/**
 * Kalman Filter-based speed calculator for GPS bus tracking.
 *
 * Uses a per-axis 2D Kalman filter (constant velocity model) to estimate
 * bus position and velocity from noisy GPS measurements. Speed is derived
 * from the velocity state, combined with endpoint-speed bounding to
 * guarantee we never overestimate.
 *
 * Handles the Straeto API's stale GPS pattern: the API often returns the
 * same lat/lng with new timestamps between real GPS hardware updates (~5s
 * cadence). Stale readings are detected by comparing consecutive raw GPS
 * positions and are excluded from the Kalman filter to prevent false
 * speed-to-zero drops.
 *
 * Also provides predicted positions for smooth 60fps map animation via
 * getPredictedPosition(), with correction blending to absorb Kalman
 * update discontinuities.
 */

import {
	OUTLIER_MIN_TIME_GAP_S,
	OUTLIER_MAX_DISTANCE_M,
	OUTLIER_MAX_SPEED_KMH,
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

// Stale detection: raw GPS positions within this distance are "same"
const STALE_THRESHOLD_M = 1.0;

// Stationarity: require this many consecutive REAL updates with small
// displacement before confirming the bus is stopped
const REAL_STATIONARY_COUNT = 3;
const REAL_STATIONARY_DIST_M = 5.0;

// Acceleration limits for physical plausibility (m/s²)
const MAX_ACCEL_MS2 = 3.0; // city bus max acceleration
const MAX_DECEL_MS2 = 5.0; // city bus max braking

// Output smoothing EMA alpha (0-1, lower = smoother)
const SPEED_EMA_ALPHA = 0.4;

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
	timestamp: number;
}

interface BlendState {
	preLat: number;
	preLng: number;
	preVlat: number; // degrees/ms velocity for extrapolation
	preVlng: number;
	startMs: number;
}

interface BusState {
	xAxis: AxisState;
	yAxis: AxisState;
	refLat: number;
	refLng: number;
	lastUpdateMs: number; // timestamp of last Kalman update (real or time advance)
	lastRealUpdateMs: number; // timestamp of last REAL GPS position change
	lastRawLat: number; // previous raw GPS position for stale detection
	lastRawLng: number;
	fixCount: number; // count of real (non-stale) fixes fed to Kalman
	realStationaryCount: number; // consecutive real updates with small displacement
	lastReportedSpeed: number;
	emaSpeed: number; // exponential moving average of speed
	// Raw position buffer for endpoint speed bounding (only real updates)
	posBuffer: PositionFix[];
	// Correction blending state
	blend: BlendState | null;
	// Whether bus is confirmed stationary
	isStationary: boolean;
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
		P00: R,
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
	const K0 = predicted.P00 / S;
	const K1 = predicted.P01 / S;

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
	 * Process a new GPS fix through stale detection + Kalman filter.
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
				lastRealUpdateMs: now,
				lastRawLat: location.lat,
				lastRawLng: location.lng,
				fixCount: 1,
				realStationaryCount: 0,
				lastReportedSpeed: 0,
				emaSpeed: 0,
				posBuffer: [{ lat: location.lat, lng: location.lng, timestamp: now }],
				blend: null,
				isStationary: false,
			});
			return copyBusLocationWith(location, { speedKmh: 0 });
		}

		// ── Time check ─────────────────────────────────────────────
		const dtMs = now - state.lastUpdateMs;
		const dtS = dtMs / 1000;
		if (dtS < OUTLIER_MIN_TIME_GAP_S) return null;

		// ── Stale detection ────────────────────────────────────────
		// Compare current raw GPS to previous raw GPS position.
		// If within STALE_THRESHOLD_M, the GPS hardware hasn't updated —
		// the API is just returning the old position with a new timestamp.
		const rawDist = haversineDistanceM(
			state.lastRawLat,
			state.lastRawLng,
			location.lat,
			location.lng,
		);
		const isStale = rawDist < STALE_THRESHOLD_M;

		// Always update raw position tracking
		state.lastRawLat = location.lat;
		state.lastRawLng = location.lng;

		if (isStale) {
			// Stale reading: GPS hasn't updated. Don't feed to Kalman.
			// Just advance time and hold current speed estimate.
			state.lastUpdateMs = now;

			// If we were moving, hold the speed (it will naturally decay
			// via the EMA when real updates resume at lower speed).
			// If we were stationary, stay at 0.
			return copyBusLocationWith(location, {
				speedKmh: state.lastReportedSpeed,
			});
		}

		// ── Real GPS update ────────────────────────────────────────
		// This is an actual position change from the GPS hardware.

		// Compute position in local coordinate system
		const [mx, my] = latLngToLocalM(
			location.lat,
			location.lng,
			state.refLat,
			state.refLng,
		);
		const dx = mx - state.xAxis.p;
		const dy = my - state.yAxis.p;
		const distFromStateM = Math.sqrt(dx * dx + dy * dy);

		// ── Outlier rejection ──────────────────────────────────────
		if (distFromStateM > OUTLIER_MAX_DISTANCE_M) {
			this.resetBus(busId);
			this.initBus(busId, location, now);
			return null;
		}

		// Use time since last REAL update for speed reasonability check
		// (stale readings don't count — the bus was moving during those)
		const realDtMs = now - state.lastRealUpdateMs;
		const realDtS = realDtMs / 1000;
		const rawSpeedKmh = realDtS > 0 ? speedKmh(distFromStateM, realDtS) : 0;
		if (rawSpeedKmh > OUTLIER_MAX_SPEED_KMH) {
			this.resetBus(busId);
			this.initBus(busId, location, now);
			return null;
		}

		// ── Stationarity detection (real updates only) ─────────────
		if (distFromStateM < REAL_STATIONARY_DIST_M) {
			state.realStationaryCount++;
		} else {
			state.realStationaryCount = 0;
		}

		const wasStationary = state.isStationary;
		state.isStationary =
			state.realStationaryCount >= REAL_STATIONARY_COUNT;

		// ── Kalman predict + update ────────────────────────────────
		// Use dt from last Kalman update (covers stale gap) for prediction,
		// which correctly models the time evolution of uncertainty.
		this.runKalmanUpdate(state, mx, my, dtS, now, location);

		// If confirmed stationary, zero velocity and decay speed smoothly
		if (state.isStationary) {
			state.xAxis.v = 0;
			state.yAxis.v = 0;

			// Smooth decay to zero over a few readings rather than snap
			const decayedSpeed = state.emaSpeed * 0.3;
			state.emaSpeed = decayedSpeed < 0.5 ? 0 : decayedSpeed;
			state.lastReportedSpeed = state.emaSpeed;
			return copyBusLocationWith(location, {
				speedKmh: state.emaSpeed,
			});
		}

		// If just left stationary, let speed ramp up naturally
		if (wasStationary && !state.isStationary) {
			// Reset velocity uncertainty to allow Kalman to pick up new motion
			state.xAxis.P11 = 100;
			state.yAxis.P11 = 100;
		}

		// ── Warm-up: need N real fixes before reporting speed ──────
		if (state.fixCount < KALMAN_MIN_FIXES_FOR_PREDICTION) {
			state.lastReportedSpeed = 0;
			state.emaSpeed = 0;
			return copyBusLocationWith(location, { speedKmh: 0 });
		}

		// ── Speed from Kalman velocity ─────────────────────────────
		const vx = state.xAxis.v;
		const vy = state.yAxis.v;
		const kalmanSpeedKmh = Math.sqrt(vx * vx + vy * vy) * 3.6;

		// ── Endpoint speed bound ───────────────────────────────────
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

		// ── Acceleration limiting ──────────────────────────────────
		// Prevent physically impossible speed changes
		if (realDtS > 0) {
			const prevSpeedMs = state.emaSpeed / 3.6;
			const newSpeedMs = finalSpeed / 3.6;
			const accelMs2 = (newSpeedMs - prevSpeedMs) / realDtS;

			if (accelMs2 > MAX_ACCEL_MS2) {
				finalSpeed = (prevSpeedMs + MAX_ACCEL_MS2 * realDtS) * 3.6;
			} else if (accelMs2 < -MAX_DECEL_MS2) {
				finalSpeed = Math.max(
					0,
					(prevSpeedMs - MAX_DECEL_MS2 * realDtS) * 3.6,
				);
			}
		}

		// ── EMA smoothing ──────────────────────────────────────────
		state.emaSpeed =
			SPEED_EMA_ALPHA * finalSpeed +
			(1 - SPEED_EMA_ALPHA) * state.emaSpeed;

		state.lastReportedSpeed = state.emaSpeed;
		return copyBusLocationWith(location, { speedKmh: state.emaSpeed });
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
		const preVlng = (state.xAxis.v / LNG_DEG_TO_M) * 1000;
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
		state.lastRealUpdateMs = now;
		state.fixCount++;

		// Update position buffer (only real updates go here)
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
			const overageS = dtS - KALMAN_PREDICTION_CAP_S;
			velocityScale = Math.max(
				0,
				1 - overageS / KALMAN_PREDICTION_DECAY_S,
			);
		}

		// If stationary, don't extrapolate
		if (state.isStationary) {
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
		if (state.blend) {
			const blendElapsed = nowMs - state.blend.startMs;
			if (blendElapsed < KALMAN_BLEND_DURATION_MS) {
				const t = blendElapsed / KALMAN_BLEND_DURATION_MS;
				const ease = 1 - Math.pow(1 - t, 3);

				const dtFromBlendS = (nowMs - state.blend.startMs) / 1000;
				const oldLat =
					state.blend.preLat +
					state.blend.preVlat * dtFromBlendS * 1000;
				const oldLng =
					state.blend.preLng +
					state.blend.preVlng * dtFromBlendS * 1000;

				return {
					lat: oldLat + (newPos.lat - oldLat) * ease,
					lng: oldLng + (newPos.lng - oldLng) * ease,
				};
			}
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
			lastRealUpdateMs: now,
			lastRawLat: location.lat,
			lastRawLng: location.lng,
			fixCount: 1,
			realStationaryCount: 0,
			lastReportedSpeed: 0,
			emaSpeed: 0,
			posBuffer: [{ lat: location.lat, lng: location.lng, timestamp: now }],
			blend: null,
			isStationary: false,
		});
	}

	resetBus(busId: string): void {
		this.busStates.delete(busId);
	}

	resetAll(): void {
		this.busStates.clear();
	}
}
