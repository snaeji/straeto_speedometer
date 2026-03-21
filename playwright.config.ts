import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 60_000,
	retries: 1,
	workers: 1,
	use: {
		baseURL: 'http://localhost:5173',
		viewport: { width: 1440, height: 900 },
		screenshot: 'off',
	},
	outputDir: 'tests/e2e/screenshots',
	projects: [
		{
			name: 'chromium',
			use: { browserName: 'chromium' },
		},
	],
	webServer: {
		command: 'npm run dev',
		url: 'http://localhost:5173',
		reuseExistingServer: !process.env.CI,
	},
});
