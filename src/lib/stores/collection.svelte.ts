import {
	POLLING_INTERVAL_MS,
	DISPLAY_DELAY_MS,
	WARMUP_DURATION_MS,
} from '$lib/utils/constants';
import { CollectionService } from '$lib/services/collection-service';
import { SpeedLimitService } from '$lib/services/speed-limit-service';
import { StorageService } from '$lib/services/storage-service';
import type { GtfsService } from '$lib/services/gtfs-service';
import type { RouteShapeIndex } from '$lib/services/route-shape-index';
import { generateMockData, resetMockData, ensureSampleLoaded } from '$lib/services/mock-data';
import type { BusLocation } from '$lib/types/bus';
import { busStore } from './buses.svelte';

class CollectionStore {
	// Public state
	isRecording = $state(false);
	isMonitoring = $state(false);
	isSimulating = $state(false);
	recordsRecorded = $state(0);
	violationsDetected = $state(0);
	startedAt = $state<number | null>(null);
	storageBytes = $state(0);
	recordCount = $state(0);
	lastError = $state<string | null>(null);

	// Warmup state
	isWarmedUp = $state(false);
	warmupProgress = $state(0);
	warmupBusCount = $state(0);
	warmupReadingCount = $state(0);

	// Display cursor (2 minutes behind real-time)
	private displayCursorMs = 0;

	// Timers
	private ingestTimer: ReturnType<typeof setInterval> | null = null;
	private processTimer: ReturnType<typeof setInterval> | null = null;
	private warmupTimer: ReturnType<typeof setInterval> | null = null;
	private simulateTimer: ReturnType<typeof setInterval> | null = null;
	private isIngesting = false;
	private refreshCounter = 0;

	collectionService: CollectionService | null = null;
	storageService: StorageService | null = null;

	/** Unified animated position for MapView 60fps loop.
	 * Called at 60fps — computes display time from wall clock for smooth interpolation
	 * between the 2s process ticks.
	 */
	getAnimatedPosition(busId: string, _nowMs: number): { lat: number; lng: number; isFrozen: boolean } | null {
		if (!this.collectionService || !this.isWarmedUp) return null;
		// Compute display time from current wall clock (smooth, not quantized to 2s ticks)
		const displayTime = Date.now() - DISPLAY_DELAY_MS;
		return this.collectionService.getAnimatedPosition(busId, displayTime);
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

	// --- Recording (ingest + process + store) ---

	async startRecording() {
		if (this.isRecording || !this.collectionService || !this.storageService) return;

		this.stopMonitoring();
		this.isRecording = true;
		this.startedAt = Date.now();
		this.lastError = null;
		this.isWarmedUp = false;
		this.warmupProgress = 0;

		// Start ingesting immediately
		this.startIngesting();

		// Start warmup countdown
		this.startWarmup(() => {
			// After warmup: start processing frames
			this.startProcessing(true);
		});
	}

	stopRecording() {
		this.stopIngesting();
		this.stopProcessing();
		this.stopWarmup();
		this.isRecording = false;
		this.isWarmedUp = false;
		this.warmupProgress = 0;
	}

	// --- Monitoring (ingest + process, no storage) ---

	async startMonitoring() {
		if (this.isMonitoring || this.isRecording || !this.collectionService) return;

		this.isMonitoring = true;
		this.lastError = null;
		this.isWarmedUp = false;
		this.warmupProgress = 0;

		this.startIngesting();
		this.startWarmup(() => {
			this.startProcessing(false);
		});
	}

	stopMonitoring() {
		this.stopIngesting();
		this.stopProcessing();
		this.stopWarmup();
		this.isMonitoring = false;
		this.isWarmedUp = false;
		this.warmupProgress = 0;
	}

	// --- Simulation ---

	async startSimulation() {
		if (this.isSimulating) return;
		this.stopRecording();
		this.stopMonitoring();

		this.isSimulating = true;
		this.startedAt = Date.now();
		this.lastError = null;
		this.isWarmedUp = false;
		this.warmupProgress = 0;
		resetMockData();

		await ensureSampleLoaded();

		// For simulation, ingest mock data into the raw buffer
		const ingestMock = () => {
			const locations = generateMockData();
			if (locations.length === 0) return;
			for (const bus of locations) {
				this.collectionService?.ingestReading(bus);
			}
		};

		// Start ingesting mock data
		ingestMock();
		this.simulateTimer = setInterval(ingestMock, POLLING_INTERVAL_MS);

		// Start warmup
		this.startWarmup(() => {
			this.startProcessing(false);
		});
	}

	stopSimulation() {
		if (this.simulateTimer) {
			clearInterval(this.simulateTimer);
			this.simulateTimer = null;
		}
		this.stopProcessing();
		this.stopWarmup();
		this.isSimulating = false;
		this.isWarmedUp = false;
		this.warmupProgress = 0;
	}

	// --- Data management ---

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

	destroy() {
		this.stopRecording();
		this.stopMonitoring();
		this.stopSimulation();
	}

	// --- Private: Ingestion ---

	private startIngesting() {
		this.ingestOnce();
		this.ingestTimer = setInterval(() => this.ingestOnce(), POLLING_INTERVAL_MS);
	}

	private stopIngesting() {
		if (this.ingestTimer) {
			clearInterval(this.ingestTimer);
			this.ingestTimer = null;
		}
	}

	private async ingestOnce() {
		if (!this.collectionService) return;
		if (this.isIngesting) return;
		this.isIngesting = true;

		try {
			const count = await this.collectionService.ingestPoll();
			if (count === 0) {
				this.lastError = 'Failed to fetch bus data';
			} else {
				this.lastError = null;
			}
			// Update reactive warmup stats from raw buffer
			this.warmupBusCount = this.collectionService.rawBuffer.busCount;
			this.warmupReadingCount = this.collectionService.rawBuffer.totalReadings;
		} catch {
			this.lastError = 'Failed to fetch bus data';
		} finally {
			this.isIngesting = false;
		}
	}

	// --- Private: Warmup ---

	private startWarmup(onComplete: () => void) {
		const warmupStart = Date.now();

		this.warmupTimer = setInterval(() => {
			const elapsed = Date.now() - warmupStart;
			this.warmupProgress = Math.min(1, elapsed / WARMUP_DURATION_MS);

			if (elapsed >= WARMUP_DURATION_MS) {
				this.stopWarmup();
				this.isWarmedUp = true;
				onComplete();
			}
		}, 100); // Update progress at 10fps
	}

	private stopWarmup() {
		if (this.warmupTimer) {
			clearInterval(this.warmupTimer);
			this.warmupTimer = null;
		}
	}

	// --- Private: Processing ---

	private startProcessing(withStorage: boolean) {
		// Process first frame immediately
		this.processOnce(withStorage);
		this.processTimer = setInterval(() => this.processOnce(withStorage), POLLING_INTERVAL_MS);
	}

	private stopProcessing() {
		if (this.processTimer) {
			clearInterval(this.processTimer);
			this.processTimer = null;
		}
	}

	private async processOnce(withStorage: boolean) {
		if (!this.collectionService) return;

		// Advance display cursor
		this.displayCursorMs = Date.now() - DISPLAY_DELAY_MS;

		// Process frame at display cursor time
		const locations = this.collectionService.processFrame(this.displayCursorMs);

		if (locations.length > 0) {
			busStore.updateBuses(locations, true);
			this.recordsRecorded += locations.length;
			this.violationsDetected += locations.filter((l) => l.isViolation).length;

			if (withStorage && this.storageService) {
				await this.storageService.storeBatch(locations);

				if (++this.refreshCounter >= 15) {
					this.refreshCounter = 0;
					await this.refreshStorageInfo();
				}
			}
		}
	}
}

export const collectionStore = new CollectionStore();
