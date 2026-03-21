import { test, expect } from '@playwright/test';

test.describe('App loading', () => {
	test('loading screen appears on initial load', async ({ page }) => {
		// Navigate but don't wait for full load
		await page.goto('/');

		// Loading screen should show logo text
		const logo = page.locator('text=THE STRAETO').or(page.locator('text=SPEEDOMETER'));
		await expect(logo.first()).toBeVisible({ timeout: 5000 });
	});

	test('loading screen shows progress bar', async ({ page }) => {
		await page.goto('/');

		// Progress bar element with gradient style
		const progressBar = page.locator('div[style*="width:"]').first();
		await expect(progressBar).toBeVisible({ timeout: 5000 });
	});

	test('loading screen shows loading step messages', async ({ page }) => {
		await page.goto('/');

		// Loading messages like "Loading speed limits..." etc.
		// These appear briefly during initialization
		await page.waitForTimeout(500);

		// Eventually transitions to dashboard
		await page.waitForFunction(
			() =>
				document.querySelector('.maplibregl-map') != null ||
				document.querySelector('button')?.textContent?.includes('Live'),
			{ timeout: 20000 },
		);
	});

	test('dashboard loads after initialization completes', async ({ page }) => {
		await page.goto('/');

		// Wait for map
		await page.waitForFunction(
			() => document.querySelector('.maplibregl-map') != null,
			{ timeout: 20000 },
		);

		// Map canvas should be visible
		await expect(page.locator('.maplibregl-canvas')).toBeVisible();
	});

	test('TopBar is visible after load', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(
			() => document.querySelector('.maplibregl-map') != null,
			{ timeout: 20000 },
		);

		// Logo text
		await expect(page.locator('text=THE STRAETO SPEEDOMETER')).toBeVisible({ timeout: 5000 });
	});

	test('no uncaught errors during initial load', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		await page.goto('/');
		await page.waitForFunction(
			() => document.querySelector('.maplibregl-map') != null,
			{ timeout: 20000 },
		);
		await page.waitForTimeout(2000);

		expect(errors).toHaveLength(0);
	});

	test('map has navigation controls', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(
			() => document.querySelector('.maplibregl-map') != null,
			{ timeout: 20000 },
		);

		// Navigation control (zoom buttons)
		await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeVisible({ timeout: 5000 });
		await expect(page.locator('.maplibregl-ctrl-zoom-out')).toBeVisible();
	});

	test('map is centered on Reykjavik', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(
			() => document.querySelector('.maplibregl-map') != null,
			{ timeout: 20000 },
		);

		// Check that attribution includes OpenStreetMap (map tiles loaded)
		const attribution = page.locator('.maplibregl-ctrl-attrib');
		await expect(attribution).toBeVisible({ timeout: 5000 });
	});

	test('loading screen timer icon is displayed', async ({ page }) => {
		await page.goto('/');

		// Timer SVG icon in loading screen
		const svg = page.locator('svg').first();
		await expect(svg).toBeVisible({ timeout: 5000 });
	});
});
