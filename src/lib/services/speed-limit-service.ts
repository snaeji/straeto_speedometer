import { DEFAULT_SPEED_LIMIT_KMH, MAX_SPEED_LIMIT_SEARCH_DISTANCE_M } from '$lib/utils/constants';
import { pointToLineSegmentDistanceM } from '$lib/utils/geo';
import type { SpeedLimitSegment } from '$lib/types/bus';

export class SpeedLimitService {
	private segments: SpeedLimitSegment[] = [];

	get isLoaded(): boolean {
		return this.segments.length > 0;
	}

	get segmentCount(): number {
		return this.segments.length;
	}

	/** Load segments from a parsed GeoJSON FeatureCollection. */
	loadFromGeoJson(geoJson: GeoJsonFeatureCollection): void {
		this.segments = geoJson.features
			.filter((f) => f.properties.GOTUFLOKKUR !== 5) // Exclude pedestrian zones
			.map(parseSegment);
	}

	/**
	 * Find the speed limit at a given GPS coordinate.
	 * Returns the HRADI of the nearest segment within 50m,
	 * or 50 km/h (default urban) if none found.
	 */
	getSpeedLimit(lat: number, lng: number): number {
		let minDistance = Infinity;
		let bestSpeedLimit: number | null = null;

		for (const segment of this.segments) {
			const coords = segment.coordinates;
			for (let i = 0; i < coords.length - 1; i++) {
				const [aLng, aLat] = coords[i];
				const [bLng, bLat] = coords[i + 1];

				const dist = pointToLineSegmentDistanceM(lat, lng, aLat, aLng, bLat, bLng);

				if (dist < minDistance) {
					minDistance = dist;
					bestSpeedLimit = segment.speedLimitKmh;
				}
			}
		}

		if (minDistance <= MAX_SPEED_LIMIT_SEARCH_DISTANCE_M && bestSpeedLimit != null) {
			return bestSpeedLimit;
		}

		return DEFAULT_SPEED_LIMIT_KMH;
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
