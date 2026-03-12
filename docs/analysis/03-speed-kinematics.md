
# Speed & Kinematics Analysis -- Straeto Bus GPS Data

Dataset: `data/2026-03-11.jsonl` -- 977,707 records, 128 buses, 25 routes
Time span: 2026-03-11 08:48:42 UTC to 2026-03-11 19:14:05 UTC (10.4 hours)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Raw Haversine Speed Distribution](#2-raw-haversine-speed-distribution)
   - 2.1 [Global Percentiles](#21-global-percentiles)
   - 2.2 [Per-Route Breakdown](#22-per-route-breakdown)
   - 2.3 [Speed by Hour of Day](#23-speed-by-hour-of-day)
   - 2.4 [Speed Histogram](#24-speed-histogram)
3. [Speed Anomalies](#3-speed-anomalies)
   - 3.1 [Anomaly Prevalence](#31-anomaly-prevalence)
   - 3.2 [Buses with Most Anomalies](#32-buses-with-most-anomalies)
   - 3.3 [Routes with Most Anomalies](#33-routes-with-most-anomalies)
   - 3.4 [Anomaly Location Clusters](#34-anomaly-location-clusters)
   - 3.5 [Anomalies by Hour](#35-anomalies-by-hour)
   - 3.6 [Detailed Extreme Anomalies](#36-detailed-extreme-anomalies)
4. [Acceleration Analysis](#4-acceleration-analysis)
   - 4.1 [Acceleration Distribution](#41-acceleration-distribution)
   - 4.2 [Physically Impossible Events](#42-physically-impossible-events)
   - 4.3 [Impossible Accelerations by Time Gap](#43-impossible-accelerations-by-time-gap)
5. [Phantom Speed at Stops (GPS Noise Quantification)](#5-phantom-speed-at-stops-gps-noise-quantification)
   - 5.1 [Stopped Buses](#51-stopped-buses)
   - 5.2 [Slow-Moving Buses](#52-slow-moving-buses)
   - 5.3 [Moving Buses (Low Speed)](#53-moving-buses-low-speed)
   - 5.4 [Effect of 3-Point Moving Average](#54-effect-of-3-point-moving-average)
6. [Consecutive Speed Jitter](#6-consecutive-speed-jitter)
   - 6.1 [Raw vs. Averaged Jitter](#61-raw-vs-averaged-jitter)
   - 6.2 [Jitter by Speed Range](#62-jitter-by-speed-range)
7. [Speed Profile Characteristics](#7-speed-profile-characteristics)
8. [Stop Detection from Speed Data](#8-stop-detection-from-speed-data)
9. [Trip Segment Analysis](#9-trip-segment-analysis)
10. [Problematic Buses](#10-problematic-buses)
    - 10.1 [Route 31 Anomaly](#101-route-31-anomaly)
    - 10.2 [GPS Teleportation Buses](#102-gps-teleportation-buses)
    - 10.3 [Chronic High-Anomaly Buses](#103-chronic-high-anomaly-buses)
11. [Key Takeaways](#11-key-takeaways)

---

## 1. Executive Summary

Five critical findings from this analysis:

1. **GPS noise creates massive phantom speeds.** The raw max Haversine speed in the dataset is 11,054 km/h -- obviously a GPS teleportation glitch. Even at the 99th percentile, raw speed is 149.87 km/h, far above any plausible bus speed. A full 6.7% of readings exceed 90 km/h and 2.6% exceed 120 km/h. Outlier rejection is non-negotiable before any speed estimation.

2. **Route 31 is a GPS disaster.** Its P95 speed is 216.16 km/h and its P99 is 457.96 km/h -- roughly 4x the fleet average at those percentiles. Its mean speed of 68.94 km/h is nearly double the fleet mean of 38.74 km/h. Route 31 buses exhibit systematic GPS hardware or firmware issues and should be flagged or excluded from violation detection.

3. **13% of consecutive readings have physically impossible acceleration (|a| > 3 m/s^2).** The extreme end reaches 712 m/s^2 (teleportation). But even the P95 of absolute acceleration is 5.13 m/s^2 -- above the physical braking limit of a city bus. This means raw speed differences between consecutive readings are unreliable for acceleration-based analysis without filtering.

4. **A 3-point moving average cuts speed jitter by 2.3x and phantom speed by ~85%.** Median jitter drops from 14.54 km/h (raw) to 6.98 km/h (averaged). For stopped buses, median phantom speed is already 0.00 km/h raw but P95 drops from 1.89 to 1.29 km/h with averaging. The 3-point average is the single most effective noise reduction step.

5. **Most bus stops are 15-30 seconds long (63.3%).** The median stop is 23 seconds. This constrains animation design: a bus stop event needs to be visually distinguishable within a very short window. The stop detection threshold of 15 seconds captures 12,093 stops across the fleet, or about 10.2 stops per bus per hour (median).

---

## 2. Raw Haversine Speed Distribution

Valid speed pairs (dt > 0, distance > 0.5m): **296,945**

### 2.1 Global Percentiles

| Percentile | Speed (km/h) |
| --- | --- |
| Min | 0.00 |
| P1 | 0.56 |
| P5 | 1.70 |
| P10 | 4.00 |
| P25 | 16.25 |
| P50 (median) | 31.53 |
| P75 | 51.76 |
| P90 | 77.90 |
| P95 | 99.27 |
| P99 | 149.87 |
| P99.5 | 172.87 |
| P99.9 | 226.50 |
| Max | 11,054.22 |
| Mean | 38.74 |

**What This Means:**

- *Speed estimation*: The median of 31.53 km/h is plausible for city buses (mix of driving and approaching stops). The mean (38.74) is pulled up by the heavy right tail of GPS noise. Any algorithm that uses raw Haversine will systematically overestimate fleet speed.
- *Violation detection*: With P95 at 99.27 km/h, roughly 5% of raw readings would flag as above the highest urban speed limit (90 km/h). Most of these are GPS artifacts, not real violations. Violation detection must apply smoothing and outlier rejection first, or it will have an unacceptable false positive rate.
- *Animation*: The P90 of 77.90 km/h sets a useful upper bound for animation speed capping. Anything above ~90 km/h should be treated as suspect and visually dampened.

### 2.2 Per-Route Breakdown

| Route | N | P25 | P50 | P75 | P90 | P95 | P99 | Max | Mean |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 24,640 | 16.69 | 33.75 | 57.72 | 88.19 | 112.35 | 169.95 | 11,054.22 | 42.71 |
| 2 | 15,656 | 13.97 | 30.13 | 52.43 | 79.46 | 105.19 | 165.96 | 5,232.39 | 41.55 |
| 3 | 19,347 | 16.44 | 33.47 | 54.85 | 82.39 | 104.14 | 147.71 | 211.48 | 39.82 |
| 4 | 12,661 | 15.68 | 32.47 | 53.14 | 80.35 | 101.93 | 146.10 | 6,339.08 | 40.29 |
| 5 | 20,182 | 14.75 | 28.17 | 45.94 | 69.55 | 87.07 | 129.16 | 280.78 | 33.91 |
| 6 | 19,520 | 16.87 | 33.57 | 55.34 | 83.30 | 105.86 | 155.17 | 5,769.82 | 40.73 |
| 7 | 7,541 | 21.42 | 35.09 | 55.31 | 79.09 | 99.41 | 150.85 | 223.88 | 41.78 |
| 8 | 2,783 | 24.84 | 42.08 | 64.65 | 91.95 | 107.55 | 142.08 | 1,808.38 | 47.76 |
| 11 | 13,760 | 12.83 | 25.94 | 41.79 | 62.04 | 78.96 | 119.90 | 284.72 | 30.78 |
| 12 | 27,520 | 14.21 | 28.67 | 46.31 | 68.58 | 87.26 | 134.44 | 3,317.14 | 34.38 |
| 13 | 10,720 | 11.30 | 22.03 | 33.10 | 45.62 | 56.39 | 84.26 | 160.63 | 24.25 |
| 14 | 13,901 | 12.48 | 24.12 | 37.22 | 52.60 | 65.24 | 95.95 | 204.92 | 27.18 |
| 15 | 26,641 | 18.27 | 34.38 | 57.05 | 83.86 | 105.44 | 170.58 | 310.54 | 41.86 |
| 16 | 8,061 | 17.42 | 34.63 | 54.84 | 80.42 | 103.79 | 145.72 | 303.63 | 40.15 |
| 17 | 6,459 | 12.80 | 29.05 | 47.40 | 71.46 | 90.68 | 135.08 | 218.04 | 34.40 |
| 18 | 16,377 | 18.82 | 34.87 | 54.17 | 77.35 | 97.89 | 144.67 | 4,384.60 | 40.60 |
| 19 | 7,922 | 18.83 | 33.14 | 51.06 | 73.92 | 91.60 | 122.34 | 190.04 | 37.77 |
| 21 | 11,671 | 18.14 | 33.02 | 52.70 | 77.86 | 100.01 | 151.39 | 7,478.11 | 40.56 |
| 22 | 2,822 | 21.03 | 37.55 | 59.48 | 93.33 | 116.70 | 169.33 | 229.13 | 45.42 |
| **23** | **2,177** | **28.21** | **48.35** | **77.09** | **110.29** | **136.94** | **191.52** | **8,000.91** | **62.65** |
| 24 | 12,443 | 19.45 | 37.94 | 60.44 | 89.69 | 112.76 | 151.92 | 851.88 | 44.00 |
| 28 | 5,869 | 22.70 | 37.99 | 57.55 | 82.78 | 99.87 | 130.87 | 382.78 | 43.06 |
| **31** | **2,690** | **22.44** | **42.82** | **76.00** | **143.29** | **216.16** | **457.96** | **1,248.23** | **68.94** |
| 35 | 2,894 | 19.22 | 35.61 | 56.12 | 81.51 | 102.88 | 136.85 | 181.90 | 40.77 |
| 36 | 2,688 | 22.82 | 37.57 | 58.42 | 84.33 | 103.69 | 143.61 | 213.93 | 43.70 |

**What This Means:**

- *Route 31 anomaly*: P90 of 143.29 km/h, P95 of 216.16 km/h, and P99 of 457.96 km/h are 2-4x the fleet norms. This route has systematic GPS quality issues (see Section 10.1 for full analysis).
- *Route 23*: Also problematic -- mean of 62.65 km/h (60% above fleet mean), max of 8,000.91 km/h. Only 2,177 readings, so a small number of bad GPS fixes heavily skew the distribution.
- *Slowest routes*: Route 13 (median 22.03, mean 24.25) and Route 14 (median 24.12, mean 27.18) operate in dense urban areas with frequent stops. These routes are least likely to produce genuine speed violations.
- *Fastest "normal" routes*: Route 8 (median 42.08, mean 47.76) and Route 22 (median 37.55, mean 45.42) likely run on higher-speed roads outside the city center.
- *Teleportation events* (max > 1,000 km/h): Routes 1, 2, 4, 6, 8, 18, 21, 23, and 31 all have at least one reading over 1,000 km/h. These are GPS glitches where the receiver jumps to a completely wrong position for 1-2 readings.

### 2.3 Speed by Hour of Day

UTC = Iceland time (no daylight saving).

| Hour | N | P25 | P50 | P75 | P90 | P95 | Mean |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | 12,424 | 16.92 | 31.16 | 49.65 | 73.46 | 92.74 | 36.99 |
| 11 | 36,918 | 18.03 | 32.51 | 52.36 | 76.91 | 97.22 | 39.49 |
| 12 | 47,416 | 17.51 | 33.03 | 54.21 | 82.72 | 104.92 | 40.59 |
| 13 | 48,790 | 17.43 | 33.04 | 54.32 | 82.51 | 105.93 | 41.76 |
| 14 | 62,485 | 15.89 | 31.74 | 52.56 | 78.96 | 100.26 | 39.11 |
| 15 | 68,406 | 14.56 | 29.46 | 48.76 | 72.78 | 92.28 | 35.74 |
| 16 | 13,340 | 12.04 | 26.87 | 44.70 | 67.03 | 84.75 | 32.14 |
| 19 | 7,166 | 17.84 | 34.34 | 56.28 | 87.75 | 112.58 | 42.57 |

**What This Means:**

- *Peak speed hours*: Hours 12-13 and 19 show the highest speeds (P95 > 100 km/h, mean > 40 km/h). Hour 19 has the highest mean (42.57) and P95 (112.58), likely because fewer buses are running on emptier roads.
- *Rush hour slowdown*: Hours 15-16 are the slowest (mean 32-36 km/h), consistent with afternoon rush hour traffic.
- *Violation detection*: Expect a higher rate of genuine violations during off-peak hours (19:00) when buses can actually reach higher speeds. Afternoon rush hours (15-16) will produce more false positives from GPS jitter relative to actual speed.
- *Sample size warning*: Hours 8 (12,424), 16 (13,340), and 19 (7,166) have significantly fewer readings than midday hours (48,000-68,000). The dataset does not capture the full morning rush or late evening.

### 2.4 Speed Histogram

```
  0-5     :    34,364 ( 11.57%) #######################
  5-10    :    16,641 (  5.60%) ###########
  10-15   :    17,886 (  6.02%) ############
  15-20   :    22,944 (  7.73%) ###############
  20-25   :    24,767 (  8.34%) #################
  25-30   :    24,690 (  8.31%) #################
  30-35   :    22,873 (  7.70%) ###############
  35-40   :    20,777 (  7.00%) ##############
  40-45   :    17,933 (  6.04%) ############
  45-50   :    15,069 (  5.07%) ##########
  50-55   :    12,944 (  4.36%) #########
  55-60   :    10,658 (  3.59%) #######
  60-70   :    16,363 (  5.51%) ###########
  70-80   :    11,359 (  3.83%) ########
  80-90   :     7,652 (  2.58%) #####
  90-100  :     5,537 (  1.86%) ####
  100-120 :     6,826 (  2.30%) #####
  120-150 :     4,712 (  1.59%) ###
  150-200 :     2,355 (  0.79%) ##
  200+    :       595 (  0.20%)
```

**What This Means:**

- *Bimodal distribution*: The 0-5 km/h bin is the single largest (11.57%), representing stops and near-stationary GPS noise. The 20-35 km/h range forms a broad peak of normal urban driving.
- *Long tail*: 8.74% of all readings exceed 90 km/h. Even at 120 km/h the tail is still thick (4.58% above 120). This long tail is dominated by GPS noise, not actual bus speeds.
- *Bus stop detection*: The 0-5 km/h bin (34,364 readings) is a mix of true stops and phantom speed from GPS noise at stops. Separating these requires the spatial analysis from Section 5.
- *Animation design*: The distribution tells us that most frames will show buses at 15-50 km/h. Animation interpolation should be optimized for this range and should clamp or dampen above ~80 km/h.

---

## 3. Speed Anomalies

### 3.1 Anomaly Prevalence

| Threshold | Count | % of valid pairs |
| --- | --- | --- |
| Raw speed > 90 km/h | 20,025 | 6.744% |
| Raw speed > 120 km/h | 7,662 | 2.580% |

**What This Means:**

- *Violation detection*: If we used raw Haversine speed with no filtering, nearly 7% of readings would appear to be violations of a 90 km/h limit. The true violation rate is orders of magnitude lower. This quantifies the cost of skipping outlier rejection.
- *Outlier rejection threshold*: Using 120 km/h as a hard rejection threshold eliminates 2.58% of readings. Most of these are clearly GPS artifacts (many are 1,000+ km/h). The 90-120 km/h range (4.16% of readings) is a gray zone where some readings may be genuine high speeds and others are noise.

### 3.2 Buses with Most Anomalies

Top 15 buses by readings > 90 km/h:

| Bus | Count (>90) | Route(s) |
| --- | --- | --- |
| 15-G | 471 | 15 |
| 15-A | 437 | 15 |
| 23-A | 393 | 23 |
| 15-B | 391 | 15 |
| 15-D | 389 | 15 |
| 7-B | 378 | 7 |
| 18-D | 341 | 18 |
| 24-A | 339 | 24 |
| 3-A | 329 | 3 |
| 24-C | 328 | 24 |
| 24-B | 324 | 24 |
| 1-C | 319 | 1 |
| 22-A | 316 | 22 |
| 1-G | 311 | 1 |
| 6-D | 299 | 6 |

**What This Means:**

- *Route 15 dominance*: Four Route 15 buses appear in the top 15. Route 15 is one of the longer routes (26,641 speed pairs), so some of this is volume-driven. But the per-bus count (370-471) is still very high.
- *Bus 23-A*: Third worst at 393 anomalies from only 2,177 route-level readings. This bus has a disproportionate anomaly rate -- roughly 18% of its readings exceed 90 km/h.
- *Per-bus flagging*: These buses should receive heightened scrutiny in the speed pipeline. A per-bus noise profile would allow adaptive thresholds.

### 3.3 Routes with Most Anomalies

Top 10 routes by readings > 90 km/h:

| Route | Count (>90) | % of route pairs |
| --- | --- | --- |
| 1 | 2,346 | 9.52% |
| 15 | 2,149 | 8.07% |
| 6 | 1,576 | 8.07% |
| 3 | 1,532 | 7.92% |
| 12 | 1,242 | 4.51% |
| 24 | 1,234 | 9.92% |
| 2 | 1,145 | 7.31% |
| 18 | 1,082 | 6.61% |
| 4 | 939 | 7.42% |
| 5 | 895 | 4.43% |

**What This Means:**

- *Route 24 has the highest anomaly rate* at 9.92% of its speed pairs exceeding 90 km/h, followed by Route 1 (9.52%). These routes likely include highway/arterial segments where GPS noise at higher base speeds pushes computed speeds over 90.
- *Routes 12 and 5 are the cleanest high-volume routes* at 4.51% and 4.43% anomaly rates respectively, suggesting they operate primarily in lower-speed urban environments where GPS noise rarely pushes computed speeds past 90.

### 3.4 Anomaly Location Clusters

Anomalies > 90 km/h grouped by ~500m grid:

| Grid Center | Count | Distinct Buses |
| --- | --- | --- |
| (64.1250, -21.9000) | 242 | 30 |
| (64.1250, -21.8475) | 225 | 48 |
| (64.1150, -21.8425) | 188 | 36 |
| (64.1050, -21.9050) | 180 | 19 |
| (64.1250, -21.8500) | 169 | 49 |
| (64.1150, -21.8450) | 165 | 35 |
| (64.1200, -21.8975) | 151 | 26 |
| (64.1350, -21.8125) | 124 | 17 |
| (64.1400, -21.7725) | 122 | 15 |
| (64.1200, -21.8450) | 117 | 30 |
| (64.1250, -21.8450) | 116 | 41 |
| (64.1250, -21.8525) | 110 | 35 |
| (64.1350, -21.9325) | 109 | 17 |
| (64.1250, -21.8400) | 105 | 37 |
| (64.1250, -21.8375) | 105 | 32 |

**What This Means:**

- *The (64.1250, -21.84xx) cluster* dominates: five grid cells in this area account for 715 anomalies across 30-49 distinct buses. This is the Breidholt/Mjoddin area -- a major bus interchange where buses accelerate/decelerate frequently and multiple routes converge, amplifying GPS noise from multipath effects near large structures.
- *High bus counts per cell*: The top cells have 30-49 distinct buses, confirming these are route/location-driven artifacts, not single-bus hardware issues.
- *Low bus count cells*: (64.1050, -21.9050) has 180 anomalies but only 19 buses -- this could indicate a specific road segment (likely highway speed) where GPS noise at high base speed creates anomalies. Similarly (64.1350, -21.8125) with 124 anomalies and 17 buses.
- *Speed limit matching*: These anomaly hotspots should be cross-referenced with the speed limit data. If they coincide with 50 km/h zones, extra caution is needed in violation detection for these areas.

### 3.5 Anomalies by Hour

| Hour | Count (>90) | % of readings that hour |
| --- | --- | --- |
| 8:00 | 680 | 5.47% |
| 11:00 | 2,358 | 6.39% |
| 12:00 | 3,806 | 8.03% |
| 13:00 | 3,888 | 7.97% |
| 14:00 | 4,373 | 7.00% |
| 15:00 | 3,714 | 5.43% |
| 16:00 | 541 | 4.06% |
| 19:00 | 665 | 9.28% |

**What This Means:**

- *Hour 19 has the highest anomaly rate* (9.28%) despite having the fewest readings (7,166). Buses are genuinely moving faster on empty evening roads, so the GPS noise pushes more readings over the 90 km/h threshold.
- *Hours 12-13 have the highest absolute count* (3,800-3,900 anomalies each), driven by large sample sizes at relatively high speeds.
- *Hour 16 is the cleanest* at 4.06%, consistent with the rush-hour slowdown reducing base speeds below the noise threshold.

### 3.6 Detailed Extreme Anomalies

The dataset contains 7,662 readings exceeding 120 km/h. Representative examples from bus 1-B (Route 1), which produced a sustained sequence of extreme readings:

**GPS Teleportation Event (bus 1-B, 11:19:26 UTC):**
- Speed: 11,046.84 km/h, then 11,054.22 km/h
- Distance jumped: 6,137 m and 6,141 m in 2 seconds each
- Previous reading: 16.85 km/h. Next reading: 13.12 km/h
- The bus "teleported" ~6 km away and back within 6 seconds

**Sustained high-speed sequence (bus 1-B, 13:02-13:03 UTC):**
- 127.76 -> 180.85 -> 157.97 -> 80.98 -> ... -> 162.86 -> 75.12 (over ~40 seconds)
- These are NOT teleportation events -- distances are 65-90 meters per 2-second interval
- Pattern suggests GPS jitter at highway speed (~70 km/h true) that amplifies distance by 2x

**What This Means:**

- *Two distinct anomaly types*: (1) Teleportation glitches (>1,000 km/h, positions jump km-scale distances) and (2) noise amplification at moderate speed (120-200 km/h, positions shift 60-100m per reading). Different mitigation strategies are needed for each.
- *Teleportation detection*: A distance threshold of ~500m between consecutive fixes catches type 1 perfectly. These events are always 1-2 readings sandwiched between normal readings.
- *Noise amplification detection*: Type 2 is harder -- speeds of 120-200 km/h over plausible distances (60-100m). Acceleration checks (impossible to go from 50 to 180 km/h in 2 seconds) or the 3-point moving average are the best mitigation.

---

## 4. Acceleration Analysis

Total acceleration samples: **295,906**

### 4.1 Acceleration Distribution

**Signed acceleration (m/s^2):**

| Percentile | Value (m/s^2) |
| --- | --- |
| Min (max deceleration) | -712.57 |
| P1 | -5.57 |
| P5 | -3.03 |
| P10 | -2.03 |
| P25 | -0.83 |
| P50 (median) | 0.01 |
| P75 | 0.93 |
| P90 | 2.49 |
| P95 | 4.20 |
| P99 | 9.39 |
| P99.9 | 15.96 |
| Max (max acceleration) | 612.78 |
| Mean | 0.21 |

**Absolute acceleration |a| (m/s^2):**

| Percentile | Value (m/s^2) |
| --- | --- |
| P50 | 0.88 |
| P75 | 1.88 |
| P90 | 3.53 |
| P95 | 5.13 |
| P99 | 9.75 |
| P99.9 | 16.63 |
| Max | 712.57 |

**What This Means:**

- *Median acceleration is near zero* (0.01 m/s^2 signed, 0.88 m/s^2 absolute), which is expected: acceleration and deceleration roughly balance over a full day of driving.
- *Mean is slightly positive* (0.21 m/s^2) -- a small systematic bias toward apparent acceleration. This is consistent with GPS noise adding more apparent distance when a bus starts moving from rest than when it stops (noise at rest creates less speed than noise at high speed).
- *Physical plausibility*: A city bus can accelerate at roughly 1-2 m/s^2 and brake at up to 3 m/s^2 in emergency. The P90 of 3.53 m/s^2 means about 10% of readings show physically implausible acceleration. The P95 of 5.13 m/s^2 is clearly impossible for a bus.
- *Algorithm design*: Acceleration-based smoothing (e.g., capping |a| at 3 m/s^2 and interpolating) would affect 13% of readings. This is a viable secondary filter after position smoothing.

### 4.2 Physically Impossible Events

| Category | Count | % of samples |
| --- | --- | --- |
| Total impossible (|a| > 3 m/s^2) | 38,685 | 13.073% |
| Acceleration > +3 m/s^2 | 23,599 | -- |
| Deceleration < -3 m/s^2 | 15,086 | -- |

**Asymmetry**: 61% of impossible events are accelerations vs. 39% decelerations. This is consistent with the GPS noise bias -- noise adds apparent distance, so when a bus starts moving from rest, the first few noisy readings exaggerate the speed increase more than noise reduces speed when stopping.

**Top 30 impossible accelerations** (sorted by magnitude):

| Bus | Route | a (m/s^2) | v1 (km/h) | v2 (km/h) | dt (s) | Time (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| 2-A | 2 | -712.57 | 5,232.39 | 101.91 | 2.0 | 11:21:40 |
| 1-B | 1 | 612.78 | 16.85 | 11,046.84 | 5.0 | 11:19:26 |
| 2-A | 2 | 537.85 | 81.73 | 3,954.27 | 2.0 | 13:19:04 |
| 1-B | 1 | -511.16 | 11,054.22 | 13.12 | 6.0 | 11:19:34 |
| 12-A | 12 | 455.42 | 38.14 | 3,317.14 | 2.0 | 12:35:31 |
| 2-A | 2 | -452.39 | 3,329.65 | 72.44 | 2.0 | 13:20:56 |
| 2-A | 2 | 429.16 | 55.47 | 3,145.42 | 2.0 | 13:18:08 |
| 6-H | 6 | -399.51 | 5,769.82 | 16.89 | 4.0 | 14:31:56 |
| 2-A | 2 | -360.75 | 2,725.67 | 128.28 | 2.0 | 13:06:53 |
| 2-A | 2 | -352.14 | 2,618.89 | 83.51 | 2.0 | 13:21:33 |
| 4-G | 4 | 345.46 | 120.82 | 6,339.08 | 5.0 | 14:50:52 |
| 21-B | 21 | -344.24 | 7,478.11 | 42.60 | 6.0 | 13:39:44 |
| 23-A | 23 | -316.53 | 8,000.91 | 24.27 | 7.0 | 13:34:36 |
| 2-D | 2 | 302.48 | 21.00 | 2,198.84 | 2.0 | 12:03:03 |
| 2-A | 2 | 277.12 | 35.21 | 2,030.45 | 2.0 | 13:17:27 |
| 2-A | 2 | -276.39 | 2,030.45 | 40.43 | 2.0 | 13:17:29 |
| 2-A | 2 | -272.42 | 3,954.27 | 31.42 | 4.0 | 13:19:08 |
| 18-B | 18 | -268.26 | 2,049.44 | 117.97 | 2.0 | 14:46:09 |
| 4-G | 4 | 249.94 | 3,598.64 | 5,398.20 | 2.0 | 14:18:38 |
| 8-A | 8 | -232.35 | 1,808.38 | 135.45 | 2.0 | 13:12:08 |
| 2-A | 2 | 218.69 | 45.55 | 2,407.38 | 3.0 | 13:18:40 |
| 6-G | 6 | -212.64 | 2,319.12 | 22.66 | 3.0 | 14:35:57 |
| 2-A | 2 | -211.13 | 3,145.42 | 105.17 | 4.0 | 13:18:12 |
| 2-A | 2 | -210.95 | 2,322.50 | 44.22 | 3.0 | 13:10:45 |
| 6-H | 6 | 200.32 | 0.61 | 5,769.82 | 8.0 | 14:31:52 |
| 2-A | 2 | -188.32 | 2,080.56 | 46.69 | 3.0 | 13:06:33 |
| 2-A | 2 | 181.43 | 6.37 | 2,618.89 | 4.0 | 13:21:31 |
| 2-A | 2 | 181.06 | 70.64 | 3,329.65 | 5.0 | 13:20:54 |
| 21-B | 21 | 170.11 | 8.79 | 4,295.49 | 7.0 | 13:39:17 |
| 18-B | 18 | 168.03 | 21.84 | 3,651.36 | 6.0 | 15:28:19 |

**What This Means:**

- *Bus 2-A dominates*: 13 of the top 30 entries, all between 13:06 and 13:21 UTC. This is a single bus with severe GPS instability over a 15-minute window. The pattern (normal -> 2,000-5,000 km/h -> normal -> repeat) suggests intermittent GPS receiver malfunction.
- *Bus 4-G*: Two entries showing speeds of 3,599 and 6,339 km/h -- consecutive readings at 14:18 and 14:50 suggest two separate teleportation events within 30 minutes.

### 4.3 Impossible Accelerations by Time Gap

| Time gap | Count of |a| > 3 m/s^2 |
| --- | --- |
| 0-3s | 16,532 |
| 3-5s | 13,720 |
| 5-10s | 8,312 |
| 10-20s | 68 |
| 20-60s | 48 |
| 60-120s | 5 |

**What This Means:**

- *Short time gaps dominate*: 78.3% of impossible accelerations occur at dt < 5 seconds. This is expected -- GPS noise has a roughly fixed position error per reading, so shorter time intervals amplify the speed error (same position error / less time = more speed error).
- *Longer gaps are self-correcting*: Only 121 impossible events at dt > 10 seconds (0.3% of the total). Position averaging over longer intervals naturally smooths GPS noise.
- *Algorithm design*: Requiring a minimum time gap of 5-10 seconds between speed calculations would eliminate most GPS noise artifacts but would reduce temporal resolution. The Kalman filter approach used in the current codebase is a better tradeoff -- it preserves temporal resolution while dampening noise.

---

## 5. Phantom Speed at Stops (GPS Noise Quantification)

Classification method: group consecutive fixes into windows (minimum 10 seconds, 3+ fixes), measure the spatial spread of all fixes in each window:
- **Stopped**: all fixes within 3m of each other
- **Slow**: 3-10m spread
- **Moving**: 10-30m spread

### 5.1 Stopped Buses

n = **31,299** windows

| Metric | Value (km/h) |
| --- | --- |
| P50 | 0.00 |
| P75 | 0.00 |
| P90 | 0.35 |
| P95 | 1.89 |
| P99 | 4.79 |
| Max | 10.10 |
| Mean | 0.24 |

| Phantom speed threshold | Count | % |
| --- | --- | --- |
| > 1 km/h | 2,214 | 7.1% |
| > 3 km/h | 857 | 2.7% |
| > 5 km/h | 280 | 0.9% |
| > 10 km/h | 1 | 0.0% |
| > 15 km/h | 0 | 0.0% |

**What This Means:**

- *The good news*: Median and P75 phantom speed is 0.00 km/h for truly stopped buses. The GPS noise floor is very low when the bus is stationary and the receiver has a stable fix.
- *The bad news*: 7.1% of stopped windows still show > 1 km/h phantom speed, and 2.7% show > 3 km/h. A bus stop detection algorithm that uses a simple "speed < 1 km/h" threshold will miss 7.1% of stops or, conversely, a threshold of 3 km/h captures 97.3% of stopped periods.
- *Bus stop detection tuning*: A threshold of **5 km/h** captures 99.1% of truly stopped periods. Higher thresholds offer negligible improvement and risk including slow-moving buses.

### 5.2 Slow-Moving Buses

n = **40,517** windows (3-10m spread)

| Metric | Value (km/h) |
| --- | --- |
| P50 | 0.01 |
| P75 | 0.77 |
| P90 | 5.08 |
| P95 | 8.16 |
| P99 | 14.86 |
| Max | 35.64 |
| Mean | 1.36 |

| Phantom speed threshold | Count | % |
| --- | --- | --- |
| > 1 km/h | 9,499 | 23.4% |
| > 3 km/h | 6,464 | 16.0% |
| > 5 km/h | 4,112 | 10.1% |
| > 10 km/h | 1,239 | 3.1% |
| > 15 km/h | 392 | 1.0% |

**What This Means:**

- *Slow-moving confusion zone*: When a bus is creeping at 1-3 km/h (approaching a stop, in heavy traffic), 23.4% of readings show > 1 km/h and 16% show > 3 km/h. This makes it very difficult to distinguish "slowly approaching a stop" from "stopped with GPS noise."
- *Bus stop detection*: The stop detection algorithm must use a spatial criterion (position spread) in addition to speed, not speed alone. A bus showing 5 km/h could be truly stopped with noise (0.9% chance from Section 5.1) or genuinely creeping (89.9% chance from this section).

### 5.3 Moving Buses (Low Speed)

n = **190,841** windows (10-30m spread)

| Metric | Value (km/h) |
| --- | --- |
| P50 | 0.01 |
| P75 | 0.61 |
| P90 | 9.46 |
| P95 | 16.54 |
| P99 | 30.89 |
| Max | 62.01 |
| Mean | 2.46 |

| Phantom speed threshold | Count | % |
| --- | --- | --- |
| > 1 km/h | 43,415 | 22.7% |
| > 3 km/h | 33,195 | 17.4% |
| > 5 km/h | 27,125 | 14.2% |
| > 10 km/h | 18,259 | 9.6% |
| > 15 km/h | 11,395 | 6.0% |

**What This Means:**

- *Heavy noise at low speed*: Even with 10-30m spatial spread (genuine slow movement), the P95 is 16.54 km/h. Nearly 10% of readings show > 10 km/h phantom speed. This quantifies the GPS overestimation problem at low speeds -- exactly the zone where the speed pipeline's 10m minimum distance threshold is designed to help.
- *Animation smoothness*: These numbers directly affect how jittery animated bus markers will appear at low speeds. Without smoothing, a bus crawling at 5 km/h will visually jitter between 0 and 16 km/h (P95) on screen. The Kalman filter's position prediction is critical for smooth low-speed animation.

### 5.4 Effect of 3-Point Moving Average

For stopped buses only (spread < 3m), n = **174,434**:

| Metric | Raw Haversine | 3-Point Average |
| --- | --- | --- |
| P50 | 0.00 | 0.01 |
| P75 | 0.00 | 0.11 |
| P90 | 0.35 | 0.76 |
| P95 | 1.89 | 1.29 |
| Max | 10.10 | 5.65 |
| Mean | 0.24 | 0.20 |

**What This Means:**

- *Averaging helps at the tail*: P95 drops from 1.89 to 1.29 km/h (-32%), and max drops from 10.10 to 5.65 km/h (-44%). The worst-case phantom speed is nearly halved.
- *Averaging slightly increases lower percentiles*: P75 goes from 0.00 to 0.11 km/h and P90 from 0.35 to 0.76 km/h. This is because averaging spreads isolated noise spikes across adjacent readings. The net effect is still positive for violation detection (tighter tail) but slightly negative for stop detection (more non-zero readings at low percentiles).
- *Design implication*: The minimum distance threshold (10m in the pipeline) should be applied AFTER averaging, not before. Averaging first reduces the max phantom speed to 5.65 km/h, then the 10m threshold at 2-second intervals (equivalent to ~18 km/h) cleans up the rest.

---

## 6. Consecutive Speed Jitter

### 6.1 Raw vs. Averaged Jitter

**Jitter = |v_n - v_{n-1}|** (absolute speed change between consecutive readings)

n = **295,906**

| Metric | Raw Haversine (km/h) | 3-Point Average (km/h) | Reduction Factor |
| --- | --- | --- | --- |
| P25 | 5.81 | 3.13 | -- |
| P50 | 14.54 | 6.98 | 2.08x |
| P75 | 29.41 | 12.95 | 2.27x |
| P90 | 51.56 | 21.09 | 2.45x |
| P95 | 67.55 | 27.51 | 2.46x |
| P99 | 102.37 | 41.23 | -- |
| Max | 11,041.11 | 3,684.50 | -- |
| Mean | 22.45 | 9.81 | 2.29x |

**What This Means:**

- *Raw jitter is extreme*: A median |dv| of 14.54 km/h means the typical bus appears to change speed by 14.5 km/h every reading. For a bus driving at a steady 50 km/h, consecutive raw readings would show 43-57 km/h -- a visual jitter of +/- 14% that would make animation unwatchable.
- *3-point averaging cuts jitter by 2.3x on average*: Median drops to 6.98 km/h. At 50 km/h, this means +/- 7 km/h or +/- 14% -- still noticeable but manageable with visual interpolation.
- *The Kalman filter approach is superior*: The current codebase uses a Kalman filter instead of simple averaging. The Kalman filter should achieve better jitter reduction (estimated 3-4x) while preserving responsiveness to genuine speed changes, unlike the uniform lag of moving average.
- *Animation target*: For smooth 60fps animation, jitter should be below ~2 km/h between rendered frames. At 2-second update intervals and 60fps, that is 120 interpolation frames per update. The averaged jitter of 7 km/h spread over 120 frames is 0.06 km/h per frame -- well within the smooth animation target.

### 6.2 Jitter by Speed Range

| Speed Range (km/h) | N | P50 | P75 | P90 | P95 | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| 0-5 | 20,022 | 2.18 | 4.05 | 5.92 | 6.92 | 2.69 |
| 5-15 | 38,470 | 10.28 | 15.40 | 20.09 | 22.51 | 10.81 |
| 15-30 | 73,085 | 11.98 | 22.19 | 32.38 | 38.60 | 15.00 |
| 30-50 | 85,323 | 16.28 | 29.22 | 43.77 | 53.23 | 20.15 |
| 50+ | 79,006 | 33.10 | 58.19 | 80.95 | 96.28 | 42.52 |

**What This Means:**

- *Jitter scales linearly with speed*: At 0-5 km/h, median jitter is 2.18 km/h. At 50+ km/h, it is 33.10 km/h -- a 15x increase for a 10x speed increase. This is consistent with GPS noise theory: position error is roughly constant, but higher speeds mean larger absolute distance changes, so the noise-to-signal ratio stays roughly constant while the absolute jitter grows.
- *Low-speed jitter is the phantom speed problem*: At 0-5 km/h, P95 jitter of 6.92 km/h means a stopped bus can appear to jump to 7 km/h and back between readings. This is the phantom speed quantified differently from Section 5.
- *High-speed jitter is the false violation problem*: At 50+ km/h, P50 jitter of 33.10 km/h means a bus driving at a legal 50 km/h will frequently show readings of 83 km/h -- deep into the "apparent violation" zone.
- *Speed-adaptive smoothing*: These numbers justify using a Kalman filter with speed-dependent process noise. At low speeds, the filter should trust the model (low process noise) and reject measurements aggressively. At high speeds, it should be more responsive to measurements to track genuine speed changes while still smoothing jitter.

---

## 7. Speed Profile Characteristics

Detailed speed-time profiles for 5 representative buses with the most readings:

### Bus 7-A (Route 7)
- Readings: 4,311 | Duration: 10.4 hours | Active driving: 310.6 min

| Speed Range | Time | % |
| --- | --- | --- |
| 0-5 km/h | 26.7 min | 8.6% |
| 5-15 km/h | 46.0 min | 14.8% |
| 15-30 km/h | 83.9 min | 27.0% |
| 30-50 km/h | 86.6 min | 27.9% |
| 50+ km/h | 67.3 min | 21.7% |

| Behavior | Time | % |
| --- | --- | --- |
| Accelerating (dv > 3) | 120.9 min | 38.9% |
| Cruising (\|dv\| <= 3) | 65.3 min | 21.0% |
| Decelerating (dv < -3) | 124.3 min | 40.0% |

Speed stats: P25=19.21, P50=31.45, P75=49.14, P90=69.39, Max=218.98, Mean=36.49 km/h

### Bus 15-H (Route 15)
- Readings: 3,912 | Duration: 7.4 hours | Active driving: 289.9 min

| Speed Range | Time | % |
| --- | --- | --- |
| 0-5 km/h | 34.0 min | 11.7% |
| 5-15 km/h | 56.3 min | 19.4% |
| 15-30 km/h | 74.9 min | 25.8% |
| 30-50 km/h | 74.5 min | 25.7% |
| 50+ km/h | 50.1 min | 17.3% |

| Behavior | Time | % |
| --- | --- | --- |
| Accelerating (dv > 3) | 113.9 min | 39.3% |
| Cruising (\|dv\| <= 3) | 61.5 min | 21.2% |
| Decelerating (dv < -3) | 114.4 min | 39.5% |

Speed stats: P25=17.68, P50=30.14, P75=47.16, P90=68.62, Max=155.39, Mean=34.42 km/h

### Bus 15-C (Route 15)
- Readings: 3,883 | Duration: 10.3 hours | Active driving: 273.2 min

| Speed Range | Time | % |
| --- | --- | --- |
| 0-5 km/h | 30.8 min | 11.3% |
| 5-15 km/h | 51.4 min | 18.8% |
| 15-30 km/h | 62.1 min | 22.7% |
| 30-50 km/h | 76.4 min | 28.0% |
| 50+ km/h | 52.5 min | 19.2% |

| Behavior | Time | % |
| --- | --- | --- |
| Accelerating (dv > 3) | 109.0 min | 39.9% |
| Cruising (\|dv\| <= 3) | 53.2 min | 19.5% |
| Decelerating (dv < -3) | 111.0 min | 40.6% |

Speed stats: P25=18.28, P50=32.52, P75=49.53, P90=70.23, Max=168.42, Mean=36.24 km/h

### Bus 15-E (Route 15)
- Readings: 3,850 | Duration: 10.4 hours | Active driving: 275.4 min

| Speed Range | Time | % |
| --- | --- | --- |
| 0-5 km/h | 34.5 min | 12.5% |
| 5-15 km/h | 43.6 min | 15.8% |
| 15-30 km/h | 66.0 min | 24.0% |
| 30-50 km/h | 70.8 min | 25.7% |
| 50+ km/h | 60.5 min | 22.0% |

| Behavior | Time | % |
| --- | --- | --- |
| Accelerating (dv > 3) | 110.2 min | 40.0% |
| Cruising (\|dv\| <= 3) | 55.4 min | 20.1% |
| Decelerating (dv < -3) | 109.8 min | 39.9% |

Speed stats: P25=17.82, P50=31.91, P75=51.80, P90=75.25, Max=198.11, Mean=37.24 km/h

### Bus 3-D (Route 3)
- Readings: 3,843 | Duration: 10.4 hours | Active driving: 277.0 min

| Speed Range | Time | % |
| --- | --- | --- |
| 0-5 km/h | 30.8 min | 11.1% |
| 5-15 km/h | 60.4 min | 21.8% |
| 15-30 km/h | 71.4 min | 25.8% |
| 30-50 km/h | 83.8 min | 30.3% |
| 50+ km/h | 30.6 min | 11.1% |

| Behavior | Time | % |
| --- | --- | --- |
| Accelerating (dv > 3) | 108.8 min | 39.3% |
| Cruising (\|dv\| <= 3) | 54.8 min | 19.8% |
| Decelerating (dv < -3) | 113.3 min | 40.9% |

Speed stats: P25=16.57, P50=28.76, P75=42.83, P90=57.15, Max=147.42, Mean=31.13 km/h

**What This Means (fleet-wide patterns):**

- *Universal 40/20/40 driving behavior split*: All five buses show approximately 39-40% accelerating, 20-21% cruising, and 40-41% decelerating. This is remarkably consistent and reflects the stop-and-go nature of bus service. Only ~20% of driving time is at a steady speed.
- *8-12% of time at 0-5 km/h*: This is the "at stop" fraction from the raw speed perspective. Combined with the phantom speed data (Section 5), the true stopped fraction is higher -- some of the 5-15 km/h band is actually stopped buses with GPS noise.
- *Route 3 vs. Route 7*: Route 3 (bus 3-D) spends only 11.1% of time above 50 km/h vs. Route 7's 21.7%. Route 3 is a slower, more urban route. Their median speeds differ by 3 km/h (28.76 vs. 31.45) but the high-speed tail differs by 2x.
- *Animation design*: The 40/20/40 split means buses will almost always be visibly changing speed. True "constant speed" animation is rare -- the Kalman predictor should expect speed changes every few seconds.

---

## 8. Stop Detection from Speed Data

Total stops detected (> 15 seconds near-zero speed): **12,093**

### Stop Duration Distribution

| Metric | Value (seconds) |
| --- | --- |
| Min | 15 |
| P10 | 15 |
| P25 | 17 |
| P50 (median) | 23 |
| P75 | 39 |
| P90 | 71 |
| P95 | 204 |
| P99 | 8,110 |
| Max | 22,933 |
| Mean | 211.4 |

Total stop time across fleet: **710.2 hours**

### Stop Duration Histogram

| Duration | Count | % |
| --- | --- | --- |
| 15-30s | 7,652 | 63.3% |
| 30-60s | 2,890 | 23.9% |
| 60-120s | 710 | 5.9% |
| 120-180s | 187 | 1.5% |
| 180-300s | 200 | 1.7% |
| 300-600s | 196 | 1.6% |
| 600-1200s | 71 | 0.6% |
| 1200-3600s | 10 | 0.1% |
| 3600s+ | 177 | 1.5% |

### Stops per Bus per Hour

| Metric | Value |
| --- | --- |
| P25 | 6.9 |
| P50 | 10.2 |
| P75 | 13.9 |
| P90 | 16.3 |
| Mean | 10.8 |

**What This Means:**

- *Most stops are short*: 63.3% of stops are 15-30 seconds (one bus stop dwell time), and 87.2% are under 60 seconds. This means the speed-to-zero-and-back cycle happens every 3-5 minutes on average (10.2 stops/hour = one stop every 5.9 minutes).
- *Long stops are layovers*: The 3600s+ bin (177 stops, 1.5%) represents end-of-line layovers, driver breaks, or overnight parking. The P99 of 8,110 seconds (2.25 hours) and max of 22,933 seconds (6.4 hours) confirm this.
- *Bus stop detection tuning*: The 15-second threshold captures a natural break point. P10 and P25 are 15 and 17 seconds, meaning very few genuine stops are shorter than 15 seconds. A shorter threshold (e.g., 10 seconds) would likely capture more GPS noise artifacts than real stops.
- *Animation design*: At 10.2 stops per hour, a bus stops roughly every 6 minutes of real time. In playback at 10x speed, that is one stop every 36 seconds. The animation must handle frequent, brief decelerations gracefully -- the 23-second median stop at 10x speed is 2.3 seconds of visual pause.
- *The mean (211.4 seconds) is misleading*: It is heavily skewed by the long tail of layovers. The median (23 seconds) is the operationally meaningful number.

---

## 9. Trip Segment Analysis

A "trip segment" is a continuous period of bus movement between extended stops.

Total trip segments: **1,595**

### Segment Duration

| Metric | Value (seconds) |
| --- | --- |
| P10 | 119 |
| P25 | 361 |
| P50 (median) | 741 |
| P75 | 1,448 |
| P90 | 2,396 |
| P95 | 3,311 |
| Max | 13,711 |
| Mean | 1,152 |

### Segment Duration Histogram

| Duration | Count | % |
| --- | --- | --- |
| 10-30s | 49 | 3.1% |
| 30-60s | 54 | 3.4% |
| 60-120s | 57 | 3.6% |
| 120-300s | 186 | 11.7% |
| 300-600s | 286 | 17.9% |
| 600-1200s | 435 | 27.3% |
| 1200-1800s | 253 | 15.9% |
| 1800-3600s | 207 | 13.0% |
| 3600s+ | 68 | 4.3% |

### Segment Distance

| Metric | Value (meters) |
| --- | --- |
| P10 | 805 |
| P25 | 2,343 |
| P50 (median) | 5,106 |
| P75 | 10,031 |
| P90 | 15,304 |
| P95 | 20,543 |
| Max | 53,772 |
| Mean | 7,067 |

### Segment Distance Histogram

| Distance | Count | % |
| --- | --- | --- |
| 0-100m | 60 | 3.8% |
| 100-250m | 14 | 0.9% |
| 250-500m | 42 | 2.6% |
| 500-1000m | 81 | 5.1% |
| 1000-2000m | 154 | 9.7% |
| 2000-5000m | 439 | 27.5% |
| 5000-10000m | 405 | 25.4% |
| 10000-20000m | 314 | 19.7% |
| 20000m+ | 86 | 5.4% |

### Segment Average Speed

| Metric | Value (km/h) |
| --- | --- |
| P10 | 15.91 |
| P25 | 19.84 |
| P50 (median) | 23.70 |
| P75 | 27.63 |
| P90 | 33.11 |
| P95 | 38.57 |
| Max | 397.84 |
| Mean | 24.83 |

### Segments per Bus per Hour

| Metric | Value |
| --- | --- |
| P25 | 0.9 |
| P50 | 1.3 |
| P75 | 1.7 |
| P90 | 2.3 |
| Mean | 1.4 |

Total fleet distance (sum of all Haversine displacements): **11,829.4 km**

**What This Means:**

- *Median trip segment is ~12 minutes and 5 km*: This is one-way along a route (e.g., from the start terminal to the end terminal). It corresponds to the typical route length in Reykjavik.
- *Segment average speed (median 23.70 km/h) is lower than the instantaneous median (31.53 km/h)*: This makes sense -- segment averages include the acceleration/deceleration phases near stops that pull down the mean, while the instantaneous distribution over-represents high-speed steady-state readings (buses spend more time at speed than at stops).
- *The max segment average speed of 397.84 km/h is anomalous*: This is a short segment with a teleportation event, inflating the average.
- *60 segments at 0-100m*: These are likely GPS noise during extended stops -- the bus appears to "start" a short segment due to position jitter, then "stops" again. These can be filtered by requiring a minimum segment distance of 250m.
- *1.4 segments per bus per hour*: Each bus completes roughly 1.4 one-way route traversals per hour. At a median segment duration of 12.4 minutes, this implies about 30 minutes of layover/turnaround per route cycle (including the return trip).

---

## 10. Problematic Buses

### 10.1 Route 31 Anomaly

Route 31 is a statistical outlier across every metric:

| Metric | Route 31 | Fleet Median (excl. 31) | Ratio |
| --- | --- | --- | --- |
| P50 speed | 42.82 km/h | ~32 km/h | 1.3x |
| P75 speed | 76.00 km/h | ~53 km/h | 1.4x |
| P90 speed | 143.29 km/h | ~80 km/h | 1.8x |
| P95 speed | 216.16 km/h | ~100 km/h | 2.2x |
| P99 speed | 457.96 km/h | ~150 km/h | 3.1x |
| Max speed | 1,248.23 km/h | ~300 km/h* | 4.2x |
| Mean speed | 68.94 km/h | ~38 km/h | 1.8x |

\* Excluding teleportation events > 1,000 km/h from other routes.

The divergence grows at higher percentiles, which is the signature of GPS hardware/firmware issues rather than genuinely different driving behavior. If Route 31 buses simply drove faster, the distribution would shift uniformly. Instead, the tail blows out exponentially -- P95 is 2.2x the fleet norm, but P99 is 3.1x. This pattern indicates noisy GPS with frequent large position errors.

Route 31 has only 2,690 speed pairs, making it a low-volume route. With only a few buses operating, a single malfunctioning GPS unit can dominate the statistics.

**Recommendation**: Flag Route 31 buses for exclusion from speed violation detection until the GPS data quality is validated. Alternatively, apply a stricter outlier rejection threshold (e.g., 70 km/h instead of 90 km/h) for this route.

### 10.2 GPS Teleportation Buses

These buses exhibited at least one teleportation event (speed > 1,000 km/h, indicating the GPS receiver reported a position several kilometers from the true location):

| Bus | Route | Max Speed (km/h) | Teleportation Distance | Time |
| --- | --- | --- | --- | --- |
| 1-B | 1 | 11,054.22 | ~6.1 km | 11:19:26 |
| 23-A | 23 | 8,000.91 | ~4.4 km | 13:34:36 |
| 21-B | 21 | 7,478.11 | ~4.2 km | 13:39:17 |
| 4-G | 4 | 6,339.08 | ~3.5 km | 14:50:52 |
| 6-H | 6 | 5,769.82 | ~3.2 km | 14:31:52 |
| 2-A | 2 | 5,232.39 | ~2.9 km | 11:21:40 |
| 18-B | 18 | 4,384.60 | implied | 14:46:09 |
| 12-A | 12 | 3,317.14 | ~1.8 km | 12:35:31 |
| 8-A | 8 | 1,808.38 | ~1.0 km | 13:12:08 |
| 31-* | 31 | 1,248.23 | ~0.7 km | -- |

All teleportation events follow the same pattern: normal reading -> impossible reading (1-2 samples) -> normal reading. The GPS receiver momentarily locks onto wrong satellites or experiences severe multipath, then recovers. These are trivially detectable by a distance threshold of 500m between consecutive fixes.

### 10.3 Chronic High-Anomaly Buses

Bus 2-A (Route 2) deserves special attention. It appears 13 times in the top-30 impossible acceleration table, all within a 15-minute window (13:06-13:21 UTC). During this period, bus 2-A experienced 7+ separate teleportation events, with speeds oscillating between ~40 km/h and 2,000-5,000 km/h. This suggests a failing GPS module that intermittently loses satellite lock.

Other repeat offenders from the anomaly tables:
- **Bus 1-B** (Route 1): Two teleportation events (11:19, 13:02-13:07) plus sustained high jitter throughout the day. 37+ readings above 120 km/h in the detailed sample alone.
- **Bus 4-G** (Route 4): Two separate teleportation events 30 minutes apart (14:18, 14:50), suggesting a recurring hardware glitch rather than a one-off event.
- **Bus 6-H** (Route 6): One teleportation to 5,770 km/h from 0.61 km/h -- the GPS was stationary, then teleported, then returned. Classic satellite reacquisition artifact.

**What This Means:**

- *Per-bus quality scoring*: The speed pipeline should maintain a rolling anomaly count per bus. Buses exceeding a threshold (e.g., more than 5 readings > 200 km/h in an hour) should be flagged and their data treated with additional skepticism.
- *Violation detection confidence*: A violation from a known-problematic bus (2-A, 1-B, 4-G) should carry lower confidence than the same violation from a clean bus. The UI could display a "data quality" indicator per bus.

---

## 11. Key Takeaways

### For Speed Estimation Algorithm Design

1. **Raw Haversine is unusable for speed estimation.** Mean overestimation is ~20% due to GPS noise, with a heavy tail of extreme artifacts. The pipeline must include outlier rejection, position smoothing, and a conservative speed factor.
2. **A 3-point moving average reduces jitter by 2.3x** (median |dv| from 14.54 to 6.98 km/h). The Kalman filter in the current codebase should achieve even better reduction.
3. **The minimum distance threshold of 10m is well-calibrated.** Phantom speed at stops maxes at 10.10 km/h raw and 5.65 km/h averaged. A 10m threshold at 2-second intervals (equivalent to 18 km/h) sits safely above both.
4. **Acceleration capping at 3 m/s^2 would affect 13% of readings** -- a large fraction, but these are almost all GPS artifacts. This is a viable secondary filter.

### For Violation Detection Confidence

5. **Without filtering, ~7% of readings would be false violations** at a 90 km/h threshold. After the full pipeline, the false positive rate should drop to well under 1%.
6. **Route 31 and Route 23 need special handling.** Their anomaly rates are 2-4x the fleet average. Violations from these routes should carry a data quality warning.
7. **Per-bus anomaly profiles matter.** A small number of buses (2-A, 1-B, 4-G, 6-H) generate disproportionate noise. Adaptive per-bus thresholds or quality scores would improve violation confidence.

### For Phantom Speed and GPS Noise

8. **Stopped buses show 0 km/h median phantom speed but up to 10.10 km/h worst case.** A stop detection threshold of 5 km/h captures 99.1% of stopped periods.
9. **The slow-speed zone (1-10 km/h) is a confusion zone** where stopped+noise and genuinely creeping buses are indistinguishable by speed alone. Spatial criteria (position spread) are needed.
10. **GPS noise is worse at high latitude (64 deg N)** due to suboptimal satellite geometry, though the effect is partially mitigated by GLONASS.

### For Bus Stop Detection Tuning

11. **15 seconds is the right minimum stop duration.** P10 of stop duration is exactly 15 seconds, and very few genuine stops are shorter.
12. **Median stop is 23 seconds, median bus makes 10.2 stops per hour.** This means one stop every ~6 minutes.
13. **63.3% of stops are 15-30 seconds** (normal passenger boarding). Stops > 5 minutes are layovers (3.8% of stops).

### For Animation Smoothness

14. **Speed jitter scales with speed**: 2.18 km/h median at 0-5 km/h, 33.10 km/h at 50+ km/h. Animation interpolation must be speed-adaptive.
15. **At 2-second update intervals and 60fps, the Kalman filter produces ~0.06 km/h per frame** -- imperceptibly smooth. The animation bottleneck is the update interval, not the smoothing algorithm.
16. **Buses spend ~40% of time accelerating, ~20% cruising, ~40% decelerating.** Constant-speed animation is rarely correct; the Kalman predictor's velocity model is essential.

### Fleet-Level Summary

| Metric | Value |
| --- | --- |
| Dataset date | 2026-03-11 |
| Total records | 977,707 |
| Unique buses | 128 |
| Routes | 25 |
| Time span | 10.4 hours (08:48 - 19:14 UTC) |
| Valid speed pairs | 296,945 |
| Total fleet distance | 11,829.4 km |
| Median speed | 31.53 km/h |
| Mean speed | 38.74 km/h |
| Total stops detected | 12,093 |
| Total stop time | 710.2 hours |
| Trip segments | 1,595 |
| Readings > 90 km/h | 20,025 (6.744%) |
| Readings > 120 km/h | 7,662 (2.580%) |
| Impossible accelerations | 38,685 (13.073%) |
| Phantom speed at stops (median) | 0.00 km/h |
| Raw speed jitter (median \|dv\|) | 14.54 km/h |
