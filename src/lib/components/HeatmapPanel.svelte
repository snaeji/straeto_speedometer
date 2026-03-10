<script lang="ts">
	import { busStore } from '$lib/stores/buses.svelte';

	let violationCount = $derived(busStore.activeBuses.filter((b) => b.isViolation).length);
</script>

<div class="flex flex-col h-full p-4">
	<h2 class="text-sm font-semibold text-text-primary mb-2">Violation Heatmap</h2>
	<p class="text-xs text-text-secondary mb-4">
		Shows areas with highest concentration of speed violations. Start collecting data to see the heatmap build up.
	</p>

	<!-- Legend -->
	<div class="mb-6">
		<div class="text-[10px] text-text-muted uppercase tracking-wider mb-2">Density</div>
		<div class="flex items-center gap-2">
			<span class="text-[10px] text-text-muted">Low</span>
			<div
				class="flex-1 h-3 rounded-full"
				style="background: linear-gradient(90deg, rgba(255,200,0,0.3), rgba(255,140,0,0.5), rgba(255,69,0,0.6), rgba(255,0,0,0.7), rgba(200,0,0,0.8))"
			></div>
			<span class="text-[10px] text-text-muted">High</span>
		</div>
	</div>

	<!-- Stats -->
	<div class="bg-white/[0.02] rounded-xl px-4 py-3 border border-white/[0.04]">
		<div class="text-[10px] text-text-muted uppercase tracking-wider">Current Violations</div>
		<div class="text-2xl font-semibold font-mono {violationCount > 0 ? 'text-danger' : 'text-text-primary'}">
			{violationCount}
		</div>
	</div>

	<div class="flex-1"></div>

	<div class="text-[10px] text-text-muted/50 text-center">
		Heatmap updates in real-time as violations are detected
	</div>
</div>
