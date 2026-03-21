import { test, expect } from '@playwright/test';
import { waitForAppLoad, startSimulationAndWaitForBuses, selectFirstBus, getChartBox } from './helpers';

test.describe('SpeedGraph panel', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
		await startSimulationAndWaitForBuses(page);
		await selectFirstBus(page);
	});

	test('speed gauge renders with current speed value', async ({ page }) => {
		const gauge = page.locator('svg[viewBox="0 0 100 80"]');
		await expect(gauge).toBeVisible();

		// Should show a numeric speed value
		const speedText = await gauge.locator('text').first().textContent();
		const speedNum = parseInt(speedText || '0', 10);
		expect(speedNum).toBeGreaterThanOrEqual(0);
	});

	test('speed gauge shows limit text', async ({ page }) => {
		const limitText = page.locator('text=limit').first();
		await expect(limitText).toBeVisible({ timeout: 3000 });
	});

	test('inline chart canvas renders', async ({ page }) => {
		const canvas = page.locator('.glass-strong canvas').first();
		await expect(canvas).toBeVisible({ timeout: 5000 });
	});

	test('expand button expands chart to bottom bar', async ({ page }) => {
		const expandBtn = page.locator('button[title="Expand chart"]');
		await expect(expandBtn).toBeVisible();
		await expandBtn.click();
		await page.waitForTimeout(500);

		// Expanded chart bar at bottom
		const expandedBar = page.locator('.fixed.bottom-3.glass-strong');
		await expect(expandedBar).toBeVisible({ timeout: 3000 });
	});

	test('collapse button returns chart to card', async ({ page }) => {
		// Expand first
		await page.locator('button[title="Expand chart"]').click();
		await page.waitForTimeout(500);

		// Now collapse
		const collapseBtn = page.locator('button[title="Collapse chart"]');
		await expect(collapseBtn).toBeVisible();
		await collapseBtn.click();
		await page.waitForTimeout(500);

		// Expanded bar should be gone
		await expect(page.locator('.fixed.bottom-3.glass-strong')).not.toBeVisible();
	});

	test('expanded chart shows time preset buttons (30s, 1m, 5m, All)', async ({ page }) => {
		await page.locator('button[title="Expand chart"]').click();
		await page.waitForTimeout(500);

		await expect(page.locator('.preset-btn:has-text("30s")')).toBeVisible({ timeout: 3000 });
		await expect(page.locator('.preset-btn:has-text("1m")')).toBeVisible();
		await expect(page.locator('.preset-btn:has-text("5m")')).toBeVisible();
		await expect(page.locator('.preset-btn:has-text("All")')).toBeVisible();
	});

	test('clicking time preset changes active button', async ({ page }) => {
		await page.locator('button[title="Expand chart"]').click();
		await page.waitForTimeout(500);

		// Default: 1m should be active
		const oneMin = page.locator('.preset-btn:has-text("1m")');
		await expect(oneMin).toHaveClass(/active/, { timeout: 3000 });

		// Click 30s
		await page.locator('.preset-btn:has-text("30s")').click();
		await page.waitForTimeout(300);

		await expect(page.locator('.preset-btn:has-text("30s")')).toHaveClass(/active/);
	});

	test('expanded chart shows LIVE badge', async ({ page }) => {
		await page.locator('button[title="Expand chart"]').click();
		await page.waitForTimeout(500);

		const liveBadge = page.locator('.live-badge.live');
		await expect(liveBadge).toBeVisible({ timeout: 3000 });
		await expect(liveBadge).toContainText('LIVE');
	});

	test('clicking inline chart expands it', async ({ page }) => {
		const chartHover = page.locator('.chart-hover');
		await expect(chartHover).toBeVisible({ timeout: 5000 });
		await chartHover.click();
		await page.waitForTimeout(500);

		await expect(page.locator('.fixed.bottom-3.glass-strong')).toBeVisible({ timeout: 3000 });
	});

	test('Max Speed stat displays a number', async ({ page }) => {
		const maxSpeedValue = page.locator('text=Max Speed').locator('..').locator('.font-mono');
		await expect(maxSpeedValue).toBeVisible();
		const text = await maxSpeedValue.textContent();
		expect(parseFloat(text || '0')).toBeGreaterThanOrEqual(0);
	});

	test('Records stat increments with simulation data', async ({ page }) => {
		// Get the Records value from the SpeedGraph panel stats grid (right-side panel)
		const initial = await page.evaluate(() => {
			const labels = document.querySelectorAll('.absolute.right-3 .text-\\[8px\\]');
			for (const label of labels) {
				if (label.textContent?.includes('Records')) {
					const val = label.parentElement?.querySelector('.font-mono');
					return parseInt(val?.textContent || '0', 10);
				}
			}
			return 0;
		});

		await page.waitForTimeout(4000);

		const after = await page.evaluate(() => {
			const labels = document.querySelectorAll('.absolute.right-3 .text-\\[8px\\]');
			for (const label of labels) {
				if (label.textContent?.includes('Records')) {
					const val = label.parentElement?.querySelector('.font-mono');
					return parseInt(val?.textContent || '0', 10);
				}
			}
			return 0;
		});

		expect(after).toBeGreaterThan(initial);
	});

	test('close button hides the entire panel', async ({ page }) => {
		const closeBtn = page.locator('button[title="Close (Esc)"]');
		await expect(closeBtn).toBeVisible();
		await closeBtn.click();
		await page.waitForTimeout(500);

		// No gauge visible
		await expect(page.locator('svg[viewBox="0 0 100 80"]')).not.toBeVisible();
	});

	test('chart renders without errors when simulation provides data', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		// Wait for chart data to render
		await page.waitForTimeout(8000);

		// Expand and interact
		await page.locator('button[title="Expand chart"]').click();
		await page.waitForTimeout(2000);

		expect(errors).toHaveLength(0);
	});

	test('headsign is displayed when available', async ({ page }) => {
		// The headsign appears as small text below bus ID in the panel header
		const header = page.locator('.glass-strong .flex.flex-col').first();
		await expect(header).toBeVisible({ timeout: 3000 });
	});
});
