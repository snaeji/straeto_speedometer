import { describe, it, expect } from 'vitest';
import './setup';
import { getBusStatus, getStatusColor, type BusStatus } from '$lib/stores/buses.svelte';
import { makeBusLocation } from '../../fixtures';

describe('getBusStatus', () => {
	it('returns nodata when speedKmh is null', () => {
		expect(getBusStatus(makeBusLocation({ speedKmh: undefined, speedLimitKmh: 50 }))).toBe('nodata');
	});

	it('returns nodata when speedLimitKmh is null', () => {
		expect(getBusStatus(makeBusLocation({ speedKmh: 45, speedLimitKmh: undefined }))).toBe('nodata');
	});

	it('returns violation when isViolation is true', () => {
		expect(getBusStatus(makeBusLocation({
			speedKmh: 60, speedLimitKmh: 50, isViolation: true,
		}))).toBe('violation');
	});

	it('returns approaching when speed > limit but not violation', () => {
		// 0-5 km/h over limit (grace zone, isViolation=false but speed > limit)
		expect(getBusStatus(makeBusLocation({
			speedKmh: 52, speedLimitKmh: 50, isViolation: false,
		}))).toBe('approaching');
	});

	it('returns normal when speed <= limit', () => {
		expect(getBusStatus(makeBusLocation({
			speedKmh: 45, speedLimitKmh: 50, isViolation: false,
		}))).toBe('normal');
	});
});

describe('getStatusColor', () => {
	it('returns correct hex for each status', () => {
		const expected: Record<BusStatus, string> = {
			violation: '#ef4444',
			approaching: '#f59e0b',
			normal: '#10b981',
			nodata: '#6b7280',
		};
		for (const [status, color] of Object.entries(expected)) {
			expect(getStatusColor(status as BusStatus)).toBe(color);
		}
	});
});
