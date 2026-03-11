import type { BusLocation } from '$lib/types/bus';
import { StorageService } from '$lib/services/storage-service';

export interface RouteStats {
	routeNr: string;
	violations: number;
	avgSpeed: number;
	records: number;
}

export interface HourlyViolations {
	hour: number;
	count: number;
}

export interface TopSpeeder {
	busId: string;
	routeNr: string;
	maxSpeed: number;
	violations: number;
}

export interface SpeedBucket {
	range: string;
	count: number;
}

class StatsStore {
	isComputing = $state(false);
	topSpeeders = $state<TopSpeeder[]>([]);
	routeStats = $state<RouteStats[]>([]);
	violationsByHour = $state<HourlyViolations[]>([]);
	speedDistribution = $state<SpeedBucket[]>([]);
	totalDistanceKm = $state(0);
	totalBusesTracked = $state(0);
	totalRecords = $state(0);
	totalViolations = $state(0);

	private storageService: StorageService | null = null;

	async init(storageService: StorageService) {
		this.storageService = storageService;
	}

	async computeStats() {
		if (!this.storageService || this.isComputing) return;

		this.isComputing = true;

		const busStats = new Map<string, {
			routeNr: string;
			maxSpeed: number;
			violations: number;
		}>();

		const routeAgg = new Map<string, {
			totalSpeed: number;
			count: number;
			violations: number;
		}>();

		const hourlyViolations = new Array(24).fill(0);
		const speedBuckets = new Array(10).fill(0); // 0, 1-10, 11-20, ..., 71-80, 81+
		const uniqueBuses = new Set<string>();
		let totalDist = 0;
		let totalRecs = 0;
		let totalViol = 0;
		let prevByBus = new Map<string, BusLocation>();

		for await (const batch of this.storageService.getAllLocationsStream()) {
			for (const loc of batch) {
				totalRecs++;
				uniqueBuses.add(loc.busId);

				// Distance estimation
				const prev = prevByBus.get(loc.busId);
				if (prev && loc.speedKmh != null && loc.speedKmh > 0) {
					const timeDeltaH = (loc.timestamp - prev.timestamp) / 3_600_000;
					if (timeDeltaH > 0 && timeDeltaH < 0.5) {
						totalDist += loc.speedKmh * timeDeltaH;
					}
				}
				prevByBus.set(loc.busId, loc);

				// Bus-level stats
				const bStat = busStats.get(loc.busId) ?? {
					routeNr: loc.routeNr,
					maxSpeed: 0,
					violations: 0,
				};
				if (loc.speedKmh != null && loc.speedKmh > bStat.maxSpeed) {
					bStat.maxSpeed = loc.speedKmh;
				}
				if (loc.isViolation) {
					bStat.violations++;
					totalViol++;
					const hour = new Date(loc.timestamp).getUTCHours();
					hourlyViolations[hour]++;
				}
				busStats.set(loc.busId, bStat);

				// Route-level stats
				const rStat = routeAgg.get(loc.routeNr) ?? {
					totalSpeed: 0,
					count: 0,
					violations: 0,
				};
				if (loc.speedKmh != null && loc.speedKmh > 0) {
					rStat.totalSpeed += loc.speedKmh;
					rStat.count++;
				}
				if (loc.isViolation) rStat.violations++;
				routeAgg.set(loc.routeNr, rStat);

				// Speed distribution buckets
				if (loc.speedKmh != null) {
					const speed = loc.speedKmh;
					if (speed === 0) {
						speedBuckets[0]++;
					} else if (speed <= 10) {
						speedBuckets[1]++;
					} else if (speed <= 20) {
						speedBuckets[2]++;
					} else if (speed <= 30) {
						speedBuckets[3]++;
					} else if (speed <= 40) {
						speedBuckets[4]++;
					} else if (speed <= 50) {
						speedBuckets[5]++;
					} else if (speed <= 60) {
						speedBuckets[6]++;
					} else if (speed <= 70) {
						speedBuckets[7]++;
					} else if (speed <= 80) {
						speedBuckets[8]++;
					} else {
						speedBuckets[9]++;
					}
				}
			}
		}

		// Top speeders (by violations, top 10)
		this.topSpeeders = Array.from(busStats.entries())
			.map(([busId, s]) => ({
				busId,
				routeNr: s.routeNr,
				maxSpeed: Math.round(s.maxSpeed * 10) / 10,
				violations: s.violations,
			}))
			.sort((a, b) => b.violations - a.violations)
			.slice(0, 10);

		// Route stats (sorted by violations)
		this.routeStats = Array.from(routeAgg.entries())
			.map(([routeNr, s]) => ({
				routeNr,
				violations: s.violations,
				avgSpeed: s.count > 0 ? Math.round((s.totalSpeed / s.count) * 10) / 10 : 0,
				records: s.count,
			}))
			.sort((a, b) => b.violations - a.violations);

		// Hourly violations
		this.violationsByHour = hourlyViolations.map((count, hour) => ({
			hour,
			count,
		}));

		// Speed distribution
		const bucketLabels = ['0', '1-10', '11-20', '21-30', '31-40', '41-50', '51-60', '61-70', '71-80', '81+'];
		this.speedDistribution = speedBuckets.map((count, i) => ({
			range: bucketLabels[i],
			count,
		}));

		this.totalDistanceKm = Math.round(totalDist * 10) / 10;
		this.totalBusesTracked = uniqueBuses.size;
		this.totalRecords = totalRecs;
		this.totalViolations = totalViol;
		this.isComputing = false;
	}
}

export const statsStore = new StatsStore();
