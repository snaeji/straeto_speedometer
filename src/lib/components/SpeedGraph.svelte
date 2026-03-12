<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import * as echarts from 'echarts';
	import { busStore, getStatusColor, getBusStatus, type BusStatus } from '$lib/stores/buses.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import { formatTime } from '$lib/utils/format';
	import type { BusLocation } from '$lib/types/bus';

	let { expanded = $bindable(false), chartBarLeft = 12 }: { expanded: boolean; chartBarLeft: number } = $props();

	let chartEl: HTMLDivElement;
	let chart = $state<echarts.ECharts | null>(null);
	let ro: ResizeObserver | null = null;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let history = $state<BusLocation[]>([]);

	// Live edge tracking
	let isAtLiveEdge = $state(true);
	let isProgrammaticZoom = false;
	let currentWindowMs = $state(60_000); // Current zoom window size (default 1 min)
	let lastHoveredTs: number | null = null;

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

	// Human-readable zoom level
	const zoomLabel = $derived.by(() => {
		const sec = Math.round(currentWindowMs / 1000);
		if (sec < 60) return `${sec}s`;
		if (sec < 3600) return `${Math.round(sec / 60)}m`;
		return `${(sec / 3600).toFixed(1)}h`;
	});

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

	function jumpToLiveEdge() {
		isAtLiveEdge = true;
		currentWindowMs = 60_000;
		renderChart();
	}

	function setTimeWindow(ms: number) {
		isAtLiveEdge = true;
		if (ms === Infinity) {
			// "All" — show entire history
			const range = history.length > 1
				? history[history.length - 1].timestamp - history[0].timestamp + 4000
				: 60_000;
			currentWindowMs = range;
		} else {
			currentWindowMs = ms;
		}
		renderChart();
	}

	function initChart() {
		if (chart) { chart.dispose(); chart = null; }
		if (ro) { ro.disconnect(); ro = null; }
		busStore.setHoveredHistoryPoint(null);
		lastHoveredTs = null;
		isAtLiveEdge = true;
		if (!chartEl) return;
		chart = echarts.init(chartEl, undefined, { renderer: 'canvas' });

		// Hover: show ghost dot on map at GPS position for hovered time
		// Use ZRender-level event so it fires everywhere on the canvas,
		// not just on series elements (which are absent with symbol: 'none').
		chart.getZr().on('mousemove', (e: any) => {
			const pointInPixel = [e.offsetX, e.offsetY];
			if (chart!.containPixel('grid', pointInPixel)) {
				const xVal = chart!.convertFromPixel({ xAxisIndex: 0 }, pointInPixel)[0];
				const closest = findClosestRecord(history, xVal);
				if (closest && closest.timestamp !== lastHoveredTs) {
					lastHoveredTs = closest.timestamp;
					busStore.setHoveredHistoryPoint({
						lat: closest.lat, lng: closest.lng,
						timestamp: closest.timestamp,
						speedKmh: closest.speedKmh ?? 0,
					});
				}
			} else {
				if (lastHoveredTs !== null) {
					lastHoveredTs = null;
					busStore.setHoveredHistoryPoint(null);
				}
			}
		});
		chart.getZr().on('mouseout', () => {
			lastHoveredTs = null;
			busStore.setHoveredHistoryPoint(null);
		});

		// Track user zoom/pan — ignore programmatic updates
		chart.on('dataZoom', () => {
			if (isProgrammaticZoom) return;

			const opt = chart!.getOption() as any;
			const dz = opt?.dataZoom?.[0];
			if (!dz || dz.startValue == null || dz.endValue == null) return;

			currentWindowMs = dz.endValue - dz.startValue;

			// Check if user is near the live edge
			const lastTs = history.length > 0 ? history[history.length - 1].timestamp : 0;
			isAtLiveEdge = (lastTs - dz.endValue) < 5000;
		});

		// Double-click: jump to live edge
		chart.on('dblclick', () => {
			jumpToLiveEdge();
		});

		ro = new ResizeObserver(() => chart?.resize());
		ro.observe(chartEl);
	}

	/** Binary search for the closest record by timestamp */
	function findClosestRecord(records: BusLocation[], timestamp: number): BusLocation | null {
		if (records.length === 0) return null;
		let lo = 0, hi = records.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (records[mid].timestamp < timestamp) lo = mid + 1;
			else hi = mid;
		}
		if (lo > 0 && Math.abs(records[lo - 1].timestamp - timestamp) < Math.abs(records[lo].timestamp - timestamp)) {
			return records[lo - 1];
		}
		return records[lo];
	}

	onMount(() => {
		loadHistory();
		refreshTimer = setInterval(loadHistory, 3000);
	});

	onDestroy(() => {
		if (refreshTimer) clearInterval(refreshTimer);
		if (chart) chart.dispose();
		if (ro) ro.disconnect();
		busStore.setHoveredHistoryPoint(null);
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
	 * Also extracts violation points for scatter markers.
	 */
	function resampleForChart(sorted: BusLocation[]): {
		speeds: [number, number][];
		limits: [number, number][];
		violations: [number, number][];
	} {
		if (sorted.length < 2) {
			const t = sorted[0]?.timestamp ?? 0;
			const s = sorted[0]?.speedKmh ?? 0;
			const l = sorted[0]?.speedLimitKmh ?? 50;
			return {
				speeds: [[t, s]],
				limits: [[t, l]],
				violations: sorted[0]?.isViolation ? [[t, s]] : [],
			};
		}

		const firstTs = sorted[0].timestamp;
		const lastTs = sorted[sorted.length - 1].timestamp;
		const STEP_MS = 2000;

		// Filter brief false-zero blips
		const filtered: { t: number; speed: number; limit: number; violation: boolean }[] = [];
		for (let i = 0; i < sorted.length; i++) {
			const s = sorted[i].speedKmh ?? 0;
			const lim = sorted[i].speedLimitKmh ?? 50;
			const t = sorted[i].timestamp;
			const v = sorted[i].isViolation;

			if (s < 0.5 && i > 0 && i < sorted.length - 1) {
				const prev = sorted[i - 1];
				const next = sorted[i + 1];
				const prevSpeed = prev.speedKmh ?? 0;
				const nextSpeed = next.speedKmh ?? 0;
				const gap = next.timestamp - prev.timestamp;
				if (prevSpeed > 3 && nextSpeed > 3 && gap < 6000) {
					const frac = (t - prev.timestamp) / gap;
					filtered.push({ t, speed: prevSpeed + (nextSpeed - prevSpeed) * frac, limit: lim, violation: v });
					continue;
				}
			}
			filtered.push({ t, speed: s, limit: lim, violation: v });
		}

		const speeds: [number, number][] = [];
		const limits: [number, number][] = [];
		const violations: [number, number][] = [];
		let srcIdx = 0;

		for (let t = firstTs; t <= lastTs; t += STEP_MS) {
			while (srcIdx < filtered.length - 1 && filtered[srcIdx + 1].t <= t) srcIdx++;

			let spd: number, limitVal: number, isV: boolean;
			if (srcIdx >= filtered.length - 1) {
				spd = filtered[filtered.length - 1].speed;
				limitVal = filtered[filtered.length - 1].limit;
				isV = filtered[filtered.length - 1].violation;
			} else {
				const a = filtered[srcIdx];
				const b = filtered[srcIdx + 1];
				const gap = b.t - a.t;
				if (gap <= 0) {
					spd = a.speed; limitVal = a.limit; isV = a.violation;
				} else {
					const frac = (t - a.t) / gap;
					spd = a.speed + (b.speed - a.speed) * frac;
					limitVal = a.limit;
					isV = a.violation || b.violation;
				}
			}

			speeds.push([t, spd]);
			limits.push([t, limitVal]);
			if (isV) violations.push([t, spd]);
		}

		return { speeds, limits, violations };
	}

	function renderChart() {
		if (!chart || !selectedBus) return;
		if (history.length === 0) { chart.clear(); return; }

		const { speeds, limits, violations } = resampleForChart(history);
		const firstTs = history[0].timestamp;
		const lastTs = history[history.length - 1].timestamp;
		const totalRange = Math.max(lastTs - firstTs + 4000, 10_000);

		// Calculate visible window
		let zoomStart: number, zoomEnd: number;
		if (isAtLiveEdge) {
			zoomEnd = lastTs + 2000;
			zoomStart = Math.max(firstTs, zoomEnd - currentWindowMs);
		} else {
			// Read current position from chart to preserve user's view
			const opt = chart.getOption() as any;
			const dz = opt?.dataZoom?.[0];
			if (dz?.startValue != null && dz?.endValue != null) {
				zoomStart = dz.startValue;
				zoomEnd = dz.endValue;
			} else {
				zoomEnd = lastTs + 2000;
				zoomStart = Math.max(firstTs, zoomEnd - currentWindowMs);
			}
		}

		// Build violation regions (red background shading)
		const violationRegions: Array<[{ xAxis: number }, { xAxis: number }]> = [];
		let regionStart: number | null = null;
		for (let i = 0; i < speeds.length; i++) {
			const [t, s] = speeds[i];
			const l = limits[i]?.[1] ?? 50;
			if (s > l && regionStart === null) {
				regionStart = t;
			} else if (s <= l && regionStart !== null) {
				violationRegions.push([{ xAxis: regionStart }, { xAxis: t }]);
				regionStart = null;
			}
		}
		if (regionStart !== null) {
			violationRegions.push([{ xAxis: regionStart }, { xAxis: speeds[speeds.length - 1][0] }]);
		}

		// DataZoom: inside only (scroll wheel to zoom in expanded, pan with shift+wheel)
		const dataZoomConfig: any[] = [
			{
				type: 'inside',
				xAxisIndex: 0,
				filterMode: 'none',
				startValue: zoomStart,
				endValue: zoomEnd,
				minValueSpan: 10_000,
				maxValueSpan: totalRange,
				zoomOnMouseWheel: expanded,
				moveOnMouseMove: false,
				moveOnMouseWheel: expanded ? 'shift' : false,
			},
		];

		isProgrammaticZoom = true;
		chart.setOption({
			backgroundColor: 'transparent',
			grid: {
				left: 36,
				right: 12,
				top: 10,
				bottom: 24,
			},
			tooltip: {
				trigger: 'axis',
				backgroundColor: 'rgba(8, 14, 30, 0.95)',
				borderColor: 'rgba(255,255,255,0.08)',
				textStyle: { color: '#f1f5f9', fontSize: 10, fontFamily: 'var(--font-mono)' },
				axisPointer: {
					type: 'line',
					lineStyle: { color: 'rgba(6, 182, 212, 0.4)', width: 1 },
				},
				formatter: (params: { seriesName: string; value: [number, number] }[]) => {
					if (!Array.isArray(params)) return '';
					const timestamp = params[0]?.value?.[0];
					let html = '';
					if (timestamp) {
						html += `<div style="color:#94a3b8;margin-bottom:3px;font-size:11px">${formatTime(timestamp)}</div>`;
					}
					for (const p of params) {
						if (p.seriesName === 'Violations' || p.seriesName === 'Now') continue;
						const color = p.seriesName === 'Speed' ? '#06b6d4' : '#f59e0b';
						const val = p.value?.[1];
						html += `<div style="display:flex;align-items:center;gap:4px;margin:1px 0">`;
						html += `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color}"></span>`;
						html += `<span style="color:${color}">${p.seriesName}: ${val?.toFixed?.(1) ?? '--'} km/h</span>`;
						html += `</div>`;
					}
					return html;
				},
			},
			xAxis: {
				type: 'value',
				min: firstTs,
				max: lastTs + 2000,
				axisLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
				splitLine: { show: false },
				axisLabel: {
					color: '#64748b',
					fontSize: 9,
					formatter: (v: number) => {
						const time = formatTime(v);
						// Show HH:MM:SS for windows under 5 min, HH:MM for larger
						return currentWindowMs < 300_000 ? time : time.slice(0, 5);
					},
				},
			},
			yAxis: {
				type: 'value',
				min: 0,
				splitLine: { lineStyle: { color: 'rgba(255,255,255,0.04)' } },
				axisLabel: { color: '#64748b', fontSize: 9 },
			},
			dataZoom: dataZoomConfig,
			series: [
				{
					name: 'Speed',
					type: 'line',
					data: speeds,
					smooth: 0.3,
					smoothMonotone: 'x',
					symbol: 'none',
					lineStyle: { color: '#06b6d4', width: 1.5 },
					areaStyle: {
						color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
							{ offset: 0, color: 'rgba(6, 182, 212, 0.18)' },
							{ offset: 1, color: 'rgba(6, 182, 212, 0)' },
						]),
					},
					markArea: violationRegions.length > 0 ? {
						silent: true,
						itemStyle: { color: 'rgba(239, 68, 68, 0.08)' },
						data: violationRegions,
					} : { silent: true, data: [] },
				},
				{
					name: 'Limit',
					type: 'line',
					data: limits,
					step: 'end',
					smooth: false,
					symbol: 'none',
					lineStyle: { color: '#f59e0b', width: 1, type: 'dashed' },
				},
				{
					name: 'Violations',
					type: 'scatter',
					data: violations,
					symbol: 'circle',
					symbolSize: expanded ? 6 : 4,
					itemStyle: {
						color: '#ef4444',
						borderColor: 'rgba(239, 68, 68, 0.4)',
						borderWidth: 2,
					},
					z: 10,
				},
				// Live position dot at latest data point
				{
					name: 'Now',
					type: 'scatter',
					data: speeds.length > 0 ? [speeds[speeds.length - 1]] : [],
					symbol: 'circle',
					symbolSize: 8,
					itemStyle: {
						color: '#06b6d4',
						borderColor: 'rgba(6, 182, 212, 0.3)',
						borderWidth: 4,
					},
					z: 20,
				},
			],
			animation: false,
		});
		isProgrammaticZoom = false;
	}

	// Render chart data (reactive)
	$effect(() => {
		if (!chart || !selectedBus) return;
		// Track reactive deps
		const _len = history.length;
		const _lastTs = history.length > 0 ? history[history.length - 1].timestamp : 0;
		const _isLive = isAtLiveEdge;
		renderChart();
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
					{#if selectedBus.speedLimitRoad}
						<span class="text-[9px] text-text-muted/60 leading-tight">{selectedBus.speedLimitRoad}</span>
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
					<text x="50" y="74" text-anchor="middle" fill="rgba(148,163,184,0.4)" font-size="7" font-family="var(--font-mono)">{selectedBus.speedLimitMatch === 'fallback' ? '~' : ''}limit {limit}</text>
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
				<!-- Live edge indicator (inline) -->
				{#if !isAtLiveEdge}
					<button
						class="live-badge away"
						onclick={(e: MouseEvent) => { e.stopPropagation(); jumpToLiveEdge(); }}
					>
						<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M6 4L2 1v6z"/></svg>
						LIVE
					</button>
				{/if}
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
			style="left: {chartBarLeft}px; height: 200px; animation: slide-in-up 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
		>
			<div class="relative w-full h-full">
				<!-- Chart overlay controls -->
				<div class="chart-overlay-controls">
					<!-- Time window presets -->
					<div class="time-presets">
						<button class="preset-btn" class:active={currentWindowMs === 30_000 && isAtLiveEdge} onclick={() => setTimeWindow(30_000)}>30s</button>
						<button class="preset-btn" class:active={currentWindowMs === 60_000 && isAtLiveEdge} onclick={() => setTimeWindow(60_000)}>1m</button>
						<button class="preset-btn" class:active={currentWindowMs === 300_000 && isAtLiveEdge} onclick={() => setTimeWindow(300_000)}>5m</button>
						<button class="preset-btn" class:active={currentWindowMs >= 600_000 && isAtLiveEdge} onclick={() => setTimeWindow(Infinity)}>All</button>
					</div>
					<!-- Live edge badge -->
					{#if isAtLiveEdge}
						<div class="live-badge live">
							<span class="pulse-dot"></span>
							LIVE
						</div>
					{:else}
						<button class="live-badge away" onclick={() => jumpToLiveEdge()}>
							<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M6 4L2 1v6z"/></svg>
							LIVE
						</button>
					{/if}
				</div>
				<div bind:this={chartEl} class="w-full h-full"></div>
			</div>
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

	/* Chart overlay controls */
	.chart-overlay-controls {
		position: absolute;
		top: 6px;
		left: 44px;
		right: 16px;
		z-index: 10;
		display: flex;
		justify-content: space-between;
		align-items: center;
		pointer-events: none;
	}
	.chart-overlay-controls > * {
		pointer-events: auto;
	}

	/* Time window presets */
	.time-presets {
		display: flex;
		gap: 2px;
		background: rgba(15, 23, 42, 0.7);
		padding: 2px;
		border-radius: 5px;
		border: 1px solid rgba(255, 255, 255, 0.05);
	}
	.preset-btn {
		font-size: 9px;
		font-family: var(--font-mono);
		font-weight: 500;
		color: rgba(148, 163, 184, 0.5);
		background: transparent;
		border: none;
		padding: 2px 7px;
		border-radius: 3px;
		cursor: pointer;
		transition: all 0.15s;
		user-select: none;
	}
	.preset-btn:hover {
		color: rgba(148, 163, 184, 0.8);
		background: rgba(255, 255, 255, 0.05);
	}
	.preset-btn.active {
		color: #06b6d4;
		background: rgba(6, 182, 212, 0.1);
	}

	/* Live badge */
	.live-badge {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 9px;
		font-weight: 600;
		font-family: var(--font-mono);
		letter-spacing: 0.05em;
		padding: 2px 8px 2px 6px;
		border-radius: 4px;
		border: none;
		user-select: none;
		transition: all 0.2s;
	}

	.live-badge.live {
		color: #10b981;
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid rgba(16, 185, 129, 0.15);
	}

	.live-badge.away {
		color: rgba(148, 163, 184, 0.6);
		background: rgba(148, 163, 184, 0.08);
		border: 1px solid rgba(148, 163, 184, 0.1);
		cursor: pointer;
		position: absolute;
		top: 6px;
		right: 8px;
		z-index: 10;
	}
	.live-badge.away:hover {
		color: #06b6d4;
		background: rgba(6, 182, 212, 0.1);
		border-color: rgba(6, 182, 212, 0.2);
	}

	/* Pulsing dot */
	.pulse-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #10b981;
		animation: pulse 2s ease-in-out infinite;
		box-shadow: 0 0 4px rgba(16, 185, 129, 0.6);
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(0.8); }
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
