import { test, expect } from '@playwright/test';

test.describe('Ghost dot on map from SpeedGraph hover', () => {
	test('hovering over speed chart shows ghost marker on map', async ({ page }) => {
		await page.goto('/');

		// Wait for app to load
		await page.waitForFunction(() => {
			return document.querySelector('.maplibregl-map') != null;
		}, { timeout: 15000 });

		// Start simulation to get bus data
		const simBtn = page.getByRole('button', { name: 'Simulate' });
		await simBtn.click();

		// Wait for bus markers to appear and accumulate speed data
		await page.waitForFunction(() => {
			return document.querySelectorAll('.maplibregl-marker').length > 0;
		}, { timeout: 10000 });
		await page.waitForTimeout(6000);

		// Click the first bus marker to select it
		const firstMarker = page.locator('.maplibregl-marker').first();
		await firstMarker.click();

		// Wait for SpeedGraph chart canvas to render
		const chartCanvas = page.locator('.glass-strong canvas').first();
		await expect(chartCanvas).toBeVisible({ timeout: 5000 });
		await page.waitForTimeout(3000);

		// Get chart canvas bounding box
		const box = await chartCanvas.boundingBox();
		expect(box).not.toBeNull();

		// No ghost dot before hover
		let ghostDot = page.locator('[data-ghost-dot]');
		await expect(ghostDot).toHaveCount(0);

		// Move mouse across the chart and check for ghost dot at each position
		let ghostAppeared = false;
		for (let i = 0; i < 5; i++) {
			const x = box!.x + (box!.width * (0.2 + i * 0.15));
			await page.mouse.move(x, box!.y + box!.height / 2);
			await page.waitForTimeout(300);

			const count = await page.locator('[data-ghost-dot]').count();
			if (count > 0) {
				ghostAppeared = true;
				break;
			}
		}

		expect(ghostAppeared).toBe(true);
	});
});
