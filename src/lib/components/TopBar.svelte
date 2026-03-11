<script lang="ts">
	import { appStore } from '$lib/stores/app.svelte';
	import { busStore } from '$lib/stores/buses.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import ModeSwitcher from './ModeSwitcher.svelte';
	import KpiCard from './KpiCard.svelte';
	import RouteFilter from './RouteFilter.svelte';
</script>

<div class="mx-3 mt-3 rounded-2xl glass-strong px-4 py-2.5 flex items-center gap-3 min-w-0 overflow-hidden">
	<!-- Left: Menu + Logo -->
	<div class="flex items-center gap-3 shrink-0">
		<button
			class="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors cursor-pointer"
			onclick={() => appStore.toggleSidebar()}
			title="Toggle sidebar (B)"
		>
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
				{#if appStore.sidebarOpen}
					<path d="M4 4L14 14M14 4L4 14" />
				{:else}
					<path d="M4 5h10M4 9h10M4 13h10" />
				{/if}
			</svg>
		</button>

		<div class="flex items-center gap-2">
			<div class="w-7 h-7 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="text-accent" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="12" cy="12" r="10" />
					<path d="M12 6v6l4 2" />
				</svg>
			</div>
			<span class="text-sm font-semibold tracking-wider text-text-primary">THE STRAETO SPEEDOMETER</span>
			{#if collectionStore.isCollecting || collectionStore.isPreviewing || collectionStore.isDemoMode}
				<div class="relative flex items-center">
					<div class="w-2 h-2 rounded-full bg-success"></div>
					<div class="absolute w-2 h-2 rounded-full bg-success animate-pulse-ring"></div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Center: Mode Switcher -->
	<div class="flex-1 flex justify-center min-w-0">
		<ModeSwitcher />
	</div>

	<!-- Right: KPIs + Route Filter -->
	<div class="flex items-center gap-2 shrink-0">
		<div class="flex items-center gap-1.5">
			<KpiCard
				label="Buses"
				value={busStore.activeCount}
				icon="bus"
			/>
			<KpiCard
				label="Violations"
				value={busStore.violationCount}
				icon="alert"
				variant={busStore.violationCount > 0 ? 'danger' : 'default'}
			/>
			<KpiCard
				label="Avg Speed"
				value={Math.round(busStore.averageSpeed)}
				unit="km/h"
				icon="speed"
			/>
		</div>

		<div class="w-px h-8 bg-white/5"></div>

		<RouteFilter />
	</div>
</div>
