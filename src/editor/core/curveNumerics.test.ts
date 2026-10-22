import { describe, expect, it } from 'vitest';
import { evaluate } from './animation';
import {
	handleFromNumbers,
	handleToNumbers,
	inHandleFromNumbers,
	inHandleToNumbers,
	velocityAt,
	velocityCurve
} from './curveNumerics';
import type { AnimatedValue } from './types';

describe('handle numbers', () => {
	it('shows a handle as an influence and a value, both in percent', () => {
		expect(handleToNumbers({ x: 0.42, y: 0 })).toEqual({ influence: 42, value: 0 });
		expect(handleToNumbers({ x: 0.58, y: 1.2 })).toEqual({ influence: 58, value: 120 });
	});

	it('turns typed numbers back into a handle', () => {
		expect(handleFromNumbers({ influence: 25, value: 50 })).toEqual({ x: 0.25, y: 0.5 });
	});

	it('round trips exactly for values typed to two decimals', () => {
		const typed = { influence: 33.33, value: -12.5 };
		expect(handleToNumbers(handleFromNumbers(typed))).toEqual(typed);
	});

	it('keeps the influence inside the segment (0 to 100 percent) and refuses non-numbers', () => {
		expect(handleFromNumbers({ influence: 140, value: 0 }).x).toBe(1);
		expect(handleFromNumbers({ influence: -20, value: 0 }).x).toBe(0);
		expect(handleFromNumbers({ influence: Number.NaN, value: 10 })).toEqual({ x: 0, y: 0.1 });
		expect(handleFromNumbers({ influence: 50, value: Number.POSITIVE_INFINITY }).y).toBe(0);
	});

	it('lets the value overshoot, which is how a handle makes an overshoot', () => {
		expect(handleFromNumbers({ influence: 30, value: 250 }).y).toBe(2.5);
	});
});

describe('in handle numbers', () => {
	it('measures an in handle backwards from its own keyframe, as an out handle is measured forwards', () => {
		// The default in handle {0.58, 1} mirrors the default out handle {0.42, 0}.
		expect(inHandleToNumbers({ x: 0.58, y: 1 })).toEqual({ influence: 42, value: 0 });
		expect(inHandleToNumbers({ x: 0.75, y: 0.8 })).toEqual({ influence: 25, value: 20 });
	});

	it('turns typed numbers back into an in handle', () => {
		expect(inHandleFromNumbers({ influence: 25, value: 20 })).toEqual({ x: 0.75, y: 0.8 });
		expect(inHandleFromNumbers({ influence: 42, value: 0 })).toEqual({ x: 0.58, y: 1 });
	});

	it('keeps the influence inside the segment', () => {
		expect(inHandleFromNumbers({ influence: 150, value: 0 }).x).toBe(0);
		expect(inHandleFromNumbers({ influence: -5, value: 0 }).x).toBe(1);
	});

	it('round trips for typed values', () => {
		const typed = { influence: 66.67, value: 33.33 };
		expect(inHandleToNumbers(inHandleFromNumbers(typed))).toEqual(typed);
	});
});

describe('velocity', () => {
	const linear: AnimatedValue<number> = {
		keyframes: [
			{ time: 0, value: 0, interpolation: 'linear' },
			{ time: 2_000_000, value: 100, interpolation: 'linear' }
		]
	};
	const at = (time: number) => evaluate(linear, time);

	it('is the change per second of a straight line', () => {
		expect(velocityAt(at, 1_000_000)).toBeCloseTo(50, 5);
	});

	it('is zero where a value holds and on a plateau', () => {
		const hold: AnimatedValue<number> = {
			keyframes: [
				{ time: 0, value: 5, interpolation: 'hold' },
				{ time: 1_000_000, value: 9, interpolation: 'hold' }
			]
		};
		expect(velocityAt((time) => evaluate(hold, time), 500_000)).toBe(0);
	});

	it('is zero at both ends of an ease in and out, and fastest in the middle', () => {
		const eased: AnimatedValue<number> = {
			keyframes: [
				{
					time: 0,
					value: 0,
					interpolation: 'bezier',
					easeOut: { x: 0.5, y: 0 }
				},
				{
					time: 1_000_000,
					value: 100,
					interpolation: 'bezier',
					easeIn: { x: 0.5, y: 1 }
				}
			]
		};
		const curve = velocityCurve((time) => evaluate(eased, time), 0, 1_000_000, 11);
		expect(curve).toHaveLength(11);
		expect(curve[0]!.velocity).toBeLessThan(5);
		expect(curve[10]!.velocity).toBeLessThan(5);
		const peak = Math.max(...curve.map((point) => point.velocity));
		expect(curve[5]!.velocity).toBe(peak);
		expect(peak).toBeGreaterThan(150);
	});

	it('is negative while a value falls, so a decrease is not drawn as a rise', () => {
		const falling = (time: number) => 100 - time / 10_000;
		expect(velocityAt(falling, 500_000)).toBeCloseTo(-100, 4);
	});

	it('samples evenly from the start to the end, both included', () => {
		const curve = velocityCurve(() => 0, 1_000_000, 3_000_000, 5);
		expect(curve.map((point) => point.time)).toEqual([
			1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000
		]);
	});
});
