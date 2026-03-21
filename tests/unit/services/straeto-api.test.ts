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
