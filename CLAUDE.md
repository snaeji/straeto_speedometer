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

### 2-Minute Buffer Pipeline

The system uses a **post-processing architecture with a 2-minute display delay**. Instead of processing data reactively as it arrives, raw GPS readings are buffered for 2 minutes, then cleaned and displayed with full context. This provides accurate speed calculation and smooth animation.

```
Straeto GraphQL API (2s polling)
  |
  v
straeto-api.ts — fetch + validate (full query with nextStops + trip)
  |
  v
RawBuffer (per-bus ring buffers, ~150s retention)
  |  [2-minute delay — data buffered, not displayed yet]
  v
TrajectoryCleaner (±30s window around display cursor)
  ├── Deduplicate stale API readings (48% are cached repeats)
  ├── Route-snap all points (via MapMatcher.snapStateless)
  │     With sequential continuity for roundabouts
  ├── Outlier rejection (OR logic — either neighbor bad = reject)
  ├── Monotonic enforcement (bus never goes backwards)
  ├── Stationarity detection (speed = 0 when stopped)
  └── Speed calculation (Gaussian-weighted, hard-clamped to 90 km/h)
  |
  v
CollectionService.processFrame()
  ├── Speed limit lookup (on cleaned/snapped position)
  ├── Violation detection (with zone transition ramp)
  └── Emit BusLocation[]
  |
  v
busStore.updateBuses()
  |
  ├──> MapView (60fps via DisplayAnimator)
  │     └── Interpolates between cleaned trajectory points
  │         Always forward, always smooth
  │
  ├──> SpeedGraph (from liveHistory)
  ├──> BusList, ViolationFeed, KPIs
  └──> StorageService (if recording)
```

### Warmup / Loading Lifecycle

When the user starts recording/monitoring:
1. **2-minute warmup**: LoadingScreen shown with fun bus-themed phases while polling fills the raw buffer
2. **First frame**: Map appears with all buses positioned, speed graph pre-populated
3. **Steady state**: `ingestPoll()` every 2s feeds raw buffer; `processFrame()` every 2s processes at display cursor time

### Key Services

| Service | File | Purpose |
|---------|------|---------|
| **StraetoAPI** | `straeto-api.ts` | Fetch bus locations with nextStops + trip data |
| **RawBuffer** | `raw-buffer.ts` | Per-bus ring buffer for raw GPS readings |
| **TrajectoryCleaner** | `trajectory-cleaner.ts` | Post-process raw readings into clean monotonic trajectories |
| **DisplayAnimator** | `display-animator.ts` | Unified 60fps position interpolation from cleaned trajectories |
| **CollectionService** | `collection-service.ts` | Orchestrate ingest + processFrame, violation detection |
| **MapMatcher** | `map-matcher.ts` | Snap GPS to route polyline (stateful `snap()` + stateless `snapStateless()`) |
| **SpeedLimitService** | `speed-limit-service.ts` | Spatial grid lookup of nearest speed limit segment |
| **RouteShapeIndex** | `route-shape-index.ts` | Pre-built polyline data with cumulative distances |
| **GtfsService** | `gtfs-service.ts` | Route/shape/stop lookups from static GTFS data |
| **StorageService** | `storage-service.ts` | IndexedDB persistence for bus locations |

### Legacy Services (still present, no longer in main pipeline)

| Service | File | Status |
|---------|------|--------|
| **SplineRenderer** | `spline-renderer.ts` | Replaced by TrajectoryCleaner + DisplayAnimator |
| **RouteAnimator** | `route-animator.ts` | Replaced by DisplayAnimator |

### Stores (Svelte 5 runes)

| Store | File | Purpose |
|-------|------|---------|
| **busStore** | `buses.svelte.ts` | Current bus positions, selection, filtering |
| **statsStore** | `stats.svelte.ts` | Computed statistics (violations, speeds, distance) |
| **collectionStore** | `collection.svelte.ts` | Warmup lifecycle, polling, display cursor |
| **playbackStore** | `playback.svelte.ts` | Time-travel through historical data |

## GPS Data Characteristics

### Server-Interpolated Positions (NOT Raw GPS)

The Straeto API does **not** serve raw GPS fixes. The bus hardware transmits every ~15 seconds; the server interpolates between fixes and serves smoothed positions every 2-3 seconds. This has critical implications:

- **~48% stale readings**: API caches the same interpolated position for multiple polls
- **÷3 coordinate pattern**: 66% of coordinates end in ...3333/...6667, confirming server-side averaging
- **Quantization resolution**: ~0.002m (300x below GPS noise floor — not a limiting factor)
- **Corner-cutting on curves**: Server linear interpolation shortens actual road distance by ~5%
- **Timing uncertainty**: API timestamp is poll time, not GPS fix time (±2-4s error)
- **Per-bus genuine update cadence**: median 5.0s, P75 6.0s, P90 7.0s, P95 12.0s
- **No per-bus timestamp** — single `lastUpdate` for all buses
- **No speed/accuracy/HDOP fields** from API

### Fleet Characteristics

- **Fleet size**: ~90 buses midday, ~125 afternoon rush, ~68-72 evening
- **Per-bus tiers**: ~40 buses at 4s median, ~85 at 5s, ~8 at 6s, Bus 31-B at 25s (malfunctioning)
- **Route 31**: 68% stale rate, P95 speed 216 km/h — violations suppressed

## Speed Calculation

### Post-Processing Pipeline (2-minute buffer)

1. **Deduplicate stale**: Remove cached API repeats (keep first+last of each cluster)
2. **Route-snap all points**: Project onto GTFS polyline with sequential continuity
   - `snapStateless()` for pure geometric snap
   - `snapStatelessNear()` for continuity-constrained snap (roundabouts)
3. **Reject outliers (OR logic)**: Remove if speed to EITHER neighbor > 90 km/h
4. **Enforce monotonic**: Remove backward points (bus only moves forward)
5. **Detect stationarity**: 3+ readings with < 3m movement → speed = 0
6. **Calculate raw speed**: `deltaDistance / deltaTime × 0.92` (conservative factor)
7. **Hard clamp**: Cap at 90 km/h (no bus exceeds this in display)
8. **Gaussian smooth**: ±2 neighbors (sigma=1.0), respects stop boundaries
9. **Interpolate**: `speedAtTime()` and `positionAtTime()` for any display timestamp

### Conservative Speed Factor (0.92)

Accounts for two known error sources:
- **Server corner-cutting** (~5%): Linear interpolation between 15s GPS fixes shortens curves
- **API timing uncertainty** (~3%): Timestamps are poll time, not GPS fix time (±2-4s)

### Violation Detection
- Violation: `speed > speedLimit + 5 km/h`
- Zone transition grace: linear ramp from old to new limit over 8 seconds
- Cascading drops (80→50→30): keeps highest prevLimit
- Route 31 suppressed (known GPS quality issues)
- Hard speed clamp at 90 km/h means no speed > 90 can ever be shown

## Key Constants (`src/lib/utils/constants.ts`)

### Buffer Pipeline
| Constant | Value | Purpose |
|----------|-------|---------|
| `DISPLAY_DELAY_MS` | 120,000 | Display cursor offset from real-time (2 minutes) |
| `WARMUP_DURATION_MS` | 120,000 | Loading screen duration (2 minutes) |
| `RAW_BUFFER_RETENTION_MS` | 150,000 | Raw reading retention (2.5 minutes) |
| `CLEANING_LOOKBACK_MS` | 30,000 | Context window behind display cursor |
| `CLEANING_LOOKAHEAD_MS` | 30,000 | Context window ahead of display cursor |
| `STALE_THRESHOLD_MS` | 180,000 | Bus disappears after 3 min no data |

### Speed Calculation
| Constant | Value | Purpose |
|----------|-------|---------|
| `POLLING_INTERVAL_MS` | 2000 | API poll frequency |
| `OUTLIER_MAX_SPEED_KMH` | 90 | Hard speed ceiling + outlier filter |
| `CONSERVATIVE_SPEED_FACTOR` | 0.92 | Accounts for corner-cutting + timing uncertainty |
| `VIOLATION_GRACE_KMH` | 5.0 | Speed over limit tolerance |
| `ZONE_TRANSITION_GRACE_MS` | 8000 | Deceleration grace period |
| `DEFAULT_SPEED_LIMIT_KMH` | 50 | Fallback when no road match |

### Route Matching
| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_SNAP_DISTANCE_M` | 75 | Off-route threshold |
| `STOP_PROXIMITY_M` | 30 | Near-stop detection |
| `NEXT_STOP_FORWARD_MARGIN_M` | 150 | nextStops constraint tolerance |
| `MATCH_SEARCH_WINDOW_M` | 500 | Segment search radius |

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

### CleanedPoint (internal to trajectory cleaner)
```typescript
interface CleanedPoint {
  lat: number; lng: number;
  timestamp: number;
  distAlongRouteM: number;    // Monotonically increasing
  snappedLat: number; snappedLng: number;
  isGenuine: boolean;         // GPS actually moved
  isNearStop: boolean;
  isStationary: boolean;      // Confirmed stopped
  matchConfidence: MatchConfidence;
  rawSpeedKmh: number;        // Before smoothing
}
```

### Storage Format (JSONL)
Compact keys: `b`=busId, `r`=routeNr, `t`=tripId, `la`=lat, `ln`=lng, `d`=direction, `ts`=timestamp, `s`=speed, `sl`=speedLimit, `v`=violation

## Project Structure

```
src/
  lib/
    services/          # Core business logic
      raw-buffer.ts        # Per-bus raw GPS reading ring buffer
      trajectory-cleaner.ts # Post-processing pipeline (dedup, snap, clean, speed)
      display-animator.ts   # Unified 60fps position interpolation
      collection-service.ts # Orchestrate ingest + processFrame
      map-matcher.ts        # Route snapping (stateful + stateless)
      speed-limit-service.ts # Spatial speed limit lookup
      route-shape-index.ts  # Pre-built polyline data
      gtfs-service.ts       # GTFS route/shape/stop lookups
      storage-service.ts    # IndexedDB persistence
      straeto-api.ts        # GraphQL API client
      spline-renderer.ts    # [Legacy] Catmull-Rom animation
      route-animator.ts     # [Legacy] 1D polyline animation
    stores/            # Svelte 5 reactive state
    types/             # TypeScript interfaces
    utils/             # Geo math, constants, formatting
    components/        # Svelte UI components
      LoadingScreen.svelte  # 2-minute warmup with bus-themed phases
      MapView.svelte        # Map + markers + trails + heatmap
      SpeedGraph.svelte     # Speed timeline chart + bus detail panel
      Dashboard.svelte      # Main layout orchestrator
      LivePanel.svelte      # Recording controls + bus list + violations
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
  unit/                # Vitest unit tests (363 tests, 17 files)
  e2e/                 # Playwright e2e tests
  fixtures/            # Test data factories
docs/
  spec-2min-buffer-redesign.md  # Full design specification
  analysis/            # Data analysis from real API recordings
```

## Coordinate Math

All distance calculations use Reykjavik-specific constants (64°N):
- 1° latitude ≈ 111 km
- 1° longitude ≈ 48.6 km (cos(64°) factor)
- Flat-Earth approximation for short distances (<1km)
- Haversine for final distance measurements
- GPS coordinates are server-averaged (66.5% end in ...3333/6667 = ÷3 pattern)
- Quantization resolution: ~0.002m (300x below noise floor — not a limiting factor)
