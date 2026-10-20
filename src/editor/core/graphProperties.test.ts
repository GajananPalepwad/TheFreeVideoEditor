import { describe, expect, it } from 'vitest';
import { createEffectInstance } from './effects/instance';
import { channelKeyValue, graphPropertyIds, nearestChannel } from './graphProperties';
import { enableAnimation, setPropertyAtTime } from './keyframeEdit';
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

describe('nearestChannel', () => {
	const opacity = { propertyId: 'opacity', channelIdx: 0, displayFactor: 100 };
	const rotation = { propertyId: 'rotation', channelIdx: 0, displayFactor: 1 };

	function animatedClip(): Clip {
		let clip = enableAnimation(makeClip(), 'opacity', 0, 30);
		clip = setPropertyAtTime(clip, 'opacity', 1_000_000, 0, { autoKey: true, fps: 30 });
		clip = enableAnimation(clip, 'rotation', 0, 30);
		return setPropertyAtTime(clip, 'rotation', 1_000_000, 90, { autoKey: true, fps: 30 });
	}

	it('picks the channel whose curve passes closest to the click', () => {
		const clip = animatedClip();
		// At half way opacity reads 50 % and rotation reads 45 degrees.
		expect(nearestChannel(clip, [opacity, rotation], 500_000, 47)).toBe(rotation);
		expect(nearestChannel(clip, [opacity, rotation], 500_000, 52)).toBe(opacity);
	});

	it('returns undefined when there is nothing to pick from', () => {
		expect(nearestChannel(animatedClip(), [], 0, 0)).toBeUndefined();
	});
});

describe('channelKeyValue', () => {
	const fps = 30;

	it('turns a displayed number back into the stored value', () => {
		const clip = enableAnimation(makeClip(), 'opacity', 0, fps);
		const channel = { propertyId: 'opacity', channelIdx: 0, displayFactor: 100 };
		expect(channelKeyValue(clip, channel, 0, 40)).toBeCloseTo(0.4);
	});

	it('keeps the other channels of a vector property', () => {
		let clip = enableAnimation(makeClip(), 'position', 0, fps);
		clip = setPropertyAtTime(clip, 'position', 0, [10, 20], { autoKey: true, fps });
		const channel = { propertyId: 'position', channelIdx: 1, displayFactor: 1 };
		expect(channelKeyValue(clip, channel, 0, 99)).toEqual([10, 99]);
	});
});
