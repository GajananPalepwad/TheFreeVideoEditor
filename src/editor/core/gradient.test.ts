import { describe, expect, it } from 'vitest';
import { resolveGradient, gradientKey, type GradientFields } from './gradient';
import { graphPropertyIds } from './graphProperties';
import { descriptorFor } from './properties';
import { clipSourceSchema } from './schema';
import type { Clip, ClipId } from './types';

const RED = { r: 1, g: 0, b: 0, a: 1 };
const GREEN = { r: 0, g: 1, b: 0, a: 1 };
const BLUE = { r: 0, g: 0, b: 1, a: 1 };

const none = () => undefined;

describe('resolving a gradient', () => {
	it('has none when the type is none or nothing says there is one', () => {
		expect(resolveGradient({}, RED, none)).toBeNull();
		expect(
			resolveGradient({ gradientType: 'none', gradientColorEnd: GREEN }, RED, none)
		).toBeNull();
		// A type with no end colour and no stops has nothing to blend to.
		expect(resolveGradient({ gradientType: 'radial' }, RED, none)).toBeNull();
	});

	it('is a two stop blend from the fill to the end colour for the old fields', () => {
		const result = resolveGradient(
			{ gradientType: 'linear-angle', gradientColorEnd: GREEN, gradientAngle: 30 },
			RED,
			none
		);
		expect(result).toEqual({
			type: 'linear-angle',
			angle: 30,
			stops: [
				{ offset: 0, color: RED },
				{ offset: 1, color: GREEN }
			]
		});
	});

	it('uses the angle 45 degrees when none is given', () => {
		expect(
			resolveGradient({ gradientType: 'linear-angle', gradientColorEnd: GREEN }, RED, none)!.angle
		).toBe(45);
	});

	it('uses the stops a clip lists, whatever the fill is', () => {
		const fields: GradientFields = {
			gradientType: 'linear-horizontal',
			gradientStops: [
				{ offset: 0, color: RED },
				{ offset: 0.5, color: GREEN },
				{ offset: 1, color: BLUE }
			]
		};
		expect(resolveGradient(fields, BLUE, none)!.stops).toEqual(fields.gradientStops);
	});

	it('sorts stops by position and keeps them inside 0 to 1', () => {
		const result = resolveGradient(
			{
				gradientType: 'radial',
				gradientStops: [
					{ offset: 1.4, color: BLUE },
					{ offset: -0.2, color: RED },
					{ offset: 0.5, color: GREEN }
				]
			},
			RED,
			none
		)!;
		expect(result.stops.map((stop) => stop.offset)).toEqual([0, 0.5, 1]);
		expect(result.stops.map((stop) => stop.color)).toEqual([RED, GREEN, BLUE]);
	});

	it('ignores a stop list of fewer than two stops and falls back to the end colour', () => {
		const result = resolveGradient(
			{
				gradientType: 'radial',
				gradientColorEnd: GREEN,
				gradientStops: [{ offset: 0, color: BLUE }]
			},
			RED,
			none
		)!;
		expect(result.stops).toEqual([
			{ offset: 0, color: RED },
			{ offset: 1, color: GREEN }
		]);
	});
});

describe('animated gradients', () => {
	const fields: GradientFields = {
		gradientType: 'linear-angle',
		gradientAngle: 0,
		gradientStops: [
			{ offset: 0, color: RED },
			{ offset: 0.5, color: GREEN },
			{ offset: 1, color: BLUE }
		]
	};

	it('takes the angle from the gradient.angle property', () => {
		const read = (id: string) => (id === 'gradient.angle' ? 90 : undefined);
		expect(resolveGradient(fields, RED, read)!.angle).toBe(90);
	});

	it('takes a stop colour and position from its properties', () => {
		const read = (id: string) => {
			if (id === 'gradient.stop1.color') return [0.5, 0.5, 0, 1];
			if (id === 'gradient.stop1.offset') return 0.25;
			return undefined;
		};
		const result = resolveGradient(fields, RED, read)!;
		expect(result.stops[1]).toEqual({ offset: 0.25, color: { r: 0.5, g: 0.5, b: 0, a: 1 } });
		expect(result.stops[0]).toEqual({ offset: 0, color: RED });
	});

	it('re-sorts when an animated position passes its neighbour', () => {
		const read = (id: string) => (id === 'gradient.stop1.offset' ? 0.9 : undefined);
		const result = resolveGradient(
			{
				...fields,
				gradientStops: [
					{ offset: 0, color: RED },
					{ offset: 0.5, color: GREEN },
					{ offset: 0.7, color: BLUE }
				]
			},
			RED,
			read
		)!;
		expect(result.stops.map((stop) => stop.color)).toEqual([RED, BLUE, GREEN]);
	});

	it('animates the second colour of a two stop gradient through stop 1', () => {
		const read = (id: string) => (id === 'gradient.stop1.color' ? [0, 0, 1, 1] : undefined);
		const result = resolveGradient({ gradientType: 'radial', gradientColorEnd: GREEN }, RED, read)!;
		expect(result.stops[1]!.color).toEqual(BLUE);
	});

	it('ignores values that are not numbers or colours', () => {
		const read = (id: string) =>
			id === 'gradient.stop1.color' ? 'red' : id === 'gradient.angle' ? Number.NaN : undefined;
		const result = resolveGradient(fields, RED, read)!;
		expect(result.stops[1]!.color).toEqual(GREEN);
		expect(result.angle).toBe(0);
	});
});

describe('gradient key', () => {
	it('differs when a stop colour, position or the angle differs, and is equal otherwise', () => {
		const base = resolveGradient({ gradientType: 'radial', gradientColorEnd: GREEN }, RED, none)!;
		const same = resolveGradient({ gradientType: 'radial', gradientColorEnd: GREEN }, RED, none)!;
		const otherColor = resolveGradient(
			{ gradientType: 'radial', gradientColorEnd: BLUE },
			RED,
			none
		)!;
		const moved = {
			...base,
			stops: [base.stops[0]!, { offset: 0.9, color: GREEN }]
		};
		expect(gradientKey(same)).toBe(gradientKey(base));
		expect(gradientKey(otherColor)).not.toBe(gradientKey(base));
		expect(gradientKey(moved)).not.toBe(gradientKey(base));
		expect(gradientKey({ ...base, angle: 12 })).not.toBe(gradientKey(base));
		expect(gradientKey(null)).toBe('none');
	});
});

describe('gradient properties', () => {
	it('describes the angle, and a position and a colour for each stop', () => {
		expect(descriptorFor('gradient.angle')).toMatchObject({ shape: 'number', unit: '°' });
		expect(descriptorFor('gradient.stop3.offset')).toMatchObject({
			shape: 'number',
			min: 0,
			max: 1,
			unit: '%',
			displayFactor: 100
		});
		expect(descriptorFor('gradient.stop2.color')).toMatchObject({
			shape: 'vec4',
			channels: ['R', 'G', 'B', 'A'],
			min: 0,
			max: 1
		});
		expect(descriptorFor('gradient.stop2.color')!.label).toBe('Gradient Stop 3 Color');
	});

	it('knows nothing of other names that look similar', () => {
		expect(descriptorFor('gradient.stop.color')).toBeUndefined();
		expect(descriptorFor('gradient.stopx.offset')).toBeUndefined();
		expect(descriptorFor('gradient.stop1.width')).toBeUndefined();
		expect(descriptorFor('gradient.stop99.offset')).toBeUndefined();
	});

	it('are offered in the graph editor for a clip that has a gradient, and only then', () => {
		const text = (gradientStops?: unknown[]): Clip =>
			({
				id: 'c' as ClipId,
				start: 0,
				duration: 1,
				source: {
					type: 'text',
					text: 'x',
					box: { gradientType: 'radial', gradientStops }
				}
			}) as unknown as Clip;
		const three = [
			{ offset: 0, color: RED },
			{ offset: 0.5, color: GREEN },
			{ offset: 1, color: BLUE }
		];
		const ids = graphPropertyIds(text(three));
		expect(ids).toContain('gradient.angle');
		expect(ids).toContain('gradient.stop2.color');
		expect(ids).not.toContain('gradient.stop3.color');
		const plain = graphPropertyIds({
			id: 'c' as ClipId,
			start: 0,
			duration: 1,
			source: { type: 'text', text: 'x' }
		} as unknown as Clip);
		expect(plain.some((id) => id.startsWith('gradient.'))).toBe(false);
	});
});

describe('gradient stops in the file format', () => {
	const solid = (gradientStops: unknown) => ({
		type: 'solid',
		color: RED,
		gradientType: 'radial',
		gradientStops
	});

	it('keeps a list of stops on a solid', () => {
		const stops = [
			{ offset: 0, color: RED },
			{ offset: 1, color: BLUE }
		];
		expect(clipSourceSchema.parse(solid(stops))).toMatchObject({ gradientStops: stops });
	});

	it('refuses a list with one stop, an offset outside 0 to 1, or too many stops', () => {
		expect(() => clipSourceSchema.parse(solid([{ offset: 0, color: RED }]))).toThrow();
		expect(() =>
			clipSourceSchema.parse(
				solid([
					{ offset: -1, color: RED },
					{ offset: 1, color: BLUE }
				])
			)
		).toThrow();
		const many = Array.from({ length: 17 }, (_, index) => ({ offset: index / 16, color: RED }));
		expect(() => clipSourceSchema.parse(solid(many))).toThrow();
	});
});
