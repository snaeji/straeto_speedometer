import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DisplayAnimator } from '$lib/services/display-animator';
import { CleanedTrajectory } from '$lib/services/trajectory-cleaner';
import type { CleanedPoint } from '$lib/services/trajectory-cleaner';
import type { RouteShapeData } from '$lib/services/route-shape-index';

/**
 * Build a CleanedPoint at a given position along a north-bound route.
 * Each meter of distAlongRouteM corresponds to ~1/111000 degrees latitude.
 */
function makeCleanedPoint(overrides: Partial<CleanedPoint> = {}): CleanedPoint {
	return {
		lat: 64.14,
		lng: -21.93,
		timestamp: 1710000000000,
		distAlongRouteM: 0,
		snappedLat: 64.14,
		snappedLng: -21.93,
		isGenuine: true,
		isNearStop: false,
		isStationary: false,
		matchConfidence: 'high',
		rawSpeedKmh: 0,
		...overrides,
	};
}

/**
 * Build a minimal CleanedTrajectory with N points spaced apart in time and distance.
 * Points are at 2-second intervals, moving north at ~30 km/h by default.
 */
function makeTrajectory(
	busId: string,
	opts: {
		routeNr?: string;
		numPoints?: number;
		startTimestamp?: number;
		intervalMs?: number;
		distPerPointM?: number;
	} = {},
): CleanedTrajectory {
	const routeNr = opts.routeNr ?? '1';
	const numPoints = opts.numPoints ?? 4;
	const startTs = opts.startTimestamp ?? 1710000000000;
	const interval = opts.intervalMs ?? 2000;
	const distPerPoint = opts.distPerPointM ?? 16.67; // ~30 km/h at 2s intervals

	const latPerM = 1 / 111000;
	const baseLat = 64.14;
	const baseLng = -21.93;

	const points: CleanedPoint[] = [];
	const speeds: number[] = [];

	for (let i = 0; i < numPoints; i++) {
		const dist = i * distPerPoint;
		points.push(
			makeCleanedPoint({
				lat: baseLat + dist * latPerM,
				lng: baseLng,
				timestamp: startTs + i * interval,
				distAlongRouteM: dist,
				snappedLat: baseLat + dist * latPerM,
				snappedLng: baseLng,
				rawSpeedKmh: i === 0 ? 0 : 30,
			}),
		);
		speeds.push(i === 0 ? 0 : 30);
	}

	return new CleanedTrajectory(busId, routeNr, points, speeds, null);
}

describe('DisplayAnimator', () => {
	let animator: DisplayAnimator;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1710000010000); // a baseline "now"
		animator = new DisplayAnimator();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('getPosition', () => {
		it('returns null for unknown bus', () => {
			const pos = animator.getPosition('unknown-bus', 1710000005000);
			expect(pos).toBeNull();
		});

		it('returns position after updateTrajectory', () => {
			const traj = makeTrajectory('bus-1');
			animator.updateTrajectory('bus-1', traj);

			// Query at a time midway through the trajectory
			const midTime = 1710000003000; // between point 1 (2s) and point 2 (4s)
			const pos = animator.getPosition('bus-1', midTime);

			expect(pos).not.toBeNull();
			expect(pos!.lat).toBeGreaterThan(64.14);
			expect(pos!.lng).toBeCloseTo(-21.93);
			expect(pos!.speedKmh).toBeGreaterThan(0);
			expect(typeof pos!.bearing).toBe('number');
			expect(typeof pos!.isFrozen).toBe('boolean');
		});

		it('returns null for trajectory with fewer than 2 points (isValid=false)', () => {
			const singlePoint = new CleanedTrajectory(
				'bus-1',
				'1',
				[makeCleanedPoint()],
				[0],
				null,
			);
			animator.updateTrajectory('bus-1', singlePoint);

			const pos = animator.getPosition('bus-1', 1710000000000);
			expect(pos).toBeNull();
		});
	});

	describe('isFrozen', () => {
		it('returns isFrozen=false for recently updated trajectory', () => {
			const traj = makeTrajectory('bus-1');
			vi.setSystemTime(1710000010000);
			animator.updateTrajectory('bus-1', traj);

			// Advance only 5 seconds — well under 15s threshold
			vi.setSystemTime(1710000015000);
			const pos = animator.getPosition('bus-1', 1710000003000);

			expect(pos).not.toBeNull();
			expect(pos!.isFrozen).toBe(false);
		});

		it('returns isFrozen=true when trajectory is stale (>15s without update)', () => {
			const traj = makeTrajectory('bus-1');
			vi.setSystemTime(1710000010000);
			animator.updateTrajectory('bus-1', traj);

			// Advance 16 seconds — past the 15s FROZEN_THRESHOLD_MS
			vi.setSystemTime(1710000026000);
			const pos = animator.getPosition('bus-1', 1710000003000);

			expect(pos).not.toBeNull();
			expect(pos!.isFrozen).toBe(true);
		});

		it('returns isFrozen=false exactly at the 15s boundary', () => {
			const traj = makeTrajectory('bus-1');
			vi.setSystemTime(1710000010000);
			animator.updateTrajectory('bus-1', traj);

			// Exactly 15 seconds — not strictly greater, so should not be frozen
			vi.setSystemTime(1710000025000);
			const pos = animator.getPosition('bus-1', 1710000003000);

			expect(pos).not.toBeNull();
			expect(pos!.isFrozen).toBe(false);
		});

		it('resets frozen state when trajectory is re-updated', () => {
			const traj = makeTrajectory('bus-1');
			vi.setSystemTime(1710000010000);
			animator.updateTrajectory('bus-1', traj);

			// Become frozen
			vi.setSystemTime(1710000030000);
			const frozen = animator.getPosition('bus-1', 1710000003000);
			expect(frozen!.isFrozen).toBe(true);

			// Re-update trajectory at this later time
			const traj2 = makeTrajectory('bus-1', { startTimestamp: 1710000020000 });
			animator.updateTrajectory('bus-1', traj2);

			// Now should be fresh again
			const fresh = animator.getPosition('bus-1', 1710000023000);
			expect(fresh).not.toBeNull();
			expect(fresh!.isFrozen).toBe(false);
		});
	});

	describe('resetBus', () => {
		it('clears state for a specific bus', () => {
			const traj1 = makeTrajectory('bus-1');
			const traj2 = makeTrajectory('bus-2');
			animator.updateTrajectory('bus-1', traj1);
			animator.updateTrajectory('bus-2', traj2);

			animator.resetBus('bus-1');

			expect(animator.has('bus-1')).toBe(false);
			expect(animator.has('bus-2')).toBe(true);
			expect(animator.getPosition('bus-1', 1710000003000)).toBeNull();
			expect(animator.getPosition('bus-2', 1710000003000)).not.toBeNull();
		});

		it('is a no-op for unknown bus', () => {
			// Should not throw
			animator.resetBus('nonexistent');
			expect(animator.has('nonexistent')).toBe(false);
		});
	});

	describe('resetAll', () => {
		it('clears all states', () => {
			animator.updateTrajectory('bus-1', makeTrajectory('bus-1'));
			animator.updateTrajectory('bus-2', makeTrajectory('bus-2'));
			animator.updateTrajectory('bus-3', makeTrajectory('bus-3'));

			animator.resetAll();

			expect(animator.has('bus-1')).toBe(false);
			expect(animator.has('bus-2')).toBe(false);
			expect(animator.has('bus-3')).toBe(false);
		});
	});

	describe('cleanupStale', () => {
		it('removes entries older than maxAgeMs', () => {
			vi.setSystemTime(1710000000000);
			animator.updateTrajectory('bus-old', makeTrajectory('bus-old'));

			vi.setSystemTime(1710000170000);
			animator.updateTrajectory('bus-recent', makeTrajectory('bus-recent'));

			// Advance to 180001ms after bus-old was added
			vi.setSystemTime(1710000180001);
			animator.cleanupStale(); // default maxAgeMs = 180_000

			expect(animator.has('bus-old')).toBe(false);
			expect(animator.has('bus-recent')).toBe(true);
		});

		it('respects custom maxAgeMs', () => {
			vi.setSystemTime(1710000000000);
			animator.updateTrajectory('bus-1', makeTrajectory('bus-1'));

			vi.setSystemTime(1710000010000); // 10 seconds later
			animator.cleanupStale(5000); // 5 second max age

			expect(animator.has('bus-1')).toBe(false);
		});

		it('keeps all entries when none are stale', () => {
			vi.setSystemTime(1710000000000);
			animator.updateTrajectory('bus-1', makeTrajectory('bus-1'));
			animator.updateTrajectory('bus-2', makeTrajectory('bus-2'));

			vi.setSystemTime(1710000001000); // 1 second later
			animator.cleanupStale();

			expect(animator.has('bus-1')).toBe(true);
			expect(animator.has('bus-2')).toBe(true);
		});
	});

	describe('has', () => {
		it('returns false for bus that was never added', () => {
			expect(animator.has('nonexistent')).toBe(false);
		});

		it('returns true for bus with active trajectory', () => {
			animator.updateTrajectory('bus-1', makeTrajectory('bus-1'));
			expect(animator.has('bus-1')).toBe(true);
		});

		it('returns false after bus is reset', () => {
			animator.updateTrajectory('bus-1', makeTrajectory('bus-1'));
			animator.resetBus('bus-1');
			expect(animator.has('bus-1')).toBe(false);
		});

		it('returns false after resetAll', () => {
			animator.updateTrajectory('bus-1', makeTrajectory('bus-1'));
			animator.resetAll();
			expect(animator.has('bus-1')).toBe(false);
		});

		it('returns false after cleanupStale removes it', () => {
			vi.setSystemTime(1710000000000);
			animator.updateTrajectory('bus-1', makeTrajectory('bus-1'));

			vi.setSystemTime(1710000200000); // 200 seconds later
			animator.cleanupStale();

			expect(animator.has('bus-1')).toBe(false);
		});
	});
});
