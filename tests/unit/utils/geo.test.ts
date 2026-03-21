import { describe, it, expect } from 'vitest';
import {
	haversineDistanceM,
	pointToLineSegmentDistanceM,
	projectPointOnSegment,
	flatDistanceM,
	speedKmh,
} from '$lib/utils/geo';
import {
	HALLGRIMSKIRKJA,
	HARPA,
	KLEPPSMYRARVEGUR_A,
	KLEPPSMYRARVEGUR_B,
} from '../../fixtures';

describe('haversineDistanceM', () => {
	it('returns 0 for the same point', () => {
		expect(haversineDistanceM(64.14, -21.93, 64.14, -21.93)).toBe(0);
	});

	it('returns ~990-1010m between Hallgrimskirkja and Harpa', () => {
		const dist = haversineDistanceM(
			HALLGRIMSKIRKJA.lat, HALLGRIMSKIRKJA.lng,
			HARPA.lat, HARPA.lng,
		);
		expect(dist).toBeGreaterThan(950);
		expect(dist).toBeLessThan(1050);
	});

	it('returns ~half Earth circumference for antipodal points', () => {
		const dist = haversineDistanceM(0, 0, 0, 180);
		expect(dist).toBeGreaterThan(20_000_000);
		expect(dist).toBeLessThan(20_100_000);
	});

	it('is symmetric', () => {
		const ab = haversineDistanceM(64.14, -21.93, 64.15, -21.94);
		const ba = haversineDistanceM(64.15, -21.94, 64.14, -21.93);
		expect(ab).toBeCloseTo(ba, 10);
	});

	it('handles small distances (~1m) at Reykjavik latitude', () => {
		const latOffset = 1 / 111_000; // ~1m north
		const dist = haversineDistanceM(64.14, -21.93, 64.14 + latOffset, -21.93);
		expect(dist).toBeGreaterThan(0.5);
		expect(dist).toBeLessThan(1.5);
	});

	it('works for southern hemisphere coordinates', () => {
		const dist = haversineDistanceM(-33.87, 151.21, -33.86, 151.21);
		expect(dist).toBeGreaterThan(1000);
		expect(dist).toBeLessThan(1200);
	});
});

describe('pointToLineSegmentDistanceM', () => {
	it('returns ~0 for a point on the segment', () => {
		const midLat = (KLEPPSMYRARVEGUR_A.lat + KLEPPSMYRARVEGUR_B.lat) / 2;
		const midLng = (KLEPPSMYRARVEGUR_A.lng + KLEPPSMYRARVEGUR_B.lng) / 2;
		const dist = pointToLineSegmentDistanceM(
			midLat, midLng,
			KLEPPSMYRARVEGUR_A.lat, KLEPPSMYRARVEGUR_A.lng,
			KLEPPSMYRARVEGUR_B.lat, KLEPPSMYRARVEGUR_B.lng,
		);
		expect(dist).toBeLessThan(1);
	});

	it('returns distance to endpoint A when closest', () => {
		// Point south of A — closest is A
		const dist = pointToLineSegmentDistanceM(
			KLEPPSMYRARVEGUR_A.lat - 0.001, KLEPPSMYRARVEGUR_A.lng,
			KLEPPSMYRARVEGUR_A.lat, KLEPPSMYRARVEGUR_A.lng,
			KLEPPSMYRARVEGUR_B.lat, KLEPPSMYRARVEGUR_B.lng,
		);
		const directDist = haversineDistanceM(
			KLEPPSMYRARVEGUR_A.lat - 0.001, KLEPPSMYRARVEGUR_A.lng,
			KLEPPSMYRARVEGUR_A.lat, KLEPPSMYRARVEGUR_A.lng,
		);
		expect(dist).toBeCloseTo(directDist, 0);
	});

	it('returns distance to endpoint B when closest', () => {
		const dist = pointToLineSegmentDistanceM(
			KLEPPSMYRARVEGUR_B.lat + 0.001, KLEPPSMYRARVEGUR_B.lng,
			KLEPPSMYRARVEGUR_A.lat, KLEPPSMYRARVEGUR_A.lng,
			KLEPPSMYRARVEGUR_B.lat, KLEPPSMYRARVEGUR_B.lng,
		);
		const directDist = haversineDistanceM(
			KLEPPSMYRARVEGUR_B.lat + 0.001, KLEPPSMYRARVEGUR_B.lng,
			KLEPPSMYRARVEGUR_B.lat, KLEPPSMYRARVEGUR_B.lng,
		);
		expect(dist).toBeCloseTo(directDist, 0);
	});

	it('handles perpendicular projection onto midpoint', () => {
		// Segment going north, point offset east
		const aLat = 64.14, aLng = -21.93;
		const bLat = 64.15, bLng = -21.93;
		const pLat = 64.145, pLng = -21.929; // east of midpoint
		const dist = pointToLineSegmentDistanceM(pLat, pLng, aLat, aLng, bLat, bLng);
		// 0.001 deg lng at 64N ≈ 48.6m
		expect(dist).toBeGreaterThan(30);
		expect(dist).toBeLessThan(60);
	});

	it('handles degenerate (zero-length) segment', () => {
		const dist = pointToLineSegmentDistanceM(
			64.14, -21.93,
			64.15, -21.94,
			64.15, -21.94,
		);
		const directDist = haversineDistanceM(64.14, -21.93, 64.15, -21.94);
		expect(dist).toBeCloseTo(directDist, 0);
	});

	it('returns reasonable distance for a point near Kleppsmyrarvegur', () => {
		// Offset perpendicular to segment: compute normal direction in meters
		const dLat = KLEPPSMYRARVEGUR_B.lat - KLEPPSMYRARVEGUR_A.lat;
		const dLng = KLEPPSMYRARVEGUR_B.lng - KLEPPSMYRARVEGUR_A.lng;
		// Normal direction in meter space (rotate 90 degrees)
		const nY = dLng * 48_600; // dx in meters
		const nX = -(dLat * 111_000); // -dy in meters
		const nLen = Math.hypot(nX, nY);
		const midLat = (KLEPPSMYRARVEGUR_A.lat + KLEPPSMYRARVEGUR_B.lat) / 2;
		const midLng = (KLEPPSMYRARVEGUR_A.lng + KLEPPSMYRARVEGUR_B.lng) / 2;
		// Offset 20m in the perpendicular direction
		const pLat = midLat + (nX / nLen) * 20 / 111_000;
		const pLng = midLng + (nY / nLen) * 20 / 48_600;
		const dist = pointToLineSegmentDistanceM(
			pLat, pLng,
			KLEPPSMYRARVEGUR_A.lat, KLEPPSMYRARVEGUR_A.lng,
			KLEPPSMYRARVEGUR_B.lat, KLEPPSMYRARVEGUR_B.lng,
		);
		expect(dist).toBeGreaterThan(15);
		expect(dist).toBeLessThan(25);
	});
});

describe('projectPointOnSegment', () => {
	const aLat = 64.14, aLng = -21.93;
	const bLat = 64.15, bLng = -21.93;

	it('returns t ≈ 0 for point closest to A', () => {
		const result = projectPointOnSegment(aLat - 0.001, aLng, aLat, aLng, bLat, bLng);
		expect(result.t).toBe(0);
	});

	it('returns t ≈ 1 for point closest to B', () => {
		const result = projectPointOnSegment(bLat + 0.001, bLng, aLat, aLng, bLat, bLng);
		expect(result.t).toBe(1);
	});

	it('returns t ≈ 0.5 for point perpendicular to midpoint', () => {
		const result = projectPointOnSegment(64.145, -21.929, aLat, aLng, bLat, bLng);
		expect(result.t).toBeCloseTo(0.5, 1);
	});

	it('clamps t beyond endpoints', () => {
		const before = projectPointOnSegment(aLat - 0.01, aLng, aLat, aLng, bLat, bLng);
		const after = projectPointOnSegment(bLat + 0.01, bLng, aLat, aLng, bLat, bLng);
		expect(before.t).toBe(0);
		expect(after.t).toBe(1);
	});

	it('projected coords lie on the segment', () => {
		const result = projectPointOnSegment(64.145, -21.929, aLat, aLng, bLat, bLng);
		// projLng should be ~aLng since segment is vertical
		expect(result.projLng).toBeCloseTo(aLng, 3);
		expect(result.projLat).toBeGreaterThanOrEqual(aLat);
		expect(result.projLat).toBeLessThanOrEqual(bLat);
	});

	it('distanceM matches pointToLineSegmentDistanceM', () => {
		const pLat = 64.145, pLng = -21.929;
		const proj = projectPointOnSegment(pLat, pLng, aLat, aLng, bLat, bLng);
		const direct = pointToLineSegmentDistanceM(pLat, pLng, aLat, aLng, bLat, bLng);
		expect(proj.distanceM).toBeCloseTo(direct, 5);
	});

	it('handles degenerate segment (A === B)', () => {
		const result = projectPointOnSegment(64.145, -21.929, 64.14, -21.93, 64.14, -21.93);
		expect(result.t).toBe(0);
	});
});

describe('flatDistanceM', () => {
	it('returns 0 for the same point', () => {
		expect(flatDistanceM(64.14, -21.93, 64.14, -21.93)).toBe(0);
	});

	it('agrees with Haversine within 1% for short distances', () => {
		const lat2 = 64.14 + 0.005; // ~555m north
		const flat = flatDistanceM(64.14, -21.93, lat2, -21.93);
		const hav = haversineDistanceM(64.14, -21.93, lat2, -21.93);
		const diff = Math.abs(flat - hav) / hav;
		expect(diff).toBeLessThan(0.01);
	});

	it('verifies 1 degree lat ≈ 111km', () => {
		const dist = flatDistanceM(64.0, -21.93, 65.0, -21.93);
		expect(dist).toBeCloseTo(111_000, -3); // within 1km
	});

	it('verifies 1 degree lng ≈ 48.6km at 64N', () => {
		const dist = flatDistanceM(64.14, -22.0, 64.14, -21.0);
		expect(dist).toBeCloseTo(48_600, -3); // within 1km
	});
});

describe('speedKmh', () => {
	it('returns 0 for zero time delta', () => {
		expect(speedKmh(100, 0)).toBe(0);
	});

	it('returns 0 for negative time delta', () => {
		expect(speedKmh(100, -1)).toBe(0);
	});

	it('converts 1000m in 60s to 60 km/h', () => {
		expect(speedKmh(1000, 60)).toBeCloseTo(60, 5);
	});

	it('converts 1m in 1s to 3.6 km/h', () => {
		expect(speedKmh(1, 1)).toBeCloseTo(3.6, 5);
	});

	it('converts 100km in 1 hour to 100 km/h', () => {
		expect(speedKmh(100_000, 3600)).toBeCloseTo(100, 5);
	});
});
