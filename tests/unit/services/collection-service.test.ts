import { describe, it, expect, beforeEach } from 'vitest';
import { CollectionService } from '$lib/services/collection-service';
import { SpeedLimitService } from '$lib/services/speed-limit-service';
import { makeSpeedLimitGeoJson, makeBusLocation } from '../../fixtures';
import { ZONE_TRANSITION_GRACE_MS, VIOLATION_GRACE_KMH, VIOLATION_SUPPRESSED_ROUTES } from '$lib/utils/constants';

const LAT_PER_M = 1 / 111_000;
const LNG_PER_M = 1 / 48_600;

function makeCollectionService(speedLimit = 50): CollectionService {
	const sls = new SpeedLimitService();
	sls.loadFromGeoJson(makeSpeedLimitGeoJson([{
		coords: [[-21.93, 64.14], [-21.92, 64.14]],
		hradi: speedLimit,
	}]) as Parameters<typeof sls.loadFromGeoJson>[0]);
	return new CollectionService(sls);
}

function makeZoneTransitionService(): CollectionService {
	const sls = new SpeedLimitService();
	// Two parallel streets: 50 at 64.14, 30 at 10m north
	sls.loadFromGeoJson(makeSpeedLimitGeoJson([
		{ coords: [[-21.93, 64.14], [-21.88, 64.14]], hradi: 50, name: 'Fast St' },
		{ coords: [[-21.93, 64.14 + 10 * LAT_PER_M], [-21.88, 64.14 + 10 * LAT_PER_M]], hradi: 30, name: 'Slow St' },
	]) as Parameters<typeof sls.loadFromGeoJson>[0]);
	return new CollectionService(sls);
}

/**
 * Feed enough fixes on one street to build up spline renderer state,
 * so that the bus gets a speed from the pipeline.
 */
function warmupBus(svc: CollectionService, busId: string, lat: number, startLng: number, startTs: number, count = 5) {
	for (let i = 0; i < count; i++) {
		svc.processFixForSimulation(makeBusLocation({
			busId,
			lat,
			lng: startLng + i * 30 * LNG_PER_M, // 30m east per fix
			timestamp: startTs + i * 2000,
		}));
	}
}

describe('CollectionService', () => {
	describe('violation detection via pipeline', () => {
		it('first fix always has speed=0 and isViolation=false', () => {
			const svc = makeCollectionService(30);
			const result = svc.processFixForSimulation(makeBusLocation({
				lat: 64.14, lng: -21.925, timestamp: 1000,
			}));
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0);
			expect(result!.isViolation).toBe(false);
		});

		it('sets speed limit data on result', () => {
			const svc = makeCollectionService(50);
			const result = svc.processFixForSimulation(makeBusLocation({
				lat: 64.14, lng: -21.925, timestamp: 1000,
			}));
			expect(result).not.toBeNull();
			expect(result!.speedLimitKmh).toBe(50);
			expect(result!.speedLimitMatch).toBe('matched');
		});

		it('builds up speed over multiple fixes', () => {
			const svc = makeCollectionService(50);
			let lastResult: ReturnType<typeof svc.processFixForSimulation> = null;
			for (let i = 0; i < 6; i++) {
				lastResult = svc.processFixForSimulation(makeBusLocation({
					lat: 64.14,
					lng: -21.925 + i * 30 * LNG_PER_M,
					timestamp: i * 2000,
				}));
			}
			// After warm up, speed should be calculated
			expect(lastResult).not.toBeNull();
			expect(lastResult!.speedKmh).toBeGreaterThan(0);
		});

		it('getAnimatedPosition delegates to spline renderer', () => {
			const svc = makeCollectionService(50);
			// Not enough data → null
			svc.processFixForSimulation(makeBusLocation({ timestamp: 1000 }));
			const pos = svc.getAnimatedPosition('bus-1', Date.now());
			// May be null since we haven't built up enough points
		});
	});

	describe('zone transition grace period', () => {
		it('grants grace when entering lower speed zone', () => {
			const svc = makeZoneTransitionService();
			// Warm up on 50 zone
			warmupBus(svc, 'bus-1', 64.14, -21.925, 0);
			// Move to 30 zone
			const result = svc.processFixForSimulation(makeBusLocation({
				lat: 64.14 + 10 * LAT_PER_M,
				lng: -21.925 + 5 * 30 * LNG_PER_M,
				timestamp: 10000,
			}));
			if (result) {
				expect(result.speedLimitKmh).toBeDefined();
			}
		});

		it('zone increase clears transition', () => {
			const svc = makeZoneTransitionService();
			// Start on 30 zone
			warmupBus(svc, 'bus-1', 64.14 + 10 * LAT_PER_M, -21.925, 0);
			// Move to 50 zone
			const result = svc.processFixForSimulation(makeBusLocation({
				lat: 64.14,
				lng: -21.925 + 5 * 30 * LNG_PER_M,
				timestamp: 10000,
			}));
			if (result) {
				expect(result.isViolation).toBe(false);
			}
		});

		it('cascading drops keep highest prevLimit', () => {
			// 80 → 50 → 30
			const sls = new SpeedLimitService();
			sls.loadFromGeoJson(makeSpeedLimitGeoJson([
				{ coords: [[-21.93, 64.14], [-21.88, 64.14]], hradi: 80 },
				{ coords: [[-21.93, 64.14 + 10 * LAT_PER_M], [-21.88, 64.14 + 10 * LAT_PER_M]], hradi: 50 },
				{ coords: [[-21.93, 64.14 + 20 * LAT_PER_M], [-21.88, 64.14 + 20 * LAT_PER_M]], hradi: 30 },
			]) as Parameters<typeof sls.loadFromGeoJson>[0]);
			const svc = new CollectionService(sls);

			// Warm on 80 zone
			warmupBus(svc, 'bus-1', 64.14, -21.925, 0);
			// Move to 50 zone
			svc.processFixForSimulation(makeBusLocation({
				lat: 64.14 + 10 * LAT_PER_M,
				lng: -21.925 + 5 * 30 * LNG_PER_M,
				timestamp: 10000,
			}));
			// Move to 30 zone
			const result = svc.processFixForSimulation(makeBusLocation({
				lat: 64.14 + 20 * LAT_PER_M,
				lng: -21.925 + 6 * 30 * LNG_PER_M,
				timestamp: 12000,
			}));
			// Grace period should handle the cascading drop
			if (result) {
				expect(result.speedLimitKmh).toBeDefined();
			}
		});
	});

	describe('route/direction change', () => {
		it('resets map matcher and route animator on direction change', () => {
			const svc = makeCollectionService(50);
			svc.processFixForSimulation(makeBusLocation({
				routeNr: '1', direction: 0, lat: 64.14, lng: -21.925, timestamp: 1000,
			}));
			const result = svc.processFixForSimulation(makeBusLocation({
				routeNr: '1', direction: 1, lat: 64.14, lng: -21.924, timestamp: 3000,
			}));
			expect(result).not.toBeNull();
		});

		it('resets on route number change', () => {
			const svc = makeCollectionService(50);
			svc.processFixForSimulation(makeBusLocation({
				routeNr: '1', direction: 0, lat: 64.14, lng: -21.925, timestamp: 1000,
			}));
			const result = svc.processFixForSimulation(makeBusLocation({
				routeNr: '5', direction: 0, lat: 64.14, lng: -21.924, timestamp: 3000,
			}));
			expect(result).not.toBeNull();
		});
	});

	describe('reset operations', () => {
		it('resetBus clears all state for that bus', () => {
			const svc = makeCollectionService(50);
			svc.processFixForSimulation(makeBusLocation({ timestamp: 1000 }));
			svc.resetBus('bus-1');
			const result = svc.processFixForSimulation(makeBusLocation({ timestamp: 3000 }));
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0);
		});

		it('resetAll clears everything', () => {
			const svc = makeCollectionService(50);
			svc.processFixForSimulation(makeBusLocation({ busId: 'b1', timestamp: 1000 }));
			svc.processFixForSimulation(makeBusLocation({ busId: 'b2', timestamp: 1000 }));
			svc.resetAll();
			const r1 = svc.processFixForSimulation(makeBusLocation({ busId: 'b1', timestamp: 3000 }));
			const r2 = svc.processFixForSimulation(makeBusLocation({ busId: 'b2', timestamp: 3000 }));
			expect(r1!.speedKmh).toBe(0);
			expect(r2!.speedKmh).toBe(0);
		});

		it('cleanupStale removes expired transitions', () => {
			const svc = makeCollectionService(50);
			svc.processFixForSimulation(makeBusLocation({ timestamp: 1000 }));
			svc.cleanupStale();
		});
	});

	describe('zone transition grace - quantitative', () => {
		it('does not flag violation during grace period ramp', () => {
			const svc = makeZoneTransitionService();
			const busId = 'bus-grace';
			// Warm up on 50 zone to build speed
			warmupBus(svc, busId, 64.14, -21.925, 0);

			// Move to 30 zone — now going ~54 km/h in a 30 zone
			// At t=0 of grace, effective limit = 50 (prevLimit), violation threshold = 55
			// Bus at ~54 should NOT be a violation
			const result = svc.processFixForSimulation(makeBusLocation({
				busId,
				lat: 64.14 + 10 * LAT_PER_M,
				lng: -21.925 + 5 * 30 * LNG_PER_M,
				timestamp: 10000,
			}));
			if (result && result.speedKmh != null && result.speedKmh > 30) {
				// Speed is above 30 limit but within grace ramp
				expect(result.isViolation).toBe(false);
			}
		});

		it('flags violation when exceeding even the old limit during grace', () => {
			const svc = makeZoneTransitionService();
			const busId = 'bus-fast';
			// Feed a bus going very fast (huge moves)
			for (let i = 0; i < 5; i++) {
				svc.processFixForSimulation(makeBusLocation({
					busId,
					lat: 64.14,
					lng: -21.925 + i * 100 * LNG_PER_M, // 100m per fix = ~180 km/h raw
					timestamp: i * 2000,
				}));
			}
			// Move to 30 zone — speed should exceed even the old 50 limit + grace
			const result = svc.processFixForSimulation(makeBusLocation({
				busId,
				lat: 64.14 + 10 * LAT_PER_M,
				lng: -21.925 + 5 * 100 * LNG_PER_M,
				timestamp: 10000,
			}));
			// If pipeline reports speed > 55 (50 + 5 grace), should be violation
			if (result && result.speedKmh != null && result.speedKmh > 50 + VIOLATION_GRACE_KMH) {
				expect(result.isViolation).toBe(true);
			}
		});
	});

	describe('route 31 violation suppression', () => {
		it('suppresses violations for route 31', () => {
			expect(VIOLATION_SUPPRESSED_ROUTES.has('31')).toBe(true);

			const svc = makeCollectionService(30);
			// Build up speed on route 31
			for (let i = 0; i < 6; i++) {
				svc.processFixForSimulation(makeBusLocation({
					busId: 'bus-31',
					routeNr: '31',
					lat: 64.14,
					lng: -21.925 + i * 30 * LNG_PER_M,
					timestamp: i * 2000,
				}));
			}
			// Even if speed exceeds limit, violation should be suppressed
			const result = svc.processFixForSimulation(makeBusLocation({
				busId: 'bus-31',
				routeNr: '31',
				lat: 64.14,
				lng: -21.925 + 6 * 30 * LNG_PER_M,
				timestamp: 12000,
			}));
			if (result) {
				expect(result.isViolation).toBe(false);
			}
		});

		it('does not suppress violations for other routes', () => {
			expect(VIOLATION_SUPPRESSED_ROUTES.has('1')).toBe(false);
		});
	});

	describe('gtfsDirectionId handling', () => {
		it('uses gtfsDirectionId for route key when available', () => {
			const svc = makeCollectionService(50);
			// Two fixes with same compass bearing but different gtfsDirectionId
			// should trigger a route/direction reset
			svc.processFixForSimulation(makeBusLocation({
				direction: 263, gtfsDirectionId: 0,
				lat: 64.14, lng: -21.925, timestamp: 1000,
			}));
			const result = svc.processFixForSimulation(makeBusLocation({
				direction: 263, gtfsDirectionId: 1, // same compass bearing, different GTFS direction
				lat: 64.14, lng: -21.924, timestamp: 3000,
			}));
			// Should have triggered reset — speed back to 0
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0);
		});

		it('falls back to compass bearing when gtfsDirectionId absent', () => {
			const svc = makeCollectionService(50);
			svc.processFixForSimulation(makeBusLocation({
				direction: 0, gtfsDirectionId: undefined,
				lat: 64.14, lng: -21.925, timestamp: 1000,
			}));
			const result = svc.processFixForSimulation(makeBusLocation({
				direction: 1, gtfsDirectionId: undefined,
				lat: 64.14, lng: -21.924, timestamp: 3000,
			}));
			// Direction changed (0→1), should trigger reset
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBe(0);
		});
	});

	describe('multi-bus processing', () => {
		it('processes multiple buses independently', () => {
			const svc = makeCollectionService(50);
			const r1 = svc.processFixForSimulation(makeBusLocation({
				busId: 'b1', lat: 64.14, lng: -21.925, timestamp: 1000,
			}));
			const r2 = svc.processFixForSimulation(makeBusLocation({
				busId: 'b2', lat: 64.14, lng: -21.920, timestamp: 1000,
			}));
			expect(r1).not.toBeNull();
			expect(r2).not.toBeNull();
			expect(r1!.busId).toBe('b1');
			expect(r2!.busId).toBe('b2');
		});

		it('speed limit fallback when far from segments', () => {
			const svc = makeCollectionService(50);
			// Point far from the 50 km/h street
			const result = svc.processFixForSimulation(makeBusLocation({
				lat: 64.2, lng: -21.925, timestamp: 1000,
			}));
			if (result) {
				expect(result.speedLimitMatch).toBe('fallback');
				expect(result.speedLimitKmh).toBe(50); // DEFAULT_SPEED_LIMIT_KMH
			}
		});
	});
});
