# Spec: 2-Minute Buffer Pipeline Redesign

## Overview

Redesign the data collection and display pipeline to operate with a **2-minute intentional delay**. Instead of showing data in near-real-time and fighting GPS noise reactively, we collect 2 minutes of data before displaying anything, then continuously maintain a 2-minute buffer ahead of what's shown. This transforms the system from a reactive, uncertain real-time pipeline into a confident post-processing pipeline.

## Goals

1. **Accuracy**: Speed values shown are ones we'd stand behind — post-processed, filtered, verified
2. **Smooth UI**: Bus markers move forward only, no backtracking, no teleporting, buttery 60fps
3. **Simplicity**: Remove defensive warmup/edge-case code that exists because we currently display from the first poll
4. **Fun loading experience**: 2-minute warmup becomes a themed loading sequence instead of a jarring blank screen

## Design Principles

- A bus **never moves backwards** on the map. If a GPS point suggests it did, that point is wrong.
- Speed is calculated from a **cleaned, monotonic trajectory**, not raw GPS deltas.
- The 2-minute delay is a **design choice**, not a compromise. Users are watching speed data, not catching a bus.
- Process first, display second. The display pipeline consumes **finished data**, not work-in-progress.

---

## Architecture: Before vs After

### Current Architecture (Reactive)

```
API Poll (every 2s)
  → processBusFix() immediately
    → MapMatcher/SplineRenderer calculate speed reactively
    → Warmup guards (4 fixes before speed emitted)
    → EMA smoothing reacts to each new point
    → busStore updated → UI renders immediately
    → Animation interpolates between last 2-8 points
```

**Problems**:
- First 8-10 seconds show no speed (warmup)
- GPS glitches visible before filter catches them
- Animation can go backwards on stale readings
- Two animation systems (RouteAnimator + SplineRenderer) with complex fallback logic
- Ghost dot reveals raw position ahead of animated position
- Speed graph shows reactive EMA — jittery on noisy data

### New Architecture (Post-Processing with 2-Minute Buffer)

```
API Poll (every 2s)
  → Raw readings stored in RingBuffer (per-bus)
  → Buffer always holds ~2 minutes of unprocessed GPS data ahead of display cursor

Display Pipeline (runs at display cursor time, 2 minutes behind real-time):
  → Take all raw readings in window around display time
  → Clean: remove stale duplicates, reject outliers with full context
  → Monotonic enforcement: ensure distAlongRoute only increases
  → Calculate speed from cleaned trajectory (both directions available)
  → Speed limit lookup on cleaned position
  → Violation detection with full context window
  → Emit finished BusLocation to busStore → UI renders

Animation (60fps):
  → Interpolate between consecutive cleaned positions
  → Always forward, always smooth
  → No warmup — buffer was pre-filled during loading screen
```

---

## Real API Cadence Data

These numbers (from our own data analysis) drive the buffer sizing decisions:

| Metric | Value | Source |
|--------|-------|--------|
| API poll interval | 2 seconds | Our polling config |
| Per-bus genuine update median | 5.0 seconds | `docs/analysis/01-temporal-patterns.md` |
| Per-bus genuine update P75 | 6.0 seconds | Same |
| Per-bus genuine update P90 | 7.0 seconds | Same |
| Per-bus genuine update P95 | 12.0 seconds | Same |
| Stale reading rate | 48.1% | Same |
| Bus 31-B outlier median | 25.0 seconds | Same |
| Fleet size midday | ~90 buses | Same |
| Fleet size afternoon rush | ~125 buses | Same |

**Why 2 minutes**: To get 6-8 genuine position changes for confident speed calculation:
- Median bus (5s updates): ~24 genuine points in 2 min — excellent
- P90 bus (7s updates): ~17 genuine points — great
- P95 bus (12s updates): ~10 genuine points — solid
- Worst buses (~25s updates): ~5 genuine points — workable

A 30-second buffer would only give P95 buses 2-3 genuine points — not enough.

---

## Component Design

### 1. Loading Screen (New Component)

**When**: Shown for 2 minutes after user clicks "Start Recording" / "Start Monitoring" / "Start Simulation"

**What happens behind the scenes**:
- Polling starts immediately (2s intervals)
- Raw GPS data accumulates in per-bus ring buffers
- GTFS shapes, speed limits, route indices all load/warm up
- After 2 minutes: enough data for even the slowest buses to have confident speed calculation

**UI — Bus-themed loading sequence**:
- Phases progress automatically over ~2 minutes
- Each phase shows a fun illustration/icon and message:

| Time | Phase | Message |
|------|-------|---------|
| 0-10s | Depot | "Opening the depot gates..." |
| 10-20s | Fueling | "Fueling up the bus..." |
| 20-35s | Coffee | "Driver getting coffee..." |
| 35-50s | Engine | "Warming up the engine..." |
| 50-65s | Inspection | "Pre-trip inspection..." |
| 65-80s | Mirrors | "Checking the mirrors..." |
| 80-95s | Passengers | "Picking up the first passengers..." |
| 95-110s | Route | "Planning today's route..." |
| 110-120s | Depot | "Pulling out of the depot..." |

- Progress bar or progress ring underneath
- Subtle animation (e.g., fuel gauge filling, steam rising from coffee cup)
- Can be CSS/SVG animations — doesn't need to be complex

**File**: `src/lib/components/LoadingScreen.svelte` (new)

**Store integration**: `collectionStore` gains `warmupProgress` (0-1) and `isWarmedUp` (boolean) state.

---

### 2. Raw Ring Buffer (New Service)

**Purpose**: Store raw, unprocessed GPS readings per bus in a time-ordered ring buffer.

**File**: `src/lib/services/raw-buffer.ts` (new)

```typescript
interface RawReading {
  busId: string;
  routeNr: string;
  tripId: string;
  lat: number;
  lng: number;
  direction: number;
  timestamp: number;         // API timestamp
  headsign?: string;
  nextStops?: NextStop[];
  gtfsDirectionId?: number;
  isStale: boolean;          // GPS position unchanged from previous reading
}

interface BusBuffer {
  readings: RawReading[];    // Time-ordered, oldest first
  lastRawLat: number;        // For stale detection at ingest
  lastRawLng: number;
}

class RawBuffer {
  private buffers: Map<string, BusBuffer>;

  // Add new reading from API (called every 2s per bus)
  ingest(reading: RawReading): void;

  // Get all readings for a bus in a time window
  getWindow(busId: string, startMs: number, endMs: number): RawReading[];

  // Get all bus IDs that have data
  getActiveBusIds(): string[];

  // Remove readings older than cutoff
  prune(cutoffMs: number): void;

  // Clear a specific bus (route change, stale)
  clearBus(busId: string): void;

  // Total reading count across all buses
  get totalReadings(): number;
}
```

**Buffer sizing** (based on real API cadence data):
- Keep ~150 seconds of data per bus (120s display delay + 30s lookback for cleaning context)
- At 2s polling: ~75 raw readings per bus max
- Of which ~50% are stale (same position) → ~38 genuine readings per bus
- With ~90-125 active buses: ~7,500-9,400 readings total — trivial memory (~2-3 MB)

**Stale detection at ingest**:
- If `haversineDistanceM(newPos, lastRawPos) < 1m`: mark as stale (don't discard — keep for gap detection)
- Store raw regardless — cleaning happens in the processing step

---

### 3. Trajectory Cleaner (New Service)

**Purpose**: Take a window of raw readings for one bus and produce a clean, monotonic trajectory.

**File**: `src/lib/services/trajectory-cleaner.ts` (new)

```typescript
interface CleanedPoint {
  lat: number;
  lng: number;
  timestamp: number;
  distAlongRouteM: number;    // Monotonically increasing (route-matched)
  snappedLat: number;         // Position on route polyline
  snappedLng: number;
  isGenuine: boolean;         // True if GPS actually moved
  isNearStop: boolean;
  matchConfidence: MatchConfidence;
}

interface CleanedTrajectory {
  busId: string;
  routeNr: string;
  points: CleanedPoint[];     // Time-ordered, monotonic distAlongRoute

  // Speed at any timestamp (interpolated from cleaned points)
  speedAtTime(timestamp: number): number;

  // Position at any timestamp (interpolated along route)
  positionAtTime(timestamp: number): { lat: number; lng: number };
}
```

**Cleaning steps** (applied to a window of ~40-75 raw readings, ~20-38 genuine after dedup):

1. **Deduplicate stale readings**: Group consecutive readings at same position. Keep first and last of each cluster (preserves timing for "bus was stopped" detection).

2. **Route snap all points**: Use MapMatcher to snap each reading to the GTFS polyline. Get `distAlongRouteM` for each.

3. **Outlier rejection with context**: A point is an outlier if:
   - Its snapped position jumps > 500m from neighbors on either side
   - Speed implied between it and neighbors exceeds 90 km/h
   - It snaps with `off-route` confidence while neighbors are `high`
   - **Key difference from current**: We can look at points AFTER the suspect point. No guessing.

4. **Monotonic enforcement**:
   - After removing outliers, ensure `distAlongRouteM` is strictly non-decreasing
   - If a point has lower distance than its predecessor: remove it (GPS jitter caused backward snap)
   - Result: bus only ever moves forward on its route

5. **Stationarity detection**:
   - If distance hasn't changed by > 3m for 3+ consecutive genuine readings: bus is stopped
   - Mark these points so speed = 0 during this period

6. **Fallback path** (no GTFS shape):
   - Skip route snapping, use raw lat/lng
   - Monotonic enforcement via cumulative haversine distance
   - Same outlier rejection using haversine speed between neighbors

**Output**: A `CleanedTrajectory` with guaranteed forward-only movement and interpolation methods.

---

### 4. Speed Calculator (Replaces MapMatcher speed + SplineRenderer speed)

**Purpose**: Calculate speed from a cleaned trajectory, not from raw GPS deltas.

**Integrated into trajectory-cleaner.ts** (method on CleanedTrajectory):

```typescript
speedAtTime(timestamp: number): number {
  // Find the two cleaned points bracketing this timestamp
  // Speed = deltaDistance / deltaTime from the cleaned trajectory
  // Apply conservative factor (0.95)
  // Apply EMA smoothing across consecutive calls
  // Near stops: decay toward 0
}
```

**Key differences from current**:
- No warmup period needed — trajectory already has multiple points
- No outlier rejection at speed level — outliers already removed from trajectory
- Speed computed from **cleaned distance**, not raw GPS jumps
- Can use centered window (points before AND after) for smoother results
- EMA seeding is trivial — we have enough history

**Speed calculation method**:
- For each cleaned point, compute speed as `(dist[i] - dist[i-1]) / (time[i] - time[i-1]) * 3.6 * 0.95`
- Apply Gaussian-weighted average over ±3 neighboring points (7-point window when available)
- With 2-minute buffer: median bus has ~24 genuine points → plenty for 7-point windowed average
- Even P95 buses (12s cadence) have ~10 points → 7-point window still works
- This is much smoother than single-point EMA because we have full context
- Clamp to 0 when stationary

---

### 5. Display Cursor (New concept in CollectionStore)

**Purpose**: Track the "display time" — always 2 minutes behind real time.

```typescript
// In collectionStore
let displayCursorMs = $state(0);       // Current display time
let realTimeOffsetMs = 120_000;         // 2-minute delay

// On each frame tick (60fps):
displayCursorMs = Date.now() - realTimeOffsetMs;
```

**The display cursor drives everything**:
- Which cleaned trajectory points to show
- What speed to display
- Where the bus marker should be
- What the speed graph plots

**Playback mode**: Display cursor is controlled by playback transport instead of `Date.now()`.

---

### 6. Revised Collection Pipeline

**File**: `src/lib/services/collection-service.ts` (major refactor)

**Current flow** (to be replaced):
```
collectOnce() → processBusFix() per bus → speed calc → violation → emit
```

**New flow**:
```
// Called every 2s by polling timer
ingestPoll(timestamp, rawBuses):
  for each bus:
    rawBuffer.ingest(reading)

// Called every 2s (offset from ingest, or same tick)
processFrame(displayCursorMs):
  for each bus with data:
    window = rawBuffer.getWindow(busId, displayCursorMs - 30000, displayCursorMs + 30000)
    trajectory = trajectoryCleaner.clean(window, shapeData)

    position = trajectory.positionAtTime(displayCursorMs)
    speed = trajectory.speedAtTime(displayCursorMs)
    speedLimit = speedLimitService.getSpeedLimit(position.lat, position.lng)
    violation = checkViolation(speed, speedLimit, ...)

    emit BusLocation { ...position, speed, speedLimit, violation }

  busStore.updateBuses(locations)
  if recording: storageService.storeBatch(locations)
```

**Key changes**:
- `ingestPoll()` and `processFrame()` are **decoupled**. Ingest runs at API cadence, display runs at its own cadence.
- No per-fix speed calculation. Speed comes from the cleaned trajectory.
- No warmup guards. The 2-minute loading screen ensures buffers are full before `processFrame()` ever runs.
- Window is ±30s around display cursor: 30s lookback for context, 30s lookahead (available because we're 2 min behind real-time). This gives the cleaner ~12-24 genuine points per bus to work with.

---

### 7. Revised Animation System

**Current**: Two parallel animators (RouteAnimator + SplineRenderer) with complex fallback.

**New**: Single unified animator that consumes cleaned trajectory data.

**File**: `src/lib/services/display-animator.ts` (new, replaces route-animator.ts + spline-renderer.ts animation logic)

```typescript
class DisplayAnimator {
  // Store the latest cleaned trajectory per bus
  updateTrajectory(busId: string, trajectory: CleanedTrajectory): void;

  // Called at 60fps by MapView
  getPosition(busId: string, displayTimeMs: number): AnimatedPosition | null;
}

interface AnimatedPosition {
  lat: number;
  lng: number;
  bearing: number;      // Derived from trajectory direction
  speedKmh: number;     // From trajectory
  isFrozen: boolean;    // No recent data
}
```

**How it works**:
- `getPosition()` calls `trajectory.positionAtTime(displayTimeMs)`
- Position is interpolated along the cleaned route polyline (or cleaned spline for fallback)
- Since the trajectory is monotonic and cleaned, interpolation is trivial and always smooth
- Bearing derived from direction of travel on the cleaned trajectory
- No need for Catmull-Rom splines — the cleaned trajectory points, interpolated along the GTFS polyline, are already smooth

**For non-route-matched buses**:
- Cleaned trajectory still has monotonic positions
- Interpolate linearly between consecutive cleaned points
- Could optionally fit a Catmull-Rom for visual smoothness, but the points are already clean so linear may suffice

---

### 8. Revised busStore Updates

**Current**: `updateBuses()` receives raw-ish data with speed already calculated per-fix.

**New**: `updateBuses()` receives fully processed frames at display cursor time.

**Changes to `buses.svelte.ts`**:
- No change to interface — still receives `BusLocation[]`
- `liveHistory` accumulation works the same
- Stale detection threshold increases: since display is 2 min behind, a bus is "stale" if its last raw reading is > 3 min old (2 min buffer + 1 min grace)
- `hoveredHistoryPoint` and ghost dot behavior unchanged

---

### 9. Revised Speed Graph

**Current**: Resamples `liveHistory` to 2s grid, shows reactive EMA speeds.

**New**: Shows post-processed speeds from cleaned trajectories. Data is inherently smoother.

**Changes to `SpeedGraph.svelte`**:
- Minimal code changes — it already consumes `busStore.liveHistory`
- The data it receives is now pre-cleaned, so:
  - No more brief zero-blip filtering needed (cleaned trajectory handles this)
  - No more jittery lines from GPS noise
  - Speed line will be naturally smooth
- "Live" badge now means "2 minutes behind real-time" — user doesn't notice

---

### 10. Violation Detection

**Current**: Reactive, per-fix, with zone transition ramp.

**New**: Same logic, but operating on cleaned data with full context.

**Changes**:
- Zone transition grace period logic stays the same (8s ramp)
- Input speed is now from cleaned trajectory — more reliable
- Can optionally look ahead in the buffer: "is the bus about to enter a new speed zone?" and pre-compute the transition
- Route 31 suppression stays
- Violation confidence is higher because the speed feeding into the check is post-processed

---

## Files Affected

### New Files
| File | Purpose |
|------|---------|
| `src/lib/components/LoadingScreen.svelte` | Fun 2-minute warmup UI |
| `src/lib/services/raw-buffer.ts` | Per-bus ring buffer for raw GPS readings |
| `src/lib/services/trajectory-cleaner.ts` | Clean raw readings into monotonic trajectory |
| `src/lib/services/display-animator.ts` | Unified 60fps position interpolation |

### Major Refactors
| File | Changes |
|------|---------|
| `src/lib/services/collection-service.ts` | Split into ingest + processFrame, remove per-fix speed calc |
| `src/lib/stores/collection.svelte.ts` | Add warmup state, display cursor, loading lifecycle |
| `src/lib/components/MapView.svelte` | Use new DisplayAnimator, remove dual-animator logic |
| `src/lib/components/LivePanel.svelte` | Integrate loading screen trigger |

### Minor Updates
| File | Changes |
|------|---------|
| `src/lib/stores/buses.svelte.ts` | Adjust stale threshold (30s → 180s) |
| `src/lib/components/SpeedGraph.svelte` | Remove zero-blip filtering (no longer needed) |
| `src/lib/components/Dashboard.svelte` | Show LoadingScreen during warmup |
| `src/lib/utils/constants.ts` | Add `DISPLAY_DELAY_MS = 120000`, `WARMUP_DURATION_MS = 120000` |

### Potentially Removable
| File | Reason |
|------|--------|
| `src/lib/services/route-animator.ts` | Replaced by DisplayAnimator |
| `src/lib/services/spline-renderer.ts` | Speed calc moves to trajectory-cleaner, animation to DisplayAnimator |

**Note**: `map-matcher.ts` is **kept** — it's still used by trajectory-cleaner for route snapping. But its speed calculation logic (`emaSpeedKmh`, `fixCount` warmup) is no longer used. The snap functionality (`snap()` → `SnapResult` with `distAlongRouteM`, `snappedLat/Lng`, `matchConfidence`) remains essential.

---

## Data Flow Diagram (New)

```
Straeto GraphQL API (2s polling)
  │
  v
RawBuffer (per-bus ring buffers, ~150s of raw readings each)
  │
  │  [2-minute delay]
  │
  v
TrajectoryCleaner (takes ±30s window around display cursor)
  ├── Dedup stale readings
  ├── Route-snap all points (via MapMatcher.snap())
  ├── Outlier rejection (with lookahead context)
  ├── Monotonic enforcement (forward-only distance)
  ├── Stationarity detection
  └── Speed calculation (Gaussian-weighted, from cleaned distances)
  │
  v
CollectionService.processFrame()
  ├── Speed limit lookup (on cleaned/snapped position)
  ├── Violation detection (with zone transition ramp)
  └── Emit BusLocation[]
  │
  v
busStore.updateBuses()
  │
  ├──> MapView (60fps via DisplayAnimator)
  │     └── Interpolates between cleaned points
  │         Always forward, always smooth
  │
  ├──> SpeedGraph (from liveHistory)
  │     └── Naturally smooth data, no post-filtering needed
  │
  ├──> BusList, ViolationFeed, KPIs
  │
  └──> StorageService (if recording)
```

---

## Warmup / Loading Lifecycle

```
User clicks "Start Recording"
  │
  v
[Phase 1: Warmup — 2 minutes]
  ├── LoadingScreen shown (fun bus-themed phases)
  ├── Polling starts immediately (2s intervals → ~60 polls)
  ├── RawBuffer accumulates data (~38 genuine readings per bus at median cadence)
  ├── collectionStore.isWarmedUp = false
  ├── collectionStore.warmupProgress = 0..1
  │
  v
[Phase 2: First Frame]
  ├── LoadingScreen fades out
  ├── Map + UI revealed
  ├── processFrame() runs for first time at displayCursorMs
  ├── All buses appear simultaneously with smooth animation
  ├── Speed graph starts with 2 minutes of history already plotted
  │
  v
[Phase 3: Steady State]
  ├── Every 2s: ingestPoll() adds new raw data
  ├── Every 2s: processFrame() at displayCursorMs (= now - 120s)
  ├── displayCursorMs advances with wall clock
  ├── RawBuffer.prune() removes data older than displayCursor - 30s
  ├── UI always has smooth, confident data
```

---

## Playback Mode Integration

The 2-minute buffer concept maps cleanly to playback:

- **Live mode**: `displayCursorMs = Date.now() - 120000`
- **Playback mode**: `displayCursorMs = playbackStore.currentTimestamp`
- Both modes call the same `processFrame(displayCursorMs)` with the same trajectory cleaning

For playback, the RawBuffer is pre-loaded from IndexedDB instead of from live polling.

---

## Edge Cases

### Bus appears mid-session
- First reading enters RawBuffer
- Won't appear on map until 2 minutes of data accumulated for that bus
- This is fine — bus wasn't visible during warmup anyway, same experience

### Bus disappears
- No new readings → buffer ages out
- Display shows bus at last known cleaned position
- After 3 minutes of no new data (2 min delay + 1 min grace): mark stale, fade out, remove

### Route change mid-buffer
- Detected when `routeNr:directionId` changes in raw readings
- Split the buffer at the route change point
- Clear trajectory cleaner state for that bus
- Bus may briefly disappear and reappear on new route (acceptable)

### Very slow bus (stopped at terminal)
- Stale readings cluster at same position
- Trajectory cleaner marks as stationary, speed = 0
- Animation holds position (no jitter)

### Simulation mode
- Sample data pre-loaded into RawBuffer
- Same 2-minute warmup applies (or shorter if sample data covers enough time to pre-fill)

---

## Constants (New/Changed)

```typescript
// New
DISPLAY_DELAY_MS = 120_000         // Display cursor offset from real-time (2 minutes)
WARMUP_DURATION_MS = 120_000       // Loading screen duration (2 minutes)
RAW_BUFFER_RETENTION_MS = 150_000  // How long to keep raw readings (2.5 minutes)
CLEANING_WINDOW_MS = 60_000        // Total window for trajectory cleaning (±30s around cursor)
CLEANING_LOOKBACK_MS = 30_000      // How far behind display cursor for context
CLEANING_LOOKAHEAD_MS = 30_000     // How far ahead of display cursor for context

// Changed
STALE_THRESHOLD_MS = 180_000       // Was ~30s, now 3 min (accounts for 2 min delay + 1 min grace)

// Potentially removable
SPLINE_MIN_BUFFER                  // Warmup handled by loading screen
SPLINE_MAX_BUFFER                  // Replaced by RawBuffer sizing
MATCH_WARMUP_FIXES                 // No per-fix warmup needed
ROUTE_ANIM_MIN_BUFFER              // Replaced by DisplayAnimator
ROUTE_ANIM_MAX_BUFFER              // Same
```

---

## Migration Strategy

### Phase 1: Raw Buffer + Loading Screen
- Implement `RawBuffer` and `LoadingScreen`
- Wire polling to feed RawBuffer during warmup
- Show loading screen for 2 minutes, then hand off to existing pipeline
- **No behavior change yet** — just adds the warmup experience

### Phase 2: Trajectory Cleaner
- Implement `TrajectoryCleaner` with route snapping and monotonic enforcement
- Run in parallel with existing speed pipeline for validation
- Compare cleaned speeds vs current EMA speeds in dev tools

### Phase 3: Display Pipeline Switch
- Replace `processBusFix()` with `processFrame()` using cleaned trajectories
- Implement `DisplayAnimator` to replace RouteAnimator + SplineRenderer animation
- Speed graph now fed by cleaned data

### Phase 4: Cleanup
- Remove old SplineRenderer (speed calc + animation portions)
- Remove RouteAnimator entirely
- Simplify MapMatcher (keep snap, remove speed calc / warmup)
- Remove warmup guards and edge-case code from collection-service
- Update tests

---

## Success Criteria

1. **No backward movement**: Bus markers never visually move backwards on the map
2. **Smooth speed graph**: No sudden spikes, dips, or zero-blips from GPS noise
3. **Accurate violations**: Violations flagged with high confidence from cleaned data
4. **Fun loading**: Users enjoy the 2-minute warmup instead of seeing a broken first minute
5. **Simpler codebase**: Fewer edge cases, fewer warmup guards, one animation system
6. **Same or better performance**: 60fps maintained, memory usage reasonable

---

## Implementation Status (2026-03-21)

### Completed

All four phases have been implemented:

- **Phase 1**: RawBuffer + LoadingScreen — implemented and wired
- **Phase 2**: TrajectoryCleaner — implemented with all 7 cleaning steps
- **Phase 3**: Full pipeline switch — CollectionService refactored, DisplayAnimator replacing old animators
- **Phase 4**: Tests rewritten (363 passing), old services marked as legacy

### Post-Implementation Fixes

Three critical bugs found and fixed after initial implementation:

1. **Roundabout snap ambiguity**: Added `snapStatelessNear()` for sequential snap continuity. Prevents jumping across opposite sides of roundabouts (which are ~50-100m apart in route distance).

2. **2000 km/h speed spikes**: Outlier rejection changed from AND→OR logic. Added hard speed clamp at 90 km/h at three pipeline levels (raw calculation, Gaussian output, processFrame emission).

3. **Jerky stop/start speed**: Added `isStationary` flag. `speedAtTime()` returns 0 during stopped periods with sharp ramps at transitions. Gaussian smoothing respects stop boundaries.

### Server-Interpolated GPS Tuning

Constants adjusted after discovering the API serves server-interpolated positions (not raw GPS):

- `CONSERVATIVE_SPEED_FACTOR`: 0.95 → 0.92 (accounts for corner-cutting + timing uncertainty)
- `OUTLIER_JUMP_M`: 500 → 300 (server smoothing means smaller jumps are suspicious)
- `GAUSSIAN_HALF_WINDOW`: ±3 → ±2 (server already smoothed; less double-smoothing needed)
- `SNAP_CONTINUITY_MAX_JUMP_M`: 150 → 100 (tighter for roundabouts)
- Removed 10s intermediate stale points (cached API repeats add no information)
