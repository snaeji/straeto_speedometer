<script lang="ts">
	import { busStore, getBusStatus, getStatusColor, type BusStatus } from '$lib/stores/buses.svelte';
	import type { BusLocation } from '$lib/types/bus';

	type SortMode = 'route' | 'speed' | 'status';
	let sortMode = $state<SortMode>('status');

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
					return (b.speedKmh ?? 0) - (a.speedKmh ?? 0);
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

	function getSpeedBarWidth(bus: BusLocation): number {
		if (!bus.speedKmh || !bus.speedLimitKmh) return 0;
		return Math.min(100, (bus.speedKmh / bus.speedLimitKmh) * 100);
	}
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
			<span class="text-[10px] text-text-muted uppercase tracking-wider font-medium">
				{sortedBuses.length} buses
				{#if violationBuses.length > 0}
					<span class="text-danger font-semibold"> &middot; {violationBuses.length} violating</span>
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
			{@const speedPct = getSpeedBarWidth(bus)}

			<button
				class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all duration-150 cursor-pointer group
					{isSelected
						? 'bg-accent/[0.08] border border-accent/15'
						: status === 'violation'
							? 'bg-danger/[0.04] hover:bg-danger/[0.08] border border-danger/[0.08]'
							: 'hover:bg-white/[0.03] border border-transparent'}"
				onclick={() => busStore.selectBus(isSelected ? null : bus.busId)}
			>
				<!-- Route badge -->
				<div
					class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
					style="background: {color}; box-shadow: 0 0 8px {color}30;"
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

					{#if bus.speedKmh != null && bus.speedLimitKmh}
						<!-- Speed bar -->
						<div class="flex items-center gap-2 mt-1">
							<div class="flex-1 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
								<div
									class="h-full rounded-full transition-all duration-500"
									style="width: {speedPct}%; background: {color}; box-shadow: 0 0 6px {color}40;"
								></div>
							</div>
							<span class="text-[10px] font-mono tabular-nums font-semibold shrink-0 w-[52px] text-right" style="color: {color}">
								{bus.speedKmh.toFixed(0)}<span class="text-text-muted font-normal">/{bus.speedLimitKmh}</span>
							</span>
						</div>
					{:else}
						<span class="text-[10px] text-text-muted italic mt-0.5 block">awaiting data</span>
					{/if}
				</div>

				<!-- Violation indicator -->
				{#if bus.isViolation}
					<div class="relative shrink-0">
						<div class="w-2.5 h-2.5 rounded-full bg-danger" style="box-shadow: 0 0 8px rgba(239,68,68,0.6)"></div>
						<div class="absolute inset-0 w-2.5 h-2.5 rounded-full bg-danger animate-pulse-ring"></div>
					</div>
				{/if}
			</button>
		{/each}
	</div>
{/if}
