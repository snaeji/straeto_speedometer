/**
 * Pre-computed polyline data for each GTFS route shape.
 *
 * Builds cumulative distance arrays and spatial grids at startup
 * so that map matching can efficiently snap GPS to route polylines.
 */

import type { GtfsService } from './gtfs-service';
import { flatDistanceM, projectPointOnSegment } from '$lib/utils/geo';
import { ROUTE_GRID_LAT_STEP, ROUTE_GRID_LNG_STEP } from '$lib/utils/constants';

export interface RouteShapeVertex {
	lat: number;
	lng: number;
	cumDistM: number;
}

export interface RouteShapeData {
	shapeId: string;
	routeNr: string;
	directionId: number;
	vertices: RouteShapeVertex[];
	totalLengthM: number;
	grid: Map<string, number[]>; // cell key -> segment indices
	stopDistancesM: number[]; // distance along route for each stop
}

function gridKey(lat: number, lng: number): string {
	const row = Math.floor(lat / ROUTE_GRID_LAT_STEP);
	const col = Math.floor(lng / ROUTE_GRID_LNG_STEP);
	return `${row},${col}`;
}

/** Snap a lat/lng to the nearest point on the polyline, returning distance along route. */
function snapPointToPolyline(
	lat: number,
	lng: number,
	vertices: RouteShapeVertex[],
): { distAlongM: number; distanceM: number } | null {
	if (vertices.length < 2) return null;

	let bestDist = Infinity;
	let bestDistAlong = 0;

	for (let i = 0; i < vertices.length - 1; i++) {
		const a = vertices[i];
		const b = vertices[i + 1];
		const proj = projectPointOnSegment(lat, lng, a.lat, a.lng, b.lat, b.lng);
		if (proj.distanceM < bestDist) {
			bestDist = proj.distanceM;
			const segLen = b.cumDistM - a.cumDistM;
			bestDistAlong = a.cumDistM + proj.t * segLen;
		}
	}

	return { distAlongM: bestDistAlong, distanceM: bestDist };
}

export class RouteShapeIndex {
	private shapes = new Map<string, RouteShapeData>();

	build(shapesGeoJson: GeoJSON.FeatureCollection, gtfsService: GtfsService): void {
		for (const feature of shapesGeoJson.features) {
			const props = feature.properties;
			if (!props?.shapeId || feature.geometry.type !== 'LineString') continue;

			const coords = (feature.geometry as GeoJSON.LineString).coordinates;
			if (coords.length < 2) continue;

			const shapeId = props.shapeId as string;
			const routeNr = (props.routeNr as string) ?? '';
			const directionId = (props.directionId as number) ?? 0;

			// Build vertex array with cumulative distances
			const vertices: RouteShapeVertex[] = [];
			let cumDist = 0;
			for (let i = 0; i < coords.length; i++) {
				const [lng, lat] = coords[i]; // GeoJSON is [lng, lat]
				if (i > 0) {
					const prev = vertices[i - 1];
					cumDist += flatDistanceM(prev.lat, prev.lng, lat, lng);
				}
				vertices.push({ lat, lng, cumDistM: cumDist });
			}

			// Build spatial grid
			const grid = new Map<string, number[]>();
			for (let i = 0; i < vertices.length - 1; i++) {
				const a = vertices[i];
				const b = vertices[i + 1];
				const minLat = Math.min(a.lat, b.lat);
				const maxLat = Math.max(a.lat, b.lat);
				const minLng = Math.min(a.lng, b.lng);
				const maxLng = Math.max(a.lng, b.lng);

				const rowStart = Math.floor(minLat / ROUTE_GRID_LAT_STEP);
				const rowEnd = Math.floor(maxLat / ROUTE_GRID_LAT_STEP);
				const colStart = Math.floor(minLng / ROUTE_GRID_LNG_STEP);
				const colEnd = Math.floor(maxLng / ROUTE_GRID_LNG_STEP);

				for (let r = rowStart; r <= rowEnd; r++) {
					for (let c = colStart; c <= colEnd; c++) {
						const key = `${r},${c}`;
						let arr = grid.get(key);
						if (!arr) {
							arr = [];
							grid.set(key, arr);
						}
						arr.push(i);
					}
				}
			}

			// Snap stop positions to route
			const stopDistancesM: number[] = [];
			const stops = gtfsService.getStopSequence(routeNr, directionId);
			for (const stop of stops) {
				const snap = snapPointToPolyline(stop.lat, stop.lng, vertices);
				stopDistancesM.push(snap ? snap.distAlongM : 0);
			}

			this.shapes.set(shapeId, {
				shapeId,
				routeNr,
				directionId,
				vertices,
				totalLengthM: cumDist,
				grid,
				stopDistancesM,
			});
		}
	}

	get(shapeId: string): RouteShapeData | undefined {
		return this.shapes.get(shapeId);
	}

	get size(): number {
		return this.shapes.size;
	}
}
