import { STRAETO_API_URL, PERSISTED_QUERY_HASH, ALL_ROUTES } from '$lib/utils/constants';
import { busLocationFromApi, type BusLocation } from '$lib/types/bus';

export class StraetoApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StraetoApiError';
	}
}

/**
 * Fetches current bus positions for all routes from the Straeto GraphQL API.
 * Returns [timestamp in epoch ms, list of BusLocation].
 */
export async function fetchBusLocations(): Promise<[number, BusLocation[]]> {
	const body = JSON.stringify({
		extensions: {
			persistedQuery: {
				version: 1,
				sha256Hash: PERSISTED_QUERY_HASH,
			},
		},
		variables: {
			routes: ALL_ROUTES,
		},
	});

	const response = await fetch(STRAETO_API_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
	});

	if (!response.ok) {
		throw new StraetoApiError(`HTTP ${response.status}: ${response.statusText}`);
	}

	const json = await response.json();

	const data = json?.data;
	if (!data) throw new StraetoApiError('Response missing "data" field');

	const busLocationByRoute = data.BusLocationByRoute;
	if (!busLocationByRoute) {
		throw new StraetoApiError('Response missing "data.BusLocationByRoute" field');
	}

	const lastUpdateStr = busLocationByRoute.lastUpdate;
	if (!lastUpdateStr) throw new StraetoApiError('Response missing "lastUpdate" field');

	const timestamp = new Date(lastUpdateStr).getTime();
	const results = busLocationByRoute.results;
	if (!Array.isArray(results)) throw new StraetoApiError('Response missing "results" field');

	const buses = results.map((r: Record<string, unknown>) => busLocationFromApi(r as never, timestamp));
	return [timestamp, buses];
}
