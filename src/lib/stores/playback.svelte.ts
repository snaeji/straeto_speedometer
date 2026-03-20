import type { PlaybackSpeed } from '$lib/types/bus';
import { StorageService } from '$lib/services/storage-service';
import { busStore } from './buses.svelte';
import { collectionStore } from './collection.svelte';

class PlaybackStore {
	isPlaying = $state(false);
	currentTimestamp = $state(0);
	startTimestamp = $state(0);
	endTimestamp = $state(0);
	speed = $state<PlaybackSpeed>(1);
	hasData = $state(false);

	private timer: ReturnType<typeof setInterval> | null = null;
	private storageService: StorageService | null = null;
	private seekVersion = 0;
	private isLoadingFrame = false;

	get progress(): number {
		const range = this.endTimestamp - this.startTimestamp;
		if (range <= 0) return 0;
		return (this.currentTimestamp - this.startTimestamp) / range;
	}

	async init(storageService: StorageService) {
		this.storageService = storageService;
		await this.loadTimeRange();
	}

	async loadTimeRange() {
		if (!this.storageService) return;
		const range = await this.storageService.getTimeRange();
		if (range) {
			this.startTimestamp = range[0];
			this.endTimestamp = range[1];
			this.currentTimestamp = range[0];
			this.hasData = true;
		} else {
			this.hasData = false;
		}
	}

	play() {
		if (this.isPlaying || !this.hasData) return;
		this.isPlaying = true;

		// Reset pipeline state so stale live data doesn't affect playback
		collectionStore.collectionService?.resetAll();
		// Set renderer time source to playback time
		collectionStore.setTimeSource(() => this.currentTimestamp);

		const tickMs = 100; // update every 100ms
		this.timer = setInterval(() => {
			const advance = (tickMs / 1000) * this.speed * 1000; // ms of real time per tick
			this.currentTimestamp += advance;

			if (this.currentTimestamp >= this.endTimestamp) {
				this.currentTimestamp = this.endTimestamp;
				this.pause();
				return;
			}

			if (!this.isLoadingFrame) {
				this.isLoadingFrame = true;
				this.loadCurrentFrame().finally(() => { this.isLoadingFrame = false; });
			}
		}, tickMs);
	}

	pause() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.isPlaying = false;

		// Restore real-time clock and flush stale animation buffers
		collectionStore.setTimeSource(() => Date.now());
		collectionStore.collectionService?.resetAll();
	}

	async seekTo(timestamp: number) {
		this.currentTimestamp = Math.max(this.startTimestamp, Math.min(this.endTimestamp, timestamp));
		const version = ++this.seekVersion;
		await this.loadCurrentFrame(version);
	}

	async stepForward() {
		await this.seekTo(this.currentTimestamp + 5000);
	}

	async stepBackward() {
		await this.seekTo(this.currentTimestamp - 5000);
	}

	setSpeed(speed: PlaybackSpeed) {
		this.speed = speed;
	}

	private async loadCurrentFrame(version?: number) {
		if (!this.storageService) return;
		if (this.isLoadingFrame && version === undefined) return;
		if (version !== undefined && version !== this.seekVersion) return;

		const windowMs = 5000;
		const locations = await this.storageService.getLocationsInRange(
			this.currentTimestamp - windowMs,
			this.currentTimestamp + windowMs
		);

		if (version !== undefined && version !== this.seekVersion) return;

		const latestByBus = new Map<string, typeof locations[number]>();
		for (const loc of locations) {
			const existing = latestByBus.get(loc.busId);
			if (!existing || loc.timestamp > existing.timestamp) {
				latestByBus.set(loc.busId, loc);
			}
		}

		const renderer = collectionStore.renderer;
		if (renderer) {
			for (const loc of latestByBus.values()) {
				renderer.ingestReading(loc.busId, loc);
			}
		}

		busStore.updateBuses(Array.from(latestByBus.values()), false);
	}

	destroy() {
		this.pause();
	}
}

export const playbackStore = new PlaybackStore();
