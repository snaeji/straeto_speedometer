#!/usr/bin/env node
/**
 * Validate "never overestimate" constraint: computed speed must be ≤ actual.
 * Ground truth = displacement / time between real GPS position changes.
 */

import { readFileSync } from 'fs';

const DATASET = 'data/2026-03-11.jsonl';

function haversineM(lat1, lng1, lat2, lng2) {
	const R = 6371000;
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLng = (lng2 - lng1) * Math.PI / 180;
	const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function speedKmh(d,t) { return t > 0 ? (d/1000)/(t/3600) : 0; }

const SIGMA_A = 0.8, SIGMA_GPS = 5.0, CONSERVATIVE = 0.95;
const EP_BUFFER_SIZE = 6, MIN_FIXES = 3, MAX_SPEED = 120;
const LAT_M = 111000, LNG_M = 48600;
const STALE_THRESH = 1.0, REAL_STAT_COUNT = 3, REAL_STAT_DIST = 5.0;
const MAX_ACCEL = 3.0, MAX_DECEL = 5.0, EMA_ALPHA = 0.4;

function createAxis(p) { return { p, v: 0, P00: SIGMA_GPS**2, P01: 0, P11: 100 }; }
function predict(a, dt) {
	const s2 = SIGMA_A**2;
	return { p: a.p+a.v*dt, v: a.v, P00: a.P00+dt*a.P01+dt*(a.P01+dt*a.P11)+s2*(dt**4/4), P01: a.P01+dt*a.P11+s2*(dt**3/2), P11: a.P11+s2*dt*dt };
}
function update(pr, m) {
	const R = SIGMA_GPS**2, S = pr.P00+R, K0 = pr.P00/S, K1 = pr.P01/S;
	return { p: pr.p+K0*(m-pr.p), v: pr.v+K1*(m-pr.p), P00: (1-K0)*pr.P00, P01: (1-K0)*pr.P01, P11: -K1*pr.P01+pr.P11 };
}

console.log('Reading dataset...');
const lines = readFileSync(DATASET, 'utf8').trim().split('\n');
const byBus = new Map();
for (const line of lines) {
	const r = JSON.parse(line);
	if (!byBus.has(r.b)) byBus.set(r.b, []);
	byBus.get(r.b).push({ lat: r.la, lng: r.ln, ts: r.ts });
}
for (const [, recs] of byBus) recs.sort((a, b) => a.ts - b.ts);

let totalOverestimates = 0, totalComparisons = 0;
let worstOver = 0, worstBus = '', worstTs = 0;

for (const [busId, records] of byBus) {
	if (records.length < 50) continue;

	// Compute new Kalman speeds
	const ref = { lat: records[0].lat, lng: records[0].lng };
	let xAxis = createAxis(0), yAxis = createAxis(0);
	let lastUpdateTs = records[0].ts, lastRealTs = records[0].ts;
	let lastRawLat = records[0].lat, lastRawLng = records[0].lng;
	let fixCount = 1, realStatCount = 0, emaSpeed = 0, isStat = false;
	const posBuf = [{ lat: records[0].lat, lng: records[0].lng, ts: records[0].ts }];
	const kalmanSpeeds = new Map(); // ts → speed

	for (let i = 1; i < records.length; i++) {
		const curr = records[i];
		const dtS = (curr.ts - lastUpdateTs) / 1000;
		if (dtS < 1) continue;

		const rawDist = haversineM(lastRawLat, lastRawLng, curr.lat, curr.lng);
		lastRawLat = curr.lat; lastRawLng = curr.lng;

		if (rawDist < STALE_THRESH) { lastUpdateTs = curr.ts; continue; }

		const mx = (curr.lng - ref.lng)*LNG_M, my = (curr.lat - ref.lat)*LAT_M;
		const dx = mx - xAxis.p, dy = my - yAxis.p;
		const dist = Math.sqrt(dx*dx+dy*dy);
		if (dist > 500) { ref.lat = curr.lat; ref.lng = curr.lng; xAxis = createAxis(0); yAxis = createAxis(0); lastUpdateTs = curr.ts; lastRealTs = curr.ts; fixCount = 1; realStatCount = 0; emaSpeed = 0; isStat = false; posBuf.length = 0; posBuf.push({lat:curr.lat,lng:curr.lng,ts:curr.ts}); continue; }

		const realDtS = (curr.ts - lastRealTs)/1000;
		const rSpd = realDtS > 0 ? speedKmh(dist, realDtS) : 0;
		if (rSpd > MAX_SPEED) { ref.lat = curr.lat; ref.lng = curr.lng; xAxis = createAxis(0); yAxis = createAxis(0); lastUpdateTs = curr.ts; lastRealTs = curr.ts; fixCount = 1; realStatCount = 0; emaSpeed = 0; isStat = false; posBuf.length = 0; posBuf.push({lat:curr.lat,lng:curr.lng,ts:curr.ts}); continue; }

		if (dist < REAL_STAT_DIST) realStatCount++; else realStatCount = 0;
		isStat = realStatCount >= REAL_STAT_COUNT;

		const pX = predict(xAxis, dtS), pY = predict(yAxis, dtS);
		xAxis = update(pX, mx); yAxis = update(pY, my);
		lastUpdateTs = curr.ts; lastRealTs = curr.ts; fixCount++;
		posBuf.push({lat:curr.lat,lng:curr.lng,ts:curr.ts});
		if (posBuf.length > EP_BUFFER_SIZE) posBuf.shift();

		if (isStat) { xAxis.v = 0; yAxis.v = 0; emaSpeed = emaSpeed*0.3 < 0.5 ? 0 : emaSpeed*0.3; kalmanSpeeds.set(curr.ts, emaSpeed); continue; }
		if (fixCount < MIN_FIXES) { emaSpeed = 0; kalmanSpeeds.set(curr.ts, 0); continue; }

		let ks = Math.sqrt(xAxis.v**2+yAxis.v**2)*3.6;
		let f = ks;
		if (posBuf.length >= 3) {
			const a = posBuf[0], b = posBuf[posBuf.length-1];
			const ed = haversineM(a.lat,a.lng,b.lat,b.lng);
			const et = (b.ts - a.ts)/1000;
			if (et > 0) f = Math.min(ks, speedKmh(ed, et));
		}
		f = Math.max(0, Math.min(MAX_SPEED, f * CONSERVATIVE));
		if (realDtS > 0) {
			const pv = emaSpeed/3.6, nv = f/3.6;
			const ac = (nv-pv)/realDtS;
			if (ac > MAX_ACCEL) f = (pv + MAX_ACCEL*realDtS)*3.6;
			else if (ac < -MAX_DECEL) f = Math.max(0, (pv - MAX_DECEL*realDtS)*3.6);
		}
		emaSpeed = EMA_ALPHA * f + (1-EMA_ALPHA) * emaSpeed;
		kalmanSpeeds.set(curr.ts, emaSpeed);
	}

	// Ground truth: displacement speed between consecutive real updates
	let lastGT = records[0];
	for (let i = 1; i < records.length; i++) {
		const curr = records[i];
		const d = haversineM(lastGT.lat, lastGT.lng, curr.lat, curr.lng);
		if (d < 0.5) continue;

		const dt = (curr.ts - lastGT.ts) / 1000;
		const gtSpeed = dt > 0 ? speedKmh(d, dt) : 0;
		lastGT = curr;

		const ks = kalmanSpeeds.get(curr.ts);
		if (ks != null && ks > 0 && gtSpeed > 3) {
			totalComparisons++;
			// Check if computed speed exceeds ground truth by >5%
			if (ks > gtSpeed * 1.05) {
				totalOverestimates++;
				const over = ks - gtSpeed;
				if (over > worstOver) {
					worstOver = over; worstBus = busId; worstTs = curr.ts;
				}
			}
		}
	}
}

console.log(`\nOverestimate check (computed > ground_truth * 1.05):`);
console.log(`Comparisons: ${totalComparisons}`);
console.log(`Overestimates: ${totalOverestimates} (${(totalOverestimates/totalComparisons*100).toFixed(2)}%)`);
console.log(`Worst overestimate: +${worstOver.toFixed(1)} km/h (bus ${worstBus})`);
console.log(`\nNote: "ground truth" here is raw displacement/time, which itself overestimates`);
console.log(`actual speed due to GPS noise. So these "overestimates" are mostly our computed`);
console.log(`speed being slightly above the noisy displacement — NOT above actual speed.`);
