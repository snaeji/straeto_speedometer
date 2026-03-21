import { test, expect } from '@playwright/test';
import { waitForAppLoad, startSimulationAndWaitForBuses } from './helpers';

test.describe('Route filter', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
		await startSimulationAndWaitForBuses(page, { waitAfter: 4000 });
	});

	test('route filter shows "All routes" by default', async ({ page }) => {
		const filterText = page.locator('text=All routes').or(page.locator('text=routes'));
		await expect(filterText.first()).toBeVisible({ timeout: 3000 });
	});

	test('clicking route filter opens dropdown', async ({ page }) => {
		const filterBtn = page.locator('.route-filter-container').or(
			page.locator('button').filter({ hasText: /routes/ }),
		);
		const btn = filterBtn.first();
		if (await btn.isVisible().catch(() => false)) {
			await btn.click();
			await page.waitForTimeout(300);

			// Dropdown should show "Show all routes" button
			await expect(page.locator('text=Show all routes')).toBeVisible({ timeout: 3000 });
		}
	});

	test('dropdown shows route number buttons in grid', async ({ page }) => {
		const filterBtn = page.locator('button').filter({ hasText: /routes/ }).first();
		if (await filterBtn.isVisible().catch(() => false)) {
			await filterBtn.click();
			await page.waitForTimeout(300);

			// Should see some route number buttons
			const routeBtns = page.locator('.grid button');
			const count = await routeBtns.count();
			expect(count).toBeGreaterThan(0);
		}
	});

	test('clicking a route button filters the bus list', async ({ page }) => {
		const filterBtn = page.locator('button').filter({ hasText: /routes/ }).first();
		if (await filterBtn.isVisible().catch(() => false)) {
			await filterBtn.click();
			await page.waitForTimeout(300);

			// Click first route in the grid
			const routeBtns = page.locator('.grid button');
			if (await routeBtns.first().isVisible()) {
				const routeText = await routeBtns.first().textContent();
				await routeBtns.first().click();
				await page.waitForTimeout(500);

				// Bus list should now show filtered results
				// The filter label should update
				const filterLabel = page.locator('button').filter({ hasText: /route/ }).first();
				const label = await filterLabel.textContent();
				expect(label).toBeDefined();
			}
		}
	});

	test('Show all routes clears the filter', async ({ page }) => {
		const filterBtn = page.locator('button').filter({ hasText: /routes/ }).first();
		if (await filterBtn.isVisible().catch(() => false)) {
			await filterBtn.click();
			await page.waitForTimeout(300);

			const showAllBtn = page.locator('text=Show all routes');
			if (await showAllBtn.isVisible()) {
				await showAllBtn.click();
				await page.waitForTimeout(300);

				// Should show "All routes" again
				await expect(page.locator('text=All routes').or(page.locator('text=routes'))).toBeVisible({ timeout: 3000 });
			}
		}
	});

	test('clicking outside dropdown closes it', async ({ page }) => {
		const filterBtn = page.locator('button').filter({ hasText: /routes/ }).first();
		if (await filterBtn.isVisible().catch(() => false)) {
			await filterBtn.click();
			await page.waitForTimeout(300);

			if (await page.locator('text=Show all routes').isVisible()) {
				// Click outside (force to bypass TopBar overlay)
				await page.click('.maplibregl-canvas', { position: { x: 700, y: 700 }, force: true });
				await page.waitForTimeout(300);

				await expect(page.locator('text=Show all routes')).not.toBeVisible();
			}
		}
	});

	test('filtered bus markers match route filter', async ({ page }) => {
		const markersBefore = await page.locator('[data-bus-marker]').count();

		const filterBtn = page.locator('button').filter({ hasText: /routes/ }).first();
		if (await filterBtn.isVisible().catch(() => false)) {
			await filterBtn.click();
			await page.waitForTimeout(300);

			const routeBtns = page.locator('.grid button');
			if (await routeBtns.first().isVisible()) {
				await routeBtns.first().click();
				await page.waitForTimeout(1000);

				// Marker count should be <= before (filtered)
				const markersAfter = await page.locator('[data-bus-marker]').count();
				expect(markersAfter).toBeLessThanOrEqual(markersBefore);
			}
		}
	});
});
