export interface GtfsRouteDirection {
	primaryShapeId: string | null;
	stopSequence: string[];
}

export interface GtfsRoute {
	routeNr: string;
	routeId: string;
	shortName: string;
	longName: string;
	color: string | null;
	directions: Record<number, GtfsRouteDirection>;
}

export interface GtfsStop {
	stopId: string;
	name: string;
	lat: number;
	lng: number;
	bearing?: number;
}

/** Shape of routes.json — keyed by routeNr */
export type GtfsRoutesFile = Record<string, GtfsRoute>;

/** Shape of stops.json — keyed by stopId */
export type GtfsStopsFile = Record<string, GtfsStop>;

/** Shape of trip-shapes.json — tripId → shapeId */
export type GtfsTripShapesFile = Record<string, string>;
