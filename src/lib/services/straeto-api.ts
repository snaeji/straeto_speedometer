import { STRAETO_API_URL, PERSISTED_QUERY_HASH, ALL_ROUTES } from '$lib/utils/constants';
import { busLocationFromApi, type ApiResult, type BusLocation } from '$lib/types/bus';

export class StraetoApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StraetoApiError';
	}
}

function validateApiResult(r: Record<string, unknown>): ApiResult | null {
	if (typeof r.busId !== 'string' || !r.busId) return null;
	if (typeof r.routeNr !== 'string' && typeof r.routeNr !== 'number') return null;
	if (typeof r.tripId !== 'string') return null;
	if (typeof r.lat !== 'number' || !isFinite(r.lat) || r.lat < -90 || r.lat > 90) return null;
	if (typeof r.lng !== 'number' || !isFinite(r.lng) || r.lng < -180 || r.lng > 180) return null;
	if (typeof r.direction !== 'number') return null;
	return {
		busId: String(r.busId),
		routeNr: String(r.routeNr),
		tripId: String(r.tripId),
		lat: r.lat,
		lng: r.lng,
		direction: r.direction,
		headsign: typeof r.headsign === 'string' ? r.headsign : null,
	};
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

	const buses: BusLocation[] = [];
	for (const r of results) {
		const validated = validateApiResult(r as Record<string, unknown>);
		if (validated) {
			buses.push(busLocationFromApi(validated, timestamp));
		}
	}
	return [timestamp, buses];
}
