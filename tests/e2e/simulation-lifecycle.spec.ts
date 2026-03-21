import { test, expect } from '@playwright/test';
import { waitForAppLoad, ensureLiveMode } from './helpers';

test.describe('Simulation lifecycle', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
		await ensureLiveMode(page);
	});

	test('Simulate button is visible in idle state', async ({ page }) => {
		const simBtn = page.getByRole('button', { name: 'Simulate' });
		await expect(simBtn).toBeVisible();
	});

	test('Start Recording button is visible in idle state', async ({ page }) => {
		const recBtn = page.getByRole('button', { name: 'Start Recording' });
		await expect(recBtn).toBeVisible();
	});

	test('Monitor button is visible in idle state', async ({ page }) => {
		const monBtn = page.getByRole('button', { name: 'Monitor' });
		await expect(monBtn).toBeVisible();
	});

	test('clicking Simulate starts simulation and shows Stop Simulation', async ({ page }) => {
		await page.getByRole('button', { name: 'Simulate' }).click();

		const stopBtn = page.getByRole('button', { name: 'Stop Simulation' });
		await expect(stopBtn).toBeVisible({ timeout: 5000 });
	});

	test('simulation shows recording stats grid (Time, Records, Violations)', async ({ page }) => {
		await page.getByRole('button', { name: 'Simulate' }).click();
		await page.waitForTimeout(3000);

		// Stats grid should be visible
		const timeLabel = page.locator('text=Time').first();
		const recordsLabel = page.locator('text=Records').first();
		const violationsLabel = page.locator('text=Violations').first();

		await expect(timeLabel).toBeVisible({ timeout: 5000 });
		await expect(recordsLabel).toBeVisible();
		await expect(violationsLabel).toBeVisible();
	});

	test('simulation accumulates records over time', async ({ page }) => {
		await page.getByRole('button', { name: 'Simulate' }).click();
		await page.waitForTimeout(5000);

		// Records count should be > 0
		const recordsText = await page.evaluate(() => {
			const els = document.querySelectorAll('.font-mono.text-text-primary');
			for (const el of els) {
				const prev = el.previousElementSibling;
				if (prev?.textContent?.includes('Records')) return el.textContent;
			}
			return '0';
		});

		const count = parseInt(recordsText?.replace(/,/g, '') || '0', 10);
		expect(count).toBeGreaterThan(0);
	});

	test('simulation creates bus markers on the map', async ({ page }) => {
		// No markers initially
		expect(await page.locator('[data-bus-marker]').count()).toBe(0);

		await page.getByRole('button', { name: 'Simulate' }).click();

		await page.waitForFunction(
			() => document.querySelectorAll('[data-bus-marker]').length > 0,
			{ timeout: 15000 },
		);

		const markerCount = await page.locator('[data-bus-marker]').count();
		expect(markerCount).toBeGreaterThan(0);
	});

	test('stopping simulation shows idle buttons again', async ({ page }) => {
		await page.getByRole('button', { name: 'Simulate' }).click();
		await page.waitForTimeout(3000);

		// Stop
		await page.getByRole('button', { name: 'Stop Simulation' }).click();
		await page.waitForTimeout(500);

		// Idle buttons should reappear
		await expect(page.getByRole('button', { name: 'Start Recording' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Monitor' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Simulate' })).toBeVisible();
	});

	test('Monitor and Simulate buttons hidden during simulation', async ({ page }) => {
		await page.getByRole('button', { name: 'Simulate' }).click();
		await page.waitForTimeout(1000);

		// Secondary buttons should be hidden
		await expect(page.getByRole('button', { name: 'Monitor' })).not.toBeVisible();
		await expect(page.getByRole('button', { name: 'Simulate' })).not.toBeVisible();
	});

	test('simulation shows live indicator in top bar', async ({ page }) => {
		await page.getByRole('button', { name: 'Simulate' }).click();
		await page.waitForTimeout(4000);

		// KPI cards should update — look for bus count > 0
		const busKpi = await page.evaluate(() => {
			const cards = document.querySelectorAll('.font-mono.tabular-nums');
			for (const card of cards) {
				const val = parseInt(card.textContent || '0', 10);
				if (val > 0) return val;
			}
			return 0;
		});

		expect(busKpi).toBeGreaterThan(0);
	});

	test('elapsed time increments during simulation', async ({ page }) => {
		await page.getByRole('button', { name: 'Simulate' }).click();
		await page.waitForTimeout(2000);

		const time1 = await page.evaluate(() => {
			const els = document.querySelectorAll('.font-mono.text-text-primary');
			for (const el of els) {
				const prev = el.previousElementSibling;
				if (prev?.textContent?.includes('Time')) return el.textContent;
			}
			return '0:00';
		});

		await page.waitForTimeout(3000);

		const time2 = await page.evaluate(() => {
			const els = document.querySelectorAll('.font-mono.text-text-primary');
			for (const el of els) {
				const prev = el.previousElementSibling;
				if (prev?.textContent?.includes('Time')) return el.textContent;
			}
			return '0:00';
		});

		// Time should have advanced
		expect(time2).not.toBe(time1);
	});

	test('no console errors during simulation lifecycle', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		await page.getByRole('button', { name: 'Simulate' }).click();
		await page.waitForTimeout(8000);
		await page.getByRole('button', { name: 'Stop Simulation' }).click();
		await page.waitForTimeout(1000);

		expect(errors).toHaveLength(0);
	});
});
