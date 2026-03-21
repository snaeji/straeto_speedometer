<script lang="ts">
	import { appStore } from '$lib/stores/app.svelte';
	import LivePanel from './LivePanel.svelte';
	import HeatmapPanel from './HeatmapPanel.svelte';
</script>

<div class="h-full glass-strong rounded-2xl overflow-hidden flex flex-col">
	{#if appStore.mode === 'live'}
		<LivePanel />
	{:else if appStore.mode === 'heatmap'}
		<HeatmapPanel />
	{/if}
</div>
