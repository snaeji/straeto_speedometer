# Critical Review: Algorithmic Claims in 05-algorithm-implications.md

Reviewer examined: `scripts/analysis-algorithms.mjs`, the production Kalman filter (`src/lib/services/kalman-speed-calculator.ts`), constants (`src/lib/utils/constants.ts`), and supporting analysis documents (01 through 04).

Dataset: 977,707 GPS records, 128 buses, 25 routes, single day (2026-03-11).

---

## Table of Contents

1. [sigma_gps = 1.3m](#1-sigma_gps--13m)
2. [Kalman Overestimate Rate (20.2%)](#2-kalman-overestimate-rate-202)
3. [Stationarity Detection Threshold (3m)](#3-stationarity-detection-threshold-3m)
4. [Animation Prediction Quality](#4-animation-prediction-quality)
5. [Polling Interval Recommendation (3s)](#5-polling-interval-recommendation-3s)
6. [Speed Limit Matching (50m Radius)](#6-speed-limit-matching-50m-radius)
7. [Conservative Speed Factor (0.95 to 0.90)](#7-conservative-speed-factor-095-to-090)
8. [Additional Concerns](#8-additional-concerns)
9. [Summary Table](#9-summary-table)
10. [Recommended Next Steps](#10-recommended-next-steps)

---

## 1. sigma_gps = 1.3m

**Rating: Questionable**

### Methodology

The script (lines 253-313 of `analysis-algorithms.mjs`) selects triplets of consecutive real GPS updates A, B, C where:
- Time gaps are under 15s each
- Speeds on AB and BC are 10-70 km/h
- Speed ratio between segments is >= 0.7 (within 30%)

It computes the perpendicular distance from B to line AC. From 90,430 such measurements, the P50 lateral deviation is 1.08m. The claimed sigma is `P50 * sqrt(3/2) = 1.33m`.

### Concerns

**1. Road curvature is not filtered and dominates the measurement at upper percentiles.** The speed-ratio filter ensures roughly constant speed, but does nothing to exclude curves. A bus rounding a gentle curve at constant speed passes the filter perfectly while producing large lateral deviation that is geometry, not noise.

Quantitative check: at 40 km/h with 5s between updates, points A and C span ~111m. For a curve with 200m radius (common in Reykjavik's residential grid), the sagitta is approximately 7.8m. For a 500m radius curve (typical arterial), the sagitta is ~3.1m. Both dwarf the claimed 1.08m P50 noise. The heavy tail in the data confirms this: P90 = 9.07m and P95 = 13.40m. A Rayleigh distribution with sigma=1.3m would predict P90 = 2.83m and P95 = 3.17m. The observed P90 is 3.2x the theoretical value, which is the signature of a mixture distribution where curvature contaminates the noise measurement.

The P50 may be closer to the true noise floor (dominated by straight-road segments), but even the P50 of a mixture of "noise on straight segments" and "noise+curvature on curved segments" is biased upward.

**2. The sqrt(3/2) conversion factor has specific assumptions.** The derivation assumes B's deviation from line AC is the perpendicular projection of Gaussian noise at three equally-noisy independent points, with the road being perfectly straight. The formula `sigma = lateral_dev_P50 * sqrt(3/2)` holds when the expected perpendicular residual for the midpoint of a 3-point OLS fit is `sigma * sqrt(2/3)`. This is correct for a straight line with i.i.d. noise at all three points. But the road curvature violation breaks the "straight line" assumption, and the speed/distance filters create selection bias that breaks the "i.i.d." assumption (by excluding low-speed periods where noise-to-signal is highest and high-speed periods where multipath may differ).

**3. Contradicts the stopped-bus analysis.** Doc 02 (Spatial & Geographic, Section 4.1) reports stationary GPS noise: per-axis sigma = 0.33-0.34m, 2D RMS P50 = 0.641m. If sigma_gps were 1.3m, the expected 2D RMS for a stationary bus would be `1.3 * sqrt(2) = 1.84m`, not 0.64m. The document explains this discrepancy by noting that 14.4% of stopped episodes have identical coordinates (API caching). But this creates a bimodal noise profile: near-zero for cached readings (which are already filtered by stale detection and never reach the Kalman filter) and some higher value for fresh readings. A single sigma_gps value cannot represent both regimes. The moving-bus measurement at 1.3m and the stopped-bus measurement at ~0.6m bracket the true value, but the moving-bus figure is inflated by curvature.

**4. Single day, no HDOP or environmental stratification.** GPS accuracy at 64N varies with satellite geometry (GLONASS constellation, HDOP cycle), time of day, and local environment (urban canyon vs open road). The analysis uses one day of data and produces a single number. The true sigma likely varies between 0.8m and 3.0m depending on conditions. No per-hour or per-location analysis was performed.

**5. 70% of data excluded by filters.** Only 90,430 of ~300K real update pairs were used (30%). The retained subset satisfies strict speed and consistency criteria, creating selection bias toward the best-conditioned data (straight roads, moderate speed, consistent movement). The excluded 70% includes exactly the conditions where GPS noise is worst.

### What would resolve the uncertainty

- Filter triplets to verified straight road segments using the API direction field (require direction change < 5 degrees across A-to-C, which doc 02 shows is reliable for moves >5m).
- Compute GPS position deviation from Borgarvefsja road centerlines directly (the GeoJSON with 9,997 road segments is available). This gives a curvature-corrected noise measurement.
- Stratify sigma by time-of-day and location (urban center vs suburban).
- Compare stopped-bus fresh-fix-only sigma with the moving-bus estimate to bound the range.

### Bottom line

The true sigma_gps for fresh GPS fixes is likely in the range 1.5-3.0m. The 1.3m figure is an underestimate due to curvature contamination at upper percentiles pulling the P50 upward, and the 5.0m original assumption is likely an overestimate. A value of 2.0-2.5m would be a defensible starting point pending road-geometry validation.

---

## 2. Kalman Overestimate Rate (20.2%)

**Rating: Plausible (the divergence is real; the interpretation overstates the severity)**

### Methodology

The script (lines 623-899) runs a full Kalman filter simulation that mirrors the production code, then compares its EMA-smoothed speed output to a "ground truth" defined by `computeGroundTruth` (lines 768-791): for each real GPS update, compute endpoint speed (haversine distance / time since previous real update), take a 3-point moving average, and multiply by 0.95.

### Concerns

**1. The "ground truth" is not ground truth.** There is no independent speed reference in this dataset -- no OBD-II, no radar, no reference velocimetry. The function computes an alternative GPS-derived speed estimate from the same noisy data. The 20.2% figure measures divergence between two GPS processing pipelines, not divergence from true speed. Calling it "ground truth" in the code comment (line 767: `// Ground truth: 3-point moving average of real-update endpoint speeds, x0.95`) is misleading.

**2. Endpoint speed has its own systematic biases.** Haversine distance between two noisy points overestimates true distance (random errors always add apparent distance). This bias is `E[excess] ~ sigma^2 / d` where d is the true distance. At 50 km/h with sigma=2m and 5s intervals, the true distance is ~69m and the bias is ~0.12m, which is small. But endpoint speed also *underestimates* during curves because haversine measures chord distance, not arc length. For a 200m radius curve over 69m of travel, the chord is ~68.0m vs arc of 69.0m, a 1.4% underestimate. These biases partially cancel but do not eliminate each other.

More importantly, the 3-point moving average introduces a 1-step lookahead: the ground truth at time t includes the speed at t+1. During deceleration, the ground truth at time t already partially reflects the lower speed at t+1, while the Kalman estimate at time t is causal (uses information only up to time t). This temporal asymmetry systematically inflates the measured overestimate rate during braking, which the analysis itself identifies as the dominant error context ("speed transitions": 52,021 points, 85% of comparisons).

**3. The 0.95 factor creates partial circularity.** Both the ground truth and the Kalman pipeline apply a 0.95 factor. The comparison is between EMA(Kalman_speed * 0.95) and mean(endpoint_speeds) * 0.95. The factor cancels to first order, but the EMA and the moving average respond differently to speed changes, so the comparison is really measuring the difference in smoothing lag between EMA (alpha=0.4, exponential decay) and a 3-point boxcar average (symmetric, finite window).

**4. The 2 km/h threshold is not justified by the use case.** An overestimate is counted when error > 2 km/h. For speed violation detection, what matters is whether the estimated speed exceeds the speed limit. A 3 km/h overestimate at 35 km/h in a 50 zone is irrelevant; a 3 km/h overestimate at 49 km/h in a 50 zone triggers a false violation. The flat 2 km/h threshold conflates operationally irrelevant overestimates with consequential ones.

**5. The near-stop phantom speed finding is the most credible.** The contextual breakdown shows +5.4 km/h mean error when ground truth < 5 km/h (1,675 points). Here, the ground truth is reliable -- both endpoint speed and moving average should be near zero for a truly stopped bus. The Kalman pipeline producing +5.4 km/h phantom speed is a genuine problem attributable to EMA smoothing lag and insufficient stationarity detection. This finding does not depend on the ground truth methodology.

**6. Consistency across buses strengthens the finding.** The overestimate rate ranges from 17.3% to 22.6% across all 20 buses analyzed. This consistency confirms a systematic pipeline characteristic rather than per-vehicle GPS quality variation. The phenomenon is real, even if the magnitude is uncertain due to ground truth limitations.

### What would resolve the uncertainty

- Obtain actual speedometer data from even one bus trip (OBD-II or GTFS-RT with odometer). This would calibrate both the ground truth and the pipeline against an independent reference.
- If unavailable: use long-window endpoint speed (30-60 seconds) as a more stable reference, accepting that it only captures average speed rather than instantaneous speed.
- Report overestimates relative to speed limits (the operationally meaningful metric), not relative to an alternative estimator.
- Separate the EMA lag contribution from the Kalman lag by testing Kalman velocity output directly (without EMA) against ground truth.

### Bottom line

The 20.2% rate is a real measurement of divergence between the Kalman pipeline and a smoothed endpoint speed reference. The true overestimate rate relative to actual bus speed is probably lower (10-15%), because the ground truth is biased by the lookahead in the moving average and by endpoint speed's own noise characteristics. The near-stop phantom speed problem (+5.4 km/h) is credible and actionable.

---

## 3. Stationarity Detection Threshold (3m)

**Rating: Plausible, with methodological caveats**

### Methodology

The script (lines 486-580) tests thresholds 3, 5, 7, 10, 15, 20m. For each consecutive GPS pair, it classifies as "detected stationary" if distance < threshold for 2+ consecutive readings. Ground truth "truly stopped" is defined as 5 consecutive readings within 2m of each other. "Truly moving" is defined as displacement implying >5 km/h over the next 5 readings.

Results at 3m: FP=16.63%, FN=9.83%, combined=26.46%.
Results at 10m (current): FP=24.69%, FN=8.57%, combined=33.26%.

### Concerns

**1. The ground truth definition is circular.** "Truly stopped" is defined by a 2m threshold applied to 5 consecutive readings. This 2m value is itself a threshold choice that directly influences which tested threshold looks best. If the ground truth threshold were 1m, the FP/FN landscape would shift. The analysis is comparing one threshold against an arbitrarily chosen reference threshold.

**2. Stale readings dominate and inflate all true positive counts.** With 62% of consecutive readings being exact duplicates (0m distance), any threshold above 0m classifies these as stationary. Since most stale readings occur when the bus IS stopped, this inflates true positive counts roughly equally for all thresholds, masking the discrimination ability at the interesting boundary (1-15 km/h movement).

**3. The FP+FN combined metric gives equal weight to both errors.** The document correctly argues that false positives (calling slow movement "stationary") are more costly than false negatives (calling a stopped bus "moving"). But then it uses unweighted FP+FN to recommend 3m. A cost-weighted metric (e.g., 2*FP + FN) would be more consistent and would push the recommendation even lower, perhaps to 2m.

**4. The "truly moving" threshold of 5 km/h is lenient.** A bus creeping at 3 km/h in traffic would not be classified as "truly moving" and therefore would not be counted as a false positive at any threshold. This underestimates the FP rate, particularly for low thresholds.

**5. The production code mitigates the main risk.** The production Kalman calculator (`kalman-speed-calculator.ts`, line 283) requires 3 consecutive real updates with small displacement (`REAL_STATIONARY_COUNT = 3`) before confirming stationarity. With ~5s between real updates, this means 15 seconds of sustained small displacement. This consecutive-count requirement makes the system robust against single GPS outliers at stopped buses (which doc 02 shows can reach 4m at P90). The 3m threshold combined with the 3-consecutive requirement is more robust than either mechanism alone.

**6. The FN increase from 10m to 3m is modest.** FN rate goes from 8.57% to 9.83% -- a 1.26 percentage point increase. This means only marginally more stopped buses will momentarily be classified as moving, and the EMA decay in the production code will quickly bring phantom speed to zero.

### What would resolve the uncertainty

- Use GTFS scheduled stop times as independent ground truth for when buses are truly stopped.
- Analyze only non-stale readings (since stale detection handles the dominant case upstream).
- Test with a cost-weighted metric that reflects the FP >> FN asymmetry.

### Bottom line

Reducing from 10m to 3m is directionally correct. The GPS noise floor (~0.6m stopped, ~1-2m moving) supports a threshold well below 10m. The consecutive-count requirement provides sufficient protection against GPS outliers. A threshold in the range of 2-5m would be defensible; the precise optimum depends on ground truth definition and cost weighting, neither of which is rigorously established.

---

## 4. Animation Prediction Quality

**Rating: Flawed (invalid data, acknowledged by the document)**

### Methodology

The script (lines 902-1050) runs a Kalman filter per bus, saves state snapshots at each update, then predicts forward by various horizons (500ms to 10s) and measures haversine distance to the nearest actual GPS position at that future time.

### The results are clearly broken

| Horizon | P50 Error |
|---|---|
| 500ms | 3,123m |
| 10,000ms | 3,133m |

A bus at 50 km/h covers ~7m in 500ms. Median errors of 3km are physically impossible. The document acknowledges this.

### Root cause: reference coordinate bug

The bug is on lines 1004-1007. The prediction loop converts local Kalman coordinates back to lat/lng using a `ref` variable:

```javascript
const predPos = {
    lat: ref.lat + predYm / LAT_M,
    lng: ref.lng + predXm / LNG_M,
};
```

But `ref` is mutated during the Kalman processing loop (line 947: `ref.lat = curr.lat; ref.lng = curr.lng;` on outlier resets). The state snapshots (line 961-966) store `xp, xv, yp, yv` which are local coordinates relative to the `ref` at the time of capture. But when the prediction loop runs, `ref` has been updated to whatever its final value was after all Kalman processing. Any snapshot taken before a ref reset will have its predicted position computed relative to the wrong origin.

The dataset has 924 jumps > 200m. Any bus with even one such jump will have all pre-jump snapshots corrupted. The near-constant P50 across all horizons (~3,123m to ~3,133m) confirms this is a fixed geographic offset, not prediction error. The P75 clustering around ~5,012m and P95 around ~7,354m matches the characteristic distances between route endpoints (doc 02 shows routes spanning 3-16 km).

### The bug was identified but not fixed

The document states "Reinvestigate the analysis script" but publishes the invalid data anyway. The state snapshot structure (line 930) includes `actualLat, actualLng` but not `refLat, refLng`. The fix would be to store `refLat: ref.lat, refLng: ref.lng` in each snapshot and use those for the lat/lng conversion instead of the mutable `ref`.

### No validated replacement results exist

The expected prediction errors cited in the recommendations (500ms: P50 ~2-5m, P90 ~10-15m, etc.) are reasonable estimates based on Kalman filter theory, but they are not derived from data. There is zero empirical evidence on animation prediction quality in this analysis.

### Bottom line

This section's data is entirely invalid and must not inform any decisions. The bug is clearly identified, easy to fix, and should have been fixed before publication. The expected prediction ranges are plausible but unvalidated.

---

## 5. Polling Interval Recommendation (3s)

**Rating: Verified**

### Methodology

The script (lines 1053-1134) builds a timeline of real position changes per bus, then simulates different polling intervals (1-10s) to count how many polls would catch a new GPS update not seen at the previous poll.

### Assessment

**The analysis is sound and the recommendation is well-supported.**

Key findings:
- 1s and 2s polling produce identical data yield (289,285 vs 289,265 new readings). This is consistent with the API `cache-control: max-age=2` header.
- Moving from 2s to 3s loses 5.2% of new data (289,265 to 274,070) while reducing poll count by 33%.
- The effective per-bus update rate is ~0.2 Hz regardless of polling interval (one real update every ~5s).

**One nuance the analysis acknowledges but could quantify better: the latency cost.** The 5.2% data loss is a throughput metric. For real-time animation, the latency metric matters: with 3s polling, the worst-case delay before detecting a new GPS update is 3s vs 2s. At 50 km/h, an extra 1s of prediction extends animation extrapolation by ~14m. The document recommends 2s for active UI and 3s for background, which is the correct stratification.

**The API cache-control header independently confirms the finding.** `max-age=2` means the server refreshes data at most every 2 seconds. Polling at 1s is provably wasted. Polling at 3s may miss one cache generation per two polls, which is exactly the 5.2% data loss observed.

**The data yield per-poll efficiency inflection at 3s is clear:** 14.1% useful at 2s vs 20.0% at 3s. Beyond 3s, diminishing returns are steep (25.1% at 4s but losing 10.9% of data).

### What would add confidence

- Validate over multiple days (GPS update cadence could vary with fleet composition or time of day).
- Quantify per-bus data loss, not just fleet aggregate, since some buses (e.g., Route 31 with P90 gap of 25s) have much longer update gaps where polling interval matters less.

### Bottom line

This is the strongest, most methodologically sound analysis in the document. The 3s recommendation for background collection and 2s for live UI is well-justified.

---

## 6. Speed Limit Matching (50m Radius)

**Rating: Plausible (correct recommendation, misleading headline metric)**

### Methodology

Analysis 8 (lines 1137-1289) computes two metrics:
1. "Moving bus position scatter" -- distance from each raw GPS position to the 5-point moving average centroid.
2. "Cross-track deviation" -- perpendicular distance from each position to the line between its predecessor and successor.

The headline claim: "50m search radius captures 98.8% of positions."

### Concerns

**1. The 98.8% measures the wrong thing.** It measures scatter around the bus's own moving average, not distance from the road centerline. The moving average centroid is the average of 5 noisy GPS positions of a moving bus. At 30 km/h with 5s gaps, the bus moves ~42m between updates, so the center of a 5-point window is ~2-3 intervals from the edges, producing expected deviations of 40-80m that are dominated by the bus's own movement, not GPS noise. The P50 of 11.5m and P90 of 27.0m are mostly measuring "how far does a bus move in half the window duration," not "how far is the GPS position from the road."

**2. The cross-track deviation is the correct metric, but it is relegated to a footnote.** The cross-track analysis (perpendicular to travel direction) gives P50=1.1m, P75=3.7m, P90=8.8m, P95=13.1m. This is the distance a GPS position deviates from the direction of travel, which approximates distance from road centerline on straight segments. The P95 of 13.1m directly supports a 50m radius (with >3x safety margin).

**3. Cross-track deviation also has the curvature problem.** On curved roads, the perpendicular from the instantaneous travel direction diverges from the perpendicular to the road centerline. But for the purpose of speed limit matching (finding the nearest road segment within 50m), this is a second-order concern -- the 50m radius is generous enough to absorb both GPS noise and moderate curvature effects.

**4. The 1.2% that miss are not analyzed.** If a GPS position is >50m from the correct road, the system falls back to 50 km/h. On 80/90 km/h roads, this creates false violations. On 30 km/h roads, it is harmless or even conservative. The document does not analyze the speed limit distribution of roads near the 1.2% outlier positions. Given that 98.8% capture rate means ~2,800 readings per day fall through, and some of these may be on high-speed roads, the false violation rate from fallback should be quantified.

**5. Parallel roads with different speed limits are the real risk.** With P95 cross-track deviation of 13.1m, there is a 5% chance of being 13m+ from the centerline. In areas where a 50 km/h main road runs parallel to a 30 km/h residential street within 25m, the wrong road could be matched. This risk is not analyzed.

### What would resolve the uncertainty

- Compute actual distance from GPS positions to Borgarvefsja road centerlines. The road geometry GeoJSON is available -- this is a direct, curvature-corrected measurement.
- Analyze the 1.2% outlier positions: what roads are they near, and what speed limits apply?
- Identify locations where parallel roads with different speed limits are within 50m of each other and quantify mismatching risk.

### Bottom line

The 50m radius recommendation is correct. The cross-track analysis (P95=13.1m) provides strong support. The "98.8% coverage" headline number is measured from the wrong metric and should not be the basis for the recommendation. The unanalyzed 1.2% of outliers and the parallel-road mismatching risk are the real concerns, but they are unlikely to change the 50m recommendation.

---

## 7. Conservative Speed Factor (0.95 to 0.90)

**Rating: Questionable (premature and likely counterproductive)**

### The recommendation

Doc 05 recommends reducing `CONSERVATIVE_SPEED_FACTOR` from 0.95 to 0.90 based on the 20.2% overestimate rate. The document also recommends fixing sigma_gps (5.0 -> 1.3) and sigma_a (0.8 -> 1.7). The factor reduction is described as a fallback "if sigma fixes are insufficient."

### Concerns

**1. The Kalman parameter fixes and the factor adjustment are coupled; the factor must be re-evaluated after parameter fixes.** The 20.2% overestimate rate was measured with the current mistuned Kalman filter (sigma_gps=5.0, sigma_a=0.8). Fixing these parameters will fundamentally change the filter's behavior -- it will track speed changes more responsively, reducing both overshoot during deceleration and lag during acceleration. The error distribution will change shape. Recommending 0.90 based on the mistuned filter's behavior is like adjusting the brake pedal pressure based on how the car handles with flat tires.

**2. The original justification for 0.95 was Haversine overestimation bias from GPS noise.** CLAUDE.md explains that at 50 km/h with sigma=5m and 5s intervals, GPS noise adds ~5-14 km/h of apparent speed. The 0.95 factor (subtracting ~2.5 km/h at 50 km/h) was calibrated for that noise level. With sigma=1.3m (or the more likely 2.0-2.5m), the Haversine overestimation is much smaller: approximately `2 * sigma^2 / (distance * dt) * 3.6 = 2 * 2.5^2 / 69 * 3.6 = 0.65 km/h` at 50 km/h. The 0.95 factor already overcompensates for this reduced noise. Going to 0.90 would compound the overcompensation.

**3. The pipeline already underestimates 66.1% of the time by a median of 6.6 km/h.** Reducing the factor to 0.90 would shift the entire error distribution leftward by an additional ~speed * 0.05. At 50 km/h, that is 2.5 km/h more underestimation. The new underestimate rate would likely exceed 75%, and the mean error would approach -11 km/h. A bus doing 55 km/h in a 50 zone (a genuine violation) would be reported as `55 * 0.90 = 49.5 km/h` -- invisible to the violation detection system.

**4. The overestimates concentrate in specific contexts, not uniformly.** The error-by-context data shows:
- Near stops (GT < 5 km/h): mean error +5.4 km/h (the actual problem)
- Speed transitions: mean error -9.6 km/h (already heavily underestimated)
- Steady speed: mean error -4.5 km/h (already underestimated)

A uniform factor reduction punishes all contexts equally to fix a problem that exists almost exclusively near stops. This is a blunt instrument. The correct fix for near-stop phantom speed is better stationarity detection (already recommended at 3m) and possibly a more aggressive EMA decay when speed is low, not a fleet-wide scaling factor.

**5. The factor should potentially increase, not decrease, after sigma fixes.** If the Kalman parameter corrections reduce overshoot (as expected), the remaining overestimates will be primarily near-stop phantom speeds. These are better addressed by stationarity and EMA decay logic. The bulk of the speed distribution (20-70 km/h during normal driving) would benefit from a less aggressive factor (0.97-0.98) to reduce the 66.1% underestimate rate and improve violation detection sensitivity.

### What would resolve the uncertainty

- Fix sigma_gps and sigma_a first. Re-run the full error analysis with corrected parameters.
- If overestimation persists, implement a speed-dependent factor: more aggressive near zero (e.g., 0.85 when estimated speed < 10 km/h) and less aggressive at highway speeds (e.g., 0.97 when > 30 km/h).
- Evaluate the factor's effect on violation detection sensitivity (true positive rate for genuine speed limit violations), not just the overestimate rate against an alternative estimator.

### Bottom line

Reducing the factor to 0.90 without first fixing the Kalman parameters would make the underestimation problem worse while providing minimal benefit at high speeds where violations actually matter. The correct sequence is: fix sigma_gps, fix sigma_a, re-evaluate the overestimate rate, then adjust the factor -- which may need to go up, not down.

---

## 8. Additional Concerns

### 8.1 sigma_a = 1.7 may overfit to GPS noise

The recommendation to increase `KALMAN_SIGMA_A` from 0.8 to 1.7 m/s^2 is based on the empirical standard deviation of signed acceleration (1.702 m/s^2). However, the acceleration measurements include GPS-noise-induced phantom acceleration. Doc 03 (Speed & Kinematics, Section 4) shows that 13% of acceleration readings are physically impossible (|a| > 3 m/s^2). These inflate the standard deviation.

The acceleration-by-speed-band data in Analysis 3 shows std increasing from 0.56 m/s^2 at 0-10 km/h to 2.7 m/s^2 at 60-80 km/h. The low-speed value is closer to true bus dynamics; the high-speed value is contaminated by GPS noise amplification (small position errors divided by small time intervals). A sigma_a of 1.0-1.3 m/s^2 (the value for the 20-40 km/h range where most driving occurs) is more defensible than 1.7.

Setting sigma_a too high makes the Kalman filter trust measurements more aggressively, partially defeating the purpose of filtering. The filter becomes more responsive to real speed changes (good) but also more responsive to GPS noise (bad). The optimal sigma_a balances these.

### 8.2 The EMA smoothing layer is not analyzed but is a major lag contributor

The production code applies an EMA with alpha=0.4 to the post-Kalman speed output (`kalman-speed-calculator.ts`, line 367-369). The analysis script replicates this (line 760). With alpha=0.4 and ~5s between real updates, the EMA time constant is approximately `dt / alpha = 12.5s`. This means speed changes are delayed by ~12 seconds *in addition to* the Kalman filter's own lag. Total pipeline latency during speed transitions is likely 15-20 seconds.

This double-smoothing is a major contributor to both the overestimate problem (EMA holds stale speed when bus stops) and the underestimate problem (EMA dampens real acceleration). Doc 05 does not discuss the EMA at all. If the Kalman parameters are corrected (making the filter more responsive), the EMA smoothing should be reduced (alpha -> 0.6-0.7) or removed to avoid compounding the lag.

### 8.3 The endpoint speed bound over-clamps during acceleration

The endpoint speed bound uses the last 6 raw GPS positions (`KALMAN_ENDPOINT_BUFFER_SIZE = 6`). With ~5s between real updates, this spans ~30s. For a bus accelerating from 0 to 60 km/h over 30s, the endpoint speed would be approximately 30 km/h (the average), clamping the Kalman estimate of 60 km/h to 30 km/h. This directly contributes to the 66.1% underestimate rate. A shorter buffer (4 positions, ~20s) would be less aggressive during acceleration.

### 8.4 Single-day dataset limits generalizability

All analyses are based on one Wednesday (2026-03-11). GPS noise, satellite geometry, weather conditions, fleet composition, and traffic patterns all vary by day. The analysis should caveat that all parameter recommendations are optimized for this specific day and may not generalize. At minimum, a second day of data should be analyzed to check stability of key metrics (sigma_gps, update interval distribution, stale rate).

---

## 9. Summary Table

| Claim | Rating | Key Issue |
|---|---|---|
| sigma_gps = 1.3m | **Questionable** | Road curvature confounds the lateral deviation method; contradicts stopped-bus sigma; 70% of data excluded by filters |
| 20.2% overestimate rate | **Plausible** | Real divergence between pipelines, but "ground truth" is another noisy GPS estimate with lookahead bias; near-stop phantom speed is the credible finding |
| 3m stationarity threshold | **Plausible** | Directionally correct; consecutive-count mitigates GPS outlier risk; ground truth definition is circular but the recommendation is defensible |
| Animation prediction quality | **Flawed** | 3000m+ errors are a confirmed script bug (ref coordinate mismatch); no valid data exists; section should have been omitted |
| 3s polling interval | **Verified** | Sound methodology; well-justified tradeoff; consistent with API cache-control header |
| 50m speed limit radius | **Plausible** | Correct recommendation, but the 98.8% headline measures scatter from self-centroid, not distance from road; cross-track analysis (P95=13.1m) is the real support |
| Conservative factor -> 0.90 | **Questionable** | Premature; depends on Kalman parameter fixes that will change the error distribution; would worsen the 66.1% underestimation rate; may need to go up, not down |

---

## 10. Recommended Next Steps

**Priority 1: Fix the animation prediction bug.** Store `refLat, refLng` in each state snapshot and use them for lat/lng conversion. Re-run and validate that errors increase monotonically with horizon. This is the most clearly actionable item.

**Priority 2: Validate sigma_gps against road geometry.** Compute perpendicular distance from GPS positions to Borgarvefsja road centerlines. This gives a direct, curvature-corrected noise estimate and would definitively resolve the 1.3m vs 2.0m vs 5.0m question.

**Priority 3: Fix Kalman parameters in sequence, then re-evaluate downstream.** The correct sequence is:
1. Set sigma_gps from road-geometry-validated analysis (likely 2.0-2.5m)
2. Set sigma_a from the 20-40 km/h band acceleration data (likely 1.0-1.3 m/s^2)
3. Re-run the error analysis with corrected parameters
4. Evaluate whether the EMA alpha needs adjustment (likely increase to 0.6-0.7)
5. Adjust the conservative speed factor based on the new error distribution (may increase to 0.97-0.98)
6. Reduce stationarity threshold to 3m

**Priority 4: Obtain genuine ground truth.** Even one bus trip with OBD-II speedometer data would calibrate all speed accuracy claims. Without it, every "error" measurement is one GPS estimate compared to another.

**Priority 5: Validate on a second day of data.** Confirm that key metrics (sigma, stale rate, update interval distribution) are stable across days before committing to parameter changes.

---

*Review conducted 2026-03-12 against `docs/analysis/05-algorithm-implications.md`, `scripts/analysis-algorithms.mjs`, `src/lib/services/kalman-speed-calculator.ts`, `src/lib/utils/constants.ts`, and docs 01-04.*
