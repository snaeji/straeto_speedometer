#!/usr/bin/env node
/**
 * Phase 2 Validation: Compare old vs new Kalman filter on real data.
 * Simulates both algorithms offline and compares results.
 */

import { readFileSync, writeFileSync } from 'fs';

const DATASET = 'data/2026-03-11.jsonl';
const OUTDIR = 'docs/speed-analysis';

function haversineM(lat1, lng1, lat2, lng2) {
	const R = 6371000;
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLng = (lng2 - lng1) * Math.PI / 180;
	const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function speedKmh(distM, dtS) {
	if (dtS <= 0) return 0;
	return (distM / 1000) / (dtS / 3600);
}

// Kalman math (shared between old and new)
const SIGMA_A = 0.8, SIGMA_GPS = 5.0, CONSERVATIVE = 0.95;
const EP_BUFFER_SIZE = 6, MIN_FIXES = 3, MAX_SPEED = 120;
const LAT_M = 111000, LNG_M = 48600;

function createAxis(posM) {
	return { p: posM, v: 0, P00: SIGMA_GPS**2, P01: 0, P11: 100 };
}
function predict(ax, dt) {
	const s2 = SIGMA_A**2;
	return {
		p: ax.p + ax.v * dt, v: ax.v,
		P00: ax.P00 + dt*ax.P01 + dt*(ax.P01 + dt*ax.P11) + s2*(dt**4/4),
		P01: ax.P01 + dt*ax.P11 + s2*(dt**3/2),
		P11: ax.P11 + s2*dt*dt,
	};
}
function update(pred, meas) {
	const R = SIGMA_GPS**2;
	const S = pred.P00 + R;
	const K0 = pred.P00/S, K1 = pred.P01/S;
	return {
		p: pred.p + K0*(meas-pred.p), v: pred.v + K1*(meas-pred.p),
		P00: (1-K0)*pred.P00, P01: (1-K0)*pred.P01,
		P11: -K1*pred.P01 + pred.P11,
	};
}

// ── NEW Kalman simulation ──────────────────────────────────────────
function simulateNewKalman(records) {
	if (records.length < 2) return [];
	const STALE_THRESH = 1.0;
	const REAL_STAT_COUNT = 3, REAL_STAT_DIST = 5.0;
	const MAX_ACCEL = 3.0, MAX_DECEL = 5.0;
	const EMA_ALPHA = 0.4;

	const results = [];
	const ref = { lat: records[0].lat, lng: records[0].lng };
	let xAxis = createAxis(0), yAxis = createAxis(0);
	let lastUpdateTs = records[0].ts;
	let lastRealUpdateTs = records[0].ts;
	let lastRawLat = records[0].lat, lastRawLng = records[0].lng;
	let fixCount = 1, realStatCount = 0;
	let lastReported = 0, emaSpeed = 0;
	let isStationary = false;
	const posBuf = [{ lat: records[0].lat, lng: records[0].lng, ts: records[0].ts }];

	results.push({ ts: records[0].ts, speed: 0, isStale: false, isStat: false });

	for (let i = 1; i < records.length; i++) {
		const curr = records[i];
		const dtMs = curr.ts - lastUpdateTs;
		const dtS = dtMs / 1000;
		if (dtS < 1) continue;

		// Stale detection: compare to previous raw position
		const rawDist = haversineM(lastRawLat, lastRawLng, curr.lat, curr.lng);
		const isStale = rawDist < STALE_THRESH;
		lastRawLat = curr.lat; lastRawLng = curr.lng;

		if (isStale) {
			lastUpdateTs = curr.ts;
			results.push({ ts: curr.ts, speed: lastReported, isStale: true, isStat: isStationary });
			continue;
		}

		// Real GPS update
		const mx = (curr.lng - ref.lng) * LNG_M;
		const my = (curr.lat - ref.lat) * LAT_M;
		const dx = mx - xAxis.p, dy = my - yAxis.p;
		const distState = Math.sqrt(dx*dx + dy*dy);

		if (distState > 500) {
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastUpdateTs = curr.ts; lastRealUpdateTs = curr.ts;
			fixCount = 1; realStatCount = 0; lastReported = 0; emaSpeed = 0;
			isStationary = false;
			posBuf.length = 0; posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
			continue;
		}

		const realDtS = (curr.ts - lastRealUpdateTs) / 1000;
		const rawSpeed = realDtS > 0 ? speedKmh(distState, realDtS) : 0;
		if (rawSpeed > MAX_SPEED) {
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastUpdateTs = curr.ts; lastRealUpdateTs = curr.ts;
			fixCount = 1; realStatCount = 0; lastReported = 0; emaSpeed = 0;
			isStationary = false;
			posBuf.length = 0; posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
			continue;
		}

		// Stationarity
		if (distState < REAL_STAT_DIST) realStatCount++; else realStatCount = 0;
		const wasStat = isStationary;
		isStationary = realStatCount >= REAL_STAT_COUNT;

		// Kalman predict + update
		const predX = predict(xAxis, dtS);
		const predY = predict(yAxis, dtS);
		xAxis = update(predX, mx); yAxis = update(predY, my);
		lastUpdateTs = curr.ts; lastRealUpdateTs = curr.ts; fixCount++;
		posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
		if (posBuf.length > EP_BUFFER_SIZE) posBuf.shift();

		if (isStationary) {
			xAxis.v = 0; yAxis.v = 0;
			const decayed = emaSpeed * 0.3;
			emaSpeed = decayed < 0.5 ? 0 : decayed;
			lastReported = emaSpeed;
			results.push({ ts: curr.ts, speed: emaSpeed, isStale: false, isStat: true });
			continue;
		}

		if (wasStat && !isStationary) {
			xAxis.P11 = 100; yAxis.P11 = 100;
		}

		if (fixCount < MIN_FIXES) {
			lastReported = 0; emaSpeed = 0;
			results.push({ ts: curr.ts, speed: 0, isStale: false, isStat: false });
			continue;
		}

		let kalSpeed = Math.sqrt(xAxis.v**2 + yAxis.v**2) * 3.6;
		let final = kalSpeed;

		// Endpoint bound
		if (posBuf.length >= 3) {
			const f = posBuf[0], l = posBuf[posBuf.length-1];
			const epDist = haversineM(f.lat, f.lng, l.lat, l.lng);
			const epTime = (l.ts - f.ts) / 1000;
			if (epTime > 0) final = Math.min(kalSpeed, speedKmh(epDist, epTime));
		}

		final = Math.max(0, Math.min(MAX_SPEED, final * CONSERVATIVE));

		// Acceleration limiting
		if (realDtS > 0) {
			const prev = emaSpeed / 3.6, next = final / 3.6;
			const accel = (next - prev) / realDtS;
			if (accel > MAX_ACCEL) final = (prev + MAX_ACCEL * realDtS) * 3.6;
			else if (accel < -MAX_DECEL) final = Math.max(0, (prev - MAX_DECEL * realDtS) * 3.6);
		}

		// EMA
		emaSpeed = EMA_ALPHA * final + (1 - EMA_ALPHA) * emaSpeed;
		lastReported = emaSpeed;
		results.push({ ts: curr.ts, speed: emaSpeed, isStale: false, isStat: false });
	}
	return results;
}

// ── OLD Kalman simulation ──────────────────────────────────────────
function simulateOldKalman(records) {
	if (records.length < 2) return [];
	const MIN_DIST = 10.0, STAT_CONFIRM = 2;
	const results = [];
	const ref = { lat: records[0].lat, lng: records[0].lng };
	let xAxis = createAxis(0), yAxis = createAxis(0);
	let lastTs = records[0].ts, fixCount = 1, statCount = 0, lastReported = 0;
	const posBuf = [{ lat: records[0].lat, lng: records[0].lng, ts: records[0].ts }];

	results.push({ ts: records[0].ts, speed: 0 });

	for (let i = 1; i < records.length; i++) {
		const curr = records[i];
		const dtS = (curr.ts - lastTs) / 1000;
		if (dtS < 1) continue;

		const mx = (curr.lng - ref.lng) * LNG_M;
		const my = (curr.lat - ref.lat) * LAT_M;
		const dx = mx - xAxis.p, dy = my - yAxis.p;
		const dist = Math.sqrt(dx*dx + dy*dy);

		if (dist > 500) {
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastTs = curr.ts; fixCount = 1; statCount = 0; lastReported = 0;
			posBuf.length = 0; posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
			continue;
		}

		const rawSpeed = dtS > 0 ? speedKmh(dist, dtS) : 0;
		if (rawSpeed > MAX_SPEED) {
			ref.lat = curr.lat; ref.lng = curr.lng;
			xAxis = createAxis(0); yAxis = createAxis(0);
			lastTs = curr.ts; fixCount = 1; statCount = 0; lastReported = 0;
			posBuf.length = 0; posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
			continue;
		}

		const predX = predict(xAxis, dtS); const predY = predict(yAxis, dtS);
		xAxis = update(predX, mx); yAxis = update(predY, my);
		lastTs = curr.ts; fixCount++;
		posBuf.push({ lat: curr.lat, lng: curr.lng, ts: curr.ts });
		if (posBuf.length > EP_BUFFER_SIZE) posBuf.shift();

		if (dist < MIN_DIST) {
			statCount++;
			if (statCount >= STAT_CONFIRM) {
				xAxis.v = 0; yAxis.v = 0; lastReported = 0;
				results.push({ ts: curr.ts, speed: 0 });
				continue;
			}
			results.push({ ts: curr.ts, speed: lastReported });
			continue;
		}
		statCount = 0;

		if (fixCount < MIN_FIXES) {
			lastReported = 0;
			results.push({ ts: curr.ts, speed: 0 });
			continue;
		}

		let kalSpeed = Math.sqrt(xAxis.v**2 + yAxis.v**2) * 3.6;
		let final = kalSpeed;
		if (posBuf.length >= 3) {
			const f = posBuf[0], l = posBuf[posBuf.length-1];
			const epDist = haversineM(f.lat, f.lng, l.lat, l.lng);
			const epTime = (l.ts - f.ts) / 1000;
			if (epTime > 0) final = Math.min(kalSpeed, speedKmh(epDist, epTime));
		}
		final = Math.max(0, Math.min(MAX_SPEED, final * CONSERVATIVE));
		lastReported = final;
		results.push({ ts: curr.ts, speed: final });
	}
	return results;
}

// ── Main ───────────────────────────────────────────────────────────

console.log('Reading dataset...');
const lines = readFileSync(DATASET, 'utf8').trim().split('\n');
const byBus = new Map();
for (const line of lines) {
	const r = JSON.parse(line);
	if (!byBus.has(r.b)) byBus.set(r.b, []);
	byBus.get(r.b).push({ lat: r.la, lng: r.ln, ts: r.ts });
}
for (const [, recs] of byBus) recs.sort((a, b) => a.ts - b.ts);

// Test on buses with good data
const testBuses = ['1-J', '6-G', '19-C', '4-A', '31-B'];

for (const busId of testBuses) {
	const records = byBus.get(busId);
	if (!records) { console.log(`${busId}: not found`); continue; }
	console.log(`\n=== ${busId} (${records.length} records) ===`);

	const oldResults = simulateOldKalman(records);
	const newResults = simulateNewKalman(records);

	// Metrics
	const countFalseZeros = (results) => {
		let count = 0;
		for (let i = 1; i < results.length; i++) {
			if (results[i].speed === 0 && results[i-1].speed > 5) {
				for (let j = i+1; j < results.length && j < i+15; j++) {
					if (results[j].speed > 5) { count++; break; }
				}
			}
		}
		return count;
	};

	const countSpikes = (results, thresh) => results.filter(r => r.speed > thresh).length;

	const avgNonZeroSpeed = (results) => {
		const nonZero = results.filter(r => r.speed > 0);
		return nonZero.length > 0 ? (nonZero.reduce((s,r) => s + r.speed, 0) / nonZero.length) : 0;
	};

	const maxSpeed = (results) => Math.max(...results.map(r => r.speed));

	// Speed continuity: average absolute speed change between consecutive readings
	const avgSpeedChange = (results) => {
		let totalChange = 0, count = 0;
		for (let i = 1; i < results.length; i++) {
			totalChange += Math.abs(results[i].speed - results[i-1].speed);
			count++;
		}
		return count > 0 ? totalChange / count : 0;
	};

	console.log('          | Old Kalman | New Kalman');
	console.log(`Points    | ${String(oldResults.length).padStart(10)} | ${newResults.length}`);
	console.log(`False 0s  | ${String(countFalseZeros(oldResults)).padStart(10)} | ${countFalseZeros(newResults)}`);
	console.log(`>80 km/h  | ${String(countSpikes(oldResults, 80)).padStart(10)} | ${countSpikes(newResults, 80)}`);
	console.log(`>100 km/h | ${String(countSpikes(oldResults, 100)).padStart(10)} | ${countSpikes(newResults, 100)}`);
	console.log(`Avg speed | ${avgNonZeroSpeed(oldResults).toFixed(1).padStart(10)} | ${avgNonZeroSpeed(newResults).toFixed(1)}`);
	console.log(`Max speed | ${maxSpeed(oldResults).toFixed(1).padStart(10)} | ${maxSpeed(newResults).toFixed(1)}`);
	console.log(`Avg |Δv|  | ${avgSpeedChange(oldResults).toFixed(2).padStart(10)} | ${avgSpeedChange(newResults).toFixed(2)} (lower=smoother)`);

	// Write comparison CSV for visualization
	const rows = ['ts,old_speed,new_speed,new_is_stale,new_is_stat'];
	const newMap = new Map(newResults.map(r => [r.ts, r]));
	for (const old of oldResults) {
		const n = newMap.get(old.ts);
		rows.push(`${old.ts},${old.speed.toFixed(2)},${n ? n.speed.toFixed(2) : ''},${n ? n.isStale : ''},${n ? n.isStat : ''}`);
	}
	// Add new-only points
	for (const n of newResults) {
		if (!oldResults.find(o => o.ts === n.ts)) {
			rows.push(`${n.ts},,${n.speed.toFixed(2)},${n.isStale},${n.isStat}`);
		}
	}
	writeFileSync(`${OUTDIR}/compare_${busId.replace(/[^a-zA-Z0-9-]/g, '_')}.csv`, rows.join('\n'));
}

// Fleet-wide metrics
console.log('\n=== FLEET-WIDE COMPARISON ===');
let oldTotalFZ = 0, newTotalFZ = 0, oldTotalSpikes = 0, newTotalSpikes = 0;
let oldTotalAvgDv = 0, newTotalAvgDv = 0, busCount = 0;

for (const [busId, records] of byBus) {
	if (records.length < 50) continue;
	busCount++;

	const oldR = simulateOldKalman(records);
	const newR = simulateNewKalman(records);

	let oldFZ = 0, newFZ = 0;
	for (let i = 1; i < oldR.length; i++) {
		if (oldR[i].speed === 0 && oldR[i-1].speed > 5) {
			for (let j = i+1; j < oldR.length && j < i+15; j++) {
				if (oldR[j].speed > 5) { oldFZ++; break; }
			}
		}
	}
	for (let i = 1; i < newR.length; i++) {
		if (newR[i].speed === 0 && newR[i-1].speed > 5) {
			for (let j = i+1; j < newR.length && j < i+15; j++) {
				if (newR[j].speed > 5) { newFZ++; break; }
			}
		}
	}
	oldTotalFZ += oldFZ; newTotalFZ += newFZ;
	oldTotalSpikes += oldR.filter(r => r.speed > 80).length;
	newTotalSpikes += newR.filter(r => r.speed > 80).length;

	let oldDv = 0, newDv = 0;
	for (let i = 1; i < oldR.length; i++) oldDv += Math.abs(oldR[i].speed - oldR[i-1].speed);
	for (let i = 1; i < newR.length; i++) newDv += Math.abs(newR[i].speed - newR[i-1].speed);
	oldTotalAvgDv += oldR.length > 1 ? oldDv / (oldR.length-1) : 0;
	newTotalAvgDv += newR.length > 1 ? newDv / (newR.length-1) : 0;
}

console.log(`Buses: ${busCount}`);
console.log(`             | Old Kalman | New Kalman | Improvement`);
console.log(`False zeros  | ${String(oldTotalFZ).padStart(10)} | ${String(newTotalFZ).padStart(10)} | ${((1 - newTotalFZ/oldTotalFZ)*100).toFixed(0)}% reduction`);
console.log(`>80 km/h     | ${String(oldTotalSpikes).padStart(10)} | ${String(newTotalSpikes).padStart(10)} | ${((1 - newTotalSpikes/Math.max(1,oldTotalSpikes))*100).toFixed(0)}% reduction`);
console.log(`Avg |Δv|/bus | ${(oldTotalAvgDv/busCount).toFixed(2).padStart(10)} | ${(newTotalAvgDv/busCount).toFixed(2).padStart(10)} | ${((1 - newTotalAvgDv/oldTotalAvgDv)*100).toFixed(0)}% smoother`);
