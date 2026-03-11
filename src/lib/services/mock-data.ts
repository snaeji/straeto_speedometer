import type { BusLocation } from '$lib/types/bus';

// Realistic Reykjavik bus routes with actual road coordinates
export const DEMO_ROUTES = [
	{
		routeNr: '1',
		headsign: 'Hlemmur',
		waypoints: [
			{ lat: 64.1508, lng: -21.9314 },
			{ lat: 64.1485, lng: -21.9280 },
			{ lat: 64.1462, lng: -21.9250 },
			{ lat: 64.1440, lng: -21.9220 },
			{ lat: 64.1420, lng: -21.9180 },
			{ lat: 64.1395, lng: -21.9150 },
		],
		speedLimit: 50,
	},
	{
		routeNr: '3',
		headsign: 'Mjódd',
		waypoints: [
			{ lat: 64.1460, lng: -21.9420 },
			{ lat: 64.1440, lng: -21.9360 },
			{ lat: 64.1420, lng: -21.9300 },
			{ lat: 64.1395, lng: -21.9240 },
			{ lat: 64.1370, lng: -21.9180 },
			{ lat: 64.1340, lng: -21.9100 },
			{ lat: 64.1310, lng: -21.9020 },
			{ lat: 64.1285, lng: -21.8950 },
		],
		speedLimit: 50,
	},
	{
		routeNr: '6',
		headsign: 'Háholt',
		waypoints: [
			{ lat: 64.1500, lng: -21.9500 },
			{ lat: 64.1485, lng: -21.9440 },
			{ lat: 64.1465, lng: -21.9380 },
			{ lat: 64.1450, lng: -21.9320 },
			{ lat: 64.1430, lng: -21.9260 },
			{ lat: 64.1410, lng: -21.9200 },
			{ lat: 64.1385, lng: -21.9130 },
		],
		speedLimit: 50,
	},
	{
		routeNr: '11',
		headsign: 'Breiðholt',
		waypoints: [
			{ lat: 64.1440, lng: -21.9400 },
			{ lat: 64.1410, lng: -21.9320 },
			{ lat: 64.1380, lng: -21.9240 },
			{ lat: 64.1350, lng: -21.9160 },
			{ lat: 64.1320, lng: -21.9080 },
			{ lat: 64.1290, lng: -21.9000 },
			{ lat: 64.1260, lng: -21.8920 },
			{ lat: 64.1230, lng: -21.8840 },
			{ lat: 64.1200, lng: -21.8760 },
		],
		speedLimit: 50,
	},
	{
		routeNr: '14',
		headsign: 'Grafarvogsbraut',
		waypoints: [
			{ lat: 64.1480, lng: -21.9300 },
			{ lat: 64.1510, lng: -21.9220 },
			{ lat: 64.1540, lng: -21.9140 },
			{ lat: 64.1570, lng: -21.9060 },
			{ lat: 64.1600, lng: -21.8980 },
			{ lat: 64.1625, lng: -21.8900 },
			{ lat: 64.1650, lng: -21.8820 },
		],
		speedLimit: 60,
	},
	{
		routeNr: '15',
		headsign: 'Mosfellsbær',
		waypoints: [
			{ lat: 64.1490, lng: -21.9350 },
			{ lat: 64.1520, lng: -21.9420 },
			{ lat: 64.1555, lng: -21.9500 },
			{ lat: 64.1590, lng: -21.9580 },
			{ lat: 64.1620, lng: -21.9650 },
			{ lat: 64.1650, lng: -21.9720 },
		],
		speedLimit: 70,
	},
	{
		routeNr: '5',
		headsign: 'Ártúnshöfði',
		waypoints: [
			{ lat: 64.1350, lng: -21.8700 },
			{ lat: 64.1370, lng: -21.8780 },
			{ lat: 64.1390, lng: -21.8860 },
			{ lat: 64.1405, lng: -21.8940 },
			{ lat: 64.1420, lng: -21.9020 },
			{ lat: 64.1440, lng: -21.9100 },
		],
		speedLimit: 50,
	},
	{
		routeNr: '12',
		headsign: 'Seltjarnarnes',
		waypoints: [
			{ lat: 64.1510, lng: -21.9700 },
			{ lat: 64.1520, lng: -21.9620 },
			{ lat: 64.1515, lng: -21.9540 },
			{ lat: 64.1505, lng: -21.9460 },
			{ lat: 64.1490, lng: -21.9380 },
			{ lat: 64.1475, lng: -21.9310 },
		],
		speedLimit: 30,
	},
];

interface MockBus {
	busId: string;
	routeIdx: number;
	waypointProgress: number; // 0 to 1 across the route
	speed: number; // current speed km/h
	targetSpeed: number; // target speed (with some variance)
	direction: number; // heading degrees
	forward: boolean; // going forward or backward along route
	isSpeedDemon: boolean; // occasionally exceeds speed limit
}

let mockBuses: MockBus[] = [];
let initialized = false;

function initMockBuses() {
	if (initialized) return;
	initialized = true;

	// Create 15-25 buses spread across routes
	const busCount = 18 + Math.floor(Math.random() * 8);
	for (let i = 0; i < busCount; i++) {
		const routeIdx = Math.floor(Math.random() * DEMO_ROUTES.length);
		const route = DEMO_ROUTES[routeIdx];
		const busLetter = String.fromCharCode(65 + (i % 4)); // A, B, C, D
		mockBuses.push({
			busId: `${route.routeNr}-${busLetter}`,
			routeIdx,
			waypointProgress: Math.random(),
			speed: 20 + Math.random() * 30,
			targetSpeed: route.speedLimit * (0.6 + Math.random() * 0.3),
			direction: Math.random() * 360,
			forward: Math.random() > 0.5,
			isSpeedDemon: Math.random() < 0.35, // 35% chance of being a speeder
		});
	}
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function getPositionOnRoute(route: typeof DEMO_ROUTES[0], progress: number): { lat: number; lng: number; direction: number } {
	const waypoints = route.waypoints;
	const totalSegments = waypoints.length - 1;
	const segmentFloat = progress * totalSegments;
	const segmentIdx = Math.min(Math.floor(segmentFloat), totalSegments - 1);
	const segmentT = segmentFloat - segmentIdx;

	const from = waypoints[segmentIdx];
	const to = waypoints[Math.min(segmentIdx + 1, waypoints.length - 1)];

	// Add small random jitter (GPS noise)
	const jitterLat = (Math.random() - 0.5) * 0.0002;
	const jitterLng = (Math.random() - 0.5) * 0.0004;

	const lat = lerp(from.lat, to.lat, segmentT) + jitterLat;
	const lng = lerp(from.lng, to.lng, segmentT) + jitterLng;

	// Calculate heading
	const dlat = to.lat - from.lat;
	const dlng = to.lng - from.lng;
	const direction = (Math.atan2(dlng, dlat) * 180) / Math.PI;

	return { lat, lng, direction: (direction + 360) % 360 };
}

export function generateMockData(): BusLocation[] {
	initMockBuses();

	const now = Date.now();
	const locations: BusLocation[] = [];

	for (const bus of mockBuses) {
		const route = DEMO_ROUTES[bus.routeIdx];

		// Update speed with some variance
		if (Math.random() < 0.15) {
			// Occasionally change target speed
			if (bus.isSpeedDemon && Math.random() < 0.6) {
				bus.targetSpeed = route.speedLimit * (1.15 + Math.random() * 0.35); // Exceed limit
			} else if (Math.random() < 0.15) {
				// Random burst of speed for any bus
				bus.targetSpeed = route.speedLimit * (1.05 + Math.random() * 0.2);
			} else {
				bus.targetSpeed = route.speedLimit * (0.5 + Math.random() * 0.45);
			}
		}

		// Smoothly approach target speed
		bus.speed = lerp(bus.speed, bus.targetSpeed, 0.12);
		bus.speed = Math.max(0, bus.speed + (Math.random() - 0.5) * 4);

		// Move along route
		const moveRate = (bus.speed / 3600) * 2 / (route.waypoints.length * 0.01); // Approximate
		if (bus.forward) {
			bus.waypointProgress += moveRate * 0.01;
			if (bus.waypointProgress >= 1) {
				bus.waypointProgress = 1;
				bus.forward = false;
			}
		} else {
			bus.waypointProgress -= moveRate * 0.01;
			if (bus.waypointProgress <= 0) {
				bus.waypointProgress = 0;
				bus.forward = true;
			}
		}

		const pos = getPositionOnRoute(route, bus.waypointProgress);
		bus.direction = bus.forward ? pos.direction : (pos.direction + 180) % 360;

		const speedKmh = bus.speed;
		const speedLimitKmh = route.speedLimit;
		const isViolation = speedKmh > speedLimitKmh;

		locations.push({
			busId: bus.busId,
			routeNr: route.routeNr,
			tripId: `mock-${bus.busId}`,
			lat: pos.lat,
			lng: pos.lng,
			direction: Math.round(bus.direction),
			timestamp: now,
			headsign: route.headsign,
			speedKmh: Math.round(speedKmh * 10) / 10,
			speedLimitKmh,
			isViolation,
		});
	}

	return locations;
}

export function resetMockData() {
	mockBuses = [];
	initialized = false;
}
