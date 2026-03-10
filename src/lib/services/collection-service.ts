import { fetchBusLocations } from './straeto-api';
import { SpeedCalculator } from './speed-calculator';
import { SpeedLimitService } from './speed-limit-service';
import { copyBusLocationWith, type BusLocation } from '$lib/types/bus';

export class CollectionService {
	private speedCalculator = new SpeedCalculator();
	private lastUpdateByBus = new Map<string, number>();

	constructor(private speedLimitService: SpeedLimitService) {}

	/**
	 * Poll once. Returns processed bus locations (deduplicated, speed-calculated,
	 * speed-limit-matched, violations detected), or null on error.
	 */
	async collectOnce(): Promise<BusLocation[] | null> {
		try {
			const [, rawBuses] = await fetchBusLocations();
			const processed: BusLocation[] = [];

			for (const bus of rawBuses) {
				// Deduplicate: skip if lastUpdate hasn't changed
				const prevTimestamp = this.lastUpdateByBus.get(bus.busId);
				if (prevTimestamp != null && bus.timestamp === prevTimestamp) {
					continue;
				}
				this.lastUpdateByBus.set(bus.busId, bus.timestamp);

				// Speed calculation pipeline
				const withSpeed = this.speedCalculator.processFix(bus);
				if (!withSpeed) continue;

				// Speed limit lookup
				const speedLimit = this.speedLimitService.getSpeedLimit(bus.lat, bus.lng);
				const isViolation =
					withSpeed.speedKmh != null && withSpeed.speedKmh > speedLimit;

				processed.push(
					copyBusLocationWith(withSpeed, {
						speedLimitKmh: speedLimit,
						isViolation,
					})
				);
			}

			return processed;
		} catch (err) {
			console.error('Collection error:', err);
			return null;
		}
	}

	/** Reset speed calculator state for a specific bus. */
	resetBus(busId: string): void {
		this.speedCalculator.resetBus(busId);
		this.lastUpdateByBus.delete(busId);
	}

	/** Reset all state. */
	resetAll(): void {
		this.speedCalculator.resetAll();
		this.lastUpdateByBus.clear();
	}
}
