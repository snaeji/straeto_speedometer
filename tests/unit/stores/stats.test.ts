import { describe, it, expect } from 'vitest';
import { makeBusLocation } from '../../fixtures';
import type { BusLocation } from '$lib/types/bus';

// Since StatsStore uses $state (Svelte 5 rune), we can't instantiate it in Node.
// Instead, we replicate the computeFromArray logic in a pure function to test it.
// This tests the actual algorithm without rune dependency.

interface ComputeResult {
	topSpeeders: Array<{ busId: string; routeNr: string; maxSpeed: number; violations: number }>;
	routeStats: Array<{ routeNr: string; violations: number; avgSpeed: number; records: number }>;
	violationsByHour: Array<{ hour: number; count: number }>;
	speedDistribution: Array<{ range: string; count: number }>;
	totalDistanceKm: number;
	totalBusesTracked: number;
	totalRecords: number;
	totalViolations: number;
}

function computeFromArray(locations: BusLocation[]): ComputeResult {
	const busStats = new Map<string, { routeNr: string; maxSpeed: number; violations: number }>();
	const routeAgg = new Map<string, { totalSpeed: number; count: number; violations: number }>();
	const hourlyViolations = new Array(24).fill(0);
	const speedBuckets = new Array(10).fill(0);
	const uniqueBuses = new Set<string>();
	let totalDist = 0;
	let totalRecs = 0;
	let totalViol = 0;
	const prevByBus = new Map<string, BusLocation>();

	for (const loc of locations) {
		totalRecs++;
		uniqueBuses.add(loc.busId);

		const prev = prevByBus.get(loc.busId);
		if (prev && loc.speedKmh != null && loc.speedKmh > 0) {
			const timeDeltaH = (loc.timestamp - prev.timestamp) / 3_600_000;
			if (timeDeltaH > 0 && timeDeltaH < 0.5) {
				totalDist += loc.speedKmh * timeDeltaH;
			}
		}
		prevByBus.set(loc.busId, loc);

		const bStat = busStats.get(loc.busId) ?? { routeNr: loc.routeNr, maxSpeed: 0, violations: 0 };
		if (loc.speedKmh != null && loc.speedKmh > bStat.maxSpeed) bStat.maxSpeed = loc.speedKmh;
		if (loc.isViolation) { bStat.violations++; totalViol++; hourlyViolations[new Date(loc.timestamp).getUTCHours()]++; }
		busStats.set(loc.busId, bStat);

		const rStat = routeAgg.get(loc.routeNr) ?? { totalSpeed: 0, count: 0, violations: 0 };
		if (loc.speedKmh != null && loc.speedKmh > 0) { rStat.totalSpeed += loc.speedKmh; rStat.count++; }
		if (loc.isViolation) rStat.violations++;
		routeAgg.set(loc.routeNr, rStat);

		if (loc.speedKmh != null) {
			const idx = loc.speedKmh === 0 ? 0 : Math.min(9, Math.ceil(loc.speedKmh / 10));
			speedBuckets[idx]++;
		}
	}

	const topSpeeders = Array.from(busStats.entries())
		.map(([busId, s]) => ({ busId, routeNr: s.routeNr, maxSpeed: Math.round(s.maxSpeed * 10) / 10, violations: s.violations }))
		.sort((a, b) => b.violations - a.violations || b.maxSpeed - a.maxSpeed)
		.slice(0, 10);

	const routeStats = Array.from(routeAgg.entries())
		.map(([routeNr, s]) => ({ routeNr, violations: s.violations, avgSpeed: s.count > 0 ? Math.round((s.totalSpeed / s.count) * 10) / 10 : 0, records: s.count }))
		.sort((a, b) => b.violations - a.violations);

	const violationsByHour = hourlyViolations.map((count: number, hour: number) => ({ hour, count }));

	const bucketLabels = ['0', '1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81+'];
	const speedDistribution = speedBuckets.map((count: number, i: number) => ({ range: bucketLabels[i], count }));

	return {
		topSpeeders,
		routeStats,
		violationsByHour,
		speedDistribution,
		totalDistanceKm: Math.round(totalDist * 10) / 10,
		totalBusesTracked: uniqueBuses.size,
		totalRecords: totalRecs,
		totalViolations: totalViol,
	};
}

describe('stats computeFromArray', () => {
	it('handles empty array', () => {
		const result = computeFromArray([]);
		expect(result.totalRecords).toBe(0);
		expect(result.totalBusesTracked).toBe(0);
		expect(result.totalViolations).toBe(0);
		expect(result.topSpeeders).toEqual([]);
		expect(result.routeStats).toEqual([]);
	});

	it('handles single record', () => {
		const result = computeFromArray([
			makeBusLocation({ busId: 'b1', speedKmh: 45, routeNr: '1' }),
		]);
		expect(result.totalRecords).toBe(1);
		expect(result.totalBusesTracked).toBe(1);
	});

	it('top speeders sorted by violations desc then maxSpeed desc', () => {
		const locs = [
			makeBusLocation({ busId: 'b1', speedKmh: 80, isViolation: true, routeNr: '1', timestamp: 1000 }),
			makeBusLocation({ busId: 'b1', speedKmh: 70, isViolation: true, routeNr: '1', timestamp: 2000 }),
			makeBusLocation({ busId: 'b2', speedKmh: 90, isViolation: true, routeNr: '2', timestamp: 1000 }),
			makeBusLocation({ busId: 'b3', speedKmh: 60, isViolation: false, routeNr: '3', timestamp: 1000 }),
		];
		const result = computeFromArray(locs);
		expect(result.topSpeeders[0].busId).toBe('b1'); // 2 violations
		expect(result.topSpeeders[1].busId).toBe('b2'); // 1 violation, 90 max
		expect(result.topSpeeders).toHaveLength(3);
	});

	it('top speeders limited to 10', () => {
		const locs: BusLocation[] = [];
		for (let i = 0; i < 15; i++) {
			locs.push(makeBusLocation({
				busId: `b${i}`, speedKmh: 50 + i, isViolation: true, routeNr: '1', timestamp: i * 1000,
			}));
		}
		const result = computeFromArray(locs);
		expect(result.topSpeeders).toHaveLength(10);
	});

	it('route stats computes violations, avg speed, records per route', () => {
		const locs = [
			makeBusLocation({ busId: 'b1', routeNr: '1', speedKmh: 40, timestamp: 1000 }),
			makeBusLocation({ busId: 'b2', routeNr: '1', speedKmh: 60, isViolation: true, timestamp: 2000 }),
			makeBusLocation({ busId: 'b3', routeNr: '5', speedKmh: 30, timestamp: 1000 }),
		];
		const result = computeFromArray(locs);

		const route1 = result.routeStats.find((r) => r.routeNr === '1');
		expect(route1).toBeDefined();
		expect(route1!.violations).toBe(1);
		expect(route1!.avgSpeed).toBe(50); // (40+60)/2
		expect(route1!.records).toBe(2);

		const route5 = result.routeStats.find((r) => r.routeNr === '5');
		expect(route5!.violations).toBe(0);
	});

	it('hourly violations bucketed correctly', () => {
		// Timestamp for 14:00 UTC
		const ts14 = new Date('2024-01-15T14:30:00Z').getTime();
		const ts02 = new Date('2024-01-15T02:15:00Z').getTime();
		const locs = [
			makeBusLocation({ busId: 'b1', isViolation: true, timestamp: ts14 }),
			makeBusLocation({ busId: 'b2', isViolation: true, timestamp: ts14 }),
			makeBusLocation({ busId: 'b3', isViolation: true, timestamp: ts02 }),
		];
		const result = computeFromArray(locs);
		expect(result.violationsByHour[14].count).toBe(2);
		expect(result.violationsByHour[2].count).toBe(1);
	});

	it('speed distribution bucketed correctly', () => {
		const locs = [
			makeBusLocation({ busId: 'b1', speedKmh: 0, timestamp: 1000 }),
			makeBusLocation({ busId: 'b2', speedKmh: 5, timestamp: 1000 }),
			makeBusLocation({ busId: 'b3', speedKmh: 15, timestamp: 1000 }),
			makeBusLocation({ busId: 'b4', speedKmh: 45, timestamp: 1000 }),
			makeBusLocation({ busId: 'b5', speedKmh: 85, timestamp: 1000 }),
		];
		const result = computeFromArray(locs);
		expect(result.speedDistribution[0].count).toBe(1); // 0
		expect(result.speedDistribution[1].count).toBe(1); // 1-10
		expect(result.speedDistribution[2].count).toBe(1); // 11-20
		expect(result.speedDistribution[5].count).toBe(1); // 41-50
		expect(result.speedDistribution[9].count).toBe(1); // 81+
	});

	it('total distance estimated from speed x time', () => {
		// Bus going 36 km/h for 10 seconds (1 data point after first)
		const locs = [
			makeBusLocation({ busId: 'b1', speedKmh: 36, timestamp: 0 }),
			makeBusLocation({ busId: 'b1', speedKmh: 36, timestamp: 10000 }),
		];
		const result = computeFromArray(locs);
		// 36 km/h * (10s / 3600s) = 0.1 km
		expect(result.totalDistanceKm).toBeCloseTo(0.1, 1);
	});

	it('counts violations correctly', () => {
		const locs = [
			makeBusLocation({ busId: 'b1', isViolation: true, timestamp: 1000 }),
			makeBusLocation({ busId: 'b2', isViolation: false, timestamp: 1000 }),
			makeBusLocation({ busId: 'b3', isViolation: true, timestamp: 1000 }),
		];
		const result = computeFromArray(locs);
		expect(result.totalViolations).toBe(2);
	});
});
