import { POLLING_INTERVAL_MS } from '$lib/utils/constants';
import { CollectionService } from '$lib/services/collection-service';
import { SpeedLimitService } from '$lib/services/speed-limit-service';
import { StorageService } from '$lib/services/storage-service';
import { busStore } from './buses.svelte';

class CollectionStore {
	isCollecting = $state(false);
	isPreviewing = $state(false);
	recordsCollected = $state(0);
	violationsDetected = $state(0);
	startedAt = $state<number | null>(null);
	storageBytes = $state(0);
	recordCount = $state(0);
	lastError = $state<string | null>(null);

	private timer: ReturnType<typeof setInterval> | null = null;
	private previewTimer: ReturnType<typeof setInterval> | null = null;
	collectionService: CollectionService | null = null;
	storageService: StorageService | null = null;

	get elapsedSeconds(): number {
		if (!this.startedAt) return 0;
		return Math.floor((Date.now() - this.startedAt) / 1000);
	}

	async init(speedLimitService: SpeedLimitService, storageService: StorageService) {
		this.collectionService = new CollectionService(speedLimitService);
		this.storageService = storageService;

		// Register stale bus callback
		busStore.onBusStale((busId) => {
			this.collectionService?.resetBus(busId);
		});

		await this.refreshStorageInfo();
	}

	async startCollecting() {
		if (this.isCollecting || !this.collectionService || !this.storageService) return;

		this.isCollecting = true;
		this.startedAt = Date.now();
		this.lastError = null;

		// Stop preview if running
		this.stopPreviewing();

		// Collect immediately, then on interval
		await this.collectAndStore();
		this.timer = setInterval(() => this.collectAndStore(), POLLING_INTERVAL_MS);
	}

	stopCollecting() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.isCollecting = false;
	}

	async startPreviewing() {
		if (this.isPreviewing || this.isCollecting || !this.collectionService) return;
		this.isPreviewing = true;
		this.lastError = null;

		await this.previewOnce();
		this.previewTimer = setInterval(() => this.previewOnce(), POLLING_INTERVAL_MS);
	}

	stopPreviewing() {
		if (this.previewTimer) {
			clearInterval(this.previewTimer);
			this.previewTimer = null;
		}
		this.isPreviewing = false;
	}

	private async previewOnce() {
		if (!this.collectionService) return;
		const locations = await this.collectionService.collectOnce();
		if (locations && locations.length > 0) {
			busStore.updateBuses(locations, true);
		}
	}

	private async collectAndStore() {
		if (!this.collectionService || !this.storageService) return;

		const locations = await this.collectionService.collectOnce();
		if (!locations) {
			this.lastError = 'Failed to fetch bus data';
			return;
		}

		this.lastError = null;

		if (locations.length > 0) {
			// Update live display
			busStore.updateBuses(locations, true);

			// Store to IndexedDB
			await this.storageService.storeBatch(locations);

			this.recordsCollected += locations.length;
			this.violationsDetected += locations.filter((l) => l.isViolation).length;
		}

		await this.refreshStorageInfo();
	}

	async refreshStorageInfo() {
		if (!this.storageService) return;
		this.storageBytes = await this.storageService.getStorageEstimate();
		this.recordCount = await this.storageService.getRecordCount();
	}

	async importFile(text: string): Promise<number> {
		if (!this.storageService) return 0;
		const count = await this.storageService.importJsonl(text);
		await this.refreshStorageInfo();
		return count;
	}

	async clearData() {
		if (!this.storageService) return;
		await this.storageService.clearAll();
		this.recordsCollected = 0;
		this.violationsDetected = 0;
		await this.refreshStorageInfo();
	}

	destroy() {
		this.stopCollecting();
		this.stopPreviewing();
	}
}

export const collectionStore = new CollectionStore();
