import { REYKJAVIK_LAT_DEG_TO_KM, REYKJAVIK_LNG_DEG_TO_KM } from './constants';

const EARTH_RADIUS_M = 6_371_000.0;

function toRad(deg: number): number {
	return (deg * Math.PI) / 180;
}

/** Haversine distance in meters between two WGS84 coordinates. */
export function haversineDistanceM(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number
): number {
	const dLat = toRad(lat2 - lat1);
	const dLng = toRad(lng2 - lng1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return EARTH_RADIUS_M * c;
}

/**
 * Minimum distance in meters from point (pLat, pLng) to the line segment
 * from (aLat, aLng) to (bLat, bLng).
 *
 * Uses flat-Earth approximation with Reykjavik-specific degree-to-km
 * conversions for the projection, then Haversine for the final distance.
 */
export function pointToLineSegmentDistanceM(
	pLat: number,
	pLng: number,
	aLat: number,
	aLng: number,
	bLat: number,
	bLng: number
): number {
	const pX = pLng * REYKJAVIK_LNG_DEG_TO_KM;
	const pY = pLat * REYKJAVIK_LAT_DEG_TO_KM;
	const aX = aLng * REYKJAVIK_LNG_DEG_TO_KM;
	const aY = aLat * REYKJAVIK_LAT_DEG_TO_KM;
	const bX = bLng * REYKJAVIK_LNG_DEG_TO_KM;
	const bY = bLat * REYKJAVIK_LAT_DEG_TO_KM;

	const dx = bX - aX;
	const dy = bY - aY;
	const lenSq = dx * dx + dy * dy;

	let closestLat: number;
	let closestLng: number;

	if (lenSq < 1e-12) {
		closestLat = aLat;
		closestLng = aLng;
	} else {
		let t = ((pX - aX) * dx + (pY - aY) * dy) / lenSq;
		t = Math.max(0, Math.min(1, t));
		closestLat = aLat + t * (bLat - aLat);
		closestLng = aLng + t * (bLng - aLng);
	}

	return haversineDistanceM(pLat, pLng, closestLat, closestLng);
}

/** Project point onto line segment, returning t parameter, projected coords, and distance. */
export function projectPointOnSegment(
	pLat: number,
	pLng: number,
	aLat: number,
	aLng: number,
	bLat: number,
	bLng: number
): { t: number; projLat: number; projLng: number; distanceM: number } {
	const pX = pLng * REYKJAVIK_LNG_DEG_TO_KM;
	const pY = pLat * REYKJAVIK_LAT_DEG_TO_KM;
	const aX = aLng * REYKJAVIK_LNG_DEG_TO_KM;
	const aY = aLat * REYKJAVIK_LAT_DEG_TO_KM;
	const bX = bLng * REYKJAVIK_LNG_DEG_TO_KM;
	const bY = bLat * REYKJAVIK_LAT_DEG_TO_KM;

	const dx = bX - aX;
	const dy = bY - aY;
	const lenSq = dx * dx + dy * dy;

	let t: number;
	if (lenSq < 1e-12) {
		t = 0;
	} else {
		t = Math.max(0, Math.min(1, ((pX - aX) * dx + (pY - aY) * dy) / lenSq));
	}

	const projLat = aLat + t * (bLat - aLat);
	const projLng = aLng + t * (bLng - aLng);
	const distanceM = haversineDistanceM(pLat, pLng, projLat, projLng);

	return { t, projLat, projLng, distanceM };
}

/** Flat-Earth distance in meters between two WGS84 coordinates at Reykjavik latitude. */
export function flatDistanceM(
	lat1: number,
	lng1: number,
	lat2: number,
	lng2: number
): number {
	const dy = (lat2 - lat1) * REYKJAVIK_LAT_DEG_TO_KM * 1000;
	const dx = (lng2 - lng1) * REYKJAVIK_LNG_DEG_TO_KM * 1000;
	return Math.sqrt(dx * dx + dy * dy);
}

/** Convert distance in meters and time delta in seconds to speed in km/h. */
export function speedKmh(distanceM: number, timeDeltaS: number): number {
	if (timeDeltaS <= 0) return 0;
	return (distanceM / 1000) / (timeDeltaS / 3600);
}
