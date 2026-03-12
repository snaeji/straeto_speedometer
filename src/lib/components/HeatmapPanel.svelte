<script lang="ts">
	import { busStore } from '$lib/stores/buses.svelte';

	let violationCount = $derived(busStore.activeBuses.filter((b) => b.isViolation).length);
</script>

<div class="flex flex-col h-full p-4">
	<h2 class="text-sm font-semibold text-text-primary mb-2 text-glow">Violation Heatmap</h2>
	<p class="text-xs text-text-secondary mb-3">
		Shows areas with highest concentration of speed violations. Start recording data to see the heatmap build up.
	</p>

	<!-- Instructions -->
	<div class="glass-card px-3 py-2.5 mb-4">
		<div class="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">How to use</div>
		<ul class="text-[11px] text-text-secondary space-y-1">
			<li class="flex items-start gap-1.5">
				<span class="text-accent mt-0.5 shrink-0">&#x2022;</span>
				<span>Start recording to begin tracking violations</span>
			</li>
			<li class="flex items-start gap-1.5">
				<span class="text-accent mt-0.5 shrink-0">&#x2022;</span>
				<span>Hot spots appear where violations cluster geographically</span>
			</li>
			<li class="flex items-start gap-1.5">
				<span class="text-accent mt-0.5 shrink-0">&#x2022;</span>
				<span>Zoom in on red areas to inspect individual violations</span>
			</li>
		</ul>
	</div>

	<!-- Legend -->
	<div class="mb-6">
		<div class="text-[10px] text-text-muted uppercase tracking-wider mb-2">Density</div>
		<div class="flex flex-col gap-1">
			<div
				class="w-full h-4 rounded-lg"
				style="background: linear-gradient(90deg, rgba(255,200,0,0.3), rgba(255,165,0,0.45) 25%, rgba(255,100,0,0.55) 50%, rgba(255,30,0,0.7) 75%, rgba(200,0,0,0.85))"
			></div>
			<div class="flex justify-between relative">
				<div class="flex flex-col items-start">
					<div class="w-px h-1.5 bg-text-muted/40 mb-0.5"></div>
					<span class="text-[10px] text-text-muted">Low</span>
				</div>
				<div class="flex flex-col items-center">
					<div class="w-px h-1.5 bg-text-muted/40 mb-0.5"></div>
					<span class="text-[10px] text-text-muted">Medium</span>
				</div>
				<div class="flex flex-col items-end">
					<div class="w-px h-1.5 bg-text-muted/40 mb-0.5"></div>
					<span class="text-[10px] text-text-muted">High</span>
				</div>
			</div>
		</div>
	</div>

	<!-- Stats: Gauge-like violation display -->
	<div class="glass-card px-4 py-4 text-center">
		<div class="text-[10px] text-text-muted uppercase tracking-wider mb-3">Current Violations</div>
		<div class="relative inline-flex items-center justify-center w-20 h-20 mx-auto mb-2">
			<!-- Background ring -->
			<svg class="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80">
				<circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="6" />
				<circle
					cx="40" cy="40" r="34" fill="none"
					stroke={violationCount > 0 ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.08)'}
					stroke-width="6"
					stroke-linecap="round"
					stroke-dasharray={`${Math.min(violationCount * 7, 214)} 214`}
					class="transition-all duration-700"
				/>
			</svg>
			<span class="text-3xl font-bold font-mono tabular-nums {violationCount > 0 ? 'text-danger text-glow' : 'text-text-primary'}">
				{violationCount}
			</span>
		</div>
		<div class="text-[10px] text-text-muted">
			{violationCount === 0 ? 'No active violations' : violationCount === 1 ? '1 bus exceeding limit' : `${violationCount} buses exceeding limits`}
		</div>
	</div>

	<div class="flex-1"></div>

	<div class="text-[10px] text-text-muted/50 text-center">
		Heatmap updates in real-time as violations are detected
	</div>
</div>
