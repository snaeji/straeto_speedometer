<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import { busStore, getBusStatus, getStatusColor } from '$lib/stores/buses.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import { MAP_CENTER, MAP_ZOOM } from '$lib/utils/constants';


	let mapContainer: HTMLDivElement;
	let map: maplibregl.Map | null = null;
	let mapLoaded = $state(false);
	let markers = new Map<string, {
		marker: maplibregl.Marker;
		element: HTMLDivElement;
		busId: string;
	}>();
	let resizeObserver: ResizeObserver | null = null;
	let animFrameId: number | null = null;
	let ghostMarker: maplibregl.Marker | null = null;

	// Track position history for bus trails
	let busTrails = new Map<string, { lng: number; lat: number; ts: number }[]>();
	const TRAIL_MAX_POINTS = 30;
	const TRAIL_MAX_AGE_MS = 120_000; // 2 minutes

	// Track known violators to detect NEW violations for shockwave
	let knownViolators = new Set<string>();

	// Accumulated violation points for heatmap (persists across updates)
	let heatmapPoints: { lng: number; lat: number; weight: number }[] = [];
	const HEATMAP_MAX_POINTS = 500;

	function spawnShockwave(lng: number, lat: number) {
		if (!map) return;
		const el = document.createElement('div');
		el.className = 'shockwave-ring';
		const m = new maplibregl.Marker({ element: el, anchor: 'center' })
			.setLngLat([lng, lat])
			.addTo(map);
		// Auto-remove after animation completes
		setTimeout(() => m.remove(), 1200);
	}

	onMount(() => {
		map = new maplibregl.Map({
			container: mapContainer,
			style: {
				version: 8,
				sources: {
					'carto-dark': {
						type: 'raster',
						tiles: [
							'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
						],
						tileSize: 256,
						attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
					},
				},
				layers: [
					{
						id: 'carto-dark-layer',
						type: 'raster',
						source: 'carto-dark',
						minzoom: 0,
						maxzoom: 20,
					},
				],
			},
			center: MAP_CENTER,
			zoom: MAP_ZOOM,
			maxZoom: 18,
			minZoom: 10,
			attributionControl: {},
		});

		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

		map.on('load', () => {
			if (!map) return;
			mapLoaded = true;

			// Speed limit road overlay
			if (appStore.speedLimitGeoJson) {
				map.addSource('speed-limits', {
					type: 'geojson',
					data: appStore.speedLimitGeoJson as GeoJSON.FeatureCollection,
				});

				map.addLayer({
					id: 'speed-limit-lines',
					type: 'line',
					source: 'speed-limits',
					paint: {
						'line-color': [
							'match',
							['get', 'HRADI'],
							30, 'rgba(16, 185, 129, 0.15)',
							50, 'rgba(6, 182, 212, 0.15)',
							70, 'rgba(245, 158, 11, 0.15)',
							80, 'rgba(245, 158, 11, 0.15)',
							90, 'rgba(245, 158, 11, 0.15)',
							'rgba(255, 255, 255, 0.05)',
						],
						'line-width': 2,
					},
					layout: {
						'line-cap': 'round',
					},
				});
			}

			// Bus trail lines source
			map.addSource('bus-trails', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});

			map.addLayer({
				id: 'bus-trail-lines',
				type: 'line',
				source: 'bus-trails',
				paint: {
					'line-color': ['get', 'color'],
					'line-width': 3,
					'line-opacity': ['get', 'opacity'],
				},
				layout: {
					'line-cap': 'round',
					'line-join': 'round',
				},
			});

			// Route path for selected bus
			map.addSource('route-path', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});

			// Glow outline behind the route
			map.addLayer({
				id: 'route-path-glow',
				type: 'line',
				source: 'route-path',
				paint: {
					'line-color': '#06b6d4',
					'line-width': 12,
					'line-opacity': 0.15,
					'line-blur': 6,
				},
				layout: {
					'line-cap': 'round',
					'line-join': 'round',
				},
			});

			// Main dashed route line
			map.addLayer({
				id: 'route-path-line',
				type: 'line',
				source: 'route-path',
				paint: {
					'line-color': '#06b6d4',
					'line-width': 3,
					'line-opacity': 0.7,
					'line-dasharray': [3, 2],
				},
				layout: {
					'line-cap': 'round',
					'line-join': 'round',
				},
			});

			// Heatmap source and layer
			map.addSource('heatmap-data', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});

			map.addLayer({
				id: 'heatmap-layer',
				type: 'heatmap',
				source: 'heatmap-data',
				paint: {
					'heatmap-weight': ['coalesce', ['get', 'weight'], 1],
					'heatmap-intensity': 0.8,
					'heatmap-radius': 30,
					'heatmap-opacity': 0.7,
					'heatmap-color': [
						'interpolate', ['linear'], ['heatmap-density'],
						0, 'rgba(0,0,0,0)',
						0.2, 'rgba(255,200,0,0.3)',
						0.4, 'rgba(255,140,0,0.5)',
						0.6, 'rgba(255,69,0,0.6)',
						0.8, 'rgba(255,0,0,0.7)',
						1, 'rgba(200,0,0,0.8)',
					],
				},
				layout: {
					visibility: 'none',
				},
			});
		});

		startAnimLoop();

		map.on('click', (e: maplibregl.MapMouseEvent) => {
			const target = e.originalEvent.target as HTMLElement;
			if (!target.closest('.bus-marker')) {
				busStore.selectBus(null);
			}
		});

		map.on('dragstart', () => {
			busStore.autoFollow = false;
		});

		resizeObserver = new ResizeObserver(() => {
			map?.resize();
		});
		resizeObserver.observe(mapContainer);
	});

	// Animation loop: Kalman-predicted positions at 60fps
	function startAnimLoop() {
		function tick() {
			const now = Date.now();
			const calc = collectionStore.speedCalculator;
			for (const entry of markers.values()) {
				if (calc) {
					const pred = calc.getPredictedPosition(entry.busId, now);
					if (pred) {
						entry.marker.setLngLat([pred.lng, pred.lat]);
						continue;
					}
				}
				// Fallback: position already set from bus store data
			}
			animFrameId = requestAnimationFrame(tick);
		}
		animFrameId = requestAnimationFrame(tick);
	}

	onDestroy(() => {
		if (animFrameId) cancelAnimationFrame(animFrameId);
		resizeObserver?.disconnect();
		if (ghostMarker) { ghostMarker.remove(); ghostMarker = null; }
		for (const { marker } of markers.values()) {
			marker.remove();
		}
		markers.clear();
		map?.remove();
	});

	// Ghost dot: show hovered history point on map
	$effect(() => {
		const point = busStore.hoveredHistoryPoint;
		if (!point || !map) {
			if (ghostMarker) { ghostMarker.remove(); ghostMarker = null; }
			return;
		}
		if (ghostMarker) {
			ghostMarker.setLngLat([point.lng, point.lat]);
		} else {
			const el = document.createElement('div');
			el.className = 'ghost-position-dot';
			ghostMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
				.setLngLat([point.lng, point.lat])
				.addTo(map);
		}
	});

	// Update markers when bus data changes
	$effect(() => {
		if (!map) return;

		const currentBuses = busStore.activeBuses;
		const currentIds = new Set(currentBuses.map((b) => b.busId));
		const now = Date.now();

		// Remove markers for buses that are gone
		for (const [busId, { marker }] of markers) {
			if (!currentIds.has(busId)) {
				marker.remove();
				markers.delete(busId);
				busTrails.delete(busId);
			}
		}

		// Add or update markers
		for (const bus of currentBuses) {
			const status = getBusStatus(bus);
			const color = getStatusColor(status);
			const isSelected = bus.busId === busStore.selectedBusId;

			// Update trail history
			let trail = busTrails.get(bus.busId);
			if (!trail) {
				trail = [];
				busTrails.set(bus.busId, trail);
			}
			const lastPoint = trail[trail.length - 1];
			if (!lastPoint || lastPoint.lng !== bus.lng || lastPoint.lat !== bus.lat) {
				trail.push({ lng: bus.lng, lat: bus.lat, ts: now });
				// Prune old points
				while (trail.length > TRAIL_MAX_POINTS) trail.shift();
				while (trail.length > 0 && now - trail[0].ts > TRAIL_MAX_AGE_MS) trail.shift();
			}

			const existing = markers.get(bus.busId);
			if (existing) {
				// Update visual element (color, speed badge, etc.)
				// Position is handled by the Kalman animation loop
				updateMarkerElement(existing.element, bus.routeNr, color, status, isSelected, bus.speedKmh, bus.speedLimitKmh, bus.direction);
			} else {
				const el = createMarkerElement(bus.routeNr, color, status, isSelected, bus.busId, bus.speedKmh, bus.speedLimitKmh, bus.direction);

				// Use Kalman-predicted position if available, else raw GPS
				let initLng = bus.lng;
				let initLat = bus.lat;
				const calc = collectionStore.speedCalculator;
				if (calc) {
					const pred = calc.getPredictedPosition(bus.busId, Date.now());
					if (pred) {
						initLng = pred.lng;
						initLat = pred.lat;
					}
				}

				const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
					.setLngLat([initLng, initLat])
					.addTo(map!);

				markers.set(bus.busId, {
					marker,
					element: el,
					busId: bus.busId,
				});
			}
		}

		// Detect new violations, spawn shockwaves, accumulate heatmap
		const newViolators = new Set<string>();
		for (const bus of currentBuses) {
			if (bus.isViolation) {
				newViolators.add(bus.busId);
				if (!knownViolators.has(bus.busId)) {
					spawnShockwave(bus.lng, bus.lat);
				}
				// Accumulate for heatmap
				const excess = (bus.speedKmh ?? 0) - (bus.speedLimitKmh ?? 50);
				heatmapPoints.push({ lng: bus.lng, lat: bus.lat, weight: Math.max(1, excess / 10) });
				if (heatmapPoints.length > HEATMAP_MAX_POINTS) {
					heatmapPoints = heatmapPoints.slice(-HEATMAP_MAX_POINTS);
				}
			}
		}
		knownViolators = newViolators;

		// Update trail lines on map
		updateTrailLines(currentBuses);
	});

	// Auto-follow selected bus
	$effect(() => {
		if (!map || !busStore.autoFollow || !busStore.selectedBusId) return;
		const bus = busStore.selectedBus;
		if (bus) {
			map.easeTo({ center: [bus.lng, bus.lat], duration: 500 });
		}
	});

	// Toggle heatmap layer visibility
	$effect(() => {
		if (!map || !mapLoaded) return;
		map.setLayoutProperty(
			'heatmap-layer',
			'visibility',
			appStore.mode === 'heatmap' ? 'visible' : 'none'
		);
	});

	// Update heatmap data with accumulated violation points
	$effect(() => {
		if (!map || !mapLoaded || appStore.mode !== 'heatmap') return;
		const source = map.getSource('heatmap-data') as maplibregl.GeoJSONSource | undefined;
		if (!source) return;

		// Use accumulated points + current violations for richer heatmap
		const currentViolations = busStore.activeBuses.filter((b) => b.isViolation);
		const allPoints = [
			...heatmapPoints.map(p => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
				properties: { weight: p.weight },
			})),
			...currentViolations.map((b) => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
				properties: { weight: 2 },
			})),
		];
		source.setData({ type: 'FeatureCollection', features: allPoints });
	});

	// Show route path when a bus is selected
	$effect(() => {
		if (!map || !mapLoaded) return;
		const source = map.getSource('route-path') as maplibregl.GeoJSONSource | undefined;
		if (!source) return;

		const selected = busStore.selectedBus;
		if (!selected) {
			source.setData({ type: 'FeatureCollection', features: [] });
			return;
		}

		// Build route path from the bus's trail history
		const trail = busTrails.get(selected.busId);
		if (!trail || trail.length < 2) {
			source.setData({ type: 'FeatureCollection', features: [] });
			return;
		}

		const coordinates = trail.map((p: { lng: number; lat: number }) => [p.lng, p.lat]);
		source.setData({
			type: 'FeatureCollection',
			features: [{
				type: 'Feature',
				geometry: { type: 'LineString', coordinates },
				properties: {},
			}],
		});
	});

	function updateTrailLines(buses: typeof busStore.activeBuses) {
		if (!map || !mapLoaded) return;
		const source = map.getSource('bus-trails') as maplibregl.GeoJSONSource | undefined;
		if (!source) return;

		const features: GeoJSON.Feature[] = [];
		for (const bus of buses) {
			const trail = busTrails.get(bus.busId);
			if (!trail || trail.length < 2) continue;

			const status = getBusStatus(bus);
			const color = getStatusColor(status);
			const isSelected = bus.busId === busStore.selectedBusId;

			// Create line segments with decreasing opacity
			// Selected bus gets brighter, thicker trails
			for (let i = 1; i < trail.length; i++) {
				const baseOpacity = isSelected ? 0.7 : 0.4;
				const opacity = (i / trail.length) * baseOpacity;
				features.push({
					type: 'Feature',
					geometry: {
						type: 'LineString',
						coordinates: [
							[trail[i - 1].lng, trail[i - 1].lat],
							[trail[i].lng, trail[i].lat],
						],
					},
					properties: { color: isSelected ? '#06b6d4' : color, opacity },
				});
			}
		}

		source.setData({ type: 'FeatureCollection', features });
	}

	function createMarkerElement(
		routeNr: string,
		color: string,
		status: string,
		isSelected: boolean,
		busId: string,
		speed?: number,
		limit?: number,
		direction?: number,
	): HTMLDivElement {
		const el = document.createElement('div');
		el.className = 'bus-marker';
		el.addEventListener('click', (e) => {
			e.stopPropagation();
			busStore.selectBus(busStore.selectedBusId === busId ? null : busId);
		});
		updateMarkerElement(el, routeNr, color, status, isSelected, speed, limit, direction);
		return el;
	}

	function updateMarkerElement(
		el: HTMLDivElement,
		routeNr: string,
		color: string,
		status: string,
		isSelected: boolean,
		speed?: number,
		limit?: number,
		direction?: number,
	) {
		const size = isSelected ? 40 : 32;
		const fontSize = isSelected ? 13 : 11;

		// Outer glow ring
		const glowSize = size + 16;
		const glowColor = status === 'violation' ? color : isSelected ? '#06b6d4' : color;
		const glowOpacity = status === 'violation' ? 0.35 : isSelected ? 0.25 : 0.12;

		// Direction arrow rotation
		const rotation = direction != null ? direction : 0;
		const showDirection = speed != null && speed > 2;

		let html = '';

		// Violation pulse rings (animated)
		if (status === 'violation') {
			html += `<div class="violation-pulse" style="
				position: absolute; inset: -12px; border-radius: 50%;
				border: 2px solid ${color};
				animation: violation-ring 1.5s ease-out infinite;
			"></div>`;
			html += `<div class="violation-pulse" style="
				position: absolute; inset: -12px; border-radius: 50%;
				border: 2px solid ${color};
				animation: violation-ring 1.5s ease-out infinite 0.5s;
			"></div>`;
		}

		// Ambient glow
		html += `<div style="
			position: absolute; inset: -8px; border-radius: 50%;
			background: radial-gradient(circle, ${glowColor}${Math.round(glowOpacity * 255).toString(16).padStart(2, '0')} 0%, transparent 70%);
			pointer-events: none;
		"></div>`;

		// Direction indicator (triangle behind marker)
		if (showDirection) {
			html += `<div style="
				position: absolute; top: 50%; left: 50%;
				width: 0; height: 0;
				border-left: 5px solid transparent; border-right: 5px solid transparent;
				border-bottom: 14px solid ${color}80;
				transform: translate(-50%, -50%) rotate(${rotation}deg) translateY(-${size / 2 + 6}px);
				pointer-events: none;
			"></div>`;
		}

		// Main marker circle
		html += `<div style="
			width: ${size}px; height: ${size}px; border-radius: 50%;
			background: radial-gradient(circle at 35% 35%, ${color}ee, ${color}aa);
			border: 2px solid rgba(255,255,255,${isSelected ? 0.7 : 0.3});
			display: flex; align-items: center; justify-content: center;
			font-size: ${fontSize}px; font-weight: 700; color: white;
			cursor: pointer; position: relative; z-index: 2;
			box-shadow: 0 0 ${isSelected ? 20 : 10}px ${glowColor}40,
				0 2px 8px rgba(0,0,0,0.5),
				inset 0 1px 2px rgba(255,255,255,0.15);
			font-family: var(--font-sans); letter-spacing: -0.5px;
			text-shadow: 0 1px 3px rgba(0,0,0,0.5);
		">${routeNr}</div>`;

		// Speed badge (always visible when there's speed data)
		if (speed != null && speed > 0) {
			const speedColor = status === 'violation' ? '#ef4444' : status === 'approaching' ? '#f59e0b' : '#10b981';
			html += `<div style="
				position: absolute; top: -8px; right: -8px; z-index: 3;
				background: rgba(3, 7, 18, 0.92); backdrop-filter: blur(8px);
				border: 1px solid ${speedColor}40;
				border-radius: 6px; padding: 1px 4px;
				font-size: 9px; font-weight: 600; color: ${speedColor};
				font-family: var(--font-mono); white-space: nowrap;
				box-shadow: 0 2px 8px rgba(0,0,0,0.4);
				line-height: 1.3;
			">${Math.round(speed)}</div>`;
		}

		// Selection ring (replaces inline info panel — detail panel is on right side)
		if (isSelected) {
			html += `<div style="
				position: absolute; inset: -6px; border-radius: 50%;
				border: 2px solid rgba(6, 182, 212, 0.6);
				pointer-events: none;
				box-shadow: 0 0 12px rgba(6, 182, 212, 0.3), inset 0 0 8px rgba(6, 182, 212, 0.1);
			"></div>`;
		}

		el.innerHTML = html;
		el.style.zIndex = isSelected ? '10' : status === 'violation' ? '5' : '1';
	}
</script>

<div bind:this={mapContainer} class="absolute inset-0 w-full h-full"></div>

<style>
	/* Do NOT add transition on transform — MapLibre uses transform to position
	   markers on screen. A CSS transition causes markers to lag behind during
	   pan/zoom, making them appear to float in the wrong location (e.g. the sea). */
	:global(.bus-marker) {
		will-change: transform;
	}

	/* Violation pulse ring animation */
	@keyframes violation-ring {
		0% { transform: scale(0.8); opacity: 0.8; }
		100% { transform: scale(2.2); opacity: 0; }
	}

	/* Info panel appear */
	@keyframes marker-info-appear {
		from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
		to { opacity: 1; transform: translateX(-50%) translateY(0); }
	}

	/* Violation shockwave expanding ring on map */
	:global(.shockwave-ring) {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		pointer-events: none;
		position: relative;
	}

	:global(.shockwave-ring)::before,
	:global(.shockwave-ring)::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		border-radius: 50%;
		transform: translate(-50%, -50%);
	}

	:global(.shockwave-ring)::before {
		width: 20px;
		height: 20px;
		border: 2px solid rgba(239, 68, 68, 0.8);
		animation: shockwave-expand 1.2s ease-out forwards;
	}

	:global(.shockwave-ring)::after {
		width: 20px;
		height: 20px;
		border: 1px solid rgba(239, 68, 68, 0.4);
		animation: shockwave-expand 1.2s ease-out 0.15s forwards;
	}

	@keyframes shockwave-expand {
		0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
		100% { transform: translate(-50%, -50%) scale(8); opacity: 0; }
	}

	/* Ghost dot: shows GPS position for hovered chart point */
	:global(.ghost-position-dot) {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: rgba(6, 182, 212, 0.3);
		border: 2px solid #06b6d4;
		box-shadow: 0 0 8px rgba(6, 182, 212, 0.5);
		animation: ghost-pulse 1.5s ease-in-out infinite;
		pointer-events: none;
	}

	@keyframes ghost-pulse {
		0%, 100% { transform: scale(1); opacity: 0.8; }
		50% { transform: scale(1.4); opacity: 1; }
	}
</style>
