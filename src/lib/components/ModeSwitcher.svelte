<script lang="ts">
	import { appStore } from '$lib/stores/app.svelte';
	import type { AppMode } from '$lib/types/bus';

	const modes: { id: AppMode; label: string; key: string }[] = [
		{ id: 'live', label: 'Live', key: '1' },
		{ id: 'playback', label: 'Playback', key: '2' },
		{ id: 'stats', label: 'Stats', key: '3' },
		{ id: 'heatmap', label: 'Heatmap', key: '4' },
	];

	let activeIndex = $derived(modes.findIndex((m) => m.id === appStore.mode));
</script>

<div class="relative flex items-center bg-white/[0.03] rounded-xl p-0.5 border border-white/[0.06]">
	<!-- Sliding indicator -->
	<div
		class="absolute h-[calc(100%-4px)] rounded-[10px] transition-all duration-300"
		style="left: calc({activeIndex} * {100 / modes.length}% + 2px); width: calc({100 / modes.length}% - 4px);"
		style:transition-timing-function="cubic-bezier(0.16, 1, 0.3, 1)"
		style:background="linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(16, 185, 129, 0.1))"
		style:border="1px solid rgba(6, 182, 212, 0.2)"
	></div>

	{#each modes as mode}
		{@const isActive = appStore.mode === mode.id}
		<button
			class="relative z-10 flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium transition-colors duration-200 cursor-pointer rounded-[10px]
				{isActive ? 'text-accent' : 'text-text-secondary hover:text-text-primary'}"
			onclick={() => appStore.setMode(mode.id)}
			title="{mode.label} ({mode.key})"
		>
			<!-- Mode icons -->
			{#if mode.id === 'live'}
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
					<circle cx="8" cy="8" r="3" />
					<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5" opacity={isActive ? 0.5 : 0.3} />
				</svg>
			{:else if mode.id === 'playback'}
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
					<path d="M5 3v10l8-5z" />
				</svg>
			{:else if mode.id === 'stats'}
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
					<rect x="1" y="8" width="3" height="7" rx="0.5" />
					<rect x="6.5" y="4" width="3" height="11" rx="0.5" />
					<rect x="12" y="1" width="3" height="14" rx="0.5" />
				</svg>
			{:else if mode.id === 'heatmap'}
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" opacity="0.9">
					<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3" />
					<circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5" />
					<circle cx="8" cy="8" r="2" />
				</svg>
			{/if}
			{mode.label}
		</button>
	{/each}
</div>
