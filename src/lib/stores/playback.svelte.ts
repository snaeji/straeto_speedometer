import type { PlaybackSpeed } from '$lib/types/bus';
import { StorageService } from '$lib/services/storage-service';
import { busStore } from './buses.svelte';

class PlaybackStore {
	isPlaying = $state(false);
	currentTimestamp = $state(0);
	startTimestamp = $state(0);
	endTimestamp = $state(0);
	speed = $state<PlaybackSpeed>(1);
	hasData = $state(false);

	private timer: ReturnType<typeof setInterval> | null = null;
	private storageService: StorageService | null = null;

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

		const tickMs = 100; // update every 100ms
		this.timer = setInterval(() => {
			const advance = (tickMs / 1000) * this.speed * 1000; // ms of real time per tick
			this.currentTimestamp += advance;

			if (this.currentTimestamp >= this.endTimestamp) {
				this.currentTimestamp = this.endTimestamp;
				this.pause();
				return;
			}

			this.loadCurrentFrame();
		}, tickMs);
	}

	pause() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.isPlaying = false;
	}

	async seekTo(timestamp: number) {
		this.currentTimestamp = Math.max(this.startTimestamp, Math.min(this.endTimestamp, timestamp));
		await this.loadCurrentFrame();
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

	private async loadCurrentFrame() {
		if (!this.storageService) return;
		const windowMs = 5000; // ±5 seconds
		const locations = await this.storageService.getLocationsInRange(
			this.currentTimestamp - windowMs,
			this.currentTimestamp + windowMs
		);

		// Keep only latest record per bus within window
		const latestByBus = new Map<string, typeof locations[number]>();
		for (const loc of locations) {
			const existing = latestByBus.get(loc.busId);
			if (!existing || loc.timestamp > existing.timestamp) {
				latestByBus.set(loc.busId, loc);
			}
		}

		busStore.updateBuses(Array.from(latestByBus.values()), false);
	}

	destroy() {
		this.pause();
	}
}

export const playbackStore = new PlaybackStore();
