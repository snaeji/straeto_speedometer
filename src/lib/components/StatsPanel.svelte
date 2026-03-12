<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as echarts from 'echarts';
	import { statsStore } from '$lib/stores/stats.svelte';
	import { busStore } from '$lib/stores/buses.svelte';
	import { formatDistance } from '$lib/utils/format';

	let routeChartEl: HTMLDivElement;
	let hourlyChartEl: HTMLDivElement;
	let speedChartEl: HTMLDivElement;
	let distChartEl: HTMLDivElement;
	let routeChart: echarts.ECharts | null = null;
	let hourlyChart: echarts.ECharts | null = null;
	let speedChart: echarts.ECharts | null = null;
	let distChart: echarts.ECharts | null = null;

	const chartTheme = {
		backgroundColor: 'transparent',
		textStyle: { color: '#94a3b8', fontFamily: 'var(--font-sans)' },
		grid: { left: 48, right: 16, top: 24, bottom: 32, containLabel: false },
	};

	let lastComputedLength = 0;
	const hasData = $derived(statsStore.totalRecords > 0);

	onMount(async () => {
		// Chart containers are always in DOM now, so init immediately
		routeChart = echarts.init(routeChartEl, undefined, { renderer: 'canvas' });
		hourlyChart = echarts.init(hourlyChartEl, undefined, { renderer: 'canvas' });
		speedChart = echarts.init(speedChartEl, undefined, { renderer: 'canvas' });
		distChart = echarts.init(distChartEl, undefined, { renderer: 'canvas' });

		const ro = new ResizeObserver(() => {
			routeChart?.resize();
			hourlyChart?.resize();
			speedChart?.resize();
			distChart?.resize();
		});
		ro.observe(routeChartEl);
		ro.observe(hourlyChartEl);
		ro.observe(speedChartEl);
		ro.observe(distChartEl);

		await statsStore.computeStats();
	});

	// Reactively recompute stats when liveHistory grows
	$effect(() => {
		const len = busStore.liveHistory.length;
		if (len > 0 && len - lastComputedLength >= 50) {
			lastComputedLength = len;
			statsStore.computeStats();
		}
	});

	onDestroy(() => {
		routeChart?.dispose();
		hourlyChart?.dispose();
		speedChart?.dispose();
		distChart?.dispose();
	});

	// Update route violations chart
	$effect(() => {
		if (!routeChart || statsStore.routeStats.length === 0) return;
		const top10 = statsStore.routeStats.slice(0, 10);
		routeChart.setOption({
			...chartTheme,
			tooltip: {
				trigger: 'axis',
				backgroundColor: 'rgba(8, 14, 30, 0.9)',
				borderColor: 'rgba(255,255,255,0.1)',
				textStyle: { color: '#f1f5f9', fontSize: 11 },
			},
			xAxis: {
				type: 'category',
				data: top10.map((r) => `R${r.routeNr}`),
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
				axisLabel: { color: '#64748b', fontSize: 10 },
			},
			yAxis: {
				type: 'value',
				splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
				axisLabel: { color: '#64748b', fontSize: 10 },
			},
			series: [{
				type: 'bar',
				data: top10.map((r) => r.violations),
				barWidth: '50%',
				itemStyle: {
					borderRadius: [4, 4, 0, 0],
					color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
						{ offset: 0, color: '#ef4444' },
						{ offset: 1, color: '#991b1b' },
					]),
				},
			}],
			animationDuration: 600,
			animationEasing: 'cubicOut',
		});
	});

	// Update hourly violations chart
	$effect(() => {
		if (!hourlyChart || statsStore.violationsByHour.length === 0) return;
		hourlyChart.setOption({
			...chartTheme,
			tooltip: {
				trigger: 'axis',
				backgroundColor: 'rgba(8, 14, 30, 0.9)',
				borderColor: 'rgba(255,255,255,0.1)',
				textStyle: { color: '#f1f5f9', fontSize: 11 },
				formatter: (params: {value: number; name: string}[]) => {
					const p = Array.isArray(params) ? params[0] : params;
					return `${p.name}:00 — ${p.value} violations`;
				},
			},
			xAxis: {
				type: 'category',
				data: statsStore.violationsByHour.map((h) => String(h.hour).padStart(2, '0')),
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
				axisLabel: { color: '#64748b', fontSize: 9, interval: 2 },
			},
			yAxis: {
				type: 'value',
				splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
				axisLabel: { color: '#64748b', fontSize: 10 },
			},
			series: [{
				type: 'bar',
				data: statsStore.violationsByHour.map((h) => h.count),
				barWidth: '60%',
				itemStyle: {
					borderRadius: [3, 3, 0, 0],
					color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
						{ offset: 0, color: '#f59e0b' },
						{ offset: 1, color: '#92400e' },
					]),
				},
			}],
			animationDuration: 600,
			animationDelay: 200,
		});
	});

	// Update average speed chart
	$effect(() => {
		if (!speedChart || statsStore.routeStats.length === 0) return;
		const sorted = statsStore.routeStats.slice().sort((a, b) => parseInt(a.routeNr) - parseInt(b.routeNr));
		speedChart.setOption({
			...chartTheme,
			tooltip: {
				trigger: 'axis',
				backgroundColor: 'rgba(8, 14, 30, 0.9)',
				borderColor: 'rgba(255,255,255,0.1)',
				textStyle: { color: '#f1f5f9', fontSize: 11 },
				formatter: (params: {value: number; name: string}[]) => {
					const p = Array.isArray(params) ? params[0] : params;
					return `Route ${p.name.replace('R', '')}: ${p.value} km/h avg`;
				},
			},
			xAxis: {
				type: 'category',
				data: sorted.map((r) => `R${r.routeNr}`),
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
				axisLabel: { color: '#64748b', fontSize: 9, rotate: 45 },
			},
			yAxis: {
				type: 'value',
				splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
				axisLabel: { color: '#64748b', fontSize: 10 },
			},
			series: [{
				type: 'bar',
				data: sorted.map((r) => r.avgSpeed),
				barWidth: '50%',
				itemStyle: {
					borderRadius: [3, 3, 0, 0],
					color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
						{ offset: 0, color: '#06b6d4' },
						{ offset: 1, color: '#0e7490' },
					]),
				},
			}],
			animationDuration: 600,
			animationDelay: 400,
		});
	});

	// Update speed distribution chart
	$effect(() => {
		if (!distChart || statsStore.speedDistribution.length === 0) return;
		distChart.setOption({
			...chartTheme,
			tooltip: {
				trigger: 'axis',
				backgroundColor: 'rgba(8, 14, 30, 0.9)',
				borderColor: 'rgba(255,255,255,0.1)',
				textStyle: { color: '#f1f5f9', fontSize: 11 },
				formatter: (params: {value: number; name: string}[]) => {
					const p = Array.isArray(params) ? params[0] : params;
					return `${p.name} km/h — ${p.value.toLocaleString()} records`;
				},
			},
			xAxis: {
				type: 'category',
				data: statsStore.speedDistribution.map((b) => b.range),
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
				axisLabel: { color: '#64748b', fontSize: 9 },
			},
			yAxis: {
				type: 'value',
				splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
				axisLabel: { color: '#64748b', fontSize: 10 },
			},
			series: [{
				type: 'bar',
				data: statsStore.speedDistribution.map((b) => b.count),
				barWidth: '60%',
				itemStyle: {
					borderRadius: [3, 3, 0, 0],
					color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
						{ offset: 0, color: '#06b6d4' },
						{ offset: 1, color: '#d97706' },
					]),
				},
			}],
			animationDuration: 600,
			animationDelay: 600,
		});
	});
</script>

<div class="flex flex-col h-full overflow-y-auto">
	<div class="p-4 border-b border-white/5">
		<h2 class="text-sm font-semibold text-text-primary mb-3">Fleet Statistics</h2>

		<!-- Summary cards -->
		<div class="grid grid-cols-2 gap-2 mb-1">
			<div class="bg-white/[0.02] rounded-xl px-3 py-2 border border-white/[0.04]">
				<div class="text-[10px] text-text-muted uppercase tracking-wider">Buses Tracked</div>
				<div class="text-lg font-semibold font-mono text-text-primary">{statsStore.totalBusesTracked}</div>
			</div>
			<div class="bg-white/[0.02] rounded-xl px-3 py-2 border border-white/[0.04]">
				<div class="text-[10px] text-text-muted uppercase tracking-wider">Total Distance</div>
				<div class="text-lg font-semibold font-mono text-text-primary">{formatDistance(statsStore.totalDistanceKm)}</div>
			</div>
			<div class="bg-white/[0.02] rounded-xl px-3 py-2 border border-white/[0.04]">
				<div class="text-[10px] text-text-muted uppercase tracking-wider">Total Records</div>
				<div class="text-lg font-semibold font-mono text-text-primary">{statsStore.totalRecords.toLocaleString()}</div>
			</div>
			<div class="bg-white/[0.02] rounded-xl px-3 py-2 border border-white/[0.04]">
				<div class="text-[10px] text-text-muted uppercase tracking-wider">Violations</div>
				<div class="text-lg font-semibold font-mono text-danger">{statsStore.totalViolations.toLocaleString()}</div>
			</div>
		</div>
	</div>

	{#if statsStore.isComputing}
		<div class="flex items-center justify-center py-12">
			<div class="flex items-center gap-3 text-text-secondary text-xs">
				<div class="w-4 h-4 rounded-full border-2 border-transparent border-t-accent animate-spin"></div>
				Computing statistics...
			</div>
		</div>
	{:else if !hasData}
		<div class="flex flex-col items-center justify-center py-12 px-4">
			<p class="text-xs text-text-muted text-center">No data available</p>
			<p class="text-[10px] text-text-muted/60 text-center mt-1">Record or import data first</p>
		</div>
	{/if}

	<!-- Top Speeders (only shown when data available) -->
	{#if hasData && statsStore.topSpeeders.length > 0}
		<div class="px-4 pt-4 pb-2">
			<h3 class="text-xs font-medium text-text-secondary mb-2">Top Speeders</h3>
			<div class="rounded-xl border border-white/[0.04] overflow-hidden">
				<div class="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.04]">
					<span class="text-[9px] text-text-muted uppercase tracking-wider">Bus ID</span>
					<span class="text-[9px] text-text-muted uppercase tracking-wider">Route</span>
					<span class="text-[9px] text-text-muted uppercase tracking-wider text-right">Max Spd</span>
					<span class="text-[9px] text-text-muted uppercase tracking-wider text-right">Viol.</span>
				</div>
				{#each statsStore.topSpeeders as speeder, i}
					<div class="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-3 py-1.5
						{i % 2 === 0 ? 'bg-white/[0.01]' : 'bg-white/[0.03]'}
						{i < statsStore.topSpeeders.length - 1 ? 'border-b border-white/[0.03]' : ''}">
						<span class="text-[11px] font-mono text-text-primary truncate">{speeder.busId}</span>
						<span class="inline-flex items-center justify-center min-w-[28px] h-5 rounded-md px-1.5 text-[10px] font-bold text-white bg-accent/70">{speeder.routeNr}</span>
						<span class="text-[11px] font-mono tabular-nums text-text-secondary text-right">{speeder.maxSpeed}</span>
						<span class="text-[11px] font-mono tabular-nums text-danger text-right font-medium">{speeder.violations}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Charts — always in DOM so echarts.init works in onMount -->
	<div class="p-4 space-y-4" class:hidden={!hasData}>
		<div>
			<h3 class="text-xs font-medium text-text-secondary mb-2">Violations by Route (Top 10)</h3>
			<div bind:this={routeChartEl} class="w-full h-44 rounded-xl bg-white/[0.01]"></div>
		</div>

		<div>
			<h3 class="text-xs font-medium text-text-secondary mb-2">Violations by Hour</h3>
			<div bind:this={hourlyChartEl} class="w-full h-44 rounded-xl bg-white/[0.01]"></div>
		</div>

		<div>
			<h3 class="text-xs font-medium text-text-secondary mb-2">Average Speed by Route</h3>
			<div bind:this={speedChartEl} class="w-full h-48 rounded-xl bg-white/[0.01]"></div>
		</div>

		<div>
			<h3 class="text-xs font-medium text-text-secondary mb-2">Speed Distribution</h3>
			<div bind:this={distChartEl} class="w-full h-44 rounded-xl bg-white/[0.01]"></div>
		</div>
	</div>
</div>
