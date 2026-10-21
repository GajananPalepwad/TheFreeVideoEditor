import { createAssetId } from '../ids';
import type { Project, Track, TrackId } from '../types';
import { TrackLockedError, TrackNotFoundError } from './errors';
import { DEFAULT_CAPTION_STYLE } from '../captions/presets';

export function addTrack(project: Project, kind: Track['kind'], index?: number): Project {
	const count = project.tracks.filter((track) => track.kind === kind).length + 1;
	const trackName =
		kind === 'video'
			? `Video ${count}`
			: kind === 'caption'
				? `Captions ${count}`
				: `Audio ${count}`;
	const track: Track = {
		id: createAssetId().toString() as TrackId,
		kind,
		name: trackName,
		muted: false,
		locked: false,
		hidden: false,
		clips: [],
		captions: kind === 'caption' ? [] : undefined,
		captionStyle: kind === 'caption' ? { ...DEFAULT_CAPTION_STYLE } : undefined
	};
	const tracks = [...project.tracks];
	const visualTrackCount = tracks.filter((item) => item.kind === 'caption' || item.kind === 'video').length;

	let target: number;
	if (kind === 'caption' || kind === 'video') {
		target = index === undefined ? 0 : Math.max(0, Math.min(index, visualTrackCount));
	} else {
		// audio track
		target =
			index === undefined
				? tracks.length
				: Math.max(visualTrackCount, Math.min(index, tracks.length));
	}
	tracks.splice(target, 0, track);
	return { ...project, tracks };
}

export interface RemoveTrackResult {
	project: Project;
	clipCount: number;
}

export function removeTrack(project: Project, trackId: TrackId): RemoveTrackResult {
	const track = project.tracks.find((item) => item.id === trackId);
	if (!track) throw new TrackNotFoundError(trackId);
	if (track.locked) throw new TrackLockedError(track.id);
	const clipIds = new Set(track.clips.map((clip) => clip.id));
	const linkedIds = new Set(track.clips.flatMap((clip) => (clip.linkId ? [clip.linkId] : [])));
	const lockedPartner = project.tracks.find(
		(item) =>
			item.id !== trackId &&
			item.locked &&
			item.clips.some((clip) => clip.linkId && linkedIds.has(clip.linkId))
	);
	if (lockedPartner) throw new TrackLockedError(lockedPartner.id);
	const tracks = project.tracks
		.filter((item) => item.id !== trackId)
		.map((item) => ({
			...item,
			clips: item.clips.filter(
				(clip) => !clipIds.has(clip.id) && !(clip.linkId && linkedIds.has(clip.linkId))
			)
		}));
	return { project: { ...project, tracks }, clipCount: track.clips.length };
}

export function reorderTrack(project: Project, trackId: TrackId, targetIndex: number): Project {
	const index = project.tracks.findIndex((track) => track.id === trackId);
	if (index < 0) throw new TrackNotFoundError(trackId);
	const tracks = [...project.tracks];
	const [track] = tracks.splice(index, 1);
	if (!track) return project;

	const visualTrackCount = tracks.filter((item) => item.kind === 'caption' || item.kind === 'video').length;

	let target: number;
	if (track.kind === 'caption' || track.kind === 'video') {
		target = Math.max(0, Math.min(targetIndex, visualTrackCount));
	} else {
		// audio track
		target = Math.max(visualTrackCount, Math.min(targetIndex, tracks.length));
	}
	tracks.splice(target, 0, track);
	return { ...project, tracks };
}

export function renameTrack(project: Project, trackId: TrackId, name: string): Project {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Track name cannot be empty.');
	if (trimmed.length > 80) throw new Error('Track name must be 80 characters or fewer.');
	if (!project.tracks.some((track) => track.id === trackId)) throw new TrackNotFoundError(trackId);
	return {
		...project,
		tracks: project.tracks.map((track) =>
			track.id === trackId ? { ...track, name: trimmed } : track
		)
	};
}

export function setTrackFlags(
	project: Project,
	trackId: TrackId,
	flags: Partial<Pick<Track, 'muted' | 'locked' | 'hidden'>>
): Project {
	if (!project.tracks.some((track) => track.id === trackId)) throw new TrackNotFoundError(trackId);
	return {
		...project,
		tracks: project.tracks.map((track) => (track.id === trackId ? { ...track, ...flags } : track))
	};
}

export function setTrackHeight(project: Project, trackId: TrackId, height: number): Project {
	if (!project.tracks.some((track) => track.id === trackId)) throw new TrackNotFoundError(trackId);
	const clamped = Math.max(48, Math.min(240, Math.round(height)));
	return {
		...project,
		tracks: project.tracks.map((track) =>
			track.id === trackId ? { ...track, height: clamped } : track
		)
	};
}

export function setClipLink(project: Project, clipId: string, linkId?: string): Project {
	let found = false;
	const tracks = project.tracks.map((track) => ({
		...track,
		clips: track.clips.map((clip) => {
			if (clip.id !== clipId) return clip;
			found = true;
			const next = { ...clip };
			delete next.linkId;
			return linkId ? { ...next, linkId } : next;
		})
	}));
	if (!found) throw new Error(`Clip “${clipId}” does not exist.`);
	return { ...project, tracks };
}
