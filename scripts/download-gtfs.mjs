#!/usr/bin/env node
/**
 * Downloads Straeto GTFS data and produces 4 JSON files in static/gtfs/:
 *   - routes.json    — Route metadata keyed by routeNr
 *   - shapes.json    — GeoJSON FeatureCollection of route polylines
 *   - stops.json     — All stops keyed by stopId
 *   - trip-shapes.json — Map of tripId → shapeId
 *
 * Usage:
 *   node scripts/download-gtfs.mjs
 *
 * Re-run periodically to pick up schedule changes (quarterly is fine).
 */

import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { execSync } from 'child_process';

const GTFS_ZIP_URL = 'http://opendata.straeto.is/data/gtfs/gtfs.zip';
const STOPINFO_URL = 'http://opendata.straeto.is/data/gtfs/stopinfo.txt';
const ROUTEMAP_URL = 'http://opendata.straeto.is/data/gtfs/routemap.txt';

const OUT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'static', 'gtfs');

// --- CSV parsing ---

function parseCsv(text) {
	const lines = text.split('\n').filter((l) => l.trim());
	if (lines.length === 0) return [];
	const headers = parseCsvLine(lines[0]);
	const rows = [];
	for (let i = 1; i < lines.length; i++) {
		const values = parseCsvLine(lines[i]);
		if (values.length === 0) continue;
		const row = {};
		for (let j = 0; j < headers.length; j++) {
			row[headers[j]] = values[j] ?? '';
		}
		rows.push(row);
	}
	return rows;
}

function parseCsvLine(line) {
	const fields = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else {
			if (ch === '"') {
				inQuotes = true;
			} else if (ch === ',') {
				fields.push(current.trim());
				current = '';
			} else {
				current += ch;
			}
		}
	}
	fields.push(current.trim());
	return fields;
}

// --- Main ---

async function main() {
	const tmpDir = fs.mkdtempSync(path.join(tmpdir(), 'gtfs-'));
	console.log(`Temp dir: ${tmpDir}`);

	// Step 1: Download GTFS zip
	console.log('Downloading GTFS zip...');
	const zipPath = path.join(tmpDir, 'gtfs.zip');
	const zipRes = await fetch(GTFS_ZIP_URL);
	if (!zipRes.ok) throw new Error(`Failed to download GTFS zip: ${zipRes.status}`);
	await pipeline(zipRes.body, createWriteStream(zipPath));
	console.log(`  Downloaded ${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB`);

	// Extract zip
	console.log('Extracting...');
	const extractDir = path.join(tmpDir, 'gtfs');
	fs.mkdirSync(extractDir, { recursive: true });
	execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' });

	// Step 2: Download bonus files (optional, non-fatal)
	let stopInfoRows = [];
	let routeMapRows = [];
	try {
		console.log('Downloading stopinfo.txt...');
		const siRes = await fetch(STOPINFO_URL);
		if (siRes.ok) {
			stopInfoRows = parseCsv(await siRes.text());
			console.log(`  ${stopInfoRows.length} stop info records`);
		}
	} catch (e) {
		console.warn('  stopinfo.txt not available, skipping');
	}
	try {
		console.log('Downloading routemap.txt...');
		const rmRes = await fetch(ROUTEMAP_URL);
		if (rmRes.ok) {
			routeMapRows = parseCsv(await rmRes.text());
			console.log(`  ${routeMapRows.length} route map records`);
		}
	} catch (e) {
		console.warn('  routemap.txt not available, skipping');
	}

	// Step 3: Parse GTFS CSVs
	console.log('Parsing GTFS files...');
	const readFile = (name) => {
		const p = path.join(extractDir, name);
		if (!fs.existsSync(p)) return [];
		return parseCsv(fs.readFileSync(p, 'utf-8'));
	};

	const routesRaw = readFile('routes.txt');
	const tripsRaw = readFile('trips.txt');
	const shapesRaw = readFile('shapes.txt');
	const stopsRaw = readFile('stops.txt');
	const stopTimesRaw = readFile('stop_times.txt');

	console.log(`  routes.txt: ${routesRaw.length} rows`);
	console.log(`  trips.txt: ${tripsRaw.length} rows`);
	console.log(`  shapes.txt: ${shapesRaw.length} rows`);
	console.log(`  stops.txt: ${stopsRaw.length} rows`);
	console.log(`  stop_times.txt: ${stopTimesRaw.length} rows`);

	// --- Build route_id → routeNr + color map ---
	const routeIdMap = new Map(); // route_id → { routeNr, color, longName, shortName }
	for (const r of routesRaw) {
		const routeNr = r.route_short_name || r.route_id;
		const color = r.route_color ? `#${r.route_color}` : null;
		routeIdMap.set(r.route_id, {
			routeNr,
			color,
			longName: r.route_long_name || '',
			shortName: r.route_short_name || '',
		});
	}

	// --- Build trip → shape + route mapping ---
	// tripId → { shapeId, routeId, directionId }
	const tripMap = new Map();
	for (const t of tripsRaw) {
		tripMap.set(t.trip_id, {
			shapeId: t.shape_id || null,
			routeId: t.route_id,
			directionId: parseInt(t.direction_id || '0'),
		});
	}

	// --- Build shapes GeoJSON ---
	console.log('Building shapes...');
	// Group shape points by shape_id, sorted by sequence
	const shapePoints = new Map(); // shape_id → [{lat, lng, seq}]
	for (const s of shapesRaw) {
		const sid = s.shape_id;
		if (!shapePoints.has(sid)) shapePoints.set(sid, []);
		shapePoints.get(sid).push({
			lat: parseFloat(s.shape_pt_lat),
			lng: parseFloat(s.shape_pt_lon),
			seq: parseInt(s.shape_pt_sequence),
		});
	}
	// Sort each shape's points by sequence
	for (const pts of shapePoints.values()) {
		pts.sort((a, b) => a.seq - b.seq);
	}

	// Find which route+direction each shape belongs to (most common trip association)
	const shapeRouteMap = new Map(); // shape_id → { routeId, directionId, count }
	for (const t of tripsRaw) {
		if (!t.shape_id) continue;
		const key = t.shape_id;
		const existing = shapeRouteMap.get(key);
		const rid = t.route_id;
		const did = parseInt(t.direction_id || '0');
		if (!existing) {
			shapeRouteMap.set(key, new Map());
		}
		const counts = shapeRouteMap.get(key);
		const ck = `${rid}|${did}`;
		counts.set(ck, (counts.get(ck) || 0) + 1);
	}

	// Resolve each shape to its most common route+direction
	const shapeInfo = new Map(); // shape_id → { routeNr, routeId, directionId, color }
	for (const [shapeId, counts] of shapeRouteMap) {
		let best = null;
		let bestCount = 0;
		for (const [key, count] of counts) {
			if (count > bestCount) {
				bestCount = count;
				best = key;
			}
		}
		if (best) {
			const [routeId, dirStr] = best.split('|');
			const routeMeta = routeIdMap.get(routeId);
			shapeInfo.set(shapeId, {
				routeNr: routeMeta?.routeNr || routeId,
				routeId,
				directionId: parseInt(dirStr),
				color: routeMeta?.color || null,
			});
		}
	}

	// Build GeoJSON features
	const shapeFeatures = [];
	for (const [shapeId, points] of shapePoints) {
		if (points.length < 2) continue;
		const info = shapeInfo.get(shapeId) || {};
		shapeFeatures.push({
			type: 'Feature',
			geometry: {
				type: 'LineString',
				coordinates: points.map((p) => [p.lng, p.lat]),
			},
			properties: {
				shapeId,
				routeNr: info.routeNr || null,
				directionId: info.directionId ?? null,
				color: info.color || null,
			},
		});
	}

	const shapesGeoJson = {
		type: 'FeatureCollection',
		features: shapeFeatures,
	};

	// --- Build routes.json ---
	console.log('Building routes...');
	// For each route, find the primary shape per direction (most trips)
	const routeShapes = new Map(); // routeNr → { 0: {shapeId, count}[], 1: {shapeId, count}[] }
	for (const t of tripsRaw) {
		if (!t.shape_id) continue;
		const routeMeta = routeIdMap.get(t.route_id);
		if (!routeMeta) continue;
		const routeNr = routeMeta.routeNr;
		const dir = parseInt(t.direction_id || '0');
		if (!routeShapes.has(routeNr)) routeShapes.set(routeNr, new Map());
		const dirs = routeShapes.get(routeNr);
		if (!dirs.has(dir)) dirs.set(dir, new Map());
		const shapeCounts = dirs.get(dir);
		shapeCounts.set(t.shape_id, (shapeCounts.get(t.shape_id) || 0) + 1);
	}

	// Build stop sequences: pick one representative trip per (route, direction)
	const routeStopSeqs = new Map(); // `routeNr|dir` → stop_id[]
	const tripStopTimes = new Map(); // trip_id → [{stop_id, stop_sequence}]
	for (const st of stopTimesRaw) {
		const tid = st.trip_id;
		if (!tripStopTimes.has(tid)) tripStopTimes.set(tid, []);
		tripStopTimes.get(tid).push({
			stopId: st.stop_id,
			seq: parseInt(st.stop_sequence),
		});
	}

	// Pick a representative trip for each (route, direction)
	const repTrips = new Map(); // `routeNr|dir` → trip_id
	for (const t of tripsRaw) {
		const routeMeta = routeIdMap.get(t.route_id);
		if (!routeMeta) continue;
		const key = `${routeMeta.routeNr}|${t.direction_id || '0'}`;
		if (!repTrips.has(key)) {
			repTrips.set(key, t.trip_id);
		}
	}

	for (const [key, tripId] of repTrips) {
		const sts = tripStopTimes.get(tripId);
		if (sts) {
			sts.sort((a, b) => a.seq - b.seq);
			routeStopSeqs.set(key, sts.map((s) => s.stopId));
		}
	}

	// Assemble routes object
	const routes = {};
	for (const [routeId, meta] of routeIdMap) {
		const routeNr = meta.routeNr;
		const dirShapes = routeShapes.get(routeNr);

		const directions = {};
		if (dirShapes) {
			for (const [dir, shapeCounts] of dirShapes) {
				// Pick shape with most trips
				let bestShape = null;
				let bestCount = 0;
				for (const [sid, count] of shapeCounts) {
					if (count > bestCount) {
						bestCount = count;
						bestShape = sid;
					}
				}
				const stopSeq = routeStopSeqs.get(`${routeNr}|${dir}`) || [];
				directions[dir] = {
					primaryShapeId: bestShape,
					stopSequence: stopSeq,
				};
			}
		}

		routes[routeNr] = {
			routeNr,
			routeId,
			shortName: meta.shortName,
			longName: meta.longName,
			color: meta.color,
			directions,
		};
	}

	// --- Build stops.json ---
	console.log('Building stops...');
	// Build bearing lookup from stopinfo.txt
	const stopBearings = new Map();
	for (const si of stopInfoRows) {
		const sid = si.stop_id || si.stopid;
		const bearing = si.bearing || si.heading;
		if (sid && bearing) {
			stopBearings.set(sid, parseFloat(bearing));
		}
	}

	const stops = {};
	for (const s of stopsRaw) {
		const sid = s.stop_id;
		stops[sid] = {
			stopId: sid,
			name: s.stop_name || '',
			lat: parseFloat(s.stop_lat),
			lng: parseFloat(s.stop_lon),
		};
		const bearing = stopBearings.get(sid);
		if (bearing != null && !isNaN(bearing)) {
			stops[sid].bearing = bearing;
		}
	}

	// --- Build trip-shapes.json ---
	console.log('Building trip-shapes...');
	const tripShapes = {};
	for (const t of tripsRaw) {
		if (t.shape_id) {
			tripShapes[t.trip_id] = t.shape_id;
		}
	}

	// --- Write output ---
	fs.mkdirSync(OUT_DIR, { recursive: true });

	const write = (name, data) => {
		const p = path.join(OUT_DIR, name);
		const json = JSON.stringify(data);
		fs.writeFileSync(p, json);
		console.log(`  ${name}: ${(Buffer.byteLength(json) / 1024).toFixed(0)} KB`);
	};

	console.log('\nWriting output files:');
	write('routes.json', routes);
	write('shapes.json', shapesGeoJson);
	write('stops.json', stops);
	write('trip-shapes.json', tripShapes);

	// Summary
	console.log(`\nSummary:`);
	console.log(`  Routes: ${Object.keys(routes).length}`);
	console.log(`  Shapes: ${shapeFeatures.length}`);
	console.log(`  Stops: ${Object.keys(stops).length}`);
	console.log(`  Trip→Shape mappings: ${Object.keys(tripShapes).length}`);

	// Cleanup
	fs.rmSync(tmpDir, { recursive: true, force: true });
	console.log('\nDone!');
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
