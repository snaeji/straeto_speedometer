import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBusLocations, StraetoApiError } from '$lib/services/straeto-api';

function mockFetch(body: unknown, status = 200, statusText = 'OK') {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		statusText,
		json: () => Promise.resolve(body),
	}));
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('fetchBusLocations', () => {
	it('parses a valid GraphQL response', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [
						{ busId: 'b1', routeNr: '1', tripId: 't1', lat: 64.14, lng: -21.93, direction: 0, headsign: 'Hlemmur' },
						{ busId: 'b2', routeNr: '5', tripId: 't2', lat: 64.15, lng: -21.92, direction: 1, headsign: null },
					],
				},
			},
		});

		const [timestamp, buses] = await fetchBusLocations();

		expect(timestamp).toBe(new Date('2024-03-15T12:00:00Z').getTime());
		expect(buses).toHaveLength(2);
		expect(buses[0].busId).toBe('b1');
		expect(buses[0].routeNr).toBe('1');
		expect(buses[0].headsign).toBe('Hlemmur');
		expect(buses[0].isViolation).toBe(false);
		expect(buses[1].headsign).toBeUndefined();
	});

	it('skips invalid entries silently', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [
						{ busId: '', routeNr: '1', tripId: 't1', lat: 64.14, lng: -21.93, direction: 0 }, // empty busId
						{ busId: 'b2', routeNr: '1', tripId: 't2', lat: 64.14, lng: -21.93, direction: 0 }, // valid
					],
				},
			},
		});

		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(1);
		expect(buses[0].busId).toBe('b2');
	});

	it('throws StraetoApiError on HTTP 500', async () => {
		mockFetch({}, 500, 'Internal Server Error');
		await expect(fetchBusLocations()).rejects.toThrow(StraetoApiError);
	});

	it('throws on GraphQL errors in response', async () => {
		mockFetch({ errors: [{ message: 'query failed' }] });
		await expect(fetchBusLocations()).rejects.toThrow(StraetoApiError);
	});

	it('throws on missing data field', async () => {
		mockFetch({});
		await expect(fetchBusLocations()).rejects.toThrow(StraetoApiError);
	});

	it('throws on missing BusLocationByRoute', async () => {
		mockFetch({ data: {} });
		await expect(fetchBusLocations()).rejects.toThrow(StraetoApiError);
	});

	it('throws on missing lastUpdate', async () => {
		mockFetch({ data: { BusLocationByRoute: { results: [] } } });
		await expect(fetchBusLocations()).rejects.toThrow(StraetoApiError);
	});

	it('throws on invalid timestamp string', async () => {
		mockFetch({ data: { BusLocationByRoute: { lastUpdate: 'not-a-date', results: [] } } });
		await expect(fetchBusLocations()).rejects.toThrow(StraetoApiError);
	});

	it('throws on missing results', async () => {
		mockFetch({ data: { BusLocationByRoute: { lastUpdate: '2024-03-15T12:00:00Z' } } });
		await expect(fetchBusLocations()).rejects.toThrow(StraetoApiError);
	});
});

describe('validateApiResult edge cases (tested via fetchBusLocations)', () => {
	it('accepts numeric routeNr (stringified)', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [
						{ busId: 'b1', routeNr: 5, tripId: 't1', lat: 64.14, lng: -21.93, direction: 0 },
					],
				},
			},
		});
		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(1);
		expect(buses[0].routeNr).toBe('5');
	});

	it('rejects NaN lat', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [
						{ busId: 'b1', routeNr: '1', tripId: 't1', lat: NaN, lng: -21.93, direction: 0 },
					],
				},
			},
		});
		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(0);
	});

	it('rejects Infinity lat', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [
						{ busId: 'b1', routeNr: '1', tripId: 't1', lat: Infinity, lng: -21.93, direction: 0 },
					],
				},
			},
		});
		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(0);
	});

	it('rejects lat out of range (-91)', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [
						{ busId: 'b1', routeNr: '1', tripId: 't1', lat: -91, lng: -21.93, direction: 0 },
					],
				},
			},
		});
		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(0);
	});

	it('rejects lng out of range (181)', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [
						{ busId: 'b1', routeNr: '1', tripId: 't1', lat: 64.14, lng: 181, direction: 0 },
					],
				},
			},
		});
		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(0);
	});

	it('rejects missing direction', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [
						{ busId: 'b1', routeNr: '1', tripId: 't1', lat: 64.14, lng: -21.93 },
					],
				},
			},
		});
		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(0);
	});
});

describe('nextStops and trip parsing', () => {
	it('parses nextStops from response', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [{
						busId: 'b1', routeNr: '1', tripId: 't1', lat: 64.14, lng: -21.93, direction: 0,
						nextStops: [
							{ stop: { id: 90000834, name: 'Gamla Hringbraut', lat: 64.138, lon: -21.932 }, arrival: '08:28' },
							{ stop: { id: 90000845, name: 'Læknagarður', lat: 64.135, lon: -21.931 }, arrival: '08:30' },
						],
						trip: { direction: 0, routeId: '1', serviceId: '1309', headsign: 'Hlemmur' },
					}],
				},
			},
		});

		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(1);
		expect(buses[0].nextStops).toBeDefined();
		expect(buses[0].nextStops).toHaveLength(2);
		expect(buses[0].nextStops![0].stopId).toBe('90000834');
		expect(buses[0].nextStops![0].name).toBe('Gamla Hringbraut');
		expect(buses[0].nextStops![0].lat).toBe(64.138);
		expect(buses[0].nextStops![0].lng).toBe(-21.932); // normalized from lon
		expect(buses[0].nextStops![0].arrival).toBe('08:28');
	});

	it('handles missing nextStops gracefully', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [{
						busId: 'b1', routeNr: '1', tripId: 't1', lat: 64.14, lng: -21.93, direction: 0,
					}],
				},
			},
		});

		const [, buses] = await fetchBusLocations();
		expect(buses).toHaveLength(1);
		expect(buses[0].nextStops).toBeUndefined();
	});

	it('parses trip.direction as gtfsDirectionId', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [{
						busId: 'b1', routeNr: '1', tripId: 't1', lat: 64.14, lng: -21.93, direction: 263,
						trip: { direction: 1, routeId: '1', serviceId: '1309', headsign: 'Test' },
					}],
				},
			},
		});

		const [, buses] = await fetchBusLocations();
		expect(buses[0].direction).toBe(263); // compass bearing preserved
		expect(buses[0].gtfsDirectionId).toBe(1); // GTFS direction extracted
	});

	it('handles missing trip gracefully', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [{
						busId: 'b1', routeNr: '1', tripId: 't1', lat: 64.14, lng: -21.93, direction: 0,
					}],
				},
			},
		});

		const [, buses] = await fetchBusLocations();
		expect(buses[0].gtfsDirectionId).toBeUndefined();
	});

	it('rejects trip with invalid direction', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [{
						busId: 'b1', routeNr: '1', tripId: 't1', lat: 64.14, lng: -21.93, direction: 0,
						trip: { direction: 5, routeId: '1', serviceId: '1309', headsign: 'Test' },
					}],
				},
			},
		});

		const [, buses] = await fetchBusLocations();
		expect(buses[0].gtfsDirectionId).toBeUndefined();
	});

	it('sends full query with apollo-require-preflight header', async () => {
		mockFetch({
			data: {
				BusLocationByRoute: {
					lastUpdate: '2024-03-15T12:00:00Z',
					results: [],
				},
			},
		});

		await fetchBusLocations();

		const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const [, options] = fetchCall;
		const body = JSON.parse(options.body);

		// Should use full query, not persisted hash
		expect(body.query).toBeDefined();
		expect(body.extensions).toBeUndefined();
		expect(body.query).toContain('nextStops');
		expect(body.query).toContain('trip');

		// Should have apollo-require-preflight header
		expect(options.headers['apollo-require-preflight']).toBe('true');
	});
});
