import { describe, expect, it } from 'vitest';
import {
	TEXT_TEMPLATE_PRESETS,
	TEXT_ANIMATION_PRESETS,
	applyTextAnimationPreset,
	applyTextTemplatePreset,
	clearTextAnimations
} from './presets';
import { GRAPHIC_ANIMATION_PRESETS, applyAnimationPresetToClip } from './graphicsTemplates';
import { createTextClip } from '../adjustment';
import { evaluate } from '../animation';
import type { Keyframe } from '../types';

describe('Text Presets & Templates', () => {
	it('has 7 valid template presets and 16 animation presets', () => {
		expect(TEXT_TEMPLATE_PRESETS.length).toBe(7);
		const ids = TEXT_TEMPLATE_PRESETS.map((t) => t.id);
		expect(ids).toContain('title');
		expect(ids).toContain('subtitle');
		expect(ids).toContain('lower-third');
		expect(ids).toContain('bold-outline');
		expect(ids).toContain('neon-glow');
		expect(ids).toContain('typewriter-caption');
		expect(ids).toContain('pop-in-caption');

		expect(TEXT_ANIMATION_PRESETS.length).toBe(16);
		const animIds = TEXT_ANIMATION_PRESETS.map((a) => a.id);
		expect(animIds).toContain('fade-in');
		expect(animIds).toContain('fade-out');
		expect(animIds).toContain('slide-in-up');
		expect(animIds).toContain('slide-in-down');
		expect(animIds).toContain('slide-in-left');
		expect(animIds).toContain('slide-in-right');
		expect(animIds).toContain('pop-in');
		expect(animIds).toContain('typewriter');
		expect(animIds).toContain('whip-slide-left');
		expect(animIds).toContain('elastic-spring');
		expect(animIds).toContain('cinematic-reveal');
		expect(animIds).toContain('broadcast-lower-third-in');
	});

	it('applies a template preset to a text clip', () => {
		const clip = createTextClip(0, 5_000_000, 'Custom Text');
		const applied = applyTextTemplatePreset(clip, 'lower-third', true);
		expect(applied.source?.type).toBe('text');
		if (applied.source?.type === 'text') {
			expect(applied.source.text).toBe('Custom Text');
			expect(applied.source.style?.alignment).toBe('left');
			expect(applied.source.box?.autoSize).toBe(false);
		}
		expect(applied.properties?.['text.fontSize']).toEqual({ value: 32 });
	});

	it('applies typewriter animation and reveals text over time', () => {
		const clip = createTextClip(0, 5_000_000, 'Typewriter Demo');
		const animated = applyTextAnimationPreset(clip, 'typewriter');

		const revealProp = animated.properties?.['text.reveal'];
		expect(revealProp).toBeDefined();
		expect('keyframes' in revealProp!).toBe(true);

		if (revealProp && 'keyframes' in revealProp) {
			// At t = 0
			expect(evaluate(revealProp, 0)).toBe(0);
			// At t = 750_000 (halfway of 1.5s)
			expect(evaluate(revealProp, 750_000)).toBeCloseTo(0.5, 2);
			// At t = 1_500_000
			expect(evaluate(revealProp, 1_500_000)).toBe(1);
		}
	});

	it('applies pop-in animation with scale bezier keyframes', () => {
		const clip = createTextClip(0, 5_000_000, 'Pop Demo');
		const animated = applyTextAnimationPreset(clip, 'pop-in');

		const scaleProp = animated.properties?.['scale'];
		expect(scaleProp).toBeDefined();
		expect('keyframes' in scaleProp!).toBe(true);

		if (scaleProp && 'keyframes' in scaleProp) {
			const startVal = evaluate(scaleProp, 0) as number[];
			expect(startVal[0]).toBe(0.6);
			const midVal = evaluate(scaleProp, 350_000) as number[];
			expect(midVal[0]).toBe(1.05);
			const endVal = evaluate(scaleProp, 500_000) as number[];
			expect(endVal[0]).toBe(1.0);
		}
	});

	it('applies fade-out preset at the end of the clip', () => {
		const clipDuration = 4_000_000;
		const clip = createTextClip(0, clipDuration, 'Out Demo');
		const animated = applyTextAnimationPreset(clip, 'fade-out');

		const opacityProp = animated.properties?.['opacity'];
		expect(opacityProp).toBeDefined();
		if (opacityProp && 'keyframes' in opacityProp) {
			const kfs = opacityProp.keyframes as Keyframe<number>[];
			// Preset duration is 500ms, so fade out starts at 3.5s and ends at 4.0s
			expect(kfs[0]!.time).toBe(3_500_000);
			expect(kfs[0]!.value).toBe(1);
			expect(kfs[1]!.time).toBe(4_000_000);
			expect(kfs[1]!.value).toBe(0);
		}
	});

	it('clears animation keyframes', () => {
		const clip = createTextClip(0, 5_000_000, 'Clear Demo');
		const animated = applyTextAnimationPreset(clip, 'pop-in');
		expect('keyframes' in (animated.properties?.['scale'] ?? {})).toBe(true);

		const cleared = clearTextAnimations(animated);
		expect('keyframes' in (cleared.properties?.['scale'] ?? {})).toBe(false);
		expect((cleared.properties?.['scale'] as { value: unknown })?.value).toBeDefined();
	});
});

function keyTimes(clip: ReturnType<typeof createTextClip>, propertyId: string): number[] {
	const curve = clip.properties?.[propertyId];
	return curve && 'keyframes' in curve ? curve.keyframes.map((key) => key.time) : [];
}

describe('animation presets on clips shorter than the preset', () => {
	it('squeezes an in preset into the clip', () => {
		const clip = createTextClip(0, 250_000, 'Short');
		// pop-in lasts 500 ms, so every key must be halved to land inside 250 ms.
		const full = keyTimes(
			applyTextAnimationPreset(createTextClip(0, 4_000_000, 'Long'), 'pop-in'),
			'scale'
		);
		const fitted = keyTimes(applyTextAnimationPreset(clip, 'pop-in'), 'scale');
		expect(fitted).toEqual(full.map((time) => Math.round(time / 2)));
	});

	it('squeezes an out preset so it still ends on the last frame', () => {
		const clip = createTextClip(0, 200_000, 'Short');
		const times = keyTimes(applyTextAnimationPreset(clip, 'fade-out'), 'opacity');
		expect(times).toEqual([0, 200_000]);
	});

	it('leaves presets that already fit untouched', () => {
		const clip = createTextClip(0, 500_000, 'Exact');
		expect(keyTimes(applyTextAnimationPreset(clip, 'fade-in'), 'opacity')).toEqual([0, 500_000]);
	});

	it('squeezes graphic presets too, measured from where they start', () => {
		const preset = GRAPHIC_ANIMATION_PRESETS.find((candidate) => candidate.id === 'bounce-in')!;
		const clip = createTextClip(0, 300_000, 'Short');
		const times = keyTimes(applyAnimationPresetToClip(clip, preset, 0), 'position');
		expect(times).toEqual([0, 210_000, 300_000]);
	});
});
