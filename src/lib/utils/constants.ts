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

// Step 1: Outlier rejection
export const OUTLIER_MAX_DISTANCE_M = 500.0;
export const OUTLIER_MAX_SPEED_KMH = 120.0;
export const OUTLIER_MIN_TIME_GAP_S = 1;

// Step 2: Minimum distance threshold
export const MIN_DISTANCE_THRESHOLD_M = 10.0;
export const STATIONARY_CONFIRM_COUNT = 2; // Consecutive sub-threshold readings before confirming stopped

// Step 3: Speed smoothing
export const SMOOTHING_BUFFER_SIZE = 6;
export const MIN_SPEED_READINGS = 3; // Require this many readings before reporting speed

// Step 4: Conservative speed factor
export const CONSERVATIVE_SPEED_FACTOR = 0.95;

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

// Kalman filter parameters
export const KALMAN_SIGMA_A = 0.8; // Process noise: acceleration std dev (m/s²)
export const KALMAN_SIGMA_GPS = 5.0; // Measurement noise: GPS position sigma (m)
export const KALMAN_MIN_FIXES_FOR_PREDICTION = 3; // Warm-up fixes before reporting speed
export const KALMAN_PREDICTION_CAP_S = 5.0; // Max extrapolation time (seconds)
export const KALMAN_PREDICTION_DECAY_S = 2.0; // Velocity decay window after cap
export const KALMAN_BLEND_DURATION_MS = 400; // Correction blend window (ms)
export const KALMAN_ENDPOINT_BUFFER_SIZE = 6; // Position buffer for endpoint speed bound

// Route colors for consistent coloring
export const ROUTE_COLORS: Record<string, string> = {};
