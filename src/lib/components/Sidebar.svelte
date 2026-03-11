<script lang="ts">
	import { appStore } from '$lib/stores/app.svelte';
	import { busStore } from '$lib/stores/buses.svelte';
	import LivePanel from './LivePanel.svelte';
	import StatsPanel from './StatsPanel.svelte';
	import HeatmapPanel from './HeatmapPanel.svelte';

	const hasViolations = $derived(busStore.violationCount > 0 && appStore.mode === 'live');
</script>

<div
	class="h-full glass-strong rounded-2xl overflow-hidden flex flex-col transition-shadow duration-700"
	style={hasViolations ? 'box-shadow: 0 0 20px rgba(239,68,68,0.08), inset 0 0 1px rgba(239,68,68,0.15);' : ''}
>
	{#if appStore.mode === 'live'}
		<LivePanel />
	{:else if appStore.mode === 'stats'}
		<StatsPanel />
	{:else if appStore.mode === 'heatmap'}
		<HeatmapPanel />
	{/if}
</div>
