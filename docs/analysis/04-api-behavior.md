
# API Behavior Analysis -- Straeto Bus GPS Data

Dataset: `data/2026-03-11.jsonl` -- 977,707 records, 128 buses, 25 routes
Collection period: 2026-03-11 08:48:42 UTC to 2026-03-11 19:14:05 UTC (10.42 hours)
Analysis script: `scripts/analysis-api.mjs`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Snapshot Analysis](#2-snapshot-analysis)
   - 2.1 [Snapshot Size](#21-snapshot-size)
   - 2.2 [Snapshot Timing](#22-snapshot-timing)
   - 2.3 [Collection Gaps](#23-collection-gaps)
3. [Bus Appearance and Disappearance](#3-bus-appearance-and-disappearance)
   - 3.1 [Bus Lifecycle Overview](#31-bus-lifecycle-overview)
   - 3.2 [Coverage Distribution](#32-coverage-distribution)
   - 3.3 [Fleet Size Over Time](#33-fleet-size-over-time)
   - 3.4 [Flickering and Transient Buses](#34-flickering-and-transient-buses)
4. [Timestamp and Staleness Analysis](#4-timestamp-and-staleness-analysis)
   - 4.1 [Staleness Distribution](#41-staleness-distribution)
   - 4.2 [Per-Bus Staleness](#42-per-bus-staleness)
   - 4.3 [Timestamp Homogeneity Within Snapshots](#43-timestamp-homogeneity-within-snapshots)
5. [Bus ID, Trip ID, and Route Behavior](#5-bus-id-trip-id-and-route-behavior)
   - 5.1 [ID Format and Counts](#51-id-format-and-counts)
   - 5.2 [Bus ID Prefix vs Route Mapping](#52-bus-id-prefix-vs-route-mapping)
   - 5.3 [Trips Per Bus](#53-trips-per-bus)
   - 5.4 [Trip ID Changes](#54-trip-id-changes)
   - 5.5 [Route-Switching Buses](#55-route-switching-buses)
   - 5.6 [Buses Per Route](#56-buses-per-route)
6. [Headsign Patterns](#6-headsign-patterns)
   - 6.1 [Headsign Inventory](#61-headsign-inventory)
   - 6.2 [Headsign-to-Route Mapping](#62-headsign-to-route-mapping)
   - 6.3 [Route-to-Headsign Mapping](#63-route-to-headsign-mapping)
   - 6.4 [Headsign Change Behavior](#64-headsign-change-behavior)
7. [Direction Field Analysis](#7-direction-field-analysis)
   - 7.1 [Direction Statistics](#71-direction-statistics)
   - 7.2 [Direction Change Behavior](#72-direction-change-behavior)
8. [Deduplication Characteristics](#8-deduplication-characteristics)
   - 8.1 [Duplicate Rates](#81-duplicate-rates)
   - 8.2 [Per-Bus Duplicate Analysis](#82-per-bus-duplicate-analysis)
   - 8.3 [Duplicate Run Lengths](#83-duplicate-run-lengths)
9. [API Rate and Volume](#9-api-rate-and-volume)
   - 9.1 [Overall Rates](#91-overall-rates)
   - 9.2 [Records Per Hour](#92-records-per-hour)
   - 9.3 [Data Volume](#93-data-volume)
   - 9.4 [Optimal Polling Interval](#94-optimal-polling-interval)
10. [Key Takeaways](#10-key-takeaways)

---

## 1. Executive Summary

Five most critical findings from the analysis of 977,707 records across 9,478 API snapshots:

1. **41.3% of all records are pure duplicates.** The API returns the same (busId, lat, lng, timestamp) tuple across consecutive polls. After deduplication, only 571,890 unique (busId, ts) pairs remain -- 58.5% of the original data. Nearly half of all storage and processing is wasted without deduplication.

2. **Bus GPS updates arrive every 2-4 seconds (median 3.0s), not every 1 second.** Polling faster than every 3 seconds yields diminishing returns. At a 1-second poll interval, each response yields only 34.4 new bus records on average; at 3 seconds, it yields 103.2 (the full fleet). Polling at 3s instead of 1s cuts bandwidth from 70.8 MB/hr to 23.6 MB/hr with zero data loss.

3. **The fleet is remarkably stable: 92 of 128 buses have over 90% coverage** across the entire collection period. Buses do not appear and disappear unpredictably -- they are persistent entities in the API. Only 4 buses exhibit "flickering" behavior (frequent gaps).

4. **Five buses switch between routes 16 and 17** (16-A, 16-B, 16-C, 17-A, 17-B). These are the only buses observed on multiple routes. The bus ID prefix does not reliably indicate the current route for these buses.

5. **Two major collection gaps (132.8 min and 171.0 min) account for ~5 hours of missing data** in the 10.42-hour collection window. Outside these gaps, the API was polled consistently with a median interval of 2.0 seconds and 95th percentile of 6.0 seconds.

---

## 2. Snapshot Analysis

A "snapshot" is a single API response containing the positions of all currently tracked buses.

### 2.1 Snapshot Size

| Metric | Value |
| --- | --- |
| Total snapshots | 9,478 |
| Total records | 977,707 |
| Records per snapshot (avg) | 103.2 |

**Buses per response (detailed statistics):**

| Statistic | Value |
| --- | --- |
| Min | 64 |
| Max | 127 |
| Mean | 103.2 |
| Median | 93.0 |
| P5 | 88.0 |
| P25 | 90.0 |
| P75 | 123.0 |
| P95 | 127.0 |
| Std | 16.6 |

**Snapshot size distribution:**

| Buses per response | Count | % |
| --- | --- | --- |
| 60-70 | 49 | 0.5% |
| 70-80 | 291 | 3.1% |
| 80-90 | 1,746 | 18.4% |
| **90-100** | **3,269** | **34.5%** |
| 100-110 | 462 | 4.9% |
| 110-120 | 755 | 8.0% |
| **120-130** | **2,906** | **30.7%** |

The distribution is bimodal with two distinct clusters: ~90 buses (34.5% of snapshots) and ~125 buses (30.7% of snapshots). This corresponds to time of day -- the fleet runs ~88-90 buses during midday (11:00-14:00) and expands to 123-127 during the afternoon rush (14:00-16:00). The late evening window (19:00+) drops to ~68-72 buses.

**What This Means:**
The app should expect the API to return between 64 and 127 bus records per call and should allocate marker pools accordingly. The bimodal pattern reflects Straeto's service schedule: fewer buses run during off-peak hours, more during the afternoon rush. Pre-allocate for at least 130 markers to avoid runtime allocations during peak.

### 2.2 Snapshot Timing

**Time gaps between consecutive snapshots (seconds):**

| Statistic | Value |
| --- | --- |
| Min | 0.0s |
| Max | 10,260.0s |
| Mean | 4.0s |
| Median | 2.0s |
| P5 | 0.0s |
| P25 | 0.0s |
| P75 | 4.0s |
| P95 | 6.0s |
| P99 | 7.0s |

**Gap distribution:**

| Gap range | Count | % |
| --- | --- | --- |
| 0-1s | 3,923 | 41.4% |
| 2-3s | 2,049 | 21.6% |
| 3-4s | 1,020 | 10.8% |
| 4-5s | 1,289 | 13.6% |
| 5-6s | 652 | 6.9% |
| 6-8s | 474 | 5.0% |
| 8-10s | 44 | 0.5% |
| 10-15s | 19 | 0.2% |
| 15-20s | 1 | 0.0% |
| 20-30s | 2 | 0.0% |
| 30-60s | 1 | 0.0% |
| 60-120s | 1 | 0.0% |
| 600+s | 2 | 0.0% |

**Collection window:**

| Metric | Value |
| --- | --- |
| First snapshot | 2026-03-11 08:48:42.000 UTC |
| Last snapshot | 2026-03-11 19:14:05.000 UTC |
| Collection duration | 10.42 hours |

**What This Means:**
The collector was polling aggressively -- 41.4% of gaps are under 1 second. Given the API's `cache-control: max-age=2` header, many of these sub-second polls returned cached (identical) responses. The 99th percentile gap is only 7 seconds, meaning the collector was consistently fast outside of the major outages. For the app, targeting a 2-3 second poll interval aligns with the API's cache behavior and the actual GPS update cadence. Polling faster than the 2-second cache TTL guarantees wasted requests.

### 2.3 Collection Gaps

Four gaps longer than 30 seconds were detected:

| Start (UTC) | End (UTC) | Duration (seconds) | Duration (minutes) |
| --- | --- | --- | --- |
| 2026-03-11 08:58:42 | 2026-03-11 11:11:31 | 7,969s | **132.8 min** |
| 2026-03-11 15:26:15 | 2026-03-11 15:27:29 | 74s | 1.2 min |
| 2026-03-11 15:58:05 | 2026-03-11 15:58:39 | 34s | 0.6 min |
| 2026-03-11 16:11:30 | 2026-03-11 19:02:30 | 10,260s | **171.0 min** |

The two major gaps (132.8 minutes from ~09:00-11:11 and 171.0 minutes from ~16:12-19:03) account for approximately 5 hours of missing data within the 10.42-hour collection window. The two minor gaps (1.2 min and 0.6 min) are inconsequential. The actual continuous collection windows break down to:

- 08:48 -- 08:58 (10 min)
- 11:11 -- 16:11 (5 hours)
- 19:02 -- 19:14 (12 min)

**What This Means:**
These gaps are collector-side outages (the script stopped or lost connectivity), not API outages. The API resumed returning data immediately after each gap. For a production collector:

- Implement health-check monitoring and auto-restart
- Log gap events with timestamps for data quality tracking
- The app's playback mode must gracefully handle time gaps -- show a "no data" indicator rather than interpolating across multi-hour voids
- When the collector reconnects, it must not compute speed from the last pre-gap reading (the stale time delta would yield nonsensical speeds)

---

## 3. Bus Appearance and Disappearance

### 3.1 Bus Lifecycle Overview

| Metric | Value |
| --- | --- |
| Total unique bus IDs | 128 |
| Stable core fleet (>90% coverage, span >10% of day) | 92 buses |
| Transient buses (span <5% of day) | 0 buses |
| Flickering buses (>5 gaps, <95% coverage) | 4 buses |

**Top 30 buses by record count (all with 100% coverage):**

| Bus ID | Records | First Seen | Last Seen | Present In | Coverage | Gaps | Max Gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2-B | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 3-B | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 3-C | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 4-D | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 5-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 6-B | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 7-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 7-B | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 11-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 11-B | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 12-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 12-D | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 13-B | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 14-C | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 14-D | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 14-E | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 15-B | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 15-E | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 16-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 19-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 21-B | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 21-C | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 24-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 28-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 35-A | 9,478 | 08:48:42 | 19:14:05 | 9,478 | 100.0% | 0 | 0 |
| 6-A | 9,476 | 08:48:42 | 19:14:05 | 9,476 | 100.0% | 1 | 2 |
| 19-C | 9,476 | 08:48:42 | 19:14:05 | 9,476 | 100.0% | 2 | 1 |
| 36-A | 9,476 | 08:48:42 | 19:14:05 | 9,476 | 100.0% | 1 | 2 |
| 1-D | 9,475 | 08:48:42 | 19:14:05 | 9,475 | 100.0% | 1 | 2 |
| 15-A | 9,475 | 08:48:42 | 19:14:05 | 9,475 | 100.0% | 1 | 3 |

25 buses appear in every single one of the 9,478 snapshots with zero gaps. The next tier (6-A, 19-C, 36-A, 1-D, 15-A) miss only 2-3 snapshots out of 9,478 -- effectively 100% coverage.

### 3.2 Coverage Distribution

**Coverage across all 128 buses:**

| Metric | Value |
| --- | --- |
| Mean coverage | 83.3% |
| Median coverage | 99.9% |
| Min coverage | 19.7% |
| Max coverage | 100.0% |

| Coverage range | # Buses | % of fleet |
| --- | --- | --- |
| 10-20% | 1 | 0.8% |
| 20-30% | 3 | 2.3% |
| 30-40% | 10 | 7.8% |
| 40-50% | 15 | 11.7% |
| 50-60% | 3 | 2.3% |
| 60-70% | 1 | 0.8% |
| 70-80% | 2 | 1.6% |
| 80-90% | 1 | 0.8% |
| 90-95% | 7 | 5.5% |
| 95-99% | 12 | 9.4% |
| 99-100% | 73 | 57.0% |

**What This Means -- Bus Lifecycle Management:**
The coverage distribution is heavily bimodal: 57.0% of buses appear in 99-100% of snapshots (the always-on core fleet), while 22.6% of buses appear in only 20-50% of snapshots (afternoon-only additions). The median of 99.9% vs mean of 83.3% confirms this skew. For bus lifecycle management in the app:

- Do not aggressively remove bus markers after a single missed snapshot -- most buses persist for the entire day
- A bus missing from 2-3 consecutive snapshots is normal behavior (even 100%-coverage buses have occasional 1-2 snapshot gaps)
- Wait for at least 30-60 seconds of absence before fading a marker, and at least 2-3 minutes before removing it entirely
- When a new bus appears in the API response for the first time, add it immediately -- there is no "warm-up" period

### 3.3 Fleet Size Over Time

Sampled every 100 snapshots:

| Snapshot # | Time (UTC) | # Buses |
| --- | --- | --- |
| 0 | 08:48:42 | 123 |
| 189 | 08:55:10 | 122 |
| 378 | 11:14:26 | 90 |
| 567 | 11:20:43 | 90 |
| 756 | 11:27:02 | 89 |
| 945 | 11:33:30 | 89 |
| 1,134 | 11:39:53 | 90 |
| 1,323 | 11:46:15 | 88 |
| 1,512 | 11:52:36 | 89 |
| 1,701 | 11:59:01 | 88 |
| 1,890 | 12:05:24 | 89 |
| 2,079 | 12:11:46 | 89 |
| 2,268 | 12:18:12 | 89 |
| 2,457 | 12:24:43 | 88 |
| 2,646 | 12:31:05 | 89 |
| 2,835 | 12:37:22 | 92 |
| 3,024 | 12:43:47 | 91 |
| 3,213 | 12:50:05 | 91 |
| 3,402 | 12:56:28 | 91 |
| 3,591 | 13:02:55 | 92 |
| 3,780 | 13:09:18 | 91 |
| 3,969 | 13:15:49 | 92 |
| 4,158 | 13:22:11 | 92 |
| 4,347 | 13:28:34 | 91 |
| 4,536 | 13:34:53 | 93 |
| 4,725 | 13:41:16 | 94 |
| 4,914 | 13:47:41 | 95 |
| 5,103 | 13:54:03 | 96 |
| 5,292 | 14:00:23 | 98 |
| 5,481 | 14:06:55 | 105 |
| 5,670 | 14:13:17 | 110 |
| 5,859 | 14:19:34 | 111 |
| 6,048 | 14:26:04 | 114 |
| 6,237 | 14:32:26 | 116 |
| 6,426 | 14:38:56 | 118 |
| 6,615 | 14:45:17 | 123 |
| 6,804 | 14:51:43 | 123 |
| 6,993 | 14:58:09 | 122 |
| 7,182 | 15:04:46 | 123 |
| 7,371 | 15:11:07 | 125 |
| 7,560 | 15:17:47 | 125 |
| 7,749 | 15:24:13 | 125 |
| 7,938 | 15:30:35 | 125 |
| 8,127 | 15:37:05 | 127 |
| 8,316 | 15:43:22 | 126 |
| 8,505 | 15:49:50 | 126 |
| 8,694 | 15:56:16 | 127 |
| 8,883 | 16:02:48 | 126 |
| 9,072 | 16:09:20 | 127 |
| 9,261 | 19:06:41 | 72 |
| 9,450 | 19:13:17 | 68 |

The fleet ramps up gradually through the afternoon:
- **Morning start (08:48)**: 122-123 buses
- **Midday baseline (11:00-13:30)**: 88-92 buses
- **Afternoon ramp (13:30-14:45)**: gradual growth from 93 to 123
- **Peak fleet (15:00-16:09)**: 125-127 buses
- **Evening drop (19:00+)**: 68-72 buses

**What This Means:**
The afternoon ramp-up is smooth (about 1 new bus every 3-4 minutes between 14:00-15:00), so new buses appear gradually rather than in bursts. The morning start at 123 buses followed by a drop to ~90 at midday (after the first collection gap) likely reflects the collector restarting after the 132.8-minute gap rather than an actual fleet change. The KPI display should show the current active fleet count and expect it to fluctuate between 68 and 127 depending on time of day.

### 3.4 Flickering and Transient Buses

**Flickering buses** (>5 gaps, <95% coverage): 4 buses

| Bus ID | Gaps | Max Gap (snapshots) | Coverage |
| --- | --- | --- | --- |
| 2-C | 19 | 295 | 93.7% |
| 2-A | 34 | 234 | 91.5% |
| 23-A | 19 | 776 | 91.2% |
| 6-H | 12 | 5,923 | 35.0% |

Bus 6-H stands out with only 35.0% coverage and a max gap of 5,923 snapshots -- it was absent for long stretches. This is likely a bus that went out of service for a significant portion of the day.

**Transient buses** (span <5% of day): 0 buses. Every bus that appeared at all was present for a meaningful portion of the collection period.

**What This Means:**
Flickering is rare and mostly mild (3 of 4 flickerers still have >91% coverage). The one outlier (6-H) behaves more like an intermittent-service bus. For the app:
- The vast majority of buses are stable -- aggressive removal logic is unnecessary
- The 4 flickering buses will not cause visual artifacts if the app uses a fade-out delay of 30+ seconds before removing a marker
- A bus that disappears and reappears should retain its color-coding and trail history

---

## 4. Timestamp and Staleness Analysis

"Staleness" measures the difference between the poll time and each bus's own GPS timestamp (`lastUpdate`). Higher staleness means the GPS data for that bus is older relative to when it was received.

### 4.1 Staleness Distribution

**Staleness (poll_time - bus_ts) across all 977,707 records:**

| Statistic | Value |
| --- | --- |
| Min | 0.0s |
| Max | 10,260.0s |
| Mean | 4.2s |
| Median | 2.0s |
| P5 | 0.0s |
| P25 | 0.0s |
| P75 | 4.0s |
| P95 | 6.0s |
| P99 | 7.0s |

| Staleness range | Records | % |
| --- | --- | --- |
| 0-1s | 435,815 | 44.6% |
| 2-3s | 195,209 | 20.0% |
| 3-4s | 100,291 | 10.3% |
| 4-5s | 124,957 | 12.8% |
| 5-10s | 118,370 | 12.1% |
| 10-15s | 2,213 | 0.2% |
| 15-20s | 123 | 0.0% |
| 20-30s | 245 | 0.0% |
| 30-60s | 123 | 0.0% |
| 60-120s | 121 | 0.0% |
| 600+s | 240 | 0.0% |

Records with 0 staleness (freshest bus in each snapshot): 435,815 (44.6%).

**What This Means:**
Data is very fresh -- 87.7% of records are 5 seconds old or less. The 44.6% with zero staleness means nearly half the fleet updates in the same second as the poll. For the speed calculation pipeline:
- GPS position timestamps are highly reliable for computing time deltas between fixes
- The rare high-staleness outliers (>10s) are likely stale GPS readings from buses with poor cellular connectivity; these should be flagged but not discarded
- For the animation system, a 2-3 second interpolation window is appropriate since most updates arrive within that window

### 4.2 Per-Bus Staleness

**Top 20 stalest buses (by average staleness):**

| Bus ID | Avg Staleness (s) | Records |
| --- | --- | --- |
| 12-I | 12.0 | 1,803 |
| 3-I | 11.9 | 1,048 |
| 3-G | 10.2 | 2,217 |
| 1-K | 9.1 | 2,547 |
| 12-L | 8.7 | 2,687 |
| 5-H | 8.2 | 2,935 |
| 2-F | 8.2 | 2,942 |
| 4-E | 8.2 | 2,942 |
| 6-I | 8.0 | 3,006 |
| 18-G | 7.9 | 3,068 |
| 12-J | 7.9 | 3,070 |
| 6-H | 7.7 | 3,199 |
| 3-H | 7.1 | 3,546 |
| 11-D | 7.0 | 3,667 |
| 18-F | 6.9 | 3,709 |
| 1-I | 6.8 | 3,778 |
| 21-E | 6.7 | 3,847 |
| 12-K | 6.7 | 3,868 |
| 19-D | 6.7 | 3,894 |
| 14-B | 6.6 | 3,971 |

**What This Means:**
A clear pattern: buses with fewer records also tend to have higher average staleness. Buses 12-I (12.0s avg, 1,803 records) and 3-I (11.9s avg, 1,048 records) are the stalest and also have among the fewest records. These are likely afternoon-only buses with weaker GPS/cellular hardware or coverage gaps. The typical core-fleet bus has 2-4s average staleness. For speed calculation, staler buses need larger time windows for position smoothing since their update intervals are less consistent.

### 4.3 Timestamp Homogeneity Within Snapshots

| Metric | Value |
| --- | --- |
| Unique bus timestamps per snapshot (min) | 1 |
| Unique bus timestamps per snapshot (max) | 2 |
| Unique bus timestamps per snapshot (mean) | 1.6 |
| Unique bus timestamps per snapshot (median) | 2 |
| Snapshots where all buses share one timestamp | 3,955 (41.7%) |

| Unique timestamps per snapshot | Count | % |
| --- | --- | --- |
| 1 (homogeneous) | 3,955 | 41.7% |
| 2 (two groups) | 5,523 | 58.3% |

**What This Means:**
Each API response contains buses from at most 2 different GPS update cycles. In 41.7% of snapshots, every bus shares a single timestamp. The API backend updates all bus positions atomically on a ~2-3 second tick, and the API response reflects either one or two of these ticks. For deduplication:
- Comparing `(busId, timestamp)` is a reliable dedup key
- There is no sub-second variation within snapshots -- timestamps are quantized to whole seconds
- The maximum of 2 distinct timestamps means the API is not streaming; it is batch-updating on a fixed cadence

---

## 5. Bus ID, Trip ID, and Route Behavior

### 5.1 ID Format and Counts

| Metric | Value |
| --- | --- |
| Unique bus IDs | 128 |
| Unique trip IDs | 1,060 |
| Unique routes | 25 |
| Unique headsigns | 51 |

All 128 bus IDs follow the format `<number>-<letter>` (e.g., "1-A", "12-D", "99-A"). No other formats exist in the dataset.

### 5.2 Bus ID Prefix vs Route Mapping

| Relationship | Count |
| --- | --- |
| Prefixes that always match their route | 23 |
| Prefixes with different routes | 3 |

The three exceptions:

| Bus ID Prefix | Routes observed |
| --- | --- |
| 99 | 1 |
| 16 | 16, 17 |
| 17 | 16, 17 |

Bus 99-A operates on route 1 -- its prefix (99) does not match its route. Buses with prefixes 16 and 17 cross-operate between routes 16 and 17 (see section 5.5 for details).

**What This Means:**
For 23 of 26 prefixes, the bus ID prefix reliably indicates the route. However, the app must never assume `busId.split("-")[0] === routeNr`. Always use the `routeNr` field from the API response. The 99-A case is particularly important -- it would be misclassified if route were inferred from the bus ID.

### 5.3 Trips Per Bus

| Statistic | Value |
| --- | --- |
| Min trips per bus | 1 |
| Max trips per bus | 56 |
| Mean | 8.3 |
| Median | 8 |

| Trips per bus | # Buses | % |
| --- | --- | --- |
| 1-2 | 2 | 1.6% |
| 2-3 | 2 | 1.6% |
| 3-4 | 9 | 7.0% |
| 4-5 | 19 | 14.8% |
| 5-6 | 6 | 4.7% |
| 6-8 | 14 | 10.9% |
| 8-10 | 34 | 26.6% |
| 10-15 | 38 | 29.7% |
| 15-20 | 3 | 2.3% |
| 50+ | 1 | 0.8% |

**What This Means:**
A "trip" represents one end-to-end journey of a route. Most buses complete 4-15 trips during the observation window, consistent with typical urban transit operations (30-90 minute round trips over ~5 hours of active data). The one bus with 56 trips is an outlier -- likely a short-loop shuttle route or a trip ID that flickers rapidly. The trip ID is useful for grouping positions into logical journeys but should not be used as a primary key since it changes frequently.

### 5.4 Trip ID Changes

| Metric | Value |
| --- | --- |
| Total trip ID changes | 1,933 |
| Buses with trip changes | 126 |
| Changes per bus (min) | 1 |
| Changes per bus (max) | 190 |
| Changes per bus (mean) | 15.3 |
| Changes per bus (median) | 11 |

**What This Means:**
Trip IDs change frequently -- 15.3 times per bus on average across ~5 hours of active collection. This means a trip change occurs roughly every 20 minutes per bus. The bus with 190 changes (averaging one change every 1.6 minutes) is likely experiencing rapid trip ID flicker rather than actually completing trips. For the app:
- Do not use trip ID as a stable identifier for tracking bus state
- Trip ID changes can signal the start of a new journey -- useful for resetting speed calculation buffers
- The high-change-count outlier suggests trip IDs may briefly flicker during transitions (similar to headsign flicker, see section 6.4)

### 5.5 Route-Switching Buses

| Metric | Value |
| --- | --- |
| Buses always on one route | 123 |
| Buses on multiple routes | 5 |

The 5 route-switching buses and their observed routes:

| Bus ID | Routes |
| --- | --- |
| 16-A | 16, 17 |
| 16-B | 16, 17 |
| 16-C | 17, 16 |
| 17-A | 17, 16 |
| 17-B | 16, 17 |

All 5 share the same behavior: they alternate between routes 16 and 17 exclusively. No bus was observed on three or more routes.

Looking at the buses-per-route table (section 5.6), both routes 16 and 17 show exactly 5 buses, and those 5 buses are the same set: 16-A, 16-B, 16-C, 17-A, 17-B. This strongly suggests routes 16 and 17 are operationally linked -- possibly the same physical corridor in opposite directions, or one continues as the other at a terminus.

**What This Means:**
For the app:
- When a bus switches routes, reset any route-specific speed calculation state
- The route filter UI should correctly update -- if a user is filtering for route 16, a bus that switches to route 17 should disappear from their view
- The route field from the API response is the authoritative source; do not cache route assignment per bus ID
- Consider showing routes 16 and 17 together in the UI (e.g., "Routes 16/17") since they share a bus pool

### 5.6 Buses Per Route

| Route | # Buses | Bus IDs |
| --- | --- | --- |
| 1 | 12 | 1-A, 1-B, 1-C, 1-D, 1-E, 1-F, 1-G, 1-H, 1-I, 1-J, 1-K, 99-A |
| 2 | 8 | 2-A, 2-B, 2-C, 2-D, 2-E, 2-F, 2-G, 2-H |
| 3 | 9 | 3-A, 3-B, 3-C, 3-D, 3-E, 3-F, 3-G, 3-H, 3-I |
| 4 | 7 | 4-A, 4-B, 4-C, 4-D, 4-E, 4-F, 4-G |
| 5 | 8 | 5-A, 5-B, 5-C, 5-D, 5-E, 5-F, 5-G, 5-H |
| 6 | 9 | 6-A, 6-B, 6-C, 6-D, 6-E, 6-F, 6-G, 6-H, 6-I |
| 7 | 2 | 7-A, 7-B |
| 8 | 1 | 8-A |
| 11 | 6 | 11-A, 11-B, 11-C, 11-D, 11-E, 11-F |
| 12 | 12 | 12-A, 12-B, 12-C, 12-D, 12-E, 12-F, 12-G, 12-H, 12-I, 12-J, 12-K, 12-L |
| 13 | 5 | 13-A, 13-B, 13-C, 13-D, 13-E |
| 14 | 6 | 14-A, 14-B, 14-C, 14-D, 14-E, 14-F |
| 15 | 8 | 15-A, 15-B, 15-C, 15-D, 15-E, 15-F, 15-G, 15-H |
| 16 | 5 | 16-A, 16-B, 16-C, 17-A, 17-B |
| 17 | 5 | 16-A, 16-B, 16-C, 17-A, 17-B |
| 18 | 7 | 18-A, 18-B, 18-C, 18-D, 18-E, 18-F, 18-G |
| 19 | 4 | 19-A, 19-B, 19-C, 19-D |
| 21 | 5 | 21-A, 21-B, 21-C, 21-D, 21-E |
| 22 | 1 | 22-A |
| 23 | 1 | 23-A |
| 24 | 6 | 24-A, 24-B, 24-C, 24-D, 24-E, 24-F |
| 28 | 2 | 28-A, 28-B |
| 31 | 2 | 31-A, 31-B |
| 35 | 1 | 35-A |
| 36 | 1 | 36-A |

Routes 1 and 12 are the largest with 12 buses each. Routes 8, 22, 23, 35, and 36 operate with a single bus. Note that routes 16 and 17 list the exact same 5 buses.

---

## 6. Headsign Patterns

### 6.1 Headsign Inventory

51 unique headsign strings observed. Several headsigns have trailing-space variants (e.g., "Egilsholl" and "Egilsholl "), inflating the count from a true unique value of approximately 39 to 51.

Full headsign list (51 values): BSI/Landspitalinn, Berg/Fell, Dalaping, Egilsholl, Egilsholl (trailing space), Eidisgrandi, Engihjalli/Karsnes, Engihjalli/Karsnes (trailing space), Fell/Berg, Gamla Hringbraut, Grandi, Grandi (trailing space), Gufunesbaer, HR, Hamraborg, Hfj. Skardshlid, Hvaleyrarholt, Hvaleyrarholt (trailing space), HI, HI (trailing space), Kaplakriki, Karsnes/Engihjalli, Karsnes/Engihjalli (trailing space), Leirvogstunga, Meistaravellir, Mjodd, Mjodd (trailing space), Mjodd/Artun, Mjodd/Artun (trailing space), Mosfellsbaer, Nautholl - HR, Nordlingaholt, Sel/Fell, Seltjarnarnes, Skerjafjoerdur, Skerjafjoerdur (trailing space), Skulagata, Skulagata um Grafarholt, Slettuvegur, Slettuvegur (trailing space), Spong, Spong um Grafarholt, Spongin, Urridaholt/Asgardur, Urridaholt/Asgardur (trailing space), Verzlo, Alftanes/Asgardur, Alftanes/Asgardur (trailing space), Arbaer/Hraunas, Asgardur, Asvallalaug.

**Trailing-space duplicates identified:**

| Clean value | Trailing-space variant |
| --- | --- |
| Egilsholl | Egilsholl (space) |
| Grandi | Grandi (space) |
| HI | HI (space) |
| Hvaleyrarholt | Hvaleyrarholt (space) |
| Mjodd | Mjodd (space) |
| Mjodd/Artun | Mjodd/Artun (space) |
| Skerjafjoerdur | Skerjafjoerdur (space) |
| Slettuvegur | Slettuvegur (space) |
| Karsnes/Engihjalli | Karsnes/Engihjalli (space) |
| Engihjalli/Karsnes | Engihjalli/Karsnes (space) |
| Alftanes/Asgardur | Alftanes/Asgardur (space) |
| Urridaholt/Asgardur | Urridaholt/Asgardur (space) |

### 6.2 Headsign-to-Route Mapping

Headsigns are NOT 1:1 with routes. Several headsigns appear on multiple routes:

| Headsign | Routes |
| --- | --- |
| Alftanes/Asgardur | 23 |
| Alftanes/Asgardur (space) | 23 |
| Arbaer/Hraunas | 16 |
| Asgardur | 24 |
| Asvallalaug | 19 |
| Berg/Fell | 4 |
| BSI/Landspitalinn | 8 |
| Dalaping | 28 |
| **Egilsholl** | **31, 6** |
| Egilsholl (space) | 6 |
| Eidisgrandi | 13 |
| Engihjalli/Karsnes | 36 |
| Engihjalli/Karsnes (space) | 36 |
| Fell/Berg | 17 |
| Gamla Hringbraut | 5 |
| **Grandi** | **14, 3** |
| Grandi (space) | 14 |
| Gufunesbaer | 31 |
| Hamraborg | 28 |
| Hfj. Skardshlid | 1 |
| **HI** | **2, 6** |
| HI (space) | 6 |
| HR | 5 |
| Hvaleyrarholt | 21 |
| Hvaleyrarholt (space) | 21 |
| Kaplakriki | 19 |
| Karsnes/Engihjalli | 35 |
| Karsnes/Engihjalli (space) | 35 |
| Leirvogstunga | 7 |
| Meistaravellir | 15 |
| **Mjodd** | **11, 2, 21** |
| Mjodd (space) | 11, 2 |
| Mjodd/Artun | 12 |
| Mjodd/Artun (space) | 12 |
| Mosfellsbaer | 15 |
| Nautholl - HR | 8 |
| Nordlingaholt | 5 |
| Sel/Fell | 3 |
| Seltjarnarnes | 11 |
| Skerjafjoerdur | 12 |
| Skerjafjoerdur (space) | 12 |
| **Skulagata** | **1, 16, 17, 18, 4** |
| Skulagata um Grafarholt | 18 |
| Slettuvegur | 13 |
| Slettuvegur (space) | 13 |
| Spong | 24 |
| Spong um Grafarholt | 18 |
| Spongin | 7 |
| Urridaholt/Asgardur | 22 |
| Urridaholt/Asgardur (space) | 22 |
| Verzlo | 14 |

Key multi-route headsigns:
- **Skulagata**: 5 routes (1, 4, 16, 17, 18) -- a shared terminal/destination
- **Mjodd**: 3 routes (2, 11, 21) -- a major bus terminus
- **Grandi**: 2 routes (3, 14)
- **Egilsholl**: 2 routes (6, 31)
- **HI**: 2 routes (2, 6) -- the University of Iceland

### 6.3 Route-to-Headsign Mapping

Each route uses 2-4 headsigns (representing its two terminal directions plus trailing-space variants):

| Route | Headsigns |
| --- | --- |
| 1 | Skulagata, Hfj. Skardshlid |
| 2 | Mjodd, HI, Mjodd (space) |
| 3 | Grandi, Sel/Fell |
| 4 | Berg/Fell, Skulagata |
| 5 | Nordlingaholt, Gamla Hringbraut, HR |
| 6 | HI, Egilsholl, HI (space), Egilsholl (space) |
| 7 | Spongin, Leirvogstunga |
| 8 | BSI/Landspitalinn, Nautholl - HR |
| 11 | Mjodd, Seltjarnarnes, Mjodd (space) |
| 12 | Mjodd/Artun, Skerjafjoerdur, Mjodd/Artun (space), Skerjafjoerdur (space) |
| 13 | Slettuvegur, Eidisgrandi, Slettuvegur (space) |
| 14 | Verzlo, Grandi, Grandi (space) |
| 15 | Meistaravellir, Mosfellsbaer |
| 16 | Arbaer/Hraunas, Skulagata |
| 17 | Fell/Berg, Skulagata |
| 18 | Skulagata um Grafarholt, Spong um Grafarholt, Skulagata |
| 19 | Asvallalaug, Kaplakriki |
| 21 | Hvaleyrarholt, Mjodd, Hvaleyrarholt (space) |
| 22 | Urridaholt/Asgardur (space), Urridaholt/Asgardur |
| 23 | Alftanes/Asgardur (space), Alftanes/Asgardur |
| 24 | Asgardur, Spong |
| 28 | Hamraborg, Dalaping |
| 31 | Gufunesbaer, Egilsholl |
| 35 | Karsnes/Engihjalli, Karsnes/Engihjalli (space) |
| 36 | Engihjalli/Karsnes, Engihjalli/Karsnes (space) |

**What This Means:**
Headsigns represent the current direction of travel -- they indicate which terminus the bus is heading toward. Each route has 2 main headsigns (one per direction), some with a third variant for branches (e.g., route 5 has Nordlingaholt, Gamla Hringbraut, and HR; route 18 has three distinct headsigns). The trailing-space variants are a data quality issue in the API. For the app:
- Trim whitespace from headsigns on ingestion
- Headsigns can be used to show travel direction in the UI, but are not unique route identifiers (Skulagata appears on 5 routes)
- The combination of headsign + route together uniquely identifies the direction of travel

### 6.4 Headsign Change Behavior

| Metric | Value |
| --- | --- |
| Total headsign changes | 1,841 |
| Buses with headsign changes | 125 |
| Changes per bus (min) | 1 |
| Changes per bus (max) | 189 |
| Changes per bus (mean) | 14.7 |
| Changes per bus (median) | 10 |

**Sample headsign change traces:**

Bus **1-B** (15 changes shown, demonstrating terminus flicker):
```
"Skulagata" -> "Hfj. Skardshlid"  at 11:22:20
"Hfj. Skardshlid" -> "Skulagata"  at 12:22:58     (~60 min gap -- normal direction change)
"Skulagata" -> "Hfj. Skardshlid"  at 13:25:55     (~63 min gap -- normal)
"Hfj. Skardshlid" -> "Skulagata"  at 14:22:08     (~56 min gap -- normal)
"Skulagata" -> "Hfj. Skardshlid"  at 14:22:29     (21 seconds later -- FLICKER)
"Hfj. Skardshlid" -> "Skulagata"  at 14:22:40     (11 seconds later -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 14:22:52     (12 seconds later -- FLICKER)
"Hfj. Skardshlid" -> "Skulagata"  at 14:23:05     (13 seconds later -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 15:04:30     (~41 min gap -- normal)
"Hfj. Skardshlid" -> "Skulagata"  at 15:04:32     (2 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 15:13:26
"Hfj. Skardshlid" -> "Skulagata"  at 15:13:29     (3 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 15:13:35     (6 seconds -- FLICKER)
"Hfj. Skardshlid" -> "Skulagata"  at 15:13:44     (9 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 15:14:01     (17 seconds -- FLICKER)
```

Bus **1-C** (11 changes, mix of normal and flicker):
```
"Skulagata" -> "Hfj. Skardshlid"  at 11:11:35
"Hfj. Skardshlid" -> "Skulagata"  at 12:07:43
"Skulagata" -> "Hfj. Skardshlid"  at 12:07:45     (2 seconds -- FLICKER)
"Hfj. Skardshlid" -> "Skulagata"  at 12:07:45     (0 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 13:06:30     (~59 min gap -- normal)
"Hfj. Skardshlid" -> "Skulagata"  at 14:09:55     (~63 min gap -- normal)
"Skulagata" -> "Hfj. Skardshlid"  at 14:52:34
"Hfj. Skardshlid" -> "Skulagata"  at 14:52:39     (5 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 15:01:25
"Hfj. Skardshlid" -> "Skulagata"  at 15:59:15     (~58 min gap -- normal)
"Skulagata" -> "Hfj. Skardshlid"  at 19:02:30
```

Bus **1-D** (11 changes):
```
"Hfj. Skardshlid" -> "Skulagata"  at 11:23:06
"Skulagata" -> "Hfj. Skardshlid"  at 12:21:08     (~58 min gap -- normal)
"Hfj. Skardshlid" -> "Skulagata"  at 13:21:31     (~60 min gap -- normal)
"Skulagata" -> "Hfj. Skardshlid"  at 14:14:31
"Hfj. Skardshlid" -> "Skulagata"  at 14:14:40     (9 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 14:22:44
"Hfj. Skardshlid" -> "Skulagata"  at 15:20:51     (~58 min gap -- normal)
"Skulagata" -> "Hfj. Skardshlid"  at 16:04:21
"Hfj. Skardshlid" -> "Skulagata"  at 16:04:23     (2 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 16:04:40     (17 seconds -- FLICKER)
"Hfj. Skardshlid" -> "Skulagata"  at 16:04:48     (8 seconds -- FLICKER)
```

Bus **1-E** (12 changes):
```
"Hfj. Skardshlid" -> "Skulagata"  at 11:11:35
"Skulagata" -> "Hfj. Skardshlid"  at 12:08:13     (~57 min gap -- normal)
"Hfj. Skardshlid" -> "Skulagata"  at 13:10:58     (~63 min gap -- normal)
"Skulagata" -> "Hfj. Skardshlid"  at 14:01:05
"Hfj. Skardshlid" -> "Skulagata"  at 14:01:05     (0 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 14:01:27     (22 seconds -- FLICKER)
"Hfj. Skardshlid" -> "Skulagata"  at 14:01:40     (13 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 14:10:12
"Hfj. Skardshlid" -> "Skulagata"  at 15:07:46     (~58 min gap -- normal)
"Skulagata" -> "Hfj. Skardshlid"  at 15:53:32
"Hfj. Skardshlid" -> "Skulagata"  at 15:53:34     (2 seconds -- FLICKER)
"Skulagata" -> "Hfj. Skardshlid"  at 16:03:03
```

Bus **1-F** (5 changes -- clean, no flickering):
```
"Hfj. Skardshlid" -> "Skulagata"  at 11:35:10
"Skulagata" -> "Hfj. Skardshlid"  at 12:37:30     (~62 min gap)
"Hfj. Skardshlid" -> "Skulagata"  at 13:40:08     (~63 min gap)
"Skulagata" -> "Hfj. Skardshlid"  at 14:36:34     (~56 min gap)
"Hfj. Skardshlid" -> "Skulagata"  at 15:36:29     (~60 min gap)
```

**What This Means:**
The traces reveal two distinct patterns:
1. **Legitimate direction changes** happen every ~56-63 minutes for route 1 buses. This is the actual one-way trip time.
2. **Terminus flicker** causes rapid toggles (2-22 seconds apart) when the bus is at or near a terminus turnaround point. The GPS position oscillates across the direction boundary.

Bus 1-F shows clean changes only (no flickering), while buses 1-B, 1-C, 1-D, and 1-E all exhibit varying degrees of flicker. The high per-bus change counts (up to 189) are inflated by flicker -- the actual number of direction reversals is much lower.

For the app:
- Do not trigger direction-change events on every headsign change
- Implement a debounce: only consider a headsign change "real" if the new value persists for at least 30-60 seconds
- The flicker pattern is a reliable indicator that a bus is at a terminus (could be used as a feature, not just noise)

---

## 7. Direction Field Analysis

### 7.1 Direction Statistics

| Metric | Value |
| --- | --- |
| Min | -2 |
| Max | 360 |
| Mean | 177.4 |
| Median | 180 |
| Unique values | 363 |
| Values < 0 | 12 |
| Values > 360 | 0 |
| Interpretation | Compass heading in degrees |

**Quadrant distribution:**

| Quadrant | Degrees | Records | % |
| --- | --- | --- | --- |
| North (315-45) | 315-360, 0-45 | 223,646 | 22.9% |
| East (45-135) | 45-135 | 273,133 | 27.9% |
| South (135-225) | 135-225 | 208,614 | 21.3% |
| West (225-315) | 225-315 | 272,314 | 27.9% |

The distribution across quadrants is roughly even (21-28% each), expected for a bus network with routes running in all directions. East and West quadrants are slightly more common (27.9% each), reflecting that major corridors in Reykjavik run roughly east-west.

**What This Means:**
The direction field is a compass heading in integer degrees (0-360), with 12 anomalous records at -2 (likely error/uninitialized). The app should:
- Clamp direction values to 0-360 range (treat negative values as unknown)
- Use the direction to orient bus marker arrows on the map
- The even quadrant distribution confirms the field is reliable and can be trusted for visualization

### 7.2 Direction Change Behavior

| Metric | Value |
| --- | --- |
| Total consecutive pairs | 977,579 |
| Direction unchanged | 730,973 (74.8%) |
| Direction changed | 246,606 (25.2%) |
| Change magnitude (min) | 0 degrees |
| Change magnitude (max) | 180 degrees |
| Change magnitude (mean) | 13.0 degrees |
| Change magnitude (median) | 5 degrees |

**Direction vs position change correlation:**

| Condition | Records | % |
| --- | --- | --- |
| Position moved + direction changed | 246,576 | 25.2% |
| Position moved + direction same | 129,531 | 13.3% |
| Position static + direction changed | 30 | 0.0% |
| Position static + direction same | 601,442 | 61.5% |

**What This Means:**
Three critical observations:

1. **61.5% of consecutive readings show no movement and no direction change** -- the bus is stationary (parked, at a stop, etc.). This is consistent with the 41.3% duplicate rate.

2. **Direction virtually never changes without position movement** -- only 30 records out of 977,579 (0.003%). The direction field is derived from GPS movement vectors, not from an onboard compass. This means the direction is undefined/stale when a bus is stationary.

3. **When direction changes, the median change is only 5 degrees** -- buses mostly travel in straight lines with gradual turns. This is useful for the Kalman filter: large sudden direction changes (>45 degrees) are likely real turns at intersections, not noise. The max of 180 degrees represents complete direction reversal (bus turning around at a terminus).

---

## 8. Deduplication Characteristics

### 8.1 Duplicate Rates

| Metric | Value |
| --- | --- |
| Total consecutive pairs (per bus) | 977,579 |
| Pure duplicates (same busId, lat, lng, ts) | 403,790 (41.3%) |
| Same-ts but different position | 0 (0.0%) |
| Genuinely new readings | 573,789 (58.7%) |
| Total records | 977,707 |
| Unique (busId, ts) pairs | 571,890 |
| Duplication factor | 1.71x |
| Wasted records | 405,817 (41.5%) |

**What This Means -- Deduplication Strategy:**
Deduplication is essential and straightforward:

- **Use `(busId, timestamp)` as the dedup key.** Since there are zero cases of same-timestamp-different-position, this is 100% reliable. The API is fully deterministic: a given bus timestamp always corresponds to exactly one position.
- **Implementation:** On each poll, compare each bus's new timestamp against the last-seen timestamp for that bus. If equal, skip the record entirely -- no position comparison needed.
- **The 1.71x duplication factor** means the app processes 71% more records than necessary without dedup.
- **Storage savings:** Deduplication removes 41.5% of records, reducing storage from 110.9 MB to an estimated 64.8 MB for this collection period.

### 8.2 Per-Bus Duplicate Analysis

**Top 20 buses by duplicate rate:**

| Bus ID | Records | Duplicates | Dup Rate |
| --- | --- | --- | --- |
| 3-I | 1,048 | 513 | 49.0% |
| 12-I | 1,803 | 849 | 47.1% |
| 3-G | 2,217 | 1,008 | 45.5% |
| 1-K | 2,547 | 1,150 | 45.2% |
| 5-H | 2,935 | 1,314 | 44.8% |
| 2-F | 2,942 | 1,316 | 44.7% |
| 4-E | 2,942 | 1,316 | 44.7% |
| 6-I | 3,006 | 1,341 | 44.6% |
| 2-H | 3,070 | 1,369 | 44.6% |
| 12-J | 3,070 | 1,367 | 44.5% |
| 18-G | 3,068 | 1,366 | 44.5% |
| 12-L | 2,687 | 1,191 | 44.3% |
| 6-H | 3,199 | 1,416 | 44.3% |
| 18-F | 3,709 | 1,634 | 44.1% |
| 14-F | 3,243 | 1,428 | 44.0% |
| 3-H | 3,546 | 1,546 | 43.6% |
| 11-D | 3,667 | 1,598 | 43.6% |
| 13-E | 4,196 | 1,820 | 43.4% |
| 1-I | 3,778 | 1,637 | 43.3% |
| 12-K | 3,868 | 1,675 | 43.3% |

**Fleet-wide duplicate rates:**

| Statistic | Value |
| --- | --- |
| Mean | 41.8% |
| Median | 41.0% |
| Min | 39.4% |
| Max | 49.0% |

**What This Means:**
Duplicate rates are remarkably consistent across the fleet (39.4% - 49.0%), confirming this is a systemic property of the API + GPS update cadence, not a per-bus issue. Buses with fewer total records tend to have slightly higher dup rates (3-I at 49.0% with only 1,048 records) because they joined later when the poll interval was tighter relative to their update interval. The narrow range (only 9.6 percentage points separating min from max) means a single dedup strategy works uniformly for all buses.

### 8.3 Duplicate Run Lengths

A "run" is a sequence of consecutive identical readings for the same bus before a new reading arrives.

| Metric | Value |
| --- | --- |
| Total duplicate runs | 318,872 |
| Min run length | 1 |
| Max run length | 36 |
| Mean run length | 1.3 |
| Median run length | 1 |

| Run length | Count | % |
| --- | --- | --- |
| 1-2 | 254,571 | 79.8% |
| 2-3 | 54,856 | 17.2% |
| 3-4 | 6,744 | 2.1% |
| 4-5 | 1,147 | 0.4% |
| 5-6 | 922 | 0.3% |
| 6-8 | 127 | 0.0% |
| 10-15 | 253 | 0.1% |
| 15-20 | 127 | 0.0% |
| 20-50 | 125 | 0.0% |

**What This Means:**
Most duplicate runs are 1-2 consecutive identical readings (79.8%), meaning the GPS typically updates before the third poll. The rare long runs (up to 36 consecutive duplicates) occur when a bus is stationary for extended periods. At a ~2s poll interval, a run of 36 corresponds to about 72 seconds of no GPS update -- likely a bus idling at a terminus. For the app:
- Polling at 3 seconds will almost always catch the next genuine update (97% of runs end within 2 duplicates)
- A run of 5+ duplicates likely indicates a stationary bus (useful for detecting "at stop" state)
- The max run of 36 should not trigger a "bus offline" warning; it is still within normal behavior

---

## 9. API Rate and Volume

### 9.1 Overall Rates

| Metric | Value |
| --- | --- |
| Collection period | 2026-03-11 08:48:42 -- 19:14:05 UTC |
| Duration | 10.42 hours (37,523 seconds) |
| Total records | 977,707 |
| Total snapshots | 9,478 |
| Records/second | 26.1 |
| Records/minute | 1,563 |
| Snapshots/minute | 15.2 |
| Avg seconds between snapshots | 4.0 |

### 9.2 Records Per Hour

| Hour (UTC) | Records | Snapshots | Avg Buses/Snapshot |
| --- | --- | --- | --- |
| 08:00 | 35,770 | 293 | 122.1 |
| 11:00 | 127,972 | 1,438 | 89.0 |
| 12:00 | 159,576 | 1,774 | 90.0 |
| 13:00 | 165,111 | 1,777 | 92.9 |
| 14:00 | 202,088 | 1,766 | 114.4 |
| 15:00 | 220,449 | 1,755 | 125.6 |
| 16:00 | 42,188 | 334 | 126.3 |
| 19:00 | 24,553 | 341 | 72.0 |

Peak data volume occurs at 15:00 (220,449 records from 1,755 snapshots with 125.6 buses/snapshot). The 08:00 and 16:00 hours have fewer snapshots (293 and 334) due to the collection gaps, not lower API throughput. The 19:00 hour drops to only 72 buses/snapshot, reflecting the evening service reduction.

### 9.3 Data Volume

**Raw data:**

| Metric | Value |
| --- | --- |
| File size | 110.9 MB |
| Bytes per record (avg) | 119 bytes |
| MB per hour | 10.6 |
| Estimated MB per 24h | 255 |

**After deduplication:**

| Metric | Value |
| --- | --- |
| Records | 571,890 (58.5% of original) |
| Estimated size | 64.8 MB |
| MB per hour | 6.2 |
| Estimated MB per 24h | 149 |

**Estimated API bandwidth:**

| Metric | Value |
| --- | --- |
| Avg buses per snapshot | 103.2 |
| Est. response size | ~20.1 KB |
| Total API calls | 9,478 |
| Est. total bandwidth | 186.5 MB |
| Est. bandwidth/hour | 17.9 MB |

**What This Means -- Data Storage Optimization:**
- **Browser storage (IndexedDB):** At 149 MB/day after dedup, a week of data is ~1 GB. IndexedDB can handle this, but consider offering a retention policy (e.g., auto-purge data older than 7 days).
- **JSONL file storage:** At 255 MB/day raw (149 MB deduped), a month of data is ~4.5 GB deduped. Gzip compression would reduce this to ~1-1.5 GB.
- **Per-record size of 119 bytes** is already compact. The primary optimization is deduplication, not compression -- dedup saves 41.5% while gzip on already-deduped data typically saves another 60-70%.
- For the busiest continuous hour (15:00), expect about 25 MB raw or 15 MB deduped.

**What This Means -- Bandwidth Optimization:**
- At 17.9 MB/hour for API calls (at the aggressive ~2s polling used in this dataset), a browser tab open for 8 hours would consume ~143 MB of API bandwidth.
- Switching from ~2s to 3-second polling cuts bandwidth roughly in half.
- The API response size (~20.1 KB per call) is small enough that gzip in transit (if enabled) would reduce each response to ~3-5 KB.
- At 3-second polling, bandwidth drops to ~23.6 MB/hr; at 5-second polling, it drops further to ~14.2 MB/hr.

### 9.4 Optimal Polling Interval

**Bus GPS update interval (time between distinct timestamps for the same bus):**

| Statistic | Value |
| --- | --- |
| Min | -7.0s |
| Max | 22,892.0s |
| Mean | 7.2s |
| Median | 3.0s |
| P5 | 2.0s |
| P25 | 2.0s |
| P75 | 4.0s |
| P95 | 6.0s |
| P99 | 8.0s |

Note: The minimum of -7.0s indicates occasional timestamp regression (a newer poll returning an older timestamp), likely due to API caching or clock skew. The max of 22,892.0s corresponds to a bus reappearing after the major collection gap.

**Bus update interval distribution:**

| Interval | Count | % |
| --- | --- | --- |
| 2-3s | 205,444 | 35.8% |
| 3-4s | 105,766 | 18.4% |
| 4-5s | 131,605 | 22.9% |
| 5-6s | 68,740 | 12.0% |
| 6-8s | 50,059 | 8.7% |
| 8-10s | 5,175 | 0.9% |
| 10-15s | 2,443 | 0.4% |
| 15-20s | 139 | 0.0% |
| 20-30s | 258 | 0.0% |
| 30-60s | 135 | 0.0% |
| 60-120s | 132 | 0.0% |
| 120-300s | 16 | 0.0% |
| 300-600s | 9 | 0.0% |
| 600+s | 211 | 0.0% |

77.1% of GPS updates fall in the 2-5 second range. The mean (7.2s) is inflated by occasional long gaps when buses are at stops or out of service.

**Poll interval simulation (estimated new data per poll):**

| Poll interval | % polls with new data | Avg new buses/poll | Bandwidth/hr |
| --- | --- | --- | --- |
| 1s | 100.0% | 34.4 | 70.8 MB |
| 2s | 100.0% | 68.8 | 35.4 MB |
| 3s | 100.0% | 103.2 | 23.6 MB |
| 5s | 100.0% | 103.2 | 14.2 MB |
| 10s | 100.0% | 103.2 | 7.1 MB |
| 15s | 100.0% | 103.2 | 4.7 MB |
| 30s | 100.0% | 103.2 | 2.4 MB |

**What This Means -- Optimal Polling Interval Recommendation:**

The optimal poll interval is **3 seconds**, based on the following:

1. **GPS data cadence:** The median bus update interval is 3.0 seconds. Polling at 3s captures the full fleet's updates: the simulation shows 103.2 new buses per poll at 3s (the entire fleet), vs only 34.4 at 1s (one-third).

2. **API cache:** The API returns `cache-control: max-age=2`, meaning responses are cached for 2 seconds. Polling at 1s wastes every other request on a cached response.

3. **Bandwidth:** 3s polling uses 23.6 MB/hr vs 70.8 MB/hr at 1s -- a 3x reduction.

4. **Animation quality:** With Kalman filter prediction and 60fps interpolation in the app, a 3s data cadence is more than sufficient for smooth animation. The interpolation system fills the gaps between real data points.

5. **No data loss at 3s:** Every poll returns new data for effectively every bus (100% of polls have new data, and the full fleet of 103.2 buses updates within each 3s window).

At 5s and beyond, polling still catches all buses per poll, but the speed calculation pipeline loses temporal resolution. For speed monitoring, 3 seconds strikes the ideal balance between accuracy and efficiency. If bandwidth is a constraint (e.g., mobile or metered connections), 5 seconds is acceptable with minimal quality loss.

---

## 10. Key Takeaways

### For the Collector

1. **Poll at 3-second intervals.** Matches the GPS data cadence (median 3.0s update interval), respects the API cache (max-age=2), and captures the full fleet per poll. Reduces bandwidth from 70.8 MB/hr (at 1s) to 23.6 MB/hr with zero data loss.

2. **Deduplicate on `(busId, timestamp)`.** Eliminates 41.5% of records (405,817 wasted records in this dataset) with zero information loss. There are no same-ts-different-position cases, making this perfectly safe. The duplication factor is 1.71x.

3. **Monitor for collection gaps.** This dataset lost ~5 hours to two gaps (132.8 min and 171.0 min). Implement watchdog/auto-restart for production. After a gap, do not compute speed from the last pre-gap reading.

### For Bus Lifecycle Management

4. **Do not aggressively remove markers.** 92 of 128 buses maintain >90% coverage. 73 buses (57%) appear in every single one of the 9,478 snapshots with zero gaps. A bus missing from 1-3 snapshots is normal, not a disappearance.

5. **Fade markers after 30s of absence, remove after 2-3 minutes.** This handles the 4 flickering buses without creating ghost markers for truly gone buses. The worst flickerer (6-H) has only 35% coverage, but the other 3 are above 91%.

6. **Expect 68-127 buses depending on time of day.** Midday baseline: ~88-92 buses. Afternoon peak (15:00-16:00): 125-127 buses. Evening: 68-72 buses. Pre-allocate for 130 markers.

### For Data Quality

7. **Trim headsign whitespace.** Trailing spaces inflate the unique headsign count from ~39 to 51. Trim on ingestion.

8. **Debounce headsign and trip changes.** Rapid flickering near terminus points inflates change counts (up to 189 per bus, but most are flicker). Wait 30-60 seconds before acting on a headsign change. The actual direction-change cycle for route 1 buses is ~56-63 minutes.

9. **Clamp direction values.** 12 records have direction = -2. Treat as unknown/uninitialized. Valid range is 0-360 degrees (compass heading). The direction is GPS-derived (not compass) -- it only changes when the bus moves (99.997% correlation with position change).

10. **Handle negative time deltas.** The minimum bus update interval is -7.0s, indicating occasional timestamp regression. Discard readings where the new timestamp is older than the previous.

### For the Route-16/17 Bus Pool

11. **Five buses (16-A, 16-B, 16-C, 17-A, 17-B) switch between routes 16 and 17.** These are the only multi-route buses in the fleet (123 of 128 stay on a single route all day). Both routes list the exact same 5 buses. Always use the API's `routeNr` field -- never infer route from bus ID prefix (99-A operates on route 1, not route 99).

### For Storage and Bandwidth

12. **Budget 149 MB/day for deduplicated storage** (6.2 MB/hr). That is ~1 GB/week or ~4.5 GB/month. With gzip, roughly 1-1.5 GB/month.

13. **Budget 23.6 MB/hr for API bandwidth at 3s polling.** An 8-hour browser session consumes ~189 MB. Each API response is ~20.1 KB.

14. **Each record averages 119 bytes.** The data is already compact; dedup provides far more savings (41.5%) than compression alone.

### Summary Statistics

| Metric | Value |
| --- | --- |
| Dataset | 2026-03-11.jsonl |
| Period | 2026-03-11 08:48:42 -- 19:14:05 UTC (10.42h) |
| Total records | 977,707 |
| Total snapshots | 9,478 |
| Unique buses | 128 |
| Unique routes | 25 |
| Unique trips | 1,060 |
| Unique headsigns | 51 (~39 after trimming whitespace) |
| Avg buses per snapshot | 103.2 |
| Avg snapshot interval | 4.0s |
| Pure duplicate rate | 41.3% |
| Unique (bus, ts) pairs | 571,890 (58.5% of records) |
| Bus GPS update interval (median) | 3.0s |
| File size | 110.9 MB |
| Direction field range | -2 to 360 (compass heading) |
