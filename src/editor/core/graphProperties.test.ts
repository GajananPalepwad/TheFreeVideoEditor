import { describe, expect, it } from 'vitest';
import { createEffectInstance } from './effects/instance';
import { graphPropertyIds } from './graphProperties';
import { enableAnimation } from './keyframeEdit';
import type { Clip, ClipId } from './types';

function makeClip(patch: Partial<Clip> = {}): Clip {
	return {
		id: 'c1' as ClipId,
		start: 0,
		duration: 1_000_000,
		sourceIn: 0,
		sourceOut: 1_000_000,
		speed: 1,
		volume: 1,
		...patch
	};
}

describe('graphPropertyIds', () => {
	it('lists the transform channels for any clip', () => {
		expect(graphPropertyIds(makeClip())).toEqual([
			'position',
			'scale',
			'rotation',
			'opacity',
			'crop'
		]);
	});

	it('adds the colour properties of text and shapes', () => {
		const text = graphPropertyIds(
			makeClip({ source: { type: 'text', text: 'Hi', style: {} } as Clip['source'] })
		);
		expect(text).toEqual(
			expect.arrayContaining(['text.fontSize', 'text.fillColor', 'text.shadowColor'])
		);
		const shape = graphPropertyIds(makeClip({ source: { type: 'shape' } as Clip['source'] }));
		expect(shape).toEqual(
			expect.arrayContaining([
				'shape.width',
				'shape.fillColor',
				'shape.strokeColor',
				'shape.shadowColor'
			])
		);
	});

	it('lists only the effect parameters that are animated', () => {
		const blur = createEffectInstance('gaussianBlur', { radius: 10 });
		const id = `effect:gaussianBlur:${blur.id}:radius`;
		const staticClip = makeClip({ effects: [blur] });
		expect(graphPropertyIds(staticClip)).not.toContain(id);

		const animated = enableAnimation(staticClip, id, 0, 30);
		expect(graphPropertyIds(animated)).toContain(id);
	});

	it('skips animated effect parameters the graph cannot plot', () => {
		const key = createEffectInstance('chromaKey');
		const animatedKey = {
			...key,
			params: {
				...key.params,
				color: {
					keyframes: [
						{ time: 0, value: [0, 1, 0], interpolation: 'linear' as const },
						{ time: 500_000, value: [0, 0, 1], interpolation: 'linear' as const }
					]
				},
				tolerance: {
					keyframes: [
						{ time: 0, value: 0.2, interpolation: 'linear' as const },
						{ time: 500_000, value: 0.4, interpolation: 'linear' as const }
					]
				}
			}
		};
		const ids = graphPropertyIds(makeClip({ effects: [animatedKey] }));
		expect(ids).toContain(`effect:chromaKey:${key.id}:tolerance`);
		expect(ids).not.toContain(`effect:chromaKey:${key.id}:color`);
	});
});
