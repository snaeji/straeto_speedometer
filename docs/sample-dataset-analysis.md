# Sample Dataset Analysis

## Overview
- **File**: `static/sample.jsonl` (also `data/2026-03-11.jsonl`)
- **Records**: 35,990 lines (4.3 MB)
- **Duration**: 594 seconds (~10 minutes)
- **Time range**: 2026-03-11 08:49:38 to 08:59:32 UTC
- **Fleet**: 123 unique buses across 25 routes (1-29, 31, 35, 36)
- **Snapshots**: 178 unique timestamps

## Temporal Characteristics

### Per-Bus Time Gaps (seconds)
| Percentile | Gap |
|---|---|
| Min | 0s |
| P25 | 0s |
| Median | 2s |
| P75 | 4s |
| P95 | 5s |
| Max | 25s |

### Gap Distribution
| Gap | Count | Percentage |
|---|---|---|
| 0s | 14,359 | 40.0% |
| 2s | 7,390 | 20.6% |
| 3s | 4,492 | 12.5% |
| 4s | 5,733 | 16.0% |
| 5s | 2,676 | 7.5% |
| 6s | 847 | 2.4% |
| 7s | 367 | 1.0% |

**Key insight**: 40% of records have 0s gap — these are duplicate timestamps from consecutive API polls returning unchanged bus positions. After deduplication, effective update rate is ~3-4 seconds per bus.

## Spatial & Movement Analysis

### Distance Between Consecutive Fixes (meters)
| Percentile | Distance |
|---|---|
| Min | 0.0m |
| P25 | 0.0m |
| Median | 0.0m |
| P75 | 17.7m |
| P95 | 59.4m |
| Max | 877.3m |
| <10m | 71.1% |

**Key insight**: 71.1% of consecutive fixes are <10m apart. Most buses are barely moving or stationary between fixes. The 10m minimum distance threshold in the pipeline correctly identifies these.

### Raw Haversine Speeds (km/h)
| Percentile | Speed |
|---|---|
| Min | 0.0 |
| P25 | 0.0 |
| Median | 8.4 |
| P75 | 35.5 |
| P95 | 77.8 |
| P99 | 122.3 |
| Max | 1,112.8 |

- **>50 km/h**: 3,098 records (8.6%)
- **>120 km/h**: 234 records (0.7%) — GPS glitches
- **Max 1,112.8 km/h**: Route 31-B bus with systematic GPS issues

## Data Format
```json
{"b":"1-B","r":"1","t":"62765","la":64.067,"ln":-21.948,"d":271,"ts":1773218978000,"h":"Skúlagata"}
```

| Field | Description | Example |
|---|---|---|
| b | Bus ID | "1-B" |
| r | Route number | "1" |
| t | Trip ID | "62765" |
| la | Latitude | 64.067 |
| ln | Longitude | -21.948 |
| d | Direction (degrees) | 271 |
| ts | Timestamp (epoch ms) | 1773218978000 |
| h | Headsign | "Skúlagata" |

## Anomalies
- **14 large jumps** >200m between consecutive fixes
- **Route 31-B**: Systematic GPS issues with max 1,112.8 km/h impossible speed
- **0 stuck buses**: All 123 show movement (GPS jitter prevents exact repetition)

## TODO: Speed Limit Match Quality Analysis

Run against the full sample dataset to determine how often we actually match a road segment vs. fall back to the 50 km/h default. Calculate:
- % of records with `match === 'matched'` vs `match === 'fallback'`
- Breakdown by route (some routes may leave the Reykjavík road dataset coverage)
- Whether fallback records cluster geographically (bus terminals, outskirts, etc.)

This tells us how trustworthy our speed limit data actually is across the fleet.

## TODO: Rewrite speed limit download script to Node

The current download script (`tools/download_speed_limits.dart`) requires a Dart runtime. Rewrite as a Node/JS script to match the SvelteKit stack so refreshing speed limit data doesn't require an extra toolchain.

## Data Collection
- **Script**: `scripts/collect.mjs`
- **Method**: Persisted GraphQL query to Straeto API
- **Poll interval**: 2 seconds (matches API cache `max-age=2`)
- **CORS**: API returns `access-control-allow-origin: *` — no proxy needed
- **Storage**: ~119 bytes/record, ~10 MB/24 hours estimated
