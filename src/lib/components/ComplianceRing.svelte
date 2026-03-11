<script lang="ts">
	import { busStore } from '$lib/stores/buses.svelte';

	const total = $derived(busStore.activeCount);
	const violations = $derived(busStore.violationCount);
	const compliance = $derived(total > 0 ? ((total - violations) / total) * 100 : 100);

	// SVG circle math
	const size = 36;
	const strokeWidth = 3;
	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;
	const dashOffset = $derived(circumference - (compliance / 100) * circumference);

	// Color shifts: green when high compliance, through amber to red
	const ringColor = $derived(
		compliance >= 90 ? '#10b981' :
		compliance >= 70 ? '#f59e0b' :
		'#ef4444'
	);
</script>

<div class="relative flex items-center justify-center" style="width: {size}px; height: {size}px;" title="{Math.round(compliance)}% fleet compliance">
	<svg width={size} height={size} class="transform -rotate-90">
		<!-- Background track -->
		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke="rgba(255,255,255,0.06)"
			stroke-width={strokeWidth}
		/>
		<!-- Compliance arc -->
		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke={ringColor}
			stroke-width={strokeWidth}
			stroke-dasharray={circumference}
			stroke-dashoffset={dashOffset}
			stroke-linecap="round"
			style="transition: stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.5s ease; filter: drop-shadow(0 0 4px {ringColor}60);"
		/>
	</svg>
	<!-- Center text -->
	<div class="absolute inset-0 flex items-center justify-center">
		<span class="text-[9px] font-bold font-mono tabular-nums" style="color: {ringColor}; text-shadow: 0 0 8px {ringColor}40;">
			{Math.round(compliance)}
		</span>
	</div>
</div>
