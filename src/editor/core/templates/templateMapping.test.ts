import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../factory';
import { resolveFrame, type ActiveLayer } from '../playback';
import type { Clip, ClipId, Project, SequenceId, Sequence } from '../types';
import type { PublishedTemplateParam } from './templateTypes';
import { BUILTIN_MOTION_TEMPLATES, getBuiltinMotionTemplate } from './builtinTemplates';
import {
	applyParamOverridesToSequence,
	instantiateTemplateIntoProject,
	offsetClipPosition,
	unpackTemplateInstanceClip
} from './templateService';
import type { MotionGraphicTemplate } from './templateTypes';

const SETTLED = 1_500_000;

function instantiate(template: MotionGraphicTemplate): {
	project: Project;
	sequence: Sequence;
	params: PublishedTemplateParam[];
} {
	const { project } = instantiateTemplateIntoProject(
		createEmptyProject({ name: 'Mapping' }),
		'root' as SequenceId,
		template,
		0
	);
	const sequence = Object.values(project.sequences ?? {})[0]!;
	const instance = project.tracks.flatMap((track) => track.clips)[0]!;
	// The instance's params point at its own clip ids, not the template's.
	const params =
		instance.source?.type === 'sequence' ? (instance.source.publishedParams ?? []) : [];
	return { project, sequence, params };
}

/** The nested layers of the one template instance in `project` at `time`. */
function nestedLayers(project: Project, time = SETTLED): ActiveLayer[] {
	const [layer] = resolveFrame(project, time).videoLayers;
	return layer!.nested!.layers;
}

/** A project whose instance carries `overrides` for the template's published params. */
function withOverrides(
	template: MotionGraphicTemplate,
	overrides: Record<string, unknown>
): Project {
	const { project } = instantiate(template);
	return {
		...project,
		tracks: project.tracks.map((track) => ({
			...track,
			clips: track.clips.map((clip) =>
				clip.source?.type === 'sequence'
					? { ...clip, source: { ...clip.source, paramOverrides: overrides } }
					: clip
			)
		}))
	};
}

function paramId(template: MotionGraphicTemplate, property: string): string {
	return template.publishedParams.find((param) => param.targetProperty === property)!.id;
}

describe('template data mapping', () => {
	describe('crop', () => {
		it('is authored as fractions that the renderer can use as they are', () => {
			for (const template of BUILTIN_MOTION_TEMPLATES) {
				for (const track of template.tracks) {
					for (const clip of track.clips) {
						const crop = clip.properties?.crop as
							{ keyframes?: Array<{ value: number[] }>; value?: number[] } | undefined;
						const values = crop?.keyframes?.map((keyframe) => keyframe.value) ?? [crop?.value];
						for (const value of values) {
							if (!value) continue;
							for (const inset of value) {
								expect(inset, `${template.id} crop`).toBeGreaterThanOrEqual(0);
								expect(inset, `${template.id} crop`).toBeLessThanOrEqual(1);
							}
						}
					}
				}
			}
		});

		it('reaches the renderer as the authored fraction', () => {
			const template = getBuiltinMotionTemplate('mixkit-minimal-wipe-lower-third')!;
			const { project } = instantiate(template);
			const cropped = nestedLayers(project, 850_000).find((layer) => layer.crop);
			expect(cropped!.crop![2]).toBeCloseTo(0.55, 5);
		});
	});

	describe('param overrides', () => {
		const template = getBuiltinMotionTemplate('cinematic-blockbuster')!;

		it('resizes text through text.fontSize and leaves line height alone', () => {
			const sized: MotionGraphicTemplate = {
				...template,
				publishedParams: [
					...template.publishedParams,
					{
						id: 'param_size',
						name: 'Size',
						type: 'number',
						targetClipId: template.publishedParams[0]!.targetClipId,
						targetProperty: 'text.fontSize',
						defaultValue: 64
					}
				]
			};
			const before = nestedLayers(withOverrides(sized, {}), SETTLED).find(
				(layer) => layer.kind === 'text'
			)!;
			const after = nestedLayers(withOverrides(sized, { param_size: 90 }), SETTLED).find(
				(layer) => layer.kind === 'text'
			)!;
			expect(before.textData!.fontSize).toBe(64);
			expect(after.textData!.fontSize).toBe(90);
			expect(after.textData!.lineHeight).toBe(before.textData!.lineHeight);
		});

		it('recolours a keyframed text colour without flattening its animation', () => {
			const targetId = template.publishedParams[0]!.targetClipId;
			const animated: MotionGraphicTemplate = {
				...template,
				tracks: template.tracks.map((track) => ({
					...track,
					clips: track.clips.map((clip) =>
						clip.id === targetId
							? {
									...clip,
									properties: {
										...clip.properties,
										'text.fillColor': {
											keyframes: [
												{ time: 0, value: [1, 0, 0, 0], interpolation: 'linear' as const },
												{ time: 1_000_000, value: [1, 0, 0, 1], interpolation: 'linear' as const }
											]
										}
									}
								}
							: clip
					)
				}))
			};
			const { sequence, params } = instantiate(animated);
			const next = applyParamOverridesToSequence(sequence, params, {
				[paramId(animated, 'text.fill')]: { r: 0, g: 1, b: 0, a: 1 }
			});
			const clip = next.tracks
				.flatMap((track) => track.clips)
				.find(
					(item) =>
						item.id ===
						sequence.tracks.flatMap((t) => t.clips).find((c) => c.source?.type === 'text')!.id
				)!;
			const fill = clip.properties!['text.fillColor'] as {
				keyframes?: Array<{ value: number[] }>;
			};
			expect(fill.keyframes).toHaveLength(2);
			expect(fill.keyframes!.map((keyframe) => keyframe.value.slice(0, 3))).toEqual([
				[0, 1, 0],
				[0, 1, 0]
			]);
			// Each keyframe keeps its own alpha.
			expect(fill.keyframes!.map((keyframe) => keyframe.value[3])).toEqual([0, 1]);
		});

		it('only recolours the colour runs that used the template colour', () => {
			const textClip = template.tracks
				.flatMap((track) => track.clips)
				.find((clip) => clip.source?.type === 'text')!;
			const primary = { r: 1, g: 1, b: 1, a: 1 };
			const accent = { r: 0.2, g: 0.4, b: 0.9, a: 1 };
			const twoRuns: MotionGraphicTemplate = {
				...template,
				publishedParams: template.publishedParams.map((param) =>
					param.targetProperty === 'text.fill' ? { ...param, defaultValue: primary } : param
				),
				tracks: template.tracks.map((track) => ({
					...track,
					clips: track.clips.map((clip) =>
						clip.id === textClip.id && clip.source?.type === 'text'
							? {
									...clip,
									source: {
										...clip.source,
										colorRuns: [
											{ startIndex: 0, endIndex: 5, fillColor: primary },
											{ startIndex: 5, endIndex: 12, fillColor: accent }
										]
									}
								}
							: clip
					)
				}))
			};
			const { sequence, params } = instantiate(twoRuns);
			const next = applyParamOverridesToSequence(sequence, params, {
				[paramId(twoRuns, 'text.fill')]: { r: 0, g: 1, b: 0, a: 1 }
			});
			const text = next.tracks
				.flatMap((track) => track.clips)
				.find((clip) => clip.source?.type === 'text')!;
			const runs = (text.source as { colorRuns: Array<{ fillColor: unknown }> }).colorRuns;
			expect(runs).toHaveLength(2);
			expect(runs[0]!.fillColor).toEqual({ r: 0, g: 1, b: 0, a: 1 });
			expect(runs[1]!.fillColor).toEqual(accent);
		});

		it('applies shape.fill to the property the renderer reads', () => {
			const withShapeProperty: MotionGraphicTemplate = {
				...template,
				tracks: template.tracks.map((track) => ({
					...track,
					clips: track.clips.map((clip) =>
						clip.source?.type === 'shape'
							? {
									...clip,
									properties: { ...clip.properties, 'shape.fillColor': { value: [1, 0, 0, 1] } }
								}
							: clip
					)
				}))
			};
			const project = withOverrides(withShapeProperty, {
				[paramId(withShapeProperty, 'shape.fill')]: { r: 0, g: 0, b: 1, a: 1 }
			});
			const shape = nestedLayers(project).find((layer) => layer.kind === 'shape')!;
			expect(shape.shapeData!.fillColor).toMatchObject({ r: 0, g: 0, b: 1 });
		});
	});

	describe('layer order', () => {
		it('stacks the text above its background shape (the first track is the top layer)', () => {
			for (const template of BUILTIN_MOTION_TEMPLATES) {
				if (template.id.startsWith('mixkit')) continue;
				const indexOf = (type: string) =>
					template.tracks.findIndex((track) =>
						track.clips.some((clip) => clip.source?.type === type)
					);
				if (indexOf('shape') < 0) continue;
				expect(indexOf('text'), template.id).toBeLessThan(indexOf('shape'));
			}
		});
	});

	describe('frame decorations', () => {
		it('does not draw a frame on the text when a shape layer already provides it', () => {
			for (const template of BUILTIN_MOTION_TEMPLATES) {
				const clips = template.tracks.flatMap((track) => track.clips);
				if (!clips.some((clip) => clip.source?.type === 'shape')) continue;
				if (template.id.startsWith('mixkit')) continue;
				for (const clip of clips) {
					if (clip.source?.type !== 'text') continue;
					expect(clip.source.box?.frameStyle ?? 'none', template.id).toBe('none');
					expect(clip.properties?.['text.backgroundBoxColor'], template.id).toBeUndefined();
				}
			}
		});
	});

	describe('moving a template between coordinate spaces', () => {
		const clip = (properties: Clip['properties'], transform?: Clip['transform']): Clip => ({
			id: 'c' as ClipId,
			start: 0,
			duration: 1_000_000,
			sourceIn: 0,
			sourceOut: 1_000_000,
			speed: 1,
			volume: 1,
			transform,
			properties,
			source: { type: 'text', text: 'x' }
		});

		it('keeps sub-pixel positions instead of rounding them', () => {
			const moved = offsetClipPosition(clip({ position: { value: [10.25, 20.5] } }), 5, 5);
			expect((moved.properties!.position as { value: number[] }).value).toEqual([5.25, 15.5]);
			const keyed = offsetClipPosition(
				clip({
					position: {
						keyframes: [{ time: 0, value: [0.4, 0.4], interpolation: 'linear' as const }]
					}
				}),
				0,
				0
			);
			expect(
				(keyed.properties!.position as { keyframes: Array<{ value: number[] }> }).keyframes[0]!
					.value
			).toEqual([0.4, 0.4]);
		});

		it('shifts the transform by the same offset rather than snapping it to the first keyframe', () => {
			const transform = { x: 7, y: 9, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
			const moved = offsetClipPosition(
				clip({ position: { value: [100, 100] } }, transform),
				30,
				40
			);
			expect(moved.transform).toMatchObject({ x: -23, y: -31 });
		});
	});

	describe('unpacking a template instance', () => {
		const layered = BUILTIN_MOTION_TEMPLATES.filter(
			(template) => template.tracks.flatMap((track) => track.clips).length > 1
		);

		it('has multi-layer templates to check', () => {
			expect(layered.length).toBeGreaterThan(0);
		});

		for (const template of layered) {
			it(`${template.id}: keeps every layer and never overlaps clips on a track`, () => {
				const { project } = instantiate(template);
				const instance = project.tracks.flatMap((track) => track.clips)[0]!;
				const layers = template.tracks.flatMap((track) => track.clips).length;

				const unpacked = unpackTemplateInstanceClip(project, 'root' as SequenceId, instance.id);

				expect(unpacked.tracks.flatMap((track) => track.clips)).toHaveLength(layers);
				for (const track of unpacked.tracks) {
					const sorted = [...track.clips].sort((a, b) => a.start - b.start);
					for (let index = 1; index < sorted.length; index += 1) {
						const previous = sorted[index - 1]!;
						expect(sorted[index]!.start).toBeGreaterThanOrEqual(previous.start + previous.duration);
					}
				}
			});
		}
	});
});
