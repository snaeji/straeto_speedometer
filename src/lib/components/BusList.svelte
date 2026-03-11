<script lang="ts">
	import { busStore, getBusStatus, getStatusColor, type BusStatus } from '$lib/stores/buses.svelte';
	import type { BusLocation } from '$lib/types/bus';

	type SortMode = 'route' | 'speed' | 'status';
	let sortMode = $state<SortMode>('route');

	function sortBuses(buses: BusLocation[], mode: SortMode): BusLocation[] {
		return buses.slice().sort((a, b) => {
			switch (mode) {
				case 'speed': {
					const speedA = a.speedKmh ?? -1;
					const speedB = b.speedKmh ?? -1;
					return speedB - speedA; // fastest first
				}
				case 'status': {
					const order: Record<BusStatus, number> = { violation: 0, approaching: 1, normal: 2, nodata: 3 };
					const diff = order[getBusStatus(a)] - order[getBusStatus(b)];
					if (diff !== 0) return diff;
					return parseInt(a.routeNr) - parseInt(b.routeNr);
				}
				default: { // route
					const routeA = parseInt(a.routeNr);
					const routeB = parseInt(b.routeNr);
					if (routeA !== routeB) return routeA - routeB;
					return a.busId.localeCompare(b.busId);
				}
			}
		});
	}

	let sortedBuses = $derived(sortBuses(busStore.activeBuses, sortMode));
	let violationBuses = $derived(sortedBuses.filter((b) => b.isViolation));
</script>

{#if sortedBuses.length === 0}
	<div class="flex flex-col items-center justify-center h-full py-12 px-4">
		<div class="w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/[0.05] flex items-center justify-center mb-4">
			<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="text-text-muted/60" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="4" width="18" height="12" rx="2" />
				<circle cx="7.5" cy="18" r="1.5" />
				<circle cx="16.5" cy="18" r="1.5" />
			</svg>
		</div>
		<p class="text-sm text-text-secondary text-center font-medium">No active buses</p>
		<p class="text-xs text-text-muted text-center mt-1.5 max-w-[200px] leading-relaxed">
			Click "Start Collecting" to record data, or "Preview" to see live positions
		</p>
	</div>
{:else}
	<div class="p-2">
		<!-- Header with sort options -->
		<div class="flex items-center justify-between px-2 py-1.5 mb-1">
			<span class="text-[10px] text-text-muted uppercase tracking-wider">
				{sortedBuses.length} buses
				{#if violationBuses.length > 0}
					<span class="text-danger">&middot; {violationBuses.length} violations</span>
				{/if}
			</span>
			<div class="flex gap-0.5 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.04]">
				{#each [['route', 'Rt'], ['speed', 'Spd'], ['status', 'St']] as [mode, label]}
					<button
						class="px-2 py-0.5 rounded-md text-[9px] font-medium transition-all cursor-pointer
							{sortMode === mode
								? 'bg-white/[0.06] text-text-primary'
								: 'text-text-muted hover:text-text-secondary'}"
						onclick={() => (sortMode = mode as SortMode)}
					>
						{label}
					</button>
				{/each}
			</div>
		</div>

		{#each sortedBuses as bus (bus.busId)}
			{@const status = getBusStatus(bus)}
			{@const color = getStatusColor(status)}
			{@const isSelected = bus.busId === busStore.selectedBusId}

			<button
				class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all duration-150 cursor-pointer
					{isSelected
						? 'bg-accent/[0.08] border border-accent/15'
						: 'hover:bg-white/[0.03] border border-transparent'}"
				onclick={() => busStore.selectBus(isSelected ? null : bus.busId)}
			>
				<!-- Route badge -->
				<div
					class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 transition-transform duration-150"
					style="background: {color}; {isSelected ? 'transform: scale(1.1)' : ''}"
				>
					{bus.routeNr}
				</div>

				<!-- Info -->
				<div class="flex-1 text-left min-w-0">
					<div class="flex items-center gap-1.5">
						<span class="text-xs font-medium text-text-primary">{bus.busId}</span>
						{#if bus.headsign}
							<span class="text-[10px] text-text-muted truncate">&rarr; {bus.headsign}</span>
						{/if}
					</div>
					<div class="flex items-center gap-1 mt-0.5">
						{#if bus.speedKmh != null}
							<span class="text-[11px] font-mono tabular-nums font-medium" style="color: {color}">
								{bus.speedKmh.toFixed(1)}
							</span>
							<span class="text-[10px] text-text-muted font-mono">
								/ {bus.speedLimitKmh ?? '--'}
							</span>
							<span class="text-[9px] text-text-muted">km/h</span>
						{:else}
							<span class="text-[10px] text-text-muted italic">awaiting data</span>
						{/if}
					</div>
				</div>

				<!-- Violation indicator -->
				{#if bus.isViolation}
					<div class="relative shrink-0">
						<div class="w-2 h-2 rounded-full bg-danger" style="box-shadow: 0 0 6px rgba(239,68,68,0.5)"></div>
						<div class="absolute inset-0 w-2 h-2 rounded-full bg-danger animate-pulse-ring"></div>
					</div>
				{/if}
			</button>
		{/each}
	</div>
{/if}
