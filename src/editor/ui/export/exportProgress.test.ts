import { describe, expect, it } from 'vitest';
import type { ExportProgress } from '../../services/export/exporter';
import { describeProgress, formatClock } from './exportProgress';

type Fields = Omit<ExportProgress, 'percent'>;

const rendering = (overrides: Partial<Fields> = {}): ExportProgress => ({
	percent: 25,
	phase: 'rendering',
	framesDone: 150,
	totalFrames: 600,
	fps: 30,
	etaMs: 15_000,
	...overrides
});

describe('formatClock', () => {
	it('writes minutes and seconds, adding hours only when needed', () => {
		expect(formatClock(0)).toBe('0:00');
		expect(formatClock(7_400)).toBe('0:07');
		expect(formatClock(65_000)).toBe('1:05');
		expect(formatClock(3_725_000)).toBe('1:02:05');
	});

	it('never shows a negative or fractional time', () => {
		expect(formatClock(-500)).toBe('0:00');
		expect(formatClock(59_999)).toBe('0:59');
		expect(formatClock(Number.NaN)).toBe('0:00');
	});
});

describe('describeProgress', () => {
	it('shows frames, speed, elapsed time and the time left while rendering', () => {
		expect(describeProgress(rendering(), 5_000)).toBe(
			'150 / 600 frames · 30.0 fps · 0:05 elapsed · about 0:15 left'
		);
	});

	it('rounds the time left up so it never claims to be finished early', () => {
		expect(describeProgress(rendering({ etaMs: 14_100 }), 5_000)).toContain('about 0:15 left');
	});

	it('leaves the estimate out until enough frames have been timed', () => {
		const text = describeProgress(rendering({ framesDone: 12 }), 400);

		expect(text).toBe('12 / 600 frames · 30.0 fps · 0:00 elapsed');
	});

	it('leaves the estimate out when the speed or estimate is unusable', () => {
		for (const bad of [
			{ fps: 0 },
			{ etaMs: Number.NaN },
			{ etaMs: Number.POSITIVE_INFINITY },
			{ etaMs: 0 }
		]) {
			expect(describeProgress(rendering(bad), 5_000), JSON.stringify(bad)).not.toContain('left');
		}
	});

	it('shows only elapsed time outside the rendering phase', () => {
		expect(describeProgress(rendering({ phase: 'finalizing', framesDone: 600 }), 21_000)).toBe(
			'600 / 600 frames · 0:21 elapsed'
		);
		expect(describeProgress(rendering({ phase: 'complete', framesDone: 600 }), 21_000)).toBe(
			'600 / 600 frames · finished in 0:21'
		);
	});
});
