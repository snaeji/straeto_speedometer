# Algorithm & Parameter Implications Analysis

Empirical analysis of 977,707 GPS records from 128 buses across 25 Straeto routes. All numbers derived from real operational data collected via the Straeto GraphQL API.

---

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [Executive Summary](#executive-summary)
3. [Analysis 1: Empirical GPS Noise](#analysis-1-empirical-gps-noise)
4. [Analysis 2: Effective Update Interval Distribution](#analysis-2-effective-update-interval-distribution)
5. [Analysis 3: Movement Characteristics (Acceleration)](#analysis-3-movement-characteristics-acceleration)
6. [Analysis 4: Stationarity Detection Threshold](#analysis-4-stationarity-detection-threshold)
7. [Analysis 5: Speed Estimation Error](#analysis-5-speed-estimation-error)
8. [Analysis 6: Animation Prediction Quality](#analysis-6-animation-prediction-quality)
9. [Analysis 7: Optimal Polling Interval](#analysis-7-optimal-polling-interval)
10. [Analysis 8: Speed Limit Matching Implications](#analysis-8-speed-limit-matching-implications)
11. [Parameter Recommendations Summary](#parameter-recommendations-summary)

---

## Critical Issues

These are the three highest-priority findings that require immediate attention:

### 1. The "never overestimate" guarantee is broken

The current Kalman pipeline overestimates speed **20.2% of the time** (12,322 out of 61,029 comparisons across 20 buses). The design goal stated in CLAUDE.md is *"Critical constraint: Never overestimate bus speed."* This is not being met. The worst single overestimate observed was **48.4 km/h** (bus 15-B). Overestimates at P50 are 6.0 km/h, at P90 are 12.9 km/h, and at P95 are 15.8 km/h. The conservative speed factor of 0.95 is insufficient to compensate for the Kalman filter's lag-induced overshoot during speed transitions.

### 2. sigma_gps is set to 5.0m but the empirical value is 1.3m

The Kalman filter's measurement noise parameter (`KALMAN_SIGMA_GPS`) is set to 5.0m based on a prior assumption about typical GPS error. Empirical analysis of moving bus lateral deviations yields a sigma of **1.3m** -- nearly 4x lower. This means the Kalman filter trusts measurements far less than it should, over-smoothing position estimates and introducing unnecessary velocity lag. This is a direct contributor to Critical Issue #1.

### 3. Stationarity detection thresholds are too high

The current dual-threshold system uses `MIN_DISTANCE_THRESHOLD_M = 10m` and `REAL_STATIONARY_DIST_M = 5m`. The analysis shows 3m is the optimal threshold by false-positive/false-negative balance, with a combined error rate of 26.46% vs. 33.26% at 10m. The current 10m threshold misclassifies 24.69% of readings as false positives (stationary when actually moving slowly) while still missing 8.57% of truly stopped buses.

---

## Executive Summary

| Parameter | Current | Recommended | Justification |
|---|---|---|---|
| `KALMAN_SIGMA_GPS` | 5.0m | 1.3m | Empirical lateral deviation P50 * sqrt(3/2) from moving buses |
| `KALMAN_SIGMA_A` | 0.8 m/s^2 | 1.7 m/s^2 | Empirical acceleration std dev from 271,610 measurements |
| `CONSERVATIVE_SPEED_FACTOR` | 0.95 | 0.90 or lower | 20.2% overestimate rate requires more aggressive compensation |
| `REAL_STATIONARY_DIST_M` | 5.0m | 3.0m | Best FP+FN balance; current 5m has 21.25% FP rate |
| `MIN_DISTANCE_THRESHOLD_M` | 10.0m | 3.0m | Align with stationary analysis; 10m clips speeds below ~7 km/h |
| `MAX_SPEED_LIMIT_SEARCH_DISTANCE_M` | 50m | 50m (keep) | Captures 98.8% of positions; reduction not warranted |
| `POLLING_INTERVAL_MS` | 2000 | 3000 | 20% vs 14.1% data yield per poll; negligible data loss |

---

## Analysis 1: Empirical GPS Noise

### Raw Data

**Stopped bus episodes** (>=10 consecutive readings within 1m): 8,777 total

| Metric | Value |
|---|---|
| Episodes with ALL identical positions | 1,267 (14.4%) |
| Episodes with position variation | 7,510 (85.6%) |

**Position variation in non-identical stopped episodes:**

| Percentile | Max spread |
|---|---|
| P50 | 0.547m |
| P90 | 1.169m |
| P99 | 2.768m |
| Max | 43.999m |

**GPS noise from 7,432 episodes with measurable scatter:**

| Axis | Mean sigma | Median sigma | P90 sigma |
|---|---|---|---|
| Latitude | 0.144m | 0.096m | 0.311m |
| Longitude | 0.152m | 0.107m | 0.334m |

**Total position deviations from centroids** (287,433 measurements):

| Metric | Value |
|---|---|
| Mean | 0.2290m |
| P50 | 0.0733m |
| P90 | 0.6404m |
| P95 | 0.9853m |
| P99 | 1.7638m |
| Max | 23.2405m |

**Long stops (>60s):** 1,275 episodes, scatter mean=0.2970m, P50=0.0883m, P95=1.3008m

**GPS noise from moving buses** (lateral deviation from 3-point line):

| Metric | Value |
|---|---|
| Measurements | 90,430 |
| Mean lateral deviation | 3.11m |
| P50 | 1.08m |
| P75 | 3.81m |
| P90 | 9.07m |
| P95 | 13.40m |
| P99 | 22.08m |
| **Implied sigma_gps (P50 * sqrt(3/2))** | **1.33m** |

### What This Means

**The most surprising finding in this analysis.** The assumed GPS noise of 5.0m (a standard textbook value for consumer GPS at mid-latitudes) is wildly wrong for this data source. The empirical sigma is **1.3m**, nearly 4x lower.

There are two separate effects at play:

1. **Stopped buses show near-zero noise** because the Straeto API caches and returns identical coordinates when the GPS hardware hasn't produced a new fix. 14.4% of stopped episodes have literally identical positions across all readings. The remaining 85.6% show sub-meter scatter (P50 = 0.55m, P95 = 0.99m). This is not low GPS noise -- it is the API returning stale cached coordinates.

2. **Moving buses show real GPS noise**, measured via lateral deviation from a 3-point line fit. The P50 lateral deviation is 1.08m, yielding an implied sigma of 1.33m. This is the correct measurement to use for the Kalman filter because it reflects actual measurement uncertainty during normal operation.

The consequence of `sigma_gps = 5.0m` is severe: the Kalman filter assigns far too little weight to each new GPS measurement (the Kalman gain is too low), causing the estimated position and velocity to lag behind reality. During acceleration and deceleration, this lag manifests as overshoot -- the filter's velocity estimate continues at the old speed for too long after a bus slows down, directly causing the overestimation problem documented in Analysis 5.

### Recommendations

- Set `KALMAN_SIGMA_GPS = 1.3` based on the moving-bus lateral deviation analysis
- This will increase Kalman gain, making the filter more responsive to position updates
- The filter will track speed changes more tightly, reducing both overshoot and lag
- Note: this alone will not solve the 20.2% overestimate rate, but it is necessary groundwork

---

## Analysis 2: Effective Update Interval Distribution

### Raw Data

**Raw inter-reading gaps** (all readings including stale):

| Percentile | Gap |
|---|---|
| P10 | 2.0s |
| P25 | 2.0s |
| P50 | 3.0s |
| P75 | 4.0s |
| P90 | 5.0s |
| P95 | 6.0s |
| P99 | 8.0s |
| Mean | 7.2s |

**Real update gaps** (after removing stale readings): 287,081 real updates

| Percentile | Gap |
|---|---|
| P10 | 2.0s |
| P25 | 3.0s |
| P50 | 5.0s |
| P75 | 6.0s |
| P90 | 9.0s |
| P95 | 14.0s |
| P99 | 38.0s |
| Mean | 6.2s |

**Real update gap bucket distribution:**

| Bucket | Count | Percentage |
|---|---|---|
| 0-2s | 0 | 0.0% |
| 2-4s | 77,753 | 27.1% |
| 4-6s | 102,456 | 35.7% |
| 6-8s | 64,061 | 22.3% |
| 8-10s | 19,064 | 6.6% |
| 10-12s | 6,369 | 2.2% |
| 12-15s | 4,032 | 1.4% |
| 15-20s | 4,951 | 1.7% |
| 20-30s | 3,941 | 1.4% |
| 30-60s | 3,156 | 1.1% |
| 60-120s | 853 | 0.3% |
| 120-300s | 445 | 0.2% |

**Per-route median real update gap:**

| Route | Count | P50(s) | P90(s) | Mean(s) |
|---|---|---|---|---|
| 1 | 23,677 | 5.0 | 9.0 | 6.8 |
| 2 | 15,123 | 5.0 | 9.0 | 6.4 |
| 3 | 18,734 | 5.0 | 9.0 | 6.4 |
| 4 | 12,108 | 5.0 | 9.0 | 7.1 |
| 5 | 19,516 | 4.0 | 9.0 | 5.9 |
| 6 | 18,823 | 5.0 | 9.0 | 6.5 |
| 7 | 7,429 | 4.0 | 7.0 | 5.1 |
| 11 | 13,208 | 4.0 | 9.0 | 5.8 |
| 12 | 26,574 | 5.0 | 9.0 | 6.2 |
| 13 | 10,293 | 4.0 | 9.0 | 5.7 |
| 14 | 13,347 | 4.0 | 9.0 | 5.6 |
| 15 | 25,864 | 4.0 | 8.0 | 5.4 |
| 16 | 8,731 | 5.0 | 9.0 | 5.9 |
| 17 | 5,273 | 5.0 | 9.0 | 6.6 |
| 18 | 15,847 | 4.0 | 8.0 | 5.6 |
| 19 | 7,727 | 5.0 | 9.0 | 6.6 |
| 21 | 11,413 | 5.0 | 8.0 | 6.0 |
| 22 | 2,754 | 5.0 | 9.0 | 6.6 |
| 23 | 2,121 | 5.0 | 9.0 | 7.0 |
| 24 | 12,042 | 5.0 | 9.0 | 6.6 |
| 28 | 5,736 | 5.0 | 9.0 | 6.4 |
| 31 | 2,610 | 6.0 | 25.0 | 10.8 |
| 35 | 2,785 | 5.0 | 9.0 | 6.4 |
| 36 | 2,634 | 5.0 | 9.0 | 6.3 |
| 8 | 2,712 | 5.0 | 9.0 | 6.5 |

**Overall stale rate: 49.8% of readings are stale.**

### What This Means

Half of all API responses contain no new GPS data. The GPS hardware on the buses updates at roughly a 5-second cadence (median real gap = 5.0s), while the API is polled every 2 seconds. The 2-4 second bucket (27.1%) likely represents cases where a real GPS update happens to align closely with a poll cycle.

Route 31 is a notable outlier with a median gap of 6.0s and P90 of 25.0s, suggesting intermittent GPS connectivity issues on that route's vehicles.

The Kalman filter's `dt` parameter must use the real update gap, not the polling interval. Currently this is handled correctly via stale detection, but the filter should be tuned for the typical 5s cadence, not 2s.

### Recommendations

- The current stale-detection logic is working correctly -- stale readings are excluded from Kalman updates
- The Kalman process noise should be tuned for dt=5s (median), not dt=2s
- Consider flagging Route 31 data quality separately (P90 gap of 25s makes speed calculation unreliable)
- See Analysis 7 for polling interval recommendations

---

## Analysis 3: Movement Characteristics (Acceleration)

### Raw Data

**Total acceleration measurements:** 271,610

**Absolute acceleration distribution (m/s^2):**

| Metric | Value |
|---|---|
| P50 | 0.695 |
| P75 | 1.440 |
| P90 | 2.648 |
| P95 | 3.819 |
| P99 | 6.500 |
| Mean | 1.120 |
| Std | 1.286 |

**Signed acceleration distribution (m/s^2):**

| Metric | Value |
|---|---|
| Mean | 0.1037 |
| Std | 1.702 |
| P5 | -2.331 |
| P25 | -0.675 |
| P50 | -0.038 |
| P75 | 0.721 |
| P95 | 3.050 |

**Acceleration by speed band:**

| Band (km/h) | Count | \|accel\| P50 | \|accel\| P90 | \|accel\| P95 | Std |
|---|---|---|---|---|---|
| 0-10 | 33,509 | 0.241 | 0.860 | 1.147 | 0.561 |
| 10-20 | 49,428 | 0.567 | 1.710 | 2.214 | 1.056 |
| 20-30 | 64,626 | 0.634 | 1.969 | 2.738 | 1.348 |
| 30-40 | 53,459 | 0.822 | 2.642 | 3.722 | 1.692 |
| 40-50 | 32,611 | 1.066 | 3.639 | 5.152 | 2.193 |
| 50-60 | 17,573 | 1.331 | 4.120 | 5.539 | 2.444 |
| 60-80 | 15,453 | 1.684 | 4.515 | 5.760 | 2.706 |

### What This Means

The current `KALMAN_SIGMA_A = 0.8 m/s^2` is set below the empirical median absolute acceleration (0.695 m/s^2) and well below the standard deviation (1.702 m/s^2). This means the Kalman filter's process model does not expect buses to accelerate as aggressively as they actually do. The consequence is that during real acceleration/deceleration events, the filter lags -- it doesn't trust the data enough to update its velocity estimate quickly.

The acceleration increases sharply with speed: at 0-10 km/h the P50 is just 0.241 m/s^2, but at 50-60 km/h it reaches 1.331 m/s^2. This is partly genuine (higher-speed maneuvers) and partly GPS noise amplification (errors are proportionally larger when divided by the same time interval at higher absolute speeds).

The signed acceleration distribution is nearly symmetric (mean 0.1037, P5=-2.331, P95=3.050), with a slight positive skew, indicating marginally more aggressive acceleration than braking in the data. The P50 of -0.038 being near zero confirms buses spend roughly equal time speeding up and slowing down.

The hard acceleration limits in the Kalman filter (`MAX_ACCEL_MS2 = 3.0`, `MAX_DECEL_MS2 = 5.0`) are reasonable: P95 of signed acceleration is 3.050, and P5 is -2.331. The 3.0 cap clips about 5% of acceleration events; the 5.0 deceleration cap is well above any observed braking.

### Recommendations

- Increase `KALMAN_SIGMA_A` from 0.8 to 1.7 m/s^2 (matching the empirical signed acceleration std of 1.702)
- This allows the Kalman filter to track real speed changes faster, reducing overshoot during deceleration
- The acceleration caps (3.0/5.0 m/s^2) are appropriate and should be kept
- Consider a speed-dependent sigma_a if further precision is needed (0.56 at low speed, 2.7 at highway speed)

---

## Analysis 4: Stationarity Detection Threshold

### Raw Data

| Threshold | Stationary | False Pos | FP Rate | False Neg | FN Rate |
|---|---|---|---|---|---|
| 3m | 193,663 | 32,203 | 16.63% | 26,876 | 9.83% |
| 5m | 209,288 | 44,470 | 21.25% | 24,612 | 9.43% |
| 7m | 217,771 | 50,416 | 23.15% | 22,960 | 9.06% |
| 10m | 227,405 | 56,141 | 24.69% | 20,837 | 8.57% |
| 15m | 244,182 | 66,740 | 27.33% | 17,562 | 7.81% |
| 20m | 264,916 | 81,054 | 30.60% | 14,413 | 7.08% |

### What This Means

There is no threshold that eliminates both false positives and false negatives, because GPS noise and slow bus movement overlap in the same distance range. The tradeoff is:

- **Lower threshold (3m):** Fewer false positives (16.63% vs. 24.69% at 10m) but more false negatives (9.83% vs. 8.57%). Buses moving very slowly (e.g., in traffic or at bus stops) are correctly identified as moving.
- **Higher threshold (10m, current):** More false positives -- 24.69% of "stationary" classifications are actually slow-moving buses. This clips real low-speed movement, reporting it as zero.

The current system uses two thresholds: `MIN_DISTANCE_THRESHOLD_M = 10m` (old pipeline) and `REAL_STATIONARY_DIST_M = 5m` (Kalman pipeline). The 5m threshold has a 21.25% false positive rate.

At 3m, the combined error rate (FP + FN) is 16.63% + 9.83% = 26.46%. At 10m, it is 24.69% + 8.57% = 33.26%. The 3m threshold is strictly better by this combined metric.

For the speed violation use case, **false positives are more costly than false negatives.** A false positive (classifying a slow-moving bus as stopped) means we miss a potential slow-speed violation. A false negative (classifying a stopped bus as moving) merely adds a near-zero phantom speed reading that the speed pipeline already handles. The bias should therefore be toward lower thresholds.

### Recommendations

- Reduce `REAL_STATIONARY_DIST_M` from 5.0m to 3.0m
- Reduce `MIN_DISTANCE_THRESHOLD_M` from 10.0m to 3.0m (align both pipelines)
- Accept the marginal increase in false negatives (9.83% vs. 8.57%) in exchange for a significant reduction in false positives (16.63% vs. 24.69%)

---

## Analysis 5: Speed Estimation Error

### Raw Data

**Per-bus error analysis** (top 20 buses, 61,029 total comparisons):

| Bus | Records | Comparisons | Over% | Under% | MeanErr (km/h) | MaxOver (km/h) |
|---|---|---|---|---|---|---|
| 2-B | 9,478 | 3,049 | 20.9 | 66.5 | -10.1 | 29.1 |
| 3-B | 9,478 | 2,770 | 19.4 | 68.8 | -10.0 | 34.2 |
| 3-C | 9,478 | 2,504 | 17.3 | 70.0 | -10.6 | 27.9 |
| 4-D | 9,478 | 2,173 | 21.9 | 66.1 | -9.1 | 27.6 |
| 5-A | 9,478 | 2,773 | 18.6 | 68.2 | -9.0 | 25.1 |
| 6-B | 9,478 | 2,641 | 20.1 | 68.2 | -10.6 | 47.1 |
| 7-A | 9,478 | 4,223 | 22.6 | 62.5 | -7.3 | 29.8 |
| 7-B | 9,478 | 3,129 | 20.1 | 67.7 | -10.8 | 27.6 |
| 11-A | 9,478 | 2,722 | 18.2 | 66.3 | -8.0 | 30.4 |
| 11-B | 9,478 | 3,656 | 20.9 | 63.6 | -6.7 | 20.3 |
| 12-A | 9,478 | 3,366 | 20.2 | 66.2 | -8.6 | 29.0 |
| 12-D | 9,478 | 2,521 | 18.9 | 68.5 | -9.3 | 35.1 |
| 13-B | 9,478 | 3,499 | 19.5 | 63.9 | -6.4 | 22.6 |
| 14-C | 9,478 | 3,461 | 20.2 | 64.1 | -6.5 | 29.2 |
| 14-D | 9,478 | 3,378 | 20.4 | 64.7 | -7.0 | 25.2 |
| 14-E | 9,478 | 3,300 | 20.6 | 64.2 | -7.6 | 24.2 |
| 15-B | 9,478 | 2,820 | 21.2 | 67.4 | -11.3 | 48.4 |
| 15-E | 9,478 | 3,731 | 21.1 | 66.8 | -8.7 | 27.9 |
| 16-A | 9,478 | 2,848 | 20.9 | 65.6 | -8.5 | 35.5 |
| 19-A | 9,478 | 2,465 | 18.8 | 67.9 | -9.0 | 21.8 |

**Fleet-wide summary:**

| Metric | Value |
|---|---|
| **Overestimates (>2 km/h)** | **12,322 (20.2%)** |
| Underestimates (>2 km/h) | 40,349 (66.1%) |
| Within +/-2 km/h | ~8,358 (13.7%) |
| Max overestimate | 48.4 km/h (bus 15-B) |

**Error distribution (km/h, positive = overestimate):**

| Metric | Value |
|---|---|
| P5 | -31.7 |
| P25 | -15.4 |
| P50 | -6.6 |
| P75 | 0.5 |
| P95 | 9.1 |
| Mean | -8.6 |
| Std | 15.2 |

**Overestimate magnitude distribution (when overestimating):**

| Metric | Value |
|---|---|
| P50 | 6.0 km/h |
| P90 | 12.9 km/h |
| P95 | 15.8 km/h |
| P99 | 22.1 km/h |

**Error by context:**

| Context | Points | Mean Error | Std |
|---|---|---|---|
| Speed transitions (GT range > 10 km/h) | 52,021 | -9.6 | 15.9 |
| Steady speed | 7,333 | -4.5 | 7.1 |
| Near stops (GT < 5 km/h) | 1,675 | +5.4 | 5.5 |

### What This Means

**The "never overestimate" guarantee is not being met.** One in five speed readings is an overestimate by more than 2 km/h. The overestimate rate is remarkably consistent across all 20 buses analyzed (17.3% to 22.6%), confirming this is a systematic pipeline issue, not a per-vehicle GPS quality problem.

The error is heavily skewed toward underestimation overall (mean = -8.6 km/h, median = -6.6 km/h), which means the `CONSERVATIVE_SPEED_FACTOR = 0.95` is doing its job in the aggregate -- but it cannot prevent the overshoot events that occur during speed transitions.

The contextual breakdown is revealing:

- **Speed transitions** (52,021 points, mean error -9.6 km/h): These dominate the dataset. The Kalman filter lags during both acceleration and deceleration. During deceleration, lag causes overestimates; during acceleration, lag causes underestimates. The net mean is negative because the 0.95 factor biases everything down.
- **Steady speed** (7,333 points, mean error -4.5 km/h, std 7.1): Even at constant speed, the pipeline underestimates by 4.5 km/h on average. The 0.95 factor accounts for ~2.5 km/h of this; the rest is smoothing lag residual.
- **Near stops** (1,675 points, mean error **+5.4 km/h**): This is the most problematic context. When the ground truth speed is below 5 km/h, the Kalman filter's velocity estimate hasn't decayed to zero yet, producing phantom speeds. These are the bulk of the overestimate events.

The root cause chain: `sigma_gps` too high (5.0m vs. 1.3m empirical) --> Kalman gain too low --> velocity estimate responds slowly --> overshoot during deceleration and near-stop phantom speeds. Fixing sigma_gps (Analysis 1) and sigma_a (Analysis 3) should substantially reduce the 20.2% overestimate rate.

### Recommendations

- Fixing `sigma_gps` and `sigma_a` as recommended in Analyses 1 and 3 is the primary remedy
- If overestimate rate remains above 5% after parameter correction, reduce `CONSERVATIVE_SPEED_FACTOR` from 0.95 to 0.90
- Consider an adaptive speed factor: more aggressive near stops (where the +5.4 km/h mean error concentrates), less aggressive at highway speeds
- The endpoint speed bounding mechanism (already in the code via `KALMAN_ENDPOINT_BUFFER_SIZE = 6`) should act as a hard cap, but the 20.2% rate suggests it is not sufficiently constraining; investigate whether it is working as intended
- Target overestimate rate: below 5% for the "never overestimate" guarantee to be credible

---

## Analysis 6: Animation Prediction Quality

### Raw Data

| Horizon (ms) | Count | P50 (m) | P75 (m) | P90 (m) | P95 (m) | Mean (m) |
|---|---|---|---|---|---|---|
| 500 | 29,846 | 3,123.3 | 5,012.4 | 5,134.1 | 7,353.4 | 3,276.6 |
| 1,000 | 29,847 | 3,120.6 | 5,012.1 | 5,133.4 | 7,354.1 | 3,276.9 |
| 1,500 | 29,847 | 3,118.2 | 5,011.7 | 5,132.7 | 7,354.4 | 3,277.2 |
| 2,000 | 29,850 | 3,116.1 | 5,011.5 | 5,133.1 | 7,354.4 | 3,277.5 |
| 3,000 | 18,897 | 3,365.8 | 5,017.2 | 5,144.5 | 7,356.6 | 3,498.2 |
| 4,000 | 23,554 | 3,135.9 | 5,015.4 | 5,135.9 | 7,354.3 | 3,379.2 |
| 5,000 | 23,863 | 3,129.9 | 5,014.8 | 5,137.0 | 7,355.6 | 3,344.1 |
| 7,000 | 23,783 | 3,129.9 | 5,013.7 | 5,148.1 | 7,356.4 | 3,332.4 |
| 10,000 | 22,888 | 3,133.0 | 5,011.3 | 5,157.5 | 7,356.5 | 3,339.0 |

Thresholds exceeded:
- Median error exceeds 5m, 10m, and 20m at the very first horizon (500ms)
- P90 error exceeds 5m, 10m, and 20m at the very first horizon (500ms)

### What This Means

**WARNING: These numbers are clearly wrong and need reinvestigation.**

Median prediction errors of 3,000+ meters at a 500ms horizon are physically impossible. A bus at 50 km/h covers approximately 7 meters in 500ms. P50 errors in the 3-5 km range, and their near-total independence from the prediction horizon (3,123m at 500ms vs. 3,133m at 10,000ms), indicate the analysis script is computing distances against incorrect reference positions.

The most likely bug: the script is comparing predicted positions against future positions of **different buses** rather than the same bus, or it is failing to match timestamps correctly, measuring against positions that are thousands of meters away geographically rather than temporally adjacent positions of the same vehicle.

The near-constant error across all horizons (500ms to 10,000ms) further confirms this is a measurement bug, not a real prediction quality issue. Real prediction errors would increase monotonically with horizon length -- longer predictions should be worse, not roughly the same.

Additionally, the clustering of P75 values around ~5,012m and P95 around ~7,354m across all horizons suggests these are actually measuring geographic distances between different bus routes or bus positions at unrelated times, not prediction errors.

### Recommendations

- **Do not use these numbers for any parameter decisions**
- Reinvestigate the analysis script: verify that predicted positions are compared to the next real GPS update **for the same bus**
- Ensure bus ID matching is correct in the comparison loop
- After fixing, expected prediction errors for a well-tuned Kalman filter should be:
  - 500ms: P50 ~2-5m, P90 ~10-15m
  - 2000ms: P50 ~8-15m, P90 ~25-40m
  - 5000ms: P50 ~20-40m, P90 ~60-100m

---

## Analysis 7: Optimal Polling Interval

### Raw Data

| Interval | Total Polls | New Data | New Data % | Effective Hz |
|---|---|---|---|---|
| 1s | 4,104,357 | 289,285 | 7.0% | 0.070 |
| 2s | 2,052,142 | 289,265 | 14.1% | 0.070 |
| 3s | 1,368,072 | 274,070 | 20.0% | 0.067 |
| 4s | 1,026,035 | 257,752 | 25.1% | 0.063 |
| 5s | 820,798 | 237,498 | 28.9% | 0.058 |
| 6s | 683,998 | 215,922 | 31.6% | 0.053 |
| 8s | 513,015 | 175,665 | 34.2% | 0.043 |
| 10s | 410,370 | 146,228 | 35.6% | 0.036 |

**Efficiency (new data per poll / polls per second):**

| Interval | Useful % | New readings/min/bus |
|---|---|---|
| 1s | 7.0% | 4.2 |
| 2s | 14.1% | 4.2 |
| 3s | 20.0% | 4.0 |
| 4s | 25.1% | 3.8 |
| 5s | 28.9% | 3.5 |
| 6s | 31.6% | 3.2 |
| 8s | 34.2% | 2.6 |
| 10s | 35.6% | 2.1 |

### What This Means

The 1s and 2s intervals produce identical actual data throughput (289,285 vs. 289,265 new readings -- effectively identical), but 1s makes twice as many API requests. The API's `cache-control: max-age=2` header is consistent with this: polling faster than every 2 seconds is entirely wasted.

Moving from 2s to 3s reduces total polls by 33% (from 2.05M to 1.37M) while losing only 5.2% of new data (289,265 to 274,070). This is the best efficiency inflection point. Beyond 3s, the data loss curve steepens: 4s loses 10.9%, 5s loses 17.9%.

The effective Hz column shows the true GPS update rate is approximately 0.070 Hz (one update every ~14 seconds per bus), regardless of how fast we poll. This aligns with the 5-second median real update gap from Analysis 2 combined with the fleet size.

For the collector script running on a server, the savings from 2s to 3s polling are modest (33% fewer HTTP requests). For the browser-based collector, the savings are more meaningful: fewer network calls, less CPU for JSON parsing, and longer battery life on laptops.

### Recommendations

- Increase `POLLING_INTERVAL_MS` from 2000 to 3000 for the collector
- The tradeoff: 33% fewer API requests in exchange for 5.2% data loss, which translates to losing ~0.2 real readings per minute per bus (4.2 vs. 4.0)
- For live UI mode where animation smoothness matters, keep 2s polling to minimize the gap between poll and GPS update (lower latency for animation prediction starts)
- Consider adaptive polling: 2s when the UI is actively displaying the map, 3-5s for background collection

---

## Analysis 8: Speed Limit Matching Implications

### Raw Data

**Moving bus position scatter** (raw GPS vs. 5-point moving average centroid): 236,180 measurements

| Metric | Value |
|---|---|
| P50 | 11.5m |
| P75 | 18.9m |
| P90 | 27.0m |
| P95 | 32.9m |
| P99 | 53.5m |
| Mean | 14.7m |

**Position scatter by speed band:**

| Band (km/h) | Count | P50 (m) | P90 (m) | P95 (m) |
|---|---|---|---|---|
| 10-20 | 66,018 | 13.2 | 26.8 | 31.6 |
| 20-30 | 68,940 | 10.7 | 27.1 | 33.1 |
| 30-40 | 50,801 | 10.5 | 25.2 | 31.0 |
| 40-50 | 25,121 | 11.4 | 26.7 | 32.6 |
| 50-70 | 19,721 | 11.5 | 29.5 | 37.3 |

**Search radius needed to capture X% of true positions:**

| Capture Rate | Radius Needed |
|---|---|
| 90% | 27.0m |
| 95% | 32.9m |
| 99% | 53.5m |

**Current setting: 50m search radius captures 98.8% of positions.**

**Cross-track deviation** (perpendicular to direction of travel): 235,904 measurements

| Metric | Value |
|---|---|
| P50 | 1.1m |
| P75 | 3.7m |
| P90 | 8.8m |
| P95 | 13.1m |
| P99 | 21.5m |
| Mean | 3.1m |

### What This Means

The position scatter vs. moving average centroid measures how far any single GPS reading drifts from the bus's "true" trajectory. At P50=11.5m, this is dominated by the fact that the centroid itself shifts as the bus moves between the 5 readings -- this is not GPS noise alone, but noise plus the natural displacement of a moving bus over 25 seconds of travel.

The cross-track deviation (perpendicular to travel direction) isolates the relevant dimension for speed limit matching: how far off the road centerline does the bus's GPS position appear? With a P50 of 1.1m and P95 of 13.1m, the GPS typically places the bus within a lane width of the road, but 5% of the time it can be 13+ meters off -- enough to snap to a parallel road with a different speed limit.

The current 50m search radius captures 98.8% of positions, which is appropriate. The P99 of 53.5m means roughly 1.2% of positions would require a search radius larger than 50m to find the correct road. Increasing to 55m would cover P99, but the remaining 1% are likely GPS outliers that would match to the wrong road regardless.

The position scatter is remarkably consistent across speed bands (P50 ranges from 10.5m to 13.2m), confirming that the scatter is dominated by GPS noise and centroid-shift, not speed-dependent effects.

### Recommendations

- Keep `MAX_SPEED_LIMIT_SEARCH_DISTANCE_M = 50m` (98.8% capture rate is sufficient)
- For speed limit matching, prefer **cross-track distance** (perpendicular to travel direction) over radial distance when choosing the matching road segment, since the P95 cross-track deviation is only 13.1m
- When multiple road segments are within the search radius, weight matches by perpendicular distance rather than point-to-point distance
- Consider using the Kalman-smoothed position (not raw GPS) for speed limit lookups to reduce the P95 cross-track deviation

---

## Parameter Recommendations Summary

| Parameter | Current | Recommended | Change | Justification |
|---|---|---|---|---|
| `KALMAN_SIGMA_GPS` | 5.0m | 1.3m | Decrease 3.8x | Empirical moving-bus lateral deviation P50 * sqrt(3/2) = 1.33m (Analysis 1) |
| `KALMAN_SIGMA_A` | 0.8 m/s^2 | 1.7 m/s^2 | Increase 2.1x | Empirical signed acceleration std = 1.702 m/s^2 (Analysis 3) |
| `CONSERVATIVE_SPEED_FACTOR` | 0.95 | 0.90 | Decrease | 20.2% overestimate rate with current pipeline (Analysis 5); reduce if sigma fixes are insufficient |
| `REAL_STATIONARY_DIST_M` | 5.0m | 3.0m | Decrease | Best FP+FN balance: 26.46% combined at 3m vs. 30.68% at 5m (Analysis 4) |
| `MIN_DISTANCE_THRESHOLD_M` | 10.0m | 3.0m | Decrease | Align with stationarity analysis; 10m clips all movement below ~7 km/h (Analysis 4) |
| `POLLING_INTERVAL_MS` | 2000 | 3000 | Increase | 33% fewer polls, 5.2% data loss; API data yield doubles from 14.1% to 20.0% (Analysis 7) |
| `MAX_SPEED_LIMIT_SEARCH_DISTANCE_M` | 50m | 50m | No change | 98.8% position capture rate is sufficient (Analysis 8) |
| `KALMAN_ENDPOINT_BUFFER_SIZE` | 6 | 6 | No change | Appropriate for 5s median update interval * 6 = 30s speed bounding window |
| `MAX_ACCEL_MS2` | 3.0 | 3.0 | No change | At P95 of signed acceleration (3.050 m/s^2), clips ~5% which is appropriate (Analysis 3) |
| `MAX_DECEL_MS2` | 5.0 | 5.0 | No change | Well above observed braking magnitudes (Analysis 3) |
