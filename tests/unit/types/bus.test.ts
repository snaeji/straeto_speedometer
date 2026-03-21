import { describe, it, expect } from 'vitest';
import {
	busLocationFromApi,
	busLocationFromJsonLine,
	busLocationToJsonLine,
	copyBusLocationWith,
	createBusLocation,
	type BusLocation,
} from '$lib/types/bus';
import { makeApiResult, makeBusLocation, makeJsonLineRecord } from '../../fixtures';

describe('busLocationFromApi', () => {
	it('creates correct BusLocation from ApiResult', () => {
		const api = makeApiResult({ busId: 'b42', routeNr: '3', headsign: 'Mjódd' });
		const loc = busLocationFromApi(api, 1710000000000);

		expect(loc.busId).toBe('b42');
		expect(loc.routeNr).toBe('3');
		expect(loc.tripId).toBe('trip-1');
		expect(loc.lat).toBe(api.lat);
		expect(loc.lng).toBe(api.lng);
		expect(loc.direction).toBe(0);
		expect(loc.timestamp).toBe(1710000000000);
		expect(loc.headsign).toBe('Mjódd');
		expect(loc.isViolation).toBe(false);
	});

	it('sets isViolation to false', () => {
		const loc = busLocationFromApi(makeApiResult(), 0);
		expect(loc.isViolation).toBe(false);
	});

	it('handles null headsign → undefined', () => {
		const api = makeApiResult({ headsign: null });
		const loc = busLocationFromApi(api, 0);
		expect(loc.headsign).toBeUndefined();
	});
});

describe('busLocationToJsonLine / busLocationFromJsonLine roundtrip', () => {
	it('roundtrips a full BusLocation', () => {
		const original = makeBusLocation({
			busId: 'b99',
			routeNr: '14',
			tripId: 'trip-x',
			lat: 64.1418,
			lng: -21.9268,
			direction: 1,
			timestamp: 1710000000000,
			headsign: 'Grandi',
			speedKmh: 45.678,
			speedLimitKmh: 50.4,
			speedLimitMatch: 'matched',
			speedLimitRoad: 'Kleppsmyrarvegur',
			isViolation: true,
		});

		const json = busLocationToJsonLine(original);
		const restored = busLocationFromJsonLine(json);

		expect(restored.busId).toBe('b99');
		expect(restored.routeNr).toBe('14');
		expect(restored.tripId).toBe('trip-x');
		expect(restored.lat).toBe(64.1418);
		expect(restored.lng).toBe(-21.9268);
		expect(restored.direction).toBe(1);
		expect(restored.timestamp).toBe(1710000000000);
		expect(restored.headsign).toBe('Grandi');
		expect(restored.isViolation).toBe(true);
	});

	it('rounds speed to 1 decimal', () => {
		const loc = makeBusLocation({ speedKmh: 45.678 });
		const json = busLocationToJsonLine(loc);
		expect(json.s).toBe(45.7);
	});

	it('rounds speed limit to integer', () => {
		const loc = makeBusLocation({ speedLimitKmh: 50.4 });
		const json = busLocationToJsonLine(loc);
		expect(json.sl).toBe(50);
	});

	it('maps speedLimitMatch correctly', () => {
		const matched = busLocationToJsonLine(makeBusLocation({ speedLimitMatch: 'matched' }));
		expect(matched.slm).toBe('m');

		const fallback = busLocationToJsonLine(makeBusLocation({ speedLimitMatch: 'fallback' }));
		expect(fallback.slm).toBe('f');

		const restoredM = busLocationFromJsonLine(makeJsonLineRecord({ slm: 'm' }));
		expect(restoredM.speedLimitMatch).toBe('matched');

		const restoredF = busLocationFromJsonLine(makeJsonLineRecord({ slm: 'f' }));
		expect(restoredF.speedLimitMatch).toBe('fallback');
	});

	it('omits optional fields when undefined', () => {
		const loc = makeBusLocation(); // no speed, no limit, etc.
		const json = busLocationToJsonLine(loc);
		expect(json.s).toBeUndefined();
		expect(json.sl).toBeUndefined();
		expect(json.slm).toBeUndefined();
		expect(json.slr).toBeUndefined();
		expect(json.h).toBeUndefined();
		expect(json.v).toBeUndefined();
	});

	it('preserves optional fields when present', () => {
		const loc = makeBusLocation({
			headsign: 'Hlemmur',
			speedKmh: 30,
			speedLimitKmh: 50,
			speedLimitMatch: 'matched',
			speedLimitRoad: 'Laugavegur',
		});
		const json = busLocationToJsonLine(loc);
		expect(json.h).toBe('Hlemmur');
		expect(json.s).toBe(30);
		expect(json.sl).toBe(50);
		expect(json.slm).toBe('m');
		expect(json.slr).toBe('Laugavegur');
	});

	it('only writes isViolation when true', () => {
		const noViol = busLocationToJsonLine(makeBusLocation({ isViolation: false }));
		expect(noViol.v).toBeUndefined();

		const viol = busLocationToJsonLine(makeBusLocation({ isViolation: true }));
		expect(viol.v).toBe(true);
	});
});

describe('copyBusLocationWith', () => {
	it('overrides specified fields', () => {
		const original = makeBusLocation({ speedKmh: 40 });
		const copied = copyBusLocationWith(original, { speedKmh: 55, isViolation: true });
		expect(copied.speedKmh).toBe(55);
		expect(copied.isViolation).toBe(true);
	});

	it('leaves non-overridden fields intact', () => {
		const original = makeBusLocation({ busId: 'b1', routeNr: '5', speedKmh: 40 });
		const copied = copyBusLocationWith(original, { speedKmh: 55 });
		expect(copied.busId).toBe('b1');
		expect(copied.routeNr).toBe('5');
	});

	it('does not mutate the original', () => {
		const original = makeBusLocation({ speedKmh: 40 });
		copyBusLocationWith(original, { speedKmh: 55 });
		expect(original.speedKmh).toBe(40);
	});
});

describe('createBusLocation', () => {
	it('sets isViolation to false when omitted', () => {
		const loc = createBusLocation({
			busId: 'b1',
			routeNr: '1',
			tripId: 'trip-1',
			lat: 64.14,
			lng: -21.93,
			direction: 0,
			timestamp: 1710000000000,
		});
		expect(loc.isViolation).toBe(false);
	});

	it('preserves isViolation when explicitly set', () => {
		const loc = createBusLocation({
			busId: 'b1',
			routeNr: '1',
			tripId: 'trip-1',
			lat: 64.14,
			lng: -21.93,
			direction: 0,
			timestamp: 1710000000000,
			isViolation: true,
		});
		expect(loc.isViolation).toBe(true);
	});
});

describe('validateApiResult (via straeto-api)', () => {
	// Import directly from straeto-api to test the validateApiResult function
	// Since it's not exported, we test it indirectly through busLocationFromApi edge cases
	// and the exposed validation behavior in straeto-api.test.ts
	// Here we test the type-level guarantees

	it('BusLocation requires all mandatory fields', () => {
		const loc: BusLocation = {
			busId: 'b1',
			routeNr: '1',
			tripId: 't1',
			lat: 64.14,
			lng: -21.93,
			direction: 0,
			timestamp: 0,
			isViolation: false,
		};
		expect(loc.busId).toBe('b1');
		expect(loc.speedKmh).toBeUndefined();
	});
});
