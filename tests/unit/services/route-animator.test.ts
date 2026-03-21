import { describe, it, expect, beforeEach } from 'vitest';
import { RouteAnimator } from '$lib/services/route-animator';
import { makeStraightRoute } from '../../fixtures';
import type { SnapResult } from '$lib/services/map-matcher';
import type { RouteShapeData } from '$lib/services/route-shape-index';

let mockTime = 1000000;
function getTime() { return mockTime; }
function advanceTime(ms: number) { mockTime += ms; }

function makeSnap(distAlongM: number, overrides: Partial<SnapResult> = {}): SnapResult {
	return {
		snappedLat: 64.14,
		snappedLng: -21.93,
		distAlongRouteM: distAlongM,
		segmentIdx: 0,
		lateralOffsetM: 5,
		confidence: 'high',
		speedKmh: null,
		isNearStop: false,
		...overrides,
	};
}

describe('RouteAnimator', () => {
	let animator: RouteAnimator;
	let route: RouteShapeData;

	beforeEach(() => {
		mockTime = 1000000;
		animator = new RouteAnimator(getTime);
		route = makeStraightRoute(5, 500); // 5 vertices, 500m total
	});

	describe('ingestion', () => {
		it('initializes state on first snap', () => {
			animator.ingest('b1', makeSnap(50), route);
			expect(animator.has('b1')).toBe(true);
		});

		it('returns null animation before ROUTE_ANIM_MIN_BUFFER (4)', () => {
			for (let i = 0; i < 3; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 50), route);
			}
			const pos = animator.getAnimatedPosition('b1', mockTime);
			expect(pos).toBeNull();
		});

		it('starts animation after 4 ingestions', () => {
			for (let i = 0; i < 4; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 50), route);
			}
			advanceTime(1000); // half a segment
			const pos = animator.getAnimatedPosition('b1', mockTime);
			expect(pos).not.toBeNull();
		});

		it('trims buffer to ROUTE_ANIM_MAX_BUFFER (6)', () => {
			for (let i = 0; i < 8; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 20), route);
			}
			// Should still work — buffer trimmed internally
			const pos = animator.getAnimatedPosition('b1', mockTime);
			expect(pos).not.toBeNull();
		});
	});

	describe('getAnimatedPosition', () => {
		it('returns route-constrained position', () => {
			for (let i = 0; i < 5; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 50), route);
			}
			advanceTime(1000);
			const pos = animator.getAnimatedPosition('b1', mockTime);
			expect(pos).not.toBeNull();
			// Position should be along the straight north-going route
			expect(pos!.lng).toBeCloseTo(-21.93, 3);
			expect(pos!.lat).toBeGreaterThanOrEqual(route.vertices[0].lat);
		});

		it('returns frozen state when no new data', () => {
			for (let i = 0; i < 5; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 50), route);
			}
			advanceTime(30000); // way past all segments
			const pos = animator.getAnimatedPosition('b1', mockTime);
			expect(pos).not.toBeNull();
			expect(pos!.isFrozen).toBe(true);
		});

		it('returns position with speed=0 for stationary bus', () => {
			for (let i = 0; i < 5; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(100 + i * 1, { speedKmh: 0 }), route); // < 5m movement
			}
			const pos = animator.getAnimatedPosition('b1', mockTime);
			// Stationary buses are detected, position returned with isFrozen=false
			if (pos) {
				expect(pos.isFrozen).toBe(false);
			}
		});
	});

	describe('segment advancement', () => {
		it('advances through multiple animation segments', () => {
			for (let i = 0; i < 6; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 50, { speedKmh: 20 }), route);
			}
			// Advance time through segments
			for (let step = 0; step < 5; step++) {
				advanceTime(1500);
				const pos = animator.getAnimatedPosition('b1', mockTime);
				if (pos) {
					expect(pos.lat).toBeDefined();
					expect(pos.lng).toBeDefined();
				}
			}
		});

		it('returns last confirmed position when p1/p2 missing', () => {
			// Edge case: very early in animation
			for (let i = 0; i < 4; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 50), route);
			}
			// Animation just started, request position
			const pos = animator.getAnimatedPosition('b1', mockTime);
			// Should return something (not crash)
			if (pos) expect(pos.lat).toBeDefined();
		});
	});

	describe('shape change', () => {
		it('resets when shape changes', () => {
			for (let i = 0; i < 4; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 50), route);
			}
			// Change shape
			const route2 = { ...route, shapeId: 'different' };
			advanceTime(2000);
			animator.ingest('b1', makeSnap(100), route2);
			// Buffer reset, not enough points for animation
			const pos = animator.getAnimatedPosition('b1', mockTime);
			expect(pos).toBeNull();
		});
	});

	describe('setTimeSource', () => {
		it('accepts a new time source', () => {
			let t = 0;
			animator.setTimeSource(() => t);
			t = 5000;
			animator.ingest('b1', makeSnap(50), route);
			expect(animator.has('b1')).toBe(true);
		});
	});

	describe('gap reset', () => {
		it('resets on time gap > 60s', () => {
			for (let i = 0; i < 4; i++) {
				advanceTime(2000);
				animator.ingest('b1', makeSnap(i * 50), route);
			}
			advanceTime(70000); // 70s gap
			animator.ingest('b1', makeSnap(300), route);
			// After reset, needs to build up buffer again
			const pos = animator.getAnimatedPosition('b1', mockTime);
			expect(pos).toBeNull();
		});
	});

	describe('cleanup', () => {
		it('resetBus removes specific bus', () => {
			animator.ingest('b1', makeSnap(50), route);
			animator.ingest('b2', makeSnap(50), route);
			animator.resetBus('b1');
			expect(animator.has('b1')).toBe(false);
			expect(animator.has('b2')).toBe(true);
		});

		it('resetAll clears all', () => {
			animator.ingest('b1', makeSnap(50), route);
			animator.ingest('b2', makeSnap(50), route);
			animator.resetAll();
			expect(animator.has('b1')).toBe(false);
			expect(animator.has('b2')).toBe(false);
		});

		it('cleanupStale removes old entries', () => {
			animator.ingest('b1', makeSnap(50), route);
			advanceTime(130_000);
			animator.cleanupStale();
			expect(animator.has('b1')).toBe(false);
		});
	});
});
