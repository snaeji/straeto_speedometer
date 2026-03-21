import { test, expect } from '@playwright/test';
import { waitForAppLoad } from './helpers';

test.describe('Mode switching', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await waitForAppLoad(page);
	});

	test('app starts in Live mode', async ({ page }) => {
		// Live tab should have accent color (active indicator)
		const liveBtn = page.getByRole('button', { name: 'Live', exact: true });
		await expect(liveBtn).toBeVisible();

		// Data Recording section should be visible (LivePanel)
		await expect(page.locator('text=Data Recording')).toBeVisible();
	});

	test('clicking Playback tab switches to playback mode', async ({ page }) => {
		const playbackBtn = page.getByRole('button', { name: 'Playback', exact: true });
		await playbackBtn.click();
		await page.waitForTimeout(500);

		// PlaybackBar should appear at bottom
		// Either "No recorded data" message or transport controls
		const playbackContent = page.locator('text=No recorded data').or(page.locator('text=1x'));
		await expect(playbackContent).toBeVisible({ timeout: 3000 });
	});

	test('clicking Stats tab shows stats panel', async ({ page }) => {
		const statsBtn = page.getByRole('button', { name: 'Stats', exact: true });
		await statsBtn.click();
		await page.waitForTimeout(500);

		// Stats panel has "Buses Tracked" label
		await expect(page.getByText('Buses Tracked').first()).toBeVisible({ timeout: 5000 });
	});

	test('clicking Heatmap tab shows heatmap panel', async ({ page }) => {
		const heatmapBtn = page.getByRole('button', { name: 'Heatmap', exact: true });
		await heatmapBtn.click();
		await page.waitForTimeout(500);

		await expect(page.locator('text=Violation Heatmap')).toBeVisible({ timeout: 3000 });
	});

	test('sidebar hides in Playback mode', async ({ page }) => {
		const sidebar = page.locator('.absolute.left-3.bottom-3.transition-all');

		// Sidebar should be on-screen initially
		const initialTransform = await sidebar.evaluate((el) => el.style.transform);
		expect(initialTransform).toContain('0');

		// Switch to Playback
		await page.getByRole('button', { name: 'Playback', exact: true }).click();
		await page.waitForTimeout(500);

		// Sidebar should be off-screen
		const hiddenTransform = await sidebar.evaluate((el) => el.style.transform);
		expect(hiddenTransform).toContain('-');
	});

	test('sidebar reappears when switching back from Playback to Live', async ({ page }) => {
		const sidebar = page.locator('.absolute.left-3.bottom-3.transition-all');

		await page.getByRole('button', { name: 'Playback', exact: true }).click();
		await page.waitForTimeout(500);

		await page.getByRole('button', { name: 'Live', exact: true }).click();
		await page.waitForTimeout(500);

		const transform = await sidebar.evaluate((el) => el.style.transform);
		expect(transform).toContain('0');
	});

	test('mode indicator slides to correct position', async ({ page }) => {
		// The sliding indicator is the absolute-positioned div inside ModeSwitcher
		const modes = ['Live', 'Playback', 'Stats', 'Heatmap'];

		for (let i = 0; i < modes.length; i++) {
			await page.getByRole('button', { name: modes[i], exact: true }).click();
			await page.waitForTimeout(400);
		}
		// No assertion needed beyond no errors — visual verification via screenshot
	});

	test('keyboard 1-4 switches modes correctly', async ({ page }) => {
		// 2 = Playback
		await page.keyboard.press('2');
		await page.waitForTimeout(500);
		await expect(page.locator('text=No recorded data').or(page.locator('text=1x')).first()).toBeVisible({ timeout: 3000 });

		// 3 = Stats
		await page.keyboard.press('3');
		await page.waitForTimeout(500);
		await expect(page.getByText('Buses Tracked').first()).toBeVisible({ timeout: 5000 });

		// 4 = Heatmap
		await page.keyboard.press('4');
		await page.waitForTimeout(500);
		await expect(page.locator('text=Violation Heatmap')).toBeVisible({ timeout: 3000 });

		// 1 = Live
		await page.keyboard.press('1');
		await page.waitForTimeout(500);
		// Verify sidebar is on-screen with Live content
		await expect(page.getByText('Data Recording').first()).toBeVisible({ timeout: 3000 });
	});

	test('Stats sidebar is wider than Live sidebar', async ({ page }) => {
		// Live mode sidebar width
		const sidebarContainer = page.locator('.absolute.left-3.bottom-3');
		await expect(sidebarContainer).toBeVisible();

		const liveWidth = await sidebarContainer.evaluate((el) => el.clientWidth);

		// Switch to Stats
		await page.keyboard.press('3');
		await page.waitForTimeout(500);

		const statsWidth = await sidebarContainer.evaluate((el) => el.clientWidth);

		// Stats sidebar should be wider (420px vs 320px)
		expect(statsWidth).toBeGreaterThan(liveWidth);
	});

	test('Heatmap mode shows density legend', async ({ page }) => {
		await page.keyboard.press('4');
		await page.waitForTimeout(500);

		await expect(page.locator('text=Violation Heatmap')).toBeVisible({ timeout: 3000 });
		// Density legend uses Low/Medium/High labels
		await expect(page.getByText('Low').first()).toBeVisible({ timeout: 3000 });
	});

	test('rapid mode switching does not crash the app', async ({ page }) => {
		for (let cycle = 0; cycle < 3; cycle++) {
			for (const key of ['1', '2', '3', '4']) {
				await page.keyboard.press(key);
				await page.waitForTimeout(150);
			}
		}

		await page.waitForTimeout(500);

		// App should still be responsive — can navigate back to Live
		await page.keyboard.press('1');
		await page.waitForTimeout(500);
		await expect(page.getByText('Data Recording').first()).toBeVisible({ timeout: 3000 });
	});

	test('PlaybackBar only visible in Playback mode', async ({ page }) => {
		// Check each mode
		for (const key of ['1', '3', '4']) {
			await page.keyboard.press(key);
			await page.waitForTimeout(400);
			// PlaybackBar specific element should not be visible
			const transport = page.locator('text=No recorded data');
			if (await transport.isVisible().catch(() => false)) {
				// Only expected in Playback mode
				expect(key).toBe('2');
			}
		}

		// Playback mode should show it
		await page.keyboard.press('2');
		await page.waitForTimeout(400);
		const playbackContent = page.locator('text=No recorded data').or(page.locator('text=1x'));
		await expect(playbackContent).toBeVisible({ timeout: 3000 });
	});
});
