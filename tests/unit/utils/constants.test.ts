import { describe, it, expect } from 'vitest';
import {
	POLLING_INTERVAL_MS,
	OUTLIER_MAX_SPEED_KMH,
	CONSERVATIVE_SPEED_FACTOR,
	DEFAULT_SPEED_LIMIT_KMH,
	MAX_SPEED_LIMIT_SEARCH_DISTANCE_M,
	VIOLATION_GRACE_KMH,
	MAP_CENTER,
	ALL_ROUTES,
} from '$lib/utils/constants';

describe('constants sanity checks', () => {
	it('POLLING_INTERVAL_MS is 2000', () => {
		expect(POLLING_INTERVAL_MS).toBe(2000);
	});

	it('OUTLIER_MAX_SPEED_KMH is 90', () => {
		expect(OUTLIER_MAX_SPEED_KMH).toBe(90);
	});

	it('CONSERVATIVE_SPEED_FACTOR is 0.95 (accounts for server corner-cutting only)', () => {
		expect(CONSERVATIVE_SPEED_FACTOR).toBe(0.95);
	});

	it('DEFAULT_SPEED_LIMIT_KMH is 50', () => {
		expect(DEFAULT_SPEED_LIMIT_KMH).toBe(50);
	});

	it('MAX_SPEED_LIMIT_SEARCH_DISTANCE_M is 50', () => {
		expect(MAX_SPEED_LIMIT_SEARCH_DISTANCE_M).toBe(50);
	});

	it('VIOLATION_GRACE_KMH is 5', () => {
		expect(VIOLATION_GRACE_KMH).toBe(5);
	});

	it('MAP_CENTER is centered on Reykjavik', () => {
		expect(MAP_CENTER).toEqual([-21.9, 64.135]);
	});

	it('ALL_ROUTES has 32 entries and includes routes 1 through 36', () => {
		expect(ALL_ROUTES).toHaveLength(32);
		expect(ALL_ROUTES).toContain('1');
		expect(ALL_ROUTES).toContain('36');
		expect(ALL_ROUTES).toContain('14');
	});
});
