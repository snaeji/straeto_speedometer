<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as echarts from 'echarts';
	import { busStore, getStatusColor, getBusStatus, type BusStatus } from '$lib/stores/buses.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import type { BusLocation } from '$lib/types/bus';

	let chartEl: HTMLDivElement;
	let chart: echarts.ECharts | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let history = $state<BusLocation[]>([]);

	const selectedBus = $derived(busStore.selectedBus);
	const status = $derived<BusStatus>(selectedBus ? getBusStatus(selectedBus) : 'nodata');
	const statusColor = $derived(getStatusColor(status));

	// Gauge math
	const speed = $derived(selectedBus?.speedKmh ?? 0);
	const limit = $derived(selectedBus?.speedLimitKmh ?? 50);
	const gaugeMax = $derived(Math.max(limit * 1.5, 80));
	const speedAngle = $derived(Math.min(speed / gaugeMax, 1) * 240); // 240° arc
	const limitAngle = $derived(Math.min(limit / gaugeMax, 1) * 240);

	// Count violations in history for this bus
	const violationCount = $derived(history.filter(h => h.isViolation).length);
	const maxSpeed = $derived(history.length > 0
		? Math.max(...history.map(h => h.speedKmh ?? 0))
		: speed
	);

	// Limit tick mark positions
	const limitTickStart = $derived(polarToXY(50, 50, 33, limitAngle));
	const limitTickEnd = $derived(polarToXY(50, 50, 43, limitAngle));

	function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
		const rad = ((angleDeg - 210) * Math.PI) / 180; // Start at 210° (7 o'clock)
		return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
	}

	function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
		const start = polarToXY(cx, cy, r, startAngle);
		const end = polarToXY(cx, cy, r, endAngle);
		const largeArc = endAngle - startAngle > 180 ? 1 : 0;
		return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
	}

	onMount(() => {
		chart = echarts.init(chartEl, undefined, { renderer: 'canvas' });
		loadHistory();
		refreshTimer = setInterval(loadHistory, 3000);

		const ro = new ResizeObserver(() => chart?.resize());
		ro.observe(chartEl);
	});

	onDestroy(() => {
		if (refreshTimer) clearInterval(refreshTimer);
		chart?.dispose();
	});

	function loadHistory() {
		if (!busStore.selectedBusId) return;

		// Use liveHistory (works for demo/preview/collect modes)
		const busId = busStore.selectedBusId;
		const busHistory = busStore.liveHistory
			.filter(h => h.busId === busId)
			.sort((a, b) => a.timestamp - b.timestamp);

		if (busHistory.length > 0) {
			history = busHistory;
			return;
		}

		// Fallback to IndexedDB
		if (collectionStore.storageService) {
			collectionStore.storageService.getBusHistory(busId).then(h => {
				if (h.length > 0) history = h;
			});
		}
	}

	$effect(() => {
		if (busStore.selectedBusId) {
			loadHistory();
		}
	});

	// Update chart
	$effect(() => {
		if (!chart || !selectedBus) return;

		const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
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
			grid: { left: 36, right: 12, top: 8, bottom: 24 },
			tooltip: {
				trigger: 'axis',
				backgroundColor: 'rgba(8, 14, 30, 0.9)',
				borderColor: 'rgba(255,255,255,0.1)',
				textStyle: { color: '#f1f5f9', fontSize: 10, fontFamily: 'var(--font-mono)' },
				formatter: (params: {seriesName: string; value: number}[]) => {
					if (!Array.isArray(params)) return '';
					let html = '';
					for (const p of params) {
						const color = p.seriesName === 'Speed' ? '#06b6d4' : '#f59e0b';
						html += `<span style="color:${color}">${p.seriesName}: ${p.value?.toFixed?.(1) ?? '--'}</span><br/>`;
					}
					return html;
				},
			},
			xAxis: {
				type: 'category',
				data: times,
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
				axisLabel: {
					color: '#64748b', fontSize: 8,
					formatter: (v: string) => {
						const s = parseInt(v);
						return s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`;
					},
					interval: 'auto',
				},
			},
			yAxis: {
				type: 'value', min: 0,
				splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
				axisLabel: { color: '#64748b', fontSize: 8 },
			},
			series: [
				{
					name: 'Speed', type: 'line', data: speeds,
					smooth: true, symbol: 'none',
					lineStyle: { color: '#06b6d4', width: 1.5 },
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: 'rgba(6, 182, 212, 0.15)' },
							{ offset: 1, color: 'rgba(6, 182, 212, 0)' },
						]),
					},
				},
				{
					name: 'Limit', type: 'line', data: limits,
					smooth: false, symbol: 'none',
					lineStyle: { color: '#f59e0b', width: 1, type: 'dashed' },
				},
			],
			animationDuration: 300,
		});
	});
</script>

{#if selectedBus}
	<div class="glass-strong rounded-2xl overflow-hidden bus-detail-panel" style="animation: slide-in-right 0.35s cubic-bezier(0.16, 1, 0.3, 1)">
		<!-- Header -->
		<div class="flex items-center justify-between px-3 py-2 border-b border-white/5">
			<div class="flex items-center gap-2">
				<div
					class="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white"
					style="background: {statusColor}; box-shadow: 0 0 12px {statusColor}40;"
				>
					{selectedBus.routeNr}
				</div>
				<div class="flex flex-col">
					<span class="text-xs font-medium text-text-primary leading-tight">{selectedBus.busId}</span>
					{#if selectedBus.headsign}
						<span class="text-[9px] text-text-muted leading-tight">{selectedBus.headsign}</span>
					{/if}
				</div>
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

		<!-- Speed Gauge + Stats Row -->
		<div class="flex items-center px-3 py-2 gap-3 border-b border-white/5">
			<!-- SVG Radial Gauge -->
			<div class="shrink-0 relative" style="width: 90px; height: 75px;">
				<svg viewBox="0 0 100 80" width="90" height="75">
					<!-- Background arc -->
					<path
						d={describeArc(50, 50, 38, 0, 240)}
						fill="none"
						stroke="rgba(255,255,255,0.06)"
						stroke-width="6"
						stroke-linecap="round"
					/>

					<!-- Speed limit zone indicator -->
					<path
						d={describeArc(50, 50, 38, 0, limitAngle)}
						fill="none"
						stroke="rgba(16, 185, 129, 0.2)"
						stroke-width="6"
						stroke-linecap="round"
					/>

					<!-- Speed arc -->
					<path
						d={describeArc(50, 50, 38, 0, Math.max(speedAngle, 0.1))}
						fill="none"
						stroke={statusColor}
						stroke-width="6"
						stroke-linecap="round"
						style="transition: d 0.8s ease-out; filter: drop-shadow(0 0 6px {statusColor}80);"
					/>

					<!-- Limit tick mark -->
					<line
						x1={limitTickStart.x} y1={limitTickStart.y}
						x2={limitTickEnd.x} y2={limitTickEnd.y}
						stroke="#f59e0b"
						stroke-width="2"
						stroke-linecap="round"
						opacity="0.7"
					/>

					<!-- Speed value -->
					<text x="50" y="46" text-anchor="middle" fill={statusColor}
						font-size="18" font-weight="700" font-family="var(--font-mono)"
						style="filter: drop-shadow(0 0 8px {statusColor}40);"
					>
						{Math.round(speed)}
					</text>
					<text x="50" y="58" text-anchor="middle" fill="rgba(148,163,184,0.5)"
						font-size="7" font-weight="400" font-family="var(--font-sans)"
					>
						km/h
					</text>

					<!-- Limit label -->
					<text x="50" y="74" text-anchor="middle" fill="rgba(148,163,184,0.4)"
						font-size="7" font-family="var(--font-mono)"
					>
						limit {limit}
					</text>
				</svg>
			</div>

			<!-- Stats Grid -->
			<div class="flex-1 grid grid-cols-2 gap-x-3 gap-y-1">
				<div>
					<div class="text-[8px] uppercase tracking-wider text-text-muted">Max Speed</div>
					<div class="text-xs font-bold font-mono tabular-nums text-text-primary">{maxSpeed.toFixed(1)}</div>
				</div>
				<div>
					<div class="text-[8px] uppercase tracking-wider text-text-muted">Violations</div>
					<div class="text-xs font-bold font-mono tabular-nums {violationCount > 0 ? 'text-danger' : 'text-text-primary'}">{violationCount}</div>
				</div>
				<div>
					<div class="text-[8px] uppercase tracking-wider text-text-muted">Direction</div>
					<div class="text-xs font-mono tabular-nums text-text-primary">{selectedBus.direction != null ? `${selectedBus.direction}°` : '--'}</div>
				</div>
				<div>
					<div class="text-[8px] uppercase tracking-wider text-text-muted">Records</div>
					<div class="text-xs font-mono tabular-nums text-text-primary">{history.length}</div>
				</div>
			</div>
		</div>

		<!-- Speed History Chart -->
		<div bind:this={chartEl} class="w-full" style="height: 110px"></div>
	</div>
{/if}

<style>
	.bus-detail-panel {
		width: 320px;
	}

	@keyframes slide-in-right {
		from { transform: translateX(20px); opacity: 0; }
		to { transform: translateX(0); opacity: 1; }
	}
</style>
