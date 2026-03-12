#!/usr/bin/env node
/**
 * Comprehensive Straeto GraphQL API Behavior Analysis.
 * Analyzes the full-day dataset to understand API response patterns,
 * bus lifecycle, data staleness, deduplication, and volume characteristics.
 */

import { readFileSync } from 'fs';

const DATASET = '/Users/snaeji/development/git/straeto_speedometer/data/2026-03-11.jsonl';

// ─── Helpers ──────────────────────────────────────────────────────────

function percentile(sorted, p) {
	if (sorted.length === 0) return NaN;
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(arr) {
	if (arr.length === 0) return { min: NaN, max: NaN, mean: NaN, median: NaN, p5: NaN, p25: NaN, p75: NaN, p95: NaN, p99: NaN, std: NaN };
	const sorted = [...arr].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	const mean = sum / sorted.length;
	const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / sorted.length;
	return {
		min: sorted[0],
		max: sorted[sorted.length - 1],
		mean,
		median: percentile(sorted, 50),
		p5: percentile(sorted, 5),
		p25: percentile(sorted, 25),
		p75: percentile(sorted, 75),
		p95: percentile(sorted, 95),
		p99: percentile(sorted, 99),
		std: Math.sqrt(variance),
		count: sorted.length,
	};
}

function fmtN(n) {
	return n.toLocaleString('en-US');
}

function fmtF(n, d = 2) {
	return Number(n).toFixed(d);
}

function tsToISO(ts) {
	return new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function tsToTime(ts) {
	return new Date(ts).toISOString().slice(11, 19);
}

function histogram(arr, buckets) {
	const result = [];
	for (let i = 0; i < buckets.length - 1; i++) {
		const lo = buckets[i];
		const hi = buckets[i + 1];
		const count = arr.filter(v => v >= lo && v < hi).length;
		result.push({ lo, hi, count, pct: arr.length > 0 ? (count / arr.length * 100) : 0 });
	}
	return result;
}

// ─── Load Data ────────────────────────────────────────────────────────

console.log('Loading dataset...');
const rawLines = readFileSync(DATASET, 'utf8').trim().split('\n');
console.log(`Loaded ${fmtN(rawLines.length)} lines.`);

const records = [];
for (const line of rawLines) {
	const r = JSON.parse(line);
	records.push(r);
}

console.log(`Parsed ${fmtN(records.length)} records.\n`);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: SNAPSHOT ANALYSIS
// ═══════════════════════════════════════════════════════════════════════
console.log('══════════════════════════════════════════════════════════');
console.log(' SECTION 1: SNAPSHOT ANALYSIS');
console.log('══════════════════════════════════════════════════════════');

// Each "snapshot" = a group of records that were returned together in one API poll.
// Since the collector writes them sequentially, records from the same poll share
// the same approximate file position. But we need a way to group them.
//
// Strategy: Records are written line-by-line per poll. Consecutive records with
// the same set of timestamps likely came from the same API response. However,
// the bus timestamps (ts) are from the bus GPS, not the poll time.
//
// Better approach: group by looking at the sequence. The collector writes
// all buses from one poll, then all buses from the next. We can detect
// snapshot boundaries by looking for when bus IDs repeat (a bus appearing
// again means we've started a new snapshot).

// Build snapshots by detecting boundaries
const snapshots = [];
let currentSnapshot = [];
const seenInCurrent = new Set();

for (const r of records) {
	if (seenInCurrent.has(r.b)) {
		// This bus was already in the current snapshot; start a new one
		snapshots.push(currentSnapshot);
		currentSnapshot = [r];
		seenInCurrent.clear();
		seenInCurrent.add(r.b);
	} else {
		currentSnapshot.push(r);
		seenInCurrent.add(r.b);
	}
}
if (currentSnapshot.length > 0) snapshots.push(currentSnapshot);

console.log(`Total snapshots detected: ${fmtN(snapshots.length)}`);
console.log(`Total records: ${fmtN(records.length)}`);
console.log(`Records per snapshot: avg=${fmtF(records.length / snapshots.length, 1)}`);

// Snapshot sizes
const snapshotSizes = snapshots.map(s => s.length);
const sizeStats = stats(snapshotSizes);
console.log(`\nSnapshot size (buses per response):`);
console.log(`  Min: ${sizeStats.min}, Max: ${sizeStats.max}`);
console.log(`  Mean: ${fmtF(sizeStats.mean, 1)}, Median: ${fmtF(sizeStats.median, 1)}`);
console.log(`  P5: ${fmtF(sizeStats.p5, 1)}, P25: ${fmtF(sizeStats.p25, 1)}, P75: ${fmtF(sizeStats.p75, 1)}, P95: ${fmtF(sizeStats.p95, 1)}`);
console.log(`  Std: ${fmtF(sizeStats.std, 1)}`);

const sizeBuckets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 200];
const sizeHist = histogram(snapshotSizes, sizeBuckets);
console.log(`\nSnapshot size distribution:`);
for (const h of sizeHist) {
	if (h.count > 0) console.log(`  ${h.lo}-${h.hi}: ${fmtN(h.count)} (${fmtF(h.pct, 1)}%)`);
}

// Assign approximate "poll time" to each snapshot.
// Use the maximum bus timestamp in the snapshot as a proxy for the poll time.
const snapshotTimes = snapshots.map(s => {
	const maxTs = Math.max(...s.map(r => r.ts));
	const minTs = Math.min(...s.map(r => r.ts));
	return { maxTs, minTs, size: s.length, records: s };
});

// Time gaps between consecutive snapshots
const snapshotGaps = [];
for (let i = 1; i < snapshotTimes.length; i++) {
	const gap = (snapshotTimes[i].maxTs - snapshotTimes[i - 1].maxTs) / 1000;
	snapshotGaps.push(gap);
}

const gapStats = stats(snapshotGaps);
console.log(`\nTime gaps between consecutive snapshots (seconds):`);
console.log(`  Min: ${fmtF(gapStats.min, 1)}, Max: ${fmtF(gapStats.max, 1)}`);
console.log(`  Mean: ${fmtF(gapStats.mean, 1)}, Median: ${fmtF(gapStats.median, 1)}`);
console.log(`  P5: ${fmtF(gapStats.p5, 1)}, P25: ${fmtF(gapStats.p25, 1)}, P75: ${fmtF(gapStats.p75, 1)}, P95: ${fmtF(gapStats.p95, 1)}, P99: ${fmtF(gapStats.p99, 1)}`);

const gapBuckets = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 60, 120, 300, 600, Infinity];
const gapHist = histogram(snapshotGaps, gapBuckets);
console.log(`\nSnapshot gap distribution:`);
for (const h of gapHist) {
	if (h.count > 0) console.log(`  ${h.lo}-${h.hi === Infinity ? 'inf' : h.hi}s: ${fmtN(h.count)} (${fmtF(h.pct, 1)}%)`);
}

// First and last snapshot time
const firstPollTime = snapshotTimes[0].maxTs;
const lastPollTime = snapshotTimes[snapshotTimes.length - 1].maxTs;
console.log(`\nFirst snapshot: ${tsToISO(firstPollTime)}`);
console.log(`Last snapshot:  ${tsToISO(lastPollTime)}`);
console.log(`Collection duration: ${fmtF((lastPollTime - firstPollTime) / 3600000, 2)} hours`);

// Large gaps (> 30s) - interruptions
const largeGaps = [];
for (let i = 0; i < snapshotGaps.length; i++) {
	if (snapshotGaps[i] > 30) {
		largeGaps.push({
			idx: i,
			gap: snapshotGaps[i],
			from: tsToISO(snapshotTimes[i].maxTs),
			to: tsToISO(snapshotTimes[i + 1].maxTs),
		});
	}
}
console.log(`\nCollection gaps > 30s: ${largeGaps.length}`);
for (const g of largeGaps.slice(0, 20)) {
	console.log(`  ${g.from} -> ${g.to} (${fmtF(g.gap, 0)}s = ${fmtF(g.gap / 60, 1)}min)`);
}


// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: BUS APPEARANCE / DISAPPEARANCE
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' SECTION 2: BUS APPEARANCE / DISAPPEARANCE');
console.log('══════════════════════════════════════════════════════════');

// Track per-bus: first/last appearance, total records, snapshot count
const busLifecycle = new Map(); // busId -> { first, last, count, snapshotIdxs }

for (let si = 0; si < snapshots.length; si++) {
	for (const r of snapshots[si]) {
		if (!busLifecycle.has(r.b)) {
			busLifecycle.set(r.b, { first: si, last: si, count: 1, snapshotIdxs: new Set([si]) });
		} else {
			const bl = busLifecycle.get(r.b);
			bl.last = si;
			bl.count++;
			bl.snapshotIdxs.add(si);
		}
	}
}

const totalSnapshots = snapshots.length;
console.log(`Total unique bus IDs: ${busLifecycle.size}`);

// For each bus, compute span (first to last) and coverage (snapshots present / span)
const busStats = [];
for (const [busId, bl] of busLifecycle) {
	const span = bl.last - bl.first + 1;
	const coverage = bl.snapshotIdxs.size / span;
	const gaps = []; // gaps in snapshot presence
	let gapStart = null;
	for (let si = bl.first; si <= bl.last; si++) {
		if (!bl.snapshotIdxs.has(si)) {
			if (gapStart === null) gapStart = si;
		} else {
			if (gapStart !== null) {
				gaps.push(si - gapStart);
				gapStart = null;
			}
		}
	}
	if (gapStart !== null) gaps.push(bl.last - gapStart + 1);

	busStats.push({
		busId,
		firstSnap: bl.first,
		lastSnap: bl.last,
		span,
		presentIn: bl.snapshotIdxs.size,
		totalRecords: bl.count,
		coverage,
		gapCount: gaps.length,
		maxGap: gaps.length > 0 ? Math.max(...gaps) : 0,
		firstTime: snapshotTimes[bl.first].maxTs,
		lastTime: snapshotTimes[bl.last].maxTs,
	});
}

busStats.sort((a, b) => b.totalRecords - a.totalRecords);

console.log(`\nBus lifecycle overview (top 30 by record count):`);
console.log('BusId      | Records | First Time          | Last Time           | Span(snaps) | Present | Coverage | Gaps | MaxGap');
for (const bs of busStats.slice(0, 30)) {
	console.log(`${bs.busId.padEnd(11)}| ${String(bs.totalRecords).padEnd(8)}| ${tsToTime(bs.firstTime)} | ${tsToTime(bs.lastTime)} | ${String(bs.span).padEnd(12)}| ${String(bs.presentIn).padEnd(8)}| ${fmtF(bs.coverage * 100, 1).padStart(5)}% | ${String(bs.gapCount).padEnd(5)}| ${bs.maxGap}`);
}

// Coverage distribution
const coverages = busStats.map(b => b.coverage * 100);
const covStats = stats(coverages);
console.log(`\nBus coverage (% of snapshots within span where bus appears):`);
console.log(`  Mean: ${fmtF(covStats.mean, 1)}%, Median: ${fmtF(covStats.median, 1)}%`);
console.log(`  Min: ${fmtF(covStats.min, 1)}%, Max: ${fmtF(covStats.max, 1)}%`);

const covBuckets = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100.1];
const covHist = histogram(coverages, covBuckets);
console.log(`\nCoverage distribution:`);
for (const h of covHist) {
	if (h.count > 0) console.log(`  ${h.lo}-${h.hi > 100 ? '100' : h.hi}%: ${h.count} buses (${fmtF(h.pct, 1)}%)`);
}

// Bus count over time (by snapshot)
// Sample at regular intervals to keep output manageable
console.log(`\nBus count over time (sampled every 100 snapshots):`);
console.log('Snapshot# | Time     | #Buses');
for (let i = 0; i < snapshots.length; i += Math.max(1, Math.floor(snapshots.length / 50))) {
	console.log(`${String(i).padEnd(10)}| ${tsToTime(snapshotTimes[i].maxTs)} | ${snapshots[i].length}`);
}

// Flickering buses: buses that appear, disappear, reappear
const flickerBuses = busStats.filter(b => b.gapCount > 5 && b.coverage < 0.95);
console.log(`\nFlickering buses (>5 gaps, <95% coverage): ${flickerBuses.length}`);
for (const fb of flickerBuses.slice(0, 15)) {
	console.log(`  ${fb.busId}: ${fb.gapCount} gaps, maxGap=${fb.maxGap} snapshots, coverage=${fmtF(fb.coverage * 100, 1)}%`);
}

// Stable core fleet: buses present in >90% of snapshots in their span
const stableFleet = busStats.filter(b => b.coverage > 0.9 && b.span > totalSnapshots * 0.1);
console.log(`\nStable core fleet (>90% coverage, span >10% of day): ${stableFleet.length} buses`);

// Transient buses: short-lived
const transientBuses = busStats.filter(b => b.span < totalSnapshots * 0.05);
console.log(`Transient buses (span <5% of day): ${transientBuses.length} buses`);


// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: TIMESTAMP BEHAVIOR / STALENESS
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' SECTION 3: TIMESTAMP / STALENESS ANALYSIS');
console.log('══════════════════════════════════════════════════════════');

// For each snapshot, compute staleness of each bus: snapshot_poll_time - bus_ts
// We approximate poll time as the max bus ts in that snapshot.
const allStaleness = [];
const perBusStaleness = new Map();

for (let si = 0; si < snapshots.length; si++) {
	const snap = snapshots[si];
	const pollTime = snapshotTimes[si].maxTs;

	for (const r of snap) {
		const stale = (pollTime - r.ts) / 1000; // seconds
		allStaleness.push(stale);
		if (!perBusStaleness.has(r.b)) perBusStaleness.set(r.b, []);
		perBusStaleness.get(r.b).push(stale);
	}
}

const staleStats = stats(allStaleness);
console.log(`Staleness (poll_time - bus_ts) across all records:`);
console.log(`  Min: ${fmtF(staleStats.min, 1)}s, Max: ${fmtF(staleStats.max, 1)}s`);
console.log(`  Mean: ${fmtF(staleStats.mean, 1)}s, Median: ${fmtF(staleStats.median, 1)}s`);
console.log(`  P5: ${fmtF(staleStats.p5, 1)}s, P25: ${fmtF(staleStats.p25, 1)}s, P75: ${fmtF(staleStats.p75, 1)}s, P95: ${fmtF(staleStats.p95, 1)}s, P99: ${fmtF(staleStats.p99, 1)}s`);

const staleBuckets = [0, 1, 2, 3, 4, 5, 10, 15, 20, 30, 60, 120, 300, 600, Infinity];
const staleHist = histogram(allStaleness, staleBuckets);
console.log(`\nStaleness distribution:`);
for (const h of staleHist) {
	if (h.count > 0) console.log(`  ${h.lo}-${h.hi === Infinity ? 'inf' : h.hi}s: ${fmtN(h.count)} (${fmtF(h.pct, 1)}%)`);
}

// Percentage with 0 staleness (freshest possible)
const zeroStale = allStaleness.filter(s => s === 0).length;
console.log(`\nRecords with 0 staleness (freshest bus in snapshot): ${fmtN(zeroStale)} (${fmtF(zeroStale / allStaleness.length * 100, 1)}%)`);

// Per-bus average staleness
console.log(`\nPer-bus average staleness (top 20 stalest):`);
const busAvgStale = [];
for (const [busId, stales] of perBusStaleness) {
	const avg = stales.reduce((a, b) => a + b, 0) / stales.length;
	busAvgStale.push({ busId, avg, count: stales.length });
}
busAvgStale.sort((a, b) => b.avg - a.avg);
console.log('BusId      | AvgStale(s) | Records');
for (const bs of busAvgStale.slice(0, 20)) {
	console.log(`${bs.busId.padEnd(11)}| ${fmtF(bs.avg, 1).padStart(10)}  | ${bs.count}`);
}

// Do all buses in a snapshot share the same ts? Or are they heterogeneous?
console.log(`\nTimestamp homogeneity within snapshots:`);
const uniqueTsPerSnapshot = snapshots.map(s => new Set(s.map(r => r.ts)).size);
const utsStats = stats(uniqueTsPerSnapshot);
console.log(`  Unique bus timestamps per snapshot: min=${utsStats.min}, max=${utsStats.max}, mean=${fmtF(utsStats.mean, 1)}, median=${fmtF(utsStats.median, 0)}`);

// How many snapshots have all buses with the same timestamp?
const homogeneous = uniqueTsPerSnapshot.filter(u => u === 1).length;
console.log(`  Snapshots where all buses share one timestamp: ${fmtN(homogeneous)} (${fmtF(homogeneous / snapshots.length * 100, 1)}%)`);

// Distribution of unique ts counts
const utsBuckets = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 50, 100, Infinity];
const utsHist = histogram(uniqueTsPerSnapshot, utsBuckets);
console.log(`\nUnique-ts-per-snapshot distribution:`);
for (const h of utsHist) {
	if (h.count > 0) console.log(`  ${h.lo}-${h.hi === Infinity ? 'inf' : h.hi}: ${fmtN(h.count)} (${fmtF(h.pct, 1)}%)`);
}


// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: BUS ID / TRIP ID / ROUTE BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' SECTION 4: BUS ID / TRIP ID / ROUTE BEHAVIOR');
console.log('══════════════════════════════════════════════════════════');

// Unique counts
const allBusIds = new Set(records.map(r => r.b));
const allTripIds = new Set(records.map(r => r.t));
const allRoutes = new Set(records.map(r => r.r));
console.log(`Unique bus IDs: ${allBusIds.size}`);
console.log(`Unique trip IDs: ${allTripIds.size}`);
console.log(`Unique routes: ${allRoutes.size}`);

// Bus ID format analysis
console.log(`\nBus ID format analysis:`);
const busIdFormats = new Map();
for (const bid of allBusIds) {
	const match = bid.match(/^(\d+)-([A-Z]+)$/);
	if (match) {
		const numPart = match[1];
		const letterPart = match[2];
		const fmt = `<number>-<letter>`;
		if (!busIdFormats.has(fmt)) busIdFormats.set(fmt, []);
		busIdFormats.get(fmt).push(bid);
	} else {
		if (!busIdFormats.has('other')) busIdFormats.set('other', []);
		busIdFormats.get('other').push(bid);
	}
}
for (const [fmt, ids] of busIdFormats) {
	console.log(`  Format "${fmt}": ${ids.length} bus IDs`);
	if (ids.length <= 10) console.log(`    IDs: ${ids.join(', ')}`);
}

// Bus ID prefix (number before dash) vs route
console.log(`\nBus ID prefix vs route:`);
const prefixRoutes = new Map();
for (const r of records) {
	const prefix = r.b.split('-')[0];
	const key = prefix;
	if (!prefixRoutes.has(key)) prefixRoutes.set(key, new Set());
	prefixRoutes.get(key).add(r.r);
}

// Check if prefix always matches route
let prefixMatchesRoute = 0;
let prefixDiffers = 0;
for (const [prefix, routes] of prefixRoutes) {
	if (routes.size === 1 && routes.has(prefix)) {
		prefixMatchesRoute++;
	} else {
		prefixDiffers++;
		console.log(`  Prefix ${prefix} -> routes: ${[...routes].join(', ')}`);
	}
}
console.log(`  Prefixes that always match route: ${prefixMatchesRoute}`);
console.log(`  Prefixes with different routes: ${prefixDiffers}`);

// Trips per bus
console.log(`\nTrips per bus:`);
const tripsPerBus = new Map();
for (const r of records) {
	if (!tripsPerBus.has(r.b)) tripsPerBus.set(r.b, new Set());
	tripsPerBus.get(r.b).add(r.t);
}
const tripCounts = [...tripsPerBus.values()].map(s => s.size);
const tripCountStats = stats(tripCounts);
console.log(`  Min trips: ${tripCountStats.min}, Max: ${tripCountStats.max}, Mean: ${fmtF(tripCountStats.mean, 1)}, Median: ${fmtF(tripCountStats.median, 0)}`);

const tripBuckets = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 50, Infinity];
const tripHist = histogram(tripCounts, tripBuckets);
console.log(`\nTrips-per-bus distribution:`);
for (const h of tripHist) {
	if (h.count > 0) console.log(`  ${h.lo}-${h.hi === Infinity ? 'inf' : h.hi}: ${h.count} buses (${fmtF(h.pct, 1)}%)`);
}

// Trip ID changes - when do they happen?
console.log(`\nTrip ID change analysis:`);
// Group records by bus, sorted by snapshot order
const busTripChanges = new Map(); // busId -> [{snapIdx, oldTrip, newTrip}]
const busRecordsBySnap = new Map(); // busId -> [{snapIdx, record}]

for (let si = 0; si < snapshots.length; si++) {
	for (const r of snapshots[si]) {
		if (!busRecordsBySnap.has(r.b)) busRecordsBySnap.set(r.b, []);
		busRecordsBySnap.get(r.b).push({ si, r });
	}
}

let totalTripChanges = 0;
for (const [busId, recs] of busRecordsBySnap) {
	recs.sort((a, b) => a.si - b.si);
	const changes = [];
	for (let i = 1; i < recs.length; i++) {
		if (recs[i].r.t !== recs[i - 1].r.t) {
			changes.push({
				snapIdx: recs[i].si,
				oldTrip: recs[i - 1].r.t,
				newTrip: recs[i].r.t,
				time: snapshotTimes[recs[i].si].maxTs,
			});
		}
	}
	if (changes.length > 0) {
		busTripChanges.set(busId, changes);
		totalTripChanges += changes.length;
	}
}

console.log(`  Total trip ID changes across all buses: ${totalTripChanges}`);
console.log(`  Buses with trip changes: ${busTripChanges.size}`);
const changesPerBus = [...busTripChanges.values()].map(c => c.length);
if (changesPerBus.length > 0) {
	const cpbStats = stats(changesPerBus);
	console.log(`  Changes per bus: min=${cpbStats.min}, max=${cpbStats.max}, mean=${fmtF(cpbStats.mean, 1)}, median=${fmtF(cpbStats.median, 0)}`);
}

// Route switching: does a bus ID ever appear on a different route?
console.log(`\nRoute switching analysis:`);
const routesPerBus = new Map();
for (const r of records) {
	if (!routesPerBus.has(r.b)) routesPerBus.set(r.b, new Set());
	routesPerBus.get(r.b).add(r.r);
}
const multiRouteBuses = [...routesPerBus.entries()].filter(([, routes]) => routes.size > 1);
console.log(`  Buses always on one route: ${routesPerBus.size - multiRouteBuses.length}`);
console.log(`  Buses on multiple routes: ${multiRouteBuses.length}`);
for (const [busId, routes] of multiRouteBuses.slice(0, 20)) {
	console.log(`    ${busId}: routes ${[...routes].join(', ')}`);
}

// Buses per route
console.log(`\nBuses per route:`);
const busesPerRoute = new Map();
for (const r of records) {
	if (!busesPerRoute.has(r.r)) busesPerRoute.set(r.r, new Set());
	busesPerRoute.get(r.r).add(r.b);
}
const sortedRoutes = [...busesPerRoute.entries()].sort((a, b) => {
	const na = parseInt(a[0]) || 0;
	const nb = parseInt(b[0]) || 0;
	return na - nb;
});
console.log('Route | #Buses | Bus IDs');
for (const [route, buses] of sortedRoutes) {
	const busIds = [...buses].sort();
	console.log(`${route.padEnd(6)}| ${String(buses.size).padEnd(7)}| ${busIds.join(', ')}`);
}


// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: HEADSIGN PATTERNS
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' SECTION 5: HEADSIGN PATTERNS');
console.log('══════════════════════════════════════════════════════════');

const allHeadsigns = new Set(records.map(r => r.h));
console.log(`Unique headsigns: ${allHeadsigns.size}`);
console.log(`Headsign list: ${[...allHeadsigns].sort().join(', ')}`);

// Headsign-to-route mapping
console.log(`\nHeadsign to route mapping:`);
const headsignRoutes = new Map();
for (const r of records) {
	if (!headsignRoutes.has(r.h)) headsignRoutes.set(r.h, new Set());
	headsignRoutes.get(r.h).add(r.r);
}
console.log('Headsign                           | Routes');
for (const [hs, routes] of [...headsignRoutes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
	console.log(`${hs.padEnd(35)}| ${[...routes].sort().join(', ')}`);
}

// Route-to-headsign mapping
console.log(`\nRoute to headsign mapping:`);
const routeHeadsigns = new Map();
for (const r of records) {
	if (!routeHeadsigns.has(r.r)) routeHeadsigns.set(r.r, new Set());
	routeHeadsigns.get(r.r).add(r.h);
}
for (const [route, headsigns] of [...routeHeadsigns.entries()].sort((a, b) => (parseInt(a[0]) || 0) - (parseInt(b[0]) || 0))) {
	console.log(`  Route ${route}: ${[...headsigns].join(', ')}`);
}

// Do headsigns change for a bus? Track transitions
console.log(`\nHeadsign changes per bus:`);
let totalHeadsignChanges = 0;
const busHeadsignChanges = new Map();
for (const [busId, recs] of busRecordsBySnap) {
	recs.sort((a, b) => a.si - b.si);
	let changes = 0;
	for (let i = 1; i < recs.length; i++) {
		if (recs[i].r.h !== recs[i - 1].r.h) {
			changes++;
		}
	}
	if (changes > 0) busHeadsignChanges.set(busId, changes);
	totalHeadsignChanges += changes;
}
console.log(`  Total headsign changes: ${totalHeadsignChanges}`);
console.log(`  Buses with headsign changes: ${busHeadsignChanges.size}`);

const hsChangeCounts = [...busHeadsignChanges.values()];
if (hsChangeCounts.length > 0) {
	const hsStats = stats(hsChangeCounts);
	console.log(`  Changes per bus: min=${hsStats.min}, max=${hsStats.max}, mean=${fmtF(hsStats.mean, 1)}, median=${fmtF(hsStats.median, 0)}`);
}

// Example headsign changes for a few buses
for (const [busId, recs] of [...busRecordsBySnap.entries()].slice(0, 5)) {
	recs.sort((a, b) => a.si - b.si);
	const transitions = [];
	for (let i = 1; i < recs.length; i++) {
		if (recs[i].r.h !== recs[i - 1].r.h) {
			transitions.push({ from: recs[i - 1].r.h, to: recs[i].r.h, time: tsToTime(snapshotTimes[recs[i].si].maxTs) });
		}
	}
	if (transitions.length > 0) {
		console.log(`  ${busId}: ${transitions.map(t => `"${t.from}"->"${t.to}" at ${t.time}`).join(', ')}`);
	}
}


// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: DIRECTION FIELD
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' SECTION 6: DIRECTION FIELD ANALYSIS');
console.log('══════════════════════════════════════════════════════════');

const allDirections = records.map(r => r.d);
const dirStats = stats(allDirections);
console.log(`Direction field (d) statistics:`);
console.log(`  Min: ${dirStats.min}, Max: ${dirStats.max}`);
console.log(`  Mean: ${fmtF(dirStats.mean, 1)}, Median: ${fmtF(dirStats.median, 0)}`);
console.log(`  Unique values: ${new Set(allDirections).size}`);

// Is it 0-360?
const under0 = allDirections.filter(d => d < 0).length;
const over360 = allDirections.filter(d => d > 360).length;
console.log(`  Values < 0: ${under0}, Values > 360: ${over360}`);
console.log(`  Interpretation: ${under0 === 0 && over360 === 0 ? 'Compass heading (0-360 degrees)' : 'Not standard compass'}`);

// Direction distribution by quadrant
const quadrants = { N: 0, E: 0, S: 0, W: 0 };
for (const d of allDirections) {
	if (d >= 315 || d < 45) quadrants.N++;
	else if (d >= 45 && d < 135) quadrants.E++;
	else if (d >= 135 && d < 225) quadrants.S++;
	else quadrants.W++;
}
console.log(`\nDirection quadrant distribution:`);
console.log(`  N (315-45):  ${fmtN(quadrants.N)} (${fmtF(quadrants.N / allDirections.length * 100, 1)}%)`);
console.log(`  E (45-135):  ${fmtN(quadrants.E)} (${fmtF(quadrants.E / allDirections.length * 100, 1)}%)`);
console.log(`  S (135-225): ${fmtN(quadrants.S)} (${fmtF(quadrants.S / allDirections.length * 100, 1)}%)`);
console.log(`  W (225-315): ${fmtN(quadrants.W)} (${fmtF(quadrants.W / allDirections.length * 100, 1)}%)`);

// Direction change frequency between consecutive readings for same bus
console.log(`\nDirection change behavior (consecutive readings per bus):`);
let totalDirPairs = 0;
let dirChanged = 0;
let dirUnchanged = 0;
const dirChangeMagnitudes = [];

for (const [busId, recs] of busRecordsBySnap) {
	recs.sort((a, b) => a.si - b.si);
	for (let i = 1; i < recs.length; i++) {
		totalDirPairs++;
		const d1 = recs[i - 1].r.d;
		const d2 = recs[i].r.d;
		if (d1 === d2) {
			dirUnchanged++;
		} else {
			dirChanged++;
			// Compute shortest angular distance
			let diff = Math.abs(d2 - d1);
			if (diff > 180) diff = 360 - diff;
			dirChangeMagnitudes.push(diff);
		}
	}
}

console.log(`  Total consecutive pairs: ${fmtN(totalDirPairs)}`);
console.log(`  Direction unchanged: ${fmtN(dirUnchanged)} (${fmtF(dirUnchanged / totalDirPairs * 100, 1)}%)`);
console.log(`  Direction changed: ${fmtN(dirChanged)} (${fmtF(dirChanged / totalDirPairs * 100, 1)}%)`);

if (dirChangeMagnitudes.length > 0) {
	const dcStats = stats(dirChangeMagnitudes);
	console.log(`  Change magnitude (degrees): min=${dcStats.min}, max=${dcStats.max}, mean=${fmtF(dcStats.mean, 1)}, median=${fmtF(dcStats.median, 0)}`);
}

// Does direction change independently of position changes?
console.log(`\nDirection vs position change correlation:`);
let posChangeDirChange = 0;
let posChangeDirSame = 0;
let posStaticDirChange = 0;
let posStaticDirSame = 0;

for (const [busId, recs] of busRecordsBySnap) {
	recs.sort((a, b) => a.si - b.si);
	for (let i = 1; i < recs.length; i++) {
		const r1 = recs[i - 1].r;
		const r2 = recs[i].r;
		const posChanged = (r1.la !== r2.la || r1.ln !== r2.ln);
		const dirSame = (r1.d === r2.d);

		if (posChanged && !dirSame) posChangeDirChange++;
		else if (posChanged && dirSame) posChangeDirSame++;
		else if (!posChanged && !dirSame) posStaticDirChange++;
		else posStaticDirSame++;
	}
}

console.log(`  Position moved + direction changed: ${fmtN(posChangeDirChange)} (${fmtF(posChangeDirChange / totalDirPairs * 100, 1)}%)`);
console.log(`  Position moved + direction same:    ${fmtN(posChangeDirSame)} (${fmtF(posChangeDirSame / totalDirPairs * 100, 1)}%)`);
console.log(`  Position static + direction changed: ${fmtN(posStaticDirChange)} (${fmtF(posStaticDirChange / totalDirPairs * 100, 1)}%)`);
console.log(`  Position static + direction same:    ${fmtN(posStaticDirSame)} (${fmtF(posStaticDirSame / totalDirPairs * 100, 1)}%)`);


// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: DEDUPLICATION CHARACTERISTICS
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' SECTION 7: DEDUPLICATION CHARACTERISTICS');
console.log('══════════════════════════════════════════════════════════');

// A "pure duplicate" = same busId, lat, lng, ts as the previous record for that bus
let totalPureDuplicates = 0;
let totalPartialDuplicates = 0; // same busId, ts but different lat/lng
let totalUnique = 0;

// Track by bus, ordered by snapshot
for (const [busId, recs] of busRecordsBySnap) {
	recs.sort((a, b) => a.si - b.si);
	for (let i = 1; i < recs.length; i++) {
		const prev = recs[i - 1].r;
		const curr = recs[i].r;

		if (curr.la === prev.la && curr.ln === prev.ln && curr.ts === prev.ts) {
			totalPureDuplicates++;
		} else if (curr.ts === prev.ts) {
			totalPartialDuplicates++;
		} else {
			totalUnique++;
		}
	}
}

const totalPairs = totalPureDuplicates + totalPartialDuplicates + totalUnique;
console.log(`Total consecutive pairs (per bus): ${fmtN(totalPairs)}`);
console.log(`Pure duplicates (same busId, lat, lng, ts): ${fmtN(totalPureDuplicates)} (${fmtF(totalPureDuplicates / totalPairs * 100, 1)}%)`);
console.log(`Same-ts but moved (same busId, ts, diff pos): ${fmtN(totalPartialDuplicates)} (${fmtF(totalPartialDuplicates / totalPairs * 100, 1)}%)`);
console.log(`Genuinely new readings: ${fmtN(totalUnique)} (${fmtF(totalUnique / totalPairs * 100, 1)}%)`);

// Effective data rate: how many unique (bus, ts) pairs exist?
const uniqueBusTsPairs = new Set(records.map(r => `${r.b}:${r.ts}`));
console.log(`\nTotal records: ${fmtN(records.length)}`);
console.log(`Unique (busId, ts) pairs: ${fmtN(uniqueBusTsPairs.size)}`);
console.log(`Duplication factor: ${fmtF(records.length / uniqueBusTsPairs.size, 2)}x`);
console.log(`Wasted records: ${fmtN(records.length - uniqueBusTsPairs.size)} (${fmtF((records.length - uniqueBusTsPairs.size) / records.length * 100, 1)}%)`);

// Per-bus duplicate rate
console.log(`\nPer-bus duplicate analysis (top 20 by dup rate):`);
const busDupRates = [];
for (const [busId, recs] of busRecordsBySnap) {
	if (recs.length < 50) continue;
	recs.sort((a, b) => a.si - b.si);
	let dups = 0;
	for (let i = 1; i < recs.length; i++) {
		const prev = recs[i - 1].r;
		const curr = recs[i].r;
		if (curr.la === prev.la && curr.ln === prev.ln && curr.ts === prev.ts) {
			dups++;
		}
	}
	busDupRates.push({ busId, records: recs.length, dups, rate: dups / (recs.length - 1) });
}
busDupRates.sort((a, b) => b.rate - a.rate);
console.log('BusId      | Records | Dups    | DupRate');
for (const bd of busDupRates.slice(0, 20)) {
	console.log(`${bd.busId.padEnd(11)}| ${String(bd.records).padEnd(8)}| ${String(bd.dups).padEnd(8)}| ${fmtF(bd.rate * 100, 1)}%`);
}

// Fleet-wide average dup rate
const allDupRates = busDupRates.map(b => b.rate * 100);
if (allDupRates.length > 0) {
	const drStats = stats(allDupRates);
	console.log(`\nFleet duplicate rate: mean=${fmtF(drStats.mean, 1)}%, median=${fmtF(drStats.median, 1)}%, min=${fmtF(drStats.min, 1)}%, max=${fmtF(drStats.max, 1)}%`);
}

// How many consecutive duplicates in a row?
console.log(`\nDuplicate run lengths:`);
const dupRunLengths = [];
for (const [busId, recs] of busRecordsBySnap) {
	recs.sort((a, b) => a.si - b.si);
	let runLen = 0;
	for (let i = 1; i < recs.length; i++) {
		const prev = recs[i - 1].r;
		const curr = recs[i].r;
		if (curr.la === prev.la && curr.ln === prev.ln && curr.ts === prev.ts) {
			runLen++;
		} else {
			if (runLen > 0) dupRunLengths.push(runLen);
			runLen = 0;
		}
	}
	if (runLen > 0) dupRunLengths.push(runLen);
}

if (dupRunLengths.length > 0) {
	const drlStats = stats(dupRunLengths);
	console.log(`  Total duplicate runs: ${fmtN(dupRunLengths.length)}`);
	console.log(`  Run length: min=${drlStats.min}, max=${drlStats.max}, mean=${fmtF(drlStats.mean, 1)}, median=${fmtF(drlStats.median, 0)}`);

	const drlBuckets = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 50, 100, Infinity];
	const drlHist = histogram(dupRunLengths, drlBuckets);
	for (const h of drlHist) {
		if (h.count > 0) console.log(`  ${h.lo}-${h.hi === Infinity ? 'inf' : h.hi}: ${fmtN(h.count)} runs (${fmtF(h.pct, 1)}%)`);
	}
}


// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: API RATE AND VOLUME
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' SECTION 8: API RATE AND VOLUME');
console.log('══════════════════════════════════════════════════════════');

const totalDurationS = (lastPollTime - firstPollTime) / 1000;
const totalDurationH = totalDurationS / 3600;

console.log(`Collection period: ${tsToISO(firstPollTime)} to ${tsToISO(lastPollTime)}`);
console.log(`Duration: ${fmtF(totalDurationH, 2)} hours (${fmtF(totalDurationS, 0)} seconds)`);
console.log(`Total records: ${fmtN(records.length)}`);
console.log(`Total snapshots: ${fmtN(snapshots.length)}`);

console.log(`\nOverall rates:`);
console.log(`  Records/second: ${fmtF(records.length / totalDurationS, 1)}`);
console.log(`  Records/minute: ${fmtF(records.length / (totalDurationS / 60), 0)}`);
console.log(`  Snapshots/minute: ${fmtF(snapshots.length / (totalDurationS / 60), 1)}`);
console.log(`  Avg seconds between snapshots: ${fmtF(totalDurationS / snapshots.length, 1)}`);

// Records per hour
console.log(`\nRecords per hour:`);
const hourlyRecords = new Map();
for (let si = 0; si < snapshots.length; si++) {
	const hour = new Date(snapshotTimes[si].maxTs).getUTCHours();
	if (!hourlyRecords.has(hour)) hourlyRecords.set(hour, { records: 0, snapshots: 0 });
	hourlyRecords.get(hour).records += snapshots[si].length;
	hourlyRecords.get(hour).snapshots++;
}

console.log('Hour(UTC) | Records   | Snapshots | Avg Buses/Snap');
for (const [hour, data] of [...hourlyRecords.entries()].sort((a, b) => a[0] - b[0])) {
	const avgBuses = data.records / data.snapshots;
	console.log(`${String(hour).padStart(2, '0')}:00     | ${String(data.records).padEnd(10)}| ${String(data.snapshots).padEnd(10)}| ${fmtF(avgBuses, 1)}`);
}

// Data volume estimation
const fileSize = readFileSync(DATASET).length;
console.log(`\nData volume:`);
console.log(`  File size: ${fmtF(fileSize / 1024 / 1024, 1)} MB`);
console.log(`  Bytes per record (avg): ${fmtF(fileSize / records.length, 0)} bytes`);
console.log(`  MB per hour: ${fmtF(fileSize / totalDurationH / 1024 / 1024, 1)} MB`);
console.log(`  Estimated MB per 24h: ${fmtF(fileSize / totalDurationH * 24 / 1024 / 1024, 0)} MB`);

// After deduplication
const deduplicatedRecords = uniqueBusTsPairs.size;
const estDeduplicatedSize = (deduplicatedRecords / records.length) * fileSize;
console.log(`\nAfter deduplication:`);
console.log(`  Records: ${fmtN(deduplicatedRecords)} (${fmtF(deduplicatedRecords / records.length * 100, 1)}% of original)`);
console.log(`  Estimated size: ${fmtF(estDeduplicatedSize / 1024 / 1024, 1)} MB`);
console.log(`  MB per hour: ${fmtF(estDeduplicatedSize / totalDurationH / 1024 / 1024, 1)} MB`);
console.log(`  Estimated MB per 24h: ${fmtF(estDeduplicatedSize / totalDurationH * 24 / 1024 / 1024, 0)} MB`);

// Bandwidth estimation (API responses as JSON)
// Each API response contains ~N buses with their data
const avgBusesPerSnap = records.length / snapshots.length;
const estJsonPerBus = 200; // rough estimate of JSON bytes per bus in API response
const estResponseSize = avgBusesPerSnap * estJsonPerBus;
const totalApiCalls = snapshots.length;
const totalBandwidth = totalApiCalls * estResponseSize;
console.log(`\nEstimated API bandwidth:`);
console.log(`  Avg buses per snapshot: ${fmtF(avgBusesPerSnap, 1)}`);
console.log(`  Est. response size: ~${fmtF(estResponseSize / 1024, 1)} KB`);
console.log(`  Total API calls: ${fmtN(totalApiCalls)}`);
console.log(`  Est. total bandwidth: ${fmtF(totalBandwidth / 1024 / 1024, 1)} MB`);
console.log(`  Est. bandwidth/hour: ${fmtF(totalBandwidth / totalDurationH / 1024 / 1024, 1)} MB`);

// Optimal polling interval analysis
console.log(`\nOptimal polling interval analysis:`);
// How fresh is the data at each polling interval?
// We already know the distribution of bus update intervals from staleness analysis.
// Let's compute: for a given poll interval, what % of polls would get new data vs duplicates?

// Compute actual bus update intervals (time between distinct ts values per bus)
const busUpdateIntervals = [];
for (const [busId, recs] of busRecordsBySnap) {
	recs.sort((a, b) => a.si - b.si);
	let lastTs = recs[0].r.ts;
	for (let i = 1; i < recs.length; i++) {
		if (recs[i].r.ts !== lastTs) {
			busUpdateIntervals.push((recs[i].r.ts - lastTs) / 1000);
			lastTs = recs[i].r.ts;
		}
	}
}

const buiStats = stats(busUpdateIntervals);
console.log(`\nBus GPS update interval (time between distinct timestamps for same bus):`);
console.log(`  Min: ${fmtF(buiStats.min, 1)}s, Max: ${fmtF(buiStats.max, 1)}s`);
console.log(`  Mean: ${fmtF(buiStats.mean, 1)}s, Median: ${fmtF(buiStats.median, 1)}s`);
console.log(`  P5: ${fmtF(buiStats.p5, 1)}s, P25: ${fmtF(buiStats.p25, 1)}s, P75: ${fmtF(buiStats.p75, 1)}s, P95: ${fmtF(buiStats.p95, 1)}s, P99: ${fmtF(buiStats.p99, 1)}s`);

const buiBuckets = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 60, 120, 300, 600, Infinity];
const buiHist = histogram(busUpdateIntervals, buiBuckets);
console.log(`\nBus update interval distribution:`);
for (const h of buiHist) {
	if (h.count > 0) console.log(`  ${h.lo}-${h.hi === Infinity ? 'inf' : h.hi}s: ${fmtN(h.count)} (${fmtF(h.pct, 1)}%)`);
}

// Given the bus update interval, what happens at different poll rates?
const pollOptions = [1, 2, 3, 5, 10, 15, 30];
console.log(`\nPoll interval simulation (estimated new data %):`);
console.log(`Poll(s) | % polls with any new data | Avg new buses/poll | Bandwidth/hr(MB)`);

for (const pollS of pollOptions) {
	const pollsPerHour = 3600 / pollS;
	// Approximate: a bus has new data every ~median update interval
	// If poll interval < update interval, most polls get no new data from that bus
	// If poll interval >= update interval, most polls get new data from that bus
	const medianUpdateS = buiStats.median;
	// For a fleet of N buses, each updating independently every ~medianUpdateS:
	// In a pollS window, probability any given bus has updated = min(1, pollS / medianUpdateS)
	const probBusUpdated = Math.min(1, pollS / medianUpdateS);
	const avgBuses = avgBusesPerSnap;
	const expectedNewBuses = avgBuses * probBusUpdated;
	const probAnyNew = 1 - (1 - probBusUpdated) ** avgBuses;
	const bw = pollsPerHour * estResponseSize / 1024 / 1024;
	console.log(`${String(pollS).padEnd(8)}| ${fmtF(probAnyNew * 100, 1).padStart(24)}% | ${fmtF(expectedNewBuses, 1).padStart(18)} | ${fmtF(bw, 1)}`);
}


// ═══════════════════════════════════════════════════════════════════════
// SECTION 9: SUMMARY TABLE
// ═══════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════');
console.log(' SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`Dataset: 2026-03-11.jsonl`);
console.log(`Period: ${tsToISO(firstPollTime)} to ${tsToISO(lastPollTime)} (${fmtF(totalDurationH, 2)}h)`);
console.log(`Total records: ${fmtN(records.length)}`);
console.log(`Total snapshots: ${fmtN(snapshots.length)}`);
console.log(`Unique buses: ${allBusIds.size}`);
console.log(`Unique routes: ${allRoutes.size}`);
console.log(`Unique trips: ${allTripIds.size}`);
console.log(`Unique headsigns: ${allHeadsigns.size}`);
console.log(`Avg buses per snapshot: ${fmtF(avgBusesPerSnap, 1)}`);
console.log(`Avg snapshot interval: ${fmtF(totalDurationS / snapshots.length, 1)}s`);
console.log(`Pure duplicate rate: ${fmtF(totalPureDuplicates / totalPairs * 100, 1)}%`);
console.log(`Unique (bus,ts) pairs: ${fmtN(uniqueBusTsPairs.size)} (${fmtF(uniqueBusTsPairs.size / records.length * 100, 1)}% of records)`);
console.log(`Bus GPS update interval (median): ${fmtF(buiStats.median, 1)}s`);
console.log(`File size: ${fmtF(fileSize / 1024 / 1024, 1)} MB`);
console.log(`Direction field range: ${dirStats.min}-${dirStats.max} (compass heading)`);

console.log('\n=== ANALYSIS COMPLETE ===');
