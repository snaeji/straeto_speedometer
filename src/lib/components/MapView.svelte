<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import { busStore, getBusStatus, getStatusColor } from '$lib/stores/buses.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import { MAP_CENTER, MAP_ZOOM } from '$lib/utils/constants';

	let mapContainer: HTMLDivElement;
	let map: maplibregl.Map | null = null;
	let mapLoaded = $state(false);
	let markers = new Map<string, { marker: maplibregl.Marker; element: HTMLDivElement }>();
	let resizeObserver: ResizeObserver | null = null;

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
			attributionControl: true,
		});

		map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

		// Wait for map to load before adding layers
		map.on('load', () => {
			if (!map) return;
			mapLoaded = true;

			// Add speed limit road overlay (before heatmap so heatmap renders on top)
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

			// Add heatmap source and layer
			map.addSource('heatmap-data', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] },
			});

			map.addLayer({
				id: 'heatmap-layer',
				type: 'heatmap',
				source: 'heatmap-data',
				paint: {
					'heatmap-weight': 1,
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

		// Handle map click to deselect
		map.on('click', (e: maplibregl.MapMouseEvent) => {
			const target = e.originalEvent.target as HTMLElement;
			if (!target.closest('.bus-marker')) {
				busStore.selectBus(null);
			}
		});

		// Disable auto-follow on manual interaction
		map.on('dragstart', () => {
			busStore.autoFollow = false;
		});

		resizeObserver = new ResizeObserver(() => {
			map?.resize();
		});
		resizeObserver.observe(mapContainer);
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		for (const { marker } of markers.values()) {
			marker.remove();
		}
		markers.clear();
		map?.remove();
	});

	// Update markers when bus data changes
	$effect(() => {
		if (!map) return;

		const currentBuses = busStore.activeBuses;
		const currentIds = new Set(currentBuses.map((b) => b.busId));

		// Remove markers for buses that are gone
		for (const [busId, { marker }] of markers) {
			if (!currentIds.has(busId)) {
				marker.remove();
				markers.delete(busId);
			}
		}

		// Add or update markers
		for (const bus of currentBuses) {
			const status = getBusStatus(bus);
			const color = getStatusColor(status);
			const isSelected = bus.busId === busStore.selectedBusId;

			const existing = markers.get(bus.busId);
			if (existing) {
				// Update position
				existing.marker.setLngLat([bus.lng, bus.lat]);

				// Update element
				updateMarkerElement(existing.element, bus.routeNr, color, status, isSelected, bus.speedKmh, bus.speedLimitKmh);
			} else {
				// Create new marker
				const el = createMarkerElement(bus.routeNr, color, status, isSelected, bus.busId, bus.speedKmh, bus.speedLimitKmh);
				const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
					.setLngLat([bus.lng, bus.lat])
					.addTo(map!);

				markers.set(bus.busId, { marker, element: el });
			}
		}
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

	// Update heatmap data
	$effect(() => {
		if (!map || !mapLoaded || appStore.mode !== 'heatmap') return;
		const source = map.getSource('heatmap-data') as maplibregl.GeoJSONSource | undefined;
		if (!source) return;

		const violations = busStore.activeBuses.filter((b) => b.isViolation);
		source.setData({
			type: 'FeatureCollection',
			features: violations.map((b) => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
				properties: {},
			})),
		});
	});

	function createMarkerElement(
		routeNr: string,
		color: string,
		status: string,
		isSelected: boolean,
		busId: string,
		speed?: number,
		limit?: number,
	): HTMLDivElement {
		const el = document.createElement('div');
		el.className = 'bus-marker';
		el.addEventListener('click', (e) => {
			e.stopPropagation();
			busStore.selectBus(busStore.selectedBusId === busId ? null : busId);
		});
		updateMarkerElement(el, routeNr, color, status, isSelected, speed, limit);
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
	) {
		const size = isSelected ? 36 : 28;
		const borderWidth = isSelected ? 3 : 2;
		const fontSize = isSelected ? 12 : 10;
		const glow = status === 'violation'
			? `0 0 12px ${color}60, 0 0 24px ${color}20`
			: isSelected
				? '0 0 12px rgba(6, 182, 212, 0.4)'
				: '0 2px 8px rgba(0,0,0,0.5)';

		let html = `<div style="
			width: ${size}px; height: ${size}px; border-radius: 50%;
			background: ${color}; border: ${borderWidth}px solid rgba(255,255,255,${isSelected ? 0.8 : 0.4});
			display: flex; align-items: center; justify-content: center;
			font-size: ${fontSize}px; font-weight: 600; color: white;
			cursor: pointer; transition: all 0.2s; box-shadow: ${glow};
			font-family: var(--font-sans);
		">${routeNr}</div>`;

		if (isSelected && speed != null) {
			html += `<div style="
				position: absolute; top: ${size + 4}px; left: 50%; transform: translateX(-50%);
				background: rgba(8, 14, 30, 0.9); backdrop-filter: blur(12px);
				border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
				padding: 3px 8px; white-space: nowrap;
				font-size: 11px; font-family: var(--font-mono); color: white;
				box-shadow: 0 4px 12px rgba(0,0,0,0.4);
			">
				<span style="color: ${color}">${speed.toFixed(1)}</span>
				<span style="color: rgba(148,163,184,0.6)"> / ${limit ?? '--'}</span>
				<span style="color: rgba(148,163,184,0.4); font-size: 9px"> km/h</span>
			</div>`;
		}

		el.innerHTML = html;
		el.style.position = 'relative';
		el.style.zIndex = isSelected ? '10' : status === 'violation' ? '5' : '1';
	}
</script>

<div bind:this={mapContainer} class="absolute inset-0 w-full h-full"></div>

<style>
	:global(.bus-marker) {
		transition: transform 0.3s ease-out;
	}
</style>
