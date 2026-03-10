<script lang="ts">
	import { busStore } from '$lib/stores/buses.svelte';
	import { ALL_ROUTES } from '$lib/utils/constants';

	let isOpen = $state(false);

	function toggleRoute(route: string) {
		const current = busStore.routeFilter;
		if (!current) {
			// Switch from "all" to "all except this one"
			const newFilter = new Set(ALL_ROUTES);
			newFilter.delete(route);
			busStore.setRouteFilter(newFilter);
		} else {
			const newFilter = new Set(current);
			if (newFilter.has(route)) {
				newFilter.delete(route);
				if (newFilter.size === 0) {
					busStore.setRouteFilter(null); // back to all
				} else {
					busStore.setRouteFilter(newFilter);
				}
			} else {
				newFilter.add(route);
				if (newFilter.size === ALL_ROUTES.length) {
					busStore.setRouteFilter(null); // all selected = show all
				} else {
					busStore.setRouteFilter(newFilter);
				}
			}
		}
	}

	function showAll() {
		busStore.setRouteFilter(null);
		isOpen = false;
	}

	let filterLabel = $derived(
		busStore.routeFilter ? `${busStore.routeFilter.size} routes` : 'All routes'
	);

	function handleClickOutside(e: MouseEvent) {
		if (isOpen && !(e.target as Element)?.closest('.route-filter-container')) {
			isOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="relative route-filter-container">
	<button
		class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-text-secondary hover:text-text-primary hover:border-white/[0.1] transition-all cursor-pointer"
		onclick={() => (isOpen = !isOpen)}
	>
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
			<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
		</svg>
		{filterLabel}
		<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" class="transition-transform {isOpen ? 'rotate-180' : ''}">
			<path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" />
		</svg>
	</button>

	{#if isOpen}
		<div class="absolute right-0 top-full mt-2 w-56 glass-strong rounded-xl p-2 z-50" style="animation: fade-in 0.15s ease-out">
			<button
				class="w-full text-left px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:bg-white/5 transition-colors cursor-pointer"
				onclick={showAll}
			>
				Show all routes
			</button>
			<div class="h-px bg-white/5 my-1"></div>
			<div class="max-h-64 overflow-y-auto grid grid-cols-4 gap-0.5 p-1">
				{#each ALL_ROUTES as route}
					{@const isSelected = !busStore.routeFilter || busStore.routeFilter.has(route)}
					<button
						class="w-full py-1 rounded-lg text-xs font-mono text-center transition-all cursor-pointer
							{isSelected
								? 'bg-accent/15 text-accent border border-accent/20'
								: 'text-text-muted hover:bg-white/5 border border-transparent'}"
						onclick={() => toggleRoute(route)}
					>
						{route}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
