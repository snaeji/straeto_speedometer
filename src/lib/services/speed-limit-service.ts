import { DEFAULT_SPEED_LIMIT_KMH, MAX_SPEED_LIMIT_SEARCH_DISTANCE_M } from '$lib/utils/constants';
import { pointToLineSegmentDistanceM } from '$lib/utils/geo';
import type { SpeedLimitSegment, SpeedLimitResult } from '$lib/types/bus';

// ~200m grid cells at 64°N latitude
const GRID_LAT_STEP = 0.0018; // 200m / 111km per degree
const GRID_LNG_STEP = 0.0041; // 200m / 48.6km per degree

interface SegmentEdge {
	aLat: number;
	aLng: number;
	bLat: number;
	bLng: number;
	speedLimitKmh: number;
	name?: string;
}

export class SpeedLimitService {
	private grid = new Map<string, SegmentEdge[]>();
	private edgeCount = 0;

	get isLoaded(): boolean {
		return this.edgeCount > 0;
	}

	get segmentCount(): number {
		return this.edgeCount;
	}

	/** Load segments from a parsed GeoJSON FeatureCollection and build spatial grid. */
	loadFromGeoJson(geoJson: GeoJsonFeatureCollection): void {
		this.grid.clear();
		this.edgeCount = 0;

		const segments = geoJson.features
			.filter((f) => f.properties.GOTUFLOKKUR !== 5)
			.map(parseSegment);

		for (const seg of segments) {
			const coords = seg.coordinates;
			for (let i = 0; i < coords.length - 1; i++) {
				const [aLng, aLat] = coords[i];
				const [bLng, bLat] = coords[i + 1];
				const edge: SegmentEdge = {
					aLat, aLng, bLat, bLng,
					speedLimitKmh: seg.speedLimitKmh,
					name: seg.name,
				};
				this.edgeCount++;

				// Insert edge into every grid cell it touches
				const minLat = Math.min(aLat, bLat);
				const maxLat = Math.max(aLat, bLat);
				const minLng = Math.min(aLng, bLng);
				const maxLng = Math.max(aLng, bLng);
				const latStart = Math.floor(minLat / GRID_LAT_STEP);
				const latEnd = Math.floor(maxLat / GRID_LAT_STEP);
				const lngStart = Math.floor(minLng / GRID_LNG_STEP);
				const lngEnd = Math.floor(maxLng / GRID_LNG_STEP);

				for (let gLat = latStart; gLat <= latEnd; gLat++) {
					for (let gLng = lngStart; gLng <= lngEnd; gLng++) {
						const key = `${gLat},${gLng}`;
						let bucket = this.grid.get(key);
						if (!bucket) {
							bucket = [];
							this.grid.set(key, bucket);
						}
						bucket.push(edge);
					}
				}
			}
		}
	}

	/**
	 * Find the speed limit at a given GPS coordinate.
	 * Uses spatial grid to check only nearby segments.
	 */
	getSpeedLimit(lat: number, lng: number): SpeedLimitResult {
		let minDistance = Infinity;
		let bestSpeedLimit: number | null = null;
		let bestRoadName: string | undefined;

		const centerLatCell = Math.floor(lat / GRID_LAT_STEP);
		const centerLngCell = Math.floor(lng / GRID_LNG_STEP);

		// Check 3x3 neighborhood (~600m coverage, well beyond 50m threshold)
		for (let dLat = -1; dLat <= 1; dLat++) {
			for (let dLng = -1; dLng <= 1; dLng++) {
				const bucket = this.grid.get(`${centerLatCell + dLat},${centerLngCell + dLng}`);
				if (!bucket) continue;

				for (const edge of bucket) {
					const dist = pointToLineSegmentDistanceM(
						lat, lng, edge.aLat, edge.aLng, edge.bLat, edge.bLng
					);
					if (dist < minDistance) {
						minDistance = dist;
						bestSpeedLimit = edge.speedLimitKmh;
						bestRoadName = edge.name;
					}
				}
			}
		}

		if (minDistance <= MAX_SPEED_LIMIT_SEARCH_DISTANCE_M && bestSpeedLimit != null) {
			return {
				speedLimitKmh: bestSpeedLimit,
				match: 'matched',
				distanceM: Math.round(minDistance * 10) / 10,
				roadName: bestRoadName,
			};
		}

		return {
			speedLimitKmh: DEFAULT_SPEED_LIMIT_KMH,
			match: 'fallback',
			distanceM: Math.round(minDistance * 10) / 10,
		};
	}
}

function parseSegment(feature: GeoJsonFeature): SpeedLimitSegment {
	const props = feature.properties;
	const geometry = feature.geometry;
	const type = geometry.type;
	const rawCoords = geometry.coordinates;

	let coords: [number, number][];
	if (type === 'MultiLineString') {
		coords = [];
		for (const lineString of rawCoords as number[][][]) {
			for (const point of lineString) {
				coords.push([point[0], point[1]]);
			}
		}
	} else {
		coords = (rawCoords as number[][]).map((c) => [c[0], c[1]]);
	}

	return {
		objectId: (props.OBJECTID ?? feature.id) as number,
		name: props.NAFN as string | undefined,
		speedLimitKmh: props.HRADI as number,
		coordinates: coords,
	};
}

interface GeoJsonFeatureCollection {
	type: string;
	features: GeoJsonFeature[];
}

interface GeoJsonFeature {
	type: string;
	id?: number;
	geometry: {
		type: string;
		coordinates: number[][] | number[][][];
	};
	properties: Record<string, unknown>;
}
