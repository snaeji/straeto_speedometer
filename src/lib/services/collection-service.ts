import { fetchBusLocations } from './straeto-api';
import { KalmanSpeedCalculator } from './kalman-speed-calculator';
import { SpeedLimitService } from './speed-limit-service';
import { copyBusLocationWith, type BusLocation } from '$lib/types/bus';
import { VIOLATION_GRACE_KMH } from '$lib/utils/constants';

export class CollectionService {
	readonly speedCalculator = new KalmanSpeedCalculator();
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
				const limitResult = this.speedLimitService.getSpeedLimit(bus.lat, bus.lng);
				const isViolation =
					withSpeed.speedKmh != null && withSpeed.speedKmh > limitResult.speedLimitKmh + VIOLATION_GRACE_KMH;

				processed.push(
					copyBusLocationWith(withSpeed, {
						speedLimitKmh: limitResult.speedLimitKmh,
						speedLimitMatch: limitResult.match,
						speedLimitRoad: limitResult.roadName,
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

	/** Process a single bus location through speed calc + speed limit (for simulation replay). */
	processFixForSimulation(bus: BusLocation): BusLocation | null {
		const withSpeed = this.speedCalculator.processFix(bus);
		if (!withSpeed) return null;

		const limitResult = this.speedLimitService.getSpeedLimit(bus.lat, bus.lng);
		const isViolation =
			withSpeed.speedKmh != null && withSpeed.speedKmh > limitResult.speedLimitKmh + VIOLATION_GRACE_KMH;

		return copyBusLocationWith(withSpeed, {
			speedLimitKmh: limitResult.speedLimitKmh,
			speedLimitMatch: limitResult.match,
			speedLimitRoad: limitResult.roadName,
			isViolation,
		});
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
