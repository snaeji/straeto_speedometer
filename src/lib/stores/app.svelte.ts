import type { AppMode } from '$lib/types/bus';
import type { GtfsService } from '$lib/services/gtfs-service';

class AppStore {
	mode = $state<AppMode>('live');
	sidebarOpen = $state(true);
	speedLimitGeoJson = $state<object | null>(null);
	speedLimitsLoaded = $state(false);
	gtfsService = $state<GtfsService | null>(null);
	gtfsLoaded = $state(false);

	toggleSidebar() {
		this.sidebarOpen = !this.sidebarOpen;
	}

	setMode(mode: AppMode) {
		this.mode = mode;
		// Show sidebar for all modes except playback
		if (mode === 'playback') {
			this.sidebarOpen = false;
		} else if (!this.sidebarOpen) {
			this.sidebarOpen = true;
		}
	}
}

export const appStore = new AppStore();
