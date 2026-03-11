<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SpeedLimitService } from '$lib/services/speed-limit-service';
	import { StorageService } from '$lib/services/storage-service';
	import { appStore } from '$lib/stores/app.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import { playbackStore } from '$lib/stores/playback.svelte';
	import { statsStore } from '$lib/stores/stats.svelte';
	import { busStore } from '$lib/stores/buses.svelte';
	import { base } from '$app/paths';
	import Dashboard from '$lib/components/Dashboard.svelte';

	let initialized = $state(false);
	let loadingMessage = $state('Initializing...');
	let loadingProgress = $state(0);
	let error = $state<string | null>(null);

	const speedLimitService = new SpeedLimitService();
	const storageService = new StorageService();

	onMount(async () => {
		try {
			// Step 1: Load speed limit data
			loadingMessage = 'Loading speed limits';
			loadingProgress = 20;
			const response = await fetch(`${base}/speed_limits.geojson`);
			if (!response.ok) throw new Error('Failed to load speed_limits.geojson');
			const geoJson = await response.json();
			speedLimitService.loadFromGeoJson(geoJson);
			appStore.speedLimitGeoJson = geoJson;
			appStore.speedLimitsLoaded = true;
			loadingProgress = 50;

			// Step 2: Open IndexedDB
			loadingMessage = 'Opening database';
			loadingProgress = 65;
			await storageService.open();

			// Step 3: Initialize stores
			loadingMessage = 'Starting services';
			loadingProgress = 80;
			await collectionStore.init(speedLimitService, storageService);
			await playbackStore.init(storageService);
			await statsStore.init(storageService);

			loadingProgress = 100;
			await new Promise((r) => setTimeout(r, 200)); // Brief pause for visual
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
	<div class="flex items-center justify-center h-screen bg-bg-primary relative overflow-hidden">
		<!-- Animated ambient glows -->
		<div class="absolute top-1/3 left-1/3 w-[500px] h-[500px] rounded-full opacity-15"
			style="background: radial-gradient(circle, rgba(6, 182, 212, 0.2) 0%, transparent 70%);
				animation: loading-glow-1 4s ease-in-out infinite alternate;"
		></div>
		<div class="absolute bottom-1/3 right-1/3 w-[400px] h-[400px] rounded-full opacity-10"
			style="background: radial-gradient(circle, rgba(16, 185, 129, 0.2) 0%, transparent 70%);
				animation: loading-glow-2 5s ease-in-out infinite alternate;"
		></div>

		<!-- Grid pattern overlay -->
		<div class="absolute inset-0 opacity-[0.02]"
			style="background-image: linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
				linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px);
				background-size: 60px 60px;"
		></div>

		<div class="flex flex-col items-center gap-8 z-10" style="animation: fade-in 0.6s ease-out">
			<!-- Logo with glow -->
			<div class="flex items-center gap-3">
				<div class="w-12 h-12 rounded-2xl bg-accent/15 border border-accent/20 flex items-center justify-center"
					style="box-shadow: 0 0 30px rgba(6, 182, 212, 0.15), 0 0 60px rgba(6, 182, 212, 0.05);"
				>
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="text-accent" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="12" cy="12" r="10" />
						<path d="M12 6v6l4 2" />
					</svg>
				</div>
				<div class="flex flex-col">
					<span class="text-xl font-bold tracking-[0.2em] text-text-primary">THE STRAETO</span>
					<span class="text-[10px] tracking-[0.3em] text-text-muted font-medium uppercase">Speedometer</span>
				</div>
			</div>

			<!-- Progress bar -->
			<div class="w-56 flex flex-col items-center gap-3">
				<div class="w-full h-1 rounded-full bg-white/[0.06] overflow-hidden">
					<div
						class="h-full rounded-full transition-all duration-500 ease-out"
						style="width: {loadingProgress}%; background: linear-gradient(90deg, #06b6d4, #10b981);
							box-shadow: 0 0 10px rgba(6, 182, 212, 0.4);"
					></div>
				</div>
				<p class="text-text-muted text-[11px] font-mono tracking-wider">{loadingMessage}</p>
			</div>
		</div>
	</div>
{:else}
	<Dashboard />
{/if}
