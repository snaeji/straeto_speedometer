import type { BusLocation } from '$lib/types/bus';
import { STALE_THRESHOLD_MS } from '$lib/utils/constants';

export type BusStatus = 'violation' | 'approaching' | 'normal' | 'nodata';

export function getBusStatus(bus: BusLocation): BusStatus {
	if (bus.speedKmh == null || bus.speedLimitKmh == null) return 'nodata';
	if (bus.isViolation) return 'violation'; // 5+ km/h over limit
	if (bus.speedKmh > bus.speedLimitKmh) return 'approaching'; // 0-5 km/h over limit
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
	liveHistory = $state<BusLocation[]>([]);

	/** Hovered point on SpeedGraph timeline — shown as ghost dot on map */
	hoveredHistoryPoint = $state<{ lat: number; lng: number; timestamp: number; speedKmh: number } | null>(null);

	/** Callbacks when a bus goes stale (for speed calculator reset) */
	private onBusStaleCallbacks: ((busId: string) => void)[] = [];

	private _activeBusesCache: BusLocation[] | null = null;

	// Derived values
	get activeBuses(): BusLocation[] {
		// Read reactive deps BEFORE cache check so Svelte always tracks them
		const buses = this.buses;
		const filter = this.routeFilter;
		if (this._activeBusesCache !== null) return this._activeBusesCache;
		const list = Array.from(buses.values());
		this._activeBusesCache = filter
			? list.filter((b) => filter.has(b.routeNr))
			: list;
		return this._activeBusesCache;
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
					if (busId === this.selectedBusId) {
						this.selectedBusId = null;
					}
					this.notifyStale(busId);
				}
			}

			this.buses = newMap;
			this._activeBusesCache = null;

			// Accumulate to live history for stats
			if (this.liveHistory.length + locations.length > LIVE_HISTORY_MAX) {
				const keep = Math.max(0, LIVE_HISTORY_MAX - locations.length);
				this.liveHistory = [...this.liveHistory.slice(-keep), ...locations];
			} else {
				this.liveHistory.push(...locations);
			}
		} else {
			// Replace entirely (playback mode)
			const newMap = new Map<string, BusLocation>();
			for (const loc of locations) {
				newMap.set(loc.busId, loc);
			}
			this.buses = newMap;
			this._activeBusesCache = null;
		}
	}

	selectBus(busId: string | null) {
		this.selectedBusId = busId;
		this.autoFollow = true;
		this.hoveredHistoryPoint = null;
	}

	setHoveredHistoryPoint(point: { lat: number; lng: number; timestamp: number; speedKmh: number } | null) {
		this.hoveredHistoryPoint = point;
	}

	setRouteFilter(routes: Set<string> | null) {
		this.routeFilter = routes;
		this._activeBusesCache = null;
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
		this.liveHistory = [];
		this._activeBusesCache = null;
		this.onBusStaleCallbacks = [];
	}
}

export const busStore = new BusStore();
