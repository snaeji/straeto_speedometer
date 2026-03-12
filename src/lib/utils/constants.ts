export const STRAETO_API_URL = 'https://api.straeto.is/graphql';

export const PERSISTED_QUERY_HASH =
	'8f9ee84171961f8a3b9a9d1a7b2a7ac49e7e122e1ba1727e75cfe3a94ff3edb8';

export const ALL_ROUTES = [
	'1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
	'11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
	'21', '22', '23', '24', '25', '26', '27', '28', '29',
	'31', '35', '36',
];

export const POLLING_INTERVAL_MS = 2000;

// Outlier rejection
export const OUTLIER_MAX_SPEED_KMH = 120.0;

// Conservative speed factor
export const CONSERVATIVE_SPEED_FACTOR = 0.95;


// Spline renderer
export const SPLINE_MIN_BUFFER = 4; // readings before first animation (Catmull-Rom needs 4 points)
export const SPLINE_MAX_BUFFER = 8; // max readings to keep per bus
export const SPLINE_STALE_THRESHOLD_M = 1.0; // GPS stale detection
export const SPLINE_STATIONARY_DIST_M = 3.0; // near-stationary threshold
export const SPLINE_STATIONARY_COUNT = 3; // consecutive readings to confirm stopped
export const SPLINE_GAP_RESET_S = 60; // reset buffer if gap exceeds this
export const SPLINE_OVERSHOOT_GUARD_M = 50; // fallback to linear if spline deviates
export const SPLINE_SPEED_ENDPOINT_BUFFER = 4; // readings for endpoint speed bound
export const SPEED_EMA_ALPHA = 0.6; // EMA smoothing factor for speed output

// Speed limit matching
export const DEFAULT_SPEED_LIMIT_KMH = 50.0;
export const MAX_SPEED_LIMIT_SEARCH_DISTANCE_M = 50.0;
export const VIOLATION_GRACE_KMH = 5.0;

// Coordinate conversion at 64 N (Reykjavik)
export const REYKJAVIK_LAT_DEG_TO_KM = 111.0;
export const REYKJAVIK_LNG_DEG_TO_KM = 48.6;

// UI constants
export const STALE_THRESHOLD_MS = 30_000; // 30 seconds
export const SPEED_GRAPH_HISTORY_MINUTES = 30;
export const VIOLATION_APPROACHING_RATIO = 0.8; // 80% of limit = approaching

// Map defaults (centered on Reykjavik)
export const MAP_CENTER: [number, number] = [-21.9, 64.135];
export const MAP_ZOOM = 12;


// Route matching
export const MATCH_SEARCH_WINDOW_M = 500;
export const MATCH_BACKWARD_TOLERANCE_M = 100;
export const MAX_SNAP_DISTANCE_M = 75;
export const LOW_CONFIDENCE_SNAP_DISTANCE_M = 40;
export const STOP_PROXIMITY_M = 30;
export const ROUTE_GRID_LAT_STEP = 0.0009; // ~100m
export const ROUTE_GRID_LNG_STEP = 0.00206; // ~100m at 64N

// Route-constrained animation
export const ROUTE_ANIM_MIN_BUFFER = 4;
export const ROUTE_ANIM_MAX_BUFFER = 6;
export const ROUTE_ANIM_GAP_RESET_S = 60;
export const ROUTE_ANIM_STATIONARY_DIST_M = 5.0;
export const ROUTE_ANIM_STATIONARY_COUNT = 3;

// Route colors for consistent coloring
export const ROUTE_COLORS: Record<string, string> = {};
