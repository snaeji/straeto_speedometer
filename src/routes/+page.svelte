<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SpeedLimitService } from '$lib/services/speed-limit-service';
	import { StorageService } from '$lib/services/storage-service';
	import { appStore } from '$lib/stores/app.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import { playbackStore } from '$lib/stores/playback.svelte';
	import { statsStore } from '$lib/stores/stats.svelte';
	import { busStore } from '$lib/stores/buses.svelte';
	import Dashboard from '$lib/components/Dashboard.svelte';

	let initialized = $state(false);
	let loadingMessage = $state('Initializing...');
	let error = $state<string | null>(null);

	const speedLimitService = new SpeedLimitService();
	const storageService = new StorageService();

	onMount(async () => {
		try {
			// Step 1: Load speed limit data
			loadingMessage = 'Loading speed limit data...';
			const response = await fetch('/speed_limits.geojson');
			if (!response.ok) throw new Error('Failed to load speed_limits.geojson');
			const geoJson = await response.json();
			speedLimitService.loadFromGeoJson(geoJson);
			appStore.speedLimitsLoaded = true;

			// Step 2: Open IndexedDB
			loadingMessage = 'Opening database...';
			await storageService.open();

			// Step 3: Initialize stores
			loadingMessage = 'Starting services...';
			await collectionStore.init(speedLimitService, storageService);
			await playbackStore.init(storageService);
			await statsStore.init(storageService);

			initialized = true;
		} catch (err) {
			console.error('Initialization error:', err);
			error = err instanceof Error ? err.message : 'Unknown error';
		}
	});

	onDestroy(() => {
		collectionStore.destroy();
		playbackStore.destroy();
	});

	function handleKeydown(e: KeyboardEvent) {
		// Don't handle if user is typing in an input
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

		switch (e.key) {
			case ' ':
				if (appStore.mode === 'playback') {
					e.preventDefault();
					playbackStore.isPlaying ? playbackStore.pause() : playbackStore.play();
				}
				break;
			case 'ArrowLeft':
				if (appStore.mode === 'playback') {
					e.preventDefault();
					playbackStore.stepBackward();
				}
				break;
			case 'ArrowRight':
				if (appStore.mode === 'playback') {
					e.preventDefault();
					playbackStore.stepForward();
				}
				break;
			case 'Escape':
				busStore.selectBus(null);
				break;
			case 'f':
				busStore.autoFollow = !busStore.autoFollow;
				break;
			case 'b':
				appStore.toggleSidebar();
				break;
			case '1': appStore.setMode('live'); break;
			case '2': appStore.setMode('playback'); break;
			case '3': appStore.setMode('stats'); break;
			case '4': appStore.setMode('heatmap'); break;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if error}
	<div class="flex items-center justify-center h-screen bg-bg-primary">
		<div class="glass-strong rounded-2xl p-8 max-w-md text-center">
			<div class="text-4xl mb-4">&#9888;</div>
			<h2 class="text-xl font-semibold text-text-primary mb-2">Failed to Initialize</h2>
			<p class="text-text-secondary text-sm mb-6">{error}</p>
			<button
				class="px-6 py-2 rounded-xl bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30 transition-all cursor-pointer"
				onclick={() => window.location.reload()}
			>
				Retry
			</button>
		</div>
	</div>
{:else if !initialized}
	<div class="flex items-center justify-center h-screen bg-bg-primary">
		<div class="flex flex-col items-center gap-4">
			<div class="relative">
				<div class="w-12 h-12 rounded-full border-2 border-accent/20"></div>
				<div class="absolute inset-0 w-12 h-12 rounded-full border-2 border-transparent border-t-accent animate-spin"></div>
			</div>
			<p class="text-text-secondary text-sm font-mono">{loadingMessage}</p>
		</div>
	</div>
{:else}
	<Dashboard />
{/if}
