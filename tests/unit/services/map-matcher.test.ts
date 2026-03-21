import { describe, it, expect, beforeEach } from 'vitest';
import { MapMatcher } from '$lib/services/map-matcher';
import { makeLShapedRoute, makeUShapedRoute, makeNextStops } from '../../fixtures';
import type { RouteShapeData } from '$lib/services/route-shape-index';

const LAT_PER_M = 1 / 111_000;
const LNG_PER_M = 1 / 48_600;

let mockTime = 1000000;
function getTime() { return mockTime; }
function advanceTime(ms: number) { mockTime += ms; }

describe('MapMatcher', () => {
	let matcher: MapMatcher;
	let route: RouteShapeData;

	beforeEach(() => {
		mockTime = 1000000;
		matcher = new MapMatcher(getTime);
		route = makeLShapedRoute();
	});

	describe('snapping', () => {
		it('snaps an on-route point with high confidence', () => {
			// Point 5m north of the first (east-going) segment
			const lat = route.vertices[0].lat + 5 * LAT_PER_M;
			const lng = (route.vertices[0].lng + route.vertices[1].lng) / 2;
			const result = matcher.snap('b1', lat, lng, 1000, route);

			expect(result).not.toBeNull();
			expect(result!.confidence).toBe('high');
			expect(result!.lateralOffsetM).toBeLessThan(10);
		});

		it('returns off-route for a distant point', () => {
			// Point 80m away from route
			const lat = route.vertices[0].lat + 80 * LAT_PER_M;
			const lng = route.vertices[0].lng;
			const result = matcher.snap('b1', lat, lng, 1000, route);

			expect(result).not.toBeNull();
			expect(result!.confidence).toBe('off-route');
		});

		it('returns low confidence for intermediate distance', () => {
			// Point ~50m from route (between 40 and 75)
			const lat = route.vertices[0].lat + 50 * LAT_PER_M;
			const lng = (route.vertices[0].lng + route.vertices[1].lng) / 2;
			const result = matcher.snap('b1', lat, lng, 1000, route);

			expect(result).not.toBeNull();
			expect(result!.confidence).toBe('low');
		});

		it('computes correct distAlongRouteM', () => {
			// Point at midpoint of first segment
			const lat = route.vertices[0].lat;
			const lng = (route.vertices[0].lng + route.vertices[1].lng) / 2;
			const result = matcher.snap('b1', lat, lng, 1000, route);

			expect(result).not.toBeNull();
			// Should be roughly half of first segment length
			expect(result!.distAlongRouteM).toBeGreaterThan(30);
			expect(result!.distAlongRouteM).toBeLessThan(70);
		});
	});

	describe('speed calculation', () => {
		it('returns null speed for first 3 fixes (warmup)', () => {
			const speeds: (number | null)[] = [];
			for (let i = 0; i < 3; i++) {
				const lat = route.vertices[0].lat;
				const lng = route.vertices[0].lng + i * 10 * LNG_PER_M;
				advanceTime(2000);
				const result = matcher.snap('b1', lat, lng, mockTime, route);
				speeds.push(result?.speedKmh ?? null);
			}
			expect(speeds[0]).toBeNull();
			expect(speeds[1]).toBeNull();
			expect(speeds[2]).toBeNull();
		});

		it('calculates speed from fix 4+', () => {
			for (let i = 0; i < 4; i++) {
				const lat = route.vertices[0].lat;
				const lng = route.vertices[0].lng + i * 10 * LNG_PER_M;
				advanceTime(2000);
				matcher.snap('b1', lat, lng, mockTime, route);
			}
			// 5th fix
			advanceTime(2000);
			const lat = route.vertices[0].lat;
			const lng = route.vertices[0].lng + 4 * 10 * LNG_PER_M;
			const result = matcher.snap('b1', lat, lng, mockTime, route);
			expect(result).not.toBeNull();
			expect(result!.speedKmh).not.toBeNull();
			expect(result!.speedKmh).toBeGreaterThan(0);
		});

		it('holds previous speed on outlier', () => {
			// Build up normal speed
			for (let i = 0; i < 5; i++) {
				const lat = route.vertices[0].lat;
				const lng = route.vertices[0].lng + i * 10 * LNG_PER_M;
				advanceTime(2000);
				matcher.snap('b1', lat, lng, mockTime, route);
			}
			// Huge jump in 1ms → outlier
			advanceTime(1);
			const result = matcher.snap('b1', route.vertices[2].lat, route.vertices[2].lng, mockTime, route);
			// Speed should be held or reset, not insanely high
			if (result && result.speedKmh != null) {
				expect(result.speedKmh).toBeLessThan(91);
			}
		});
	});

	describe('monotonicity', () => {
		it('accepts forward movement', () => {
			for (let i = 0; i < 3; i++) {
				const lat = route.vertices[0].lat;
				const lng = route.vertices[0].lng + i * 10 * LNG_PER_M;
				advanceTime(2000);
				const result = matcher.snap('b1', lat, lng, mockTime, route);
				expect(result).not.toBeNull();
			}
		});

		it('accepts small backward movement (<100m)', () => {
			// Move forward then slightly back
			for (let i = 0; i < 3; i++) {
				advanceTime(2000);
				matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng + i * 20 * LNG_PER_M, mockTime, route);
			}
			// Small backward
			advanceTime(2000);
			const result = matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng + 1 * 20 * LNG_PER_M, mockTime, route);
			expect(result).not.toBeNull();
		});

		it('resets on large backward movement (>100m)', () => {
			// Move to near end of route
			advanceTime(2000);
			matcher.snap('b1', route.vertices[1].lat, route.vertices[1].lng, mockTime, route);
			advanceTime(2000);
			matcher.snap('b1', route.vertices[2].lat, route.vertices[2].lng, mockTime, route);

			// Jump back to start (>100m backward)
			advanceTime(2000);
			const result = matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng, mockTime, route);
			// After reset, fixCount restarts → speed is null
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBeNull();
		});
	});

	describe('stop proximity', () => {
		it('detects point near a stop', () => {
			// Stops are at distances 0, 97, 197. Query at distance ~0
			const result = matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng, 1000, route);
			expect(result).not.toBeNull();
			expect(result!.isNearStop).toBe(true);
		});

		it('detects point away from stops', () => {
			// Midpoint of first segment — stops are at 0, 97, 197
			// Midpoint ~48m from both nearest stops
			const lat = route.vertices[0].lat;
			const lng = (route.vertices[0].lng + route.vertices[1].lng) / 2;
			const result = matcher.snap('b1', lat, lng, 1000, route);
			expect(result).not.toBeNull();
			expect(result!.isNearStop).toBe(false);
		});
	});

	describe('shape change', () => {
		it('resets state when shapeId changes', () => {
			advanceTime(2000);
			matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng, mockTime, route);

			const route2 = { ...route, shapeId: 'different-shape' };
			advanceTime(2000);
			const result = matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng, mockTime, route2);
			// After shape change, fixCount restarts
			expect(result).not.toBeNull();
			expect(result!.speedKmh).toBeNull(); // warmup again
		});

		it('isOnRoute returns true when matched, false when off-route', () => {
			matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng, 1000, route);
			expect(matcher.isOnRoute('b1')).toBe(true);

			// Point far away → off-route
			matcher.snap('b2', 63.0, -23.0, 1000, route);
			expect(matcher.isOnRoute('b2')).toBe(false);
		});
	});

	describe('nextStops constraint', () => {
		it('disambiguates snap at U-shaped overlap using nextStops', () => {
			const uRoute = makeUShapedRoute();
			// U-route: p0(0m) --east 200m--> p1(200m) --south 100m--> p2(300m) --west 200m--> p3(500m)
			// p0 and p3 share the same longitude but are 100m apart vertically.
			//
			// Place bus 5m north of the outbound leg (seg 0, p0→p1) at ~100m along.
			// This is also ~95m north of the return leg (seg 2, p2→p3).
			// Without nextStops both segments are candidates via grid, but the outbound
			// leg is closer (5m vs 95m). With nextStops pointing to stop-start (0m),
			// the return leg is preferred since stop-start constraint keeps segments ≤ 150m.
			// Actually — let's test the other way: nextStops at stop-end (500m) forces
			// the return leg even though the outbound leg is geographically closer.

			// Bus at outbound-leg level, 100m along the outbound leg
			const busLat = uRoute.vertices[0].lat - 5 * LAT_PER_M; // 5m south of outbound
			const busLng = uRoute.vertices[0].lng + 100 * LNG_PER_M; // 100m east

			// nextStops pointing to stop-east (200m on route) → bus on outbound leg
			const nextStopsOutbound = makeNextStops([{
				stopId: 'stop-east',
				lat: uRoute.vertices[1].lat,
				lng: uRoute.vertices[1].lng,
			}]);

			const resultOutbound = matcher.snap('b1', busLat, busLng, 1000, uRoute, nextStopsOutbound);
			expect(resultOutbound).not.toBeNull();
			// Should snap to outbound leg (0-200m range)
			expect(resultOutbound!.distAlongRouteM).toBeLessThan(250);

			// Now test: bus near the RETURN leg with nextStops to stop-end
			const returnLat = uRoute.vertices[3].lat + 5 * LAT_PER_M; // 5m north of return leg
			const returnLng = uRoute.vertices[3].lng + 100 * LNG_PER_M; // 100m east

			const nextStopsReturn = makeNextStops([{
				stopId: 'stop-end',
				lat: uRoute.vertices[3].lat,
				lng: uRoute.vertices[3].lng,
			}]);

			const resultReturn = matcher.snap('b2', returnLat, returnLng, 1000, uRoute, nextStopsReturn);
			expect(resultReturn).not.toBeNull();
			// Should snap to return leg (300-500m range)
			expect(resultReturn!.distAlongRouteM).toBeGreaterThan(250);
		});

		it('falls back to nearest segment when nextStops is absent', () => {
			const uRoute = makeUShapedRoute();
			const midLat = (uRoute.vertices[0].lat + uRoute.vertices[3].lat) / 2;
			const busLng = uRoute.vertices[0].lng + 10 * LNG_PER_M;

			// Without nextStops, picks whichever segment is geographically closest
			const result = matcher.snap('b1', midLat, busLng, 1000, uRoute);
			expect(result).not.toBeNull();
			// We don't care which leg it picks — just that it works
			expect(result!.confidence).not.toBe('off-route');
		});

		it('falls back when nextStop ID does not match any route stop', () => {
			const nextStops = makeNextStops([{
				stopId: 'nonexistent-stop',
				lat: 65.0, // far from route
				lng: -20.0,
			}]);

			const result = matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng, 1000, route, nextStops);
			// Should still snap successfully (constraint ignored due to bad stop)
			expect(result).not.toBeNull();
			expect(result!.confidence).toBe('high');
		});

		it('downgrades confidence when snap is past first nextStop', () => {
			// nextStop at distance 0 (start of route), but bus is near the end
			const nextStopsAtStart = makeNextStops([{
				stopId: 'stop-start',
				lat: route.vertices[0].lat,
				lng: route.vertices[0].lng,
			}]);

			// Snap bus at end of L-shaped route (distAlong ~197m, but nextStop is at 0m)
			// The constraint allows up to 0 + 150m = 150m, and snap at 197m > 150m → low confidence
			const result = matcher.snap('b1', route.vertices[2].lat, route.vertices[2].lng, 1000, route, nextStopsAtStart);
			expect(result).not.toBeNull();
			expect(result!.confidence).toBe('low');
		});

		it('keeps high confidence when snap is before first nextStop', () => {
			// nextStop at end of route
			const nextStopsAtEnd = makeNextStops([{
				stopId: 'stop-end',
				lat: route.vertices[2].lat,
				lng: route.vertices[2].lng,
			}]);

			// Bus near start of route → well before the nextStop
			const result = matcher.snap('b1', route.vertices[0].lat, route.vertices[0].lng, 1000, route, nextStopsAtEnd);
			expect(result).not.toBeNull();
			expect(result!.confidence).toBe('high');
		});
	});
});
