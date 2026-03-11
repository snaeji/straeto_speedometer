<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import * as echarts from 'echarts';
	import { busStore, getStatusColor, getBusStatus, type BusStatus } from '$lib/stores/buses.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import type { BusLocation } from '$lib/types/bus';

	let { expanded = $bindable(false), chartBarLeft = 12 }: { expanded: boolean; chartBarLeft: number } = $props();

	let chartEl: HTMLDivElement;
	let chart = $state<echarts.ECharts | null>(null);
	let ro: ResizeObserver | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let history = $state<BusLocation[]>([]);

	const selectedBus = $derived(busStore.selectedBus);
	const status = $derived<BusStatus>(selectedBus ? getBusStatus(selectedBus) : 'nodata');
	const statusColor = $derived(getStatusColor(status));

	// Gauge math
	const speed = $derived(selectedBus?.speedKmh ?? 0);
	const limit = $derived(selectedBus?.speedLimitKmh ?? 50);
	const gaugeMax = $derived(Math.max(limit * 1.5, 80));
	const speedAngle = $derived(Math.min(speed / gaugeMax, 1) * 240);
	const limitAngle = $derived(Math.min(limit / gaugeMax, 1) * 240);

	const violationCount = $derived(history.filter(h => h.isViolation).length);
	const maxSpeed = $derived(history.length > 0
		? Math.max(...history.map(h => h.speedKmh ?? 0))
		: speed
	);

	const limitTickStart = $derived(polarToXY(50, 50, 33, limitAngle));
	const limitTickEnd = $derived(polarToXY(50, 50, 43, limitAngle));

	function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
		const rad = ((angleDeg - 210) * Math.PI) / 180;
		return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
	}

	function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
		const start = polarToXY(cx, cy, r, startAngle);
		const end = polarToXY(cx, cy, r, endAngle);
		const largeArc = endAngle - startAngle > 180 ? 1 : 0;
		return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
	}

	function initChart() {
		if (chart) { chart.dispose(); chart = null; }
		if (ro) { ro.disconnect(); ro = null; }
		if (!chartEl) return;
		chart = echarts.init(chartEl, undefined, { renderer: 'canvas' });
		ro = new ResizeObserver(() => chart?.resize());
		ro.observe(chartEl);
	}

	onMount(() => {
		loadHistory();
		refreshTimer = setInterval(loadHistory, 3000);
	});

	onDestroy(() => {
		if (refreshTimer) clearInterval(refreshTimer);
		if (chart) chart.dispose();
		if (ro) ro.disconnect();
	});

	// (Re)init chart when expanded toggles — chartEl moves to a new DOM element
	$effect(() => {
		const _ = expanded;
		tick().then(() => initChart());
	});

	function loadHistory() {
		if (!busStore.selectedBusId) return;
		const busId = busStore.selectedBusId;
		const busHistory = busStore.liveHistory
			.filter(h => h.busId === busId)
			.sort((a, b) => a.timestamp - b.timestamp);

		if (busHistory.length > 0) {
			history = busHistory;
			return;
		}

		if (collectionStore.storageService) {
			collectionStore.storageService.getBusHistory(busId).then(h => {
				if (h.length > 0) history = h;
			});
		}
	}

	$effect(() => {
		const _busId = busStore.selectedBusId;
		const _len = busStore.liveHistory.length;
		if (_busId) loadHistory();
	});

	/**
	 * Resample speed data to a regular 2-second grid with linear interpolation.
	 * This prevents the chart from drawing misleading straight lines across
	 * irregular time gaps, and filters brief false-zero blips (<3s).
	 */
	function resampleForChart(sorted: BusLocation[]): {
		speeds: [number, number][];
		limits: [number, number][];
	} {
		if (sorted.length < 2) {
			const t = sorted[0]?.timestamp ?? 0;
			return {
				speeds: [[t, sorted[0]?.speedKmh ?? 0]],
				limits: [[t, sorted[0]?.speedLimitKmh ?? 50]],
			};
		}

		const firstTs = sorted[0].timestamp;
		const lastTs = sorted[sorted.length - 1].timestamp;
		const STEP_MS = 2000; // 2-second grid

		// Filter brief false-zero blips: if speed=0 for <4s between >3 km/h readings, interpolate through
		const filtered: { t: number; speed: number; limit: number }[] = [];
		for (let i = 0; i < sorted.length; i++) {
			const s = sorted[i].speedKmh ?? 0;
			const lim = sorted[i].speedLimitKmh ?? 50;
			const t = sorted[i].timestamp;

			if (s < 0.5 && i > 0 && i < sorted.length - 1) {
				// Check if this is a brief zero blip
				const prev = sorted[i - 1];
				const next = sorted[i + 1];
				const prevSpeed = prev.speedKmh ?? 0;
				const nextSpeed = next.speedKmh ?? 0;
				const gap = next.timestamp - prev.timestamp;
				if (prevSpeed > 3 && nextSpeed > 3 && gap < 6000) {
					// Interpolate through
					const frac = (t - prev.timestamp) / gap;
					filtered.push({ t, speed: prevSpeed + (nextSpeed - prevSpeed) * frac, limit: lim });
					continue;
				}
			}
			filtered.push({ t, speed: s, limit: lim });
		}

		// Resample to regular grid using linear interpolation
		const speeds: [number, number][] = [];
		const limits: [number, number][] = [];
		let srcIdx = 0;

		for (let t = firstTs; t <= lastTs; t += STEP_MS) {
			// Advance source index to bracket current time
			while (srcIdx < filtered.length - 1 && filtered[srcIdx + 1].t <= t) {
				srcIdx++;
			}

			if (srcIdx >= filtered.length - 1) {
				// Past end — use last value
				speeds.push([t, filtered[filtered.length - 1].speed]);
				limits.push([t, filtered[filtered.length - 1].limit]);
			} else {
				const a = filtered[srcIdx];
				const b = filtered[srcIdx + 1];
				const gap = b.t - a.t;
				if (gap <= 0) {
					speeds.push([t, a.speed]);
					limits.push([t, a.limit]);
				} else {
					const frac = (t - a.t) / gap;
					speeds.push([t, a.speed + (b.speed - a.speed) * frac]);
					limits.push([t, a.limit]); // Step interpolation — limits are discrete, not gradual
				}
			}
		}

		return { speeds, limits };
	}

	// Render chart data
	$effect(() => {
		if (!chart || !selectedBus) return;

		const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
		if (sorted.length === 0) { chart.clear(); return; }

		const { speeds, limits } = resampleForChart(sorted);
		const firstTs = sorted[0].timestamp;

		chart.setOption({
			backgroundColor: 'transparent',
			grid: { left: 36, right: 12, top: 8, bottom: 24 },
			tooltip: {
				trigger: 'axis',
				backgroundColor: 'rgba(8, 14, 30, 0.9)',
				borderColor: 'rgba(255,255,255,0.1)',
				textStyle: { color: '#f1f5f9', fontSize: 10, fontFamily: 'var(--font-mono)' },
				formatter: (params: {seriesName: string; value: [number, number]}[]) => {
					if (!Array.isArray(params)) return '';
					let html = '';
					for (const p of params) {
						const color = p.seriesName === 'Speed' ? '#06b6d4' : '#f59e0b';
						const val = p.value?.[1];
						html += `<span style="color:${color}">${p.seriesName}: ${val?.toFixed?.(1) ?? '--'}</span><br/>`;
					}
					return html;
				},
			},
			xAxis: {
				type: 'value',
				min: firstTs,
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
				splitLine: { show: false },
				axisLabel: {
					color: '#64748b', fontSize: 8,
					formatter: (v: number) => {
						const s = Math.round((v - firstTs) / 1000);
						return s >= 60 ? `${Math.floor(s / 60)}m` : `${s}s`;
					},
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
					smooth: 0.3, smoothMonotone: 'x', symbol: 'none',
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
					step: 'end', smooth: false, symbol: 'none',
					lineStyle: { color: '#f59e0b', width: 1, type: 'dashed' },
				},
			],
			animationDuration: 300,
		});
	});
</script>

{#if selectedBus}
	<!-- Info card (always top-right, 320px) -->
	<div class="glass-strong rounded-2xl overflow-hidden" style="width: 320px; animation: slide-in-right 0.35s cubic-bezier(0.16, 1, 0.3, 1)">
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
			<div class="flex items-center gap-1">
				<button
					class="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors cursor-pointer text-text-muted hover:text-text-primary"
					onclick={() => expanded = !expanded}
					title={expanded ? 'Collapse chart' : 'Expand chart'}
				>
					{#if expanded}
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M8 2H10V4M4 10H2V8" /><path d="M10 2L7 5M2 10L5 7" />
						</svg>
					{:else}
						<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
							<path d="M2 4V2H4M10 8V10H8" /><path d="M2 2L5 5M10 10L7 7" />
						</svg>
					{/if}
				</button>
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
		</div>

		<!-- Speed Gauge + Stats -->
		<div class="flex items-center px-3 py-2 gap-2 {!expanded ? 'border-b border-white/5' : ''}">
			<div class="shrink-0 relative" style="width: 80px; height: 68px;">
				<svg viewBox="0 0 100 80" width="80" height="68">
					<path d={describeArc(50, 50, 38, 0, 240)} fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="6" stroke-linecap="round" />
					<path d={describeArc(50, 50, 38, 0, limitAngle)} fill="none" stroke="rgba(16, 185, 129, 0.2)" stroke-width="6" stroke-linecap="round" />
					<path d={describeArc(50, 50, 38, 0, Math.max(speedAngle, 0.1))} fill="none" stroke={statusColor} stroke-width="6" stroke-linecap="round"
						style="transition: d 0.8s ease-out; filter: drop-shadow(0 0 6px {statusColor}80);" />
					<line x1={limitTickStart.x} y1={limitTickStart.y} x2={limitTickEnd.x} y2={limitTickEnd.y}
						stroke="#f59e0b" stroke-width="2" stroke-linecap="round" opacity="0.7" />
					<text x="50" y="46" text-anchor="middle" fill={statusColor}
						font-size="18" font-weight="700" font-family="var(--font-mono)"
						style="filter: drop-shadow(0 0 8px {statusColor}40);">
						{Math.round(speed)}
					</text>
					<text x="50" y="58" text-anchor="middle" fill="rgba(148,163,184,0.5)" font-size="7" font-family="var(--font-sans)">km/h</text>
					<text x="50" y="74" text-anchor="middle" fill="rgba(148,163,184,0.4)" font-size="7" font-family="var(--font-mono)">limit {limit}</text>
				</svg>
			</div>
			<div class="grid grid-cols-2 gap-x-3 gap-y-1">
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

		<!-- Inline chart (collapsed only) -->
		{#if !expanded}
			<div
				class="relative cursor-pointer chart-hover"
				onclick={() => expanded = true}
				role="button"
				tabindex="0"
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') expanded = true; }}
			>
				<div bind:this={chartEl} class="w-full" style="height: 110px"></div>
				<div class="expand-hint">
					<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3">
						<path d="M1 9V6M1 9H4M1 9L4 6" />
						<path d="M9 1V4M9 1H6M9 1L6 4" />
					</svg>
				</div>
			</div>
		{/if}
	</div>

	<!-- Expanded chart bar (fixed to bottom, clears sidebar) -->
	{#if expanded}
		<div
			class="fixed bottom-3 right-3 z-10 glass-strong rounded-2xl overflow-hidden"
			style="left: {chartBarLeft}px; height: 160px; animation: slide-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
		>
			<div bind:this={chartEl} class="w-full h-full"></div>
		</div>
	{/if}
{/if}

<style>
	.chart-hover {
		transition: background 0.2s;
	}
	.chart-hover:hover {
		background: rgba(255, 255, 255, 0.015);
	}

	.expand-hint {
		position: absolute;
		bottom: 6px;
		right: 8px;
		color: rgba(148, 163, 184, 0.2);
		transition: color 0.2s, transform 0.2s;
	}
	.chart-hover:hover .expand-hint {
		color: rgba(148, 163, 184, 0.6);
		transform: scale(1.15);
	}

	@keyframes slide-in-right {
		from { transform: translateX(20px); opacity: 0; }
		to { transform: translateX(0); opacity: 1; }
	}

	@keyframes slide-in-up {
		from { transform: translateY(20px); opacity: 0; }
		to { transform: translateY(0); opacity: 1; }
	}
</style>
