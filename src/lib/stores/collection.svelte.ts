import { POLLING_INTERVAL_MS } from '$lib/utils/constants';
import { CollectionService } from '$lib/services/collection-service';
import { SpeedLimitService } from '$lib/services/speed-limit-service';
import { StorageService } from '$lib/services/storage-service';
import type { GtfsService } from '$lib/services/gtfs-service';
import type { RouteShapeIndex } from '$lib/services/route-shape-index';
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
	private isCollecting = false;
	private refreshCounter = 0;
	collectionService: CollectionService | null = null;
	storageService: StorageService | null = null;

	/** Expose spline renderer for MapView animation (legacy, used for trail sampling) */
	get renderer() {
		return this.collectionService?.renderer ?? null;
	}

	/** Set time source for renderer (e.g. for playback mode) */
	setTimeSource(getTime: () => number) {
		if (this.collectionService?.renderer) {
			this.collectionService.renderer.setTimeSource(getTime);
		}
		if (this.collectionService?.mapMatcher) {
			this.collectionService.mapMatcher.setTimeSource(getTime);
		}
		if (this.collectionService?.routeAnimator) {
			this.collectionService.routeAnimator.setTimeSource(getTime);
		}
	}

	/** Unified animated position: route-constrained when possible, spline fallback. */
	getAnimatedPosition(busId: string, nowMs: number): { lat: number; lng: number; isFrozen: boolean } | null {
		return this.collectionService?.getAnimatedPosition(busId, nowMs) ?? null;
	}

	get elapsedSeconds(): number {
		if (!this.startedAt) return 0;
		return Math.floor((Date.now() - this.startedAt) / 1000);
	}

	async init(
		speedLimitService: SpeedLimitService,
		storageService: StorageService,
		gtfsService?: GtfsService,
		routeShapeIndex?: RouteShapeIndex,
	) {
		this.collectionService = new CollectionService(
			speedLimitService,
			gtfsService ?? null,
			routeShapeIndex ?? null,
		);
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
		if (this.isCollecting) return;
		this.isCollecting = true;
		try {
			const locations = await this.collectionService.collectOnce();
			if (locations && locations.length > 0) {
				busStore.updateBuses(locations, true);
			}
		} finally {
			this.isCollecting = false;
		}
	}

	private async recordAndStore() {
		if (!this.collectionService || !this.storageService) return;
		if (this.isCollecting) return;
		this.isCollecting = true;

		try {
			const locations = await this.collectionService.collectOnce();
			if (!locations) {
				this.lastError = 'Failed to fetch bus data';
				return;
			}

			this.lastError = null;

			if (locations.length > 0) {
				busStore.updateBuses(locations, true);
				await this.storageService.storeBatch(locations);
				this.recordsRecorded += locations.length;
				this.violationsDetected += locations.filter((l) => l.isViolation).length;
			}

			if (++this.refreshCounter >= 15) {
				this.refreshCounter = 0;
				await this.refreshStorageInfo();
			}
		} finally {
			this.isCollecting = false;
		}
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
