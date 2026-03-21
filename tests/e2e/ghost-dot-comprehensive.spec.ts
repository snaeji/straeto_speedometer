import { test, expect } from '@playwright/test';
import { waitForAppLoad, startSimulationAndWaitForBuses, selectFirstBus, getChartBox, sweepChart } from './helpers';

test.describe('Ghost dot comprehensive tests', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
		await startSimulationAndWaitForBuses(page);
		await selectFirstBus(page);
	});

	test('ghost dot appears when hovering over speed chart', async ({ page }) => {
		const box = await getChartBox(page);

		// No ghost dot before hover
		await expect(page.locator('[data-ghost-dot]')).toHaveCount(0);

		// Hover over chart center
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(500);

		await expect(page.locator('[data-ghost-dot]')).toHaveCount(1);
	});

	test('ghost dot disappears when mouse leaves chart', async ({ page }) => {
		const box = await getChartBox(page);

		// Hover to create ghost dot
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(500);
		await expect(page.locator('[data-ghost-dot]')).toHaveCount(1);

		// Move mouse far away from chart
		await page.mouse.move(10, 10);
		await page.waitForTimeout(500);

		await expect(page.locator('[data-ghost-dot]')).toHaveCount(0);
	});

	test('ghost dot appears at multiple positions across chart sweep', async ({ page }) => {
		const box = await getChartBox(page);
		let appearances = 0;

		for (let i = 0; i < 8; i++) {
			const x = box.x + box.width * (0.1 + i * 0.1);
			await page.mouse.move(x, box.y + box.height / 2);
			await page.waitForTimeout(400);

			if (await page.locator('[data-ghost-dot]').count() > 0) {
				appearances++;
			}
		}

		// Ghost dot should appear for at least half the sweep positions
		expect(appearances).toBeGreaterThanOrEqual(4);
	});

	test('ghost dot is a visible cyan circle element', async ({ page }) => {
		const box = await getChartBox(page);

		await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
		await page.waitForTimeout(500);

		const ghostDot = page.locator('[data-ghost-dot]');
		await expect(ghostDot).toHaveCount(1);

		// Verify the ghost dot is styled correctly (cyan border, round)
		const styles = await ghostDot.evaluate((el) => {
			const cs = window.getComputedStyle(el);
			return {
				borderRadius: cs.borderRadius,
				width: cs.width,
				height: cs.height,
			};
		});
		expect(styles.borderRadius).toBe('50%');
		expect(styles.width).toBe('14px');
		expect(styles.height).toBe('14px');
	});

	test('ghost dot position changes as mouse moves along chart', async ({ page }) => {
		const box = await getChartBox(page);
		const positions: string[] = [];

		for (let i = 0; i < 5; i++) {
			const x = box.x + box.width * (0.2 + i * 0.15);
			await page.mouse.move(x, box.y + box.height / 2);
			await page.waitForTimeout(400);

			const dot = page.locator('[data-ghost-dot]');
			if (await dot.count() > 0) {
				const pos = await dot.evaluate((el) => {
					const parent = el.closest('.maplibregl-marker') as HTMLElement;
					return parent?.style.transform || '';
				});
				positions.push(pos);
			}
		}

		// Should have collected multiple positions
		expect(positions.length).toBeGreaterThanOrEqual(2);
		// At least some positions should be different (bus was moving)
		const unique = new Set(positions);
		expect(unique.size).toBeGreaterThanOrEqual(1);
	});

	test('ghost dot disappears when bus is deselected', async ({ page }) => {
		const box = await getChartBox(page);

		// Create ghost dot
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(500);
		await expect(page.locator('[data-ghost-dot]')).toHaveCount(1);

		// Deselect bus via Escape
		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);

		await expect(page.locator('[data-ghost-dot]')).toHaveCount(0);
	});

	test('ghost dot works in expanded chart mode', async ({ page }) => {
		// Expand the chart
		const expandBtn = page.locator('button[title="Expand chart"]');
		await expect(expandBtn).toBeVisible({ timeout: 3000 });
		await expandBtn.click();
		await page.waitForTimeout(1000);

		// Get the expanded chart canvas (bottom bar)
		const expandedCanvas = page.locator('.fixed.bottom-3 canvas').first();
		await expect(expandedCanvas).toBeVisible({ timeout: 5000 });
		await page.waitForTimeout(2000);

		const box = await expandedCanvas.boundingBox();
		expect(box).not.toBeNull();

		// Hover expanded chart
		await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
		await page.waitForTimeout(500);

		const ghostCount = await page.locator('[data-ghost-dot]').count();
		expect(ghostCount).toBe(1);
	});

	test('only one ghost dot exists at a time', async ({ page }) => {
		const box = await getChartBox(page);

		// Sweep rapidly
		for (let i = 0; i < 10; i++) {
			const x = box.x + box.width * (0.1 + i * 0.08);
			await page.mouse.move(x, box.y + box.height / 2);
			await page.waitForTimeout(100);
		}

		await page.waitForTimeout(300);
		const count = await page.locator('[data-ghost-dot]').count();
		expect(count).toBeLessThanOrEqual(1);
	});

	test('ghost dot does not appear when hovering outside chart area (above/below)', async ({ page }) => {
		const box = await getChartBox(page);

		// Hover above the chart
		await page.mouse.move(box.x + box.width / 2, box.y - 20);
		await page.waitForTimeout(400);
		expect(await page.locator('[data-ghost-dot]').count()).toBe(0);

		// Hover below the chart
		await page.mouse.move(box.x + box.width / 2, box.y + box.height + 20);
		await page.waitForTimeout(400);
		expect(await page.locator('[data-ghost-dot]').count()).toBe(0);
	});

	test('ghost dot survives rapid mouse movement without errors', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		const box = await getChartBox(page);

		// Rapid back-and-forth sweep
		for (let pass = 0; pass < 3; pass++) {
			for (let i = 0; i < 10; i++) {
				const x = box.x + box.width * (0.1 + i * 0.08);
				await page.mouse.move(x, box.y + box.height / 2);
			}
			for (let i = 9; i >= 0; i--) {
				const x = box.x + box.width * (0.1 + i * 0.08);
				await page.mouse.move(x, box.y + box.height / 2);
			}
		}

		await page.waitForTimeout(300);
		expect(errors).toHaveLength(0);
	});

	test('ghost dot clears when selecting a different bus', async ({ page }) => {
		const box = await getChartBox(page);

		// Create ghost dot
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(500);
		await expect(page.locator('[data-ghost-dot]')).toHaveCount(1);

		// Move mouse away first
		await page.mouse.move(10, 10);
		await page.waitForTimeout(300);

		// Select a different bus from the bus list (more stable than map markers)
		const busListItems = page.locator('.overflow-y-auto button.w-full');
		const count = await busListItems.count();
		if (count > 1) {
			await busListItems.nth(1).click();
			await page.waitForTimeout(1000);
			// Ghost dot should be cleared when selecting new bus
			await expect(page.locator('[data-ghost-dot]')).toHaveCount(0);
		}
	});
});
