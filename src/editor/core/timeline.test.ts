import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import {
	addClipFromAsset,
	addTrack,
	deleteClips,
	duplicateClips,
	linkClips,
	moveClips,
	removeTrack,
	renameTrack,
	reorderTrack,
	rippleDeleteClips,
	rippleDeleteGap,
	rippleTrimClip,
	setTrackFlags,
	setTrackHeight,
	splitClipsAt,
	trimClip,
	unlinkClips
} from './operations';
import { AssetInUseError, removeAsset } from './assets';
import {
	clipAt,
	clipEnd,
	clipsOverlappingRange,
	collectSnapPoints,
	findFreeGap,
	groupOf,
	nearestValidStart,
	rulerTickStep,
	snapTime,
	timelineDuration
} from './timeline';
import { intersectsPixelRange, pixelsToTime, snapToFrame, timeToPixels } from './timelineGeometry';
import { projectSchema } from './schema';
import type { Asset, AssetId, ClipId, Project, Track } from './types';

function videoProject(): Project {
	const project = createEmptyProject({ name: 'Timeline test' });
	const assetId = 'timeline-video' as AssetId;
	const asset: Asset = {
		id: assetId,
		kind: 'video',
		name: 'sample.mp4',
		mimeType: 'video/mp4',
		size: 100,
		duration: 10_000_000,
		hasAudio: true,
		opfsPath: `projects/${project.id}/media/${assetId}.mp4`
	};
	return { ...project, assets: { [assetId]: asset } };
}

function addVideo(project = videoProject()): Project {
	const track = project.tracks.find((item) => item.kind === 'video')!;
	return addClipFromAsset(project, {
		assetId: Object.keys(project.assets)[0] as AssetId,
		trackId: track.id,
		start: 0
	});
}

describe('timeline geometry', () => {
	it('tests clip visibility against an overscanned viewport range', () => {
		expect(intersectsPixelRange(100, 40, { start: 140, end: 200 })).toBe(true);
		expect(intersectsPixelRange(201, 40, { start: 140, end: 200 })).toBe(false);
	});

	it('converts integer microseconds to pixels and frame-aligned time', () => {
		const time = 2_000_000;
		expect(timeToPixels(time, 100)).toBe(200);
		expect(pixelsToTime(200, 100, 30)).toBe(time);
		expect(snapToFrame(40_000, 30)).toBe(33_333);
	});

	it('selects a ruler tick step with a readable label gap', () => {
		expect(rulerTickStep(100, 30)).toBe(1_000_000);
		expect(rulerTickStep(10, 30)).toBeGreaterThanOrEqual(5_000_000);
	});
});

describe('timeline queries and clip operations', () => {
	it('queries clip intervals, duration, groups, and snap points', () => {
		const project = addVideo();
		const track = project.tracks[0]!;
		const clip = track.clips[0]!;
		expect(clipEnd(clip)).toBe(10_000_000);
		expect(clipAt(track, 500)).toEqual(clip);
		expect(clipAt(track, clipEnd(clip))).toBeUndefined();
		expect(clipsOverlappingRange(track, 9_000_000, 11_000_000)).toEqual([clip]);
		expect(timelineDuration(project)).toBe(10_000_000);
		expect(groupOf(project, clip.id)).toHaveLength(2);
		expect(collectSnapPoints(project, { playhead: 5_000_000, includeMarkers: true })).toContain(
			10_000_000
		);
		expect(snapTime(5_000_050, [5_000_000], 100).snappedTo).toBe(5_000_000);
	});

	it('places a clip at the nearest non-overlapping gap and adds linked audio', () => {
		const project = addVideo();
		const video = project.tracks.find((track) => track.kind === 'video')!;
		const second = addClipFromAsset(project, {
			assetId: Object.keys(project.assets)[0] as AssetId,
			trackId: video.id,
			start: 2_000_000
		});
		expect(second.tracks.find((track) => track.kind === 'video')?.clips[1]?.start).toBe(10_000_000);
		const audio = second.tracks.find((track) => track.kind === 'audio')!;
		expect(audio.clips).toHaveLength(2);
		expect(audio.clips[0]?.linkId).toBe(second.tracks[0]?.clips[0]?.linkId);
	});

	it('places linked video and audio at the same time and keeps split effect ids unique', () => {
		const project = videoProject();
		const audioId = 'occupied-audio-track' as AssetId;
		const withAudio = {
			...project,
			assets: {
				...project.assets,
				[audioId]: {
					id: audioId,
					kind: 'audio' as const,
					name: 'occupied.wav',
					mimeType: 'audio/wav',
					size: 50,
					duration: 10_000_000,
					hasAudio: true,
					opfsPath: `projects/${project.id}/media/${audioId}.wav`
				}
			}
		};
		const audioTrack = withAudio.tracks.find((track) => track.kind === 'audio')!;
		const withOccupiedAudio = addClipFromAsset(withAudio, {
			assetId: audioId,
			trackId: audioTrack.id,
			start: 0
		});
		const videoTrack = withOccupiedAudio.tracks.find((track) => track.kind === 'video')!;
		const withVideo = addClipFromAsset(withOccupiedAudio, {
			assetId: Object.keys(project.assets)[0] as AssetId,
			trackId: videoTrack.id,
			start: 0
		});
		const videoClip = withVideo.tracks.find((track) => track.kind === 'video')!.clips[0]!;
		const linkedAudio = withVideo.tracks.find(
			(track) => track.kind === 'audio' && track.id !== audioTrack.id
		)!.clips[0]!;
		expect(linkedAudio.start).toBe(videoClip.start);

		const withEffect: Project = {
			...withVideo,
			tracks: withVideo.tracks.map((track) =>
				track.id === videoTrack.id
					? {
							...track,
							clips: track.clips.map((clip) =>
								clip.id === videoClip.id
									? { ...clip, effects: [{ id: 'fade-effect', type: 'fade', params: {} }] }
									: clip
							)
						}
					: track
			)
		};
		const split = splitClipsAt(withEffect, 5_000_000, [videoClip.id]).project;
		expect(projectSchema.safeParse(split).success).toBe(true);
	});

	it('moves linked clips as one group, splits both halves, and trims source bounds', () => {
		const project = addVideo();
		const clip = project.tracks[0]!.clips[0]!;
		const moved = moveClips(project, { clipIds: [clip.id], deltaTime: 1_000_000 });
		expect(moved.tracks.flatMap((track) => track.clips).map((item) => item.start)).toEqual([
			1_000_000, 1_000_000
		]);
		const split = splitClipsAt(moved, 4_000_000, [clip.id]);
		expect(split.splitClipIds).toHaveLength(4);
		expect(
			new Set(split.project.tracks.flatMap((track) => track.clips).map((item) => item.linkId))
		).toHaveProperty('size', 2);
		const trimmed = trimClip(project, clip.id, 'end', 99_000_000);
		expect(trimmed.tracks[0]!.clips[0]!.sourceOut).toBe(10_000_000);
	});

	it('keeps linked groups aligned when moving and duplicating without overlap', () => {
		const project = addVideo();
		const video = project.tracks.find((track) => track.kind === 'video')!;
		const clip = video.clips[0]!;
		const addedTrack = addTrack(project, 'video');
		const target = addedTrack.tracks[0]!;
		const moved = moveClips(addedTrack, {
			clipIds: [clip.id],
			deltaTime: 2_000_000,
			targetTrackId: target.id
		});
		const movedVideo = moved.tracks.find((track) => track.id === target.id)!.clips[0]!;
		const movedAudio = moved.tracks.find((track) => track.kind === 'audio')!.clips[0]!;
		expect(movedVideo.start).toBe(2_000_000);
		expect(movedAudio.start).toBe(2_000_000);
		expect(movedVideo.linkId).toBe(movedAudio.linkId);

		const duplicated = duplicateClips(moved, [movedVideo.id]);
		const copies = duplicated.tracks
			.flatMap((track) => track.clips)
			.filter((item) => item.start === 12_000_000);
		expect(copies).toHaveLength(2);
		expect(copies[0]?.linkId).toBe(copies[1]?.linkId);
		expect(copies[0]?.linkId).not.toBe(movedVideo.linkId);
	});

	it('moves multiple selected clips together across tracks and preserves track separation', () => {
		let project = addVideo();
		const assetId = Object.keys(project.assets)[0] as AssetId;
		const initialVideo = project.tracks.find((t) => t.kind === 'video')!;
		const clip1 = initialVideo.clips[0]!;
		project = addTrack(project, 'video');
		const newVideo = project.tracks.find((t) => t.kind === 'video' && t.id !== initialVideo.id)!;
		project = addClipFromAsset(project, { assetId, trackId: newVideo.id, start: 0 });
		const clip2 = project.tracks.find((t) => t.id === newVideo.id)!.clips[0]!;

		const moved = moveClips(project, {
			clipIds: [clip1.id, clip2.id],
			deltaTime: 3_000_000,
			targetTrackId: initialVideo.id
		});
		const moved1 = moved.tracks.find((t) => t.id === initialVideo.id)!.clips.find((c) => c.id === clip1.id)!;
		const moved2 = moved.tracks.find((t) => t.id === newVideo.id)!.clips.find((c) => c.id === clip2.id)!;
		expect(moved1.start).toBe(3_000_000);
		expect(moved2.start).toBe(3_000_000);
	});

	it('ripple-deletes linked clips and rejects a ripple that would alter a locked track', () => {
		let project = addVideo();
		const assetId = Object.keys(project.assets)[0] as AssetId;
		const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
		project = addClipFromAsset(project, { assetId, trackId: videoTrack.id, start: 10_000_000 });
		project = addClipFromAsset(project, { assetId, trackId: videoTrack.id, start: 20_000_000 });
		const videoClips = project.tracks.find((track) => track.kind === 'video')!.clips;
		const first = videoClips[0]!;
		const second = videoClips[1]!;

		const rippled = rippleDeleteClips(project, [first.id, second.id]);
		expect(rippled.tracks.find((track) => track.kind === 'video')!.clips[0]!.start).toBe(0);
		expect(rippled.tracks.find((track) => track.kind === 'audio')!.clips[0]!.start).toBe(0);

		const locked: Project = {
			...project,
			tracks: project.tracks.map((track) =>
				track.kind === 'audio' ? { ...track, locked: true } : track
			)
		};
		expect(() => rippleDeleteClips(locked, [first.id])).toThrow('locked');
	});

	it('ripple-deletes a gap between two clips and shifts following clips', () => {
		let project = addVideo();
		const assetId = Object.keys(project.assets)[0] as AssetId;
		const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
		// First clip: [0, 5s]
		// Second clip: starts at 12s, duration 5s -> Gap is [5s, 12s] (duration 7s)
		project = addClipFromAsset(project, { assetId, trackId: videoTrack.id, start: 12_000_000 });
		const vTrack = project.tracks.find((track) => track.kind === 'video')!;
		const clip1 = vTrack.clips[0]!;
		const clip2 = vTrack.clips[1]!;

		const gapStart = clip1.start + clip1.duration; // 5s
		const gapEnd = clip2.start; // 12s

		const rippled = rippleDeleteGap(project, videoTrack.id, gapStart, gapEnd);
		const rippledVideo = rippled.tracks.find((track) => track.kind === 'video')!;
		const rippledAudio = rippled.tracks.find((track) => track.kind === 'audio')!;

		// Second clip should now start immediately at 10s (end of first 10s clip)
		expect(rippledVideo.clips[1]!.start).toBe(10_000_000);
		// Linked audio should also shift to 10s
		expect(rippledAudio.clips[1]!.start).toBe(10_000_000);

		// If track is locked, should throw
		const locked: Project = {
			...project,
			tracks: project.tracks.map((track) =>
				track.kind === 'video' ? { ...track, locked: true } : track
			)
		};
		expect(() => rippleDeleteGap(locked, videoTrack.id, gapStart, gapEnd)).toThrow('locked');
	});

	it('ripple trims a clip and shifts following clips across tracks', () => {
		let project = addVideo();
		const assetId = Object.keys(project.assets)[0] as AssetId;
		const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
		// add a second video clip
		project = addClipFromAsset(project, { assetId, trackId: videoTrack.id, start: 10_000_000 });
		const videoClips = project.tracks.find((track) => track.kind === 'video')!.clips;
		const first = videoClips[0]!;
		const second = videoClips[1]!;
		const oldSecondStart = second.start;

		// Shorten first clip by 2 seconds from the end
		const newEnd = first.start + first.duration - 2_000_000;
		const rippled = rippleTrimClip(project, first.id, 'end', newEnd);

		const updatedClips = rippled.tracks.find((track) => track.kind === 'video')!.clips;
		const updatedFirst = updatedClips.find((c) => c.id === first.id)!;
		const updatedSecond = updatedClips.find((c) => c.id === second.id)!;

		expect(updatedFirst.duration).toBe(first.duration - 2_000_000);
		expect(updatedSecond.start).toBe(oldSecondStart - 2_000_000);
	});

	it('protects linked clips on locked tracks when removing a track', () => {
		const project = addVideo();
		const audioTrack = project.tracks.find((track) => track.kind === 'audio')!;
		const locked: Project = {
			...project,
			tracks: project.tracks.map((track) =>
				track.id === audioTrack.id ? { ...track, locked: true } : track
			)
		};
		const videoTrack = locked.tracks.find((track) => track.kind === 'video')!;
		expect(() => removeTrack(locked, videoTrack.id)).toThrow('locked');
	});

	it('reorders and updates track flags while preserving unrelated tracks', () => {
		const project = createEmptyProject({ name: 'Track controls' });
		const firstTrack = project.tracks[0]!;
		const secondTrack = project.tracks[1]!;
		const changed = setTrackFlags(project, firstTrack.id, { locked: true, hidden: true });
		const reordered = reorderTrack(changed, firstTrack.id, 1);
		expect(reordered.tracks.map((track) => track.id)).toEqual([firstTrack.id, secondTrack.id]);
		expect(reordered.tracks[0]?.locked).toBe(true);
		expect(reordered.tracks[0]?.hidden).toBe(true);
		expect(renameTrack(reordered, firstTrack.id, '  Main video  ').tracks[0]?.name).toBe(
			'Main video'
		);
		expect(() => renameTrack(reordered, firstTrack.id, '  ')).toThrow('cannot be empty');
	});

	it('sets a track height clamped to 48–240 pixels', () => {
		const project = createEmptyProject({ name: 'Track height' });
		const [firstTrack, secondTrack] = project.tracks;
		const height = (value: number) =>
			setTrackHeight(project, firstTrack!.id, value).tracks[0]?.height;
		expect(height(120)).toBe(120);
		expect(height(120.4)).toBe(120);
		expect(height(10)).toBe(48);
		expect(height(500)).toBe(240);
		expect(setTrackHeight(project, firstTrack!.id, 120).tracks[1]).toBe(secondTrack);
		expect(() => setTrackHeight(project, 'missing' as typeof firstTrack.id, 120)).toThrow();
	});

	it('trims linked clip starts in sync and rejects trims that overlap another clip', () => {
		const project = addVideo();
		const assetId = Object.keys(project.assets)[0] as AssetId;
		const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
		const first = project.tracks.find((track) => track.kind === 'video')!.clips[0]!;
		const trimmed = trimClip(project, first.id, 'start', 1_000_000);
		const trimmedVideo = trimmed.tracks.find((track) => track.kind === 'video')!.clips[0]!;
		const trimmedAudio = trimmed.tracks.find((track) => track.kind === 'audio')!.clips[0]!;
		expect(trimmedVideo.start).toBe(1_000_000);
		expect(trimmedVideo.sourceIn).toBe(1_000_000);
		expect(trimmedAudio.start).toBe(trimmedVideo.start);
		expect(trimmedAudio.sourceIn).toBe(trimmedVideo.sourceIn);

		const shortened: Project = {
			...project,
			tracks: project.tracks.map((track) => ({
				...track,
				clips: track.clips.map((clip) =>
					clip.linkId === first.linkId
						? { ...clip, duration: 5_000_000, sourceOut: 5_000_000 }
						: clip
				)
			}))
		};
		const withNeighbor = addClipFromAsset(shortened, {
			assetId,
			trackId: videoTrack.id,
			start: 5_000_000
		});
		expect(() => trimClip(withNeighbor, first.id, 'end', 6_000_000)).toThrow('overlap');
	});

	it('links and unlinks selected clips without changing their positions', () => {
		let project = addVideo();
		const videoClip = project.tracks.find((track) => track.kind === 'video')!.clips[0]!;
		const audioClip = project.tracks.find((track) => track.kind === 'audio')!.clips[0]!;
		project = unlinkClips(project, [videoClip.id]);
		project = linkClips(project, [videoClip.id, audioClip.id]);
		expect(groupOf(project, videoClip.id)).toHaveLength(2);
		project = unlinkClips(project, [videoClip.id]);
		expect(groupOf(project, videoClip.id)).toHaveLength(1);
		expect(project.tracks.flatMap((track) => track.clips).map((clip) => clip.start)).toEqual([
			0, 0
		]);
	});

	it('moves a detached audio clip, including onto another audio track', () => {
		let project = addVideo();
		const videoClip = project.tracks.find((track) => track.kind === 'video')!.clips[0]!;
		const audioTrack = project.tracks.find((track) => track.kind === 'audio')!;
		const audioClip = audioTrack.clips[0]!;
		project = unlinkClips(project, [audioClip.id]);
		project = addTrack(project, 'audio');
		const second = project.tracks.filter((track) => track.kind === 'audio')[1]!;
		const moved = moveClips(project, {
			clipIds: [audioClip.id],
			deltaTime: 1_000_000,
			targetTrackId: second.id
		});
		const movedAudio = moved.tracks.find((track) => track.id === second.id)!.clips[0]!;
		expect(movedAudio.start).toBe(1_000_000);
		expect(moved.tracks.find((track) => track.kind === 'video')!.clips[0]!.start).toBe(
			videoClip.start
		);
	});

	it('makes edge splits a typed no-op and refuses locked tracks', () => {
		const project = addVideo();
		const clip = project.tracks[0]!.clips[0]!;
		expect(splitClipsAt(project, clip.start, [clip.id]).noOpClipIds).toEqual([
			clip.id,
			project.tracks[1]!.clips[0]!.id
		]);
		const locked: Project = {
			...project,
			tracks: project.tracks.map((track) => ({ ...track, locked: track.kind === 'video' }))
		};
		expect(() => deleteClips(locked, [clip.id])).toThrow('locked');
	});

	it('finds free gaps and keeps generated placements disjoint', () => {
		const project = addVideo();
		const base = project.tracks[0]!;
		const occupied: Track = {
			...base,
			clips: [
				{ ...base.clips[0]!, id: 'first' as ClipId, duration: 1_000_000 },
				{ ...base.clips[0]!, id: 'second' as ClipId, start: 2_000_000, duration: 1_000_000 }
			]
		};
		expect(findFreeGap(occupied, 1_500_000, 1_000_000)).toBe(1_000_000);
		expect(nearestValidStart(occupied, 1_500_000, 1_000_000)).toBe(1_000_000);
	});

	it('removes linked partner clips when force-removing a source asset', () => {
		const project = addVideo();
		const assetId = Object.keys(project.assets)[0] as AssetId;
		expect(() => removeAsset(project, { assetId })).toThrow(AssetInUseError);
		const result = removeAsset(project, { assetId, force: true });
		expect(Object.keys(result.assets)).toHaveLength(0);
		expect(result.tracks.every((track) => track.clips.length === 0)).toBe(true);
	});

	it('adds additional tracks without changing existing track records', () => {
		const project = videoProject();
		const videoTrack = addTrack(project, 'video').tracks[0];
		expect(videoTrack?.kind).toBe('video');
		expect(project.tracks.every((track) => track.id !== videoTrack?.id)).toBe(true);

		const withAudio = addTrack(project, 'audio');
		expect(withAudio.tracks).toHaveLength(project.tracks.length + 1);
		expect(withAudio.tracks.at(-1)?.kind).toBe('audio');
		expect(withAudio.tracks.findIndex((track) => track.kind === 'audio')).toBeGreaterThan(
			withAudio.tracks.findLastIndex((track) => track.kind === 'video')
		);
	});

	it('keeps video tracks above audio tracks during manual reordering', () => {
		const project = videoProject();
		const withVideo = addTrack(project, 'video');
		const videoTrack = withVideo.tracks[0]!;
		const audioTrack = withVideo.tracks.find((track) => track.kind === 'audio')!;

		const reorderedVideo = reorderTrack(withVideo, videoTrack.id, withVideo.tracks.length - 1);
		expect(reorderedVideo.tracks.findIndex((track) => track.id === videoTrack.id)).toBe(1);
		expect(reorderedVideo.tracks.slice(0, 2).every((track) => track.kind === 'video')).toBe(true);
		const reordered = reorderTrack(withVideo, audioTrack.id, 0);
		expect(reordered.tracks.at(-1)?.id).toBe(audioTrack.id);
	});

	it('rearranges caption tracks among visual tracks without dropping into audio', () => {
		const project = videoProject();
		// Add two caption tracks
		const withCap1 = addTrack(project, 'caption');
		const withCap2 = addTrack(withCap1, 'caption');
		const capTracks = withCap2.tracks.filter((t) => t.kind === 'caption');
		expect(capTracks).toHaveLength(2);
		const [firstCap, secondCap] = capTracks;

		// Initial tracks order should have captions at top
		expect(withCap2.tracks.map((t) => t.kind)).toEqual(['caption', 'caption', 'video', 'audio']);

		// Reorder second caption track to index 0 (swap positions)
		const reordered = reorderTrack(withCap2, secondCap!.id, 0);
		expect(reordered.tracks[0]?.id).toBe(secondCap!.id);
		expect(reordered.tracks[1]?.id).toBe(firstCap!.id);
		expect(reordered.tracks[2]?.kind).toBe('video');
		expect(reordered.tracks[3]?.kind).toBe('audio');

		// Move first caption track below video (index 2)
		const movedBelowVideo = reorderTrack(reordered, firstCap!.id, 2);
		expect(movedBelowVideo.tracks.map((t) => t.kind)).toEqual(['caption', 'video', 'caption', 'audio']);

		// Reorder caption track downwards towards bottom (e.g. target index 99)
		// Should clamp strictly within the visual zone (above audio), NEVER dropping into audio
		const clamped = reorderTrack(movedBelowVideo, secondCap!.id, 99);
		expect(clamped.tracks.map((t) => t.kind)).toEqual(['video', 'caption', 'caption', 'audio']);
	});

	it('allows a caption track to move below video tracks and prevents dragging into audio', () => {
		const project = videoProject();
		const withCap = addTrack(project, 'caption');
		const capTrack = withCap.tracks.find((t) => t.kind === 'caption')!;

		expect(withCap.tracks[0]?.id).toBe(capTrack.id);

		// Move caption track below video track (index 1)
		const reorderedDown = reorderTrack(withCap, capTrack.id, 1);
		expect(reorderedDown.tracks[0]?.kind).toBe('video');
		expect(reorderedDown.tracks[1]?.id).toBe(capTrack.id);
		expect(reorderedDown.tracks.map((t) => t.kind)).toEqual(['video', 'caption', 'audio']);

		// Attempting to reorder caption track to index 99 clamps strictly above audio
		const reorderedBottom = reorderTrack(withCap, capTrack.id, 99);
		expect(reorderedBottom.tracks[1]?.id).toBe(capTrack.id);
		expect(reorderedBottom.tracks.map((t) => t.kind)).toEqual(['video', 'caption', 'audio']);
	});

	it('preserves the no-overlap invariant over 500 generated placements and edits', () => {
		let project = videoProject();
		const assetId = Object.keys(project.assets)[0] as AssetId;
		project.assets[assetId] = { ...project.assets[assetId]!, duration: 1_000_000 };
		let seed = 23_481;
		const random = () => {
			seed = (seed * 16_807) % 2_147_483_647;
			return seed / 2_147_483_647;
		};
		const assertInvariant = (current: Project) => {
			for (const track of current.tracks) {
				const clips = track.clips.toSorted((first, second) => first.start - second.start);
				for (let index = 0; index < clips.length; index += 1) {
					const clip = clips[index]!;
					expect(clip.sourceIn).toBeLessThan(clip.sourceOut);
					if (clip.assetId) {
						expect(clip.sourceOut).toBeLessThanOrEqual(current.assets[clip.assetId]!.duration);
					}
					const next = clips[index + 1];
					if (next) expect(clipEnd(clip)).toBeLessThanOrEqual(next.start);
				}
			}
		};

		for (let step = 0; step < 500; step += 1) {
			const videoTrack = project.tracks.find((track) => track.kind === 'video')!;
			project = addClipFromAsset(project, {
				assetId,
				trackId: videoTrack.id,
				start: Math.floor(random() * 30_000_000)
			});
			if (step % 3 === 0) {
				const clips = project.tracks.find((track) => track.kind === 'video')!.clips;
				const clip = clips[Math.floor(random() * clips.length)]!;
				try {
					project = moveClips(project, {
						clipIds: [clip.id],
						deltaTime: Math.floor(random() * 4_000_000) - 2_000_000
					});
				} catch {
					// A move with no fitting interval is rejected without changing the source project.
				}
			}
			assertInvariant(project);
		}
	});

	it('preserves the no-overlap invariant on caption tracks across 500 random operations', async () => {
		const { createCaptionTrack, addCaptionSegment, retimeCaptionSegment } =
			await import('./captions/operations');
		const captionTrack = createCaptionTrack('Test Captions');
		let seed = 42_137;
		const random = () => {
			seed = (seed * 16_807) % 2_147_483_647;
			return seed / 2_147_483_647;
		};

		const assertCaptionInvariant = (track: typeof captionTrack) => {
			const cues = (track.captions ?? []).toSorted((a, b) => a.start - b.start);
			for (let i = 0; i < cues.length; i++) {
				const cue = cues[i]!;
				expect(cue.start).toBeLessThan(cue.end);
				const next = cues[i + 1];
				if (next) {
					expect(cue.end).toBeLessThanOrEqual(next.start);
				}
			}
		};

		for (let step = 0; step < 500; step++) {
			const start = Math.floor(random() * 20_000_000);
			const duration = Math.floor(random() * 3_000_000) + 500_000;
			addCaptionSegment(captionTrack, {
				start,
				end: start + duration,
				text: `Cue ${step}`
			});

			if (step % 4 === 0 && captionTrack.captions && captionTrack.captions.length > 0) {
				const cue = captionTrack.captions[Math.floor(random() * captionTrack.captions.length)]!;
				const newStart = Math.floor(random() * 15_000_000);
				const newDur = Math.floor(random() * 2_000_000) + 400_000;
				retimeCaptionSegment(captionTrack, cue.id, newStart, newStart + newDur);
			}

			assertCaptionInvariant(captionTrack);
		}
	});
});
