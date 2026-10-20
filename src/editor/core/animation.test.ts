import { describe, expect, it } from 'vitest';
import {
	addKeyframe,
	cubicBezierEase,
	evaluate,
	moveKeyframe,
	removeKeyframe,
	retimeAnimatedValue,
	retimeAnimatedValueTail,
	setInterpolation,
	shiftAnimatedValue,
	solveBezierParameter,
	splitAnimatedValue
} from './animation';
import { bounceEase, elasticEase, springEase } from './easing';
import { animatedValueSchema } from './schema';
import type { AnimatedValue, Keyframe } from './types';

function numberCurve(...frames: Array<[number, number, Keyframe<number>['interpolation']?]>) {
	return {
		keyframes: frames.map(([time, value, interpolation]) => ({
			time,
			value,
			interpolation: interpolation ?? 'linear'
		}))
	} satisfies AnimatedValue<number>;
}

function random(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
}

function randomCurve(next: () => number): AnimatedValue<number> {
	const count = 2 + Math.floor(next() * 5);
	const times = new Set<number>();
	while (times.size < count) times.add(Math.floor(next() * 20) * 100_000);
	const kinds = ['linear', 'hold', 'bezier'] as const;
	return {
		keyframes: [...times]
			.toSorted((a, b) => a - b)
			.map((time) => ({
				time,
				value: next() * 200 - 100,
				interpolation: kinds[Math.floor(next() * 3)]!,
				easeOut: { x: next(), y: next() },
				easeIn: { x: next(), y: next() }
			}))
	};
}

describe('evaluate', () => {
	it('returns constants and clamps outside the keyframe range', () => {
		expect(evaluate({ value: 5 }, 123)).toBe(5);
		const curve = numberCurve([100, 10], [200, 20]);
		expect(evaluate(curve, 0)).toBe(10);
		expect(evaluate(curve, 999)).toBe(20);
	});

	it('matches the closed form for linear interpolation', () => {
		const curve = numberCurve([0, 0], [1_000_000, 100]);
		for (const time of [0, 250_000, 500_000, 750_000, 1_000_000]) {
			expect(evaluate(curve, time)).toBeCloseTo(time / 10_000, 10);
		}
	});

	it('holds the left value until the next keyframe', () => {
		const curve = numberCurve([0, 1, 'hold'], [100, 9]);
		expect(evaluate(curve, 99)).toBe(1);
		expect(evaluate(curve, 100)).toBe(9);
	});

	it('is continuous at keyframes', () => {
		const curve = numberCurve([0, 0, 'bezier'], [100, 50, 'linear'], [200, 10]);
		expect(evaluate(curve, 100)).toBe(50);
		expect(Math.abs(evaluate(curve, 99.999999) - 50)).toBeLessThan(1e-3);
	});

	it('interpolates vectors and colors component-wise and holds non-numeric values', () => {
		const vector = {
			keyframes: [
				{ time: 0, value: [0, 10], interpolation: 'linear' as const },
				{ time: 100, value: [10, 20], interpolation: 'linear' as const }
			]
		};
		expect(evaluate(vector, 50)).toEqual([5, 15]);
		const color = {
			keyframes: [
				{ time: 0, value: { r: 0, g: 0, b: 0, a: 1 }, interpolation: 'linear' as const },
				{ time: 100, value: { r: 1, g: 0.5, b: 0, a: 1 }, interpolation: 'linear' as const }
			]
		};
		expect(evaluate(color, 50)).toEqual({ r: 0.5, g: 0.25, b: 0, a: 1 });
		const mode = {
			keyframes: [
				{ time: 0, value: 'a', interpolation: 'linear' as const },
				{ time: 100, value: 'b', interpolation: 'linear' as const }
			]
		};
		expect(evaluate(mode, 50)).toBe('a');
	});

	it('supports unwrapped and shortest-path angles', () => {
		const frames = [
			{ time: 0, value: 350, interpolation: 'linear' as const },
			{ time: 100, value: 10, interpolation: 'linear' as const }
		];
		expect(evaluate({ keyframes: frames }, 50)).toBe(180);
		expect(evaluate({ keyframes: frames, angleMode: 'shortest' }, 50)).toBe(360);
	});
});

describe('cubic bezier easing', () => {
	it('keeps time monotonic and endpoints exact', () => {
		const out = { x: 0.42, y: 0 };
		const handleIn = { x: 0.58, y: 1 };
		let previous = -Infinity;
		for (let step = 0; step <= 200; step += 1) {
			const u = step / 200;
			expect(solveBezierParameter(out.x, handleIn.x, u)).toBeGreaterThanOrEqual(previous);
			previous = solveBezierParameter(out.x, handleIn.x, u);
		}
		expect(cubicBezierEase(out, handleIn, 0)).toBe(0);
		expect(cubicBezierEase(out, handleIn, 1)).toBe(1);
		expect(cubicBezierEase(out, handleIn, 0.5)).toBeCloseTo(0.5, 6);
	});

	it('reduces to linear for collinear handles', () => {
		for (const u of [0.1, 0.3, 0.77]) {
			expect(cubicBezierEase({ x: 1 / 3, y: 1 / 3 }, { x: 2 / 3, y: 2 / 3 }, u)).toBeCloseTo(u, 9);
		}
	});

	it('does not overshoot time even with extreme handles', () => {
		const curve = numberCurve([0, 0, 'bezier'], [1000, 1]);
		const withHandles = setInterpolation(curve, 0, 'bezier', {
			easeOut: { x: 5, y: 3 },
			easeIn: { x: -4, y: -2 }
		});
		for (let time = 0; time <= 1000; time += 25) {
			expect(Number.isFinite(evaluate(withHandles, time))).toBe(true);
		}
	});
});

describe('keyframe editing', () => {
	it('adds, replaces, moves, retargets and removes keyframes immutably', () => {
		const base: AnimatedValue<number> = { value: 1 };
		const one = addKeyframe(base, { time: 100, value: 5, interpolation: 'linear' });
		const two = addKeyframe(one, { time: 0, value: 2, interpolation: 'linear' });
		const replaced = addKeyframe(two, { time: 100, value: 9, interpolation: 'hold' });
		expect(base).toEqual({ value: 1 });
		expect(evaluate(replaced, 100)).toBe(9);
		const moved = moveKeyframe(replaced, 100, 300);
		expect(evaluate(moved, 300)).toBe(9);
		expect(evaluate(removeKeyframe(moved, 300), 500)).toBe(2);
		expect(removeKeyframe(removeKeyframe(moved, 300), 0)).toEqual({ value: 2 });
		expect(() => addKeyframe(base, { time: -1, value: 1, interpolation: 'linear' })).toThrow(
			RangeError
		);
		expect(shiftAnimatedValue(two, 50)).toEqual(
			addKeyframe(addKeyframe({ value: 0 }, { time: 50, value: 2, interpolation: 'linear' }), {
				time: 150,
				value: 5,
				interpolation: 'linear'
			})
		);
	});
});

describe('split and retime', () => {
	it('is lossless on 1,000 random curves', () => {
		const next = random(2024);
		for (let index = 0; index < 1000; index += 1) {
			const curve = randomCurve(next);
			const total = 2_000_000;
			const at = 1 + Math.floor(next() * (total - 1));
			const [left, right] = splitAnimatedValue(curve, at);
			for (let sample = 0; sample < 12; sample += 1) {
				const time = Math.floor(next() * total);
				const expected = evaluate(curve, time);
				const actual = time <= at ? evaluate(left, time) : evaluate(right, time - at);
				expect(Math.abs(actual - expected)).toBeLessThan(1e-4);
			}
			expect(Math.abs(evaluate(left, at) - evaluate(curve, at))).toBeLessThan(1e-6);
			expect(Math.abs(evaluate(right, 0) - evaluate(curve, at))).toBeLessThan(1e-6);
		}
	});

	it('splits vectors on a bezier segment exactly', () => {
		const curve = {
			keyframes: [
				{
					time: 0,
					value: [0, 100],
					interpolation: 'bezier' as const,
					easeOut: { x: 0.2, y: 0.9 }
				},
				{
					time: 1000,
					value: [50, -20],
					interpolation: 'linear' as const,
					easeIn: { x: 0.7, y: 0.4 }
				}
			]
		};
		const [left, right] = splitAnimatedValue(curve, 400);
		for (const time of [0, 100, 399, 400]) {
			const expected = evaluate(curve, time);
			const actual = evaluate(left, time);
			expect(actual[0]).toBeCloseTo(expected[0]!, 5);
			expect(actual[1]).toBeCloseTo(expected[1]!, 5);
		}
		for (const time of [400, 500, 900, 1000]) {
			const expected = evaluate(curve, time);
			const actual = evaluate(right, time - 400);
			expect(actual[0]).toBeCloseTo(expected[0]!, 5);
			expect(actual[1]).toBeCloseTo(expected[1]!, 5);
		}
	});

	it('handles splits outside the keyframe range, on a keyframe and for constants', () => {
		const curve = numberCurve([100, 10], [300, 30]);
		const [before, afterStart] = splitAnimatedValue(curve, 50);
		expect(before).toEqual({ value: 10 });
		expect(evaluate(afterStart, 50)).toBe(10);
		const [leftOnKey, rightOnKey] = splitAnimatedValue(curve, 300);
		expect(evaluate(leftOnKey, 300)).toBe(30);
		expect(rightOnKey).toEqual({ value: 30 });
		expect(splitAnimatedValue({ value: 4 }, 10)).toEqual([{ value: 4 }, { value: 4 }]);
		const [, exact] = splitAnimatedValue(curve, 100);
		expect(evaluate(exact, 100)).toBe(20);
	});

	it('retimes a head trim without changing values at the same absolute time', () => {
		const curve = numberCurve([0, 0], [1000, 100]);
		const trimmed = retimeAnimatedValue(curve, 400);
		for (const absolute of [400, 700, 1000]) {
			expect(evaluate(trimmed, absolute - 400)).toBeCloseTo(evaluate(curve, absolute), 9);
		}
	});
});

describe('spring, elastic and bounce interpolation', () => {
	const kinds = [
		['spring', springEase],
		['elastic', elasticEase],
		['bounce', bounceEase]
	] as const;

	for (const [kind, ease] of kinds) {
		it(`${kind} eases a number between its keyframes`, () => {
			const curve = numberCurve([0, 10, kind], [1000, 110]);
			for (const time of [100, 250, 500, 800]) {
				expect(evaluate(curve, time)).toBeCloseTo(10 + 100 * ease(time / 1000), 9);
			}
			expect(evaluate(curve, 0)).toBe(10);
			expect(evaluate(curve, 1000)).toBe(110);
		});

		it(`${kind} eases vectors component-wise`, () => {
			const curve: AnimatedValue<number[]> = {
				keyframes: [
					{ time: 0, value: [0, 100], interpolation: kind },
					{ time: 1000, value: [50, 0], interpolation: 'linear' }
				]
			};
			const [x, y] = evaluate(curve, 400);
			expect(x).toBeCloseTo(50 * ease(0.4), 9);
			expect(y).toBeCloseTo(100 - 100 * ease(0.4), 9);
		});

		it(`${kind} round-trips through the project schema`, () => {
			const curve = numberCurve([0, 0, kind], [1000, 1]);
			expect(animatedValueSchema.parse(curve)).toEqual(curve);
		});

		it(`${kind} keeps its shape on both sides of a split`, () => {
			const curve = numberCurve([0, 0, kind], [1000, 100], [2000, 40]);
			for (const at of [250, 600, 1000]) {
				const [left, right] = splitAnimatedValue(curve, at);
				for (let time = 0; time <= 2000; time += 25) {
					const actual = time <= at ? evaluate(left, time) : evaluate(right, time - at);
					expect(Math.abs(actual - evaluate(curve, time))).toBeLessThan(2.5);
				}
			}
		});
	}

	it('keeps the incoming ease of the key it bakes', () => {
		const curve: AnimatedValue<number> = {
			keyframes: [
				{ time: 0, value: 0, interpolation: 'bezier' },
				{
					time: 1000,
					value: 100,
					interpolation: 'spring',
					easeIn: { x: 0.2, y: 0.9 }
				},
				{ time: 2000, value: 0, interpolation: 'linear' }
			]
		};
		const [left] = splitAnimatedValue(curve, 1500);
		for (const time of [250, 500, 750]) {
			expect(evaluate(left, time)).toBeCloseTo(evaluate(curve, time), 9);
		}
	});
});

describe('tail retiming of end-anchored keys', () => {
	function fadeOutCurve(duration: number, fade = 500_000): AnimatedValue<number> {
		return {
			keyframes: [
				{ time: 0, value: 1, interpolation: 'linear' },
				{ time: duration - fade, value: 1, interpolation: 'linear', anchor: 'end' },
				{ time: duration, value: 0, interpolation: 'linear', anchor: 'end' }
			]
		};
	}

	function times(curve: AnimatedValue<number>): number[] {
		return 'keyframes' in curve ? curve.keyframes.map((key) => key.time) : [];
	}

	it('leaves curves without anchored keys alone', () => {
		const curve = numberCurve([0, 0], [1000, 100]);
		expect(retimeAnimatedValueTail(curve, 2000, 1500)).toBe(curve);
	});

	it('moves an anchored fade-out with a shorter end', () => {
		const shorter = retimeAnimatedValueTail(fadeOutCurve(4_000_000), 4_000_000, 3_000_000);
		expect(times(shorter)).toEqual([0, 2_500_000, 3_000_000]);
		expect(evaluate(shorter, 3_000_000)).toBe(0);
	});

	it('moves an anchored fade-out with a longer end', () => {
		const longer = retimeAnimatedValueTail(fadeOutCurve(4_000_000), 4_000_000, 5_000_000);
		expect(times(longer)).toEqual([0, 4_500_000, 5_000_000]);
	});

	it('squeezes the anchored keys when the clip is shorter than the fade', () => {
		const tiny = retimeAnimatedValueTail(fadeOutCurve(1_000_000), 1_000_000, 300_000);
		expect(times(tiny)).toEqual([0, 300_000]);
		expect(evaluate(tiny, 0)).toBe(1);
		expect(evaluate(tiny, 300_000)).toBe(0);
	});

	it('drops keys that the moved fade would run into', () => {
		const curve: AnimatedValue<number> = {
			keyframes: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 500_000, value: 1, interpolation: 'linear' },
				{ time: 700_000, value: 1, interpolation: 'linear', anchor: 'end' },
				{ time: 1_200_000, value: 0, interpolation: 'linear', anchor: 'end' }
			]
		};
		const trimmed = retimeAnimatedValueTail(curve, 1_200_000, 900_000);
		expect(times(trimmed)).toEqual([0, 400_000, 900_000]);
	});

	it('keeps every other key when the end is extended', () => {
		const curve: AnimatedValue<number> = {
			keyframes: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 1_000_000, value: 1, interpolation: 'linear', anchor: 'end' },
				{ time: 1_400_000, value: 0.5, interpolation: 'linear' },
				{ time: 2_000_000, value: 0, interpolation: 'linear', anchor: 'end' }
			]
		};
		const longer = retimeAnimatedValueTail(curve, 2_000_000, 2_200_000);
		expect(times(longer)).toEqual([0, 1_200_000, 1_400_000, 2_200_000]);
	});

	it('keeps the anchor flag through the project schema', () => {
		const curve = fadeOutCurve(2_000_000);
		expect(animatedValueSchema.parse(curve)).toEqual(curve);
	});

	it('keeps the anchor when changing interpolation or baking a split', () => {
		const curve = fadeOutCurve(2_000_000);
		const changed = setInterpolation(curve, 1_500_000, 'spring');
		expect('keyframes' in changed && changed.keyframes[1]?.anchor).toBe('end');
		const [, right] = splitAnimatedValue(curve, 1_750_000);
		expect('keyframes' in right && right.keyframes.every((key) => key.anchor === 'end')).toBe(true);
	});
});
