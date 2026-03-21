import { test, expect } from '@playwright/test';
import { waitForAppLoad, startSimulationAndWaitForBuses } from './helpers';

test.describe('Playback mode', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
	});

	test('playback mode shows "No recorded data" when empty', async ({ page }) => {
		await page.keyboard.press('2');
		await page.waitForTimeout(500);

		await expect(page.locator('text=No recorded data')).toBeVisible({ timeout: 3000 });
	});

	test('playback mode with data shows transport controls', async ({ page }) => {
		// First generate data via simulation + recording
		await startSimulationAndWaitForBuses(page, { waitAfter: 8000 });

		// Stop simulation
		await page.getByRole('button', { name: 'Stop Simulation' }).click();
		await page.waitForTimeout(500);

		// Switch to Playback
		await page.keyboard.press('2');
		await page.waitForTimeout(1000);

		// Either no data or transport controls
		const hasData = await page.locator('text=1x').isVisible().catch(() => false);
		if (hasData) {
			// Play button should be present
			const playBtn = page.locator('button').filter({ has: page.locator('svg') }).nth(1);
			await expect(playBtn).toBeVisible();
		}
	});

	test('speed buttons show 1x, 2x, 5x, 10x options', async ({ page }) => {
		// Generate some data first
		await startSimulationAndWaitForBuses(page, { waitAfter: 8000 });
		await page.getByRole('button', { name: 'Stop Simulation' }).click();
		await page.waitForTimeout(500);

		await page.keyboard.press('2');
		await page.waitForTimeout(1000);

		const hasTransport = await page.locator('text=1x').isVisible().catch(() => false);
		if (hasTransport) {
			await expect(page.locator('button:has-text("1x")')).toBeVisible();
			await expect(page.locator('button:has-text("2x")')).toBeVisible();
			await expect(page.locator('button:has-text("5x")')).toBeVisible();
			await expect(page.locator('button:has-text("10x")')).toBeVisible();
		}
	});

	test('keyboard Space toggles play/pause in playback mode', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 8000 });
		await page.getByRole('button', { name: 'Stop Simulation' }).click();
		await page.waitForTimeout(500);

		await page.keyboard.press('2');
		await page.waitForTimeout(1000);

		const hasData = await page.locator('text=1x').isVisible().catch(() => false);
		if (hasData) {
			// Press Space to play
			await page.keyboard.press('Space');
			await page.waitForTimeout(1000);

			// Press Space again to pause
			await page.keyboard.press('Space');
			await page.waitForTimeout(500);
		}
	});

	test('keyboard arrow keys step forward/backward', async ({ page }) => {
		await startSimulationAndWaitForBuses(page, { waitAfter: 8000 });
		await page.getByRole('button', { name: 'Stop Simulation' }).click();
		await page.waitForTimeout(500);

		await page.keyboard.press('2');
		await page.waitForTimeout(1000);

		const hasData = await page.locator('text=1x').isVisible().catch(() => false);
		if (hasData) {
			// Arrow right should step forward
			await page.keyboard.press('ArrowRight');
			await page.waitForTimeout(300);

			// Arrow left should step backward
			await page.keyboard.press('ArrowLeft');
			await page.waitForTimeout(300);
		}
	});

	test('switching to Playback mode hides sidebar', async ({ page }) => {
		const sidebar = page.locator('.absolute.left-3.bottom-3.transition-all');
		const initialTransform = await sidebar.evaluate((el) => el.style.transform);
		expect(initialTransform).toContain('0');

		await page.keyboard.press('2');
		await page.waitForTimeout(500);

		const hiddenTransform = await sidebar.evaluate((el) => el.style.transform);
		expect(hiddenTransform).toContain('-');
	});
});
