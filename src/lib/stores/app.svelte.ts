import type { AppMode } from '$lib/types/bus';
import type { GtfsService } from '$lib/services/gtfs-service';
import type { RouteShapeIndex } from '$lib/services/route-shape-index';

class AppStore {
	mode = $state<AppMode>('live');
	sidebarOpen = $state(true);
	speedLimitGeoJson = $state<object | null>(null);
	speedLimitsLoaded = $state(false);
	gtfsService = $state<GtfsService | null>(null);
	gtfsLoaded = $state(false);
	routeShapeIndex = $state<RouteShapeIndex | null>(null);

	toggleSidebar() {
		this.sidebarOpen = !this.sidebarOpen;
	}

	setMode(mode: AppMode) {
		this.mode = mode;
		if (!this.sidebarOpen) {
			this.sidebarOpen = true;
		}
	}
}

export const appStore = new AppStore();
