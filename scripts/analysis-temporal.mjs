#!/usr/bin/env node
/**
 * Exhaustive temporal analysis of Straeto bus GPS telemetry data.
 * Analyzes: polling cadence, per-bus update frequency, stale readings,
 * time-of-day patterns, bus lifecycles, effective update rates, timestamp precision.
 */

import { readFileSync } from 'fs';

const DATASET = process.argv[2] || 'data/2026-03-11.jsonl';
const STALE_THRESHOLD_M = 0.5; // meters — positions within this are "same GPS fix"

// ── Utilities ─────────────────────────────────────────────────────────

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function percentiles(arr, pcts = [1, 5, 10, 25, 50, 75, 90, 95, 99]) {
  const sorted = [...arr].sort((a, b) => a - b);
  const result = {};
  for (const p of pcts) result[`P${p}`] = percentile(sorted, p);
  result.min = sorted[0];
  result.max = sorted[sorted.length - 1];
  result.mean = arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
  result.count = arr.length;
  return result;
}

function fmtNum(n, decimals = 1) {
  if (n == null || isNaN(n)) return 'N/A';
  return Number(n).toFixed(decimals);
}

function fmtPct(n, total) {
  if (total === 0) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

function epochToUTC(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

function epochToHour(ms) {
  return new Date(ms).getUTCHours();
}

function histogram(values, bucketEdges) {
  const counts = new Array(bucketEdges.length - 1).fill(0);
  for (const v of values) {
    for (let i = 0; i < bucketEdges.length - 1; i++) {
      if (v >= bucketEdges[i] && v < bucketEdges[i + 1]) {
        counts[i]++;
        break;
      }
    }
  }
  return counts;
}

// ── Load and parse ────────────────────────────────────────────────────

console.log(`Loading ${DATASET}...`);
const raw = readFileSync(DATASET, 'utf8');
const lines = raw.trim().split('\n');
console.log(`Total records: ${lines.length.toLocaleString()}`);

const records = [];
for (const line of lines) {
  const r = JSON.parse(line);
  records.push({
    busId: r.b,
    route: r.r,
    tripId: r.t,
    lat: r.la,
    lng: r.ln,
    dir: r.d,
    ts: r.ts,
    headsign: r.h,
  });
}

// ── Group by bus ──────────────────────────────────────────────────────

const byBus = new Map();
for (const rec of records) {
  if (!byBus.has(rec.busId)) byBus.set(rec.busId, []);
  byBus.get(rec.busId).push(rec);
}
for (const [, recs] of byBus) recs.sort((a, b) => a.ts - b.ts);

console.log(`Unique buses: ${byBus.size}`);

// ══════════════════════════════════════════════════════════════════════
// SECTION 1: API POLLING CADENCE
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 1: API POLLING CADENCE');
console.log('='.repeat(72));

// Collect all unique timestamps
const allTimestamps = new Set();
for (const rec of records) allTimestamps.add(rec.ts);
const sortedTimestamps = [...allTimestamps].sort((a, b) => a - b);

console.log(`\nUnique timestamps (global snapshots): ${sortedTimestamps.length.toLocaleString()}`);
console.log(`First: ${epochToUTC(sortedTimestamps[0])} (${sortedTimestamps[0]})`);
console.log(`Last:  ${epochToUTC(sortedTimestamps[sortedTimestamps.length - 1])} (${sortedTimestamps[sortedTimestamps.length - 1]})`);
const totalSpanS = (sortedTimestamps[sortedTimestamps.length - 1] - sortedTimestamps[0]) / 1000;
console.log(`Total span: ${fmtNum(totalSpanS, 0)}s = ${fmtNum(totalSpanS / 3600, 2)} hours`);

// Gaps between consecutive global snapshots
const snapshotGaps = [];
for (let i = 1; i < sortedTimestamps.length; i++) {
  snapshotGaps.push((sortedTimestamps[i] - sortedTimestamps[i - 1]) / 1000);
}

const snapshotGapStats = percentiles(snapshotGaps);
console.log(`\nSnapshot gap statistics (seconds):`);
for (const [k, v] of Object.entries(snapshotGapStats)) {
  console.log(`  ${k}: ${fmtNum(v, 2)}`);
}

// Histogram of snapshot gaps
const gapEdges = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 30, 60, 120, 300, 600, Infinity];
const gapHist = histogram(snapshotGaps, gapEdges);
console.log(`\nSnapshot gap distribution:`);
for (let i = 0; i < gapEdges.length - 1; i++) {
  const label =
    gapEdges[i + 1] === Infinity
      ? `>=${gapEdges[i]}s`
      : `${gapEdges[i]}-${gapEdges[i + 1]}s`;
  console.log(
    `  ${label.padEnd(12)} ${String(gapHist[i]).padStart(6)}  ${fmtPct(gapHist[i], snapshotGaps.length).padStart(7)}`
  );
}

// Records per snapshot
const recordsPerSnapshot = new Map();
for (const rec of records) {
  recordsPerSnapshot.set(rec.ts, (recordsPerSnapshot.get(rec.ts) || 0) + 1);
}
const rpsValues = [...recordsPerSnapshot.values()];
const rpsStats = percentiles(rpsValues);
console.log(`\nRecords per snapshot:`);
for (const [k, v] of Object.entries(rpsStats)) {
  console.log(`  ${k}: ${fmtNum(v, 1)}`);
}

// ── Timestamp modular analysis ────────────────────────────────────────

console.log(`\nTimestamp precision analysis:`);
const tsModulo1000 = sortedTimestamps.map((t) => t % 1000);
const uniqueSubSecond = new Set(tsModulo1000);
console.log(`  Unique sub-second values (ts % 1000): ${uniqueSubSecond.size}`);
console.log(`  Values: [${[...uniqueSubSecond].sort((a, b) => a - b).join(', ')}]`);

// Check if timestamps are always whole seconds
const nonWholeSeconds = sortedTimestamps.filter((t) => t % 1000 !== 0);
console.log(`  Timestamps not on whole seconds: ${nonWholeSeconds.length} / ${sortedTimestamps.length}`);

// Gap modular analysis (are gaps always multiples of some base interval?)
const gapMod2 = snapshotGaps.filter((g) => g % 2 === 0).length;
const gapMod3 = snapshotGaps.filter((g) => g % 3 === 0).length;
const gapMod5 = snapshotGaps.filter((g) => g % 5 === 0).length;
console.log(`  Gaps that are multiples of 2s: ${gapMod2} (${fmtPct(gapMod2, snapshotGaps.length)})`);
console.log(`  Gaps that are multiples of 3s: ${gapMod3} (${fmtPct(gapMod3, snapshotGaps.length)})`);
console.log(`  Gaps that are multiples of 5s: ${gapMod5} (${fmtPct(gapMod5, snapshotGaps.length)})`);

// ── Inter-snapshot timestamp regularity ───────────────────────────────

// Count exact gap values
const exactGapCounts = new Map();
for (const g of snapshotGaps) {
  exactGapCounts.set(g, (exactGapCounts.get(g) || 0) + 1);
}
const sortedExactGaps = [...exactGapCounts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\nTop 20 most common exact gap values (seconds):`);
for (const [gap, count] of sortedExactGaps.slice(0, 20)) {
  console.log(`  ${String(gap).padEnd(8)} ${String(count).padStart(6)} occurrences  ${fmtPct(count, snapshotGaps.length).padStart(7)}`);
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 2: PER-BUS UPDATE FREQUENCY
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 2: PER-BUS UPDATE FREQUENCY');
console.log('='.repeat(72));

const allBusGaps = []; // all consecutive record gaps per bus (in seconds)
const sameTs = []; // gaps that are 0 (same snapshot timestamp)
const staleGaps = []; // ts changed but position didn't
const genuineGaps = []; // both ts and position changed
const perBusUpdateStats = [];

for (const [busId, recs] of byBus) {
  if (recs.length < 2) continue;

  let busStale = 0;
  let busSameTs = 0;
  let busGenuine = 0;
  const busGenuineGaps = [];
  const busTotalGaps = [];

  for (let i = 1; i < recs.length; i++) {
    const prev = recs[i - 1];
    const curr = recs[i];
    const dtMs = curr.ts - prev.ts;
    const dtS = dtMs / 1000;
    const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);

    busTotalGaps.push(dtS);
    allBusGaps.push(dtS);

    if (dtMs === 0) {
      busSameTs++;
      sameTs.push(dtS);
    } else if (dist < STALE_THRESHOLD_M) {
      busStale++;
      staleGaps.push(dtS);
    } else {
      busGenuine++;
      genuineGaps.push(dtS);
      busGenuineGaps.push(dtS);
    }
  }

  const totalPairs = recs.length - 1;
  perBusUpdateStats.push({
    busId,
    totalRecords: recs.length,
    totalPairs,
    sameTs: busSameTs,
    stale: busStale,
    genuine: busGenuine,
    sameTsPct: (busSameTs / totalPairs) * 100,
    stalePct: (busStale / totalPairs) * 100,
    genuinePct: (busGenuine / totalPairs) * 100,
    genuineGapStats:
      busGenuineGaps.length > 0
        ? percentiles(busGenuineGaps, [25, 50, 75, 95])
        : null,
  });
}

const totalPairs = allBusGaps.length;
console.log(`\nTotal consecutive-record pairs: ${totalPairs.toLocaleString()}`);
console.log(`  Same-timestamp (duplicate in same poll): ${sameTs.length.toLocaleString()} (${fmtPct(sameTs.length, totalPairs)})`);
console.log(`  Stale (ts changed, position unchanged):  ${staleGaps.length.toLocaleString()} (${fmtPct(staleGaps.length, totalPairs)})`);
console.log(`  Genuine (ts and position both changed):  ${genuineGaps.length.toLocaleString()} (${fmtPct(genuineGaps.length, totalPairs)})`);

// All gaps distribution
console.log(`\nAll-gap statistics (seconds):`);
const allGapStats = percentiles(allBusGaps);
for (const [k, v] of Object.entries(allGapStats)) {
  console.log(`  ${k}: ${fmtNum(v, 2)}`);
}

// Stale gaps distribution
if (staleGaps.length > 0) {
  console.log(`\nStale-gap statistics (seconds):`);
  const staleStats = percentiles(staleGaps);
  for (const [k, v] of Object.entries(staleStats)) {
    console.log(`  ${k}: ${fmtNum(v, 2)}`);
  }
}

// Genuine gaps distribution
if (genuineGaps.length > 0) {
  console.log(`\nGenuine-update gap statistics (seconds):`);
  const genuineStats = percentiles(genuineGaps);
  for (const [k, v] of Object.entries(genuineStats)) {
    console.log(`  ${k}: ${fmtNum(v, 2)}`);
  }
}

// Per-bus summary table (sorted by genuine%)
perBusUpdateStats.sort((a, b) => a.genuinePct - b.genuinePct);
console.log(`\nPer-bus update breakdown (sorted by genuine %, all ${perBusUpdateStats.length} buses):`);
console.log('BusId      | Records | SameTs% | Stale%  | Genuine% | Genuine P50(s)');
console.log('-'.repeat(78));
for (const s of perBusUpdateStats) {
  const p50 = s.genuineGapStats ? fmtNum(s.genuineGapStats.P50, 1) : 'N/A';
  console.log(
    `${s.busId.padEnd(11)}| ${String(s.totalRecords).padStart(7)} | ${fmtNum(s.sameTsPct, 1).padStart(6)}% | ${fmtNum(s.stalePct, 1).padStart(6)}% | ${fmtNum(s.genuinePct, 1).padStart(7)}% | ${p50.padStart(10)}`
  );
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 3: STALE READING PATTERNS
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 3: STALE READING PATTERNS');
console.log('='.repeat(72));

// Stale run lengths (consecutive stale readings before a genuine update)
const allStaleRuns = [];
const staleRunsByRoute = new Map();
const staleRunsByBus = new Map();
const staleRateByHour = new Map(); // hour -> {total, stale}

for (const [busId, recs] of byBus) {
  if (recs.length < 2) continue;
  let currentRun = 0;

  for (let i = 1; i < recs.length; i++) {
    const prev = recs[i - 1];
    const curr = recs[i];
    const dtMs = curr.ts - prev.ts;
    const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
    const hour = epochToHour(curr.ts);

    // Hour tracking
    if (!staleRateByHour.has(hour)) staleRateByHour.set(hour, { total: 0, stale: 0 });
    const hourData = staleRateByHour.get(hour);
    hourData.total++;

    if (dtMs === 0) continue; // skip duplicate timestamps

    const isStale = dist < STALE_THRESHOLD_M;
    if (isStale) {
      hourData.stale++;
      currentRun++;
    } else {
      if (currentRun > 0) {
        allStaleRuns.push(currentRun);
        // Track by route
        const route = curr.route;
        if (!staleRunsByRoute.has(route)) staleRunsByRoute.set(route, []);
        staleRunsByRoute.get(route).push(currentRun);
        // Track by bus
        if (!staleRunsByBus.has(busId)) staleRunsByBus.set(busId, []);
        staleRunsByBus.get(busId).push(currentRun);
        currentRun = 0;
      }
    }
  }
  // Flush trailing run
  if (currentRun > 0) {
    allStaleRuns.push(currentRun);
    const lastRec = recs[recs.length - 1];
    const route = lastRec.route;
    if (!staleRunsByRoute.has(route)) staleRunsByRoute.set(route, []);
    staleRunsByRoute.get(route).push(currentRun);
    if (!staleRunsByBus.has(busId)) staleRunsByBus.set(busId, []);
    staleRunsByBus.get(busId).push(currentRun);
  }
}

// Overall stale reading percentage
const totalNonDup = staleGaps.length + genuineGaps.length;
console.log(`\nOverall stale rate (excluding same-ts duplicates): ${fmtPct(staleGaps.length, totalNonDup)}`);
console.log(`  Stale readings: ${staleGaps.length.toLocaleString()}`);
console.log(`  Genuine updates: ${genuineGaps.length.toLocaleString()}`);

// Stale run length distribution
if (allStaleRuns.length > 0) {
  console.log(`\nStale run length statistics:`);
  const runStats = percentiles(allStaleRuns);
  for (const [k, v] of Object.entries(runStats)) {
    console.log(`  ${k}: ${fmtNum(v, 1)}`);
  }

  const runEdges = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 100, 200, 500, Infinity];
  const runHist = histogram(allStaleRuns, runEdges);
  console.log(`\nStale run length distribution:`);
  for (let i = 0; i < runEdges.length - 1; i++) {
    const label =
      runEdges[i + 1] === Infinity
        ? `>=${runEdges[i]}`
        : `${runEdges[i]}-${runEdges[i + 1] - 1}`;
    console.log(
      `  ${label.padEnd(10)} ${String(runHist[i]).padStart(6)}  ${fmtPct(runHist[i], allStaleRuns.length).padStart(7)}`
    );
  }
}

// Stale rate by route
console.log(`\nStale rate by route:`);
const routeStaleRates = [];
for (const [busId, recs] of byBus) {
  // compute per-route stale rates
}
// Re-compute from per-bus data grouped by route
const routeStats = new Map();
for (const [busId, recs] of byBus) {
  if (recs.length < 2) continue;
  for (let i = 1; i < recs.length; i++) {
    const prev = recs[i - 1];
    const curr = recs[i];
    const dtMs = curr.ts - prev.ts;
    if (dtMs === 0) continue;
    const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
    const route = curr.route;
    if (!routeStats.has(route)) routeStats.set(route, { total: 0, stale: 0 });
    const rs = routeStats.get(route);
    rs.total++;
    if (dist < STALE_THRESHOLD_M) rs.stale++;
  }
}
const sortedRoutes = [...routeStats.entries()].sort(
  (a, b) => b[1].stale / b[1].total - a[1].stale / a[1].total
);
console.log('Route | Total    | Stale    | Stale%');
console.log('-'.repeat(50));
for (const [route, stats] of sortedRoutes) {
  console.log(
    `${route.padEnd(6)}| ${String(stats.total).padStart(8)} | ${String(stats.stale).padStart(8)} | ${fmtPct(stats.stale, stats.total).padStart(7)}`
  );
}

// Stale rate by hour
console.log(`\nStale rate by hour of day (UTC):`);
console.log('Hour | Total     | Stale     | Stale%');
console.log('-'.repeat(50));
const sortedHours = [...staleRateByHour.entries()].sort((a, b) => a[0] - b[0]);
for (const [hour, data] of sortedHours) {
  console.log(
    `${String(hour).padStart(4)} | ${String(data.total).padStart(9)} | ${String(data.stale).padStart(9)} | ${fmtPct(data.stale, data.total).padStart(7)}`
  );
}

// Buses that go dark for long periods
console.log(`\nBuses with long gaps (>5 minutes between consecutive records):`);
const busLongGaps = [];
for (const [busId, recs] of byBus) {
  if (recs.length < 2) continue;
  const gaps = [];
  for (let i = 1; i < recs.length; i++) {
    const dtS = (recs[i].ts - recs[i - 1].ts) / 1000;
    if (dtS > 300) {
      gaps.push({
        from: epochToUTC(recs[i - 1].ts),
        to: epochToUTC(recs[i].ts),
        durationMin: dtS / 60,
      });
    }
  }
  if (gaps.length > 0) {
    busLongGaps.push({ busId, gaps });
  }
}
busLongGaps.sort((a, b) => b.gaps.length - a.gaps.length);
console.log(`Buses with gaps >5min: ${busLongGaps.length} / ${byBus.size}`);
for (const { busId, gaps } of busLongGaps.slice(0, 30)) {
  console.log(`  ${busId}: ${gaps.length} gap(s)`);
  for (const g of gaps.slice(0, 5)) {
    console.log(`    ${g.from} -> ${g.to} (${fmtNum(g.durationMin, 1)} min)`);
  }
  if (gaps.length > 5) console.log(`    ... and ${gaps.length - 5} more`);
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 4: TIME-OF-DAY PATTERNS
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 4: TIME-OF-DAY PATTERNS');
console.log('='.repeat(72));

// Active buses per hour
const busesActiveByHour = new Map(); // hour -> Set of busIds
const snapshotsPerHour = new Map(); // hour -> count of snapshots
for (const rec of records) {
  const hour = epochToHour(rec.ts);
  if (!busesActiveByHour.has(hour)) busesActiveByHour.set(hour, new Set());
  busesActiveByHour.get(hour).add(rec.busId);
}
for (const ts of sortedTimestamps) {
  const hour = epochToHour(ts);
  snapshotsPerHour.set(hour, (snapshotsPerHour.get(hour) || 0) + 1);
}

console.log(`\nActive buses and snapshots per hour (UTC = Iceland time):`);
console.log('Hour | Buses | Snapshots | Records/Snapshot(avg)');
console.log('-'.repeat(55));
const hourlyRecordCounts = new Map();
for (const rec of records) {
  const hour = epochToHour(rec.ts);
  hourlyRecordCounts.set(hour, (hourlyRecordCounts.get(hour) || 0) + 1);
}
for (const hour of [...busesActiveByHour.keys()].sort((a, b) => a - b)) {
  const buses = busesActiveByHour.get(hour).size;
  const snaps = snapshotsPerHour.get(hour) || 0;
  const totalRecs = hourlyRecordCounts.get(hour) || 0;
  const avgPerSnap = snaps > 0 ? totalRecs / snaps : 0;
  console.log(
    `${String(hour).padStart(4)} | ${String(buses).padStart(5)} | ${String(snaps).padStart(9)} | ${fmtNum(avgPerSnap, 1).padStart(15)}`
  );
}

// Fleet size at 10-minute intervals
console.log(`\nFleet size at 10-minute intervals:`);
const bucketSize = 10 * 60 * 1000; // 10 min in ms
const firstTs = sortedTimestamps[0];
const lastTs = sortedTimestamps[sortedTimestamps.length - 1];
const busesPerBucket = new Map(); // bucketStart -> Set of busIds
for (const rec of records) {
  const bucket = Math.floor((rec.ts - firstTs) / bucketSize) * bucketSize + firstTs;
  if (!busesPerBucket.has(bucket)) busesPerBucket.set(bucket, new Set());
  busesPerBucket.get(bucket).add(rec.busId);
}
console.log('Time (UTC)              | Buses');
console.log('-'.repeat(40));
for (const [bucket, buses] of [...busesPerBucket.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`${epochToUTC(bucket)} | ${buses.size}`);
}

// When do buses start and stop?
console.log(`\nBus first/last appearance:`);
console.log('BusId      | First seen              | Last seen               | Duration(h)');
console.log('-'.repeat(85));
const busLifetimes = [];
for (const [busId, recs] of byBus) {
  const first = recs[0].ts;
  const last = recs[recs.length - 1].ts;
  const durationH = (last - first) / 3600000;
  busLifetimes.push({ busId, first, last, durationH, records: recs.length });
}
busLifetimes.sort((a, b) => a.first - b.first);
for (const bl of busLifetimes) {
  console.log(
    `${bl.busId.padEnd(11)}| ${epochToUTC(bl.first)} | ${epochToUTC(bl.last)} | ${fmtNum(bl.durationH, 2)}`
  );
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 5: BUS LIFECYCLE
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 5: BUS LIFECYCLE');
console.log('='.repeat(72));

// Duration distribution
const durations = busLifetimes.map((b) => b.durationH);
console.log(`\nBus active duration statistics (hours):`);
const durStats = percentiles(durations);
for (const [k, v] of Object.entries(durStats)) {
  console.log(`  ${k}: ${fmtNum(v, 2)}`);
}

// Route switching: does a bus appear on multiple routes?
console.log(`\nRoute switching analysis:`);
const busRoutes = new Map(); // busId -> Set of routes
const busTrips = new Map(); // busId -> Set of tripIds
for (const rec of records) {
  if (!busRoutes.has(rec.busId)) busRoutes.set(rec.busId, new Set());
  busRoutes.get(rec.busId).add(rec.route);
  if (!busTrips.has(rec.busId)) busTrips.set(rec.busId, new Set());
  busTrips.get(rec.busId).add(rec.tripId);
}

let multiRouteBuses = 0;
let multiTripBuses = 0;
const routeSwitchDetails = [];
for (const [busId, routes] of busRoutes) {
  if (routes.size > 1) {
    multiRouteBuses++;
    routeSwitchDetails.push({
      busId,
      routes: [...routes],
      trips: busTrips.get(busId).size,
    });
  }
  if (busTrips.get(busId).size > 1) multiTripBuses++;
}

console.log(`  Buses on single route: ${byBus.size - multiRouteBuses}`);
console.log(`  Buses on multiple routes: ${multiRouteBuses}`);
console.log(`  Buses with multiple trips: ${multiTripBuses}`);

if (routeSwitchDetails.length > 0) {
  routeSwitchDetails.sort((a, b) => b.routes.length - a.routes.length);
  console.log(`\n  Multi-route buses:`);
  for (const d of routeSwitchDetails.slice(0, 30)) {
    console.log(`    ${d.busId}: routes=[${d.routes.join(', ')}], trips=${d.trips}`);
  }
}

// Detailed route-switching timeline for multi-route buses
if (routeSwitchDetails.length > 0) {
  console.log(`\n  Route-switching timeline (top 10 multi-route buses):`);
  for (const d of routeSwitchDetails.slice(0, 10)) {
    const recs = byBus.get(d.busId);
    console.log(`\n    ${d.busId}:`);
    let prevRoute = null;
    let prevTrip = null;
    for (const rec of recs) {
      if (rec.route !== prevRoute || rec.tripId !== prevTrip) {
        console.log(
          `      ${epochToUTC(rec.ts)} route=${rec.route} trip=${rec.tripId} headsign="${rec.headsign}"`
        );
        prevRoute = rec.route;
        prevTrip = rec.tripId;
      }
    }
  }
}

// Gaps in individual bus timelines
console.log(`\nGap analysis per bus (gaps > 60s between consecutive records):`);
const busGapStats = [];
for (const [busId, recs] of byBus) {
  if (recs.length < 2) continue;
  const gaps = [];
  for (let i = 1; i < recs.length; i++) {
    const dtS = (recs[i].ts - recs[i - 1].ts) / 1000;
    if (dtS > 60) gaps.push(dtS);
  }
  busGapStats.push({
    busId,
    totalRecords: recs.length,
    gapsOver60s: gaps.length,
    maxGapS: gaps.length > 0 ? Math.max(...gaps) : 0,
    avgGapS: gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
  });
}
busGapStats.sort((a, b) => b.maxGapS - a.maxGapS);
console.log('BusId      | Records | Gaps>60s | MaxGap(s)  | AvgGap(s)');
console.log('-'.repeat(65));
for (const s of busGapStats.filter((b) => b.gapsOver60s > 0).slice(0, 30)) {
  console.log(
    `${s.busId.padEnd(11)}| ${String(s.totalRecords).padStart(7)} | ${String(s.gapsOver60s).padStart(8)} | ${fmtNum(s.maxGapS, 0).padStart(10)} | ${fmtNum(s.avgGapS, 0).padStart(9)}`
  );
}

// Buses overlapping on same route at same time
console.log(`\nBuses per route per snapshot (concurrent buses on same route):`);
const routeOverlap = new Map(); // route -> array of counts per snapshot
// Sample a few snapshots evenly
const sampleInterval = Math.max(1, Math.floor(sortedTimestamps.length / 50));
const sampledSnapshots = sortedTimestamps.filter((_, i) => i % sampleInterval === 0);

// Build snapshot -> route -> bus count from raw records
const snapshotRouteMap = new Map(); // ts -> Map<route, count>
for (const rec of records) {
  if (!snapshotRouteMap.has(rec.ts)) snapshotRouteMap.set(rec.ts, new Map());
  const routeMap = snapshotRouteMap.get(rec.ts);
  routeMap.set(rec.route, (routeMap.get(rec.route) || 0) + 1);
}

// Compute per-route statistics across all snapshots
const routeOverlapStats = new Map(); // route -> array of bus counts across snapshots
for (const [ts, routeMap] of snapshotRouteMap) {
  for (const [route, count] of routeMap) {
    if (!routeOverlapStats.has(route)) routeOverlapStats.set(route, []);
    routeOverlapStats.get(route).push(count);
  }
}

console.log('Route | Snapshots | Min | P25 | P50 | P75 | Max | Mean');
console.log('-'.repeat(65));
for (const [route, counts] of [...routeOverlapStats.entries()].sort(
  (a, b) => {
    const aM = a[1].reduce((x, y) => x + y, 0) / a[1].length;
    const bM = b[1].reduce((x, y) => x + y, 0) / b[1].length;
    return bM - aM;
  }
)) {
  const p = percentiles(counts, [25, 50, 75]);
  console.log(
    `${route.padEnd(6)}| ${String(counts.length).padStart(9)} | ${String(p.min).padStart(3)} | ${fmtNum(p.P25, 0).padStart(3)} | ${fmtNum(p.P50, 0).padStart(3)} | ${fmtNum(p.P75, 0).padStart(3)} | ${String(p.max).padStart(3)} | ${fmtNum(p.mean, 1).padStart(5)}`
  );
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 6: EFFECTIVE UPDATE RATE
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 6: EFFECTIVE UPDATE RATE (genuine position changes only)');
console.log('='.repeat(72));

// For each bus, compute gaps between consecutive GENUINE position updates
const allEffectiveGaps = [];
const perBusEffective = [];

for (const [busId, recs] of byBus) {
  if (recs.length < 2) continue;

  let lastRealTs = recs[0].ts;
  let lastRealLat = recs[0].lat;
  let lastRealLng = recs[0].lng;
  const busEffGaps = [];

  for (let i = 1; i < recs.length; i++) {
    const curr = recs[i];
    const dist = haversineM(lastRealLat, lastRealLng, curr.lat, curr.lng);

    if (dist >= STALE_THRESHOLD_M) {
      const gapS = (curr.ts - lastRealTs) / 1000;
      if (gapS > 0) {
        busEffGaps.push(gapS);
        allEffectiveGaps.push(gapS);
      }
      lastRealTs = curr.ts;
      lastRealLat = curr.lat;
      lastRealLng = curr.lng;
    }
  }

  if (busEffGaps.length > 0) {
    const stats = percentiles(busEffGaps, [25, 50, 75, 95, 99]);
    perBusEffective.push({ busId, ...stats });
  }
}

console.log(`\nFleet-wide effective update gap statistics (seconds):`);
const effStats = percentiles(allEffectiveGaps, [1, 5, 10, 25, 50, 75, 90, 95, 99]);
for (const [k, v] of Object.entries(effStats)) {
  console.log(`  ${k}: ${fmtNum(v, 2)}`);
}

// Histogram
const effEdges = [0, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 30, 60, 120, 300, 600, Infinity];
const effHist = histogram(allEffectiveGaps, effEdges);
console.log(`\nEffective update gap distribution:`);
for (let i = 0; i < effEdges.length - 1; i++) {
  const label =
    effEdges[i + 1] === Infinity
      ? `>=${effEdges[i]}s`
      : `${effEdges[i]}-${effEdges[i + 1]}s`;
  console.log(
    `  ${label.padEnd(12)} ${String(effHist[i]).padStart(7)}  ${fmtPct(effHist[i], allEffectiveGaps.length).padStart(7)}`
  );
}

// Per-bus effective rate table
perBusEffective.sort((a, b) => a.P50 - b.P50);
console.log(`\nPer-bus effective update rate (sorted by median gap):`);
console.log('BusId      | Count  | P25(s) | P50(s) | P75(s) | P95(s) | P99(s)');
console.log('-'.repeat(72));
for (const s of perBusEffective) {
  console.log(
    `${s.busId.padEnd(11)}| ${String(s.count).padStart(6)} | ${fmtNum(s.P25, 1).padStart(6)} | ${fmtNum(s.P50, 1).padStart(6)} | ${fmtNum(s.P75, 1).padStart(6)} | ${fmtNum(s.P95, 1).padStart(6)} | ${fmtNum(s.P99, 1).padStart(6)}`
  );
}

// ══════════════════════════════════════════════════════════════════════
// SECTION 7: TIMESTAMP PRECISION
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 7: TIMESTAMP PRECISION AND QUANTIZATION');
console.log('='.repeat(72));

// Analyze the last digits of timestamps
console.log(`\nTimestamp modular analysis (all records, n=${records.length.toLocaleString()}):`);

// Check sub-second resolution
const tsMod1000All = records.map((r) => r.ts % 1000);
const uniqueSubSecAll = new Set(tsMod1000All);
console.log(`  Unique (ts % 1000) values: ${uniqueSubSecAll.size}`);
if (uniqueSubSecAll.size <= 20) {
  console.log(`  Values: [${[...uniqueSubSecAll].sort((a, b) => a - b).join(', ')}]`);
}

// Check second-level quantization
const tsMod10s = records.map((r) => Math.floor(r.ts / 1000) % 10);
const tsMod10sCounts = new Map();
for (const v of tsMod10s) tsMod10sCounts.set(v, (tsMod10sCounts.get(v) || 0) + 1);
console.log(`\n  Distribution of (ts_seconds % 10):`);
for (const [digit, count] of [...tsMod10sCounts.entries()].sort((a, b) => a - b)) {
  console.log(`    ${digit}: ${count.toLocaleString()} (${fmtPct(count, records.length)})`);
}

// Check for per-bus clock drift
console.log(`\nPer-bus timestamp analysis:`);
const busTimestampStats = [];
for (const [busId, recs] of byBus) {
  if (recs.length < 10) continue;
  const subSecond = recs.map((r) => r.ts % 1000);
  const uniqueSS = new Set(subSecond);
  // Check gap regularity
  const gaps = [];
  for (let i = 1; i < recs.length; i++) {
    const g = recs[i].ts - recs[i - 1].ts;
    if (g > 0) gaps.push(g);
  }
  const gapMod = gaps.length > 0 ? gaps.map((g) => g % 1000) : [];
  const uniqueGapMod = new Set(gapMod);

  busTimestampStats.push({
    busId,
    uniqueSubSecond: uniqueSS.size,
    subSecondValues: [...uniqueSS].sort((a, b) => a - b),
    uniqueGapMod1000: uniqueGapMod.size,
  });
}

// Summarize
const allUniqueSSCounts = busTimestampStats.map((b) => b.uniqueSubSecond);
const ssCounts = new Map();
for (const c of allUniqueSSCounts) ssCounts.set(c, (ssCounts.get(c) || 0) + 1);
console.log(`  Distribution of unique sub-second values per bus:`);
for (const [count, buses] of [...ssCounts.entries()].sort((a, b) => a - b)) {
  console.log(`    ${count} unique sub-second values: ${buses} buses`);
}

// Check if all buses share same timestamps (i.e., the ts is from the collector, not from GPS)
console.log(`\nTimestamp source analysis:`);
console.log(`  If all buses in a snapshot share the same ts, the timestamp is from the collector poll, not from individual GPS units.`);
// Check a few snapshots
const checkSnapshots = sortedTimestamps.slice(0, 10);
let allShareTs = true;
for (const ts of checkSnapshots) {
  const busesInSnap = records.filter((r) => r.ts === ts);
  const uniqueTs = new Set(busesInSnap.map((r) => r.ts));
  if (uniqueTs.size > 1) {
    allShareTs = false;
    break;
  }
}
console.log(`  First 10 snapshots: all buses share same ts? ${allShareTs ? 'YES' : 'NO'}`);

// Now check across snapshots: do different buses have different ts in the same poll?
// (already answered above but let's verify with more depth)
// Check if the API field `lastUpdate` is being used as ts
// Look at cases where the same bus has the same ts in consecutive records
let sameTsCount = 0;
let diffTsCount = 0;
for (const [busId, recs] of byBus) {
  for (let i = 1; i < recs.length; i++) {
    if (recs[i].ts === recs[i - 1].ts) sameTsCount++;
    else diffTsCount++;
  }
}
console.log(`\n  Consecutive same-bus pairs with identical ts: ${sameTsCount.toLocaleString()}`);
console.log(`  Consecutive same-bus pairs with different ts: ${diffTsCount.toLocaleString()}`);
console.log(`  Ratio: ${fmtPct(sameTsCount, sameTsCount + diffTsCount)} have same ts`);

// Analyze: within each snapshot, are there multiple DIFFERENT ts values?
// (i.e., is this a per-bus lastUpdate or a single poll timestamp?)
console.log(`\nWithin-snapshot timestamp homogeneity:`);
// Group all records by their row-order "snapshot" (records with same ts)
// Actually, ts IS the grouping key. Let's check if within the same poll,
// buses could have different "lastUpdate" times.
// Better approach: look at the raw data ordering. Records appear in groups.
// Each group of consecutive records with same ts = one API poll response.
let currentTs = records[0].ts;
let currentGroup = [records[0]];
const snapshotSizes = [];
let prevGroupEndTs = null;
const pollingGaps = [];

for (let i = 1; i < records.length; i++) {
  if (records[i].ts === currentTs) {
    currentGroup.push(records[i]);
  } else {
    snapshotSizes.push(currentGroup.length);
    if (prevGroupEndTs !== null) {
      pollingGaps.push((currentTs - prevGroupEndTs) / 1000);
    }
    prevGroupEndTs = currentTs;
    currentTs = records[i].ts;
    currentGroup = [records[i]];
  }
}
snapshotSizes.push(currentGroup.length);

console.log(`  Total record groups (consecutive same-ts blocks): ${snapshotSizes.length.toLocaleString()}`);
console.log(`  This should equal unique timestamps: ${sortedTimestamps.length.toLocaleString()}`);

// ══════════════════════════════════════════════════════════════════════
// SECTION 8: SUMMARY OF KEY FINDINGS
// ══════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 8: SUMMARY OF KEY FINDINGS');
console.log('='.repeat(72));

console.log(`
Dataset: ${DATASET}
Records: ${records.length.toLocaleString()}
Time span: ${epochToUTC(sortedTimestamps[0])} to ${epochToUTC(sortedTimestamps[sortedTimestamps.length - 1])}
Duration: ${fmtNum(totalSpanS / 3600, 2)} hours
Unique buses: ${byBus.size}
Unique timestamps: ${sortedTimestamps.length.toLocaleString()}
Unique routes: ${new Set(records.map((r) => r.route)).size}

Polling cadence: median=${fmtNum(snapshotGapStats.P50, 1)}s, P95=${fmtNum(snapshotGapStats.P95, 1)}s
Records per snapshot: median=${fmtNum(rpsStats.P50, 0)}, mean=${fmtNum(rpsStats.mean, 1)}
Timestamp precision: always whole seconds? ${nonWholeSeconds.length === 0 ? 'YES' : 'NO'}

Reading classification (excluding same-ts):
  Stale: ${staleGaps.length.toLocaleString()} (${fmtPct(staleGaps.length, totalNonDup)})
  Genuine: ${genuineGaps.length.toLocaleString()} (${fmtPct(genuineGaps.length, totalNonDup)})

Effective update rate (genuine only): median=${fmtNum(effStats.P50, 1)}s, P95=${fmtNum(effStats.P95, 1)}s

Stale run lengths: median=${fmtNum(allStaleRuns.length > 0 ? percentile([...allStaleRuns].sort((a,b)=>a-b), 50) : 0, 1)}, max=${allStaleRuns.length > 0 ? Math.max(...allStaleRuns) : 0}

Bus duration: median=${fmtNum(durStats.P50, 2)}h, min=${fmtNum(durStats.min, 2)}h, max=${fmtNum(durStats.max, 2)}h
Multi-route buses: ${multiRouteBuses} / ${byBus.size}
Buses with gaps >5min: ${busLongGaps.length} / ${byBus.size}
`);

console.log('Analysis complete.');
