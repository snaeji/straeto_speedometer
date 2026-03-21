# Straeto Speedometer

Real-time bus speed monitoring for Reykjavik's Straeto bus system. Tracks GPS positions, calculates speeds, compares against road speed limits, and visualizes violations on an interactive map.

## Tech Stack

- **Framework**: SvelteKit 5 (TypeScript)
- **Map**: MapLibre GL JS with OpenStreetMap tiles
- **Storage**: IndexedDB (via `idb` library)
- **Tests**: Vitest (unit), Playwright (e2e)
- **Hosting**: GitHub Pages via GitHub Actions

## Data Sources

### Straeto GraphQL API
- **Endpoint**: `https://api.straeto.is/graphql`
- **Method**: Full GraphQL query with `apollo-require-preflight: true` header
- **Introspection disabled** — schema inferred from probing
- **Polling interval**: 2 seconds (`POLLING_INTERVAL_MS`)
- **Server refresh**: Every 2-3 seconds (`Cache-Control: max-age=2`)
- **No rate limiting** (burst-tested at 50 sequential requests)
- **Response fields per bus**: `busId`, `tripId`, `routeNr`, `lat`, `lng`, `direction` (compass bearing), `headsign`, `tag`
- **nextStops** (8-10 per bus): `stop { id, name, lat, lon }`, `arrival` (predicted ETA)
- **trip**: `direction` (GTFS 0/1), `routeId`, `serviceId`, `headsign`
- **Routes queried**: 32 routes defined in `ALL_ROUTES` constant

### Speed Limit Data (Borgarvefsja ArcGIS)
- **Source**: `https://borgarvefsja.reykjavik.is/arcgis/rest/services/Borgarvefsja/Borgarvefsja_over/MapServer/23/query`
- **9,997 street segments** as GeoJSON LineStrings
- **Key field**: `HRADI` = speed limit in km/h
- **Pre-downloaded** as `static/speed_limits.geojson` (~6 MB)
- **Fallback**: 50 km/h when no segment within 50m

### GTFS Static Data
- **Source**: `http://opendata.straeto.is/data/gtfs/gtfs.zip`
- **Downloaded by**: `scripts/download-gtfs.mjs` → `static/gtfs/`
- **routes.json**: 71 routes with colors, directions, stop sequences
- **shapes.json**: 337 route polylines as GeoJSON (~15 MB)
- **stops.json**: 1,283 stops with lat/lng
- **trip-shapes.json**: 11,243 tripId → shapeId mappings
- **Re-run periodically** to stay current with schedule changes

## Architecture

### Data Pipeline (every 2 seconds)

```
Straeto GraphQL API
  |
  v
straeto-api.ts — fetch + validate (full query with nextStops + trip)
  |
  v
collection-service.ts — orchestrate per-bus processing
  |
  +--[Route-constrained path] (when GTFS shape available)
  |   |
  |   +-- gtfs-service.ts — resolve tripId → shapeId (using gtfsDirectionId)
  |   +-- route-shape-index.ts — get pre-built polyline + spatial grid
  |   +-- map-matcher.ts — snap GPS to polyline, compute route-distance speed
  |   |     Uses nextStops to constrain search at route overlaps
  |   +-- route-animator.ts — smooth 1D animation along polyline
  |   +-- speed-limit-service.ts — nearest road segment within 50m
  |
  +--[Fallback path] (no shape or off-route)
  |   |
  |   +-- spline-renderer.ts — Catmull-Rom buffer + haversine speed
  |   +-- speed-limit-service.ts
  |
  v
Violation detection (speed > limit + 5 km/h grace, zone transition ramp)
  |
  v
busStore → UI (MapView, BusList, SpeedGraph, ViolationFeed)
```

### Key Services

| Service | File | Purpose |
|---------|------|---------|
| **StraetoAPI** | `straeto-api.ts` | Fetch bus locations with nextStops + trip data |
| **CollectionService** | `collection-service.ts` | Orchestrate speed pipeline, violation detection |
| **MapMatcher** | `map-matcher.ts` | Snap GPS to route polyline, route-constrained speed |
| **SplineRenderer** | `spline-renderer.ts` | Catmull-Rom animation + fallback speed from haversine |
| **RouteAnimator** | `route-animator.ts` | 1D animation along route polyline (60fps) |
| **SpeedLimitService** | `speed-limit-service.ts` | Spatial grid lookup of nearest speed limit segment |
| **RouteShapeIndex** | `route-shape-index.ts` | Pre-built polyline data with cumulative distances |
| **GtfsService** | `gtfs-service.ts` | Route/shape/stop lookups from static GTFS data |
| **StorageService** | `storage-service.ts` | IndexedDB persistence for bus locations |

### Stores (Svelte 5 runes)

| Store | File | Purpose |
|-------|------|---------|
| **busStore** | `buses.svelte.ts` | Current bus positions, selection, filtering |
| **statsStore** | `stats.svelte.ts` | Computed statistics (violations, speeds, distance) |
| **collectionStore** | `collection.svelte.ts` | Polling lifecycle, recording, monitoring |
| **playbackStore** | `playback.svelte.ts` | Time-travel through historical data |

## Speed Calculation

### Route-Constrained Pipeline (primary)
1. Snap GPS to nearest polyline segment → `distAlongRouteM`
2. Speed = `deltaDistance / deltaTime × 0.95` (conservative factor)
3. EMA smoothing with alpha=0.6
4. Warmup: 4 fixes before emitting speed
5. Outlier rejection: speed > 90 km/h → hold previous
6. nextStops constraint: narrow segment search to before first upcoming stop

### Spline Renderer Pipeline (fallback)
1. Buffer 4-8 genuine GPS readings per bus
2. Speed = min(segmentSpeed, endpointSpeed) × 0.95
3. EMA smoothing with alpha=0.6
4. Catmull-Rom spline animation (centripetal, alpha=0.5)
5. ~8-10 second display delay (deliberate: shows real positions, not predictions)

### Violation Detection
- Violation: `speed > speedLimit + 5 km/h`
- Zone transition grace: linear ramp from old to new limit over 8 seconds
- Route 31 suppressed (known GPS quality issues)

## Key Constants (`src/lib/utils/constants.ts`)

| Constant | Value | Purpose |
|----------|-------|---------|
| `POLLING_INTERVAL_MS` | 2000 | API poll frequency |
| `OUTLIER_MAX_SPEED_KMH` | 90 | GPS spike filter |
| `CONSERVATIVE_SPEED_FACTOR` | 0.95 | Bias toward underestimation |
| `SPEED_EMA_ALPHA` | 0.6 | Speed smoothing factor |
| `MAX_SNAP_DISTANCE_M` | 75 | Off-route threshold |
| `STOP_PROXIMITY_M` | 30 | Near-stop detection |
| `NEXT_STOP_FORWARD_MARGIN_M` | 150 | nextStops constraint tolerance |
| `VIOLATION_GRACE_KMH` | 5.0 | Speed over limit tolerance |
| `ZONE_TRANSITION_GRACE_MS` | 8000 | Deceleration grace period |
| `DEFAULT_SPEED_LIMIT_KMH` | 50 | Fallback when no road match |

## Data Model

### BusLocation (TypeScript)
```typescript
interface BusLocation {
  busId: string;
  routeNr: string;
  tripId: string;
  lat: number;
  lng: number;
  direction: number;          // compass bearing 0-360
  timestamp: number;          // epoch ms
  headsign?: string;
  speedKmh?: number;
  speedLimitKmh?: number;
  isViolation: boolean;
  matchConfidence?: 'high' | 'low' | 'off-route';
  snappedLat?: number;
  snappedLng?: number;
  distAlongRouteM?: number;
  isNearStop?: boolean;
  nextStops?: NextStop[];     // transient (not stored)
  gtfsDirectionId?: number;   // 0 or 1 from API trip.direction
}
```

### Storage Format (JSONL)
Compact keys: `b`=busId, `r`=routeNr, `t`=tripId, `la`=lat, `ln`=lng, `d`=direction, `ts`=timestamp, `s`=speed, `sl`=speedLimit, `v`=violation

## Project Structure

```
src/
  lib/
    services/          # Core business logic
    stores/            # Svelte 5 reactive state
    types/             # TypeScript interfaces
    utils/             # Geo math, constants, formatting
    components/        # Svelte UI components
  routes/              # SvelteKit pages
static/
  gtfs/                # Route shapes, stops, trip mappings
  speed_limits.geojson # Road speed limit segments
  sample.jsonl         # Sample bus data for testing
scripts/
  collect.mjs          # Standalone data collector
  download-gtfs.mjs    # GTFS data refresh
  browser.mjs          # Headless browser testing
tests/
  unit/                # Vitest unit tests
  e2e/                 # Playwright e2e tests
  fixtures/            # Test data factories
```

## Coordinate Math

All distance calculations use Reykjavik-specific constants (64°N):
- 1° latitude ≈ 111 km
- 1° longitude ≈ 48.6 km (cos(64°) factor)
- Flat-Earth approximation for short distances (<1km)
- Haversine for final distance measurements
- GPS coordinates are server-averaged (66.5% end in ...3333/6667 = ÷3 pattern)

## GPS Data Characteristics

- Server updates every 2-3 seconds
- ~48% stale readings (same position, new timestamp)
- Per-bus update cadence: median 3.1s, P90 7.1s
- Coordinate precision: 13 decimal places (server-averaged)
- No per-bus timestamp — single `lastUpdate` for all buses
- No speed/accuracy/HDOP fields from API
