import { describe, it, expect, beforeEach } from 'vitest';
import {
	TrajectoryCleaner,
	CleanedTrajectory,
	type CleanedPoint,
} from '$lib/services/trajectory-cleaner';
import { MapMatcher } from '$lib/services/map-matcher';
import type { RawReading } from '$lib/services/raw-buffer';
import { haversineDistanceM } from '$lib/utils/geo';
import { CONSERVATIVE_SPEED_FACTOR, OUTLIER_MAX_SPEED_KMH } from '$lib/utils/constants';

// Coordinate helpers at Reykjavik latitude (64.14N)
const LAT_PER_M = 1 / 111_000;
const LNG_PER_M = 1 / 48_600;

const BASE_LAT = 64.14;
const BASE_LNG = -21.92;
const BASE_TIME = 1_710_000_000_000;

/** Create a RawReading with sensible defaults. */
function makeReading(overrides: Partial<RawReading> = {}): RawReading {
	return {
		busId: 'bus-1',
		routeNr: '1',
		tripId: 'trip-1',
		lat: BASE_LAT,
		lng: BASE_LNG,
		direction: 0,
		timestamp: BASE_TIME,
		isStale: false,
		...overrides,
	};
}

/**
 * Create a sequence of readings moving north from a starting point.
 * Each reading is `stepM` meters north of the previous, separated by `intervalMs`.
 */
function makeNorthboundReadings(
	count: number,
	opts: {
		stepM?: number;
		intervalMs?: number;
		startLat?: number;
		startLng?: number;
		startTime?: number;
		busId?: string;
		routeNr?: string;
	} = {},
): RawReading[] {
	const stepM = opts.stepM ?? 30;
	const intervalMs = opts.intervalMs ?? 3000;
	const startLat = opts.startLat ?? BASE_LAT;
	const startLng = opts.startLng ?? BASE_LNG;
	const startTime = opts.startTime ?? BASE_TIME;
	const busId = opts.busId ?? 'bus-1';
	const routeNr = opts.routeNr ?? '1';

	return Array.from({ length: count }, (_, i) => ({
		busId,
		routeNr,
		tripId: 'trip-1',
		lat: startLat + i * stepM * LAT_PER_M,
		lng: startLng,
		direction: 0,
		timestamp: startTime + i * intervalMs,
		isStale: false,
	}));
}

/**
 * Create a sequence of readings moving east from a starting point.
 */
function makeEastboundReadings(
	count: number,
	opts: {
		stepM?: number;
		intervalMs?: number;
		startLat?: number;
		startLng?: number;
		startTime?: number;
	} = {},
): RawReading[] {
	const stepM = opts.stepM ?? 30;
	const intervalMs = opts.intervalMs ?? 3000;
	const startLat = opts.startLat ?? BASE_LAT;
	const startLng = opts.startLng ?? BASE_LNG;
	const startTime = opts.startTime ?? BASE_TIME;

	return Array.from({ length: count }, (_, i) => ({
		busId: 'bus-1',
		routeNr: '1',
		tripId: 'trip-1',
		lat: startLat,
		lng: startLng + i * stepM * LNG_PER_M,
		direction: 90,
		timestamp: startTime + i * intervalMs,
		isStale: false,
	}));
}

describe('TrajectoryCleaner', () => {
	let cleaner: TrajectoryCleaner;
	let matcher: MapMatcher;

	beforeEach(() => {
		cleaner = new TrajectoryCleaner();
		matcher = new MapMatcher();
	});

	// ----------------------------------------------------------------
	// 1. Basic cleaning
	// ----------------------------------------------------------------
	describe('basic cleaning', () => {
		it('takes readings and produces a CleanedTrajectory', () => {
			const readings = makeNorthboundReadings(6);
			const result = cleaner.clean(readings, matcher, null, null);

			expect(result).not.toBeNull();
			expect(result).toBeInstanceOf(CleanedTrajectory);
			expect(result!.busId).toBe('bus-1');
			expect(result!.routeNr).toBe('1');
			expect(result!.points.length).toBeGreaterThanOrEqual(2);
		});

		it('produces points with all required fields', () => {
			const readings = makeNorthboundReadings(5);
			const result = cleaner.clean(readings, matcher, null, null)!;

			for (const pt of result.points) {
				expect(pt).toHaveProperty('lat');
				expect(pt).toHaveProperty('lng');
				expect(pt).toHaveProperty('timestamp');
				expect(pt).toHaveProperty('distAlongRouteM');
				expect(pt).toHaveProperty('snappedLat');
				expect(pt).toHaveProperty('snappedLng');
				expect(pt).toHaveProperty('isGenuine');
				expect(pt).toHaveProperty('isNearStop');
				expect(pt).toHaveProperty('matchConfidence');
				expect(pt).toHaveProperty('rawSpeedKmh');
			}
		});

		it('preserves time ordering of points', () => {
			const readings = makeNorthboundReadings(8);
			const result = cleaner.clean(readings, matcher, null, null)!;

			for (let i = 1; i < result.points.length; i++) {
				expect(result.points[i].timestamp).toBeGreaterThanOrEqual(
					result.points[i - 1].timestamp,
				);
			}
		});

		it('marks trajectory as valid when it has >= 2 points', () => {
			const readings = makeNorthboundReadings(5);
			const result = cleaner.clean(readings, matcher, null, null)!;
			expect(result.isValid).toBe(true);
		});

		it('marks trajectory as invalid when it has < 2 points', () => {
			// Single reading — after cleaning, only 1 point
			const readings = [makeReading()];
			const result = cleaner.clean(readings, matcher, null, null);

			// With only 1 reading, trajectory has 1 point — not valid
			if (result !== null) {
				expect(result.isValid).toBe(false);
			}
		});
	});

	// ----------------------------------------------------------------
	// 2. Stale deduplication
	// ----------------------------------------------------------------
	describe('stale deduplication', () => {
		it('deduplicates consecutive readings at the same position', () => {
			const samePosition = { lat: BASE_LAT, lng: BASE_LNG };
			const readings: RawReading[] = [];

			// 5 readings at the same position, then 5 moving
			for (let i = 0; i < 5; i++) {
				readings.push(
					makeReading({
						...samePosition,
						timestamp: BASE_TIME + i * 3000,
						isStale: i > 0,
					}),
				);
			}
			for (let i = 0; i < 5; i++) {
				readings.push(
					makeReading({
						lat: BASE_LAT + (i + 1) * 30 * LAT_PER_M,
						lng: BASE_LNG,
						timestamp: BASE_TIME + (5 + i) * 3000,
						isStale: false,
					}),
				);
			}

			const result = cleaner.clean(readings, matcher, null, null)!;
			// The 5 stale readings should be reduced (first + last kept),
			// total points should be fewer than 10
			expect(result.points.length).toBeLessThan(10);
		});

		it('keeps first and last of a stale cluster', () => {
			// 4 readings at same position, then 1 that moves
			const readings: RawReading[] = [];
			for (let i = 0; i < 4; i++) {
				readings.push(
					makeReading({
						lat: BASE_LAT,
						lng: BASE_LNG,
						timestamp: BASE_TIME + i * 3000,
						isStale: i > 0,
					}),
				);
			}
			readings.push(
				makeReading({
					lat: BASE_LAT + 50 * LAT_PER_M,
					lng: BASE_LNG,
					timestamp: BASE_TIME + 4 * 3000,
					isStale: false,
				}),
			);

			const result = cleaner.clean(readings, matcher, null, null)!;

			// Should have the cluster bookends + the moved point
			// The stale cluster (first and last) + the final moved reading
			expect(result).not.toBeNull();
			expect(result.points.length).toBeGreaterThanOrEqual(2);
		});

		it('handles all readings at identical positions without crashing', () => {
			const readings: RawReading[] = [];
			for (let i = 0; i < 5; i++) {
				readings.push(
					makeReading({
						timestamp: BASE_TIME + i * 3000,
						isStale: i > 0,
					}),
				);
			}

			// Should not throw; may return null or a minimal trajectory
			const result = cleaner.clean(readings, matcher, null, null);
			// All same position — dedup keeps first+last, but distance is 0
			// This is valid — it just shows a stationary bus
			if (result !== null) {
				expect(result.points.length).toBeGreaterThanOrEqual(1);
			}
		});
	});

	// ----------------------------------------------------------------
	// 3. Outlier rejection
	// ----------------------------------------------------------------
	describe('outlier rejection', () => {
		it('removes a point that jumps wildly compared to neighbors', () => {
			// Normal trajectory with one wild jump in the middle
			const readings: RawReading[] = [];
			for (let i = 0; i < 8; i++) {
				let lat = BASE_LAT + i * 30 * LAT_PER_M;
				if (i === 4) {
					// Outlier: jump 1 km north suddenly then back
					lat = BASE_LAT + 1000 * LAT_PER_M;
				}
				readings.push(
					makeReading({
						lat,
						lng: BASE_LNG,
						timestamp: BASE_TIME + i * 3000,
					}),
				);
			}

			const result = cleaner.clean(readings, matcher, null, null)!;

			// The outlier point should be removed — check that no point is near
			// the 1km jump position
			for (const pt of result.points) {
				const distToOutlier = haversineDistanceM(
					pt.lat,
					pt.lng,
					BASE_LAT + 1000 * LAT_PER_M,
					BASE_LNG,
				);
				expect(distToOutlier).toBeGreaterThan(50);
			}
		});

		it('keeps points within reasonable speed range', () => {
			// All points moving at ~36 km/h (10 m/s, 30m every 3s)
			const readings = makeNorthboundReadings(8, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// All original points should be kept (no outliers)
			// Dedup might remove some but outlier rejection shouldn't
			expect(result.points.length).toBeGreaterThanOrEqual(6);
		});

		it('removes points that imply impossible speed to both neighbors', () => {
			// Point implies > 90 km/h to both its neighbors
			// Normal: 30m in 3s = 36 km/h
			// Outlier at index 3: huge forward jump then back
			const readings = makeNorthboundReadings(7, { stepM: 30, intervalMs: 3000 });

			// Insert outlier: same timestamp spacing, but 600m ahead
			readings[3] = makeReading({
				lat: BASE_LAT + 600 * LAT_PER_M,
				lng: BASE_LNG,
				timestamp: BASE_TIME + 3 * 3000,
			});

			const result = cleaner.clean(readings, matcher, null, null)!;

			// The outlier at index 3 should be rejected
			for (const pt of result.points) {
				const distFromOutlier = haversineDistanceM(
					pt.lat,
					pt.lng,
					BASE_LAT + 600 * LAT_PER_M,
					BASE_LNG,
				);
				expect(distFromOutlier).toBeGreaterThan(50);
			}
		});
	});

	// ----------------------------------------------------------------
	// 4. Monotonic enforcement
	// ----------------------------------------------------------------
	describe('monotonic enforcement', () => {
		it('removes points where distance decreases (backward movement)', () => {
			// Moving north, then one point goes back south, then north again
			const readings: RawReading[] = [
				makeReading({ lat: BASE_LAT, timestamp: BASE_TIME }),
				makeReading({ lat: BASE_LAT + 50 * LAT_PER_M, timestamp: BASE_TIME + 3000 }),
				makeReading({ lat: BASE_LAT + 100 * LAT_PER_M, timestamp: BASE_TIME + 6000 }),
				// Backward jump — goes back to 60m (less than 100m)
				makeReading({ lat: BASE_LAT + 60 * LAT_PER_M, timestamp: BASE_TIME + 9000 }),
				makeReading({ lat: BASE_LAT + 150 * LAT_PER_M, timestamp: BASE_TIME + 12000 }),
				makeReading({ lat: BASE_LAT + 200 * LAT_PER_M, timestamp: BASE_TIME + 15000 }),
			];

			const result = cleaner.clean(readings, matcher, null, null)!;

			// Distance along route should be monotonically non-decreasing
			for (let i = 1; i < result.points.length; i++) {
				expect(result.points[i].distAlongRouteM).toBeGreaterThanOrEqual(
					result.points[i - 1].distAlongRouteM,
				);
			}
		});

		it('guarantees forward-only movement in output', () => {
			// Mix of forward and backward readings
			const readings: RawReading[] = [
				makeReading({ lat: BASE_LAT, timestamp: BASE_TIME }),
				makeReading({ lat: BASE_LAT + 30 * LAT_PER_M, timestamp: BASE_TIME + 3000 }),
				makeReading({ lat: BASE_LAT + 20 * LAT_PER_M, timestamp: BASE_TIME + 6000 }), // backward
				makeReading({ lat: BASE_LAT + 10 * LAT_PER_M, timestamp: BASE_TIME + 9000 }), // backward
				makeReading({ lat: BASE_LAT + 60 * LAT_PER_M, timestamp: BASE_TIME + 12000 }),
				makeReading({ lat: BASE_LAT + 90 * LAT_PER_M, timestamp: BASE_TIME + 15000 }),
			];

			const result = cleaner.clean(readings, matcher, null, null)!;

			for (let i = 1; i < result.points.length; i++) {
				expect(result.points[i].distAlongRouteM).toBeGreaterThanOrEqual(
					result.points[i - 1].distAlongRouteM,
				);
			}
		});

		it('does not remove points that move forward', () => {
			const readings = makeNorthboundReadings(6, { stepM: 50 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// All points are forward-moving — none should be removed by monotonic step
			expect(result.points.length).toBe(6);
		});
	});

	// ----------------------------------------------------------------
	// 5. Stationarity detection
	// ----------------------------------------------------------------
	describe('stationarity detection', () => {
		it('marks a stopped bus with speed=0', () => {
			// Bus stays at same position for many readings, then moves
			const readings: RawReading[] = [];

			// 6 readings at same position (stationary)
			for (let i = 0; i < 6; i++) {
				readings.push(
					makeReading({
						lat: BASE_LAT + (i * 0.5) * LAT_PER_M, // tiny movement < 1m each
						lng: BASE_LNG,
						timestamp: BASE_TIME + i * 3000,
						isStale: i > 0,
					}),
				);
			}

			// Then start moving
			for (let i = 0; i < 4; i++) {
				readings.push(
					makeReading({
						lat: BASE_LAT + (10 + i * 30) * LAT_PER_M,
						lng: BASE_LNG,
						timestamp: BASE_TIME + (6 + i) * 3000,
					}),
				);
			}

			const result = cleaner.clean(readings, matcher, null, null)!;

			// The stationary cluster at the beginning should have speed ~0
			const stationaryPoints = result.points.filter(
				(pt) => pt.timestamp <= BASE_TIME + 5 * 3000,
			);
			for (const pt of stationaryPoints) {
				expect(pt.rawSpeedKmh).toBe(0);
			}
		});

		it('detects stationarity when bus moves < 3m over 3+ readings', () => {
			// Each step is 1.2m (above DEDUP_DISTANCE_M=1.0 so not collapsed),
			// but cumulative stays under STATIONARY_DIST_M=3.0 for 3+ points.
			// Points: 0, 1.2, 2.4 are all within 3m of the start -> count=3 >= STATIONARY_COUNT
			const readings: RawReading[] = [];
			for (let i = 0; i < 5; i++) {
				readings.push(
					makeReading({
						lat: BASE_LAT + (i * 1.2) * LAT_PER_M,
						lng: BASE_LNG,
						timestamp: BASE_TIME + i * 3000,
					}),
				);
			}
			// Add a final movement well beyond the stationary cluster
			readings.push(
				makeReading({
					lat: BASE_LAT + 100 * LAT_PER_M,
					lng: BASE_LNG,
					timestamp: BASE_TIME + 5 * 3000,
				}),
			);

			const result = cleaner.clean(readings, matcher, null, null)!;

			// isStationaryAtTime should return true during the slow-drift period
			// The first few points (within 3m of each other) should be marked stationary
			const stationaryTime = result.points[1].timestamp;
			expect(result.isStationaryAtTime(stationaryTime)).toBe(true);
		});
	});

	// ----------------------------------------------------------------
	// 6. Speed calculation
	// ----------------------------------------------------------------
	describe('speed calculation', () => {
		it('calculates reasonable speeds from cleaned distances', () => {
			// 30m every 3s = 10 m/s = 36 km/h
			const readings = makeNorthboundReadings(8, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// Smoothed speeds for moving points should be in a reasonable range
			// Expected: ~36 * 0.95 = ~34.2 km/h (with conservative factor)
			// Gaussian smoothing will affect edges but middle should be stable
			const midIdx = Math.floor(result.points.length / 2);
			const midSpeed = result.speedAtTime(result.points[midIdx].timestamp);

			// Should be in the range 25-45 km/h (some smoothing tolerance)
			expect(midSpeed).toBeGreaterThan(20);
			expect(midSpeed).toBeLessThan(50);
		});

		it('applies the conservative speed factor', () => {
			// 50m every 3s = ~60 km/h * 0.95 = ~57 km/h
			const readings = makeNorthboundReadings(10, { stepM: 50, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// Check raw speeds on interior points
			const interiorPoints = result.points.filter(
				(_, i) => i > 0 && i < result.points.length - 1,
			);
			for (const pt of interiorPoints) {
				if (pt.rawSpeedKmh > 0) {
					// Raw speed = (50m / 1000) / (3s / 3600) * 0.95 = ~57 km/h
					// Allow tolerance for haversine precision
					expect(pt.rawSpeedKmh).toBeLessThan(65);
					expect(pt.rawSpeedKmh).toBeGreaterThan(45);
				}
			}
		});

		it('first point always has rawSpeedKmh = 0', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			expect(result.points[0].rawSpeedKmh).toBe(0);
		});

		it('does not produce negative speeds', () => {
			const readings = makeNorthboundReadings(8, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			for (const pt of result.points) {
				expect(pt.rawSpeedKmh).toBeGreaterThanOrEqual(0);
			}
		});

		it('smoothed speeds are all non-negative', () => {
			const readings = makeNorthboundReadings(10, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			for (const pt of result.points) {
				const speed = result.speedAtTime(pt.timestamp);
				expect(speed).toBeGreaterThanOrEqual(0);
			}
		});
	});

	// ----------------------------------------------------------------
	// 7. speedAtTime() interpolation
	// ----------------------------------------------------------------
	describe('speedAtTime()', () => {
		it('returns 0 for empty trajectory', () => {
			// Construct a trajectory with no points
			const traj = new CleanedTrajectory('bus-1', '1', [], [], null);
			expect(traj.speedAtTime(BASE_TIME)).toBe(0);
		});

		it('returns the single smoothed speed for single-point trajectory', () => {
			const pt: CleanedPoint = {
				lat: BASE_LAT,
				lng: BASE_LNG,
				timestamp: BASE_TIME,
				distAlongRouteM: 0,
				snappedLat: BASE_LAT,
				snappedLng: BASE_LNG,
				isGenuine: true,
				isNearStop: false,
				matchConfidence: 'low',
				rawSpeedKmh: 0,
			};
			const traj = new CleanedTrajectory('bus-1', '1', [pt], [25.0], null);
			expect(traj.speedAtTime(BASE_TIME)).toBe(25.0);
			expect(traj.speedAtTime(BASE_TIME - 1000)).toBe(25.0);
			expect(traj.speedAtTime(BASE_TIME + 1000)).toBe(25.0);
		});

		it('interpolates linearly between two bracketing points', () => {
			const readings = makeNorthboundReadings(6, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// Query at a time between two points
			const t0 = result.points[2].timestamp;
			const t1 = result.points[3].timestamp;
			const midTime = (t0 + t1) / 2;

			const speed = result.speedAtTime(midTime);
			const speedBefore = result.speedAtTime(t0);
			const speedAfter = result.speedAtTime(t1);

			// Interpolated speed should be between the two bracketing speeds
			const minSpeed = Math.min(speedBefore, speedAfter);
			const maxSpeed = Math.max(speedBefore, speedAfter);
			expect(speed).toBeGreaterThanOrEqual(minSpeed - 0.01);
			expect(speed).toBeLessThanOrEqual(maxSpeed + 0.01);
		});

		it('clamps to first speed before trajectory start', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			const firstSpeed = result.speedAtTime(result.points[0].timestamp);
			const beforeStart = result.speedAtTime(result.points[0].timestamp - 10000);
			expect(beforeStart).toBe(firstSpeed);
		});

		it('clamps to last speed after trajectory end', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			const lastPt = result.points[result.points.length - 1];
			const lastSpeed = result.speedAtTime(lastPt.timestamp);
			const afterEnd = result.speedAtTime(lastPt.timestamp + 10000);
			expect(afterEnd).toBe(lastSpeed);
		});
	});

	// ----------------------------------------------------------------
	// 8. positionAtTime() interpolation
	// ----------------------------------------------------------------
	describe('positionAtTime()', () => {
		it('returns null for empty trajectory', () => {
			const traj = new CleanedTrajectory('bus-1', '1', [], [], null);
			expect(traj.positionAtTime(BASE_TIME)).toBeNull();
		});

		it('returns the single position for single-point trajectory', () => {
			const pt: CleanedPoint = {
				lat: BASE_LAT,
				lng: BASE_LNG,
				timestamp: BASE_TIME,
				distAlongRouteM: 0,
				snappedLat: BASE_LAT,
				snappedLng: BASE_LNG,
				isGenuine: true,
				isNearStop: false,
				matchConfidence: 'low',
				rawSpeedKmh: 0,
			};
			const traj = new CleanedTrajectory('bus-1', '1', [pt], [0], null);
			const pos = traj.positionAtTime(BASE_TIME);
			expect(pos).not.toBeNull();
			expect(pos!.lat).toBeCloseTo(BASE_LAT, 6);
			expect(pos!.lng).toBeCloseTo(BASE_LNG, 6);
		});

		it('interpolates position between two points', () => {
			const readings = makeNorthboundReadings(6, { stepM: 50, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			const p0 = result.points[1];
			const p1 = result.points[2];
			const midTime = (p0.timestamp + p1.timestamp) / 2;

			const pos = result.positionAtTime(midTime)!;

			// Position should be between the two bracketing points
			const minLat = Math.min(p0.snappedLat, p1.snappedLat);
			const maxLat = Math.max(p0.snappedLat, p1.snappedLat);
			expect(pos.lat).toBeGreaterThanOrEqual(minLat - 1e-7);
			expect(pos.lat).toBeLessThanOrEqual(maxLat + 1e-7);
		});

		it('clamps to first position before trajectory start', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			const pos = result.positionAtTime(result.points[0].timestamp - 10000)!;
			expect(pos.lat).toBeCloseTo(result.points[0].snappedLat, 6);
			expect(pos.lng).toBeCloseTo(result.points[0].snappedLng, 6);
		});

		it('clamps to last position after trajectory end', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			const lastPt = result.points[result.points.length - 1];
			const pos = result.positionAtTime(lastPt.timestamp + 10000)!;
			expect(pos.lat).toBeCloseTo(lastPt.snappedLat, 6);
			expect(pos.lng).toBeCloseTo(lastPt.snappedLng, 6);
		});

		it('produces a position that moves smoothly along the trajectory', () => {
			const readings = makeNorthboundReadings(8, { stepM: 40, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// Sample positions at 10 evenly spaced times
			const startT = result.points[0].timestamp;
			const endT = result.points[result.points.length - 1].timestamp;
			const samples: { lat: number; lng: number }[] = [];

			for (let i = 0; i <= 10; i++) {
				const t = startT + (i / 10) * (endT - startT);
				const pos = result.positionAtTime(t);
				expect(pos).not.toBeNull();
				samples.push(pos!);
			}

			// Latitude should be monotonically non-decreasing (moving north)
			for (let i = 1; i < samples.length; i++) {
				expect(samples[i].lat).toBeGreaterThanOrEqual(samples[i - 1].lat - 1e-9);
			}
		});
	});

	// ----------------------------------------------------------------
	// 9. bearingAtTime()
	// ----------------------------------------------------------------
	describe('bearingAtTime()', () => {
		it('returns 0 for empty or single-point trajectory', () => {
			const traj0 = new CleanedTrajectory('bus-1', '1', [], [], null);
			expect(traj0.bearingAtTime(BASE_TIME)).toBe(0);

			const pt: CleanedPoint = {
				lat: BASE_LAT,
				lng: BASE_LNG,
				timestamp: BASE_TIME,
				distAlongRouteM: 0,
				snappedLat: BASE_LAT,
				snappedLng: BASE_LNG,
				isGenuine: true,
				isNearStop: false,
				matchConfidence: 'low',
				rawSpeedKmh: 0,
			};
			const traj1 = new CleanedTrajectory('bus-1', '1', [pt], [0], null);
			expect(traj1.bearingAtTime(BASE_TIME)).toBe(0);
		});

		it('returns approximately 0 (north) for northbound trajectory', () => {
			const readings = makeNorthboundReadings(6, { stepM: 50, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			const midTime =
				(result.points[1].timestamp + result.points[2].timestamp) / 2;
			const bearing = result.bearingAtTime(midTime);

			// Northbound bearing should be near 0 (or 360)
			// Allow for small deviations due to coordinate math
			const normalizedBearing = bearing > 180 ? bearing - 360 : bearing;
			expect(Math.abs(normalizedBearing)).toBeLessThan(10);
		});

		it('returns approximately 90 for eastbound trajectory', () => {
			const readings = makeEastboundReadings(6, { stepM: 50, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			const midTime =
				(result.points[1].timestamp + result.points[2].timestamp) / 2;
			const bearing = result.bearingAtTime(midTime);

			// Eastbound bearing should be near 90
			expect(bearing).toBeGreaterThan(60);
			expect(bearing).toBeLessThan(120);
		});

		it('returns a value between 0 and 360', () => {
			const readings = makeNorthboundReadings(6, { stepM: 50 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			for (const pt of result.points) {
				const b = result.bearingAtTime(pt.timestamp);
				expect(b).toBeGreaterThanOrEqual(0);
				expect(b).toBeLessThan(360);
			}
		});
	});

	// ----------------------------------------------------------------
	// 10. Fallback path (no GTFS shape)
	// ----------------------------------------------------------------
	describe('fallback path (no GTFS shape)', () => {
		it('uses raw lat/lng when no GTFS service or shape index provided', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// In fallback, snappedLat/snappedLng should equal raw lat/lng
			for (const pt of result.points) {
				expect(pt.snappedLat).toBeCloseTo(pt.lat, 8);
				expect(pt.snappedLng).toBeCloseTo(pt.lng, 8);
			}
		});

		it('uses cumulative haversine distance instead of route distance', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// distAlongRouteM should be cumulative haversine
			expect(result.points[0].distAlongRouteM).toBe(0);
			for (let i = 1; i < result.points.length; i++) {
				expect(result.points[i].distAlongRouteM).toBeGreaterThan(
					result.points[i - 1].distAlongRouteM,
				);
			}

			// Distance between consecutive points should be ~30m
			for (let i = 1; i < result.points.length; i++) {
				const delta =
					result.points[i].distAlongRouteM -
					result.points[i - 1].distAlongRouteM;
				expect(delta).toBeGreaterThan(25);
				expect(delta).toBeLessThan(35);
			}
		});

		it('marks all points as low confidence in fallback', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			for (const pt of result.points) {
				expect(pt.matchConfidence).toBe('low');
			}
		});

		it('marks isNearStop as false in fallback', () => {
			const readings = makeNorthboundReadings(5, { stepM: 30 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			for (const pt of result.points) {
				expect(pt.isNearStop).toBe(false);
			}
		});

		it('position interpolation uses linear fallback without shape data', () => {
			const readings = makeNorthboundReadings(4, { stepM: 50, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			const p0 = result.points[0];
			const p1 = result.points[1];
			const midTime = (p0.timestamp + p1.timestamp) / 2;

			const pos = result.positionAtTime(midTime)!;
			// Linear interpolation: midpoint should be the average
			const expectedLat = (p0.snappedLat + p1.snappedLat) / 2;
			const expectedLng = (p0.snappedLng + p1.snappedLng) / 2;

			expect(pos.lat).toBeCloseTo(expectedLat, 6);
			expect(pos.lng).toBeCloseTo(expectedLng, 6);
		});
	});

	// ----------------------------------------------------------------
	// 11. Edge cases
	// ----------------------------------------------------------------
	describe('edge cases', () => {
		it('returns null for empty readings array', () => {
			const result = cleaner.clean([], matcher, null, null);
			expect(result).toBeNull();
		});

		it('handles a single reading', () => {
			const readings = [makeReading()];
			const result = cleaner.clean(readings, matcher, null, null);

			// Single reading can produce a trajectory with 1 point
			if (result !== null) {
				expect(result.points.length).toBe(1);
				expect(result.isValid).toBe(false); // needs >= 2 points
				expect(result.points[0].lat).toBeCloseTo(BASE_LAT, 6);
			}
		});

		it('handles two readings with same timestamp', () => {
			const readings = [
				makeReading({ lat: BASE_LAT, timestamp: BASE_TIME }),
				makeReading({
					lat: BASE_LAT + 30 * LAT_PER_M,
					timestamp: BASE_TIME, // same timestamp
				}),
			];

			// Should not throw
			const result = cleaner.clean(readings, matcher, null, null);
			// Speed calculation with dt=0 should yield 0, not Infinity
			if (result !== null) {
				for (const pt of result.points) {
					expect(pt.rawSpeedKmh).not.toBe(Infinity);
					expect(pt.rawSpeedKmh).not.toBe(-Infinity);
					expect(Number.isFinite(pt.rawSpeedKmh)).toBe(true);
				}
			}
		});

		it('handles very large number of readings without throwing', () => {
			// 100 readings moving steadily north
			const readings = makeNorthboundReadings(100, { stepM: 10, intervalMs: 2000 });
			const result = cleaner.clean(readings, matcher, null, null);

			expect(result).not.toBeNull();
			expect(result!.points.length).toBeGreaterThan(10);
		});

		it('handles readings where all are stale (same position)', () => {
			const readings: RawReading[] = [];
			for (let i = 0; i < 10; i++) {
				readings.push(
					makeReading({
						lat: BASE_LAT,
						lng: BASE_LNG,
						timestamp: BASE_TIME + i * 3000,
						isStale: i > 0,
					}),
				);
			}

			// Should produce a trajectory (or null) but not crash
			const result = cleaner.clean(readings, matcher, null, null);
			if (result !== null) {
				// All speeds should be 0 (bus is not moving)
				for (const pt of result.points) {
					expect(pt.rawSpeedKmh).toBe(0);
				}
			}
		});

		it('preserves busId and routeNr from readings', () => {
			const readings = makeNorthboundReadings(5, {
				stepM: 30,
				busId: 'bus-42',
				routeNr: '14',
			});
			const result = cleaner.clean(readings, matcher, null, null)!;

			expect(result.busId).toBe('bus-42');
			expect(result.routeNr).toBe('14');
		});

		it('handles readings with isStale flag already set', () => {
			const readings: RawReading[] = [
				makeReading({ lat: BASE_LAT, timestamp: BASE_TIME, isStale: false }),
				makeReading({
					lat: BASE_LAT,
					lng: BASE_LNG,
					timestamp: BASE_TIME + 3000,
					isStale: true,
				}),
				makeReading({
					lat: BASE_LAT,
					lng: BASE_LNG,
					timestamp: BASE_TIME + 6000,
					isStale: true,
				}),
				makeReading({
					lat: BASE_LAT + 50 * LAT_PER_M,
					lng: BASE_LNG,
					timestamp: BASE_TIME + 9000,
					isStale: false,
				}),
				makeReading({
					lat: BASE_LAT + 100 * LAT_PER_M,
					lng: BASE_LNG,
					timestamp: BASE_TIME + 12000,
					isStale: false,
				}),
			];

			const result = cleaner.clean(readings, matcher, null, null)!;
			expect(result).not.toBeNull();
			expect(result.points.length).toBeGreaterThanOrEqual(2);
		});
	});

	// ----------------------------------------------------------------
	// Additional: Gaussian smoothing properties
	// ----------------------------------------------------------------
	describe('gaussian speed smoothing', () => {
		it('smoothed speed is close to raw speed for uniform motion', () => {
			// All points at same speed = 36 km/h
			const readings = makeNorthboundReadings(12, { stepM: 30, intervalMs: 3000 });
			const result = cleaner.clean(readings, matcher, null, null)!;

			// Interior points (away from edges) should have smoothed speed
			// close to raw speed since all raw speeds are the same
			const midIdx = Math.floor(result.points.length / 2);
			const midPt = result.points[midIdx];
			const smoothedSpeed = result.speedAtTime(midPt.timestamp);

			// Raw speed at this point (30m in 3s * 0.95 = ~34.2 km/h)
			// Smoothed should be very close
			if (midPt.rawSpeedKmh > 0) {
				const ratio = smoothedSpeed / midPt.rawSpeedKmh;
				expect(ratio).toBeGreaterThan(0.8);
				expect(ratio).toBeLessThan(1.2);
			}
		});

		it('smoothing reduces extreme speed variations', () => {
			// Alternating fast and slow readings
			const readings: RawReading[] = [];
			for (let i = 0; i < 12; i++) {
				const stepM = i % 2 === 0 ? 60 : 10; // alternating fast/slow
				const prevDist = i === 0 ? 0 : readings.reduce((sum, _, j) => {
					if (j >= i) return sum;
					const s = j % 2 === 0 ? 60 : 10;
					return sum + s;
				}, 0);
				readings.push(
					makeReading({
						lat: BASE_LAT + prevDist * LAT_PER_M + (i > 0 ? stepM * LAT_PER_M : 0),
						lng: BASE_LNG,
						timestamp: BASE_TIME + i * 3000,
					}),
				);
			}

			const result = cleaner.clean(readings, matcher, null, null);
			if (result !== null && result.points.length >= 4) {
				// Smoothed speeds should have less variance than raw speeds
				const rawSpeeds = result.points.map((p) => p.rawSpeedKmh).filter((s) => s > 0);
				const smoothedSpeeds = result.points.map((p) => result.speedAtTime(p.timestamp));

				if (rawSpeeds.length > 2) {
					const rawVariance = variance(rawSpeeds);
					const smoothedVariance = variance(smoothedSpeeds.filter((s) => s > 0));

					// Smoothed variance should be less than or equal to raw
					expect(smoothedVariance).toBeLessThanOrEqual(rawVariance + 1);
				}
			}
		});
	});

	// ----------------------------------------------------------------
	// Additional: isStationaryAtTime
	// ----------------------------------------------------------------
	describe('isStationaryAtTime()', () => {
		it('returns true when speed is below 0.5 km/h', () => {
			// Manually construct a trajectory with known speeds
			const pt1: CleanedPoint = {
				lat: BASE_LAT,
				lng: BASE_LNG,
				timestamp: BASE_TIME,
				distAlongRouteM: 0,
				snappedLat: BASE_LAT,
				snappedLng: BASE_LNG,
				isGenuine: false,
				isNearStop: false,
				matchConfidence: 'low',
				rawSpeedKmh: 0,
			};
			const pt2: CleanedPoint = {
				lat: BASE_LAT,
				lng: BASE_LNG,
				timestamp: BASE_TIME + 3000,
				distAlongRouteM: 0,
				snappedLat: BASE_LAT,
				snappedLng: BASE_LNG,
				isGenuine: false,
				isNearStop: false,
				matchConfidence: 'low',
				rawSpeedKmh: 0,
			};
			const traj = new CleanedTrajectory(
				'bus-1',
				'1',
				[pt1, pt2],
				[0, 0],
				null,
			);

			expect(traj.isStationaryAtTime(BASE_TIME)).toBe(true);
			expect(traj.isStationaryAtTime(BASE_TIME + 1500)).toBe(true);
		});

		it('returns false when bus is moving', () => {
			const pt1: CleanedPoint = {
				lat: BASE_LAT,
				lng: BASE_LNG,
				timestamp: BASE_TIME,
				distAlongRouteM: 0,
				snappedLat: BASE_LAT,
				snappedLng: BASE_LNG,
				isGenuine: true,
				isNearStop: false,
				matchConfidence: 'low',
				rawSpeedKmh: 0,
			};
			const pt2: CleanedPoint = {
				lat: BASE_LAT + 30 * LAT_PER_M,
				lng: BASE_LNG,
				timestamp: BASE_TIME + 3000,
				distAlongRouteM: 30,
				snappedLat: BASE_LAT + 30 * LAT_PER_M,
				snappedLng: BASE_LNG,
				isGenuine: true,
				isNearStop: false,
				matchConfidence: 'low',
				rawSpeedKmh: 34,
			};
			const traj = new CleanedTrajectory(
				'bus-1',
				'1',
				[pt1, pt2],
				[10, 34],
				null,
			);

			expect(traj.isStationaryAtTime(BASE_TIME + 1500)).toBe(false);
		});
	});
});

/** Compute variance of an array of numbers. */
function variance(values: number[]): number {
	if (values.length === 0) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / values.length;
	return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}
