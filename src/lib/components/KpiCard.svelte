<script lang="ts">
	let {
		label,
		value,
		unit = '',
		icon,
		variant = 'default',
	}: {
		label: string;
		value: number;
		unit?: string;
		icon: string;
		variant?: 'default' | 'danger';
	} = $props();

	const iconPaths: Record<string, string> = {
		bus: 'M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z',
		alert: 'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z',
		speed: 'M20.38 8.57l-1.23 1.85a8 8 0 01-.22 7.58H5.07A8 8 0 0115.58 6.85l1.85-1.23A10 10 0 003.35 19a2 2 0 001.72 1h13.85a2 2 0 001.74-1 10 10 0 00-.27-10.44zM10.59 15.41a2 2 0 002.83 0l5.66-8.49-8.49 5.66a2 2 0 000 2.83z',
	};

	let isDanger = $derived(variant === 'danger' && value > 0);

	// Smooth animated value display
	let displayValue = $state(value);
	let animFrame = 0;

	$effect(() => {
		const target = value;
		const start = displayValue;
		if (start === target) {
			if (animFrame) cancelAnimationFrame(animFrame);
			return;
		}

		const startTime = performance.now();
		const duration = 400;

		function tick() {
			const elapsed = performance.now() - startTime;
			const t = Math.min(elapsed / duration, 1);
			const ease = 1 - Math.pow(1 - t, 3);
			displayValue = Math.round(start + (target - start) * ease);
			if (t < 1) animFrame = requestAnimationFrame(tick);
		}
		cancelAnimationFrame(animFrame);
		animFrame = requestAnimationFrame(tick);
	});
</script>

<div
	class="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border transition-all duration-300 relative overflow-hidden
		{isDanger
			? 'bg-gradient-to-br from-danger/[0.15] to-danger/[0.05] border-danger/25'
			: 'bg-gradient-to-br from-white/[0.05] to-white/[0.01] border-white/[0.06] hover:border-white/[0.12]'}"
	style={isDanger ? 'box-shadow: 0 0 16px rgba(239,68,68,0.12), inset 0 0 20px rgba(239,68,68,0.05);' : ''}
>
	<svg
		width="13"
		height="13"
		viewBox="0 0 24 24"
		fill="currentColor"
		class="shrink-0 {isDanger ? 'text-danger' : 'text-text-muted'}"
	>
		<path d={iconPaths[icon] ?? iconPaths.bus} />
	</svg>
	<div class="flex flex-col min-w-0">
		<span class="text-[9px] uppercase tracking-wider text-text-muted leading-none font-medium">{label}</span>
		<div class="flex items-baseline gap-0.5">
			<span class="text-sm font-bold font-mono tabular-nums leading-tight
				{isDanger ? 'text-danger' : 'text-text-primary'}"
				style={isDanger ? 'text-shadow: 0 0 12px rgba(239,68,68,0.4);' : ''}
			>
				{displayValue}
			</span>
			{#if unit}
				<span class="text-[9px] text-text-muted">{unit}</span>
			{/if}
		</div>
	</div>
</div>
