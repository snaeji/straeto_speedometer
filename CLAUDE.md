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
- **Routes queried**: 1–29, 31, 35, 36 (all Reykjavík bus routes)
- **Response fields**: `busId`, `tripId`, `routeNr`, `lat`, `lng`, `direction`, `headsign`, `lastUpdate`

### OpenStreetMap / Overpass API
- Queries for `maxspeed` tags on roads within 50m of bus GPS coordinates
- Results are cached locally to reduce API load
- Default speed limit: 50 km/h (standard urban Iceland)

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

### Speed Calculation (`speed_calculator.dart`)
- Haversine formula for GPS distance between consecutive positions
- Filters: ignores < 1m movement (stationary) and > 150 km/h (GPS jumps)
- Violation: `speed > (speedLimit + threshold)`

### Kalman Filter (`kalman_filter.dart`)
- Smooths noisy GPS positions and estimates velocity
- Latitude/longitude conversion at Reykjavík (64°N): 1° lat ≈ 111km, 1° lng ≈ 48.6km
- Resets on > 30-second gaps or > ~1000m jumps

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

## Current State / Notes

- Speed violation detection is implemented but currently disabled in the UI
- The web app uses IndexedDB (browser Hive), so it cannot directly share files with the CLI data collector
- The Straeto API uses persisted queries (no arbitrary GraphQL, must use the known SHA256 hash)
