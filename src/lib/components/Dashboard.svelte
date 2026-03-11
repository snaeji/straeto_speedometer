<script lang="ts">
	import { appStore } from '$lib/stores/app.svelte';
	import { busStore } from '$lib/stores/buses.svelte';
	import TopBar from './TopBar.svelte';
	import MapView from './MapView.svelte';
	import Sidebar from './Sidebar.svelte';
	import PlaybackBar from './PlaybackBar.svelte';
	import SpeedGraph from './SpeedGraph.svelte';
	import ViolationFlash from './ViolationFlash.svelte';
</script>

<div class="h-screen w-screen overflow-hidden bg-bg-primary relative">
	<!-- Map (always full background) -->
	<MapView />

	<!-- Vignette overlay for depth -->
	<div class="absolute inset-0 pointer-events-none z-[1]"
		style="background: radial-gradient(ellipse at center, transparent 40%, rgba(3, 7, 18, 0.4) 100%)"
	></div>

	<!-- Top edge shadow -->
	<div class="absolute top-0 left-0 right-0 h-24 pointer-events-none z-[1]"
		style="background: linear-gradient(180deg, rgba(3, 7, 18, 0.5) 0%, transparent 100%)"
	></div>

	<!-- Top Bar (floating glass) -->
	<div class="absolute top-0 left-0 right-0 z-20">
		<TopBar />
	</div>

	<!-- Sidebar (floating glass, sliding) -->
	<div
		class="absolute left-3 bottom-3 z-10 transition-all duration-300"
		style="top: 68px; transform: translateX({appStore.sidebarOpen ? '0' : 'calc(-100% - 24px)'}); width: {appStore.mode === 'stats' ? '420px' : '320px'}"
		style:transition-timing-function="cubic-bezier(0.16, 1, 0.3, 1)"
	>
		<Sidebar />
	</div>

	<!-- Bus Detail Panel (floating glass, right side) -->
	{#if busStore.selectedBusId}
		<div
			class="absolute right-3 z-10 transition-all duration-300"
			style="top: 68px;
				bottom: {appStore.mode === 'playback' ? '88px' : '12px'};
				transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1)"
		>
			<SpeedGraph />
		</div>
	{/if}

	<!-- Playback Bar (floating glass, bottom) -->
	{#if appStore.mode === 'playback'}
		<div
			class="absolute bottom-3 left-3 right-3 z-10"
			style="animation: slide-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
		>
			<PlaybackBar />
		</div>
	{/if}

	<!-- Violation screen flash -->
	<ViolationFlash />

	<!-- Keyboard shortcut hint -->
	<div class="absolute right-4 z-[2] text-text-muted text-[10px] font-mono opacity-30 pointer-events-none select-none transition-all duration-300"
		style:bottom={busStore.selectedBusId ? '210px' : (appStore.mode === 'playback' ? '92px' : '16px')}
	>
		B sidebar &middot; 1-4 modes &middot; Esc deselect &middot; F follow
	</div>
</div>
