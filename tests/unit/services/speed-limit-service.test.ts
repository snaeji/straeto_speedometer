import { describe, it, expect, beforeEach } from 'vitest';
import { SpeedLimitService } from '$lib/services/speed-limit-service';
import { DEFAULT_SPEED_LIMIT_KMH, MAX_SPEED_LIMIT_SEARCH_DISTANCE_M } from '$lib/utils/constants';
import { makeSpeedLimitGeoJson, KLEPPSMYRARVEGUR_A, KLEPPSMYRARVEGUR_B } from '../../fixtures';

function makeService(...segments: Parameters<typeof makeSpeedLimitGeoJson>[0]) {
	const svc = new SpeedLimitService();
	svc.loadFromGeoJson(makeSpeedLimitGeoJson(segments) as Parameters<typeof svc.loadFromGeoJson>[0]);
	return svc;
}

describe('SpeedLimitService', () => {
	describe('loading', () => {
		it('isLoaded is false before loading', () => {
			const svc = new SpeedLimitService();
			expect(svc.isLoaded).toBe(false);
		});

		it('isLoaded is true after loading', () => {
			const svc = makeService({
				coords: [[KLEPPSMYRARVEGUR_A.lng, KLEPPSMYRARVEGUR_A.lat], [KLEPPSMYRARVEGUR_B.lng, KLEPPSMYRARVEGUR_B.lat]],
				hradi: 30,
			});
			expect(svc.isLoaded).toBe(true);
		});

		it('segmentCount matches expected edge count', () => {
			const svc = makeService(
				{ coords: [[-21.93, 64.14], [-21.92, 64.14]], hradi: 50 },
				{ coords: [[-21.93, 64.15], [-21.92, 64.15], [-21.91, 64.15]], hradi: 30 },
			);
			// First segment: 1 edge. Second segment: 2 edges (3 coords - 1).
			expect(svc.segmentCount).toBe(3);
		});

		it('filters out features with GOTUFLOKKUR === 5', () => {
			const svc = makeService(
				{ coords: [[-21.93, 64.14], [-21.92, 64.14]], hradi: 50 },
				{ coords: [[-21.93, 64.15], [-21.92, 64.15]], hradi: 30, gotuflokkur: 5 },
			);
			expect(svc.segmentCount).toBe(1);
		});

		it('filters out features with HRADI <= 0 or non-numeric', () => {
			const geoJson = {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature', id: 1,
						geometry: { type: 'LineString', coordinates: [[-21.93, 64.14], [-21.92, 64.14]] },
						properties: { OBJECTID: 1, HRADI: 0, NAFN: 'zero', GOTUFLOKKUR: 2 },
					},
					{
						type: 'Feature', id: 2,
						geometry: { type: 'LineString', coordinates: [[-21.93, 64.15], [-21.92, 64.15]] },
						properties: { OBJECTID: 2, HRADI: 'none', NAFN: 'text', GOTUFLOKKUR: 2 },
					},
					{
						type: 'Feature', id: 3,
						geometry: { type: 'LineString', coordinates: [[-21.93, 64.16], [-21.92, 64.16]] },
						properties: { OBJECTID: 3, HRADI: 50, NAFN: 'valid', GOTUFLOKKUR: 2 },
					},
				],
			};
			const svc = new SpeedLimitService();
			svc.loadFromGeoJson(geoJson as Parameters<typeof svc.loadFromGeoJson>[0]);
			expect(svc.segmentCount).toBe(1);
		});
	});

	describe('getSpeedLimit', () => {
		let svc: SpeedLimitService;

		beforeEach(() => {
			// Two parallel streets:
			// Street A (30 km/h) at lat 64.14, lng -21.93 to -21.92
			// Street B (50 km/h) at lat 64.145, lng -21.93 to -21.92
			svc = makeService(
				{ coords: [[-21.93, 64.14], [-21.92, 64.14]], hradi: 30, name: 'Street A' },
				{ coords: [[-21.93, 64.145], [-21.92, 64.145]], hradi: 50, name: 'Street B' },
			);
		});

		it('returns matched for a point close to a segment', () => {
			// 5m north of Street A
			const result = svc.getSpeedLimit(64.14 + 5 / 111_000, -21.925);
			expect(result.match).toBe('matched');
			expect(result.speedLimitKmh).toBe(30);
		});

		it('returns closest segment when between two streets', () => {
			// 20m north of Street A (well within 50m), closer to A than B
			const result = svc.getSpeedLimit(64.14 + 20 / 111_000, -21.925);
			expect(result.speedLimitKmh).toBe(30);
		});

		it('returns fallback for a point far from all segments', () => {
			const result = svc.getSpeedLimit(64.2, -21.925);
			expect(result.match).toBe('fallback');
			expect(result.speedLimitKmh).toBe(DEFAULT_SPEED_LIMIT_KMH);
		});

		it('returns matched at boundary distance (<=50m)', () => {
			const offset = (MAX_SPEED_LIMIT_SEARCH_DISTANCE_M - 1) / 111_000;
			const result = svc.getSpeedLimit(64.14 + offset, -21.925);
			expect(result.match).toBe('matched');
		});

		it('returns fallback beyond boundary distance', () => {
			// Point between both streets where closest is > 50m
			// Streets at 64.14 and 64.145 — midpoint 64.1425 is ~278m from each
			const result = svc.getSpeedLimit(64.1425, -21.925);
			expect(result.match).toBe('fallback');
		});

		it('returns roadName from matched segment', () => {
			const result = svc.getSpeedLimit(64.14, -21.925);
			expect(result.roadName).toBe('Street A');
		});

		it('handles MultiLineString geometry', () => {
			const geoJson = {
				type: 'FeatureCollection',
				features: [{
					type: 'Feature', id: 1,
					geometry: {
						type: 'MultiLineString',
						coordinates: [
							[[-21.93, 64.14], [-21.92, 64.14]],
							[[-21.92, 64.14], [-21.91, 64.14]],
						],
					},
					properties: { OBJECTID: 1, HRADI: 40, NAFN: 'Multi', GOTUFLOKKUR: 2 },
				}],
			};
			const multiSvc = new SpeedLimitService();
			multiSvc.loadFromGeoJson(geoJson as Parameters<typeof multiSvc.loadFromGeoJson>[0]);
			expect(multiSvc.segmentCount).toBe(2);
			const result = multiSvc.getSpeedLimit(64.14, -21.915);
			expect(result.speedLimitKmh).toBe(40);
			expect(result.match).toBe('matched');
		});
	});

	describe('spatial grid', () => {
		it('returns fallback for ocean coordinates', () => {
			const svc = makeService(
				{ coords: [[-21.93, 64.14], [-21.92, 64.14]], hradi: 30 },
			);
			const result = svc.getSpeedLimit(63.0, -23.0);
			expect(result.match).toBe('fallback');
		});

		it('finds segments in different grid cells', () => {
			const svc = makeService(
				{ coords: [[-21.93, 64.14], [-21.92, 64.14]], hradi: 30, name: 'A' },
				{ coords: [[-21.80, 64.20], [-21.79, 64.20]], hradi: 60, name: 'B' },
			);
			const resA = svc.getSpeedLimit(64.14, -21.925);
			expect(resA.speedLimitKmh).toBe(30);

			const resB = svc.getSpeedLimit(64.20, -21.795);
			expect(resB.speedLimitKmh).toBe(60);
		});
	});
});
