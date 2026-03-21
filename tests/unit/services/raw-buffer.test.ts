import { describe, it, expect, beforeEach } from 'vitest';
import { RawBuffer, type RawReading } from '$lib/services/raw-buffer';
import { HALLGRIMSKIRKJA, HARPA, BSI_TERMINAL } from '../../fixtures';

// Coordinate helpers — 1m offsets at Reykjavik latitude
const LAT_PER_M = 1 / 111_000;
const LNG_PER_M = 1 / 48_600;

const BASE_TS = 1710000000000;

/** Build a reading input (without isStale, which ingest() computes). */
function makeReading(overrides: Partial<Omit<RawReading, 'isStale'>> = {}): Omit<RawReading, 'isStale'> {
	return {
		busId: 'bus-1',
		routeNr: '1',
		tripId: 'trip-1',
		lat: HALLGRIMSKIRKJA.lat,
		lng: HALLGRIMSKIRKJA.lng,
		direction: 0,
		timestamp: BASE_TS,
		...overrides,
	};
}

/** Shift a coordinate north by the given number of meters. */
function shiftNorth(lat: number, meters: number): number {
	return lat + meters * LAT_PER_M;
}

/** Shift a coordinate east by the given number of meters. */
function shiftEast(lng: number, meters: number): number {
	return lng + meters * LNG_PER_M;
}

describe('RawBuffer', () => {
	let buffer: RawBuffer;

	beforeEach(() => {
		buffer = new RawBuffer();
	});

	describe('ingest()', () => {
		it('ingests a first reading and marks it as not stale', () => {
			buffer.ingest(makeReading());
			const all = buffer.getAll('bus-1');
			expect(all).toHaveLength(1);
			expect(all[0].isStale).toBe(false);
		});

		it('marks reading as stale when position is less than 1m from previous', () => {
			buffer.ingest(makeReading({ timestamp: BASE_TS }));
			// Move 0.5m north — well under the 1m stale threshold
			buffer.ingest(makeReading({
				timestamp: BASE_TS + 2000,
				lat: shiftNorth(HALLGRIMSKIRKJA.lat, 0.5),
			}));

			const all = buffer.getAll('bus-1');
			expect(all).toHaveLength(2);
			expect(all[0].isStale).toBe(false);
			expect(all[1].isStale).toBe(true);
		});

		it('marks reading as not stale when position is more than 1m from previous', () => {
			buffer.ingest(makeReading({ timestamp: BASE_TS }));
			// Move 5m north — clearly beyond the 1m threshold
			buffer.ingest(makeReading({
				timestamp: BASE_TS + 2000,
				lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5),
			}));

			const all = buffer.getAll('bus-1');
			expect(all).toHaveLength(2);
			expect(all[0].isStale).toBe(false);
			expect(all[1].isStale).toBe(false);
		});

		it('marks identical coordinates as stale', () => {
			buffer.ingest(makeReading({ timestamp: BASE_TS }));
			buffer.ingest(makeReading({ timestamp: BASE_TS + 2000 }));

			const all = buffer.getAll('bus-1');
			expect(all[1].isStale).toBe(true);
		});

		it('does not update lastRaw position when reading is stale', () => {
			// First genuine reading
			buffer.ingest(makeReading({ timestamp: BASE_TS }));
			// Stale reading at same position
			buffer.ingest(makeReading({ timestamp: BASE_TS + 2000 }));
			// Move 0.8m from original — still stale relative to original position
			buffer.ingest(makeReading({
				timestamp: BASE_TS + 4000,
				lat: shiftNorth(HALLGRIMSKIRKJA.lat, 0.8),
			}));

			const all = buffer.getAll('bus-1');
			expect(all[2].isStale).toBe(true);
		});

		it('updates lastRaw position when reading is not stale', () => {
			buffer.ingest(makeReading({ timestamp: BASE_TS }));
			// Move 10m north — not stale, updates baseline
			const newLat = shiftNorth(HALLGRIMSKIRKJA.lat, 10);
			buffer.ingest(makeReading({
				timestamp: BASE_TS + 2000,
				lat: newLat,
			}));
			// Move 0.5m from new position — stale relative to updated position
			buffer.ingest(makeReading({
				timestamp: BASE_TS + 4000,
				lat: shiftNorth(newLat, 0.5),
			}));

			const all = buffer.getAll('bus-1');
			expect(all[1].isStale).toBe(false);
			expect(all[2].isStale).toBe(true);
		});

		it('preserves all fields from the input reading', () => {
			buffer.ingest(makeReading({
				busId: 'bus-42',
				routeNr: '14',
				tripId: 'trip-abc',
				direction: 180,
				headsign: 'Fjorour',
				gtfsDirectionId: 1,
				timestamp: BASE_TS + 1000,
			}));

			const reading = buffer.getAll('bus-42')[0];
			expect(reading.busId).toBe('bus-42');
			expect(reading.routeNr).toBe('14');
			expect(reading.tripId).toBe('trip-abc');
			expect(reading.direction).toBe(180);
			expect(reading.headsign).toBe('Fjorour');
			expect(reading.gtfsDirectionId).toBe(1);
			expect(reading.timestamp).toBe(BASE_TS + 1000);
		});

		it('preserves nextStops data', () => {
			const nextStops = [
				{ stopId: 's1', name: 'Stop 1', lat: 64.14, lng: -21.93, arrival: '10:30' },
			];
			buffer.ingest(makeReading({ nextStops }));

			const reading = buffer.getAll('bus-1')[0];
			expect(reading.nextStops).toEqual(nextStops);
		});

		it('handles multiple consecutive stale readings', () => {
			buffer.ingest(makeReading({ timestamp: BASE_TS }));
			buffer.ingest(makeReading({ timestamp: BASE_TS + 2000 }));
			buffer.ingest(makeReading({ timestamp: BASE_TS + 4000 }));
			buffer.ingest(makeReading({ timestamp: BASE_TS + 6000 }));

			const all = buffer.getAll('bus-1');
			expect(all).toHaveLength(4);
			expect(all[0].isStale).toBe(false);
			expect(all[1].isStale).toBe(true);
			expect(all[2].isStale).toBe(true);
			expect(all[3].isStale).toBe(true);
		});

		it('correctly detects stale at boundary distance (~1m)', () => {
			buffer.ingest(makeReading({ timestamp: BASE_TS }));
			// Move exactly 1.5m — should not be stale
			buffer.ingest(makeReading({
				timestamp: BASE_TS + 2000,
				lat: shiftNorth(HALLGRIMSKIRKJA.lat, 1.5),
			}));

			const all = buffer.getAll('bus-1');
			expect(all[1].isStale).toBe(false);
		});
	});

	describe('getWindow()', () => {
		it('returns empty array for unknown bus', () => {
			expect(buffer.getWindow('nonexistent', 0, Date.now())).toEqual([]);
		});

		it('returns readings within the time window (inclusive)', () => {
			buffer.ingest(makeReading({ timestamp: 1000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 0) }));
			buffer.ingest(makeReading({ timestamp: 2000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 10) }));
			buffer.ingest(makeReading({ timestamp: 3000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 20) }));
			buffer.ingest(makeReading({ timestamp: 4000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 30) }));
			buffer.ingest(makeReading({ timestamp: 5000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 40) }));

			const window = buffer.getWindow('bus-1', 2000, 4000);
			expect(window).toHaveLength(3);
			expect(window[0].timestamp).toBe(2000);
			expect(window[1].timestamp).toBe(3000);
			expect(window[2].timestamp).toBe(4000);
		});

		it('returns empty array when window is outside data range', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000 }));

			expect(buffer.getWindow('bus-1', 3000, 5000)).toEqual([]);
		});

		it('returns single reading when start and end match a timestamp', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000 }));
			buffer.ingest(makeReading({ timestamp: 3000 }));

			const window = buffer.getWindow('bus-1', 2000, 2000);
			expect(window).toHaveLength(1);
			expect(window[0].timestamp).toBe(2000);
		});

		it('returns all readings when window encompasses all data', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000 }));
			buffer.ingest(makeReading({ timestamp: 3000 }));

			const window = buffer.getWindow('bus-1', 0, 10000);
			expect(window).toHaveLength(3);
		});
	});

	describe('getAll()', () => {
		it('returns empty array for unknown bus', () => {
			expect(buffer.getAll('nonexistent')).toEqual([]);
		});

		it('returns all readings in insertion order', () => {
			buffer.ingest(makeReading({ timestamp: 3000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 20) }));
			buffer.ingest(makeReading({ timestamp: 1000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 30) }));
			buffer.ingest(makeReading({ timestamp: 2000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 40) }));

			const all = buffer.getAll('bus-1');
			expect(all).toHaveLength(3);
			expect(all[0].timestamp).toBe(3000);
			expect(all[1].timestamp).toBe(1000);
			expect(all[2].timestamp).toBe(2000);
		});
	});

	describe('getLatest()', () => {
		it('returns undefined for unknown bus', () => {
			expect(buffer.getLatest('nonexistent')).toBeUndefined();
		});

		it('returns the most recently ingested reading', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5) }));
			buffer.ingest(makeReading({ timestamp: 3000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 10) }));

			const latest = buffer.getLatest('bus-1');
			expect(latest).toBeDefined();
			expect(latest!.timestamp).toBe(3000);
		});

		it('returns the only reading when buffer has one entry', () => {
			buffer.ingest(makeReading({ timestamp: 5000 }));

			const latest = buffer.getLatest('bus-1');
			expect(latest).toBeDefined();
			expect(latest!.timestamp).toBe(5000);
		});
	});

	describe('prune()', () => {
		it('removes readings older than cutoff', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5) }));
			buffer.ingest(makeReading({ timestamp: 3000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 10) }));
			buffer.ingest(makeReading({ timestamp: 4000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 15) }));

			buffer.prune(3000);

			const all = buffer.getAll('bus-1');
			expect(all).toHaveLength(2);
			expect(all[0].timestamp).toBe(3000);
			expect(all[1].timestamp).toBe(4000);
		});

		it('removes bus entirely when all readings are older than cutoff', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000 }));

			buffer.prune(5000);

			expect(buffer.getAll('bus-1')).toEqual([]);
			expect(buffer.has('bus-1')).toBe(false);
			expect(buffer.busCount).toBe(0);
		});

		it('does nothing when no readings are older than cutoff', () => {
			buffer.ingest(makeReading({ timestamp: 5000 }));
			buffer.ingest(makeReading({ timestamp: 6000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5) }));

			buffer.prune(1000);

			expect(buffer.getAll('bus-1')).toHaveLength(2);
		});

		it('prunes multiple buses independently', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 5000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5) }));
			buffer.ingest(makeReading({ busId: 'bus-B', timestamp: 2000, lat: HARPA.lat, lng: HARPA.lng }));
			buffer.ingest(makeReading({ busId: 'bus-B', timestamp: 3000, lat: shiftNorth(HARPA.lat, 5), lng: HARPA.lng }));

			buffer.prune(4000);

			// bus-A has one reading at 5000, bus-B removed entirely
			expect(buffer.getAll('bus-A')).toHaveLength(1);
			expect(buffer.getAll('bus-A')[0].timestamp).toBe(5000);
			expect(buffer.has('bus-B')).toBe(false);
		});

		it('handles cutoff at exact reading timestamp (inclusive — keeps that reading)', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5) }));
			buffer.ingest(makeReading({ timestamp: 3000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 10) }));

			buffer.prune(2000);

			const all = buffer.getAll('bus-1');
			expect(all).toHaveLength(2);
			expect(all[0].timestamp).toBe(2000);
		});
	});

	describe('clearBus()', () => {
		it('removes all data for a specific bus', () => {
			buffer.ingest(makeReading({ busId: 'bus-1', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-2', timestamp: 2000, lat: HARPA.lat, lng: HARPA.lng }));

			buffer.clearBus('bus-1');

			expect(buffer.has('bus-1')).toBe(false);
			expect(buffer.getAll('bus-1')).toEqual([]);
			expect(buffer.has('bus-2')).toBe(true);
			expect(buffer.getAll('bus-2')).toHaveLength(1);
		});

		it('is a no-op for unknown bus', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.clearBus('nonexistent');

			expect(buffer.busCount).toBe(1);
		});
	});

	describe('clearAll()', () => {
		it('removes all data for all buses', () => {
			buffer.ingest(makeReading({ busId: 'bus-1', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-2', timestamp: 2000, lat: HARPA.lat, lng: HARPA.lng }));
			buffer.ingest(makeReading({ busId: 'bus-3', timestamp: 3000, lat: BSI_TERMINAL.lat, lng: BSI_TERMINAL.lng }));

			buffer.clearAll();

			expect(buffer.busCount).toBe(0);
			expect(buffer.totalReadings).toBe(0);
			expect(buffer.getActiveBusIds()).toEqual([]);
		});

		it('works on an already-empty buffer', () => {
			buffer.clearAll();
			expect(buffer.busCount).toBe(0);
		});
	});

	describe('multiple buses independently tracked', () => {
		it('maintains separate buffers for each bus', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', lat: HALLGRIMSKIRKJA.lat, lng: HALLGRIMSKIRKJA.lng, timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-A', lat: shiftNorth(HALLGRIMSKIRKJA.lat, 10), lng: HALLGRIMSKIRKJA.lng, timestamp: 2000 }));

			expect(buffer.getAll('bus-A')).toHaveLength(2);
			expect(buffer.getAll('bus-B')).toHaveLength(1);
		});

		it('detects stale independently per bus', () => {
			// bus-A: same position → stale
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 2000 }));

			// bus-B: different position → not stale
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: shiftNorth(HARPA.lat, 10), lng: HARPA.lng, timestamp: 2000 }));

			expect(buffer.getAll('bus-A')[1].isStale).toBe(true);
			expect(buffer.getAll('bus-B')[1].isStale).toBe(false);
		});

		it('clearing one bus does not affect others', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 2000 }));

			buffer.clearBus('bus-A');

			expect(buffer.has('bus-A')).toBe(false);
			expect(buffer.has('bus-B')).toBe(true);
			expect(buffer.busCount).toBe(1);
		});
	});

	describe('getActiveBusIds()', () => {
		it('returns empty array when no buses exist', () => {
			expect(buffer.getActiveBusIds()).toEqual([]);
		});

		it('returns all bus IDs with data', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 2000 }));
			buffer.ingest(makeReading({ busId: 'bus-C', lat: BSI_TERMINAL.lat, lng: BSI_TERMINAL.lng, timestamp: 3000 }));

			const ids = buffer.getActiveBusIds();
			expect(ids).toHaveLength(3);
			expect(ids).toContain('bus-A');
			expect(ids).toContain('bus-B');
			expect(ids).toContain('bus-C');
		});

		it('does not include cleared buses', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 2000 }));
			buffer.clearBus('bus-A');

			const ids = buffer.getActiveBusIds();
			expect(ids).toEqual(['bus-B']);
		});

		it('does not include buses fully pruned', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 5000 }));
			buffer.prune(3000);

			const ids = buffer.getActiveBusIds();
			expect(ids).toEqual(['bus-B']);
		});
	});

	describe('busCount', () => {
		it('returns 0 for empty buffer', () => {
			expect(buffer.busCount).toBe(0);
		});

		it('returns correct count of distinct buses', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 2000 }));
			expect(buffer.busCount).toBe(2);
		});

		it('does not double-count multiple readings for same bus', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 2000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5) }));
			expect(buffer.busCount).toBe(1);
		});
	});

	describe('totalReadings', () => {
		it('returns 0 for empty buffer', () => {
			expect(buffer.totalReadings).toBe(0);
		});

		it('counts readings across all buses', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 2000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 3000 }));

			expect(buffer.totalReadings).toBe(3);
		});

		it('decreases after prune', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000 }));
			buffer.ingest(makeReading({ timestamp: 3000 }));

			buffer.prune(2000);
			expect(buffer.totalReadings).toBe(2);
		});

		it('is 0 after clearAll', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000 }));
			buffer.clearAll();
			expect(buffer.totalReadings).toBe(0);
		});
	});

	describe('has()', () => {
		it('returns false for unknown bus', () => {
			expect(buffer.has('nonexistent')).toBe(false);
		});

		it('returns true for bus with data', () => {
			buffer.ingest(makeReading({ busId: 'bus-1' }));
			expect(buffer.has('bus-1')).toBe(true);
		});

		it('returns false after bus is cleared', () => {
			buffer.ingest(makeReading({ busId: 'bus-1' }));
			buffer.clearBus('bus-1');
			expect(buffer.has('bus-1')).toBe(false);
		});
	});

	describe('getOldestTimestamp()', () => {
		it('returns undefined for empty buffer', () => {
			expect(buffer.getOldestTimestamp()).toBeUndefined();
		});

		it('returns the oldest timestamp across all buses', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 5000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 2000 }));
			buffer.ingest(makeReading({ busId: 'bus-C', lat: BSI_TERMINAL.lat, lng: BSI_TERMINAL.lng, timestamp: 8000 }));

			expect(buffer.getOldestTimestamp()).toBe(2000);
		});

		it('returns correct value after pruning', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 3000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5) }));
			buffer.ingest(makeReading({ timestamp: 5000, lat: shiftNorth(HALLGRIMSKIRKJA.lat, 10) }));

			buffer.prune(3000);

			expect(buffer.getOldestTimestamp()).toBe(3000);
		});

		it('returns the single timestamp when only one reading exists', () => {
			buffer.ingest(makeReading({ timestamp: 42000 }));
			expect(buffer.getOldestTimestamp()).toBe(42000);
		});

		it('returns undefined after clearAll', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.clearAll();
			expect(buffer.getOldestTimestamp()).toBeUndefined();
		});
	});

	describe('getNewestTimestamp()', () => {
		it('returns undefined for empty buffer', () => {
			expect(buffer.getNewestTimestamp()).toBeUndefined();
		});

		it('returns the newest timestamp across all buses', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 5000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 2000 }));
			buffer.ingest(makeReading({ busId: 'bus-C', lat: BSI_TERMINAL.lat, lng: BSI_TERMINAL.lng, timestamp: 8000 }));

			expect(buffer.getNewestTimestamp()).toBe(8000);
		});

		it('considers latest reading per bus (last in buffer)', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 10000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 5000 }));

			expect(buffer.getNewestTimestamp()).toBe(10000);
		});

		it('returns correct value after pruning', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 3000 }));
			buffer.ingest(makeReading({ timestamp: 5000 }));

			buffer.prune(3000);

			expect(buffer.getNewestTimestamp()).toBe(5000);
		});

		it('returns undefined after clearAll', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.clearAll();
			expect(buffer.getNewestTimestamp()).toBeUndefined();
		});
	});

	describe('getRouteKey()', () => {
		it('returns undefined for unknown bus', () => {
			expect(buffer.getRouteKey('nonexistent')).toBeUndefined();
		});

		it('returns routeNr:gtfsDirectionId when gtfsDirectionId is present', () => {
			buffer.ingest(makeReading({
				routeNr: '14',
				gtfsDirectionId: 1,
				timestamp: 1000,
			}));

			expect(buffer.getRouteKey('bus-1')).toBe('14:1');
		});

		it('falls back to compass direction when gtfsDirectionId is undefined', () => {
			buffer.ingest(makeReading({
				routeNr: '6',
				direction: 270,
				gtfsDirectionId: undefined,
				timestamp: 1000,
			}));

			expect(buffer.getRouteKey('bus-1')).toBe('6:270');
		});

		it('uses the latest reading for route key', () => {
			buffer.ingest(makeReading({
				routeNr: '1',
				gtfsDirectionId: 0,
				timestamp: 1000,
			}));
			buffer.ingest(makeReading({
				routeNr: '14',
				gtfsDirectionId: 1,
				timestamp: 2000,
				lat: shiftNorth(HALLGRIMSKIRKJA.lat, 5),
			}));

			expect(buffer.getRouteKey('bus-1')).toBe('14:1');
		});

		it('returns routeNr:0 when gtfsDirectionId is 0', () => {
			buffer.ingest(makeReading({
				routeNr: '3',
				gtfsDirectionId: 0,
				timestamp: 1000,
			}));

			expect(buffer.getRouteKey('bus-1')).toBe('3:0');
		});

		it('returns undefined after bus is cleared', () => {
			buffer.ingest(makeReading({ routeNr: '1', gtfsDirectionId: 0 }));
			buffer.clearBus('bus-1');
			expect(buffer.getRouteKey('bus-1')).toBeUndefined();
		});
	});

	describe('edge cases', () => {
		it('handles large number of readings per bus', () => {
			for (let i = 0; i < 1000; i++) {
				buffer.ingest(makeReading({
					timestamp: BASE_TS + i * 2000,
					lat: shiftNorth(HALLGRIMSKIRKJA.lat, i * 2),
				}));
			}

			expect(buffer.getAll('bus-1')).toHaveLength(1000);
			expect(buffer.totalReadings).toBe(1000);
		});

		it('handles many distinct buses', () => {
			for (let i = 0; i < 50; i++) {
				buffer.ingest(makeReading({
					busId: `bus-${i}`,
					timestamp: BASE_TS,
					lat: shiftNorth(HALLGRIMSKIRKJA.lat, i * 10),
				}));
			}

			expect(buffer.busCount).toBe(50);
			expect(buffer.totalReadings).toBe(50);
		});

		it('prune with cutoff in the future removes all data', () => {
			buffer.ingest(makeReading({ timestamp: BASE_TS }));
			buffer.ingest(makeReading({ timestamp: BASE_TS + 1000 }));

			buffer.prune(BASE_TS + 999999);

			expect(buffer.busCount).toBe(0);
			expect(buffer.totalReadings).toBe(0);
		});

		it('prune with cutoff of 0 keeps everything', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			buffer.ingest(makeReading({ timestamp: 2000 }));

			buffer.prune(0);

			expect(buffer.totalReadings).toBe(2);
		});

		it('getWindow returns readings only for specified bus', () => {
			buffer.ingest(makeReading({ busId: 'bus-A', timestamp: 1000 }));
			buffer.ingest(makeReading({ busId: 'bus-B', lat: HARPA.lat, lng: HARPA.lng, timestamp: 1000 }));

			const window = buffer.getWindow('bus-A', 0, 5000);
			expect(window).toHaveLength(1);
			expect(window[0].busId).toBe('bus-A');
		});

		it('stale detection works across longitude shifts', () => {
			buffer.ingest(makeReading({ timestamp: 1000 }));
			// Move 0.5m east — still stale
			buffer.ingest(makeReading({
				timestamp: 2000,
				lng: shiftEast(HALLGRIMSKIRKJA.lng, 0.5),
			}));

			expect(buffer.getAll('bus-1')[1].isStale).toBe(true);

			// Move 5m east from original — not stale (baseline was not updated)
			buffer.ingest(makeReading({
				timestamp: 3000,
				lng: shiftEast(HALLGRIMSKIRKJA.lng, 5),
			}));

			expect(buffer.getAll('bus-1')[2].isStale).toBe(false);
		});
	});
});
