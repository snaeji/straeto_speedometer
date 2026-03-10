export interface BusLocation {
	busId: string;
	routeNr: string;
	tripId: string;
	lat: number;
	lng: number;
	direction: number;
	timestamp: number; // Unix epoch milliseconds
	headsign?: string;
	speedKmh?: number;
	speedLimitKmh?: number;
	isViolation: boolean;
}

export interface BusLocationUpdate extends BusLocation {
	isStale?: boolean;
}

export function createBusLocation(partial: Omit<BusLocation, 'isViolation'> & { isViolation?: boolean }): BusLocation {
	return { ...partial, isViolation: partial.isViolation ?? false };
}

export function busLocationFromApi(json: ApiResult, timestamp: number): BusLocation {
	return {
		busId: json.busId,
		routeNr: json.routeNr,
		tripId: json.tripId,
		lat: json.lat,
		lng: json.lng,
		direction: json.direction,
		timestamp,
		headsign: json.headsign ?? undefined,
		isViolation: false,
	};
}

export function busLocationFromJsonLine(json: JsonLineRecord): BusLocation {
	return {
		busId: json.b,
		routeNr: json.r,
		tripId: json.t,
		lat: json.la,
		lng: json.ln,
		direction: json.d,
		timestamp: json.ts,
		headsign: json.h ?? undefined,
		speedKmh: json.s ?? undefined,
		speedLimitKmh: json.sl ?? undefined,
		isViolation: json.v ?? false,
	};
}

export function busLocationToJsonLine(loc: BusLocation): JsonLineRecord {
	const record: JsonLineRecord = {
		b: loc.busId,
		r: loc.routeNr,
		t: loc.tripId,
		la: loc.lat,
		ln: loc.lng,
		d: loc.direction,
		ts: loc.timestamp,
	};
	if (loc.headsign) record.h = loc.headsign;
	if (loc.speedKmh != null) record.s = Math.round(loc.speedKmh * 10) / 10;
	if (loc.speedLimitKmh != null) record.sl = Math.round(loc.speedLimitKmh);
	if (loc.isViolation) record.v = true;
	return record;
}

export function copyBusLocationWith(
	loc: BusLocation,
	overrides: { speedKmh?: number; speedLimitKmh?: number; isViolation?: boolean }
): BusLocation {
	return { ...loc, ...overrides };
}

export interface ApiResult {
	busId: string;
	tripId: string;
	routeNr: string;
	lat: number;
	lng: number;
	direction: number;
	headsign: string | null;
}

export interface JsonLineRecord {
	b: string;
	r: string;
	t: string;
	la: number;
	ln: number;
	d: number;
	ts: number;
	h?: string;
	s?: number;
	sl?: number;
	v?: boolean;
}

export interface SpeedLimitSegment {
	objectId: number;
	name?: string;
	speedLimitKmh: number;
	coordinates: [number, number][]; // [lng, lat][] GeoJSON order
}

export type AppMode = 'live' | 'playback' | 'stats' | 'heatmap';

export type PlaybackSpeed = 1 | 2 | 5 | 10;
