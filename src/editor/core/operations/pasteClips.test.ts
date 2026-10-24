import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../factory';
import type { Clip, ClipId, Project, TrackId } from '../types';
import { type ClipClipboard, pasteClips } from './clips';

function makeBaseClip(id: string, start = 0, duration = 1_000_000): Clip {
	return {
		id: id as ClipId,
		start,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 1
	};
}

function makeProject(clips: Clip[] = []): Project {
	const base = createEmptyProject({ name: 'Test Project' });
	const vTrack = base.tracks.find((t) => t.kind === 'video')!;
	return {
		...base,
		tracks: base.tracks.map((t) =>
			t.id === vTrack.id
				? { ...t, id: 'v1' as TrackId, clips }
				: t.kind === 'audio'
					? { ...t, id: 'a1' as TrackId }
					: t
		)
	};
}

describe('pasteClips', () => {
	it('returns empty result when clipboard is empty', () => {
		const project = makeProject();
		const clipboard: ClipClipboard = { items: [], minStart: 0 };
		const result = pasteClips(project, clipboard, 1_000_000);
		expect(result.pastedClipIds).toEqual([]);
		expect(result.project).toBe(project);
	});

	it('pastes a single clip at the given playhead time', () => {
		const clip = makeBaseClip('c1', 500_000, 2_000_000);
		const project = makeProject();
		const clipboard: ClipClipboard = {
			items: [{ clip, trackId: 'v1' as TrackId, trackKind: 'video' }],
			minStart: 500_000
		};

		const result = pasteClips(project, clipboard, 3_000_000);
		expect(result.pastedClipIds).toHaveLength(1);
		const pastedId = result.pastedClipIds[0]!;
		expect(pastedId).not.toBe('c1');

		const track = result.project.tracks.find((t) => t.id === 'v1')!;
		expect(track.clips).toHaveLength(1);
		const pasted = track.clips[0]!;
		expect(pasted.id).toBe(pastedId);
		expect(pasted.start).toBe(3_000_000);
		expect(pasted.duration).toBe(2_000_000);
	});

	it('pastes multiple clips maintaining relative time offsets', () => {
		const c1 = makeBaseClip('c1', 1_000_000, 1_000_000);
		const c2 = makeBaseClip('c2', 3_000_000, 1_000_000); // 2s after c1

		const project = makeProject();
		const clipboard: ClipClipboard = {
			items: [
				{ clip: c1, trackId: 'v1' as TrackId, trackKind: 'video' },
				{ clip: c2, trackId: 'v1' as TrackId, trackKind: 'video' }
			],
			minStart: 1_000_000
		};

		const result = pasteClips(project, clipboard, 5_000_000);
		expect(result.pastedClipIds).toHaveLength(2);

		const track = result.project.tracks.find((t) => t.id === 'v1')!;
		expect(track.clips).toHaveLength(2);
		expect(track.clips[0]!.start).toBe(5_000_000);
		expect(track.clips[1]!.start).toBe(7_000_000);
	});

	it('links linked clips together with a fresh linkId upon pasting', () => {
		const videoClip: Clip = {
			...makeBaseClip('v-orig', 0, 1_000_000),
			linkId: 'link-old'
		};
		const audioClip: Clip = {
			...makeBaseClip('a-orig', 0, 1_000_000),
			linkId: 'link-old'
		};

		const project = makeProject();
		const clipboard: ClipClipboard = {
			items: [
				{ clip: videoClip, trackId: 'v1' as TrackId, trackKind: 'video' },
				{ clip: audioClip, trackId: 'a1' as TrackId, trackKind: 'audio' }
			],
			minStart: 0
		};

		const result = pasteClips(project, clipboard, 2_000_000);
		expect(result.pastedClipIds).toHaveLength(2);

		const vTrack = result.project.tracks.find((t) => t.kind === 'video')!;
		const aTrack = result.project.tracks.find((t) => t.kind === 'audio')!;

		const pastedV = vTrack.clips.find((c) => c.id === result.pastedClipIds[0])!;
		const pastedA = aTrack.clips.find((c) => c.id === result.pastedClipIds[1])!;

		expect(pastedV.linkId).toBeDefined();
		expect(pastedV.linkId).not.toBe('link-old');
		expect(pastedV.linkId).toBe(pastedA.linkId);
	});

	it('creates a new track when the target track has an overlapping clip', () => {
		// Existing clip on Video 1 occupies 2s to 4s
		const existing = makeBaseClip('existing', 2_000_000, 2_000_000);
		const project = makeProject([existing]);

		// Clipboard clip to paste at 3s with duration 2s (would collide with 2s..4s)
		const clipToPaste = makeBaseClip('paste-me', 0, 2_000_000);
		const clipboard: ClipClipboard = {
			items: [{ clip: clipToPaste, trackId: 'v1' as TrackId, trackKind: 'video' }],
			minStart: 0
		};

		const result = pasteClips(project, clipboard, 3_000_000, 'v1' as TrackId);
		expect(result.pastedClipIds).toHaveLength(1);

		// Video 1 should still only have the existing clip
		const v1 = result.project.tracks.find((t) => t.id === 'v1')!;
		expect(v1.clips).toHaveLength(1);
		expect(v1.clips[0]!.id).toBe('existing');

		// A new video track should have been created with the pasted clip
		const videoTracks = result.project.tracks.filter((t) => t.kind === 'video');
		expect(videoTracks).toHaveLength(2);
		const otherTrack = videoTracks.find((t) => t.id !== 'v1')!;
		expect(otherTrack.clips).toHaveLength(1);
		expect(otherTrack.clips[0]!.start).toBe(3_000_000);
	});
});
