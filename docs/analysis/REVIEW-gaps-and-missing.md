# Gap Analysis: What the Five Analyses Missed

Adversarial review of documents 01 through 05 in `docs/analysis/`, cross-referenced against the raw data in `data/2026-03-11.jsonl` and `data/sample.jsonl`. Each gap below identifies an unasked question, an untested assumption, or a missing cross-correlation that matters for the correctness of the speed monitoring system.

Each gap is rated: **Critical** (blocks correctness of core feature), **Important** (recurring source of error or false results), or **Nice-to-have** (useful for robustness but not blocking).

---

## Gap 1: Speed Limit Matching Has Never Been Tested Against Real Data

**Rating: Critical**

**The problem.** The entire point of this project is to detect speed violations by comparing bus speed against road speed limits. The analyses recommend a 50m search radius, a 100m grid cache, and cross-track distance weighting -- but nobody has actually run the matching algorithm against the dataset. Zero bus positions have been matched to Borgarvefsja road segments. The speed limit GeoJSON exists at `static/speed_limits.geojson` (9,997 road segments), the bus GPS data exists at `data/2026-03-11.jsonl` (977,707 records), and neither has been joined to the other in any analysis.

**What we do not know:**

- What percentage of the 296,945 non-stale bus positions fall within 50m of a road segment? The analyses assume "buses drive on roads so they should always be within 50m" but never verified this. Depot parking lots, bus turnaround areas, and layover locations may not have road centerlines in the dataset.
- Are there geographic dead zones where the Borgarvefsja dataset has no coverage? The Borgarvefsja data covers Reykjavik municipality, but several routes (especially Route 1, 15, 24) extend into neighboring municipalities (Kopavogur, Hafnarfjordur, Mosfellsbaer). The `SVF` (municipality code) field in the GeoJSON could reveal coverage boundaries. Buses outside Reykjavik proper may consistently fail to match.
- When multiple road segments are within 50m, how often does the algorithm pick the wrong one? Parallel roads with different speed limits (e.g., a 50 km/h arterial next to a 30 km/h residential street) are common. The cross-track P95 of 13.1m from Analysis 8 in document 05 means 5% of positions could snap to the wrong parallel road.
- What is the distribution of matched speed limits across the fleet? If 80% of matches return 50 km/h and 15% return 30 km/h, that tells us the violation detection sensitivity profile. If the 30 km/h zones are in the dense urban core where GPS noise is highest, the false positive rate there will be much worse than in 50 km/h zones.
- How many buses spend time in areas with no road segment at all? If 5% of positions fall in zero-coverage areas, the 50 km/h fallback kicks in for thousands of readings per day. Is that fallback appropriate for all of those locations, or are some in 30 km/h or 80 km/h zones?

**Why it matters for algorithm design.** If the match failure rate is high (say, 10%+), the algorithm needs a smarter fallback than the hardcoded 50 km/h urban default. If parallel-road ambiguity is common, the matching algorithm needs to incorporate direction of travel to disambiguate. If certain routes systematically extend beyond the Borgarvefsja coverage area, the violation detector must suppress alerts in those zones rather than generating false positives against the fallback speed.

**What analysis would fill it.** A script that loads both datasets, runs a point-to-nearest-segment lookup for every non-stale bus position, and produces: (a) match rate by distance threshold (10m, 25m, 50m, 100m), (b) a map of unmatched positions colored by route, (c) distribution of matched speed limits, (d) cases where 2+ segments within 50m have different speed limits (ambiguity rate), (e) match rate broken down by route to identify routes with coverage gaps, and (f) the geographic extent of the Borgarvefsja data versus the bus network bounding box.

---

## Gap 2: Coordinate Quantization Was Identified But Not Fully Characterized

**Rating: Nice-to-have**

**The problem.** Document 02 found that 66% of coordinates have 13 decimal places with characteristic "333"/"667" trailing patterns, and that the smallest position increment is 1.6667e-8 degrees (1/60,000,000 of a degree). The document states this "strongly suggests" the API divides arc-minutes by some factor. Then the analysis stops. Nobody decoded the coordinate encoding scheme completely.

**What we do not know:**

- The exact encoding. The value 1/60,000,000 degree = 1/1,000,000 arc-minute. This is suspiciously round. Is the internal representation an integer count of micro-arc-minutes? If so, all coordinates should be exact multiples of 1.6667e-8 degrees. Does every coordinate in the dataset satisfy this, or only the 66% with 13 decimal places?
- Why 34% of coordinates do NOT show this pattern. The remaining coordinates have 1-8 decimal places. Are these from different GPS hardware models? Different firmware versions? Different buses? The document notes the distribution (e.g., 2.5% have 5 decimal places, 13.3% have 7, 14.1% have 8) but does not correlate decimal precision with bus ID, route, or time of day. If certain buses report at lower precision, their speed estimates will have higher quantization noise.
- Whether the mixed-precision coordinates affect speed limit matching. A coordinate with 4 decimal places (11.1m precision) is much coarser than one with 13 decimal places (sub-mm). If 2.5% of positions have 11m-class precision, they may snap to the wrong road segment for speed limit matching.
- Examining the raw data confirms the pattern: `64.0673487833333` contains the "833333" suffix typical of x/6 division, while `64.1234432` has only 7 significant decimal places with no "333"/"667" pattern. Both appear on buses from the same timestamp, so the mixed precision is not time-dependent -- it may be per-bus or per-GPS-fix.

**Why it matters for algorithm design.** The quantization itself is well below the noise floor (0.002m vs 0.64m GPS noise) and is practically irrelevant. However, the 2.5% of positions at 4 decimal places (11m precision) could affect speed limit matching in ambiguous zones, and correlating precision with bus ID could reveal which buses have different GPS hardware and might need different noise parameters.

**What analysis would fill it.** For every coordinate in the dataset, compute `lat * 60,000,000` and check whether the result is an integer (within floating-point tolerance). Correlate decimal place count with bus ID to determine if it is a hardware property. Compute speed separately for the 66% high-precision readings and the 34% lower-precision readings and compare error distributions.

---

## Gap 3: Trip Transition Behavior Was Not Examined

**Rating: Important**

**The problem.** Document 04 identifies 1,933 trip ID changes across 126 buses (an average of one change every 20 minutes per bus). It notes that one bus has 190 changes (once every 1.6 minutes). The analysis does not examine what happens to GPS data quality during these transitions.

**What we do not know:**

- Does the bus position teleport when the trip ID changes? If a bus ends a trip at a terminus and starts a new trip at the same terminus, the position should be continuous. But if the API reassigns the bus to a new trip at a distant starting point before the bus physically moves there, the position could jump. This would generate a false speed anomaly.
- Does the headsign change before, during, or after the trip ID change? Document 04 identifies 2,072 headsign changes. Are these correlated in time with the 1,933 trip changes? A headsign that changes 30 seconds before the trip ID would suggest the bus is already at the new terminus updating its display. A headsign that flickers simultaneously with the trip ID suggests an API-level transition event.
- Does the direction field (bearing) flip during trip transitions? If a bus finishes a route going east and starts the return journey going west, there should be a 180-degree direction change near the terminus. Is this visible in the data? Is it smooth or instantaneous?
- What happens to the bus's route number during transitions? The 5 buses that switch between routes 16 and 17 are documented, but the transition mechanism is not. Does route 16 become route 17 instantaneously, or is there a gap where the bus disappears from both routes?
- The bus with 190 trip changes in 5 hours -- is this real behavior (a shuttle on a 1.6-minute loop) or API flicker? If it is flicker, each "trip change" could reset the Kalman filter unnecessarily, degrading speed estimation for that bus.

**Why it matters for algorithm design.** The current algorithm uses bus ID as the primary state key, which is correct. But if trip transitions are used as Kalman filter reset triggers (which is a common design choice), and 190 trip changes per bus per day are flicker rather than real transitions, the filter is being reset 190 times unnecessarily. Each reset produces a warm-up period with degraded accuracy (see Gap 9). Trip transitions also affect how the speed pipeline handles the transition moment itself: if the bus "teleports" from one end of a route to the other, the speed calculator will produce a single enormous speed reading unless it specifically guards against trip-change teleportation.

**What analysis would fill it.** For each of the 1,933 trip ID changes: extract the position, speed, headsign, direction, and route number in a window of +/- 30 seconds around the change. Compute the position delta at the moment of change. Histogram these deltas. Identify cases where the position jumps >100m at a trip change (indicating teleportation). Cross-reference headsign changes and direction flips with trip changes to build a complete picture of the transition event.

---

## Gap 4: Stationary Episodes Were Not Correlated with Known Bus Stops

**Rating: Important**

**The problem.** Document 02 identifies 3,572 stationary episodes (20+ fixes within 5m) and lists "favorite positions" visited by buses repeatedly. Document 03 identifies 12,093 bus stops using a speed-based detector (speed < 5 km/h for 15+ seconds). Neither analysis cross-references these positions with actual Straeto bus stop locations.

**Why this matters:**

- If the "favorite positions" match known bus stops, it validates both the bus stop locations and the stationarity detection algorithm.
- If many stationary episodes occur at locations that are not bus stops, those are layover points, depots, traffic signals, or GPS dead zones. Each has different implications for speed calculation: a bus at a depot should be excluded from speed violation detection entirely; a bus at a red light should not be.
- The stop detection threshold (15 seconds, 5 km/h) from document 03 was tuned without reference to real stop locations. It detects 12,093 events. If Straeto publishes 800 bus stops and each is visited by 5 buses in 10 hours, the expected count is ~40,000 stop events (assuming 1 stop per bus per stop per trip, 8 trips per bus). The 12,093 count is suspiciously low, or the threshold is too restrictive, or not all stops are visited, or the effective collection window is too short.
- Straeto publishes GTFS data. Bus stop coordinates are public. The correlation analysis is straightforward.

**Why it matters for algorithm design.** Knowing that a bus is at a bus stop vs. at a traffic light vs. at a depot changes how the speed pipeline should treat the stationarity period. Stops have predictable dwell times (15-60s); depot stays last hours; traffic lights last 30-90s. The Kalman filter's velocity decay during stationarity should be tuned differently for each case. Additionally, if depot locations are identified, buses at depots can be excluded from the active fleet count and violation statistics.

**What analysis would fill it.** Download Straeto's GTFS stop locations. For each stationary episode and each "favorite position," measure the distance to the nearest known bus stop. Report: (a) percentage of stationary episodes within 25m of a known stop, (b) known stops that were never visited in the data (route coverage gaps), (c) stationary episodes far from any stop (depot candidates), and (d) average dwell time at stops vs. non-stop stationary locations.

---

## Gap 5: Route-Specific GPS Characteristics Were Not Compared

**Rating: Important**

**The problem.** Document 02 provides per-route bounding boxes, distance statistics, and zero-distance percentages. Document 03 provides per-route speed breakdowns. But no analysis compares the actual GPS data quality characteristics across routes -- noise levels, stale rates, anomaly rates, and update intervals -- to determine whether different routes need different algorithm parameters.

**What we do not know:**

- Do urban routes (e.g., Route 13 with a 15.6 km^2 bbox, dense downtown coverage) have different GPS noise from suburban routes (e.g., Route 15 with 80.2 km^2 bbox extending to Mosfellsbaer, or Route 24 at 109.3 km^2 reaching south to Alftanes)?
- The stale rate ranges from 32.4% (Route 7) to 68.1% (Route 31), a 2x difference. Is this because Route 31 buses have worse GPS hardware, or because Route 31 passes through areas with poor cellular connectivity (which would delay GPS position updates from the bus to the API)?
- Document 02 shows Route 7 has the highest P50 distance (54.1m) and Route 13 the lowest (30.3m). This could mean Route 7 buses travel faster, or that Route 7 has longer genuine update intervals (producing bigger displacements per update). Without separating speed from update interval, we cannot tell.
- Routes 35 and 36 overlap 96.7% geographically and each have only 1 bus. Are their GPS characteristics identical? If so, this serves as a natural control -- same road, different bus, same or different GPS behavior.
- Route 1 spans 12.27 km north-south and reaches the southern fringe of the network (Hafnarfjordur). Does its GPS noise profile change between the urban core and the southern suburbs? Satellite geometry is the same (negligible change over 12 km), but urban canyon effects should differ.

**Why it matters for algorithm design.** If GPS noise is route-dependent, a single set of Kalman filter parameters may be suboptimal. Routes through open suburban areas with low noise could use tighter parameters (higher Kalman gain), while routes through dense areas might need more smoothing. At minimum, the analysis would confirm whether a single parameter set is adequate or whether per-route tuning is warranted.

**What analysis would fill it.** For each route, compute: (a) GPS noise sigma from stationary episodes on that route, (b) median and P90 update intervals (real, not raw), (c) anomaly rate (>120 km/h readings per 1000 readings), (d) large-jump rate, and (e) lateral deviation from 3-point line fit at different speed bands. Compare these metrics across routes using statistical tests. If the variation is within 20-30%, a single parameter set suffices. If any route is 2x or more different, it needs special handling.

---

## Gap 6: Time-of-Day Effects on GPS Accuracy Were Not Analyzed

**Rating: Nice-to-have**

**The problem.** Document 01 shows stale rates vary by hour (21.4% at 16:00 vs 32.6% at 19:00). Document 03 shows speed anomaly rates by hour. But no analysis examines whether GPS accuracy itself (noise sigma, lateral deviation, jump rate) varies throughout the day.

**What we do not know:**

- Does GPS noise increase in the early morning or late evening when satellite geometry may be less favorable? At 64 degrees N latitude, GPS DOP (Dilution of Precision) follows a predictable daily cycle as the satellite constellation rotates. If DOP spikes at certain times, GPS position errors will spike proportionally.
- Does the number of anomalous readings (>120 km/h) correlate with time of day independently of traffic patterns? Document 03 Section 3.5 shows anomalies by hour, but this mixes two effects: more buses on the road (more opportunities for anomalies) and potentially worse GPS conditions. A per-bus, per-hour anomaly rate would separate these.
- The dataset only covers 08:48-19:14 with two large gaps. The effective windows are roughly 08:48-08:58, 11:11-16:11, and 19:02-19:14. This gives us midday through early afternoon in detail but nothing for dawn, dusk, or nighttime. Weather effects (March fog, low sun angle) cannot be assessed from a single day.
- The stale rate at hour 8 is 25.3%, at hour 15 it is 22.7%, and at hour 19 it is 32.6%. The evening increase could be fewer active buses (more parked buses reporting stale positions) or worse cellular connectivity during evening hours.

**Why it matters for algorithm design.** If GPS noise has a predictable daily cycle, the Kalman filter's measurement noise parameter could be made time-adaptive. This is likely overkill for the current system, but knowing the magnitude of time-of-day variation would set bounds on how much accuracy fluctuates. If the variation is less than 30%, fixed parameters are fine. If GPS noise doubles at certain times, the violation threshold should be widened during those periods.

**What analysis would fill it.** Segment the dataset by hour. For each hour, compute: (a) per-bus GPS noise sigma from stationary episodes within that hour, (b) per-bus anomaly rate, (c) median lateral deviation. Compare across hours. This requires a longer dataset (full 06:00-00:00 operating day) to be meaningful; the current 5-hour midday window is too narrow.

---

## Gap 7: Dataset Scope -- Single Weekday, Partial Day

**Rating: Important**

**The problem.** All five analyses are built on one dataset: 2026-03-11 (Wednesday), 08:48-19:14 UTC, with two gaps totaling ~5 hours. Effective continuous coverage is roughly 11:11-16:11 (5 hours). The analyses acknowledge this in passing but do not systematically enumerate what questions the limited dataset cannot answer.

**What we cannot answer with this data:**

- **Weekend behavior.** Straeto runs reduced schedules on weekends. The fleet may shrink to 30-40 buses. Routes change. Speed patterns will differ (less traffic, potentially higher speeds). The GPS update cadence, stale rate, and noise characteristics might also differ if different buses are deployed.
- **Early morning / late night.** The dataset starts at 08:48 and the active window begins at 11:11. The 06:00-08:00 morning rush is completely missing. The 20:00-00:00 evening period has only 12 minutes of data at 19:02-19:14. Violation patterns during these periods are unknown.
- **Seasonal variation.** March in Iceland is late winter. Daylight is approximately 07:00-19:00. GPS accuracy can vary with atmospheric conditions (ionospheric delay correlates with season and solar activity). Summer driving patterns may differ substantially.
- **Weather effects.** One day cannot capture the effect of rain, snow, or ice on bus speeds and GPS quality. Snow coverage affects ground reflections which affect multipath GPS error.
- **Fleet turnover.** Are the same 128 buses deployed every day? If the fleet rotates, the GPS hardware characteristics identified for specific buses (e.g., Bus 31-B's anomalous jump rate, Bus 99-A's zero-jitter stationarity) may not be stable across days.
- **API behavior changes.** The staleness distribution, caching behavior, and timestamp quantization observed are a snapshot of the API at one point in time. The API could change its caching strategy, polling rate, or coordinate precision at any time.
- **Statistical reliability of per-route metrics.** Routes 8, 22, 23, 35, and 36 each have only 1 bus. The per-route statistics for these routes are per-bus statistics. Any conclusion about these "routes" is actually a conclusion about one vehicle on one day.

**Why it matters for algorithm design.** All parameter recommendations (sigma_gps=1.3m, sigma_a=1.7 m/s^2, stationarity threshold=3m, etc.) are point estimates from a single day. They have no confidence intervals. If the true sigma_gps varies between 0.8m and 2.5m across days and conditions, the "optimal" value of 1.3m is only optimal for Wednesday March 11th. The algorithm should be designed to be robust across a range of parameters, not tuned precisely for one day's data.

**What analysis would fill it.** Collect data for at least one full week (Monday through Sunday), covering the full operating day (06:00-00:00). Compare weekday vs. weekend patterns. Verify that per-bus GPS characteristics are stable across days. Compute confidence intervals on all metrics rather than point estimates from a single day.

---

## Gap 8: Direction Field Correlation With Travel Bearing Was Not Fully Exploited

**Rating: Nice-to-have**

**The problem.** Document 02 (Section 5) provides an excellent analysis of the direction field: it is integer-only, accurate to 2 degrees median error for moves >5m, and unreliable during large jumps. However, the analysis stops at "use it for marker rotation." Several deeper questions that matter for speed limit matching and route validation were not asked.

**What we do not know:**

- Can the direction field disambiguate parallel roads for speed limit matching? When a bus is within 50m of two road segments with different speed limits, the direction field (accurate to 2 degrees median for moves >5m) could resolve which road the bus is actually on, since parallel roads in opposite directions have headings ~180 degrees apart. This was suggested in document 05 ("weight matches by perpendicular distance rather than point-to-point distance") but not tested.
- Is the direction field derived from GPS heading or computed from consecutive positions? Document 02 Section 5.3 shows that direction "virtually never changes without position movement" (only 30 out of 977,579 records). This strongly suggests it is derived from GPS course-over-ground (COG), not from an onboard compass. But COG is undefined at low speeds and unreliable during GPS glitches. The 30 exceptions (direction change without position change) may reveal hardware differences.
- Does the direction field lag behind actual turns? If direction is computed from the GPS receiver's COG, it reflects the average heading over some internal smoothing window. During a sharp turn, the direction might lag by 2-3 seconds. This matters for animation (the marker should turn when the bus turns, not 3 seconds later) and for speed limit matching at intersections where the speed limit changes.
- Document 02 found that bearing error spikes for >200m jumps (P90 of 116.6 degrees). Can this be used as a teleportation detector? A bearing error >90 degrees with a position jump >200m is a near-certain GPS glitch. Adding direction consistency to the outlier detection rules could improve precision beyond the speed-only approach.

**Why it matters for algorithm design.** The direction field is a free signal that the analyses mostly treat as a display property. Using it for speed limit matching disambiguation could significantly reduce wrong-road matches in areas with parallel roads. Using it for teleportation detection could improve the outlier rejection pipeline.

**What analysis would fill it.** At locations where 2+ road segments are within 50m with different speed limits, test whether the direction field correctly identifies which road the bus is on. Measure the direction lag during turns by comparing direction changes to position-derived bearing changes with sub-second resolution. Check whether direction > 90 degrees off from position-derived bearing is a better teleportation detector than speed alone.

---

## Gap 9: Correlated GPS Errors Between Co-Located Buses Were Not Investigated

**Rating: Important**

**The problem.** The analyses treat each bus's GPS error as independent. But GPS errors are dominated by satellite geometry and atmospheric delay, which are the same for all receivers at the same location. If two buses are 20 meters apart at a bus stop, they see the same satellites and experience the same ionospheric delay. Their GPS errors should be highly correlated.

**Why this matters:**

- **False violation correlation.** If GPS noise causes Bus A to overestimate speed by 8 km/h in a 50 km/h zone, Bus B next to it probably also overestimates by a similar amount. This means multiple simultaneous "violations" at the same location are likely a single correlated noise event, not multiple buses independently speeding. The violation detection system should discount simultaneous violations at the same location.
- **Validation opportunity.** Correlated errors between co-located buses can be used to estimate the common-mode GPS error. If buses A and B are both at (64.1097, -21.8425) and report positions that are 1.2m apart, the common-mode error is at least the mean of their offsets from the true position. Differencing their positions gives the uncorrelated (receiver-specific) noise component.
- **Speed limit matching implications.** If correlated GPS bias shifts all buses at a location 10m east, all of them will match to the same (possibly wrong) road segment. Independent per-bus errors would average out in aggregate statistics; correlated errors will not.
- **The data supports this analysis.** Document 02 (Section 8.4) found 195 positions where multiple distinct buses report the same exact coordinates. Document 02 (Section 6.3) shows that the top density grid cell has 9 routes converging. At major stops like Mjodd and Hlemmur, there are frequently 5-10 buses within a 100m radius simultaneously.

**Why it matters for algorithm design.** If errors are correlated, the violation detection system should apply a location-based debounce: if 3 buses at the same stop all show violations in the same 10-second window, that is 1 GPS event, not 3 violations. Without this, violation counts at major hubs like Mjodd and Hlemmur will be systematically inflated. The per-route statistics also become less reliable because buses on overlapping routes at the same location experience the same noise -- you cannot treat per-route speed metrics as independent samples at those locations.

**What analysis would fill it.** Identify time windows where 2+ buses are within 50m of each other (use the high-density grid cells as candidates). For each co-located pair, compute: (a) the position difference between them (inter-bus distance), (b) whether their speed anomalies are correlated (do both buses report >90 km/h in the same snapshot?), (c) whether their position errors relative to the road centerline are in the same direction (correlated) or opposite directions (independent). Compare the observed inter-bus position variance against the per-bus noise variance from document 02 (0.64m RMS). If inter-bus variance is significantly less than 2x per-bus variance, the errors are correlated.

---

## Gap 10: Systematic Missing Data Patterns Were Not Analyzed

**Rating: Important**

**The problem.** Document 01 identifies two collector-side gaps (09:00-11:11 and 16:12-19:02) and notes per-bus gaps >5 minutes for 126 of 128 buses. Document 04 examines bus appearance/disappearance and fleet size over time. But neither document analyzes whether data gaps are systematically correlated with specific routes, geographic areas, or operational patterns.

**What we do not know:**

- **Route-level gaps.** Do all routes have roughly equal coverage, or are some routes consistently under-represented? Route 8 has only 9,127 records from 1 bus, while Route 1 has 96,315 records from 12 buses. This is partly fleet allocation, but is there also differential dropout? If Route 8's single bus goes offline for 30 minutes, there is zero data for that route. For Route 1 with 12 buses, losing one bus still leaves 11 others.
- **Geographic gaps.** Are there areas of the bus network where GPS signal is consistently lost? Route 15 extends to Mosfellsbaer (15.25 km E-W span), which includes a segment through the Mosfellsdalur valley. Valley terrain could cause GPS signal loss. Similarly, Route 24 extends south to Alftanes peninsula. Do these suburban/rural extremes have higher data gap rates than the urban core?
- **Time-correlated dropouts.** Beyond the two collector-side gaps, do individual buses systematically drop out at certain times? The fleet drops from 127 at 15:58 to 74 at 18:58. Is this a uniform reduction (all routes lose some buses), or do certain routes disappear entirely while others continue at full strength?
- **Correlation between bus ID and dropout.** Document 01 notes that Bus 99-A is stationary with 100% stale readings for the entire day. Document 04 identifies buses with anomalously high staleness (12-I at 12.0s average). Are there buses that systematically appear for only part of the day? The lifecycle analysis shows 5 buses with short durations (0.72 to 2.38 hours), but this is conflated with the collector gaps. On a full-day collection, the dropout pattern could be very different.

**Why it matters for algorithm design.** If certain routes or areas have systematic gaps, speed violation statistics for those routes will be biased. A route that loses GPS signal in a high-speed zone will undercount violations there. A route that drops out during the evening rush misses the period when violations may be most common. The algorithm should flag routes/areas with low data quality rather than reporting confident statistics from sparse data. The UI should indicate data coverage quality on the map so users do not assume absence of violations means absence of speeding.

**What analysis would fill it.** For each route, compute: (a) total active time vs. theoretical operating time (from GTFS schedule), (b) number and duration of gaps >30 seconds, (c) geographic distribution of the last GPS position before each gap (are buses "disappearing" at specific locations?). For the fleet as a whole, compute the per-minute active bus count per route and look for systematic time-of-day patterns beyond the collector gaps.

---

## Supplementary Gaps (From Existing Analysis)

The following two gaps were identified in the previous version of this review. They are not in the user's primary gap list but remain important.

### Supplementary A: Speed Estimation Error at Different Update Rates Was Not Tested

**Rating: Important**

Analysis 5 in document 05 evaluates the current Kalman pipeline's speed estimation error and finds a 20.2% overestimate rate. Analysis 7 evaluates optimal polling intervals for data efficiency. But nobody tested how speed estimation accuracy changes as a function of the effective GPS update interval. The recommendation to increase polling from 2s to 3s is based on data efficiency (20% vs. 14.1% useful rate) but not on its impact on speed accuracy. The 0.95 conservative speed factor was tuned (implicitly) for the current ~5s effective update rate. If the effective rate changes, the factor needs re-tuning.

### Supplementary B: Kalman Filter Warm-Up Behavior Is Uncharacterized

**Rating: Important**

The Kalman filter must initialize when a bus first appears or reappears after a gap. Document 04 shows 1,933 trip changes and 924 large jumps (which trigger resets) -- approximately 2,857 filter reset events per day across 128 buses, or ~22 resets per bus per day. Each reset is followed by a warm-up period of 3-5 readings (15-25 seconds). Over a 10-hour day, each bus spends approximately 8-9 minutes in a warm-up state (~1.5% of operating time). No analysis examines whether warm-up periods contribute disproportionately to the 20.2% overestimate rate identified in Analysis 5.

---

## Summary: Priority Ranking

| Priority | Gap | Risk if Unfilled |
|---|---|---|
| **Critical** | Gap 1 (Speed limit matching untested) | The core feature may not work. Could have massive match failure rate outside Reykjavik, systematic wrong-road matches, or unknown coverage holes. |
| **Important** | Gap 3 (Trip transitions) | Trip changes happen every 20 minutes per bus. If they produce position jumps or data quality drops, this is a recurring source of false anomalies that compounds with Kalman warm-up. |
| **Important** | Gap 4 (Bus stop correlation) | Affects accuracy of stop detection and the ability to exclude depot/layover time from speed violation analysis. |
| **Important** | Gap 5 (Route-specific GPS patterns) | If GPS noise varies 2x+ across routes, a single parameter set is suboptimal. Routes through suburban corridors may behave fundamentally differently from urban core routes. |
| **Important** | Gap 7 (Single-day dataset) | All parameter recommendations are point estimates from one Wednesday. No confidence intervals, no weekend data, no early-morning or late-night coverage. |
| **Important** | Gap 9 (Correlated multi-bus errors) | Simultaneous violations at bus hubs may be correlated GPS events, inflating violation counts at Mjodd, Hlemmur, and other high-density locations. |
| **Important** | Gap 10 (Missing data patterns) | Route-specific and area-specific gaps bias violation statistics. Some routes may appear clean simply because they lack data during high-speed periods. |
| **Important** | Supp. A (Speed error vs update rate) | The polling interval recommendation is based on efficiency, not accuracy. Changing the rate will change accuracy in unknown ways. |
| **Important** | Supp. B (Kalman warm-up) | 1.5% of operating time is in warm-up. If warm-up produces systematic overestimates, it inflates the already-problematic 20.2% overestimate rate. |
| **Nice-to-have** | Gap 2 (Coordinate quantization) | Quantization is below the noise floor, so its practical impact is minimal. But the mixed-precision issue (2.5% of readings at 11m accuracy) could affect speed limit matching edge cases. |
| **Nice-to-have** | Gap 6 (Time-of-day GPS effects) | Likely a small effect in this dataset, but cannot be confirmed without a full-day collection. Would set bounds on parameter stability. |
| **Nice-to-have** | Gap 8 (Direction field exploitation) | The direction field is an unused signal for speed limit matching disambiguation and teleportation detection. Low risk if unused, moderate benefit if exploited. |

---

*Review conducted 2026-03-12 against analysis documents 01-05, data/sample.jsonl, data/2026-03-11.jsonl, static/speed_limits.geojson, and CLAUDE.md project specification.*
