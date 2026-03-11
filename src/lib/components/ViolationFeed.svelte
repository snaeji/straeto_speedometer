<script lang="ts">
	import { busStore, getStatusColor } from '$lib/stores/buses.svelte';
	import { formatTime } from '$lib/utils/format';
	import type { BusLocation } from '$lib/types/bus';

	// Track recent violations (last 20)
	let recentViolations = $state<Array<BusLocation & { seenAt: number }>>([]);

	$effect(() => {
		const violations = busStore.activeBuses.filter((b) => b.isViolation);
		const now = Date.now();

		for (const v of violations) {
			const existing = recentViolations.find(
				(r) => r.busId === v.busId && Math.abs(r.timestamp - v.timestamp) < 5000
			);
			if (!existing) {
				recentViolations = [{ ...v, seenAt: now }, ...recentViolations].slice(0, 20);
			}
		}
	});

	function clearFeed() {
		recentViolations = [];
	}

	function getExcessSpeed(v: BusLocation): string {
		if (!v.speedKmh || !v.speedLimitKmh) return '';
		const excess = v.speedKmh - v.speedLimitKmh;
		return `+${excess.toFixed(0)}`;
	}
</script>

{#if recentViolations.length > 0}
	<div class="border-t border-danger/10 bg-gradient-to-t from-danger/[0.03] to-transparent">
		<div class="flex items-center justify-between px-4 pt-3 pb-1">
			<div class="flex items-center gap-2">
				<div class="relative">
					<div class="w-1.5 h-1.5 rounded-full bg-danger"></div>
					<div class="absolute inset-0 w-1.5 h-1.5 rounded-full bg-danger animate-pulse-ring"></div>
				</div>
				<h3 class="text-[11px] font-semibold uppercase tracking-wider text-danger/80">
					Violation Feed
				</h3>
			</div>
			<button
				class="text-[10px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
				onclick={clearFeed}
			>
				Clear
			</button>
		</div>

		<div class="max-h-36 overflow-y-auto px-2 pb-2">
			{#each recentViolations as violation, i (violation.busId + violation.seenAt)}
				<button
					class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-danger/[0.06] transition-all cursor-pointer"
					style="animation: slide-in-left 0.2s cubic-bezier(0.16, 1, 0.3, 1) {Math.min(i * 0.03, 0.15)}s both"
					onclick={() => busStore.selectBus(violation.busId)}
				>
					<div class="w-5 h-5 rounded-md flex items-center justify-center text-[8px] font-bold text-white shrink-0"
						style="background: {getStatusColor('violation')}; box-shadow: 0 0 6px rgba(239,68,68,0.3);"
					>
						{violation.routeNr}
					</div>
					<div class="flex-1 text-left min-w-0">
						<span class="text-[10px] text-text-primary font-medium">{violation.busId}</span>
						<span class="text-[10px] text-danger font-mono font-semibold ml-1.5">
							{violation.speedKmh?.toFixed(0)}
						</span>
						<span class="text-[9px] text-text-muted font-mono">/{violation.speedLimitKmh}</span>
						{#if violation.speedKmh && violation.speedLimitKmh}
							<span class="text-[9px] text-danger/70 font-mono font-semibold ml-1">
								{getExcessSpeed(violation)}
							</span>
						{/if}
					</div>
					<span class="text-[9px] text-text-muted font-mono shrink-0">
						{formatTime(violation.seenAt)}
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}
