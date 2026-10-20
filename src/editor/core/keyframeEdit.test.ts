import { describe, expect, it } from 'vitest';
import { isAnimated } from './animation';
import { bounceEase, elasticEase, springEase } from './easing';
import {
	copyKeyframes,
	deleteKeyframes,
	disableAnimation,
	enableAnimation,
	hasKeyframeAt,
	keyframesOf,
	moveKeyframes,
	nextKeyframeTime,
	pasteKeyframes,
	prevKeyframeTime,
	setBezierHandles,
	setKeyframeInterpolation,
	setKeyframeValue,
	setPropertyAtTime,
	toggleKeyframe,
	type KeyframeClipboard,
	type KeyframeRef
} from './keyframeEdit';
import { propertyCurve, readProperty } from './properties';
import type { AssetId, Clip, ClipId, PropertyId } from './types';

const CLOSED_FORM = { spring: springEase, elastic: elasticEase, bounce: bounceEase };

function makeClip(duration = 5_000_000): Clip {
	return {
		id: 'clip-1' as ClipId,
		assetId: 'asset-1' as AssetId,
		start: 1_000_000,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 1,
		properties: {}
	};
}

describe('keyframeEdit core operations', () => {
	const fps = 30;

	it('sets constant property value when not animated', () => {
		let clip = makeClip();
		clip = setPropertyAtTime(clip, 'opacity', 0, 0.75, { autoKey: false, fps });
		expect(readProperty(clip, 'opacity', 0)).toBe(0.75);
		const curve = propertyCurve(clip, 'opacity');
		expect(curve && isAnimated(curve)).toBe(false);
	});

	it('throws NEEDS_KEYFRAME when property is animated and autoKey is false', () => {
		let clip = makeClip();
		clip = enableAnimation(clip, 'opacity', 0, fps);
		expect(() =>
			setPropertyAtTime(clip, 'opacity', 1_000_000, 0.5, { autoKey: false, fps })
		).toThrow(/is animated; add a keyframe/);
	});

	it('adds and updates keyframes when autoKey is true', () => {
		let clip = makeClip();
		clip = enableAnimation(clip, 'position', 0, fps);
		clip = setPropertyAtTime(clip, 'position', 1_000_000, [100, 50], { autoKey: true, fps });

		const curve = propertyCurve(clip, 'position');
		expect(curve && isAnimated(curve)).toBe(true);
		if (curve && isAnimated(curve)) {
			expect(curve.keyframes.length).toBe(2);
			const k1 = curve.keyframes.find((k) => Math.abs(k.time - 1_000_000) < 50_000);
			expect(k1?.value).toEqual([100, 50]);
		}

		// Updating existing keyframe at same time
		clip = setPropertyAtTime(clip, 'position', 1_000_000, [200, 80], { autoKey: true, fps });
		const updatedCurve = propertyCurve(clip, 'position');
		if (updatedCurve && isAnimated(updatedCurve)) {
			expect(updatedCurve.keyframes.length).toBe(2);
			const k1 = updatedCurve.keyframes.find((k) => Math.abs(k.time - 1_000_000) < 50_000);
			expect(k1?.value).toEqual([200, 80]);
		}
	});

	it('enables and disables animation properly', () => {
		let clip = makeClip();
		// Enable animation
		clip = enableAnimation(clip, 'rotation', 500_000, fps);
		expect(hasKeyframeAt(clip, 'rotation', 500_000)).toBe(true);

		// Add another keyframe
		clip = setPropertyAtTime(clip, 'rotation', 1_500_000, 90, { autoKey: true, fps });
		expect(readProperty(clip, 'rotation', 1_500_000)).toBe(90);

		// Disable with flatten-current
		const flattened = disableAnimation(clip, 'rotation', 1_500_000, 'flatten-current');
		const flatCurve = propertyCurve(flattened, 'rotation');
		expect(flatCurve && isAnimated(flatCurve)).toBe(false);
		expect(readProperty(flattened, 'rotation', 0)).toBe(90);

		// Disable with discard keeps first keyframe value
		const discarded = disableAnimation(clip, 'rotation', 1_500_000, 'discard');
		expect(readProperty(discarded, 'rotation', 0)).toBe(0);
	});

	it('toggles keyframe at playhead', () => {
		let clip = makeClip();
		// Toggle when not animated enables it
		clip = toggleKeyframe(clip, 'opacity', 500_000, fps);
		expect(hasKeyframeAt(clip, 'opacity', 500_000)).toBe(true);

		// Toggle at an empty time adds keyframe
		clip = toggleKeyframe(clip, 'opacity', 1_000_000, fps);
		expect(hasKeyframeAt(clip, 'opacity', 1_000_000)).toBe(true);

		// Toggle at existing keyframe removes it
		clip = toggleKeyframe(clip, 'opacity', 1_000_000, fps);
		expect(hasKeyframeAt(clip, 'opacity', 1_000_000)).toBe(false);
	});

	it('finds next and previous keyframe times', () => {
		let clip = makeClip();
		clip = enableAnimation(clip, 'opacity', 100_000, fps);
		clip = setPropertyAtTime(clip, 'opacity', 500_000, 0.8, { autoKey: true, fps });
		clip = setPropertyAtTime(clip, 'opacity', 1_200_000, 0.2, { autoKey: true, fps });

		expect(nextKeyframeTime(clip, ['opacity'], 0)).toBe(100_000);
		expect(nextKeyframeTime(clip, ['opacity'], 200_000)).toBe(500_000);
		expect(nextKeyframeTime(clip, ['opacity'], 1_500_000)).toBeNull();

		expect(prevKeyframeTime(clip, ['opacity'], 1_500_000)).toBe(1_200_000);
		expect(prevKeyframeTime(clip, ['opacity'], 400_000)).toBe(100_000);
		expect(prevKeyframeTime(clip, ['opacity'], 50_000)).toBeNull();
	});

	it('moves keyframes clamped to clip bounds and replaces collisions', () => {
		let clip = makeClip(2_000_000);
		clip = enableAnimation(clip, 'scale', 500_000, fps);
		clip = setPropertyAtTime(clip, 'scale', 1_000_000, [2, 2], { autoKey: true, fps });

		const refs: KeyframeRef[] = [
			{ propertyId: 'scale', time: 500_000 },
			{ propertyId: 'scale', time: 1_000_000 }
		];

		const result = moveKeyframes(clip, refs, 400_000);
		clip = result.clip;
		expect(hasKeyframeAt(clip, 'scale', 900_000)).toBe(true);
		expect(hasKeyframeAt(clip, 'scale', 1_400_000)).toBe(true);

		// Move beyond duration clamps delta
		const clampedMove = moveKeyframes(
			clip,
			[
				{ propertyId: 'scale', time: 900_000 },
				{ propertyId: 'scale', time: 1_400_000 }
			],
			1_000_000
		);
		expect(clampedMove.appliedDelta).toBe(600_000); // 2_000_000 - 1_400_000
	});

	it('deleting the last keyframe flattens to a constant', () => {
		let clip = makeClip();
		clip = enableAnimation(clip, 'opacity', 500_000, fps);
		clip = deleteKeyframes(clip, [{ propertyId: 'opacity', time: 500_000 }]);

		const curve = propertyCurve(clip, 'opacity');
		expect(curve && isAnimated(curve)).toBe(false);
	});

	it('sets keyframe value and clamps', () => {
		let clip = makeClip();
		clip = enableAnimation(clip, 'opacity', 500_000, fps);
		clip = setKeyframeValue(clip, 'opacity', 500_000, 1.5); // Should clamp opacity to 1
		expect(readProperty(clip, 'opacity', 500_000)).toBe(1);
	});

	it('sets interpolation presets and bezier handles', () => {
		let clip = makeClip();
		clip = enableAnimation(clip, 'rotation', 0, fps);
		clip = setPropertyAtTime(clip, 'rotation', 1_000_000, 45, { autoKey: true, fps });

		clip = setKeyframeInterpolation(clip, [{ propertyId: 'rotation', time: 0 }], 'ease-out');
		const curve = propertyCurve(clip, 'rotation');
		if (curve && isAnimated(curve)) {
			expect(curve.keyframes[0]?.interpolation).toBe('bezier');
			expect(curve.keyframes[0]?.easeOut).toBeDefined();
		}

		clip = setBezierHandles(clip, 'rotation', 0, {
			easeOut: { x: 0.3, y: 0.1 }
		});
		const bezierCurve = propertyCurve(clip, 'rotation');
		if (bezierCurve && isAnimated(bezierCurve)) {
			expect(bezierCurve.keyframes[0]?.easeOut?.x).toBe(0.3);
		}
	});

	it('applies spring, elastic and bounce presets and drops bezier handles they replace', () => {
		for (const preset of ['spring', 'elastic', 'bounce'] as const) {
			let clip = makeClip();
			clip = enableAnimation(clip, 'rotation', 0, fps);
			clip = setPropertyAtTime(clip, 'rotation', 1_000_000, 100, { autoKey: true, fps });
			clip = setKeyframeInterpolation(clip, [{ propertyId: 'rotation', time: 0 }], 'ease-out');
			clip = setKeyframeInterpolation(clip, [{ propertyId: 'rotation', time: 0 }], preset);
			const first = keyframesOf(propertyCurve(clip, 'rotation')!)[0]!;
			expect(first.interpolation).toBe(preset);
			expect(first.easeOut).toBeUndefined();
			expect(readProperty(clip, 'rotation', 500_000)).toBeCloseTo(
				100 * CLOSED_FORM[preset](0.5),
				6
			);
		}
	});

	it('copies and pastes keyframes with relative times and retargeting', () => {
		let clip = makeClip();
		clip = enableAnimation(clip, 'opacity', 200_000, fps);
		clip = setPropertyAtTime(clip, 'opacity', 600_000, 0.4, { autoKey: true, fps });

		const clipboard: KeyframeClipboard = copyKeyframes(clip, [
			{ propertyId: 'opacity', time: 200_000 },
			{ propertyId: 'opacity', time: 600_000 }
		]);

		expect(clipboard.entries.length).toBe(2);
		expect(clipboard.entries[0]?.relativeTime).toBe(0);
		expect(clipboard.entries[1]?.relativeTime).toBe(400_000);

		// Paste onto another clip at 1_000_000
		const targetClip = makeClip();
		const { clip: pastedClip, pasted } = pasteKeyframes(targetClip, clipboard, 1_000_000);
		expect(pasted.length).toBe(2);
		expect(hasKeyframeAt(pastedClip, 'opacity', 1_000_000)).toBe(true);
		expect(hasKeyframeAt(pastedClip, 'opacity', 1_400_000)).toBe(true);
	});

	it('keeps the end anchor of out-animation keyframes through copy and paste', () => {
		let clip = makeClip();
		clip = enableAnimation(clip, 'opacity', 4_500_000, fps);
		clip = setPropertyAtTime(clip, 'opacity', 5_000_000, 0, { autoKey: true, fps });
		const curve = propertyCurve(clip, 'opacity')!;
		clip = {
			...clip,
			properties: {
				...clip.properties,
				opacity: {
					...curve,
					keyframes: keyframesOf(curve).map((key) => ({ ...key, anchor: 'end' as const }))
				}
			}
		};

		const clipboard: KeyframeClipboard = copyKeyframes(clip, [
			{ propertyId: 'opacity', time: 4_500_000 },
			{ propertyId: 'opacity', time: 5_000_000 }
		]);
		expect(clipboard.entries.map((entry) => entry.anchor)).toEqual(['end', 'end']);

		const { clip: pasted } = pasteKeyframes(makeClip(), clipboard, 500_000);
		expect(keyframesOf(propertyCurve(pasted, 'opacity')!).map((key) => key.anchor)).toEqual([
			'end',
			'end'
		]);
	});

	it('migrates legacy transform on first edit into constant properties', () => {
		const legacyClip: Clip = {
			...makeClip(),
			transform: { x: 50, y: -30, scaleX: 1.5, scaleY: 1.5, rotation: 45, opacity: 0.8 }
		};

		const edited = setPropertyAtTime(legacyClip, 'position', 0, [80, -30], { autoKey: false, fps });
		expect(edited.transform).toBeUndefined();
		expect(readProperty(edited, 'position', 0)).toEqual([80, -30]);
		expect(readProperty(edited, 'scale', 0)).toEqual([1.5, 1.5]);
		expect(readProperty(edited, 'rotation', 0)).toBe(45);
		expect(readProperty(edited, 'opacity', 0)).toBe(0.8);
	});

	it('preserves strictly-increasing-times invariant across 500 randomized operations', () => {
		let clip = makeClip(10_000_000);
		const propIds: PropertyId[] = ['position', 'scale', 'rotation', 'opacity', 'crop'];

		// Initialize animations
		for (const id of propIds) {
			clip = enableAnimation(clip, id, 0, fps);
		}

		for (let step = 0; step < 500; step += 1) {
			const propId = propIds[step % propIds.length]!;
			const randTime = Math.floor(Math.random() * 9_000_000);
			const op = step % 5;

			switch (op) {
				case 0: {
					// Add or set keyframe
					const val =
						propId === 'position' || propId === 'scale'
							? [Math.random() * 10, Math.random() * 10]
							: propId === 'crop'
								? [0.1, 0.1, 0.1, 0.1]
								: Math.random();
					clip = setPropertyAtTime(clip, propId, randTime, val, { autoKey: true, fps });
					break;
				}
				case 1: {
					// Toggle keyframe
					clip = toggleKeyframe(clip, propId, randTime, fps);
					break;
				}
				case 2: {
					// Move keyframe if any exist
					const curve = propertyCurve(clip, propId);
					if (curve && isAnimated(curve) && curve.keyframes.length > 0) {
						const key = curve.keyframes[Math.floor(Math.random() * curve.keyframes.length)]!;
						clip = moveKeyframes(
							clip,
							[{ propertyId: propId, time: key.time }],
							Math.floor((Math.random() - 0.5) * 1_000_000)
						).clip;
					}
					break;
				}
				case 3: {
					// Change interpolation preset
					const curve = propertyCurve(clip, propId);
					if (curve && isAnimated(curve) && curve.keyframes.length > 0) {
						const key = curve.keyframes[0]!;
						clip = setKeyframeInterpolation(
							clip,
							[{ propertyId: propId, time: key.time }],
							'ease-in-out'
						);
					}
					break;
				}
				case 4: {
					// Delete random keyframe
					const curve = propertyCurve(clip, propId);
					if (curve && isAnimated(curve) && curve.keyframes.length > 1) {
						const key = curve.keyframes[Math.floor(Math.random() * curve.keyframes.length)]!;
						clip = deleteKeyframes(clip, [{ propertyId: propId, time: key.time }]);
					}
					break;
				}
			}

			// Validate strictly increasing times on all animated properties
			for (const id of propIds) {
				const curve = propertyCurve(clip, id);
				if (curve && isAnimated(curve)) {
					for (let i = 1; i < curve.keyframes.length; i += 1) {
						expect(curve.keyframes[i]!.time).toBeGreaterThan(curve.keyframes[i - 1]!.time);
					}
				}
			}
		}
	});
});
