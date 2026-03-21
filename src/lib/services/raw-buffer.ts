/**
 * Per-bus ring buffer for raw GPS readings.
 *
 * Sits between the API fetcher and the processing pipeline.
 * Stores unprocessed readings so the trajectory cleaner can
 * work with a full window of data (±30s around display cursor).
 */

import type { NextStop } from '$lib/types/bus';
import { haversineDistanceM } from '$lib/utils/geo';

const STALE_DISTANCE_M = 1.0; // GPS unchanged threshold

export interface RawReading {
	busId: string;
	routeNr: string;
	tripId: string;
	lat: number;
	lng: number;
	direction: number;
	timestamp: number; // API timestamp (epoch ms)
	headsign?: string;
	nextStops?: NextStop[];
	gtfsDirectionId?: number;
	isStale: boolean; // GPS position unchanged from previous reading
}

interface BusBuffer {
	readings: RawReading[];
	lastRawLat: number;
	lastRawLng: number;
}

export class RawBuffer {
	private buffers = new Map<string, BusBuffer>();

	/** Add a new reading from the API. Marks stale if position unchanged. */
	ingest(reading: Omit<RawReading, 'isStale'>): void {
		let buf = this.buffers.get(reading.busId);

		let isStale = false;
		if (buf) {
			const dist = haversineDistanceM(reading.lat, reading.lng, buf.lastRawLat, buf.lastRawLng);
			isStale = dist < STALE_DISTANCE_M;
		}

		const fullReading: RawReading = { ...reading, isStale };

		if (!buf) {
			buf = {
				readings: [fullReading],
				lastRawLat: reading.lat,
				lastRawLng: reading.lng,
			};
			this.buffers.set(reading.busId, buf);
		} else {
			buf.readings.push(fullReading);
			if (!isStale) {
				buf.lastRawLat = reading.lat;
				buf.lastRawLng = reading.lng;
			}
		}
	}

	/** Get all readings for a bus in a time window [startMs, endMs]. */
	getWindow(busId: string, startMs: number, endMs: number): RawReading[] {
		const buf = this.buffers.get(busId);
		if (!buf) return [];
		return buf.readings.filter((r) => r.timestamp >= startMs && r.timestamp <= endMs);
	}

	/** Get all readings for a bus (full buffer). */
	getAll(busId: string): RawReading[] {
		return this.buffers.get(busId)?.readings ?? [];
	}

	/** Get the latest reading for a bus. */
	getLatest(busId: string): RawReading | undefined {
		const buf = this.buffers.get(busId);
		if (!buf || buf.readings.length === 0) return undefined;
		return buf.readings[buf.readings.length - 1];
	}

	/** Get all bus IDs that have data. */
	getActiveBusIds(): string[] {
		return Array.from(this.buffers.keys());
	}

	/** Get the latest route key ("routeNr:directionId") for a bus. */
	getRouteKey(busId: string): string | undefined {
		const buf = this.buffers.get(busId);
		if (!buf || buf.readings.length === 0) return undefined;
		const latest = buf.readings[buf.readings.length - 1];
		const dir = latest.gtfsDirectionId ?? latest.direction;
		return `${latest.routeNr}:${dir}`;
	}

	/** Remove readings older than cutoff timestamp. */
	prune(cutoffMs: number): void {
		for (const [busId, buf] of this.buffers) {
			const firstValid = buf.readings.findIndex((r) => r.timestamp >= cutoffMs);
			if (firstValid < 0) {
				// All readings are older than cutoff — remove bus entirely
				this.buffers.delete(busId);
			} else if (firstValid > 0) {
				buf.readings.splice(0, firstValid);
			}
		}
	}

	/** Clear all data for a specific bus. */
	clearBus(busId: string): void {
		this.buffers.delete(busId);
	}

	/** Clear everything. */
	clearAll(): void {
		this.buffers.clear();
	}

	/** Total reading count across all buses. */
	get totalReadings(): number {
		let total = 0;
		for (const buf of this.buffers.values()) {
			total += buf.readings.length;
		}
		return total;
	}

	/** Number of buses with data. */
	get busCount(): number {
		return this.buffers.size;
	}

	/** Check if a bus has any data. */
	has(busId: string): boolean {
		return this.buffers.has(busId);
	}

	/** Get the oldest timestamp across all buses. */
	getOldestTimestamp(): number | undefined {
		let oldest: number | undefined;
		for (const buf of this.buffers.values()) {
			if (buf.readings.length > 0) {
				const ts = buf.readings[0].timestamp;
				if (oldest === undefined || ts < oldest) oldest = ts;
			}
		}
		return oldest;
	}

	/** Get the newest timestamp across all buses. */
	getNewestTimestamp(): number | undefined {
		let newest: number | undefined;
		for (const buf of this.buffers.values()) {
			if (buf.readings.length > 0) {
				const ts = buf.readings[buf.readings.length - 1].timestamp;
				if (newest === undefined || ts > newest) newest = ts;
			}
		}
		return newest;
	}
}
