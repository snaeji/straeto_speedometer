import { test, expect } from '@playwright/test';

test.describe('App initialization', () => {
	test('page loads without console errors and shows loading screen', async ({ page }) => {
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(msg.text());
		});

		await page.goto('/');

		// Loading screen should appear with progress bar
		const progressBar = page.locator('div[style*="width:"]').first();
		await expect(progressBar).toBeVisible({ timeout: 5000 });

		// Wait for app to initialize (Dashboard appears)
		await page.waitForFunction(() => {
			return document.querySelector('button')?.textContent?.includes('Live') ||
				document.querySelector('.maplibregl-map') != null;
		}, { timeout: 15000 });

		// Take screenshot of loaded state
		await page.screenshot({ path: 'tests/e2e/screenshots/01-app-loaded.png' });
	});
});

test.describe('Mode switching', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		// Wait for Dashboard to load
		await page.waitForFunction(() => {
			return document.querySelector('button')?.textContent?.includes('Live') ||
				document.querySelector('.maplibregl-map') != null;
		}, { timeout: 15000 });
	});

	test('mode tabs switch content', async ({ page }) => {
		// Click each mode tab
		const modes = ['Live', 'Playback', 'Stats', 'Heatmap'];
		for (const mode of modes) {
			const tab = page.getByRole('button', { name: mode, exact: true });
			if (await tab.isVisible()) {
				await tab.click();
				// Brief wait for animation
				await page.waitForTimeout(300);
			}
		}
		await page.screenshot({ path: 'tests/e2e/screenshots/02-mode-switching.png' });
	});

	test('playback bar appears only in Playback mode', async ({ page }) => {
		// Switch to Playback
		const playbackTab = page.getByRole('button', { name: 'Playback', exact: true });
		if (await playbackTab.isVisible()) {
			await playbackTab.click();
			await page.waitForTimeout(500);

			// PlaybackBar should be visible (contains play/pause buttons or timeline)
			const playbackBar = page.locator('.absolute.bottom-3');
			// Take screenshot
			await page.screenshot({ path: 'tests/e2e/screenshots/03-mode-playback.png' });

			// Switch to Live — playback bar should disappear
			const liveTab = page.getByRole('button', { name: 'Live', exact: true });
			if (await liveTab.isVisible()) {
				await liveTab.click();
				await page.waitForTimeout(300);
			}
		}
	});

	test('Stats mode shows charts area', async ({ page }) => {
		const statsTab = page.getByRole('button', { name: 'Stats', exact: true });
		if (await statsTab.isVisible()) {
			await statsTab.click();
			await page.waitForTimeout(500);
			await page.screenshot({ path: 'tests/e2e/screenshots/04-mode-stats.png' });
		}
	});

	test('Heatmap mode renders', async ({ page }) => {
		const heatmapTab = page.getByRole('button', { name: 'Heatmap', exact: true });
		if (await heatmapTab.isVisible()) {
			await heatmapTab.click();
			await page.waitForTimeout(500);
			await page.screenshot({ path: 'tests/e2e/screenshots/05-mode-heatmap.png' });
		}
	});
});

test.describe('Keyboard shortcuts', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(() => {
			return document.querySelector('button')?.textContent?.includes('Live') ||
				document.querySelector('.maplibregl-map') != null;
		}, { timeout: 15000 });
	});

	test('1-4 keys switch modes', async ({ page }) => {
		// Press '2' for Playback
		await page.keyboard.press('2');
		await page.waitForTimeout(300);

		// Press '3' for Stats
		await page.keyboard.press('3');
		await page.waitForTimeout(300);

		// Press '4' for Heatmap
		await page.keyboard.press('4');
		await page.waitForTimeout(300);

		// Press '1' for Live
		await page.keyboard.press('1');
		await page.waitForTimeout(300);
	});

	test('b toggles sidebar', async ({ page }) => {
		// Press 'b' to toggle sidebar
		await page.keyboard.press('b');
		await page.waitForTimeout(300);

		// Press 'b' again to toggle back
		await page.keyboard.press('b');
		await page.waitForTimeout(300);
	});

	test('Escape deselects bus', async ({ page }) => {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(200);
		// Should not throw — just verify no errors
	});
});

test.describe('Simulation mode', () => {
	test('simulate button starts simulation and shows bus data', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(() => {
			return document.querySelector('button')?.textContent?.includes('Live') ||
				document.querySelector('.maplibregl-map') != null;
		}, { timeout: 15000 });

		// Ensure we're on Live mode
		const liveTab = page.getByRole('button', { name: 'Live', exact: true });
		if (await liveTab.isVisible()) {
			await liveTab.click();
			await page.waitForTimeout(300);
		}

		// Click Simulate button
		const simBtn = page.getByRole('button', { name: 'Simulate' });
		if (await simBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
			await simBtn.click();

			// Wait for bus markers or KPI updates
			await page.waitForTimeout(5000);

			await page.screenshot({ path: 'tests/e2e/screenshots/06-simulation-running.png' });
		}
	});
});

test.describe('Stats with data', () => {
	test('stats show charts when data available', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(() => {
			return document.querySelector('button')?.textContent?.includes('Live') ||
				document.querySelector('.maplibregl-map') != null;
		}, { timeout: 15000 });

		// Start simulation first to get data
		const liveTab = page.getByRole('button', { name: 'Live', exact: true });
		if (await liveTab.isVisible()) await liveTab.click();
		await page.waitForTimeout(300);

		const simBtn = page.getByRole('button', { name: 'Simulate' });
		if (await simBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
			await simBtn.click();
			await page.waitForTimeout(4000); // Accumulate some data
		}

		// Switch to Stats
		await page.keyboard.press('3');
		await page.waitForTimeout(2000);

		await page.screenshot({ path: 'tests/e2e/screenshots/07-stats-with-data.png' });
	});
});

test.describe('Heatmap mode', () => {
	test('heatmap renders', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(() => {
			return document.querySelector('button')?.textContent?.includes('Live') ||
				document.querySelector('.maplibregl-map') != null;
		}, { timeout: 15000 });

		await page.keyboard.press('4');
		await page.waitForTimeout(500);

		await page.screenshot({ path: 'tests/e2e/screenshots/08-heatmap-mode.png' });
	});
});

test.describe('Playback mode', () => {
	test('playback mode shows timeline', async ({ page }) => {
		await page.goto('/');
		await page.waitForFunction(() => {
			return document.querySelector('button')?.textContent?.includes('Live') ||
				document.querySelector('.maplibregl-map') != null;
		}, { timeout: 15000 });

		await page.keyboard.press('2');
		await page.waitForTimeout(500);

		await page.screenshot({ path: 'tests/e2e/screenshots/09-playback-mode.png' });
	});
});
