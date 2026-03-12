import { openDB, type IDBPDatabase } from 'idb';
import { busLocationFromJsonLine, busLocationToJsonLine, type BusLocation } from '$lib/types/bus';

const DB_NAME = 'straeto_speedometer_v2';
const DB_VERSION = 1;
const STORE_NAME = 'bus_locations';

const MAX_IMPORT_SIZE = 100 * 1024 * 1024; // 100MB

type StraetoDb = IDBPDatabase;

export class StorageService {
	private db: StraetoDb | null = null;
	private writeLock: Promise<void> = Promise.resolve();

	async open(): Promise<void> {
		this.db = await openDB(DB_NAME, DB_VERSION, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					const store = db.createObjectStore(STORE_NAME);
					store.createIndex('timestamp', 'ts');
					store.createIndex('busId', 'b');
				}
			},
		});
	}

	async storeBatch(locations: BusLocation[]): Promise<void> {
		const prev = this.writeLock;
		let resolve!: () => void;
		this.writeLock = new Promise<void>((r) => { resolve = r; });
		await prev;

		try {
			if (!this.db) return;
			const tx = this.db.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);
			for (const loc of locations) {
				const key = `${loc.timestamp}_${loc.busId}`;
				store.put(busLocationToJsonLine(loc), key);
			}
			await tx.done;
		} finally {
			resolve();
		}
	}

	async getLocationsInRange(start: number, end: number): Promise<BusLocation[]> {
		if (!this.db) return [];
		const tx = this.db.transaction(STORE_NAME, 'readonly');
		const index = tx.objectStore(STORE_NAME).index('timestamp');
		const range = IDBKeyRange.bound(start, end);
		const records = await index.getAll(range);
		return records.map((r) => busLocationFromJsonLine(r));
	}

	async getTimeRange(): Promise<[number, number] | null> {
		if (!this.db) return null;
		const tx = this.db.transaction(STORE_NAME, 'readonly');
		const index = tx.objectStore(STORE_NAME).index('timestamp');

		const firstCursor = await index.openCursor();
		if (!firstCursor) return null;
		const first = firstCursor.value.ts as number;

		const lastCursor = await index.openCursor(null, 'prev');
		if (!lastCursor) return null;
		const last = lastCursor.value.ts as number;

		return [first, last];
	}

	async getBusHistory(busId: string, maxMinutes: number = 30): Promise<BusLocation[]> {
		if (!this.db) return [];
		const now = Date.now();
		const start = now - maxMinutes * 60 * 1000;

		const tx = this.db.transaction(STORE_NAME, 'readonly');
		const index = tx.objectStore(STORE_NAME).index('timestamp');
		const range = IDBKeyRange.lowerBound(start);
		const results: BusLocation[] = [];

		let cursor = await index.openCursor(range);
		while (cursor) {
			const record = cursor.value;
			if (record.b === busId) {
				results.push(busLocationFromJsonLine(record));
			}
			cursor = await cursor.continue();
		}

		return results;
	}

	async getRecordCount(): Promise<number> {
		if (!this.db) return 0;
		return await this.db.count(STORE_NAME);
	}

	async getStorageEstimate(): Promise<number> {
		// navigator.storage.estimate() reports the entire origin's allocated
		// bytes, which doesn't drop immediately after clearing an IndexedDB store.
		// Return 0 when there are no records to avoid showing stale size.
		const count = await this.getRecordCount();
		if (count === 0) return 0;
		if ('storage' in navigator && 'estimate' in navigator.storage) {
			const estimate = await navigator.storage.estimate();
			return estimate.usage ?? 0;
		}
		return 0;
	}

	async clearAll(): Promise<void> {
		if (!this.db) return;
		const tx = this.db.transaction(STORE_NAME, 'readwrite');
		await tx.objectStore(STORE_NAME).clear();
		await tx.done;
	}

	async importJsonl(text: string): Promise<number> {
		if (text.length > MAX_IMPORT_SIZE) {
			throw new Error(`Import too large (${Math.round(text.length / 1024 / 1024)}MB). Max 100MB.`);
		}
		const lines = text.split('\n').filter((l) => l.trim());
		const locations: BusLocation[] = [];

		for (const line of lines) {
			try {
				const json = JSON.parse(line);
				if (!json || typeof json.b !== 'string' || typeof json.r !== 'string' ||
					typeof json.la !== 'number' || !isFinite(json.la) ||
					typeof json.ln !== 'number' || !isFinite(json.ln) ||
					typeof json.ts !== 'number' || json.ts <= 0) {
					continue;
				}
				locations.push(busLocationFromJsonLine(json));
			} catch {
				// Skip invalid lines
			}
		}

		if (locations.length > 0) {
			await this.storeBatch(locations);
		}
		return locations.length;
	}

	/** Export all data as JSONL text. */
	async exportJsonl(): Promise<string> {
		if (!this.db) return '';
		const tx = this.db.transaction(STORE_NAME, 'readonly');
		const index = tx.objectStore(STORE_NAME).index('timestamp');
		const lines: string[] = [];

		let cursor = await index.openCursor();
		while (cursor) {
			lines.push(JSON.stringify(cursor.value));
			cursor = await cursor.continue();
		}

		return lines.join('\n');
	}

	/**
	 * Stream all records for stats computation.
	 * Yields batches to avoid loading everything into memory.
	 */
	async *getAllLocationsStream(batchSize: number = 1000): AsyncGenerator<BusLocation[]> {
		if (!this.db) return;
		const tx = this.db.transaction(STORE_NAME, 'readonly');
		const index = tx.objectStore(STORE_NAME).index('timestamp');
		let batch: BusLocation[] = [];

		let cursor = await index.openCursor();
		while (cursor) {
			batch.push(busLocationFromJsonLine(cursor.value));
			if (batch.length >= batchSize) {
				yield batch;
				batch = [];
			}
			cursor = await cursor.continue();
		}

		if (batch.length > 0) {
			yield batch;
		}
	}
}
