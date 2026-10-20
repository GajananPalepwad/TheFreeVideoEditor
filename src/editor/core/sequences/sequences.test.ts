import { describe, expect, it } from 'vitest';
import {
	ROOT_SEQUENCE_ID,
	applyToSequence,
	findClipInSequence,
	getSequence,
	isRootSequence,
	viewProject
} from './access';
import {
	MAX_SEQUENCE_NESTING_DEPTH,
	SequenceCycleError,
	SequenceDepthError,
	addSequenceInstance,
	createSequence,
	deleteSequence,
	duplicateSequence,
	expandSequenceInstance,
	flattenForInterchange,
	getDepthFromRoot,
	getSequenceUsage,
	makeInstanceUnique,
	nestSelection,
	renameSequence,
	sequenceDuration,
	wouldCreateCycle
} from './operations';
import type { Asset, AssetId, Clip, ClipId, Project, SequenceId, Track } from '../types';
import { createEmptyProject } from '../factory';

const RED = { r: 1, g: 0, b: 0, a: 1 };

function makeSolidClip(id: string, start: number, duration: number): Clip {
	return {
		id: id as ClipId,
		start,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 1,
		source: { type: 'solid', color: RED }
	};
}

function makeEmptyProject(): Project {
	return createEmptyProject({ name: 'Test Project' });
}

describe('Sequence Access & View Projection', () => {
	it('identifies root sequence correctly', () => {
		expect(isRootSequence(ROOT_SEQUENCE_ID)).toBe(true);
		expect(isRootSequence(undefined)).toBe(true);
		expect(isRootSequence(null)).toBe(true);
		expect(isRootSequence('' as SequenceId)).toBe(true);
		expect(isRootSequence('seq-1' as SequenceId)).toBe(false);
	});

	it('views root project as itself', () => {
		const project = makeEmptyProject();
		const view = viewProject(project, ROOT_SEQUENCE_ID);
		expect(view.tracks).toBe(project.tracks);
		expect(view.settings).toBe(project.settings);
	});

	it('creates a sequence and projects its view', () => {
		let project = makeEmptyProject();
		const { project: p2, sequenceId } = createSequence(project, 'Scene 1');
		project = p2;

		const seq = getSequence(project, sequenceId);
		expect(seq).toBeDefined();
		expect(seq?.name).toBe('Scene 1');

		const view = viewProject(project, sequenceId);
		expect(view.tracks).toEqual(seq?.tracks);
		expect(view.settings).toEqual(project.settings); // inherited settings
	});

	it('applies operations to a nested sequence via viewProject & applyToSequence', () => {
		let project = makeEmptyProject();
		const { project: p2, sequenceId } = createSequence(project, 'Scene 1');
		project = p2;

		// Add a clip into the nested sequence using a standard Project operation
		const clip = makeSolidClip('clip-inside', 0, 5_000_000);

		const updatedProject = applyToSequence(project, sequenceId, (view) => {
			const targetTrack = view.tracks.find((t) => t.kind === 'video')!;
			return {
				...view,
				tracks: view.tracks.map((t) => (t.id === targetTrack.id ? { ...t, clips: [clip] } : t))
			};
		});

		const seqTracks = updatedProject.sequences?.[sequenceId]?.tracks;
		const vTrack = seqTracks?.find((t) => t.kind === 'video');
		expect(vTrack?.clips.length).toBe(1);
		expect(vTrack?.clips[0]!.id).toBe('clip-inside');
		// Root tracks remain untouched
		expect(updatedProject.tracks.find((t) => t.kind === 'video')?.clips.length).toBe(0);
	});

	it('finds a clip in the sequence it belongs to', () => {
		const { project: base, sequenceId } = createSequence(makeEmptyProject(), 'Scene 1');
		const inner = makeSolidClip('clip-inside', 0, 1_000_000);
		const project = applyToSequence(base, sequenceId, (view) => ({
			...view,
			tracks: view.tracks.map((t) => (t.kind === 'video' ? { ...t, clips: [inner] } : t))
		}));

		expect(findClipInSequence(project, sequenceId, inner.id)?.id).toBe(inner.id);
	});

	it('does not find a nested clip from the root, nor a root clip from a sequence', () => {
		const { project: base, sequenceId } = createSequence(makeEmptyProject(), 'Scene 1');
		const inner = makeSolidClip('clip-inside', 0, 1_000_000);
		const outer = makeSolidClip('clip-outside', 0, 1_000_000);
		const nested = applyToSequence(base, sequenceId, (view) => ({
			...view,
			tracks: view.tracks.map((t) => (t.kind === 'video' ? { ...t, clips: [inner] } : t))
		}));
		const project = {
			...nested,
			tracks: nested.tracks.map((t) => (t.kind === 'video' ? { ...t, clips: [outer] } : t))
		};

		expect(findClipInSequence(project, ROOT_SEQUENCE_ID, inner.id)).toBeNull();
		expect(findClipInSequence(project, sequenceId, outer.id)).toBeNull();
		expect(findClipInSequence(project, ROOT_SEQUENCE_ID, outer.id)?.id).toBe(outer.id);
	});
});

describe('Cycle Detection & Nesting Depth', () => {
	it('detects direct self-reference cycle', () => {
		let project = makeEmptyProject();
		const { project: p2, sequenceId } = createSequence(project, 'Seq A');
		project = p2;

		expect(wouldCreateCycle(project, sequenceId, sequenceId)).toBe(true);
	});

	it('detects indirect cycles A -> B -> A', () => {
		let project = makeEmptyProject();
		const { project: p1, sequenceId: seqA } = createSequence(project, 'Seq A');
		const { project: p2, sequenceId: seqB } = createSequence(p1, 'Seq B');
		project = p2;

		// Add instance of Seq B inside Seq A
		const { project: p3 } = addSequenceInstance(project, seqA, seqB, 0);
		project = p3;

		// Inserting Seq A into Seq B would create cycle
		expect(wouldCreateCycle(project, seqB, seqA)).toBe(true);

		// Throws when attempting addSequenceInstance
		expect(() => addSequenceInstance(project, seqB, seqA, 0)).toThrow(SequenceCycleError);
	});

	it('enforces maximum nesting depth of 8', () => {
		let project = makeEmptyProject();
		let currentSeq: SequenceId = ROOT_SEQUENCE_ID;

		// Chain sequences: root -> s1 -> s2 -> ... -> s8
		for (let i = 1; i <= MAX_SEQUENCE_NESTING_DEPTH; i++) {
			const { project: nextProj, sequenceId } = createSequence(project, `Seq ${i}`);
			project = nextProj;
			const { project: chainedProj } = addSequenceInstance(project, currentSeq, sequenceId, 0);
			project = chainedProj;
			currentSeq = sequenceId;
		}

		expect(getDepthFromRoot(project, currentSeq)).toBe(MAX_SEQUENCE_NESTING_DEPTH);

		// Attempting to nest an 9th level sequence should throw SequenceDepthError
		const { project: pExceed, sequenceId: sExceed } = createSequence(project, 'Exceed');
		expect(() => addSequenceInstance(pExceed, currentSeq, sExceed, 0)).toThrow(SequenceDepthError);
	});
});

describe('Sequence Duration & Sizing', () => {
	it('calculates duration based on maximum clip end', () => {
		let project = makeEmptyProject();
		const { project: p2, sequenceId } = createSequence(project, 'Duration Test');
		project = p2;

		expect(sequenceDuration(project, sequenceId)).toBe(0);

		const clip = makeSolidClip('clip-1', 1_000_000, 4_000_000);

		project = applyToSequence(project, sequenceId, (view) => ({
			...view,
			tracks: view.tracks.map((t) => (t.kind === 'video' ? { ...t, clips: [clip] } : t))
		}));

		expect(sequenceDuration(project, sequenceId)).toBe(5_000_000);
	});
});

describe('Sequence Operations (CRUD, Nest, Expand, Make Unique)', () => {
	it('renames a sequence', () => {
		const project = makeEmptyProject();
		const { project: p2, sequenceId } = createSequence(project, 'Original Name');
		const pRenamed = renameSequence(p2, sequenceId, 'New Name');
		expect(pRenamed.sequences?.[sequenceId]?.name).toBe('New Name');
	});

	it('prevents deleting sequence when used, allows deletion with force', () => {
		const project = makeEmptyProject();
		const { project: p2, sequenceId } = createSequence(project, 'To Delete');
		const { project: p3 } = addSequenceInstance(p2, ROOT_SEQUENCE_ID, sequenceId, 0);

		// Should have usage
		expect(getSequenceUsage(p3, sequenceId).length).toBeGreaterThan(0);

		// Deleting without force throws
		expect(() => deleteSequence(p3, sequenceId, false)).toThrow(/is used by/);

		// Deleting with force removes instances
		const pDeleted = deleteSequence(p3, sequenceId, true);
		expect(pDeleted.sequences?.[sequenceId]).toBeUndefined();
		expect(pDeleted.tracks.find((t) => t.kind === 'video')?.clips.length).toBe(0);
	});

	it('duplicates a sequence with deep copy of tracks and clips', () => {
		const project = makeEmptyProject();
		const { project: p2, sequenceId } = createSequence(project, 'Original');
		const clip = makeSolidClip('orig-clip', 0, 2_000_000);
		const pWithClip = applyToSequence(p2, sequenceId, (view) => ({
			...view,
			tracks: view.tracks.map((t) => (t.kind === 'video' ? { ...t, clips: [clip] } : t))
		}));

		const { project: pDup, newSequenceId } = duplicateSequence(pWithClip, sequenceId);
		expect(pDup.sequences?.[newSequenceId]?.name).toBe('Original Copy');
		const dupClips = pDup.sequences?.[newSequenceId]?.tracks.find((t) => t.kind === 'video')?.clips;
		expect(dupClips?.length).toBe(1);
		expect(dupClips?.[0]!.id).not.toBe('orig-clip'); // New IDs
	});

	it('nests a selection of clips and creates an instance on the timeline', () => {
		let project = makeEmptyProject();
		const clip1 = makeSolidClip('c1', 1_000_000, 2_000_000);
		const clip2 = makeSolidClip('c2', 3_000_000, 2_000_000);
		project = {
			...project,
			tracks: project.tracks.map((t) => (t.kind === 'video' ? { ...t, clips: [clip1, clip2] } : t))
		};

		const {
			project: pNested,
			newSequenceId,
			videoInstanceClipId
		} = nestSelection(project, ROOT_SEQUENCE_ID, ['c1' as ClipId, 'c2' as ClipId], 'Nested Scene');

		const seq = pNested.sequences?.[newSequenceId];
		expect(seq).toBeDefined();
		expect(seq?.name).toBe('Nested Scene');
		// Clips inside sequence should be normalized to start at 0
		const innerClips = seq?.tracks.find((t) => t.kind === 'video')?.clips;
		expect(innerClips?.length).toBe(2);
		expect(innerClips?.[0]!.start).toBe(0);
		expect(innerClips?.[1]!.start).toBe(2_000_000);

		// Host track now contains the sequence instance clip spanning 1_000_000 to 5_000_000
		const hostClips = pNested.tracks.find((t) => t.kind === 'video')?.clips;
		expect(hostClips?.length).toBe(1);
		expect(hostClips?.[0]!.id).toBe(videoInstanceClipId);
		expect(hostClips?.[0]!.start).toBe(1_000_000);
		expect(hostClips?.[0]!.duration).toBe(4_000_000);
		expect(hostClips?.[0]!.source).toEqual({ type: 'sequence', sequenceId: newSequenceId });

		// Test expandSequenceInstance (un-nest roundtrip)
		const pExpanded = expandSequenceInstance(pNested, ROOT_SEQUENCE_ID, videoInstanceClipId!);
		const unnestedClips = pExpanded.tracks.find((t) => t.kind === 'video')?.clips;
		expect(unnestedClips?.length).toBe(2);
		expect(unnestedClips?.[0]!.start).toBe(1_000_000);
		expect(unnestedClips?.[1]!.start).toBe(3_000_000);
		expect(unnestedClips?.[0]!.duration).toBe(2_000_000);
		expect(unnestedClips?.[1]!.duration).toBe(2_000_000);
	});

	describe('expandSequenceInstance with several layers', () => {
		/** A host timeline holding one instance of a sequence that has `layers` video tracks. */
		function hostWithLayers(layers: number) {
			const { project: base, sequenceId } = createSequence(makeEmptyProject(), 'Layers');
			const extraTracks: Track[] = Array.from({ length: layers - 1 }, (_, index) => ({
				id: `layer-${index + 2}` as Track['id'],
				kind: 'video',
				name: `Layer ${index + 2}`,
				muted: false,
				locked: false,
				hidden: false,
				clips: []
			}));
			const nested = applyToSequence(base, sequenceId, (view) => {
				const tracks = [...view.tracks];
				const firstVideo = tracks.findIndex((track) => track.kind === 'video');
				tracks.splice(firstVideo + 1, 0, ...extraTracks);
				let layer = 0;
				return {
					...view,
					tracks: tracks.map((track) =>
						track.kind === 'video'
							? { ...track, clips: [makeSolidClip(`layer-clip-${(layer += 1)}`, 0, 2_000_000)] }
							: track
					)
				};
			});
			const { project, videoClipId } = addSequenceInstance(
				nested,
				ROOT_SEQUENCE_ID,
				sequenceId,
				1_000_000
			);
			return { project, instanceId: videoClipId! };
		}

		const videoTracks = (project: Project) =>
			project.tracks.filter((track) => track.kind === 'video');

		it('keeps every layer on its own track', () => {
			const { project, instanceId } = hostWithLayers(2);

			const expanded = expandSequenceInstance(project, ROOT_SEQUENCE_ID, instanceId);

			const tracksWithClips = videoTracks(expanded).filter((track) => track.clips.length > 0);
			expect(tracksWithClips).toHaveLength(2);
			expect(tracksWithClips.flatMap((track) => track.clips)).toHaveLength(2);
		});

		it('keeps the layer order and the timing of each layer', () => {
			const { project, instanceId } = hostWithLayers(2);

			const expanded = expandSequenceInstance(project, ROOT_SEQUENCE_ID, instanceId);

			const tracksWithClips = videoTracks(expanded).filter((track) => track.clips.length > 0);
			const sourceTracks = videoTracks({
				...project,
				tracks: Object.values(project.sequences!)[0]!.tracks
			});
			// The first nested track is the top layer, so it stays on the first host track.
			expect(tracksWithClips[0]!.clips[0]!.start).toBe(1_000_000);
			expect(tracksWithClips[1]!.clips[0]!.start).toBe(1_000_000);
			expect(tracksWithClips[0]!.clips[0]!.duration).toBe(sourceTracks[0]!.clips[0]!.duration);
		});

		it('never overlaps clips on one track, even next to existing clips', () => {
			const { project, instanceId } = hostWithLayers(3);
			const occupied = makeSolidClip('already-there', 1_500_000, 1_000_000);
			const withNeighbour = {
				...project,
				tracks: [
					...project.tracks,
					{
						id: 'busy' as Track['id'],
						kind: 'video' as const,
						name: 'Busy',
						muted: false,
						locked: false,
						hidden: false,
						clips: [occupied]
					}
				]
			};

			const expanded = expandSequenceInstance(withNeighbour, ROOT_SEQUENCE_ID, instanceId);

			for (const track of expanded.tracks) {
				const sorted = [...track.clips].sort((a, b) => a.start - b.start);
				for (let index = 1; index < sorted.length; index += 1) {
					const previous = sorted[index - 1]!;
					expect(sorted[index]!.start).toBeGreaterThanOrEqual(previous.start + previous.duration);
				}
			}
			expect(videoTracks(expanded).flatMap((track) => track.clips)).toHaveLength(4);
		});
	});

	it('makes an instance unique', () => {
		const project = makeEmptyProject();
		const { project: p2, sequenceId } = createSequence(project, 'Shared Seq');
		const { project: p3, videoClipId } = addSequenceInstance(p2, ROOT_SEQUENCE_ID, sequenceId, 0);

		const { project: pUnique, newSequenceId } = makeInstanceUnique(p3, videoClipId!);
		expect(newSequenceId).not.toBe(sequenceId);
		expect(pUnique.sequences?.[newSequenceId]?.name).toBe('Shared Seq (Unique)');

		const instance = pUnique.tracks
			.find((t) => t.kind === 'video')
			?.clips.find((c) => c.id === videoClipId);
		expect(instance?.source).toEqual({ type: 'sequence', sequenceId: newSequenceId });
	});

	it('flattens nested sequences for interchange', () => {
		let project = makeEmptyProject();
		const clip1 = makeSolidClip('c1', 1_000_000, 2_000_000);
		project = {
			...project,
			tracks: project.tracks.map((t) => (t.kind === 'video' ? { ...t, clips: [clip1] } : t))
		};

		const { project: pNested } = nestSelection(
			project,
			ROOT_SEQUENCE_ID,
			['c1' as ClipId],
			'To Flatten'
		);

		const { project: pFlattened, omissions } = flattenForInterchange(pNested);
		expect(omissions.length).toBe(0);
		expect(pFlattened.sequences).toBeUndefined();
		const hostClips = pFlattened.tracks.find((t) => t.kind === 'video')?.clips ?? [];
		expect(hostClips.length).toBe(1);
		const firstHost = hostClips[0];
		expect(firstHost).toBeDefined();
		expect(firstHost?.source?.type).toBe('solid');
		expect(firstHost?.start).toBe(1_000_000);
	});

	it('preserves invariants over 500 random operations applied to a nested sequence via applyToSequence', async () => {
		const { addClipFromAsset, moveClips } = await import('../operations');
		const { clipEnd } = await import('../timeline');
		let project = makeEmptyProject();
		const assetId = 'asset-nested-test' as AssetId;
		project = {
			...project,
			assets: {
				[assetId]: {
					id: assetId,
					name: 'test.mp4',
					kind: 'video',
					duration: 10_000_000,
					width: 1920,
					height: 1080,
					fps: 30,
					hasAudio: true,
					size: 1000,
					mimeType: 'video/mp4',
					opfsPath: 'test.mp4'
				}
			}
		};

		const { project: pSeq, sequenceId } = createSequence(project, 'Stress Seq');
		project = pSeq;

		let seed = 98_765;
		const random = () => {
			seed = (seed * 16_807) % 2_147_483_647;
			return seed / 2_147_483_647;
		};

		const assertInvariant = (p: Project) => {
			const seqTracks = p.sequences?.[sequenceId]?.tracks ?? [];
			for (const track of seqTracks) {
				const clips = track.clips.toSorted((a, b) => a.start - b.start);
				for (let i = 0; i < clips.length; i++) {
					const clip = clips[i]!;
					expect(clip.sourceIn).toBeLessThan(clip.sourceOut!);
					const next = clips[i + 1];
					if (next) expect(clipEnd(clip)).toBeLessThanOrEqual(next.start);
				}
			}
		};

		for (let step = 0; step < 500; step++) {
			project = applyToSequence(project, sequenceId, (view) => {
				const vTrack = view.tracks.find((t) => t.kind === 'video')!;
				let updated = addClipFromAsset(view, {
					assetId,
					trackId: vTrack.id,
					start: Math.floor(random() * 30_000_000)
				});
				if (step % 3 === 0) {
					const currentClips = updated.tracks.find((t) => t.kind === 'video')!.clips;
					const c = currentClips[Math.floor(random() * currentClips.length)]!;
					try {
						updated = moveClips(updated, {
							clipIds: [c.id],
							deltaTime: Math.floor(random() * 4_000_000) - 2_000_000
						});
					} catch {
						// Expected if interval doesn't fit
					}
				}
				return updated;
			});
			assertInvariant(project);
		}
	});

	it('resolves distinct instanceKeys and sourceTimes for two overlapping clips of the same asset in one nested sequence', async () => {
		const { resolveFrame } = await import('../playback');
		const { insertClip } = await import('../operations/clips');
		let project = makeEmptyProject();
		const assetId = 'colors-asset' as AssetId;
		const asset: Asset = {
			id: assetId,
			name: 'colors.mp4',
			kind: 'video',
			duration: 10_000_000,
			fps: 25,
			width: 1920,
			height: 1080,
			mimeType: 'video/mp4',
			size: 39579,
			hasAudio: true,
			opfsPath: 'media/colors.mp4'
		};
		project = {
			...project,
			assets: {
				[assetId]: asset
			}
		};

		// Create nested sequence with 2 video tracks
		const { project: pWithSeq, sequenceId } = createSequence(project, 'Nested Color Seq');
		let pNested = pWithSeq;

		const clip1: Clip = {
			id: 'clip-nested-1' as ClipId,
			assetId,
			start: 0,
			duration: 4_000_000,
			sourceIn: 1_000_000,
			sourceOut: 5_000_000,
			speed: 1,
			volume: 1
		};
		const clip2: Clip = {
			id: 'clip-nested-2' as ClipId,
			assetId,
			start: 0,
			duration: 4_000_000,
			sourceIn: 3_000_000,
			sourceOut: 7_000_000,
			speed: 1,
			volume: 1
		};

		pNested = applyToSequence(pNested, sequenceId, (view) => {
			const track1 = view.tracks.find((t) => t.kind === 'video')!;
			const track2 = {
				id: 'vtrack-2' as Track['id'],
				kind: 'video' as const,
				name: 'Video 2',
				muted: false,
				locked: false,
				hidden: false,
				clips: []
			};
			const withTrack2 = { ...view, tracks: [...view.tracks, track2] };
			const withClip1 = insertClip(withTrack2, track1.id, clip1);
			return insertClip(withClip1, track2.id, clip2);
		});

		// Add instance of sequence to root timeline
		const rootVTrack = pNested.tracks.find((t) => t.kind === 'video')!;
		const { project: pWithInst, videoClipId } = addSequenceInstance(
			pNested,
			ROOT_SEQUENCE_ID,
			sequenceId,
			0,
			rootVTrack.id
		);

		const resolved = resolveFrame(pWithInst, 1_000_000);
		expect(resolved.videoLayers.length).toBe(1);
		const seqLayer = resolved.videoLayers[0]!;
		expect(seqLayer.kind).toBe('sequence');
		expect(seqLayer.nested).toBeDefined();

		const childLayers = seqLayer.nested!.layers;
		expect(childLayers.length).toBe(2);

		// Verify distinct keys and distinct sourceTimes
		expect(childLayers[0]!.instanceKey).not.toEqual(childLayers[1]!.instanceKey);
		expect(childLayers[0]!.instanceKey).toBe(`${videoClipId}/clip-nested-2`);
		expect(childLayers[1]!.instanceKey).toBe(`${videoClipId}/clip-nested-1`);
		expect(childLayers[0]!.sourceTime).not.toEqual(childLayers[1]!.sourceTime);
		expect(childLayers[1]!.sourceTime).toBe(2_000_000); // 1s into clip1 (sourceIn 1s -> 2s)
		expect(childLayers[0]!.sourceTime).toBe(4_000_000); // 1s into clip2 (sourceIn 3s -> 4s)
	});
});
