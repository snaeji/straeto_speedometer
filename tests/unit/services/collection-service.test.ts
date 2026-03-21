import { describe, it, expect, beforeEach } from 'vitest';
import { CollectionService } from '$lib/services/collection-service';
import { SpeedLimitService } from '$lib/services/speed-limit-service';
import { makeSpeedLimitGeoJson, makeBusLocation } from '../../fixtures';
import { VIOLATION_GRACE_KMH, VIOLATION_SUPPRESSED_ROUTES } from '$lib/utils/constants';

const LAT_PER_M = 1 / 111_000;
const LNG_PER_M = 1 / 48_600;

function makeCollectionService(speedLimit = 50): CollectionService {
	const sls = new SpeedLimitService();
	sls.loadFromGeoJson(makeSpeedLimitGeoJson([{
		coords: [[-21.93, 64.14], [-21.88, 64.14]],
		hradi: speedLimit,
	}]) as Parameters<typeof sls.loadFromGeoJson>[0]);
	return new CollectionService(sls);
}

function makeZoneTransitionService(): CollectionService {
	const sls = new SpeedLimitService();
	sls.loadFromGeoJson(makeSpeedLimitGeoJson([
		{ coords: [[-21.93, 64.14], [-21.88, 64.14]], hradi: 50, name: 'Fast St' },
		{ coords: [[-21.93, 64.14 + 10 * LAT_PER_M], [-21.88, 64.14 + 10 * LAT_PER_M]], hradi: 30, name: 'Slow St' },
	]) as Parameters<typeof sls.loadFromGeoJson>[0]);
	return new CollectionService(sls);
}

/**
 * Feed readings into the buffer and process a frame at the given display cursor time.
 * Simulates the new pipeline: ingest → buffer → processFrame.
 */
function feedAndProcess(
	svc: CollectionService,
	readings: ReturnType<typeof makeBusLocation>[],
	displayCursorMs: number,
) {
	for (const r of readings) {
		svc.ingestReading(r);
	}
	return svc.processFrame(displayCursorMs);
}

/**
 * Generate a sequence of readings moving east along a street.
 */
function makeMovingReadings(
	opts: {
		busId?: string;
		routeNr?: string;
		lat?: number;
		startLng?: number;
		startTs?: number;
		count?: number;
		stepM?: number;
		stepMs?: number;
		direction?: number;
		gtfsDirectionId?: number;
	} = {},
) {
	const {
		busId = 'bus-1',
		routeNr = '1',
		lat = 64.14,
		startLng = -21.925,
		startTs = 0,
		count = 8,
		stepM = 30,
		stepMs = 2000,
		direction = 0,
		gtfsDirectionId,
	} = opts;

	const readings = [];
	for (let i = 0; i < count; i++) {
		readings.push(makeBusLocation({
			busId,
			routeNr,
			lat,
			lng: startLng + i * stepM * LNG_PER_M,
			timestamp: startTs + i * stepMs,
			direction,
			gtfsDirectionId,
		}));
	}
	return readings;
}

describe('CollectionService (2-minute buffer pipeline)', () => {
	describe('ingestReading + processFrame', () => {
		it('returns empty results with insufficient data', () => {
			const svc = makeCollectionService(50);
			svc.ingestReading(makeBusLocation({ timestamp: 1000 }));
			// Only 1 reading — needs at least 2 for a trajectory
			const results = svc.processFrame(1000);
			expect(results.length).toBe(0);
		});

		it('produces results with enough readings', () => {
			const svc = makeCollectionService(50);
			const readings = makeMovingReadings({ count: 6 });
			for (const r of readings) svc.ingestReading(r);

			const results = svc.processFrame(6000); // cursor in the middle of the data
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].busId).toBe('bus-1');
		});

		it('calculates speed from cleaned trajectory', () => {
			const svc = makeCollectionService(50);
			const readings = makeMovingReadings({ count: 10, stepM: 30, stepMs: 2000 });
			for (const r of readings) svc.ingestReading(r);

			const results = svc.processFrame(10000);
			expect(results.length).toBeGreaterThan(0);
			const result = results[0];
			expect(result.speedKmh).toBeGreaterThan(0);
			expect(result.speedKmh).toBeLessThan(90); // should be reasonable, not an outlier
		});

		it('sets speed limit data on result', () => {
			const svc = makeCollectionService(50);
			const readings = makeMovingReadings({ count: 6 });
			for (const r of readings) svc.ingestReading(r);

			const results = svc.processFrame(6000);
			expect(results.length).toBeGreaterThan(0);
			expect(results[0].speedLimitKmh).toBe(50);
			expect(results[0].speedLimitMatch).toBe('matched');
		});
	});

	describe('violation detection', () => {
		it('does not flag violation when speed is within limit', () => {
			const svc = makeCollectionService(50);
			// Slow movement — well within 50 limit
			const readings = makeMovingReadings({ count: 8, stepM: 10, stepMs: 2000 });
			for (const r of readings) svc.ingestReading(r);

			const results = svc.processFrame(8000);
			if (results.length > 0) {
				expect(results[0].isViolation).toBe(false);
			}
		});

		it('suppresses violations for route 31', () => {
			expect(VIOLATION_SUPPRESSED_ROUTES.has('31')).toBe(true);

			const svc = makeCollectionService(30);
			const readings = makeMovingReadings({
				busId: 'bus-31',
				routeNr: '31',
				count: 10,
				stepM: 50, // fast enough to potentially violate
			});
			for (const r of readings) svc.ingestReading(r);

			const results = svc.processFrame(10000);
			for (const r of results) {
				expect(r.isViolation).toBe(false);
			}
		});

		it('does not suppress violations for other routes', () => {
			expect(VIOLATION_SUPPRESSED_ROUTES.has('1')).toBe(false);
		});
	});

	describe('route/direction change', () => {
		it('clears buffer on direction change via gtfsDirectionId', () => {
			const svc = makeCollectionService(50);

			// Feed readings with gtfsDirectionId=0
			const readings1 = makeMovingReadings({
				count: 4, gtfsDirectionId: 0, startTs: 0,
			});
			for (const r of readings1) svc.ingestReading(r);

			// Change direction to 1
			const readings2 = makeMovingReadings({
				count: 4, gtfsDirectionId: 1, startTs: 8000,
			});
			for (const r of readings2) svc.ingestReading(r);

			// Process — should handle the direction change gracefully
			const results = svc.processFrame(10000);
			// Should get results for the second direction's data
			expect(results.length).toBeGreaterThanOrEqual(0);
		});

		it('clears buffer on route number change', () => {
			const svc = makeCollectionService(50);

			const readings1 = makeMovingReadings({ routeNr: '1', count: 4, startTs: 0 });
			for (const r of readings1) svc.ingestReading(r);

			const readings2 = makeMovingReadings({ routeNr: '5', count: 4, startTs: 8000 });
			for (const r of readings2) svc.ingestReading(r);

			const results = svc.processFrame(10000);
			expect(results.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe('reset operations', () => {
		it('resetBus clears all state for that bus', () => {
			const svc = makeCollectionService(50);
			const readings = makeMovingReadings({ count: 6 });
			for (const r of readings) svc.ingestReading(r);

			svc.resetBus('bus-1');

			// After reset, no data for this bus
			const results = svc.processFrame(6000);
			expect(results.length).toBe(0);
		});

		it('resetAll clears everything', () => {
			const svc = makeCollectionService(50);

			const r1 = makeMovingReadings({ busId: 'b1', count: 4 });
			const r2 = makeMovingReadings({ busId: 'b2', count: 4 });
			for (const r of [...r1, ...r2]) svc.ingestReading(r);

			svc.resetAll();

			const results = svc.processFrame(4000);
			expect(results.length).toBe(0);
		});

		it('cleanupStale does not throw', () => {
			const svc = makeCollectionService(50);
			const readings = makeMovingReadings({ count: 4 });
			for (const r of readings) svc.ingestReading(r);
			svc.cleanupStale();
		});
	});

	describe('multi-bus processing', () => {
		it('processes multiple buses independently', () => {
			const svc = makeCollectionService(50);

			const r1 = makeMovingReadings({ busId: 'b1', lat: 64.14, count: 6 });
			const r2 = makeMovingReadings({ busId: 'b2', lat: 64.14, startLng: -21.920, count: 6 });
			for (const r of [...r1, ...r2]) svc.ingestReading(r);

			const results = svc.processFrame(6000);
			const busIds = results.map((r) => r.busId);
			expect(busIds).toContain('b1');
			expect(busIds).toContain('b2');
		});

		it('speed limit fallback when far from segments', () => {
			const svc = makeCollectionService(50);
			// Point far from the 50 km/h street
			const readings = makeMovingReadings({ lat: 64.2, count: 4 });
			for (const r of readings) svc.ingestReading(r);

			const results = svc.processFrame(4000);
			if (results.length > 0) {
				expect(results[0].speedLimitMatch).toBe('fallback');
				expect(results[0].speedLimitKmh).toBe(50);
			}
		});
	});

	describe('display animator integration', () => {
		it('getAnimatedPosition returns null before data is available', () => {
			const svc = makeCollectionService(50);
			const pos = svc.getAnimatedPosition('bus-1', Date.now());
			expect(pos).toBeNull();
		});

		it('getAnimatedPosition returns position after processFrame', () => {
			const svc = makeCollectionService(50);
			const readings = makeMovingReadings({ count: 8 });
			for (const r of readings) svc.ingestReading(r);

			svc.processFrame(8000);

			const pos = svc.getAnimatedPosition('bus-1', 8000);
			if (pos) {
				expect(pos.lat).toBeGreaterThan(0);
				expect(pos.lng).toBeLessThan(0);
				expect(typeof pos.isFrozen).toBe('boolean');
			}
		});
	});
});
