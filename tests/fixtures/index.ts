import type { BusLocation, ApiResult, JsonLineRecord } from '$lib/types/bus';
import type { RouteShapeData, RouteShapeVertex } from '$lib/services/route-shape-index';

// Reykjavik reference points
export const HALLGRIMSKIRKJA = { lat: 64.1418, lng: -21.9268 };
export const HARPA = { lat: 64.1504, lng: -21.9330 };
export const BSI_TERMINAL = { lat: 64.1367, lng: -21.9220 };

// Kleppsmyrarvegur segment from CLAUDE.md sample
export const KLEPPSMYRARVEGUR_A = { lat: 64.134729727793399, lng: -21.84413699817409 };
export const KLEPPSMYRARVEGUR_B = { lat: 64.135027221200275, lng: -21.843183853213691 };

export function makeBusLocation(overrides: Partial<BusLocation> = {}): BusLocation {
	return {
		busId: 'bus-1',
		routeNr: '1',
		tripId: 'trip-1',
		lat: HALLGRIMSKIRKJA.lat,
		lng: HALLGRIMSKIRKJA.lng,
		direction: 0,
		timestamp: 1710000000000,
		isViolation: false,
		...overrides,
	};
}

export function makeApiResult(overrides: Partial<ApiResult> = {}): ApiResult {
	return {
		busId: 'bus-1',
		routeNr: '1',
		tripId: 'trip-1',
		lat: HALLGRIMSKIRKJA.lat,
		lng: HALLGRIMSKIRKJA.lng,
		direction: 0,
		headsign: null,
		...overrides,
	};
}

export function makeJsonLineRecord(overrides: Partial<JsonLineRecord> = {}): JsonLineRecord {
	return {
		b: 'bus-1',
		r: '1',
		t: 'trip-1',
		la: HALLGRIMSKIRKJA.lat,
		ln: HALLGRIMSKIRKJA.lng,
		d: 0,
		ts: 1710000000000,
		...overrides,
	};
}

/** Build a minimal GeoJSON FeatureCollection for SpeedLimitService tests. */
export function makeSpeedLimitGeoJson(segments: Array<{
	coords: [number, number][];
	hradi: number;
	name?: string;
	gotuflokkur?: number;
}>): { type: string; features: Array<{ type: string; id: number; geometry: { type: string; coordinates: number[][] }; properties: Record<string, unknown> }> } {
	return {
		type: 'FeatureCollection',
		features: segments.map((seg, i) => ({
			type: 'Feature',
			id: i + 1,
			geometry: {
				type: 'LineString',
				coordinates: seg.coords,
			},
			properties: {
				OBJECTID: i + 1,
				HRADI: seg.hradi,
				NAFN: seg.name ?? `Street ${i + 1}`,
				GOTUFLOKKUR: seg.gotuflokkur ?? 2,
			},
		})),
	};
}

/** Build a simple L-shaped route for MapMatcher / RouteAnimator tests. */
export function makeLShapedRoute(): RouteShapeData {
	// ~100m east then ~100m north at Reykjavik
	const p0 = { lat: 64.1400, lng: -21.9300 };
	const p1 = { lat: 64.1400, lng: -21.9280 }; // ~97m east
	const p2 = { lat: 64.1409, lng: -21.9280 }; // ~100m north

	const d01 = 97; // approx
	const d12 = 100; // approx

	const vertices: RouteShapeVertex[] = [
		{ lat: p0.lat, lng: p0.lng, cumDistM: 0 },
		{ lat: p1.lat, lng: p1.lng, cumDistM: d01 },
		{ lat: p2.lat, lng: p2.lng, cumDistM: d01 + d12 },
	];

	// Build grid
	const grid = new Map<string, number[]>();
	for (let i = 0; i < vertices.length - 1; i++) {
		const a = vertices[i];
		const b = vertices[i + 1];
		const latStep = 0.0009;
		const lngStep = 0.00206;
		const minLat = Math.min(a.lat, b.lat);
		const maxLat = Math.max(a.lat, b.lat);
		const minLng = Math.min(a.lng, b.lng);
		const maxLng = Math.max(a.lng, b.lng);
		const rowStart = Math.floor(minLat / latStep);
		const rowEnd = Math.floor(maxLat / latStep);
		const colStart = Math.floor(minLng / lngStep);
		const colEnd = Math.floor(maxLng / lngStep);
		for (let r = rowStart; r <= rowEnd; r++) {
			for (let c = colStart; c <= colEnd; c++) {
				const key = `${r},${c}`;
				let arr = grid.get(key);
				if (!arr) { arr = []; grid.set(key, arr); }
				arr.push(i);
			}
		}
	}

	return {
		shapeId: 'test-shape-1',
		routeNr: '1',
		directionId: 0,
		vertices,
		totalLengthM: d01 + d12,
		grid,
		stopDistancesM: [0, d01, d01 + d12],
	};
}

/** Build a straight-line route with N evenly-spaced vertices. */
export function makeStraightRoute(n: number, totalLengthM: number = 500): RouteShapeData {
	const startLat = 64.1400;
	const startLng = -21.9300;
	const latPerM = 1 / 111000;
	const segLen = totalLengthM / (n - 1);

	const vertices: RouteShapeVertex[] = [];
	for (let i = 0; i < n; i++) {
		vertices.push({
			lat: startLat + i * segLen * latPerM,
			lng: startLng,
			cumDistM: i * segLen,
		});
	}

	const grid = new Map<string, number[]>();
	for (let i = 0; i < vertices.length - 1; i++) {
		const key = `${Math.floor(vertices[i].lat / 0.0009)},${Math.floor(vertices[i].lng / 0.00206)}`;
		let arr = grid.get(key);
		if (!arr) { arr = []; grid.set(key, arr); }
		arr.push(i);
	}

	return {
		shapeId: 'straight-shape',
		routeNr: '1',
		directionId: 0,
		vertices,
		totalLengthM,
		grid,
		stopDistancesM: [0, totalLengthM / 2, totalLengthM],
	};
}
