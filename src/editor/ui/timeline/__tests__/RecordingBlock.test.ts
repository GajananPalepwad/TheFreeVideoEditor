import { describe, it, expect } from 'vitest';
import { timeToPixels } from '../../../core';

describe('RecordingBlock layout math', () => {
	it('calculates pixel position and width accurately based on pps and microseconds', () => {
		const pixelsPerSecond = 50; // 50px per 1_000_000us
		const startTime = 2_000_000; // 2 seconds
		const duration = 3_500_000; // 3.5 seconds

		const left = timeToPixels(startTime, pixelsPerSecond);
		const width = Math.max(12, timeToPixels(duration, pixelsPerSecond));

		expect(left).toBe(100);
		expect(width).toBe(175);
	});

	it('enforces a minimum width for very short recording durations', () => {
		const pixelsPerSecond = 50;
		const duration = 50_000; // 0.05 seconds = 2.5px

		const width = Math.max(12, timeToPixels(duration, pixelsPerSecond));
		expect(width).toBe(12);
	});
});
