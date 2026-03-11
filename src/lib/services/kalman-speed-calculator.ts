/**
 * Kalman Filter-based speed calculator for GPS bus tracking.
 *
 * Uses a per-axis 2D Kalman filter (constant velocity model) to estimate
 * bus position and velocity from noisy GPS measurements. Speed is derived
 * from the velocity state, combined with endpoint-speed bounding to
 * guarantee we never overestimate.
 *
 * Also provides predicted positions for smooth 60fps map animation via
 * getPredictedPosition(), with correction blending to absorb Kalman
 * update discontinuities.
 */

import {
	OUTLIER_MIN_TIME_GAP_S,
	OUTLIER_MAX_DISTANCE_M,
	OUTLIER_MAX_SPEED_KMH,
	MIN_DISTANCE_THRESHOLD_M,
	STATIONARY_CONFIRM_COUNT,
	CONSERVATIVE_SPEED_FACTOR,
	KALMAN_SIGMA_A,
	KALMAN_SIGMA_GPS,
	KALMAN_MIN_FIXES_FOR_PREDICTION,
	KALMAN_PREDICTION_CAP_S,
	KALMAN_PREDICTION_DECAY_S,
	KALMAN_BLEND_DURATION_MS,
	KALMAN_ENDPOINT_BUFFER_SIZE,
} from '$lib/utils/constants';
import { haversineDistanceM, speedKmh } from '$lib/utils/geo';
import { copyBusLocationWith, type BusLocation } from '$lib/types/bus';

// Reykjavik coordinate conversion (meters per degree at 64°N)
const LAT_DEG_TO_M = 111_000;
const LNG_DEG_TO_M = 48_600;

// ── Per-axis Kalman state ──────────────────────────────────────────────

interface AxisState {
	p: number; // position (meters from reference)
	v: number; // velocity (m/s)
	// Symmetric 2×2 covariance (P01 = P10)
	P00: number;
	P01: number;
	P11: number;
}

interface PositionFix {
	lat: number;
	lng: number;
	timestamp: number; // Date.now() when processed
}

interface BlendState {
	preLat: number;
	preLng: number;
	preVlat: number; // degrees/ms velocity for extrapolation
	preVlng: number;
	startMs: number;
}

interface BusState {
	xAxis: AxisState; // longitude axis (meters)
	yAxis: AxisState; // latitude axis (meters)
	refLat: number; // reference point for local coordinate system
	refLng: number;
	lastUpdateMs: number; // Date.now() of last Kalman update
	fixCount: number;
	stationaryCount: number;
	lastReportedSpeed: number;
	// Raw position buffer for endpoint speed bounding
	posBuffer: PositionFix[];
	// Correction blending state
	blend: BlendState | null;
}

// ── Coordinate helpers ─────────────────────────────────────────────────

function latLngToLocalM(
	lat: number,
	lng: number,
	refLat: number,
	refLng: number,
): [number, number] {
	return [(lng - refLng) * LNG_DEG_TO_M, (lat - refLat) * LAT_DEG_TO_M];
}

function localMToLatLng(
	xM: number,
	yM: number,
	refLat: number,
	refLng: number,
): { lat: number; lng: number } {
	return {
		lat: refLat + yM / LAT_DEG_TO_M,
		lng: refLng + xM / LNG_DEG_TO_M,
	};
}

// ── Kalman math ────────────────────────────────────────────────────────

function createAxisState(positionM: number): AxisState {
	const R = KALMAN_SIGMA_GPS * KALMAN_SIGMA_GPS;
	return {
		p: positionM,
		v: 0,
		P00: R, // initial position variance = GPS variance
		P01: 0,
		P11: 100, // large velocity uncertainty (10 m/s)
	};
}

function kalmanPredict(axis: AxisState, dt: number): AxisState {
	const sigmaA2 = KALMAN_SIGMA_A * KALMAN_SIGMA_A;
	const dt2 = dt * dt;
	const dt3 = dt2 * dt;
	const dt4 = dt2 * dt2;

	return {
		p: axis.p + axis.v * dt,
		v: axis.v,
		P00:
			axis.P00 +
			dt * axis.P01 +
			dt * (axis.P01 + dt * axis.P11) +
			sigmaA2 * (dt4 / 4),
		P01: axis.P01 + dt * axis.P11 + sigmaA2 * (dt3 / 2),
		P11: axis.P11 + sigmaA2 * dt2,
	};
}

function kalmanUpdate(predicted: AxisState, measurement: number): AxisState {
	const R = KALMAN_SIGMA_GPS * KALMAN_SIGMA_GPS;
	const innovation = measurement - predicted.p;
	const S = predicted.P00 + R;
	const K0 = predicted.P00 / S; // position gain
	const K1 = predicted.P01 / S; // velocity gain

	return {
		p: predicted.p + K0 * innovation,
		v: predicted.v + K1 * innovation,
		P00: (1 - K0) * predicted.P00,
		P01: (1 - K0) * predicted.P01,
		P11: -K1 * predicted.P01 + predicted.P11,
	};
}

// ── Main calculator class ──────────────────────────────────────────────

export class KalmanSpeedCalculator {
	private busStates = new Map<string, BusState>();

	/**
	 * Process a new GPS fix through outlier rejection + Kalman filter.
	 * Returns BusLocation with speedKmh set, or null if rejected.
	 */
	processFix(location: BusLocation): BusLocation | null {
		const { busId } = location;
		const now = Date.now();
		const state = this.busStates.get(busId);

		// ── First fix for this bus ─────────────────────────────────
		if (!state) {
			this.busStates.set(busId, {
				xAxis: createAxisState(0),
				yAxis: createAxisState(0),
				refLat: location.lat,
				refLng: location.lng,
				lastUpdateMs: now,
				fixCount: 1,
				stationaryCount: 0,
				lastReportedSpeed: 0,
				posBuffer: [{ lat: location.lat, lng: location.lng, timestamp: now }],
				blend: null,
			});
			return copyBusLocationWith(location, { speedKmh: 0 });
		}

		// ── Time check ─────────────────────────────────────────────
		const dtMs = now - state.lastUpdateMs;
		const dtS = dtMs / 1000;
		if (dtS < OUTLIER_MIN_TIME_GAP_S) return null;

		// ── Outlier rejection ──────────────────────────────────────
		const [mx, my] = latLngToLocalM(
			location.lat,
			location.lng,
			state.refLat,
			state.refLng,
		);
		const dx = mx - state.xAxis.p;
		const dy = my - state.yAxis.p;
		const distFromStateM = Math.sqrt(dx * dx + dy * dy);

		if (distFromStateM > OUTLIER_MAX_DISTANCE_M) {
			this.resetBus(busId);
			this.initBus(busId, location, now);
			return null;
		}

		const rawSpeedKmh = speedKmh(distFromStateM, dtS);
		if (rawSpeedKmh > OUTLIER_MAX_SPEED_KMH) {
			this.resetBus(busId);
			this.initBus(busId, location, now);
			return null;
		}

		// ── Stationarity detection (distance-based, pre-Kalman) ───
		// Raw GPS displacement from last Kalman position
		if (distFromStateM < MIN_DISTANCE_THRESHOLD_M) {
			state.stationaryCount++;

			// Still run Kalman update so position estimate stays current
			this.runKalmanUpdate(state, mx, my, dtS, now, location);

			if (state.stationaryCount >= STATIONARY_CONFIRM_COUNT) {
				// Confirmed stationary — zero out velocity estimate
				state.xAxis.v = 0;
				state.yAxis.v = 0;
				state.lastReportedSpeed = 0;
				// Clear speed-relevant buffer
				state.posBuffer = [
					{ lat: location.lat, lng: location.lng, timestamp: now },
				];
				return copyBusLocationWith(location, { speedKmh: 0 });
			}

			// Not confirmed yet — hold previous speed
			return copyBusLocationWith(location, {
				speedKmh: state.lastReportedSpeed,
			});
		}

		// Bus is moving
		state.stationaryCount = 0;

		// ── Kalman predict + update ────────────────────────────────
		this.runKalmanUpdate(state, mx, my, dtS, now, location);

		// ── Warm-up: need N fixes before reporting speed ───────────
		if (state.fixCount < KALMAN_MIN_FIXES_FOR_PREDICTION) {
			state.lastReportedSpeed = 0;
			return copyBusLocationWith(location, { speedKmh: 0 });
		}

		// ── Speed from Kalman velocity ─────────────────────────────
		const vx = state.xAxis.v;
		const vy = state.yAxis.v;
		const kalmanSpeedKmh = Math.sqrt(vx * vx + vy * vy) * 3.6;

		// ── Endpoint speed bound ───────────────────────────────────
		// Displacement across the position buffer / time span
		// This always underestimates (displacement ≤ path length) and
		// acts as an upper bound to prevent occasional Kalman overshots.
		let finalSpeed = kalmanSpeedKmh;

		const buf = state.posBuffer;
		if (buf.length >= 3) {
			const first = buf[0];
			const last = buf[buf.length - 1];
			const epDistM = haversineDistanceM(
				first.lat,
				first.lng,
				last.lat,
				last.lng,
			);
			const epTimeS = (last.timestamp - first.timestamp) / 1000;
			if (epTimeS > 0) {
				const endpointSpeed = speedKmh(epDistM, epTimeS);
				finalSpeed = Math.min(kalmanSpeedKmh, endpointSpeed);
			}
		}

		// ── Conservative factor ────────────────────────────────────
		finalSpeed = Math.max(
			0,
			Math.min(OUTLIER_MAX_SPEED_KMH, finalSpeed * CONSERVATIVE_SPEED_FACTOR),
		);

		state.lastReportedSpeed = finalSpeed;
		return copyBusLocationWith(location, { speedKmh: finalSpeed });
	}

	/**
	 * Run Kalman predict + update and manage blend/buffer state.
	 */
	private runKalmanUpdate(
		state: BusState,
		mx: number,
		my: number,
		dtS: number,
		now: number,
		location: BusLocation,
	) {
		// Save pre-update position for correction blending
		const prePos = localMToLatLng(
			state.xAxis.p,
			state.yAxis.p,
			state.refLat,
			state.refLng,
		);

		// Velocity in degrees/ms for blend extrapolation
		const preVlng = (state.xAxis.v / LNG_DEG_TO_M) * 1000; // deg/ms
		const preVlat = (state.yAxis.v / LAT_DEG_TO_M) * 1000;

		// Predict
		const predX = kalmanPredict(state.xAxis, dtS);
		const predY = kalmanPredict(state.yAxis, dtS);

		// Update
		state.xAxis = kalmanUpdate(predX, mx);
		state.yAxis = kalmanUpdate(predY, my);

		// Store blend state for smooth correction in animation
		if (state.fixCount >= KALMAN_MIN_FIXES_FOR_PREDICTION) {
			state.blend = {
				preLat: prePos.lat + preVlat * (now - state.lastUpdateMs),
				preLng: prePos.lng + preVlng * (now - state.lastUpdateMs),
				preVlat,
				preVlng,
				startMs: now,
			};
		}

		state.lastUpdateMs = now;
		state.fixCount++;

		// Update position buffer for endpoint speed
		state.posBuffer.push({
			lat: location.lat,
			lng: location.lng,
			timestamp: now,
		});
		if (state.posBuffer.length > KALMAN_ENDPOINT_BUFFER_SIZE) {
			state.posBuffer.shift();
		}
	}

	/**
	 * Get predicted position for smooth 60fps animation.
	 * Extrapolates from Kalman velocity with correction blending.
	 * Returns null if bus has no state or hasn't converged.
	 */
	getPredictedPosition(
		busId: string,
		nowMs: number,
	): { lat: number; lng: number } | null {
		const state = this.busStates.get(busId);
		if (!state) return null;

		// During warm-up, return current Kalman position (no extrapolation)
		if (state.fixCount < KALMAN_MIN_FIXES_FOR_PREDICTION) {
			return localMToLatLng(
				state.xAxis.p,
				state.yAxis.p,
				state.refLat,
				state.refLng,
			);
		}

		// Time since last Kalman update
		const dtS = Math.max(0, (nowMs - state.lastUpdateMs) / 1000);

		// Cap extrapolation and apply velocity decay
		let velocityScale = 1.0;
		let clampedDtS = dtS;
		if (dtS > KALMAN_PREDICTION_CAP_S) {
			clampedDtS = KALMAN_PREDICTION_CAP_S;
			// Linearly decay velocity to 0 over DECAY window
			const overageS = dtS - KALMAN_PREDICTION_CAP_S;
			velocityScale = Math.max(
				0,
				1 - overageS / KALMAN_PREDICTION_DECAY_S,
			);
		}

		// If stationary, don't extrapolate
		if (state.stationaryCount >= STATIONARY_CONFIRM_COUNT) {
			return localMToLatLng(
				state.xAxis.p,
				state.yAxis.p,
				state.refLat,
				state.refLng,
			);
		}

		// Kalman-predicted position
		const predX =
			state.xAxis.p + state.xAxis.v * clampedDtS * velocityScale;
		const predY =
			state.yAxis.p + state.yAxis.v * clampedDtS * velocityScale;
		const newPos = localMToLatLng(
			predX,
			predY,
			state.refLat,
			state.refLng,
		);

		// ── Correction blending ────────────────────────────────────
		// Smoothly absorb the Kalman update discontinuity over BLEND_DURATION
		if (state.blend) {
			const blendElapsed = nowMs - state.blend.startMs;
			if (blendElapsed < KALMAN_BLEND_DURATION_MS) {
				// Ease-out cubic for natural deceleration of correction
				const t = blendElapsed / KALMAN_BLEND_DURATION_MS;
				const ease = 1 - Math.pow(1 - t, 3);

				// Old trajectory: where the pre-update state would have predicted
				const dtFromBlendS = (nowMs - state.blend.startMs) / 1000;
				const oldLat =
					state.blend.preLat +
					state.blend.preVlat * dtFromBlendS * 1000;
				const oldLng =
					state.blend.preLng +
					state.blend.preVlng * dtFromBlendS * 1000;

				// Blend from old trajectory to new trajectory
				return {
					lat: oldLat + (newPos.lat - oldLat) * ease,
					lng: oldLng + (newPos.lng - oldLng) * ease,
				};
			}
			// Blend complete — clear
			state.blend = null;
		}

		return newPos;
	}

	private initBus(busId: string, location: BusLocation, now: number) {
		this.busStates.set(busId, {
			xAxis: createAxisState(0),
			yAxis: createAxisState(0),
			refLat: location.lat,
			refLng: location.lng,
			lastUpdateMs: now,
			fixCount: 1,
			stationaryCount: 0,
			lastReportedSpeed: 0,
			posBuffer: [{ lat: location.lat, lng: location.lng, timestamp: now }],
			blend: null,
		});
	}

	resetBus(busId: string): void {
		this.busStates.delete(busId);
	}

	resetAll(): void {
		this.busStates.clear();
	}
}
