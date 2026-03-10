<script lang="ts">
	import { playbackStore } from '$lib/stores/playback.svelte';
	import { formatTime, formatDate } from '$lib/utils/format';
	import type { PlaybackSpeed } from '$lib/types/bus';

	const speeds: PlaybackSpeed[] = [1, 2, 5, 10];
</script>

<div class="glass-strong rounded-2xl px-5 py-3 flex items-center gap-4">
	<!-- Transport controls -->
	<div class="flex items-center gap-1 shrink-0">
		<button
			class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary"
			onclick={() => playbackStore.stepBackward()}
			title="Step back 5s (Left arrow)"
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
				<path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
			</svg>
		</button>

		<button
			class="w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer
				{playbackStore.isPlaying
					? 'bg-accent/15 text-accent border border-accent/20'
					: 'bg-white/5 text-text-primary border border-white/10 hover:bg-white/10'}"
			onclick={() => (playbackStore.isPlaying ? playbackStore.pause() : playbackStore.play())}
			title="Play/Pause (Space)"
		>
			{#if playbackStore.isPlaying}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
				</svg>
			{:else}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z" />
				</svg>
			{/if}
		</button>

		<button
			class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary"
			onclick={() => playbackStore.stepForward()}
			title="Step forward 5s (Right arrow)"
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
				<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
			</svg>
		</button>
	</div>

	<!-- Speed selector -->
	<div class="flex items-center gap-0.5 shrink-0 bg-white/[0.02] rounded-lg p-0.5 border border-white/[0.04]">
		{#each speeds as s}
			<button
				class="px-2 py-1 rounded-md text-[10px] font-mono font-medium transition-all cursor-pointer
					{playbackStore.speed === s
						? 'bg-accent/15 text-accent border border-accent/20'
						: 'text-text-muted hover:text-text-secondary border border-transparent'}"
				onclick={() => playbackStore.setSpeed(s)}
			>
				{s}x
			</button>
		{/each}
	</div>

	<!-- Timeline slider -->
	<div class="flex-1 flex flex-col gap-1 min-w-0">
		<input
			type="range"
			min={playbackStore.startTimestamp}
			max={playbackStore.endTimestamp}
			value={playbackStore.currentTimestamp}
			oninput={(e) => playbackStore.seekTo(Number((e.target as HTMLInputElement).value))}
			class="w-full h-1.5 rounded-full appearance-none cursor-pointer"
			style="background: linear-gradient(90deg, rgba(6,182,212,0.4) {playbackStore.progress * 100}%, rgba(255,255,255,0.06) {playbackStore.progress * 100}%)"
		/>
		<div class="flex justify-between text-[10px] text-text-muted font-mono">
			<span>{formatDate(playbackStore.startTimestamp)} {formatTime(playbackStore.startTimestamp)}</span>
			<span>{formatDate(playbackStore.endTimestamp)} {formatTime(playbackStore.endTimestamp)}</span>
		</div>
	</div>

	<!-- Current time -->
	<div class="shrink-0 text-right">
		<div class="text-xs font-mono font-semibold text-text-primary tabular-nums">
			{formatTime(playbackStore.currentTimestamp)}
		</div>
		<div class="text-[10px] font-mono text-text-muted">
			{formatDate(playbackStore.currentTimestamp)}
		</div>
	</div>
</div>

<style>
	input[type='range']::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #06b6d4;
		border: 2px solid rgba(255, 255, 255, 0.8);
		cursor: pointer;
		box-shadow: 0 0 8px rgba(6, 182, 212, 0.4);
	}

	input[type='range']::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #06b6d4;
		border: 2px solid rgba(255, 255, 255, 0.8);
		cursor: pointer;
		box-shadow: 0 0 8px rgba(6, 182, 212, 0.4);
	}
</style>
