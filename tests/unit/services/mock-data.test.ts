import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ensureSampleLoaded, generateMockData, resetMockData } from '$lib/services/mock-data';

describe('mock-data', () => {
	beforeEach(() => {
		resetMockData();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('generateMockData returns empty array before loading', () => {
		const result = generateMockData();
		expect(result).toEqual([]);
	});

	it('ensureSampleLoaded fetches /sample.jsonl', async () => {
		const sampleData = [
			'{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}',
			'{"b":"b2","r":"2","t":"t2","la":64.15,"ln":-21.92,"d":1,"ts":1000}',
			'{"b":"b3","r":"3","t":"t3","la":64.16,"ln":-21.91,"d":0,"ts":2000}',
		].join('\n');

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(sampleData),
		}));

		await ensureSampleLoaded();
		expect(fetch).toHaveBeenCalledWith('/sample.jsonl');
	});

	it('after loading: generates snapshots with rebased timestamps', async () => {
		const sampleData = [
			'{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}',
			'{"b":"b2","r":"2","t":"t2","la":64.15,"ln":-21.92,"d":1,"ts":1000}',
			'{"b":"b3","r":"3","t":"t3","la":64.16,"ln":-21.91,"d":0,"ts":2000}',
		].join('\n');

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(sampleData),
		}));

		await ensureSampleLoaded();

		const snapshot1 = generateMockData();
		expect(snapshot1.length).toBeGreaterThan(0);

		// First snapshot has ts=1000 (2 buses), timestamps should be rebased to now
		expect(snapshot1[0].busId).toBe('b1');
		expect(snapshot1[0].timestamp).toBeGreaterThan(1000); // rebased
		expect(snapshot1).toHaveLength(2); // 2 buses at ts=1000
	});

	it('resetMockData resets index to 0', async () => {
		const sampleData = [
			'{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}',
			'{"b":"b2","r":"2","t":"t2","la":64.15,"ln":-21.92,"d":1,"ts":2000}',
		].join('\n');

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(sampleData),
		}));

		await ensureSampleLoaded();

		const first = generateMockData();
		generateMockData(); // advance
		resetMockData();
		const afterReset = generateMockData();
		expect(afterReset[0].busId).toBe(first[0].busId);
	});

	it('loops back when snapshots exhausted', async () => {
		const sampleData = [
			'{"b":"b1","r":"1","t":"t1","la":64.14,"ln":-21.93,"d":0,"ts":1000}',
			'{"b":"b2","r":"2","t":"t2","la":64.15,"ln":-21.92,"d":1,"ts":2000}',
		].join('\n');

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(sampleData),
		}));

		await ensureSampleLoaded();

		const snap1 = generateMockData();
		const snap2 = generateMockData();
		// Loop: third call should wrap around
		const snap3 = generateMockData();
		expect(snap3[0].busId).toBe(snap1[0].busId);
	});
});
