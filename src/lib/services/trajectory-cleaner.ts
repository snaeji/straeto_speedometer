/**
 * Trajectory Cleaner — post-processing pipeline for GPS readings.
 *
 * Takes a window of raw readings for one bus, removes stale duplicates,
 * snaps to GTFS route polyline, rejects outliers using full context
 * (before AND after each point), enforces monotonic forward movement,
 * detects stationarity, and calculates speed from cleaned distances.
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

/** Minimum distance (m) between readings to count as genuine movement. */
const DEDUP_DISTANCE_M = 1.0;

/** Maximum jump (m) between neighbors before a point is an outlier. */
const OUTLIER_JUMP_M = 500;

/** Minimum distance change over 3+ readings to count as stationary. */
const STATIONARY_DIST_M = 3.0;

/** Number of consecutive near-zero-movement readings to confirm stopped. */
const STATIONARY_COUNT = 3;

/** Number of neighbors on each side for Gaussian speed smoothing. */
const GAUSSIAN_HALF_WINDOW = 3;

/** Precomputed Gaussian kernel weights for ±3 window (sigma = 1.5). */
const GAUSSIAN_KERNEL = (() => {
	const sigma = 1.5;
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

	/** Get interpolated speed at a given timestamp. */
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

		// Step 1: Deduplicate stale readings
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

		// Step 2: Snap to route (or use raw positions as fallback)
		const snapped = this.snapToRoute(deduped, mapMatcher, shapeData);
		if (snapped.length === 0) return null;

		// Step 3: Outlier rejection with full context
		const cleaned = this.rejectOutliers(snapped);
		if (cleaned.length === 0) return null;

		// Step 4: Monotonic enforcement
		const monotonic = this.enforceMonotonic(cleaned);
		if (monotonic.length === 0) return null;

		// Step 5: Detect stationarity
		this.detectStationarity(monotonic);

		// Step 6: Calculate raw point-to-point speeds
		this.calculateRawSpeeds(monotonic);

		// Step 7: Gaussian-weighted speed smoothing
		const smoothedSpeeds = this.smoothSpeeds(monotonic);

		return new CleanedTrajectory(busId, routeNr, monotonic, smoothedSpeeds, shapeData);
	}

	/**
	 * Step 1: Deduplicate stale readings.
	 * Group consecutive readings at same position. Keep first and last of each cluster.
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
				// If cluster had multiple readings, keep the last one too (timing info)
				if (i - 1 > clusterStart && result[result.length - 1] !== readings[i - 1]) {
					result.push(readings[i - 1]);
				}
				result.push(curr);
				clusterStart = i;
			}
		}

		// Keep the very last reading if it was in a stale cluster
		const last = readings[readings.length - 1];
		if (result[result.length - 1] !== last) {
			result.push(last);
		}

		return result;
	}

	/**
	 * Step 2: Snap all points to route polyline (or use raw positions).
	 */
	private snapToRoute(
		readings: RawReading[],
		mapMatcher: MapMatcher,
		shapeData: RouteShapeData | null,
	): CleanedPoint[] {
		const points: CleanedPoint[] = [];

		if (shapeData) {
			// Route-constrained: snap each reading to the GTFS polyline
			for (const reading of readings) {
				const snap = mapMatcher.snapStateless(
					reading.lat, reading.lng, shapeData, reading.nextStops,
				);
				if (snap && snap.confidence !== 'off-route') {
					points.push({
						lat: reading.lat,
						lng: reading.lng,
						timestamp: reading.timestamp,
						distAlongRouteM: snap.distAlongRouteM,
						snappedLat: snap.snappedLat,
						snappedLng: snap.snappedLng,
						isGenuine: !reading.isStale,
						isNearStop: snap.isNearStop,
						matchConfidence: snap.confidence,
						rawSpeedKmh: 0,
					});
				}
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
	 * Step 3: Reject outliers using full context (neighbors on both sides).
	 * A point is an outlier if:
	 * - Jump to/from neighbors exceeds OUTLIER_JUMP_M
	 * - Implied speed to/from neighbors exceeds OUTLIER_MAX_SPEED_KMH
	 * - Off-route confidence while neighbors are high
	 */
	private rejectOutliers(points: CleanedPoint[]): CleanedPoint[] {
		if (points.length <= 2) return points;

		const keep: boolean[] = new Array(points.length).fill(true);

		for (let i = 1; i < points.length - 1; i++) {
			const prev = points[i - 1];
			const curr = points[i];
			const next = points[i + 1];

			// Check distance jumps
			const distToPrev = Math.abs(curr.distAlongRouteM - prev.distAlongRouteM);
			const distToNext = Math.abs(next.distAlongRouteM - curr.distAlongRouteM);

			if (distToPrev > OUTLIER_JUMP_M && distToNext > OUTLIER_JUMP_M) {
				keep[i] = false;
				continue;
			}

			// Check implied speed
			const dtPrev = (curr.timestamp - prev.timestamp) / 1000;
			const dtNext = (next.timestamp - curr.timestamp) / 1000;

			if (dtPrev > 0 && dtNext > 0) {
				const speedToPrev = (distToPrev / 1000) / (dtPrev / 3600);
				const speedToNext = (distToNext / 1000) / (dtNext / 3600);

				if (speedToPrev > OUTLIER_MAX_SPEED_KMH && speedToNext > OUTLIER_MAX_SPEED_KMH) {
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
	 * consecutive readings, mark them and set speed to 0.
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
						points[k].isGenuine = false; // treat as non-moving
					}
					i = j - 1; // skip past the cluster
				}
			}
		}
	}

	/**
	 * Step 6: Calculate raw point-to-point speeds from cleaned distances.
	 */
	private calculateRawSpeeds(points: CleanedPoint[]): void {
		if (points.length < 2) return;

		points[0].rawSpeedKmh = 0;

		for (let i = 1; i < points.length; i++) {
			// Skip if stationarity already set speed to 0
			if (points[i].rawSpeedKmh === 0 && !points[i].isGenuine) continue;

			const distM = points[i].distAlongRouteM - points[i - 1].distAlongRouteM;
			const dtS = (points[i].timestamp - points[i - 1].timestamp) / 1000;

			if (dtS > 0 && distM >= 0) {
				points[i].rawSpeedKmh = (distM / 1000) / (dtS / 3600) * CONSERVATIVE_SPEED_FACTOR;
			} else {
				points[i].rawSpeedKmh = 0;
			}
		}
	}

	/**
	 * Step 7: Gaussian-weighted speed smoothing.
	 * For each point, weight raw speeds of ±GAUSSIAN_HALF_WINDOW neighbors.
	 */
	private smoothSpeeds(points: CleanedPoint[]): number[] {
		const speeds = new Array<number>(points.length);

		for (let i = 0; i < points.length; i++) {
			let weightedSum = 0;
			let totalWeight = 0;

			for (let j = -GAUSSIAN_HALF_WINDOW; j <= GAUSSIAN_HALF_WINDOW; j++) {
				const idx = i + j;
				if (idx < 0 || idx >= points.length) continue;

				const kernelIdx = j + GAUSSIAN_HALF_WINDOW;
				const weight = GAUSSIAN_KERNEL[kernelIdx];
				weightedSum += points[idx].rawSpeedKmh * weight;
				totalWeight += weight;
			}

			speeds[i] = totalWeight > 0 ? Math.max(0, weightedSum / totalWeight) : 0;
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
