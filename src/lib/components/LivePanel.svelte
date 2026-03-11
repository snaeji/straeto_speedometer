<script lang="ts">
	import { collectionStore } from '$lib/stores/collection.svelte';
	import { busStore } from '$lib/stores/buses.svelte';
	import { formatBytes, formatElapsed } from '$lib/utils/format';
	import BusList from './BusList.svelte';
	import ViolationFeed from './ViolationFeed.svelte';

	let showClearConfirm = $state(false);
	let isExporting = $state(false);
	let importInput: HTMLInputElement;

	async function handleExport() {
		if (!collectionStore.storageService || isExporting) return;
		isExporting = true;
		try {
			const text = await collectionStore.storageService.exportJsonl();
			const blob = new Blob([text], { type: 'application/jsonl' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `straeto-${new Date().toISOString().slice(0, 10)}.jsonl`;
			a.click();
			URL.revokeObjectURL(url);
		} finally {
			isExporting = false;
		}
	}

	async function handleImport() {
		const files = importInput?.files;
		if (!files) return;

		let total = 0;
		for (const file of files) {
			const text = await file.text();
			total += await collectionStore.importFile(text);
		}

		if (total > 0) {
			alert(`Imported ${total.toLocaleString()} records`);
		}
	}

	function handleClear() {
		collectionStore.clearData();
		showClearConfirm = false;
	}

	let elapsedDisplay = $state('0:00');
	let elapsedTimer: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		if (collectionStore.isCollecting || collectionStore.isDemoMode) {
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
	<!-- Collection Controls -->
	<div class="p-4 border-b border-white/5">
		<h3 class="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-3">Data Collection</h3>
		<div class="flex gap-2 mb-3">
			{#if collectionStore.isCollecting}
				<button
					class="flex-1 py-2 rounded-xl bg-danger/15 text-danger border border-danger/20 text-xs font-medium hover:bg-danger/25 transition-all cursor-pointer"
					onclick={() => collectionStore.stopCollecting()}
				>
					Stop Collecting
				</button>
			{:else if collectionStore.isDemoMode}
				<button
					class="flex-1 py-2 rounded-xl bg-warning/15 text-warning border border-warning/20 text-xs font-medium hover:bg-warning/25 transition-all cursor-pointer"
					onclick={() => collectionStore.stopDemoMode()}
				>
					Stop Demo
				</button>
			{:else}
				<button
					class="flex-1 py-2 rounded-xl bg-success/15 text-success border border-success/20 text-xs font-medium hover:bg-success/25 transition-all cursor-pointer"
					onclick={() => collectionStore.startCollecting()}
				>
					Start Collecting
				</button>
			{/if}

			{#if !collectionStore.isCollecting && !collectionStore.isDemoMode}
				<button
					class="py-2 px-3 rounded-xl text-xs font-medium transition-all cursor-pointer
						{collectionStore.isPreviewing
							? 'bg-accent/15 text-accent border border-accent/20'
							: 'bg-white/[0.03] text-text-secondary border border-white/[0.06] hover:border-white/[0.1]'}"
					onclick={() =>
						collectionStore.isPreviewing
							? collectionStore.stopPreviewing()
							: collectionStore.startPreviewing()}
					title="Preview live data without storing"
				>
					{collectionStore.isPreviewing ? 'Stop Preview' : 'Preview'}
				</button>
				<button
					class="py-2 px-3 rounded-xl text-xs font-medium transition-all cursor-pointer bg-warning/[0.08] text-warning/80 border border-warning/15 hover:bg-warning/15 hover:text-warning"
					onclick={() => collectionStore.startDemoMode()}
					title="Simulated bus data for testing"
				>
					Demo
				</button>
			{/if}
		</div>

		<!-- Collection Stats -->
		{#if collectionStore.isCollecting || collectionStore.isDemoMode}
			<div class="grid grid-cols-3 gap-2 mb-3">
				<div class="bg-white/[0.02] rounded-lg px-2 py-1.5">
					<div class="text-[10px] text-text-muted uppercase">Time</div>
					<div class="text-xs font-mono text-text-primary">{elapsedDisplay}</div>
				</div>
				<div class="bg-white/[0.02] rounded-lg px-2 py-1.5">
					<div class="text-[10px] text-text-muted uppercase">Records</div>
					<div class="text-xs font-mono text-text-primary">{collectionStore.recordsCollected.toLocaleString()}</div>
				</div>
				<div class="bg-white/[0.02] rounded-lg px-2 py-1.5">
					<div class="text-[10px] text-text-muted uppercase">Violations</div>
					<div class="text-xs font-mono {collectionStore.violationsDetected > 0 ? 'text-danger' : 'text-text-primary'}">{collectionStore.violationsDetected}</div>
				</div>
			</div>
		{/if}

		{#if collectionStore.lastError}
			<div class="text-xs text-danger/80 bg-danger/5 rounded-lg px-3 py-2 mb-3 border border-danger/10">
				{collectionStore.lastError}
			</div>
		{/if}

		<!-- Import / Export / Storage -->
		<div class="flex items-center gap-1.5 text-xs flex-wrap">
			<input bind:this={importInput} type="file" accept=".jsonl" multiple class="hidden" onchange={handleImport} />
			<button
				class="px-2.5 py-1.5 rounded-lg bg-white/[0.03] text-text-secondary border border-white/[0.06] hover:border-white/[0.1] transition-all cursor-pointer"
				onclick={() => importInput?.click()}
			>
				Import
			</button>

			{#if collectionStore.recordCount > 0}
				<button
					class="px-2.5 py-1.5 rounded-lg bg-white/[0.03] text-text-secondary border border-white/[0.06] hover:border-white/[0.1] transition-all cursor-pointer"
					onclick={handleExport}
					disabled={isExporting}
				>
					{isExporting ? 'Exporting...' : 'Export'}
				</button>
			{/if}

			<div class="flex-1 text-right text-text-muted font-mono text-[10px]">
				{collectionStore.recordCount.toLocaleString()} rec &middot; {formatBytes(collectionStore.storageBytes)}
			</div>

			{#if collectionStore.recordCount > 0}
				{#if showClearConfirm}
					<button class="px-2 py-1 rounded-lg bg-danger/15 text-danger text-[10px] cursor-pointer" onclick={handleClear}>
						Confirm
					</button>
					<button class="px-2 py-1 rounded-lg bg-white/5 text-text-muted text-[10px] cursor-pointer" onclick={() => (showClearConfirm = false)}>
						Cancel
					</button>
				{:else}
					<button
						class="px-2 py-1 rounded-lg text-text-muted hover:text-danger text-[10px] transition-colors cursor-pointer"
						onclick={() => (showClearConfirm = true)}
						title="Clear all stored data"
					>
						Clear
					</button>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Bus List -->
	<div class="flex-1 overflow-y-auto">
		<BusList />
	</div>

	<!-- Violation Feed -->
	<ViolationFeed />
</div>
