/**
 * Spline-based delayed playback renderer for GPS bus tracking.
 *
 * Replaces the Kalman filter approach. Instead of predicting forward from
 * noisy GPS, we buffer 4 genuine readings per bus and animate between
 * confirmed positions using Catmull-Rom splines. This shows real data,
 * not estimates.
 *
 * The trade-off is a ~8-10 second display delay (4 readings × ~2s each),
 * but animation is perfectly smooth and positions are always genuine.
 */

import {
	OUTLIER_MAX_SPEED_KMH,
	CONSERVATIVE_SPEED_FACTOR,
	SPLINE_MIN_BUFFER,
	SPLINE_MAX_BUFFER,
	SPLINE_STALE_THRESHOLD_M,
	SPLINE_STATIONARY_DIST_M,
	SPLINE_STATIONARY_COUNT,
	SPLINE_GAP_RESET_S,
	SPLINE_OVERSHOOT_GUARD_M,
	SPLINE_SPEED_ENDPOINT_BUFFER,
	SPEED_EMA_ALPHA,
} from '$lib/utils/constants';
import { haversineDistanceM, speedKmh } from '$lib/utils/geo';
import { copyBusLocationWith, type BusLocation } from '$lib/types/bus';

// Reykjavik coordinate conversion (meters per degree at 64°N)
const LAT_DEG_TO_M = 111_000;
const LNG_DEG_TO_M = 48_600;

// ── Types ────────────────────────────────────────────────────────────

interface SplinePoint {
	x: number; // local meters from reference
	y: number; // local meters from reference
	lat: number; // WGS84
	lng: number; // WGS84
	timestamp: number; // wall-clock epoch ms (for animation timing)
	gpsTimestamp: number; // GPS/API epoch ms (for speed calculation)
}

interface BusSplineState {
	refLat: number;
	refLng: number;
	buffer: SplinePoint[]; // genuine readings, max SPLINE_MAX_BUFFER

	// Animation
	animating: boolean;
	segmentStartTime: number; // time source value when segment animation began
	segmentDurationMs: number; // P2.timestamp - P1.timestamp
	segmentIndex: number; // index of P1 in buffer (animating P1→P2)

	// Speed
	currentSpeedKmh: number; // speed for currently animating segment

	// Stale tracking
	lastRawLat: number;
	lastRawLng: number;

	// Frozen state
	isFrozen: boolean;
	lastLat: number;
	lastLng: number;

	// Stationarity
	stationaryCount: number; // consecutive genuine readings with small displacement
	isStationary: boolean;
}

// ── Coordinate helpers ───────────────────────────────────────────────

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

// ── Catmull-Rom spline (centripetal, alpha=0.5) ──────────────────────

/**
 * Evaluate a centripetal Catmull-Rom spline at parameter t ∈ [0,1]
 * using the Barry-Goldman algorithm. Works in local meter coordinates.
 *
 * P0, P1, P2, P3 are the four control points.
 * Returns the interpolated point between P1 and P2.
 */
function catmullRom(
	p0x: number, p0y: number,
	p1x: number, p1y: number,
	p2x: number, p2y: number,
	p3x: number, p3y: number,
	t: number,
): [number, number] {
	// Centripetal parameterization: knot intervals based on sqrt(distance)
	const d01 = Math.sqrt(Math.hypot(p1x - p0x, p1y - p0y));
	const d12 = Math.sqrt(Math.hypot(p2x - p1x, p2y - p1y));
	const d23 = Math.sqrt(Math.hypot(p3x - p2x, p3y - p2y));

	// Avoid division by zero for coincident points
	const t0 = 0;
	const t1 = t0 + (d01 || 1);
	const t2 = t1 + (d12 || 1);
	const t3 = t2 + (d23 || 1);

	// Remap t from [0,1] to [t1, t2]
	const tt = t1 + t * (t2 - t1);

	// Barry-Goldman: three levels of linear interpolation
	const a1x = ((t1 - tt) / (t1 - t0)) * p0x + ((tt - t0) / (t1 - t0)) * p1x;
	const a1y = ((t1 - tt) / (t1 - t0)) * p0y + ((tt - t0) / (t1 - t0)) * p1y;
	const a2x = ((t2 - tt) / (t2 - t1)) * p1x + ((tt - t1) / (t2 - t1)) * p2x;
	const a2y = ((t2 - tt) / (t2 - t1)) * p1y + ((tt - t1) / (t2 - t1)) * p2y;
	const a3x = ((t3 - tt) / (t3 - t2)) * p2x + ((tt - t2) / (t3 - t2)) * p3x;
	const a3y = ((t3 - tt) / (t3 - t2)) * p2y + ((tt - t2) / (t3 - t2)) * p3y;

	const b1x = ((t2 - tt) / (t2 - t0)) * a1x + ((tt - t0) / (t2 - t0)) * a2x;
	const b1y = ((t2 - tt) / (t2 - t0)) * a1y + ((tt - t0) / (t2 - t0)) * a2y;
	const b2x = ((t3 - tt) / (t3 - t1)) * a2x + ((tt - t1) / (t3 - t1)) * a3x;
	const b2y = ((t3 - tt) / (t3 - t1)) * a2y + ((tt - t1) / (t3 - t1)) * a3y;

	const cx = ((t2 - tt) / (t2 - t1)) * b1x + ((tt - t1) / (t2 - t1)) * b2x;
	const cy = ((t2 - tt) / (t2 - t1)) * b1y + ((tt - t1) / (t2 - t1)) * b2y;

	return [cx, cy];
}

// ── Main renderer class ──────────────────────────────────────────────

export class SplineRenderer {
	private busStates = new Map<string, BusSplineState>();
	private getTime: () => number;

	constructor(getTime: () => number = () => Date.now()) {
		this.getTime = getTime;
	}

	/**
	 * Set a new time source (e.g. for playback mode).
	 */
	setTimeSource(getTime: () => number) {
		this.getTime = getTime;
	}

	/**
	 * Process a new GPS reading. Filters stale/outlier readings, adds genuine
	 * ones to the spline buffer, and calculates speed from confirmed positions.
	 *
	 * Returns BusLocation with speedKmh set, or null if rejected (stale/outlier).
	 */
	ingestReading(busId: string, location: BusLocation): BusLocation | null {
		const state = this.busStates.get(busId);

		// ── First fix for this bus ────────────────────────────────
		if (!state) {
			return this.initBus(busId, location);
		}

		// ── Stale detection ───────────────────────────────────────
		const rawDist = haversineDistanceM(
			state.lastRawLat, state.lastRawLng,
			location.lat, location.lng,
		);

		if (rawDist < SPLINE_STALE_THRESHOLD_M) {
			// GPS hasn't actually updated — decay speed toward zero
			state.currentSpeedKmh *= 0.8;
			return copyBusLocationWith(location, {
				speedKmh: state.currentSpeedKmh < 1 ? 0 : state.currentSpeedKmh,
			});
		}

		// Update raw position tracking
		state.lastRawLat = location.lat;
		state.lastRawLng = location.lng;

		// ── Outlier rejection ─────────────────────────────────────
		const lastPoint = state.buffer[state.buffer.length - 1];
		const nowMs = this.getTime();
		const gpsNow = location.timestamp;
		const dtS = (gpsNow - lastPoint.gpsTimestamp) / 1000;

		// Gap too large or time reversal — reset buffer
		if (dtS < 0 || dtS > SPLINE_GAP_RESET_S) {
			this.resetBus(busId);
			return this.initBus(busId, location);
		}

		// Speed too high — reset buffer
		const dist = haversineDistanceM(
			lastPoint.lat, lastPoint.lng,
			location.lat, location.lng,
		);
		if (dtS > 0 && speedKmh(dist, dtS) > OUTLIER_MAX_SPEED_KMH) {
			this.resetBus(busId);
			return this.initBus(busId, location);
		}

		// ── Add genuine reading to buffer ─────────────────────────
		const [x, y] = latLngToLocalM(
			location.lat, location.lng,
			state.refLat, state.refLng,
		);
		state.buffer.push({ x, y, lat: location.lat, lng: location.lng, timestamp: nowMs, gpsTimestamp: gpsNow });

		// ── Stationarity detection ────────────────────────────────
		if (dist < SPLINE_STATIONARY_DIST_M) {
			state.stationaryCount++;
		} else {
			state.stationaryCount = 0;
		}
		state.isStationary = state.stationaryCount >= SPLINE_STATIONARY_COUNT;

		if (state.isStationary) {
			state.currentSpeedKmh = 0;
			// Keep buffer trimmed but don't start animation for stationary buses
			if (state.buffer.length > SPLINE_MAX_BUFFER) {
				const excess = state.buffer.length - SPLINE_MAX_BUFFER;
				state.buffer.splice(0, excess);
				state.segmentIndex = Math.max(0, state.segmentIndex - excess);
			}
			return copyBusLocationWith(location, { speedKmh: 0 });
		}

		// ── Calculate speed (need 3+ readings so endpoint bound has data) ──
		if (state.buffer.length >= 3) {
			const buf = state.buffer;
			const prev = buf[buf.length - 2];
			const curr = buf[buf.length - 1];
			const segDist = haversineDistanceM(prev.lat, prev.lng, curr.lat, curr.lng);
			const segTime = (curr.gpsTimestamp - prev.gpsTimestamp) / 1000;
			const segSpeed = segTime > 0 ? speedKmh(segDist, segTime) : 0;

			// Endpoint speed bound
			let endpointSpeed = segSpeed;
			const epLen = Math.min(buf.length, SPLINE_SPEED_ENDPOINT_BUFFER);
			if (epLen >= 2) {
				const first = buf[buf.length - epLen];
				const last = buf[buf.length - 1];
				const epDist = haversineDistanceM(first.lat, first.lng, last.lat, last.lng);
				const epTime = (last.gpsTimestamp - first.gpsTimestamp) / 1000;
				if (epTime > 0) {
					endpointSpeed = speedKmh(epDist, epTime);
				}
			}

			const rawSpeed = Math.max(
				0,
				Math.min(segSpeed, endpointSpeed) * CONSERVATIVE_SPEED_FACTOR,
			);

			// EMA smoothing to prevent abrupt speed jumps
			if (state.currentSpeedKmh === 0 && rawSpeed > 0) {
				// First non-zero reading: seed EMA instead of jumping from 0
				state.currentSpeedKmh = rawSpeed;
			} else {
				state.currentSpeedKmh =
					rawSpeed * SPEED_EMA_ALPHA + state.currentSpeedKmh * (1 - SPEED_EMA_ALPHA);
			}
		}

		// ── Manage animation state ────────────────────────────────
		// Start animating when we have enough points
		if (!state.animating && state.buffer.length >= SPLINE_MIN_BUFFER) {
			state.animating = true;
			state.segmentIndex = 1; // animate from P1 to P2 (P0 is pre-control)
			state.segmentStartTime = nowMs;
			const p1 = state.buffer[1];
			const p2 = state.buffer[2];
			state.segmentDurationMs = p2.timestamp - p1.timestamp;
			if (state.segmentDurationMs <= 0) state.segmentDurationMs = 2000;
			state.isFrozen = false;
		}

		// Trim buffer if too long, maintaining the 4-point window around segmentIndex
		if (state.buffer.length > SPLINE_MAX_BUFFER) {
			const excess = state.buffer.length - SPLINE_MAX_BUFFER;
			state.buffer.splice(0, excess);
			state.segmentIndex = Math.max(0, state.segmentIndex - excess);
		}

		// Unfreeze if we were frozen and got new data
		if (state.isFrozen && state.animating) {
			state.isFrozen = false;
		}

		return copyBusLocationWith(location, { speedKmh: state.currentSpeedKmh });
	}

	/**
	 * Get the animated position for a bus at the given timestamp.
	 * Uses Catmull-Rom spline interpolation between confirmed GPS points.
	 *
	 * Returns null if the bus doesn't have enough data yet (warming up).
	 */
	getAnimatedPosition(
		busId: string,
		nowMs: number,
	): { lat: number; lng: number; isFrozen: boolean } | null {
		const state = this.busStates.get(busId);
		if (!state) return null;

		// Not enough points yet — bus is warming up
		if (!state.animating || state.buffer.length < SPLINE_MIN_BUFFER) {
			return null;
		}

		// Stationary: hold at last confirmed position
		if (state.isStationary) {
			const last = state.buffer[state.buffer.length - 1];
			state.lastLat = last.lat;
			state.lastLng = last.lng;
			return { lat: last.lat, lng: last.lng, isFrozen: false };
		}

		// Compute animation progress
		const elapsed = nowMs - state.segmentStartTime;
		const duration = state.segmentDurationMs || 2000; // fallback 2s
		let t = elapsed / duration;

		// Try to advance to next segment if t >= 1
		while (t >= 1.0) {
			const nextP2Index = state.segmentIndex + 2;
			if (nextP2Index < state.buffer.length) {
				// Advance segment
				state.segmentIndex++;
				const p1 = state.buffer[state.segmentIndex];
				const p2 = state.buffer[state.segmentIndex + 1];
				state.segmentDurationMs = p2.timestamp - p1.timestamp;
				if (state.segmentDurationMs <= 0) state.segmentDurationMs = 2000;
				state.segmentStartTime += duration;
				state.isFrozen = false;

				const newElapsed = nowMs - state.segmentStartTime;
				const newDuration = state.segmentDurationMs || 2000;
				t = newElapsed / newDuration;
			} else {
				// No next segment available — freeze at last confirmed position
				const lastAnimPoint = state.buffer[state.segmentIndex + 1] ?? state.buffer[state.buffer.length - 1];
				state.isFrozen = true;
				state.lastLat = lastAnimPoint.lat;
				state.lastLng = lastAnimPoint.lng;
				return { lat: lastAnimPoint.lat, lng: lastAnimPoint.lng, isFrozen: true };
			}
		}

		t = Math.max(0, Math.min(1, t));

		// Get the 4 control points: P0, P1, P2, P3
		const i = state.segmentIndex; // P1 index
		const p0 = state.buffer[i - 1] ?? state.buffer[i]; // P0 (or duplicate P1)
		const p1 = state.buffer[i];
		const p2 = state.buffer[i + 1];
		const p3 = state.buffer[i + 2] ?? p2; // P3 (or duplicate P2)

		if (!p1 || !p2) {
			// Safety: shouldn't happen, but return last known position
			return { lat: state.lastLat, lng: state.lastLng, isFrozen: true };
		}

		// Evaluate Catmull-Rom spline in local meter coordinates
		const [sx, sy] = catmullRom(
			p0.x, p0.y,
			p1.x, p1.y,
			p2.x, p2.y,
			p3.x, p3.y,
			t,
		);

		// Overshoot guard: if spline deviates too far from the chord, fall back to linear
		const linearX = p1.x + (p2.x - p1.x) * t;
		const linearY = p1.y + (p2.y - p1.y) * t;
		const deviationM = Math.hypot(sx - linearX, sy - linearY);

		let finalX: number, finalY: number;
		if (deviationM > SPLINE_OVERSHOOT_GUARD_M) {
			finalX = linearX;
			finalY = linearY;
		} else {
			finalX = sx;
			finalY = sy;
		}

		// Convert back to lat/lng
		const pos = localMToLatLng(finalX, finalY, state.refLat, state.refLng);
		state.lastLat = pos.lat;
		state.lastLng = pos.lng;
		state.isFrozen = false;

		return { lat: pos.lat, lng: pos.lng, isFrozen: false };
	}

	/** Remove bus states that haven't been updated recently. */
	cleanupStale(maxAgeMs: number = 120_000): void {
		const now = this.getTime();
		for (const [busId, state] of this.busStates) {
			const lastTs = state.buffer[state.buffer.length - 1]?.timestamp ?? 0;
			if (now - lastTs > maxAgeMs) {
				this.busStates.delete(busId);
			}
		}
	}

	resetBus(busId: string): void {
		this.busStates.delete(busId);
	}

	private initBus(busId: string, location: BusLocation): BusLocation {
		this.busStates.set(busId, {
			refLat: location.lat,
			refLng: location.lng,
			buffer: [{ x: 0, y: 0, lat: location.lat, lng: location.lng, timestamp: this.getTime(), gpsTimestamp: location.timestamp }],
			animating: false,
			segmentStartTime: 0,
			segmentDurationMs: 0,
			segmentIndex: 0,
			currentSpeedKmh: 0,
			lastRawLat: location.lat,
			lastRawLng: location.lng,
			isFrozen: false,
			lastLat: location.lat,
			lastLng: location.lng,
			stationaryCount: 0,
			isStationary: false,
		});
		return copyBusLocationWith(location, { speedKmh: 0 });
	}

	resetAll(): void {
		this.busStates.clear();
	}
}
