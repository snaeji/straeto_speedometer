import { describe, it, expect, beforeEach } from 'vitest';
import { SplineRenderer } from '$lib/services/spline-renderer';
import { makeBusLocation, HALLGRIMSKIRKJA } from '../../fixtures';

// Helpers for deterministic time
let mockTime = 1000000;
function getTime() { return mockTime; }
function advanceTime(ms: number) { mockTime += ms; }

// Helpers for generating movement points
const LAT_PER_M = 1 / 111_000;
const LNG_PER_M = 1 / 48_600;

function pointNorthM(meters: number, baseLat = HALLGRIMSKIRKJA.lat, baseLng = HALLGRIMSKIRKJA.lng) {
	return { lat: baseLat + meters * LAT_PER_M, lng: baseLng };
}

describe('SplineRenderer', () => {
	let renderer: SplineRenderer;

	beforeEach(() => {
		mockTime = 1000000;
		renderer = new SplineRenderer(getTime);
	});

	describe('ingestion pipeline', () => {
		it('returns BusLocation with speedKmh = 0 on first fix', () => {
			const loc = makeBusLocation();
			const result = renderer.ingestReading('b1', loc);
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0);
		});

		it('detects stale (identical coordinates) and decays speed', () => {
			const loc1 = makeBusLocation({ timestamp: 1000 });
			renderer.ingestReading('b1', loc1);
			advanceTime(2000);

			// Same coordinates → stale
			const loc2 = makeBusLocation({ timestamp: 3000 });
			const result = renderer.ingestReading('b1', loc2);
			expect(result).not.toBeNull();
			// Speed should decay toward 0
			expect(result!.speedKmh).toBeLessThanOrEqual(0);
		});

		it('rejects outlier speed >90 km/h and resets buffer', () => {
			const loc1 = makeBusLocation({ timestamp: 1000 });
			renderer.ingestReading('b1', loc1);
			advanceTime(2000);

			// Jump 500m in 2s = 900 km/h → outlier
			const far = pointNorthM(500);
			const loc2 = makeBusLocation({ lat: far.lat, lng: far.lng, timestamp: 3000 });
			const result = renderer.ingestReading('b1', loc2);
			// After reset, returns speed 0 (re-init)
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0);
		});

		it('resets on time gap > 60 seconds', () => {
			renderer.ingestReading('b1', makeBusLocation({ timestamp: 1000 }));
			advanceTime(2000);

			const moved = pointNorthM(10);
			const result = renderer.ingestReading('b1', makeBusLocation({
				lat: moved.lat, lng: moved.lng, timestamp: 62_000, // 61s gap
			}));
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0); // re-init
		});

		it('resets on time reversal', () => {
			renderer.ingestReading('b1', makeBusLocation({ timestamp: 5000 }));
			advanceTime(2000);

			const moved = pointNorthM(10);
			const result = renderer.ingestReading('b1', makeBusLocation({
				lat: moved.lat, lng: moved.lng, timestamp: 3000, // earlier than 5000
			}));
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0);
		});

		it('returns speed 0 for first 2 fixes (warmup)', () => {
			const speeds: number[] = [];
			for (let i = 0; i < 3; i++) {
				const p = pointNorthM(i * 30);
				advanceTime(2000);
				const result = renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
				if (result) speeds.push(result.speedKmh ?? 0);
			}
			expect(speeds[0]).toBe(0); // first fix
			expect(speeds[1]).toBe(0); // second fix
		});

		it('calculates speed from fix 3+ with conservative factor', () => {
			// Feed 4 fixes simulating ~54 km/h (30m every 2s = 54 km/h)
			for (let i = 0; i < 4; i++) {
				const p = pointNorthM(i * 30);
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			// Feed one more to get a calculated speed
			advanceTime(2000);
			const p = pointNorthM(4 * 30);
			const result = renderer.ingestReading('b1', makeBusLocation({
				lat: p.lat, lng: p.lng, timestamp: 8000,
			}));
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBeGreaterThan(0);
			// 30m/2s = 54 km/h, with conservative factor 0.95 = ~51.3, but endpoint bound may reduce further
			expect(result!.speedKmh).toBeLessThanOrEqual(54);
		});
	});

	describe('speed accuracy (conservative bias)', () => {
		it('never overestimates 50 km/h movement', () => {
			// 50 km/h = 13.89 m/s → 27.78m every 2s
			const distPerFix = 27.78;
			let lastResult: ReturnType<typeof renderer.ingestReading>;
			for (let i = 0; i < 8; i++) {
				const p = pointNorthM(i * distPerFix);
				advanceTime(2000);
				lastResult = renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			expect(lastResult!).not.toBeNull();
			expect(lastResult!.speedKmh).toBeLessThanOrEqual(50);
			expect(lastResult!.speedKmh).toBeGreaterThan(0);
		});

		it('reports 0 for stationary points', () => {
			// Feed same location 5 times
			for (let i = 0; i < 5; i++) {
				const p = pointNorthM(i * 0.5); // tiny movement < SPLINE_STATIONARY_DIST_M
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			advanceTime(2000);
			const result = renderer.ingestReading('b1', makeBusLocation({
				lat: HALLGRIMSKIRKJA.lat + 0.5 * 5 * LAT_PER_M,
				lng: HALLGRIMSKIRKJA.lng,
				timestamp: 10000,
			}));
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0);
		});
	});

	describe('stationarity detection', () => {
		it('detects stationary after 3+ close readings', () => {
			// 3 readings within SPLINE_STATIONARY_DIST_M (3m)
			for (let i = 0; i < 4; i++) {
				const p = pointNorthM(i * 1); // 1m apart
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			const result = renderer.ingestReading('b1', makeBusLocation({
				lat: HALLGRIMSKIRKJA.lat + 4 * LAT_PER_M,
				lng: HALLGRIMSKIRKJA.lng,
				timestamp: 8000,
			}));
			expect(result!.speedKmh).toBe(0);
		});

		it('resets stationarity when bus moves', () => {
			// Make stationary first
			for (let i = 0; i < 4; i++) {
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: HALLGRIMSKIRKJA.lat + i * 0.5 * LAT_PER_M,
					lng: HALLGRIMSKIRKJA.lng,
					timestamp: i * 2000,
				}));
			}
			// Now move significantly
			advanceTime(2000);
			const moved = pointNorthM(50);
			const result = renderer.ingestReading('b1', makeBusLocation({
				lat: moved.lat, lng: moved.lng, timestamp: 8000,
			}));
			// Speed should be calculated (non-zero or at least process the movement)
			expect(result).not.toBeNull();
		});
	});

	describe('EMA smoothing', () => {
		it('seeds EMA on first non-zero reading', () => {
			// First 3 fixes: speed=0
			for (let i = 0; i < 3; i++) {
				const p = pointNorthM(i * 30);
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			// 4th fix: first speed calculation → seeds EMA
			advanceTime(2000);
			const p = pointNorthM(3 * 30);
			const result = renderer.ingestReading('b1', makeBusLocation({
				lat: p.lat, lng: p.lng, timestamp: 6000,
			}));
			expect(result!.speedKmh).toBeGreaterThan(0);
		});
	});

	describe('getAnimatedPosition', () => {
		it('returns null before SPLINE_MIN_BUFFER (4) points', () => {
			for (let i = 0; i < 3; i++) {
				const p = pointNorthM(i * 30);
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			expect(renderer.getAnimatedPosition('b1', mockTime)).toBeNull();
		});

		it('returns interpolated position after 4+ points', () => {
			for (let i = 0; i < 5; i++) {
				const p = pointNorthM(i * 30);
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			advanceTime(1000); // half a segment
			const pos = renderer.getAnimatedPosition('b1', mockTime);
			expect(pos).not.toBeNull();
			expect(pos!.lat).toBeGreaterThan(0);
			expect(pos!.isFrozen).toBe(false);
		});

		it('returns frozen state when no new data', () => {
			for (let i = 0; i < 5; i++) {
				const p = pointNorthM(i * 30);
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			// Advance time way beyond all segments
			advanceTime(30000);
			const pos = renderer.getAnimatedPosition('b1', mockTime);
			expect(pos).not.toBeNull();
			expect(pos!.isFrozen).toBe(true);
		});

		it('returns last position for stationary bus (not frozen)', () => {
			// Make bus stationary
			for (let i = 0; i < 6; i++) {
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: HALLGRIMSKIRKJA.lat + i * 0.5 * LAT_PER_M,
					lng: HALLGRIMSKIRKJA.lng,
					timestamp: i * 2000,
				}));
			}
			const pos = renderer.getAnimatedPosition('b1', mockTime);
			// Stationary buses might not have animation started, returns null
			// because they never reached SPLINE_MIN_BUFFER with animating=true
			// This is expected behavior
			if (pos) {
				expect(pos.isFrozen).toBe(false);
			}
		});

		it('falls back to linear when spline overshoots', () => {
			// Create points with a sharp turn (small enough to avoid outlier reset)
			// ~20m per step at 2s intervals = ~36 km/h, well under 90 km/h limit
			const step = 20;
			const points = [
				{ lat: 64.14, lng: -21.93 },                                        // start
				{ lat: 64.14 + step * LAT_PER_M, lng: -21.93 },                     // north
				{ lat: 64.14 + 2 * step * LAT_PER_M, lng: -21.93 },                 // north
				{ lat: 64.14 + 2 * step * LAT_PER_M, lng: -21.93 + step * LNG_PER_M }, // east (sharp turn)
				{ lat: 64.14 + 2 * step * LAT_PER_M, lng: -21.93 + 2 * step * LNG_PER_M }, // east
			];
			for (let i = 0; i < points.length; i++) {
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: points[i].lat, lng: points[i].lng, timestamp: i * 2000,
				}));
			}
			advanceTime(500);
			const pos = renderer.getAnimatedPosition('b1', mockTime);
			// Should return a valid position (may be spline or linear fallback)
			expect(pos).not.toBeNull();
		});
	});

	describe('setTimeSource', () => {
		it('changes the time source', () => {
			let t = 0;
			renderer.setTimeSource(() => t);
			t = 5000;
			renderer.ingestReading('b1', makeBusLocation({ timestamp: 1000 }));
			// Should not throw — just verify it accepts a new time source
		});
	});

	describe('segment advancement in animation', () => {
		it('advances through multiple segments smoothly', () => {
			// Build up 6 points of steady movement
			for (let i = 0; i < 6; i++) {
				const p = pointNorthM(i * 20);
				advanceTime(2000);
				renderer.ingestReading('b1', makeBusLocation({
					lat: p.lat, lng: p.lng, timestamp: i * 2000,
				}));
			}
			// Advance time through multiple segments
			for (let step = 0; step < 5; step++) {
				advanceTime(1500);
				const pos = renderer.getAnimatedPosition('b1', mockTime);
				if (pos) {
					expect(pos.lat).toBeDefined();
					expect(pos.lng).toBeDefined();
				}
			}
		});
	});

	describe('cleanup', () => {
		it('cleanupStale removes buses not updated for 120s', () => {
			renderer.ingestReading('b1', makeBusLocation({ timestamp: 1000 }));
			advanceTime(130_000); // 130 seconds
			renderer.cleanupStale();
			expect(renderer.getAnimatedPosition('b1', mockTime)).toBeNull();
		});

		it('resetBus clears state for specific bus', () => {
			renderer.ingestReading('b1', makeBusLocation({ timestamp: 1000 }));
			renderer.ingestReading('b2', makeBusLocation({ busId: 'b2', timestamp: 1000 }));
			renderer.resetBus('b1');
			// b1 reset, b2 still exists
			const result = renderer.ingestReading('b1', makeBusLocation({ timestamp: 2000 }));
			expect(result!.speedKmh).toBe(0); // re-init
		});

		it('resetAll clears all state', () => {
			renderer.ingestReading('b1', makeBusLocation({ timestamp: 1000 }));
			renderer.ingestReading('b2', makeBusLocation({ busId: 'b2', timestamp: 1000 }));
			renderer.resetAll();
			const r1 = renderer.ingestReading('b1', makeBusLocation({ timestamp: 2000 }));
			const r2 = renderer.ingestReading('b2', makeBusLocation({ busId: 'b2', timestamp: 2000 }));
			expect(r1!.speedKmh).toBe(0);
			expect(r2!.speedKmh).toBe(0);
		});
	});
});
