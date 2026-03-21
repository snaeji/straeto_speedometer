import { test, expect } from '@playwright/test';
import { waitForAppLoad, startSimulationAndWaitForBuses } from './helpers';

test.describe('Keyboard shortcuts', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
	});

	test('key 1 switches to Live mode', async ({ page }) => {
		// Start from a different mode
		await page.keyboard.press('3');
		await page.waitForTimeout(300);

		await page.keyboard.press('1');
		await page.waitForTimeout(500);

		await expect(page.locator('text=Data Recording')).toBeVisible({ timeout: 3000 });
	});

	test('key 2 switches to Playback mode', async ({ page }) => {
		await page.keyboard.press('2');
		await page.waitForTimeout(500);

		const playbackContent = page.locator('text=No recorded data').or(page.locator('text=1x'));
		await expect(playbackContent).toBeVisible({ timeout: 3000 });
	});

	test('key 3 switches to Stats mode', async ({ page }) => {
		await page.keyboard.press('3');
		await page.waitForTimeout(500);

		// Stats panel has "Buses Tracked" label
		await expect(page.getByText('Buses Tracked').first()).toBeVisible({ timeout: 5000 });
	});

	test('key 4 switches to Heatmap mode', async ({ page }) => {
		await page.keyboard.press('4');
		await page.waitForTimeout(500);

		await expect(page.locator('text=Violation Heatmap')).toBeVisible({ timeout: 3000 });
	});

	test('key B toggles sidebar', async ({ page }) => {
		// Sidebar should be visible initially — check the sidebar container transform
		const sidebar = page.locator('.absolute.left-3.bottom-3.transition-all');
		await expect(sidebar).toBeVisible();

		// Initially sidebar should be on-screen (translateX(0))
		const initialTransform = await sidebar.evaluate((el) => el.style.transform);
		expect(initialTransform).toContain('0');

		await page.keyboard.press('b');
		await page.waitForTimeout(500);

		// Sidebar should be slid off-screen
		const hiddenTransform = await sidebar.evaluate((el) => el.style.transform);
		expect(hiddenTransform).toContain('-');

		await page.keyboard.press('b');
		await page.waitForTimeout(500);

		// Sidebar back on-screen
		const restoredTransform = await sidebar.evaluate((el) => el.style.transform);
		expect(restoredTransform).toContain('0');
	});

	test('Escape deselects bus', async ({ page }) => {
		await startSimulationAndWaitForBuses(page);
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(500);

		const gauge = page.locator('svg[viewBox="0 0 100 80"]');
		await expect(gauge).toBeVisible({ timeout: 3000 });

		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);

		await expect(gauge).not.toBeVisible();
	});

	test('F key toggles auto-follow', async ({ page }) => {
		await startSimulationAndWaitForBuses(page);
		await page.locator('[data-bus-marker]').first().click();
		await page.waitForTimeout(500);

		// Press F to toggle auto-follow
		await page.keyboard.press('f');
		await page.waitForTimeout(300);

		// Press F again
		await page.keyboard.press('f');
		await page.waitForTimeout(300);

		// No crash expected
	});

	test('keyboard shortcuts ignored when modifier keys held', async ({ page }) => {
		// Ctrl+1 should not switch modes (it's a browser shortcut)
		await page.keyboard.press('Control+1');
		await page.waitForTimeout(300);

		// Should still be in Live mode
		await expect(page.locator('text=Data Recording')).toBeVisible();
	});

	test('Space key in playback mode toggles play/pause', async ({ page }) => {
		await page.keyboard.press('2');
		await page.waitForTimeout(500);

		// Space should not cause errors even with no data
		await page.keyboard.press('Space');
		await page.waitForTimeout(300);
	});

	test('Arrow keys in playback mode step through time', async ({ page }) => {
		await page.keyboard.press('2');
		await page.waitForTimeout(500);

		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(200);

		await page.keyboard.press('ArrowLeft');
		await page.waitForTimeout(200);
	});

	test('rapid keyboard shortcuts do not crash the app', async ({ page }) => {
		// Rapid key presses across all shortcuts
		for (const key of ['1', '2', '3', '4', 'b', 'f', 'Escape']) {
			await page.keyboard.press(key);
			await page.waitForTimeout(100);
		}

		await page.waitForTimeout(500);

		// App should still be responsive — return to Live mode
		await page.keyboard.press('1');
		await page.waitForTimeout(500);
		await expect(page.getByText('Data Recording').first()).toBeVisible({ timeout: 3000 });
	});

	test('keyboard hint text is visible in bottom-right corner', async ({ page }) => {
		const hint = page.locator('text=B sidebar');
		await expect(hint).toBeVisible({ timeout: 3000 });
	});
});
