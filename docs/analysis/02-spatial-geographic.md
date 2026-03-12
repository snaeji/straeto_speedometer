# Spatial & Geographic Analysis -- Straeto Bus GPS Data

Dataset: `data/2026-03-11.jsonl` -- 977,707 records, 128 buses, 25 routes

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Geographic Bounding Box](#1-geographic-bounding-box)
3. [Coordinate Precision Analysis](#2-coordinate-precision-analysis)
   - 2.1 [Decimal Places Distribution](#21-decimal-places-distribution)
   - 2.2 [Smallest Position Changes Between Consecutive Fixes](#22-smallest-position-changes-between-consecutive-fixes)
   - 2.3 [Quantization / Grid Analysis](#23-quantization--grid-analysis)
4. [Distance Between Consecutive Fixes](#3-distance-between-consecutive-fixes)
   - 3.1 [All Consecutive Fix Distances](#31-all-consecutive-fix-distances)
   - 3.2 [Distance Bucket Distribution](#32-distance-bucket-distribution)
   - 3.3 [Distance per Route](#33-distance-per-route)
5. [GPS Jitter for Stationary Buses](#4-gps-jitter-for-stationary-buses)
   - 4.1 [GPS Noise Statistics](#41-gps-noise-statistics-from-stationary-episodes)
   - 4.2 [Stationary Episode Characteristics](#42-stationary-episode-characteristics)
   - 4.3 [Longest Stationary Episodes](#43-longest-stationary-episodes-top-15)
6. [Direction Field Analysis](#5-direction-field-analysis)
   - 5.1 [Direction Value Distribution](#51-direction-value-distribution)
   - 5.2 [Direction Quantization](#52-direction-quantization)
   - 5.3 [Direction Change Between Consecutive Fixes](#53-direction-change-between-consecutive-fixes)
   - 5.4 [Correlation Between Reported Direction and Computed Bearing](#54-correlation-between-reported-direction-and-computed-bearing)
   - 5.5 [Bearing Error vs. Distance Moved](#55-bearing-error-vs-distance-moved)
7. [Route Geographic Coverage](#6-route-geographic-coverage)
   - 6.1 [Per-Route Bounding Boxes](#61-per-route-bounding-boxes)
   - 6.2 [Route Overlap Analysis](#62-route-overlap-analysis)
   - 6.3 [Bus Density -- Highest Activity Grid Cells](#63-bus-density--highest-activity-grid-cells)
8. [Large Position Jumps (> 200m)](#7-large-position-jumps--200m-between-consecutive-fixes)
   - 7.1 [Jump Distance Distribution](#71-jump-distance-distribution)
   - 7.2 [Time Gap During Jumps](#72-time-gap-during-jumps)
   - 7.3 [Buses with Most Jumps](#73-buses-with-most-jumps)
   - 7.4 [Top 20 Largest Jumps](#74-top-20-largest-jumps)
   - 7.5 [Jump Classification](#75-jump-classification)
9. [Position Repetition](#8-position-repetition)
   - 8.1 [Exact Position Repeats Per Bus](#81-exact-position-repeats-per-bus)
   - 8.2 [Fleet-Wide Favorite Positions](#82-fleet-wide-favorite-positions-likely-bus-stops-or-terminals)
   - 8.3 [Position Frequency Distribution](#83-position-frequency-distribution)
   - 8.4 [Multi-Bus Positions](#84-multi-bus-positions-same-exact-coordinates-from-different-buses)
10. [Key Takeaways for Algorithm Design](#key-takeaways-for-algorithm-design)

---

## Executive Summary

This analysis examines the spatial and geographic characteristics of one full day of Straeto GPS data (977,707 records from 128 buses across 25 routes). Five findings dominate everything else:

1. **61.8% of consecutive GPS fixes are exact duplicates.** The Straeto API returns cached/stale positions the majority of the time. Any speed calculation or animation system must detect and skip these stale fixes, or it will compute zero speed for most of the fleet and waste cycles processing non-events. This is the single most important fact in the dataset.

2. **GPS noise is remarkably low: median 0.64m RMS when stationary.** This is far better than the 3-5m sigma assumed in the original project specification. The Kalman filter's process noise and measurement noise parameters should be tuned for sub-meter accuracy, not the multi-meter noise budgets typical of consumer GPS. Overly aggressive smoothing will blur real movement.

3. **Coordinates are quantized to a 1/60,000,000 degree grid (~0.002m lat, ~0.008m lng).** The GPS hardware or API pipeline rounds coordinates to this step size. This quantization is finer than the noise floor, so it does not affect speed calculations, but it means the data is not truly continuous -- it snaps to discrete grid points.

4. **924 large jumps (>200m) occur in a single day, with 23% being outright GPS glitches (implied speed >200 km/h).** The outlier rejection threshold of 500m in the original spec would miss the 593 jumps in the 200-500m range. A threshold based on implied speed (e.g., >120 km/h) is more robust than a fixed distance cutoff.

5. **The direction field is integer-only and accurate to 2 degrees median error for moves >5m.** This is good enough to use for marker rotation on the map without computing bearing from GPS positions, but it should not be trusted for moves under 5m where GPS noise dominates the bearing calculation.

---

## 1. Geographic Bounding Box

| Metric | Value |
| --- | --- |
| Min latitude | 64.0391543333333 |
| Max latitude | 64.1848716 |
| Min longitude | -22.0272061666667 |
| Max longitude | -21.6568378333333 |
| Latitude span | 0.145717 deg = 16,175 m (16.17 km) |
| Longitude span | 0.370368 deg = 18,000 m (18.00 km) |
| Approximate coverage area | 16.2 km x 18.0 km = ~291 km^2 |

**Centroid** (mean of all GPS fixes): 64.123317, -21.875763
**Median center**: 64.129480, -21.891379

**Distribution of fixes by distance from centroid:**

| Radius | Fixes within | % of total |
| --- | --- | --- |
| 1.0 km | 50,169 | 5.1% |
| 2.0 km | 164,444 | 16.8% |
| 3.0 km | 389,298 | 39.8% |
| 5.0 km | 765,489 | 78.3% |
| 7.5 km | 898,287 | 91.9% |
| 10.0 km | 949,632 | 97.1% |
| 15.0 km | 977,707 | 100.0% |
| 20.0 km | 977,707 | 100.0% |

### What This Means

**For speed limit matching:** The entire bus network fits within a 16x18 km rectangle, and 78% of all fixes fall within 5 km of the centroid. The speed limit dataset from Borgarvefsja covers 9,997 road segments across all of Reykjavik, so coverage should be comprehensive. A spatial index (R-tree or grid) partitioning this area into cells is straightforward -- even a 100m grid would have only ~29,000 cells.

**For map animation:** The default map viewport should be centered near the median center (64.1295, -21.8914) at a zoom level that covers a ~10 km radius, which captures 97% of all bus activity. Buses outside this radius (routes 15, 24, and 1 on their suburban legs) can be shown when the user zooms out.

---

## 2. Coordinate Precision Analysis

### 2.1 Decimal Places Distribution

**Latitude decimal places:**

| Decimal places | Count | % | Precision in meters |
| --- | --- | --- | --- |
| 1 | 5 | 0.0% | ~11100.00 m |
| 2 | 20 | 0.0% | ~1110.00 m |
| 3 | 239 | 0.0% | ~111.00 m |
| 4 | 2,267 | 0.2% | ~11.10 m |
| 5 | 24,502 | 2.5% | ~1.1100 m |
| 6 | 36,705 | 3.8% | ~0.1110 m |
| 7 | 129,595 | 13.3% | ~0.0111 m |
| 8 | 137,564 | 14.1% | ~0.0011 m |
| 13 | 646,810 | 66.2% | ~0.0000 m |

**Longitude decimal places:**

| Decimal places | Count | % | Precision in meters |
| --- | --- | --- | --- |
| 1 | 10 | 0.0% | ~4860.00 m |
| 2 | 185 | 0.0% | ~486.00 m |
| 3 | 2,247 | 0.2% | ~48.60 m |
| 4 | 23,398 | 2.4% | ~4.86 m |
| 5 | 40,361 | 4.1% | ~0.4860 m |
| 6 | 122,763 | 12.6% | ~0.0486 m |
| 7 | 136,766 | 14.0% | ~0.0049 m |
| 13 | 651,977 | 66.7% | ~0.0000 m |

### 2.2 Smallest Position Changes Between Consecutive Fixes

**Smallest non-zero latitude changes (degrees and meters):**

| Rank | Delta lat (deg) | Meters |
| --- | --- | --- |
| 1 | 1.6667e-8 | 0.0018 m |
| 2 | 1.6667e-8 | 0.0018 m |
| 3 | 1.6667e-8 | 0.0018 m |
| 4 | 1.6667e-8 | 0.0018 m |
| 5 | 1.6667e-8 | 0.0018 m |
| 6 | 1.6667e-8 | 0.0018 m |
| 7 | 1.6667e-8 | 0.0018 m |
| 8 | 1.6667e-8 | 0.0018 m |
| 9 | 1.6667e-8 | 0.0018 m |
| 10 | 1.6667e-8 | 0.0018 m |

**Smallest non-zero longitude changes (degrees and meters):**

| Rank | Delta lng (deg) | Meters |
| --- | --- | --- |
| 1 | 1.6667e-7 | 0.0081 m |
| 2 | 1.6667e-7 | 0.0081 m |
| 3 | 1.6667e-7 | 0.0081 m |
| 4 | 1.6667e-7 | 0.0081 m |
| 5 | 1.6667e-7 | 0.0081 m |
| 6 | 1.6667e-7 | 0.0081 m |
| 7 | 1.6667e-7 | 0.0081 m |
| 8 | 1.6667e-7 | 0.0081 m |
| 9 | 1.6667e-7 | 0.0081 m |
| 10 | 1.6667e-7 | 0.0081 m |

**Smallest non-zero Haversine distances (m):**

| Rank | Distance (m) |
| --- | --- |
| 1 | 0.0019 |
| 2 | 0.0019 |
| 3 | 0.0019 |
| 4 | 0.0019 |
| 5 | 0.0019 |
| 6 | 0.0019 |
| 7 | 0.0019 |
| 8 | 0.0019 |
| 9 | 0.0019 |
| 10 | 0.0019 |

### 2.3 Quantization / Grid Analysis

Records with lat OR lng trailing in "0": 0 (0.0%)
Records with lat OR lng trailing in "5": 330,891 (33.8%)
Records with lat containing "333" or "667"/"666": 650,221 (66.5%)
Records with lng containing "333" or "667"/"666": 654,632 (67.0%)

**Grid quantization test** -- checking if lat values cluster at regular intervals:

Grid 1e-4 (11.10m): median residual=2.7750m, P90=4.9950m, exact-on-grid=0.4%
Grid 5e-5 (5.55m): median residual=1.3672m, P90=2.4994m, exact-on-grid=1.0%
Grid 1e-5 (1.11m): median residual=0.2794m, P90=0.5069m, exact-on-grid=4.2%
Grid 5e-6 (0.56m): median residual=0.1498m, P90=0.2442m, exact-on-grid=8.2%
Grid 1e-6 (0.11m): median residual=0.0296m, P90=0.0481m, exact-on-grid=20.4%

### What This Means

**The data is quantized, not continuous.** The smallest observed position change is exactly 1.6667e-8 degrees in latitude (0.0018m) and 1.6667e-7 degrees in longitude (0.0081m). The value 1.6667e-8 is 1/60,000,000 of a degree -- the coordinates appear to be encoded as integer multiples of this step. Two-thirds of records show the characteristic "333"/"667" trailing digits that result from dividing by 3 or 6 in this grid.

**For the Kalman filter:** The quantization step (0.002m lat, 0.008m lng) is 300x smaller than the measured GPS noise (0.64m RMS). This means quantization does not limit accuracy -- it is invisible beneath the noise floor. However, the filter should not interpret a zero position delta as "zero process noise" -- it likely means the position was cached/stale. A stale-fix detector (consecutive identical coordinates) should gate Kalman measurement updates.

**For map animation:** The 66% of fixes with 13 decimal places are not more precise than those with 7 decimal places. The extra digits are artifacts of floating-point representation of the quantized values. Animation code should not try to interpolate at sub-millimeter resolution -- the real position uncertainty is ~0.6m.

---

## 3. Distance Between Consecutive Fixes

### 3.1 All Consecutive Fix Distances

| Percentile | All fixes (m) | Non-stale only (m) |
| --- | --- | --- |
| P1 | 0.00 | 0.62 |
| P5 | 0.00 | 1.74 |
| P10 | 0.00 | 3.84 |
| P25 | 0.00 | 15.49 |
| P50 | 0.00 | 31.69 |
| P75 | 9.71 | 51.48 |
| P90 | 44.17 | 73.00 |
| P95 | 61.57 | 88.20 |
| P99 | 97.30 | 126.26 |
| Min | 0.0000 | 0.5000 |
| Max | 13871.47 | 13871.47 |
| Mean | 12.11 | 39.84 |
| Count | 977,579 | 296,945 |

### 3.2 Distance Bucket Distribution

| Distance range | Count | % of all pairs |
| --- | --- | --- |
| 0 m (exact same position) | 604,095 | 61.80% |
| < 1 m | 689,998 | 70.58% |
| < 5 m | 716,684 | 73.31% |
| < 10 m | 734,304 | 75.11% |
| < 50 m | 898,855 | 91.95% |
| < 100 m | 968,947 | 99.12% |
| 100-200 m | 7,708 | 0.79% |
| 200-500 m | 593 | 0.06% |
| 500-1000 m | 93 | 0.01% |
| > 1000 m | 238 | 0.02% |

### 3.3 Distance per Route

| Route | Pairs | P50 (m) | P90 (m) | P99 (m) | Max (m) | Mean (m) | % zero |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 96,303 | 0.0 | 42.8 | 100.8 | 12700 | 11.3 | 66.7% |
| 2 | 50,813 | 0.0 | 44.0 | 105.4 | 7741 | 13.7 | 62.4% |
| 3 | 62,978 | 0.0 | 48.0 | 96.7 | 8246 | 12.8 | 60.3% |
| 4 | 54,778 | 0.0 | 38.5 | 88.0 | 7412 | 9.6 | 67.0% |
| 5 | 60,641 | 0.0 | 41.6 | 92.0 | 8963 | 11.8 | 58.2% |
| 6 | 71,134 | 0.0 | 43.9 | 100.5 | 8014 | 11.6 | 64.6% |
| 7 | 18,954 | 0.0 | 54.1 | 103.2 | 1436 | 15.9 | 55.7% |
| 8 | 9,126 | 0.0 | 55.5 | 87.6 | 2009 | 14.1 | 63.1% |
| 11 | 40,299 | 0.0 | 38.8 | 83.9 | 6461 | 11.2 | 56.6% |
| 12 | 84,427 | 0.0 | 41.8 | 88.2 | 6811 | 11.5 | 59.2% |
| 13 | 31,949 | 0.0 | 30.3 | 64.8 | 3901 | 8.3 | 55.2% |
| 14 | 40,011 | 0.0 | 34.4 | 71.8 | 4226 | 9.5 | 53.8% |
| 15 | 74,648 | 0.0 | 51.3 | 115.9 | 13871 | 15.4 | 55.3% |
| 16 | 24,084 | 0.0 | 50.6 | 92.0 | 3529 | 13.3 | 59.5% |
| 17 | 23,019 | 0.0 | 39.0 | 83.2 | 4965 | 9.9 | 60.3% |
| 18 | 48,229 | 0.0 | 50.2 | 100.8 | 6693 | 14.3 | 57.3% |
| 19 | 32,293 | 0.0 | 40.2 | 76.9 | 7320 | 9.5 | 72.5% |
| 21 | 36,781 | 0.0 | 46.8 | 101.9 | 6836 | 13.4 | 65.1% |
| 22 | 9,473 | 0.0 | 50.6 | 100.8 | 1295 | 12.9 | 62.8% |
| 23 | 8,640 | 0.0 | 59.2 | 106.5 | 4445 | 15.9 | 66.1% |
| 24 | 46,814 | 0.0 | 48.8 | 95.2 | 9577 | 12.1 | 66.9% |
| 28 | 18,951 | 0.0 | 50.3 | 83.8 | 2298 | 13.0 | 65.8% |
| 31 | 14,277 | 0.0 | 43.2 | 223.2 | 2629 | 12.8 | 77.9% |
| 35 | 9,477 | 0.0 | 49.1 | 85.8 | 3098 | 12.4 | 64.5% |
| 36 | 9,475 | 0.0 | 47.5 | 89.2 | 3099 | 12.2 | 71.2% |

### What This Means

**The stale-fix problem is massive.** Only 296,945 of 977,579 consecutive fix pairs (30.4%) show any position change at all. The median distance for all pairs is 0.0m. When the position does change, the median jump is 31.7m and the P90 is 73m. These numbers define the "real" GPS update cadence: the API may respond every 2 seconds, but the underlying GPS hardware reports a new position roughly every 6-7 seconds on average (given ~3x more stale fixes than fresh ones).

**For the Kalman filter:** The filter must distinguish three regimes:
- **Stale fix (0m displacement, 62% of data):** Skip the Kalman measurement update entirely. Use the filter's prediction step only to advance the state estimate, maintaining velocity from the last real update. This is critical -- feeding zero-displacement measurements to the filter would cause it to converge on zero velocity and then "jump" when the next real update arrives.
- **Normal movement (1-100m, 37% of data):** Standard Kalman measurement update. The median 31.7m displacement over ~2-6 seconds corresponds to 19-57 km/h, which matches expected urban bus speeds.
- **Large jump (>100m, 0.9% of data):** Likely a gap in reporting or route teleportation. Reset the filter state rather than updating, to avoid a massive velocity spike.

**For map animation:** When a bus goes 6-7 seconds between real position updates, the animation must interpolate smoothly across that gap. At 50 km/h, a 6-second gap means ~83m of travel. The current Kalman prediction approach (predicting forward at 60fps using estimated velocity) is the right strategy -- the prediction will carry the marker forward during stale-fix periods, then correct gently when the next real position arrives.

**For data deduplication:** The 61.8% exact-duplicate rate means storing raw API responses wastes more than half the storage. Deduplication on (busId, lat, lng) would cut the dataset from 977K to ~374K records with zero information loss. However, timestamp-only deduplication (using `lastUpdate`) is preferred because it also captures the "the bus was confirmed at this location at this time" signal, which is useful for distinguishing "parked" from "API not reporting."

**Route variation is modest.** The zero-distance percentage ranges from 53.8% (route 14) to 77.9% (route 31), but the P90 moving distance is remarkably consistent across routes: 30-59m. No route needs special handling.

---

## 4. GPS Jitter for Stationary Buses

Found **3,572** stationary episodes (20+ fixes within 5m)

### 4.1 GPS Noise Statistics (from stationary episodes)

| Metric | P10 | P25 | P50 (median) | P75 | P90 | P99 | Mean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Std dev lat (m) | 0.020 | 0.106 | 0.327 | 0.646 | 0.991 | 1.585 | 0.427 |
| Std dev lng (m) | 0.000 | 0.114 | 0.339 | 0.677 | 1.012 | 1.614 | 0.441 |
| RMS 2D (m) | 0.046 | 0.251 | 0.641 | 0.998 | 1.346 | 1.911 | 0.674 |
| Max deviation (m) | 0.152 | 0.903 | 2.289 | 3.198 | 3.966 | 4.953 | 2.161 |

### 4.2 Stationary Episode Characteristics

| Metric | P10 | P25 | P50 | P75 | P90 | Max |
| --- | --- | --- | --- | --- | --- | --- |
| Duration (s) | 37 | 42 | 53 | 89 | 261 | 21806 |
| Fix count | 21 | 23 | 29 | 46 | 129 | 6818 |

### 4.3 Longest Stationary Episodes (top 15)

| Bus | Duration | Fixes | Std lat (m) | Std lng (m) | RMS (m) | Max dev (m) | Location |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 99-A | 363 min | 6,818 | 0.000 | 0.000 | 0.000 | 0.000 | 64.12344, -21.78755 |
| 1-J | 170 min | 5,034 | 1.155 | 0.868 | 1.445 | 3.226 | 64.12323, -21.78992 |
| 4-G | 163 min | 4,832 | 1.389 | 0.312 | 1.423 | 2.309 | 64.15556, -21.86755 |
| 19-C | 159 min | 4,703 | 0.000 | 0.000 | 0.000 | 0.000 | 64.10960, -21.84165 |
| 24-D | 141 min | 4,181 | 1.032 | 0.225 | 1.057 | 2.441 | 64.12010, -21.80656 |
| 6-G | 112 min | 3,324 | 0.475 | 0.852 | 0.975 | 2.369 | 64.12365, -21.78760 |
| 6-G | 92 min | 2,720 | 0.858 | 0.332 | 0.920 | 3.660 | 64.12362, -21.78762 |
| 24-F | 39 min | 1,145 | 0.264 | 0.380 | 0.463 | 2.234 | 64.05947, -21.97510 |
| 12-L | 36 min | 97 | 0.828 | 0.333 | 0.892 | 4.276 | 64.10499, -21.81700 |
| 23-A | 34 min | 239 | 0.219 | 0.048 | 0.224 | 0.891 | 64.08986, -21.92973 |
| 4-B | 29 min | 848 | 0.470 | 0.613 | 0.773 | 4.115 | 64.14834, -21.92717 |
| 4-A | 28 min | 821 | 0.278 | 0.145 | 0.313 | 1.921 | 64.14827, -21.92708 |
| 4-C | 27 min | 809 | 0.174 | 0.390 | 0.426 | 0.980 | 64.14830, -21.92714 |
| 4-D | 26 min | 783 | 0.193 | 0.092 | 0.214 | 0.844 | 64.14827, -21.92708 |
| 5-E | 22 min | 642 | 0.000 | 0.000 | 0.000 | 0.000 | 64.13725, -21.93410 |

**Summary**: Median GPS noise sigma = 0.641m RMS (lat: 0.327m, lng: 0.339m). Mean RMS = 0.674m.

### What This Means

**GPS noise is much lower than the original estimate.** The CLAUDE.md specification assumed 3-5m sigma per axis based on generic GPS characteristics. The measured values are 0.33m lat / 0.34m lng (median sigma), which is 10x better. This has cascading implications:

**For the Kalman filter:** The measurement noise covariance matrix (R) should use sigma ~0.4m per axis, not 3-5m. With the current 2D constant-velocity model, this means:
- R = diag(0.16, 0.16) in meters^2 (using 0.4m sigma)
- Process noise Q should be tuned for the actual position update rate (~6s between real fixes), not the 2s polling rate
- The 99th percentile noise is 1.9m RMS -- even worst-case GPS conditions in Reykjavik produce sub-2m errors
- Maximum observed deviation from a stationary position is ~5m (P99 of max deviations). This confirms the 500m outlier rejection threshold in the original spec is far too generous for "noise" but appropriate for "the bus actually moved."

**For map animation:** The low noise means a stationary bus marker should stay essentially still. A well-tuned Kalman filter with R=0.16 m^2 will barely move the predicted position when receiving noisy-but-stationary measurements. The 400ms correction blending in the current implementation is appropriate -- it is slow enough that sub-meter jitter won't produce visible marker twitching.

**For speed calculation:** At 0.64m RMS noise with ~6s between real fixes, the noise-induced speed error for a stationary bus is approximately (0.64m * sqrt(2)) / 6s = 0.15 m/s = 0.54 km/h. This is negligible. The original spec's "10m minimum distance threshold" can be lowered to 2-3m without risk of phantom speed. However, since 62% of fixes are exact duplicates anyway, the stale-fix detection matters far more than the minimum-distance threshold.

**Notable: three buses (99-A, 19-C, 5-E) show zero jitter.** These are reporting the exact same coordinate for every fix during their stationary episodes. This means either their GPS hardware caches the last position, or the API is returning a cached value. Bus 99-A reported the same position 6,818 times over 363 minutes -- it may be a decommissioned or test vehicle.

---

## 5. Direction Field Analysis

### 5.1 Direction Value Distribution

Unique direction values: **363**
Range: **-2** to **360**

**Direction distribution (10 deg bins):**

| Bearing range | Count | % |
| --- | --- | --- |
| 0-10 deg | 24,825 | 2.5% |
| 10-20 deg | 36,677 | 3.8% |
| 20-30 deg | 31,654 | 3.2% |
| 30-40 deg | 29,400 | 3.0% |
| 40-50 deg | 16,382 | 1.7% |
| 50-60 deg | 26,957 | 2.8% |
| 60-70 deg | 16,483 | 1.7% |
| 70-80 deg | 16,268 | 1.7% |
| 80-90 deg | 33,110 | 3.4% |
| 90-100 deg | 41,298 | 4.2% |
| 100-110 deg | 37,474 | 3.8% |
| 110-120 deg | 59,185 | 6.1% |
| 120-130 deg | 23,576 | 2.4% |
| 130-140 deg | 22,059 | 2.3% |
| 140-150 deg | 22,979 | 2.4% |
| 150-160 deg | 13,404 | 1.4% |
| 160-170 deg | 13,525 | 1.4% |
| 170-180 deg | 21,621 | 2.2% |
| 180-190 deg | 22,607 | 2.3% |
| 190-200 deg | 29,854 | 3.1% |
| 200-210 deg | 33,483 | 3.4% |
| 210-220 deg | 31,653 | 3.2% |
| 220-230 deg | 17,348 | 1.8% |
| 230-240 deg | 18,375 | 1.9% |
| 240-250 deg | 16,552 | 1.7% |
| 250-260 deg | 18,114 | 1.9% |
| 260-270 deg | 44,138 | 4.5% |
| 270-280 deg | 35,425 | 3.6% |
| 280-290 deg | 38,569 | 3.9% |
| 290-300 deg | 54,144 | 5.5% |
| 300-310 deg | 26,776 | 2.7% |
| 310-320 deg | 19,865 | 2.0% |
| 320-330 deg | 22,426 | 2.3% |
| 330-340 deg | 16,042 | 1.6% |
| 340-350 deg | 16,300 | 1.7% |
| 350-360 deg | 27,799 | 2.8% |
| 360-370 deg | 1,348 | 0.1% |
| -10-0 deg | 12 | 0.0% |

### 5.2 Direction Quantization

**Top 20 most frequent direction values:**

| Direction | Count | % |
| --- | --- | --- |
| 58 deg | 8,946 | 0.91% |
| 109 deg | 8,842 | 0.90% |
| 289 deg | 8,676 | 0.89% |
| 113 deg | 8,657 | 0.89% |
| 111 deg | 8,411 | 0.86% |
| 93 deg | 8,097 | 0.83% |
| 290 deg | 7,886 | 0.81% |
| 291 deg | 7,875 | 0.81% |
| 32 deg | 7,848 | 0.80% |
| 110 deg | 7,761 | 0.79% |
| 213 deg | 6,643 | 0.68% |
| 262 deg | 6,464 | 0.66% |
| 115 deg | 6,368 | 0.65% |
| 114 deg | 6,223 | 0.64% |
| 145 deg | 6,190 | 0.63% |
| 268 deg | 6,096 | 0.62% |
| 288 deg | 6,049 | 0.62% |
| 295 deg | 5,874 | 0.60% |
| 271 deg | 5,816 | 0.59% |
| 16 deg | 5,640 | 0.58% |

Directions with decimal part: **0** out of 977,707 (0.0%)

### 5.3 Direction Change Between Consecutive Fixes

Zero change (same direction): **732,884** (75.0%)
1 deg change: **51,660** (5.3%)

| Percentile | Direction change (deg) |
| --- | --- |
| P1 | 0.0 |
| P5 | 0.0 |
| P10 | 0.0 |
| P25 | 0.0 |
| P50 | 0.0 |
| P75 | 1.0 |
| P90 | 7.0 |
| P95 | 19.0 |
| P99 | 64.0 |

### 5.4 Correlation Between Reported Direction and Computed Bearing

Comparable pairs (distance >= 5m): **260,895**

| Percentile | Bearing error (deg) |
| --- | --- |
| P1 | 0.0 |
| P5 | 0.1 |
| P10 | 0.2 |
| P25 | 0.6 |
| P50 | 2.0 |
| P75 | 7.0 |
| P90 | 17.6 |
| P95 | 28.4 |
| P99 | 50.1 |

Within 10 deg of computed bearing: **81.5%**
Within 30 deg: **95.5%**
Within 45 deg: **98.5%**
Off by > 90 deg (wrong direction): **0.1%**

### 5.5 Bearing Error vs. Distance Moved

| Distance bucket | Pairs | Median error (deg) | P90 error (deg) | % within 30 deg |
| --- | --- | --- | --- | --- |
| 5-10 m | 17,620 | 3.3 | 18.0 | 96.3% |
| 10-25 m | 63,071 | 2.5 | 25.5 | 92.1% |
| 25-50 m | 101,480 | 2.1 | 19.4 | 95.1% |
| 50-100 m | 70,092 | 1.4 | 9.9 | 99.1% |
| 100-200 m | 7,708 | 1.6 | 9.5 | 97.9% |
| > 200 m | 924 | 16.5 | 116.6 | 62.3% |

### What This Means

**The direction field is reliable and usable as-is for marker rotation.** With a median error of just 2.0 degrees for moves over 5m, the API's reported direction closely matches the actual bearing of travel. The 95.5% of fixes within 30 degrees means marker arrows/icons will point the right way almost all the time.

**Direction is integer-only (1-degree resolution).** All 977,707 values are whole numbers. This is fine for visual display -- 1-degree steps are imperceptible on a map marker.

**Edge cases to handle:**
- **Values -2 to -1 and 360:** These appear 1,360 times total (0.14%). The code should normalize direction to 0-359 before using it (e.g., `((dir % 360) + 360) % 360`).
- **75% of consecutive fixes have the same direction:** This is consistent with the 62% stale-fix rate plus the fact that buses on straight roads legitimately maintain heading. Direction should not change during stale fixes.
- **Bearing error spikes for >200m jumps:** The 62.3% within-30-degrees rate and 116.6 P90 error for large jumps confirms these are discontinuities (route jumps or GPS glitches), not smooth travel. Direction is unreliable during teleportation events.

**For map animation:** Use the API direction field directly for marker rotation. Animate direction changes smoothly (slerp over ~300ms) to avoid jarring 1-degree steps from looking robotic. During stale-fix periods (direction unchanged), keep the marker pointing in the last reported direction.

---

## 6. Route Geographic Coverage

### 6.1 Per-Route Bounding Boxes

| Route | Records | Buses | N-S span (km) | E-W span (km) | Bbox area (km^2) |
| --- | --- | --- | --- | --- | --- |
| 1 | 96,315 | 12 | 12.27 | 10.10 | 123.9 |
| 2 | 50,821 | 8 | 7.10 | 6.98 | 49.5 |
| 3 | 62,987 | 9 | 7.15 | 7.56 | 54.1 |
| 4 | 54,785 | 7 | 7.01 | 6.03 | 42.2 |
| 5 | 60,649 | 8 | 5.34 | 8.51 | 45.4 |
| 6 | 71,143 | 9 | 3.14 | 9.18 | 28.8 |
| 7 | 18,956 | 2 | 4.47 | 6.57 | 29.4 |
| 8 | 9,127 | 1 | 1.82 | 2.42 | 4.4 |
| 11 | 40,305 | 6 | 5.52 | 8.00 | 44.2 |
| 12 | 84,439 | 12 | 6.38 | 7.15 | 45.6 |
| 13 | 31,954 | 5 | 3.19 | 4.91 | 15.6 |
| 14 | 40,017 | 6 | 3.80 | 4.83 | 18.3 |
| 15 | 74,656 | 8 | 5.26 | 15.25 | 80.2 |
| 16 | 24,089 | 5 | 4.71 | 7.39 | 34.8 |
| 17 | 23,024 | 5 | 5.23 | 5.43 | 28.4 |
| 18 | 48,236 | 7 | 3.23 | 9.75 | 31.5 |
| 19 | 32,297 | 4 | 6.40 | 6.51 | 41.7 |
| 21 | 36,786 | 5 | 6.08 | 7.19 | 43.7 |
| 22 | 9,474 | 1 | 2.58 | 2.07 | 5.3 |
| 23 | 8,641 | 1 | 2.87 | 4.97 | 14.3 |
| 24 | 46,820 | 6 | 10.34 | 10.58 | 109.3 |
| 28 | 18,953 | 2 | 3.53 | 4.74 | 16.7 |
| 31 | 14,279 | 2 | 2.66 | 2.86 | 7.6 |
| 35 | 9,478 | 1 | 0.86 | 4.08 | 3.5 |
| 36 | 9,476 | 1 | 0.88 | 4.08 | 3.6 |

### 6.2 Route Overlap Analysis

Overlap is measured as the fraction of one route's bounding box that intersects with another's.

Grid: 162 x 180 cells (100m resolution)

**Top 20 most overlapping route pairs** (by % of smaller route's cells shared):

| Route A | Route B | Shared cells | Cells A | Cells B | Overlap % |
| --- | --- | --- | --- | --- | --- |
| 35 | 36 | 118 | 122 | 122 | 96.7% |
| 5 | 8 | 46 | 314 | 58 | 79.3% |
| 24 | 31 | 80 | 432 | 118 | 67.8% |
| 1 | 8 | 36 | 550 | 58 | 62.1% |
| 3 | 8 | 36 | 319 | 58 | 62.1% |
| 11 | 13 | 74 | 281 | 132 | 56.1% |
| 6 | 31 | 66 | 281 | 118 | 55.9% |
| 1 | 19 | 119 | 550 | 216 | 55.1% |
| 19 | 21 | 101 | 216 | 250 | 46.8% |
| 21 | 24 | 116 | 250 | 432 | 46.4% |
| 3 | 12 | 145 | 319 | 386 | 45.5% |
| 12 | 16 | 95 | 386 | 209 | 45.5% |
| 6 | 18 | 127 | 281 | 390 | 45.2% |
| 8 | 12 | 26 | 58 | 386 | 44.8% |
| 18 | 31 | 51 | 390 | 118 | 43.2% |
| 5 | 15 | 133 | 314 | 377 | 42.4% |
| 2 | 14 | 84 | 390 | 201 | 41.8% |
| 3 | 4 | 119 | 319 | 288 | 41.3% |
| 1 | 6 | 116 | 550 | 281 | 41.3% |
| 12 | 17 | 62 | 386 | 152 | 40.8% |

### 6.3 Bus Density -- Highest Activity Grid Cells

Total 100m grid cells with at least 1 fix: **2,993** out of 29,160 total

**Top 20 highest-density cells** (100m x 100m):

| Rank | Fixes | Approx location (lat, lng) | Routes present |
| --- | --- | --- | --- |
| 1 | 20,957 | 64.10988, -21.84305 | 1, 2, 3, 4, 11, 12, 17, 21, 24 |
| 2 | 15,856 | 64.14861, -21.92741 | 1, 4, 11, 16, 17, 18 |
| 3 | 12,899 | 64.12339, -21.78749 | 1, 6, 31 |
| 4 | 11,070 | 64.10988, -21.84099 | 2, 3, 4, 11, 12, 17, 19, 21, 24 |
| 5 | 9,361 | 64.14771, -21.93564 | 1, 2, 3, 6, 11, 12, 13, 14 |
| 6 | 8,742 | 64.11168, -21.90889 | 1, 2, 4, 28, 35, 36 |
| 7 | 8,485 | 64.15582, -21.94182 | 3, 14 |
| 8 | 7,102 | 64.15042, -21.79161 | 7, 18, 24 |
| 9 | 6,994 | 64.14141, -21.94593 | 1, 2, 3, 6, 12 |
| 10 | 6,716 | 64.13870, -21.93976 | 1, 2, 3, 5, 6, 8, 12, 15 |
| 11 | 6,623 | 64.15402, -21.65786 | 15 |
| 12 | 6,213 | 64.14771, -21.92741 | 1, 4, 16, 17, 18 |
| 13 | 6,199 | 64.06753, -21.95828 | 1, 19, 21, 24 |
| 14 | 5,883 | 64.09006, -21.92947 | 1, 22, 23, 24 |
| 15 | 5,646 | 64.12429, -21.82247 | 1, 3, 5, 6, 15, 18, 24 |
| 16 | 5,537 | 64.12339, -21.78955 | 1, 6, 18, 31 |
| 17 | 5,216 | 64.13780, -21.93358 | 1, 3, 5, 8, 15 |
| 18 | 5,140 | 64.15582, -21.86774 | 4, 11, 12 |
| 19 | 4,840 | 64.14501, -21.91507 | 1, 2, 4, 5, 12, 14, 15, 16, 17, 18 |
| 20 | 4,454 | 64.04321, -21.95622 | 1 |

**Distribution of fixes per occupied cell:**

| Percentile | Fixes in cell |
| --- | --- |
| P10 | 8 |
| P25 | 48 |
| P50 | 139 |
| P75 | 311 |
| P90 | 666 |
| P95 | 1,094 |
| P99 | 3,295 |

### What This Means

**For speed limit matching:** Route overlap is significant -- the top-density cell at (64.10988, -21.84305) sees 9 different routes. This is likely a major bus hub or terminal (Mjodd or Hlemmur). Speed limit lookups here will always hit the same road segments, so caching speed limits by grid cell would be highly effective. The 2,993 occupied cells mean a precomputed lookup table of (cell -> nearest road segment -> speed limit) would need under 3,000 entries and eliminate runtime spatial queries for 100% of bus positions.

**For speed limit matching search radius:** The 100m grid resolution shows that buses occupy only 10.3% of the total bounding-box area. The bus network follows roads, not a uniform distribution. The speed limit matching algorithm's 50m search radius (from the spec) is appropriate -- buses should always be within 50m of a road centerline since they are, by definition, driving on roads. The few outliers beyond 50m would be GPS glitches or depot locations.

**Route 1 is the dominant route** with 96K records, 12 buses, and a 124 km^2 bounding box. It reaches the farthest corners of the network. Routes 35 and 36 are nearly identical (96.7% overlap) -- they likely share the same physical path with minor terminus differences.

---

## 7. Large Position Jumps (> 200m Between Consecutive Fixes)

Total jumps > 200m: **924**

### 7.1 Jump Distance Distribution

| Distance range | Count | % |
| --- | --- | --- |
| 200-500 m | 593 | 64.2% |
| 500-1000 m | 93 | 10.1% |
| 1-2 km | 59 | 6.4% |
| 2-5 km | 111 | 12.0% |
| 5-10 km | 61 | 6.6% |
| > 10 km | 7 | 0.8% |

### 7.2 Time Gap During Jumps

| Percentile | Time gap (s) |
| --- | --- |
| P1 | 2.0 |
| P10 | 3.0 |
| P25 | 5.0 |
| P50 | 13.0 |
| P75 | 74.0 |
| P90 | 10260.0 |
| P99 | 19592.8 |

### 7.3 Buses with Most Jumps

| Bus | Jumps > 200m | Largest jump (m) |
| --- | --- | --- |
| 31-B | 176 | 1,610 |
| 2-A | 55 | 7,592 |
| 2-C | 25 | 7,741 |
| 23-A | 24 | 4,445 |
| 2-B | 15 | 4,161 |
| 15-E | 12 | 11,650 |
| 15-B | 12 | 3,927 |
| 12-A | 12 | 2,662 |
| 1-B | 11 | 11,373 |
| 6-B | 11 | 6,184 |
| 15-A | 10 | 13,871 |
| 24-B | 10 | 9,577 |
| 6-A | 10 | 7,253 |
| 21-B | 10 | 6,232 |
| 28-B | 10 | 2,298 |

### 7.4 Top 20 Largest Jumps

| Rank | Bus | Route | Distance | Time gap | Implied speed | From -> To |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 15-A | 15 | 13.87 km | 10260 s | 5 km/h | (64.1611, -21.6817) -> (64.1430, -21.9648) |
| 2 | 15-C | 15 | 12.74 km | 10260 s | 4 km/h | (64.1377, -21.9540) -> (64.1691, -21.7012) |
| 3 | 1-I | 1 | 12.70 km | 18842 s | 2 km/h | (64.0424, -21.9756) -> (64.1229, -21.7902) |
| 4 | 15-D | 15 | 12.19 km | 10260 s | 4 km/h | (64.1433, -21.9072) -> (64.1539, -21.6569) |
| 5 | 1-D | 1 | 11.67 km | 10260 s | 4 km/h | (64.1482, -21.9346) -> (64.0436, -21.9567) |
| 6 | 15-E | 15 | 11.65 km | 7969 s | 5 km/h | (64.1354, -21.9567) -> (64.1654, -21.7265) |
| 7 | 1-B | 1 | 11.37 km | 10260 s | 4 km/h | (64.0490, -21.9832) -> (64.1484, -21.9273) |
| 8 | 1-C | 1 | 9.92 km | 10260 s | 3 km/h | (64.0511, -21.9800) -> (64.1329, -21.8987) |
| 9 | 24-B | 24 | 9.58 km | 7969 s | 4 km/h | (64.0897, -21.9299) -> (64.1494, -21.7877) |
| 10 | 1-D | 1 | 9.57 km | 7969 s | 4 km/h | (64.1460, -21.9402) -> (64.0605, -21.9625) |
| 11 | 5-E | 5 | 8.96 km | 7969 s | 4 km/h | (64.1026, -21.7668) -> (64.1374, -21.9332) |
| 12 | 15-C | 15 | 8.36 km | 7969 s | 4 km/h | (64.1240, -21.8151) -> (64.1539, -21.6569) |
| 13 | 3-D | 3 | 8.25 km | 7969 s | 4 km/h | (64.1558, -21.9454) -> (64.0959, -21.8452) |
| 14 | 3-C | 3 | 8.12 km | 7969 s | 4 km/h | (64.1020, -21.8251) -> (64.1514, -21.9485) |
| 15 | 6-H | 6 | 8.01 km | 5 s | 5770 km/h | (64.1238, -21.7878) -> (64.1424, -21.9473) |
| 16 | 1-K | 1 | 7.98 km | 21336 s | 1 km/h | (64.1117, -21.9086) -> (64.0433, -21.9580) |
| 17 | 6-C | 6 | 7.87 km | 7969 s | 4 km/h | (64.1456, -21.7738) -> (64.1474, -21.9362) |
| 18 | 5-D | 5 | 7.74 km | 7969 s | 3 km/h | (64.1378, -21.9333) -> (64.1115, -21.7856) |
| 19 | 2-C | 2 | 7.74 km | 10260 s | 3 km/h | (64.1447, -21.9068) -> (64.0847, -21.8260) |
| 20 | 5-B | 5 | 7.74 km | 7969 s | 3 km/h | (64.1377, -21.9335) -> (64.1115, -21.7857) |

### 7.5 Jump Classification

Plausible travel (implied speed <= 90 km/h): **510** (55.2%)
Suspicious (90-200 km/h): **198** (21.4%)
GPS glitch (> 200 km/h): **216** (23.4%)

### What This Means

**The original 500m outlier threshold would miss 64% of anomalous jumps.** The majority of >200m jumps (593 out of 924) fall in the 200-500m range. A distance-only threshold fails because a 300m jump could be either a legitimate 10-second gap at 108 km/h or a GPS glitch. The implied-speed approach is strictly better: classify by `distance / time_gap` rather than distance alone.

**Recommended outlier detection:**
- Implied speed > 120 km/h: reject as GPS glitch (city buses cannot exceed this)
- Distance > 200m AND time gap < 5s: reject (impossible acceleration)
- Distance > 2km AND time gap < 60s: reject (route teleportation)
- Everything else with time gap > 60s: accept as a reporting gap (bus was moving during the gap, we just don't have the intermediate fixes)

**Bus 31-B is an extreme outlier** with 176 jumps (19% of all jumps from a single bus). Its maximum jump is only 1,610m, suggesting it has a faulty GPS that intermittently drops out and reconnects. Consider flagging buses with anomalous jump rates for reduced trust in speed calculations.

**The 5770 km/h jump (rank 15, bus 6-H) is the most dramatic glitch**: 8.01 km in 5 seconds. This is a textbook GPS multipath error or satellite reacquisition spike. The time gap of 5 seconds proves the API was actively tracking this bus, so the position itself is wrong, not just delayed.

**For map animation:** When a large jump is detected (>200m in <5s), the marker should teleport instantly rather than animate. Animating a 5770 km/h trajectory would cause the marker to streak across the map. Reset the Kalman filter state at the new position and begin predicting from there.

---

## 8. Position Repetition

### 8.1 Exact Position Repeats Per Bus

Total consecutive exact-position repeats: **604,095** out of 977,579 pairs (**61.8%**)

**Top 15 buses by repeat rate:**

| Bus | Total pairs | Exact repeats | Repeat % |
| --- | --- | --- | --- |
| 99-A | 6,817 | 6,817 | 100.0% |
| 31-B | 6,888 | 6,421 | 93.2% |
| 19-C | 9,475 | 8,069 | 85.2% |
| 6-G | 9,119 | 7,522 | 82.5% |
| 1-J | 9,133 | 7,395 | 81.0% |
| 24-D | 9,090 | 7,184 | 79.0% |
| 4-G | 9,183 | 7,185 | 78.2% |
| 12-J | 3,069 | 2,255 | 73.5% |
| 19-A | 9,477 | 6,915 | 73.0% |
| 12-K | 3,867 | 2,817 | 72.8% |
| 1-I | 3,777 | 2,733 | 72.4% |
| 21-B | 9,477 | 6,857 | 72.4% |
| 24-B | 9,181 | 6,613 | 72.0% |
| 2-F | 2,941 | 2,114 | 71.9% |
| 36-A | 9,475 | 6,745 | 71.2% |

**Distribution of per-bus repeat rates:**

| Percentile | Repeat % |
| --- | --- |
| P10 | 49.1% |
| P25 | 56.3% |
| P50 | 63.2% |
| P75 | 65.3% |
| P90 | 71.9% |
| P99 | 91.0% |

### 8.2 Fleet-Wide "Favorite" Positions (Likely Bus Stops or Terminals)

Total unique (lat,lng) pairs in dataset: **372,264**
Records per unique position -- mean: **2.6**

**Top 30 most-reported exact positions:**

| Rank | Lat | Lng | Times reported | Distinct buses | Routes |
| --- | --- | --- | --- | --- | --- |
| 1 | 64.1234432 | -21.7875538 | 6,818 | 1 | 1 |
| 2 | 64.1095983 | -21.8416500 | 4,703 | 1 | 19 |
| 3 | 64.1372500 | -21.9341000 | 642 | 1 | 5 |
| 4 | 64.0593617 | -21.9833833 | 522 | 1 | 21 |
| 5 | 64.1097517 | -21.8425333 | 519 | 2 | 2 |
| 6 | 64.0593733 | -21.9757667 | 480 | 2 | 21 |
| 7 | 64.1260167 | -21.9491667 | 397 | 1 | 12 |
| 8 | 64.0526117 | -21.9729667 | 386 | 1 | 19 |
| 9 | 64.1416500 | -21.9467333 | 323 | 1 | 2 |
| 10 | 64.0595333 | -21.9747167 | 311 | 1 | 21 |
| 11 | 64.1260033 | -21.9491333 | 308 | 1 | 12 |
| 12 | 64.1097333 | -21.8422667 | 307 | 2 | 2 |
| 13 | 64.1115300 | -21.9084667 | 295 | 1 | 36 |
| 14 | 64.0593850 | -21.9833667 | 288 | 1 | 21 |
| 15 | 64.1235933 | -21.8944000 | 286 | 1 | 13 |
| 16 | 64.1260283 | -21.9491333 | 260 | 1 | 12 |
| 17 | 64.0769200 | -21.9366833 | 260 | 1 | 19 |
| 18 | 64.0896683 | -21.9299167 | 252 | 1 | 24 |
| 19 | 64.0769133 | -21.9366667 | 249 | 1 | 19 |
| 20 | 64.1097167 | -21.8410333 | 238 | 1 | 21 |
| 21 | 64.0768617 | -21.9367167 | 237 | 1 | 19 |
| 22 | 64.0768733 | -21.9366667 | 236 | 1 | 19 |
| 23 | 64.0768850 | -21.9367500 | 219 | 1 | 19 |
| 24 | 64.1117933 | -21.9082667 | 212 | 1 | 28 |
| 25 | 64.1259183 | -21.9491500 | 200 | 1 | 12 |
| 26 | 64.1456367 | -21.7737667 | 200 | 1 | 7 |
| 27 | 64.1096983 | -21.8425667 | 199 | 1 | 12 |
| 28 | 64.1115433 | -21.9084333 | 196 | 1 | 36 |
| 29 | 64.1117783 | -21.9083167 | 195 | 1 | 28 |
| 30 | 64.1500350 | -21.7909167 | 188 | 1 | 24 |

### 8.3 Position Frequency Distribution

| Percentile | Times position appears |
| --- | --- |
| P50 | 2 |
| P75 | 3 |
| P90 | 4 |
| P95 | 4 |
| P99 | 9 |
| P99.9 | 61 |

| Category | Count | % of unique positions |
| --- | --- | --- |
| Used exactly once | 94,866 | 25.5% |
| Used > 1 time | 277,398 | 74.5% |
| Used >= 10 times | 3,362 | 0.9% |
| Used >= 50 times | 792 | 0.2% |

### 8.4 Multi-Bus Positions (Same Exact Coordinates from Different Buses)

Positions reported by more than 1 bus: **195**

**Top 20 positions visited by most distinct buses:**

| Rank | Lat | Lng | Distinct buses | Total reports | Routes |
| --- | --- | --- | --- | --- | --- |
| 1 | 64.1335567 | -21.8501667 | 3 | 15 | 12 |
| 2 | 64.0556300 | -21.9801000 | 3 | 10 | 21 |
| 3 | 64.1473533 | -21.9359667 | 3 | 8 | 2, 13 |
| 4 | 64.1097517 | -21.8425333 | 2 | 519 | 2 |
| 5 | 64.0593733 | -21.9757667 | 2 | 480 | 21 |
| 6 | 64.1097333 | -21.8422667 | 2 | 307 | 2 |
| 7 | 64.1260567 | -21.9491000 | 2 | 148 | 12 |
| 8 | 64.1464400 | -21.9553333 | 2 | 71 | 13 |
| 9 | 64.0677133 | -21.9574167 | 2 | 65 | 19, 21 |
| 10 | 64.1208150 | -21.8121667 | 2 | 62 | 12 |
| 11 | 64.0525133 | -21.9739833 | 2 | 60 | 19 |
| 12 | 64.0677183 | -21.9574833 | 2 | 57 | 19, 21 |
| 13 | 64.1097250 | -21.8414167 | 2 | 55 | 21 |
| 14 | 64.0678667 | -21.9578833 | 2 | 38 | 19, 21 |
| 15 | 64.0741083 | -21.9140667 | 2 | 32 | 21 |
| 16 | 64.1454100 | -21.8570667 | 2 | 25 | 12 |
| 17 | 64.0757400 | -21.9420167 | 2 | 25 | 21 |
| 18 | 64.1007617 | -21.8887333 | 2 | 21 | 21, 24 |
| 19 | 64.0853533 | -21.8185000 | 2 | 19 | 2 |
| 20 | 64.0672917 | -21.9487333 | 2 | 19 | 21 |

### What This Means

**For data deduplication:** The 61.8% stale-fix rate is the dominant storage optimization opportunity. There are two deduplication strategies, each with tradeoffs:

1. **Drop consecutive identical positions per bus (timestamp-aware).** This reduces the dataset from ~978K to ~374K records (62% reduction) while preserving the "last seen at this location at this time" signal. This is the recommended approach because it keeps temporal resolution for "when was this bus last active" queries.

2. **Drop all stale fixes globally.** Same 62% reduction, but also discard the information that the bus was still being tracked (just not moving). This loses the ability to distinguish "parked at depot" from "GPS offline."

**Multi-bus position sharing is rare (195 positions).** This means exact coordinate matches are almost always the same bus reporting stale data, not two buses at the same location. This confirms that deduplication keyed on (busId, lat, lng) is safe -- collisions between different buses are negligible.

**The top "favorite" positions are terminal/depot locations.** The #1 position (64.1234, -21.7876) with 6,818 reports from bus 99-A matches the longest stationary episode in section 4.3. Cross-referencing with the bus density map (section 6.3, rank 3: 64.12339, -21.78749), this is almost certainly the Mjodd bus terminal. The #2 position (64.1096, -21.8417) with 4,703 reports from bus 19-C is near the top density cell at Hlemmur (64.10988, -21.84305).

---

## Key Takeaways for Algorithm Design

### Kalman Filter Tuning

| Parameter | Recommended value | Rationale |
| --- | --- | --- |
| Measurement noise R (per axis) | 0.16 m^2 (sigma = 0.4m) | Measured median RMS is 0.64m; using 0.4m per axis is conservative |
| Process noise Q | Tune for 6-7s update intervals | Real position updates arrive every ~6s despite 2s polling |
| Stale-fix handling | Skip measurement update; predict only | 62% of fixes are exact duplicates with zero new information |
| Filter reset threshold | Implied speed > 120 km/h | 216 GPS glitches per day need hard resets, not smooth corrections |
| Minimum movement for update | 0.5m (not 10m) | GPS noise is 0.64m RMS, so 0.5m is below the noise floor. Anything above 0.5m could be real movement. The 10m threshold from the original spec was designed for 3-5m noise and is too aggressive. |

### Map Animation

| Concern | Recommendation | Rationale |
| --- | --- | --- |
| Stale-fix interpolation | Continue Kalman prediction at constant velocity | Bridges the ~6s gap between real updates; marker moves smoothly |
| Direction display | Use API direction field directly | 2-degree median accuracy; integer resolution is invisible on map |
| Direction smoothing | Slerp over ~300ms | Prevents robotic 1-degree steps from being visible |
| Teleportation detection | Distance >200m AND time <5s | Animate normally for slow large-distance moves; teleport for glitches |
| Default viewport | Center 64.1295, -21.8914, ~10km radius | Captures 97% of bus activity |

### Speed Limit Matching

| Concern | Recommendation | Rationale |
| --- | --- | --- |
| Search radius | 50m from bus position to road centerline | Buses drive on roads; GPS error is <2m at P99 |
| Spatial index | Grid at 100m resolution, 2,993 occupied cells | Precompute (cell -> road segment) for O(1) lookup |
| Caching | Cache by 100m grid cell | Top density cells see 20K+ fixes/day; identical lookups |
| Coverage | 10.3% of bounding box has bus activity | Only 2,993 cells need lookup tables, not 29,160 |

### Data Deduplication

| Strategy | Records kept | Reduction | Information lost |
| --- | --- | --- | --- |
| Raw (no dedup) | 977,707 | 0% | None |
| Drop stale fixes (recommended) | ~374,000 | 62% | "Still being tracked" signal for parked buses |
| Drop stale + subsample 5s | ~200,000 | 80% | Sub-5s temporal resolution |

### Outlier Rejection

| Rule | Catches | False positive risk |
| --- | --- | --- |
| Implied speed > 120 km/h | 216 GPS glitches/day | Near zero (buses cannot exceed 120) |
| Distance > 200m AND time < 5s | Short-range teleportation | Low; 200m in 5s = 144 km/h min |
| Consecutive identical positions >= 20 | Parked/offline buses | None if flagged rather than dropped |
| Bus with >50 jumps/day | Faulty GPS hardware (bus 31-B) | Flag for manual review, do not auto-reject |

---

*Analysis run on 2026-03-12T17:38:57.680Z against data/2026-03-11.jsonl*
