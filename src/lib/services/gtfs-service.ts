import type {
	GtfsRoute,
	GtfsStop,
	GtfsRoutesFile,
	GtfsStopsFile,
	GtfsTripShapesFile,
} from '$lib/types/gtfs';

// Deterministic fallback colors for routes without an official color
const FALLBACK_COLORS = [
	'#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
	'#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

export class GtfsService {
	private routes = new Map<string, GtfsRoute>();
	private stops = new Map<string, GtfsStop>();
	private tripShapes = new Map<string, string>();
	private _shapesGeoJson: GeoJSON.FeatureCollection | null = null;
	private _loaded = false;

	get isLoaded(): boolean {
		return this._loaded;
	}

	get shapesGeoJson(): GeoJSON.FeatureCollection | null {
		return this._shapesGeoJson;
	}

	async load(basePath: string): Promise<void> {
		const [routesData, shapesData, stopsData, tripShapesData] = await Promise.all([
			fetchJson<GtfsRoutesFile>(`${basePath}/routes.json`),
			fetchJson<GeoJSON.FeatureCollection>(`${basePath}/shapes.json`),
			fetchJson<GtfsStopsFile>(`${basePath}/stops.json`),
			fetchJson<GtfsTripShapesFile>(`${basePath}/trip-shapes.json`),
		]);

		for (const [key, route] of Object.entries(routesData)) {
			this.routes.set(key, route);
		}

		this._shapesGeoJson = shapesData;

		for (const [key, stop] of Object.entries(stopsData)) {
			this.stops.set(key, stop);
		}

		for (const [tripId, shapeId] of Object.entries(tripShapesData)) {
			this.tripShapes.set(tripId, shapeId);
		}

		this._loaded = true;
	}

	// --- Route lookups ---

	getRoute(routeNr: string): GtfsRoute | undefined {
		return this.routes.get(routeNr);
	}

	getAllRoutes(): GtfsRoute[] {
		return Array.from(this.routes.values());
	}

	getAllRouteNumbers(): string[] {
		return Array.from(this.routes.keys()).sort(
			(a, b) => parseInt(a) - parseInt(b)
		);
	}

	getRouteColor(routeNr: string): string {
		const route = this.routes.get(routeNr);
		if (route?.color) return route.color;
		// Deterministic fallback based on route number
		const idx = Math.abs(hashCode(routeNr)) % FALLBACK_COLORS.length;
		return FALLBACK_COLORS[idx];
	}

	// --- Shape lookups ---

	/**
	 * Get the shape ID for a trip. Falls back to route+direction primary shape.
	 */
	getShapeId(tripId: string | undefined, routeNr: string, direction: number): string | null {
		if (tripId) {
			const shapeId = this.tripShapes.get(tripId);
			if (shapeId) return shapeId;
		}
		// Fallback: primary shape for this route+direction
		const route = this.routes.get(routeNr);
		if (route) {
			const dir = route.directions[direction];
			if (dir?.primaryShapeId) return dir.primaryShapeId;
			// Try the other direction
			const otherDir = route.directions[direction === 0 ? 1 : 0];
			if (otherDir?.primaryShapeId) return otherDir.primaryShapeId;
		}
		return null;
	}

	getShapeGeoJson(shapeId: string): GeoJSON.Feature | null {
		if (!this._shapesGeoJson) return null;
		return this._shapesGeoJson.features.find(
			(f) => f.properties?.shapeId === shapeId
		) ?? null;
	}

	getRouteShapesGeoJson(routeNr: string): GeoJSON.Feature[] {
		if (!this._shapesGeoJson) return [];
		return this._shapesGeoJson.features.filter(
			(f) => f.properties?.routeNr === routeNr
		);
	}

	// --- Stop lookups ---

	getStop(stopId: string): GtfsStop | undefined {
		return this.stops.get(stopId);
	}

	getStopSequence(routeNr: string, directionId: number): GtfsStop[] {
		const route = this.routes.get(routeNr);
		if (!route) return [];
		const dir = route.directions[directionId];
		if (!dir) return [];
		return dir.stopSequence
			.map((sid) => this.stops.get(sid))
			.filter((s): s is GtfsStop => s != null);
	}

	getStopsGeoJson(): GeoJSON.FeatureCollection {
		const features: GeoJSON.Feature[] = [];
		for (const stop of this.stops.values()) {
			features.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [stop.lng, stop.lat] },
				properties: {
					stopId: stop.stopId,
					name: stop.name,
					bearing: stop.bearing ?? null,
				},
			});
		}
		return { type: 'FeatureCollection', features };
	}
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
	return res.json();
}

function hashCode(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
	}
	return h;
}
