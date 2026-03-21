/**
 * Unified 60fps position interpolation from cleaned trajectories.
 *
 * Replaces both RouteAnimator and SplineRenderer animation logic.
 * Consumes CleanedTrajectory objects (updated every 2s by processFrame)
 * and provides smooth interpolated positions at any timestamp.
 */

import type { CleanedTrajectory } from './trajectory-cleaner';

export interface AnimatedPosition {
	lat: number;
	lng: number;
	bearing: number;
	speedKmh: number;
	isFrozen: boolean;
}

/** How long without a trajectory update before marking as frozen. */
const FROZEN_THRESHOLD_MS = 15_000;

interface BusAnimState {
	trajectory: CleanedTrajectory;
	lastUpdateMs: number; // wall clock time when trajectory was last updated
}

export class DisplayAnimator {
	private states = new Map<string, BusAnimState>();

	/** Update the cleaned trajectory for a bus. Called every ~2s by processFrame. */
	updateTrajectory(busId: string, trajectory: CleanedTrajectory): void {
		this.states.set(busId, {
			trajectory,
			lastUpdateMs: Date.now(),
		});
	}

	/**
	 * Get animated position for a bus at a given display time.
	 * Called at 60fps by MapView's requestAnimationFrame loop.
	 */
	getPosition(busId: string, displayTimeMs: number): AnimatedPosition | null {
		const state = this.states.get(busId);
		if (!state) return null;

		const trajectory = state.trajectory;
		if (!trajectory.isValid) return null;

		const pos = trajectory.positionAtTime(displayTimeMs);
		if (!pos) return null;

		const speed = trajectory.speedAtTime(displayTimeMs);
		const bearing = trajectory.bearingAtTime(displayTimeMs);
		const isFrozen = Date.now() - state.lastUpdateMs > FROZEN_THRESHOLD_MS;

		return {
			lat: pos.lat,
			lng: pos.lng,
			bearing,
			speedKmh: speed,
			isFrozen,
		};
	}

	/** Check if a bus has an active trajectory. */
	has(busId: string): boolean {
		return this.states.has(busId);
	}

	/** Reset state for a specific bus. */
	resetBus(busId: string): void {
		this.states.delete(busId);
	}

	/** Reset all state. */
	resetAll(): void {
		this.states.clear();
	}

	/** Remove buses that haven't been updated recently. */
	cleanupStale(maxAgeMs: number = 180_000): void {
		const now = Date.now();
		for (const [busId, state] of this.states) {
			if (now - state.lastUpdateMs > maxAgeMs) {
				this.states.delete(busId);
			}
		}
	}
}
