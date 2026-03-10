# Straeto Speedometer

> **Note:** Everything below is reference material from a previous implementation. All design decisions (tech stack, architecture, storage, etc.) will be made fresh for the new build. This documentation exists solely as context — the API endpoints, data structures, and domain knowledge are useful, but nothing here is prescriptive.

## Project Goal

Real-time bus speed monitoring system for Reykjavík's public bus system (Straeto). The system:
- Tracks all Straeto bus GPS locations in real-time
- Calculates bus speeds from consecutive GPS positions using the Haversine formula
- Compares speeds against OpenStreetMap speed limits to detect violations
- Visualizes bus positions on an interactive map with historical time-travel playback

## Data Sources

### Straeto GraphQL API
- **Endpoint**: `https://api.straeto.is/graphql`
- **Query**: `BusLocationByRoute` via persisted query
- **SHA256 Hash**: `8f9ee84171961f8a3b9a9d1a7b2a7ac49e7e122e1ba1727e75cfe3a94ff3edb8`
- **Introspection is disabled** — the schema (`straeto_graphql_schema.graphql`) was inferred from usage
- **Polling interval**: Every 1 second
- **Routes queried**: All routes returned by the API (not hardcoded)
- **Response fields**: `busId`, `tripId`, `routeNr`, `lat`, `lng`, `direction`, `headsign`, `lastUpdate`

### Reykjavík City Map — Speed Limit Data (Borgarvefsja)

Official speed limit data from Reykjavík city, served via a public ArcGIS REST API.

**API Base URL**: `https://borgarvefsja.reykjavik.is/arcgis/rest/services/Borgarvefsja/Borgarvefsja_over/MapServer`

**Layer 23 — Götur-miðlínur (Street Centerlines)**:
- **Query endpoint**: `.../MapServer/23/query`
- **Total features**: 9,997 street segments
- **No authentication required**
- **Max records per request**: 2,000 (pagination via `resultOffset`)
- **Output formats**: JSON, GeoJSON, PBF
- **Native coordinate system**: WKID 3057 (ISN93), reprojectable to WGS84 via `outSR=4326`

**Fields**:
| Field | Description | Example |
|---|---|---|
| `OBJECTID` | Unique ID | `25081812` |
| `NAFN` | Street name | `"Kleppsmyrarvegur"` |
| `HRADI` | Speed limit (km/h) | `30` |
| `VEGNR` | Road number | `"0707"` |
| `GOTUFLOKKUR` | Street category (numeric) | `2` |
| `STEFNA` | Driving direction | `2` |
| `SVF` | Municipality code | `"0000"` |
| `EIGANDI` | Owner (numeric) | `1` |
| `UMFERDARTAKMARKANIR` | Traffic restrictions | `1` |

**Geometry**: Each feature is a `LineString` (polyline) in WGS84 when requested with `outSR=4326`.

**Speed limit distribution**:
| km/h | Count |
|---|---|
| 1 | 26 (pedestrian zones) |
| 15 | 39 |
| 30 | 4,476 |
| 40 | 363 |
| 50 | 4,795 |
| 60 | 125 |
| 70 | 32 |
| 80 | 110 |
| 90 | 31 |

**Sample GeoJSON feature**:
```json
{
  "type": "Feature",
  "id": 25081812,
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-21.84413699817409, 64.134729727793399],
      [-21.843183853213691, 64.135027221200275]
    ]
  },
  "properties": {
    "OBJECTID": 25081812,
    "GOTUFLOKKUR": 2,
    "VEGNR": "0707",
    "STEFNA": 2,
    "HRADI": 30,
    "SVF": "0000",
    "EIGANDI": 1,
    "NAFN": "Kleppsmyrarvegur",
    "UMFERDARTAKMARKANIR": 1
  }
}
```

**Download script requirements**:
- Paginate through all 9,997 features using 5 requests (2,000 per page)
- Query: `?where=1%3D1&outFields=*&f=geojson&outSR=4326&returnGeometry=true&resultRecordCount=2000&resultOffset={offset}`
- Offsets: 0, 2000, 4000, 6000, 8000
- Merge all pages into a single GeoJSON FeatureCollection
- Save as a static file bundled with the app (estimated ~5-10 MB)
- Should be re-run periodically to pick up any speed limit changes (quarterly is fine)

**Also available (Layer 80 — Hámarkshraði)**: A subset of 4,710 features specifically for speed limit rendering, with extra fields like inspection dates. Layer 23 is sufficient for our needs.

### Speed Limit Matching (GPS → Road Segment)

At runtime, match a bus GPS coordinate to the nearest street segment to determine the speed limit:

1. Load the pre-downloaded GeoJSON into memory at app startup
2. For each bus GPS position, find the nearest `LineString` segment using perpendicular point-to-line-segment distance
3. Return the `HRADI` (speed limit) of the nearest segment
4. If no segment is within 50m, fall back to 50 km/h (Iceland urban default)

**Iceland default speed limits** (for fallback):
| Context | Speed |
|---|---|
| Urban | 50 km/h |
| Rural (paved) | 90 km/h |
| Pedestrian zones | 10 km/h |

The dataset is small enough (~10K segments) that brute-force nearest-segment search is feasible, but spatial indexing (R-tree / grid) can optimize it if needed.

### OpenStreetMap / Overpass API (Previous approach — replaced by Borgarvefsja)
- Previously used for speed limit queries
- Replaced by the Borgarvefsja city data which is the authoritative source

## Tech Stack

- **Frontend**: Flutter (Dart) — web app with flutter_map + OpenStreetMap tiles
- **Data Collector**: Dart CLI service (runs independently from the app)
- **Databases**: Hive (processed bus locations), SQLite3 (raw GraphQL snapshots)
- **Platforms**: Web (Chrome), macOS desktop

## Architecture

### Three Independent Services

1. **Main Collector** (`data_collector/bin/main.dart`, launch: `./start_collector.sh`)
   - Polls Straeto API every 1 second
   - Calculates speed via Haversine between consecutive GPS points
   - Queries Overpass API for speed limits
   - Stores processed `BusLocation` records in Hive

2. **Raw Collector** (`data_collector/bin/raw_collector.dart`, launch: `./start_raw_collector.sh`)
   - Polls Straeto API every 1 second
   - Stores unmodified GraphQL responses in SQLite3
   - Purpose: allows offline reprocessing with different algorithms

3. **Processor** (`data_collector/bin/processor.dart`, launch: `./start_processor.sh`)
   - Reads raw SQLite snapshots and applies Kalman filter for GPS smoothing
   - Modes: `--batch` (all history), `--continuous` (watch for new), `--from-timestamp`
   - Outputs processed data to Hive

### Flutter Web App (`./start_app.sh`)
- Three-panel layout: settings sidebar, time controls bar, map view
- **Real-time mode**: streams latest bus positions (polls Hive every 3 seconds)
- **Historical mode**: date/time picker, play/pause animation, slider scrubbing
- Bus markers color-coded: red (violation), orange (>40 km/h), green (normal), grey (no data)

## Key Algorithms

### Speed Calculation Pipeline

**Critical constraint: Never overestimate bus speed.** GPS noise systematically overestimates distance (and therefore speed) due to the mathematical property that random position errors always add apparent distance. At 50 km/h with typical GPS error (~4-5m sigma), raw Haversine can overestimate by +5 to +14 km/h. A stationary bus can show 5-12 km/h phantom speed.

**GPS noise context for Reykjavík:**
- Typical GPS position error: sigma ~3-5 meters (standard deviation per axis)
- High latitude (64°N) degrades GPS geometry (satellites cluster toward southern sky), partially mitigated by GLONASS
- Urban canyon effects are mild (low-rise city) — adds ~1-3m in dense downtown
- Coordinate conversion at 64°N: 1° lat ≈ 111 km, 1° lng ≈ 48.6 km

**Four-step pipeline applied to each bus GPS reading:**

```
Raw GPS fix
  |
  v
[Step 1] OUTLIER REJECTION
  - Drop if position jumps > 500m from previous fix (GPS glitch)
  - Drop if computed speed > 120 km/h (impossible for city bus)
  - Drop if time gap from previous fix < 1 second (duplicate/stale)
  |
  v
[Step 2] MINIMUM DISTANCE THRESHOLD
  - If distance between consecutive fixes < 10m → report speed as 0
  - Eliminates phantom speed for stationary/very slow buses
  - At 5s intervals this means speeds below ~7 km/h are reported as 0
    (acceptable — speed violations only matter at higher speeds)
  |
  v
[Step 3] POSITION SMOOTHING
  - Maintain a buffer of the last 3 position fixes per bus
  - Compute smoothed position as the mean of the 3 lat/lng values
  - Compute speed from consecutive smoothed positions via Haversine
  - Reduces noise by factor of sqrt(3) ≈ 1.73, cutting overestimation variance roughly in half
  - Introduces ~10-15 seconds of lag (acceptable for monitoring)
  - Tends to underestimate during turns/acceleration (favorable for our constraint)
  |
  v
[Step 4] CONSERVATIVE SPEED FACTOR
  - Multiply computed speed by 0.92
  - Compensates for the remaining systematic GPS overestimation bias
  - Tunable: increase to 0.94-0.95 if underestimation is too aggressive,
    decrease to 0.90 if any overestimation is observed in testing
  |
  v
Final speed estimate
```

**Expected accuracy after pipeline:**

| True Speed | Raw Haversine (avg) | After Pipeline (avg) | 95th Percentile |
|---|---|---|---|
| 0 km/h (stationary) | ~6 km/h | 0 km/h | 0 km/h |
| 20 km/h | ~23 km/h | ~17 km/h | ~21 km/h |
| 50 km/h | ~52 km/h | ~44 km/h | ~49 km/h |
| 70 km/h | ~72 km/h | ~62 km/h | ~67 km/h |

**Why not a Kalman filter:**
- The simple pipeline achieves the "never overestimate" goal more transparently
- Kalman filter behavior depends on tuning parameters that are hard to validate
- The pipeline's bias is predictable and mathematically reasoned about
- Kalman filter is a valid upgrade path later if more accuracy is needed

**Violation detection:** `speed > speedLimit` (after pipeline). Since the pipeline already underestimates, any detected violation is a genuine violation with high confidence. A bus showing 52 km/h in a 50 zone after the pipeline is truly going significantly faster than 50.

## Data Model — BusLocation

```dart
class BusLocation {
  String busId, routeNr, tripId;
  double lat, lng;
  int direction, timestamp;
  double? speedKmh, speedLimitKmh;
  bool isViolation;
  double violationThreshold;
  String? headsign;
}
```
- Hive key format: `"${timestamp}_${busId}"`
- Hive typeId: 0

## Storage Paths

- **macOS**: `~/Library/Application Support/straeto_speedometer/`
- **Linux**: `~/.local/share/straeto_speedometer/`
- Subdirectories: `bus_locations/` (Hive), `raw_bus_data.db` (SQLite), `speed_limit_cache/`

## Project Structure

```
├── lib/                          # Flutter web app
│   ├── main.dart                 # App entry, three-panel layout
│   ├── services/
│   │   └── database_service.dart # Hive reads for Flutter
│   └── widgets/
│       ├── bus_map.dart          # Map display with markers
│       ├── settings_panel.dart   # Route filter, threshold, legend
│       └── time_controls.dart    # Real-time/historical toggle, playback
├── data_collector/               # Dart CLI data services
│   ├── bin/
│   │   ├── main.dart             # Main collector (1s polling)
│   │   ├── raw_collector.dart    # Raw snapshot saver
│   │   └── processor.dart        # Kalman filter processor
│   └── lib/
│       ├── models/
│       │   ├── bus_location.dart  # Core data model (Hive-serializable)
│       │   └── graphql_response.dart
│       └── services/
│           ├── graphql_service.dart     # Straeto API client
│           ├── speed_calculator.dart    # Haversine + speed logic
│           ├── speed_limit_service.dart # Overpass API queries
│           ├── database_service.dart    # Hive writes
│           ├── raw_data_service.dart    # SQLite writes
│           ├── speed_processor.dart     # Batch/continuous processing
│           └── kalman_filter.dart       # GPS smoothing
├── web/                          # Flutter web assets
├── macos/                        # macOS runner
├── start_app.sh                  # Launch Flutter web app
├── start_collector.sh            # Launch main collector
├── start_raw_collector.sh        # Launch raw collector
└── start_processor.sh            # Launch processor
```

## Data Collection Strategy

The system has two independent paths for gathering bus data, both producing the same format so data can be used interchangeably in the UI.

### 1. Standalone Collector Script

A long-running script meant to run on a server or local machine for days/weeks/months, building up a historical dataset.

- Polls the Straeto GraphQL API at regular intervals
- Computes speed from consecutive GPS positions (Haversine)
- Appends processed records to an output file
- Designed to run unattended over long periods
- Runs on local machine (macOS)
- Output split into daily files (e.g. `2026-03-10.jsonl`, `2026-03-11.jsonl`)

### 2. Browser-Based Live Collection

When a user opens the web UI, they can start collecting data in real-time directly from the browser.

- The UI polls the Straeto API and computes speeds using the same logic as the standalone collector
- Data is stored in-browser (IndexedDB or in-memory) for the duration of the session
- Gives users immediate access to live bus data without needing the standalone collector

### 3. Data Import

The UI supports importing data files produced by the standalone collector.

- Users can load a collector output file into the UI via file picker / drag-and-drop
- Imported data merges with any live-collected data in the browser
- This allows users to explore historical data gathered over long periods

### CORS — Confirmed: No Proxy Needed

The Straeto API returns `access-control-allow-origin: *`, so browsers can call it directly from any origin. No backend proxy is required. The API also sets `cache-control: max-age=2`, meaning polling faster than every 2 seconds is pointless.

### Tech Stack — Decided

- **UI**: Flutter web (Dart) with flutter_map + OpenStreetMap tiles
- **Collector**: Dart CLI script
- **Shared code**: Models and speed calculation logic shared between UI and collector

## UI Design

### Layout — Map-Dominant Single Page with Mode Switching

The map is always full-screen. A pill-style mode switcher changes what's overlaid on the map and in the sidebar. No page navigation.

**Structure:**
- **Top bar**: Mode switcher (Live | Playback | Stats | Heatmap) + route filters + KPI cards (active buses, violations, avg speed)
- **Collapsible sidebar** (~300px, expands to ~450px for Stats): Content changes per mode
- **Map**: Always visible, full viewport
- **Bottom bar**: Only in Playback mode — timeline scrubber, play/pause, speed controls

### Modes

| Mode | Map | Sidebar |
|---|---|---|
| **Live** | Real-time bus markers, color-coded by speed | Active bus list + violation alert feed |
| **Playback** | Historical positions from imported/collected data | Collapses; bottom bar appears with timeline controls |
| **Stats** | Highlights selected routes | Expands with charts (top speeders, violations over time, avg speed/route, worst times, distance tracked) |
| **Heatmap** | Violation density layer | Time range selector + legend |

### Platform & Hosting
- Desktop only (no mobile support for now)
- Hosted on GitHub Pages with GitHub Actions for auto-build and deploy on push
- English UI
- Small audience (no bandwidth concerns)
- All timestamps displayed in Iceland time (UTC+0, no daylight saving)

### Data Collection Controls
- "Start Collecting" button in the UI to begin browser-based live collection
- Collected data persists in IndexedDB across browser sessions
- File import via file picker for standalone collector data (supports selecting multiple daily `.jsonl` files at once)
- No export functionality

### Data Retention
- No hard storage limit — IndexedDB handles hundreds of MB
- "Clear data" button in settings to free up space
- Show current storage usage next to the button (e.g. "Using 45 MB, 3 days of data")

### Visual Design
- Bus markers color-coded: red (violation), orange (approaching limit), green (normal), grey (no data)
- Marker clustering when zoomed out, individual buses with speed labels when zoomed in

### KPI Cards (always visible in top bar)
- Total active buses
- Current violations
- Average fleet speed

### Statistics Charts
- Top speeding buses / routes
- Number of violations over time
- Average speed per route
- Worst time of day for violations
- Total distance traveled / buses tracked

### Data Format

- **Format**: JSON Lines (`.jsonl`) — one JSON object per line
- **Content**: Processed records only (bus ID, route, position, speed, timestamp) — not raw API snapshots
- **Deduplication**: Only store when `lastUpdate` changes for a bus (avoids duplicate records from unchanged GPS)
- **Polling interval**: Every 2 seconds (matches API cache)
- **Estimated size**: ~50-80 MB/day, ~350-500 MB/week (manageable without compression)

### Speed Limit Data
- Pre-downloaded from Borgarvefsja ArcGIS API as GeoJSON
- Bundled as a static asset in the Flutter web app
- Re-download script run periodically to pick up changes (quarterly is fine)

## Previous Implementation Notes

> From the earlier Flutter/Dart build — kept for reference only.

- Speed violation detection was implemented but disabled in the UI
- The web app used IndexedDB (browser Hive), so it could not directly share files with the CLI data collector
- The Straeto API uses persisted queries (no arbitrary GraphQL, must use the known SHA256 hash)
