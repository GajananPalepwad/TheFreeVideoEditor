import { describe, expect, it } from 'vitest';
import { evaluate } from './animation';
import { duplicateProject, createEmptyProject } from './factory';
import { projectSchema } from './schema';
import { addClipFromAsset, duplicateClips, splitClipsAt, trimClip } from './operations';
import type { AnimatedValue, AssetId, ClipId, Project, SequenceId } from './types';

function animatedProject(): Project {
	const base = createEmptyProject({ name: 'anim' });
	const assetId = 'anim-asset' as AssetId;
	const project: Project = {
		...base,
		assets: {
			[assetId]: {
				id: assetId,
				kind: 'video',
				name: 'a.mp4',
				mimeType: 'video/mp4',
				size: 1,
				duration: 10_000_000,
				hasAudio: false,
				opfsPath: 'x'
			}
		}
	};
	const track = project.tracks.find((item) => item.kind === 'video')!;
	const added = addClipFromAsset(project, { assetId, trackId: track.id, start: 1_000_000 });
	const clip = added.tracks.find((item) => item.id === track.id)!.clips[0]!;
	clip.properties = {
		opacity: {
			keyframes: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 4_000_000, value: 100, interpolation: 'linear' }
			]
		}
	};
	clip.masks = [
		{
			id: 'mask-1',
			type: 'rect',
			mode: 'add',
			inverted: false,
			feather: 0,
			expansion: 0,
			opacity: 1
		}
	];
	clip.effects = [{ id: 'fx-1', type: 'blur', params: { radius: 3 } }];
	return added;
}

const firstClip = (project: Project) => project.tracks.find((t) => t.kind === 'video')!.clips;
const opacity = (clip: { properties?: Record<string, AnimatedValue<unknown>> }, time: number) =>
	evaluate(clip.properties!.opacity as AnimatedValue<number>, time);

describe('animation across edit operations', () => {
	it('split keeps the curve continuous and gives new ids to the right half', () => {
		const project = animatedProject();
		const original = firstClip(project)[0]!;
		const { project: after } = splitClipsAt(project, 2_000_000, [original.id]);
		const [left, right] = firstClip(after);
		expect(opacity(left!, 500_000)).toBeCloseTo(opacity(original, 500_000), 6);
		expect(opacity(right!, 0)).toBeCloseTo(25, 6);
		expect(opacity(right!, 2_000_000)).toBeCloseTo(opacity(original, 3_000_000), 6);
		expect(right!.masks![0]!.id).not.toBe(left!.masks![0]!.id);
		expect(right!.effects![0]!.id).not.toBe(left!.effects![0]!.id);
		expect(projectSchema.safeParse(after).success).toBe(true);
	});

	it('split carries a time remap and derives the right source-in from the curve', () => {
		const project = animatedProject();
		const clip = firstClip(project)[0]!;
		clip.timeRemap = { value: 2 };
		const { project: after } = splitClipsAt(project, 2_000_000, [clip.id]);
		const [left, right] = firstClip(after);
		expect(left!.sourceOut).toBe(2_000_000);
		expect(right!.sourceIn).toBe(2_000_000);
		expect(right!.timeRemap).toEqual({ value: 2 });
	});

	it('head trim re-bases keyframes so values stay put on the timeline', () => {
		const project = animatedProject();
		const clip = firstClip(project)[0]!;
		const trimmed = firstClip(trimClip(project, clip.id, 'start', 2_000_000))[0]!;
		expect(trimmed.start).toBe(2_000_000);
		expect(opacity(trimmed, 0)).toBeCloseTo(opacity(clip, 1_000_000), 6);
		expect(opacity(trimmed, 1_000_000)).toBeCloseTo(opacity(clip, 2_000_000), 6);
	});

	it('tail trim leaves keyframes alone', () => {
		const project = animatedProject();
		const clip = firstClip(project)[0]!;
		const trimmed = firstClip(trimClip(project, clip.id, 'end', 3_000_000))[0]!;
		expect(trimmed.properties).toEqual(clip.properties);
	});

	it('tail trim moves an end-anchored fade-out with the new end', () => {
		const project = animatedProject();
		const clip = firstClip(project)[0]!;
		const end = clip.duration;
		clip.properties = {
			opacity: {
				keyframes: [
					{ time: 0, value: 1, interpolation: 'linear' },
					{ time: end - 500_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: end, value: 0, interpolation: 'linear', anchor: 'end' }
				]
			}
		};
		const trimmed = firstClip(trimClip(project, clip.id, 'end', 3_000_000))[0]!;
		expect(trimmed.duration).toBe(2_000_000);
		expect(opacity(trimmed, 1_500_000)).toBe(1);
		expect(opacity(trimmed, 1_750_000)).toBeCloseTo(0.5, 6);
		expect(opacity(trimmed, 2_000_000)).toBe(0);
	});

	it('tail trim retimes anchored effect parameters too', () => {
		const project = animatedProject();
		const clip = firstClip(project)[0]!;
		const end = clip.duration;
		clip.effects = [
			{
				id: 'fx-1',
				type: 'blur',
				params: {
					radius: {
						keyframes: [
							{ time: end - 400_000, value: 0, interpolation: 'linear', anchor: 'end' },
							{ time: end, value: 8, interpolation: 'linear', anchor: 'end' }
						]
					}
				}
			}
		];
		const trimmed = firstClip(trimClip(project, clip.id, 'end', 3_000_000))[0]!;
		const radius = trimmed.effects![0]!.params.radius as AnimatedValue<number>;
		expect(evaluate(radius, 2_000_000)).toBe(8);
		expect(evaluate(radius, 1_600_000)).toBe(0);
	});

	it('duplicate gives masks and effects new ids but keeps the animation', () => {
		const project = animatedProject();
		const clip = firstClip(project)[0]!;
		const copy = firstClip(duplicateClips(project, [clip.id])).find((item) => item.id !== clip.id)!;
		expect(copy.properties).toEqual(clip.properties);
		expect(copy.masks![0]!.id).not.toBe('mask-1');
		expect(copy.effects![0]!.id).not.toBe('fx-1');
	});

	it('duplicateProject remaps clips, transitions, masks and sequences consistently', () => {
		const project = animatedProject();
		const track = project.tracks.find((item) => item.kind === 'video')!;
		const clip = track.clips[0]!;
		track.transitions = [
			{
				id: 'tr-1',
				type: 'fade',
				duration: 500_000,
				alignment: 'center',
				edge: { kind: 'head', clipId: clip.id },
				params: {}
			}
		];
		const sequenceId = 'seq-1' as SequenceId;
		project.sequences = {
			[sequenceId]: {
				id: sequenceId,
				name: 'Nested',
				tracks: [
					{ ...track, id: 'seq-track' as never, clips: [{ ...clip, id: 'seq-clip' as ClipId }] }
				]
			}
		};
		clip.source = { type: 'sequence', sequenceId };
		project.sequences[sequenceId]!.tracks[0]!.clips[0]!.masks = [];
		project.sequences[sequenceId]!.tracks[0]!.clips[0]!.effects = [];
		delete project.sequences[sequenceId]!.tracks[0]!.transitions;
		const copy = duplicateProject(project);
		expect(projectSchema.safeParse(copy).success).toBe(true);
		const copyClip = copy.tracks.find((item) => item.kind === 'video')!.clips[0]!;
		const transition = copy.tracks.find((item) => item.kind === 'video')!.transitions![0]!;
		expect(transition.id).not.toBe('tr-1');
		expect(transition.edge).toEqual({ kind: 'head', clipId: copyClip.id });
		expect(copyClip.source?.type === 'sequence' && copyClip.source.sequenceId).toBeTruthy();
		expect(copy.sequences![sequenceId]).toBeUndefined();
		expect(Object.keys(copy.sequences!)).toHaveLength(1);
	});
});
