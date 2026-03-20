import { busLocationFromJsonLine, type BusLocation, type JsonLineRecord } from '$lib/types/bus';

/**
 * Replays real bus data from the bundled sample.jsonl file.
 * Data is grouped by timestamp and played back one snapshot at a time.
 */

let snapshots: BusLocation[][] = [];
let snapshotTimestamps: number[] = [];
let currentIndex = 0;
let loaded = false;
let loading: Promise<void> | null = null;
let simulationStartTime = 0;
let firstSnapshotTimestamp = 0;

async function loadSampleData(): Promise<void> {
	if (loaded) return;
	if (loading) return loading;

	loading = (async () => {
		const res = await fetch('/sample.jsonl');
		if (!res.ok) throw new Error(`Failed to load sample data: ${res.status} ${res.statusText}`);
		const text = await res.text();
		const lines = text.trim().split('\n');

		// Group records by timestamp into snapshots
		const byTimestamp = new Map<number, BusLocation[]>();
		for (const line of lines) {
			if (!line) continue;
			let json: JsonLineRecord;
			try { json = JSON.parse(line); } catch { continue; }
			const loc = busLocationFromJsonLine(json);
			let group = byTimestamp.get(loc.timestamp);
			if (!group) {
				group = [];
				byTimestamp.set(loc.timestamp, group);
			}
			group.push(loc);
		}

		// Sort snapshots chronologically
		const sortedKeys = [...byTimestamp.keys()].sort((a, b) => a - b);
		snapshots = sortedKeys.map((ts) => byTimestamp.get(ts)!);
		snapshotTimestamps = sortedKeys;
		loaded = true;
	})();

	return loading;
}

/**
 * Returns the next snapshot of bus locations, rebased to current time.
 * Loops back to the beginning when all snapshots are exhausted.
 */
export function generateMockData(): BusLocation[] {
	if (!loaded || snapshots.length === 0) return [];

	const idx = currentIndex % snapshots.length;
	const snapshot = snapshots[idx];
	currentIndex++;

	const origTs = snapshotTimestamps[idx];

	if (simulationStartTime === 0) {
		simulationStartTime = Date.now();
		firstSnapshotTimestamp = origTs;
	}

	// Rebase timestamps preserving original time deltas between snapshots
	const now = simulationStartTime + (origTs - firstSnapshotTimestamp);
	return snapshot.map((loc) => ({ ...loc, timestamp: now }));
}

export async function ensureSampleLoaded(): Promise<void> {
	await loadSampleData();
}

export function resetMockData() {
	currentIndex = 0;
	simulationStartTime = 0;
}
