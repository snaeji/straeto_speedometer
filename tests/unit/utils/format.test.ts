import { describe, it, expect } from 'vitest';
import {
	formatSpeed,
	formatTime,
	formatDate,
	formatDateTime,
	formatBytes,
	formatElapsed,
	formatDistance,
} from '$lib/utils/format';

describe('formatSpeed', () => {
	it('returns "--" for undefined', () => {
		expect(formatSpeed(undefined)).toBe('--');
	});

	it('returns "--" for null', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect(formatSpeed(null as any)).toBe('--');
	});

	it('returns "0.0" for 0', () => {
		expect(formatSpeed(0)).toBe('0.0');
	});

	it('rounds to 1 decimal place', () => {
		expect(formatSpeed(45.678)).toBe('45.7');
	});

	it('formats 100 as "100.0"', () => {
		expect(formatSpeed(100)).toBe('100.0');
	});
});

describe('formatTime', () => {
	it('formats epoch 0 as 00:00:00', () => {
		expect(formatTime(0)).toBe('00:00:00');
	});

	it('formats a known timestamp correctly', () => {
		// 2024-01-15T14:30:45Z
		const ts = new Date('2024-01-15T14:30:45Z').getTime();
		expect(formatTime(ts)).toBe('14:30:45');
	});

	it('formats midnight UTC as 00:00:00', () => {
		const ts = new Date('2026-03-21T00:00:00Z').getTime();
		expect(formatTime(ts)).toBe('00:00:00');
	});
});

describe('formatDate', () => {
	it('formats a known timestamp', () => {
		const ts = new Date('2024-06-15T12:00:00Z').getTime();
		expect(formatDate(ts)).toBe('2024-06-15');
	});

	it('formats New Year', () => {
		const ts = new Date('2026-01-01T00:00:00Z').getTime();
		expect(formatDate(ts)).toBe('2026-01-01');
	});
});

describe('formatDateTime', () => {
	it('combines time and date with space', () => {
		const ts = new Date('2024-06-15T14:30:00Z').getTime();
		expect(formatDateTime(ts)).toBe('14:30:00 2024-06-15');
	});
});

describe('formatBytes', () => {
	it('formats 0 bytes', () => {
		expect(formatBytes(0)).toBe('0 B');
	});

	it('formats 512 bytes', () => {
		expect(formatBytes(512)).toBe('512 B');
	});

	it('formats 1024 as 1.0 KB', () => {
		expect(formatBytes(1024)).toBe('1.0 KB');
	});

	it('formats 1536 as 1.5 KB', () => {
		expect(formatBytes(1536)).toBe('1.5 KB');
	});

	it('formats 1048576 as 1.0 MB', () => {
		expect(formatBytes(1048576)).toBe('1.0 MB');
	});

	it('formats 10485760 as 10.0 MB', () => {
		expect(formatBytes(10485760)).toBe('10.0 MB');
	});
});

describe('formatElapsed', () => {
	it('formats 0 seconds', () => {
		expect(formatElapsed(0)).toBe('0:00');
	});

	it('formats 59 seconds', () => {
		expect(formatElapsed(59)).toBe('0:59');
	});

	it('formats 60 seconds as 1:00', () => {
		expect(formatElapsed(60)).toBe('1:00');
	});

	it('formats 3661 as 1:01:01', () => {
		expect(formatElapsed(3661)).toBe('1:01:01');
	});
});

describe('formatDistance', () => {
	it('formats 0.5 km as 500 m', () => {
		expect(formatDistance(0.5)).toBe('500 m');
	});

	it('formats 0.001 km as 1 m', () => {
		expect(formatDistance(0.001)).toBe('1 m');
	});

	it('formats 1.0 km as 1.0 km', () => {
		expect(formatDistance(1.0)).toBe('1.0 km');
	});

	it('formats 42.3 km as 42.3 km', () => {
		expect(formatDistance(42.3)).toBe('42.3 km');
	});
});
