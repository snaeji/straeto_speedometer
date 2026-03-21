import { STRAETO_API_URL, ALL_ROUTES } from '$lib/utils/constants';
import { busLocationFromApi, type ApiResult, type ApiTripInfo, type BusLocation, type NextStop } from '$lib/types/bus';

export class StraetoApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'StraetoApiError';
	}
}

const FULL_QUERY = `query BusLocationByRoute($routes: [String!]!) {
	BusLocationByRoute(routes: $routes) {
		lastUpdate
		results {
			busId tripId routeNr lat lng direction headsign tag
			nextStops {
				stop { id name lat lon }
				arrival
			}
			trip {
				direction routeId serviceId headsign
			}
		}
	}
}`;

function validateNextStops(raw: unknown): NextStop[] | undefined {
	if (!Array.isArray(raw) || raw.length === 0) return undefined;
	const stops: NextStop[] = [];
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) continue;
		const obj = item as Record<string, unknown>;
		const stop = obj.stop as Record<string, unknown> | undefined;
		if (!stop || typeof stop !== 'object') continue;
		const id = stop.id;
		const lat = stop.lat;
		const lon = stop.lon;
		if (id == null || typeof lat !== 'number' || !isFinite(lat) || typeof lon !== 'number' || !isFinite(lon)) continue;
		stops.push({
			stopId: String(id),
			name: typeof stop.name === 'string' ? stop.name : '',
			lat,
			lng: lon, // API uses "lon", we normalize to "lng"
			arrival: typeof obj.arrival === 'string' ? obj.arrival : '',
		});
	}
	return stops.length > 0 ? stops : undefined;
}

function validateTrip(raw: unknown): ApiTripInfo | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.direction !== 'number' || (obj.direction !== 0 && obj.direction !== 1)) return undefined;
	return {
		direction: obj.direction,
		routeId: typeof obj.routeId === 'string' ? obj.routeId : '',
		serviceId: typeof obj.serviceId === 'string' ? obj.serviceId : '',
		headsign: typeof obj.headsign === 'string' ? obj.headsign : '',
	};
}

function validateApiResult(r: Record<string, unknown>): ApiResult | null {
	if (typeof r.busId !== 'string' || !r.busId) return null;
	if (typeof r.routeNr !== 'string' && typeof r.routeNr !== 'number') return null;
	if (typeof r.tripId !== 'string') return null;
	if (typeof r.lat !== 'number' || !isFinite(r.lat) || r.lat < 63.5 || r.lat > 66.5) return null;
	if (typeof r.lng !== 'number' || !isFinite(r.lng) || r.lng < -25.0 || r.lng > -13.0) return null;
	if (typeof r.direction !== 'number' || !isFinite(r.direction)) return null;
	return {
		busId: String(r.busId),
		routeNr: String(r.routeNr),
		tripId: String(r.tripId),
		lat: r.lat,
		lng: r.lng,
		direction: r.direction,
		headsign: typeof r.headsign === 'string' ? r.headsign : null,
		nextStops: validateNextStops(r.nextStops),
		trip: validateTrip(r.trip),
	};
}

/**
 * Fetches current bus positions for all routes from the Straeto GraphQL API.
 * Uses full GraphQL query (not persisted hash) to include nextStops and trip data.
 * Returns [timestamp in epoch ms, list of BusLocation].
 */
export async function fetchBusLocations(): Promise<[number, BusLocation[]]> {
	const body = JSON.stringify({
		query: FULL_QUERY,
		variables: { routes: ALL_ROUTES },
	});

	const response = await fetch(STRAETO_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'apollo-require-preflight': 'true',
		},
		body,
	});

	if (!response.ok) {
		throw new StraetoApiError(`HTTP ${response.status}: ${response.statusText}`);
	}

	const json = await response.json();

	if (json?.errors?.length > 0) {
		throw new StraetoApiError(`GraphQL error: ${json.errors[0]?.message ?? 'unknown'}`);
	}

	const data = json?.data;
	if (!data) throw new StraetoApiError('Response missing "data" field');

	const busLocationByRoute = data.BusLocationByRoute;
	if (!busLocationByRoute) {
		throw new StraetoApiError('Response missing "data.BusLocationByRoute" field');
	}

	const lastUpdateStr = busLocationByRoute.lastUpdate;
	if (!lastUpdateStr) throw new StraetoApiError('Response missing "lastUpdate" field');

	const timestamp = new Date(lastUpdateStr).getTime();
	if (isNaN(timestamp)) throw new StraetoApiError(`Invalid timestamp: "${lastUpdateStr}"`);
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
