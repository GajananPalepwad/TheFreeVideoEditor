import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../factory';
import { groupOf } from '../timeline';
import type { Asset, AssetId, Clip, ClipId, Project, Track, TrackId } from '../types';
import {
	deleteClips,
	duplicateClips,
	groupClips,
	moveClips,
	splitClipsAt,
	trimClip,
	ungroupClips
} from './clips';

function makeClip(id: string, start: number, duration: number, opts: Partial<Clip> = {}): Clip {
	return {
		id: id as ClipId,
		start,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 1,
		...opts
	};
}

function createTestProject(): {
	project: Project;
	videoClip1: ClipId;
	videoClip2: ClipId;
	audioClip1: ClipId;
	textClip1: ClipId;
} {
	const c1 = makeClip('c1', 0, 5_000_000, { assetId: 'a1' as AssetId });
	const c2 = makeClip('c2', 12_000_000, 4_000_000, { assetId: 'a1' as AssetId });
	const a1 = makeClip('a1', 1_000_000, 5_000_000, { assetId: 'a2' as AssetId });
	const t1 = makeClip('t1', 2_000_000, 3_000_000, {
		source: { type: 'text', text: 'Hello' }
	});

	const videoTrack: Track = {
		id: 'v1' as TrackId,
		name: 'Video 1',
		kind: 'video',
		muted: false,
		locked: false,
		hidden: false,
		clips: [c1, c2]
	};
	const audioTrack: Track = {
		id: 'a1-tr' as TrackId,
		name: 'Audio 1',
		kind: 'audio',
		muted: false,
		locked: false,
		hidden: false,
		clips: [a1]
	};
	const textTrack: Track = {
		id: 'v2' as TrackId,
		name: 'Video 2',
		kind: 'video',
		muted: false,
		locked: false,
		hidden: false,
		clips: [t1]
	};

	const asset1: Asset = {
		id: 'a1' as AssetId,
		kind: 'video',
		name: 'v.mp4',
		mimeType: 'video/mp4',
		size: 1000,
		duration: 20_000_000,
		hasAudio: true,
		opfsPath: '/media/v.mp4'
	};
	const asset2: Asset = {
		id: 'a2' as AssetId,
		kind: 'audio',
		name: 'a.mp3',
		mimeType: 'audio/mp3',
		size: 1000,
		duration: 20_000_000,
		hasAudio: true,
		opfsPath: '/media/a.mp3'
	};

	const base = createEmptyProject({ name: 'Grouping Test' });
	const project: Project = {
		...base,
		tracks: [videoTrack, textTrack, audioTrack],
		assets: {
			['a1' as AssetId]: asset1,
			['a2' as AssetId]: asset2
		}
	};

	return {
		project,
		videoClip1: c1.id,
		videoClip2: c2.id,
		audioClip1: a1.id,
		textClip1: t1.id
	};
}

describe('Clip Grouping and Ungrouping (Issue #35)', () => {
	it('groups multiple clips across tracks and assigns a shared groupId', () => {
		const { project, videoClip1, audioClip1, textClip1 } = createTestProject();

		const grouped = groupClips(project, [videoClip1, audioClip1, textClip1]);
		const allClips = grouped.tracks.flatMap((t) => t.clips);

		const v1 = allClips.find((c) => c.id === videoClip1)!;
		const a1 = allClips.find((c) => c.id === audioClip1)!;
		const t1 = allClips.find((c) => c.id === textClip1)!;

		expect(v1.groupId).toBeDefined();
		expect(v1.groupId).toBe(a1.groupId);
		expect(v1.groupId).toBe(t1.groupId);

		// Non-grouped clip retains no groupId
		const v2 = allClips.find((c) => c.id === 'c2')!;
		expect(v2.groupId).toBeUndefined();
	});

	it('requires at least 2 clips to create a group', () => {
		const { project, videoClip1 } = createTestProject();
		expect(() => groupClips(project, [videoClip1])).toThrow();
	});

	it('resolves all members of a group via groupOf when clicking any member', () => {
		const { project, videoClip1, audioClip1, textClip1 } = createTestProject();
		const grouped = groupClips(project, [videoClip1, audioClip1, textClip1]);

		const fromV1 = groupOf(grouped, videoClip1);
		const fromA1 = groupOf(grouped, audioClip1);
		const fromT1 = groupOf(grouped, textClip1);

		expect(fromV1.map((c) => c.id).sort()).toEqual([audioClip1, textClip1, videoClip1].sort());
		expect(fromA1.map((c) => c.id).sort()).toEqual([audioClip1, textClip1, videoClip1].sort());
		expect(fromT1.map((c) => c.id).sort()).toEqual([audioClip1, textClip1, videoClip1].sort());
	});

	it('ungroups a group when ungroupClips is called', () => {
		const { project, videoClip1, audioClip1 } = createTestProject();
		const grouped = groupClips(project, [videoClip1, audioClip1]);
		const ungrouped = ungroupClips(grouped, [videoClip1]);

		const allClips = ungrouped.tracks.flatMap((t) => t.clips);
		const v1 = allClips.find((c) => c.id === videoClip1)!;
		const a1 = allClips.find((c) => c.id === audioClip1)!;

		expect(v1.groupId).toBeUndefined();
		expect(a1.groupId).toBeUndefined();
		expect(groupOf(ungrouped, videoClip1)).toHaveLength(1);
	});

	it('preserves underlying linkId when ungrouping clips', () => {
		const { project, videoClip1, audioClip1 } = createTestProject();
		// Manually assign linkId to simulate linked A/V
		const withLink: Project = {
			...project,
			tracks: project.tracks.map((t) => ({
				...t,
				clips: t.clips.map((c) =>
					c.id === videoClip1 || c.id === audioClip1 ? { ...c, linkId: 'av-link-1' } : c
				)
			}))
		};

		const grouped = groupClips(withLink, [videoClip1, audioClip1]);
		const ungrouped = ungroupClips(grouped, [videoClip1]);

		const allClips = ungrouped.tracks.flatMap((t) => t.clips);
		const v1 = allClips.find((c) => c.id === videoClip1)!;
		const a1 = allClips.find((c) => c.id === audioClip1)!;

		expect(v1.groupId).toBeUndefined();
		expect(a1.groupId).toBeUndefined();
		// Underlying linkId remains intact
		expect(v1.linkId).toBe('av-link-1');
		expect(a1.linkId).toBe('av-link-1');
		expect(groupOf(ungrouped, videoClip1)).toHaveLength(2);
	});

	it('moves grouped clips together while maintaining relative offsets', () => {
		const { project, videoClip1, audioClip1 } = createTestProject();
		// videoClip1 starts at 0, audioClip1 starts at 1_000_000 (relative offset = +1_000_000)
		const grouped = groupClips(project, [videoClip1, audioClip1]);

		const moved = moveClips(grouped, {
			clipIds: [videoClip1],
			deltaTime: 2_000_000
		});

		const allClips = moved.tracks.flatMap((t) => t.clips);
		const v1 = allClips.find((c) => c.id === videoClip1)!;
		const a1 = allClips.find((c) => c.id === audioClip1)!;

		expect(v1.start).toBe(2_000_000);
		expect(a1.start).toBe(3_000_000); // 1_000_000 + 2_000_000
		expect(a1.start - v1.start).toBe(1_000_000); // relative offset preserved
	});

	it('trims grouped clips together while maintaining relative offsets', () => {
		const { project, videoClip1, audioClip1 } = createTestProject();
		// videoClip1 is [0, 5_000_000], audioClip1 is [1_000_000, 6_000_000] (duration 5s)
		const grouped = groupClips(project, [videoClip1, audioClip1]);

		// Trim videoClip1 end from 5s to 4s (delta = -1s)
		const trimmedEnd = trimClip(grouped, videoClip1, 'end', 4_000_000);
		const allClipsEnd = trimmedEnd.tracks.flatMap((t) => t.clips);
		const v1End = allClipsEnd.find((c) => c.id === videoClip1)!;
		const a1End = allClipsEnd.find((c) => c.id === audioClip1)!;

		expect(v1End.duration).toBe(4_000_000);
		expect(a1End.duration).toBe(4_000_000); // reduced by 1s
		expect(a1End.start).toBe(1_000_000); // start unchanged

		// Trim videoClip1 start from 0 to 1s (delta = +1s)
		const trimmedStart = trimClip(grouped, videoClip1, 'start', 1_000_000);
		const allClipsStart = trimmedStart.tracks.flatMap((t) => t.clips);
		const v1Start = allClipsStart.find((c) => c.id === videoClip1)!;
		const a1Start = allClipsStart.find((c) => c.id === audioClip1)!;

		expect(v1Start.start).toBe(1_000_000);
		expect(v1Start.duration).toBe(4_000_000);
		expect(a1Start.start).toBe(2_000_000); // shifted by +1s
		expect(a1Start.duration).toBe(4_000_000); // reduced by 1s
		expect(a1Start.start - v1Start.start).toBe(1_000_000); // relative offset preserved
	});

	it('splits grouped clips at playhead and maintains group relationships on both sides', () => {
		const { project, videoClip1, audioClip1 } = createTestProject();
		// videoClip1 is [0, 5s], audioClip1 is [1s, 6s]
		const grouped = groupClips(project, [videoClip1, audioClip1]);

		// Split at 3_000_000 (3s)
		const { project: splitProject, splitClipIds } = splitClipsAt(grouped, 3_000_000, [videoClip1]);
		expect(splitClipIds.length).toBeGreaterThanOrEqual(4); // 2 left, 2 right

		const vClips = splitProject.tracks.find((t) => t.id === 'v1')!.clips;
		const aClips = splitProject.tracks.find((t) => t.id === 'a1-tr')!.clips;

		const vLeft = vClips.find((c) => c.start === 0)!;
		const vRight = vClips.find((c) => c.start === 3_000_000)!;
		const aLeft = aClips.find((c) => c.start === 1_000_000)!;
		const aRight = aClips.find((c) => c.start === 3_000_000)!;

		expect(vLeft).toBeDefined();
		expect(vRight).toBeDefined();
		expect(aLeft).toBeDefined();
		expect(aRight).toBeDefined();

		// Left halves share a group
		expect(vLeft.groupId).toBeDefined();
		expect(vLeft.groupId).toBe(aLeft.groupId);

		// Right halves share a new group
		expect(vRight.groupId).toBeDefined();
		expect(vRight.groupId).toBe(aRight.groupId);

		// Left group is different from Right group
		expect(vLeft.groupId).not.toBe(vRight.groupId);
	});

	it('duplicates grouped clips and gives duplicate group a new shared groupId', () => {
		const { project, videoClip1, audioClip1 } = createTestProject();
		const grouped = groupClips(project, [videoClip1, audioClip1]);

		const duplicated = duplicateClips(grouped, [videoClip1]);
		const allClips = duplicated.tracks.flatMap((t) => t.clips);

		// Should now have 4 clips total (2 original + 2 duplicated)
		const groupedClips = allClips.filter((c) => c.groupId);
		expect(groupedClips).toHaveLength(4);

		const originalV1 = allClips.find((c) => c.id === videoClip1)!;
		const originalA1 = allClips.find((c) => c.id === audioClip1)!;
		const copies = groupedClips.filter((c) => c.id !== videoClip1 && c.id !== audioClip1);

		expect(copies).toHaveLength(2);
		expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
		expect(copies[0]!.groupId).not.toBe(originalV1.groupId);
		expect(originalV1.groupId).toBe(originalA1.groupId);
	});

	it('deletes all members of a group when one member is deleted', () => {
		const { project, videoClip1, audioClip1 } = createTestProject();
		const grouped = groupClips(project, [videoClip1, audioClip1]);

		const deleted = deleteClips(grouped, [videoClip1]);
		const allClips = deleted.tracks.flatMap((t) => t.clips);

		expect(allClips.find((c) => c.id === videoClip1)).toBeUndefined();
		expect(allClips.find((c) => c.id === audioClip1)).toBeUndefined();
	});
});
