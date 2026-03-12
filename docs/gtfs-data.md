# GTFS Data Integration

## Source

Straeto publishes a free GTFS (General Transit Feed Specification) feed:

- **GTFS zip**: `http://opendata.straeto.is/data/gtfs/gtfs.zip` (~8 MB)
- **Bonus files** (not in the zip):
  - `http://opendata.straeto.is/data/gtfs/stopinfo.txt` — stop bearings (1,266 records)
  - `http://opendata.straeto.is/data/gtfs/routemap.txt` — route map metadata (58 records)

No authentication required. Data updates with schedule changes — re-download quarterly.

## Download Script

```bash
node scripts/download-gtfs.mjs
```

Downloads the GTFS zip, extracts and parses the CSVs, and writes 4 JSON files to `static/gtfs/`. These files are committed to git and served as static assets.

### What the script does

1. Fetches `gtfs.zip` + bonus `stopinfo.txt` and `routemap.txt`
2. Extracts to temp dir, parses all CSVs with a simple line splitter
3. Builds 4 data structures:
   - **routes**: Groups trips by `(route_id, direction, shape_id)`, picks the most-used shape per direction as primary, extracts one representative stop sequence per direction
   - **shapes**: Assembles coordinate arrays from `shapes.txt`, wraps as GeoJSON Features
   - **stops**: Merges `stops.txt` with `stopinfo.txt` bearings
   - **trip-shapes**: Simple `trip_id → shape_id` map
4. Writes 4 JSON files
5. Cleans up temp dir

## Output Files

All files live in `static/gtfs/` and are loaded at app startup.

### `routes.json` (~39 KB)

Keyed by `routeNr` (e.g. `"1"`, `"14"`, `"A1"`). 71 routes total.

```json
{
  "1": {
    "routeNr": "1",
    "routeId": "1",
    "shortName": "1",
    "longName": "Skúlagata <-> Hfj. Skarðshlíð",
    "color": "#d32600",
    "directions": {
      "0": {
        "primaryShapeId": "2084",
        "stopSequence": ["90000875", "90000713", "90000055", ...]
      },
      "1": {
        "primaryShapeId": "2085",
        "stopSequence": ["90000342", "90000341", ...]
      }
    }
  }
}
```

**Fields:**
| Field | Description |
|-------|-------------|
| `routeNr` | Public-facing route number (e.g. `"1"`, `"A1"`) |
| `routeId` | Internal GTFS route ID (usually same as routeNr) |
| `shortName` | Short display name |
| `longName` | Full route name with endpoints |
| `color` | Official hex color (e.g. `"#d32600"`), or `null` |
| `directions` | Per-direction data (usually `0` and `1`) |
| `directions[n].primaryShapeId` | Most-used shape ID for this direction |
| `directions[n].stopSequence` | Ordered stop IDs for one representative trip |

### `shapes.json` (~13 MB)

GeoJSON `FeatureCollection` with 229 route polylines.

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[-21.933, 64.148], [-21.932, 64.147], ...]
      },
      "properties": {
        "shapeId": "2084",
        "routeNr": "1",
        "directionId": 0,
        "color": "#d32600"
      }
    }
  ]
}
```

Each feature is a complete route polyline for one direction. Properties include `shapeId`, `routeNr`, `directionId`, and `color` for easy filtering and styling.

### `stops.json` (~115 KB)

Keyed by `stopId`. 1,292 stops.

```json
{
  "90000875": {
    "stopId": "90000875",
    "name": "Skúlagata",
    "lat": 64.1492,
    "lng": -21.9308,
    "bearing": 270
  }
}
```

**Fields:**
| Field | Description |
|-------|-------------|
| `stopId` | Unique stop identifier |
| `name` | Stop display name |
| `lat`, `lng` | WGS84 coordinates |
| `bearing` | Approach bearing in degrees (from `stopinfo.txt`), optional |

### `trip-shapes.json` (~95 KB)

Simple map of `tripId → shapeId`. 6,452 entries.

```json
{
  "ST:11049413:0:1": "2084",
  "ST:11049413:0:2": "2084"
}
```

Used to resolve a live bus's `tripId` (from the Straeto API) to its route geometry.

## TypeScript Types

Defined in `src/lib/types/gtfs.ts`:

- `GtfsRoute` — route metadata with directions
- `GtfsRouteDirection` — primary shape ID + stop sequence
- `GtfsStop` — stop with name, coordinates, optional bearing
- `GtfsRoutesFile`, `GtfsStopsFile`, `GtfsTripShapesFile` — file-level types

## GtfsService API

`src/lib/services/gtfs-service.ts` — loaded at startup, available via `appStore.gtfsService`.

### Loading

```ts
const gtfs = new GtfsService();
await gtfs.load(`${base}/gtfs`);  // fetches all 4 JSON files in parallel
```

### Route lookups

| Method | Returns | Description |
|--------|---------|-------------|
| `getRoute(routeNr)` | `GtfsRoute \| undefined` | Single route metadata |
| `getAllRoutes()` | `GtfsRoute[]` | All routes |
| `getAllRouteNumbers()` | `string[]` | Sorted route numbers |
| `getRouteColor(routeNr)` | `string` | Official color or deterministic fallback |

### Shape lookups

| Method | Returns | Description |
|--------|---------|-------------|
| `getShapeId(tripId, routeNr, direction)` | `string \| null` | Resolves trip → shape, falls back to route+direction primary |
| `getShapeGeoJson(shapeId)` | `GeoJSON.Feature \| null` | Single shape polyline |
| `getRouteShapesGeoJson(routeNr)` | `GeoJSON.Feature[]` | All shapes for a route |
| `shapesGeoJson` | `GeoJSON.FeatureCollection` | Full collection (for MapLibre source) |

### Stop lookups

| Method | Returns | Description |
|--------|---------|-------------|
| `getStop(stopId)` | `GtfsStop \| undefined` | Single stop |
| `getStopSequence(routeNr, directionId)` | `GtfsStop[]` | Ordered stops for a route direction |
| `getStopsGeoJson()` | `GeoJSON.FeatureCollection` | All stops as GeoJSON points (for MapLibre source) |

## Route Number Coverage

The GTFS feed contains 71 routes. This is a superset of the 32 routes previously hardcoded in `ALL_ROUTES`. New routes include regional/airport/express services:

- **Urban**: 1-7, 11-19, 21-24, 28, 31, 35, 36
- **Suburban/Regional**: 50-59, 63-65, 71-73, 78-79, 81-82, 84, 87, 89, 91-94, 96
- **Airport/Express**: A1-A6, R1, R3, R4
- **Peak-only**: P25-P27, P29, P92
- **Long-distance**: 101, 103-106

The Straeto live API only returns buses for routes that are currently operating, so querying all 71 is safe — unused routes simply return no buses.

## How Data Connects to the Live API

The Straeto GraphQL API returns `busId`, `tripId`, `routeNr`, and `direction` for each bus. These map to GTFS data as follows:

```
API bus.tripId  →  trip-shapes.json  →  shapeId  →  shapes.json (geometry)
API bus.routeNr →  routes.json       →  color, longName, stop sequence
API bus.routeNr + bus.direction → routes.json.directions[dir].primaryShapeId (fallback)
```

If `tripId` isn't in `trip-shapes.json` (schedule changes, special trips), the service falls back to the route's primary shape for that direction.

## Data Freshness

GTFS data reflects Straeto's published schedule. It changes when:
- Routes are added, removed, or renamed
- Route paths change (construction, new roads)
- Stops are added, moved, or removed
- Schedule changes (seasonal adjustments)

Re-running `node scripts/download-gtfs.mjs` and committing the updated files is sufficient. The script is idempotent.
