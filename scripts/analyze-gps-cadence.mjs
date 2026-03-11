#!/usr/bin/env node
/**
 * Phase 1 Analysis: GPS update cadence and stale reading detection.
 * Processes the JSONL dataset to understand the data characteristics.
 */

import { readFileSync, writeFileSync } from 'fs';

const DATASET = 'data/2026-03-11.jsonl';
const OUTDIR = 'docs/speed-analysis';

// Haversine distance in meters
function haversineM(lat1, lng1, lat2, lng2) {
	const R = 6371000;
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLng = (lng2 - lng1) * Math.PI / 180;
	const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

console.log('Reading dataset...');
const lines = readFileSync(DATASET, 'utf8').trim().split('\n');
console.log(`Total records: ${lines.length}`);

// Parse and group by bus
const byBus = new Map();
for (const line of lines) {
	const r = JSON.parse(line);
	const busId = r.b;
	if (!byBus.has(busId)) byBus.set(busId, []);
	byBus.get(busId).push({ lat: r.la, lng: r.ln, ts: r.ts, route: r.r, headsign: r.h });
}

// Sort each bus's records by timestamp
for (const [, records] of byBus) {
	records.sort((a, b) => a.ts - b.ts);
}

console.log(`Unique buses: ${byBus.size}`);

// ── Analysis 1: GPS update cadence ──────────────────────────────────
console.log('\n=== GPS UPDATE CADENCE ===');

const STALE_THRESHOLD_M = 0.5; // meters - positions within this are "same"

let totalReadings = 0;
let totalStale = 0;
let totalDuplicateTs = 0;
const allTimeGaps = [];
const realUpdateGaps = [];
const staleRunLengths = [];
const perBusStats = [];

for (const [busId, records] of byBus) {
	if (records.length < 10) continue;

	let busStale = 0;
	let busDupTs = 0;
	let busRealUpdates = 0;
	let currentStaleRun = 0;
	let lastRealUpdateTs = records[0].ts;

	for (let i = 1; i < records.length; i++) {
		const prev = records[i-1];
		const curr = records[i];
		const dtMs = curr.ts - prev.ts;
		const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);

		totalReadings++;
		allTimeGaps.push(dtMs / 1000);

		if (dtMs === 0) {
			totalDuplicateTs++;
			busDupTs++;
			continue;
		}

		if (dist < STALE_THRESHOLD_M) {
			totalStale++;
			busStale++;
			currentStaleRun++;
		} else {
			// Real position update
			busRealUpdates++;
			const gapFromLastReal = curr.ts - lastRealUpdateTs;
			realUpdateGaps.push(gapFromLastReal / 1000);
			lastRealUpdateTs = curr.ts;

			if (currentStaleRun > 0) {
				staleRunLengths.push(currentStaleRun);
				currentStaleRun = 0;
			}
		}
	}

	if (currentStaleRun > 0) staleRunLengths.push(currentStaleRun);

	const stalePct = records.length > 1 ? (busStale / (records.length - 1) * 100) : 0;
	perBusStats.push({
		busId,
		totalRecords: records.length,
		staleCount: busStale,
		stalePct: stalePct.toFixed(1),
		dupTsCount: busDupTs,
		realUpdates: busRealUpdates,
		durationMin: ((records[records.length-1].ts - records[0].ts) / 60000).toFixed(1),
	});
}

// Summary stats
console.log(`Total inter-reading pairs: ${totalReadings}`);
console.log(`Stale readings (dist < ${STALE_THRESHOLD_M}m): ${totalStale} (${(totalStale/totalReadings*100).toFixed(1)}%)`);
console.log(`Duplicate timestamps: ${totalDuplicateTs} (${(totalDuplicateTs/totalReadings*100).toFixed(1)}%)`);

// Time gap distribution (all readings)
const gapBuckets = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 60, 120, 300, Infinity];
console.log('\nAll-readings time gap distribution:');
for (let i = 0; i < gapBuckets.length - 1; i++) {
	const count = allTimeGaps.filter(g => g >= gapBuckets[i] && g < gapBuckets[i+1]).length;
	const pct = (count / allTimeGaps.length * 100).toFixed(1);
	console.log(`  ${gapBuckets[i]}-${gapBuckets[i+1]}s: ${count} (${pct}%)`);
}

// Real update gap distribution
console.log('\nReal-update time gap distribution:');
for (let i = 0; i < gapBuckets.length - 1; i++) {
	const count = realUpdateGaps.filter(g => g >= gapBuckets[i] && g < gapBuckets[i+1]).length;
	const pct = realUpdateGaps.length > 0 ? (count / realUpdateGaps.length * 100).toFixed(1) : '0.0';
	console.log(`  ${gapBuckets[i]}-${gapBuckets[i+1]}s: ${count} (${pct}%)`);
}

// Stale run length distribution
const runBuckets = [1, 2, 3, 4, 5, 10, 20, 50, 100, Infinity];
console.log('\nStale run length distribution:');
for (let i = 0; i < runBuckets.length - 1; i++) {
	const count = staleRunLengths.filter(r => r >= runBuckets[i] && r < runBuckets[i+1]).length;
	const pct = staleRunLengths.length > 0 ? (count / staleRunLengths.length * 100).toFixed(1) : '0.0';
	console.log(`  ${runBuckets[i]}-${runBuckets[i+1]}: ${count} (${pct}%)`);
}

const avgStaleRun = staleRunLengths.length > 0
	? (staleRunLengths.reduce((a,b) => a+b, 0) / staleRunLengths.length).toFixed(1)
	: 0;
const maxStaleRun = staleRunLengths.length > 0 ? Math.max(...staleRunLengths) : 0;
console.log(`\nAvg stale run: ${avgStaleRun}, Max: ${maxStaleRun}`);

const avgRealGap = realUpdateGaps.length > 0
	? (realUpdateGaps.reduce((a,b) => a+b, 0) / realUpdateGaps.length).toFixed(1)
	: 0;
const medianRealGap = realUpdateGaps.length > 0
	? realUpdateGaps.sort((a,b) => a-b)[Math.floor(realUpdateGaps.length/2)].toFixed(1)
	: 0;
console.log(`Real update gap: avg=${avgRealGap}s, median=${medianRealGap}s`);

// ── Analysis 2: Per-bus summary ──────────────────────────────────────
perBusStats.sort((a, b) => parseFloat(b.stalePct) - parseFloat(a.stalePct));
console.log('\n=== PER-BUS STALE RATE (top 20) ===');
console.log('BusId     | Records | Stale% | RealUpdates | Duration(min)');
for (const s of perBusStats.slice(0, 20)) {
	console.log(`${s.busId.padEnd(10)}| ${String(s.totalRecords).padEnd(8)}| ${s.stalePct.padStart(5)}% | ${String(s.realUpdates).padEnd(12)}| ${s.durationMin}`);
}

// ── Analysis 3: Detailed trace for a few buses ───────────────────────
// Pick buses with good data: > 500 records, mid-range stale rate
const goodBuses = perBusStats
	.filter(s => s.totalRecords > 500 && parseFloat(s.stalePct) > 20 && parseFloat(s.stalePct) < 80)
	.slice(0, 5);

console.log('\n=== DETAILED TRACE BUSES ===');
for (const s of goodBuses) {
	console.log(`${s.busId}: ${s.totalRecords} records, ${s.stalePct}% stale, ${s.durationMin} min`);
}

// Write detailed trace CSVs
for (const busInfo of goodBuses) {
	const records = byBus.get(busInfo.busId);
	const rows = ['ts,lat,lng,dt_s,dist_m,implied_speed_kmh,is_stale,stale_run,real_gap_s'];

	let staleRun = 0;
	let lastRealTs = records[0].ts;
	let lastRealLat = records[0].lat;
	let lastRealLng = records[0].lng;

	for (let i = 1; i < records.length; i++) {
		const prev = records[i-1];
		const curr = records[i];
		const dt = (curr.ts - prev.ts) / 1000;
		const dist = haversineM(prev.lat, prev.lng, curr.lat, curr.lng);
		const impliedSpeed = dt > 0 ? (dist / 1000) / (dt / 3600) : 0;
		const isStale = dist < STALE_THRESHOLD_M;

		if (isStale) {
			staleRun++;
		} else {
			const realGap = (curr.ts - lastRealTs) / 1000;
			const realDist = haversineM(lastRealLat, lastRealLng, curr.lat, curr.lng);
			const correctedSpeed = realGap > 0 ? (realDist / 1000) / (realGap / 3600) : 0;

			rows.push(`${curr.ts},${curr.lat},${curr.lng},${dt.toFixed(1)},${dist.toFixed(1)},${impliedSpeed.toFixed(1)},${isStale},${staleRun},${realGap.toFixed(1)}`);

			staleRun = 0;
			lastRealTs = curr.ts;
			lastRealLat = curr.lat;
			lastRealLng = curr.lng;
		}

		if (isStale) {
			rows.push(`${curr.ts},${curr.lat},${curr.lng},${dt.toFixed(1)},${dist.toFixed(1)},${impliedSpeed.toFixed(1)},${isStale},${staleRun},0`);
		}
	}

	writeFileSync(`${OUTDIR}/trace_${busInfo.busId.replace(/[^a-zA-Z0-9-]/g, '_')}.csv`, rows.join('\n'));
}

// ── Analysis 4: Simulate current Kalman offline ──────────────────────
console.log('\n=== SIMULATING CURRENT KALMAN FILTER ===');

// Port the exact Kalman logic from kalman-speed-calculator.ts
const SIGMA_A = 0.8;
const SIGMA_GPS = 5.0;
const MIN_DIST = 10.0;
const STAT_CONFIRM = 2;
const CONSERVATIVE = 0.95;
const EP_BUFFER_SIZE = 6;
const MIN_FIXES = 3;
const MAX_SPEED = 120;
const LAT_M = 111000;
const LNG_M = 48600;

function createAxis(posM) {
	const R = SIGMA_GPS * SIGMA_GPS;
	return { p: posM, v: 0, P00: R, P01: 0, P11: 100 };
}

function predict(ax, dt) {
	const s2 = SIGMA_A * SIGMA_A;
	return {
		p: ax.p + ax.v * dt,
		v: ax.v,
		P00: ax.P00 + dt*ax.P01 + dt*(ax.P01 + dt*ax.P11) + s2*(dt**4/4),
		P01: ax.P01 + dt*ax.P11 + s2*(dt**3/2),
		P11: ax.P11 + s2*dt*dt,
	};
}

function update(pred, meas) {
	const R = SIGMA_GPS * SIGMA_GPS;
	const inn = meas - pred.p;
	const S = pred.P00 + R;
	const K0 = pred.P00 / S;
	const K1 = pred.P01 / S;
	return {
		p: pred.p + K0 * inn,
		v: pred.v + K1 * inn,
		P00: (1-K0)*pred.P00,
		P01: (1-K0)*pred.P01,
		P11: -K1*pred.P01 + pred.P11,
	};
}

function simulateKalmanForBus(records) {
	if (records.length < 2) return [];

	const results = [];
	const ref = { lat: records[0].lat, lng: records[0].lng };
	let xAxis = createAxis(0);
	let yAxis = createAxis(0);
	let lastTs = records[0].ts;
	let fixCount = 1;
	let statCount = 0;
	let lastReported = 0;
	const posBuf = [{ lat: records[0].lat, lng: records[0].lng, ts: records[0].ts }];

	results.push({
		ts: records[0].ts,
		lat: records[0].lat,
		lng: records[0].lng,
		kalmanSpeed: 0,
		endpointSpeed: 0,
		finalSpeed: 0,
		isStale: false,
		isStationary: false,
		rawDist: 0,
		rawDt: 0,
		rawImplied: 0,
		statCount: 0,
	});

	for (let i = 1; i < records.length; i++) {
		const curr = records[i];
		const dtMs = curr.ts - lastTs;
		const dtS = dtMs / 1000;

		if (dtS < 1) continue; // min time gap

		const mx = (curr.lng - ref.lng) * LNG_M;
		const my = (curr.lat - ref.lat) * LAT_M;
		const dx = mx - xAxis.p;
		const dy = my - yAxis.p;
		const distFromState = Math.sqrt(dx*dx + dy*dy);

		// Outlier rejection
		if (distFromState > 500) {
			// Reset
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastTs = curr.ts; fixCount = 1; statCount = 0; lastReported = 0;
			posBuf.length = 0;
			posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
			continue;
		}

		const rawSpeed = dtS > 0 ? (distFromState / 1000) / (dtS / 3600) : 0;
		if (rawSpeed > MAX_SPEED) {
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastTs = curr.ts; fixCount = 1; statCount = 0; lastReported = 0;
			posBuf.length = 0;
			posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
			continue;
		}

		const isStale = distFromState < MIN_DIST;

		// Kalman predict + update
		const predX = predict(xAxis, dtS);
		const predY = predict(yAxis, dtS);
		xAxis = update(predX, mx);
		yAxis = update(predY, my);
		lastTs = curr.ts;
		fixCount++;
		posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
		if (posBuf.length > EP_BUFFER_SIZE) posBuf.shift();

		if (isStale) {
			statCount++;
			if (statCount >= STAT_CONFIRM) {
				xAxis.v = 0; yAxis.v = 0;
				lastReported = 0;
				results.push({
					ts: curr.ts, lat: curr.lat, lng: curr.lng,
					kalmanSpeed: 0, endpointSpeed: 0, finalSpeed: 0,
					isStale: true, isStationary: true,
					rawDist: distFromState, rawDt: dtS, rawImplied: rawSpeed,
					statCount,
				});
				continue;
			}
			results.push({
				ts: curr.ts, lat: curr.lat, lng: curr.lng,
				kalmanSpeed: Math.sqrt(xAxis.v**2 + yAxis.v**2) * 3.6,
				endpointSpeed: 0, finalSpeed: lastReported,
				isStale: true, isStationary: false,
				rawDist: distFromState, rawDt: dtS, rawImplied: rawSpeed,
				statCount,
			});
			continue;
		}

		statCount = 0;

		if (fixCount < MIN_FIXES) {
			lastReported = 0;
			results.push({
				ts: curr.ts, lat: curr.lat, lng: curr.lng,
				kalmanSpeed: 0, endpointSpeed: 0, finalSpeed: 0,
				isStale: false, isStationary: false,
				rawDist: distFromState, rawDt: dtS, rawImplied: rawSpeed,
				statCount: 0,
			});
			continue;
		}

		const kalSpeed = Math.sqrt(xAxis.v**2 + yAxis.v**2) * 3.6;

		// Endpoint bound
		let final = kalSpeed;
		if (posBuf.length >= 3) {
			const first = posBuf[0];
			const last = posBuf[posBuf.length - 1];
			const epDist = haversineM(first.lat, first.lng, last.lat, last.lng);
			const epTime = (last.ts - first.ts) / 1000;
			if (epTime > 0) {
				const epSpeed = (epDist / 1000) / (epTime / 3600);
				final = Math.min(kalSpeed, epSpeed);
			}
		}

		final = Math.max(0, Math.min(MAX_SPEED, final * CONSERVATIVE));
		lastReported = final;

		results.push({
			ts: curr.ts, lat: curr.lat, lng: curr.lng,
			kalmanSpeed: kalSpeed,
			endpointSpeed: posBuf.length >= 3 ? final / CONSERVATIVE : 0,
			finalSpeed: final,
			isStale: false, isStationary: false,
			rawDist: distFromState, rawDt: dtS, rawImplied: rawSpeed,
			statCount: 0,
		});
	}

	return results;
}

// ── Analysis 5: Ground truth reconstruction ──────────────────────────
function reconstructGroundTruth(records) {
	// Filter to only genuine position changes, compute speed using
	// displacement over full gap since last real update
	const realUpdates = [{ ...records[0], speed: 0 }];
	let lastReal = records[0];

	for (let i = 1; i < records.length; i++) {
		const curr = records[i];
		const dist = haversineM(lastReal.lat, lastReal.lng, curr.lat, curr.lng);
		if (dist >= STALE_THRESHOLD_M) {
			const dt = (curr.ts - lastReal.ts) / 1000;
			const speed = dt > 0 ? (dist / 1000) / (dt / 3600) : 0;
			realUpdates.push({ ...curr, speed });
			lastReal = curr;
		}
	}

	// Apply simple 3-point moving average for smoothing
	const smoothed = [];
	for (let i = 0; i < realUpdates.length; i++) {
		const window = [];
		for (let j = Math.max(0, i-1); j <= Math.min(realUpdates.length-1, i+1); j++) {
			window.push(realUpdates[j].speed);
		}
		const avg = window.reduce((a,b) => a+b, 0) / window.length;
		smoothed.push({ ...realUpdates[i], smoothSpeed: avg * 0.95 }); // conservative
	}

	return smoothed;
}

// Run simulation for selected buses
for (const busInfo of goodBuses) {
	const records = byBus.get(busInfo.busId);
	console.log(`\nSimulating ${busInfo.busId} (${records.length} records)...`);

	const kalResults = simulateKalmanForBus(records);
	const groundTruth = reconstructGroundTruth(records);

	// Write Kalman simulation CSV
	const kalRows = ['ts,lat,lng,kalman_speed,endpoint_speed,final_speed,is_stale,is_stationary,raw_dist,raw_dt,raw_implied,stat_count'];
	for (const r of kalResults) {
		kalRows.push(`${r.ts},${r.lat},${r.lng},${r.kalmanSpeed.toFixed(2)},${r.endpointSpeed.toFixed(2)},${r.finalSpeed.toFixed(2)},${r.isStale},${r.isStationary},${r.rawDist.toFixed(2)},${r.rawDt.toFixed(2)},${r.rawImplied.toFixed(2)},${r.statCount}`);
	}
	writeFileSync(`${OUTDIR}/kalman_${busInfo.busId.replace(/[^a-zA-Z0-9-]/g, '_')}.csv`, kalRows.join('\n'));

	// Write ground truth CSV
	const gtRows = ['ts,lat,lng,raw_speed,smooth_speed'];
	for (const r of groundTruth) {
		gtRows.push(`${r.ts},${r.lat},${r.lng},${r.speed.toFixed(2)},${r.smoothSpeed.toFixed(2)}`);
	}
	writeFileSync(`${OUTDIR}/groundtruth_${busInfo.busId.replace(/[^a-zA-Z0-9-]/g, '_')}.csv`, gtRows.join('\n'));

	// Quantify problems
	let falseZeros = 0;
	let spikesOver80 = 0;
	let zeroEpisodes = 0;
	let inZeroEpisode = false;

	for (let i = 1; i < kalResults.length; i++) {
		const prev = kalResults[i-1];
		const curr = kalResults[i];

		// False zero: speed was >5, drops to 0, then goes back >5 within 10s
		if (curr.finalSpeed === 0 && prev.finalSpeed > 5) {
			// Look ahead to see if it recovers
			for (let j = i+1; j < kalResults.length && j < i+10; j++) {
				if (kalResults[j].finalSpeed > 5) {
					falseZeros++;
					break;
				}
			}
		}

		if (curr.finalSpeed > 80) spikesOver80++;

		// Zero episodes
		if (curr.finalSpeed === 0 && !inZeroEpisode && prev.finalSpeed > 5) {
			zeroEpisodes++;
			inZeroEpisode = true;
		}
		if (curr.finalSpeed > 0) inZeroEpisode = false;
	}

	console.log(`  Kalman results: ${kalResults.length} points`);
	console.log(`  False zero drops: ${falseZeros}`);
	console.log(`  Spikes > 80 km/h: ${spikesOver80}`);
	console.log(`  Zero episodes: ${zeroEpisodes}`);

	// Compare Kalman vs ground truth at matching timestamps
	const gtMap = new Map(groundTruth.map(g => [g.ts, g.smoothSpeed]));
	let overestimates = 0;
	let totalComparisons = 0;
	for (const kr of kalResults) {
		const gt = gtMap.get(kr.ts);
		if (gt != null && kr.finalSpeed > 0) {
			totalComparisons++;
			if (kr.finalSpeed > gt * 1.1) overestimates++; // >10% overestimate
		}
	}
	console.log(`  Overestimates vs ground truth: ${overestimates}/${totalComparisons}`);
}

// ── Summary for all buses ────────────────────────────────────────────
console.log('\n=== FLEET-WIDE PROBLEM QUANTIFICATION ===');

let totalFalseZeros = 0;
let totalSpikes = 0;
let totalBusesAnalyzed = 0;
let totalPointsAnalyzed = 0;

for (const [busId, records] of byBus) {
	if (records.length < 50) continue;
	totalBusesAnalyzed++;

	const results = simulateKalmanForBus(records);
	totalPointsAnalyzed += results.length;

	for (let i = 1; i < results.length; i++) {
		const prev = results[i-1];
		const curr = results[i];

		if (curr.finalSpeed === 0 && prev.finalSpeed > 5) {
			for (let j = i+1; j < results.length && j < i+10; j++) {
				if (results[j].finalSpeed > 5) {
					totalFalseZeros++;
					break;
				}
			}
		}
		if (curr.finalSpeed > 80) totalSpikes++;
	}
}

console.log(`Buses analyzed: ${totalBusesAnalyzed}`);
console.log(`Total points: ${totalPointsAnalyzed}`);
console.log(`Fleet false-zero drops: ${totalFalseZeros} (${(totalFalseZeros/totalBusesAnalyzed).toFixed(1)}/bus)`);
console.log(`Fleet spikes > 80 km/h: ${totalSpikes}`);

console.log('\nAnalysis complete. CSVs written to docs/speed-analysis/');
