# Master Reference: Straeto Bus GPS Dataset Analysis

Single-day dataset: `data/2026-03-11.jsonl` (Wednesday). 977,707 records, 128 buses, 25 routes, 08:48-19:14 UTC.

This document reconciles all findings from analysis documents 01-05 and the three adversary reviews. Where documents disagree, the resolution is stated with reasoning. Every key number includes provenance, measurement methodology, and confidence level.

---

## Critical Issues

These issues must be understood before acting on any parameter recommendation in this document.

### Issue 1: Prediction Analysis Script Bug (ref coordinate mutation)

**Status:** Confirmed, unresolved.

The animation prediction analysis in doc 05, Analysis 6 produces physically impossible results (3,000m+ median error at 500ms horizon). The root cause is identified in REVIEW-algorithm-claims Section 4: the script's `ref` variable (local coordinate origin) is mutated during Kalman processing but not stored in state snapshots. All predictions after a ref reset are computed against the wrong geographic origin.

**Impact:** Zero valid empirical data exists on animation prediction quality. The expected ranges cited in doc 05 (500ms: P50 ~2-5m) are theoretical estimates, not measurements.

**Fix:** Store `refLat, refLng` in each state snapshot. Re-run analysis and verify errors increase monotonically with horizon.

### Issue 2: Double-Smoothing Problem (Kalman + EMA)

**Status:** Identified by REVIEW-algorithm-claims Section 8.2, not analyzed in any primary document.

The production pipeline applies an EMA (alpha=0.4) on top of Kalman-filtered speed output. With ~5s between real updates, the EMA time constant is ~12.5s. Combined with Kalman filter lag, total pipeline latency during speed transitions is estimated at 15-20 seconds. This is a major contributor to both overestimation (EMA holds stale speed when bus stops) and underestimation (EMA dampens real acceleration). None of the five analysis documents examine the EMA's contribution to error.

**Recommendation:** After correcting Kalman parameters, re-evaluate the EMA. It may need alpha increased to 0.6-0.7 or removal entirely if the corrected Kalman provides sufficient smoothing.

### Issue 3: Ground Truth Methodology Limitation

**Status:** Structural limitation, acknowledged by REVIEW-algorithm-claims Section 2.

The 20.2% overestimate rate in doc 05, Analysis 5 is computed against a "ground truth" that is itself a GPS-derived estimate (3-point moving average of endpoint speeds, multiplied by 0.95). This is not independent ground truth. The moving average includes a 1-step lookahead, creating temporal asymmetry that inflates measured overestimation during deceleration. The true overestimate rate relative to actual bus speed is likely lower (estimated 10-15% per REVIEW-algorithm-claims), but the near-stop phantom speed finding (+5.4 km/h when ground truth < 5 km/h) is credible regardless of methodology because both estimators should be near zero for truly stopped buses.

**Impact:** All speed accuracy numbers in this document should be interpreted as pipeline-vs-pipeline divergence, not pipeline-vs-truth divergence, unless OBD-II or equivalent reference data is obtained.

### Issue 4: Single-Day Dataset Scope

**Status:** Structural limitation, flagged by all three reviews.

All statistics are point estimates from one Wednesday with ~5 hours of effective continuous coverage (11:11-16:11 UTC). There are no confidence intervals. Missing coverage includes: morning rush (06:00-08:48), most of the evening (16:12-19:02, 19:14+), all weekends, and all seasonal variation. Parameter recommendations may not generalize.

### Issue 5: Speed Limit Matching Never Tested

**Status:** Critical gap, identified by REVIEW-gaps Section 1.

The Borgarvefsja road segment GeoJSON (9,997 segments) has never been joined to the bus GPS data. Match rate, wrong-road rate, coverage outside Reykjavik municipality, and fallback frequency are all unknown. This is the core feature of the project and it has zero empirical validation.

---

## 1. Dataset Overview

| Metric | Value | Source | Confidence |
|---|---|---|---|
| File | `data/2026-03-11.jsonl` | All docs | High |
| Date | 2026-03-11 (Wednesday) | All docs | High |
| Total records | 977,707 | All docs (consistent) | High |
| Unique buses | 128 | All docs (consistent) | High |
| Unique routes | 25 | All docs (consistent) | High |
| Unique trip IDs | 1,060 | Doc 04 S5.1 | High |
| Unique headsigns | 51 | Doc 04 S6.1 | High |
| Time span | 08:48:42 to 19:14:05 UTC (10.42 hours) | All docs | High |
| Effective continuous coverage | ~5 hours (11:11-16:11 UTC) | Doc 01, Doc 04 | High |
| Unique positions (lat,lng pairs) | 372,264 | Doc 02 S8.2 | High |
| Record format | JSONL, one JSON object per line | CLAUDE.md | High |

### Collection Gaps

| Gap | Start (UTC) | End (UTC) | Duration |
|---|---|---|---|
| Gap 1 (collector outage) | 08:58:42 | 11:11:31 | 132.8 min |
| Gap 2 (minor) | 15:26:15 | 15:27:29 | 1.2 min |
| Gap 3 (minor) | 15:58:05 | 15:58:39 | 0.6 min |
| Gap 4 (collector outage) | 16:11:30 | 19:02:30 | 171.0 min |

These are collector-side outages, not API outages. The two major gaps remove ~5 hours from the 10.42-hour window. Per-hour statistics for hours 8, 16, and 19 have significantly fewer samples and are less reliable.

### Dataset Limitations

1. **Single day.** No weekend, no seasonal, no multi-day stability data.
2. **Partial day.** Morning rush (06:00-08:48) and evening (16:12-19:14) are largely missing.
3. **Collector gaps bias per-hour statistics.** Hours 9-10 have zero data; hours 8, 16, 19 have limited data.
4. **Single-bus routes.** Routes 8, 22, 23, 35, 36 each have only 1 bus. Per-route statistics for these are per-bus statistics.
5. **Bus 99-A is anomalous.** 100% stale, zero jitter, stationary for 363 minutes at a single coordinate. Likely decommissioned or test vehicle. Should be excluded from fleet statistics.
6. **Bus 31-B is anomalous.** 93.2% position repeat rate, 176 large jumps (19% of all >200m jumps from one bus). Faulty GPS hardware.

---

## 2. API Behavior

### Polling and Caching

| Metric | Value | Source | Confidence |
|---|---|---|---|
| API endpoint | `https://api.straeto.is/graphql` (full GraphQL query) | CLAUDE.md | High |
| Cache-control header | `max-age=2` | CLAUDE.md, Doc 04 | High |
| CORS | `access-control-allow-origin: *` | CLAUDE.md | High |
| Response format | JSON, per-route bus positions | Doc 04 | High |

### Snapshot Structure

The term "snapshot" is ambiguous in the source documents and must be defined carefully.

| Definition | Count | Source | Note |
|---|---|---|---|
| **Unique timestamps** in dataset | 5,580 | Doc 01 S1 | Each timestamp represents a distinct server-side data generation event |
| **API poll responses** (including sub-second re-polls of same cache) | 9,478 | Doc 04 S2.1 | Includes 3,898 polls that hit the same cached response (0-1s gap, 41.4%) |

**Resolution (from REVIEW-contradictions S1.3):** Doc 01's 5,580 counts unique server-side timestamps. Doc 04's 9,478 counts individual HTTP responses, many of which return cached data. For all analyses in this document, "snapshot" means a unique timestamp (5,580). The 9,478 count is the raw poll count.

### Records Per Snapshot

| Metric | Value (using 5,580 snapshots) | Value (using 9,478 polls) | Source |
|---|---|---|---|
| Mean records | 175.2 | 103.2 | Doc 01 S1 / Doc 04 S2.1 |
| Median records | 178 | 93 | Doc 01 S1 / Doc 04 S2.1 |

The 175.2 figure is correct for unique timestamps. The 103.2 figure is diluted by cached re-polls. Use 175.2 for capacity planning.

### Buses Per Snapshot

| Metric | Value | Source |
|---|---|---|
| Min | 64 | Doc 04 S2.1 |
| Median | 93 (at unique timestamps: ~90 midday, ~125 afternoon) | Doc 04 S3.3 |
| Max | 127 | Doc 04 S2.1 |

The distribution is bimodal: ~88-92 buses during midday (11:00-14:00), ramping to 125-127 during afternoon rush (14:45-16:10), dropping to 68-72 in the evening (19:00+).

### Fleet Stability

| Metric | Value | Source |
|---|---|---|
| Buses with >90% snapshot coverage | 92 of 128 (72%) | Doc 04 S3.2 |
| Buses with 99-100% coverage | 73 of 128 (57%) | Doc 04 S3.2 |
| Buses present in all 9,478 polls | 25 | Doc 04 S3.1 |
| Flickering buses (>5 gaps, <95% coverage) | 4 | Doc 04 S3.4 |
| Transient buses (span <5% of day) | 0 | Doc 04 S3.4 |
| Route-switching buses | 5 (16-A, 16-B, 16-C, 17-A, 17-B between routes 16/17) | Doc 04 S5.5 |

### Deduplication Strategy

Three record categories exist in the raw data:

| Category | Count | % of 977,579 pairs | Definition |
|---|---|---|---|
| Same-timestamp duplicates | 405,817 | 41.5% | Same bus appears twice in one poll (per-route querying artifact) |
| Stale readings | 274,817 | 28.1% | Timestamp changed but position identical (API cache of GPS position) |
| Genuine updates | 296,945 | 30.4% | Both timestamp and position changed (true GPS update) |

**Note on the "stale rate" contradiction (REVIEW-contradictions S1.1):** Three stale rates appear in the source docs:
- **48.1%** = stale readings / timestamp-changed pairs = 274,817 / 571,762 (Doc 01). This is the rate among non-duplicate readings.
- **49.8%** = Doc 05's stale rate (287,081 real updates out of ~571K, slightly different filtering criteria; the 10K discrepancy from 296,945 is unexplained -- see REVIEW-contradictions S1.2).
- **61.8%** = zero-distance pairs / all consecutive pairs = 604,095 / 977,579 (Doc 02). This includes same-timestamp duplicates.

**Canonical stale rate for this document: 48.1% of timestamp-changed readings are stale.** This is the rate that matters for Kalman filter skip logic, since same-timestamp duplicates are already removed by dedup.

### Recommended Dedup Approach

| Strategy | Records retained | Reduction | Information lost |
|---|---|---|---|
| No dedup (raw) | 977,707 | 0% | None |
| Dedup by (busId, timestamp) | 571,890 | 41.5% | Same-poll duplicates |
| Drop stale fixes (position unchanged) | ~374,000 | 61.8% | "Still being tracked" signal for parked buses |
| Drop stale + subsample 5s | ~200,000 | 80% | Sub-5s temporal resolution |

Recommended: dedup by (busId, timestamp) for storage. Apply stale detection at runtime for Kalman filter gating.

---

## 3. Temporal Patterns

### Effective Update Frequency

**The key question:** how often does a bus produce a genuinely new GPS position?

| Metric | Value | Source | Note |
|---|---|---|---|
| Raw inter-reading gap P50 | 2.0s | Doc 01 S2 | Includes same-timestamp (0s gaps) |
| Genuine update gap P50 (per-bus) | 4.0s | Doc 01 S2 per-bus table | Nearly all buses show P50=4.0s or 3.0s |
| Genuine update gap P50 (global) | 4.0s | Doc 01 S2 | Direct measurement from genuine-only pairs |
| Fleet-wide effective update gap P50 | 5.0s | Doc 01 S6, Doc 05 Analysis 2 | Aggregated across all buses including gap periods |
| Doc 05 real update count | 287,081 | Doc 05 Analysis 2 | ~10K fewer than Doc 01's 296,945 (unexplained) |

**Resolution (from REVIEW-contradictions S1.8, S1.13):** The per-bus genuine gap P50 is 4.0s. The fleet-wide "effective update gap" P50 is 5.0s. The difference is due to aggregation method: the fleet-wide figure includes gap periods where some buses have long stale runs that pull up the global median. Doc 02's estimate of "6-7 seconds" is derived from the stale-to-genuine ratio and overestimates the actual update rate.

**For Kalman filter tuning, use dt=5s as the typical update interval.** This accounts for the fact that the filter will sometimes wait longer than the per-bus P50 due to stale runs. Confidence: Medium (single-day data).

### Real Update Gap Distribution (Doc 05 Analysis 2)

| Bucket | Count | % |
|---|---|---|
| 2-4s | 77,753 | 27.1% |
| 4-6s | 102,456 | 35.7% |
| 6-8s | 64,061 | 22.3% |
| 8-10s | 19,064 | 6.6% |
| 10-15s | 10,401 | 3.6% |
| 15-30s | 8,892 | 3.1% |
| 30-60s | 3,156 | 1.1% |
| 60-300s | 1,298 | 0.5% |

The distribution peaks at 4-6s (35.7%) with 85.1% of updates arriving within 8 seconds.

### Stale Run Lengths

A "stale run" is consecutive stale readings for one bus before a genuine update.

| Metric | Value | Source |
|---|---|---|
| Total stale runs | 110,429 | Doc 01 S3 |
| P50 run length | 1.0 | Doc 01 S3 |
| P90 | 3.0 | Doc 01 S3 |
| P95 | 6.0 | Doc 01 S3 |
| Max | 4,118 | Doc 01 S3 |

77.8% of stale runs are length 1 (a single stale reading followed by a genuine update). The long tail (runs > 500) represents parked buses.

### Stale Rate by Route

Ranges from 32.4% (Route 7, most active) to 68.1% (Route 31, most stale). Source: Doc 01 S3. Route 31 is a known outlier with GPS quality issues.

### Per-Hour Fleet Activity

| Hour (UTC) | Active Buses | Snapshots | Stale % | Note |
|---|---|---|---|---|
| 8 | 123 | 177 | 25.3% | Only 10 min before gap |
| 11 | 90 | 840 | 29.6% | Post-gap restart |
| 12 | 92 | 1,094 | 32.0% | |
| 13 | 103 | 1,089 | 31.7% | |
| 14 | 125 | 1,049 | 28.5% | Fleet ramp-up begins |
| 15 | 127 | 943 | 22.7% | Peak fleet, lowest stale rate |
| 16 | 72-127 | 388 | 21.4% | Partial coverage before gap |
| 19 | 68-72 | ~200 | 32.6% | Only 12 min after gap |

### Timestamp Characteristics

| Property | Value | Source |
|---|---|---|
| Precision | Whole seconds only (zero milliseconds) | Doc 01 S1 |
| Timestamps per snapshot | 1-2 distinct values | Doc 04 S4.3 |
| Snapshots with single timestamp | 41.7% | Doc 04 S4.3 |

The API batch-updates all bus positions on a ~2-3 second tick. Each response contains data from 1-2 tick cycles.

---

## 4. Spatial Characteristics

### Operating Area

| Metric | Value | Source | Confidence |
|---|---|---|---|
| Latitude range | 64.0392 - 64.1849 (0.1457 deg, 16.17 km) | Doc 02 S1 | High |
| Longitude range | -22.0272 - -21.6568 (0.3704 deg, 18.00 km) | Doc 02 S1 | High |
| Approximate coverage | 16.2 x 18.0 km = ~291 km^2 | Doc 02 S1 | High |
| Mean centroid | 64.123317, -21.875763 | Doc 02 S1 | High |
| Median center | 64.129480, -21.891379 | Doc 02 S1 | High |
| Fixes within 5 km of centroid | 78.3% | Doc 02 S1 | High |
| Fixes within 10 km of centroid | 97.1% | Doc 02 S1 | High |
| Occupied 100m grid cells | 2,993 of 29,160 (10.3%) | Doc 02 S6.3 | High |

### Route Geographic Coverage

| Route | Records | Buses | N-S span (km) | E-W span (km) | Bbox area (km^2) | Note |
|---|---|---|---|---|---|---|
| 1 | 96,315 | 12 | 12.27 | 10.10 | 123.9 | Longest, reaches Hafnarfjordur |
| 15 | 74,656 | 8 | 5.26 | 15.25 | 80.2 | Widest E-W, reaches Mosfellsbaer |
| 24 | 46,820 | 6 | 10.34 | 10.58 | 109.3 | Reaches Alftanes peninsula |
| 12 | 84,439 | 12 | 6.38 | 7.15 | 45.6 | Highest bus count (tied with route 1) |
| 13 | 31,954 | 5 | 3.19 | 4.91 | 15.6 | Compact urban |
| 8 | 9,127 | 1 | 1.82 | 2.42 | 4.4 | Single bus, smallest coverage |
| 35/36 | ~9,477 each | 1 each | ~0.87 | ~4.08 | ~3.5 | 96.7% overlap, nearly identical routes |

Source: Doc 02 S6.1. Routes 1, 15, and 24 extend significantly beyond the urban core and are most likely to encounter speed-limit-matching coverage gaps from the Reykjavik-only Borgarvefsja dataset.

### Coordinate Precision and Quantization

| Property | Value | Source | Confidence |
|---|---|---|---|
| Minimum latitude increment | 1.6667e-8 deg (0.0018 m) | Doc 02 S2.2 | High |
| Minimum longitude increment | 1.6667e-7 deg (0.0081 m) | Doc 02 S2.2 | High |
| Encoding | Appears to be integer multiples of 1/60,000,000 degree | Doc 02 S2.3 | Medium |
| Records with "333"/"667" trailing digits | ~66% | Doc 02 S2.3 | High |
| Records with 13 decimal places | ~66% | Doc 02 S2.1 | High |
| Records with <= 4 decimal places | ~2.7% (lat), ~2.6% (lng) | Doc 02 S2.1 | High |

The quantization (0.002m lat, 0.008m lng) is ~300x below the GPS noise floor and is invisible to all algorithms. The ~2.5% of positions at 4 decimal places (11m precision) could affect speed limit matching in ambiguous zones, but this is unquantified (REVIEW-gaps Gap 2).

### GPS Noise (Stationary)

Measured from 3,572 stationary episodes (20+ fixes within 5m) per Doc 02 S4, and from 8,777 episodes (>=10 fixes within 1m) per Doc 05 Analysis 1.

**Resolution of the sigma contradiction (REVIEW-contradictions S1.7, S1.12):**

| Metric | Doc 02 (stationary, 3,572 episodes, 20+ fixes within 5m) | Doc 05 (stationary, 8,777 episodes, 10+ fixes within 1m) | Resolution |
|---|---|---|---|
| Per-axis sigma P50 | 0.33m lat, 0.34m lng | 0.10m lat, 0.11m lng | Different populations: Doc 05 uses stricter distance criterion (1m) capturing more API-cached episodes with near-zero scatter |
| 2D RMS P50 | 0.641m | ~0.07m | Doc 05's 1m threshold includes more cached episodes (14.4% have zero variation) |
| 2D RMS P99 | 1.911m | 1.764m | Tail is more consistent |
| Max deviation P50 | 2.289m | 0.547m (max spread P50) | Different metrics |

**The key insight:** stationary GPS noise is confounded by API position caching. 14.4% of stopped episodes return the exact same coordinate for every reading (Doc 05 Analysis 1). These zeros pull down the median dramatically. For non-cached stopped episodes, the scatter is:

| Metric | Value | Source |
|---|---|---|
| Per-axis sigma (non-cached stops, Doc 05) | mean 0.14m lat, 0.15m lng | Doc 05 Analysis 1 |
| Per-axis sigma (all stops, Doc 02) | median 0.33m lat, 0.34m lng | Doc 02 S4.1 |
| 2D RMS (all stops, Doc 02) | median 0.641m, mean 0.674m | Doc 02 S4.1 |

### GPS Noise (Moving)

| Metric | Value | Source | Confidence |
|---|---|---|---|
| Lateral deviation from 3-point line (P50) | 1.08m | Doc 05 Analysis 1 | Medium |
| Lateral deviation P90 | 9.07m | Doc 05 Analysis 1 | Low (curvature-contaminated) |
| Lateral deviation P95 | 13.40m | Doc 05 Analysis 1 | Low (curvature-contaminated) |
| Implied sigma_gps from P50 | 1.33m (= 1.08 * sqrt(3/2)) | Doc 05 Analysis 1 | Medium |
| Cross-track deviation P50 | 1.1m | Doc 05 Analysis 8 | Medium |
| Cross-track deviation P95 | 13.1m | Doc 05 Analysis 8 | Medium |

**Critical caveat (REVIEW-algorithm-claims S1):** The 1.33m sigma estimate is contaminated by road curvature. A bus rounding a 200m radius curve at 40 km/h with 5s between updates produces ~7.8m sagitta, which far exceeds the claimed noise. The P90 of 9.07m is 3.2x the theoretical value for a Rayleigh distribution with sigma=1.3m, confirming curvature contamination. The P50 is more robust to curvature (dominated by straight-road segments) but still biased upward. Additionally, 70% of data pairs were excluded by the analysis filters, creating selection bias toward well-conditioned data.

### GPS Noise: Resolved Estimate

| Context | sigma_gps estimate | Confidence | Reasoning |
|---|---|---|---|
| Stationary (fresh fixes) | 0.3-0.7m per axis | Medium | Doc 02 measurements, excluding cached episodes |
| Moving (curvature-corrected) | 1.5-3.0m per axis | Low | REVIEW-algorithm-claims bounds: 1.3m is floor (curvature-contaminated P50), 5.0m is ceiling (original over-conservative assumption) |
| **Recommended for Kalman R matrix** | **2.0-2.5m per axis** | **Low** | Midpoint of REVIEW-algorithm-claims range; pending road-geometry validation |

The wide uncertainty range (2.0-2.5m) reflects that no curvature-corrected measurement has been performed. Computing perpendicular distance from GPS positions to Borgarvefsja road centerlines would resolve this definitively (REVIEW-algorithm-claims S1, recommended next step).

### Distance Between Consecutive Fixes

| Percentile | All pairs (m) | Non-stale only (m) | Source |
|---|---|---|---|
| P1 | 0.00 | 0.62 | Doc 02 S3.1 |
| P25 | 0.00 | 15.49 | Doc 02 S3.1 |
| P50 | 0.00 | 31.69 | Doc 02 S3.1 |
| P75 | 9.71 | 51.48 | Doc 02 S3.1 |
| P90 | 44.17 | 73.00 | Doc 02 S3.1 |
| P99 | 97.30 | 126.26 | Doc 02 S3.1 |

The median non-stale displacement of 31.7m over ~5s corresponds to ~23 km/h, consistent with urban bus driving.

### Direction Field

| Property | Value | Source |
|---|---|---|
| Resolution | Integer degrees only (0 decimal places) | Doc 02 S5.2 |
| Range | -2 to 360 (normalize to 0-359) | Doc 02 S5.1 |
| Median bearing error (moves > 5m) | 2.0 degrees | Doc 02 S5.4 |
| % within 10 degrees of computed bearing | 81.5% | Doc 02 S5.4 |
| % within 30 degrees | 95.5% | Doc 02 S5.4 |
| Direction unchanged between consecutive fixes | 75.0% (Doc 02) / 74.8% (Doc 04) | Minor discrepancy (1,911 records) |
| Bearing error for >200m jumps | P90 = 116.6 degrees | Doc 02 S5.5 |

The direction field is reliable for moves >5m and usable directly for marker rotation. It is unreliable during teleportation events and for moves <5m.

### Large Position Jumps

| Classification | Count | % of 924 jumps >200m | Source |
|---|---|---|---|
| Plausible travel (implied speed <= 90 km/h) | 510 | 55.2% | Doc 02 S7.5 |
| Suspicious (90-200 km/h) | 198 | 21.4% | Doc 02 S7.5 |
| GPS glitch (>200 km/h) | 216 | 23.4% | Doc 02 S7.5 |

Jump distance distribution:

| Range | Count | % |
|---|---|---|
| 200-500m | 593 | 64.2% |
| 500m-1km | 93 | 10.1% |
| 1-2km | 59 | 6.4% |
| 2-5km | 111 | 12.0% |
| 5-10km | 61 | 6.6% |
| >10km | 7 | 0.8% |

Bus 31-B accounts for 176 of 924 jumps (19%). The most extreme glitch: bus 6-H, 8.01 km in 5 seconds (5,770 km/h).

---

## 5. Speed and Kinematics

### Raw Haversine Speed Distribution

Based on 296,945 valid speed pairs (dt > 0, distance > 0.5m). Source: Doc 03 S2.1.

| Percentile | Speed (km/h) |
|---|---|
| P1 | 0.56 |
| P10 | 4.00 |
| P25 | 16.25 |
| P50 | 31.53 |
| P75 | 51.76 |
| P90 | 77.90 |
| P95 | 99.27 |
| P99 | 149.87 |
| Max | 11,054.22 |
| Mean | 38.74 |

**Anomaly rates:**

| Threshold | Count | % |
|---|---|---|
| > 90 km/h | 20,025 | 6.7% |
| > 120 km/h | 7,662 | 2.6% |

Note: Doc 02 counts 216 GPS glitches (>200 km/h implied speed from >200m jumps). Doc 03 counts 7,662 readings >120 km/h across all speed pairs. These are different populations -- Doc 02 counts large-jump events; Doc 03 counts all raw Haversine speeds above threshold. An implementer using "reject if speed > 120 km/h" would reject 7,662 readings (2.6%), not 216 (REVIEW-contradictions S2.5).

### Speed by Route (Selected)

| Route | N | P50 (km/h) | P90 (km/h) | P95 (km/h) | Mean (km/h) | Note |
|---|---|---|---|---|---|---|
| 13 (slowest) | 10,720 | 22.03 | 45.62 | 56.39 | 24.25 | Dense urban |
| 14 | 13,901 | 24.12 | 52.60 | 65.24 | 27.18 | Dense urban |
| 3 (typical) | 19,347 | 33.47 | 82.39 | 104.14 | 39.82 | |
| 1 (longest) | 24,640 | 33.75 | 88.19 | 112.35 | 42.71 | Reaches suburbs |
| 31 (anomalous) | 2,690 | 42.82 | 143.29 | 216.16 | 68.94 | GPS hardware issue |
| 23 (anomalous) | 2,177 | 48.35 | 110.29 | 136.94 | 62.65 | Single bus, high noise |

Route 31's P95 of 216.16 km/h is 2-4x the fleet norm. Routes 31 and 23 should be flagged for degraded data quality.

### Speed by Hour of Day

| Hour (UTC) | N | P50 (km/h) | P90 (km/h) | P95 (km/h) | Mean (km/h) | Source |
|---|---|---|---|---|---|---|
| 8 | 12,424 | 31.16 | 73.46 | 92.74 | 36.99 | Doc 03 S2.3 |
| 11 | 36,918 | 32.51 | 76.91 | 97.22 | 39.49 | Doc 03 S2.3 |
| 12 | 47,416 | 33.03 | 82.72 | 104.92 | 40.59 | Doc 03 S2.3 |
| 13 | 48,790 | 33.04 | 82.51 | 105.93 | 41.76 | Doc 03 S2.3 |
| 14 | 62,485 | 31.74 | 78.96 | 100.26 | 39.11 | Doc 03 S2.3 |
| 15 | 68,406 | 29.46 | 72.78 | 92.28 | 35.74 | Doc 03 S2.3 |
| 16 | 13,340 | 26.87 | 67.03 | 84.75 | 32.14 | Doc 03 S2.3 |
| 19 | 7,166 | 34.34 | 87.75 | 112.58 | 42.57 | Doc 03 S2.3 |

Hour 19 has the highest speeds (mean 42.57, P95 112.58) -- fewer buses on emptier roads. Hours 15-16 are slowest (afternoon rush). The anomaly rate at hour 19 is 9.28% (highest) vs 4.06% at hour 16 (lowest). Sample sizes at hours 8, 16, 19 are 3-9x smaller than midday and are less reliable.

### Anomaly Hotspots

Top anomaly clusters by 500m grid (Doc 03 S3.4):

| Location | Anomalies >90 km/h | Distinct Buses | Likely Area |
|---|---|---|---|
| (64.125, -21.900) | 242 | 30 | Urban interchange |
| (64.125, -21.848) | 225 | 48 | Breidholt/Mjodd area |
| (64.115, -21.843) | 188 | 36 | Near Mjodd |
| (64.105, -21.905) | 180 | 19 | Possible highway segment |
| (64.125, -21.850) | 169 | 49 | Breidholt/Mjodd area |

High bus counts per cell (30-49) confirm these are location-driven GPS artifacts, not single-bus hardware issues. These hotspots should be cross-referenced with speed limit data. If they fall in 50 km/h zones, violation detection needs extra caution there.

### Problematic Buses and Routes

| Entity | Problem | Evidence | Recommendation |
|---|---|---|---|
| Bus 99-A | Completely stationary, zero jitter | 100% stale, 6,818 identical positions over 363 min | Exclude from all statistics |
| Bus 31-B | Faulty GPS | 93.2% repeat rate, 176 jumps >200m (19% of all), max jump 1,610m | Flag, reduce trust in speed estimates |
| Bus 2-A | Intermittent GPS failure | 13 of top 30 impossible accelerations, all in a 15-min window | Transient hardware issue |
| Route 31 | Systematic GPS quality issues | P95 speed 216 km/h, P90 gap 25s, highest stale rate (68.1%) | Flag data quality, suppress violation alerts |
| Route 23 | Single-bus high noise | Mean speed 62.65 km/h (60% above fleet), max 8,001 km/h | Only 1 bus, 2,177 readings; do not generalize |
| Routes 16/17 | Route-switching buses | 5 buses cross-operate between these routes | Use routeNr field, not bus ID prefix |

### Acceleration Distribution

**Contradiction resolved (REVIEW-contradictions S1.9, S1.11):** Doc 03 reports 295,906 samples and P95(|a|)=5.13 m/s^2. Doc 05 reports 271,610 samples and P95(|a|)=3.819 m/s^2. The 24,296 sample discrepancy (8.2%) is unexplained but likely reflects different filtering criteria in Doc 05 (possibly requiring both speeds non-zero or restricting to a bus subset). Doc 05's filtered dataset excludes extreme events, yielding a lower P95.

**Canonical values (using Doc 03's larger, less-filtered dataset):**

| Metric | Value | Source | Confidence |
|---|---|---|---|
| Signed acceleration P50 | 0.01 m/s^2 | Doc 03 S4.1 | High |
| Signed acceleration mean | 0.21 m/s^2 | Doc 03 S4.1 | High |
| |a| P50 | 0.88 m/s^2 | Doc 03 S4.1 | High |
| |a| P90 | 3.53 m/s^2 | Doc 03 S4.1 | High |
| |a| P95 | 5.13 m/s^2 | Doc 03 S4.1 | High |
| Physically impossible (|a| > 3 m/s^2) | 38,685 (13.1%) | Doc 03 S4.2 | High |
| Signed std dev | 1.702 m/s^2 | Doc 05 Analysis 3 | Medium (filtered subset) |

The P95 of 5.13 m/s^2 exceeds physical braking limits for a city bus (~3 m/s^2). The 13% impossible rate is dominated by GPS noise amplification at short time intervals (78.3% occur at dt < 5s per Doc 03 S4.3).

**Acceleration by speed band (Doc 05 Analysis 3):**

| Speed band (km/h) | |accel| P50 | |accel| P90 | Std |
|---|---|---|---|
| 0-10 | 0.241 | 0.860 | 0.561 |
| 10-20 | 0.567 | 1.710 | 1.056 |
| 20-30 | 0.634 | 1.969 | 1.348 |
| 30-40 | 0.822 | 2.642 | 1.692 |
| 40-50 | 1.066 | 3.639 | 2.193 |
| 50-60 | 1.331 | 4.120 | 2.444 |
| 60-80 | 1.684 | 4.515 | 2.706 |

Acceleration increases with speed partly due to genuine dynamics and partly due to GPS noise amplification.

### Phantom Speed at Stops

| Context | N windows | P50 (km/h) | P90 (km/h) | P95 (km/h) | Max (km/h) | Source |
|---|---|---|---|---|---|---|
| Stopped (spread <3m) | 31,299 | 0.00 | 0.35 | 1.89 | 10.10 | Doc 03 S5.1 |
| Slow (3-10m spread) | 40,517 | 0.01 | 5.08 | 8.16 | 35.64 | Doc 03 S5.2 |
| Low speed (10-30m spread) | 190,841 | 0.01 | 9.46 | 16.54 | 62.01 | Doc 03 S5.3 |

**After 3-point moving average (stopped buses only):**

| Metric | Raw | 3-pt avg |
|---|---|---|
| P95 | 1.89 km/h | 1.29 km/h |
| Max | 10.10 km/h | 5.65 km/h |

The 3-point average cuts the tail by ~30-44%. The Kalman filter should achieve better noise reduction.

### Speed Jitter

| Metric | Raw (km/h) | 3-pt avg (km/h) | Reduction |
|---|---|---|---|
| P50 jitter | 14.54 | 6.98 | 2.08x |
| P75 jitter | 29.41 | 12.95 | 2.27x |
| P90 jitter | 51.56 | 21.09 | 2.45x |
| Mean jitter | 22.45 | 9.81 | 2.29x |

Source: Doc 03 S6.1. Jitter scales linearly with speed: P50 jitter is 2.18 km/h at 0-5 km/h but 33.10 km/h at 50+ km/h (Doc 03 S6.2).

### Speed Estimation Error (Current Pipeline)

From Doc 05 Analysis 5, comparing Kalman + EMA pipeline against 3-point moving average of endpoint speeds (both multiplied by 0.95). 61,029 comparisons across 20 buses.

| Metric | Value |
|---|---|
| Overestimate rate (>2 km/h) | 20.2% |
| Underestimate rate (>2 km/h) | 66.1% |
| Within +/-2 km/h | ~13.7% |
| Mean error | -8.6 km/h |
| Median error | -6.6 km/h |
| Max overestimate | 48.4 km/h |
| Overestimate P50 (when overestimating) | 6.0 km/h |
| Overestimate P90 | 12.9 km/h |

**Error by context:**

| Context | Points | Mean Error | Note |
|---|---|---|---|
| Speed transitions (GT range > 10 km/h) | 52,021 | -9.6 km/h | Dominant category; Kalman+EMA lag |
| Steady speed | 7,333 | -4.5 km/h | Systematic underestimation |
| Near stops (GT < 5 km/h) | 1,675 | +5.4 km/h | **Most problematic**: phantom speed from pipeline lag |

**Interpretation (per REVIEW-algorithm-claims S2):** The 20.2% is a real pipeline-vs-pipeline divergence. True overestimate rate vs actual speed is likely 10-15%. The near-stop phantom speed (+5.4 km/h) is the most credible and actionable finding. The overestimate rate is consistent across all 20 buses (17.3-22.6%), confirming a systematic pipeline issue.

### Driving Behavior Profile

From 5 representative buses (Doc 03 S7):

| Behavior | Time % |
|---|---|
| Accelerating (dv > 3 km/h) | ~39-40% |
| Cruising (|dv| <= 3 km/h) | ~20-21% |
| Decelerating (dv < -3 km/h) | ~40-41% |

This 40/20/40 split is remarkably consistent across all analyzed buses. Only ~20% of driving time is at steady speed.

### Stop Detection

| Metric | Value | Source |
|---|---|---|
| Total stops detected (>15s near-zero) | 12,093 | Doc 03 S8 |
| Median stop duration | 23 seconds | Doc 03 S8 |
| 15-30s stops | 63.3% | Doc 03 S8 |
| Stops per bus per hour (median) | 10.2 | Doc 03 S8 |

---

## 6. Algorithm Parameter Recommendations

This section presents the final recommended parameter table, reconciling Doc 05's original recommendations with corrections from REVIEW-algorithm-claims.

### Final Parameter Table

| Parameter | Current | Recommended | Confidence | Rationale |
|---|---|---|---|---|
| `KALMAN_SIGMA_GPS` | 5.0m | **2.0-2.5m** | Low | Doc 05 recommends 1.3m but this is an underestimate due to curvature contamination (REVIEW-algorithm-claims S1). Doc 02's 0.4m is stationary-only and too low for moving buses. The true moving-bus sigma is in the 1.5-3.0m range per REVIEW-algorithm-claims. Use 2.0-2.5m as starting point pending road-geometry validation. |
| `KALMAN_SIGMA_A` | 0.8 m/s^2 | **1.0-1.2 m/s^2** | Medium | Doc 05 recommends 1.7m/s^2 based on overall signed acceleration std (1.702). But this includes GPS-noise-induced phantom acceleration (13% of readings are physically impossible per Doc 03 S4.2). The 20-40 km/h band (where most driving occurs) has std of 1.3-1.7 m/s^2, and the low-speed band (0-10 km/h) has std of 0.56. Per REVIEW-algorithm-claims S8.1, 1.0-1.3 balances responsiveness to real acceleration against GPS noise. |
| `CONSERVATIVE_SPEED_FACTOR` | 0.95 | **0.95 (keep, re-evaluate after sigma fixes)** | Medium | Doc 05 recommends 0.90 but REVIEW-algorithm-claims S7 argues this is premature and counterproductive: it would worsen the 66.1% underestimate rate without addressing the root cause (mistuned Kalman parameters). After fixing sigma_gps and sigma_a, the error distribution will change. The factor may need to go UP to 0.97-0.98, not down. Keep at 0.95 until re-evaluation with corrected parameters. |
| `REAL_STATIONARY_DIST_M` | 5.0m | **3.0m** | Medium | Doc 05 Analysis 4: combined FP+FN at 3m is 26.46% vs 30.68% at 5m. REVIEW-algorithm-claims S3 confirms directionally correct. The production code's consecutive-count requirement (3 real updates) provides robustness against GPS outliers at any threshold. |
| `MIN_DISTANCE_THRESHOLD_M` | 10.0m | **3.0m** | Medium | Align with stationarity threshold. Doc 03 defends 10m as "well-calibrated" but Doc 05 shows 24.69% false positive rate at 10m (calling slow movement "stationary"). Doc 02 suggests 0.5m is feasible but this is too aggressive given the moving-bus noise of 1-3m. 3m balances false positives and false negatives. |
| `POLLING_INTERVAL_MS` (collector) | 2000 | **3000** | High | Strongest finding in doc 05 (REVIEW-algorithm-claims rates it "Verified"). 33% fewer API requests, 5.2% data loss. API cache-control: max-age=2 confirms 1s polling is wasted. |
| `POLLING_INTERVAL_MS` (live UI) | 2000 | **2000 (keep)** | High | Lower latency matters for animation. 2s aligns with API cache TTL. |
| `MAX_SPEED_LIMIT_SEARCH_DISTANCE_M` | 50m | **50m (keep)** | Medium | Cross-track P95 of 13.1m supports 50m with >3x safety margin. 98.8% capture rate measured from self-centroid (wrong metric per REVIEW-algorithm-claims S6) but the cross-track analysis independently supports 50m. |
| `KALMAN_ENDPOINT_BUFFER_SIZE` | 6 | **4-5** | Low | REVIEW-algorithm-claims S8.3: with 6 positions at ~5s intervals = 30s window. During acceleration from 0 to 60 km/h over 30s, the endpoint speed averages to ~30 km/h, clamping the Kalman estimate aggressively. Reducing to 4-5 positions (20-25s) is less aggressive during acceleration while still bounding speed. |
| `MAX_ACCEL_MS2` | 3.0 | **3.0 (keep)** | Medium | Doc 03 P95(|a|) = 5.13 clips ~5% of readings. Doc 05 says P95 = 3.82 clips ~5%. The true clip rate with Doc 03's unfiltered data is ~10-13% at 3.0 (REVIEW-contradictions S1.11). This is acceptable -- the clipped events are a mix of noise and genuine hard acceleration. |
| `MAX_DECEL_MS2` | 5.0 | **5.0 (keep)** | High | Well above observed braking magnitudes. |
| `EMA_ALPHA` | 0.4 | **0.6-0.7 (after sigma fixes)** | Low | Not analyzed in any primary doc. REVIEW-algorithm-claims S8.2 identifies double-smoothing as a major lag contributor. After sigma fixes make Kalman more responsive, reduce EMA's dampening effect. Alternatively, remove EMA entirely if corrected Kalman provides sufficient smoothing. |

### Parameter Change Sequence

Per REVIEW-algorithm-claims S10, parameters must be changed in order because they are coupled:

1. **Validate sigma_gps** against road geometry (compute perpendicular distance from GPS to Borgarvefsja centerlines). Set to validated value (expected 2.0-2.5m).
2. **Set sigma_a** to 1.0-1.2 m/s^2 (20-40 km/h band acceleration data).
3. **Re-run error analysis** with corrected Kalman parameters.
4. **Evaluate EMA alpha.** If Kalman is now responsive enough, increase alpha to 0.6-0.7 or remove EMA.
5. **Adjust conservative speed factor** based on new error distribution. It may need to increase to 0.97-0.98 (not decrease to 0.90).
6. **Reduce stationarity threshold** to 3m.
7. **Re-run prediction analysis** after fixing the ref coordinate bug.

### Outlier Rejection Rules

| Rule | Catches | Rate | Source |
|---|---|---|---|
| Implied speed > 120 km/h | GPS glitches and noise amplification | 7,662 readings/day (2.6%) | Doc 03 S3.1 |
| Distance > 200m AND time < 5s | Short-range teleportation | ~50 events/day | Doc 02 S7 |
| Distance > 2km AND time < 60s | Route teleportation | ~20 events/day | Doc 02 S7 |
| Consecutive identical positions >= 20 | Parked/offline buses | Flags, does not reject | Doc 02 S8 |
| Per-bus jump rate > 50/day | Faulty GPS hardware | Flags bus 31-B | Doc 02 S7.3 |

Note: the original 500m fixed-distance threshold from CLAUDE.md misses 593 of 924 anomalous jumps (64%) in the 200-500m range (Doc 02 S7). Speed-based rejection (implied speed > 120 km/h) is strictly better.

### Kalman Filter Process Noise Formula

For the constant-velocity Kalman model, the process noise matrix Q for time step dt:

```
Q = sigma_a^2 * | dt^4/4   dt^3/2 |
                 | dt^3/2   dt^2   |
```

Applied per-axis (x and y independently). With the recommended sigma_a = 1.0-1.2 m/s^2 and typical dt = 5s:

```
Q_xx = Q_yy = sigma_a^2 * | 156.25   62.50 |    (for sigma_a=1.0, dt=5)
                           |  62.50   25.00 |
```

Measurement noise:

```
R = | sigma_gps^2    0          |
    | 0              sigma_gps^2 |

R = | 4.0-6.25   0        |    (for sigma_gps=2.0-2.5)
    | 0          4.0-6.25  |
```

### Stale Fix Handling in Kalman Filter

When a stale fix is detected (position identical to previous reading):

1. **Skip the measurement update entirely.** Do not feed the duplicate position to the Kalman filter.
2. **Run prediction step only** to advance the state estimate forward in time using current velocity.
3. **Do not reset velocity to zero.** The bus may still be moving; the API simply returned cached data.
4. **After a genuine update arrives**, the measurement update corrects the accumulated prediction drift.

This is the current production behavior and is correct.

### Filter Reset Conditions

| Condition | Action | Rationale |
|---|---|---|
| Implied speed > 120 km/h | Hard reset at new position, zero velocity | GPS glitch; prediction is meaningless |
| Gap > 60 seconds | Soft reset: reinitialize position, reduce velocity estimate by 50% | Bus likely changed direction/speed during gap |
| Trip ID change with position jump > 100m | Hard reset at new position | Bus assigned to new route |
| First appearance of bus | Initialize at reported position, zero velocity | No prior state |

Estimated ~22 resets per bus per day (REVIEW-gaps Supp. B). Each reset produces a warm-up period of 3-5 readings (15-25s). Total warm-up time is ~1.5% of operating time per bus.

---

## 7. Speed Limit Matching

### Road Segment Data

| Property | Value | Source |
|---|---|---|
| API | Borgarvefsja ArcGIS REST, Layer 23 | CLAUDE.md |
| Total segments | 9,997 | CLAUDE.md |
| Format | GeoJSON FeatureCollection | CLAUDE.md |
| Coverage | Reykjavik municipality (WKID 3057, reprojected to WGS84) | CLAUDE.md |
| Key fields | NAFN (name), HRADI (speed limit km/h), geometry (LineString) | CLAUDE.md |

**Speed limit distribution:**

| Limit (km/h) | Segments |
|---|---|
| 1 (pedestrian) | 26 |
| 15 | 39 |
| 30 | 4,476 |
| 40 | 363 |
| 50 | 4,795 |
| 60 | 125 |
| 70 | 32 |
| 80 | 110 |
| 90 | 31 |

### Matching Algorithm Design

| Parameter | Value | Rationale |
|---|---|---|
| Search radius | 50m | Cross-track P95 = 13.1m gives >3x margin |
| Fallback speed limit | 50 km/h | Iceland urban default |
| Spatial index | 100m grid, ~3,000 occupied cells | Precompute (cell -> nearest segments) for O(1) lookup |
| Disambiguation | Prefer cross-track (perpendicular) distance over radial; use direction field to disambiguate parallel roads | Doc 05 Analysis 8, REVIEW-gaps Gap 8 |

### High-Density Grid Cells (Speed Limit Caching Candidates)

Top bus activity cells at 100m resolution (Doc 02 S6.3):

| Rank | Approx Location | Fixes | Routes Present | Likely Landmark |
|---|---|---|---|---|
| 1 | 64.110, -21.843 | 20,957 | 1,2,3,4,11,12,17,21,24 | Mjodd terminal |
| 2 | 64.149, -21.927 | 15,856 | 1,4,11,16,17,18 | Artun/Mjoddin area |
| 3 | 64.123, -21.788 | 12,899 | 1,6,31 | Eastern terminus |
| 4 | 64.110, -21.841 | 11,070 | 2,3,4,11,12,17,19,21,24 | Near Mjodd |
| 5 | 64.148, -21.936 | 9,361 | 1,2,3,6,11,12,13,14 | Hlemmur area |

The top cell (Mjodd) sees 9 routes and 21K fixes/day. Precomputing speed limits for these high-density cells eliminates runtime spatial queries for a large fraction of all bus positions.

### Unvalidated Risks

All from REVIEW-gaps Gap 1:

1. **Coverage outside Reykjavik.** Routes 1, 15, 24 extend to Kopavogur, Hafnarfjordur, Mosfellsbaer. The Borgarvefsja dataset may not cover these municipalities. Buses outside coverage would get the 50 km/h fallback, which is wrong on 80/90 km/h suburban roads.
2. **Parallel road ambiguity.** With P95 cross-track deviation of 13.1m, 5% of positions could snap to a parallel road with a different speed limit. Not quantified.
3. **Match failure rate.** Unknown. Depot parking lots and bus turnaround areas may lack road centerlines.
4. **Fallback appropriateness.** The 50 km/h fallback is correct for urban areas but wrong for suburban/rural segments. A location-aware fallback would be better.

### Recommended Validation Script

To close the critical speed-limit-matching gap, implement a script that:
1. Loads `static/speed_limits.geojson` and `data/2026-03-11.jsonl`
2. For every non-stale bus position, finds the nearest road segment(s) within 10m, 25m, 50m, 100m
3. Reports: (a) match rate by distance threshold, (b) map of unmatched positions by route, (c) speed limit distribution of matched segments, (d) ambiguity rate (2+ segments within 50m with different HRADI values), (e) coverage gaps by route (positions outside Reykjavik municipality boundary)

### Map Animation Parameters

Derived from spatial and temporal analysis across all documents.

| Parameter | Recommended Value | Rationale |
|---|---|---|
| Default map center | 64.1295, -21.8914 (median center) | Captures 97% of bus activity within 10km radius |
| Marker pool size | 130 minimum | Peak fleet is 127 buses |
| Stale-fix interpolation | Continue Kalman prediction at constant velocity | Bridges ~5s gap between real updates; marker moves smoothly |
| Direction display | Use API direction field directly | 2-degree median accuracy at moves >5m; integer resolution invisible on map |
| Direction smoothing | Slerp over ~300ms | Prevents robotic 1-degree step changes |
| Teleportation detection | Distance >200m AND time <5s | Teleport marker instantly; do not animate impossible trajectories |
| Bus disappearance delay | 30-60s before fading, 2-3 min before removal | Most buses are persistent; flickering is rare (4 buses) |
| New bus appearance | Immediate, no warm-up animation | Buses appear gradually in fleet, not in bursts |
| Speed cap for animation | ~90 km/h | P90 raw speed is 77.9 km/h; anything above 90 is suspect |
| Correction blending | 400ms (current) is appropriate | Low GPS noise (sub-meter stationary) means corrections are small |

### Violation Detection Design Considerations

| Consideration | Detail |
|---|---|
| **Expected false violation rate from raw speed** | 6.7% of readings >90 km/h; vast majority are GPS artifacts |
| **Post-pipeline overestimate rate** | 20.2% pipeline-vs-pipeline (likely 10-15% vs true speed) |
| **Near-stop phantom speed** | +5.4 km/h mean when truly stopped; will generate false low-speed violations in 30 km/h zones |
| **Correlated violations at hubs** | Multiple buses at Mjodd/Hlemmur may show simultaneous violations from shared GPS error; implement location-based debounce |
| **Route 31 suppression** | Data quality too poor for reliable violation detection; flag but do not alert |
| **Violation confidence** | After the full pipeline (Kalman + factor + stationarity), any detected violation is likely genuine with high confidence for speeds >40 km/h. Below 30 km/h, phantom speed risk is significant. |
| **Speed limit fallback** | The 50 km/h fallback will generate false violations on 80/90 km/h roads outside Reykjavik coverage. Suppress violations when using fallback speed. |

---

## 8. Known Limitations and Gaps

Organized by priority, from REVIEW-gaps and REVIEW-contradictions.

### Critical

| Gap | Description | Impact |
|---|---|---|
| Speed limit matching untested | Zero bus positions have been matched to road segments | Core feature may not work; unknown match/failure/wrong-road rates |
| Animation prediction bug | Ref coordinate mutation in analysis script | No valid prediction quality data; fix and re-run |

### Important

| Gap | Description | Impact |
|---|---|---|
| Single-day dataset | All parameters are point estimates from one Wednesday | No confidence intervals; may not generalize to weekends, other seasons, fleet changes |
| Trip transition behavior | 1,933 trip changes/day unexamined for GPS quality effects | Trip changes may produce position jumps, unnecessary Kalman resets, or data quality drops |
| Bus stop correlation | Stationary episodes not cross-referenced with GTFS stop locations | Cannot distinguish bus stops from depots from traffic lights; affects stationarity handling |
| Route-specific GPS quality | No per-route noise/stale/anomaly comparison | If noise varies 2x+ across routes, single parameters are suboptimal |
| Correlated multi-bus errors | Co-located buses share satellite geometry and atmospheric delay | Simultaneous violations at hubs may be correlated GPS events, inflating counts |
| Missing data patterns | Route-level and area-level gaps not analyzed | Some routes may appear clean simply because they lack data during high-speed periods |
| Speed error vs update rate | Polling interval recommendation based on efficiency, not accuracy impact | Changing rate will change accuracy in unknown ways |
| Kalman warm-up behavior | ~22 resets/bus/day producing ~1.5% warm-up time | Warm-up periods may disproportionately contribute to overestimates |
| EMA double-smoothing | EMA alpha=0.4 adds ~12.5s lag on top of Kalman | Major latency contributor, never analyzed in primary docs |

### Nice-to-Have

| Gap | Description | Impact |
|---|---|---|
| Coordinate quantization details | Mixed precision (2.5% at 11m) not correlated with bus ID | May reveal hardware differences; practical impact minimal |
| Time-of-day GPS effects | No per-hour noise analysis | Likely small effect, but cannot confirm without full-day data |
| Direction field exploitation | Unused for speed limit disambiguation and teleportation detection | Low risk if unused; moderate benefit if exploited |

---

## 9. Terminology Reference

The source documents use inconsistent terminology. This section defines canonical terms for this project.

| Term | Definition | Notes |
|---|---|---|
| **Record** | One JSON line in the JSONL file, representing one bus's data from one API response | 977,707 total |
| **Snapshot** | A group of records sharing one unique timestamp (server-side data generation event) | 5,580 total. NOT the same as an API poll (9,478 total). |
| **Same-timestamp duplicate** | Two consecutive records for the same bus with identical timestamps | 405,817 pairs (41.5%). Caused by per-route API querying. |
| **Stale reading** | A record where the timestamp is new but the position is identical to the previous record for that bus | 274,817 pairs (28.1% of all pairs, 48.1% of timestamp-changed pairs). GPS hardware cached position. |
| **Genuine update** | A record where both timestamp and position differ from the previous record for that bus | 296,945 pairs (30.4% of all pairs). True GPS position update. |
| **Stale rate** | Stale readings / (stale readings + genuine updates) = 48.1% | Excludes same-timestamp duplicates from denominator. |
| **Position duplicate rate** | Zero-distance consecutive pairs / all consecutive pairs = 61.8% | Includes same-timestamp duplicates. |
| **Real update gap** | Time between consecutive genuine updates for one bus | P50 = 5.0s (fleet-wide), P50 = 4.0s (per-bus) |
| **Effective update rate** | Rate at which genuine GPS data arrives | ~0.2 Hz per bus (one update every ~5s) |

---

## 10. Quick Reference: Key Numbers

| What | Value | Confidence |
|---|---|---|
| Total records | 977,707 | High |
| Genuine updates | 296,945 (30.4%) | High |
| Stale rate (of timestamp-changed) | 48.1% | High |
| Unique buses | 128 (92 stable core) | High |
| Unique routes | 25 | High |
| Real update gap P50 | 5.0s fleet-wide, 4.0s per-bus | High |
| GPS noise (stationary, 2D RMS) | 0.64m median | High |
| GPS noise (moving, sigma estimate) | 2.0-2.5m (uncertain) | Low |
| Coordinate quantization step | 0.002m lat, 0.008m lng | High |
| Median raw speed | 31.53 km/h | High |
| Readings > 120 km/h | 7,662 (2.6%) | High |
| Physically impossible acceleration (|a|>3) | 13.1% | High |
| Phantom speed at stops (P95) | 1.89 km/h raw, 1.29 km/h averaged | High |
| Speed jitter P50 | 14.54 km/h raw, 6.98 km/h averaged | High |
| Pipeline overestimate rate | 20.2% (pipeline-vs-pipeline) | Medium |
| Pipeline near-stop phantom speed | +5.4 km/h mean | Medium-High |
| Large jumps (>200m/day) | 924 | High |
| GPS glitches (>200 km/h implied) | 216/day | High |
| Bus stops detected | 12,093 (median 23s duration) | High |
| Stops per bus per hour | 10.2 median | High |
| Direction field accuracy | 2.0 deg median error (moves >5m) | High |
| Speed limit search radius | 50m (captures P95 cross-track) | Medium |
| Polling interval (collector) | 3s optimal (5.2% data loss vs 2s) | High |
| Polling interval (live UI) | 2s optimal (matches API cache TTL) | High |
| Recommended sigma_gps | 2.0-2.5m | Low (pending validation) |
| Recommended sigma_a | 1.0-1.2 m/s^2 | Medium |
| Recommended stationarity threshold | 3.0m | Medium |
| Recommended conservative factor | 0.95 (keep, re-evaluate after fixes) | Medium |

---

## 11. Source Document Index

| Document | Focus | Key Contribution |
|---|---|---|
| `01-temporal-patterns.md` | Polling cadence, update frequency, stale patterns, gaps | Canonical stale rate (48.1%), genuine update count (296,945), gap analysis |
| `02-spatial-geographic.md` | Bounding box, coordinate precision, GPS jitter, direction field, jumps | Stationary GPS noise (0.64m RMS), position duplicate rate (61.8%), jump classification |
| `03-speed-kinematics.md` | Raw speed distribution, anomalies, acceleration, phantom speed, jitter | Speed percentiles, phantom speed quantification, 3-point average effectiveness, stop detection |
| `04-api-behavior.md` | Snapshot structure, fleet lifecycle, staleness, bus/trip/route IDs | Poll count (9,478), fleet stability (92 core buses), trip/headsign patterns |
| `05-algorithm-implications.md` | Parameter recommendations, Kalman analysis, prediction quality | sigma_gps=1.3m (disputed), sigma_a=1.7 (disputed), 20.2% overestimate rate, polling optimization |
| `REVIEW-contradictions.md` | Cross-document inconsistencies | 13 number contradictions, 5 logical contradictions, 3 terminology inconsistencies |
| `REVIEW-algorithm-claims.md` | Adversary review of doc 05's claims | sigma_gps corrected to 2.0-2.5m, overestimate rate contextualized, conservative factor rebuttal |
| `REVIEW-gaps-and-missing.md` | Unasked questions and missing analyses | Speed limit matching gap (critical), 10 identified gaps with priority ranking |

---

*Synthesized 2026-03-12 from 8 source documents. All numbers derived from `data/2026-03-11.jsonl` unless otherwise noted. This document supersedes individual analysis docs for parameter decisions.*
