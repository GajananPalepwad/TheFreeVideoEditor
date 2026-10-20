import { describe, expect, it } from 'vitest';
import { bounceEase, elasticEase, springEase } from './easing';

const SAMPLES = Array.from({ length: 1001 }, (_, index) => index / 1000);

const EASINGS = [
	['spring', springEase],
	['elastic', elasticEase],
	['bounce', bounceEase]
] as const;

describe('spring, elastic and bounce easing', () => {
	for (const [name, ease] of EASINGS) {
		it(`${name} starts at 0 and lands exactly on 1`, () => {
			expect(ease(0)).toBe(0);
			expect(ease(1)).toBe(1);
		});

		it(`${name} clamps progress outside [0, 1]`, () => {
			expect(ease(-0.5)).toBe(0);
			expect(ease(1.5)).toBe(1);
		});

		it(`${name} is deterministic and finite`, () => {
			for (const u of SAMPLES) {
				expect(Number.isFinite(ease(u))).toBe(true);
				expect(ease(u)).toBe(ease(u));
			}
		});

		it(`${name} has settled by the last tenth of the segment`, () => {
			for (const u of SAMPLES.filter((sample) => sample >= 0.9)) {
				expect(Math.abs(ease(u) - 1)).toBeLessThan(0.02);
			}
		});
	}

	it('spring overshoots the target and comes back', () => {
		const peak = Math.max(...SAMPLES.map(springEase));
		expect(peak).toBeGreaterThan(1.05);
		expect(peak).toBeLessThan(1.5);
	});

	it('spring leaves the start with no jump in velocity', () => {
		expect(springEase(0.001)).toBeLessThan(0.001);
	});

	it('elastic overshoots the target and undershoots on the way back', () => {
		const values = SAMPLES.map(elasticEase);
		expect(Math.max(...values)).toBeGreaterThan(1.05);
		const afterPeak = values.slice(values.indexOf(Math.max(...values)));
		expect(Math.min(...afterPeak)).toBeLessThan(1);
	});

	it('bounce never passes the target and touches it again after each fall', () => {
		const values = SAMPLES.map(bounceEase);
		expect(Math.max(...values)).toBeLessThanOrEqual(1);
		expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
		const touches = values.filter((value, index) => value > 0.999 && values[index - 1]! <= 0.999);
		expect(touches.length).toBeGreaterThanOrEqual(2);
	});
});
