import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib'),
		},
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		exclude: ['node_modules', '.svelte-kit', 'build'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			include: ['src/lib/**/*.ts'],
			exclude: [
				'src/lib/**/*.svelte.ts',
				'src/lib/services/gtfs-service.ts',
				'src/lib/services/route-shape-index.ts',
				'src/lib/types/gtfs.ts',
			],
			thresholds: {
				branches: 80,
				functions: 85,
				lines: 80,
				statements: 80,
			},
		},
	},
});
