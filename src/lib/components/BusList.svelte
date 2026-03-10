<script lang="ts">
	import { busStore, getBusStatus, getStatusColor } from '$lib/stores/buses.svelte';

	let sortedBuses = $derived(
		busStore.activeBuses.slice().sort((a, b) => {
			const routeA = parseInt(a.routeNr);
			const routeB = parseInt(b.routeNr);
			if (routeA !== routeB) return routeA - routeB;
			return a.busId.localeCompare(b.busId);
		})
	);
</script>

{#if sortedBuses.length === 0}
	<div class="flex flex-col items-center justify-center h-full py-12 px-4">
		<div class="w-12 h-12 rounded-full bg-white/[0.03] flex items-center justify-center mb-3">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="text-text-muted" stroke-width="1.5">
				<path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z" />
			</svg>
		</div>
		<p class="text-xs text-text-muted text-center">No active buses</p>
		<p class="text-[10px] text-text-muted/60 text-center mt-1">Start collecting or preview live data</p>
	</div>
{:else}
	<div class="p-2">
		<div class="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider">
			Active Buses ({sortedBuses.length})
		</div>

		{#each sortedBuses as bus (bus.busId)}
			{@const status = getBusStatus(bus)}
			{@const color = getStatusColor(status)}
			{@const isSelected = bus.busId === busStore.selectedBusId}

			<button
				class="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl transition-all cursor-pointer
					{isSelected
						? 'bg-accent/[0.08] border border-accent/15'
						: 'hover:bg-white/[0.03] border border-transparent'}"
				onclick={() => busStore.selectBus(isSelected ? null : bus.busId)}
			>
				<!-- Route badge -->
				<div
					class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
					style="background: {color}"
				>
					{bus.routeNr}
				</div>

				<!-- Info -->
				<div class="flex-1 text-left min-w-0">
					<div class="flex items-center gap-1.5">
						<span class="text-xs font-medium text-text-primary">{bus.busId}</span>
						{#if bus.headsign}
							<span class="text-[10px] text-text-muted truncate">{bus.headsign}</span>
						{/if}
					</div>
					<div class="flex items-center gap-1 mt-0.5">
						{#if bus.speedKmh != null}
							<span class="text-[11px] font-mono tabular-nums" style="color: {color}">
								{bus.speedKmh.toFixed(1)}
							</span>
							<span class="text-[10px] text-text-muted">
								/ {bus.speedLimitKmh ?? '--'} km/h
							</span>
						{:else}
							<span class="text-[10px] text-text-muted">No speed data</span>
						{/if}
					</div>
				</div>

				<!-- Violation indicator -->
				{#if bus.isViolation}
					<div class="w-2 h-2 rounded-full bg-danger shrink-0" style="box-shadow: 0 0 6px rgba(239,68,68,0.5)"></div>
				{/if}
			</button>
		{/each}
	</div>
{/if}
