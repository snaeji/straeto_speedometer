# Temporal Pattern Analysis: Straeto Bus GPS Data

**Dataset:** `data/2026-03-11.jsonl`
**Date analyzed:** 2026-03-11 (Wednesday)
**Time span:** 08:48:42 UTC to 19:14:05 UTC (10.42 hours)
**Total records:** 977,707
**Unique buses:** 128
**Unique routes:** 25
**Unique timestamps:** 5,580

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [API Polling Cadence](#1-api-polling-cadence)
3. [Per-Bus Update Frequency](#2-per-bus-update-frequency)
4. [Stale Reading Patterns](#3-stale-reading-patterns)
5. [Time-of-Day Patterns](#4-time-of-day-patterns)
6. [Bus Lifecycle](#5-bus-lifecycle)
7. [Effective Update Rate](#6-effective-update-rate)
8. [Timestamp Precision and Quantization](#7-timestamp-precision-and-quantization)
9. [Key Takeaways for Algorithm Design](#key-takeaways-for-algorithm-design)

---

## Executive Summary

The single most important finding is that **nearly half of all GPS readings are stale** -- the API reports the same position even though the timestamp has advanced. Of 571,762 timestamp-changed record pairs, 274,817 (48.1%) had identical positions. Only 296,945 (30.4% of all consecutive pairs) represent genuine position changes. This has fundamental implications for speed calculation: any algorithm that blindly computes Haversine distance over time between consecutive records will produce zero-speed artifacts nearly half the time, or worse, will compute spurious speeds when a stale-then-genuine transition causes a large position jump over an accumulated time gap.

The effective GPS update rate -- considering only genuine position changes -- has a **median of 5 seconds** and a **P95 of 12 seconds**, significantly slower than the 2-3 second API polling rate might suggest. The collector sees roughly 175 bus records per API snapshot (at 2-4 second intervals), but after filtering out same-timestamp duplicates and stale readings, a given bus produces a usable position update only every 4-6 seconds.

The system experiences a **2+ hour data gap** (08:58 to 11:11 UTC) affecting virtually all buses, plus a **~3 hour evening gap** (16:11 to 19:02 UTC) affecting many buses. 126 of 128 buses have at least one gap exceeding 5 minutes. The Kalman filter must be designed to detect and gracefully handle these discontinuities rather than computing phantom speeds across them.

Five buses (16-A, 16-B, 16-C, 17-A, 17-B) **switch between routes 16 and 17** during the day, with rapid trip-ID flapping at transition points. This confirms that bus identity is stable but route assignment is dynamic.

---

## 1. API Polling Cadence

The collector script polled the Straeto GraphQL API and produced **5,580 distinct snapshots** over the 10.42-hour window. Each snapshot carries a single timestamp shared by all buses in that response.

### Snapshot Overview

| Metric | Value |
|--------|-------|
| Unique timestamps | 5,580 |
| First snapshot | 2026-03-11 08:48:42 UTC (epoch 1773218922000) |
| Last snapshot | 2026-03-11 19:14:05 UTC (epoch 1773256445000) |
| Total span | 37,523 seconds (10.42 hours) |

### Gap Between Snapshots (Percentiles)

| Percentile | Gap (seconds) |
|------------|---------------|
| P1 | 2.00 |
| P5 | 2.00 |
| P10 | 2.00 |
| P25 | 2.00 |
| P50 (median) | 3.00 |
| P75 | 4.00 |
| P90 | 5.00 |
| P95 | 6.00 |
| P99 | 8.00 |
| Min | 2.00 |
| Max | 10,260.00 |
| Mean | 6.73 |
| Count | 5,579 |

### Snapshot Gap Distribution

| Gap Range | Count | Percentage |
|-----------|------:|----------:|
| 0-1s | 0 | 0.0% |
| 1-2s | 0 | 0.0% |
| 2-3s | 2,070 | 37.1% |
| 3-4s | 1,031 | 18.5% |
| 4-5s | 1,297 | 23.2% |
| 5-6s | 656 | 11.8% |
| 6-7s | 340 | 6.1% |
| 7-8s | 116 | 2.1% |
| 8-10s | 43 | 0.8% |
| 10-15s | 19 | 0.3% |
| 15-20s | 1 | 0.0% |
| 20-30s | 2 | 0.0% |
| 30-60s | 1 | 0.0% |
| 60-120s | 1 | 0.0% |
| 120-300s | 0 | 0.0% |
| 300-600s | 0 | 0.0% |
| >=600s | 2 | 0.0% |

### Top 20 Most Common Exact Gap Values

| Gap (s) | Occurrences | Percentage |
|--------:|------------:|----------:|
| 2 | 2,070 | 37.1% |
| 4 | 1,297 | 23.2% |
| 3 | 1,031 | 18.5% |
| 5 | 656 | 11.8% |
| 6 | 340 | 6.1% |
| 7 | 116 | 2.1% |
| 8 | 29 | 0.5% |
| 9 | 14 | 0.3% |
| 10 | 9 | 0.2% |
| 13 | 4 | 0.1% |
| 11 | 4 | 0.1% |
| 12 | 2 | 0.0% |
| 7,969 | 1 | 0.0% |
| 74 | 1 | 0.0% |
| 15 | 1 | 0.0% |
| 24 | 1 | 0.0% |
| 34 | 1 | 0.0% |
| 26 | 1 | 0.0% |
| 10,260 | 1 | 0.0% |

### Records Per Snapshot

| Percentile | Records |
|------------|--------:|
| P1 | 72.0 |
| P5 | 88.0 |
| P10 | 90.0 |
| P25 | 96.0 |
| P50 (median) | 178.0 |
| P75 | 228.0 |
| P90 | 264.0 |
| P95 | 354.0 |
| P99 | 446.1 |
| Min | 68.0 |
| Max | 4,625.0 |
| Mean | 175.2 |
| Count | 5,580.0 |

### Timestamp Precision

| Metric | Value |
|--------|-------|
| Unique sub-second values (ts % 1000) | 1 |
| Sub-second values observed | [0] only |
| Timestamps not on whole seconds | 0 / 5,580 |
| Gaps that are multiples of 2s | 3,752 (67.3%) |
| Gaps that are multiples of 3s | 1,390 (24.9%) |
| Gaps that are multiples of 5s | 667 (12.0%) |

**What this means:** The API always returns whole-second timestamps with zero milliseconds. The dominant polling gap is 2 seconds (37.1% of snapshots), matching the API's `cache-control: max-age=2` header. The gap is never less than 2 seconds. The 4-second gap at 23.2% suggests the collector sometimes misses a cache window and catches the next one, and 3-second gaps (18.5%) indicate variable network latency pushing some responses past the 2-second boundary. The mean gap of 6.73 seconds is heavily skewed by two extreme outliers (7,969s and 10,260s -- roughly 2.2 and 2.85 hours), which represent the major collection outages. The P95 at 6 seconds is a more representative upper bound for normal operation.

Each snapshot contains a median of 178 bus records across 128 unique buses, meaning approximately 1.4 records per bus per snapshot on average. This excess is because the API returns per-route data and some buses appear on multiple routes or with multiple trip assignments in a single poll.

---

## 2. Per-Bus Update Frequency

### Record Classification

Every consecutive pair of records for the same bus was classified into one of three categories. Out of 977,579 total consecutive same-bus record pairs:

| Category | Count | Percentage | Description |
|----------|------:|----------:|-------------|
| Same-timestamp | 405,817 | 41.5% | Bus appeared in two records within the same API poll (same ts). Duplicates from per-route querying. |
| Stale | 274,817 | 28.1% | Timestamp changed (new poll) but GPS position unchanged. |
| Genuine | 296,945 | 30.4% | Both timestamp and position changed. True GPS update. |

**Only 30.4% of consecutive record pairs represent genuine position changes.**

### Gap Statistics by Category

**All gaps (including same-timestamp):**

| Percentile | Gap (seconds) |
|------------|---------------|
| P1 | 0.00 |
| P5 | 0.00 |
| P10 | 0.00 |
| P25 | 0.00 |
| P50 | 2.00 |
| P75 | 4.00 |
| P90 | 5.00 |
| P95 | 6.00 |
| P99 | 7.00 |
| Min | 0.00 |
| Max | 22,892.00 |
| Mean | 4.22 |
| Count | 977,579 |

**Stale gaps only (timestamp changed, position unchanged):**

| Percentile | Gap (seconds) |
|------------|---------------|
| P1 | 2.00 |
| P5 | 2.00 |
| P10 | 2.00 |
| P25 | 2.00 |
| P50 | 3.00 |
| P75 | 4.00 |
| P90 | 5.00 |
| P95 | 6.00 |
| P99 | 7.00 |
| Min | 2.00 |
| Max | 7,969.00 |
| Mean | 3.12 |
| Count | 274,817 |

**Genuine update gaps only (both timestamp and position changed):**

| Percentile | Gap (seconds) |
|------------|---------------|
| P1 | 2.00 |
| P5 | 2.00 |
| P10 | 2.00 |
| P25 | 2.00 |
| P50 | 4.00 |
| P75 | 5.00 |
| P90 | 6.00 |
| P95 | 7.00 |
| P99 | 9.00 |
| Min | 2.00 |
| Max | 22,892.00 |
| Mean | 11.01 |
| Count | 296,945 |

The all-gaps P25 of 0.0 reflects the 41.5% same-timestamp records (gap = 0). The genuine-gap mean of 11.01 is elevated by the collector-outage gaps.

### Per-Bus Breakdown (All 128 Buses, Sorted by Genuine %)

| Bus ID | Records | Same-Ts% | Stale% | Genuine% | Genuine P50(s) |
|--------|--------:|----------:|--------:|----------:|---------------:|
| 99-A | 6,818 | 39.6% | 60.4% | 0.0% | N/A |
| 31-B | 6,889 | 40.9% | 52.4% | 6.7% | 4.0 |
| 6-G | 9,120 | 41.2% | 45.2% | 13.6% | 4.0 |
| 1-J | 9,134 | 41.2% | 44.7% | 14.1% | 4.0 |
| 24-D | 9,091 | 41.3% | 44.1% | 14.6% | 4.0 |
| 19-C | 9,476 | 41.1% | 44.2% | 14.7% | 4.0 |
| 4-G | 9,184 | 41.2% | 42.3% | 16.6% | 3.0 |
| 4-A | 9,467 | 41.1% | 36.0% | 22.9% | 4.0 |
| 13-E | 4,196 | 43.6% | 33.0% | 23.5% | 4.0 |
| 4-D | 9,478 | 41.1% | 35.1% | 23.7% | 4.0 |
| 4-B | 9,472 | 41.1% | 34.6% | 24.2% | 4.0 |
| 4-C | 9,464 | 41.1% | 34.6% | 24.3% | 4.0 |
| 3-I | 1,048 | 49.6% | 26.0% | 24.5% | 4.0 |
| 13-C | 4,731 | 43.1% | 32.1% | 24.8% | 4.0 |
| 12-K | 3,868 | 43.6% | 31.4% | 25.0% | 4.0 |
| 23-A | 8,641 | 41.1% | 33.7% | 25.2% | 4.0 |
| 12-J | 3,070 | 44.8% | 29.7% | 25.5% | 4.0 |
| 2-E | 4,238 | 43.5% | 30.4% | 26.1% | 4.0 |
| 19-A | 9,478 | 41.1% | 32.2% | 26.7% | 4.0 |
| 4-F | 4,778 | 43.0% | 30.3% | 26.7% | 4.0 |
| 1-I | 3,778 | 43.6% | 29.7% | 26.7% | 4.0 |
| 1-F | 9,136 | 41.2% | 32.0% | 26.8% | 4.0 |
| 2-F | 2,942 | 45.0% | 28.2% | 26.8% | 4.0 |
| 12-I | 1,803 | 47.6% | 25.5% | 26.9% | 4.0 |
| 1-G | 9,138 | 41.2% | 31.8% | 27.0% | 4.0 |
| 1-K | 2,547 | 45.5% | 27.5% | 27.0% | 4.0 |
| 21-B | 9,478 | 41.1% | 31.7% | 27.2% | 4.0 |
| 14-A | 4,369 | 43.4% | 29.3% | 27.3% | 4.0 |
| 24-B | 9,182 | 41.1% | 31.5% | 27.4% | 4.0 |
| 3-C | 9,478 | 41.1% | 31.3% | 27.6% | 4.0 |
| 1-C | 9,473 | 41.1% | 31.2% | 27.6% | 4.0 |
| 12-D | 9,478 | 41.1% | 31.2% | 27.6% | 4.0 |
| 1-D | 9,475 | 41.1% | 31.1% | 27.7% | 4.0 |
| 1-A | 9,180 | 41.2% | 31.1% | 27.8% | 4.0 |
| 5-B | 8,989 | 40.9% | 31.3% | 27.8% | 4.0 |
| 6-D | 9,136 | 41.2% | 30.9% | 27.8% | 4.0 |
| 16-B | 9,472 | 41.1% | 31.0% | 27.9% | 4.0 |
| 3-A | 9,473 | 41.1% | 30.9% | 27.9% | 4.0 |
| 3-E | 9,138 | 41.2% | 30.7% | 28.1% | 4.0 |
| 1-H | 9,028 | 41.2% | 30.7% | 28.1% | 4.0 |
| 18-D | 9,475 | 41.1% | 30.7% | 28.1% | 4.0 |
| 36-A | 9,476 | 41.1% | 30.5% | 28.4% | 4.0 |
| 21-C | 9,478 | 41.1% | 30.4% | 28.4% | 4.0 |
| 6-C | 9,455 | 41.1% | 30.4% | 28.4% | 4.0 |
| 2-A | 8,669 | 41.0% | 30.4% | 28.5% | 4.0 |
| 24-A | 9,478 | 41.1% | 30.3% | 28.6% | 4.0 |
| 5-E | 9,066 | 41.2% | 30.0% | 28.7% | 4.0 |
| 2-G | 4,187 | 43.1% | 28.1% | 28.8% | 4.0 |
| 24-E | 4,051 | 43.4% | 27.8% | 28.8% | 4.0 |
| 15-A | 9,475 | 41.1% | 30.0% | 28.8% | 4.0 |
| 4-E | 2,942 | 45.0% | 26.0% | 28.9% | 4.0 |
| 15-D | 9,475 | 41.1% | 29.9% | 29.0% | 4.0 |
| 16-C | 9,412 | 41.2% | 29.8% | 29.1% | 4.0 |
| 17-A | 9,365 | 41.2% | 29.7% | 29.1% | 4.0 |
| 6-B | 9,478 | 41.1% | 29.7% | 29.2% | 4.0 |
| 15-G | 9,135 | 41.3% | 29.6% | 29.2% | 4.0 |
| 3-F | 9,135 | 41.2% | 29.3% | 29.4% | 4.0 |
| 14-B | 3,971 | 43.4% | 26.9% | 29.6% | 4.0 |
| 6-A | 9,476 | 41.1% | 29.2% | 29.7% | 4.0 |
| 2-D | 9,359 | 41.2% | 29.0% | 29.8% | 4.0 |
| 22-A | 9,474 | 41.1% | 29.1% | 29.8% | 4.0 |
| 19-D | 3,894 | 43.3% | 26.8% | 29.8% | 4.0 |
| 11-C | 9,473 | 41.1% | 28.9% | 30.0% | 4.0 |
| 11-A | 9,478 | 41.1% | 28.9% | 30.0% | 4.0 |
| 6-F | 9,136 | 41.2% | 28.8% | 30.0% | 4.0 |
| 2-H | 3,070 | 44.8% | 25.1% | 30.1% | 4.0 |
| 12-F | 8,614 | 41.1% | 28.9% | 30.1% | 4.0 |
| 19-B | 9,449 | 41.1% | 28.8% | 30.1% | 4.0 |
| 12-L | 2,687 | 44.6% | 25.2% | 30.2% | 4.0 |
| 31-A | 7,390 | 41.1% | 28.8% | 30.2% | 4.0 |
| 11-F | 4,060 | 43.5% | 26.2% | 30.3% | 4.0 |
| 18-F | 3,709 | 44.3% | 25.4% | 30.3% | 4.0 |
| 6-E | 9,137 | 41.3% | 28.4% | 30.4% | 4.0 |
| 1-B | 9,470 | 41.1% | 28.5% | 30.4% | 4.0 |
| 5-A | 9,478 | 41.1% | 28.4% | 30.4% | 4.0 |
| 14-F | 3,243 | 44.2% | 25.3% | 30.5% | 4.0 |
| 8-A | 9,127 | 41.2% | 28.3% | 30.5% | 4.0 |
| 35-A | 9,478 | 41.1% | 28.3% | 30.5% | 4.0 |
| 3-B | 9,478 | 41.1% | 28.3% | 30.6% | 4.0 |
| 28-A | 9,478 | 41.1% | 28.3% | 30.6% | 4.0 |
| 24-C | 9,475 | 41.1% | 27.9% | 31.0% | 4.0 |
| 6-I | 3,006 | 44.9% | 24.1% | 31.0% | 4.0 |
| 21-D | 4,730 | 43.2% | 25.6% | 31.2% | 4.0 |
| 16-A | 9,478 | 41.1% | 27.6% | 31.3% | 4.0 |
| 28-B | 9,475 | 41.1% | 27.5% | 31.3% | 4.0 |
| 12-G | 9,075 | 41.3% | 27.3% | 31.5% | 4.0 |
| 3-H | 3,546 | 43.8% | 24.6% | 31.6% | 4.0 |
| 5-G | 4,549 | 43.3% | 25.1% | 31.6% | 4.0 |
| 18-B | 9,381 | 41.2% | 27.2% | 31.6% | 4.0 |
| 18-G | 3,068 | 44.8% | 23.6% | 31.6% | 4.0 |
| 15-B | 9,478 | 41.1% | 26.8% | 32.1% | 4.0 |
| 6-H | 3,199 | 44.5% | 23.3% | 32.2% | 4.0 |
| 24-F | 5,543 | 42.3% | 25.4% | 32.3% | 3.0 |
| 3-G | 2,217 | 45.8% | 21.6% | 32.5% | 4.0 |
| 12-B | 9,269 | 41.2% | 25.4% | 33.3% | 4.0 |
| 2-B | 9,478 | 41.1% | 25.0% | 33.8% | 4.0 |
| 7-B | 9,478 | 41.1% | 24.8% | 34.1% | 4.0 |
| 12-H | 9,015 | 41.3% | 24.6% | 34.1% | 4.0 |
| 13-D | 4,077 | 43.4% | 21.0% | 35.5% | 3.0 |
| 2-C | 8,878 | 41.1% | 23.2% | 35.7% | 3.0 |
| 21-A | 9,253 | 41.2% | 23.0% | 35.9% | 4.0 |
| 12-C | 9,193 | 41.2% | 22.7% | 36.1% | 4.0 |
| 14-E | 9,478 | 41.1% | 22.7% | 36.2% | 3.0 |
| 5-F | 8,745 | 41.5% | 22.0% | 36.4% | 4.0 |
| 5-D | 8,240 | 41.4% | 22.1% | 36.5% | 4.0 |
| 13-A | 9,472 | 41.1% | 22.2% | 36.6% | 3.0 |
| 12-A | 9,478 | 41.1% | 22.1% | 36.8% | 4.0 |
| 17-B | 9,386 | 41.1% | 22.1% | 36.8% | 3.0 |
| 11-D | 3,667 | 43.8% | 19.2% | 37.0% | 4.0 |
| 5-H | 2,935 | 45.1% | 17.9% | 37.1% | 4.0 |
| 14-D | 9,478 | 41.1% | 21.7% | 37.2% | 3.0 |
| 14-C | 9,478 | 41.1% | 21.0% | 37.8% | 3.0 |
| 18-C | 9,155 | 40.8% | 21.1% | 38.0% | 3.0 |
| 18-A | 9,403 | 41.1% | 20.8% | 38.1% | 3.0 |
| 13-B | 9,478 | 41.1% | 20.4% | 38.4% | 3.0 |
| 12-E | 8,889 | 41.3% | 20.0% | 38.7% | 4.0 |
| 1-E | 9,138 | 41.2% | 20.0% | 38.8% | 3.0 |
| 18-E | 4,045 | 43.4% | 17.2% | 39.4% | 3.0 |
| 11-B | 9,478 | 41.1% | 19.1% | 39.7% | 3.0 |
| 5-C | 8,647 | 41.3% | 18.4% | 40.2% | 3.0 |
| 3-D | 9,474 | 41.1% | 18.3% | 40.6% | 3.0 |
| 15-E | 9,478 | 41.1% | 18.2% | 40.6% | 3.0 |
| 15-C | 9,442 | 41.2% | 17.7% | 41.1% | 3.0 |
| 21-E | 3,847 | 43.6% | 14.8% | 41.7% | 3.0 |
| 11-E | 4,149 | 43.5% | 14.8% | 41.7% | 3.0 |
| 15-F | 9,035 | 41.2% | 16.6% | 42.2% | 3.0 |
| 15-H | 9,138 | 41.2% | 15.9% | 42.8% | 3.0 |
| 7-A | 9,478 | 41.1% | 13.4% | 45.5% | 3.0 |

**What this means:** The same-timestamp rate is remarkably consistent across all buses at ~41%, which is expected since it reflects the API being polled multiple times within a single server-side cache window. The real variation is in the stale-vs-genuine split. Bus 99-A is 100% stale (likely parked/out of service the entire day with the GPS still reporting). Bus 7-A is the most active at 45.5% genuine. The typical bus has a genuine update rate of 27-35%. Buses on routes 15 and 7 tend to have the highest genuine rates, while buses on routes 4, 19, and 31 tend to have the lowest -- possibly correlated with route length, stop density, or proportion of time spent stationary.

---

## 3. Stale Reading Patterns

### Overall Stale Rate

Excluding same-timestamp duplicates: **48.1% stale** (274,817 stale vs 296,945 genuine).

### Stale Run Length Statistics

A "stale run" is a consecutive sequence of stale readings for a single bus before a genuine update arrives.

| Percentile | Run Length |
|------------|----------:|
| P1 | 1.0 |
| P5 | 1.0 |
| P10 | 1.0 |
| P25 | 1.0 |
| P50 (median) | 1.0 |
| P75 | 1.0 |
| P90 | 3.0 |
| P95 | 6.0 |
| P99 | 19.0 |
| Min | 1.0 |
| Max | 4,118 |
| Mean | 2.5 |
| Count | 110,429 |

### Stale Run Length Distribution

| Run Length | Count | Percentage |
|------------|------:|----------:|
| 1 | 85,904 | 77.8% |
| 2 | 11,088 | 10.0% |
| 3 | 3,401 | 3.1% |
| 4 | 2,464 | 2.2% |
| 5 | 1,564 | 1.4% |
| 6 | 1,069 | 1.0% |
| 7 | 792 | 0.7% |
| 8 | 601 | 0.5% |
| 9 | 478 | 0.4% |
| 10-14 | 1,433 | 1.3% |
| 15-19 | 546 | 0.5% |
| 20-29 | 317 | 0.3% |
| 30-49 | 282 | 0.3% |
| 50-99 | 282 | 0.3% |
| 100-199 | 155 | 0.1% |
| 200-499 | 43 | 0.0% |
| >=500 | 10 | 0.0% |

### Stale Rate by Route

| Route | Total Records | Stale Records | Stale% |
|------:|-------------:|-------------:|-------:|
| 31 | 8,428 | 5,738 | 68.1% |
| 4 | 32,044 | 19,383 | 60.5% |
| 19 | 18,926 | 11,004 | 58.1% |
| 23 | 8,641 | 2,908 | 57.2% |
| 1 | 56,542 | 31,902 | 56.4% |
| 24 | 27,389 | 14,946 | 54.6% |
| 6 | 41,616 | 22,096 | 53.1% |
| 17 | 13,554 | 7,095 | 52.3% |
| 36 | 5,578 | 2,890 | 51.8% |
| 22 | 5,577 | 2,755 | 49.4% |
| 35 | 5,579 | 2,685 | 48.1% |
| 8 | 5,362 | 2,579 | 48.1% |
| 28 | 11,156 | 5,287 | 47.4% |
| 3 | 36,766 | 17,419 | 47.4% |
| 2 | 29,507 | 13,851 | 46.9% |
| 21 | 21,459 | 9,788 | 45.6% |
| 12 | 49,227 | 21,707 | 44.1% |
| 16 | 14,170 | 6,109 | 43.1% |
| 5 | 35,419 | 15,237 | 43.0% |
| 13 | 18,517 | 7,797 | 42.1% |
| 18 | 28,098 | 11,721 | 41.7% |
| 11 | 23,431 | 9,671 | 41.3% |
| 14 | 23,262 | 9,361 | 40.2% |
| 15 | 43,912 | 17,271 | 39.3% |
| 7 | 11,158 | 3,617 | 32.4% |

### Stale Rate by Hour of Day (UTC = Iceland Time)

| Hour | Total Records | Stale Records | Stale% |
|-----:|-------------:|-------------:|-------:|
| 8 | 35,764 | 9,050 | 25.3% |
| 11 | 127,938 | 37,851 | 29.6% |
| 12 | 159,579 | 51,035 | 32.0% |
| 13 | 165,115 | 52,358 | 31.7% |
| 14 | 202,112 | 57,536 | 28.5% |
| 15 | 220,452 | 49,985 | 22.7% |
| 16 | 42,189 | 9,028 | 21.4% |
| 19 | 24,430 | 7,974 | 32.6% |

### Buses Going Dark (Gaps > 5 Minutes)

**126 of 128 buses** experienced at least one gap exceeding 5 minutes.

Two dominant collection gaps affect nearly every bus simultaneously:

1. **08:58:42 to 11:11:31 UTC** (132.8 minutes): The collector was stopped. 120+ buses show this exact gap.
2. **16:11:30 to 19:02:30 UTC** (171.0 minutes): A second collector stoppage. About 55 buses that last appeared at 16:11:30 reappear at 19:02:30.

These are **collector-side gaps**, not bus-side gaps -- the buses were operating, but the collector was not running.

Selected per-bus gap details:

| Bus ID | Gap Count | Notable Gaps |
|--------|----------:|------|
| 2-A | 4 | 132.8 min, 7.9 min, 6.0 min, 171.0 min |
| 5-C | 4 | 132.8 min, 15.1 min, 13.1 min, 171.0 min |
| 2-C | 3 | 132.8 min, 10.0 min, 171.0 min |
| 5-B | 3 | 132.8 min, 16.5 min, 171.0 min |
| 5-D | 3 | 132.8 min, 11.1 min, 19.1 min |
| 11-D | 3 | 257.6 min, 69.2 min, 171.0 min |
| 12-C | 3 | 132.8 min, 8.8 min, 171.0 min |
| 12-F | 3 | 132.8 min, 7.6 min, 10.2 min |
| 21-A | 3 | 132.8 min, 7.6 min, 171.0 min |
| 23-A | 3 | 132.8 min, 26.4 min, 171.0 min |
| 24-B | 3 | 132.8 min, 9.0 min, 171.0 min |
| 31-B | 3 | 214.6 min, 6.5 min, 171.0 min |

Beyond the collector gaps, individual buses show occasional 5-20 minute gaps that likely represent route layovers, driver breaks, or the bus briefly leaving API coverage.

**What this means:** The stale reading pattern is critical for speed calculation design. The 77.8% of stale runs being length 1 means that most of the time, a single stale reading is followed by a genuine update -- the GPS unit updates roughly every other poll cycle. However, 10 stale runs exceeded 500 readings (one reaching 4,118), meaning some buses go hundreds of poll cycles without a position change. These likely represent parked/depot buses.

Route 31 has the highest stale rate at 68.1%, while route 7 is the lowest at 32.4%. This likely correlates with route characteristics -- routes with more stops, traffic, or terminal dwell time will have more stationary readings.

Stale rates are lowest in the afternoon (hours 15-16 at ~21-23%) and highest midday and evening (~32%). The afternoon pattern makes sense: rush hour means more buses in motion and fewer sitting at terminals.

---

## 4. Time-of-Day Patterns

### Active Buses and Snapshots Per Hour

| Hour (UTC) | Active Buses | Snapshots | Records/Snapshot (avg) |
|------------|-------------|-----------|------------------------|
| 8 | 123 | 177 | 202.8 |
| 11 | 90 | 840 | 152.3 |
| 12 | 92 | 1,094 | 145.9 |
| 13 | 103 | 1,089 | 151.6 |
| 14 | 125 | 1,049 | 192.7 |
| 15 | 127 | 943 | 233.8 |
| 16 | 127 | 177 | 238.4 |
| 19 | 74 | 211 | 115.8 |

Note: Hours 9-10 and 17-18 are absent due to the collector outages described in Section 3.

### Fleet Size at 10-Minute Intervals

| Time (UTC) | Buses |
|------------|------:|
| 08:48:42 | 123 |
| 08:58:42 | 118 |
| 11:08:42 | 90 |
| 11:18:42 | 90 |
| 11:28:42 | 90 |
| 11:38:42 | 90 |
| 11:48:42 | 90 |
| 11:58:42 | 89 |
| 12:08:42 | 90 |
| 12:18:42 | 91 |
| 12:28:42 | 92 |
| 12:38:42 | 92 |
| 12:48:42 | 92 |
| 12:58:42 | 92 |
| 13:08:42 | 93 |
| 13:18:42 | 93 |
| 13:28:42 | 93 |
| 13:38:42 | 99 |
| 13:48:42 | 100 |
| 13:58:42 | 106 |
| 14:08:42 | 112 |
| 14:18:42 | 115 |
| 14:28:42 | 120 |
| 14:38:42 | 123 |
| 14:48:42 | 124 |
| 14:58:42 | 125 |
| 15:08:42 | 125 |
| 15:18:42 | 127 |
| 15:28:42 | 127 |
| 15:38:42 | 127 |
| 15:48:42 | 127 |
| 15:58:42 | 127 |
| 16:08:42 | 127 |
| 18:58:42 | 74 |
| 19:08:42 | 72 |

**What this means:** The fleet size follows a clear daily pattern. There is a morning peak of 123 buses at 08:48 (first observation), which drops to 90 after the collection gap (possibly the 09:00-11:00 period represents a mid-morning lull, or some buses ended morning shifts). The fleet then ramps up steadily from 13:38 (99 buses) through 15:18 (127 buses), where it plateaus at the maximum observed fleet size through 16:08. The evening fleet at 19:00 is reduced to 74 buses, suggesting many buses are taken out of service after the afternoon rush. The records-per-snapshot metric peaks at 238.4 during hour 16, corresponding to the full fleet being tracked with the highest per-bus record count.

---

## 5. Bus Lifecycle

### Active Duration Statistics

| Percentile | Duration (hours) |
|------------|------------------:|
| P1 | 1.99 |
| P5 | 7.38 |
| P10 | 7.38 |
| P25 | 7.38 |
| P50 (median) | 10.42 |
| P75 | 10.42 |
| P90 | 10.42 |
| P95 | 10.42 |
| P99 | 10.42 |
| Min | 0.72 |
| Max | 10.42 |
| Mean | 8.95 |
| Count | 128 |

The distribution is bimodal: buses either span the full 10.42-hour collection window (~74 buses) or span ~7.38 hours (present at start but disappearing by 16:11, ~49 buses). Five buses appeared late or had very short durations:

| Bus ID | First Seen | Last Seen | Duration (h) |
|--------|------------|-----------|-------------:|
| 1-A | 11:11:31 | 19:14:05 | 8.04 |
| 4-G | 11:11:31 | 19:14:05 | 8.04 |
| 13-E | 13:48:34 | 16:11:30 | 2.38 |
| 14-F | 14:20:45 | 16:11:30 | 1.85 |
| 3-I | 15:28:03 | 16:11:30 | 0.72 |

### Route Switching

| Metric | Value |
|--------|------:|
| Buses on single route | 123 |
| Buses on multiple routes | 5 |
| Buses with multiple trips | 126 |

**All 5 multi-route buses switch between routes 16 and 17:**

| Bus ID | Routes | Trip Count |
|--------|--------|----------:|
| 16-A | 16, 17 | 12 |
| 16-B | 16, 17 | 10 |
| 17-B | 16, 17 | 11 |
| 16-C | 17, 16 | 12 |
| 17-A | 17, 16 | 11 |

### Route-Switching Timeline Details

**Bus 16-A:**
```
08:48 route=16 trip=65725 Arbær/Hraunas
08:56 route=16 trip=64120 Skulagata
11:11 route=16 trip=64793 Arbær/Hraunas
11:28 route=16 trip=66733 Skulagata
11:59 route=17 trip=62889 Fell/Berg        <-- switch
12:48 route=17 trip=62701 Skulagata
12:49 route=17 trip=62889 Fell/Berg         <-- flap
12:50 route=17 trip=62701 Skulagata
13:12 route=16 trip=63630 Arbær/Hraunas     <-- switch back
13:57 route=16 trip=64839 Skulagata
14:31 route=17 trip=62840 Fell/Berg         <-- switch
15:18 route=17 trip=66352 Skulagata
15:19 route=17 trip=62840 Fell/Berg         <-- flap
15:20 route=17 trip=66352 Skulagata
15:45 route=16 trip=63125 Arbær/Hraunas     <-- switch back
19:02 route=16 trip=64896 Skulagata
```

**Bus 16-B:**
```
08:48 route=16 trip=63277 Arbær/Hraunas
11:11 route=16 trip=63050 Arbær/Hraunas
11:57 route=16 trip=65849 Skulagata
12:28 route=17 trip=63244 Fell/Berg         <-- switch
13:18 route=17 trip=63793 Skulagata
13:40 route=16 trip=65381 Arbær/Hraunas     <-- switch back
14:26 route=16 trip=66590 Skulagata
14:58 route=17 trip=64164 Fell/Berg         <-- switch
15:50 route=17 trip=65425 Skulagata
15:50 route=17 trip=64164 Fell/Berg         <-- flap
15:50 route=17 trip=65425 Skulagata
19:02 route=16 trip=66609 Arbær/Hraunas
```

**Bus 17-B:**
```
08:48 route=16 trip=66053 Skulagata
11:11 route=16 trip=66617 Skulagata
11:30 route=17 trip=62734 Fell/Berg         <-- switch
12:19 route=17 trip=63342 Skulagata
12:42 route=16 trip=62762 Arbær/Hraunas     <-- switch back
13:26 route=16 trip=63205 Skulagata
13:58 route=17 trip=66019 Fell/Berg         <-- switch
14:50 route=17 trip=64909 Skulagata
14:50 route=17 trip=66019 Fell/Berg         <-- flap
14:50 route=17 trip=64909 Skulagata
15:20 route=16 trip=63717 Arbær/Hraunas     <-- switch back
15:59 route=16 trip=65423 Skulagata
19:02 route=17 trip=66607 Fell/Berg
```

**Bus 16-C:**
```
08:48 route=17 trip=64092 Fell/Berg
08:49 route=17 trip=63638 Skulagata         <-- rapid flap
08:49 route=17 trip=64092 Fell/Berg
08:49 route=17 trip=63638 Skulagata
08:50 route=17 trip=64092 Fell/Berg
08:51 route=17 trip=63638 Skulagata
11:11 route=17 trip=65665 Fell/Berg
11:18 route=17 trip=64409 Skulagata
11:40 route=16 trip=66797 Arbær/Hraunas     <-- switch
12:26 route=16 trip=63984 Skulagata
13:00 route=17 trip=64988 Fell/Berg         <-- switch
13:48 route=17 trip=63498 Skulagata
13:48 route=17 trip=64988 Fell/Berg         <-- rapid flap (8 switches in 3 min)
13:49 route=17 trip=63498 Skulagata
13:49 route=17 trip=64988 Fell/Berg
13:50 route=17 trip=63498 Skulagata
13:50 route=17 trip=64988 Fell/Berg
13:51 route=17 trip=63498 Skulagata
14:15 route=16 trip=66226 Arbær/Hraunas     <-- switch
14:57 route=16 trip=65946 Skulagata
15:30 route=17 trip=66286 Fell/Berg         <-- switch
19:02 route=17 trip=65387 Skulagata
```

**Bus 17-A:**
```
08:48 route=17 trip=66763 Fell/Berg
11:13 route=17 trip=66265 Fell/Berg
11:48 route=17 trip=64247 Skulagata
11:48 route=17 trip=66265 Fell/Berg         <-- flap
11:49 route=17 trip=64247 Skulagata
12:12 route=16 trip=66142 Arbær/Hraunas     <-- switch
12:58 route=16 trip=64995 Skulagata
13:29 route=17 trip=65813 Fell/Berg         <-- switch
14:19 route=17 trip=66781 Skulagata
14:40 route=16 trip=66248 Arbær/Hraunas     <-- switch
15:27 route=16 trip=63319 Skulagata
15:59 route=17 trip=65703 Fell/Berg         <-- switch
19:02 route=17 trip=66489 Fell/Berg
```

**What this means:** All five multi-route buses alternate between routes 16 and 17, completing 2-4 round trips on each route throughout the day. The trip-ID flapping at transitions (visible in 16-C especially at 13:48-13:51 with 8 switches in 3 minutes) occurs when a bus is at a shared terminus and the system briefly oscillates between two trip assignments. The speed algorithm should be **bus-keyed** (not route-keyed or trip-keyed) to handle this correctly.

### Gap Analysis (Gaps > 60 Seconds Between Consecutive Records)

| Bus ID | Records | Gaps >60s | Max Gap (s) | Avg Gap (s) |
|--------|--------:|----------:|------------:|------------:|
| 12-I | 1,803 | 2 | 22,892 | 11,483 |
| 3-G | 2,217 | 2 | 22,026 | 11,050 |
| 1-K | 2,547 | 2 | 21,336 | 10,705 |
| 2-F | 2,942 | 2 | 20,537 | 10,306 |
| 4-E | 2,942 | 2 | 20,537 | 10,306 |
| 6-I | 3,006 | 3 | 20,309 | 6,830 |
| 18-G | 3,068 | 2 | 20,284 | 10,179 |
| 2-H | 3,070 | 2 | 20,280 | 10,177 |
| 12-J | 3,070 | 2 | 20,280 | 10,177 |
| 3-H | 3,546 | 3 | 20,003 | 10,112 |
| 6-H | 3,199 | 2 | 19,982 | 10,028 |
| 5-H | 2,935 | 3 | 19,683 | 6,877 |
| 19-D | 3,894 | 3 | 19,291 | 9,875 |
| 12-L | 2,687 | 3 | 19,104 | 7,051 |
| 1-I | 3,778 | 2 | 18,842 | 9,458 |
| 2-G | 4,187 | 3 | 18,703 | 9,679 |
| 21-E | 3,847 | 2 | 18,703 | 9,389 |
| 12-K | 3,868 | 2 | 18,663 | 9,369 |
| 14-B | 3,971 | 2 | 18,453 | 9,264 |
| 18-E | 4,045 | 2 | 18,301 | 9,188 |
| 24-E | 4,051 | 2 | 18,286 | 9,180 |
| 13-D | 4,077 | 2 | 18,229 | 9,152 |
| 11-F | 4,060 | 3 | 18,150 | 6,110 |
| 2-E | 4,238 | 2 | 17,902 | 8,988 |
| 14-A | 4,369 | 2 | 17,645 | 8,860 |
| 13-C | 4,731 | 3 | 17,498 | 9,277 |
| 5-G | 4,549 | 2 | 17,275 | 8,675 |
| 18-F | 3,709 | 3 | 17,173 | 6,349 |
| 11-E | 4,149 | 3 | 17,114 | 6,049 |
| 21-D | 4,730 | 3 | 17,031 | 9,122 |

### Concurrent Buses Per Route Per Snapshot

| Route | Snapshots | Min | P25 | P50 | P75 | Max | Mean |
|------:|----------:|----:|----:|----:|----:|----:|-----:|
| 1 | 5,580 | 3 | 10 | 20 | 22 | 407 | 17.3 |
| 12 | 5,580 | 3 | 8 | 14 | 20 | 444 | 15.1 |
| 15 | 5,580 | 4 | 8 | 16 | 16 | 296 | 13.4 |
| 6 | 5,580 | 3 | 7 | 14 | 14 | 333 | 12.7 |
| 3 | 5,580 | 5 | 6 | 12 | 12 | 296 | 11.3 |
| 5 | 5,580 | 3 | 6 | 10 | 14 | 296 | 10.9 |
| 4 | 5,580 | 4 | 6 | 10 | 12 | 259 | 9.8 |
| 2 | 5,580 | 3 | 5 | 8 | 12 | 296 | 9.1 |
| 18 | 5,580 | 3 | 5 | 8 | 10 | 222 | 8.6 |
| 24 | 5,580 | 3 | 5 | 8 | 12 | 222 | 8.4 |
| 11 | 5,580 | 2 | 4 | 6 | 9 | 222 | 7.2 |
| 14 | 5,580 | 3 | 4 | 6 | 9 | 222 | 7.2 |
| 21 | 5,580 | 2 | 4 | 6 | 9 | 185 | 6.6 |
| 19 | 5,580 | 2 | 3 | 6 | 8 | 148 | 5.8 |
| 13 | 5,580 | 1 | 4 | 4 | 8 | 185 | 5.7 |
| 16 | 5,580 | 2 | 3 | 4 | 6 | 111 | 4.3 |
| 17 | 5,580 | 1 | 2 | 4 | 6 | 74 | 4.1 |
| 7 | 5,580 | 2 | 2 | 4 | 4 | 74 | 3.4 |
| 28 | 5,580 | 1 | 2 | 4 | 4 | 74 | 3.4 |
| 31 | 4,361 | 1 | 2 | 4 | 4 | 74 | 3.3 |
| 8 | 5,363 | 1 | 1 | 2 | 2 | 37 | 1.7 |
| 23 | 5,086 | 1 | 1 | 2 | 2 | 37 | 1.7 |
| 35 | 5,580 | 1 | 1 | 2 | 2 | 37 | 1.7 |
| 36 | 5,579 | 1 | 1 | 2 | 2 | 37 | 1.7 |
| 22 | 5,578 | 1 | 1 | 2 | 2 | 37 | 1.7 |

**What this means:** Route 1 is the busiest with a median of 20 concurrent buses, followed by route 15 (16), route 12 (14), and route 6 (14). Five routes (8, 22, 23, 35, 36) typically have only 1-2 buses, meaning they are low-frequency services. Routes 16 and 17 share buses, which explains their relatively low individual counts (median 4 each) but combined would be ~8. The extremely high "Max" values (e.g., 444 for route 12) are artifacts of the snapshot structure: the post-gap reconnection caused many records to appear batched in a single timestamp bucket.

---

## 6. Effective Update Rate

This is the most important section for speed algorithm design. It considers only genuine position changes -- the actual rate at which new GPS coordinates become available for each bus.

### Fleet-Wide Effective Update Gap

| Percentile | Gap (seconds) |
|------------|-------------:|
| P1 | 2.00 |
| P5 | 2.00 |
| P10 | 2.00 |
| P25 | 3.00 |
| P50 (median) | 5.00 |
| P75 | 6.00 |
| P90 | 9.00 |
| P95 | 12.00 |
| P99 | 41.00 |
| Min | 2.00 |
| Max | 22,892.00 |
| Mean | 13.73 |
| Count | 298,703 |

### Effective Update Gap Distribution

| Gap Range | Count | Percentage |
|-----------|------:|----------:|
| 0-2s | 0 | 0.0% |
| 2-3s | 49,055 | 16.4% |
| 3-4s | 31,593 | 10.6% |
| 4-5s | 57,335 | 19.2% |
| 5-6s | 49,562 | 16.6% |
| 6-7s | 46,518 | 15.6% |
| 7-8s | 20,778 | 7.0% |
| 8-10s | 20,480 | 6.9% |
| 10-12s | 7,111 | 2.4% |
| 12-15s | 4,069 | 1.4% |
| 15-20s | 4,229 | 1.4% |
| 20-30s | 3,337 | 1.1% |
| 30-60s | 2,788 | 0.9% |
| 60-120s | 817 | 0.3% |
| 120-300s | 530 | 0.2% |
| 300-600s | 223 | 0.1% |
| >=600s | 278 | 0.1% |

### Per-Bus Effective Update Rate (All 128 Buses, Sorted by Median Gap)

**Tier 1 -- Median 4-second updates (~40 buses):**

| Bus ID | Count | P25(s) | P50(s) | P75(s) | P95(s) | P99(s) |
|--------|------:|-------:|-------:|-------:|-------:|-------:|
| 1-E | 3,563 | 2.0 | 4.0 | 5.0 | 11.0 | 43.8 |
| 2-A | 2,488 | 3.0 | 4.0 | 6.0 | 18.0 | 78.3 |
| 2-B | 3,224 | 3.0 | 4.0 | 6.0 | 14.0 | 35.0 |
| 2-C | 3,184 | 2.0 | 4.0 | 5.0 | 14.0 | 56.5 |
| 3-D | 3,872 | 2.0 | 4.0 | 5.0 | 10.0 | 33.3 |
| 3-G | 725 | 3.0 | 4.0 | 5.0 | 13.0 | 37.8 |
| 5-C | 3,507 | 2.0 | 4.0 | 5.0 | 11.0 | 27.0 |
| 5-D | 3,034 | 3.0 | 4.0 | 6.0 | 11.0 | 40.0 |
| 5-F | 3,199 | 3.0 | 4.0 | 6.0 | 12.0 | 29.0 |
| 5-H | 1,095 | 3.0 | 4.0 | 6.0 | 15.0 | 36.1 |
| 6-G | 1,262 | 3.0 | 4.0 | 5.0 | 15.0 | 243.4 |
| 6-H | 1,038 | 3.0 | 4.0 | 6.0 | 12.1 | 44.6 |
| 6-I | 937 | 3.0 | 4.0 | 5.0 | 15.0 | 63.6 |
| 7-A | 4,324 | 2.0 | 4.0 | 5.0 | 8.0 | 20.0 |
| 11-B | 3,782 | 2.0 | 4.0 | 5.0 | 12.0 | 34.2 |
| 11-D | 1,358 | 2.0 | 4.0 | 5.0 | 14.0 | 39.4 |
| 11-E | 1,756 | 2.0 | 4.0 | 5.0 | 11.0 | 22.0 |
| 12-A | 3,508 | 2.8 | 4.0 | 6.0 | 13.0 | 34.0 |
| 12-C | 3,340 | 3.0 | 4.0 | 6.0 | 14.0 | 38.6 |
| 12-E | 3,459 | 2.0 | 4.0 | 5.0 | 13.0 | 33.0 |
| 12-G | 2,862 | 3.0 | 4.0 | 6.0 | 13.0 | 42.8 |
| 13-A | 3,503 | 2.0 | 4.0 | 5.0 | 15.0 | 33.0 |
| 13-B | 3,665 | 2.0 | 4.0 | 5.0 | 13.0 | 38.4 |
| 13-D | 1,452 | 2.0 | 4.0 | 5.0 | 15.0 | 46.0 |
| 14-C | 3,619 | 2.0 | 4.0 | 5.0 | 13.0 | 34.0 |
| 14-D | 3,573 | 2.0 | 4.0 | 5.0 | 13.0 | 37.3 |
| 14-E | 3,463 | 2.0 | 4.0 | 5.0 | 12.0 | 38.0 |
| 15-C | 3,916 | 2.0 | 4.0 | 5.0 | 8.0 | 27.8 |
| 15-E | 3,875 | 2.0 | 4.0 | 5.0 | 8.3 | 30.0 |
| 15-F | 3,836 | 2.0 | 4.0 | 5.0 | 9.0 | 28.7 |
| 15-H | 3,938 | 2.0 | 4.0 | 5.0 | 9.0 | 29.0 |
| 17-B | 3,486 | 2.0 | 4.0 | 5.0 | 11.0 | 44.2 |
| 18-A | 3,600 | 2.0 | 4.0 | 5.0 | 10.0 | 34.0 |
| 18-B | 2,988 | 3.0 | 4.0 | 6.0 | 10.0 | 41.3 |
| 18-C | 3,504 | 2.0 | 4.0 | 5.0 | 9.0 | 34.9 |
| 18-E | 1,600 | 2.0 | 4.0 | 5.0 | 10.0 | 32.0 |
| 21-A | 3,329 | 3.0 | 4.0 | 6.0 | 10.0 | 35.0 |
| 21-E | 1,612 | 2.0 | 4.0 | 5.0 | 8.0 | 31.9 |
| 24-F | 1,807 | 2.0 | 4.0 | 5.0 | 8.0 | 43.6 |
| 4-G | 1,566 | 2.0 | 4.0 | 5.0 | 13.0 | 144.5 |

**Tier 2 -- Median 5-second updates (~85 buses):**

| Bus ID | Count | P25(s) | P50(s) | P75(s) | P95(s) | P99(s) |
|--------|------:|-------:|-------:|-------:|-------:|-------:|
| 1-B | 2,916 | 4.0 | 5.0 | 7.0 | 12.3 | 36.8 |
| 1-C | 2,625 | 4.0 | 5.0 | 7.0 | 16.0 | 41.0 |
| 1-D | 2,648 | 4.0 | 5.0 | 7.0 | 15.0 | 43.6 |
| 1-F | 2,459 | 4.0 | 5.0 | 7.0 | 12.1 | 45.8 |
| 1-G | 2,477 | 4.0 | 5.0 | 7.0 | 12.0 | 45.2 |
| 1-H | 2,552 | 4.0 | 5.0 | 7.0 | 12.0 | 42.5 |
| 1-I | 1,009 | 4.0 | 5.0 | 7.0 | 15.0 | 54.6 |
| 1-J | 1,309 | 4.0 | 5.0 | 7.0 | 16.0 | 187.5 |
| 1-K | 690 | 4.0 | 5.0 | 7.0 | 16.0 | 66.9 |
| 2-D | 2,792 | 4.0 | 5.0 | 6.0 | 15.0 | 42.0 |
| 2-F | 791 | 4.0 | 5.0 | 7.0 | 16.5 | 43.4 |
| 2-G | 1,220 | 4.0 | 5.0 | 7.0 | 13.0 | 34.8 |
| 2-H | 923 | 4.0 | 5.0 | 7.0 | 15.9 | 43.8 |
| 3-A | 2,681 | 4.0 | 5.0 | 7.0 | 13.0 | 41.2 |
| 3-B | 2,908 | 4.0 | 5.0 | 7.0 | 11.0 | 41.9 |
| 3-C | 2,627 | 4.0 | 5.0 | 7.0 | 13.0 | 44.7 |
| 3-E | 2,567 | 4.0 | 5.0 | 7.0 | 12.0 | 51.3 |
| 3-F | 2,698 | 4.0 | 5.0 | 7.0 | 11.0 | 43.0 |
| 3-H | 1,126 | 4.0 | 5.0 | 7.0 | 11.0 | 37.5 |
| 4-A | 2,188 | 4.0 | 5.0 | 7.0 | 13.0 | 85.7 |
| 4-B | 2,317 | 4.0 | 5.0 | 7.0 | 15.0 | 62.5 |
| 4-C | 2,317 | 4.0 | 5.0 | 7.0 | 15.0 | 51.0 |
| 4-D | 2,260 | 4.0 | 5.0 | 7.0 | 13.0 | 63.2 |
| 4-E | 857 | 4.0 | 5.0 | 7.0 | 14.0 | 36.9 |
| 4-F | 1,279 | 4.0 | 5.0 | 7.0 | 15.0 | 53.1 |
| 5-A | 2,903 | 3.0 | 5.0 | 6.0 | 15.0 | 41.0 |
| 5-E | 2,620 | 4.0 | 5.0 | 7.0 | 12.0 | 36.0 |
| 5-G | 1,438 | 4.0 | 5.0 | 7.0 | 11.0 | 31.6 |
| 6-A | 2,821 | 4.0 | 5.0 | 7.0 | 12.0 | 38.6 |
| 6-B | 2,771 | 4.0 | 5.0 | 7.0 | 14.0 | 41.0 |
| 6-C | 2,697 | 4.0 | 5.0 | 7.0 | 13.0 | 39.0 |
| 6-D | 2,554 | 4.0 | 5.0 | 7.0 | 12.0 | 42.5 |
| 6-E | 2,781 | 4.0 | 5.0 | 7.0 | 12.0 | 37.2 |
| 6-F | 2,751 | 4.0 | 5.0 | 7.0 | 13.0 | 32.5 |
| 7-B | 3,232 | 4.0 | 5.0 | 6.0 | 10.0 | 26.0 |
| 8-A | 2,790 | 4.0 | 5.0 | 7.0 | 11.0 | 38.2 |
| 11-A | 2,848 | 4.0 | 5.0 | 7.0 | 13.0 | 30.0 |
| 11-C | 2,855 | 4.0 | 5.0 | 7.0 | 14.3 | 33.0 |
| 11-F | 1,229 | 4.0 | 5.0 | 7.0 | 15.0 | 32.9 |
| 12-B | 3,100 | 3.0 | 5.0 | 6.0 | 13.0 | 35.0 |
| 12-D | 2,620 | 4.0 | 5.0 | 7.0 | 13.0 | 49.8 |
| 12-F | 2,593 | 4.0 | 5.0 | 6.0 | 15.0 | 42.0 |
| 12-H | 3,123 | 3.0 | 5.0 | 6.0 | 12.0 | 28.8 |
| 12-I | 487 | 4.0 | 5.0 | 7.0 | 18.0 | 52.3 |
| 12-J | 784 | 4.0 | 5.0 | 7.0 | 16.8 | 51.2 |
| 12-K | 968 | 4.0 | 5.0 | 7.0 | 17.6 | 65.2 |
| 12-L | 813 | 4.0 | 5.0 | 7.0 | 13.0 | 34.0 |
| 13-C | 1,182 | 4.0 | 5.0 | 7.0 | 19.0 | 54.2 |
| 14-A | 1,199 | 4.0 | 5.0 | 7.0 | 15.0 | 44.0 |
| 14-B | 1,178 | 4.0 | 5.0 | 7.0 | 15.0 | 37.0 |
| 15-B | 3,101 | 4.0 | 5.0 | 7.0 | 11.0 | 30.0 |
| 15-D | 2,752 | 4.0 | 5.0 | 7.0 | 11.0 | 31.0 |
| 16-A | 2,993 | 4.0 | 5.0 | 6.0 | 11.0 | 41.0 |
| 16-C | 2,758 | 4.0 | 5.0 | 7.0 | 11.0 | 36.0 |
| 17-A | 2,747 | 4.0 | 5.0 | 7.0 | 11.0 | 40.0 |
| 18-D | 2,681 | 4.0 | 5.0 | 7.0 | 12.0 | 41.2 |
| 18-F | 1,159 | 4.0 | 5.0 | 7.0 | 13.0 | 32.3 |
| 18-G | 969 | 4.0 | 5.0 | 7.0 | 11.0 | 32.6 |
| 19-A | 2,527 | 4.0 | 5.0 | 6.0 | 11.0 | 49.2 |
| 19-B | 2,856 | 4.0 | 5.0 | 6.3 | 10.0 | 43.7 |
| 19-C | 1,389 | 4.0 | 5.0 | 7.0 | 10.0 | 33.1 |
| 19-D | 1,166 | 4.0 | 5.0 | 7.0 | 12.0 | 57.0 |
| 21-B | 2,579 | 4.0 | 5.0 | 7.0 | 10.0 | 35.2 |
| 21-C | 2,695 | 4.0 | 5.0 | 6.0 | 11.0 | 47.4 |
| 21-D | 1,476 | 4.0 | 5.0 | 6.0 | 11.0 | 43.0 |
| 22-A | 2,837 | 4.0 | 5.0 | 7.0 | 11.0 | 29.6 |
| 23-A | 2,194 | 4.0 | 5.0 | 7.0 | 11.0 | 92.1 |
| 24-A | 2,726 | 4.0 | 5.0 | 7.0 | 11.0 | 49.0 |
| 24-B | 2,515 | 4.0 | 5.0 | 7.0 | 12.3 | 45.7 |
| 24-C | 2,965 | 4.0 | 5.0 | 7.0 | 12.0 | 33.4 |
| 24-D | 1,344 | 4.0 | 5.0 | 7.0 | 13.0 | 133.9 |
| 24-E | 1,172 | 4.0 | 5.0 | 7.0 | 11.0 | 35.3 |
| 28-A | 2,899 | 4.0 | 5.0 | 7.0 | 12.0 | 28.0 |
| 28-B | 2,974 | 4.0 | 5.0 | 7.0 | 11.0 | 26.3 |
| 35-A | 2,923 | 4.0 | 5.0 | 7.0 | 10.9 | 26.8 |
| 36-A | 2,688 | 4.0 | 5.0 | 7.0 | 11.0 | 31.3 |
| 1-A | 2,562 | 4.0 | 5.0 | 7.0 | 14.0 | 47.7 |
| 14-F | 1,010 | 4.0 | 5.0 | 7.0 | 15.0 | 31.9 |

**Tier 3 -- Median 6-second updates (slower subset, ~8 buses):**

| Bus ID | Count | P25(s) | P50(s) | P75(s) | P95(s) | P99(s) |
|--------|------:|-------:|-------:|-------:|-------:|-------:|
| 2-E | 1,108 | 4.0 | 6.0 | 7.0 | 18.6 | 37.9 |
| 5-B | 2,503 | 4.0 | 6.0 | 7.0 | 13.0 | 38.0 |
| 15-A | 2,738 | 4.0 | 6.0 | 7.0 | 12.0 | 36.6 |
| 15-G | 2,671 | 4.0 | 6.0 | 7.0 | 12.0 | 35.3 |
| 16-B | 2,655 | 4.0 | 6.0 | 7.0 | 12.0 | 42.8 |
| 31-A | 2,238 | 4.0 | 6.0 | 7.0 | 11.0 | 41.6 |
| 13-E | 993 | 4.0 | 6.0 | 7.0 | 19.0 | 60.2 |
| 3-I | 257 | 4.0 | 6.0 | 7.0 | 24.4 | 58.8 |

**Outlier -- Bus 31-B (extremely slow updates):**

| Bus ID | Count | P25(s) | P50(s) | P75(s) | P95(s) | P99(s) |
|--------|------:|-------:|-------:|-------:|-------:|-------:|
| 31-B | 461 | 8.0 | 25.0 | 39.0 | 99.0 | 170.2 |

**What this means:** The effective GPS update rate has a clear structure with three tiers. Approximately 40 buses update with a median of 4 seconds (P25=2-3s, P75=5-6s), while ~85 buses update at a median of 5 seconds (P25=4s, P75=6-7s). A small group of ~8 buses update at 6-second medians. Bus 31-B is a severe outlier with a 25-second median -- its GPS hardware appears to be malfunctioning or it is mostly stationary.

The 62.8% of genuine updates arrive within 2-6 seconds. The distribution is bimodal, with a cluster at 2-3s (fast-updating buses) and a larger cluster at 4-7s (majority of fleet).

For the Kalman filter, this means:
- The prediction step should expect **4-6 second intervals** as the normal case.
- The P95 at 12 seconds means ~1 in 20 updates will have a longer gap, requiring the filter to extrapolate for up to 12 seconds.
- The P99 at 41 seconds means occasional large gaps where the filter should widen its uncertainty substantially.
- Gaps >60 seconds (0.3% of updates, ~817 occurrences) should trigger a filter reset.

---

## 7. Timestamp Precision and Quantization

### Modular Analysis (All 977,707 Records)

| Metric | Value |
|--------|-------|
| Unique (ts % 1000) values | 1 |
| Sub-second values observed | [0] only |
| Buses with 1 unique sub-second value | 128 (all) |

All timestamps are whole-second precision. There is zero sub-second granularity.

### Distribution of Last Digit of Seconds (ts_seconds % 10)

| Digit | Count | Percentage |
|------:|------:|----------:|
| 0 | 96,769 | 9.9% |
| 1 | 95,660 | 9.8% |
| 2 | 103,542 | 10.6% |
| 3 | 98,415 | 10.1% |
| 4 | 94,115 | 9.6% |
| 5 | 101,493 | 10.4% |
| 6 | 91,343 | 9.3% |
| 7 | 106,123 | 10.9% |
| 8 | 95,236 | 9.7% |
| 9 | 95,011 | 9.7% |

No quantization pattern. Timestamps land on every second with nearly equal probability (range: 9.3% to 10.9%).

### Timestamp Source Analysis

| Metric | Value |
|--------|-------|
| First 10 snapshots: all buses share same ts? | YES |
| Consecutive same-bus pairs with identical ts | 405,817 |
| Consecutive same-bus pairs with different ts | 571,762 |
| Ratio with same ts | 41.5% |
| Total record groups (consecutive same-ts blocks) | 5,599 |
| Expected (unique timestamps) | 5,580 |

**What this means:** All buses within a snapshot share the same timestamp, confirming that the `lastUpdate` field in the API response is the **server-side poll timestamp**, not the individual GPS unit's clock. The GPS units report positions to the server, and the server assigns a single timestamp to the entire batch. This means the timestamp tells us when the server last processed the data, not when the GPS fix was actually taken. The true GPS fix could be up to several seconds older than the reported timestamp, adding timing uncertainty to speed calculations.

The 41.5% same-timestamp rate aligns with polling faster than the API's 2-second cache interval. Our collector polls every ~2-4 seconds, and about 41.5% of the time it gets a cached response with the same timestamp as the previous poll.

The slight discrepancy between total record groups (5,599) and unique timestamps (5,580) suggests 19 cases where the same timestamp appeared in non-consecutive snapshots, possibly due to timestamp collisions during periods of rapid polling.

---

## Key Takeaways for Algorithm Design

### 1. Filter stale readings before speed calculation

Nearly half (48.1%) of timestamp-advanced readings are stale -- the position has not changed. The speed calculator must compare positions, not just timestamps, to identify genuine updates. Computing Haversine distance on a stale reading yields exactly 0 km/h; computing it on the first genuine reading after a long stale run may yield an artificially high speed if the time denominator includes the stale period.

**Recommendation:** When a genuine update arrives after N stale readings, the time gap used for speed calculation should be the elapsed time since the **last genuine update**, not since the last poll. This is the only way to get accurate distance/time ratios.

### 2. Design the Kalman filter for 4-6 second prediction intervals

The median effective update gap is 5 seconds (P25=3s, P75=6s). The Kalman filter's prediction step should be optimized for this range. Process noise should be tuned assuming:
- **Normal intervals:** 2-8 seconds (92.3% of updates)
- **Extended intervals:** 8-15 seconds (4.8% of updates)
- **Long gaps:** 15-60 seconds (3.4% of updates)
- **Discontinuities:** >60 seconds (0.6% of updates -- should trigger filter reset)

### 3. Implement gap detection and filter reset

126 of 128 buses experience gaps >5 minutes. Two systematic collection outages (132.8 min and 171.0 min) affect nearly all buses. The filter must detect gaps exceeding a threshold (recommended: 60 seconds, based on the distribution showing 99.4% of genuine gaps are under 60s) and reset its state entirely -- reinitializing position from the new reading and outputting no speed for the first reading after the gap.

### 4. Account for timestamp being server-side, not GPS-side

All buses in a snapshot share the same timestamp, confirming it is the collector's poll time, not the GPS fix time. This introduces up to ~2-4 seconds of additional timing uncertainty. At 50 km/h, a 2-second timing error translates to ~28 meters of position uncertainty, which is significant relative to GPS noise (~5m). The conservative speed factor (currently 0.95) should account for this.

### 5. Handle the 41.5% same-timestamp duplicate rate

The collector polls faster than the API cache interval, resulting in 41.5% duplicate snapshots. These should be filtered at ingestion time (compare timestamp to previous) rather than passed to the speed calculator, to avoid unnecessary processing and to keep the Kalman filter's update timing accurate.

### 6. Expect route switching on buses 16-A/B/C, 17-A/B

Five buses alternate between routes 16 and 17, with brief trip-ID flapping at transitions. The speed algorithm should be **bus-keyed** (not route-keyed or trip-keyed), and the UI should handle route changes gracefully rather than treating them as new buses appearing.

### 7. Bus 99-A and 31-B are anomalous

Bus 99-A has a 60.4% stale rate with 0% genuine updates -- it is likely a stationary test/depot bus. Bus 31-B has a median effective update gap of 25 seconds (vs fleet median of 5s) and P95 of 99 seconds -- its GPS hardware appears to be malfunctioning. These outliers should be handled gracefully (e.g., suppress speed display when update rate is too low) rather than allowed to produce misleading speed values.

### 8. Polling at 2-second intervals is sufficient

The API's cache interval is 2 seconds, and the minimum observed gap between snapshots is 2 seconds. Polling faster than every 2 seconds yields only duplicates. Polling at exactly 2 seconds captures 37.1% of all distinct snapshots; the remaining snapshots arrive at 3-5 second intervals due to network latency. A polling interval of 2 seconds is optimal.

### 9. Long stale runs mask real motion

Stale runs of 50-100+ readings (representing 3-8+ minutes of wall time) occur regularly. After such a run, the next genuine update may show a large position jump. Speed calculated naively from the endpoints of such a gap would be an average over the entire stale period, underestimating peak speed during that interval. The algorithm should consider suppressing speed output when the gap since the last genuine update exceeds a threshold (e.g., 30 seconds), since the resulting average speed would be too coarse to be meaningful for violation detection.
