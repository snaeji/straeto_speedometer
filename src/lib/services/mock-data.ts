import { busLocationFromJsonLine, type BusLocation, type JsonLineRecord } from '$lib/types/bus';

/**
 * Replays real bus data from the bundled sample.jsonl file.
 * Data is grouped by timestamp and played back one snapshot at a time.
 */

let snapshots: BusLocation[][] = [];
let currentIndex = 0;
let loaded = false;
let loading: Promise<void> | null = null;

async function loadSampleData(): Promise<void> {
	if (loaded) return;
	if (loading) return loading;

	loading = (async () => {
		const res = await fetch('/sample.jsonl');
		const text = await res.text();
		const lines = text.trim().split('\n');

		// Group records by timestamp into snapshots
		const byTimestamp = new Map<number, BusLocation[]>();
		for (const line of lines) {
			if (!line) continue;
			const json: JsonLineRecord = JSON.parse(line);
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

	const snapshot = snapshots[currentIndex % snapshots.length];
	currentIndex++;

	// Rebase timestamps to now so the UI treats them as live
	const now = Date.now();
	return snapshot.map((loc) => ({ ...loc, timestamp: now }));
}

export async function ensureSampleLoaded(): Promise<void> {
	await loadSampleData();
}

export function resetMockData() {
	currentIndex = 0;
}
