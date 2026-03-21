# Test Suite Build — Full Implementation Prompt

Set up a complete, production-grade test suite for this SvelteKit app. Unit tests with Vitest for all core logic, and E2E smoke tests with Playwright for critical user flows. No shortcuts, no skipping edge cases, no "TODO: add more tests later". Every testable function gets tested. Every user flow gets verified.

## Phase 1: Install & Configure Test Infrastructure

### 1A. Vitest (unit/integration tests)

Install Vitest with SvelteKit integration. Configure it to:
- Resolve `$lib/*` path aliases (match `svelte.config.js`)
- Use `jsdom` environment for tests that need DOM APIs
- Use default `node` environment for pure logic tests
- Exclude `node_modules`, `.svelte-kit`, `build`
- Generate coverage reports (v8 provider) with thresholds:
  - Branches: 80%
  - Functions: 85%
  - Lines: 80%
  - Statements: 80%

Add `package.json` scripts:
- `"test"` — run all unit tests
- `"test:watch"` — watch mode
- `"test:coverage"` — with coverage report
- `"test:e2e"` — run Playwright tests

### 1B. Playwright (E2E tests)

Install `@playwright/test`. Configure it to:
- Start the Vite dev server automatically (`webServer` config)
- Use Chromium only (this is a desktop-only app)
- Set viewport to 1440x900
- Set `baseURL` to `http://localhost:5173`
- Store screenshots in `tests/e2e/screenshots/`
- 30 second timeout per test
- Retry once on failure

### 1C. File structure

```
tests/
  unit/
    utils/
      geo.test.ts
      format.test.ts
      constants.test.ts
    services/
      speed-limit-service.test.ts
      spline-renderer.test.ts
      map-matcher.test.ts
      route-animator.test.ts
      collection-service.test.ts
      straeto-api.test.ts
      storage-service.test.ts
      mock-data.test.ts
    stores/
      buses.test.ts
      stats.test.ts
    types/
      bus.test.ts
  e2e/
    app.spec.ts
    screenshots/        (gitignored)
```

---

## Phase 2: Unit Tests — Pure Utility Functions

### 2A. `tests/unit/utils/geo.test.ts` — Geospatial Math

Test `haversineDistanceM`:
- **Zero distance**: same point returns 0
- **Known distance**: Hallgrimskirkja (64.1418, -21.9268) to Harpa (64.1504, -21.9330) should be ~990-1010m
- **Antipodal points**: should return ~half Earth circumference (~20,015 km)
- **Symmetry**: `haversine(A, B) === haversine(B, A)`
- **Small distances**: two points 1m apart at Reykjavik latitude — verify within 0.5m tolerance
- **Cross-equator**: verify works for southern hemisphere coordinates

Test `pointToLineSegmentDistanceM`:
- **Point on segment**: point exactly on the line returns ~0
- **Point at endpoint A**: closest point is A, verify distance
- **Point at endpoint B**: closest point is B, verify distance
- **Perpendicular projection**: point perpendicular to midpoint of segment
- **Degenerate segment**: A === B (zero-length segment), should return distance to that point
- **Real Reykjavik segment**: use an actual segment from the speed limit data (e.g., Kleppsmyrarvegur coords from CLAUDE.md) and verify a point 20m away returns ~20m

Test `projectPointOnSegment`:
- **t parameter at start**: point closest to A returns t ≈ 0
- **t parameter at end**: point closest to B returns t ≈ 1
- **t parameter at midpoint**: point perpendicular to midpoint returns t ≈ 0.5
- **t clamped**: point beyond endpoint returns t = 0 or t = 1
- **projLat/projLng correctness**: verify projected coords lie on the segment
- **distanceM matches**: compare with `pointToLineSegmentDistanceM` for same inputs

Test `flatDistanceM`:
- **Zero distance**: same point returns 0
- **Compare with Haversine**: for short distances (<1km) at Reykjavik latitude, should agree within 1%
- **Reykjavik-specific scaling**: verify 1 degree latitude ≈ 111km, 1 degree longitude ≈ 48.6km

Test `speedKmh`:
- **Zero time**: returns 0
- **Negative time**: returns 0
- **Known conversion**: 1000m in 60s = 60 km/h
- **Small values**: 1m in 1s = 3.6 km/h
- **Large values**: 100km in 1 hour = 100 km/h

### 2B. `tests/unit/utils/format.test.ts` — Formatters

Test `formatSpeed`:
- `undefined` → `'--'`
- `null` → `'--'`
- `0` → `'0.0'`
- `45.678` → `'45.7'`
- `100` → `'100.0'`

Test `formatTime`:
- Epoch 0 → `'00:00:00'`
- Known timestamp → verify HH:mm:ss in UTC
- Midnight UTC → `'00:00:00'`

Test `formatDate`:
- Known timestamp → verify YYYY-MM-DD
- New Year → `'2026-01-01'`

Test `formatDateTime`:
- Combines time and date with space separator

Test `formatBytes`:
- `0` → `'0 B'`
- `512` → `'512 B'`
- `1024` → `'1.0 KB'`
- `1536` → `'1.5 KB'`
- `1048576` → `'1.0 MB'`
- `10485760` → `'10.0 MB'`

Test `formatElapsed`:
- `0` → `'0:00'`
- `59` → `'0:59'`
- `60` → `'1:00'`
- `3661` → `'1:01:01'`

Test `formatDistance`:
- `0.5` → `'500 m'`
- `0.001` → `'1 m'`
- `1.0` → `'1.0 km'`
- `42.3` → `'42.3 km'`

### 2C. `tests/unit/utils/constants.test.ts` — Sanity Checks

Verify key constants have expected values (guards against accidental edits):
- `POLLING_INTERVAL_MS` is 2000
- `OUTLIER_MAX_SPEED_KMH` is 90
- `CONSERVATIVE_SPEED_FACTOR` is 0.95
- `DEFAULT_SPEED_LIMIT_KMH` is 50
- `MAX_SPEED_LIMIT_SEARCH_DISTANCE_M` is 50
- `VIOLATION_GRACE_KMH` is 5
- `MAP_CENTER` is `[-21.9, 64.135]` (Reykjavik)
- `ALL_ROUTES` has expected length and includes routes '1' through '36'

---

## Phase 3: Unit Tests — Type Serialization

### 3A. `tests/unit/types/bus.test.ts`

Test `busLocationFromApi`:
- Creates correct BusLocation from API result
- Sets `isViolation` to false
- Preserves all fields
- Handles null headsign → undefined

Test `busLocationToJsonLine` / `busLocationFromJsonLine` roundtrip:
- Full roundtrip: create BusLocation → toJsonLine → fromJsonLine → compare
- Speed is rounded to 1 decimal
- Speed limit is rounded to integer
- `speedLimitMatch` maps correctly: `'matched'` ↔ `'m'`, `'fallback'` ↔ `'f'`
- Optional fields: omitted when undefined, preserved when present
- `isViolation` only written when true

Test `copyBusLocationWith`:
- Overrides specified fields
- Leaves non-overridden fields intact
- Original object is not mutated

Test `createBusLocation`:
- Sets `isViolation` to false when omitted
- Preserves `isViolation` when explicitly set

Test `validateApiResult` (via straeto-api import or direct test):
- Valid input passes
- Missing busId → null
- Non-finite lat → null
- lat out of range (-91, 91) → null
- lng out of range (-181, 181) → null
- Missing direction → null
- routeNr as number gets stringified

---

## Phase 4: Unit Tests — Core Services

### 4A. `tests/unit/services/speed-limit-service.test.ts`

Build a minimal GeoJSON fixture with 3-5 road segments at known positions around Reykjavik (use real coords from CLAUDE.md sample). Test:

**Loading:**
- `isLoaded` is false before loading, true after
- `segmentCount` matches expected edge count
- Filters out features with `GOTUFLOKKUR === 5`
- Filters out features with `HRADI <= 0` or non-numeric

**Speed limit lookup — `getSpeedLimit`:**
- **Direct match**: point 5m from a 30 km/h segment → returns 30, match='matched'
- **Closest segment wins**: point equidistant between 30 and 50 km/h segments → returns the closer one
- **Fallback**: point 100m from any segment → returns 50 (DEFAULT_SPEED_LIMIT_KMH), match='fallback'
- **Boundary**: point exactly 50m from segment → should return 'matched' (≤ threshold)
- **Boundary**: point 50.1m from segment → should return 'fallback'
- **Road name**: verify `roadName` is returned from matched segment
- **MultiLineString support**: create a feature with MultiLineString geometry, verify all sub-lines are indexed

**Spatial grid correctness:**
- Query a point far from all segments (e.g., ocean coordinates) → fallback
- Query points in different grid cells that are near segments → correct match

### 4B. `tests/unit/services/spline-renderer.test.ts`

Use a **controlled time source** (`new SplineRenderer(() => mockTime)`) to make tests deterministic.

**Ingestion pipeline:**
- **First fix**: returns BusLocation with speedKmh = 0
- **Stale detection**: feed identical coordinates twice → second returns speed decayed toward 0, not null
- **Outlier rejection**: feed two points that imply >90 km/h → resets buffer (returns speed 0)
- **Time gap reset**: feed two points 61+ seconds apart → resets buffer
- **Time reversal**: feed point with earlier timestamp → resets buffer
- **Minimum buffer**: first 3 fixes return speed 0 (warming up)
- **Speed calculation starts at fix 3**: feed 4 fixes with known positions and timestamps, verify speed is calculated with conservative factor (0.95) applied

**Speed accuracy (the core contract from CLAUDE.md):**
- Feed a sequence simulating 50 km/h movement (points 27.8m apart every 2s at Reykjavik lat). Verify computed speed is ≤ 50 km/h (conservative bias — never overestimate)
- Feed stationary points (same coords, 3+ times) → speed drops to 0
- Feed points simulating 30 km/h → verify speed is ≤ 30 km/h

**Stationarity detection:**
- Feed 3+ points within SPLINE_STATIONARY_DIST_M (3m) → `speedKmh` returns 0
- Feed 2 close points then 1 far point → stationarity resets, speed calculated

**EMA smoothing:**
- Feed alternating fast/slow segments → verify speed doesn't jump abruptly (EMA with alpha=0.6 smooths)
- First non-zero reading should seed EMA, not blend with 0

**Animation — `getAnimatedPosition`:**
- Returns null before SPLINE_MIN_BUFFER (4) points ingested
- After 4+ points and advancing mock time: returns interpolated lat/lng between confirmed positions
- **Frozen state**: advance time beyond last segment → returns isFrozen=true with last confirmed position
- **Stationary**: returns last confirmed position with isFrozen=false
- **Overshoot guard**: craft 4 points that create extreme spline curvature → verify animation falls back to linear when deviation > SPLINE_OVERSHOOT_GUARD_M (50m)
- **Segment advancement**: advance time through multiple segments → verify smooth progression

**Cleanup:**
- `cleanupStale()` removes buses not updated for 120s
- `resetBus()` clears state for specific bus
- `resetAll()` clears all state

### 4C. `tests/unit/services/map-matcher.test.ts`

Build a synthetic route polyline (e.g., an L-shaped route with 3 vertices at known Reykjavik coords). Create a mock `RouteShapeData` with vertices, cumDistM, grid, and stopDistancesM.

**Snapping:**
- **On-route point**: GPS 5m from polyline → snaps to nearest point on line, confidence='high'
- **Off-route point**: GPS 80m from polyline → confidence='off-route'
- **Low confidence**: GPS 45m from polyline → confidence='low'
- **Correct segment**: point near vertex 2 snaps to segment 1-2 or 2-3 correctly
- **distAlongRouteM**: verify cumulative distance is correct for snapped position

**Speed calculation:**
- First 3 fixes return speedKmh = null (warmup, MATCH_WARMUP_FIXES = 4)
- Fix 4+: speed calculated from distance-along-route delta with CONSERVATIVE_SPEED_FACTOR
- Outlier rejection: speed > 90 km/h → holds previous speed

**Monotonicity:**
- Forward movement along route: accepted
- Small backward movement (< MATCH_BACKWARD_TOLERANCE_M = 100m): accepted
- Large backward movement (> 100m): triggers reset and re-snap

**Stop proximity:**
- Point within STOP_PROXIMITY_M (30m) of a stop → `isNearStop = true`
- Stop-aware speed filtering: if previous speed < 5 and current > 15 near stop → holds previous speed

**Shape change:**
- Change shapeId between fixes → resets state, starts fresh
- `isOnRoute()` returns true when matched, false when off-route

### 4D. `tests/unit/services/route-animator.test.ts`

Use controlled time source. Build a simple polyline with 5 vertices and known cumDistM values.

**Ingestion:**
- First snap result initializes state, no animation yet
- After ROUTE_ANIM_MIN_BUFFER (4) ingestions → animation starts
- Buffer trimmed to ROUTE_ANIM_MAX_BUFFER (6) entries

**Animation — `getAnimatedPosition`:**
- Returns null before min buffer reached
- After buffer filled: returns lat/lng interpolated along the actual polyline geometry (not straight lines between GPS points)
- **Verify route-constrained**: animated position lies on the polyline, not cutting corners
- **Frozen state**: no new data → returns isFrozen=true at last confirmed position
- **Stationarity**: 3+ fixes with < 5m movement → returns position with isFrozen=false, speed=0

**Gap reset:**
- Time gap > ROUTE_ANIM_GAP_RESET_S (60s) → resets and re-initializes

### 4E. `tests/unit/services/collection-service.test.ts`

This is the integration point. Mock `SpeedLimitService` (with a simple getSpeedLimit stub), mock `fetchBusLocations`, and optionally mock GTFS service.

**Violation detection — `checkViolation` (test via `processFixForSimulation`):**
- **No violation**: speed 45, limit 50 → isViolation=false
- **Grace zone**: speed 53, limit 50 → isViolation=false (within 5 km/h grace)
- **Violation**: speed 56, limit 50 → isViolation=true (>5 km/h over)
- **Zero speed**: never a violation regardless of limit
- **Zone transition grace**: simulate entering a 30 zone from a 50 zone:
  - At t=0 (transition): speed 45, limit changes 50→30. Should NOT violate (grace period active, effective limit ramping from 50 to 30)
  - At t=4s (mid-grace): speed 40, effective limit ≈ 40. Should NOT violate
  - At t=8s (grace expired): speed 40, limit 30. Should violate (40 > 30+5)
- **Already speeding before zone change**: speed 60 in a 50→30 transition. Should violate immediately (60 > 50+5, exceeded even the old limit)
- **Zone increase**: limit goes from 30→50, no grace period needed, transition cleared
- **Cascading drops**: 80→50→30. Grace keeps highest prevLimit (80), ramp covers full deceleration

**Deduplication:**
- Same timestamp for same bus → skipped
- Different timestamp → processed

**Route/direction change:**
- Bus changes from route 1 direction 0 to route 1 direction 1 → map matcher and route animator reset

**Bus reset:**
- `resetBus()` clears all state for that bus
- `resetAll()` clears everything
- `cleanupStale()` removes expired transitions

### 4F. `tests/unit/services/straeto-api.test.ts`

Mock `globalThis.fetch` to test the API client without hitting the real API.

**Success path:**
- Valid GraphQL response → parses correctly, returns [timestamp, BusLocation[]]
- Validates each result: invalid entries are silently skipped
- Timestamp parsed from `lastUpdate` string

**Error handling:**
- HTTP 500 → throws StraetoApiError
- GraphQL errors in response → throws StraetoApiError
- Missing `data` field → throws StraetoApiError
- Missing `BusLocationByRoute` → throws StraetoApiError
- Missing `lastUpdate` → throws StraetoApiError
- Invalid timestamp string → throws StraetoApiError
- Missing `results` → throws StraetoApiError

**Validation edge cases (`validateApiResult`):**
- Empty busId → null
- Non-string routeNr (number) → accepted, stringified
- Non-finite lat (NaN, Infinity) → null
- lat = -91 or 91 → null
- lng = -181 or 181 → null
- Missing direction → null

### 4G. `tests/unit/services/storage-service.test.ts`

Use `fake-indexeddb` (install it) to test IndexedDB operations in Node.

- **Open**: creates database and object store with indexes
- **Store + retrieve**: `storeBatch` then `getLocationsInRange` → roundtrip works
- **Time range**: `getTimeRange` returns correct [min, max] timestamps
- **Record count**: `getRecordCount` returns correct count
- **Clear all**: `clearAll` empties the store
- **Import JSONL**: valid lines imported, invalid lines skipped, returns correct count
- **Import validation**: missing required fields (b, r, la, ln, ts) → line skipped
- **Import size limit**: text > 100MB → throws error
- **Export JSONL**: `exportJsonl` returns correct JSONL text
- **Bus history**: `getBusHistory` filters by busId and time window
- **Streaming**: `getAllLocationsStream` yields batches of correct size
- **Write lock**: concurrent `storeBatch` calls don't corrupt data

### 4H. `tests/unit/services/mock-data.test.ts`

- `ensureSampleLoaded` fetches `/sample.jsonl` (mock the fetch)
- `generateMockData` returns empty array before loading
- After loading: returns snapshot arrays with rebased timestamps
- `resetMockData` resets index to 0
- Loops back to beginning when snapshots exhausted

---

## Phase 5: Unit Tests — Stores

### 5A. `tests/unit/stores/buses.test.ts`

Note: Svelte 5 runes (`$state`, `$derived`) won't work in plain Vitest. Test the pure logic functions exported from the module. For the class methods, instantiate `BusStore`-like logic without runes (extract testable logic or test the exported functions).

Test exported functions:
- `getBusStatus`: violation/approaching/normal/nodata based on speed vs limit
- `getStatusColor`: correct hex color for each status

Test bus store logic (may need to test via the exported singleton or extract logic):
- `updateBuses` merge mode: adds new buses, updates existing, removes stale (>30s old)
- `updateBuses` replace mode: replaces entire map
- `liveHistory` accumulation: caps at 10,000 entries
- `selectBus` / `selectedBus`: select and retrieve
- `routeFilter`: filters activeBuses correctly
- `averageSpeed`: correct calculation, excludes speed=0
- `violationCount`: counts correctly
- `availableRoutes`: sorted numerically
- `onBusStale` callback: fired when stale bus removed

### 5B. `tests/unit/stores/stats.test.ts`

Test `computeFromArray` with crafted BusLocation arrays:
- **Top speeders**: sorted by violations desc, then maxSpeed desc, limited to 10
- **Route stats**: violations, average speed, record count per route
- **Hourly violations**: correct hour bucketing (UTC)
- **Speed distribution**: correct bucket assignment (0, 1-10, 11-20, ..., 81+)
- **Total distance**: estimated from speed × time delta
- **Edge cases**: empty array, single record, all violations, no violations

---

## Phase 6: E2E Tests with Playwright

### 6A. `tests/e2e/app.spec.ts`

**App initialization:**
- Page loads without errors (no console errors)
- Loading screen appears with progress bar
- App initializes and shows Dashboard (loading screen disappears)
- Screenshot: `01-app-loaded.png`

**Mode switching:**
- Click each mode tab (Live, Playback, Stats, Heatmap)
- Verify sidebar content changes per mode
- Verify playback bar appears only in Playback mode
- Screenshot each mode: `02-mode-live.png`, `03-mode-playback.png`, `04-mode-stats.png`, `05-mode-heatmap.png`

**Keyboard shortcuts:**
- Press `1` through `4` → modes switch
- Press `b` → sidebar toggles
- Press `Escape` → bus deselected

**Simulation mode:**
- Navigate to Live mode
- Click "Simulate" button in sidebar
- Wait for bus markers to appear on map (poll via `page.evaluate`)
- Verify KPI cards update (active buses > 0)
- Screenshot: `06-simulation-running.png`

**Stats with data:**
- Start simulation, wait for data accumulation (few seconds)
- Switch to Stats mode
- Verify charts render (chart containers have non-zero height)
- Verify summary cards show non-zero values
- Screenshot: `07-stats-with-data.png`

**Heatmap mode:**
- Switch to Heatmap mode during simulation
- Verify violation count gauge renders
- Screenshot: `08-heatmap-mode.png`

**Playback mode (if data exists):**
- Switch to Playback mode
- Verify timeline bar appears at bottom
- Verify play/pause button exists
- Screenshot: `09-playback-mode.png`

---

## Phase 7: CI Integration

Add a GitHub Actions workflow `.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npm test
      - run: npm run test:coverage

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: e2e-screenshots
          path: tests/e2e/screenshots/
```

---

## Implementation Rules

1. **Write real assertions, not just "it doesn't crash"**. Every test should assert a specific expected value.
2. **Use `describe` blocks** to group related tests. Use clear test names: `it('returns fallback speed limit when no segment within 50m')`.
3. **No `any` types** in test code. Type the fixtures and expected values.
4. **Reusable test fixtures**: create helper functions for common BusLocation objects, GeoJSON features, and route shape data. Put these in `tests/fixtures/`.
5. **Deterministic tests**: mock `Date.now()`, use controlled time sources for SplineRenderer/MapMatcher/RouteAnimator. No flaky timing-dependent tests.
6. **Test the contract, not the implementation**: verify public API behavior, not internal state.
7. **Run the full suite** after writing each test file. Fix any failures before moving to the next file.
8. **Verify the build still passes**: `npm run build` and `npm run check` must succeed after all changes.
9. **Every test must actually run and pass.** Do not write tests that you haven't verified. After writing each file, run the tests for that file, fix any issues, and only then move on.
10. **Keep $lib path aliases working.** The Vitest config must resolve `$lib` to `src/lib` exactly as SvelteKit does.
11. **For Svelte 5 rune-based stores** (`$state`, `$derived`): these won't work in plain Vitest. Either test the exported pure functions directly, or test store logic by extracting the computation into plain functions. Do NOT try to make runes work in Node — test the logic, not the reactivity.
12. **For IndexedDB tests**: install and use `fake-indexeddb` to provide an in-memory IDB implementation.

## Verification

When done, run:
1. `npm test` — all unit tests pass
2. `npm run test:coverage` — coverage meets thresholds
3. `npm run test:e2e` — all E2E tests pass with screenshots generated
4. `npm run build` — production build succeeds
5. `npm run check` — TypeScript/Svelte checks pass

Take a screenshot of the final test results showing all tests passing.
