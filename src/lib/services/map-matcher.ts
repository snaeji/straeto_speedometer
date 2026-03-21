/**
 * Snap GPS positions to known GTFS route polylines.
 *
 * Maintains per-bus state tracking which segment the bus is on,
 * enforces monotonicity, and computes speed from distance-along-route.
 *
 * When nextStops data is available, constrains the search to segments
 * before the first upcoming stop — resolving ambiguity at route overlaps.
 */

import type { RouteShapeData } from './route-shape-index';
import { projectPointOnSegment } from '$lib/utils/geo';
import {
	MATCH_SEARCH_WINDOW_M,
	MATCH_BACKWARD_TOLERANCE_M,
	MAX_SNAP_DISTANCE_M,
	LOW_CONFIDENCE_SNAP_DISTANCE_M,
	STOP_PROXIMITY_M,
	CONSERVATIVE_SPEED_FACTOR,
	OUTLIER_MAX_SPEED_KMH,
	SPEED_EMA_ALPHA,
	NEXT_STOP_FORWARD_MARGIN_M,
} from '$lib/utils/constants';
import type { MatchConfidence, NextStop } from '$lib/types/bus';

/** Number of consistent fixes required before emitting speed. */
const MATCH_WARMUP_FIXES = 4;

/** Max distance for a nextStop geometric snap to be trusted. */
const NEXT_STOP_MAX_SNAP_DIST_M = 100;

interface MatchState {
	shapeId: string;
	lastSegmentIdx: number;
	lastDistAlongM: number;
	lastTimestamp: number;
	lastSpeedKmh: number;
	emaSpeedKmh: number;
	confidence: MatchConfidence;
	fixCount: number;
	stopDwellSuppressed: boolean; // true if we already suppressed a spike for this stop dwell
}

export interface SnapResult {
	snappedLat: number;
	snappedLng: number;
	distAlongRouteM: number;
	segmentIdx: number;
	lateralOffsetM: number;
	confidence: MatchConfidence;
	speedKmh: number | null;
	isNearStop: boolean;
}

export class MapMatcher {
	private states = new Map<string, MatchState>();
	private getTime: () => number;

	constructor(getTime: () => number = () => Date.now()) {
		this.getTime = getTime;
	}

	setTimeSource(getTime: () => number): void {
		this.getTime = getTime;
	}

	/**
	 * Snap a GPS fix to the route polyline.
	 * Returns null if snap fails (no shape data, no candidate segments).
	 *
	 * When nextStops is provided, constrains the segment search to only
	 * segments before the first upcoming stop on the route.
	 */
	snap(
		busId: string,
		lat: number,
		lng: number,
		timestamp: number,
		shapeData: RouteShapeData,
		nextStops?: NextStop[],
	): SnapResult | null {
		const vertices = shapeData.vertices;
		if (vertices.length < 2) return null;

		const state = this.states.get(busId);

		// Resolve nextStops constraint (distance along route to first upcoming stop)
		const nextStopDistAlongM = nextStops && nextStops.length > 0
			? this.resolveNextStopDistAlong(nextStops[0], shapeData)
			: null;

		// Find candidate segments
		let candidateIndices: number[];
		if (!state || state.shapeId !== shapeData.shapeId) {
			// First fix or shape changed: search via spatial grid
			candidateIndices = this.findCandidatesFromGrid(lat, lng, shapeData);
			if (candidateIndices.length === 0) {
				// Fallback: search all segments
				candidateIndices = [];
				for (let i = 0; i < vertices.length - 1; i++) candidateIndices.push(i);
			}
		} else {
			// Subsequent fix: search within window around last match
			candidateIndices = this.findCandidatesNearby(state.lastDistAlongM, shapeData);
		}

		// Apply nextStops constraint to narrow candidates
		if (nextStopDistAlongM != null) {
			candidateIndices = this.constrainCandidatesByNextStop(
				candidateIndices, nextStopDistAlongM, shapeData, state,
			);
		}

		// Project GPS onto each candidate, pick closest
		let bestDist = Infinity;
		let bestSegIdx = -1;
		let bestT = 0;
		let bestProjLat = lat;
		let bestProjLng = lng;

		for (const segIdx of candidateIndices) {
			const a = vertices[segIdx];
			const b = vertices[segIdx + 1];
			const proj = projectPointOnSegment(lat, lng, a.lat, a.lng, b.lat, b.lng);
			if (proj.distanceM < bestDist) {
				bestDist = proj.distanceM;
				bestSegIdx = segIdx;
				bestT = proj.t;
				bestProjLat = proj.projLat;
				bestProjLng = proj.projLng;
			}
		}

		if (bestSegIdx < 0) return null;

		// Compute distance along route
		const segStart = vertices[bestSegIdx].cumDistM;
		const segEnd = vertices[bestSegIdx + 1].cumDistM;
		const distAlongM = segStart + bestT * (segEnd - segStart);

		// Confidence based on lateral offset
		let confidence: MatchConfidence;
		if (bestDist > MAX_SNAP_DISTANCE_M) {
			confidence = 'off-route';
		} else if (bestDist > LOW_CONFIDENCE_SNAP_DISTANCE_M) {
			confidence = 'low';
		} else {
			confidence = 'high';
		}

		// Post-snap validation: downgrade if snap is past the first upcoming stop
		if (nextStopDistAlongM != null && confidence === 'high') {
			if (distAlongM > nextStopDistAlongM + NEXT_STOP_FORWARD_MARGIN_M) {
				confidence = 'low';
			}
		}

		// Monotonicity: reject if bus appears to go backwards too far
		if (state && state.shapeId === shapeData.shapeId) {
			const backward = state.lastDistAlongM - distAlongM;
			if (backward > MATCH_BACKWARD_TOLERANCE_M) {
				// Might be a loop completion or terminal turnaround — reset
				this.resetBus(busId);
				return this.snap(busId, lat, lng, timestamp, shapeData, nextStops);
			}
		}

		// Speed calculation from distance-along-route (only after warm-up)
		const fixCount = state && state.shapeId === shapeData.shapeId ? state.fixCount + 1 : 1;
		let speedKmh: number | null = null;
		if (state && state.shapeId === shapeData.shapeId && fixCount >= MATCH_WARMUP_FIXES) {
			const dtS = (timestamp - state.lastTimestamp) / 1000;
			if (dtS > 0) {
				const deltaDistM = Math.abs(distAlongM - state.lastDistAlongM);
				const rawSpeed = (deltaDistM / 1000) / (dtS / 3600) * CONSERVATIVE_SPEED_FACTOR;
				// Outlier rejection: impossible speed means a snap jump, hold previous
				if (rawSpeed > OUTLIER_MAX_SPEED_KMH) {
					speedKmh = state.lastSpeedKmh;
				} else {
					speedKmh = rawSpeed;
				}
			}
		}

		// EMA smoothing for route-constrained speed
		if (speedKmh != null && state && state.shapeId === shapeData.shapeId) {
			if (state.emaSpeedKmh === 0 && speedKmh > 0) {
				// Seed EMA with first non-zero reading
			} else {
				speedKmh = speedKmh * SPEED_EMA_ALPHA + state.emaSpeedKmh * (1 - SPEED_EMA_ALPHA);
			}
		}

		// Stop proximity check
		let isNearStop = false;
		if (shapeData.stopDistancesM.length > 0) {
			isNearStop = this.checkNearStop(distAlongM, shapeData.stopDistancesM);
		}

		// Stop-aware speed filtering: suppress a single GPS artifact spike at stop departure.
		// Only triggers once per dwell — resets when bus moves away from the stop.
		if (isNearStop && state && speedKmh != null) {
			if (state.lastSpeedKmh < 5 && speedKmh > 15 && !state.stopDwellSuppressed) {
				speedKmh = state.lastSpeedKmh;
			}
		}

		// Track stop dwell suppression: set flag when we suppress, clear when bus leaves stop
		let stopDwellSuppressed = state?.stopDwellSuppressed ?? false;
		if (isNearStop && state && state.lastSpeedKmh < 5 && (speedKmh ?? 0) > 15 && !stopDwellSuppressed) {
			stopDwellSuppressed = true; // just suppressed — don't suppress again
		} else if (!isNearStop || (speedKmh ?? 0) >= 5) {
			stopDwellSuppressed = false; // bus left stop or is moving — reset
		}

		// Update state
		this.states.set(busId, {
			shapeId: shapeData.shapeId,
			lastSegmentIdx: bestSegIdx,
			lastDistAlongM: distAlongM,
			lastTimestamp: timestamp,
			lastSpeedKmh: speedKmh ?? 0,
			emaSpeedKmh: speedKmh ?? 0,
			confidence,
			fixCount,
			stopDwellSuppressed,
		});

		return {
			snappedLat: bestProjLat,
			snappedLng: bestProjLng,
			distAlongRouteM: distAlongM,
			segmentIdx: bestSegIdx,
			lateralOffsetM: bestDist,
			confidence,
			speedKmh,
			isNearStop,
		};
	}

	/**
	 * Stateless snap: project a single GPS point onto the route polyline
	 * without tracking per-bus state. Used by TrajectoryCleaner for batch processing.
	 *
	 * Returns snap result with position, distance, and confidence — but no speed
	 * (speed is calculated by the trajectory cleaner from the cleaned sequence).
	 */
	snapStateless(
		lat: number,
		lng: number,
		shapeData: RouteShapeData,
		nextStops?: NextStop[],
	): SnapResult | null {
		const vertices = shapeData.vertices;
		if (vertices.length < 2) return null;

		// Resolve nextStops constraint
		const nextStopDistAlongM = nextStops && nextStops.length > 0
			? this.resolveNextStopDistAlong(nextStops[0], shapeData)
			: null;

		// Always use grid search (no state to do nearby search from)
		let candidateIndices = this.findCandidatesFromGrid(lat, lng, shapeData);
		if (candidateIndices.length === 0) {
			candidateIndices = [];
			for (let i = 0; i < vertices.length - 1; i++) candidateIndices.push(i);
		}

		// Apply nextStops constraint
		if (nextStopDistAlongM != null) {
			candidateIndices = this.constrainCandidatesByNextStop(
				candidateIndices, nextStopDistAlongM, shapeData, undefined,
			);
		}

		// Project GPS onto each candidate, pick closest
		let bestDist = Infinity;
		let bestSegIdx = -1;
		let bestT = 0;
		let bestProjLat = lat;
		let bestProjLng = lng;

		for (const segIdx of candidateIndices) {
			const a = vertices[segIdx];
			const b = vertices[segIdx + 1];
			const proj = projectPointOnSegment(lat, lng, a.lat, a.lng, b.lat, b.lng);
			if (proj.distanceM < bestDist) {
				bestDist = proj.distanceM;
				bestSegIdx = segIdx;
				bestT = proj.t;
				bestProjLat = proj.projLat;
				bestProjLng = proj.projLng;
			}
		}

		if (bestSegIdx < 0) return null;

		const segStart = vertices[bestSegIdx].cumDistM;
		const segEnd = vertices[bestSegIdx + 1].cumDistM;
		const distAlongM = segStart + bestT * (segEnd - segStart);

		let confidence: MatchConfidence;
		if (bestDist > MAX_SNAP_DISTANCE_M) {
			confidence = 'off-route';
		} else if (bestDist > LOW_CONFIDENCE_SNAP_DISTANCE_M) {
			confidence = 'low';
		} else {
			confidence = 'high';
		}

		let isNearStop = false;
		if (shapeData.stopDistancesM.length > 0) {
			isNearStop = this.checkNearStop(distAlongM, shapeData.stopDistancesM);
		}

		return {
			snappedLat: bestProjLat,
			snappedLng: bestProjLng,
			distAlongRouteM: distAlongM,
			segmentIdx: bestSegIdx,
			lateralOffsetM: bestDist,
			confidence,
			speedKmh: null, // stateless — no speed calculation
			isNearStop,
		};
	}

	/** Check if a bus is currently matched to a route. */
	isOnRoute(busId: string): boolean {
		const state = this.states.get(busId);
		return state != null && state.confidence !== 'off-route';
	}

	cleanupStale(maxAgeMs: number = 120_000): void {
		const now = this.getTime();
		for (const [busId, state] of this.states) {
			if (now - state.lastTimestamp > maxAgeMs) {
				this.states.delete(busId);
			}
		}
	}

	resetBus(busId: string): void {
		this.states.delete(busId);
	}

	resetAll(): void {
		this.states.clear();
	}

	// --- Private helpers ---

	/**
	 * Resolve the distance-along-route for a nextStop.
	 * Tries ID-based lookup first (O(1)), falls back to geometric snap.
	 */
	private resolveNextStopDistAlong(
		nextStop: NextStop,
		shapeData: RouteShapeData,
	): number | null {
		// Try ID-based lookup in the stop sequence
		if (shapeData.stopIds) {
			const idx = shapeData.stopIds.indexOf(nextStop.stopId);
			if (idx >= 0 && idx < shapeData.stopDistancesM.length) {
				return shapeData.stopDistancesM[idx];
			}
		}

		// Fallback: geometric snap of stop coordinates to polyline
		const vertices = shapeData.vertices;
		if (vertices.length < 2) return null;

		let bestDist = Infinity;
		let bestDistAlong = 0;

		for (let i = 0; i < vertices.length - 1; i++) {
			const a = vertices[i];
			const b = vertices[i + 1];
			const proj = projectPointOnSegment(nextStop.lat, nextStop.lng, a.lat, a.lng, b.lat, b.lng);
			if (proj.distanceM < bestDist) {
				bestDist = proj.distanceM;
				const segLen = b.cumDistM - a.cumDistM;
				bestDistAlong = a.cumDistM + proj.t * segLen;
			}
		}

		if (bestDist > NEXT_STOP_MAX_SNAP_DIST_M) return null;
		return bestDistAlong;
	}

	/**
	 * Narrow candidate segments to those before the first upcoming stop.
	 * Falls back to the full candidate list if the constraint eliminates everything.
	 */
	private constrainCandidatesByNextStop(
		candidates: number[],
		firstStopDistAlongM: number,
		shapeData: RouteShapeData,
		state: MatchState | undefined,
	): number[] {
		const vertices = shapeData.vertices;
		const maxDistAlongM = firstStopDistAlongM + NEXT_STOP_FORWARD_MARGIN_M;
		const minDistAlongM = state && state.shapeId === shapeData.shapeId
			? Math.max(0, state.lastDistAlongM - MATCH_BACKWARD_TOLERANCE_M)
			: 0;

		const constrained = candidates.filter((segIdx) => {
			if (segIdx >= vertices.length - 1) return false;
			const segStart = vertices[segIdx].cumDistM;
			const segEnd = vertices[segIdx + 1].cumDistM;
			return segEnd >= minDistAlongM && segStart <= maxDistAlongM;
		});

		// Safety fallback: if constraint eliminated all candidates, use originals
		return constrained.length > 0 ? constrained : candidates;
	}

	private findCandidatesFromGrid(lat: number, lng: number, shapeData: RouteShapeData): number[] {
		const grid = shapeData.grid;
		const row = Math.floor(lat / 0.0009);
		const col = Math.floor(lng / 0.00206);

		// Search 3x3 neighborhood
		const candidates = new Set<number>();
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				const key = `${row + dr},${col + dc}`;
				const indices = grid.get(key);
				if (indices) {
					for (const idx of indices) candidates.add(idx);
				}
			}
		}
		return Array.from(candidates);
	}

	private findCandidatesNearby(lastDistAlongM: number, shapeData: RouteShapeData): number[] {
		const vertices = shapeData.vertices;
		const minDist = lastDistAlongM - MATCH_SEARCH_WINDOW_M;
		const maxDist = lastDistAlongM + MATCH_SEARCH_WINDOW_M;

		const candidates: number[] = [];
		for (let i = 0; i < vertices.length - 1; i++) {
			const segStart = vertices[i].cumDistM;
			const segEnd = vertices[i + 1].cumDistM;
			// Segment overlaps with search window
			if (segEnd >= minDist && segStart <= maxDist) {
				candidates.push(i);
			}
		}
		return candidates;
	}

	private checkNearStop(distAlongM: number, stopDistancesM: number[]): boolean {
		// Binary search for nearest stop
		let lo = 0;
		let hi = stopDistancesM.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (stopDistancesM[mid] < distAlongM) {
				lo = mid + 1;
			} else {
				hi = mid;
			}
		}
		// Check the closest stop(s)
		for (const idx of [lo - 1, lo]) {
			if (idx >= 0 && idx < stopDistancesM.length) {
				if (Math.abs(stopDistancesM[idx] - distAlongM) < STOP_PROXIMITY_M) {
					return true;
				}
			}
		}
		return false;
	}

}
