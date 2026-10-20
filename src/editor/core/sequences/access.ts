import type { Clip, ClipId, Project, ProjectSettings, Sequence, SequenceId } from '../types';

export const ROOT_SEQUENCE_ID = 'root' as SequenceId;

/**
 * Check whether a sequence id is the root sequence.
 */
export function isRootSequence(id: SequenceId | string | undefined | null): boolean {
	return !id || id === ROOT_SEQUENCE_ID;
}

/**
 * Get sequence by ID from project. Returns undefined if not found or if ROOT_SEQUENCE_ID.
 */
export function getSequence(project: Project, id: SequenceId): Sequence | undefined {
	if (isRootSequence(id)) return undefined;
	return project.sequences?.[id];
}

/**
 * Produce a virtual Project view projecting the specified sequence as the active project.
 * - If sequenceId is root (or undefined), returns the project directly.
 * - Otherwise returns a shallow-cloned Project whose tracks, markers, and settings are projected
 *   from the sequence (inheriting project settings if sequence has no custom settings).
 */
export function viewProject(project: Project, sequenceId: SequenceId): Project {
	if (isRootSequence(sequenceId)) {
		return project;
	}

	const sequence = getSequence(project, sequenceId);
	if (!sequence) {
		return project;
	}

	const settings: ProjectSettings = sequence.settings
		? { ...project.settings, ...sequence.settings }
		: project.settings;

	return {
		...project,
		settings,
		tracks: sequence.tracks,
		markers: sequence.markers ? [...sequence.markers] : []
	};
}

/**
 * Apply a pure Project -> Project operation to a sequence (or root) and write the resulting tracks back.
 * Guarantees that any operation designed for Project works seamlessly on nested sequences.
 */
export function applyToSequence(
	project: Project,
	sequenceId: SequenceId,
	operation: (view: Project) => Project
): Project {
	if (isRootSequence(sequenceId)) {
		return operation(project);
	}

	const view = viewProject(project, sequenceId);
	const updatedView = operation(view);

	const sequence = getSequence(project, sequenceId);
	if (!sequence) {
		throw new Error(`Sequence "${sequenceId}" not found in project.`);
	}

	const updatedSequence: Sequence = {
		...sequence,
		settings: sequence.settings,
		tracks: updatedView.tracks,
		markers: updatedView.markers
	};

	return {
		...project,
		assets: updatedView.assets,
		sequences: {
			...project.sequences,
			[sequenceId]: updatedSequence
		}
	};
}

/**
 * Find a clip among the tracks of one sequence (or the root). A clip that lives in a different
 * sequence is not found, which keeps editing surfaces from touching the wrong timeline.
 */
export function findClipInSequence(
	project: Project,
	sequenceId: SequenceId,
	clipId: ClipId
): Clip | null {
	for (const track of viewProject(project, sequenceId).tracks) {
		const clip = track.clips.find((candidate) => candidate.id === clipId);
		if (clip) return clip;
	}
	return null;
}
