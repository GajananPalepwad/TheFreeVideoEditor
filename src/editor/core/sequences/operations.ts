import { clipEnd } from '../timeline';
import type { Clip, ClipId, Project, ProjectSettings, Sequence, SequenceId, Track } from '../types';
import { getSequence, isRootSequence, ROOT_SEQUENCE_ID, viewProject } from './access';

export const MAX_SEQUENCE_NESTING_DEPTH = 8;

export class SequenceCycleError extends Error {
	constructor(message = 'Nesting this sequence would create a circular dependency.') {
		super(message);
		this.name = 'SequenceCycleError';
	}
}

export class SequenceDepthError extends Error {
	constructor(
		message = `Sequence nesting exceeds maximum allowed depth of ${MAX_SEQUENCE_NESTING_DEPTH}.`
	) {
		super(message);
		this.name = 'SequenceDepthError';
	}
}

export class SequenceNotFoundError extends Error {
	constructor(sequenceId: string) {
		super(`Sequence "${sequenceId}" does not exist in project.`);
		this.name = 'SequenceNotFoundError';
	}
}

/**
 * Returns the maximum nesting depth under a given sequence.
 */
export function getSequenceDepth(
	project: Project,
	sequenceId: SequenceId,
	visited = new Set<SequenceId>()
): number {
	if (visited.has(sequenceId)) return Infinity;
	visited.add(sequenceId);

	const tracks = isRootSequence(sequenceId)
		? project.tracks
		: (project.sequences?.[sequenceId]?.tracks ?? []);

	let maxChildDepth = 0;
	for (const track of tracks) {
		for (const clip of track.clips) {
			if (clip.source?.type === 'sequence') {
				const childSeqId = clip.source.sequenceId;
				const childDepth = getSequenceDepth(project, childSeqId, new Set(visited));
				if (childDepth === Infinity) return Infinity;
				maxChildDepth = Math.max(maxChildDepth, 1 + childDepth);
			}
		}
	}
	return maxChildDepth;
}

/**
 * Returns the depth of targetId reachable from root.
 */
export function getDepthFromRoot(
	project: Project,
	targetId: SequenceId,
	current: SequenceId = ROOT_SEQUENCE_ID,
	depth = 0,
	visited = new Set<SequenceId>()
): number {
	if (current === targetId) return depth;
	if (visited.has(current)) return -1;
	visited.add(current);
	const tracks = isRootSequence(current)
		? project.tracks
		: (project.sequences?.[current]?.tracks ?? []);
	let maxDepth = -1;
	for (const track of tracks) {
		for (const clip of track.clips) {
			if (clip.source?.type === 'sequence') {
				const d = getDepthFromRoot(
					project,
					targetId,
					clip.source.sequenceId,
					depth + 1,
					new Set(visited)
				);
				if (d > maxDepth) maxDepth = d;
			}
		}
	}
	return maxDepth;
}

/**
 * Checks if adding targetSequenceId into hostSequenceId would create a cycle or exceed depth limit.
 */
export function wouldCreateCycle(
	project: Project,
	hostSequenceId: SequenceId,
	targetSequenceId: SequenceId
): boolean {
	// Directly inserting sequence into itself
	if (hostSequenceId === targetSequenceId) return true;

	// Target sequence cannot be root
	if (isRootSequence(targetSequenceId)) return true;

	// Check if targetSequence transitively references hostSequenceId
	const targetSeq = project.sequences?.[targetSequenceId];
	if (!targetSeq) return false;

	const queue: SequenceId[] = [targetSequenceId];
	const visited = new Set<SequenceId>();

	while (queue.length > 0) {
		const currentId = queue.shift()!;
		if (currentId === hostSequenceId) return true;
		if (visited.has(currentId)) continue;
		visited.add(currentId);

		const seq = project.sequences?.[currentId];
		if (!seq) continue;

		for (const track of seq.tracks) {
			for (const clip of track.clips) {
				if (clip.source?.type === 'sequence') {
					if (clip.source.sequenceId === hostSequenceId) return true;
					queue.push(clip.source.sequenceId);
				}
			}
		}
	}

	return false;
}

/**
 * Calculate the total duration of a sequence (or root) in integer microseconds.
 */
export function sequenceDuration(project: Project, sequenceId: SequenceId): number {
	const view = viewProject(project, sequenceId);
	return view.tracks.reduce((duration, track) => {
		const clipMax = track.clips.reduce((latest, clip) => Math.max(latest, clipEnd(clip)), duration);
		return (track.captions ?? []).reduce((latest, cap) => Math.max(latest, cap.end), clipMax);
	}, 0);
}

/**
 * Check if a sequence is referenced anywhere as a clip source.
 */
export function getSequenceUsage(
	project: Project,
	sequenceId: SequenceId
): Array<{ sequenceId: SequenceId; trackId: Track['id']; clip: Clip }> {
	const usage: Array<{ sequenceId: SequenceId; trackId: Track['id']; clip: Clip }> = [];

	// Root tracks
	for (const track of project.tracks) {
		for (const clip of track.clips) {
			if (clip.source?.type === 'sequence' && clip.source.sequenceId === sequenceId) {
				usage.push({ sequenceId: ROOT_SEQUENCE_ID, trackId: track.id, clip });
			}
		}
	}

	// Other sequences
	for (const [seqId, seq] of Object.entries(project.sequences ?? {})) {
		for (const track of seq.tracks) {
			for (const clip of track.clips) {
				if (clip.source?.type === 'sequence' && clip.source.sequenceId === sequenceId) {
					usage.push({ sequenceId: seqId as SequenceId, trackId: track.id, clip });
				}
			}
		}
	}

	return usage;
}

function randomId(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
		const random = Math.floor(Math.random() * 16);
		const value = character === 'x' ? random : (random & 0x3) | 0x8;
		return value.toString(16);
	});
}

function makeTrack(id: Track['id'], kind: Track['kind'], name: string): Track {
	return {
		id,
		kind,
		name,
		muted: false,
		locked: false,
		hidden: false,
		clips: []
	};
}

/**
 * Creates a new empty sequence in the project.
 */
export function createSequence(
	project: Project,
	name: string,
	settings?: ProjectSettings
): { project: Project; sequenceId: SequenceId } {
	const trimmedName = name.trim();
	if (!trimmedName) throw new Error('Sequence name cannot be empty.');

	const sequenceId = randomId() as SequenceId;
	const tracks: Track[] = [
		makeTrack(randomId() as Track['id'], 'video', 'Video 1'),
		makeTrack(randomId() as Track['id'], 'audio', 'Audio 1')
	];

	const sequence: Sequence = {
		id: sequenceId,
		name: trimmedName,
		...(settings ? { settings } : {}),
		tracks
	};

	return {
		project: {
			...project,
			sequences: {
				...project.sequences,
				[sequenceId]: sequence
			}
		},
		sequenceId
	};
}

/**
 * Duplicates an existing sequence with new IDs for sequence, tracks, clips, and transitions.
 */
export function duplicateSequence(
	project: Project,
	sequenceId: SequenceId
): { project: Project; newSequenceId: SequenceId } {
	const source = getSequence(project, sequenceId);
	if (!source) throw new SequenceNotFoundError(sequenceId);

	const newSequenceId = randomId() as SequenceId;
	const trackIdMap = new Map<string, string>();
	const clipIdMap = new Map<string, string>();
	const linkIdMap = new Map<string, string>();

	for (const track of source.tracks) {
		trackIdMap.set(track.id, randomId());
		for (const clip of track.clips) {
			clipIdMap.set(clip.id, randomId());
			if (clip.linkId && !linkIdMap.has(clip.linkId)) {
				linkIdMap.set(clip.linkId, randomId());
			}
		}
	}

	const clonedTracks: Track[] = source.tracks.map((track) => ({
		...track,
		id: trackIdMap.get(track.id) as Track['id'],
		clips: track.clips.map((clip) => ({
			...clip,
			id: clipIdMap.get(clip.id) as ClipId,
			...(clip.linkId ? { linkId: linkIdMap.get(clip.linkId) } : {}),
			effects: clip.effects?.map((eff) => ({ ...eff, id: randomId() })),
			masks: clip.masks?.map((m) => ({ ...m, id: randomId() }))
		})),
		transitions: track.transitions?.map((tr) => ({
			...tr,
			id: randomId(),
			edge:
				tr.edge.kind === 'cut'
					? {
							kind: 'cut' as const,
							fromClipId: (clipIdMap.get(tr.edge.fromClipId) ?? tr.edge.fromClipId) as ClipId,
							toClipId: (clipIdMap.get(tr.edge.toClipId) ?? tr.edge.toClipId) as ClipId
						}
					: {
							kind: tr.edge.kind,
							clipId: (clipIdMap.get(tr.edge.clipId) ?? tr.edge.clipId) as ClipId
						}
		}))
	}));

	const newSequence: Sequence = {
		id: newSequenceId,
		name: `${source.name} Copy`,
		...(source.settings ? { settings: { ...source.settings } } : {}),
		tracks: clonedTracks
	};

	return {
		project: {
			...project,
			sequences: {
				...project.sequences,
				[newSequenceId]: newSequence
			}
		},
		newSequenceId
	};
}

/**
 * Renames a sequence.
 */
export function renameSequence(project: Project, sequenceId: SequenceId, newName: string): Project {
	const trimmed = newName.trim();
	if (!trimmed) throw new Error('Sequence name cannot be empty.');
	const source = getSequence(project, sequenceId);
	if (!source) throw new SequenceNotFoundError(sequenceId);

	return {
		...project,
		sequences: {
			...project.sequences,
			[sequenceId]: {
				...source,
				name: trimmed
			}
		}
	};
}

/**
 * Deletes a sequence. If removeInstances is false and the sequence is used, throws an error with usage list.
 */
export function deleteSequence(
	project: Project,
	sequenceId: SequenceId,
	options: boolean | { removeInstances?: boolean } = false
): Project {
	const removeInstances = typeof options === 'boolean' ? options : !!options?.removeInstances;
	const source = getSequence(project, sequenceId);
	if (!source) throw new SequenceNotFoundError(sequenceId);

	const usage = getSequenceUsage(project, sequenceId);
	if (usage.length > 0 && !removeInstances) {
		throw new Error(
			`Sequence "${source.name}" is used by ${usage.length} clip(s) and cannot be deleted without removing its instances.`
		);
	}

	const filterClips = (tracks: Track[]): Track[] =>
		tracks.map((track) => ({
			...track,
			clips: track.clips.filter(
				(clip) => !(clip.source?.type === 'sequence' && clip.source.sequenceId === sequenceId)
			)
		}));

	const sequences = { ...project.sequences };
	delete sequences[sequenceId];

	const cleanedSequences = Object.fromEntries(
		Object.entries(sequences).map(([id, seq]) => [id, { ...seq, tracks: filterClips(seq.tracks) }])
	) as Record<SequenceId, Sequence>;

	return {
		...project,
		tracks: filterClips(project.tracks),
		sequences: cleanedSequences
	};
}

/**
 * Adds an instance of sequenceId into hostSequenceId at given time.
 * If sequence has video, an instance clip is placed on a video track.
 * If sequence has audio, an instance clip is placed on an audio track.
 * If both, they are linked by linkId.
 * Default duration = sequence duration (or 5s if empty), sourceIn = 0.
 */
export function addSequenceInstance(
	project: Project,
	hostSequenceId: SequenceId,
	sequenceId: SequenceId,
	time: number = 0,
	videoTrackId?: Track['id'],
	audioTrackId?: Track['id']
): { project: Project; videoClipId?: ClipId; audioClipId?: ClipId } {
	if (wouldCreateCycle(project, hostSequenceId, sequenceId)) {
		throw new SequenceCycleError();
	}
	const hostDepthFromRoot = isRootSequence(hostSequenceId)
		? 0
		: Math.max(0, getDepthFromRoot(project, hostSequenceId));
	const childDepth = getSequenceDepth(project, sequenceId);
	if (hostDepthFromRoot + 1 + childDepth > MAX_SEQUENCE_NESTING_DEPTH) {
		throw new SequenceDepthError();
	}

	const view = viewProject(project, hostSequenceId);
	const dur = sequenceDuration(project, sequenceId) || 5_000_000;

	// Check if target sequence has video / audio tracks
	const targetSeq = getSequence(project, sequenceId);
	const targetTracks = targetSeq?.tracks ?? [];
	const hasVideoTracks = targetTracks.length === 0 || targetTracks.some((t) => t.kind === 'video');
	const hasAudioTracks = targetTracks.some((t) => t.kind === 'audio');

	let vTrackId = videoTrackId;
	if (!vTrackId && hasVideoTracks) {
		vTrackId = view.tracks.find((t) => t.kind === 'video')?.id;
	}

	let aTrackId = audioTrackId;
	if (!aTrackId && hasAudioTracks) {
		aTrackId = view.tracks.find((t) => t.kind === 'audio')?.id;
	}

	const linkId = vTrackId && aTrackId ? (randomId() as string) : undefined;
	let videoClipId: ClipId | undefined;
	let audioClipId: ClipId | undefined;

	const updatedTracks = [...view.tracks];

	if (vTrackId) {
		videoClipId = randomId() as ClipId;
		const vClip: Clip = {
			id: videoClipId,
			start: time,
			duration: dur,
			sourceIn: 0,
			sourceOut: dur,
			speed: 1,
			volume: 1,
			...(linkId ? { linkId } : {}),
			source: {
				type: 'sequence',
				sequenceId
			}
		};
		const trackIdx = updatedTracks.findIndex((t) => t.id === vTrackId);
		if (trackIdx !== -1) {
			updatedTracks[trackIdx] = {
				...updatedTracks[trackIdx]!,
				clips: [...updatedTracks[trackIdx]!.clips, vClip]
			};
		}
	}

	if (aTrackId) {
		audioClipId = randomId() as ClipId;
		const aClip: Clip = {
			id: audioClipId,
			start: time,
			duration: dur,
			sourceIn: 0,
			sourceOut: dur,
			speed: 1,
			volume: 1,
			...(linkId ? { linkId } : {}),
			source: {
				type: 'sequence',
				sequenceId
			}
		};
		const trackIdx = updatedTracks.findIndex((t) => t.id === aTrackId);
		if (trackIdx !== -1) {
			updatedTracks[trackIdx] = {
				...updatedTracks[trackIdx]!,
				clips: [...updatedTracks[trackIdx]!.clips, aClip]
			};
		}
	}

	let finalProject: Project;
	if (isRootSequence(hostSequenceId)) {
		finalProject = { ...project, tracks: updatedTracks };
	} else {
		finalProject = {
			...project,
			sequences: {
				...project.sequences,
				[hostSequenceId]: {
					...project.sequences![hostSequenceId]!,
					tracks: updatedTracks
				}
			}
		};
	}

	return {
		project: finalProject,
		videoClipId,
		audioClipId
	};
}

/**
 * Nests selected clips in activeSequenceId into a new sequence, and replaces them with an instance clip.
 * Preserves track kinds/order, shifts times so earliest start is 0, preserves linkIds, effects, masks, keyframes.
 * If audio is involved, creates a linked audio instance clip.
 */
export function nestSelection(
	project: Project,
	activeSequenceId: SequenceId,
	clipIds: ClipId[],
	sequenceName?: string
): {
	project: Project;
	newSequenceId: SequenceId;
	videoInstanceClipId?: ClipId;
	audioInstanceClipId?: ClipId;
} {
	if (clipIds.length === 0) {
		throw new Error('Cannot nest an empty selection.');
	}

	const hostView = viewProject(project, activeSequenceId);
	const selectedSet = new Set(clipIds);

	// Collect selected clips and their tracks
	const involvedTracks: Array<{ track: Track; clips: Clip[] }> = [];
	let earliestStart = Infinity;
	let latestEnd = 0;
	let hasVideo = false;
	let hasAudio = false;

	for (const track of hostView.tracks) {
		const matched = track.clips.filter((c) => selectedSet.has(c.id));
		if (matched.length > 0) {
			involvedTracks.push({ track, clips: matched });
			for (const c of matched) {
				if (c.start < earliestStart) earliestStart = c.start;
				if (c.start + c.duration > latestEnd) latestEnd = c.start + c.duration;
				if (track.kind === 'video') hasVideo = true;
				if (track.kind === 'audio') hasAudio = true;
			}
		}
	}

	if (involvedTracks.length === 0) {
		throw new Error('None of the selected clips were found in the active sequence.');
	}

	const newSequenceId = randomId() as SequenceId;
	const name =
		sequenceName?.trim() || `Nested Sequence ${Object.keys(project.sequences ?? {}).length + 1}`;

	// Build nested tracks with times shifted so earliestStart becomes 0
	const nestedTracks: Track[] = involvedTracks.map(({ track, clips }) => ({
		id: randomId() as Track['id'],
		kind: track.kind,
		name: track.name,
		muted: track.muted,
		locked: track.locked,
		hidden: track.hidden,
		clips: clips.map((c) => ({
			...c,
			start: c.start - earliestStart
		})),
		transitions: track.transitions
			?.filter((tr) => {
				const edge = tr.edge;
				if (edge.kind === 'cut') {
					return selectedSet.has(edge.fromClipId) && selectedSet.has(edge.toClipId);
				}
				return selectedSet.has(edge.clipId);
			})
			.map((tr) => ({ ...tr, id: randomId() }))
	}));

	const nestedSeq: Sequence = {
		id: newSequenceId,
		name,
		tracks: nestedTracks
	};

	const instanceDuration = latestEnd - earliestStart;
	const linkId = hasVideo && hasAudio ? randomId() : undefined;

	let videoInstanceClipId: ClipId | undefined;
	let audioInstanceClipId: ClipId | undefined;

	// Remove selected clips and transitions referencing them from host tracks
	// Insert instance clips on the topmost involved video track and first suitable audio track
	let videoInserted = false;
	let audioInserted = false;

	const newHostTracks: Track[] = hostView.tracks.map((track) => {
		const remainingClips = track.clips.filter((c) => !selectedSet.has(c.id));
		const remainingTransitions = track.transitions?.filter((tr) => {
			const edge = tr.edge;
			if (edge.kind === 'cut') {
				return !selectedSet.has(edge.fromClipId) && !selectedSet.has(edge.toClipId);
			}
			return !selectedSet.has(edge.clipId);
		});

		if (
			hasVideo &&
			!videoInserted &&
			track.kind === 'video' &&
			involvedTracks.some((t) => t.track.id === track.id)
		) {
			videoInserted = true;
			videoInstanceClipId = randomId() as ClipId;
			const vClip: Clip = {
				id: videoInstanceClipId,
				start: earliestStart,
				duration: instanceDuration,
				sourceIn: 0,
				sourceOut: instanceDuration,
				speed: 1,
				volume: 1,
				...(linkId ? { linkId } : {}),
				source: {
					type: 'sequence',
					sequenceId: newSequenceId
				}
			};
			return {
				...track,
				clips: [...remainingClips, vClip],
				transitions: remainingTransitions
			};
		}

		if (
			hasAudio &&
			!audioInserted &&
			track.kind === 'audio' &&
			(involvedTracks.some((t) => t.track.id === track.id) || true)
		) {
			audioInserted = true;
			audioInstanceClipId = randomId() as ClipId;
			const aClip: Clip = {
				id: audioInstanceClipId,
				start: earliestStart,
				duration: instanceDuration,
				sourceIn: 0,
				sourceOut: instanceDuration,
				speed: 1,
				volume: 1,
				...(linkId ? { linkId } : {}),
				source: {
					type: 'sequence',
					sequenceId: newSequenceId
				}
			};
			return {
				...track,
				clips: [...remainingClips, aClip],
				transitions: remainingTransitions
			};
		}

		return {
			...track,
			clips: remainingClips,
			transitions: remainingTransitions
		};
	});

	// If audio needed to be inserted but no suitable audio track was matched in map, insert into first audio track
	if (hasAudio && !audioInserted) {
		const audioTrackIdx = newHostTracks.findIndex((t) => t.kind === 'audio');
		if (audioTrackIdx !== -1) {
			audioInserted = true;
			audioInstanceClipId = randomId() as ClipId;
			const aClip: Clip = {
				id: audioInstanceClipId,
				start: earliestStart,
				duration: instanceDuration,
				sourceIn: 0,
				sourceOut: instanceDuration,
				speed: 1,
				volume: 1,
				...(linkId ? { linkId } : {}),
				source: {
					type: 'sequence',
					sequenceId: newSequenceId
				}
			};
			newHostTracks[audioTrackIdx] = {
				...newHostTracks[audioTrackIdx]!,
				clips: [...newHostTracks[audioTrackIdx]!.clips, aClip]
			};
		}
	}

	const updatedSequences: Record<SequenceId, Sequence> = {
		...project.sequences,
		[newSequenceId]: nestedSeq
	};

	let finalProject: Project;
	if (isRootSequence(activeSequenceId)) {
		finalProject = {
			...project,
			tracks: newHostTracks,
			sequences: updatedSequences
		};
	} else {
		finalProject = {
			...project,
			sequences: {
				...updatedSequences,
				[activeSequenceId]: {
					...updatedSequences[activeSequenceId]!,
					tracks: newHostTracks
				}
			}
		};
	}

	return {
		project: finalProject,
		newSequenceId,
		videoInstanceClipId,
		audioInstanceClipId
	};
}

/**
 * Inverse of nestSelection: unpacks the sequence instance clip into the host timeline.
 * Disabled/throws if clip speed != 1 or has timeRemap.
 */
export function expandSequenceInstance(
	project: Project,
	activeSequenceId: SequenceId,
	instanceClipId: ClipId
): Project {
	const hostView = viewProject(project, activeSequenceId);
	let hostTrack: Track | undefined;
	let hostClip: Clip | undefined;

	for (const t of hostView.tracks) {
		const c = t.clips.find((item) => item.id === instanceClipId);
		if (c) {
			hostTrack = t;
			hostClip = c;
			break;
		}
	}

	if (!hostTrack || !hostClip) {
		throw new Error(`Instance clip "${instanceClipId}" not found in active sequence.`);
	}

	if (hostClip.source?.type !== 'sequence') {
		throw new Error('Clip is not a sequence instance.');
	}

	if (hostClip.speed !== 1 || hostClip.timeRemap) {
		throw new Error('Cannot expand sequence instance with remapped speed or speed curve.');
	}

	const nestedSeq = getSequence(project, hostClip.source.sequenceId);
	if (!nestedSeq) {
		throw new SequenceNotFoundError(hostClip.source.sequenceId);
	}

	const shift = hostClip.start - hostClip.sourceIn;
	const instanceStart = hostClip.start;
	const instanceEnd = hostClip.start + hostClip.duration;

	// Match or create tracks in host timeline
	const updatedHostTracks = [...hostView.tracks];
	const clipIdMap = new Map<string, string>();
	const linkIdMap = new Map<string, string>();

	// Every nested track keeps its own host track so no layer is merged into another. The first
	// nested track of the instance's kind takes the instance's track; the others are inserted right
	// below it in their original order, which keeps the stacking order and avoids overlaps.
	const takenKinds = new Set<Track['kind']>();
	let insertAfter = updatedHostTracks.findIndex((t) => t.id === hostTrack!.id);

	for (const nTrack of nestedSeq.tracks) {
		const firstOfKind = !takenKinds.has(nTrack.kind);
		takenKinds.add(nTrack.kind);
		let targetHostTrack: Track | undefined;
		if (firstOfKind && nTrack.kind === hostTrack.kind) {
			targetHostTrack = hostTrack;
		} else if (firstOfKind) {
			targetHostTrack = updatedHostTracks.find((t) => t.kind === nTrack.kind);
		}
		if (!targetHostTrack) {
			targetHostTrack = makeTrack(
				randomId() as Track['id'],
				nTrack.kind,
				`${nTrack.name} (Expanded)`
			);
			if (nTrack.kind === hostTrack.kind) {
				insertAfter += 1;
				updatedHostTracks.splice(insertAfter, 0, targetHostTrack);
			} else {
				updatedHostTracks.push(targetHostTrack);
			}
		}

		// Insert trimmed shifted clips into targetHostTrack
		const expandedClips: Clip[] = [];
		for (const c of nTrack.clips) {
			const shiftedStart = c.start + shift;
			const shiftedEnd = shiftedStart + c.duration;
			if (shiftedEnd <= instanceStart || shiftedStart >= instanceEnd) {
				continue; // Outside window
			}

			const inClipStart = Math.max(instanceStart, shiftedStart);
			const inClipEnd = Math.min(instanceEnd, shiftedEnd);
			const duration = inClipEnd - inClipStart;
			const trimHead = inClipStart - shiftedStart;
			const sourceIn = c.sourceIn + trimHead;
			const sourceOut = sourceIn + duration;

			const newId = randomId() as ClipId;
			clipIdMap.set(c.id, newId);
			if (c.linkId && !linkIdMap.has(c.linkId)) {
				linkIdMap.set(c.linkId, randomId());
			}

			expandedClips.push({
				...c,
				id: newId,
				start: inClipStart,
				duration,
				sourceIn,
				sourceOut,
				...(c.linkId ? { linkId: linkIdMap.get(c.linkId) } : {})
			});
		}

		// Replace targetHostTrack in updatedHostTracks
		const idx = updatedHostTracks.findIndex((t) => t.id === targetHostTrack!.id);
		const filteredExisting = targetHostTrack.clips.filter((c) => c.id !== instanceClipId);
		updatedHostTracks[idx] = {
			...targetHostTrack,
			clips: [...filteredExisting, ...expandedClips]
		};
	}

	// Remove instanceClipId if not already removed
	const hostTrackIdx = updatedHostTracks.findIndex((t) => t.id === hostTrack!.id);
	if (hostTrackIdx !== -1) {
		updatedHostTracks[hostTrackIdx] = {
			...updatedHostTracks[hostTrackIdx]!,
			clips: updatedHostTracks[hostTrackIdx]!.clips.filter((c) => c.id !== instanceClipId)
		};
	}

	if (isRootSequence(activeSequenceId)) {
		return { ...project, tracks: updatedHostTracks };
	} else {
		return {
			...project,
			sequences: {
				...project.sequences,
				[activeSequenceId]: {
					...project.sequences![activeSequenceId]!,
					tracks: updatedHostTracks
				}
			}
		};
	}
}

/**
 * Duplicates the sequence underlying an instance clip and relinks the instance to the copy.
 */
/**
 * Duplicates the sequence underlying an instance clip and relinks the instance (and any linked companion) to the copy.
 */
export function makeInstanceUnique(
	project: Project,
	activeSequenceIdOrClipId: SequenceId | ClipId,
	maybeClipId?: ClipId
): { project: Project; newSequenceId: SequenceId } {
	let activeSequenceId: SequenceId;
	let clipId: ClipId;

	if (maybeClipId) {
		activeSequenceId = activeSequenceIdOrClipId as SequenceId;
		clipId = maybeClipId;
	} else {
		clipId = activeSequenceIdOrClipId as ClipId;
		// Find which sequence contains clipId
		let foundSeqId: SequenceId | undefined;
		if (project.tracks.some((t) => t.clips.some((c) => c.id === clipId))) {
			foundSeqId = ROOT_SEQUENCE_ID;
		} else {
			for (const [sId, s] of Object.entries(project.sequences ?? {})) {
				if (s.tracks.some((t) => t.clips.some((c) => c.id === clipId))) {
					foundSeqId = sId as SequenceId;
					break;
				}
			}
		}
		if (!foundSeqId) throw new Error(`Clip "${clipId}" not found in project.`);
		activeSequenceId = foundSeqId;
	}

	const hostView = viewProject(project, activeSequenceId);
	let targetClip: Clip | undefined;

	for (const t of hostView.tracks) {
		const c = t.clips.find((item) => item.id === clipId);
		if (c) {
			targetClip = c;
			break;
		}
	}

	if (!targetClip || targetClip.source?.type !== 'sequence') {
		throw new Error('Clip is not a sequence instance.');
	}

	const oldSeqId = targetClip.source.sequenceId;
	const { project: duplicatedProject, newSequenceId } = duplicateSequence(project, oldSeqId);

	// Rename duplicated sequence to "${originalName} (Unique)"
	const origSeq = getSequence(project, oldSeqId);
	const uniqueName = origSeq ? `${origSeq.name} (Unique)` : 'Sequence (Unique)';
	const withRenamed = renameSequence(duplicatedProject, newSequenceId, uniqueName);

	// Update host clip (and linked companions) to point to newSequenceId
	const targetLink = targetClip.linkId;
	const updateClipSource = (tracks: Track[]): Track[] =>
		tracks.map((t) => ({
			...t,
			clips: t.clips.map((c) => {
				const isTarget = c.id === clipId;
				const isCompanion =
					targetLink &&
					c.linkId === targetLink &&
					c.source?.type === 'sequence' &&
					c.source.sequenceId === oldSeqId;
				if ((isTarget || isCompanion) && c.source?.type === 'sequence') {
					return { ...c, source: { ...c.source, sequenceId: newSequenceId } };
				}
				return c;
			})
		}));

	if (isRootSequence(activeSequenceId)) {
		return {
			project: {
				...withRenamed,
				tracks: updateClipSource(withRenamed.tracks)
			},
			newSequenceId
		};
	} else {
		return {
			project: {
				...withRenamed,
				sequences: {
					...withRenamed.sequences,
					[activeSequenceId]: {
						...withRenamed.sequences![activeSequenceId]!,
						tracks: updateClipSource(withRenamed.sequences![activeSequenceId]!.tracks)
					}
				}
			},
			newSequenceId
		};
	}
}

/**
 * Pure interchange flattening: expands sequence instances with speed 1/no remap into host timeline,
 * skips others with warnings.
 */
export function flattenForInterchange(project: Project): { project: Project; omissions: string[] } {
	const omissions: string[] = [];
	let flattened = structuredClone(project);

	// Expand sequence instances in root timeline
	let found = true;
	let passes = 0;
	while (found && passes < 20) {
		passes += 1;
		found = false;
		for (const track of flattened.tracks) {
			for (const clip of track.clips) {
				if (clip.source?.type === 'sequence') {
					if (clip.speed !== 1 || clip.timeRemap) {
						omissions.push(
							`Sequence instance "${clip.id}" has speed ${clip.speed} or time remap and was omitted from interchange flattening.`
						);
					} else {
						try {
							flattened = expandSequenceInstance(flattened, ROOT_SEQUENCE_ID, clip.id);
							found = true;
							break;
						} catch (err: unknown) {
							omissions.push(
								`Failed to expand sequence instance "${clip.id}": ${err instanceof Error ? err.message : String(err)}`
							);
						}
					}
				}
			}
			if (found) break;
		}
	}

	const remainingInstances = flattened.tracks.some((t) =>
		t.clips.some((c) => c.source?.type === 'sequence')
	);
	if (!remainingInstances) {
		delete flattened.sequences;
	}

	return { project: flattened, omissions };
}
