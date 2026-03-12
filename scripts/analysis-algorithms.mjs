#!/usr/bin/env node
/**
 * Comprehensive GPS algorithm analysis for Straeto bus fleet.
 *
 * Analyzes the full-day dataset (977K records, 128 buses, 25 routes)
 * to produce empirical findings for Kalman filter tuning, stationarity
 * detection, animation prediction, polling optimization, and speed
 * limit matching radius.
 *
 * Output: structured findings printed to stdout, suitable for piping
 * into a markdown report.
 */

import { readFileSync } from 'fs';

const DATASET = 'data/2026-03-11.jsonl';

// ── Geo helpers ───────────────────────────────────────────────────────

const EARTH_R = 6_371_000;
const LAT_M = 111_000; // meters per degree latitude at 64N
const LNG_M = 48_600;  // meters per degree longitude at 64N

function haversineM(lat1, lng1, lat2, lng2) {
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLng = (lng2 - lng1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLng / 2) ** 2;
	return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function speedKmh(distM, dtS) {
	return dtS > 0 ? (distM / 1000) / (dtS / 3600) : 0;
}

function percentile(arr, p) {
	if (arr.length === 0) return NaN;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(arr) {
	return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
}

function stddev(arr) {
	if (arr.length < 2) return NaN;
	const m = mean(arr);
	return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// ── Load and parse dataset ────────────────────────────────────────────

console.error('Loading dataset...');
const raw = readFileSync(DATASET, 'utf8');
const lines = raw.trim().split('\n');
console.error(`Loaded ${lines.length} records`);

const byBus = new Map();
for (const line of lines) {
	const r = JSON.parse(line);
	if (!byBus.has(r.b)) byBus.set(r.b, []);
	byBus.get(r.b).push({ lat: r.la, lng: r.ln, ts: r.ts, route: r.r, d: r.d });
}

// Sort each bus by timestamp
for (const [, recs] of byBus) recs.sort((a, b) => a.ts - b.ts);

const busCount = byBus.size;
const routeSet = new Set();
for (const [, recs] of byBus) for (const r of recs) routeSet.add(r.route);
console.error(`${busCount} buses, ${routeSet.size} routes\n`);

// ── Stale detection: find real vs stale readings per bus ──────────────

const STALE_THRESH_M = 1.0;

// Returns { realPairs: [{prev, curr, dt, dist}], stalePairs: [...] }
function classifyReadings(records) {
	const realPairs = [];
	const stalePairs = [];
	let lastRealIdx = 0;

	for (let i = 1; i < records.length; i++) {
		const prev = records[i - 1];
		const curr = records[i];
		const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);

		if (dist < STALE_THRESH_M) {
			stalePairs.push({ prev, curr, dt: (curr.ts - prev.ts) / 1000, dist });
		} else {
			const realDt = (curr.ts - records[lastRealIdx].ts) / 1000;
			const realDist = haversineM(records[lastRealIdx].lat, records[lastRealIdx].lng, curr.lat, curr.lng);
			realPairs.push({
				prev: records[lastRealIdx], curr, dt: realDt, dist: realDist,
				rawDt: (curr.ts - prev.ts) / 1000, rawDist: dist,
			});
			lastRealIdx = i;
		}
	}
	return { realPairs, stalePairs };
}


// =====================================================================
//  ANALYSIS 1: Empirical GPS Noise Measurement
// =====================================================================

console.log('# ANALYSIS 1: Empirical GPS Noise');
console.log('');

// Find stopped episodes: same position within 1m for 10+ consecutive readings
const stoppedEpisodes = []; // { busId, centroidLat, centroidLng, positions: [{lat,lng}], duration_s }

for (const [busId, records] of byBus) {
	if (records.length < 15) continue;

	let runStart = 0;

	for (let i = 1; i <= records.length; i++) {
		const isEnd = i === records.length;
		const dist = isEnd ? Infinity : haversineM(records[i - 1].lat, records[i - 1].lng, records[i].lat, records[i].lng);

		if (dist >= STALE_THRESH_M || isEnd) {
			const runLen = i - runStart;
			if (runLen >= 10) {
				const positions = records.slice(runStart, i);
				const cLat = mean(positions.map(p => p.lat));
				const cLng = mean(positions.map(p => p.lng));
				const duration = (positions[positions.length - 1].ts - positions[0].ts) / 1000;

				stoppedEpisodes.push({
					busId, centroidLat: cLat, centroidLng: cLng,
					positions, duration,
				});
			}
			runStart = i;
		}
	}
}

// For each stopped episode, compute scatter in meters around centroid
const latScattersM = [];
const lngScattersM = [];
const totalScattersM = [];

for (const ep of stoppedEpisodes) {
	const latDeviations = [];
	const lngDeviations = [];

	for (const p of ep.positions) {
		const dLatM = (p.lat - ep.centroidLat) * LAT_M;
		const dLngM = (p.lng - ep.centroidLng) * LNG_M;
		latDeviations.push(dLatM);
		lngDeviations.push(dLngM);
		totalScattersM.push(Math.sqrt(dLatM * dLatM + dLngM * dLngM));
	}

	latScattersM.push(stddev(latDeviations));
	lngScattersM.push(stddev(lngDeviations));
}

// Also look at the raw position uniqueness within stopped episodes
// Many stopped episodes might have identical coordinates (exact same fix repeated)
let episodesWithIdenticalPositions = 0;
let episodesWithVariation = 0;
const variationAmountsM = [];

for (const ep of stoppedEpisodes) {
	const uniquePositions = new Set(ep.positions.map(p => `${p.lat},${p.lng}`));
	if (uniquePositions.size === 1) {
		episodesWithIdenticalPositions++;
	} else {
		episodesWithVariation++;
		// Measure the spread among unique positions
		const posArr = [...uniquePositions].map(s => {
			const [la, ln] = s.split(',').map(Number);
			return { lat: la, lng: ln };
		});
		let maxSpread = 0;
		for (let i = 0; i < posArr.length; i++) {
			for (let j = i + 1; j < posArr.length; j++) {
				maxSpread = Math.max(maxSpread, haversineM(posArr[i].lat, posArr[i].lng, posArr[j].lat, posArr[j].lng));
			}
		}
		variationAmountsM.push(maxSpread);
	}
}

console.log(`Stopped episodes found (>=10 consecutive readings within 1m): ${stoppedEpisodes.length}`);
console.log(`  Episodes with ALL identical positions: ${episodesWithIdenticalPositions} (${(episodesWithIdenticalPositions / stoppedEpisodes.length * 100).toFixed(1)}%)`);
console.log(`  Episodes with position variation: ${episodesWithVariation} (${(episodesWithVariation / stoppedEpisodes.length * 100).toFixed(1)}%)`);
console.log('');

if (episodesWithVariation > 0) {
	console.log('Position variation in non-identical stopped episodes:');
	console.log(`  Max spread P50: ${percentile(variationAmountsM, 50).toFixed(3)}m`);
	console.log(`  Max spread P90: ${percentile(variationAmountsM, 90).toFixed(3)}m`);
	console.log(`  Max spread P99: ${percentile(variationAmountsM, 99).toFixed(3)}m`);
	console.log(`  Max spread max: ${variationAmountsM.reduce((a,b) => a > b ? a : b, 0).toFixed(3)}m`);
	console.log('');
}

// Filter to episodes with actual variation for sigma estimation
const validScatters = latScattersM.filter(s => !isNaN(s) && s > 0);
const validLngScatters = lngScattersM.filter(s => !isNaN(s) && s > 0);

if (validScatters.length > 0) {
	console.log(`GPS noise from ${validScatters.length} episodes with measurable scatter:`);
	console.log(`  Lat scatter sigma: mean=${mean(validScatters).toFixed(3)}m, median=${percentile(validScatters, 50).toFixed(3)}m, P90=${percentile(validScatters, 90).toFixed(3)}m`);
	console.log(`  Lng scatter sigma: mean=${mean(validLngScatters).toFixed(3)}m, median=${percentile(validLngScatters, 50).toFixed(3)}m, P90=${percentile(validLngScatters, 90).toFixed(3)}m`);
} else {
	console.log('No stopped episodes with measurable GPS scatter (all positions identical).');
}

// Compute sigma from ALL individual deviations
if (totalScattersM.length > 0) {
	console.log(`\nTotal position deviations from centroids (${totalScattersM.length} measurements):`);
	console.log(`  Mean: ${mean(totalScattersM).toFixed(4)}m`);
	console.log(`  P50: ${percentile(totalScattersM, 50).toFixed(4)}m`);
	console.log(`  P90: ${percentile(totalScattersM, 90).toFixed(4)}m`);
	console.log(`  P95: ${percentile(totalScattersM, 95).toFixed(4)}m`);
	console.log(`  P99: ${percentile(totalScattersM, 99).toFixed(4)}m`);
	console.log(`  Max: ${totalScattersM.reduce((a,b) => a > b ? a : b, 0).toFixed(4)}m`);
}

// Also measure: when the bus is at a "known stop" for a long time, what is the
// position scatter across the full stop duration?
// Use only long stops (>60s) for better statistics
const longStops = stoppedEpisodes.filter(e => e.duration > 60);
console.log(`\nLong stops (>60s): ${longStops.length}`);

if (longStops.length > 0) {
	const longStopScatters = [];
	for (const ep of longStops) {
		for (const p of ep.positions) {
			const dM = haversineM(p.lat, p.lng, ep.centroidLat, ep.centroidLng);
			longStopScatters.push(dM);
		}
	}
	console.log(`  Position scatter: mean=${mean(longStopScatters).toFixed(4)}m, P50=${percentile(longStopScatters, 50).toFixed(4)}m, P95=${percentile(longStopScatters, 95).toFixed(4)}m`);
}

// Now look at GPS noise for MOVING buses by examining consecutive real-update
// position jumps. If a bus is moving at roughly constant speed on a straight road,
// deviations from the linear path indicate GPS noise.
console.log('\nGPS noise estimate from moving buses (lateral deviation from 3-point line):');
const lateralDeviationsM = [];

for (const [busId, records] of byBus) {
	const { realPairs } = classifyReadings(records);
	if (realPairs.length < 5) continue;

	// Build real update sequence
	const realUpdates = [realPairs[0].prev];
	for (const rp of realPairs) realUpdates.push(rp.curr);

	for (let i = 1; i < realUpdates.length - 1; i++) {
		const A = realUpdates[i - 1];
		const B = realUpdates[i];
		const C = realUpdates[i + 1];

		// Speed check: only use if segment speeds are consistent (within 30%)
		const dtAB = (B.ts - A.ts) / 1000;
		const dtBC = (C.ts - B.ts) / 1000;
		if (dtAB <= 0 || dtBC <= 0 || dtAB > 15 || dtBC > 15) continue;

		const distAB = haversineM(A.lat, A.lng, B.lat, B.lng);
		const distBC = haversineM(B.lat, B.lng, C.lat, C.lng);
		const speedAB = speedKmh(distAB, dtAB);
		const speedBC = speedKmh(distBC, dtBC);

		// Only use segments with reasonable speed (10-70 kmh) and consistent
		if (speedAB < 10 || speedAB > 70 || speedBC < 10 || speedBC > 70) continue;
		const speedRatio = Math.min(speedAB, speedBC) / Math.max(speedAB, speedBC);
		if (speedRatio < 0.7) continue;

		// Compute lateral deviation of B from line AC
		// Project to local meters
		const ax = A.lng * LNG_M, ay = A.lat * LAT_M;
		const bx = B.lng * LNG_M, by = B.lat * LAT_M;
		const cx = C.lng * LNG_M, cy = C.lat * LAT_M;

		const dx = cx - ax, dy = cy - ay;
		const lenSq = dx * dx + dy * dy;
		if (lenSq < 1) continue;

		// Midpoint of AC
		const midX = (ax + cx) / 2;
		const midY = (ay + cy) / 2;
		// Distance from B to line AC (perpendicular)
		const crossProduct = Math.abs((cx - ax) * (ay - by) - (ax - bx) * (cy - ay));
		const lineLen = Math.sqrt(lenSq);
		const perpDist = crossProduct / lineLen;

		lateralDeviationsM.push(perpDist);
	}
}

if (lateralDeviationsM.length > 0) {
	console.log(`  Measurements: ${lateralDeviationsM.length}`);
	console.log(`  Mean lateral deviation: ${mean(lateralDeviationsM).toFixed(2)}m`);
	console.log(`  P50: ${percentile(lateralDeviationsM, 50).toFixed(2)}m`);
	console.log(`  P75: ${percentile(lateralDeviationsM, 75).toFixed(2)}m`);
	console.log(`  P90: ${percentile(lateralDeviationsM, 90).toFixed(2)}m`);
	console.log(`  P95: ${percentile(lateralDeviationsM, 95).toFixed(2)}m`);
	console.log(`  P99: ${percentile(lateralDeviationsM, 99).toFixed(2)}m`);
	console.log(`  Implied sigma_gps (= P50 * sqrt(3/2)): ${(percentile(lateralDeviationsM, 50) * Math.sqrt(1.5)).toFixed(2)}m`);
}


// =====================================================================
//  ANALYSIS 2: Effective Update Interval Distribution
// =====================================================================

console.log('\n\n# ANALYSIS 2: Effective Update Interval Distribution');
console.log('');

const allRealGapsS = [];
const perRouteRealGaps = new Map();
const allRawGapsS = [];

for (const [busId, records] of byBus) {
	if (records.length < 10) continue;
	const { realPairs } = classifyReadings(records);
	const route = records[0].route;

	for (const rp of realPairs) {
		if (rp.dt > 0 && rp.dt < 300) { // exclude huge gaps (bus went off-service)
			allRealGapsS.push(rp.dt);
			if (!perRouteRealGaps.has(route)) perRouteRealGaps.set(route, []);
			perRouteRealGaps.get(route).push(rp.dt);
		}
	}

	for (let i = 1; i < records.length; i++) {
		const dt = (records[i].ts - records[i - 1].ts) / 1000;
		if (dt > 0) allRawGapsS.push(dt);
	}
}

console.log('Raw inter-reading gaps (all readings, including stale):');
console.log(`  Total: ${allRawGapsS.length}`);
console.log(`  P10: ${percentile(allRawGapsS, 10).toFixed(1)}s`);
console.log(`  P25: ${percentile(allRawGapsS, 25).toFixed(1)}s`);
console.log(`  P50: ${percentile(allRawGapsS, 50).toFixed(1)}s`);
console.log(`  P75: ${percentile(allRawGapsS, 75).toFixed(1)}s`);
console.log(`  P90: ${percentile(allRawGapsS, 90).toFixed(1)}s`);
console.log(`  P95: ${percentile(allRawGapsS, 95).toFixed(1)}s`);
console.log(`  P99: ${percentile(allRawGapsS, 99).toFixed(1)}s`);
console.log(`  Mean: ${mean(allRawGapsS).toFixed(1)}s`);

console.log('\nReal update gaps (after removing stale readings):');
console.log(`  Total real updates: ${allRealGapsS.length}`);
console.log(`  P10: ${percentile(allRealGapsS, 10).toFixed(1)}s`);
console.log(`  P25: ${percentile(allRealGapsS, 25).toFixed(1)}s`);
console.log(`  P50: ${percentile(allRealGapsS, 50).toFixed(1)}s`);
console.log(`  P75: ${percentile(allRealGapsS, 75).toFixed(1)}s`);
console.log(`  P90: ${percentile(allRealGapsS, 90).toFixed(1)}s`);
console.log(`  P95: ${percentile(allRealGapsS, 95).toFixed(1)}s`);
console.log(`  P99: ${percentile(allRealGapsS, 99).toFixed(1)}s`);
console.log(`  Mean: ${mean(allRealGapsS).toFixed(1)}s`);

// Bucket distribution
const gapBuckets = [0, 2, 4, 6, 8, 10, 12, 15, 20, 30, 60, 120, 300];
console.log('\nReal update gap bucket distribution:');
for (let i = 0; i < gapBuckets.length; i++) {
	const lo = gapBuckets[i];
	const hi = i < gapBuckets.length - 1 ? gapBuckets[i + 1] : Infinity;
	const count = allRealGapsS.filter(g => g >= lo && g < hi).length;
	const pct = (count / allRealGapsS.length * 100).toFixed(1);
	console.log(`  ${lo}-${hi === Infinity ? '...' : hi}s: ${count} (${pct}%)`);
}

// Per-route breakdown
console.log('\nPer-route median real update gap:');
const routeGapSummary = [];
for (const [route, gaps] of perRouteRealGaps) {
	if (gaps.length < 100) continue;
	routeGapSummary.push({
		route,
		count: gaps.length,
		p50: percentile(gaps, 50),
		p90: percentile(gaps, 90),
		mean: mean(gaps),
	});
}
routeGapSummary.sort((a, b) => parseInt(a.route) - parseInt(b.route));
console.log('  Route | Count  | P50(s) | P90(s) | Mean(s)');
for (const rs of routeGapSummary) {
	console.log(`  ${rs.route.padStart(5)} | ${String(rs.count).padStart(6)} | ${rs.p50.toFixed(1).padStart(6)} | ${rs.p90.toFixed(1).padStart(6)} | ${rs.mean.toFixed(1).padStart(7)}`);
}

// Stale rate computation
const totalRaw = allRawGapsS.length;
const totalReal = allRealGapsS.length;
const staleRate = ((totalRaw - totalReal) / totalRaw * 100).toFixed(1);
console.log(`\nOverall stale rate: ${staleRate}% of readings are stale`);


// =====================================================================
//  ANALYSIS 3: Movement Characteristics / Acceleration
// =====================================================================

console.log('\n\n# ANALYSIS 3: Movement Characteristics (Acceleration)');
console.log('');

const allAccelMs2 = [];
const accelBySpeedBand = new Map(); // speed band -> accels
const speedBands = [[0, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, 60], [60, 80]];
for (const band of speedBands) accelBySpeedBand.set(`${band[0]}-${band[1]}`, []);

for (const [busId, records] of byBus) {
	if (records.length < 20) continue;
	const { realPairs } = classifyReadings(records);
	if (realPairs.length < 3) continue;

	// Build speed sequence from real updates
	const speeds = []; // { ts, speedMs, distM, dtS }
	for (const rp of realPairs) {
		if (rp.dt > 0 && rp.dt < 30 && rp.dist > 1) { // reasonable readings
			const spd = rp.dist / rp.dt; // m/s
			speeds.push({ ts: rp.curr.ts, speedMs: spd, dtS: rp.dt, distM: rp.dist });
		}
	}

	// Compute acceleration between consecutive speed estimates
	for (let i = 1; i < speeds.length; i++) {
		const prev = speeds[i - 1];
		const curr = speeds[i];
		const dt = (curr.ts - prev.ts) / 1000;
		if (dt <= 0 || dt > 30) continue;

		const accel = (curr.speedMs - prev.speedMs) / dt;
		const avgSpeedKmh = (curr.speedMs + prev.speedMs) / 2 * 3.6;

		// Skip outliers (>8 m/s^2 is not physical for a city bus)
		if (Math.abs(accel) > 8) continue;

		allAccelMs2.push(accel);

		for (const band of speedBands) {
			if (avgSpeedKmh >= band[0] && avgSpeedKmh < band[1]) {
				accelBySpeedBand.get(`${band[0]}-${band[1]}`).push(accel);
			}
		}
	}
}

console.log(`Total acceleration measurements: ${allAccelMs2.length}`);
const absAccel = allAccelMs2.map(Math.abs);
console.log(`\nAbsolute acceleration distribution (m/s^2):`);
console.log(`  P50: ${percentile(absAccel, 50).toFixed(3)}`);
console.log(`  P75: ${percentile(absAccel, 75).toFixed(3)}`);
console.log(`  P90: ${percentile(absAccel, 90).toFixed(3)}`);
console.log(`  P95: ${percentile(absAccel, 95).toFixed(3)}`);
console.log(`  P99: ${percentile(absAccel, 99).toFixed(3)}`);
console.log(`  Mean: ${mean(absAccel).toFixed(3)}`);
console.log(`  Std: ${stddev(absAccel).toFixed(3)}`);

console.log(`\nSigned acceleration distribution (m/s^2):`);
console.log(`  Mean: ${mean(allAccelMs2).toFixed(4)}`);
console.log(`  Std: ${stddev(allAccelMs2).toFixed(3)}`);
console.log(`  P5: ${percentile(allAccelMs2, 5).toFixed(3)}`);
console.log(`  P25: ${percentile(allAccelMs2, 25).toFixed(3)}`);
console.log(`  P50: ${percentile(allAccelMs2, 50).toFixed(3)}`);
console.log(`  P75: ${percentile(allAccelMs2, 75).toFixed(3)}`);
console.log(`  P95: ${percentile(allAccelMs2, 95).toFixed(3)}`);

console.log('\nAcceleration by speed band:');
console.log('  Band(km/h) | Count  | |accel| P50 | |accel| P90 | |accel| P95 | Std');
for (const band of speedBands) {
	const key = `${band[0]}-${band[1]}`;
	const vals = accelBySpeedBand.get(key);
	if (vals.length < 10) continue;
	const absVals = vals.map(Math.abs);
	console.log(`  ${key.padEnd(12)} | ${String(vals.length).padStart(6)} | ${percentile(absVals, 50).toFixed(3).padStart(11)} | ${percentile(absVals, 90).toFixed(3).padStart(11)} | ${percentile(absVals, 95).toFixed(3).padStart(11)} | ${stddev(vals).toFixed(3)}`);
}


// =====================================================================
//  ANALYSIS 4: Stationarity Detection Threshold
// =====================================================================

console.log('\n\n# ANALYSIS 4: Stationarity Detection Threshold Analysis');
console.log('');

const thresholds = [3, 5, 7, 10, 15, 20];
const thresholdResults = [];

for (const thresh of thresholds) {
	let totalStationary = 0;
	let totalNonStationary = 0;
	let falsePositives = 0; // Detected stationary but was clearly moving
	let truePositives = 0;  // Detected stationary and truly stopped
	let falseNegatives = 0; // Not detected but was actually stopped
	let trueNegatives = 0;  // Not detected and was truly moving

	for (const [busId, records] of byBus) {
		if (records.length < 20) continue;

		let consecutiveBelow = 0;
		const CONFIRM_COUNT = 2;

		for (let i = 1; i < records.length; i++) {
			const prev = records[i - 1];
			const curr = records[i];
			const dt = (curr.ts - prev.ts) / 1000;
			if (dt <= 0) continue;

			const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);

			// "Ground truth": look at 5-reading window to determine if truly stopped
			// A bus is truly stopped if 5 consecutive readings are within 2m of each other
			let trulyStoppedWindow = true;
			const windowSize = Math.min(5, records.length - i);
			for (let j = 0; j < windowSize - 1; j++) {
				if (i + j + 1 < records.length) {
					const d = haversineM(records[i + j].lat, records[i + j].lng,
						records[i + j + 1].lat, records[i + j + 1].lng);
					if (d > 2.0) { trulyStoppedWindow = false; break; }
				}
			}

			// Also consider: truly moving if implied speed > 5 km/h from real updates
			let trulyMoving = false;
			if (!trulyStoppedWindow) {
				// Look at displacement over the next 3 real updates
				let lookDist = 0;
				let lookTime = 0;
				for (let j = i; j < Math.min(i + 5, records.length); j++) {
					lookDist = haversineM(records[i].lat, records[i].lng, records[j].lat, records[j].lng);
					lookTime = (records[j].ts - records[i].ts) / 1000;
				}
				if (lookTime > 0) {
					const impliedSpd = speedKmh(lookDist, lookTime);
					if (impliedSpd > 5) trulyMoving = true;
				}
			}

			const detectedStationary = dist < thresh;
			if (detectedStationary) {
				consecutiveBelow++;
				if (consecutiveBelow >= CONFIRM_COUNT) {
					totalStationary++;
					if (trulyMoving) falsePositives++;
					else truePositives++;
				}
			} else {
				consecutiveBelow = 0;
				totalNonStationary++;
				if (trulyStoppedWindow) falseNegatives++;
				else trueNegatives++;
			}
		}
	}

	thresholdResults.push({
		thresh,
		totalStationary,
		totalNonStationary,
		falsePositives,
		truePositives,
		falseNegatives,
		trueNegatives,
		fpRate: totalStationary > 0 ? (falsePositives / totalStationary * 100).toFixed(2) : '0.00',
		fnRate: (totalStationary + totalNonStationary) > 0
			? (falseNegatives / (falseNegatives + trueNegatives) * 100).toFixed(2) : '0.00',
	});
}

console.log('Threshold | Stationary | FalsePos | FP Rate | FalseNeg | FN Rate');
for (const r of thresholdResults) {
	console.log(`  ${String(r.thresh).padStart(5)}m | ${String(r.totalStationary).padStart(10)} | ${String(r.falsePositives).padStart(8)} | ${r.fpRate.padStart(6)}% | ${String(r.falseNegatives).padStart(8)} | ${r.fnRate.padStart(6)}%`);
}


// =====================================================================
//  ANALYSIS 5: Speed Estimation Error Analysis (Kalman simulation)
// =====================================================================

console.log('\n\n# ANALYSIS 5: Speed Estimation Error Analysis');
console.log('');

// Kalman filter implementation (mirrors the production code)
function createAxis(posM) {
	const R = 5.0 * 5.0; // SIGMA_GPS = 5.0
	return { p: posM, v: 0, P00: R, P01: 0, P11: 100 };
}

function kPredict(ax, dt, sigmaA) {
	const s2 = sigmaA * sigmaA;
	return {
		p: ax.p + ax.v * dt,
		v: ax.v,
		P00: ax.P00 + dt * ax.P01 + dt * (ax.P01 + dt * ax.P11) + s2 * (dt ** 4 / 4),
		P01: ax.P01 + dt * ax.P11 + s2 * (dt ** 3 / 2),
		P11: ax.P11 + s2 * dt * dt,
	};
}

function kUpdate(pred, meas) {
	const R = 5.0 * 5.0;
	const inn = meas - pred.p;
	const S = pred.P00 + R;
	const K0 = pred.P00 / S;
	const K1 = pred.P01 / S;
	return {
		p: pred.p + K0 * inn,
		v: pred.v + K1 * inn,
		P00: (1 - K0) * pred.P00,
		P01: (1 - K0) * pred.P01,
		P11: -K1 * pred.P01 + pred.P11,
	};
}

// Full Kalman pipeline with stale detection, stationarity, endpoint bound, EMA, accel limiting
function simulateBusFull(records, sigmaA = 0.8) {
	if (records.length < 5) return [];

	const results = [];
	const ref = { lat: records[0].lat, lng: records[0].lng };
	let xAxis = createAxis(0);
	let yAxis = createAxis(0);
	let lastTs = records[0].ts;
	let lastRealTs = records[0].ts;
	let lastRawLat = records[0].lat;
	let lastRawLng = records[0].lng;
	let fixCount = 1;
	let realStatCount = 0;
	let isStationary = false;
	let emaSpeed = 0;
	const posBuf = [{ lat: records[0].lat, lng: records[0].lng, ts: records[0].ts }];

	const STALE_T = 1.0;
	const STAT_DIST = 5.0;
	const STAT_CONFIRM = 3;
	const MAX_ACCEL = 3.0;
	const MAX_DECEL = 5.0;
	const EMA_ALPHA = 0.4;
	const CONSERVATIVE = 0.95;
	const EP_BUF_SIZE = 6;
	const MIN_FIXES = 3;

	results.push({ ts: records[0].ts, kalmanSpeed: 0, emaSpeed: 0, isStale: false, isStationary: false });

	for (let i = 1; i < records.length; i++) {
		const curr = records[i];
		const dtMs = curr.ts - lastTs;
		const dtS = dtMs / 1000;
		if (dtS < 1) continue;

		const rawDist = haversineM(lastRawLat, lastRawLng, curr.lat, curr.lng);
		const isStale = rawDist < STALE_T;
		lastRawLat = curr.lat;
		lastRawLng = curr.lng;

		if (isStale) {
			lastTs = curr.ts;
			results.push({ ts: curr.ts, kalmanSpeed: 0, emaSpeed, isStale: true, isStationary });
			continue;
		}

		// Real update
		const mx = (curr.lng - ref.lng) * LNG_M;
		const my = (curr.lat - ref.lat) * LAT_M;
		const dx = mx - xAxis.p;
		const dy = my - yAxis.p;
		const distFromState = Math.sqrt(dx * dx + dy * dy);

		// Outlier
		if (distFromState > 500) {
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastTs = curr.ts; lastRealTs = curr.ts; fixCount = 1;
			realStatCount = 0; isStationary = false; emaSpeed = 0;
			posBuf.length = 0; posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
			continue;
		}

		const realDtS = (curr.ts - lastRealTs) / 1000;
		const rawSpd = realDtS > 0 ? speedKmh(distFromState, realDtS) : 0;
		if (rawSpd > 120) {
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastTs = curr.ts; lastRealTs = curr.ts; fixCount = 1;
			realStatCount = 0; isStationary = false; emaSpeed = 0;
			posBuf.length = 0; posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
			continue;
		}

		// Stationarity
		if (distFromState < STAT_DIST) realStatCount++;
		else realStatCount = 0;

		const wasStationary = isStationary;
		isStationary = realStatCount >= STAT_CONFIRM;

		// Kalman
		const predX = kPredict(xAxis, dtS, sigmaA);
		const predY = kPredict(yAxis, dtS, sigmaA);
		xAxis = kUpdate(predX, mx);
		yAxis = kUpdate(predY, my);
		lastTs = curr.ts;
		lastRealTs = curr.ts;
		fixCount++;
		posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
		if (posBuf.length > EP_BUF_SIZE) posBuf.shift();

		if (isStationary) {
			xAxis.v = 0; yAxis.v = 0;
			const decayed = emaSpeed * 0.3;
			emaSpeed = decayed < 0.5 ? 0 : decayed;
			results.push({ ts: curr.ts, kalmanSpeed: 0, emaSpeed, isStale: false, isStationary: true });
			continue;
		}

		if (wasStationary && !isStationary) {
			xAxis.P11 = 100; yAxis.P11 = 100;
		}

		if (fixCount < MIN_FIXES) {
			emaSpeed = 0;
			results.push({ ts: curr.ts, kalmanSpeed: 0, emaSpeed: 0, isStale: false, isStationary: false });
			continue;
		}

		const vx = xAxis.v, vy = yAxis.v;
		const kalSpd = Math.sqrt(vx * vx + vy * vy) * 3.6;

		// Endpoint bound
		let finalSpeed = kalSpd;
		if (posBuf.length >= 3) {
			const first = posBuf[0];
			const last = posBuf[posBuf.length - 1];
			const epDist = haversineM(first.lat, first.lng, last.lat, last.lng);
			const epTime = (last.ts - first.ts) / 1000;
			if (epTime > 0) {
				const epSpeed = speedKmh(epDist, epTime);
				finalSpeed = Math.min(kalSpd, epSpeed);
			}
		}

		finalSpeed = Math.max(0, Math.min(120, finalSpeed * CONSERVATIVE));

		// Accel limiting
		if (realDtS > 0) {
			const prevMs = emaSpeed / 3.6;
			const newMs = finalSpeed / 3.6;
			const accel = (newMs - prevMs) / realDtS;
			if (accel > MAX_ACCEL) finalSpeed = (prevMs + MAX_ACCEL * realDtS) * 3.6;
			else if (accel < -MAX_DECEL) finalSpeed = Math.max(0, (prevMs - MAX_DECEL * realDtS) * 3.6);
		}

		emaSpeed = EMA_ALPHA * finalSpeed + (1 - EMA_ALPHA) * emaSpeed;
		results.push({ ts: curr.ts, kalmanSpeed: kalSpd, emaSpeed, isStale: false, isStationary: false });
	}

	return results;
}

// Ground truth: 3-point moving average of real-update endpoint speeds, x0.95
function computeGroundTruth(records) {
	const realUpdates = [records[0]];
	let lastReal = records[0];

	for (let i = 1; i < records.length; i++) {
		const dist = haversineM(lastReal.lat, lastReal.lng, records[i].lat, records[i].lng);
		if (dist >= STALE_THRESH_M) {
			const dt = (records[i].ts - lastReal.ts) / 1000;
			realUpdates.push({ ...records[i], rawSpeed: dt > 0 ? speedKmh(dist, dt) : 0 });
			lastReal = records[i];
		}
	}

	const result = new Map();
	for (let i = 0; i < realUpdates.length; i++) {
		const window = [];
		for (let j = Math.max(0, i - 1); j <= Math.min(realUpdates.length - 1, i + 1); j++) {
			window.push(realUpdates[j].rawSpeed || 0);
		}
		const avg = mean(window) * 0.95;
		result.set(realUpdates[i].ts, avg);
	}
	return result;
}

// Pick 20 buses with most data for detailed analysis
const busesForAnalysis = [...byBus.entries()]
	.filter(([, recs]) => recs.length > 500)
	.sort((a, b) => b[1].length - a[1].length)
	.slice(0, 20);

let totalComparisons = 0;
let totalOverestimates = 0;
let totalUnderestimates = 0;
let overEstErrors = [];
let underEstErrors = [];
let allErrors = [];
let maxOverest = { busId: '', error: 0, speed: 0 };

// Track where errors occur
const transitionErrors = []; // speed changed by >10kmh in ground truth
const steadyErrors = [];     // speed stable
const stopErrors = [];       // near stop (gt < 5)

console.log('Per-bus error analysis (top 20 buses):');
console.log('  Bus      | Records | Comps | Over% | Under% | MeanErr | MaxOver');

for (const [busId, records] of busesForAnalysis) {
	const kalResults = simulateBusFull(records);
	const gt = computeGroundTruth(records);

	let busOver = 0, busUnder = 0, busComps = 0;
	const busErrors = [];

	for (const kr of kalResults) {
		const gtSpeed = gt.get(kr.ts);
		if (gtSpeed == null || kr.isStale) continue;

		const estSpeed = kr.emaSpeed;
		const error = estSpeed - gtSpeed;
		busComps++;
		busErrors.push(error);
		allErrors.push(error);

		if (error > 2) { // >2 kmh overestimate
			busOver++;
			totalOverestimates++;
			overEstErrors.push(error);
			if (error > maxOverest.error) maxOverest = { busId, error, speed: estSpeed };
		} else if (error < -2) { // >2 kmh underestimate
			busUnder++;
			totalUnderestimates++;
			underEstErrors.push(error);
		}

		// Classify context: check if speed is changing
		// Look at nearby ground truth values
		const nearbyGt = [];
		for (const [ts2, spd2] of gt) {
			if (Math.abs(ts2 - kr.ts) < 15000) nearbyGt.push(spd2);
		}
		const gtRange = nearbyGt.length > 1 ? nearbyGt.reduce((a,b) => a > b ? a : b, 0) - nearbyGt.reduce((a,b) => a < b ? a : b, Infinity) : 0;

		if (gtSpeed < 5) stopErrors.push(error);
		else if (gtRange > 10) transitionErrors.push(error);
		else steadyErrors.push(error);

		totalComparisons++;
	}

	const overPct = busComps > 0 ? (busOver / busComps * 100).toFixed(1) : '0.0';
	const underPct = busComps > 0 ? (busUnder / busComps * 100).toFixed(1) : '0.0';
	const meanErr = busErrors.length > 0 ? mean(busErrors).toFixed(1) : '0.0';
	const maxOv = busErrors.length > 0 ? busErrors.reduce((a,b) => a > b ? a : b, 0).toFixed(1) : '0.0';

	console.log(`  ${busId.padEnd(9)} | ${String(records.length).padStart(7)} | ${String(busComps).padStart(5)} | ${overPct.padStart(5)} | ${underPct.padStart(6)} | ${meanErr.padStart(7)} | ${maxOv.padStart(7)}`);
}

console.log(`\nFleet-wide summary (${totalComparisons} comparisons across ${busesForAnalysis.length} buses):`);
console.log(`  Overestimates (>2 km/h): ${totalOverestimates} (${(totalOverestimates / totalComparisons * 100).toFixed(1)}%)`);
console.log(`  Underestimates (>2 km/h): ${totalUnderestimates} (${(totalUnderestimates / totalComparisons * 100).toFixed(1)}%)`);
console.log(`  Max overestimate: ${maxOverest.error.toFixed(1)} km/h by ${maxOverest.busId}`);

if (allErrors.length > 0) {
	console.log(`\nError distribution (km/h, positive = overestimate):`);
	console.log(`  P5: ${percentile(allErrors, 5).toFixed(1)}`);
	console.log(`  P25: ${percentile(allErrors, 25).toFixed(1)}`);
	console.log(`  P50: ${percentile(allErrors, 50).toFixed(1)}`);
	console.log(`  P75: ${percentile(allErrors, 75).toFixed(1)}`);
	console.log(`  P95: ${percentile(allErrors, 95).toFixed(1)}`);
	console.log(`  Mean: ${mean(allErrors).toFixed(1)}`);
	console.log(`  Std: ${stddev(allErrors).toFixed(1)}`);
}

if (overEstErrors.length > 0) {
	console.log(`\nOverestimate magnitude distribution:`);
	console.log(`  P50: ${percentile(overEstErrors, 50).toFixed(1)} km/h`);
	console.log(`  P90: ${percentile(overEstErrors, 90).toFixed(1)} km/h`);
	console.log(`  P95: ${percentile(overEstErrors, 95).toFixed(1)} km/h`);
	console.log(`  P99: ${percentile(overEstErrors, 99).toFixed(1)} km/h`);
}

console.log(`\nError by context:`);
if (transitionErrors.length > 0) {
	console.log(`  Speed transitions (gt range > 10km/h): ${transitionErrors.length} points, mean err=${mean(transitionErrors).toFixed(1)}, std=${stddev(transitionErrors).toFixed(1)}`);
}
if (steadyErrors.length > 0) {
	console.log(`  Steady speed: ${steadyErrors.length} points, mean err=${mean(steadyErrors).toFixed(1)}, std=${stddev(steadyErrors).toFixed(1)}`);
}
if (stopErrors.length > 0) {
	console.log(`  Near stops (gt < 5 km/h): ${stopErrors.length} points, mean err=${mean(stopErrors).toFixed(1)}, std=${stddev(stopErrors).toFixed(1)}`);
}


// =====================================================================
//  ANALYSIS 6: Animation Prediction Quality
// =====================================================================

console.log('\n\n# ANALYSIS 6: Animation Prediction Quality');
console.log('');

// For each bus: run Kalman, then at each real update, predict forward
// and measure error at future real updates
const predErrorsByHorizon = new Map(); // horizon_ms -> [error_m]
const horizons = [500, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000];
for (const h of horizons) predErrorsByHorizon.set(h, []);

const sampleBuses = busesForAnalysis.slice(0, 10);

for (const [busId, records] of sampleBuses) {
	if (records.length < 50) continue;

	const ref = { lat: records[0].lat, lng: records[0].lng };
	let xAxis = createAxis(0);
	let yAxis = createAxis(0);
	let lastTs = records[0].ts;
	let lastRawLat = records[0].lat;
	let lastRawLng = records[0].lng;
	let fixCount = 1;

	// Store Kalman state at each update for prediction testing
	const stateSnapshots = []; // { ts, xp, xv, yp, yv, refLat, refLng }

	for (let i = 1; i < records.length; i++) {
		const curr = records[i];
		const dtS = (curr.ts - lastTs) / 1000;
		if (dtS < 1) continue;

		const rawDist = haversineM(lastRawLat, lastRawLng, curr.lat, curr.lng);
		lastRawLat = curr.lat;
		lastRawLng = curr.lng;

		if (rawDist < STALE_THRESH_M) { lastTs = curr.ts; continue; }

		const mx = (curr.lng - ref.lng) * LNG_M;
		const my = (curr.lat - ref.lat) * LAT_M;
		const dx = mx - xAxis.p, dy = my - yAxis.p;
		const distFromState = Math.sqrt(dx * dx + dy * dy);
		if (distFromState > 500) {
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastTs = curr.ts; fixCount = 1;
			continue;
		}

		const predX = kPredict(xAxis, dtS, 0.8);
		const predY = kPredict(yAxis, dtS, 0.8);
		xAxis = kUpdate(predX, mx);
		yAxis = kUpdate(predY, my);
		lastTs = curr.ts;
		fixCount++;

		if (fixCount >= 3) {
			stateSnapshots.push({
				ts: curr.ts,
				xp: xAxis.p, xv: xAxis.v,
				yp: yAxis.p, yv: yAxis.v,
				actualLat: curr.lat, actualLng: curr.lng,
			});
		}
	}

	// Now for each snapshot, predict forward and compare with actual future positions
	// Build a map of ts -> {lat, lng} for actual positions (real updates only)
	const actualPositions = [];
	let lastReal2 = records[0];
	for (let i = 1; i < records.length; i++) {
		if (haversineM(lastReal2.lat, lastReal2.lng, records[i].lat, records[i].lng) >= STALE_THRESH_M) {
			actualPositions.push({ ts: records[i].ts, lat: records[i].lat, lng: records[i].lng });
			lastReal2 = records[i];
		}
	}

	for (let si = 0; si < stateSnapshots.length; si++) {
		const snap = stateSnapshots[si];

		for (const horizon of horizons) {
			const targetTs = snap.ts + horizon;

			// Find the closest actual position to this target time
			let closest = null;
			let closestDiff = Infinity;
			for (const ap of actualPositions) {
				const diff = Math.abs(ap.ts - targetTs);
				if (diff < closestDiff) {
					closestDiff = diff;
					closest = ap;
				}
			}

			if (!closest || closestDiff > 2000) continue; // skip if no close match

			// Predict position at horizon
			const predDtS = horizon / 1000;
			const predXm = snap.xp + snap.xv * predDtS;
			const predYm = snap.yp + snap.yv * predDtS;
			const predPos = {
				lat: ref.lat + predYm / LAT_M,
				lng: ref.lng + predXm / LNG_M,
			};

			const errM = haversineM(predPos.lat, predPos.lng, closest.lat, closest.lng);
			predErrorsByHorizon.get(horizon).push(errM);
		}
	}
}

console.log('Prediction error by horizon (meters from actual position):');
console.log('  Horizon(ms) | Count  | P50(m) | P75(m) | P90(m) | P95(m) | Mean(m)');
for (const h of horizons) {
	const errs = predErrorsByHorizon.get(h);
	if (errs.length === 0) { console.log(`  ${String(h).padStart(10)}ms | no data`); continue; }
	console.log(`  ${String(h).padStart(10)}ms | ${String(errs.length).padStart(6)} | ${percentile(errs, 50).toFixed(1).padStart(6)} | ${percentile(errs, 75).toFixed(1).padStart(6)} | ${percentile(errs, 90).toFixed(1).padStart(6)} | ${percentile(errs, 95).toFixed(1).padStart(6)} | ${mean(errs).toFixed(1).padStart(7)}`);
}

// Find the horizon at which median error exceeds various thresholds
for (const threshM of [5, 10, 20]) {
	let found = false;
	for (const h of horizons) {
		const errs = predErrorsByHorizon.get(h);
		if (errs.length > 0 && percentile(errs, 50) > threshM) {
			console.log(`  Median error exceeds ${threshM}m at ${h}ms horizon`);
			found = true;
			break;
		}
	}
	if (!found) console.log(`  Median error stays below ${threshM}m through ${horizons[horizons.length - 1]}ms`);
}

// Same for P90
console.log('');
for (const threshM of [5, 10, 20]) {
	let found = false;
	for (const h of horizons) {
		const errs = predErrorsByHorizon.get(h);
		if (errs.length > 0 && percentile(errs, 90) > threshM) {
			console.log(`  P90 error exceeds ${threshM}m at ${h}ms horizon`);
			found = true;
			break;
		}
	}
	if (!found) console.log(`  P90 error stays below ${threshM}m through ${horizons[horizons.length - 1]}ms`);
}


// =====================================================================
//  ANALYSIS 7: Optimal Polling Interval
// =====================================================================

console.log('\n\n# ANALYSIS 7: Optimal Polling Interval');
console.log('');

// The question: at various polling intervals, what % of polls return new data?
// The API has max-age=2, so we poll every N seconds and check if the GPS position
// has changed since the last real update.

// For each bus, simulate different polling intervals
const pollIntervals = [1, 2, 3, 4, 5, 6, 8, 10];
const pollResults = new Map();
for (const p of pollIntervals) pollResults.set(p, { totalPolls: 0, newData: 0 });

for (const [busId, records] of byBus) {
	if (records.length < 50) continue;

	// Build timeline of real position changes
	const realChanges = [{ ts: records[0].ts, lat: records[0].lat, lng: records[0].lng }];
	let lastR = records[0];
	for (let i = 1; i < records.length; i++) {
		if (haversineM(lastR.lat, lastR.lng, records[i].lat, records[i].lng) >= STALE_THRESH_M) {
			realChanges.push({ ts: records[i].ts, lat: records[i].lat, lng: records[i].lng });
			lastR = records[i];
		}
	}

	if (realChanges.length < 5) continue;

	const startTs = records[0].ts;
	const endTs = records[records.length - 1].ts;

	for (const interval of pollIntervals) {
		const intervalMs = interval * 1000;
		let lastSeenChangeIdx = 0;

		for (let t = startTs + intervalMs; t <= endTs; t += intervalMs) {
			pollResults.get(interval).totalPolls++;

			// Find the latest real change before time t
			while (lastSeenChangeIdx < realChanges.length - 1 && realChanges[lastSeenChangeIdx + 1].ts <= t) {
				lastSeenChangeIdx++;
			}

			// Check if this is a new change compared to what we saw at t - intervalMs
			const prevChangeIdx = (() => {
				let idx = 0;
				for (let j = 0; j < realChanges.length; j++) {
					if (realChanges[j].ts <= t - intervalMs) idx = j;
					else break;
				}
				return idx;
			})();

			if (lastSeenChangeIdx > prevChangeIdx) {
				pollResults.get(interval).newData++;
			}
		}
	}
}

console.log('Polling interval analysis:');
console.log('  Interval | Total Polls | New Data | New Data % | Effective Hz');
for (const interval of pollIntervals) {
	const r = pollResults.get(interval);
	const pct = r.totalPolls > 0 ? (r.newData / r.totalPolls * 100).toFixed(1) : '0.0';
	const effectiveHz = r.totalPolls > 0 ? (r.newData / r.totalPolls / interval).toFixed(3) : '0.000';
	console.log(`  ${String(interval).padStart(6)}s | ${String(r.totalPolls).padStart(11)} | ${String(r.newData).padStart(8)} | ${pct.padStart(9)}% | ${effectiveHz.padStart(12)}`);
}

// Compute "information per poll" efficiency
console.log('\nEfficiency: new-data-per-poll / polls-per-second');
for (const interval of pollIntervals) {
	const r = pollResults.get(interval);
	const newPct = r.totalPolls > 0 ? r.newData / r.totalPolls : 0;
	const pollsPerSec = 1 / interval;
	const infoRate = newPct * pollsPerSec; // new data events per second
	const efficiency = newPct; // simple: what fraction of polls are useful
	console.log(`  ${interval}s: ${(efficiency * 100).toFixed(1)}% useful, ${(infoRate * 60).toFixed(1)} new readings/min/bus`);
}


// =====================================================================
//  ANALYSIS 8: Speed Limit Matching Implications (Position Scatter for Moving Buses)
// =====================================================================

console.log('\n\n# ANALYSIS 8: Speed Limit Matching Implications');
console.log('');

// Measure GPS position scatter for moving buses
// Use a sliding window of 5 real updates, compute centroid, measure deviation
const movingScatterM = [];
const scatterBySpeed = new Map();
const spdBands2 = [[10, 20], [20, 30], [30, 40], [40, 50], [50, 70]];
for (const b of spdBands2) scatterBySpeed.set(`${b[0]}-${b[1]}`, []);

for (const [busId, records] of byBus) {
	if (records.length < 30) continue;

	// Build real update sequence
	const realUpdates = [records[0]];
	let lastR2 = records[0];
	for (let i = 1; i < records.length; i++) {
		if (haversineM(lastR2.lat, lastR2.lng, records[i].lat, records[i].lng) >= STALE_THRESH_M) {
			realUpdates.push(records[i]);
			lastR2 = records[i];
		}
	}

	if (realUpdates.length < 7) continue;

	const WINDOW = 5;
	for (let i = 2; i < realUpdates.length - 2; i++) {
		const windowStart = Math.max(0, i - Math.floor(WINDOW / 2));
		const windowEnd = Math.min(realUpdates.length, windowStart + WINDOW);
		const window = realUpdates.slice(windowStart, windowEnd);

		if (window.length < 3) continue;

		const cLat = mean(window.map(w => w.lat));
		const cLng = mean(window.map(w => w.lng));

		// Is this bus moving? Check displacement across window
		const winDist = haversineM(window[0].lat, window[0].lng,
			window[window.length - 1].lat, window[window.length - 1].lng);
		const winTime = (window[window.length - 1].ts - window[0].ts) / 1000;
		if (winTime <= 0) continue;
		const winSpeed = speedKmh(winDist, winTime);

		if (winSpeed < 10) continue; // skip slow/stopped

		// Scatter of the center point from the windowed centroid
		const centerPt = realUpdates[i];
		const scatterDist = haversineM(centerPt.lat, centerPt.lng, cLat, cLng);
		movingScatterM.push(scatterDist);

		for (const b of spdBands2) {
			if (winSpeed >= b[0] && winSpeed < b[1]) {
				scatterBySpeed.get(`${b[0]}-${b[1]}`).push(scatterDist);
			}
		}
	}
}

console.log(`Moving bus position scatter (raw GPS vs 5-point moving average centroid):`);
console.log(`  Measurements: ${movingScatterM.length}`);
if (movingScatterM.length > 0) {
	console.log(`  P50: ${percentile(movingScatterM, 50).toFixed(1)}m`);
	console.log(`  P75: ${percentile(movingScatterM, 75).toFixed(1)}m`);
	console.log(`  P90: ${percentile(movingScatterM, 90).toFixed(1)}m`);
	console.log(`  P95: ${percentile(movingScatterM, 95).toFixed(1)}m`);
	console.log(`  P99: ${percentile(movingScatterM, 99).toFixed(1)}m`);
	console.log(`  Mean: ${mean(movingScatterM).toFixed(1)}m`);
}

console.log('\nPosition scatter by speed band:');
console.log('  Band(km/h) | Count  | P50(m) | P90(m) | P95(m)');
for (const b of spdBands2) {
	const key = `${b[0]}-${b[1]}`;
	const vals = scatterBySpeed.get(key);
	if (vals.length < 50) continue;
	console.log(`  ${key.padEnd(12)} | ${String(vals.length).padStart(6)} | ${percentile(vals, 50).toFixed(1).padStart(6)} | ${percentile(vals, 90).toFixed(1).padStart(6)} | ${percentile(vals, 95).toFixed(1).padStart(6)}`);
}

// What search radius captures 95% of true positions?
if (movingScatterM.length > 0) {
	console.log(`\nSearch radius needed to capture X% of true positions:`);
	for (const pct of [90, 95, 99]) {
		console.log(`  ${pct}%: ${percentile(movingScatterM, pct).toFixed(1)}m`);
	}
	console.log(`\nCurrent setting: 50m search radius`);
	const within50 = movingScatterM.filter(d => d <= 50).length;
	console.log(`  Positions within 50m of centroid: ${(within50 / movingScatterM.length * 100).toFixed(1)}%`);
}

// Also measure: how far do buses actually deviate from roads?
// We can't check road geometry here, but we can measure the "cross-track" error
// (lateral deviation from the direction of travel), which approximates the
// distance from the road centerline if the bus is on a straight road.
console.log('\nCross-track deviation (perpendicular to direction of travel):');
const crossTrackM = [];

for (const [busId, records] of byBus) {
	if (records.length < 20) continue;

	const realUpdates = [records[0]];
	let lastR3 = records[0];
	for (let i = 1; i < records.length; i++) {
		if (haversineM(lastR3.lat, lastR3.lng, records[i].lat, records[i].lng) >= STALE_THRESH_M) {
			realUpdates.push(records[i]);
			lastR3 = records[i];
		}
	}

	for (let i = 1; i < realUpdates.length - 1; i++) {
		const A = realUpdates[i - 1];
		const B = realUpdates[i];
		const C = realUpdates[i + 1];

		const distAC = haversineM(A.lat, A.lng, C.lat, C.lng);
		if (distAC < 20) continue; // need some distance for meaningful direction

		// Project B onto line AC
		const ax = A.lng * LNG_M, ay = A.lat * LAT_M;
		const bx = B.lng * LNG_M, by = B.lat * LAT_M;
		const cx = C.lng * LNG_M, cy = C.lat * LAT_M;

		const dx = cx - ax, dy = cy - ay;
		const lenSq = dx * dx + dy * dy;
		if (lenSq < 1) continue;

		const crossProduct = Math.abs((cx - ax) * (ay - by) - (ax - bx) * (cy - ay));
		const lineLen = Math.sqrt(lenSq);
		const perpDist = crossProduct / lineLen;

		// Only include if speed is reasonable (bus actually moving on road)
		const dtAB = (B.ts - A.ts) / 1000;
		const dtBC = (C.ts - B.ts) / 1000;
		if (dtAB <= 0 || dtBC <= 0 || dtAB > 20 || dtBC > 20) continue;
		const spdAB = speedKmh(haversineM(A.lat, A.lng, B.lat, B.lng), dtAB);
		if (spdAB < 5) continue;

		crossTrackM.push(perpDist);
	}
}

if (crossTrackM.length > 0) {
	console.log(`  Measurements: ${crossTrackM.length}`);
	console.log(`  P50: ${percentile(crossTrackM, 50).toFixed(1)}m`);
	console.log(`  P75: ${percentile(crossTrackM, 75).toFixed(1)}m`);
	console.log(`  P90: ${percentile(crossTrackM, 90).toFixed(1)}m`);
	console.log(`  P95: ${percentile(crossTrackM, 95).toFixed(1)}m`);
	console.log(`  P99: ${percentile(crossTrackM, 99).toFixed(1)}m`);
	console.log(`  Mean: ${mean(crossTrackM).toFixed(1)}m`);
}


// =====================================================================
//  SUMMARY: Parameter Recommendations
// =====================================================================

console.log('\n\n# PARAMETER RECOMMENDATIONS');
console.log('');

// Compute key derived metrics
const empiricalGpsSigma = lateralDeviationsM.length > 0
	? percentile(lateralDeviationsM, 50) * Math.sqrt(1.5) : NaN;
const medianRealGap = allRealGapsS.length > 0 ? percentile(allRealGapsS, 50) : NaN;
const p90RealGap = allRealGapsS.length > 0 ? percentile(allRealGapsS, 90) : NaN;
const empiricalSigmaA = absAccel.length > 0 ? percentile(absAccel, 90) : NaN;
const p95CrossTrack = crossTrackM.length > 0 ? percentile(crossTrackM, 95) : NaN;

console.log('Current vs Recommended Parameters:');
console.log('');
console.log(`  sigma_gps (measurement noise):`);
console.log(`    Current: 5.0m`);
console.log(`    Empirical (moving bus lateral dev): ${empiricalGpsSigma.toFixed(1)}m`);

const stoppedScatter = totalScattersM.length > 0 ? percentile(totalScattersM, 95) : NaN;
console.log(`    Empirical (stopped bus P95 scatter): ${stoppedScatter.toFixed(2)}m`);
console.log(`    Note: Stopped scatter is near-zero because API returns identical coordinates when GPS hasn't updated.`);
console.log(`    The lateral deviation method from moving buses is the better estimator.`);

console.log(`\n  sigma_a (process noise / acceleration):`);
console.log(`    Current: 0.8 m/s^2`);
console.log(`    Empirical |accel| P50: ${percentile(absAccel, 50).toFixed(3)} m/s^2`);
console.log(`    Empirical |accel| P90: ${empiricalSigmaA.toFixed(3)} m/s^2`);
console.log(`    Empirical |accel| P95: ${percentile(absAccel, 95).toFixed(3)} m/s^2`);
console.log(`    Empirical std of acceleration: ${stddev(allAccelMs2).toFixed(3)} m/s^2`);

console.log(`\n  Real update interval (dt for Kalman):`);
console.log(`    Median: ${medianRealGap.toFixed(1)}s`);
console.log(`    P90: ${p90RealGap.toFixed(1)}s`);

console.log(`\n  Stationarity threshold:`);
console.log(`    Current: 10m (MIN_DISTANCE_THRESHOLD_M) + 5m (REAL_STATIONARY_DIST_M)`);
// Find the threshold with best F1-like balance
let bestThresh = 10;
let bestScore = 0;
for (const r of thresholdResults) {
	const fp = parseFloat(r.fpRate);
	const fn = parseFloat(r.fnRate);
	const score = 100 - fp - fn; // simple combined metric
	if (score > bestScore) { bestScore = score; bestThresh = r.thresh; }
}
console.log(`    Best threshold by FP+FN balance: ${bestThresh}m`);

console.log(`\n  Speed limit search radius:`);
console.log(`    Current: 50m`);
console.log(`    P95 cross-track deviation: ${p95CrossTrack.toFixed(1)}m`);
console.log(`    P99 cross-track deviation: ${percentile(crossTrackM, 99).toFixed(1)}m`);

console.log(`\n  Polling interval:`);
const poll2 = pollResults.get(2);
const poll3 = pollResults.get(3);
const poll2pct = poll2.totalPolls > 0 ? (poll2.newData / poll2.totalPolls * 100).toFixed(1) : 'N/A';
const poll3pct = poll3.totalPolls > 0 ? (poll3.newData / poll3.totalPolls * 100).toFixed(1) : 'N/A';
console.log(`    At 2s: ${poll2pct}% of polls return new data`);
console.log(`    At 3s: ${poll3pct}% of polls return new data`);

console.log(`\n  Conservative speed factor:`);
console.log(`    Current: 0.95`);
const overPct = totalComparisons > 0 ? (totalOverestimates / totalComparisons * 100).toFixed(1) : 'N/A';
console.log(`    Overestimate rate with current pipeline: ${overPct}%`);

console.log('\nDone.');
