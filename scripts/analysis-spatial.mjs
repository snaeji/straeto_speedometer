#!/usr/bin/env node
/**
 * Phase 2 Analysis: Spatial/Geographic characteristics of Straeto bus GPS data.
 * Comprehensive analysis of coordinate precision, distances, jitter, direction,
 * route coverage, position jumps, and position repetition.
 */

import { readFileSync } from 'fs';

const DATASET = 'data/2026-03-11.jsonl';

// Constants for Reykjavik at 64°N
const LAT_M = 111000;   // 1° lat in meters
const LNG_M = 48600;    // 1° lng in meters at 64°N

// Haversine distance in meters
function haversineM(lat1, lng1, lat2, lng2) {
	const R = 6371000;
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLng = (lng2 - lng1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Bearing between two points in degrees [0, 360)
function bearing(lat1, lng1, lat2, lng2) {
	const dLng = (lng2 - lng1) * Math.PI / 180;
	const la1 = lat1 * Math.PI / 180;
	const la2 = lat2 * Math.PI / 180;
	const x = Math.sin(dLng) * Math.cos(la2);
	const y = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
	return ((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360;
}

// Percentile from sorted array
function percentile(sorted, p) {
	if (sorted.length === 0) return NaN;
	const idx = (p / 100) * (sorted.length - 1);
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo];
	return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

// Format number with commas
function fmt(n) {
	if (typeof n === 'number') {
		if (Number.isInteger(n)) return n.toLocaleString('en-US');
		return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
	}
	return String(n);
}

// Count decimal places in a number
function decimalPlaces(val) {
	const s = String(val);
	const dot = s.indexOf('.');
	if (dot === -1) return 0;
	return s.length - dot - 1;
}

console.log('Reading dataset...');
const lines = readFileSync(DATASET, 'utf8').trim().split('\n');
console.log(`Total records: ${lines.length}`);

// Parse all records
const allRecords = [];
for (const line of lines) {
	const r = JSON.parse(line);
	allRecords.push({ busId: r.b, route: r.r, tripId: r.t, lat: r.la, lng: r.ln, dir: r.d, ts: r.ts, headsign: r.h });
}

// Group by bus, sort by timestamp
const byBus = new Map();
const byRoute = new Map();
for (const r of allRecords) {
	if (!byBus.has(r.busId)) byBus.set(r.busId, []);
	byBus.get(r.busId).push(r);
	if (!byRoute.has(r.route)) byRoute.set(r.route, []);
	byRoute.get(r.route).push(r);
}
for (const [, records] of byBus) records.sort((a, b) => a.ts - b.ts);
for (const [, records] of byRoute) records.sort((a, b) => a.ts - b.ts);

const output = [];
function log(s = '') { console.log(s); output.push(s); }
function logTable(headers, rows) {
	// Markdown table
	log('| ' + headers.join(' | ') + ' |');
	log('| ' + headers.map(() => '---').join(' | ') + ' |');
	for (const row of rows) {
		log('| ' + row.join(' | ') + ' |');
	}
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Geographic Bounding Box
// ═══════════════════════════════════════════════════════════════════════
log('\n# Spatial & Geographic Analysis — Straeto Bus GPS Data');
log(`\nDataset: \`${DATASET}\` — ${fmt(allRecords.length)} records, ${byBus.size} buses, ${byRoute.size} routes`);
log('');

log('## 1. Geographic Bounding Box');
log('');

let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
for (const r of allRecords) {
	if (r.lat < minLat) minLat = r.lat;
	if (r.lat > maxLat) maxLat = r.lat;
	if (r.lng < minLng) minLng = r.lng;
	if (r.lng > maxLng) maxLng = r.lng;
}

const latSpanM = (maxLat - minLat) * LAT_M;
const lngSpanM = (maxLng - minLng) * LNG_M;

logTable(['Metric', 'Value'], [
	['Min latitude', `${minLat}`],
	['Max latitude', `${maxLat}`],
	['Min longitude', `${minLng}`],
	['Max longitude', `${maxLng}`],
	['Latitude span', `${(maxLat - minLat).toFixed(6)}° = ${fmt(Math.round(latSpanM))} m (${(latSpanM / 1000).toFixed(2)} km)`],
	['Longitude span', `${(maxLng - minLng).toFixed(6)}° = ${fmt(Math.round(lngSpanM))} m (${(lngSpanM / 1000).toFixed(2)} km)`],
	['Approximate coverage area', `${(latSpanM / 1000).toFixed(1)} km x ${(lngSpanM / 1000).toFixed(1)} km = ~${((latSpanM / 1000) * (lngSpanM / 1000)).toFixed(0)} km²`],
]);

// Centroid
const avgLat = allRecords.reduce((s, r) => s + r.lat, 0) / allRecords.length;
const avgLng = allRecords.reduce((s, r) => s + r.lng, 0) / allRecords.length;
log('');
log(`**Centroid** (mean of all GPS fixes): ${avgLat.toFixed(6)}, ${avgLng.toFixed(6)}`);

// Median center
const sortedLats = allRecords.map(r => r.lat).sort((a, b) => a - b);
const sortedLngs = allRecords.map(r => r.lng).sort((a, b) => a - b);
const medLat = sortedLats[Math.floor(sortedLats.length / 2)];
const medLng = sortedLngs[Math.floor(sortedLngs.length / 2)];
log(`**Median center**: ${medLat.toFixed(6)}, ${medLng.toFixed(6)}`);
log('');

// Distribution within radii from centroid
const radii = [1000, 2000, 3000, 5000, 7500, 10000, 15000, 20000];
const radiusCounts = radii.map(() => 0);
for (const r of allRecords) {
	const d = haversineM(avgLat, avgLng, r.lat, r.lng);
	for (let i = 0; i < radii.length; i++) {
		if (d <= radii[i]) radiusCounts[i]++;
	}
}
log('**Distribution of fixes by distance from centroid:**');
log('');
logTable(['Radius', 'Fixes within', '% of total'], radii.map((rad, i) => [
	`${(rad / 1000).toFixed(1)} km`,
	fmt(radiusCounts[i]),
	`${(radiusCounts[i] / allRecords.length * 100).toFixed(1)}%`
]));

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Coordinate Precision Analysis
// ═══════════════════════════════════════════════════════════════════════
log('');
log('## 2. Coordinate Precision Analysis');
log('');

// Decimal places distribution
const latDPCounts = {};
const lngDPCounts = {};
const allLatDP = [];
const allLngDP = [];

for (const r of allRecords) {
	const latDP = decimalPlaces(r.lat);
	const lngDP = decimalPlaces(r.lng);
	latDPCounts[latDP] = (latDPCounts[latDP] || 0) + 1;
	lngDPCounts[lngDP] = (lngDPCounts[lngDP] || 0) + 1;
	allLatDP.push(latDP);
	allLngDP.push(lngDP);
}

log('### 2.1 Decimal Places Distribution');
log('');
log('**Latitude decimal places:**');
log('');
const latDPKeys = Object.keys(latDPCounts).map(Number).sort((a, b) => a - b);
logTable(['Decimal places', 'Count', '%', 'Precision in meters'], latDPKeys.map(dp => [
	String(dp),
	fmt(latDPCounts[dp]),
	`${(latDPCounts[dp] / allRecords.length * 100).toFixed(1)}%`,
	`~${(LAT_M / (10 ** dp)).toFixed(dp > 4 ? 4 : 2)} m`
]));

log('');
log('**Longitude decimal places:**');
log('');
const lngDPKeys = Object.keys(lngDPCounts).map(Number).sort((a, b) => a - b);
logTable(['Decimal places', 'Count', '%', 'Precision in meters'], lngDPKeys.map(dp => [
	String(dp),
	fmt(lngDPCounts[dp]),
	`${(lngDPCounts[dp] / allRecords.length * 100).toFixed(1)}%`,
	`~${(LNG_M / (10 ** dp)).toFixed(dp > 4 ? 4 : 2)} m`
]));

// Smallest position changes
log('');
log('### 2.2 Smallest Position Changes Between Consecutive Fixes');
log('');

const smallestLatChanges = [];
const smallestLngChanges = [];
const smallestDistances = [];

for (const [, records] of byBus) {
	for (let i = 1; i < records.length; i++) {
		const dLat = Math.abs(records[i].lat - records[i - 1].lat);
		const dLng = Math.abs(records[i].lng - records[i - 1].lng);
		if (dLat > 0) smallestLatChanges.push(dLat);
		if (dLng > 0) smallestLngChanges.push(dLng);
		if (dLat > 0 || dLng > 0) {
			smallestDistances.push(haversineM(records[i - 1].lat, records[i - 1].lng, records[i].lat, records[i].lng));
		}
	}
}

smallestLatChanges.sort((a, b) => a - b);
smallestLngChanges.sort((a, b) => a - b);
smallestDistances.sort((a, b) => a - b);

log('**Smallest non-zero latitude changes (degrees and meters):**');
log('');
const showN = 10;
logTable(['Rank', 'Delta lat (°)', 'Meters'], Array.from({ length: showN }, (_, i) => [
	String(i + 1),
	smallestLatChanges[i]?.toExponential(4) || 'N/A',
	smallestLatChanges[i] ? `${(smallestLatChanges[i] * LAT_M).toFixed(4)} m` : 'N/A'
]));

log('');
log('**Smallest non-zero longitude changes (degrees and meters):**');
log('');
logTable(['Rank', 'Delta lng (°)', 'Meters'], Array.from({ length: showN }, (_, i) => [
	String(i + 1),
	smallestLngChanges[i]?.toExponential(4) || 'N/A',
	smallestLngChanges[i] ? `${(smallestLngChanges[i] * LNG_M).toFixed(4)} m` : 'N/A'
]));

log('');
log('**Smallest non-zero Haversine distances (m):**');
log('');
logTable(['Rank', 'Distance (m)'], Array.from({ length: showN }, (_, i) => [
	String(i + 1),
	smallestDistances[i]?.toFixed(4) || 'N/A'
]));

// Quantization check: look at the distribution of last digits
log('');
log('### 2.3 Quantization / Grid Analysis');
log('');

// Check if lat/lng values cluster on specific fractional patterns
// Look at the fractional part modulo various grid sizes
const latFracs = allRecords.map(r => r.lat - Math.floor(r.lat));
const lngFracs = allRecords.map(r => Math.abs(r.lng) - Math.floor(Math.abs(r.lng)));

// Last significant digit distribution for latitude (at highest precision)
// Group lats by their last 2 digits (scaled)
const latLastDigits = {};
const lngLastDigits = {};
for (const r of allRecords) {
	const latStr = String(r.lat);
	const lngStr = String(r.lng);
	const latLast = latStr.slice(-2);
	const lngLast = lngStr.slice(-2);
	latLastDigits[latLast] = (latLastDigits[latLast] || 0) + 1;
	lngLastDigits[lngLast] = (lngLastDigits[lngLast] || 0) + 1;
}

// Check for trailing digit patterns (evidence of quantization)
const trailingZeros = allRecords.filter(r => {
	const latStr = String(r.lat);
	const lngStr = String(r.lng);
	return latStr.endsWith('0') || lngStr.endsWith('0');
}).length;

const trailingFives = allRecords.filter(r => {
	const latStr = String(r.lat);
	const lngStr = String(r.lng);
	return latStr.endsWith('5') || lngStr.endsWith('5');
}).length;

// Check for repeating patterns (e.g., .333333, .666667 suggest 1/3 quantization)
const latRepeating = allRecords.filter(r => {
	const s = String(r.lat);
	return s.includes('333') || s.includes('667') || s.includes('666');
}).length;
const lngRepeating = allRecords.filter(r => {
	const s = String(r.lng);
	return s.includes('333') || s.includes('667') || s.includes('666');
}).length;

log(`Records with lat OR lng trailing in "0": ${fmt(trailingZeros)} (${(trailingZeros / allRecords.length * 100).toFixed(1)}%)`);
log(`Records with lat OR lng trailing in "5": ${fmt(trailingFives)} (${(trailingFives / allRecords.length * 100).toFixed(1)}%)`);
log(`Records with lat containing "333" or "667"/"666": ${fmt(latRepeating)} (${(latRepeating / allRecords.length * 100).toFixed(1)}%)`);
log(`Records with lng containing "333" or "667"/"666": ${fmt(lngRepeating)} (${(lngRepeating / allRecords.length * 100).toFixed(1)}%)`);
log('');

// Check if positions fall on a regular grid
// Multiply coordinates by a large factor and look at modulo distribution
const gridSizes = [1e-4, 5e-5, 1e-5, 5e-6, 1e-6];
log('**Grid quantization test** — checking if lat values cluster at regular intervals:');
log('');
for (const gs of gridSizes) {
	// For each record, compute lat mod gridSize, see if it clusters near 0
	const residuals = allRecords.map(r => {
		const q = r.lat / gs;
		return Math.abs(q - Math.round(q)) * gs * LAT_M;
	});
	residuals.sort((a, b) => a - b);
	const med = residuals[Math.floor(residuals.length / 2)];
	const p90 = residuals[Math.floor(residuals.length * 0.9)];
	const nearZero = residuals.filter(r => r < 0.01).length;
	log(`Grid ${gs.toExponential(0)} (${(gs * LAT_M).toFixed(2)}m): median residual=${med.toFixed(4)}m, P90=${p90.toFixed(4)}m, exact-on-grid=${(nearZero / allRecords.length * 100).toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Distance Between Consecutive Fixes
// ═══════════════════════════════════════════════════════════════════════
log('');
log('## 3. Distance Between Consecutive Fixes');
log('');

const allConsecDists = [];
const nonStaleDists = []; // where distance > 0.5m (GPS actually moved)
const STALE_THRESH = 0.5;

for (const [, records] of byBus) {
	for (let i = 1; i < records.length; i++) {
		const d = haversineM(records[i - 1].lat, records[i - 1].lng, records[i].lat, records[i].lng);
		allConsecDists.push(d);
		if (d >= STALE_THRESH) nonStaleDists.push(d);
	}
}

allConsecDists.sort((a, b) => a - b);
nonStaleDists.sort((a, b) => a - b);

log('### 3.1 All Consecutive Fix Distances');
log('');

const pctiles = [1, 5, 10, 25, 50, 75, 90, 95, 99];
logTable(
	['Percentile', 'All fixes (m)', 'Non-stale only (m)'],
	pctiles.map(p => [
		`P${p}`,
		percentile(allConsecDists, p).toFixed(2),
		percentile(nonStaleDists, p).toFixed(2)
	]).concat([
		['Min', allConsecDists[0].toFixed(4), nonStaleDists[0].toFixed(4)],
		['Max', allConsecDists[allConsecDists.length - 1].toFixed(2), nonStaleDists[nonStaleDists.length - 1].toFixed(2)],
		['Mean', (allConsecDists.reduce((a, b) => a + b, 0) / allConsecDists.length).toFixed(2),
			(nonStaleDists.reduce((a, b) => a + b, 0) / nonStaleDists.length).toFixed(2)],
		['Count', fmt(allConsecDists.length), fmt(nonStaleDists.length)],
	])
);

log('');
log('### 3.2 Distance Bucket Distribution');
log('');

const distBuckets = [
	{ label: '0 m (exact same position)', min: 0, max: 0.001 },
	{ label: '< 1 m', min: 0, max: 1 },
	{ label: '< 5 m', min: 0, max: 5 },
	{ label: '< 10 m', min: 0, max: 10 },
	{ label: '< 50 m', min: 0, max: 50 },
	{ label: '< 100 m', min: 0, max: 100 },
	{ label: '100–200 m', min: 100, max: 200 },
	{ label: '200–500 m', min: 200, max: 500 },
	{ label: '500–1000 m', min: 500, max: 1000 },
	{ label: '> 1000 m', min: 1000, max: Infinity },
];

logTable(
	['Distance range', 'Count', '% of all pairs'],
	distBuckets.map(b => {
		const count = allConsecDists.filter(d => d >= b.min && d < b.max).length;
		return [b.label, fmt(count), `${(count / allConsecDists.length * 100).toFixed(2)}%`];
	})
);

// Per-route distance stats
log('');
log('### 3.3 Distance per Route');
log('');

const routeDistStats = [];
for (const [route, records] of byRoute) {
	// Need to group by bus within route and compute consecutive distances
	const busesInRoute = new Map();
	for (const r of records) {
		if (!busesInRoute.has(r.busId)) busesInRoute.set(r.busId, []);
		busesInRoute.get(r.busId).push(r);
	}

	const dists = [];
	for (const [, busRecords] of busesInRoute) {
		busRecords.sort((a, b) => a.ts - b.ts);
		for (let i = 1; i < busRecords.length; i++) {
			const d = haversineM(busRecords[i - 1].lat, busRecords[i - 1].lng, busRecords[i].lat, busRecords[i].lng);
			dists.push(d);
		}
	}

	if (dists.length < 10) continue;
	dists.sort((a, b) => a - b);
	routeDistStats.push({
		route,
		count: dists.length,
		p50: percentile(dists, 50),
		p90: percentile(dists, 90),
		p99: percentile(dists, 99),
		max: dists[dists.length - 1],
		mean: dists.reduce((a, b) => a + b, 0) / dists.length,
		zeroPct: (dists.filter(d => d < 0.001).length / dists.length * 100),
	});
}

routeDistStats.sort((a, b) => Number(a.route) - Number(b.route));
logTable(
	['Route', 'Pairs', 'P50 (m)', 'P90 (m)', 'P99 (m)', 'Max (m)', 'Mean (m)', '% zero'],
	routeDistStats.map(s => [
		s.route,
		fmt(s.count),
		s.p50.toFixed(1),
		s.p90.toFixed(1),
		s.p99.toFixed(1),
		s.max.toFixed(0),
		s.mean.toFixed(1),
		s.zeroPct.toFixed(1) + '%'
	])
);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: GPS Jitter for Stationary Buses
// ═══════════════════════════════════════════════════════════════════════
log('');
log('## 4. GPS Jitter for Stationary Buses');
log('');

// Find stretches where a bus stays within 5m of the same point for 20+ consecutive fixes
const STATIONARY_RADIUS_M = 5;
const STATIONARY_MIN_FIXES = 20;

const stationaryEpisodes = [];

for (const [busId, records] of byBus) {
	let runStart = 0;
	let runCenterLat = records[0].lat;
	let runCenterLng = records[0].lng;

	for (let i = 1; i <= records.length; i++) {
		const inBounds = i < records.length &&
			haversineM(runCenterLat, runCenterLng, records[i].lat, records[i].lng) < STATIONARY_RADIUS_M;

		if (!inBounds) {
			const runLen = i - runStart;
			if (runLen >= STATIONARY_MIN_FIXES) {
				const segment = records.slice(runStart, i);
				const meanLat = segment.reduce((s, r) => s + r.lat, 0) / segment.length;
				const meanLng = segment.reduce((s, r) => s + r.lng, 0) / segment.length;
				const devsLat = segment.map(r => (r.lat - meanLat) * LAT_M);
				const devsLng = segment.map(r => (r.lng - meanLng) * LNG_M);
				const stdLat = Math.sqrt(devsLat.reduce((s, d) => s + d * d, 0) / devsLat.length);
				const stdLng = Math.sqrt(devsLng.reduce((s, d) => s + d * d, 0) / devsLng.length);
				const dists = segment.map(r => haversineM(meanLat, meanLng, r.lat, r.lng));
				const maxDev = Math.max(...dists);
				const durationS = (segment[segment.length - 1].ts - segment[0].ts) / 1000;

				stationaryEpisodes.push({
					busId,
					fixes: runLen,
					durationS,
					meanLat,
					meanLng,
					stdLatM: stdLat,
					stdLngM: stdLng,
					maxDevM: maxDev,
					rmsM: Math.sqrt(stdLat ** 2 + stdLng ** 2),
				});
			}

			if (i < records.length) {
				runStart = i;
				runCenterLat = records[i].lat;
				runCenterLng = records[i].lng;
			}
		}
	}
}

log(`Found **${fmt(stationaryEpisodes.length)}** stationary episodes (${STATIONARY_MIN_FIXES}+ fixes within ${STATIONARY_RADIUS_M}m)`);
log('');

if (stationaryEpisodes.length > 0) {
	const allStdLat = stationaryEpisodes.map(e => e.stdLatM).sort((a, b) => a - b);
	const allStdLng = stationaryEpisodes.map(e => e.stdLngM).sort((a, b) => a - b);
	const allRms = stationaryEpisodes.map(e => e.rmsM).sort((a, b) => a - b);
	const allMaxDev = stationaryEpisodes.map(e => e.maxDevM).sort((a, b) => a - b);
	const allDurations = stationaryEpisodes.map(e => e.durationS).sort((a, b) => a - b);
	const allFixes = stationaryEpisodes.map(e => e.fixes).sort((a, b) => a - b);

	log('### 4.1 GPS Noise Statistics (from stationary episodes)');
	log('');
	logTable(
		['Metric', 'P10', 'P25', 'P50 (median)', 'P75', 'P90', 'P99', 'Mean'],
		[
			['Std dev lat (m)', ...[10, 25, 50, 75, 90, 99].map(p => percentile(allStdLat, p).toFixed(3)),
				(allStdLat.reduce((a, b) => a + b, 0) / allStdLat.length).toFixed(3)],
			['Std dev lng (m)', ...[10, 25, 50, 75, 90, 99].map(p => percentile(allStdLng, p).toFixed(3)),
				(allStdLng.reduce((a, b) => a + b, 0) / allStdLng.length).toFixed(3)],
			['RMS 2D (m)', ...[10, 25, 50, 75, 90, 99].map(p => percentile(allRms, p).toFixed(3)),
				(allRms.reduce((a, b) => a + b, 0) / allRms.length).toFixed(3)],
			['Max deviation (m)', ...[10, 25, 50, 75, 90, 99].map(p => percentile(allMaxDev, p).toFixed(3)),
				(allMaxDev.reduce((a, b) => a + b, 0) / allMaxDev.length).toFixed(3)],
		]
	);

	log('');
	log('### 4.2 Stationary Episode Characteristics');
	log('');
	logTable(
		['Metric', 'P10', 'P25', 'P50', 'P75', 'P90', 'Max'],
		[
			['Duration (s)', ...[10, 25, 50, 75, 90].map(p => percentile(allDurations, p).toFixed(0)),
				allDurations[allDurations.length - 1].toFixed(0)],
			['Fix count', ...[10, 25, 50, 75, 90].map(p => percentile(allFixes, p).toFixed(0)),
				allFixes[allFixes.length - 1].toFixed(0)],
		]
	);

	// Find the longest stationary episodes
	log('');
	log('### 4.3 Longest Stationary Episodes (top 15)');
	log('');
	const topStationary = [...stationaryEpisodes].sort((a, b) => b.durationS - a.durationS).slice(0, 15);
	logTable(
		['Bus', 'Duration', 'Fixes', 'Std lat (m)', 'Std lng (m)', 'RMS (m)', 'Max dev (m)', 'Location'],
		topStationary.map(e => [
			e.busId,
			`${(e.durationS / 60).toFixed(0)} min`,
			fmt(e.fixes),
			e.stdLatM.toFixed(3),
			e.stdLngM.toFixed(3),
			e.rmsM.toFixed(3),
			e.maxDevM.toFixed(3),
			`${e.meanLat.toFixed(5)}, ${e.meanLng.toFixed(5)}`
		])
	);

	// Summary: what GPS sigma should we use?
	log('');
	const overallStdLat = allStdLat.reduce((a, b) => a + b, 0) / allStdLat.length;
	const overallStdLng = allStdLng.reduce((a, b) => a + b, 0) / allStdLng.length;
	const overallRms = allRms.reduce((a, b) => a + b, 0) / allRms.length;
	log(`**Summary**: Median GPS noise sigma = ${percentile(allRms, 50).toFixed(3)}m RMS (lat: ${percentile(allStdLat, 50).toFixed(3)}m, lng: ${percentile(allStdLng, 50).toFixed(3)}m). Mean RMS = ${overallRms.toFixed(3)}m.`);
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Direction Field Analysis
// ═══════════════════════════════════════════════════════════════════════
log('');
log('## 5. Direction Field Analysis');
log('');

log('### 5.1 Direction Value Distribution');
log('');

const dirValues = allRecords.map(r => r.dir);
const dirCounts = {};
for (const d of dirValues) {
	dirCounts[d] = (dirCounts[d] || 0) + 1;
}

const uniqueDirs = Object.keys(dirCounts).map(Number).sort((a, b) => a - b);
log(`Unique direction values: **${uniqueDirs.length}**`);
log(`Range: **${uniqueDirs[0]}** to **${uniqueDirs[uniqueDirs.length - 1]}**`);
log('');

// Bucket into 10-degree bins
const dirBins = {};
for (let b = 0; b < 360; b += 10) dirBins[b] = 0;
for (const d of dirValues) {
	const bin = Math.floor(d / 10) * 10;
	dirBins[bin] = (dirBins[bin] || 0) + 1;
}

log('**Direction distribution (10° bins):**');
log('');
logTable(
	['Bearing range', 'Count', '%'],
	Object.entries(dirBins).map(([b, c]) => [
		`${b}°–${Number(b) + 10}°`,
		fmt(c),
		`${(c / dirValues.length * 100).toFixed(1)}%`
	])
);

// Check for quantization
log('');
log('### 5.2 Direction Quantization');
log('');

// Most common individual values
const topDirValues = Object.entries(dirCounts)
	.sort(([, a], [, b]) => b - a)
	.slice(0, 20);

log('**Top 20 most frequent direction values:**');
log('');
logTable(
	['Direction', 'Count', '%'],
	topDirValues.map(([d, c]) => [
		`${d}°`,
		fmt(c),
		`${(c / dirValues.length * 100).toFixed(2)}%`
	])
);

// Check if directions are integer-only or have decimals
const dirWithDecimals = dirValues.filter(d => d !== Math.round(d)).length;
log('');
log(`Directions with decimal part: **${fmt(dirWithDecimals)}** out of ${fmt(dirValues.length)} (${(dirWithDecimals / dirValues.length * 100).toFixed(1)}%)`);

// Step size distribution (direction changes between consecutive fixes)
log('');
log('### 5.3 Direction Change Between Consecutive Fixes');
log('');

const dirChanges = [];
for (const [, records] of byBus) {
	for (let i = 1; i < records.length; i++) {
		let delta = records[i].dir - records[i - 1].dir;
		// Normalize to [-180, 180]
		while (delta > 180) delta -= 360;
		while (delta < -180) delta += 360;
		dirChanges.push(Math.abs(delta));
	}
}

dirChanges.sort((a, b) => a - b);
const zeroChanges = dirChanges.filter(d => d === 0).length;
const oneStepChanges = dirChanges.filter(d => d === 1).length;

log(`Zero change (same direction): **${fmt(zeroChanges)}** (${(zeroChanges / dirChanges.length * 100).toFixed(1)}%)`);
log(`1° change: **${fmt(oneStepChanges)}** (${(oneStepChanges / dirChanges.length * 100).toFixed(1)}%)`);
log('');
logTable(
	['Percentile', 'Direction change (°)'],
	pctiles.map(p => [`P${p}`, percentile(dirChanges, p).toFixed(1)])
);

// Correlation with actual movement bearing
log('');
log('### 5.4 Correlation Between Reported Direction and Computed Bearing');
log('');

const bearingErrors = [];
let comparablePairs = 0;

for (const [, records] of byBus) {
	for (let i = 1; i < records.length; i++) {
		const d = haversineM(records[i - 1].lat, records[i - 1].lng, records[i].lat, records[i].lng);
		if (d < 5) continue; // too close to compute reliable bearing

		const computedBearing = bearing(records[i - 1].lat, records[i - 1].lng, records[i].lat, records[i].lng);
		const reportedDir = records[i].dir;
		let error = Math.abs(computedBearing - reportedDir);
		if (error > 180) error = 360 - error;

		bearingErrors.push(error);
		comparablePairs++;
	}
}

bearingErrors.sort((a, b) => a - b);

log(`Comparable pairs (distance >= 5m): **${fmt(comparablePairs)}**`);
log('');
logTable(
	['Percentile', 'Bearing error (°)'],
	[1, 5, 10, 25, 50, 75, 90, 95, 99].map(p => [`P${p}`, percentile(bearingErrors, p).toFixed(1)])
);

const within10 = bearingErrors.filter(e => e <= 10).length;
const within30 = bearingErrors.filter(e => e <= 30).length;
const within45 = bearingErrors.filter(e => e <= 45).length;
const over90 = bearingErrors.filter(e => e > 90).length;

log('');
log(`Within 10° of computed bearing: **${(within10 / bearingErrors.length * 100).toFixed(1)}%**`);
log(`Within 30°: **${(within30 / bearingErrors.length * 100).toFixed(1)}%**`);
log(`Within 45°: **${(within45 / bearingErrors.length * 100).toFixed(1)}%**`);
log(`Off by > 90° (wrong direction): **${(over90 / bearingErrors.length * 100).toFixed(1)}%**`);

// Bearing error vs distance
log('');
log('### 5.5 Bearing Error vs. Distance Moved');
log('');

const distBearingBuckets = [
	{ label: '5–10 m', min: 5, max: 10 },
	{ label: '10–25 m', min: 10, max: 25 },
	{ label: '25–50 m', min: 25, max: 50 },
	{ label: '50–100 m', min: 50, max: 100 },
	{ label: '100–200 m', min: 100, max: 200 },
	{ label: '> 200 m', min: 200, max: Infinity },
];

const distBearingData = [];
for (const [, records] of byBus) {
	for (let i = 1; i < records.length; i++) {
		const d = haversineM(records[i - 1].lat, records[i - 1].lng, records[i].lat, records[i].lng);
		if (d < 5) continue;
		const computedBearing = bearing(records[i - 1].lat, records[i - 1].lng, records[i].lat, records[i].lng);
		let error = Math.abs(computedBearing - records[i].dir);
		if (error > 180) error = 360 - error;
		distBearingData.push({ dist: d, error });
	}
}

logTable(
	['Distance bucket', 'Pairs', 'Median error (°)', 'P90 error (°)', '% within 30°'],
	distBearingBuckets.map(b => {
		const pairs = distBearingData.filter(p => p.dist >= b.min && p.dist < b.max);
		if (pairs.length === 0) return [b.label, '0', '-', '-', '-'];
		const errors = pairs.map(p => p.error).sort((a, b) => a - b);
		return [
			b.label,
			fmt(pairs.length),
			percentile(errors, 50).toFixed(1),
			percentile(errors, 90).toFixed(1),
			`${(errors.filter(e => e <= 30).length / errors.length * 100).toFixed(1)}%`
		];
	})
);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Route Coverage
// ═══════════════════════════════════════════════════════════════════════
log('');
log('## 6. Route Geographic Coverage');
log('');

log('### 6.1 Per-Route Bounding Boxes');
log('');

const routeCoverage = [];
for (const [route, records] of byRoute) {
	let rMinLat = Infinity, rMaxLat = -Infinity, rMinLng = Infinity, rMaxLng = -Infinity;
	for (const r of records) {
		if (r.lat < rMinLat) rMinLat = r.lat;
		if (r.lat > rMaxLat) rMaxLat = r.lat;
		if (r.lng < rMinLng) rMinLng = r.lng;
		if (r.lng > rMaxLng) rMaxLng = r.lng;
	}
	const latSpan = (rMaxLat - rMinLat) * LAT_M;
	const lngSpan = (rMaxLng - rMinLng) * LNG_M;
	const uniqueBuses = new Set(records.map(r => r.busId)).size;

	routeCoverage.push({
		route,
		records: records.length,
		buses: uniqueBuses,
		minLat: rMinLat, maxLat: rMaxLat,
		minLng: rMinLng, maxLng: rMaxLng,
		latSpanKm: latSpan / 1000,
		lngSpanKm: lngSpan / 1000,
		areaKm2: (latSpan / 1000) * (lngSpan / 1000),
	});
}

routeCoverage.sort((a, b) => Number(a.route) - Number(b.route));

logTable(
	['Route', 'Records', 'Buses', 'N-S span (km)', 'E-W span (km)', 'Bbox area (km²)'],
	routeCoverage.map(r => [
		r.route,
		fmt(r.records),
		String(r.buses),
		r.latSpanKm.toFixed(2),
		r.lngSpanKm.toFixed(2),
		r.areaKm2.toFixed(1),
	])
);

// Route overlap analysis
log('');
log('### 6.2 Route Overlap Analysis');
log('');
log('Overlap is measured as the fraction of one route\'s bounding box that intersects with another\'s.');
log('');

// Grid-based density approach: divide the area into 100m x 100m cells
const GRID_CELL_M = 100;
const gridMinLat = minLat;
const gridMinLng = minLng;
const gridRows = Math.ceil((maxLat - minLat) * LAT_M / GRID_CELL_M);
const gridCols = Math.ceil((maxLng - minLng) * LNG_M / GRID_CELL_M);

log(`Grid: ${gridRows} x ${gridCols} cells (${GRID_CELL_M}m resolution)`);
log('');

// For each route, find which grid cells it occupies
const routeCells = new Map();
for (const [route, records] of byRoute) {
	const cells = new Set();
	for (const r of records) {
		const row = Math.floor((r.lat - gridMinLat) * LAT_M / GRID_CELL_M);
		const col = Math.floor((r.lng - gridMinLng) * LNG_M / GRID_CELL_M);
		cells.add(`${row},${col}`);
	}
	routeCells.set(route, cells);
}

// Find most overlapping route pairs
const routeList = [...routeCells.keys()].sort((a, b) => Number(a) - Number(b));
const overlapPairs = [];
for (let i = 0; i < routeList.length; i++) {
	for (let j = i + 1; j < routeList.length; j++) {
		const cellsA = routeCells.get(routeList[i]);
		const cellsB = routeCells.get(routeList[j]);
		let shared = 0;
		for (const c of cellsA) {
			if (cellsB.has(c)) shared++;
		}
		const overlapPct = shared / Math.min(cellsA.size, cellsB.size) * 100;
		if (shared > 0) {
			overlapPairs.push({
				routeA: routeList[i],
				routeB: routeList[j],
				shared,
				cellsA: cellsA.size,
				cellsB: cellsB.size,
				overlapPct,
			});
		}
	}
}

overlapPairs.sort((a, b) => b.overlapPct - a.overlapPct);

log('**Top 20 most overlapping route pairs** (by % of smaller route\'s cells shared):');
log('');
logTable(
	['Route A', 'Route B', 'Shared cells', 'Cells A', 'Cells B', 'Overlap %'],
	overlapPairs.slice(0, 20).map(o => [
		o.routeA, o.routeB,
		fmt(o.shared), fmt(o.cellsA), fmt(o.cellsB),
		o.overlapPct.toFixed(1) + '%'
	])
);

// Bus density heatmap (grid cell counts)
log('');
log('### 6.3 Bus Density — Highest Activity Grid Cells');
log('');

const cellDensity = {};
for (const r of allRecords) {
	const row = Math.floor((r.lat - gridMinLat) * LAT_M / GRID_CELL_M);
	const col = Math.floor((r.lng - gridMinLng) * LNG_M / GRID_CELL_M);
	const key = `${row},${col}`;
	cellDensity[key] = (cellDensity[key] || 0) + 1;
}

const cellEntries = Object.entries(cellDensity).sort(([, a], [, b]) => b - a);
const totalCellsOccupied = cellEntries.length;
log(`Total 100m grid cells with at least 1 fix: **${fmt(totalCellsOccupied)}** out of ${fmt(gridRows * gridCols)} total`);
log('');

log('**Top 20 highest-density cells** (${GRID_CELL_M}m x ${GRID_CELL_M}m):');
log('');
logTable(
	['Rank', 'Fixes', 'Approx location (lat, lng)', 'Routes present'],
	cellEntries.slice(0, 20).map(([key, count], idx) => {
		const [row, col] = key.split(',').map(Number);
		const cellLat = gridMinLat + (row + 0.5) * GRID_CELL_M / LAT_M;
		const cellLng = gridMinLng + (col + 0.5) * GRID_CELL_M / LNG_M;

		// Find which routes have fixes in this cell
		const routesHere = [];
		for (const [route, cells] of routeCells) {
			if (cells.has(key)) routesHere.push(route);
		}

		return [
			String(idx + 1),
			fmt(count),
			`${cellLat.toFixed(5)}, ${cellLng.toFixed(5)}`,
			routesHere.sort((a, b) => Number(a) - Number(b)).join(', ')
		];
	})
);

// Cell count distribution
const cellCountsSorted = cellEntries.map(([, c]) => c).sort((a, b) => a - b);
log('');
log('**Distribution of fixes per occupied cell:**');
log('');
logTable(
	['Percentile', 'Fixes in cell'],
	[10, 25, 50, 75, 90, 95, 99].map(p => [
		`P${p}`,
		fmt(Math.round(percentile(cellCountsSorted, p)))
	])
);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: Large Position Jumps
// ═══════════════════════════════════════════════════════════════════════
log('');
log('## 7. Large Position Jumps (> 200m Between Consecutive Fixes)');
log('');

const largeJumps = [];

for (const [busId, records] of byBus) {
	for (let i = 1; i < records.length; i++) {
		const d = haversineM(records[i - 1].lat, records[i - 1].lng, records[i].lat, records[i].lng);
		const dtS = (records[i].ts - records[i - 1].ts) / 1000;
		if (d > 200) {
			const impliedSpeedKmh = dtS > 0 ? (d / 1000) / (dtS / 3600) : Infinity;
			largeJumps.push({
				busId,
				route: records[i].route,
				distance: d,
				dtS,
				impliedSpeedKmh,
				fromLat: records[i - 1].lat,
				fromLng: records[i - 1].lng,
				toLat: records[i].lat,
				toLng: records[i].lng,
				fromTs: records[i - 1].ts,
				toTs: records[i].ts,
				idx: i,
			});
		}
	}
}

largeJumps.sort((a, b) => b.distance - a.distance);

log(`Total jumps > 200m: **${fmt(largeJumps.length)}**`);
log('');

// Distribution
const jumpBuckets = [
	{ label: '200–500 m', min: 200, max: 500 },
	{ label: '500–1000 m', min: 500, max: 1000 },
	{ label: '1–2 km', min: 1000, max: 2000 },
	{ label: '2–5 km', min: 2000, max: 5000 },
	{ label: '5–10 km', min: 5000, max: 10000 },
	{ label: '> 10 km', min: 10000, max: Infinity },
];

log('### 7.1 Jump Distance Distribution');
log('');
logTable(
	['Distance range', 'Count', '%'],
	jumpBuckets.map(b => {
		const count = largeJumps.filter(j => j.distance >= b.min && j.distance < b.max).length;
		return [b.label, fmt(count), `${(count / largeJumps.length * 100).toFixed(1)}%`];
	})
);

// Are jumps "instantaneous" (same timestamp) or over time?
log('');
log('### 7.2 Time Gap During Jumps');
log('');

const jumpTimeGaps = largeJumps.map(j => j.dtS).sort((a, b) => a - b);
logTable(
	['Percentile', 'Time gap (s)'],
	[1, 10, 25, 50, 75, 90, 99].map(p => [`P${p}`, percentile(jumpTimeGaps, p).toFixed(1)])
);

// Which buses have the most jumps?
log('');
log('### 7.3 Buses with Most Jumps');
log('');

const jumpsByBus = {};
for (const j of largeJumps) {
	jumpsByBus[j.busId] = (jumpsByBus[j.busId] || 0) + 1;
}
const topJumpBuses = Object.entries(jumpsByBus).sort(([, a], [, b]) => b - a).slice(0, 15);
logTable(
	['Bus', 'Jumps > 200m', 'Largest jump (m)'],
	topJumpBuses.map(([bus, count]) => {
		const busJumps = largeJumps.filter(j => j.busId === bus);
		const maxJump = Math.max(...busJumps.map(j => j.distance));
		return [bus, fmt(count), fmt(Math.round(maxJump))];
	})
);

// Largest jumps with context
log('');
log('### 7.4 Top 20 Largest Jumps');
log('');
logTable(
	['Rank', 'Bus', 'Route', 'Distance', 'Time gap', 'Implied speed', 'From → To'],
	largeJumps.slice(0, 20).map((j, idx) => [
		String(idx + 1),
		j.busId,
		j.route,
		`${(j.distance / 1000).toFixed(2)} km`,
		`${j.dtS.toFixed(0)} s`,
		j.impliedSpeedKmh === Infinity ? '∞' : `${j.impliedSpeedKmh.toFixed(0)} km/h`,
		`(${j.fromLat.toFixed(4)}, ${j.fromLng.toFixed(4)}) → (${j.toLat.toFixed(4)}, ${j.toLng.toFixed(4)})`
	])
);

// Classify jumps: plausible travel vs GPS glitch
log('');
log('### 7.5 Jump Classification');
log('');

const plausibleJumps = largeJumps.filter(j => j.impliedSpeedKmh <= 90);
const suspiciousJumps = largeJumps.filter(j => j.impliedSpeedKmh > 90 && j.impliedSpeedKmh <= 200);
const glitchJumps = largeJumps.filter(j => j.impliedSpeedKmh > 200);

log(`Plausible travel (implied speed ≤ 90 km/h): **${fmt(plausibleJumps.length)}** (${(plausibleJumps.length / largeJumps.length * 100).toFixed(1)}%)`);
log(`Suspicious (90–200 km/h): **${fmt(suspiciousJumps.length)}** (${(suspiciousJumps.length / largeJumps.length * 100).toFixed(1)}%)`);
log(`GPS glitch (> 200 km/h): **${fmt(glitchJumps.length)}** (${(glitchJumps.length / largeJumps.length * 100).toFixed(1)}%)`);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: Position Repetition
// ═══════════════════════════════════════════════════════════════════════
log('');
log('## 8. Position Repetition');
log('');

log('### 8.1 Exact Position Repeats Per Bus');
log('');

// How often does the exact same (lat,lng) pair repeat for the same bus?
let totalExactRepeats = 0;
let totalPairs = 0;
const perBusRepeatRate = [];

for (const [busId, records] of byBus) {
	let repeats = 0;
	for (let i = 1; i < records.length; i++) {
		totalPairs++;
		if (records[i].lat === records[i - 1].lat && records[i].lng === records[i - 1].lng) {
			repeats++;
			totalExactRepeats++;
		}
	}
	if (records.length > 10) {
		perBusRepeatRate.push({
			busId,
			total: records.length - 1,
			repeats,
			pct: repeats / (records.length - 1) * 100
		});
	}
}

log(`Total consecutive exact-position repeats: **${fmt(totalExactRepeats)}** out of ${fmt(totalPairs)} pairs (**${(totalExactRepeats / totalPairs * 100).toFixed(1)}%**)`);
log('');

perBusRepeatRate.sort((a, b) => b.pct - a.pct);
log('**Top 15 buses by repeat rate:**');
log('');
logTable(
	['Bus', 'Total pairs', 'Exact repeats', 'Repeat %'],
	perBusRepeatRate.slice(0, 15).map(b => [
		b.busId, fmt(b.total), fmt(b.repeats), b.pct.toFixed(1) + '%'
	])
);

const repeatPcts = perBusRepeatRate.map(b => b.pct).sort((a, b) => a - b);
log('');
log('**Distribution of per-bus repeat rates:**');
log('');
logTable(
	['Percentile', 'Repeat %'],
	[10, 25, 50, 75, 90, 99].map(p => [`P${p}`, percentile(repeatPcts, p).toFixed(1) + '%'])
);

// "Favorite" positions — positions that appear many times across the whole dataset
log('');
log('### 8.2 Fleet-Wide "Favorite" Positions (Likely Bus Stops or Terminals)');
log('');

const positionCounts = {};
for (const r of allRecords) {
	const key = `${r.lat},${r.lng}`;
	if (!positionCounts[key]) {
		positionCounts[key] = { lat: r.lat, lng: r.lng, count: 0, buses: new Set(), routes: new Set() };
	}
	positionCounts[key].count++;
	positionCounts[key].buses.add(r.busId);
	positionCounts[key].routes.add(r.route);
}

const posEntries = Object.values(positionCounts).sort((a, b) => b.count - a.count);

log(`Total unique (lat,lng) pairs in dataset: **${fmt(posEntries.length)}**`);
log(`Records per unique position — mean: **${(allRecords.length / posEntries.length).toFixed(1)}**`);
log('');

log('**Top 30 most-reported exact positions:**');
log('');
logTable(
	['Rank', 'Lat', 'Lng', 'Times reported', 'Distinct buses', 'Routes'],
	posEntries.slice(0, 30).map((p, idx) => [
		String(idx + 1),
		p.lat.toFixed(7),
		p.lng.toFixed(7),
		fmt(p.count),
		String(p.buses.size),
		[...p.routes].sort((a, b) => Number(a) - Number(b)).join(', ')
	])
);

// Distribution of position frequency
log('');
log('### 8.3 Position Frequency Distribution');
log('');

const posCounts = posEntries.map(p => p.count).sort((a, b) => a - b);
logTable(
	['Percentile', 'Times position appears'],
	[50, 75, 90, 95, 99, 99.9].map(p => [`P${p}`, fmt(Math.round(percentile(posCounts, p)))])
);

const singleUse = posCounts.filter(c => c === 1).length;
const multiUse = posCounts.filter(c => c > 1).length;
const heavyUse = posCounts.filter(c => c >= 10).length;
const veryHeavy = posCounts.filter(c => c >= 50).length;

log('');
logTable(
	['Category', 'Count', '% of unique positions'],
	[
		['Used exactly once', fmt(singleUse), `${(singleUse / posEntries.length * 100).toFixed(1)}%`],
		['Used > 1 time', fmt(multiUse), `${(multiUse / posEntries.length * 100).toFixed(1)}%`],
		['Used ≥ 10 times', fmt(heavyUse), `${(heavyUse / posEntries.length * 100).toFixed(1)}%`],
		['Used ≥ 50 times', fmt(veryHeavy), `${(veryHeavy / posEntries.length * 100).toFixed(1)}%`],
	]
);

// Multi-bus positions (same exact coordinates from different buses = likely bus stops)
log('');
log('### 8.4 Multi-Bus Positions (Same Exact Coordinates from Different Buses)');
log('');

const multiBusPositions = posEntries.filter(p => p.buses.size > 1).sort((a, b) => b.buses.size - a.buses.size);
log(`Positions reported by more than 1 bus: **${fmt(multiBusPositions.length)}**`);
log('');

log('**Top 20 positions visited by most distinct buses:**');
log('');
logTable(
	['Rank', 'Lat', 'Lng', 'Distinct buses', 'Total reports', 'Routes'],
	multiBusPositions.slice(0, 20).map((p, idx) => [
		String(idx + 1),
		p.lat.toFixed(7),
		p.lng.toFixed(7),
		String(p.buses.size),
		fmt(p.count),
		[...p.routes].sort((a, b) => Number(a) - Number(b)).join(', ')
	])
);

// ═══════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════
log('');
log('## Summary of Key Findings');
log('');

log('### GPS Quality');
if (stationaryEpisodes.length > 0) {
	const medRms = percentile(stationaryEpisodes.map(e => e.rmsM).sort((a, b) => a - b), 50);
	log(`- **GPS noise sigma**: Median ${medRms.toFixed(3)}m RMS when stationary (measured from ${fmt(stationaryEpisodes.length)} parking episodes)`);
}
log(`- **Coordinate precision**: Typically ${latDPKeys[Math.floor(latDPKeys.length / 2)]}–${latDPKeys[latDPKeys.length - 1]} decimal places (sub-meter to ~0.01m theoretical precision)`);
log(`- **Position repeats**: ${(totalExactRepeats / totalPairs * 100).toFixed(1)}% of consecutive fixes have identical coordinates (stale/cached GPS)`);
log(`- **Large jumps (>200m)**: ${fmt(largeJumps.length)} total, of which ${fmt(glitchJumps.length)} are likely GPS glitches (implied speed >200 km/h)`);

log('');
log('### Geographic Coverage');
log(`- **Operating area**: ~${(latSpanM / 1000).toFixed(1)} km (N-S) x ${(lngSpanM / 1000).toFixed(1)} km (E-W)`);
log(`- **Centroid**: ${avgLat.toFixed(4)}°N, ${avgLng.toFixed(4)}°W`);
log(`- **${byRoute.size} routes** covering ${fmt(totalCellsOccupied)} distinct 100m grid cells`);
const topOverlap = overlapPairs.length > 0 ? overlapPairs[0] : null;
if (topOverlap) {
	log(`- **Most overlapping routes**: ${topOverlap.routeA} and ${topOverlap.routeB} (${topOverlap.overlapPct.toFixed(0)}% cell overlap)`);
}

log('');
log('### Direction Field');
log(`- ${dirWithDecimals === 0 ? 'Integer-only' : 'Has decimals'} — ${uniqueDirs.length} unique values`);
log(`- Direction matches computed bearing: median error ${percentile(bearingErrors, 50).toFixed(1)}° (for moves > 5m)`);
log(`- ${(within30 / bearingErrors.length * 100).toFixed(0)}% of fixes have direction within 30° of computed bearing`);

log('');
log('---');
log(`*Analysis run on ${new Date().toISOString()} against ${DATASET}*`);

// Write the full output
import { writeFileSync, mkdirSync } from 'fs';
mkdirSync('docs/analysis', { recursive: true });
writeFileSync('docs/analysis/02-spatial-geographic.md', output.join('\n'));
console.log('\n\nOutput written to docs/analysis/02-spatial-geographic.md');
