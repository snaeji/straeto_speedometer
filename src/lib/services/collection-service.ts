/**
 * Collection Service — orchestrates the 2-minute buffer pipeline.
 *
 * Two decoupled operations:
 * - ingestPoll(): fetches API, stores raw readings in RawBuffer
 * - processFrame(): takes a display cursor time, cleans trajectories,
 *   calculates speed, detects violations, emits BusLocations
 *
 * The display cursor runs 2 minutes behind real-time, giving the
 * trajectory cleaner full context (before AND after each point).
 */

import { fetchBusLocations } from './straeto-api';
import { RawBuffer, type RawReading } from './raw-buffer';
import { TrajectoryCleaner, type CleanedTrajectory } from './trajectory-cleaner';
import { DisplayAnimator } from './display-animator';
import { MapMatcher } from './map-matcher';
import { SpeedLimitService } from './speed-limit-service';
import type { GtfsService } from './gtfs-service';
import type { RouteShapeIndex } from './route-shape-index';
import { copyBusLocationWith, busLocationFromApi, type BusLocation } from '$lib/types/bus';
import {
	VIOLATION_GRACE_KMH,
	ZONE_TRANSITION_GRACE_MS,
	VIOLATION_SUPPRESSED_ROUTES,
	RAW_BUFFER_RETENTION_MS,
	CLEANING_LOOKBACK_MS,
	CLEANING_LOOKAHEAD_MS,
	OUTLIER_MAX_SPEED_KMH,
} from '$lib/utils/constants';

interface ZoneTransition {
	prevLimit: number;
	newLimit: number;
	transitionTime: number;
}

export class CollectionService {
	readonly rawBuffer = new RawBuffer();
	readonly trajectoryCleaner = new TrajectoryCleaner();
	readonly displayAnimator = new DisplayAnimator();
	readonly mapMatcher = new MapMatcher();

	private lastLimitByBus = new Map<string, number>();
	private limitTransitions = new Map<string, ZoneTransition>();
	private lastRouteByBus = new Map<string, string>();

	// Cache cleaned trajectories for the display animator
	private trajectoryCache = new Map<string, CleanedTrajectory>();

	constructor(
		private speedLimitService: SpeedLimitService,
		private gtfsService: GtfsService | null = null,
		private routeShapeIndex: RouteShapeIndex | null = null,
	) {}

	/**
	 * Ingest a single API poll. Fetches bus locations and stores raw readings.
	 * Called every 2s by the polling timer. No processing happens here.
	 */
	async ingestPoll(): Promise<number> {
		try {
			const [, rawBuses] = await fetchBusLocations();

			for (const bus of rawBuses) {
				// Detect route/direction changes
				const dirForKey = bus.gtfsDirectionId ?? bus.direction;
				const routeKey = `${bus.routeNr}:${dirForKey}`;
				const prevRouteKey = this.lastRouteByBus.get(bus.busId);
				if (prevRouteKey && prevRouteKey !== routeKey) {
					this.rawBuffer.clearBus(bus.busId);
					this.displayAnimator.resetBus(bus.busId);
					this.trajectoryCache.delete(bus.busId);
					this.lastLimitByBus.delete(bus.busId);
					this.limitTransitions.delete(bus.busId);
				}
				this.lastRouteByBus.set(bus.busId, routeKey);

				this.rawBuffer.ingest({
					busId: bus.busId,
					routeNr: bus.routeNr,
					tripId: bus.tripId,
					lat: bus.lat,
					lng: bus.lng,
					direction: bus.direction,
					timestamp: bus.timestamp,
					headsign: bus.headsign ?? undefined,
					nextStops: bus.nextStops,
					gtfsDirectionId: bus.gtfsDirectionId,
				});
			}

			return rawBuses.length;
		} catch (err) {
			console.error('Ingest error:', err);
			return 0;
		}
	}

	/**
	 * Ingest a pre-built BusLocation (for simulation/playback replay).
	 */
	ingestReading(bus: BusLocation): void {
		const dirForKey = bus.gtfsDirectionId ?? bus.direction;
		const routeKey = `${bus.routeNr}:${dirForKey}`;
		const prevRouteKey = this.lastRouteByBus.get(bus.busId);
		if (prevRouteKey && prevRouteKey !== routeKey) {
			this.rawBuffer.clearBus(bus.busId);
			this.displayAnimator.resetBus(bus.busId);
			this.trajectoryCache.delete(bus.busId);
			this.lastLimitByBus.delete(bus.busId);
			this.limitTransitions.delete(bus.busId);
		}
		this.lastRouteByBus.set(bus.busId, routeKey);

		this.rawBuffer.ingest({
			busId: bus.busId,
			routeNr: bus.routeNr,
			tripId: bus.tripId,
			lat: bus.lat,
			lng: bus.lng,
			direction: bus.direction,
			timestamp: bus.timestamp,
			headsign: bus.headsign,
			nextStops: bus.nextStops,
			gtfsDirectionId: bus.gtfsDirectionId,
		});
	}

	/**
	 * Process a display frame at the given cursor time.
	 * Cleans trajectories, calculates speeds, detects violations.
	 * Returns processed BusLocations ready for the UI.
	 */
	processFrame(displayCursorMs: number): BusLocation[] {
		const results: BusLocation[] = [];
		const busIds = this.rawBuffer.getActiveBusIds();

		for (const busId of busIds) {
			const window = this.rawBuffer.getWindow(
				busId,
				displayCursorMs - CLEANING_LOOKBACK_MS,
				displayCursorMs + CLEANING_LOOKAHEAD_MS,
			);

			if (window.length < 2) continue;

			// Clean trajectory
			const trajectory = this.trajectoryCleaner.clean(
				window,
				this.mapMatcher,
				this.gtfsService,
				this.routeShapeIndex,
			);

			if (!trajectory || !trajectory.isValid) continue;

			// Update display animator with cleaned trajectory
			this.displayAnimator.updateTrajectory(busId, trajectory);
			this.trajectoryCache.set(busId, trajectory);

			// Get position and speed at display cursor time
			const position = trajectory.positionAtTime(displayCursorMs);
			if (!position) continue;

			// Final safety clamp on speed (defense in depth)
			const speed = Math.min(trajectory.speedAtTime(displayCursorMs), OUTLIER_MAX_SPEED_KMH);
			const bearing = trajectory.bearingAtTime(displayCursorMs);

			// Speed limit lookup on cleaned position
			const limitResult = this.speedLimitService.getSpeedLimit(position.lat, position.lng);

			// Get metadata from the latest reading in the window
			const latest = window[window.length - 1];
			const isStationary = trajectory.isStationaryAtTime(displayCursorMs);

			// Determine match confidence from the nearest cleaned point
			let matchConfidence = trajectory.points[0]?.matchConfidence ?? 'low';
			for (const pt of trajectory.points) {
				if (pt.timestamp <= displayCursorMs) {
					matchConfidence = pt.matchConfidence;
				} else break;
			}

			// Check if near stop at display cursor time
			let isNearStop = false;
			for (const pt of trajectory.points) {
				if (pt.timestamp <= displayCursorMs) {
					isNearStop = pt.isNearStop;
				} else break;
			}

			// Violation detection
			const isViolation = this.checkViolation(
				busId,
				isStationary ? 0 : speed,
				limitResult.speedLimitKmh,
				displayCursorMs,
				latest.routeNr,
			);

			// Find snapped position at cursor (for distAlongRouteM)
			let distAlongRouteM: number | undefined;
			let snappedLat: number | undefined;
			let snappedLng: number | undefined;
			for (const pt of trajectory.points) {
				if (pt.timestamp <= displayCursorMs) {
					distAlongRouteM = pt.distAlongRouteM;
					snappedLat = pt.snappedLat;
					snappedLng = pt.snappedLng;
				} else break;
			}

			results.push({
				busId,
				routeNr: latest.routeNr,
				tripId: latest.tripId,
				lat: position.lat,
				lng: position.lng,
				direction: bearing ?? latest.direction,
				timestamp: displayCursorMs,
				headsign: latest.headsign,
				speedKmh: isStationary ? 0 : speed,
				speedLimitKmh: limitResult.speedLimitKmh,
				speedLimitMatch: limitResult.match,
				speedLimitRoad: limitResult.roadName,
				isViolation,
				matchConfidence,
				snappedLat,
				snappedLng,
				distAlongRouteM,
				isNearStop,
				gtfsDirectionId: latest.gtfsDirectionId,
			});
		}

		// Prune old buffer data
		this.rawBuffer.prune(displayCursorMs - RAW_BUFFER_RETENTION_MS);

		return results;
	}

	/**
	 * Get animated position for 60fps rendering.
	 * Delegates to DisplayAnimator which interpolates along cleaned trajectories.
	 */
	getAnimatedPosition(busId: string, displayTimeMs: number): { lat: number; lng: number; isFrozen: boolean } | null {
		const result = this.displayAnimator.getPosition(busId, displayTimeMs);
		if (!result) return null;
		return { lat: result.lat, lng: result.lng, isFrozen: result.isFrozen };
	}

	/** Reset state for a specific bus. */
	resetBus(busId: string): void {
		this.rawBuffer.clearBus(busId);
		this.displayAnimator.resetBus(busId);
		this.mapMatcher.resetBus(busId);
		this.trajectoryCache.delete(busId);
		this.lastRouteByBus.delete(busId);
		this.lastLimitByBus.delete(busId);
		this.limitTransitions.delete(busId);
	}

	/** Reset all state. */
	resetAll(): void {
		this.rawBuffer.clearAll();
		this.displayAnimator.resetAll();
		this.mapMatcher.resetAll();
		this.trajectoryCache.clear();
		this.lastRouteByBus.clear();
		this.lastLimitByBus.clear();
		this.limitTransitions.clear();
	}

	/** Remove stale states. */
	cleanupStale(): void {
		this.displayAnimator.cleanupStale();
		this.mapMatcher.cleanupStale();

		// Prune per-bus caches for buses no longer tracked
		for (const busId of this.trajectoryCache.keys()) {
			if (!this.displayAnimator.has(busId)) {
				this.trajectoryCache.delete(busId);
				this.lastRouteByBus.delete(busId);
				this.lastLimitByBus.delete(busId);
			}
		}

		const now = Date.now();
		for (const [busId, transition] of this.limitTransitions) {
			if (now - transition.transitionTime > ZONE_TRANSITION_GRACE_MS * 2) {
				this.limitTransitions.delete(busId);
			}
		}
	}

	// --- Violation detection (unchanged logic, cleaner input) ---

	private checkViolation(
		busId: string,
		speed: number,
		currentLimit: number,
		timestamp: number,
		routeNr?: string,
	): boolean {
		if (speed <= 0) return false;
		if (routeNr && VIOLATION_SUPPRESSED_ROUTES.has(routeNr)) return false;

		const prevLimit = this.lastLimitByBus.get(busId);
		this.lastLimitByBus.set(busId, currentLimit);

		if (prevLimit != null) {
			if (currentLimit < prevLimit) {
				const existing = this.limitTransitions.get(busId);
				this.limitTransitions.set(busId, {
					prevLimit: existing ? Math.max(existing.prevLimit, prevLimit) : prevLimit,
					newLimit: currentLimit,
					transitionTime: timestamp,
				});
			} else if (currentLimit > prevLimit) {
				this.limitTransitions.delete(busId);
			}
		}

		const transition = this.limitTransitions.get(busId);
		if (transition && currentLimit === transition.newLimit) {
			const elapsed = timestamp - transition.transitionTime;
			if (elapsed >= 0 && elapsed < ZONE_TRANSITION_GRACE_MS) {
				if (speed > transition.prevLimit + VIOLATION_GRACE_KMH) {
					return true;
				}
				const t = elapsed / ZONE_TRANSITION_GRACE_MS;
				const effectiveLimit = transition.prevLimit + (transition.newLimit - transition.prevLimit) * t;
				return speed > effectiveLimit + VIOLATION_GRACE_KMH;
			}
			this.limitTransitions.delete(busId);
		}

		return speed > currentLimit + VIOLATION_GRACE_KMH;
	}
}
