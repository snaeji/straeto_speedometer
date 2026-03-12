#!/usr/bin/env node
/**
 * Comprehensive Speed & Kinematics Analysis of Straeto Bus GPS Data.
 * Processes the full-day JSONL dataset (2026-03-11).
 *
 * Sections:
 *   1. Raw Haversine Speed Distribution
 *   2. Speed Anomalies (>90, >120 km/h)
 *   3. Acceleration Analysis
 *   4. Speed Overestimation / Phantom Speed at Stops
 *   5. Consecutive Speed Jitter
 *   6. Speed Profile Characteristics (5 representative buses)
 *   7. Stop Detection from Speed Data
 *   8. Trip Segment Analysis
 */

import { readFileSync } from 'fs';

const DATASET = '/Users/snaeji/development/git/straeto_speedometer/data/2026-03-11.jsonl';

// ── Helpers ──────────────────────────────────────────────────────────────────

function haversineM(lat1, lng1, lat2, lng2) {
	const R = 6371000;
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLng = (lng2 - lng1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function percentile(sorted, p) {
	if (sorted.length === 0) return 0;
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function pctiles(arr) {
	const s = [...arr].sort((a, b) => a - b);
	return {
		count: s.length,
		min: s[0],
		P1: percentile(s, 1),
		P5: percentile(s, 5),
		P10: percentile(s, 10),
		P25: percentile(s, 25),
		P50: percentile(s, 50),
		P75: percentile(s, 75),
		P90: percentile(s, 90),
		P95: percentile(s, 95),
		P99: percentile(s, 99),
		P99_5: percentile(s, 99.5),
		P99_9: percentile(s, 99.9),
		max: s[s.length - 1],
		mean: s.reduce((a, b) => a + b, 0) / s.length,
	};
}

function fmtNum(n, d = 2) {
	return Number(n).toFixed(d);
}

function epochToTimeStr(tsMs) {
	const d = new Date(tsMs);
	return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function epochToHour(tsMs) {
	return new Date(tsMs).getUTCHours();
}

// ── Load & Parse ─────────────────────────────────────────────────────────────

console.log('Reading dataset...');
const rawLines = readFileSync(DATASET, 'utf8').trim().split('\n');
console.log(`Total records: ${rawLines.length}`);

const byBus = new Map();
for (const line of rawLines) {
	const r = JSON.parse(line);
	if (!byBus.has(r.b)) byBus.set(r.b, []);
	byBus.get(r.b).push({ lat: r.la, lng: r.ln, ts: r.ts, route: r.r, headsign: r.h, dir: r.d });
}

// Sort each bus by timestamp
for (const [, records] of byBus) {
	records.sort((a, b) => a.ts - b.ts);
}

console.log(`Unique buses: ${byBus.size}\n`);

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Raw Haversine Speed Distribution
// ═══════════════════════════════════════════════════════════════════════════

console.log('='.repeat(72));
console.log('SECTION 1: RAW HAVERSINE SPEED DISTRIBUTION');
console.log('='.repeat(72));

const allSpeeds = [];            // all valid consecutive-pair speeds
const speedByRoute = new Map();  // route -> speeds[]
const speedByHour = new Map();   // hour -> speeds[]
const pairsPerBus = new Map();   // busId -> [{speed, dt, dist, ts, lat, lng, prevLat, prevLng}]

for (const [busId, records] of byBus) {
	const busSpds = [];
	for (let i = 1; i < records.length; i++) {
		const prev = records[i - 1];
		const curr = records[i];
		const dtMs = curr.ts - prev.ts;
		if (dtMs <= 0) continue; // skip identical/reversed timestamps
		const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
		if (dist < 0.5) continue; // skip stale readings
		const dtS = dtMs / 1000;
		const speedKmh = (dist / 1000) / (dtS / 3600);
		allSpeeds.push(speedKmh);

		busSpds.push({
			speed: speedKmh, dt: dtS, dist,
			ts: curr.ts, lat: curr.lat, lng: curr.lng,
			prevLat: prev.lat, prevLng: prev.lng,
			route: curr.route,
		});

		// By route
		const rk = curr.route;
		if (!speedByRoute.has(rk)) speedByRoute.set(rk, []);
		speedByRoute.get(rk).push(speedKmh);

		// By hour
		const hk = epochToHour(curr.ts);
		if (!speedByHour.has(hk)) speedByHour.set(hk, []);
		speedByHour.get(hk).push(speedKmh);
	}
	pairsPerBus.set(busId, busSpds);
}

const globalDist = pctiles(allSpeeds);

console.log(`\nTotal valid speed pairs: ${globalDist.count}`);
console.log(`\nGlobal Raw Haversine Speed Distribution (km/h):`);
console.log(`  Min   : ${fmtNum(globalDist.min)}`);
console.log(`  P1    : ${fmtNum(globalDist.P1)}`);
console.log(`  P5    : ${fmtNum(globalDist.P5)}`);
console.log(`  P10   : ${fmtNum(globalDist.P10)}`);
console.log(`  P25   : ${fmtNum(globalDist.P25)}`);
console.log(`  P50   : ${fmtNum(globalDist.P50)}`);
console.log(`  P75   : ${fmtNum(globalDist.P75)}`);
console.log(`  P90   : ${fmtNum(globalDist.P90)}`);
console.log(`  P95   : ${fmtNum(globalDist.P95)}`);
console.log(`  P99   : ${fmtNum(globalDist.P99)}`);
console.log(`  P99.5 : ${fmtNum(globalDist.P99_5)}`);
console.log(`  P99.9 : ${fmtNum(globalDist.P99_9)}`);
console.log(`  Max   : ${fmtNum(globalDist.max)}`);
console.log(`  Mean  : ${fmtNum(globalDist.mean)}`);

// Per-route distribution
console.log(`\nPer-Route Speed Distribution (km/h):`);
console.log(`${'Route'.padEnd(8)}| ${'N'.padStart(7)} | ${'P25'.padStart(7)} | ${'P50'.padStart(7)} | ${'P75'.padStart(7)} | ${'P90'.padStart(7)} | ${'P95'.padStart(7)} | ${'P99'.padStart(7)} | ${'Max'.padStart(7)} | ${'Mean'.padStart(7)}`);
console.log('-'.repeat(96));
const routeKeys = [...speedByRoute.keys()].sort((a, b) => Number(a) - Number(b));
for (const rk of routeKeys) {
	const d = pctiles(speedByRoute.get(rk));
	console.log(`${rk.padEnd(8)}| ${String(d.count).padStart(7)} | ${fmtNum(d.P25).padStart(7)} | ${fmtNum(d.P50).padStart(7)} | ${fmtNum(d.P75).padStart(7)} | ${fmtNum(d.P90).padStart(7)} | ${fmtNum(d.P95).padStart(7)} | ${fmtNum(d.P99).padStart(7)} | ${fmtNum(d.max).padStart(7)} | ${fmtNum(d.mean).padStart(7)}`);
}

// Per-hour distribution
console.log(`\nSpeed by Hour of Day (UTC = Iceland time):`);
console.log(`${'Hour'.padEnd(6)}| ${'N'.padStart(7)} | ${'P25'.padStart(7)} | ${'P50'.padStart(7)} | ${'P75'.padStart(7)} | ${'P90'.padStart(7)} | ${'P95'.padStart(7)} | ${'Mean'.padStart(7)}`);
console.log('-'.repeat(68));
const hourKeys = [...speedByHour.keys()].sort((a, b) => a - b);
for (const hk of hourKeys) {
	const d = pctiles(speedByHour.get(hk));
	console.log(`${String(hk).padStart(2).padEnd(6)}| ${String(d.count).padStart(7)} | ${fmtNum(d.P25).padStart(7)} | ${fmtNum(d.P50).padStart(7)} | ${fmtNum(d.P75).padStart(7)} | ${fmtNum(d.P90).padStart(7)} | ${fmtNum(d.P95).padStart(7)} | ${fmtNum(d.mean).padStart(7)}`);
}

// Speed histogram buckets
const histBuckets = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 120, 150, 200, Infinity];
console.log(`\nSpeed Histogram (km/h):`);
for (let i = 0; i < histBuckets.length - 1; i++) {
	const lo = histBuckets[i], hi = histBuckets[i + 1];
	const cnt = allSpeeds.filter(s => s >= lo && s < hi).length;
	const pct = (cnt / allSpeeds.length * 100).toFixed(2);
	const bar = '#'.repeat(Math.round(cnt / allSpeeds.length * 200));
	const label = hi === Infinity ? `${lo}+` : `${lo}-${hi}`;
	console.log(`  ${label.padEnd(8)}: ${String(cnt).padStart(8)} (${pct.padStart(6)}%) ${bar}`);
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Speed Anomalies
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 2: SPEED ANOMALIES');
console.log('='.repeat(72));

// Collect all anomalies with context
const anomalies90 = [];
const anomalies120 = [];

for (const [busId, busSpds] of pairsPerBus) {
	for (let i = 0; i < busSpds.length; i++) {
		const s = busSpds[i];
		if (s.speed > 90) {
			const entry = {
				busId, route: s.route, speed: s.speed, dt: s.dt, dist: s.dist,
				ts: s.ts, lat: s.lat, lng: s.lng,
				prevLat: s.prevLat, prevLng: s.prevLng,
			};
			anomalies90.push(entry);
			if (s.speed > 120) {
				// Get context: prev and next readings for this bus
				const prev = i > 0 ? busSpds[i - 1] : null;
				const next = i < busSpds.length - 1 ? busSpds[i + 1] : null;
				anomalies120.push({ ...entry, prevReading: prev, nextReading: next });
			}
		}
	}
}

console.log(`\nRecords with raw speed > 90 km/h: ${anomalies90.length} (${(anomalies90.length / allSpeeds.length * 100).toFixed(3)}%)`);
console.log(`Records with raw speed > 120 km/h: ${anomalies120.length} (${(anomalies120.length / allSpeeds.length * 100).toFixed(3)}%)`);

// Buses with most >90 anomalies
const anomCountByBus = new Map();
for (const a of anomalies90) {
	anomCountByBus.set(a.busId, (anomCountByBus.get(a.busId) || 0) + 1);
}
const topAnomalyBuses = [...anomCountByBus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`\nBuses with most >90 km/h readings:`);
console.log(`${'Bus'.padEnd(12)}| ${'Count'.padStart(6)} | Route(s)`);
console.log('-'.repeat(50));
for (const [busId, cnt] of topAnomalyBuses) {
	const routes = [...new Set(anomalies90.filter(a => a.busId === busId).map(a => a.route))].join(',');
	console.log(`${busId.padEnd(12)}| ${String(cnt).padStart(6)} | ${routes}`);
}

// Routes with most >90 anomalies
const anomCountByRoute = new Map();
for (const a of anomalies90) {
	anomCountByRoute.set(a.route, (anomCountByRoute.get(a.route) || 0) + 1);
}
const topAnomalyRoutes = [...anomCountByRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log(`\nRoutes with most >90 km/h readings:`);
console.log(`${'Route'.padEnd(8)}| ${'Count'.padStart(6)} | ${'% of route pairs'.padStart(16)}`);
console.log('-'.repeat(40));
for (const [route, cnt] of topAnomalyRoutes) {
	const routeTotal = speedByRoute.get(route)?.length || 1;
	console.log(`${route.padEnd(8)}| ${String(cnt).padStart(6)} | ${(cnt / routeTotal * 100).toFixed(2).padStart(15)}%`);
}

// Detail each >120 km/h anomaly
console.log(`\nDetailed >120 km/h anomalies (${anomalies120.length} total):`);
console.log('-'.repeat(130));
for (const a of anomalies120.slice(0, 50)) { // cap at 50 for readability
	console.log(`  Bus=${a.busId} Route=${a.route} Speed=${fmtNum(a.speed)}km/h dt=${fmtNum(a.dt,1)}s dist=${fmtNum(a.dist,1)}m`);
	console.log(`    Time: ${epochToTimeStr(a.ts)}`);
	console.log(`    Position: (${fmtNum(a.lat, 7)}, ${fmtNum(a.lng, 7)}) from (${fmtNum(a.prevLat, 7)}, ${fmtNum(a.prevLng, 7)})`);
	if (a.prevReading) {
		console.log(`    Prev reading: ${fmtNum(a.prevReading.speed)}km/h dt=${fmtNum(a.prevReading.dt, 1)}s`);
	}
	if (a.nextReading) {
		console.log(`    Next reading: ${fmtNum(a.nextReading.speed)}km/h dt=${fmtNum(a.nextReading.dt, 1)}s`);
	}
}
if (anomalies120.length > 50) {
	console.log(`  ... and ${anomalies120.length - 50} more`);
}

// Location clustering of anomalies
console.log(`\nAnomaly location clusters (>90 km/h, grouped by ~500m grid):`);
const locGrid = new Map();
for (const a of anomalies90) {
	const gLat = Math.round(a.lat * 200) / 200; // ~500m grid
	const gLng = Math.round(a.lng * 400) / 400;
	const key = `${gLat},${gLng}`;
	if (!locGrid.has(key)) locGrid.set(key, { count: 0, lat: gLat, lng: gLng, buses: new Set() });
	const cell = locGrid.get(key);
	cell.count++;
	cell.buses.add(a.busId);
}
const hotspots = [...locGrid.values()].sort((a, b) => b.count - a.count).slice(0, 15);
console.log(`${'Grid Center'.padEnd(24)}| ${'Count'.padStart(6)} | ${'Buses'.padStart(6)}`);
console.log('-'.repeat(44));
for (const h of hotspots) {
	console.log(`(${fmtNum(h.lat, 4)}, ${fmtNum(h.lng, 4)})`.padEnd(24) + `| ${String(h.count).padStart(6)} | ${String(h.buses.size).padStart(6)}`);
}

// Temporal pattern of anomalies
const anomByHour = new Map();
for (const a of anomalies90) {
	const h = epochToHour(a.ts);
	anomByHour.set(h, (anomByHour.get(h) || 0) + 1);
}
console.log(`\n>90 km/h anomalies by hour:`);
for (const h of [...anomByHour.keys()].sort((a, b) => a - b)) {
	const cnt = anomByHour.get(h);
	const hourTotal = speedByHour.get(h)?.length || 1;
	console.log(`  ${String(h).padStart(2)}:00 : ${String(cnt).padStart(5)} (${(cnt / hourTotal * 100).toFixed(2)}% of readings that hour)`);
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Acceleration Analysis
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 3: ACCELERATION ANALYSIS');
console.log('='.repeat(72));

const allAccels = [];       // m/s^2
const accelDetails = [];    // for impossible ones

for (const [busId, busSpds] of pairsPerBus) {
	for (let i = 1; i < busSpds.length; i++) {
		const prev = busSpds[i - 1];
		const curr = busSpds[i];
		// dt between this reading and the previous (both are already consecutive real updates for this bus)
		const dtBetween = (curr.ts - prev.ts) / 1000;
		if (dtBetween <= 0 || dtBetween > 120) continue; // skip huge gaps (different trips)

		const dv = (curr.speed - prev.speed) / 3.6; // m/s
		const accel = dv / dtBetween; // m/s^2
		allAccels.push(accel);

		if (Math.abs(accel) > 3.0) {
			accelDetails.push({
				busId, route: curr.route,
				accel, dv: dv * 3.6, dtBetween,
				speed1: prev.speed, speed2: curr.speed,
				ts: curr.ts,
			});
		}
	}
}

const accelDist = pctiles(allAccels);
const absAccels = allAccels.map(a => Math.abs(a));
const absAccelDist = pctiles(absAccels);

console.log(`\nTotal acceleration samples: ${allAccels.length}`);
console.log(`\nAcceleration Distribution (m/s^2):`);
console.log(`  Min (max decel): ${fmtNum(accelDist.min)}`);
console.log(`  P1             : ${fmtNum(accelDist.P1)}`);
console.log(`  P5             : ${fmtNum(accelDist.P5)}`);
console.log(`  P10            : ${fmtNum(accelDist.P10)}`);
console.log(`  P25            : ${fmtNum(accelDist.P25)}`);
console.log(`  P50 (median)   : ${fmtNum(accelDist.P50)}`);
console.log(`  P75            : ${fmtNum(accelDist.P75)}`);
console.log(`  P90            : ${fmtNum(accelDist.P90)}`);
console.log(`  P95            : ${fmtNum(accelDist.P95)}`);
console.log(`  P99            : ${fmtNum(accelDist.P99)}`);
console.log(`  P99.9          : ${fmtNum(accelDist.P99_9)}`);
console.log(`  Max (max accel): ${fmtNum(accelDist.max)}`);
console.log(`  Mean           : ${fmtNum(accelDist.mean)}`);

console.log(`\n|Acceleration| Distribution (m/s^2):`);
console.log(`  P50    : ${fmtNum(absAccelDist.P50)}`);
console.log(`  P75    : ${fmtNum(absAccelDist.P75)}`);
console.log(`  P90    : ${fmtNum(absAccelDist.P90)}`);
console.log(`  P95    : ${fmtNum(absAccelDist.P95)}`);
console.log(`  P99    : ${fmtNum(absAccelDist.P99)}`);
console.log(`  P99.9  : ${fmtNum(absAccelDist.P99_9)}`);
console.log(`  Max    : ${fmtNum(absAccelDist.max)}`);

const impossibleCount = allAccels.filter(a => Math.abs(a) > 3.0).length;
const impossiblePct = (impossibleCount / allAccels.length * 100).toFixed(3);
console.log(`\nPhysically impossible acceleration (|a| > 3 m/s^2): ${impossibleCount} (${impossiblePct}%)`);

const impossibleAccelOnly = allAccels.filter(a => a > 3.0).length;
const impossibleDecelOnly = allAccels.filter(a => a < -3.0).length;
console.log(`  Of which acceleration > +3 m/s^2: ${impossibleAccelOnly}`);
console.log(`  Of which deceleration < -3 m/s^2: ${impossibleDecelOnly}`);

// Characterize impossible accelerations
console.log(`\nImpossible acceleration details (sample of 30):`);
const impossibleSample = accelDetails.sort((a, b) => Math.abs(b.accel) - Math.abs(a.accel)).slice(0, 30);
console.log(`${'Bus'.padEnd(10)}| ${'Rt'.padEnd(4)}| ${'a(m/s2)'.padStart(9)} | ${'v1 km/h'.padStart(9)} | ${'v2 km/h'.padStart(9)} | ${'dt(s)'.padStart(7)} | Time`);
console.log('-'.repeat(80));
for (const d of impossibleSample) {
	console.log(`${d.busId.padEnd(10)}| ${d.route.padEnd(4)}| ${fmtNum(d.accel).padStart(9)} | ${fmtNum(d.speed1).padStart(9)} | ${fmtNum(d.speed2).padStart(9)} | ${fmtNum(d.dtBetween, 1).padStart(7)} | ${epochToTimeStr(d.ts)}`);
}

// Are impossible accelerations correlated with short dt?
const impossibleByDt = new Map();
const dtBuckets = [[0, 3], [3, 5], [5, 10], [10, 20], [20, 60], [60, 120]];
for (const bucket of dtBuckets) {
	const inBucket = accelDetails.filter(d => d.dtBetween >= bucket[0] && d.dtBetween < bucket[1]);
	const totalInBucket = allAccels.length > 0 ? allAccels.filter((_, idx) => {
		// We need the dt for all accels - approximate by checking accelDetails
		return true;
	}).length : 0;
	impossibleByDt.set(`${bucket[0]}-${bucket[1]}s`, inBucket.length);
}
console.log(`\nImpossible accelerations by time-gap range:`);
for (const [label, cnt] of impossibleByDt) {
	console.log(`  dt ${label}: ${cnt}`);
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Speed Overestimation / Phantom Speed at Stops
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 4: PHANTOM SPEED AT STOPS (GPS NOISE QUANTIFICATION)');
console.log('='.repeat(72));

// Find periods where a bus is stationary (same position within threshold for >= 10s)
// Then measure raw Haversine speed during those periods.

const phantomSpeeds = {
	stopped: [],    // all fixes within 3m of mean position
	slow: [],       // 3-10m total movement
	moving: [],     // >10m total movement
};

for (const [busId, records] of byBus) {
	if (records.length < 10) continue;

	// Find windows of near-stationary behavior
	// Use sliding window: accumulate records while spread < threshold
	let windowStart = 0;
	while (windowStart < records.length) {
		// Extend window while total spread is small
		let windowEnd = windowStart;
		const firstRec = records[windowStart];

		// Find how far the window extends while staying "near" the start
		while (windowEnd < records.length - 1) {
			const next = records[windowEnd + 1];
			const distFromStart = haversineM(firstRec.lat, firstRec.lng, next.lat, next.lng);
			if (distFromStart > 30) break; // stop extending if moved >30m from start
			windowEnd++;
		}

		const windowDuration = (records[windowEnd].ts - records[windowStart].ts) / 1000;
		if (windowDuration < 10 || windowEnd - windowStart < 3) {
			windowStart = windowEnd + 1;
			continue;
		}

		// Compute spread: max distance from centroid
		const wRecords = records.slice(windowStart, windowEnd + 1);
		const meanLat = wRecords.reduce((s, r) => s + r.lat, 0) / wRecords.length;
		const meanLng = wRecords.reduce((s, r) => s + r.lng, 0) / wRecords.length;
		let maxDistFromCenter = 0;
		for (const r of wRecords) {
			const d = haversineM(meanLat, meanLng, r.lat, r.lng);
			if (d > maxDistFromCenter) maxDistFromCenter = d;
		}

		// Compute raw Haversine speeds within this window
		for (let i = windowStart + 1; i <= windowEnd; i++) {
			const prev = records[i - 1];
			const curr = records[i];
			const dt = (curr.ts - prev.ts) / 1000;
			if (dt <= 0) continue;
			const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
			const speed = (dist / 1000) / (dt / 3600);

			if (maxDistFromCenter <= 3) {
				phantomSpeeds.stopped.push(speed);
			} else if (maxDistFromCenter <= 10) {
				phantomSpeeds.slow.push(speed);
			} else {
				phantomSpeeds.moving.push(speed);
			}
		}

		windowStart = windowEnd + 1;
	}
}

console.log(`\nPhantom speed analysis (raw Haversine during near-stationary periods):`);
console.log(`  Classification: stopped = all fixes within 3m, slow = 3-10m spread, moving = 10-30m spread`);
console.log(`  Minimum window: 10 seconds, 3+ fixes\n`);

for (const [label, speeds] of Object.entries(phantomSpeeds)) {
	if (speeds.length === 0) {
		console.log(`  ${label}: no data`);
		continue;
	}
	const d = pctiles(speeds);
	console.log(`  ${label.toUpperCase()} (n=${d.count}):`);
	console.log(`    P50=${fmtNum(d.P50)} P75=${fmtNum(d.P75)} P90=${fmtNum(d.P90)} P95=${fmtNum(d.P95)} P99=${fmtNum(d.P99)} Max=${fmtNum(d.max)} Mean=${fmtNum(d.mean)} km/h`);

	// What % show > various thresholds
	for (const thresh of [1, 3, 5, 10, 15]) {
		const cnt = speeds.filter(s => s > thresh).length;
		console.log(`    > ${thresh} km/h: ${cnt} (${(cnt / speeds.length * 100).toFixed(1)}%)`);
	}
}

// Also compute: for completely stopped buses (spread < 3m),
// what does a 3-point moving average show?
console.log(`\n  3-Point Moving Average phantom speed (stopped buses, spread < 3m):`);
{
	// Reconstruct per-bus stopped windows and apply 3-pt avg
	const avgPhantom = [];
	for (const [busId, records] of byBus) {
		if (records.length < 10) continue;
		let windowStart = 0;
		while (windowStart < records.length) {
			let windowEnd = windowStart;
			const firstRec = records[windowStart];
			while (windowEnd < records.length - 1) {
				const next = records[windowEnd + 1];
				if (haversineM(firstRec.lat, firstRec.lng, next.lat, next.lng) > 5) break;
				windowEnd++;
			}
			const dur = (records[windowEnd].ts - records[windowStart].ts) / 1000;
			if (dur < 10 || windowEnd - windowStart < 5) {
				windowStart = windowEnd + 1;
				continue;
			}

			// Compute consecutive speeds
			const winSpeeds = [];
			for (let i = windowStart + 1; i <= windowEnd; i++) {
				const prev = records[i - 1];
				const curr = records[i];
				const dt = (curr.ts - prev.ts) / 1000;
				if (dt <= 0) continue;
				const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
				winSpeeds.push((dist / 1000) / (dt / 3600));
			}

			// Apply 3-point moving average
			for (let i = 1; i < winSpeeds.length - 1; i++) {
				avgPhantom.push((winSpeeds[i - 1] + winSpeeds[i] + winSpeeds[i + 1]) / 3);
			}
			windowStart = windowEnd + 1;
		}
	}
	if (avgPhantom.length > 0) {
		const d = pctiles(avgPhantom);
		console.log(`    n=${d.count}: P50=${fmtNum(d.P50)} P75=${fmtNum(d.P75)} P90=${fmtNum(d.P90)} P95=${fmtNum(d.P95)} Max=${fmtNum(d.max)} Mean=${fmtNum(d.mean)} km/h`);
	}
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Consecutive Speed Jitter
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 5: CONSECUTIVE SPEED JITTER');
console.log('='.repeat(72));

const rawJitter = [];       // |speed_n - speed_n-1| for raw Haversine
const avgJitter = [];       // same but with 3-pt avg applied

for (const [busId, busSpds] of pairsPerBus) {
	if (busSpds.length < 4) continue;

	// Raw jitter
	for (let i = 1; i < busSpds.length; i++) {
		const dtBetween = (busSpds[i].ts - busSpds[i - 1].ts) / 1000;
		if (dtBetween > 120) continue; // skip if big gap (different trip)
		rawJitter.push(Math.abs(busSpds[i].speed - busSpds[i - 1].speed));
	}

	// 3-point moving average jitter
	const avgSpeeds = [];
	for (let i = 0; i < busSpds.length; i++) {
		const lo = Math.max(0, i - 1);
		const hi = Math.min(busSpds.length - 1, i + 1);
		let sum = 0, cnt = 0;
		for (let j = lo; j <= hi; j++) {
			sum += busSpds[j].speed;
			cnt++;
		}
		avgSpeeds.push(sum / cnt);
	}
	for (let i = 1; i < avgSpeeds.length; i++) {
		const dtBetween = (busSpds[i].ts - busSpds[i - 1].ts) / 1000;
		if (dtBetween > 120) continue;
		avgJitter.push(Math.abs(avgSpeeds[i] - avgSpeeds[i - 1]));
	}
}

const rawJitterDist = pctiles(rawJitter);
const avgJitterDist = pctiles(avgJitter);

console.log(`\nRaw Haversine Speed Jitter |v_n - v_{n-1}| (km/h):`);
console.log(`  n=${rawJitterDist.count}`);
console.log(`  P25=${fmtNum(rawJitterDist.P25)} P50=${fmtNum(rawJitterDist.P50)} P75=${fmtNum(rawJitterDist.P75)} P90=${fmtNum(rawJitterDist.P90)} P95=${fmtNum(rawJitterDist.P95)} P99=${fmtNum(rawJitterDist.P99)} Max=${fmtNum(rawJitterDist.max)} Mean=${fmtNum(rawJitterDist.mean)}`);

console.log(`\n3-Point Moving Average Jitter |v_n - v_{n-1}| (km/h):`);
console.log(`  n=${avgJitterDist.count}`);
console.log(`  P25=${fmtNum(avgJitterDist.P25)} P50=${fmtNum(avgJitterDist.P50)} P75=${fmtNum(avgJitterDist.P75)} P90=${fmtNum(avgJitterDist.P90)} P95=${fmtNum(avgJitterDist.P95)} P99=${fmtNum(avgJitterDist.P99)} Max=${fmtNum(avgJitterDist.max)} Mean=${fmtNum(avgJitterDist.mean)}`);

console.log(`\nJitter Reduction Factor (raw / averaged):`);
console.log(`  P50: ${fmtNum(rawJitterDist.P50 / (avgJitterDist.P50 || 0.001), 2)}x`);
console.log(`  P75: ${fmtNum(rawJitterDist.P75 / (avgJitterDist.P75 || 0.001), 2)}x`);
console.log(`  P90: ${fmtNum(rawJitterDist.P90 / (avgJitterDist.P90 || 0.001), 2)}x`);
console.log(`  P95: ${fmtNum(rawJitterDist.P95 / (avgJitterDist.P95 || 0.001), 2)}x`);
console.log(`  Mean: ${fmtNum(rawJitterDist.mean / (avgJitterDist.mean || 0.001), 2)}x`);

// Jitter by speed range
console.log(`\nRaw jitter by speed range:`);
const jitterByRange = new Map();
for (const [busId, busSpds] of pairsPerBus) {
	for (let i = 1; i < busSpds.length; i++) {
		const dtBetween = (busSpds[i].ts - busSpds[i - 1].ts) / 1000;
		if (dtBetween > 120) continue;
		const avgSpeed = (busSpds[i].speed + busSpds[i - 1].speed) / 2;
		const jit = Math.abs(busSpds[i].speed - busSpds[i - 1].speed);
		let bucket;
		if (avgSpeed < 5) bucket = '0-5';
		else if (avgSpeed < 15) bucket = '5-15';
		else if (avgSpeed < 30) bucket = '15-30';
		else if (avgSpeed < 50) bucket = '30-50';
		else bucket = '50+';
		if (!jitterByRange.has(bucket)) jitterByRange.set(bucket, []);
		jitterByRange.get(bucket).push(jit);
	}
}
console.log(`${'Range'.padEnd(10)}| ${'N'.padStart(8)} | ${'P50'.padStart(7)} | ${'P75'.padStart(7)} | ${'P90'.padStart(7)} | ${'P95'.padStart(7)} | ${'Mean'.padStart(7)}`);
console.log('-'.repeat(62));
for (const bucket of ['0-5', '5-15', '15-30', '30-50', '50+']) {
	const vals = jitterByRange.get(bucket);
	if (!vals || vals.length === 0) continue;
	const d = pctiles(vals);
	console.log(`${bucket.padEnd(10)}| ${String(d.count).padStart(8)} | ${fmtNum(d.P50).padStart(7)} | ${fmtNum(d.P75).padStart(7)} | ${fmtNum(d.P90).padStart(7)} | ${fmtNum(d.P95).padStart(7)} | ${fmtNum(d.mean).padStart(7)}`);
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Speed Profile Characteristics (5 representative buses)
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 6: SPEED PROFILE CHARACTERISTICS');
console.log('='.repeat(72));

// Pick 5 buses with >500 non-stale speed readings and good time coverage
const busWithMost = [...pairsPerBus.entries()]
	.filter(([, spds]) => spds.length > 500)
	.sort((a, b) => b[1].length - a[1].length);

const representativeBuses = busWithMost.slice(0, 5);

for (const [busId, busSpds] of representativeBuses) {
	const totalDuration = (busSpds[busSpds.length - 1].ts - busSpds[0].ts) / 1000; // seconds
	const hours = totalDuration / 3600;

	console.log(`\n─── ${busId} (${busSpds.length} readings, ${fmtNum(hours, 1)} hours, route ${busSpds[0].route}) ───`);

	// Time at different speed ranges
	const timeInRange = { '0-5': 0, '5-15': 0, '15-30': 0, '30-50': 0, '50+': 0 };
	let totalTimeAccounted = 0;
	let timeAccelerating = 0;
	let timeCruising = 0;
	let timeDecelerating = 0;

	for (let i = 1; i < busSpds.length; i++) {
		const dtBetween = (busSpds[i].ts - busSpds[i - 1].ts) / 1000;
		if (dtBetween > 120) continue; // skip gaps
		totalTimeAccounted += dtBetween;

		const avgSpeed = (busSpds[i].speed + busSpds[i - 1].speed) / 2;
		if (avgSpeed < 5) timeInRange['0-5'] += dtBetween;
		else if (avgSpeed < 15) timeInRange['5-15'] += dtBetween;
		else if (avgSpeed < 30) timeInRange['15-30'] += dtBetween;
		else if (avgSpeed < 50) timeInRange['30-50'] += dtBetween;
		else timeInRange['50+'] += dtBetween;

		// Classify: accelerating, decelerating, cruising
		const dv = busSpds[i].speed - busSpds[i - 1].speed;
		if (dv > 3) timeAccelerating += dtBetween;
		else if (dv < -3) timeDecelerating += dtBetween;
		else timeCruising += dtBetween;
	}

	console.log(`  Total accounted time: ${fmtNum(totalTimeAccounted / 60, 1)} min`);
	console.log(`  Time in speed ranges:`);
	for (const [range, t] of Object.entries(timeInRange)) {
		console.log(`    ${range.padEnd(8)} km/h: ${fmtNum(t / 60, 1).padStart(6)} min (${fmtNum(t / totalTimeAccounted * 100, 1)}%)`);
	}

	console.log(`  Driving behavior:`);
	console.log(`    Accelerating (dv>3): ${fmtNum(timeAccelerating / 60, 1)} min (${fmtNum(timeAccelerating / totalTimeAccounted * 100, 1)}%)`);
	console.log(`    Cruising (|dv|<=3) : ${fmtNum(timeCruising / 60, 1)} min (${fmtNum(timeCruising / totalTimeAccounted * 100, 1)}%)`);
	console.log(`    Decelerating (dv<-3): ${fmtNum(timeDecelerating / 60, 1)} min (${fmtNum(timeDecelerating / totalTimeAccounted * 100, 1)}%)`);

	// Speed stats
	const speeds = busSpds.map(s => s.speed);
	const d = pctiles(speeds);
	console.log(`  Speed stats: P25=${fmtNum(d.P25)} P50=${fmtNum(d.P50)} P75=${fmtNum(d.P75)} P90=${fmtNum(d.P90)} Max=${fmtNum(d.max)} Mean=${fmtNum(d.mean)} km/h`);
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: Stop Detection from Speed Data
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 7: STOP DETECTION FROM SPEED DATA');
console.log('='.repeat(72));

// A "stop" = period where ALL consecutive readings show speed < 3 km/h (near-zero)
// lasting > 15 seconds

const allStops = [];     // {busId, startTs, endTs, duration, route}
let totalStopDuration = 0;

for (const [busId, records] of byBus) {
	if (records.length < 5) continue;

	// First compute all consecutive speeds including stale ones
	let stopStart = null;
	let lastMovingTs = records[0].ts;

	for (let i = 1; i < records.length; i++) {
		const prev = records[i - 1];
		const curr = records[i];
		const dt = (curr.ts - prev.ts) / 1000;
		if (dt <= 0) continue;
		const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
		const speed = (dist / 1000) / (dt / 3600);

		if (speed < 3) { // near-zero
			if (stopStart === null) {
				stopStart = prev.ts;
			}
		} else {
			if (stopStart !== null) {
				const duration = (prev.ts - stopStart) / 1000;
				if (duration >= 15) {
					allStops.push({
						busId, route: curr.route,
						startTs: stopStart, endTs: prev.ts,
						duration,
					});
					totalStopDuration += duration;
				}
				stopStart = null;
			}
		}
	}
	// Handle trailing stop
	if (stopStart !== null) {
		const last = records[records.length - 1];
		const duration = (last.ts - stopStart) / 1000;
		if (duration >= 15) {
			allStops.push({
				busId, route: last.route,
				startTs: stopStart, endTs: last.ts,
				duration,
			});
			totalStopDuration += duration;
		}
	}
}

console.log(`\nTotal stops detected (>15s near-zero speed): ${allStops.length}`);

const stopDurations = allStops.map(s => s.duration);
if (stopDurations.length > 0) {
	const d = pctiles(stopDurations);
	console.log(`\nStop Duration Distribution (seconds):`);
	console.log(`  Min   : ${fmtNum(d.min, 0)}`);
	console.log(`  P10   : ${fmtNum(d.P10, 0)}`);
	console.log(`  P25   : ${fmtNum(d.P25, 0)}`);
	console.log(`  P50   : ${fmtNum(d.P50, 0)}`);
	console.log(`  P75   : ${fmtNum(d.P75, 0)}`);
	console.log(`  P90   : ${fmtNum(d.P90, 0)}`);
	console.log(`  P95   : ${fmtNum(d.P95, 0)}`);
	console.log(`  P99   : ${fmtNum(d.P99, 0)}`);
	console.log(`  Max   : ${fmtNum(d.max, 0)}`);
	console.log(`  Mean  : ${fmtNum(d.mean, 1)}`);
	console.log(`  Total stop time: ${fmtNum(totalStopDuration / 3600, 1)} hours`);
}

// Stops per bus per hour
const stopsPerBus = new Map();
for (const s of allStops) {
	if (!stopsPerBus.has(s.busId)) stopsPerBus.set(s.busId, []);
	stopsPerBus.get(s.busId).push(s);
}

const stopsPerHourList = [];
for (const [busId, stops] of stopsPerBus) {
	const recs = byBus.get(busId);
	const busHours = (recs[recs.length - 1].ts - recs[0].ts) / 3600000;
	if (busHours > 0.5) { // at least 30 min of data
		stopsPerHourList.push(stops.length / busHours);
	}
}

if (stopsPerHourList.length > 0) {
	const d = pctiles(stopsPerHourList);
	console.log(`\nStops per Bus per Hour:`);
	console.log(`  P25=${fmtNum(d.P25, 1)} P50=${fmtNum(d.P50, 1)} P75=${fmtNum(d.P75, 1)} P90=${fmtNum(d.P90, 1)} Mean=${fmtNum(d.mean, 1)}`);
}

// Stop duration histogram
const stopHistBuckets = [15, 30, 60, 120, 180, 300, 600, 1200, 3600, Infinity];
console.log(`\nStop Duration Histogram:`);
for (let i = 0; i < stopHistBuckets.length - 1; i++) {
	const lo = stopHistBuckets[i], hi = stopHistBuckets[i + 1];
	const cnt = stopDurations.filter(d => d >= lo && d < hi).length;
	const pct = (cnt / stopDurations.length * 100).toFixed(1);
	const label = hi === Infinity ? `${lo}s+` : `${lo}-${hi}s`;
	console.log(`  ${label.padEnd(12)}: ${String(cnt).padStart(6)} (${pct.padStart(5)}%)`);
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: Trip Segment Analysis
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n' + '='.repeat(72));
console.log('SECTION 8: TRIP SEGMENT ANALYSIS');
console.log('='.repeat(72));

// A "trip segment" = continuous period of movement separated by stops > 60s

const allSegments = [];

for (const [busId, records] of byBus) {
	if (records.length < 10) continue;

	let segStart = 0;
	let lastMovingIdx = 0;
	let segDist = 0;
	let inStop = false;
	let stopStartTs = 0;

	for (let i = 1; i < records.length; i++) {
		const prev = records[i - 1];
		const curr = records[i];
		const dt = (curr.ts - prev.ts) / 1000;
		if (dt <= 0) continue;
		const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
		const speed = dt > 0 ? (dist / 1000) / (dt / 3600) : 0;

		if (speed < 3) {
			if (!inStop) {
				inStop = true;
				stopStartTs = prev.ts;
			}
			const stopDur = (curr.ts - stopStartTs) / 1000;
			if (stopDur >= 60 && segStart < i) {
				// End current segment
				const segEnd = lastMovingIdx > segStart ? lastMovingIdx : i - 1;
				const segDuration = (records[segEnd].ts - records[segStart].ts) / 1000;
				if (segDuration > 10) {
					// Compute total distance
					let totalDist = 0;
					for (let j = segStart + 1; j <= segEnd; j++) {
						totalDist += haversineM(records[j - 1].lat, records[j - 1].lng, records[j].lat, records[j].lng);
					}
					const avgSpeed = segDuration > 0 ? (totalDist / 1000) / (segDuration / 3600) : 0;
					allSegments.push({
						busId, route: records[segStart].route,
						duration: segDuration,
						distance: totalDist,
						avgSpeed,
						readings: segEnd - segStart + 1,
						startTs: records[segStart].ts,
					});
				}
				segStart = i;
			}
		} else {
			if (inStop) {
				inStop = false;
			}
			lastMovingIdx = i;
			segDist += dist;
		}
	}

	// Final segment
	if (segStart < records.length - 1) {
		const segEnd = records.length - 1;
		const segDuration = (records[segEnd].ts - records[segStart].ts) / 1000;
		if (segDuration > 10) {
			let totalDist = 0;
			for (let j = segStart + 1; j <= segEnd; j++) {
				totalDist += haversineM(records[j - 1].lat, records[j - 1].lng, records[j].lat, records[j].lng);
			}
			const avgSpeed = segDuration > 0 ? (totalDist / 1000) / (segDuration / 3600) : 0;
			allSegments.push({
				busId, route: records[segStart].route,
				duration: segDuration,
				distance: totalDist,
				avgSpeed,
				readings: segEnd - segStart + 1,
				startTs: records[segStart].ts,
			});
		}
	}
}

console.log(`\nTotal trip segments: ${allSegments.length}`);

const segDurations = allSegments.map(s => s.duration);
const segDistances = allSegments.map(s => s.distance);
const segAvgSpeeds = allSegments.filter(s => s.avgSpeed > 0).map(s => s.avgSpeed);

if (segDurations.length > 0) {
	const durD = pctiles(segDurations);
	console.log(`\nSegment Duration (seconds):`);
	console.log(`  P10=${fmtNum(durD.P10, 0)} P25=${fmtNum(durD.P25, 0)} P50=${fmtNum(durD.P50, 0)} P75=${fmtNum(durD.P75, 0)} P90=${fmtNum(durD.P90, 0)} P95=${fmtNum(durD.P95, 0)} Max=${fmtNum(durD.max, 0)} Mean=${fmtNum(durD.mean, 0)}`);

	const distD = pctiles(segDistances);
	console.log(`\nSegment Distance (meters):`);
	console.log(`  P10=${fmtNum(distD.P10, 0)} P25=${fmtNum(distD.P25, 0)} P50=${fmtNum(distD.P50, 0)} P75=${fmtNum(distD.P75, 0)} P90=${fmtNum(distD.P90, 0)} P95=${fmtNum(distD.P95, 0)} Max=${fmtNum(distD.max, 0)} Mean=${fmtNum(distD.mean, 0)}`);

	const spdD = pctiles(segAvgSpeeds);
	console.log(`\nSegment Average Speed (km/h):`);
	console.log(`  P10=${fmtNum(spdD.P10)} P25=${fmtNum(spdD.P25)} P50=${fmtNum(spdD.P50)} P75=${fmtNum(spdD.P75)} P90=${fmtNum(spdD.P90)} P95=${fmtNum(spdD.P95)} Max=${fmtNum(spdD.max)} Mean=${fmtNum(spdD.mean)}`);
}

// Segments per bus per hour
const segsPerBus = new Map();
for (const s of allSegments) {
	if (!segsPerBus.has(s.busId)) segsPerBus.set(s.busId, []);
	segsPerBus.get(s.busId).push(s);
}

const segsPerHourList = [];
for (const [busId, segs] of segsPerBus) {
	const recs = byBus.get(busId);
	const busHours = (recs[recs.length - 1].ts - recs[0].ts) / 3600000;
	if (busHours > 0.5) {
		segsPerHourList.push(segs.length / busHours);
	}
}

if (segsPerHourList.length > 0) {
	const d = pctiles(segsPerHourList);
	console.log(`\nSegments per Bus per Hour:`);
	console.log(`  P25=${fmtNum(d.P25, 1)} P50=${fmtNum(d.P50, 1)} P75=${fmtNum(d.P75, 1)} P90=${fmtNum(d.P90, 1)} Mean=${fmtNum(d.mean, 1)}`);
}

// Duration histogram
const segDurBuckets = [10, 30, 60, 120, 300, 600, 1200, 1800, 3600, Infinity];
console.log(`\nSegment Duration Histogram:`);
for (let i = 0; i < segDurBuckets.length - 1; i++) {
	const lo = segDurBuckets[i], hi = segDurBuckets[i + 1];
	const cnt = segDurations.filter(d => d >= lo && d < hi).length;
	const pct = (cnt / segDurations.length * 100).toFixed(1);
	const label = hi === Infinity ? `${lo}s+` : `${lo}-${hi}s`;
	console.log(`  ${label.padEnd(14)}: ${String(cnt).padStart(6)} (${pct.padStart(5)}%)`);
}

// Distance histogram
const segDistBuckets = [0, 100, 250, 500, 1000, 2000, 5000, 10000, 20000, Infinity];
console.log(`\nSegment Distance Histogram:`);
for (let i = 0; i < segDistBuckets.length - 1; i++) {
	const lo = segDistBuckets[i], hi = segDistBuckets[i + 1];
	const cnt = segDistances.filter(d => d >= lo && d < hi).length;
	const pct = (cnt / segDistances.length * 100).toFixed(1);
	const label = hi === Infinity ? `${lo}m+` : `${lo}-${hi}m`;
	console.log(`  ${label.padEnd(14)}: ${String(cnt).padStart(6)} (${pct.padStart(5)}%)`);
}

// ── Fleet-wide summary stats ─────────────────────────────────────────────

console.log('\n' + '='.repeat(72));
console.log('FLEET-WIDE SUMMARY');
console.log('='.repeat(72));

const totalBuses = byBus.size;
const totalRecords = rawLines.length;
const totalPairs = allSpeeds.length;
const firstTs = Math.min(...[...byBus.values()].map(r => r[0].ts));
const lastTs = Math.max(...[...byBus.values()].map(r => r[r.length - 1].ts));
const dataSpanHours = (lastTs - firstTs) / 3600000;

// Total distance
let totalFleetDistance = 0;
for (const [, busSpds] of pairsPerBus) {
	for (const s of busSpds) {
		totalFleetDistance += s.dist;
	}
}

console.log(`\nDataset: 2026-03-11`);
console.log(`Records: ${totalRecords}`);
console.log(`Buses: ${totalBuses}`);
console.log(`Routes: ${routeKeys.length} (${routeKeys.join(', ')})`);
console.log(`Time span: ${epochToTimeStr(firstTs)} to ${epochToTimeStr(lastTs)} (${fmtNum(dataSpanHours, 1)} hours)`);
console.log(`Valid speed pairs (dt>0, dist>0.5m): ${totalPairs}`);
console.log(`Total fleet distance (sum of all Haversine displacements): ${fmtNum(totalFleetDistance / 1000, 1)} km`);
console.log(`Median speed: ${fmtNum(globalDist.P50)} km/h`);
console.log(`Mean speed: ${fmtNum(globalDist.mean)} km/h`);
console.log(`Total stops detected: ${allStops.length}`);
console.log(`Total stop time: ${fmtNum(totalStopDuration / 3600, 1)} hours`);
console.log(`Trip segments: ${allSegments.length}`);
console.log(`Readings with speed > 90 km/h: ${anomalies90.length} (${(anomalies90.length / totalPairs * 100).toFixed(3)}%)`);
console.log(`Readings with speed > 120 km/h: ${anomalies120.length} (${(anomalies120.length / totalPairs * 100).toFixed(3)}%)`);
console.log(`Readings with impossible acceleration: ${impossibleCount} (${impossiblePct}%)`);
console.log(`Phantom speed at stops (median): ${phantomSpeeds.stopped.length > 0 ? fmtNum(pctiles(phantomSpeeds.stopped).P50) : 'N/A'} km/h`);
console.log(`Raw speed jitter (median |dv|): ${fmtNum(rawJitterDist.P50)} km/h`);

console.log('\n=== ANALYSIS COMPLETE ===');
