# Full Pipeline Audit: GPS Data → Speed Calculation → Map Rendering

**Date**: 2026-03-12
**Branch**: `rewrite/v2`
**Scope**: Complete data pipeline from Straeto API response to rendered map marker

---

## I. Pipeline Specification

### 1. Data Flow Overview

```
Straeto GraphQL API (2s poll)
  │
  ▼
validateApiResult()          — type/bounds checks on each bus
  │
  ▼
busLocationFromApi()         — maps ApiResult → BusLocation (no speed yet)
  │
  ▼
collectOnce() dedup          — skip if timestamp unchanged for bus
  │
  ▼
route change detection       — reset matcher/animator if routeNr:direction changed
  │
  ├──────────────────────────────────────────┐
  ▼                                          ▼
Pipeline A: Route-Constrained          Pipeline B: Spline Renderer
(if GTFS + shapes + snap OK)           (fallback: always)
  │                                          │
  ├─ MapMatcher.snap()                 ├─ SplineRenderer.ingestReading()
  ├─ RouteAnimator.ingest()            ├─ Outlier rejection (120 km/h)
  ├─ Speed from dist-along-route       ├─ Stationarity detection (3x <3m)
  │  × 0.95 factor                     ├─ Segment speed + endpoint bound
  │                                     ├─ × 0.95 conservative factor
  │                                     ├─ EMA smoothing (α=0.6)
  │                                          │
  └──────────┬───────────────────────────────┘
             ▼
SpeedLimitService.getSpeedLimit()    — spatial grid lookup, 50m radius
             │
             ▼
Violation detection                  — speed > limit + 5 km/h grace
             │
             ▼
BusLocation (enriched)               — to busStore, IndexedDB, UI
```

### 2. API Ingestion

- **Endpoint**: `https://api.straeto.is/graphql` (POST)
- **Query**: Persisted query, SHA256 `8f9ee84171961f8a3b9a9d1a7b2a7ac49e7e122e1ba1727e75cfe3a94ff3edb8`
- **Routes**: 29 active routes (1-29 excluding 30, 32-34; plus 31, 35, 36)
- **Poll**: Every 2000ms; API `cache-control: max-age=2` makes faster polling pointless
- **Empirical update gap**: Median 5.0s (49.8% of polls return stale data)

**Validation checks per bus** (`validateApiResult`):

| Field | Check | On failure |
|-------|-------|------------|
| busId | typeof string, non-empty | Return null |
| routeNr | typeof string or number | Return null |
| tripId | typeof string | Return null |
| lat | typeof number, isFinite, [-90, 90] | Return null |
| lng | typeof number, isFinite, [-180, 180] | Return null |
| direction | typeof number | Return null |
| headsign | typeof string or null | Set null |

**Deduplication**: `lastUpdateByBus` map tracks per-bus timestamps. If `bus.timestamp === prevTimestamp`, skip.

### 3. Speed Calculation — Spline Pipeline (Primary)

**File**: `src/lib/services/spline-renderer.ts`

Per-bus state: buffer of 4-8 SplinePoints (x/y meters, lat/lng, timestamp), stationarity counter, EMA speed, animation state.

**Step 1 — Stale detection**: If raw GPS moved < 1.0m (`SPLINE_STALE_THRESHOLD_M`), hold previous speed.

**Step 2 — Outlier rejection**:
- Time gap > 60s (`SPLINE_GAP_RESET_S`) → full reset
- Computed speed > 120 km/h (`OUTLIER_MAX_SPEED_KMH`) → full reset

**Step 3 — Stationarity detection**:
- If displacement < 3.0m (`SPLINE_STATIONARY_DIST_M`), increment counter
- If counter ≥ 3 (`SPLINE_STATIONARY_COUNT`) → stationary, speed = 0
- Single reading > 3m exits stationarity immediately (asymmetric hysteresis)

**Step 4 — Speed calculation** (when buffer ≥ 2):
```
segSpeed = haversine(prev, curr) / dt × 3.6
epSpeed  = haversine(first_of_4, last_of_4) / dt_total × 3.6
rawSpeed = max(0, min(segSpeed, epSpeed) × 0.95)
```

**Step 5 — EMA smoothing**:
```
if (currentSpeed === 0 && rawSpeed > 0): seed directly
else: currentSpeed = 0.6 × rawSpeed + 0.4 × currentSpeed
```

**Animation**: Centripetal Catmull-Rom spline (α=0.5) with 50m overshoot guard. Barry-Goldman algorithm. Requires 4 buffer points. Coincident-point division-by-zero guarded with `|| 1` fallback.

### 4. Speed Calculation — Route-Constrained Pipeline (Secondary)

**Files**: `src/lib/services/map-matcher.ts`, `src/lib/services/route-animator.ts`

**Snap algorithm**: Spatial grid (100m cells) → candidate segments → perpendicular projection → monotonicity check (backward ≤ 100m) → confidence classification.

| Lateral offset | Confidence |
|----------------|------------|
| 0-40m | high |
| 40-75m | low |
| > 75m | off-route (fall back to spline) |

**Speed**: `abs(distAlong_new - distAlong_old) / dt × 3.6 × 0.95` after 4-reading warmup. No EMA.

**Animation**: Linear interpolation in 1D distance-along-route, converted to lat/lng via binary search with cached vertex hint.

### 5. Speed Limit Matching

**File**: `src/lib/services/speed-limit-service.ts`
**Data**: `static/speed_limits.geojson` (~10,000 segments from Borgarvefsja ArcGIS Layer 23)

**Spatial grid**: 200m cells (lat: 0.0018°, lng: 0.0041°). 3×3 neighborhood search = ~600m coverage.

**Algorithm**: For each edge in 9 neighbor cells, compute `pointToLineSegmentDistanceM` (flat-Earth projection for t-parameter, Haversine for final distance). Return nearest edge's HRADI if within 50m, else fallback 50 km/h.

**Filter**: Features with `GOTUFLOKKUR === 5` excluded during loading.

### 6. Violation Detection

```
isViolation = speed > 0 AND speed > speedLimitKmh + VIOLATION_GRACE_KMH (5.0)
```

**UI status coloring**:

| Condition | Status | Color |
|-----------|--------|-------|
| No speed/limit data | nodata | Gray #6b7280 |
| speed > limit + 5 | violation | Red #ef4444 |
| speed > limit (within grace) | approaching | Orange #f59e0b |
| speed ≤ limit | normal | Green #10b981 |

### 7. All Tuning Constants

| Constant | Value | Unit |
|----------|-------|------|
| POLLING_INTERVAL_MS | 2000 | ms |
| OUTLIER_MAX_SPEED_KMH | 120.0 | km/h |
| CONSERVATIVE_SPEED_FACTOR | 0.95 | ratio |
| SPLINE_MIN_BUFFER | 4 | readings |
| SPLINE_MAX_BUFFER | 8 | readings |
| SPLINE_STALE_THRESHOLD_M | 1.0 | m |
| SPLINE_STATIONARY_DIST_M | 3.0 | m |
| SPLINE_STATIONARY_COUNT | 3 | readings |
| SPLINE_GAP_RESET_S | 60 | s |
| SPLINE_OVERSHOOT_GUARD_M | 50 | m |
| SPLINE_SPEED_ENDPOINT_BUFFER | 4 | readings |
| SPEED_EMA_ALPHA | 0.6 | ratio |
| DEFAULT_SPEED_LIMIT_KMH | 50.0 | km/h |
| MAX_SPEED_LIMIT_SEARCH_DISTANCE_M | 50.0 | m |
| VIOLATION_GRACE_KMH | 5.0 | km/h |
| REYKJAVIK_LAT_DEG_TO_KM | 111.0 | km/° |
| REYKJAVIK_LNG_DEG_TO_KM | 48.6 | km/° |
| STALE_THRESHOLD_MS | 30000 | ms |
| MATCH_SEARCH_WINDOW_M | 500 | m |
| MATCH_BACKWARD_TOLERANCE_M | 100 | m |
| MAX_SNAP_DISTANCE_M | 75 | m |
| LOW_CONFIDENCE_SNAP_DISTANCE_M | 40 | m |
| STOP_PROXIMITY_M | 30 | m |
| MATCH_WARMUP_FIXES | 4 | readings |
| ROUTE_ANIM_MIN_BUFFER | 4 | readings |
| ROUTE_ANIM_MAX_BUFFER | 6 | readings |
| ROUTE_ANIM_GAP_RESET_S | 60 | s |
| ROUTE_ANIM_STATIONARY_DIST_M | 5.0 | m |
| ROUTE_ANIM_STATIONARY_COUNT | 3 | readings |

### 8. Data Model — BusLocation

**Core fields** (populated at API entry):
busId (string), routeNr (string), tripId (string), lat (number, degrees), lng (number, degrees), direction (number), timestamp (number, epoch ms), headsign (string, optional)

**Computed fields** (populated by pipelines):
speedKmh, speedLimitKmh, speedLimitMatch ('matched'|'fallback'), speedLimitRoad, isViolation (boolean), matchConfidence ('high'|'low'|'off-route'), snappedLat, snappedLng, distAlongRouteM, isNearStop

**Serialization** (JsonLineRecord): 13 short keys (b, r, t, la, ln, d, ts, h, s, sl, slm, slr, v). Speed rounded to 0.1 km/h. Route-constrained fields NOT serialized (transient).

---

## II. Verification Results

### Geo Math (`src/lib/utils/geo.ts`)

| Check | Result |
|-------|--------|
| Haversine formula matches standard | **PASS** |
| Earth radius 6,371,000m | **PASS** |
| Hallgrimskirkja→Harpa ≈992m | **PASS** |
| Same point = 0m | **PASS** |
| 1° lat at 64°N ≈111.2km | **PASS** |
| 1° lng at 64°N ≈48.7km | **PASS** |
| Point-to-segment projection math | **PASS** |
| t clamped to [0,1] | **PASS** |
| Zero-length segment handled | **PASS** |
| Flat-Earth constants accuracy | **PASS** (0.3-0.5% low; negligible for 50m search radius) |
| speedKmh division-by-zero guard | **PASS** (returns 0 for t≤0) |
| speedKmh negative distance guard | **WARNING** (no guard, but callers always provide ≥0) |

### Spline Pipeline (`src/lib/services/spline-renderer.ts`)

| Check | Result |
|-------|--------|
| Buffer management (1-8 entries, splice+adjust) | **PASS** |
| Outlier rejection before buffer insert | **PASS** |
| 120 km/h threshold applied to raw GPS | **PASS** |
| 60s gap reset | **PASS** |
| Stationarity: 3×<3m enter, 1×>3m exit | **PASS** |
| Endpoint speed bound: min(seg, endpoint) | **PASS** |
| Conservative factor 0.95 multiplicative | **PASS** |
| EMA formula α=0.6 correct | **PASS** |
| EMA seed from zero (avoids cold-start ramp) | **PASS** |
| Catmull-Rom centripetal α=0.5 | **PASS** |
| Division-by-zero guard (coincident points) | **PASS** |
| Overshoot guard 50m → linear fallback | **PASS** |
| State machine: all transitions covered | **PASS** |
| **segmentIndex not adjusted during stationary buffer trimming** | **FAIL** |
| Timestamps use ingestion time, not GPS time | **WARNING** |
| Stale detection holds last speed (no decay) | **WARNING** |

**FAIL detail** — `spline-renderer.ts` lines 230-232: When a bus is stationary, the buffer is trimmed (`splice(0, excess)`) but `segmentIndex` is NOT adjusted. The regular trim path (lines 287-291) correctly adjusts `segmentIndex -= excess`, but the stationary path skips it. After a long stationary period, `segmentIndex` points to wrong buffer entries. The safety check at line 367 (`if (!p1 || !p2)`) prevents a crash (returns last position with `isFrozen: true`), but animation is incorrect until self-healing. **Fix**: add `state.segmentIndex = Math.max(0, state.segmentIndex - excess)` after the stationary splice.

### Route-Constrained Pipeline

| Check | Result |
|-------|--------|
| Spatial grid cell size and coverage | **PASS** |
| Distance-window search for subsequent fixes | **PASS** |
| Monotonicity enforcement (backward ≤100m → reset) | **PASS** |
| Route endpoint clamping | **PASS** |
| Off-route detection (>75m → fallback to spline) | **PASS** |
| Confidence thresholds | **PASS** |
| 4-reading warmup with spline fallback | **PASS** |
| Speed formula with abs() for backward motion | **PASS** |
| Binary search correctness | **PASS** |
| Cached vertex index hint with validation | **PASS** |
| Pipeline switching logic | **PASS** |
| Held speed on outlier rejection has no timeout/decay | **WARNING** |
| Pipeline transition can cause speed discontinuity | **WARNING** |
| No setter for gtfsService (no hot-reload; state loss on rebuild) | **WARNING** |

### Storage & State Management

| Check | Result |
|-------|--------|
| IndexedDB key format (timestamp_busId) | **PASS** |
| Write batching with transaction + lock | **PASS** |
| Read: 5s window for playback frames | **PASS** |
| Stale bus detection: 30s vs wall clock | **PASS** |
| All stores use $state correctly | **PASS** |
| Cached getter reads deps before cache check | **PASS** |
| liveHistory: 10K cap, FIFO eviction | **PASS** |
| Compression round-trip (serialized fields) | **PASS** |
| Seek debouncing via version counter | **PASS** |
| 5 transient fields dropped in serialization (by design) | **WARNING** |
| refreshStorageInfo() called every 2s (wasteful) | **WARNING** |
| IndexedDB write failure leaves busStore inconsistent | **WARNING** |
| No guard against overlapping playback frame loads | **WARNING** |

### Speed Limit Data & Matching

| Check | Result |
|-------|--------|
| Spatial grid math (200m cells, 3×3 = 600m coverage) | **PASS** |
| Distance computation (hybrid flat+Haversine) | **PASS** |
| 50m search radius well within grid coverage | **PASS** |
| Edge insertion across all touched grid cells | **PASS** |
| GOTUFLOKKUR=5 filter applied at load time | **PASS** |
| **MultiLineString parsing creates phantom edges** | **BUG** |
| No HRADI null/NaN validation | **WARNING** |
| Download script points to old Flutter path | **WARNING** |
| Intersection tie-breaking (nearest wins, no direction) | **WARNING** |

**BUG detail** — `speed-limit-service.ts` lines 131-137: `MultiLineString` geometries are flattened by concatenating all component line strings into one flat array, creating spurious edges between the last point of one component and the first point of the next. A bus GPS point near such a phantom edge gets an incorrect speed limit. **Fix**: process each component line string separately, creating edges only within each component.

---

## III. Empirical Validation

### Sample Data Analysis (`static/sample.jsonl`)

- **Records**: 35,990 lines across ~9.9 minutes
- **Unique buses**: 123 per snapshot, 25 routes
- **Time span**: 594 seconds (timestamps 1773218978000 to 1773219572000)
- **Polling consistency**: ~1 record per bus per 2s matches expected rate

**Critical finding**: The sample file contains **raw GPS data only** — no speed (`s`), speed limit (`sl`), or violation (`v`) fields. Speed calculation happens at runtime in the pipeline, not at storage time. This means pipeline output accuracy cannot be validated from stored data alone.

**GPS quality observations**:
- Stationary bus (6-A): position drift < 0.1m over 10 minutes (σ < 0.6m, consistent with empirical model)
- Moving bus (15-B): smooth trajectory, no outliers, implied ~55-65 km/h on suburban road
- Decelerating bus (12-A): clean deceleration from ~37 km/h to stop, consistent with bus stop approach
- Accelerating bus (1-B): clear transition from stationary to ~40 km/h
- No positions outside Reykjavik metro area (lat 64.04-64.17, lng -22.02 to -21.66)
- No impossible position jumps (max observed ~85m between genuine GPS updates)
- Extensive duplication (~49.8% of polls return stale positions) — handled by runtime dedup

### Speed Limit Data (`static/speed_limits.geojson`)

- **Size**: ~5.7 MB, ~10,000 street segments from Borgarvefsja ArcGIS Layer 23
- **Coverage**: Reykjavik metropolitan area (all bus routes)
- **Speed limit distribution**: 30 km/h (4,476), 50 km/h (4,795) dominate; range 1-90 km/h

**Grid validation**: 200m cells with 3×3 search = 600m coverage. The 50m search radius has a 12× safety margin — no edge can be missed. Long edges spanning multiple cells are correctly inserted into all touched cells.

### Compression Round-Trip

All serialized fields survive round-trip correctly:
- Speed: 0.1 km/h precision loss (47.3456 → 47.3) — acceptable
- Speed limit: rounded to integer — acceptable
- Match type: 'm'→'matched', 'f'→'fallback' — correct
- isViolation: false → omitted → restored as false — correct
- 5 route-constrained fields intentionally not serialized (runtime-only)

---

## IV. Accuracy Assessment

### Error Budget (σ_gps = 2.5m, median dt = 5.0s)

| True Speed | Raw Haversine | After endpoint bound | After ×0.95 | After EMA | Net Error |
|------------|---------------|---------------------|-------------|-----------|-----------|
| 10 km/h | 10.32 | 10.02 | 9.52 | 9.52 | -0.48 (-4.8%) |
| 20 km/h | 20.32 | 20.01 | 19.01 | 19.01 | -0.99 (-5.0%) |
| 30 km/h | 30.22 | 30.01 | 28.51 | 28.51 | -1.49 (-5.0%) |
| 50 km/h | 50.13 | 50.00 | 47.50 | 47.50 | -2.50 (-5.0%) |
| 70 km/h | 70.09 | 70.00 | 66.50 | 66.50 | -3.50 (-5.0%) |

At constant speed on straight roads, the endpoint bound eliminates GPS noise over 4 readings (~20s), and the dominant error source is the 0.95 conservative factor → near-constant **5% underestimate**.

On curved roads, the spline pipeline additionally underestimates due to chord vs. arc distance. For a 30° curve: ~6% total underestimate. The route-constrained pipeline avoids this (measures road distance).

**Reliability boundary**: System is reliable above ~4 km/h. Between 2-4 km/h, stationarity detection triggers intermittently. Below 2 km/h, bus is frequently classified as stationary (speed = 0). Acceptable for violation monitoring.

### False Positive Rate (Spurious Violations)

**Scenario**: Bus at exactly 50 km/h in a 50 km/h zone.

- Expected pipeline output: ~47.50 km/h
- Violation threshold: 55 km/h (limit + 5 grace)
- Gap to threshold: 7.50 km/h = ~17 standard deviations from mean
- **False positive probability: effectively ZERO** (< 10⁻⁶)

The combination of 0.95 factor, endpoint bound, EMA smoothing, and 5 km/h grace creates a ~10 km/h margin between expected output and violation threshold at any speed.

### False Negative Rate (Missed Violations)

**Detection probability vs. true speed over a 50 km/h limit:**

| True Speed | Pipeline Output | P(detected) |
|------------|----------------|-------------|
| 55 km/h | ~52.25 | ~0% |
| 56 km/h | ~53.20 | ~0% |
| 58 km/h | ~55.10 | ~64% |
| 60 km/h | ~57.00 | ~100% |

**Reliable detection (>95%)** requires true speed > limit × 1.053 + 5.46. In a 50 km/h zone: >58.4 km/h (+8.4 km/h over limit). **Dead zone** of ~7-11 km/h above the limit where violations may go undetected. This is intentional — the system prioritizes zero false positives over catching marginal violations.

**Detection delay**: ~2 readings (~10 seconds at 5s real update interval) when accelerating into violation territory due to EMA lag.

### Latency Analysis

| Stage | Delay |
|-------|-------|
| GPS → API → client | 0-6s (API cache + poll interval) |
| Buffer fill (first speed) | +5s (1 genuine reading) |
| Endpoint bound fill | +20s (4 readings) |
| EMA 95% settling | +20s (4 readings, overlaps with above) |
| Animation start | +20s (4 buffer points, overlaps with above) |
| **Cold start to accurate speed** | **~20-25s** |
| **Steady-state lag** | **~5-7s** |
| **Animation display lag** | **~10-15s behind real-time** |

Acceptable for a monitoring dashboard.

### Known Limitations

1. **GPS blackouts** (tunnels): Speed stale for up to 60s, then 20s re-warmup
2. **Bus terminals**: GPS jitter handled by stationarity detection; route-constrained may snap to wrong route
3. **Low speeds** (<4 km/h): Unreliable, intermittent stationarity; acceptable since violations irrelevant
4. **Route changes**: Route-constrained resets, spline provides continuity
5. **Fleet startup**: All buses in warmup simultaneously; ~20s of zero speeds
6. **Speed limit fallback** (50 km/h): Creates false positives on highways (real limit >50) and false negatives in pedestrian zones (real limit <50)
7. **Parallel roads**: Cross-track GPS error (P95=13.1m) can cause wrong speed limit match
8. **No EMA in route-constrained pipeline**: Higher per-reading variance than spline pipeline

---

## V. Recommendations

### Priority 1: Bugs to Fix

**1. segmentIndex not adjusted during stationary buffer trim** (spline-renderer.ts:230-232)
- **Impact**: After a long stop, animation references wrong buffer entries; bus appears frozen
- **Fix**: Add `state.segmentIndex = Math.max(0, state.segmentIndex - excess)` after the splice
- **Effort**: 1 line

**2. MultiLineString phantom edges** (speed-limit-service.ts:131-137)
- **Impact**: Spurious road segments between disconnected line string components cause incorrect speed limit matches
- **Fix**: Process each component line string separately instead of concatenating
- **Effort**: ~10 lines

### Priority 2: Data Quality

**3. Add HRADI null/NaN validation** (speed-limit-service.ts)
- **Impact**: A feature with missing HRADI produces `speedLimitKmh: NaN`, silently suppressing all violations for buses near that segment
- **Fix**: Skip features where `typeof props.HRADI !== 'number'` or `!isFinite(props.HRADI)`
- **Effort**: 2 lines

**4. Fix download script output path** (tools/download_speed_limits.dart)
- **Impact**: Re-running the script writes to the old Flutter path (`app/assets/`), not `static/`
- **Fix**: Update output path or rewrite in JS/TS for the SvelteKit stack
- **Effort**: 1 line (path fix) or ~50 lines (JS rewrite)

### Priority 3: Accuracy Improvements

**5. Add EMA smoothing to route-constrained speed** (map-matcher.ts)
- **Impact**: Route-constrained pipeline has higher per-reading variance; individual spikes could cause false violations
- **Fix**: Apply EMA (α=0.6) to route-constrained speed, matching spline pipeline behavior
- **Effort**: ~10 lines

**6. Use GPS timestamp instead of ingestion time** (spline-renderer.ts:217)
- **Impact**: Under irregular polling (tab backgrounded, network lag), speed calculations use wrong time delta
- **Fix**: Use `location.timestamp` instead of `this.getTime()` for buffer entry timestamps
- **Effort**: 1 line (but verify playback compatibility)

### Priority 4: Performance/Robustness

**7. Throttle refreshStorageInfo()** (collection.svelte.ts)
- **Impact**: Triggers 3 async calls every 2s; wasteful
- **Fix**: Call every 30s or every 15th poll cycle instead of every cycle
- **Effort**: 5 lines

**8. Guard against overlapping playback frame loads** (playback.svelte.ts)
- **Impact**: Rapid playback could queue IndexedDB reads faster than they resolve
- **Fix**: Add `isLoadingFrame` guard similar to `isCollecting` in collection store
- **Effort**: 5 lines

**9. Add decay/timeout for stale speed display** (spline-renderer.ts)
- **Impact**: When GPS stops updating, bus shows last computed speed indefinitely (up to 60s)
- **Fix**: Decay speed to 0 over ~10s when no new genuine readings arrive
- **Effort**: ~15 lines

### Not Recommended to Change

- **Flat-Earth constants** (111.0, 48.6): 0.3-0.5% low but only affect t-parameter projection; final distance uses Haversine. The error is negligible.
- **Conservative factor 0.95**: Creates a controlled 5% underestimate. Changing this shifts the false-positive/false-negative tradeoff. Current setting correctly prioritizes zero false positives.
- **5 km/h violation grace**: Combined with 0.95 factor, creates a ~7-11 km/h dead zone. This is aggressive but appropriate for a monitoring system that should never cry wolf.
- **Transient fields not serialized**: matchConfidence, snappedLat/Lng, distAlongRouteM, isNearStop are correctly treated as runtime-only values. No need to persist.
