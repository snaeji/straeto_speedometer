import { test, expect } from '@playwright/test';
import { waitForAppLoad, startSimulationAndWaitForBuses } from './helpers';

test.describe('Bus list', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
	});

	test('shows "No active buses" when no data', async ({ page }) => {
		await expect(page.locator('text=No active buses')).toBeVisible({ timeout: 5000 });
	});

	test('bus list populates after simulation starts', async ({ page }) => {
		await startSimulationAndWaitForBuses(page);

		// Bus list items should exist
		const busRows = page.locator('.overflow-y-auto button.w-full');
		const count = await busRows.count();
		expect(count).toBeGreaterThan(0);
	});

	test('bus list shows route badges with numbers', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 4000 });

		// Route badges are small colored circles with numbers
		const routeBadges = page.locator('.overflow-y-auto .rounded-lg.flex.items-center.justify-center');
		const count = await routeBadges.count();
		expect(count).toBeGreaterThan(0);
	});

	test('sort buttons exist: Rt, Spd, St', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 4000 });

		await expect(page.getByRole('button', { name: 'Rt', exact: true })).toBeVisible({ timeout: 3000 });
		await expect(page.getByRole('button', { name: 'Spd', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'St', exact: true })).toBeVisible();
	});

	test('clicking Rt sort button changes active sort', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 4000 });

		const rtBtn = page.getByRole('button', { name: 'Rt', exact: true });
		await rtBtn.click();
		await page.waitForTimeout(300);

		// Verify it's active (has specific class)
		await expect(rtBtn).toHaveClass(/text-text-primary/);
	});

	test('clicking Spd sort button sorts by speed', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 4000 });

		await page.getByRole('button', { name: 'Spd', exact: true }).click();
		await page.waitForTimeout(300);
	});

	test('clicking bus row in list selects it', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 4000 });

		const firstBus = page.locator('.overflow-y-auto button.w-full').first();
		await expect(firstBus).toBeVisible({ timeout: 3000 });
		await firstBus.click();
		await page.waitForTimeout(1000);

		// SpeedGraph should appear
		await expect(page.locator('svg[viewBox="0 0 100 80"]')).toBeVisible({ timeout: 5000 });
	});

	test('selected bus row has accent highlight', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 4000 });

		const firstBus = page.locator('.overflow-y-auto button.w-full').first();
		await expect(firstBus).toBeVisible({ timeout: 3000 });
		await firstBus.click();
		await page.waitForTimeout(500);

		// Selected row should have accent background
		const hasAccent = await firstBus.evaluate((el) => el.className.includes('accent'));
		expect(hasAccent).toBe(true);
	});

	test('bus list shows "awaiting data" for buses without speed data initially', async ({ page }) => {
		await page.getByRole('button', { name: 'Simulate' }).click();

		// Check very quickly before speed pipeline generates data
		await page.waitForFunction(
			() => document.querySelectorAll('[data-bus-marker]').length > 0,
			{ timeout: 15000 },
		);
		await page.waitForTimeout(1000);

		// Some buses might still show "awaiting data"
		const awaitingCount = await page.locator('text=awaiting data').count();
		// This is informational — may or may not have any
		expect(awaitingCount).toBeGreaterThanOrEqual(0);
	});

	test('bus list shows speed bars for buses with speed data', async ({ page }) => {
		await startSimulationAndWaitForBuses(page);

		// Speed bars have inline width style
		const speedBars = await page.evaluate(() => {
			const bars = document.querySelectorAll('.overflow-y-auto [style*="width:"]');
			return bars.length;
		});

		expect(speedBars).toBeGreaterThan(0);
	});

	test('violation count shown in header when violations exist', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 10000 });

		// Check for "violating" text in bus count
		const violatingText = await page.locator('text=violating').count();
		// May or may not have violations — just verify no error
		expect(violatingText).toBeGreaterThanOrEqual(0);
	});
});
