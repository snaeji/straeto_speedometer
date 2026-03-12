import { fetchBusLocations } from './straeto-api';
import { SplineRenderer } from './spline-renderer';
import { MapMatcher } from './map-matcher';
import { RouteAnimator } from './route-animator';
import { SpeedLimitService } from './speed-limit-service';
import type { GtfsService } from './gtfs-service';
import type { RouteShapeIndex } from './route-shape-index';
import { copyBusLocationWith, type BusLocation } from '$lib/types/bus';
import { VIOLATION_GRACE_KMH } from '$lib/utils/constants';

export class CollectionService {
	readonly renderer = new SplineRenderer();
	readonly mapMatcher = new MapMatcher();
	readonly routeAnimator = new RouteAnimator();
	private lastUpdateByBus = new Map<string, number>();
	private lastRouteByBus = new Map<string, string>(); // busId -> "routeNr:direction"

	constructor(
		private speedLimitService: SpeedLimitService,
		private gtfsService: GtfsService | null = null,
		private routeShapeIndex: RouteShapeIndex | null = null,
	) {}

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

				const result = this.processBusFix(bus);
				if (result) processed.push(result);
			}

			return processed;
		} catch (err) {
			console.error('Collection error:', err);
			return null;
		}
	}

	/** Process a single bus location through speed calc + speed limit (for simulation replay). */
	processFixForSimulation(bus: BusLocation): BusLocation | null {
		return this.processBusFix(bus);
	}

	/**
	 * Unified animation position: delegates to RouteAnimator if on-route,
	 * otherwise falls back to SplineRenderer.
	 */
	getAnimatedPosition(busId: string, nowMs: number): { lat: number; lng: number; isFrozen: boolean } | null {
		if (this.mapMatcher.isOnRoute(busId)) {
			const result = this.routeAnimator.getAnimatedPosition(busId, nowMs);
			if (result) return result;
		}
		return this.renderer.getAnimatedPosition(busId, nowMs);
	}

	/** Reset speed calculator state for a specific bus. */
	resetBus(busId: string): void {
		this.renderer.resetBus(busId);
		this.mapMatcher.resetBus(busId);
		this.routeAnimator.resetBus(busId);
		this.lastUpdateByBus.delete(busId);
		this.lastRouteByBus.delete(busId);
	}

	/** Reset all state. */
	resetAll(): void {
		this.renderer.resetAll();
		this.mapMatcher.resetAll();
		this.routeAnimator.resetAll();
		this.lastUpdateByBus.clear();
		this.lastRouteByBus.clear();
	}

	/** Remove stale bus states that haven't been updated recently. */
	cleanupStale(): void {
		this.renderer.cleanupStale();
		this.mapMatcher.cleanupStale();
		this.routeAnimator.cleanupStale();
	}

	// --- Private ---

	private processBusFix(bus: BusLocation): BusLocation | null {
		// Detect route/direction change
		const routeKey = `${bus.routeNr}:${bus.direction}`;
		const prevRouteKey = this.lastRouteByBus.get(bus.busId);
		if (prevRouteKey && prevRouteKey !== routeKey) {
			this.mapMatcher.resetBus(bus.busId);
			this.routeAnimator.resetBus(bus.busId);
		}
		this.lastRouteByBus.set(bus.busId, routeKey);

		// Try route-constrained pipeline
		if (this.gtfsService && this.routeShapeIndex) {
			const shapeId = this.gtfsService.getShapeId(bus.tripId, bus.routeNr, bus.direction);
			if (shapeId) {
				const shapeData = this.routeShapeIndex.get(shapeId);
				if (shapeData) {
					const snapResult = this.mapMatcher.snap(
						bus.busId, bus.lat, bus.lng, bus.timestamp, shapeData,
					);
					if (snapResult && snapResult.confidence !== 'off-route') {
						// Route-constrained: use snapped position for speed limit
						this.routeAnimator.ingest(bus.busId, snapResult, shapeData);

						// Also feed spline renderer — use its speed as fallback during warmup
						const rendererResult = this.renderer.ingestReading(bus.busId, bus);

						const limitResult = this.speedLimitService.getSpeedLimit(
							snapResult.snappedLat, snapResult.snappedLng,
						);
						const speed = snapResult.speedKmh ?? rendererResult?.speedKmh ?? 0;
						const isViolation = speed > 0 &&
							speed > limitResult.speedLimitKmh + VIOLATION_GRACE_KMH;

						return copyBusLocationWith(bus, {
							speedKmh: speed,
							speedLimitKmh: limitResult.speedLimitKmh,
							speedLimitMatch: limitResult.match,
							speedLimitRoad: limitResult.roadName,
							isViolation,
							matchConfidence: snapResult.confidence,
							snappedLat: snapResult.snappedLat,
							snappedLng: snapResult.snappedLng,
							distAlongRouteM: snapResult.distAlongRouteM,
							isNearStop: snapResult.isNearStop,
						});
					}
				}
			}
		}

		// Fallback: spline renderer pipeline (existing behavior)
		const withSpeed = this.renderer.ingestReading(bus.busId, bus);
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
}
