<script lang="ts">
	import { appStore } from '$lib/stores/app.svelte';
	import type { AppMode } from '$lib/types/bus';

	const modes: { id: AppMode; label: string; icon: string; key: string }[] = [
		{ id: 'live', label: 'Live', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z', key: '1' },
		{ id: 'playback', label: 'Playback', icon: 'M8 5v14l11-7z', key: '2' },
		{ id: 'stats', label: 'Stats', icon: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z', key: '3' },
		{ id: 'heatmap', label: 'Heatmap', icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z', key: '4' },
	];

	let activeIndex = $derived(modes.findIndex((m) => m.id === appStore.mode));
</script>

<div class="relative flex items-center bg-white/[0.03] rounded-xl p-0.5 border border-white/[0.06]">
	<!-- Sliding indicator -->
	<div
		class="absolute h-[calc(100%-4px)] rounded-[10px] transition-all duration-300"
		style="width: {100 / modes.length}%; left: calc({activeIndex} * {100 / modes.length}% + 2px); width: calc({100 / modes.length}% - 4px);"
		style:transition-timing-function="cubic-bezier(0.16, 1, 0.3, 1)"
		style:background="linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(16, 185, 129, 0.1))"
		style:border="1px solid rgba(6, 182, 212, 0.2)"
	></div>

	{#each modes as mode}
		<button
			class="relative z-10 px-4 py-1.5 text-xs font-medium transition-colors duration-200 cursor-pointer rounded-[10px]
				{appStore.mode === mode.id ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}"
			onclick={() => appStore.setMode(mode.id)}
			title="{mode.label} ({mode.key})"
		>
			{mode.label}
		</button>
	{/each}
</div>
