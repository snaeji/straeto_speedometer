<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker.js?url';
	maplibregl.setWorkerUrl(maplibreWorkerUrl);
	import { busStore, getBusStatus, getStatusColor } from '$lib/stores/buses.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import { collectionStore } from '$lib/stores/collection.svelte';
	import { playbackStore } from '$lib/stores/playback.svelte';
	import { MAP_CENTER, MAP_ZOOM } from '$lib/utils/constants';

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function setFrozenState(el: HTMLDivElement, isFrozen: boolean) {
		const frozen = isFrozen ? '0.45' : '';
		const filter = isFrozen ? 'saturate(0.3)' : '';
		if (el.style.opacity !== frozen) el.style.opacity = frozen;
		if (el.style.filter !== filter) el.style.filter = filter;
	}


	let mapContainer: HTMLDivElement;
	let map: maplibregl.Map | null = null;
	let mapLoaded = $state(false);
	let markers = new Map<string, {
		marker: maplibregl.Marker;
		element: HTMLDivElement;
		busId: string;
		cachedColor: string;
		cachedRouteNr: string;
		cachedIsSelected: boolean;
		cachedSpeed: number | undefined;
		cachedDirection: number;
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
		el.style.cssText = `
			width: 10px; height: 10px; border-radius: 50%;
			pointer-events: none; position: relative;
		`;
		// Create two expanding ring children (replaces ::before/::after pseudo-elements)
		for (const delay of [0, 150]) {
			const ring = document.createElement('div');
			ring.style.cssText = `
				position: absolute; top: 50%; left: 50%;
				width: 20px; height: 20px; border-radius: 50%;
				border: ${delay === 0 ? '2px' : '1px'} solid rgba(239, 68, 68, ${delay === 0 ? 0.8 : 0.4});
				transform: translate(-50%, -50%);
			`;
			ring.animate([
				{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
				{ transform: 'translate(-50%, -50%) scale(8)', opacity: 0 },
			], { duration: 1200, easing: 'ease-out', delay, fill: 'forwards' });
			el.appendChild(ring);
		}
		const m = new maplibregl.Marker({ element: el, anchor: 'center' })
			.setLngLat([lng, lat])
			.addTo(map);
		setTimeout(() => m.remove(), 1400);
	}

	// Inject global keyframes for animations referenced in marker innerHTML.
	// Svelte scopes <style> keyframes, so they don't work in dynamically created elements.
	let injectedStyle: HTMLStyleElement | null = null;
	function injectGlobalKeyframes() {
		if (document.getElementById('mapview-keyframes')) return;
		injectedStyle = document.createElement('style');
		injectedStyle.id = 'mapview-keyframes';
		injectedStyle.textContent = `
			@keyframes violation-ring {
				0% { transform: scale(0.8); opacity: 0.8; }
				100% { transform: scale(2.2); opacity: 0; }
			}
		`;
		document.head.appendChild(injectedStyle);
	}

	onMount(() => {
		injectGlobalKeyframes();
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
			if (!target.closest('[data-bus-marker]')) {
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

	// Animation loop: route-constrained or spline-interpolated positions at 60fps + camera follow
	function startAnimLoop() {
		function tick() {
			const now = appStore.mode === 'playback' ? playbackStore.currentTimestamp : Date.now();
			for (const entry of markers.values()) {
				const result = collectionStore.getAnimatedPosition(entry.busId, now);
				if (result) {
					entry.marker.setLngLat([result.lng, result.lat]);
					setFrozenState(entry.element, result.isFrozen);
					continue;
				}
				// Fallback: position already set from bus store data
			}

			// Smoothly follow selected bus at 60fps
			if (map && busStore.autoFollow && busStore.selectedBusId) {
				const entry = markers.get(busStore.selectedBusId);
				if (entry) {
					const pos = entry.marker.getLngLat();
					const center = map.getCenter();
					// Lerp the camera toward the marker to avoid jarring jumps
					const t = 0.08;
					const lng = center.lng + (pos.lng - center.lng) * t;
					const lat = center.lat + (pos.lat - center.lat) * t;
					map.setCenter([lng, lat]);
				}
			}

			animFrameId = requestAnimationFrame(tick);
		}
		animFrameId = requestAnimationFrame(tick);
	}

	onDestroy(() => {
		if (animFrameId) cancelAnimationFrame(animFrameId);
		resizeObserver?.disconnect();
		injectedStyle?.remove();
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
			el.style.cssText = `
				width: 14px; height: 14px; border-radius: 50%;
				background: rgba(6, 182, 212, 0.4);
				border: 2px solid #06b6d4;
				box-shadow: 0 0 12px rgba(6, 182, 212, 0.6);
				pointer-events: none;
			`;
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
			}
		}

		// Remove orphaned trails for buses no longer active
		for (const trailBusId of busTrails.keys()) {
			if (!currentIds.has(trailBusId)) {
				busTrails.delete(trailBusId);
			}
		}

		// Add or update markers
		for (const bus of currentBuses) {
			const status = getBusStatus(bus);
			const color = getStatusColor(status);
			const isSelected = bus.busId === busStore.selectedBusId;

			// Update trail history using animated positions (route-constrained or spline)
			const trailResult = collectionStore.getAnimatedPosition(bus.busId, now);
			if (trailResult && !trailResult.isFrozen) {
				let trail = busTrails.get(bus.busId);
				if (!trail) {
					trail = [];
					busTrails.set(bus.busId, trail);
				}
				const lastPoint = trail[trail.length - 1];
				if (!lastPoint || lastPoint.lng !== trailResult.lng || lastPoint.lat !== trailResult.lat) {
					trail.push({ lng: trailResult.lng, lat: trailResult.lat, ts: now });
					while (trail.length > TRAIL_MAX_POINTS) trail.shift();
					while (trail.length > 0 && now - trail[0].ts > TRAIL_MAX_AGE_MS) trail.shift();
				}
			}

			const existing = markers.get(bus.busId);
			if (existing) {
				// Only rebuild innerHTML if visual-affecting fields actually changed
				if (existing.cachedColor !== color || existing.cachedRouteNr !== bus.routeNr ||
					existing.cachedIsSelected !== isSelected || existing.cachedSpeed !== bus.speedKmh ||
					existing.cachedDirection !== bus.direction) {
					updateMarkerElement(existing.element, bus.routeNr, color, status, isSelected, bus.speedKmh, bus.speedLimitKmh, bus.direction);
					existing.cachedColor = color;
					existing.cachedRouteNr = bus.routeNr;
					existing.cachedIsSelected = isSelected;
					existing.cachedSpeed = bus.speedKmh;
					existing.cachedDirection = bus.direction;
				}
			} else {
				const el = createMarkerElement(bus.routeNr, color, status, isSelected, bus.busId, bus.speedKmh, bus.speedLimitKmh, bus.direction);

				// Use animated position if available, else raw GPS
				let initLng = bus.lng;
				let initLat = bus.lat;
				const initPos = collectionStore.getAnimatedPosition(bus.busId, now);
				if (initPos) {
					initLng = initPos.lng;
					initLat = initPos.lat;
				}

				const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
					.setLngLat([initLng, initLat])
					.addTo(map!);

				markers.set(bus.busId, {
					marker,
					element: el,
					busId: bus.busId,
					cachedColor: color,
					cachedRouteNr: bus.routeNr,
					cachedIsSelected: isSelected,
					cachedSpeed: bus.speedKmh,
					cachedDirection: bus.direction,
				});
			}
		}

		// Detect new violations, spawn shockwaves, accumulate heatmap
		const newViolators = new Set<string>();
		for (const bus of currentBuses) {
			if (bus.isViolation) {
				newViolators.add(bus.busId);
				// Use animated position so shockwave appears at the marker
				let lng = bus.lng;
				let lat = bus.lat;
				const shockPos = collectionStore.getAnimatedPosition(bus.busId, now);
				if (shockPos) { lng = shockPos.lng; lat = shockPos.lat; }
				if (!knownViolators.has(bus.busId)) {
					spawnShockwave(lng, lat);
				}
				// Accumulate for heatmap
				const excess = (bus.speedKmh ?? 0) - (bus.speedLimitKmh ?? 50);
				heatmapPoints.push({ lng, lat, weight: Math.max(1, excess / 10) });
				if (heatmapPoints.length > HEATMAP_MAX_POINTS) {
					heatmapPoints = heatmapPoints.slice(-HEATMAP_MAX_POINTS);
				}
			}
		}
		knownViolators = newViolators;

		// Update trail lines on map
		updateTrailLines(currentBuses);
	});

	// Snap camera to bus on initial selection
	let lastFollowedBusId: string | null = null;
	$effect(() => {
		const busId = busStore.selectedBusId;
		if (!map || !busId || busId === lastFollowedBusId) return;
		lastFollowedBusId = busId;
		// Snap to the marker's current position immediately
		const entry = markers.get(busId);
		if (entry) {
			const pos = entry.marker.getLngLat();
			map.easeTo({ center: [pos.lng, pos.lat], duration: 300 });
		} else {
			const bus = busStore.selectedBus;
			if (bus) map.easeTo({ center: [bus.lng, bus.lat], duration: 300 });
		}
	});
	// Reset tracking when deselected
	$effect(() => {
		if (!busStore.selectedBusId) lastFollowedBusId = null;
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

	// Show route path when a bus is selected (GTFS shape if available, else trail)
	$effect(() => {
		if (!map || !mapLoaded) return;
		const source = map.getSource('route-path') as maplibregl.GeoJSONSource | undefined;
		if (!source) return;

		const selected = busStore.selectedBus;
		if (!selected) {
			source.setData({ type: 'FeatureCollection', features: [] });
			return;
		}

		// Try GTFS route shape first
		const gtfs = appStore.gtfsService;
		if (gtfs) {
			const shapeId = gtfs.getShapeId(selected.tripId, selected.routeNr, selected.direction);
			if (shapeId) {
				const shapeFeature = gtfs.getShapeGeoJson(shapeId);
				if (shapeFeature) {
					source.setData({ type: 'FeatureCollection', features: [shapeFeature] });
					return;
				}
			}
		}

		// Fallback: trail history
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
		const selectedId = busStore.selectedBusId;
		if (selectedId) {
			const trail = busTrails.get(selectedId);
			if (trail && trail.length >= 2) {
				for (let i = 1; i < trail.length; i++) {
					const opacity = (i / trail.length) * 0.7;
					features.push({
						type: 'Feature',
						geometry: {
							type: 'LineString',
							coordinates: [
								[trail[i - 1].lng, trail[i - 1].lat],
								[trail[i].lng, trail[i].lat],
							],
						},
						properties: { color: '#06b6d4', opacity },
					});
				}
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
		el.style.willChange = 'transform';
		el.dataset.busMarker = '';
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
		">${escapeHtml(routeNr)}</div>`;

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

