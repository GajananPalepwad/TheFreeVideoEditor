import { describe, expect, it } from 'vitest';
import type { ResolvedGradient } from '../../core/gradient';
import { createGradientPaint, rgbaCss } from './gradientPaint';

interface Recorded {
	kind: 'linear' | 'radial';
	args: number[];
	stops: Array<[number, string]>;
}

function fakeContext() {
	const created: Recorded[] = [];
	const make = (kind: Recorded['kind'], args: number[]) => {
		const record: Recorded = { kind, args, stops: [] };
		created.push(record);
		return { addColorStop: (offset: number, color: string) => record.stops.push([offset, color]) };
	};
	return {
		created,
		context: {
			createLinearGradient: (...args: number[]) => make('linear', args),
			createRadialGradient: (...args: number[]) => make('radial', args)
		} as unknown as CanvasRenderingContext2D
	};
}

const STOPS = [
	{ offset: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
	{ offset: 0.25, color: { r: 0, g: 1, b: 0, a: 0.5 } },
	{ offset: 1, color: { r: 0, g: 0, b: 1, a: 1 } }
];
const RECT = { x: 10, y: 20, width: 200, height: 100 };

function paint(type: ResolvedGradient['type'], angle = 45) {
	const { context, created } = fakeContext();
	createGradientPaint(context, { type, angle, stops: STOPS }, RECT);
	return created;
}

describe('rgbaCss', () => {
	it('writes channels as 0 to 255 and keeps alpha', () => {
		expect(rgbaCss({ r: 1, g: 0.5, b: 0, a: 0.25 })).toBe('rgba(255, 128, 0, 0.25)');
	});
});

describe('createGradientPaint', () => {
	it('adds every stop at its offset, not just two', () => {
		const [made] = paint('linear-horizontal');
		expect(made!.stops).toEqual([
			[0, 'rgba(255, 0, 0, 1)'],
			[0.25, 'rgba(0, 255, 0, 0.5)'],
			[1, 'rgba(0, 0, 255, 1)']
		]);
	});

	it('runs a horizontal gradient across the rectangle', () => {
		expect(paint('linear-horizontal')[0]).toMatchObject({
			kind: 'linear',
			args: [10, 20, 210, 20]
		});
	});

	it('runs a vertical gradient down the rectangle', () => {
		expect(paint('linear-vertical')[0]).toMatchObject({ kind: 'linear', args: [10, 20, 10, 120] });
	});

	it('spreads a radial gradient from the centre to half the longer side', () => {
		expect(paint('radial')[0]).toMatchObject({ kind: 'radial', args: [110, 70, 0, 110, 70, 100] });
	});

	it('runs an angled gradient through the centre along the angle', () => {
		const [made] = paint('linear-angle', 0);
		const half = Math.sqrt(200 * 200 + 100 * 100) / 2;
		expect(made!.args[0]).toBeCloseTo(110 - half, 6);
		expect(made!.args[1]).toBeCloseTo(70, 6);
		expect(made!.args[2]).toBeCloseTo(110 + half, 6);
		expect(made!.args[3]).toBeCloseTo(70, 6);
		const [down] = paint('linear-angle', 90);
		expect(down!.args[0]).toBeCloseTo(110, 6);
		expect(down!.args[1]).toBeCloseTo(70 - half, 6);
		expect(down!.args[3]).toBeCloseTo(70 + half, 6);
	});
});
