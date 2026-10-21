import type { Asset, Clip, ClipId, Project, Time, Track, Transition } from './types';
import { clipEnd } from './timeline';
import { framesToTicks } from './time';
import { sourceExtent } from './timeRemap';

export type TransitionAlignment = 'center' | 'start' | 'end';
export type TransitionEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
export type AudioCrossfadeCurve = 'equalPower' | 'linear';

/** Check whether transitions are enabled (enabled by default; can be disabled with ?labs=-transitions or ?labs=no-transitions). */
export function isTransitionsEnabled(search?: string): boolean {
	const query = search ?? (typeof window !== 'undefined' ? window.location?.search : '');
	if (!query) return true;
	const params = new URLSearchParams(query);
	const labs = params.get('labs');
	if (labs) {
		const items = labs.split(',');
		if (
			items.includes('no-transitions') ||
			items.includes('-transitions') ||
			items.includes('off')
		) {
			return false;
		}
	}
	return true;
}

export interface TransitionWindow {
	/** Start time on timeline (microseconds) */
	start: Time;
	/** End time on timeline (microseconds) */
	end: Time;
	/** Duration on timeline (microseconds) */
	duration: Time;
	/** Cut point time on timeline (microseconds) */
	cutTime: Time;
}

export interface AvailableHandles {
	/** Available outgoing handle for clip A (microseconds beyond sourceOut) */
	handleA: Time;
	/** Available incoming handle for clip B (microseconds before sourceIn) */
	handleB: Time;
	/** Maximum possible duration the transition can have based on handles and clip duration */
	maxDuration: Time;
	/** Whether handles are insufficient for the requested duration */
	hasInsufficientHandles: boolean;
}

/**
 * Calculates the timeline window [start, end] for a transition given its cut point, duration, and alignment.
 * - center: centered on cut point [cutTime - duration/2, cutTime + duration/2]
 * - start: starts at cut point [cutTime, cutTime + duration]
 * - end: ends at cut point [cutTime - duration, cutTime]
 */
export function transitionWindow(
	cutTime: Time,
	duration: Time,
	alignment: TransitionAlignment
): TransitionWindow {
	let start: Time;
	let end: Time;

	switch (alignment) {
		case 'start':
			start = cutTime;
			end = cutTime + duration;
			break;
		case 'end':
			start = cutTime - duration;
			end = cutTime;
			break;
		case 'center':
		default: {
			const half = Math.floor(duration / 2);
			start = cutTime - half;
			end = start + duration;
			break;
		}
	}

	return {
		start,
		end,
		duration,
		cutTime
	};
}

/**
 * Calculates available head/tail handles for two clips meeting at a cut.
 * Clip A needs tail handle (media after sourceOut).
 * Clip B needs head handle (media before sourceIn).
 * For non-asset clips (solids, adjustment, generators), handles are infinite (or unbounded).
 */
export function availableHandles(
	clipA: Clip,
	clipB: Clip,
	assetA: Asset | undefined,
	assetB: Asset | undefined,
	project: Project
): AvailableHandles {
	// Head handle for A is not relevant for the cut, we need tail handle for A:
	// tail handle = assetA.duration - clipA.sourceOut (scaled by speed if needed)
	let handleA: Time = Number.MAX_SAFE_INTEGER;
	if (clipA.assetId && assetA && assetA.duration > 0) {
		const extentA = sourceExtent(clipA);
		handleA = Math.max(0, Math.floor((assetA.duration - extentA.max) / (clipA.speed || 1)));
	}

	// Head handle for B: media before sourceIn
	let handleB: Time = Number.MAX_SAFE_INTEGER;
	if (clipB.assetId && assetB) {
		const extentB = sourceExtent(clipB);
		handleB = Math.max(0, Math.floor(extentB.min / (clipB.speed || 1)));
	}

	// In addition, clips cannot transition longer than their actual timeline duration
	const maxFromClips = Math.min(clipA.duration, clipB.duration) * 2;
	const minFrameDuration = framesToTicks(2, project.settings.fps);

	// The max duration with handles:
	// In center alignment, duration needs duration/2 from A and duration/2 from B.
	// So maxDurationCenter = 2 * min(handleA, handleB, clipA.duration, clipB.duration).
	const maxHandleA = handleA === Number.MAX_SAFE_INTEGER ? clipA.duration : handleA;
	const maxHandleB = handleB === Number.MAX_SAFE_INTEGER ? clipB.duration : handleB;
	const maxDuration = Math.max(
		minFrameDuration,
		Math.min(
			maxFromClips,
			2 * Math.min(maxHandleA, maxHandleB) + Math.min(clipA.duration, clipB.duration)
		)
	);

	return {
		handleA,
		handleB,
		maxDuration,
		hasInsufficientHandles: false
	};
}

/**
 * Validates and clamps transition duration to valid limits:
 * - At least 2 frames (minimum required to interpolate)
 * - Cannot exceed the duration of either clip adjacent to the cut
 */
export function clampTransitionDuration(
	duration: Time,
	clipA: Clip,
	clipB: Clip | undefined,
	alignment: TransitionAlignment,
	fps: number
): Time {
	const minDuration = Math.max(1, framesToTicks(2, fps));
	let maxAllowed: Time;

	if (!clipB) {
		// Head or tail single-clip fade
		maxAllowed = clipA.duration;
	} else {
		// Cut transition
		if (alignment === 'center') {
			maxAllowed = Math.min(clipA.duration, clipB.duration) * 2;
		} else if (alignment === 'start') {
			maxAllowed = clipB.duration;
		} else {
			// 'end'
			maxAllowed = clipA.duration;
		}
	}

	return Math.max(minDuration, Math.min(duration, maxAllowed));
}

/**
 * Checks whether the available media handles cover the transition window.
 * Returns true if handles are sufficient, false if handles are insufficient (warning condition).
 */
export function checkHandlesSufficient(
	transition: Transition,
	clipA: Clip,
	clipB: Clip | undefined,
	assetA: Asset | undefined,
	assetB: Asset | undefined
): boolean {
	if (transition.edge.kind === 'cut') {
		if (!clipB) return false;
		const win = transitionWindow(
			clipA.start + clipA.duration,
			transition.duration,
			transition.alignment
		);
		const neededA = win.end - (clipA.start + clipA.duration);
		const neededB = clipA.start + clipA.duration - win.start;

		if (clipA.assetId && assetA && assetA.duration > 0) {
			const extentA = sourceExtent(clipA);
			const availableA = Math.max(
				0,
				Math.floor((assetA.duration - extentA.max) / (clipA.speed || 1))
			);
			if (neededA > availableA) return false;
		}

		if (clipB.assetId && assetB) {
			const extentB = sourceExtent(clipB);
			const availableB = Math.max(0, Math.floor(extentB.min / (clipB.speed || 1)));
			if (neededB > availableB) return false;
		}
	}
	return true;
}

/**
 * Computes transition progress (0 to 1) at time t within window [start, end].
 */
export function transitionProgress(
	t: Time,
	window: TransitionWindow,
	easing: TransitionEasing = 'linear'
): number {
	if (t <= window.start) return 0;
	if (t >= window.end) return 1;
	const linearP = (t - window.start) / window.duration;

	switch (easing) {
		case 'easeIn':
			return linearP * linearP;
		case 'easeOut':
			return linearP * (2 - linearP);
		case 'easeInOut':
			return linearP < 0.5 ? 2 * linearP * linearP : -1 + (4 - 2 * linearP) * linearP;
		case 'linear':
		default:
			return linearP;
	}
}

/**
 * Computes audio crossfade gains [gainA, gainB] at time t within transition window.
 * - equalPower: gainA = cos(p * PI / 2), gainB = sin(p * PI / 2) -> gainA^2 + gainB^2 = 1 (constant acoustic power)
 * - linear: gainA = 1 - p, gainB = p -> gainA + gainB = 1 (constant amplitude)
 * `p` is the transition's eased progress, so the sound follows the same easing as the picture.
 */
export function transitionGain(
	t: Time,
	window: TransitionWindow,
	curve: AudioCrossfadeCurve = 'equalPower',
	easing: TransitionEasing = 'linear'
): { gainA: number; gainB: number } {
	const p = Math.max(0, Math.min(1, transitionProgress(t, window, easing)));

	if (curve === 'linear') {
		return {
			gainA: 1 - p,
			gainB: p
		};
	}

	// Equal-power crossfade (standard 3dB acoustic power sum)
	const angle = p * (Math.PI / 2);
	return {
		gainA: Math.cos(angle),
		gainB: Math.sin(angle)
	};
}

/**
 * Invariant:
 * 1. For any cut transition (fromClipId, toClipId), fromClip and toClip MUST exist on the track
 *    and MUST be adjacent (clipEnd(fromClip) === toClip.start).
 * 2. For head/tail transitions, clipId MUST exist.
 * 3. No two transitions may overlap on the same track or attach to the same cut/edge.
 * 4. Duration is clamped to >= 2 frames and valid boundaries.
 *
 * Normalizes a track's transitions array by removing invalid, orphaned, or non-adjacent transitions,
 * and resolving any overlapping transitions.
 */
export function normalizeTransitions(track: Track, fps = 30): Track {
	if (!track.transitions || track.transitions.length === 0) return track;

	const clipMap = new Map<ClipId, Clip>();
	for (const clip of track.clips) {
		clipMap.set(clip.id, clip);
	}

	const validTransitions: Transition[] = [];
	const seenCuts = new Set<string>();

	for (const trans of track.transitions) {
		if (trans.edge.kind === 'cut') {
			const clipA = clipMap.get(trans.edge.fromClipId);
			const clipB = clipMap.get(trans.edge.toClipId);
			if (!clipA || !clipB) continue; // orphaned clip

			// Must be adjacent (within 1 frame tolerance for microsecond rounding)
			const tolerance = framesToTicks(1, fps);
			if (Math.abs(clipEnd(clipA) - clipB.start) > tolerance) continue;

			const cutKey = `${clipA.id}:${clipB.id}`;
			if (seenCuts.has(cutKey)) continue; // duplicate transition on cut

			const clampedDur = clampTransitionDuration(
				trans.duration,
				clipA,
				clipB,
				trans.alignment,
				fps
			);
			validTransitions.push({
				...trans,
				duration: clampedDur
			});
			seenCuts.add(cutKey);
		} else if (trans.edge.kind === 'head') {
			const clip = clipMap.get(trans.edge.clipId);
			if (!clip) continue;
			const key = `head:${clip.id}`;
			if (seenCuts.has(key)) continue;

			const clampedDur = clampTransitionDuration(trans.duration, clip, undefined, 'start', fps);
			validTransitions.push({
				...trans,
				duration: clampedDur
			});
			seenCuts.add(key);
		} else if (trans.edge.kind === 'tail') {
			const clip = clipMap.get(trans.edge.clipId);
			if (!clip) continue;
			const key = `tail:${clip.id}`;
			if (seenCuts.has(key)) continue;

			const clampedDur = clampTransitionDuration(trans.duration, clip, undefined, 'end', fps);
			validTransitions.push({
				...trans,
				duration: clampedDur
			});
			seenCuts.add(key);
		}
	}

	// Check timeline collision between windows on the same track
	// Sort by window start time
	const sorted = validTransitions
		.map((tr) => {
			let cutTime = 0;
			if (tr.edge.kind === 'cut') {
				const cA = clipMap.get(tr.edge.fromClipId)!;
				cutTime = clipEnd(cA);
			} else if (tr.edge.kind === 'head') {
				const c = clipMap.get(tr.edge.clipId)!;
				cutTime = c.start;
			} else {
				const c = clipMap.get(tr.edge.clipId)!;
				cutTime = clipEnd(c);
			}
			const win = transitionWindow(cutTime, tr.duration, tr.alignment);
			return { transition: tr, window: win };
		})
		.sort((a, b) => a.window.start - b.window.start);

	const nonOverlapping: Transition[] = [];
	let lastEnd = -1;
	for (const item of sorted) {
		if (item.window.start < lastEnd) {
			// Overlap detected: clamp duration so it fits without overlapping previous transition
			const availableDuration = item.window.end - lastEnd;
			const minTwoFrames = framesToTicks(2, fps);
			if (availableDuration >= minTwoFrames) {
				nonOverlapping.push({
					...item.transition,
					duration: availableDuration
				});
				lastEnd = item.window.end;
			}
			// Otherwise dropped to preserve strict timeline separation
		} else {
			nonOverlapping.push(item.transition);
			lastEnd = item.window.end;
		}
	}

	return {
		...track,
		transitions: nonOverlapping
	};
}

/**
 * Normalizes all tracks in a project.
 */
export function normalizeProjectTransitions(project: Project): Project {
	let changed = false;
	const newTracks = project.tracks.map((track) => {
		const norm = normalizeTransitions(track, project.settings.fps);
		if (norm !== track) changed = true;
		return norm;
	});

	if (!changed) return project;
	return {
		...project,
		tracks: newTracks
	};
}
