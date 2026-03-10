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

	if (lenSq === 0) {
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

/** Convert distance in meters and time delta in seconds to speed in km/h. */
export function speedKmh(distanceM: number, timeDeltaS: number): number {
	if (timeDeltaS <= 0) return 0;
	return (distanceM / 1000) / (timeDeltaS / 3600);
}
