<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as echarts from 'echarts';
	import { busStore, getStatusColor, getBusStatus } from '$lib/stores/buses.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import type { BusLocation } from '$lib/types/bus';

	let chartEl: HTMLDivElement;
	let chart: echarts.ECharts | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let history = $state<BusLocation[]>([]);

	const selectedBus = $derived(busStore.selectedBus);

	onMount(() => {
		chart = echarts.init(chartEl, undefined, { renderer: 'canvas' });
		loadHistory();
		refreshTimer = setInterval(loadHistory, 5000);

		const ro = new ResizeObserver(() => chart?.resize());
		ro.observe(chartEl);
	});

	onDestroy(() => {
		if (refreshTimer) clearInterval(refreshTimer);
		chart?.dispose();
	});

	async function loadHistory() {
		if (!busStore.selectedBusId || !collectionStore.storageService) return;
		history = await collectionStore.storageService.getBusHistory(busStore.selectedBusId);
	}

	// Reload when selected bus changes
	$effect(() => {
		if (busStore.selectedBusId) {
			loadHistory();
		}
	});

	// Update chart
	$effect(() => {
		if (!chart || !selectedBus) return;

		const sorted = history.sort((a, b) => a.timestamp - b.timestamp);
		if (sorted.length === 0) {
			chart.clear();
			return;
		}

		const firstTs = sorted[0].timestamp;
		const times = sorted.map((h) => Math.round((h.timestamp - firstTs) / 1000));
		const speeds = sorted.map((h) => h.speedKmh ?? 0);
		const limits = sorted.map((h) => h.speedLimitKmh ?? null);

		chart.setOption({
			backgroundColor: 'transparent',
			grid: { left: 40, right: 16, top: 16, bottom: 28 },
			tooltip: {
				trigger: 'axis',
				backgroundColor: 'rgba(8, 14, 30, 0.9)',
				borderColor: 'rgba(255,255,255,0.1)',
				textStyle: { color: '#f1f5f9', fontSize: 11, fontFamily: 'var(--font-mono)' },
				formatter: (params: {seriesName: string; value: number}[]) => {
					if (!Array.isArray(params)) return '';
					let html = '';
					for (const p of params) {
						const color = p.seriesName === 'Speed' ? '#06b6d4' : '#f59e0b';
						html += `<span style="color:${color}">${p.seriesName}: ${p.value?.toFixed?.(1) ?? '--'} km/h</span><br/>`;
					}
					return html;
				},
			},
			xAxis: {
				type: 'category',
				data: times,
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
				axisLabel: {
					color: '#64748b',
					fontSize: 9,
					formatter: (v: string) => {
						const s = parseInt(v);
						return s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`;
					},
					interval: 'auto',
				},
			},
			yAxis: {
				type: 'value',
				min: 0,
				splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
				axisLabel: { color: '#64748b', fontSize: 9 },
			},
			series: [
				{
					name: 'Speed',
					type: 'line',
					data: speeds,
					smooth: true,
					symbol: 'none',
					lineStyle: { color: '#06b6d4', width: 2 },
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: 'rgba(6, 182, 212, 0.2)' },
							{ offset: 1, color: 'rgba(6, 182, 212, 0)' },
						]),
					},
				},
				{
					name: 'Limit',
					type: 'line',
					data: limits,
					smooth: false,
					symbol: 'none',
					lineStyle: { color: '#f59e0b', width: 1.5, type: 'dashed' },
				},
			],
			animationDuration: 300,
		});
	});
</script>

{#if selectedBus}
	<div class="glass-strong rounded-2xl overflow-hidden" style="height: 190px; animation: slide-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)">
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-2 border-b border-white/5">
			<div class="flex items-center gap-2">
				<div
					class="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white"
					style="background: {getStatusColor(getBusStatus(selectedBus))}"
				>
					{selectedBus.routeNr}
				</div>
				<span class="text-xs font-medium text-text-primary">{selectedBus.busId}</span>
				{#if selectedBus.headsign}
					<span class="text-[10px] text-text-muted">{selectedBus.headsign}</span>
				{/if}
			</div>
			<button
				class="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors cursor-pointer text-text-muted hover:text-text-primary"
				onclick={() => busStore.selectBus(null)}
				title="Close (Esc)"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
					<path d="M2 2l8 8M10 2l-8 8" />
				</svg>
			</button>
		</div>

		<!-- Chart -->
		<div bind:this={chartEl} class="w-full" style="height: 150px"></div>
	</div>
{/if}
