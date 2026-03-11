<script lang="ts">
	import { busStore } from '$lib/stores/buses.svelte';

	let flashActive = $state(false);
	let prevViolationIds = new Set<string>();

	// Detect new violations by comparing current violating bus IDs
	$effect(() => {
		const currentViolations = busStore.activeBuses.filter(b => b.isViolation);
		const currentIds = new Set(currentViolations.map(b => b.busId));

		// Check for NEW violations (buses that weren't violating before)
		let hasNew = false;
		for (const id of currentIds) {
			if (!prevViolationIds.has(id)) {
				hasNew = true;
				break;
			}
		}

		prevViolationIds = currentIds;

		if (hasNew && currentViolations.length > 0) {
			flashActive = true;
			setTimeout(() => { flashActive = false; }, 600);
		}
	});
</script>

{#if flashActive}
	<!-- Screen edge vignette flash -->
	<div class="violation-flash absolute inset-0 pointer-events-none z-30">
	</div>
{/if}

<style>
	.violation-flash {
		background: radial-gradient(ellipse at center, transparent 50%, rgba(239, 68, 68, 0.15) 80%, rgba(239, 68, 68, 0.3) 100%);
		animation: flash-pulse 0.6s ease-out forwards;
	}

	@keyframes flash-pulse {
		0% { opacity: 0; }
		15% { opacity: 1; }
		100% { opacity: 0; }
	}
</style>
