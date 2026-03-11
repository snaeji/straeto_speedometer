import type { BusLocation } from '$lib/types/bus';
import { STALE_THRESHOLD_MS, VIOLATION_APPROACHING_RATIO } from '$lib/utils/constants';

export type BusStatus = 'violation' | 'approaching' | 'normal' | 'nodata';

export function getBusStatus(bus: BusLocation): BusStatus {
	if (bus.speedKmh == null || bus.speedLimitKmh == null) return 'nodata';
	if (bus.isViolation) return 'violation';
	if (bus.speedKmh > bus.speedLimitKmh * VIOLATION_APPROACHING_RATIO) return 'approaching';
	return 'normal';
}

export function getStatusColor(status: BusStatus): string {
	switch (status) {
		case 'violation': return '#ef4444';
		case 'approaching': return '#f59e0b';
		case 'normal': return '#10b981';
		case 'nodata': return '#6b7280';
	}
}

const LIVE_HISTORY_MAX = 10_000;

class BusStore {
	/** Map of busId -> BusLocation for current display */
	buses = $state<Map<string, BusLocation>>(new Map());

	/** Currently selected bus for detail view */
	selectedBusId = $state<string | null>(null);

	/** Route filter: null = show all, Set = show only these */
	routeFilter = $state<Set<string> | null>(null);

	/** Whether auto-follow is enabled for selected bus */
	autoFollow = $state(true);

	/** In-memory history of all bus locations for live stats */
	liveHistory: BusLocation[] = [];

	/** Callbacks when a bus goes stale (for speed calculator reset) */
	private onBusStaleCallbacks: ((busId: string) => void)[] = [];

	// Derived values
	get activeBuses(): BusLocation[] {
		const list = Array.from(this.buses.values());
		if (!this.routeFilter) return list;
		return list.filter((b) => this.routeFilter!.has(b.routeNr));
	}

	get activeCount(): number {
		return this.activeBuses.length;
	}

	get violationCount(): number {
		return this.activeBuses.filter((b) => b.isViolation).length;
	}

	get averageSpeed(): number {
		const withSpeed = this.activeBuses.filter((b) => b.speedKmh != null && b.speedKmh > 0);
		if (withSpeed.length === 0) return 0;
		return withSpeed.reduce((sum, b) => sum + (b.speedKmh ?? 0), 0) / withSpeed.length;
	}

	get selectedBus(): BusLocation | null {
		if (!this.selectedBusId) return null;
		return this.buses.get(this.selectedBusId) ?? null;
	}

	get availableRoutes(): string[] {
		const routes = new Set<string>();
		for (const bus of this.buses.values()) {
			routes.add(bus.routeNr);
		}
		return Array.from(routes).sort((a, b) => parseInt(a) - parseInt(b));
	}

	/** Update bus positions (merge for live, replace for playback) */
	updateBuses(locations: BusLocation[], merge: boolean = true) {
		if (merge) {
			const newMap = new Map(this.buses);
			const now = Date.now();

			// Add/update with new data
			for (const loc of locations) {
				newMap.set(loc.busId, loc);
			}

			// Remove stale buses
			for (const [busId, bus] of newMap) {
				if (now - bus.timestamp > STALE_THRESHOLD_MS) {
					newMap.delete(busId);
					this.notifyStale(busId);
				}
			}

			this.buses = newMap;

			// Accumulate to live history for stats
			this.liveHistory.push(...locations);
			if (this.liveHistory.length > LIVE_HISTORY_MAX) {
				this.liveHistory = this.liveHistory.slice(-LIVE_HISTORY_MAX);
			}
		} else {
			// Replace entirely (playback mode)
			const newMap = new Map<string, BusLocation>();
			for (const loc of locations) {
				newMap.set(loc.busId, loc);
			}
			this.buses = newMap;
		}
	}

	selectBus(busId: string | null) {
		this.selectedBusId = busId;
		this.autoFollow = true;
	}

	setRouteFilter(routes: Set<string> | null) {
		this.routeFilter = routes;
	}

	onBusStale(callback: (busId: string) => void) {
		this.onBusStaleCallbacks.push(callback);
	}

	private notifyStale(busId: string) {
		for (const cb of this.onBusStaleCallbacks) {
			cb(busId);
		}
	}

	clear() {
		this.buses = new Map();
		this.selectedBusId = null;
	}
}

export const busStore = new BusStore();
