<script lang="ts">
	import { appStore } from '$lib/stores/app.svelte';
	import { busStore } from '$lib/stores/buses.svelte';
	import TopBar from './TopBar.svelte';
	import MapView from './MapView.svelte';
	import Sidebar from './Sidebar.svelte';
	import PlaybackBar from './PlaybackBar.svelte';
	import SpeedGraph from './SpeedGraph.svelte';
</script>

<div class="h-screen w-screen overflow-hidden bg-bg-primary relative">
	<!-- Map (always full background) -->
	<MapView />

	<!-- Top Bar (floating glass) -->
	<div class="absolute top-0 left-0 right-0 z-20">
		<TopBar />
	</div>

	<!-- Sidebar (floating glass, sliding) -->
	<div
		class="absolute top-16 left-3 bottom-3 z-10 transition-all duration-300"
		style="transform: translateX({appStore.sidebarOpen ? '0' : '-110%'}); width: {appStore.mode === 'stats' ? '420px' : '320px'}"
		style:transition-timing-function="cubic-bezier(0.16, 1, 0.3, 1)"
	>
		<Sidebar />
	</div>

	<!-- Speed Graph (floating glass, bottom right) -->
	{#if busStore.selectedBusId}
		<div
			class="absolute bottom-3 right-3 z-10"
			style="left: {appStore.sidebarOpen ? (appStore.mode === 'stats' ? '440px' : '340px') : '12px'}; transition: left 0.3s cubic-bezier(0.16, 1, 0.3, 1), bottom 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
			style:bottom={appStore.mode === 'playback' ? '88px' : '12px'}
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

	<!-- Keyboard shortcut hint (bottom right corner) -->
	<div class="absolute bottom-3 right-3 z-5 text-text-muted text-[10px] font-mono opacity-40 pointer-events-none select-none"
		style:bottom={busStore.selectedBusId ? '210px' : (appStore.mode === 'playback' ? '88px' : '12px')}
	>
		B: sidebar &middot; 1-4: modes &middot; Esc: deselect
	</div>
</div>
