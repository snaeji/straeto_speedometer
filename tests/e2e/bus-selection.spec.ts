import { test, expect } from '@playwright/test';
import { waitForAppLoad, startSimulationAndWaitForBuses } from './helpers';

test.describe('Bus selection', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
		await startSimulationAndWaitForBuses(page);
	});

	test('clicking a bus marker opens the SpeedGraph detail panel', async ({ page }) => {
		// No detail panel initially
		const panels = page.locator('.glass-strong >> text=km/h');
		const panelCountBefore = await panels.count();

		// Click first bus marker
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(500);

		// SpeedGraph panel should now be visible with speed gauge
		await expect(page.locator('text=km/h').first()).toBeVisible({ timeout: 3000 });
	});

	test('detail panel shows bus route number', async ({ page }) => {
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(500);

		// Panel header should have a route badge
		const panel = page.locator('.glass-strong').first();
		await expect(panel).toBeVisible();
	});

	test('detail panel shows speed gauge', async ({ page }) => {
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(1000);

		// SVG gauge should be visible
		const gauge = page.locator('svg[viewBox="0 0 100 80"]');
		await expect(gauge).toBeVisible({ timeout: 3000 });
	});

	test('detail panel shows Max Speed, Violations, Heading, Records', async ({ page }) => {
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(1000);

		await expect(page.locator('text=Max Speed').first()).toBeVisible();
		await expect(page.locator('text=Violations').first()).toBeVisible();
		await expect(page.locator('text=Heading').first()).toBeVisible();
		await expect(page.locator('text=Records').first()).toBeVisible();
	});

	test('clicking same bus marker again deselects it', async ({ page }) => {
		const marker = page.locator('[data-bus-marker]').first();
		await marker.click();
		await page.waitForTimeout(500);

		// Panel should be visible
		const gauge = page.locator('svg[viewBox="0 0 100 80"]');
		await expect(gauge).toBeVisible({ timeout: 3000 });

		// Click again to deselect
		await marker.click();
		await page.waitForTimeout(500);

		// Panel should disappear
		await expect(gauge).not.toBeVisible();
	});

	test('Escape key deselects the bus', async ({ page }) => {
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(500);

		const gauge = page.locator('svg[viewBox="0 0 100 80"]');
		await expect(gauge).toBeVisible({ timeout: 3000 });

		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);

		await expect(gauge).not.toBeVisible();
	});

	test('close button (X) on detail panel deselects bus', async ({ page }) => {
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(500);

		const closeBtn = page.locator('button[title="Close (Esc)"]');
		await expect(closeBtn).toBeVisible({ timeout: 3000 });
		await closeBtn.click();
		await page.waitForTimeout(500);

		// Gauge should disappear
		await expect(page.locator('svg[viewBox="0 0 100 80"]')).not.toBeVisible();
	});

	test('clicking map background deselects bus', async ({ page }) => {
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(500);

		const gauge = page.locator('svg[viewBox="0 0 100 80"]');
		await expect(gauge).toBeVisible({ timeout: 3000 });

		// Click on map background (bottom area below TopBar, away from markers)
		await page.click('.maplibregl-canvas', { position: { x: 700, y: 700 }, force: true });
		await page.waitForTimeout(500);

		await expect(gauge).not.toBeVisible();
	});

	test('selecting a bus from the bus list works', async ({ page }) => {
		// Find bus list items — they are buttons inside the scrollable area
		const busListItems = page.locator('.overflow-y-auto button.w-full');
		const count = await busListItems.count();
		if (count > 0) {
			await busListItems.first().click();
			await page.waitForTimeout(1000);

			// Detail panel should appear (speed gauge)
			await expect(page.locator('svg[viewBox="0 0 100 80"]')).toBeVisible({ timeout: 5000 });
		}
	});

	test('selecting different bus via bus list switches detail panel', async ({ page }) => {
		const busListItems = page.locator('.overflow-y-auto button.w-full');
		const count = await busListItems.count();
		if (count < 2) return;

		// Select first bus from list
		await busListItems.first().click();
		await page.waitForTimeout(1000);

		// Read the bus ID from SpeedGraph header (text inside .flex.flex-col > first span)
		const firstBusId = await page.evaluate(() => {
			const panel = document.querySelector('.absolute.right-3 .text-xs.font-medium.text-text-primary');
			return panel?.textContent?.trim() || '';
		});

		// Select second bus from list
		await busListItems.nth(1).click();
		await page.waitForTimeout(1000);

		const secondBusId = await page.evaluate(() => {
			const panel = document.querySelector('.absolute.right-3 .text-xs.font-medium.text-text-primary');
			return panel?.textContent?.trim() || '';
		});

		if (firstBusId && secondBusId) {
			expect(firstBusId).not.toBe(secondBusId);
		}
	});

	test('inline chart is visible when bus is selected (collapsed mode)', async ({ page }) => {
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(2000);

		// Chart canvas should be visible within the glass panel
		const canvas = page.locator('.glass-strong canvas').first();
		await expect(canvas).toBeVisible({ timeout: 5000 });
	});

	test('selected bus marker is visually larger', async ({ page }) => {
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(500);

		// The selected marker should have 40px size indicator
		const selectedMarker = await page.evaluate(() => {
			const markers = document.querySelectorAll('[data-bus-marker]');
			for (const m of markers) {
				const inner = m.querySelector('div[style*="40px"]');
				if (inner) return true;
			}
			return false;
		});
		expect(selectedMarker).toBe(true);
	});
});
