const straetoApiUrl = 'https://api.straeto.is/graphql';

const persistedQueryHash =
    '8f9ee84171961f8a3b9a9d1a7b2a7ac49e7e122e1ba1727e75cfe3a94ff3edb8';

const allRoutes = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29',
  '31', '35', '36',
];

const pollingIntervalMs = 2000;

// Step 1: Outlier rejection
const outlierMaxDistanceM = 500.0;
const outlierMaxSpeedKmh = 120.0;
const outlierMinTimeGapS = 1;

// Step 2: Minimum distance threshold
const minDistanceThresholdM = 10.0;

// Step 3: Position smoothing
const smoothingBufferSize = 3;

// Step 4: Conservative speed factor
const conservativeSpeedFactor = 0.92;

// Speed limit matching
const defaultSpeedLimitKmh = 50.0;
const maxSpeedLimitSearchDistanceM = 50.0;

// Coordinate conversion at 64°N (Reykjavik)
const reykjavikLatDegToKm = 111.0;
const reykjavikLngDegToKm = 48.6;
