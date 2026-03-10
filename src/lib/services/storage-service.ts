import { openDB, type IDBPDatabase } from 'idb';
import { busLocationFromJsonLine, busLocationToJsonLine, type BusLocation } from '$lib/types/bus';

const DB_NAME = 'straeto_speedometer_v2';
const DB_VERSION = 1;
const STORE_NAME = 'bus_locations';

type StraetoDb = IDBPDatabase;

export class StorageService {
	private db: StraetoDb | null = null;

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
		if (!this.db) return;
		const tx = this.db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		for (const loc of locations) {
			const key = `${loc.timestamp}_${loc.busId}`;
			await store.put(busLocationToJsonLine(loc), key);
		}
		await tx.done;
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
		const lines = text.split('\n').filter((l) => l.trim());
		const locations: BusLocation[] = [];

		for (const line of lines) {
			try {
				const json = JSON.parse(line);
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
