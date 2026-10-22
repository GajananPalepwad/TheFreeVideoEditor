import { describe, expect, it } from 'vitest';
import { graphPropertyIds } from '../graphProperties';
import { descriptorFor } from '../properties';
import type { Clip } from '../types';
import {
	animatorMargin,
	resolveTextAnimator,
	unitProgress,
	unitTransform,
	type TextAnimator
} from './animator';

const animator = (extra: Partial<TextAnimator> = {}): TextAnimator => ({
	progress: 0,
	stagger: 0.5,
	offsetX: 0,
	offsetY: 40,
	scale: 1,
	rotation: 0,
	opacity: 0,
	...extra
});

describe('unitProgress', () => {
	it('is 0 for every unit at the start and 1 for every unit at the end', () => {
		for (const stagger of [0, 0.3, 0.9, 1]) {
			for (let index = 0; index < 5; index += 1) {
				expect(unitProgress(index, 5, 0, stagger)).toBe(0);
				expect(unitProgress(index, 5, 1, stagger)).toBe(1);
			}
		}
	});

	it('moves every unit together when there is no stagger', () => {
		const values = [0, 1, 2, 3].map((index) => unitProgress(index, 4, 0.4, 0));
		expect(new Set(values).size).toBe(1);
		expect(values[0]).toBeCloseTo(0.4, 6);
	});

	it('starts the first unit before the last when there is a stagger', () => {
		const first = unitProgress(0, 5, 0.3, 0.6);
		const last = unitProgress(4, 5, 0.3, 0.6);
		expect(first).toBeGreaterThan(0);
		expect(last).toBe(0);
		const series = [0, 1, 2, 3, 4].map((index) => unitProgress(index, 5, 0.5, 0.6));
		for (let index = 1; index < series.length; index += 1) {
			expect(series[index]!).toBeLessThanOrEqual(series[index - 1]!);
		}
	});

	it('keeps the full stagger finite, one unit after another', () => {
		const at = (progress: number) => [0, 1, 2].map((index) => unitProgress(index, 3, progress, 1));
		expect(at(0.5).filter((value) => value === 1).length).toBeGreaterThanOrEqual(1);
		expect(at(0.5).every((value) => Number.isFinite(value))).toBe(true);
	});

	it('is 1 for a single unit once progress reaches 1, whatever the stagger', () => {
		expect(unitProgress(0, 1, 1, 1)).toBe(1);
		expect(unitProgress(0, 1, 0.5, 0.8)).toBeCloseTo(0.5, 6);
	});

	it('stays inside 0 to 1 for any progress', () => {
		expect(unitProgress(2, 5, -1, 0.5)).toBe(0);
		expect(unitProgress(2, 5, 3, 0.5)).toBe(1);
	});
});

describe('unitTransform', () => {
	it('is the starting pose at progress 0', () => {
		const pose = unitTransform(animator({ offsetX: 10, rotation: 90, scale: 0.5 }), 0);
		expect(pose).toEqual({ dx: 10, dy: 40, scale: 0.5, rotation: 90, opacity: 0 });
	});

	it('is no change at progress 1', () => {
		expect(unitTransform(animator({ offsetX: 10, rotation: 90, scale: 0.5 }), 1)).toEqual({
			dx: 0,
			dy: 0,
			scale: 1,
			rotation: 0,
			opacity: 1
		});
	});

	it('is half way at progress 0.5', () => {
		expect(unitTransform(animator({ offsetY: 40, scale: 0, opacity: 0.2 }), 0.5)).toEqual({
			dx: 0,
			dy: 20,
			scale: 0.5,
			rotation: 0,
			opacity: 0.6
		});
	});
});

describe('animatorMargin', () => {
	it('covers how far a unit starts from its place', () => {
		expect(animatorMargin(animator({ offsetX: -30, offsetY: 50 }), 48)).toBeGreaterThanOrEqual(50);
	});

	it('covers a unit that starts larger and one that spins', () => {
		expect(animatorMargin(animator({ offsetY: 0, scale: 2 }), 100)).toBeGreaterThanOrEqual(50);
		expect(animatorMargin(animator({ offsetY: 0, rotation: 180 }), 100)).toBeGreaterThan(0);
	});

	it('is a whole number and 0 for an animator that moves nothing', () => {
		expect(Number.isInteger(animatorMargin(animator({ offsetY: 13.2 }), 40))).toBe(true);
		expect(animatorMargin(animator({ offsetY: 0 }), 40)).toBe(0);
	});
});

describe('resolveTextAnimator', () => {
	const read =
		(values: Record<string, unknown>) =>
		(id: string): unknown =>
			values[id];

	it('has none when the clip has no text.anim.progress', () => {
		expect(resolveTextAnimator(read({ 'text.anim.offsetY': 10 }))).toBeNull();
	});

	it('uses the defaults for what the clip does not set', () => {
		expect(resolveTextAnimator(read({ 'text.anim.progress': 0.25 }))).toEqual({
			progress: 0.25,
			stagger: 0.6,
			offsetX: 0,
			offsetY: 40,
			scale: 1,
			rotation: 0,
			opacity: 0
		});
	});

	it('takes every value from its property', () => {
		const result = resolveTextAnimator(
			read({
				'text.anim.progress': 0.5,
				'text.anim.stagger': 0.2,
				'text.anim.offsetX': 5,
				'text.anim.offsetY': -8,
				'text.anim.scale': 0.5,
				'text.anim.rotation': 30,
				'text.anim.opacity': 0.4
			})
		);
		expect(result).toEqual({
			progress: 0.5,
			stagger: 0.2,
			offsetX: 5,
			offsetY: -8,
			scale: 0.5,
			rotation: 30,
			opacity: 0.4
		});
	});

	it('ignores values that are not numbers and keeps stagger and opacity in range', () => {
		const result = resolveTextAnimator(
			read({
				'text.anim.progress': 0.5,
				'text.anim.stagger': 7,
				'text.anim.opacity': -3,
				'text.anim.offsetY': 'high'
			})
		)!;
		expect(result.stagger).toBe(1);
		expect(result.opacity).toBe(0);
		expect(result.offsetY).toBe(40);
	});
});

describe('text animation properties', () => {
	it('are described for the Inspector and the graph editor', () => {
		expect(descriptorFor('text.anim.progress')).toMatchObject({
			shape: 'number',
			min: 0,
			max: 1,
			unit: '%',
			displayFactor: 100,
			defaultValue: 1
		});
		expect(descriptorFor('text.anim.stagger')).toMatchObject({ min: 0, max: 1, defaultValue: 0.6 });
		expect(descriptorFor('text.anim.offsetY')).toMatchObject({ unit: 'px', defaultValue: 40 });
		expect(descriptorFor('text.anim.offsetX')).toMatchObject({ unit: 'px', defaultValue: 0 });
		expect(descriptorFor('text.anim.scale')).toMatchObject({ unit: '%', displayFactor: 100 });
		expect(descriptorFor('text.anim.rotation')).toMatchObject({ unit: '°' });
		expect(descriptorFor('text.anim.opacity')).toMatchObject({ min: 0, max: 1, defaultValue: 0 });
	});

	it('are offered in the graph editor for text clips only', () => {
		const text = { id: 'c', source: { type: 'text', text: 'x' } } as unknown as Clip;
		const shape = {
			id: 's',
			source: { type: 'shape', shapeType: 'rect', width: 1, height: 1, fillColor: { r: 1, g: 1, b: 1, a: 1 } }
		} as unknown as Clip;
		expect(graphPropertyIds(text)).toContain('text.anim.progress');
		expect(graphPropertyIds(shape)).not.toContain('text.anim.progress');
	});
});
