import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { StorageService } from '$lib/services/storage-service';
import { makeBusLocation } from '../../fixtures';
import type { BusLocation } from '$lib/types/bus';

describe('StorageService', () => {
	let svc: StorageService;

	beforeEach(async () => {
		svc = new StorageService();
		await svc.open();
	});

	afterEach(async () => {
		await svc.clearAll();
	});

	describe('open', () => {
		it('creates database and object store', async () => {
			// If open() worked, we can store/retrieve data
			const count = await svc.getRecordCount();
			expect(count).toBe(0);
		});
	});

	describe('store + retrieve', () => {
		it('roundtrips through storeBatch and getLocationsInRange', async () => {
			const locs = [
				makeBusLocation({ busId: 'b1', timestamp: 1000 }),
				makeBusLocation({ busId: 'b2', timestamp: 2000 }),
			];
			await svc.storeBatch(locs);

			const retrieved = await svc.getLocationsInRange(0, 3000);
			expect(retrieved).toHaveLength(2);
			expect(retrieved[0].busId).toBe('b1');
			expect(retrieved[1].busId).toBe('b2');
		});
	});

	describe('getTimeRange', () => {
		it('returns correct min/max timestamps', async () => {
			await svc.storeBatch([
				makeBusLocation({ busId: 'b1', timestamp: 5000 }),
				makeBusLocation({ busId: 'b2', timestamp: 10000 }),
				makeBusLocation({ busId: 'b3', timestamp: 7000 }),
			]);
			const range = await svc.getTimeRange();
			expect(range).not.toBeNull();
			expect(range![0]).toBe(5000);
			expect(range![1]).toBe(10000);
		});

		it('returns null for empty store', async () => {
			const range = await svc.getTimeRange();
			expect(range).toBeNull();
		});
	});

	describe('getRecordCount', () => {
		it('returns correct count', async () => {
			await svc.storeBatch([
				makeBusLocation({ busId: 'b1', timestamp: 1000 }),
				makeBusLocation({ busId: 'b2', timestamp: 2000 }),
				makeBusLocation({ busId: 'b3', timestamp: 3000 }),
			]);
			expect(await svc.getRecordCount()).toBe(3);
		});
	});

	describe('clearAll', () => {
		it('empties the store', async () => {
			await svc.storeBatch([makeBusLocation({ timestamp: 1000 })]);
			expect(await svc.getRecordCount()).toBe(1);
			await svc.clearAll();
			expect(await svc.getRecordCount()).toBe(0);
		});
	});

	describe('importJsonl', () => {
		it('imports valid JSONL lines', async () => {
			const text = [
				'{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}',
				'{"b":"b2","r":"2","t":"t2","la":64.15,"ln":-21.92,"d":1,"ts":2000}',
			].join('\n');

			const count = await svc.importJsonl(text);
			expect(count).toBe(2);
			expect(await svc.getRecordCount()).toBe(2);
		});

		it('skips invalid lines', async () => {
			const text = [
				'{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}',
				'not json',
				'{"b":123,"r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}', // numeric busId (not string)
				'{"b":"b3","r":"3","t":"t3","la":64.14,"ln":-21.93,"d":0,"ts":3000}',
			].join('\n');

			const count = await svc.importJsonl(text);
			expect(count).toBe(2); // skips invalid JSON and numeric busId
		});

		it('validates required fields', async () => {
			const lines = [
				'{"r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}', // missing b
				'{"b":"b1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}', // missing r
				'{"b":"b1","r":"1","t":"t1","ln":-21.93,"d":0,"ts":1000}', // missing la
				'{"b":"b1","r":"1","t":"t1","la":64.14,"d":0,"ts":1000}', // missing ln
				'{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0}', // missing ts
			].join('\n');
			const count = await svc.importJsonl(lines);
			expect(count).toBe(0);
		});

		it('throws on text >100MB', async () => {
			const huge = 'x'.repeat(101 * 1024 * 1024);
			await expect(svc.importJsonl(huge)).rejects.toThrow(/too large/i);
		});
	});

	describe('exportJsonl', () => {
		it('exports correct JSONL text', async () => {
			await svc.storeBatch([
				makeBusLocation({ busId: 'b1', timestamp: 1000 }),
				makeBusLocation({ busId: 'b2', timestamp: 2000 }),
			]);
			const text = await svc.exportJsonl();
			const lines = text.split('\n');
			expect(lines).toHaveLength(2);
			const parsed = JSON.parse(lines[0]);
			expect(parsed.b).toBe('b1');
		});
	});

	describe('getBusHistory', () => {
		it('filters by busId', async () => {
			const now = Date.now();
			await svc.storeBatch([
				makeBusLocation({ busId: 'b1', timestamp: now - 1000 }),
				makeBusLocation({ busId: 'b2', timestamp: now - 500 }),
				makeBusLocation({ busId: 'b1', timestamp: now - 200 }),
			]);
			const history = await svc.getBusHistory('b1', 1);
			expect(history.every((l) => l.busId === 'b1')).toBe(true);
			expect(history).toHaveLength(2);
		});
	});

	describe('getAllLocationsStream', () => {
		it('yields batches of correct size', async () => {
			const locs: BusLocation[] = [];
			for (let i = 0; i < 5; i++) {
				locs.push(makeBusLocation({ busId: `b${i}`, timestamp: i * 1000 }));
			}
			await svc.storeBatch(locs);

			const batches: BusLocation[][] = [];
			for await (const batch of svc.getAllLocationsStream(2)) {
				batches.push(batch);
			}
			// 5 records, batch size 2 → 3 batches (2, 2, 1)
			expect(batches).toHaveLength(3);
			expect(batches[0]).toHaveLength(2);
			expect(batches[2]).toHaveLength(1);
		});
	});

	describe('write lock', () => {
		it('concurrent storeBatch calls do not corrupt data', async () => {
			const locs1 = [makeBusLocation({ busId: 'b1', timestamp: 1000 })];
			const locs2 = [makeBusLocation({ busId: 'b2', timestamp: 2000 })];
			await Promise.all([svc.storeBatch(locs1), svc.storeBatch(locs2)]);
			expect(await svc.getRecordCount()).toBe(2);
		});
	});

	describe('null db guards', () => {
		it('returns safely when db is not opened', async () => {
			const fresh = new StorageService();
			// All methods should return empty/0/null without throwing
			expect(await fresh.getLocationsInRange(0, 1000)).toEqual([]);
			expect(await fresh.getTimeRange()).toBeNull();
			expect(await fresh.getRecordCount()).toBe(0);
			expect(await fresh.getBusHistory('b1')).toEqual([]);
			expect(await fresh.exportJsonl()).toBe('');

			const batches: BusLocation[][] = [];
			for await (const batch of fresh.getAllLocationsStream()) {
				batches.push(batch);
			}
			expect(batches).toHaveLength(0);
		});
	});

	describe('import edge cases', () => {
		it('skips lines with NaN lat', async () => {
			const text = '{"b":"b1","r":"1","t":"t1","la":NaN,"ln":-21.93,"d":0,"ts":1000}';
			// NaN is not valid JSON, so JSON.parse will fail → line skipped
			const count = await svc.importJsonl(text);
			expect(count).toBe(0);
		});

		it('skips lines with negative timestamp', async () => {
			const text = '{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":-1}';
			const count = await svc.importJsonl(text);
			expect(count).toBe(0);
		});

		it('skips lines with zero timestamp', async () => {
			const text = '{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":0}';
			const count = await svc.importJsonl(text);
			expect(count).toBe(0);
		});

		it('imports empty string as 0 records', async () => {
			const count = await svc.importJsonl('');
			expect(count).toBe(0);
		});

		it('handles lines with trailing whitespace', async () => {
			const text = '{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}  \n  ';
			const count = await svc.importJsonl(text);
			expect(count).toBe(1);
		});

		it('skips Infinity in lat', async () => {
			const text = '{"b":"b1","r":"1","t":"t1","la":Infinity,"ln":-21.93,"d":0,"ts":1000}';
			const count = await svc.importJsonl(text);
			expect(count).toBe(0); // JSON.parse fails on Infinity
		});
	});
});
