/**
 * Trajectory Cleaner — post-processing pipeline for GPS readings.
 *
 * Takes a window of raw readings for one bus, removes stale duplicates,
 * snaps to GTFS route polyline with sequential continuity, rejects outliers
 * using full context (OR logic — either neighbor bad = reject), enforces
 * monotonic forward movement, detects stationarity, and calculates speed
 * from cleaned distances with hard clamping.
 *
 * Output: a CleanedTrajectory with guaranteed forward-only movement
 * and interpolation methods for position and speed at any timestamp.
 */

import type { RawReading } from './raw-buffer';
import type { MapMatcher, SnapResult } from './map-matcher';
import type { RouteShapeData, RouteShapeVertex } from './route-shape-index';
import type { GtfsService } from './gtfs-service';
import type { RouteShapeIndex } from './route-shape-index';
import type { MatchConfidence } from '$lib/types/bus';
import { haversineDistanceM } from '$lib/utils/geo';
import {
	CONSERVATIVE_SPEED_FACTOR,
	OUTLIER_MAX_SPEED_KMH,
	STOP_PROXIMITY_M,
} from '$lib/utils/constants';

/** Minimum distance (m) between readings to count as genuine movement.
 * Server-interpolated data: cached API responses repeat the same position.
 * 1.0m is well above the ÷3 quantization step (0.002m) and below
 * the minimum genuine movement between hardware GPS fixes (~10m). */
const DEDUP_DISTANCE_M = 1.0;

/** Maximum jump (m) to EITHER neighbor before a point is an outlier.
 * Lowered from 500m: server smoothing means genuine 300m+ jumps in a
 * single API interval shouldn't happen for city buses. At 90 km/h max
 * over 5s (median genuine update), a bus covers ~125m. */
const OUTLIER_JUMP_M = 300;

/** Minimum distance change over 3+ readings to count as stationary. */
const STATIONARY_DIST_M = 3.0;

/** Number of consecutive near-zero-movement readings to confirm stopped. */
const STATIONARY_COUNT = 3;

/** Number of neighbors on each side for Gaussian speed smoothing.
 * Reduced from ±3 to ±2: server already smooths positions via interpolation
 * between 15s hardware fixes. Double-smoothing with a wide window adds
 * unnecessary lag (~6-9s at ±3 vs ~4-6s at ±2). */
const GAUSSIAN_HALF_WINDOW = 2;

/**
 * Maximum distance-along-route jump (m) between consecutive snaps
 * before preferring a closer segment. Handles roundabouts (20-30m diameter,
 * ~50-100m in route distance across) and server corner-cutting on curves.
 * At 90 km/h over median 5s update: ~125m max realistic. Use 100m. */
const SNAP_CONTINUITY_MAX_JUMP_M = 100;

/** Precomputed Gaussian kernel weights for ±2 window (sigma = 1.0).
 * Tighter kernel than before (was ±3/sigma=1.5) because server-interpolated
 * data is already smooth — we only need to handle quantization and timing artifacts. */
const GAUSSIAN_KERNEL = (() => {
	const sigma = 1.0;
	const weights: number[] = [];
	for (let i = -GAUSSIAN_HALF_WINDOW; i <= GAUSSIAN_HALF_WINDOW; i++) {
		weights.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
	}
	const sum = weights.reduce((a, b) => a + b, 0);
	return weights.map((w) => w / sum);
})();

export interface CleanedPoint {
	lat: number;
	lng: number;
	timestamp: number;
	distAlongRouteM: number; // Monotonically increasing (route-matched) or cumulative haversine (fallback)
	snappedLat: number;
	snappedLng: number;
	isGenuine: boolean; // True if GPS actually moved
	isNearStop: boolean;
	isStationary: boolean; // True if bus is confirmed stopped at this point
	matchConfidence: MatchConfidence;
	rawSpeedKmh: number; // Point-to-point speed before smoothing
}

export class CleanedTrajectory {
	constructor(
		public readonly busId: string,
		public readonly routeNr: string,
		public readonly points: CleanedPoint[],
		private readonly smoothedSpeeds: number[], // parallel to points
		private readonly shapeData: RouteShapeData | null,
	) {}

	/**
	 * Get interpolated speed at a given timestamp.
	 * Respects stationary boundaries — returns 0 during stopped periods
	 * instead of linearly interpolating through them.
	 */
	speedAtTime(timestamp: number): number {
		const pts = this.points;
		if (pts.length === 0) return 0;
		if (pts.length === 1) return this.smoothedSpeeds[0];
		if (timestamp <= pts[0].timestamp) return this.smoothedSpeeds[0];
		if (timestamp >= pts[pts.length - 1].timestamp) return this.smoothedSpeeds[pts.length - 1];

		// Binary search for bracketing points
		let lo = 0;
		let hi = pts.length - 1;
		while (lo < hi - 1) {
			const mid = (lo + hi) >> 1;
			if (pts[mid].timestamp <= timestamp) lo = mid;
			else hi = mid;
		}

		// If either bracketing point is stationary, check if we're in the stationary zone
		if (pts[lo].isStationary && pts[hi].isStationary) {
			return 0; // Both points stationary — bus is stopped
		}
		if (pts[lo].isStationary) {
			// Transitioning from stop to movement — only start accelerating near hi
			const t = (timestamp - pts[lo].timestamp) / (pts[hi].timestamp - pts[lo].timestamp);
			if (t < 0.8) return 0; // Hold at 0 for most of the interval
			const rampT = (t - 0.8) / 0.2; // Ramp up in last 20% of interval
			return this.smoothedSpeeds[hi] * rampT;
		}
		if (pts[hi].isStationary) {
			// Transitioning from movement to stop — decelerate early
			const t = (timestamp - pts[lo].timestamp) / (pts[hi].timestamp - pts[lo].timestamp);
			if (t > 0.2) return 0; // Drop to 0 after first 20% of interval
			const rampT = 1 - (t / 0.2); // Ramp down in first 20%
			return this.smoothedSpeeds[lo] * rampT;
		}

		// Normal case: linear interpolation between two moving points
		const t = (timestamp - pts[lo].timestamp) / (pts[hi].timestamp - pts[lo].timestamp);
		return this.smoothedSpeeds[lo] * (1 - t) + this.smoothedSpeeds[hi] * t;
	}

	/** Get interpolated position at a given timestamp. */
	positionAtTime(timestamp: number): { lat: number; lng: number } | null {
		const pts = this.points;
		if (pts.length === 0) return null;
		if (pts.length === 1) return { lat: pts[0].snappedLat, lng: pts[0].snappedLng };
		if (timestamp <= pts[0].timestamp) return { lat: pts[0].snappedLat, lng: pts[0].snappedLng };
		if (timestamp >= pts[pts.length - 1].timestamp) {
			const last = pts[pts.length - 1];
			return { lat: last.snappedLat, lng: last.snappedLng };
		}

		// Binary search for bracketing points
		let lo = 0;
		let hi = pts.length - 1;
		while (lo < hi - 1) {
			const mid = (lo + hi) >> 1;
			if (pts[mid].timestamp <= timestamp) lo = mid;
			else hi = mid;
		}

		const t = (timestamp - pts[lo].timestamp) / (pts[hi].timestamp - pts[lo].timestamp);

		// If route-matched, interpolate along the polyline for smooth road-following
		if (this.shapeData) {
			const distA = pts[lo].distAlongRouteM;
			const distB = pts[hi].distAlongRouteM;
			const interpDist = distA + t * (distB - distA);
			return distAlongToLatLng(interpDist, this.shapeData.vertices);
		}

		// Fallback: linear interpolation between snapped positions
		return {
			lat: pts[lo].snappedLat + t * (pts[hi].snappedLat - pts[lo].snappedLat),
			lng: pts[lo].snappedLng + t * (pts[hi].snappedLng - pts[lo].snappedLng),
		};
	}

	/** Get interpolated bearing at a given timestamp. */
	bearingAtTime(timestamp: number): number {
		const pts = this.points;
		if (pts.length < 2) return 0;

		// Find the segment the bus is on
		let idx = 0;
		for (let i = 0; i < pts.length - 1; i++) {
			if (pts[i].timestamp <= timestamp) idx = i;
			else break;
		}
		const next = Math.min(idx + 1, pts.length - 1);
		if (idx === next) return 0;

		const dLat = pts[next].snappedLat - pts[idx].snappedLat;
		const dLng = pts[next].snappedLng - pts[idx].snappedLng;
		if (Math.abs(dLat) < 1e-9 && Math.abs(dLng) < 1e-9) return 0;

		const bearing = (Math.atan2(dLng * Math.cos(pts[idx].snappedLat * Math.PI / 180), dLat) * 180 / Math.PI + 360) % 360;
		return bearing;
	}

	/** Whether this trajectory has enough data to be useful. */
	get isValid(): boolean {
		return this.points.length >= 2;
	}

	/** Whether the bus is stationary at a given timestamp. */
	isStationaryAtTime(timestamp: number): boolean {
		return this.speedAtTime(timestamp) < 0.5;
	}
}

/**
 * Stateless trajectory cleaner. Call clean() with a window of raw readings
 * and GTFS data to get a CleanedTrajectory.
 */
export class TrajectoryCleaner {
	/**
	 * Clean a window of raw readings into a monotonic trajectory.
	 *
	 * @param readings — raw readings for one bus, time-ordered
	 * @param mapMatcher — for route snapping (uses snap() without state tracking)
	 * @param gtfsService — for shape ID resolution
	 * @param routeShapeIndex — for polyline data
	 */
	clean(
		readings: RawReading[],
		mapMatcher: MapMatcher,
		gtfsService: GtfsService | null,
		routeShapeIndex: RouteShapeIndex | null,
	): CleanedTrajectory | null {
		if (readings.length === 0) return null;

		const busId = readings[0].busId;
		const routeNr = readings[0].routeNr;

		// Step 1: Deduplicate stale readings (preserves stop boundary timing)
		const deduped = this.deduplicateStale(readings);
		if (deduped.length === 0) return null;

		// Try to resolve GTFS shape for route snapping
		let shapeData: RouteShapeData | null = null;
		if (gtfsService && routeShapeIndex) {
			const latest = deduped[deduped.length - 1];
			const dirForLookup = latest.gtfsDirectionId ?? latest.direction;
			const shapeId = gtfsService.getShapeId(latest.tripId, latest.routeNr, dirForLookup);
			if (shapeId) {
				shapeData = routeShapeIndex.get(shapeId) ?? null;
			}
		}

		// Step 2: Snap to route with sequential continuity (or use raw positions)
		const snapped = this.snapToRoute(deduped, mapMatcher, shapeData);
		if (snapped.length === 0) return null;

		// Step 3: Outlier rejection with OR logic (either neighbor bad = reject)
		const cleaned = this.rejectOutliers(snapped);
		if (cleaned.length === 0) return null;

		// Step 4: Monotonic enforcement
		const monotonic = this.enforceMonotonic(cleaned);
		if (monotonic.length === 0) return null;

		// Step 5: Detect stationarity
		this.detectStationarity(monotonic);

		// Step 6: Calculate raw point-to-point speeds (with hard clamp)
		this.calculateRawSpeeds(monotonic);

		// Step 7: Gaussian-weighted speed smoothing (with final clamp)
		const smoothedSpeeds = this.smoothSpeeds(monotonic);

		return new CleanedTrajectory(busId, routeNr, monotonic, smoothedSpeeds, shapeData);
	}

	/**
	 * Step 1: Deduplicate stale readings.
	 *
	 * With server-interpolated data, ~48% of API readings are cached repeats
	 * of the same position. Group consecutive readings at same position into
	 * clusters. Keep only the first and last of each cluster — no intermediates
	 * needed because the server positions are already smoothed (the hardware
	 * only transmits every 15s, and the server interpolates between fixes).
	 *
	 * Keeping first+last preserves stop boundary timing: we know exactly
	 * when the bus arrived (first stale) and when it left (first genuine after cluster).
	 */
	private deduplicateStale(readings: RawReading[]): RawReading[] {
		if (readings.length <= 1) return [...readings];

		const result: RawReading[] = [readings[0]];
		let clusterStart = 0;

		for (let i = 1; i < readings.length; i++) {
			const prev = readings[i - 1];
			const curr = readings[i];
			const dist = haversineDistanceM(prev.lat, prev.lng, curr.lat, curr.lng);

			if (dist >= DEDUP_DISTANCE_M) {
				// Position changed — end of cluster
				// Keep last reading of the stale cluster for stop boundary timing
				if (i - 1 > clusterStart && result[result.length - 1] !== readings[i - 1]) {
					result.push(readings[i - 1]);
				}
				result.push(curr);
				clusterStart = i;
			}
			// Stale readings within a cluster are dropped entirely.
			// With server-interpolated data, intermediate stale points add no
			// information — they're just cached repeats from the API.
		}

		// Keep the very last reading if it was in a stale cluster
		const last = readings[readings.length - 1];
		if (result[result.length - 1] !== last) {
			result.push(last);
		}

		return result;
	}

	/**
	 * Step 2: Snap all points to route polyline with sequential continuity.
	 *
	 * For route-matched buses, uses sequential snapping: each snap prefers
	 * segments near the previous snap's distance-along-route. This prevents
	 * jumping across roundabouts or overlapping route sections.
	 */
	private snapToRoute(
		readings: RawReading[],
		mapMatcher: MapMatcher,
		shapeData: RouteShapeData | null,
	): CleanedPoint[] {
		const points: CleanedPoint[] = [];

		if (shapeData) {
			let prevDistAlongM: number | null = null;

			for (const reading of readings) {
				const snap = mapMatcher.snapStateless(
					reading.lat, reading.lng, shapeData, reading.nextStops,
				);
				if (!snap || snap.confidence === 'off-route') continue;

				let distAlongM = snap.distAlongRouteM;

				// Sequential continuity: if previous snap exists, check for
				// suspicious distance jumps (roundabout/overlap snap ambiguity)
				if (prevDistAlongM !== null) {
					const jump = Math.abs(distAlongM - prevDistAlongM);
					const dt = points.length > 0
						? (reading.timestamp - points[points.length - 1].timestamp) / 1000
						: 1;

					// If the jump implies unreasonable speed AND we have a recent snap,
					// try to find a better segment near the previous distance
					if (jump > SNAP_CONTINUITY_MAX_JUMP_M && dt > 0) {
						const impliedSpeed = (jump / 1000) / (dt / 3600);
						if (impliedSpeed > OUTLIER_MAX_SPEED_KMH) {
							// Try snapping with a hint to prefer segments near prevDistAlongM
							const betterSnap = mapMatcher.snapStatelessNear(
								reading.lat, reading.lng, shapeData,
								prevDistAlongM, SNAP_CONTINUITY_MAX_JUMP_M,
							);
							if (betterSnap && betterSnap.confidence !== 'off-route') {
								distAlongM = betterSnap.distAlongRouteM;
								// Use the better snap's position
								points.push({
									lat: reading.lat,
									lng: reading.lng,
									timestamp: reading.timestamp,
									distAlongRouteM: distAlongM,
									snappedLat: betterSnap.snappedLat,
									snappedLng: betterSnap.snappedLng,
									isGenuine: !reading.isStale,
									isNearStop: betterSnap.isNearStop,
									isStationary: false,
									matchConfidence: betterSnap.confidence,
									rawSpeedKmh: 0,
								});
								prevDistAlongM = distAlongM;
								continue;
							}
							// No better snap found — skip this point entirely
							continue;
						}
					}
				}

				points.push({
					lat: reading.lat,
					lng: reading.lng,
					timestamp: reading.timestamp,
					distAlongRouteM: distAlongM,
					snappedLat: snap.snappedLat,
					snappedLng: snap.snappedLng,
					isGenuine: !reading.isStale,
					isNearStop: snap.isNearStop,
					isStationary: false,
					matchConfidence: snap.confidence,
					rawSpeedKmh: 0,
				});
				prevDistAlongM = distAlongM;
			}
		} else {
			// Fallback: use raw lat/lng with cumulative haversine distance
			let cumDist = 0;
			let prevLat = readings[0].lat;
			let prevLng = readings[0].lng;

			for (const reading of readings) {
				const dist = haversineDistanceM(prevLat, prevLng, reading.lat, reading.lng);
				cumDist += dist;
				points.push({
					lat: reading.lat,
					lng: reading.lng,
					timestamp: reading.timestamp,
					distAlongRouteM: cumDist,
					snappedLat: reading.lat,
					snappedLng: reading.lng,
					isGenuine: !reading.isStale,
					isNearStop: false,
					isStationary: false,
					matchConfidence: 'low',
					rawSpeedKmh: 0,
				});
				prevLat = reading.lat;
				prevLng = reading.lng;
			}
		}

		return points;
	}

	/**
	 * Step 3: Reject outliers using full context.
	 *
	 * Uses OR logic: a point is rejected if the implied speed to EITHER
	 * neighbor exceeds the outlier threshold. This catches single-sided
	 * spikes (e.g., roundabout snap jumps, API glitches) that AND logic misses.
	 *
	 * Also checks for large distance jumps to either neighbor.
	 */
	private rejectOutliers(points: CleanedPoint[]): CleanedPoint[] {
		if (points.length <= 2) return points;

		const keep: boolean[] = new Array(points.length).fill(true);

		for (let i = 1; i < points.length - 1; i++) {
			const prev = points[i - 1];
			const curr = points[i];
			const next = points[i + 1];

			// Check distance jumps — OR logic: either side exceeding = reject
			const distToPrev = Math.abs(curr.distAlongRouteM - prev.distAlongRouteM);
			const distToNext = Math.abs(next.distAlongRouteM - curr.distAlongRouteM);

			if (distToPrev > OUTLIER_JUMP_M || distToNext > OUTLIER_JUMP_M) {
				// Large jump to at least one side.
				// But only reject if the OTHER side also looks suspicious
				// (small jump to one side is normal if bus actually traveled there)
				const dtPrev = (curr.timestamp - prev.timestamp) / 1000;
				const dtNext = (next.timestamp - curr.timestamp) / 1000;
				const speedToPrev = dtPrev > 0 ? (distToPrev / 1000) / (dtPrev / 3600) : 0;
				const speedToNext = dtNext > 0 ? (distToNext / 1000) / (dtNext / 3600) : 0;

				// If the large jump also implies impossible speed, reject
				if (distToPrev > OUTLIER_JUMP_M && speedToPrev > OUTLIER_MAX_SPEED_KMH) {
					keep[i] = false;
					continue;
				}
				if (distToNext > OUTLIER_JUMP_M && speedToNext > OUTLIER_MAX_SPEED_KMH) {
					keep[i] = false;
					continue;
				}
			}

			// Check implied speed — OR logic: either side exceeding = reject
			const dtPrev = (curr.timestamp - prev.timestamp) / 1000;
			const dtNext = (next.timestamp - curr.timestamp) / 1000;

			if (dtPrev > 0 && dtNext > 0) {
				const speedToPrev = (distToPrev / 1000) / (dtPrev / 3600);
				const speedToNext = (distToNext / 1000) / (dtNext / 3600);

				// Reject if speed to EITHER neighbor exceeds threshold
				if (speedToPrev > OUTLIER_MAX_SPEED_KMH || speedToNext > OUTLIER_MAX_SPEED_KMH) {
					keep[i] = false;
					continue;
				}
			}

			// Check confidence mismatch
			if (
				curr.matchConfidence === 'off-route' &&
				prev.matchConfidence === 'high' &&
				next.matchConfidence === 'high'
			) {
				keep[i] = false;
			}
		}

		return points.filter((_, i) => keep[i]);
	}

	/**
	 * Step 4: Enforce monotonic distance-along-route (forward-only movement).
	 * Remove any point where distAlongRouteM is less than the previous point.
	 */
	private enforceMonotonic(points: CleanedPoint[]): CleanedPoint[] {
		if (points.length <= 1) return points;

		const result: CleanedPoint[] = [points[0]];
		let maxDist = points[0].distAlongRouteM;

		for (let i = 1; i < points.length; i++) {
			if (points[i].distAlongRouteM >= maxDist) {
				result.push(points[i]);
				maxDist = points[i].distAlongRouteM;
			}
			// else: point goes backwards — skip it
		}

		return result;
	}

	/**
	 * Step 5: Detect stationarity.
	 * If distance hasn't changed by > STATIONARY_DIST_M for STATIONARY_COUNT+
	 * consecutive readings, mark them as stationary with speed = 0.
	 */
	private detectStationarity(points: CleanedPoint[]): void {
		if (points.length < STATIONARY_COUNT) return;

		for (let i = 1; i < points.length; i++) {
			const distMoved = points[i].distAlongRouteM - points[i - 1].distAlongRouteM;
			if (distMoved < STATIONARY_DIST_M) {
				// Count consecutive near-stationary points
				let count = 1;
				let j = i;
				while (
					j < points.length &&
					points[j].distAlongRouteM - points[i - 1].distAlongRouteM < STATIONARY_DIST_M
				) {
					count++;
					j++;
				}

				if (count >= STATIONARY_COUNT) {
					// Mark all points in this stationary cluster
					for (let k = i; k < j; k++) {
						points[k].rawSpeedKmh = 0;
						points[k].isGenuine = false;
						points[k].isStationary = true;
					}
					// Also mark the anchor point before the cluster
					points[i - 1].isStationary = true;
					i = j - 1; // skip past the cluster
				}
			}
		}
	}

	/**
	 * Step 6: Calculate raw point-to-point speeds from cleaned distances.
	 * Hard-clamps to OUTLIER_MAX_SPEED_KMH as a safety net.
	 */
	private calculateRawSpeeds(points: CleanedPoint[]): void {
		if (points.length < 2) return;

		points[0].rawSpeedKmh = 0;

		for (let i = 1; i < points.length; i++) {
			// Skip if stationarity already set speed to 0
			if (points[i].isStationary) {
				points[i].rawSpeedKmh = 0;
				continue;
			}

			const distM = points[i].distAlongRouteM - points[i - 1].distAlongRouteM;
			const dtS = (points[i].timestamp - points[i - 1].timestamp) / 1000;

			if (dtS > 0 && distM >= 0) {
				const raw = (distM / 1000) / (dtS / 3600) * CONSERVATIVE_SPEED_FACTOR;
				// Hard clamp: no bus goes faster than OUTLIER_MAX_SPEED_KMH
				points[i].rawSpeedKmh = Math.min(raw, OUTLIER_MAX_SPEED_KMH);
			} else {
				points[i].rawSpeedKmh = 0;
			}
		}
	}

	/**
	 * Step 7: Gaussian-weighted speed smoothing with final clamp.
	 * For each point, weight raw speeds of ±GAUSSIAN_HALF_WINDOW neighbors.
	 * Respects stationary boundaries: stationary points always get speed 0.
	 */
	private smoothSpeeds(points: CleanedPoint[]): number[] {
		const speeds = new Array<number>(points.length);

		for (let i = 0; i < points.length; i++) {
			// Stationary points always get 0, no smoothing across stop boundaries
			if (points[i].isStationary) {
				speeds[i] = 0;
				continue;
			}

			let weightedSum = 0;
			let totalWeight = 0;

			for (let j = -GAUSSIAN_HALF_WINDOW; j <= GAUSSIAN_HALF_WINDOW; j++) {
				const idx = i + j;
				if (idx < 0 || idx >= points.length) continue;

				// Don't smooth across stationary boundaries
				if (points[idx].isStationary) continue;

				const kernelIdx = j + GAUSSIAN_HALF_WINDOW;
				const weight = GAUSSIAN_KERNEL[kernelIdx];
				weightedSum += points[idx].rawSpeedKmh * weight;
				totalWeight += weight;
			}

			const smoothed = totalWeight > 0 ? Math.max(0, weightedSum / totalWeight) : 0;
			// Final safety clamp
			speeds[i] = Math.min(smoothed, OUTLIER_MAX_SPEED_KMH);
		}

		return speeds;
	}
}

/**
 * Convert a distance-along-route to lat/lng by walking the polyline vertices.
 * Uses binary search for efficiency.
 */
function distAlongToLatLng(
	distM: number,
	vertices: RouteShapeVertex[],
): { lat: number; lng: number } {
	if (vertices.length === 0) return { lat: 0, lng: 0 };
	if (vertices.length === 1) return { lat: vertices[0].lat, lng: vertices[0].lng };

	// Clamp to route bounds
	if (distM <= 0) return { lat: vertices[0].lat, lng: vertices[0].lng };
	const last = vertices[vertices.length - 1];
	if (distM >= last.cumDistM) return { lat: last.lat, lng: last.lng };

	// Binary search for the segment
	let lo = 0;
	let hi = vertices.length - 1;
	while (lo < hi - 1) {
		const mid = (lo + hi) >> 1;
		if (vertices[mid].cumDistM <= distM) lo = mid;
		else hi = mid;
	}

	const a = vertices[lo];
	const b = vertices[hi];
	const segLen = b.cumDistM - a.cumDistM;
	const t = segLen > 0 ? (distM - a.cumDistM) / segLen : 0;

	return {
		lat: a.lat + t * (b.lat - a.lat),
		lng: a.lng + t * (b.lng - a.lng),
	};
}
