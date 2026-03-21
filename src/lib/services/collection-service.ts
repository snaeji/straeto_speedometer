import { fetchBusLocations } from './straeto-api';
import { SplineRenderer } from './spline-renderer';
import { MapMatcher } from './map-matcher';
import { RouteAnimator } from './route-animator';
import { SpeedLimitService } from './speed-limit-service';
import type { GtfsService } from './gtfs-service';
import type { RouteShapeIndex } from './route-shape-index';
import { copyBusLocationWith, type BusLocation } from '$lib/types/bus';
import { VIOLATION_GRACE_KMH, ZONE_TRANSITION_GRACE_MS } from '$lib/utils/constants';

interface ZoneTransition {
	prevLimit: number;
	newLimit: number;
	transitionTime: number; // GPS timestamp when the limit first decreased
}

export class CollectionService {
	readonly renderer = new SplineRenderer();
	readonly mapMatcher = new MapMatcher();
	readonly routeAnimator = new RouteAnimator();
	private lastUpdateByBus = new Map<string, number>();
	private lastRouteByBus = new Map<string, string>(); // busId -> "routeNr:direction"
	private lastLimitByBus = new Map<string, number>(); // busId -> last speed limit
	private limitTransitions = new Map<string, ZoneTransition>(); // active zone transitions

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
		this.lastLimitByBus.delete(busId);
		this.limitTransitions.delete(busId);
	}

	/** Reset all state. */
	resetAll(): void {
		this.renderer.resetAll();
		this.mapMatcher.resetAll();
		this.routeAnimator.resetAll();
		this.lastUpdateByBus.clear();
		this.lastRouteByBus.clear();
		this.lastLimitByBus.clear();
		this.limitTransitions.clear();
	}

	/** Remove stale bus states that haven't been updated recently. */
	cleanupStale(): void {
		this.renderer.cleanupStale();
		this.mapMatcher.cleanupStale();
		this.routeAnimator.cleanupStale();
		// Clean up expired zone transitions (no bus data = no natural cleanup)
		const now = Date.now();
		for (const [busId, transition] of this.limitTransitions) {
			if (now - transition.transitionTime > ZONE_TRANSITION_GRACE_MS * 2) {
				this.limitTransitions.delete(busId);
			}
		}
	}

	// --- Private ---

	/**
	 * Check if a bus is violating its speed limit, with zone transition grace.
	 *
	 * When a bus enters a zone with a LOWER speed limit, it gets a brief grace
	 * period to decelerate. The effective limit ramps linearly from the old limit
	 * to the new limit over ZONE_TRANSITION_GRACE_MS.
	 *
	 * Exception: if the bus exceeds even the OLD (higher) limit + grace, it's
	 * flagged immediately — it was already speeding before the zone change.
	 */
	private checkViolation(busId: string, speed: number, currentLimit: number, timestamp: number): boolean {
		if (speed <= 0) return false;

		const prevLimit = this.lastLimitByBus.get(busId);
		this.lastLimitByBus.set(busId, currentLimit);

		// Detect zone transitions
		if (prevLimit != null) {
			if (currentLimit < prevLimit) {
				// Limit decreased — start or extend grace period.
				// For cascading drops (80→50→30), keep the highest prevLimit
				// so the ramp covers the full deceleration envelope.
				const existing = this.limitTransitions.get(busId);
				this.limitTransitions.set(busId, {
					prevLimit: existing ? Math.max(existing.prevLimit, prevLimit) : prevLimit,
					newLimit: currentLimit,
					transitionTime: existing ? existing.transitionTime : timestamp,
				});
			} else if (currentLimit > prevLimit) {
				// Limit increased — clear any pending grace (no grace needed entering a faster zone)
				this.limitTransitions.delete(busId);
			}
		}

		// Check if we're in an active grace period
		const transition = this.limitTransitions.get(busId);
		if (transition && currentLimit === transition.newLimit) {
			const elapsed = timestamp - transition.transitionTime;
			if (elapsed >= 0 && elapsed < ZONE_TRANSITION_GRACE_MS) {
				// Bus was already speeding before zone change — flag immediately
				if (speed > transition.prevLimit + VIOLATION_GRACE_KMH) {
					return true;
				}
				// Ramp effective limit from old to new over grace window
				const t = elapsed / ZONE_TRANSITION_GRACE_MS;
				const effectiveLimit = transition.prevLimit + (transition.newLimit - transition.prevLimit) * t;
				return speed > effectiveLimit + VIOLATION_GRACE_KMH;
			}
			// Grace expired
			this.limitTransitions.delete(busId);
		}

		// Normal case: no transition active
		return speed > currentLimit + VIOLATION_GRACE_KMH;
	}

	private processBusFix(bus: BusLocation): BusLocation | null {
		// Detect route/direction change — prefer GTFS direction (0/1) over compass bearing
		const dirForKey = bus.gtfsDirectionId ?? bus.direction;
		const routeKey = `${bus.routeNr}:${dirForKey}`;
		const prevRouteKey = this.lastRouteByBus.get(bus.busId);
		if (prevRouteKey && prevRouteKey !== routeKey) {
			this.mapMatcher.resetBus(bus.busId);
			this.routeAnimator.resetBus(bus.busId);
		}
		this.lastRouteByBus.set(bus.busId, routeKey);

		// Try route-constrained pipeline
		if (this.gtfsService && this.routeShapeIndex) {
			const dirForLookup = bus.gtfsDirectionId ?? bus.direction;
			const shapeId = this.gtfsService.getShapeId(bus.tripId, bus.routeNr, dirForLookup);
			if (shapeId) {
				const shapeData = this.routeShapeIndex.get(shapeId);
				if (shapeData) {
					const snapResult = this.mapMatcher.snap(
						bus.busId, bus.lat, bus.lng, bus.timestamp, shapeData, bus.nextStops,
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
						const isViolation = this.checkViolation(
							bus.busId, speed, limitResult.speedLimitKmh, bus.timestamp,
						);

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
		const isViolation = this.checkViolation(
			bus.busId, withSpeed.speedKmh ?? 0, limitResult.speedLimitKmh, bus.timestamp,
		);

		return copyBusLocationWith(withSpeed, {
			speedLimitKmh: limitResult.speedLimitKmh,
			speedLimitMatch: limitResult.match,
			speedLimitRoad: limitResult.roadName,
			isViolation,
		});
	}
}
