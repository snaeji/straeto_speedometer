# Cross-Document Review: Contradictions, Inconsistencies, and Errors

Reviewed documents:
- `01-temporal-patterns.md` (hereafter **Doc 1**)
- `02-spatial-geographic.md` (hereafter **Doc 2**)
- `03-speed-kinematics.md` (hereafter **Doc 3**)
- `04-api-behavior.md` (hereafter **Doc 4**)
- `05-algorithm-implications.md` (hereafter **Doc 5**)

---

## Quick Reference: Severity Summary

| # | Topic | Docs | Severity |
|---|---|---|---|
| 1.1 | Stale rate: 48.1% vs 49.8% vs 61.8% | 01, 02, 04, 05 | **Critical** |
| 1.2 | Genuine updates: 296,945 vs 287,081 | 01, 02, 05 | Major |
| 1.3 | Snapshot count: 5,580 vs 9,478 | 01, 04 | Major |
| 1.4 | Same-ts duplicates: 405,817 vs 403,790 | 01, 04 | Minor |
| 1.5 | Wasted records: 41.5% vs 41.3% (internal) | 04 | Minor |
| 1.6 | Records per snapshot: 175.2 vs 103.2 | 01, 04 | Major |
| 1.7 | GPS noise sigma: 0.4m vs 1.3m | 02, 05 | **Critical** |
| 1.8 | Update gap median: 4s vs 5s | 01 (internal) | Major |
| 1.9 | Acceleration samples: 295,906 vs 271,610 | 03, 05 | Major |
| 1.10 | Direction unchanged: 75.0% vs 74.8% | 02, 04 | Minor |
| 1.11 | Acceleration P95: 5.13 vs 3.819 m/s^2 | 03, 05 | **Major** |
| 1.12 | Stopped episodes: 3,572 vs 8,777 | 02, 05 | Major |
| 1.13 | Bus GPS update median: 3s vs 4s vs 5s | 01, 04, 05 | Major |
| 2.1 | Min distance threshold: 0.5m vs 3m vs 10m | 02, 03, 05 | **Critical** |
| 2.2 | Polling interval: no loss vs 5.2% loss at 3s | 04, 05 | Minor |
| 2.3 | Dedup target: ~374K vs 571,890 | 02, 04 | Major |
| 2.4 | 500m outlier threshold: adequate vs inadequate | 02, 03 | Major |
| 2.5 | Conservative speed factor: 0.90 vs conditional | 05 (internal) | Major |

---

## 1. Number Contradictions

### 1.1 Stale rate: 48.1% vs 49.8% vs 61.8%

Three different "stale rate" numbers appear across the documents, and they are not clearly reconciled:

- **Doc 1** (Executive Summary): "Of 571,762 timestamp-changed record pairs, 274,817 (48.1%) had identical positions."
- **Doc 5** (Analysis 2): "Overall stale rate: 49.8% of readings are stale."
- **Doc 2** (Section 3.2 / Section 8.1): "61.8% of consecutive GPS fixes are exact duplicates" and "Total consecutive exact-position repeats: 604,095 out of 977,579 pairs (61.8%)"

The 48.1% figure excludes same-timestamp duplicates from the denominator (571,762 timestamp-changed pairs). The 61.8% figure uses all 977,579 consecutive pairs as the denominator, including same-timestamp duplicates. The 49.8% from Doc 5 falls between them and is not explicitly defined as using either denominator. This is confusing because all three are presented as "the stale rate" without consistent qualification.

**Impact:** A reader looking across documents for "the stale rate" will find three different numbers and no clear statement of which is canonical. Doc 5 uses the 49.8% figure for Kalman tuning recommendations but does not explain its derivation relative to the other two values.

### 1.2 Genuine position updates: 296,945 vs 287,081

- **Doc 1** (Section 2): "Genuine: 296,945 (30.4%)" -- genuine position changes after excluding same-timestamp duplicates and stale readings.
- **Doc 2** (Section 3.1): "Non-stale only: Count = 296,945" -- same number, consistent with Doc 1.
- **Doc 5** (Analysis 2): "Real update gaps (after removing stale readings): 287,081 real updates"

Doc 5's 287,081 is ~10,000 fewer than the 296,945 used in Docs 1 and 2. This is a significant discrepancy (3.3% fewer). If this represents a different filtering criterion (e.g., requiring position change > some threshold), it is not stated. The reader cannot tell whether Doc 5 analyzed a different subset or has a bug.

### 1.3 Total snapshots: 5,580 vs 9,478

- **Doc 1** (Section 1): "Unique timestamps: 5,580" and "5,580 distinct snapshots"
- **Doc 4** (Executive Summary): "977,707 records across 9,478 API snapshots" and (Section 2.1) "Total snapshots: 9,478"

These are nearly a 2x difference. Doc 1 counts "unique timestamps" (5,580), while Doc 4 counts "API snapshots" (9,478). The difference is 3,898, which likely represents sub-second duplicate polls that hit the same cache (Doc 4 Section 2.2 shows 41.4% of gaps are "0-1s"). But this is never explicitly stated. Doc 4 says "Total snapshots: 9,478" while Doc 1 says "5,580 distinct snapshots" -- both use the word "snapshots" to mean different things.

**Impact:** Any cross-reference between Doc 1 and Doc 4 on per-snapshot metrics will produce different results depending on which snapshot count is used.

### 1.4 Same-timestamp duplicate count: 405,817 vs 403,790

- **Doc 1** (Section 2): "Same-timestamp: 405,817 (41.5%)" -- same-timestamp consecutive pairs.
- **Doc 4** (Section 8.1): "Pure duplicates (same busId, lat, lng, ts): 403,790 (41.3%)"

A difference of 2,027. Doc 1 defines "same-timestamp" as "bus appeared in two records within the same API poll (same ts)" -- this includes cases where the position might differ. Doc 4 requires all four fields (busId, lat, lng, ts) to be identical. There could be 2,027 same-timestamp pairs where the position differs slightly (e.g., due to floating-point rounding across multiple API response entries). However, Doc 4 also states "Same-ts but different position: 0 (0.0%)" -- which should mean these counts are identical. They are not. One of the counts is wrong.

**Impact:** If "same-ts but different position" is truly zero, then 405,817 should equal 403,790. This is an arithmetic inconsistency.

### 1.5 Wasted records: 41.5% vs 41.3%

Related to 1.4 above:

- **Doc 1**: "Same-timestamp: 405,817 (41.5%)" -- out of 977,579 pairs.
- **Doc 4**: "Wasted records: 405,817 (41.5%)" -- but also says "Pure duplicates: 403,790 (41.3%)" out of 977,579 pairs.

Doc 4 itself is internally inconsistent: it gives 403,790 as "pure duplicates" in one cell and 405,817 as "wasted records" two lines later. The 405,817 number matches Doc 1's same-timestamp count, not Doc 4's own pure-duplicate count.

### 1.6 Records per snapshot: 175.2 vs 103.2

- **Doc 1** (Section 1, Records Per Snapshot): "Mean: 175.2" and "P50: 178.0"
- **Doc 4** (Section 2.1): "Records per snapshot (avg): 103.2" and "Buses per response: Mean 103.2, Median 93.0"

This is because Doc 1 has 977,707 records / 5,580 timestamps = 175.2, while Doc 4 has 977,707 / 9,478 snapshots = 103.2. The discrepancy follows from the snapshot count difference (1.3 above), but neither document acknowledges the other's figure. A reader would conclude two very different things about how many buses appear per API call.

### 1.7 GPS noise: 0.64m RMS vs 1.3m sigma

- **Doc 2** (Executive Summary): "GPS noise is remarkably low: median 0.64m RMS when stationary."
- **Doc 2** (Section 4.1): "RMS 2D (m) P50 = 0.641"
- **Doc 5** (Critical Issue #2): "sigma_gps is set to 5.0m but the empirical value is 1.3m"
- **Doc 5** (Analysis 1): "GPS noise from moving buses: Implied sigma_gps (P50 * sqrt(3/2)) = 1.33m"

Doc 2 measures GPS noise from *stationary* episodes and gets 0.64m RMS. Doc 5 measures from *moving* buses (lateral deviation from 3-point line) and gets 1.33m. Both claim to be the authoritative GPS noise figure for Kalman tuning. Doc 2's recommendation table says "Measurement noise R (per axis): 0.16 m^2 (sigma = 0.4m)" while Doc 5 recommends "KALMAN_SIGMA_GPS = 1.3m". These are 3.25x apart.

Both documents are arguably correct for their respective contexts (stationary vs. moving), but they reach opposite tuning recommendations:
- **Doc 2**: R = 0.16 m^2 per axis (sigma = 0.4m)
- **Doc 5**: sigma_gps = 1.3m, meaning R ~= 1.69 m^2 per axis

These cannot both be right for the same Kalman filter. The filter either uses one value or the other.

### 1.8 Effective update gap median: 5s in multiple docs, but different tables

- **Doc 1** (Section 6): Fleet-Wide Effective Update Gap P50 = 5.00s
- **Doc 5** (Analysis 2): Real update gaps P50 = 5.0s

These agree, which is good. However:

- **Doc 1** (Section 2, Genuine update gaps): P50 = 4.00s

This is the "genuine update gap" directly from the per-bus classification, with P50 = 4.0s. Meanwhile the "effective update gap" from Section 6 of the same document gives P50 = 5.0s. The difference is not explained. Presumably one excludes gaps during collection outages while the other includes them, but the text does not clarify.

### 1.9 Per-bus acceleration samples: 295,906 vs 271,610

- **Doc 3** (Section 4): "Total acceleration samples: 295,906"
- **Doc 5** (Analysis 3): "Total acceleration measurements: 271,610"

A difference of 24,296. These should be measuring the same thing (consecutive speed pair differences). Neither document explains the discrepancy. Doc 5 may apply additional filtering (e.g., requiring both speeds to be non-zero, or only using a subset of buses), but this is not stated.

### 1.10 Direction unchanged: 75.0% vs 74.8%

- **Doc 2** (Section 5.3): "Zero change (same direction): 732,884 (75.0%)"
- **Doc 4** (Section 7.2): "Direction unchanged: 730,973 (74.8%)"

A difference of 1,911 records. Both claim to measure consecutive pairs with identical direction values. The percentage difference is small but the raw count difference is unexplained and suggests different filtering criteria for "consecutive pair."

### 1.11 Acceleration P95 (absolute): 5.13 vs 3.819 m/s^2

- **Doc 3** (Section 4.1): "Absolute acceleration |a|: P95 = 5.13 m/s^2"
- **Doc 5** (Analysis 3): "Absolute acceleration: P95 = 3.819 m/s^2"

These differ by 1.34x. Combined with the sample count discrepancy (1.9 above), Doc 5's filtered dataset appears to exclude extreme acceleration events, yielding a lower P95. This matters directly because Doc 5 uses its lower P95 value to justify keeping `MAX_ACCEL_MS2 = 3.0`: "P95 of signed acceleration is 3.050, clips about 5% of acceleration events." But if the true absolute P95 is 5.13 (Doc 3), the 3.0 cap clips approximately 10-13% of events, not 5%.

### 1.12 Stopped episode count: 3,572 vs 8,777

- **Doc 2** (Section 4): "Found 3,572 stationary episodes (20+ fixes within 5m)"
- **Doc 5** (Analysis 1): "Stopped bus episodes (>=10 consecutive readings within 1m): 8,777 total"

Doc 5 finds 2.5x more episodes despite a stricter distance criterion (1m vs 5m). This is because Doc 5 requires only 10 fixes (vs Doc 2's 20) and uses "consecutive readings" (possibly including stale fixes) vs Doc 2's approach. The dramatically different episode counts mean the GPS noise statistics derived in each document are computed from different populations, directly contributing to the sigma disagreement in 1.7.

### 1.13 Bus GPS update median interval: 3s vs 4s vs 5s (across all documents)

Five different claims for the typical update interval appear across the corpus:

- **3.0s**: Doc 4 Section 9.4 ("Bus GPS update interval: Median 3.0s") -- includes both stale and genuine timestamp changes.
- **4.0s**: Doc 1 Per-Bus table -- nearly all buses show Genuine P50 = 4.0s. This is per-bus median of genuine-only gaps.
- **5.0s**: Doc 1 Executive Summary ("effective GPS update rate... median of 5 seconds") and Doc 5 Analysis 2 ("Real update gaps: P50 = 5.0s") -- global genuine-only gap median.
- **6-7s**: Doc 2 Section 3 ("the underlying GPS hardware reports a new position roughly every 6-7 seconds on average") -- estimate from stale-to-genuine ratio.

The correct value for Kalman filter tuning depends on which definition is used. Doc 4's 3.0s is misleading for this purpose (includes stale). The per-bus 4.0s (Doc 1) and global 5.0s (Docs 1/5) disagree due to aggregation method. Doc 2's 6-7s is an overestimate.

---

## 2. Logical Contradictions

### 2.1 Minimum distance threshold: 10m is "well-calibrated" vs "too high"

- **Doc 3** (Key Takeaways, item 3): "The minimum distance threshold of 10m is well-calibrated. Phantom speed at stops maxes at 10.10 km/h raw and 5.65 km/h averaged. A 10m threshold at 2-second intervals (equivalent to 18 km/h) sits safely above both."
- **Doc 5** (Critical Issue #3): "Stationarity detection thresholds are too high. The current dual-threshold system uses MIN_DISTANCE_THRESHOLD_M = 10m... The analysis shows 3m is the optimal threshold."
- **Doc 2** (Key Takeaways): "Minimum movement for update: 0.5m (not 10m) ... The 10m threshold from the original spec was designed for 3-5m noise and is too aggressive."

Doc 3 explicitly defends 10m as correct. Doc 5 explicitly says 10m is too high and should be 3m. Doc 2 goes further and says 0.5m is appropriate. These are directly contradictory recommendations for the same parameter.

### 2.2 API polling interval: "zero data loss" vs "5.2% data loss" at 3s

- **Doc 4** (Section 9.4): "No data loss at 3s: Every poll returns new data for effectively every bus (100% of polls have new data, and the full fleet of 103.2 buses updates within each 3s window)."
- **Doc 5** (Analysis 7): "Increase POLLING_INTERVAL_MS from 2000 to 3000... 33% fewer polls, 5.2% data loss... losing ~0.2 real readings per minute per bus"

Doc 4 explicitly claims zero data loss at 3s. Doc 5 explicitly measures 5.2% data loss at 3s (289,265 new readings at 2s vs 274,070 at 3s). These directly contradict. Doc 4's "zero data loss" appears to mean "every poll returns at least some new data" (true) rather than "no GPS updates are missed" (false). Doc 5's 5.2% is the correct measure for speed calculation purposes.

### 2.3 Position deduplication reduces to ~374K vs 571,890

- **Doc 2** (Section 3, "What This Means"): "Deduplication on (busId, lat, lng) would cut the dataset from 977K to ~374K records with zero information loss."
- **Doc 4** (Section 8.1): "Unique (busId, ts) pairs: 571,890" -- dedup by (busId, timestamp) yields 571,890.

These are two different dedup strategies with very different outcomes. Doc 2 also states "Drop stale fixes (recommended): ~374,000 records kept, 62% reduction." However, Doc 4's timestamp-based dedup keeps 571,890 -- a 41.5% reduction. Both are presented as "recommended." A reader following Doc 2's recommendation would lose 197,890 records compared to Doc 4's approach (the stale readings that have new timestamps but same positions).

This is not exactly a contradiction since they use different keys, but both are labeled "recommended" with no cross-reference to explain the tradeoff.

### 2.4 Conservative speed factor: 0.90 firm vs conditional (Doc 5 internal)

- **Doc 5** (Executive Summary table): "CONSERVATIVE_SPEED_FACTOR: Current 0.95, Recommended 0.90"
- **Doc 5** (Analysis 5 Recommendations): "If overestimate rate remains above 5% after parameter correction, reduce CONSERVATIVE_SPEED_FACTOR from 0.95 to 0.90"

The summary table presents 0.90 as THE recommendation. The detailed analysis presents it as a conditional fallback -- only to be applied if fixing sigma_gps and sigma_a does not sufficiently reduce overestimates. Since the 20.2% overestimate rate was measured with sigma_gps=5.0m, and fixing sigma to 1.3m should substantially improve things, the 0.90 factor might be too aggressive after the primary fixes are applied. The unconditional recommendation in the summary could lead to excessive underestimation.

### 2.5 Outlier rejection: distance-based vs speed-based

- **Doc 2** (Section 7, "What This Means"): "The original 500m outlier threshold would miss 64% of anomalous jumps... The implied-speed approach is strictly better."
- **Doc 3** (Section 3.6, "What This Means"): "A distance threshold of ~500m between consecutive fixes catches type 1 [teleportation] perfectly."

Doc 2 says 500m distance threshold is inadequate. Doc 3 says 500m distance threshold "catches type 1 perfectly." These are discussing different anomaly types (Doc 2 talks about all >200m jumps; Doc 3 talks specifically about teleportation >1000 km/h), but the phrasing is contradictory and would confuse someone looking for a single outlier rejection strategy.

Additionally, Doc 2 recommends rejecting at "implied speed > 120 km/h" (216 events per day from >200m jumps), while Doc 3 shows 7,662 readings exceed 120 km/h across all speed pairs. A reader implementing "reject if speed > 120 km/h" following Doc 2's recommendation would actually reject 7,662 readings (2.6% of data), not 216 (0.02%). The disconnect is that Doc 2 counts only large-jump events while Doc 3 counts all raw Haversine speeds.

---

## 3. Math Errors and Verification Issues

### 3.1 Doc 1 stale percentage check

Doc 1 states: "Of 571,762 timestamp-changed record pairs, 274,817 (48.1%) had identical positions."

Check: 274,817 / 571,762 = 0.4807 = 48.1%. Correct.

But 571,762 = 977,579 - 405,817 (total pairs minus same-timestamp). Check: 977,579 - 405,817 = 571,762. Correct.

Then genuine updates: 571,762 - 274,817 = 296,945. Doc 1 states "296,945 (30.4% of all consecutive pairs)." Check: 296,945 / 977,579 = 0.3036 = 30.4%. Correct.

### 3.2 Doc 5 combined error rate at 5m threshold

Doc 5 (Analysis 4): "combined error rate... 30.68% at 5m"

From the table: 5m threshold FP Rate = 21.25%, FN Rate = 9.43%. Sum = 30.68%. Correct.

But the Parameter Recommendations Summary says: "Best FP+FN balance: 26.46% combined at 3m vs. 30.68% at 5m" -- this is consistent with the table. However, the Executive Summary table says "current 5m has 21.25% FP rate" for REAL_STATIONARY_DIST_M. The table does not mention the 9.43% FN rate. This is not an error but is incomplete.

### 3.3 Doc 4 snapshot count and records math

Doc 4: "Total snapshots: 9,478. Total records: 977,707. Records per snapshot (avg): 103.2."

Check: 977,707 / 9,478 = 103.15. Reported as 103.2. Correct (rounded).

### 3.4 Doc 2 distance bucket percentages don't perfectly reconcile

Doc 2 Section 3.2: "0 m (exact same position): 604,095 (61.80%)"

Check: 604,095 / 977,579 = 0.6179 = 61.8%. Correct.

But Doc 2 Section 8.1 also says: "Total consecutive exact-position repeats: 604,095 out of 977,579 pairs (61.8%)". Consistent.

However, Doc 1 says same-timestamp pairs are 405,817, and stale pairs are 274,817. That is 405,817 + 274,817 = 680,634. This should relate to the 604,095 zero-distance pairs, but it doesn't: 680,634 != 604,095. The difference is 76,539. This means 76,539 pairs have zero time gap (same timestamp) but nonzero distance, or stale timestamp but nonzero distance. That seems inconsistent with the definitions. Actually, same-timestamp pairs always have zero distance (the GPS didn't update in zero time), which explains most of it. But 680,634 > 604,095 by 76,539, which means 76,539 same-timestamp pairs do NOT have identical positions. Yet Doc 4 says "Same-ts but different position: 0 (0.0%)". This is a contradiction unless the 405,817 same-timestamp count from Doc 1 and the 403,790 from Doc 4 differ precisely because Doc 1 counts all same-timestamp pairs (including multi-entry per snapshot from different routes), while Doc 4 requires exact position match.

**Likely explanation:** The 604,095 zero-distance pairs in Doc 2 use a different pairing methodology. Doc 2 pairs consecutive records for the same bus sorted by time, which may merge same-timestamp records differently than Doc 1 (which explicitly separates same-timestamp into its own category). The numbers cannot be directly compared but this is never explained.

### 3.5 Doc 5 polling efficiency

Doc 5 (Analysis 7): "Moving from 2s to 3s reduces total polls by 33% (from 2.05M to 1.37M) while losing only 5.2% of new data (289,265 to 274,070)."

Check: (289,265 - 274,070) / 289,265 = 0.0525 = 5.25%. Reported as 5.2%. Correct (rounded).

Check: 2,052,142 to 1,368,072. Reduction: (2,052,142 - 1,368,072) / 2,052,142 = 0.3333 = 33.3%. Correct.

---

## 4. Missing Cross-References

### 4.1 Doc 5 does not reference Doc 3's phantom speed analysis

Doc 5's Analysis 5 (Speed Estimation Error) discusses overestimation near stops (+5.4 km/h mean error when ground truth < 5 km/h) but never references Doc 3's detailed phantom speed quantification (Section 5), which provides the empirical noise floor. The two analyses address the same phenomenon from different angles but do not cite each other.

### 4.2 Doc 3 does not reference Doc 5's Kalman overestimation findings

Doc 3's Key Takeaways section 1 states: "Raw Haversine is unusable for speed estimation. Mean overestimation is ~20% due to GPS noise." It then says "the Kalman filter in the current codebase should achieve even better reduction" than the 3-point average. But Doc 5 shows the Kalman filter *still* overestimates 20.2% of the time. Doc 3 does not acknowledge this critical finding.

### 4.3 Doc 2's GPS noise recommendation is not referenced by Doc 5

Doc 2 recommends R = 0.16 m^2 (sigma = 0.4m per axis) based on stationary analysis. Doc 5 recommends sigma_gps = 1.3m based on moving-bus analysis. Neither document references or rebuts the other's recommendation. A reader following Doc 2's guidance would set a dramatically different Kalman gain than one following Doc 5.

### 4.4 Route 31 analysis is scattered without cross-reference

Route 31 is flagged as problematic in:
- Doc 1 (highest stale rate at 68.1%)
- Doc 3 (P95 speed 216.16 km/h, detailed Section 10.1)
- Doc 5 (Analysis 2: "Route 31 is a notable outlier with median gap of 6.0s and P90 of 25.0s")

But none of these cross-reference each other. A complete picture of Route 31's problems requires reading all three independently.

---

## 5. Terminology Inconsistencies

### 5.1 "Stale" has at least three definitions

- **Doc 1**: "Stale" = timestamp changed but position unchanged (274,817 records, 28.1% of all pairs, 48.1% of timestamp-changed pairs)
- **Doc 2**: "Stale" = position unchanged from previous reading regardless of timestamp (604,095 pairs, 61.8% of all pairs)
- **Doc 4**: "Staleness" = age of GPS data relative to poll time (poll_time - bus_ts), measured in seconds
- **Doc 5**: "Stale" = undefined explicitly, but "49.8% of readings are stale" without specifying which definition

These are three entirely different concepts labeled with the same word. Doc 2's "stale" includes Doc 1's "same-timestamp" category; Doc 4's "staleness" is a continuous time measure, not a binary classification.

### 5.2 "Genuine update" vs "real update" vs "new reading"

- **Doc 1**: "Genuine" = both timestamp and position changed (296,945)
- **Doc 4**: "Genuinely new readings" = unique (busId, ts) pairs that differ from previous (573,789 -- includes stale-position records as long as timestamp changed)
- **Doc 5**: "Real updates" = 287,081 (definition unclear, count doesn't match either)

The terms "genuine," "real," and "new" are used interchangeably but refer to different sets of records.

### 5.3 "Snapshot" has two meanings

- **Doc 1**: Snapshot = unique timestamp in the data (5,580)
- **Doc 4**: Snapshot = individual API response/poll (9,478)

Both use the word "snapshot" without qualification.

---

## 6. Scope Gaps

### 6.1 No analysis of speed limit matching accuracy

All five documents analyze GPS data quality and speed estimation, but none test speed limit matching against the Borgarvefsja road segment data. Key unanswered questions:
- What percentage of GPS positions match to the correct road segment?
- How often do parallel roads with different speed limits cause mismatches?
- What is the false violation rate from speed limit mismatches alone (ignoring speed estimation errors)?

### 6.2 No temporal analysis of GPS noise variation

The GPS noise analysis (Doc 2 Section 4, Doc 5 Analysis 1) measures aggregate noise but does not examine whether noise varies by time of day, weather conditions, or location (e.g., near tall buildings vs. open roads). If noise is location-dependent, the Kalman filter might benefit from location-aware measurement noise.

### 6.3 No multi-day analysis

All documents analyze a single day (2026-03-11). There is no assessment of day-to-day variation in:
- Fleet size and route coverage
- GPS noise levels
- Stale rate patterns
- Anomaly rates

The recommendations are calibrated to one day of data. They might not generalize.

### 6.4 No analysis of the collection gaps' effect on statistics

The two collector outages (132.8 min and 171.0 min) remove approximately 5 hours from the 10.42-hour window. Most per-hour statistics are biased by this -- morning rush and evening periods are severely undersampled. No document attempts to estimate what the statistics would look like with complete coverage.

### 6.5 No evaluation of violation detection end-to-end

No document computes the expected false positive and false negative rates for speed violation detection when the full pipeline is applied (Kalman filter + speed limit matching + conservative factor). Doc 5 shows 20.2% overestimation from the Kalman pipeline alone, and Doc 3 shows 7% raw false violations, but neither combines these with speed limit matching to estimate the operational violation detection accuracy.

### 6.6 Bus 99-A is never fully explained

Bus 99-A appears as an extreme outlier in multiple documents:
- Doc 2 Section 4.3: 363-minute stationary episode, 6,818 fixes, zero jitter
- Doc 2 Section 8.1: 100% repeat rate (6,817 out of 6,817 pairs)
- Doc 1 Section 2: 0.0% genuine update rate
- Doc 4 Section 5.2: On route 1 despite prefix "99"

It is variously described as "likely a decommissioned or test vehicle" (Doc 2) but never conclusively classified. It should be excluded from fleet statistics, and no document does so.

---

## 7. Internal Inconsistencies Within Individual Documents

### 7.1 Doc 4 internal: 403,790 vs 405,817 (duplicate/wasted counts)

As noted in 1.4/1.5 above, Doc 4 Section 8.1 states both "Pure duplicates: 403,790 (41.3%)" and "Wasted records: 405,817 (41.5%)." The text does not reconcile the 2,027-record difference.

### 7.2 Doc 1 internal: two different "effective update gap" P50 values

Doc 1 Section 2 gives "Genuine update gaps: P50 = 4.00s" while Section 6 gives "Fleet-Wide Effective Update Gap: P50 = 5.00s." Both claim to represent the rate at which genuine position updates arrive. The 4s figure appears to use per-bus consecutive pairs, while the 5s figure uses a different aggregation, but this is not stated.

### 7.3 Doc 5 internal: Animation analysis admits its own data is wrong

Doc 5 Analysis 6 reports prediction errors of 3,000+ meters at 500ms horizons, then states "WARNING: These numbers are clearly wrong and need reinvestigation." The analysis is published with known-bad results. This section should have been removed or replaced with a note that the analysis was invalid, rather than presenting an analysis table and then disclaiming it.

---

## Summary

| Category | Count | Severity |
|---|---|---|
| Number contradictions | 13 | High -- different docs would lead to different parameter choices |
| Logical contradictions | 5 | High -- directly opposing recommendations |
| Math errors / verification issues | 5 (1 confirmed error in Section 3.4) | Medium |
| Missing cross-references | 4 | Medium -- reader must synthesize across docs manually |
| Terminology inconsistencies | 3 | High -- "stale" means three different things |
| Scope gaps | 6 | Medium -- important questions unanswered |
| Internal inconsistencies | 3 | Medium |

### Most Consequential Issues (ranked)

1. **GPS noise sigma: 0.4m vs 1.3m (Section 1.7).** The Kalman filter R matrix differs by **10.6x** between Doc 2 and Doc 5. This is the single most impactful parameter for filter behavior. Doc 2's stationary analysis yields R = 0.16 m^2; Doc 5's moving-bus analysis yields R = 1.69 m^2. Neither document acknowledges the other.

2. **Minimum distance threshold: 0.5m vs 3m vs 10m (Section 2.1).** Three documents give three different recommendations with confident justifications. Doc 3 defends 10m as "well-calibrated" while Doc 5 shows 10m has a 24.69% false positive rate and recommends 3m. Doc 2 recommends 0.5m. An implementer would make a completely different choice depending on which document they trust.

3. **Stale rate definitions: 41.3% vs 48.1% vs 49.8% vs 61.8% (Section 1.1).** Four different numbers all called "the stale rate." The range spans from 41.3% to 61.8%. Without a shared definition, every derived metric (dedup savings, effective update rate, Kalman skip rate) is ambiguous.

4. **Acceleration P95: 5.13 vs 3.819 m/s^2 (Section 1.11).** Directly affects the MAX_ACCEL_MS2 cap and KALMAN_SIGMA_A recommendation. Doc 5 claims the 3.0 cap clips ~5% of events; if Doc 3's P95 is correct, it clips ~10-13%.

5. **Bus GPS update interval: 3s vs 4s vs 5s vs 6-7s (Section 1.13).** The Kalman process noise is tuned to this value. Getting it wrong by even 2x causes either over-smoothing or under-smoothing.

### Aggregate Impact: Kalman Filter Gets Different Advice Everywhere

A developer implementing the Kalman filter from these documents would face irreconcilable guidance:

| Parameter | Doc 2 Recommendation | Doc 5 Recommendation | Ratio |
|---|---|---|---|
| R (measurement noise) | sigma=0.4m, R=0.16 m^2 | sigma=1.3m, R=1.69 m^2 | **10.6x** |
| Process noise dt | "6-7s update intervals" | "5s median" | 1.3x |
| Min distance threshold | 0.5m | 3.0m | 6x |
| Stale skip rate | 62% of data | ~50% of data | 1.24x |

These are not minor tuning differences. The R matrix alone differs by an order of magnitude and would produce fundamentally different filter behavior (Doc 2's value makes the filter trust measurements heavily; Doc 5's makes it trust the model more).
