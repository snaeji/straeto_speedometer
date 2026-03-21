<script lang="ts">
	import { collectionStore } from '$lib/stores/collection.svelte';
	import { formatElapsed } from '$lib/utils/format';
	import BusList from './BusList.svelte';
	import ViolationFeed from './ViolationFeed.svelte';

	let elapsedDisplay = $state('0:00');
	let elapsedTimer: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		if (collectionStore.isRecording || collectionStore.isSimulating) {
			elapsedTimer = setInterval(() => {
				elapsedDisplay = formatElapsed(collectionStore.elapsedSeconds);
			}, 1000);
		} else {
			if (elapsedTimer) clearInterval(elapsedTimer);
			elapsedDisplay = '0:00';
		}
		return () => {
			if (elapsedTimer) clearInterval(elapsedTimer);
		};
	});
</script>

<div class="flex flex-col h-full">
	<!-- Controls -->
	<div class="p-4 border-b border-white/5">
		<div class="flex gap-2 mb-3">
			{#if collectionStore.isRecording}
				<button
					class="flex-1 py-2 rounded-xl bg-danger/15 text-danger border border-danger/20 text-xs font-medium hover:bg-danger/25 transition-all cursor-pointer"
					onclick={() => collectionStore.stopRecording()}
				>
					Stop
				</button>
			{:else if collectionStore.isSimulating}
				<button
					class="flex-1 py-2 rounded-xl bg-warning/15 text-warning border border-warning/20 text-xs font-medium hover:bg-warning/25 transition-all cursor-pointer"
					onclick={() => collectionStore.stopSimulation()}
				>
					Stop Simulation
				</button>
			{:else}
				<button
					class="flex-1 py-2 rounded-xl bg-success/15 text-success border border-success/20 text-xs font-medium hover:bg-success/25 transition-all cursor-pointer"
					onclick={() => collectionStore.startRecording()}
				>
					Start
				</button>
				<button
					class="py-2 px-3 rounded-xl text-xs font-medium transition-all cursor-pointer bg-white/[0.03] text-warning/70 border border-white/[0.06] hover:border-warning/20 hover:text-warning"
					onclick={() => collectionStore.startSimulation()}
					title="Simulated bus data for testing"
				>
					Simulate
				</button>
			{/if}
		</div>

		<!-- Recording Stats -->
		{#if collectionStore.isRecording || collectionStore.isSimulating}
			<div class="grid grid-cols-2 gap-2 mb-3">
				<div class="bg-white/[0.02] rounded-lg px-2 py-1.5">
					<div class="text-[10px] text-text-muted uppercase">Time</div>
					<div class="text-xs font-mono text-text-primary">{elapsedDisplay}</div>
				</div>
				<div class="bg-white/[0.02] rounded-lg px-2 py-1.5">
					<div class="text-[10px] text-text-muted uppercase">Records</div>
					<div class="text-xs font-mono text-text-primary">{collectionStore.recordsRecorded.toLocaleString()}</div>
				</div>
			</div>
		{/if}

		{#if collectionStore.lastError}
			<div class="text-xs text-danger/80 bg-danger/5 rounded-lg px-3 py-2 mb-3 border border-danger/10">
				{collectionStore.lastError}
			</div>
		{/if}
	</div>

	<!-- Bus List -->
	<div class="flex-1 overflow-y-auto">
		<BusList />
	</div>

	<!-- Violation Feed -->
	<ViolationFeed />
</div>
