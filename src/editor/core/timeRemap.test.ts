import { describe, expect, it } from 'vitest';
import { timelineToSource, sourceToTimeline } from './timeRemap';
import type { AssetId, Clip, ClipId, Project, ProjectId, TrackId } from './types';

type C = Pick<Clip, 'start' | 'sourceIn' | 'speed' | 'timeRemap'>;
const base: C = { start: 1_000_000, sourceIn: 2_000_000, speed: 1 };
const keys = (
	...frames: Array<[number, number, 'linear' | 'hold' | 'bezier']>
): Clip['timeRemap'] => ({
	keyframes: frames.map(([time, value, interpolation]) => ({ time, value, interpolation }))
});

describe('timelineToSource', () => {
	it('is bit-identical to Phase 1 without timeRemap', () => {
		for (const speed of [0.25, 0.5, 1, 1.5, 2, 3.3333]) {
			for (const time of [1_000_000, 1_333_333, 2_999_999, 5_000_000]) {
				const clip = { ...base, speed };
				expect(timelineToSource(clip, time)).toBe(
					Math.round(clip.sourceIn + (time - clip.start) * clip.speed)
				);
			}
		}
	});

	it('handles constant, reverse and freeze', () => {
		expect(timelineToSource({ ...base, timeRemap: { value: 2 } }, 2_000_000)).toBe(4_000_000);
		expect(timelineToSource({ ...base, timeRemap: { value: -1 } }, 1_500_000)).toBe(1_500_000);
		expect(timelineToSource({ ...base, timeRemap: { value: 0 } }, 9_000_000)).toBe(2_000_000);
	});

	it('clamps negative results to zero', () => {
		expect(timelineToSource({ ...base, timeRemap: { value: -10 } }, 9_000_000)).toBe(0);
	});

	it('integrates a linear ramp exactly (trapezoid)', () => {
		const clip = { ...base, timeRemap: keys([0, 1, 'linear'], [1_000_000, 3, 'linear']) };
		expect(timelineToSource(clip, 2_000_000)).toBe(2_000_000 + 2_000_000);
		expect(timelineToSource(clip, 3_000_000)).toBe(2_000_000 + 2_000_000 + 3_000_000);
	});

	it('integrates piecewise and hold segments', () => {
		const clip = { ...base, timeRemap: keys([0, 2, 'hold'], [1_000_000, 0, 'hold']) };
		expect(timelineToSource(clip, 2_000_000)).toBe(2_000_000 + 2_000_000);
		expect(timelineToSource(clip, 4_000_000)).toBe(2_000_000 + 2_000_000);
	});

	it('integrates a symmetric bezier ramp accurately', () => {
		const clip = { ...base, timeRemap: keys([0, 0, 'bezier'], [1_000_000, 2, 'linear']) };
		expect(timelineToSource(clip, 2_000_000)).toBeCloseTo(2_000_000 + 1_000_000, -2);
	});

	it('is monotonic for non-negative speeds', () => {
		const clip = {
			...base,
			timeRemap: keys([0, 0.5, 'bezier'], [500_000, 3, 'bezier'], [1_000_000, 0, 'linear'])
		};
		let previous = -1;
		for (let time = 1_000_000; time <= 3_000_000; time += 50_000) {
			const value = timelineToSource(clip, time);
			expect(value).toBeGreaterThanOrEqual(previous);
			previous = value;
		}
	});
});

describe('sourceToTimeline', () => {
	it('round-trips', () => {
		const clip = { ...base, timeRemap: keys([0, 1, 'linear'], [1_000_000, 3, 'linear']) };
		for (const time of [1_000_000, 1_700_000, 2_400_000]) {
			const source = timelineToSource(clip, time);
			expect(Math.abs(sourceToTimeline(clip, source, 3_000_000) - time)).toBeLessThanOrEqual(1);
		}
		expect(sourceToTimeline(base, 3_000_000, 0)).toBe(2_000_000);
	});
});

describe('Gate M operations and helpers', () => {
	const dummyClip: Clip = {
		id: 'c1' as ClipId,
		assetId: 'a1' as AssetId,
		start: 1_000_000,
		duration: 2_000_000,
		sourceIn: 1_000_000,
		sourceOut: 3_000_000,
		speed: 1,
		volume: 1
	};

	it('computes sourceExtent accurately for constant, reversed, and curve clips', async () => {
		const { sourceExtent } = await import('./timeRemap');
		expect(sourceExtent(dummyClip)).toEqual({ min: 1_000_000, max: 3_000_000 });

		const reversed: Clip = {
			...dummyClip,
			speed: -1,
			sourceIn: 3_000_000,
			sourceOut: 1_000_000
		};
		expect(sourceExtent(reversed)).toEqual({ min: 1_000_000, max: 3_000_000 });

		const remapClip: Clip = {
			...dummyClip,
			timeRemap: {
				keyframes: [
					{ time: 0, value: 2, interpolation: 'linear' },
					{ time: 2_000_000, value: 0, interpolation: 'linear' }
				]
			}
		};
		const extent = sourceExtent(remapClip);
		expect(extent.min).toBe(1_000_000);
		// Trapezoid from 2 to 0 over 2s has average speed 1 => 2s total advancement => 3_000_000 max
		expect(extent.max).toBe(3_000_000);
	});

	it('evaluates speedAt correctly across keyframes', async () => {
		const { speedAt } = await import('./timeRemap');
		expect(speedAt(dummyClip, 1_500_000)).toBe(1);

		const remapClip: Clip = {
			...dummyClip,
			timeRemap: {
				keyframes: [
					{ time: 0, value: 1, interpolation: 'linear' },
					{ time: 2_000_000, value: 3, interpolation: 'linear' }
				]
			}
		};
		// At midway local time 1_000_000 (timeline 2_000_000), speed is 2
		expect(speedAt(remapClip, 2_000_000)).toBe(2);
	});

	it('re-bases timeRemap on head trim (retimeForHeadTrim)', async () => {
		const { retimeForHeadTrim, timelineToSource } = await import('./timeRemap');
		const remapClip: Clip = {
			...dummyClip,
			timeRemap: {
				keyframes: [
					{ time: 0, value: 1, interpolation: 'linear' },
					{ time: 2_000_000, value: 3, interpolation: 'linear' }
				]
			}
		};

		// Source time at timeline 1_500_000 (local 500_000)
		const expectedSourceAtCut = timelineToSource(remapClip, 1_500_000);

		// Trim 500_000 off head -> new duration 1_500_000
		const trimmed = retimeForHeadTrim(remapClip, 500_000, 1_500_000);
		expect(trimmed.sourceIn).toBe(expectedSourceAtCut);
		expect(
			trimmed.timeRemap && 'keyframes' in trimmed.timeRemap
				? trimmed.timeRemap.keyframes[0]?.time
				: undefined
		).toBe(0);
	});

	it('inverts clip direction cleanly with reverseClip', async () => {
		const { reverseClip } = await import('./timeRemap');
		const rev = reverseClip(dummyClip);
		expect(rev.speed).toBe(-1);
		expect(rev.sourceIn).toBe(3_000_000);
		expect(rev.sourceOut).toBe(1_000_000);

		// Double reverse returns back
		const revBack = reverseClip(rev);
		expect(revBack.speed).toBe(1);
		expect(revBack.sourceIn).toBe(1_000_000);
		expect(revBack.sourceOut).toBe(3_000_000);
	});

	it('splits clip and creates hold segment with addFreezeFrame', async () => {
		const { addFreezeFrame } = await import('./timeRemap');
		const project: Project = {
			id: 'p1' as ProjectId,
			schemaVersion: 2,
			name: 'Test Project',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			settings: { fps: 30, width: 1920, height: 1080, sampleRate: 48000 },
			assets: {},
			markers: [],
			tracks: [
				{
					id: 't1' as TrackId,
					name: 'Video 1',
					kind: 'video',
					muted: false,
					locked: false,
					hidden: false,
					clips: [dummyClip]
				}
			]
		};

		const updated = addFreezeFrame(project, dummyClip.id, 2_000_000, 2_000_000, { ripple: true });
		const clips = updated.tracks[0]!.clips;
		expect(clips.length).toBe(3); // head, freeze, tail
		const freezeClip = clips[1]!;
		expect(freezeClip.duration).toBe(2_000_000);
		expect(freezeClip.timeRemap).toEqual({ value: 0 });
	});

	it('reverses animated properties, effects, masks, and fades on any clip type and round-trips', async () => {
		const { reverseClip } = await import('./timeRemap');
		const { evaluate } = await import('./animation');
		const textClip: Clip = {
			id: 'txt-1' as ClipId,
			start: 0,
			duration: 4_000_000,
			sourceIn: 0,
			sourceOut: 4_000_000,
			speed: 1,
			volume: 1,
			fadeInUs: 500_000,
			fadeOutUs: 250_000,
			source: { type: 'text', text: 'Reverse Me' },
			properties: {
				'text.reveal': {
					keyframes: [
						{ time: 0, value: 0, interpolation: 'bezier', easeOut: { x: 0.42, y: 0 } },
						{ time: 2_000_000, value: 1, interpolation: 'linear', easeIn: { x: 0.58, y: 1 } }
					]
				}
			},
			effects: [
				{
					id: 'fx-1',
					type: 'blur',
					params: {
						radius: {
							keyframes: [
								{ time: 0, value: 0, interpolation: 'linear' },
								{ time: 4_000_000, value: 12, interpolation: 'linear' }
							]
						}
					}
				}
			]
		};

		const rev = reverseClip(textClip);
		expect(rev.speed).toBe(-1);
		expect(rev.sourceIn).toBe(4_000_000);
		expect(rev.sourceOut).toBe(0);
		expect(rev.fadeInUs).toBe(250_000);
		expect(rev.fadeOutUs).toBe(500_000);

		const origReveal = textClip.properties![
			'text.reveal'
		] as import('./types').AnimatedValue<number>;
		const revReveal = rev.properties!['text.reveal'] as import('./types').AnimatedValue<number>;
		expect(evaluate(revReveal, 4_000_000)).toBeCloseTo(evaluate(origReveal, 0), 4);
		expect(evaluate(revReveal, 3_000_000)).toBeCloseTo(evaluate(origReveal, 1_000_000), 3);
		expect(evaluate(revReveal, 2_000_000)).toBeCloseTo(evaluate(origReveal, 2_000_000), 4);

		const revBlur = rev.effects![0]!.params.radius as import('./types').AnimatedValue<number>;
		expect(evaluate(revBlur, 0)).toBeCloseTo(12, 5);
		expect(evaluate(revBlur, 4_000_000)).toBeCloseTo(0, 5);

		const revBack = reverseClip(rev);
		expect(revBack.speed).toBe(1);
		expect(revBack.fadeInUs).toBe(500_000);
		expect(revBack.fadeOutUs).toBe(250_000);
		expect(
			evaluate(
				revBack.properties!['text.reveal'] as import('./types').AnimatedValue<number>,
				1_000_000
			)
		).toBeCloseTo(evaluate(origReveal, 1_000_000), 4);
	});

	it('supports negative speed multipliers in setConstantSpeed for reverse dialog', async () => {
		const { setConstantSpeed } = await import('./timeRemap');
		const project: Project = {
			id: 'p1' as ProjectId,
			schemaVersion: 2,
			name: 'Speed Neg Test',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			settings: { fps: 30, width: 1920, height: 1080, sampleRate: 48000 },
			assets: {},
			markers: [],
			tracks: [
				{
					id: 't1' as TrackId,
					name: 'Video 1',
					kind: 'video',
					muted: false,
					locked: false,
					hidden: false,
					clips: [{ ...dummyClip, sourceIn: 0, sourceOut: 4_000_000, duration: 4_000_000 }]
				}
			]
		};

		const updated = setConstantSpeed(project, [dummyClip.id], -2);
		const clip = updated.tracks[0]!.clips[0]!;
		expect(clip.speed).toBe(-2);
		expect(clip.duration).toBe(2_000_000);
		expect(clip.sourceIn).toBe(4_000_000);
		expect(clip.sourceOut).toBe(0);
	});

	it('renders the start frame of a reversed nested sequence clip instead of empty', async () => {
		const { resolveFrame } = await import('./playback');
		const { reverseClip } = await import('./timeRemap');
		const { createSequence } = await import('./sequences/operations');
		const { createSolidClip } = await import('./adjustment');
		const baseProj: Project = {
			id: 'p-seq' as ProjectId,
			schemaVersion: 2,
			name: 'Seq Reverse',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			settings: { fps: 30, width: 1920, height: 1080, sampleRate: 48000 },
			assets: {},
			markers: [],
			tracks: [
				{
					id: 't1' as TrackId,
					name: 'Video 1',
					kind: 'video',
					muted: false,
					locked: false,
					hidden: false,
					clips: []
				}
			]
		};
		const { project: withSeq, sequenceId } = createSequence(baseProj, 'Nested');
		withSeq.sequences![sequenceId]!.tracks[0]!.clips.push(
			createSolidClip(0, 3_000_000, { r: 1, g: 0, b: 0, a: 1 })
		);
		const seqClip = reverseClip({
			id: 'seq-clip' as ClipId,
			start: 0,
			duration: 3_000_000,
			sourceIn: 0,
			sourceOut: 3_000_000,
			speed: 1,
			volume: 1,
			source: { type: 'sequence', sequenceId }
		});
		withSeq.tracks[0]!.clips.push(seqClip);

		const atStart = resolveFrame(withSeq, 0);
		expect(atStart.videoLayers[0]?.nested?.layers.length).toBe(1);
	});

	it('trims head and tail cleanly on a reversed media clip within asset bounds', async () => {
		const { trimClip } = await import('./operations');
		const project: Project = {
			id: 'p-trim' as ProjectId,
			schemaVersion: 2,
			name: 'Trim Reverse',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			settings: { fps: 30, width: 1920, height: 1080, sampleRate: 48000 },
			assets: {
				['a1' as AssetId]: {
					id: 'a1' as AssetId,
					kind: 'video',
					name: 'v.mp4',
					mimeType: 'video/mp4',
					size: 100,
					duration: 6_000_000,
					hasAudio: false,
					opfsPath: 'v.mp4'
				}
			},
			markers: [],
			tracks: [
				{
					id: 't1' as TrackId,
					name: 'Video 1',
					kind: 'video',
					muted: false,
					locked: false,
					hidden: false,
					clips: [
						{
							id: 'rev-v' as ClipId,
							assetId: 'a1' as AssetId,
							start: 2_000_000,
							duration: 4_000_000,
							sourceIn: 5_000_000,
							sourceOut: 1_000_000,
							speed: -1,
							volume: 1
						}
					]
				}
			]
		};

		const afterHead = trimClip(project, 'rev-v' as ClipId, 'start', 1_500_000);
		const cHead = afterHead.tracks[0]!.clips[0]!;
		expect(cHead.start).toBe(1_500_000);
		expect(cHead.duration).toBe(4_500_000);
		expect(cHead.sourceIn).toBe(5_500_000);
		expect(cHead.sourceOut).toBe(1_000_000);

		const afterTail = trimClip(project, 'rev-v' as ClipId, 'end', 6_500_000);
		const cTail = afterTail.tracks[0]!.clips[0]!;
		expect(cTail.duration).toBe(4_500_000);
		expect(cTail.sourceIn).toBe(5_000_000);
		expect(cTail.sourceOut).toBe(500_000);
	});
});
