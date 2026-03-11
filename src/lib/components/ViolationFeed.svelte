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
			// Only add if not already tracked
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
</script>

{#if recentViolations.length > 0}
	<div class="border-t border-white/5">
		<div class="flex items-center justify-between px-4 pt-3 pb-1">
			<h3 class="text-[11px] font-semibold uppercase tracking-wider text-danger/80">
				Violation Feed
			</h3>
			<button
				class="text-[10px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
				onclick={clearFeed}
			>
				Clear
			</button>
		</div>

		<div class="max-h-40 overflow-y-auto px-2 pb-2">
			{#each recentViolations as violation (violation.busId + violation.seenAt)}
				<button
					class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer"
					onclick={() => busStore.selectBus(violation.busId)}
				>
					<div class="w-5 h-5 rounded-md flex items-center justify-center text-[8px] font-bold text-white shrink-0"
						style="background: {getStatusColor('violation')}"
					>
						{violation.routeNr}
					</div>
					<div class="flex-1 text-left min-w-0">
						<span class="text-[10px] text-text-primary">{violation.busId}</span>
						<span class="text-[10px] text-danger font-mono ml-1">
							{violation.speedKmh?.toFixed(1)} / {violation.speedLimitKmh}
						</span>
					</div>
					<span class="text-[9px] text-text-muted font-mono shrink-0">
						{formatTime(violation.seenAt)}
					</span>
				</button>
			{/each}
		</div>
	</div>
{/if}
