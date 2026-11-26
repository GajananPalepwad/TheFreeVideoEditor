import {
	evaluate,
	isAnimated,
	retimeAnimatedValue,
	reverseAnimatedValue,
	shiftAnimatedValue
} from './animation';
import { reverseClipAnimation, splitClipAnimation } from './clipAnimation';
import { framesToTicks, ticksToFrames } from './time';
import { clipEnd } from './timeline';
import type { AnimatedValue, Clip, ClipId, Project, Time } from './types';

type RemapClip = Pick<Clip, 'start' | 'sourceIn' | 'speed' | 'timeRemap'>;

const SIMPSON_STEPS = 64;

/** Source position gained by integrating the speed curve over [0, localTime] (µs). */
function integrateSpeed(speed: NonNullable<Clip['timeRemap']>, localTime: Time): number {
	if (!isAnimated(speed)) return speed.value * localTime;
	const keyframes = speed.keyframes;
	let total = 0;
	let cursor = 0;
	const first = keyframes[0];
	const last = keyframes[keyframes.length - 1];
	if (!first || !last) return 0;
	const stops = [
		...keyframes.map((item) => item.time).filter((time) => time > 0 && time < localTime),
		localTime
	];
	for (const stop of stops) {
		total += integrateSegment(speed, cursor, stop);
		cursor = stop;
	}
	return total;
}

function integrateSegment(speed: NonNullable<Clip['timeRemap']>, from: Time, to: Time): number {
	if (!isAnimated(speed) || to <= from) return 0;
	const keyframes = speed.keyframes;
	const startKey = [...keyframes].reverse().find((item) => item.time <= from);
	if (startKey?.interpolation === 'hold' || !startKey) {
		return evaluate(speed, from) * (to - from);
	}
	const endKey = keyframes.find((item) => item.time > from);
	if (!endKey) return evaluate(speed, from) * (to - from);
	if (startKey.interpolation === 'linear') {
		return ((evaluate(speed, from) + evaluate(speed, to)) / 2) * (to - from);
	}
	const h = (to - from) / SIMPSON_STEPS;
	let sum = evaluate(speed, from) + evaluate(speed, to);
	for (let index = 1; index < SIMPSON_STEPS; index += 1) {
		sum += (index % 2 === 0 ? 2 : 4) * evaluate(speed, from + index * h);
	}
	return (sum * h) / 3;
}

/** Maps a timeline time to a source time (µs). Bit-identical to Phase 1 without `timeRemap`. */
export function timelineToSource(clip: RemapClip, time: Time): Time {
	if (!clip.timeRemap) return Math.round(clip.sourceIn + (time - clip.start) * clip.speed);
	const local = time - clip.start;
	const offset =
		local >= 0 ? integrateSpeed(clip.timeRemap, local) : local * evaluate(clip.timeRemap, 0);
	return Math.max(0, Math.round(clip.sourceIn + offset));
}

/**
 * Inverse of `timelineToSource` by binary search over [start, start + span].
 * Only well-defined while the speed does not change sign; returns the nearest match otherwise.
 */
export function sourceToTimeline(clip: RemapClip, sourceTime: Time, span: Time): Time {
	if (!clip.timeRemap) return Math.round(clip.start + (sourceTime - clip.sourceIn) / clip.speed);
	const ascending = timelineToSource(clip, clip.start + span) >= timelineToSource(clip, clip.start);
	let low = clip.start;
	let high = clip.start + span;
	for (let step = 0; step < 48 && high - low > 0.5; step += 1) {
		const middle = (low + high) / 2;
		const value = timelineToSource(clip, middle);
		if (value < sourceTime === ascending) low = middle;
		else high = middle;
	}
	return Math.round((low + high) / 2);
}

/**
 * Computes the minimum and maximum source time (µs) visited by this clip.
 * Evaluates endpoints, all keyframe stops, zero-crossings of the speed curve,
 * and fine intermediate samples across the clip duration.
 */
export function sourceExtent(
	clip: Pick<Clip, 'start' | 'duration' | 'sourceIn' | 'speed' | 'timeRemap'>
): { min: number; max: number } {
	if (!clip.timeRemap) {
		const startSource = clip.sourceIn;
		const endSource = Math.max(0, clip.sourceIn + Math.round(clip.duration * clip.speed));
		return {
			min: Math.min(startSource, endSource),
			max: Math.max(startSource, endSource)
		};
	}

	const sampleTimes = new Set<Time>();
	sampleTimes.add(0);
	sampleTimes.add(clip.duration);

	if (isAnimated(clip.timeRemap)) {
		for (const kf of clip.timeRemap.keyframes) {
			if (kf.time > 0 && kf.time < clip.duration) {
				sampleTimes.add(kf.time);
			}
		}
	}

	const steps = 64;
	const dt = clip.duration / steps;
	for (let i = 1; i < steps; i++) {
		sampleTimes.add(Math.round(i * dt));
	}

	// Detect zero-crossings of speed (critical points where direction changes)
	const sortedStops = [...sampleTimes].sort((a, b) => a - b);
	for (let i = 0; i < sortedStops.length - 1; i++) {
		const t0 = sortedStops[i]!;
		const t1 = sortedStops[i + 1]!;
		const s0 = evaluate(clip.timeRemap, t0);
		const s1 = evaluate(clip.timeRemap, t1);
		if ((s0 < 0 && s1 > 0) || (s0 > 0 && s1 < 0)) {
			let lo = t0;
			let hi = t1;
			for (let it = 0; it < 16; it++) {
				const mid = Math.round((lo + hi) / 2);
				const smid = evaluate(clip.timeRemap, mid);
				if ((smid < 0 && s0 < 0) || (smid > 0 && s0 > 0)) {
					lo = mid;
				} else {
					hi = mid;
				}
			}
			sampleTimes.add(Math.round((lo + hi) / 2));
		}
	}

	let min = Infinity;
	let max = -Infinity;
	for (const t of sampleTimes) {
		const sourceTime = timelineToSource(clip, clip.start + t);
		if (sourceTime < min) min = sourceTime;
		if (sourceTime > max) max = sourceTime;
	}

	return {
		min: Math.max(0, Math.round(min)),
		max: Math.max(0, Math.round(max))
	};
}

/** Effective speed multiplier at timeline time (µs). */
export function speedAt(clip: Pick<Clip, 'start' | 'speed' | 'timeRemap'>, time: Time): number {
	if (!clip.timeRemap) return clip.speed;
	const local = time - clip.start;
	return evaluate(clip.timeRemap, local);
}

/**
 * Re-bases timeRemap and recomputes sourceIn/sourceOut when the head is trimmed by `trimmed` (µs).
 * Invariant: source time at every absolute timeline time >= newStart is strictly identical to before.
 */
export function retimeForHeadTrim(
	clip: Clip,
	trimmed: Time,
	newDuration?: Time
): Pick<Clip, 'sourceIn' | 'sourceOut' | 'timeRemap'> {
	if (!clip.timeRemap || trimmed === 0) {
		const sourceIn = Math.max(0, clip.sourceIn + Math.round(trimmed * clip.speed));
		const dur = newDuration ?? Math.max(0, clip.duration - trimmed);
		const sourceOut = sourceIn + Math.round(dur * clip.speed);
		return { sourceIn, sourceOut };
	}

	const nextSourceIn = timelineToSource(clip, clip.start + trimmed);
	const nextTimeRemap =
		trimmed > 0
			? (retimeAnimatedValue(
					clip.timeRemap as AnimatedValue<unknown>,
					trimmed
				) as AnimatedValue<number>)
			: (shiftAnimatedValue(
					clip.timeRemap as AnimatedValue<unknown>,
					-trimmed
				) as AnimatedValue<number>);

	const dur = newDuration ?? Math.max(0, clip.duration - trimmed);
	const nextSourceOut = timelineToSource(
		{
			...clip,
			start: clip.start + trimmed,
			sourceIn: nextSourceIn,
			timeRemap: nextTimeRemap
		},
		clip.start + trimmed + dur
	);

	return {
		sourceIn: nextSourceIn,
		sourceOut: nextSourceOut,
		timeRemap: nextTimeRemap
	};
}

export interface SetConstantSpeedOptions {
	ripple?: boolean;
	maintainPitch?: boolean;
}

/**
 * Changes constant clip speed (duration = sourceRange / |speed|).
 * Rejects speeds whose magnitude falls outside [0.01, 100]. Negative multipliers reverse playback.
 * Snaps timeline duration to project frame boundaries.
 */
export function setConstantSpeed(
	project: Project,
	clipIds: readonly ClipId[],
	speedMultiplier: number,
	options?: SetConstantSpeedOptions
): Project {
	const absSpeed = Math.abs(speedMultiplier);
	if (!Number.isFinite(speedMultiplier) || absSpeed < 0.01 || absSpeed > 100) {
		throw new RangeError('Speed multiplier magnitude must be between 0.01 and 100 (1% to 10000%).');
	}

	const fps = project.settings.fps;
	const idSet = new Set(clipIds);
	const tracks = project.tracks.map((track) => {
		const trackHasTarget = track.clips.some((c) => idSet.has(c.id));
		if (!trackHasTarget) return track;

		let rippleShift = 0;
		const newClips: Clip[] = [];

		for (const clip of track.clips) {
			if (!idSet.has(clip.id)) {
				if (options?.ripple && rippleShift !== 0) {
					newClips.push({ ...clip, start: clip.start + rippleShift });
				} else {
					newClips.push(clip);
				}
				continue;
			}

			const prevSpeed = clip.speed || 1;
			const flipped = prevSpeed < 0 !== speedMultiplier < 0;
			const sourceSpan = Math.abs(clip.sourceOut - clip.sourceIn);
			const rawDuration = Math.round(sourceSpan / absSpeed);
			const snappedFrames = Math.max(1, ticksToFrames(rawDuration, fps));
			const newDuration = framesToTicks(snappedFrames, fps);
			const newSourceIn = flipped ? clip.sourceOut : clip.sourceIn;
			const newSourceOut = Math.max(0, newSourceIn + Math.round(newDuration * speedMultiplier));
			const durationDelta = newDuration - clip.duration;
			const reversedAnim = flipped ? reverseClipAnimation(clip, clip.duration) : {};
			const swappedFades =
				flipped && (clip.fadeInUs !== undefined || clip.fadeOutUs !== undefined)
					? { fadeInUs: clip.fadeOutUs, fadeOutUs: clip.fadeInUs }
					: {};

			const updatedClip: Clip = {
				...clip,
				...reversedAnim,
				...swappedFades,
				start: clip.start + rippleShift,
				duration: newDuration,
				speed: speedMultiplier,
				sourceIn: newSourceIn,
				sourceOut: newSourceOut,
				...(options?.maintainPitch !== undefined ? { maintainPitch: options.maintainPitch } : {})
			};
			if (swappedFades.fadeInUs === undefined && 'fadeInUs' in swappedFades) {
				delete updatedClip.fadeInUs;
			}
			if (swappedFades.fadeOutUs === undefined && 'fadeOutUs' in swappedFades) {
				delete updatedClip.fadeOutUs;
			}
			delete updatedClip.timeRemap;

			newClips.push(updatedClip);
			if (options?.ripple) {
				rippleShift += durationDelta;
			}
		}

		return { ...track, clips: newClips };
	});

	return { ...project, tracks };
}

function generateId(): string {
	const cryptoApi = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto;
	if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
	return 'c_' + Math.random().toString(36).substring(2, 11);
}

/**
 * Reverses clip playback direction, keyframed animations (properties, effects, masks),
 * audio/video fades, and speed curves for any clip type.
 */
export function reverseClip(clip: Clip): Clip {
	const reversedAnim = reverseClipAnimation(clip, clip.duration);
	const hasFades = clip.fadeInUs !== undefined || clip.fadeOutUs !== undefined;
	const fadePatch: Partial<Clip> = hasFades
		? { fadeInUs: clip.fadeOutUs, fadeOutUs: clip.fadeInUs }
		: {};
	const cleanFades = (next: Clip): Clip => {
		if (hasFades) {
			if (next.fadeInUs === undefined) delete next.fadeInUs;
			if (next.fadeOutUs === undefined) delete next.fadeOutUs;
		}
		return next;
	};

	if (!clip.timeRemap) {
		const speed = clip.speed || 1;
		return cleanFades({
			...clip,
			...reversedAnim,
			...fadePatch,
			speed: -speed,
			sourceIn: clip.sourceOut,
			sourceOut: clip.sourceIn
		});
	}

	if (!isAnimated(clip.timeRemap)) {
		const nextVal = -clip.timeRemap.value;
		return cleanFades({
			...clip,
			...reversedAnim,
			...fadePatch,
			sourceIn: clip.sourceOut,
			sourceOut: clip.sourceIn,
			timeRemap: { value: nextVal }
		});
	}

	const flippedCurve = reverseAnimatedValue(clip.timeRemap, clip.duration);
	const reversedKeyframes = isAnimated(flippedCurve)
		? flippedCurve.keyframes.map((k) => ({ ...k, value: -k.value }))
		: [];

	const newSourceIn = timelineToSource(clip, clip.start + clip.duration);
	const newSourceOut = timelineToSource(clip, clip.start);

	return cleanFades({
		...clip,
		...reversedAnim,
		...fadePatch,
		sourceIn: newSourceIn,
		sourceOut: newSourceOut,
		timeRemap: { keyframes: reversedKeyframes }
	});
}

/**
 * Enables time remapping on a clip with an initial constant keyframe equal to current speed.
 */
export function enableTimeRemap(clip: Clip): Clip {
	if (clip.timeRemap) return clip;
	return {
		...clip,
		timeRemap: {
			keyframes: [{ time: 0, value: clip.speed, interpolation: 'linear' }]
		}
	};
}

/**
 * Disables time remapping, optionally setting constant speed to average speed across duration.
 */
export function disableTimeRemap(clip: Clip, mode: 'average' | 'initial' = 'initial'): Clip {
	const { timeRemap: _removed, ...rest } = clip;
	void _removed;

	let speed = clip.speed;
	if (mode === 'average' && clip.duration > 0) {
		const avg = Math.abs((clip.sourceOut - clip.sourceIn) / clip.duration);
		speed = Math.max(0.01, Math.min(100, Number(avg.toFixed(4))));
	}

	let sourceOut = clip.sourceOut;
	if (sourceOut <= clip.sourceIn) {
		sourceOut = clip.sourceIn + Math.round(clip.duration * speed);
	}

	return { ...rest, speed, sourceOut };
}

/**
 * Splits clip at playhead time and inserts a hold segment with timeRemap { value: 0 } and silence.
 * Ripples subsequent clips.
 */
export function addFreezeFrame(
	project: Project,
	clipId: ClipId,
	time: Time,
	duration: Time = 2_000_000,
	options?: { ripple?: boolean }
): Project {
	const ripple = options?.ripple !== false;
	const tracks = project.tracks.map((track) => {
		const targetIndex = track.clips.findIndex((c) => c.id === clipId);
		if (targetIndex === -1) return track;

		const target = track.clips[targetIndex]!;
		if (time <= target.start || time >= clipEnd(target)) {
			return track;
		}

		const freezeSource = timelineToSource(target, time);
		const leftDuration = time - target.start;
		const rightDuration = clipEnd(target) - time;

		const leftClip: Clip = {
			...target,
			duration: leftDuration,
			sourceOut: freezeSource
		};
		if (target.timeRemap) {
			const [leftAnimation] = splitClipAnimation(target, leftDuration);
			Object.assign(leftClip, leftAnimation);
		}

		const freezeClip: Clip = {
			...target,
			id: generateId() as ClipId,
			start: time,
			duration,
			sourceIn: freezeSource,
			sourceOut: freezeSource,
			speed: 1,
			volume: 0,
			timeRemap: { value: 0 }
		};

		const rightClip: Clip = {
			...target,
			id: generateId() as ClipId,
			start: time + duration,
			duration: rightDuration,
			sourceIn: freezeSource
		};
		if (target.timeRemap) {
			const [, rightAnimation] = splitClipAnimation(target, leftDuration);
			Object.assign(rightClip, rightAnimation);
		}

		const newClips: Clip[] = [];
		for (let i = 0; i < track.clips.length; i++) {
			if (i === targetIndex) {
				newClips.push(leftClip, freezeClip, rightClip);
			} else if (i > targetIndex && ripple) {
				const c = track.clips[i]!;
				newClips.push({ ...c, start: c.start + duration });
			} else {
				newClips.push(track.clips[i]!);
			}
		}

		return { ...track, clips: newClips };
	});

	return { ...project, tracks };
}

/**
 * Freezes frame at playhead to the end of the clip (right half gets speed 0).
 */
export function freezeFrameToEnd(project: Project, clipId: ClipId, time: Time): Project {
	const tracks = project.tracks.map((track) => {
		const targetIndex = track.clips.findIndex((c) => c.id === clipId);
		if (targetIndex === -1) return track;

		const target = track.clips[targetIndex]!;
		if (time <= target.start || time >= clipEnd(target)) return track;

		const freezeSource = timelineToSource(target, time);
		const leftDuration = time - target.start;
		const rightDuration = clipEnd(target) - time;

		const leftClip: Clip = {
			...target,
			duration: leftDuration,
			sourceOut: freezeSource
		};
		if (target.timeRemap) {
			const [leftAnimation] = splitClipAnimation(target, leftDuration);
			Object.assign(leftClip, leftAnimation);
		}

		const rightClip: Clip = {
			...target,
			id: generateId() as ClipId,
			start: time,
			duration: rightDuration,
			sourceIn: freezeSource,
			sourceOut: freezeSource,
			speed: 1,
			volume: 0,
			timeRemap: { value: 0 }
		};

		const newClips: Clip[] = [];
		for (let i = 0; i < track.clips.length; i++) {
			if (i === targetIndex) {
				newClips.push(leftClip, rightClip);
			} else {
				newClips.push(track.clips[i]!);
			}
		}

		return { ...track, clips: newClips };
	});

	return { ...project, tracks };
}

/**
 * Checks whether the clip's speed curve / source range runs past the media boundaries.
 */
export function isSpeedExceedingMedia(
	clip: Pick<Clip, 'start' | 'duration' | 'sourceIn' | 'speed' | 'timeRemap'>,
	asset?: { duration: Time }
): boolean {
	if (!asset || asset.duration <= 0) return false;
	const extent = sourceExtent(clip);
	return extent.min < 0 || extent.max > asset.duration;
}
