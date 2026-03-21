import { type Page, expect } from '@playwright/test';

/** Wait for the app to fully initialize (map loaded, dashboard visible). */
export async function waitForAppLoad(page: Page) {
	// Wait for map container to be present
	await page.waitForSelector('.maplibregl-map', { timeout: 20000 });
	// Wait for mode switcher buttons to be rendered
	await page.waitForSelector('button:has-text("Live")', { timeout: 10000 });
}

/** Start simulation and wait for bus markers to appear on the map. */
export async function startSimulationAndWaitForBuses(page: Page, { minBuses = 1, waitAfter = 6000 } = {}) {
	const simBtn = page.getByRole('button', { name: 'Simulate' });
	await expect(simBtn).toBeVisible({ timeout: 5000 });
	await simBtn.click();

	await page.waitForFunction(
		(min) => document.querySelectorAll('[data-bus-marker]').length >= min,
		minBuses,
		{ timeout: 15000 },
	);

	// Let speed pipeline accumulate data
	if (waitAfter > 0) await page.waitForTimeout(waitAfter);
}

/** Click the first visible bus marker on the map to select it. */
export async function selectFirstBus(page: Page) {
	const marker = page.locator('[data-bus-marker]').first();
	await expect(marker).toBeVisible({ timeout: 5000 });
	await marker.click();
	// Wait for SpeedGraph panel to appear
	await expect(page.locator('.glass-strong').first()).toBeVisible({ timeout: 3000 });
}

/** Get the bounding box of the speed chart canvas. */
export async function getChartBox(page: Page) {
	const canvas = page.locator('.glass-strong canvas').first();
	await expect(canvas).toBeVisible({ timeout: 5000 });
	await page.waitForTimeout(2000); // Let chart data render
	const box = await canvas.boundingBox();
	expect(box).not.toBeNull();
	return box!;
}

/** Sweep mouse across a chart canvas at evenly spaced positions. */
export async function sweepChart(page: Page, box: { x: number; y: number; width: number; height: number }, steps = 5, pauseMs = 300) {
	for (let i = 0; i < steps; i++) {
		const x = box.x + box.width * (0.15 + i * (0.7 / (steps - 1)));
		await page.mouse.move(x, box.y + box.height / 2);
		await page.waitForTimeout(pauseMs);
	}
}

/** Count the number of elements matching a selector. */
export async function countElements(page: Page, selector: string): Promise<number> {
	return page.locator(selector).count();
}

/** Ensure we're on Live mode. */
export async function ensureLiveMode(page: Page) {
	const liveTab = page.getByRole('button', { name: 'Live', exact: true });
	if (await liveTab.isVisible()) {
		await liveTab.click();
		await page.waitForTimeout(300);
	}
}
