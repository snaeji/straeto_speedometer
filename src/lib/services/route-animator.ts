/**
 * Animate bus positions along GTFS route polylines.
 *
 * Works in 1D (distance along route) and converts back to lat/lng,
 * ensuring buses follow actual road geometry instead of cutting corners.
 */

import type { RouteShapeData, RouteShapeVertex } from './route-shape-index';
import type { SnapResult } from './map-matcher';
import {
	ROUTE_ANIM_MIN_BUFFER,
	ROUTE_ANIM_MAX_BUFFER,
	ROUTE_ANIM_GAP_RESET_S,
	ROUTE_ANIM_STATIONARY_DIST_M,
	ROUTE_ANIM_STATIONARY_COUNT,
} from '$lib/utils/constants';

interface BufferEntry {
	distAlongM: number;
	timestamp: number;
	speedKmh: number;
}

interface RouteAnimState {
	shapeData: RouteShapeData;
	buffer: BufferEntry[];
	animating: boolean;
	segmentIndex: number; // index in buffer (not polyline)
	segmentStartTime: number;
	segmentDurationMs: number;
	currentSpeedKmh: number;
	isFrozen: boolean;
	lastDistAlongM: number;
	lastLat: number;
	lastLng: number;
	// Stationarity
	stationaryCount: number;
	isStationary: boolean;
	// Cached segment index for distAlongToLatLng hot path
	cachedVertexIdx: number;
}

/**
 * Convert a distance-along-route to lat/lng by interpolating the polyline vertices.
 * Uses binary search with a cached hint for the 60fps hot path.
 */
function distAlongToLatLng(
	vertices: RouteShapeVertex[],
	distM: number,
	hintIdx: number,
): { lat: number; lng: number; vertexIdx: number } {
	// Clamp
	if (distM <= 0) {
		return { lat: vertices[0].lat, lng: vertices[0].lng, vertexIdx: 0 };
	}
	const last = vertices[vertices.length - 1];
	if (distM >= last.cumDistM) {
		return { lat: last.lat, lng: last.lng, vertexIdx: vertices.length - 2 };
	}

	// Try cached hint first
	let idx = hintIdx;
	if (idx >= 0 && idx < vertices.length - 1) {
		if (vertices[idx].cumDistM <= distM && vertices[idx + 1].cumDistM >= distM) {
			// Hit — use this segment
		} else {
			// Miss — binary search
			idx = binarySearchSegment(vertices, distM);
		}
	} else {
		idx = binarySearchSegment(vertices, distM);
	}

	idx = Math.min(idx, vertices.length - 2);

	const a = vertices[idx];
	const b = vertices[idx + 1];
	const segLen = b.cumDistM - a.cumDistM;
	const t = segLen > 0 ? (distM - a.cumDistM) / segLen : 0;

	return {
		lat: a.lat + t * (b.lat - a.lat),
		lng: a.lng + t * (b.lng - a.lng),
		vertexIdx: idx,
	};
}

function binarySearchSegment(vertices: RouteShapeVertex[], distM: number): number {
	let lo = 0;
	let hi = vertices.length - 2;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (vertices[mid + 1].cumDistM < distM) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

export class RouteAnimator {
	private states = new Map<string, RouteAnimState>();
	private getTime: () => number;

	constructor(getTime: () => number = () => Date.now()) {
		this.getTime = getTime;
	}

	setTimeSource(getTime: () => number): void {
		this.getTime = getTime;
	}

	/**
	 * Ingest a snap result from the map matcher.
	 */
	ingest(busId: string, snapResult: SnapResult, shapeData: RouteShapeData): void {
		const nowMs = this.getTime();
		let state = this.states.get(busId);

		// Reset if shape changed
		if (state && state.shapeData.shapeId !== shapeData.shapeId) {
			this.resetBus(busId);
			state = undefined;
		}

		if (!state) {
			const pos = distAlongToLatLng(shapeData.vertices, snapResult.distAlongRouteM, 0);
			this.states.set(busId, {
				shapeData,
				buffer: [{
					distAlongM: snapResult.distAlongRouteM,
					timestamp: nowMs,
					speedKmh: snapResult.speedKmh ?? 0,
				}],
				animating: false,
				segmentIndex: 0,
				segmentStartTime: 0,
				segmentDurationMs: 0,
				currentSpeedKmh: snapResult.speedKmh ?? 0,
				isFrozen: false,
				lastDistAlongM: snapResult.distAlongRouteM,
				lastLat: pos.lat,
				lastLng: pos.lng,
				stationaryCount: 0,
				isStationary: false,
				cachedVertexIdx: pos.vertexIdx,
			});
			return;
		}

		// Gap detection
		const lastEntry = state.buffer[state.buffer.length - 1];
		const dtS = (nowMs - lastEntry.timestamp) / 1000;
		if (dtS > ROUTE_ANIM_GAP_RESET_S) {
			this.resetBus(busId);
			this.ingest(busId, snapResult, shapeData);
			return;
		}

		// Add to buffer
		state.buffer.push({
			distAlongM: snapResult.distAlongRouteM,
			timestamp: nowMs,
			speedKmh: snapResult.speedKmh ?? 0,
		});

		state.currentSpeedKmh = snapResult.speedKmh ?? 0;
		state.lastDistAlongM = snapResult.distAlongRouteM;

		// Stationarity detection
		const moveDist = Math.abs(snapResult.distAlongRouteM - lastEntry.distAlongM);
		if (moveDist < ROUTE_ANIM_STATIONARY_DIST_M) {
			state.stationaryCount++;
		} else {
			state.stationaryCount = 0;
		}
		state.isStationary = state.stationaryCount >= ROUTE_ANIM_STATIONARY_COUNT;

		if (state.isStationary) {
			state.currentSpeedKmh = 0;
			if (state.buffer.length > ROUTE_ANIM_MAX_BUFFER) {
				state.buffer.splice(0, state.buffer.length - ROUTE_ANIM_MAX_BUFFER);
			}
			return;
		}

		// Start animating when we have enough points
		if (!state.animating && state.buffer.length >= ROUTE_ANIM_MIN_BUFFER) {
			state.animating = true;
			state.segmentIndex = 1;
			state.segmentStartTime = nowMs;
			const p1 = state.buffer[1];
			const p2 = state.buffer[2];
			state.segmentDurationMs = p2.timestamp - p1.timestamp;
			if (state.segmentDurationMs <= 0) state.segmentDurationMs = 2000;
			state.isFrozen = false;
		}

		// Trim buffer
		if (state.buffer.length > ROUTE_ANIM_MAX_BUFFER) {
			const excess = state.buffer.length - ROUTE_ANIM_MAX_BUFFER;
			state.buffer.splice(0, excess);
			state.segmentIndex = Math.max(0, state.segmentIndex - excess);
		}

		// Unfreeze on new data
		if (state.isFrozen && state.animating) {
			state.isFrozen = false;
		}
	}

	/**
	 * Get the animated position along the route polyline.
	 */
	getAnimatedPosition(
		busId: string,
		nowMs: number,
	): { lat: number; lng: number; isFrozen: boolean } | null {
		const state = this.states.get(busId);
		if (!state) return null;

		if (!state.animating || state.buffer.length < ROUTE_ANIM_MIN_BUFFER) {
			return null;
		}

		// Stationary: hold at last position
		if (state.isStationary) {
			const lastEntry = state.buffer[state.buffer.length - 1];
			const pos = distAlongToLatLng(
				state.shapeData.vertices,
				lastEntry.distAlongM,
				state.cachedVertexIdx,
			);
			state.lastLat = pos.lat;
			state.lastLng = pos.lng;
			state.cachedVertexIdx = pos.vertexIdx;
			return { lat: pos.lat, lng: pos.lng, isFrozen: false };
		}

		// Compute animation progress
		const elapsed = nowMs - state.segmentStartTime;
		const duration = state.segmentDurationMs || 2000;
		let t = elapsed / duration;

		// Try to advance to next segment
		while (t >= 1.0) {
			const nextP2Index = state.segmentIndex + 2;
			if (nextP2Index < state.buffer.length) {
				state.segmentIndex++;
				const p1 = state.buffer[state.segmentIndex];
				const p2 = state.buffer[state.segmentIndex + 1];
				state.segmentDurationMs = p2.timestamp - p1.timestamp;
				if (state.segmentDurationMs <= 0) state.segmentDurationMs = 2000;
				state.segmentStartTime += duration;
				state.isFrozen = false;

				const newElapsed = nowMs - state.segmentStartTime;
				const newDuration = state.segmentDurationMs || 2000;
				t = newElapsed / newDuration;
			} else {
				// No next segment — freeze at last confirmed position
				const lastEntry = state.buffer[state.segmentIndex + 1] ?? state.buffer[state.buffer.length - 1];
				state.isFrozen = true;
				const pos = distAlongToLatLng(
					state.shapeData.vertices,
					lastEntry.distAlongM,
					state.cachedVertexIdx,
				);
				state.lastLat = pos.lat;
				state.lastLng = pos.lng;
				state.cachedVertexIdx = pos.vertexIdx;
				return { lat: pos.lat, lng: pos.lng, isFrozen: true };
			}
		}

		t = Math.max(0, Math.min(1, t));

		// Lerp distance along route
		const p1 = state.buffer[state.segmentIndex];
		const p2 = state.buffer[state.segmentIndex + 1];
		if (!p1 || !p2) {
			return { lat: state.lastLat, lng: state.lastLng, isFrozen: true };
		}

		const distAlong = p1.distAlongM + (p2.distAlongM - p1.distAlongM) * t;
		const pos = distAlongToLatLng(
			state.shapeData.vertices,
			distAlong,
			state.cachedVertexIdx,
		);

		state.lastLat = pos.lat;
		state.lastLng = pos.lng;
		state.cachedVertexIdx = pos.vertexIdx;
		state.isFrozen = false;

		return { lat: pos.lat, lng: pos.lng, isFrozen: false };
	}

	/** Check if a bus has an active route animation. */
	has(busId: string): boolean {
		return this.states.has(busId);
	}

	cleanupStale(maxAgeMs: number = 120_000): void {
		const now = this.getTime();
		for (const [busId, state] of this.states) {
			const lastTs = state.buffer[state.buffer.length - 1]?.timestamp ?? 0;
			if (now - lastTs > maxAgeMs) {
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
}
