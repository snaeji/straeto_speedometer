#!/usr/bin/env node
/**
 * Straeto bus data collector.
 * Polls the API every 2s and writes JSONL to data/<date>.jsonl
 *
 * Usage:
 *   node scripts/collect.mjs              # collect for 10 minutes (default)
 *   node scripts/collect.mjs --minutes 60 # collect for 1 hour
 *   node scripts/collect.mjs --minutes 0  # collect indefinitely (Ctrl+C to stop)
 *   node scripts/collect.mjs --output data/sample.jsonl  # custom output path
 */

import fs from 'fs';
import path from 'path';

const API_URL = 'https://api.straeto.is/graphql';
const HASH = '8f9ee84171961f8a3b9a9d1a7b2a7ac49e7e122e1ba1727e75cfe3a94ff3edb8';
const ALL_ROUTES = [
	'1','2','3','4','5','6','7','8','9','10',
	'11','12','13','14','15','16','17','18','19','20',
	'21','22','23','24','25','26','27','28','29','31','35','36',
];
const POLL_INTERVAL_MS = 2000;

// Parse --minutes flag
const args = process.argv.slice(2);
let durationMinutes = 10;
const minIdx = args.indexOf('--minutes');
if (minIdx !== -1 && args[minIdx + 1] != null) {
	durationMinutes = Number(args[minIdx + 1]);
}

// Parse --output flag
let outFile;
const outIdx = args.indexOf('--output');
if (outIdx !== -1 && args[outIdx + 1] != null) {
	outFile = path.resolve(args[outIdx + 1]);
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
} else {
	const dataDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
	fs.mkdirSync(dataDir, { recursive: true });
	const dateStr = new Date().toISOString().slice(0, 10);
	outFile = path.join(dataDir, `${dateStr}.jsonl`);
}
const stream = fs.createWriteStream(outFile, { flags: 'a' }); // append

console.log(`Collecting bus data → ${outFile}`);
console.log(`Duration: ${durationMinutes === 0 ? 'indefinite (Ctrl+C to stop)' : `${durationMinutes} minutes`}`);
console.log(`Polling every ${POLL_INTERVAL_MS / 1000}s\n`);

let snapshots = 0;
let totalRecords = 0;
const startTime = Date.now();

async function poll() {
	try {
		const res = await fetch(API_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				extensions: { persistedQuery: { version: 1, sha256Hash: HASH } },
				variables: { routes: ALL_ROUTES },
			}),
		});

		if (!res.ok) {
			console.error(`HTTP ${res.status}`);
			return;
		}

		const json = await res.json();
		const blr = json?.data?.BusLocationByRoute;
		if (!blr?.results) {
			console.error('Unexpected response shape');
			return;
		}

		const timestamp = new Date(blr.lastUpdate).getTime();
		const buses = blr.results;

		for (const bus of buses) {
			const record = {
				b: bus.busId,
				r: bus.routeNr,
				t: bus.tripId,
				la: bus.lat,
				ln: bus.lng,
				d: bus.direction,
				ts: timestamp,
			};
			if (bus.headsign) record.h = bus.headsign;
			stream.write(JSON.stringify(record) + '\n');
		}

		snapshots++;
		totalRecords += buses.length;
		const elapsed = Math.round((Date.now() - startTime) / 1000);
		process.stdout.write(`\r  ${snapshots} snapshots, ${totalRecords} records, ${elapsed}s elapsed`);
	} catch (err) {
		console.error(`\nError: ${err.message}`);
	}
}

const timer = setInterval(poll, POLL_INTERVAL_MS);
poll(); // first poll immediately

// Stop after duration
if (durationMinutes > 0) {
	setTimeout(() => {
		clearInterval(timer);
		stream.end(() => {
			console.log(`\n\nDone! ${snapshots} snapshots, ${totalRecords} records saved to ${outFile}`);
			process.exit(0);
		});
	}, durationMinutes * 60 * 1000);
}

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
	clearInterval(timer);
	stream.end(() => {
		console.log(`\n\nStopped. ${snapshots} snapshots, ${totalRecords} records saved to ${outFile}`);
		process.exit(0);
	});
});
