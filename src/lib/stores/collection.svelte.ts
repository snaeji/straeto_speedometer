import { POLLING_INTERVAL_MS } from '$lib/utils/constants';
import { CollectionService } from '$lib/services/collection-service';
import { SpeedLimitService } from '$lib/services/speed-limit-service';
import { StorageService } from '$lib/services/storage-service';
import { generateMockData, resetMockData, ensureSampleLoaded } from '$lib/services/mock-data';
import type { BusLocation } from '$lib/types/bus';
import { busStore } from './buses.svelte';

class CollectionStore {
	isRecording = $state(false);
	isMonitoring = $state(false);
	isSimulating = $state(false);
	recordsRecorded = $state(0);
	violationsDetected = $state(0);
	startedAt = $state<number | null>(null);
	storageBytes = $state(0);
	recordCount = $state(0);
	lastError = $state<string | null>(null);

	private timer: ReturnType<typeof setInterval> | null = null;
	private monitorTimer: ReturnType<typeof setInterval> | null = null;
	private simulateTimer: ReturnType<typeof setInterval> | null = null;
	collectionService: CollectionService | null = null;
	storageService: StorageService | null = null;

	/** Expose Kalman calculator for MapView animation */
	get speedCalculator() {
		return this.collectionService?.speedCalculator ?? null;
	}

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

	async startRecording() {
		if (this.isRecording || !this.collectionService || !this.storageService) return;

		this.isRecording = true;
		this.startedAt = Date.now();
		this.lastError = null;

		// Stop monitoring if running
		this.stopMonitoring();

		// Collect immediately, then on interval
		await this.recordAndStore();
		this.timer = setInterval(() => this.recordAndStore(), POLLING_INTERVAL_MS);
	}

	stopRecording() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.isRecording = false;
	}

	async startMonitoring() {
		if (this.isMonitoring || this.isRecording || !this.collectionService) return;
		this.isMonitoring = true;
		this.lastError = null;

		await this.monitorOnce();
		this.monitorTimer = setInterval(() => this.monitorOnce(), POLLING_INTERVAL_MS);
	}

	stopMonitoring() {
		if (this.monitorTimer) {
			clearInterval(this.monitorTimer);
			this.monitorTimer = null;
		}
		this.isMonitoring = false;
	}

	private async monitorOnce() {
		if (!this.collectionService) return;
		const locations = await this.collectionService.collectOnce();
		if (locations && locations.length > 0) {
			busStore.updateBuses(locations, true);
		}
	}

	private async recordAndStore() {
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

			this.recordsRecorded += locations.length;
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
		this.recordsRecorded = 0;
		this.violationsDetected = 0;
		await this.refreshStorageInfo();
	}

	async startSimulation() {
		if (this.isSimulating) return;
		this.stopRecording();
		this.stopMonitoring();

		this.isSimulating = true;
		this.startedAt = Date.now();
		this.lastError = null;
		resetMockData();

		// Load sample data before starting playback
		await ensureSampleLoaded();

		// Replay sample data snapshots through the speed pipeline
		const tick = () => {
			let locations = generateMockData();
			if (locations.length === 0) return;

			// Process through speed calculator + speed limit service if available
			if (this.collectionService) {
				const processed: BusLocation[] = [];
				for (const bus of locations) {
					const withSpeed = this.collectionService.processFixForSimulation(bus);
					if (withSpeed) {
						processed.push(withSpeed);
					}
				}
				locations = processed;
			}

			busStore.updateBuses(locations, true);
			this.recordsRecorded += locations.length;
			this.violationsDetected += locations.filter((l) => l.isViolation).length;
		};
		tick();
		this.simulateTimer = setInterval(tick, POLLING_INTERVAL_MS);
	}

	stopSimulation() {
		if (this.simulateTimer) {
			clearInterval(this.simulateTimer);
			this.simulateTimer = null;
		}
		this.isSimulating = false;
	}

	destroy() {
		this.stopRecording();
		this.stopMonitoring();
		this.stopSimulation();
	}
}

export const collectionStore = new CollectionStore();
