import {
	OUTLIER_MIN_TIME_GAP_S,
	OUTLIER_MAX_DISTANCE_M,
	OUTLIER_MAX_SPEED_KMH,
	MIN_DISTANCE_THRESHOLD_M,
	SMOOTHING_BUFFER_SIZE,
	CONSERVATIVE_SPEED_FACTOR,
} from '$lib/utils/constants';
import { haversineDistanceM, speedKmh } from '$lib/utils/geo';
import { copyBusLocationWith, type BusLocation } from '$lib/types/bus';

interface PositionFix {
	lat: number;
	lng: number;
	timestamp: number; // epoch ms
}

export class SpeedCalculator {
	private busBuffers = new Map<string, PositionFix[]>();
	private speedBuffers = new Map<string, number[]>();
	private lastSpeed = new Map<string, number>();
	private stationaryCount = new Map<string, number>();

	/**
	 * Process a new GPS fix. Returns BusLocation with speedKmh set,
	 * or null if rejected by outlier detection.
	 */
	processFix(location: BusLocation): BusLocation | null {
		const { busId } = location;
		const newFix: PositionFix = {
			lat: location.lat,
			lng: location.lng,
			timestamp: location.timestamp,
		};

		const buffer = this.busBuffers.get(busId);

		// First fix for this bus
		if (!buffer || buffer.length === 0) {
			this.busBuffers.set(busId, [newFix]);
			this.speedBuffers.delete(busId);
			this.lastSpeed.delete(busId);
			this.stationaryCount.set(busId, 0);
			return copyBusLocationWith(location, { speedKmh: 0 });
		}

		const lastFix = buffer[buffer.length - 1];

		// Step 1: Outlier rejection
		const distanceM = haversineDistanceM(lastFix.lat, lastFix.lng, newFix.lat, newFix.lng);
		const timeDeltaS = (newFix.timestamp - lastFix.timestamp) / 1000.0;

		if (timeDeltaS < OUTLIER_MIN_TIME_GAP_S) return null;

		if (distanceM > OUTLIER_MAX_DISTANCE_M) {
			this.resetBus(busId);
			this.busBuffers.set(busId, [newFix]);
			this.stationaryCount.set(busId, 0);
			return null;
		}

		const rawSpeed = speedKmh(distanceM, timeDeltaS);
		if (rawSpeed > OUTLIER_MAX_SPEED_KMH) {
			this.resetBus(busId);
			this.busBuffers.set(busId, [newFix]);
			this.stationaryCount.set(busId, 0);
			return null;
		}

		// Add fix to position buffer
		buffer.push(newFix);
		if (buffer.length > SMOOTHING_BUFFER_SIZE) {
			buffer.shift();
		}

		// Step 2: Minimum distance threshold
		if (distanceM < MIN_DISTANCE_THRESHOLD_M) {
			this.stationaryCount.set(busId, (this.stationaryCount.get(busId) ?? 0) + 1);
			this.lastSpeed.delete(busId);
			this.speedBuffers.delete(busId);
			return copyBusLocationWith(location, { speedKmh: 0 });
		}

		// Bus is moving
		this.stationaryCount.set(busId, 0);

		// Step 3: Speed smoothing
		let spdBuffer = this.speedBuffers.get(busId);
		if (!spdBuffer) {
			spdBuffer = [];
			this.speedBuffers.set(busId, spdBuffer);
		}
		spdBuffer.push(rawSpeed);
		if (spdBuffer.length > SMOOTHING_BUFFER_SIZE) {
			spdBuffer.shift();
		}

		const avgSpeed = spdBuffer.reduce((a, b) => a + b, 0) / spdBuffer.length;

		// Endpoint speed: displacement across full buffer / time across full buffer
		let smoothedSpeed = avgSpeed;
		if (buffer.length >= 2) {
			const first = buffer[0];
			const last = buffer[buffer.length - 1];
			const epDistM = haversineDistanceM(first.lat, first.lng, last.lat, last.lng);
			const epTimeS = (last.timestamp - first.timestamp) / 1000.0;
			if (epTimeS > 0) {
				const endpointSpeed = speedKmh(epDistM, epTimeS);
				smoothedSpeed = Math.min(avgSpeed, endpointSpeed);
			}
		}

		// Step 4: Conservative speed factor
		const finalSpeed = Math.max(0, Math.min(OUTLIER_MAX_SPEED_KMH, smoothedSpeed * CONSERVATIVE_SPEED_FACTOR));

		this.lastSpeed.set(busId, finalSpeed);
		return copyBusLocationWith(location, { speedKmh: finalSpeed });
	}

	resetBus(busId: string): void {
		this.busBuffers.delete(busId);
		this.speedBuffers.delete(busId);
		this.lastSpeed.delete(busId);
		this.stationaryCount.delete(busId);
	}

	resetAll(): void {
		this.busBuffers.clear();
		this.speedBuffers.clear();
		this.lastSpeed.clear();
		this.stationaryCount.clear();
	}
}
