import { evaluate, isAnimated, removeKeyframe } from './animation';
import {
	clampPropertyValue,
	descriptorFor,
	matchesShape,
	migrateLegacyTransform,
	propertyCurve,
	readProperty,
	type PropertyDescriptor,
	type PropertyValue
} from './properties';
import { framesToTicks, ticksToFrames } from './time';
import type {
	AnimatedValue,
	BezierHandle,
	Clip,
	Interpolation,
	Keyframe,
	PropertyId,
	Time
} from './types';

export type KeyframeEditErrorCode =
	| 'UNKNOWN_PROPERTY'
	| 'NEEDS_KEYFRAME'
	| 'SHAPE_MISMATCH'
	| 'NOT_ANIMATED'
	| 'NO_SUCH_KEYFRAME'
	| 'INVALID_TIME'
	| 'EMPTY_SELECTION';

export class KeyframeEditError extends Error {
	constructor(
		readonly code: KeyframeEditErrorCode,
		message: string
	) {
		super(message);
		this.name = 'KeyframeEditError';
	}
}

export interface KeyframeRef {
	propertyId: PropertyId;
	/** Clip-local time in ticks. */
	time: Time;
}

export type InterpolationPreset =
	| 'linear'
	| 'hold'
	| 'ease-in'
	| 'ease-out'
	| 'ease-in-out'
	| 'bezier'
	| 'spring'
	| 'elastic'
	| 'bounce';

export interface KeyframeClipboardEntry {
	propertyId: PropertyId;
	/** Time relative to the earliest copied keyframe. */
	relativeTime: Time;
	value: PropertyValue;
	interpolation: Interpolation;
	easeIn?: BezierHandle;
	easeOut?: BezierHandle;
}

export interface KeyframeClipboard {
	entries: KeyframeClipboardEntry[];
}

export interface SetPropertyOptions {
	autoKey: boolean;
	fps: number;
	/** Component being edited (crop insets give way against their opposite inset). */
	editedChannel?: number;
}

const EASE_OUT_HANDLE: BezierHandle = { x: 0.42, y: 0 };
const EASE_IN_HANDLE: BezierHandle = { x: 0.58, y: 1 };
/** Handles that reproduce a straight line, used so easing one side never bends the other. */
const LINEAR_OUT_HANDLE: BezierHandle = { x: 1 / 3, y: 1 / 3 };
const LINEAR_IN_HANDLE: BezierHandle = { x: 2 / 3, y: 2 / 3 };

function descriptor(id: PropertyId): PropertyDescriptor {
	const found = descriptorFor(id);
	if (!found) throw new KeyframeEditError('UNKNOWN_PROPERTY', `Unknown property "${id}".`);
	return found;
}

function checkValue(desc: PropertyDescriptor, value: unknown): PropertyValue {
	if (!matchesShape(desc, value)) {
		throw new KeyframeEditError('SHAPE_MISMATCH', `${desc.label} expects a ${desc.shape} value.`);
	}
	return value;
}

function clampHandle(handle: BezierHandle): BezierHandle {
	return { x: Math.min(1, Math.max(0, handle.x)), y: handle.y };
}

/** Snaps a clip-local time to the nearest frame and into [0, clip duration]. */
export function snapLocalTime(clip: Clip, time: Time, fps: number): Time {
	if (!Number.isFinite(time)) throw new KeyframeEditError('INVALID_TIME', 'Time must be finite.');
	const clamped = Math.min(clip.duration, Math.max(0, Math.round(time)));
	const snapped = framesToTicks(ticksToFrames(clamped, fps), fps);
	return Math.min(clip.duration, snapped);
}

function curveOf(clip: Clip, id: PropertyId): AnimatedValue<PropertyValue> | undefined {
	return propertyCurve(clip, id);
}

function withCurve(clip: Clip, id: PropertyId, curve: AnimatedValue<PropertyValue>): Clip {
	if (id.startsWith('effect:')) {
		const parts = id.split(':');
		if (parts.length >= 4) {
			const [, , effectId, paramName] = parts;
			const effects = (clip.effects ?? []).map((eff) => {
				if (eff.id !== effectId) return eff;
				return {
					...eff,
					params: {
						...eff.params,
						[paramName!]: curve as AnimatedValue<unknown>
					}
				};
			});
			return { ...clip, effects };
		}
	}
	if (id.startsWith('mask:')) {
		const parts = id.split(':');
		const paramName = parts[parts.length - 1]!;
		const maskId = parts.length >= 4 ? parts[2]! : parts[1]!;
		const masks = (clip.masks ?? []).map((mask) => {
			if (mask.id !== maskId) return mask;
			return {
				...mask,
				properties: {
					...mask.properties,
					[paramName]: curve as AnimatedValue<unknown>
				}
			};
		});
		return { ...clip, masks };
	}
	if (id === 'timeRemap') {
		return { ...clip, timeRemap: curve as AnimatedValue<number> };
	}
	return { ...clip, properties: { ...clip.properties, [id]: curve as AnimatedValue<unknown> } };
}

export function keyframesOf(curve: AnimatedValue<PropertyValue>): Keyframe<PropertyValue>[] {
	return isAnimated(curve) ? curve.keyframes : [];
}

function sortKeys(keys: Keyframe<PropertyValue>[], source: AnimatedValue<PropertyValue>) {
	const sorted = keys.toSorted((a, b) => a.time - b.time);
	const angleMode = isAnimated(source) ? source.angleMode : undefined;
	return angleMode ? { keyframes: sorted, angleMode } : { keyframes: sorted };
}

function keepOnlyUnique(keys: Keyframe<PropertyValue>[]): Keyframe<PropertyValue>[] {
	const byTime = new Map<number, Keyframe<PropertyValue>>();
	for (const key of keys) byTime.set(key.time, key);
	return [...byTime.values()];
}

/**
 * Sets a property at a clip-local time. Constants are replaced; animated properties get a keyframe
 * at the frame-snapped time when `autoKey` is on, otherwise a `NEEDS_KEYFRAME` error is thrown so
 * the UI can ask. A legacy `transform` is converted to `properties` first.
 */
export function setPropertyAtTime(
	source: Clip,
	propertyId: PropertyId,
	localTime: Time,
	rawValue: PropertyValue,
	options: SetPropertyOptions
): Clip {
	const desc = descriptor(propertyId);
	const clip = migrateLegacyTransform(source);
	const value = clampPropertyValue(desc, checkValue(desc, rawValue), options.editedChannel);
	const curve = curveOf(clip, propertyId);
	if (!curve || !isAnimated(curve)) return withCurve(clip, propertyId, { value });
	if (!options.autoKey) {
		throw new KeyframeEditError('NEEDS_KEYFRAME', `${desc.label} is animated; add a keyframe.`);
	}
	const time = snapLocalTime(clip, localTime, options.fps);
	const existing = curve.keyframes.find((item) => item.time === time);
	const next: Keyframe<PropertyValue> = existing
		? { ...existing, value }
		: { time, value, interpolation: 'linear' };
	return withCurve(
		clip,
		propertyId,
		sortKeys(keepOnlyUnique([...curve.keyframes.filter((item) => item.time !== time), next]), curve)
	);
}

/** Stopwatch on: the first keyframe holds the value currently shown at the playhead. */
export function enableAnimation(
	source: Clip,
	propertyId: PropertyId,
	localTime: Time,
	fps: number
): Clip {
	descriptor(propertyId);
	const clip = migrateLegacyTransform(source);
	const curve = curveOf(clip, propertyId);
	if (curve && isAnimated(curve)) return clip;
	const value = readProperty(clip, propertyId, localTime);
	const time = snapLocalTime(clip, localTime, fps);
	return withCurve(clip, propertyId, { keyframes: [{ time, value, interpolation: 'linear' }] });
}

/**
 * Stopwatch off. `flatten-current` keeps the value at `localTime`; `discard` keeps the first
 * keyframe's value.
 */
export function disableAnimation(
	source: Clip,
	propertyId: PropertyId,
	localTime: Time,
	mode: 'flatten-current' | 'discard'
): Clip {
	descriptor(propertyId);
	const clip = migrateLegacyTransform(source);
	const curve = curveOf(clip, propertyId);
	if (!curve || !isAnimated(curve)) return clip;
	const value = mode === 'discard' ? curve.keyframes[0]!.value : evaluate(curve, localTime);
	return withCurve(clip, propertyId, { value });
}

export function hasKeyframeAt(clip: Clip, propertyId: PropertyId, time: Time): boolean {
	const curve = curveOf(clip, propertyId);
	return Boolean(curve && isAnimated(curve) && curve.keyframes.some((item) => item.time === time));
}

/** Adds a keyframe at the playhead (current value), or removes the one that is there. */
export function toggleKeyframe(
	source: Clip,
	propertyId: PropertyId,
	localTime: Time,
	fps: number
): Clip {
	descriptor(propertyId);
	const clip = migrateLegacyTransform(source);
	const curve = curveOf(clip, propertyId);
	if (!curve || !isAnimated(curve)) return enableAnimation(clip, propertyId, localTime, fps);
	const time = snapLocalTime(clip, localTime, fps);
	if (curve.keyframes.some((item) => item.time === time)) {
		return withCurve(clip, propertyId, removeKeyframe(curve, time));
	}
	const value = evaluate(curve, time);
	return withCurve(
		clip,
		propertyId,
		sortKeys([...curve.keyframes, { time, value, interpolation: 'linear' }], curve)
	);
}

function neighbourTime(
	clip: Clip,
	propertyIds: readonly PropertyId[],
	localTime: Time,
	direction: 1 | -1
): Time | null {
	let best: Time | null = null;
	for (const id of propertyIds) {
		const curve = curveOf(clip, id);
		if (!curve || !isAnimated(curve)) continue;
		for (const key of curve.keyframes) {
			if (direction === 1 ? key.time > localTime : key.time < localTime) {
				if (best === null || (direction === 1 ? key.time < best : key.time > best)) best = key.time;
			}
		}
	}
	return best;
}

export function nextKeyframeTime(
	clip: Clip,
	propertyIds: readonly PropertyId[],
	localTime: Time
): Time | null {
	return neighbourTime(clip, propertyIds, localTime, 1);
}

export function prevKeyframeTime(
	clip: Clip,
	propertyIds: readonly PropertyId[],
	localTime: Time
): Time | null {
	return neighbourTime(clip, propertyIds, localTime, -1);
}

function groupByProperty(selection: readonly KeyframeRef[]): Map<PropertyId, Set<Time>> {
	const groups = new Map<PropertyId, Set<Time>>();
	for (const ref of selection) {
		const times = groups.get(ref.propertyId) ?? new Set<Time>();
		times.add(ref.time);
		groups.set(ref.propertyId, times);
	}
	return groups;
}

export interface MoveKeyframesResult {
	clip: Clip;
	/** The delta actually applied after clamping to the clip bounds. */
	appliedDelta: Time;
}

/**
 * Moves the selected keyframes together. The delta is clamped so nothing leaves [0, clip duration]
 * (keyframes already past the end may only move earlier). A moved keyframe that lands on an
 * unselected keyframe replaces it.
 */
export function moveKeyframes(
	clip: Clip,
	selection: readonly KeyframeRef[],
	deltaTime: Time
): MoveKeyframesResult {
	if (selection.length === 0) throw new KeyframeEditError('EMPTY_SELECTION', 'Nothing selected.');
	const groups = groupByProperty(selection);
	let minTime = Infinity;
	let maxTime = -Infinity;
	for (const [id, times] of groups) {
		const curve = curveOf(clip, id);
		if (!curve || !isAnimated(curve)) {
			throw new KeyframeEditError('NOT_ANIMATED', `Property "${id}" is not animated.`);
		}
		for (const time of times) {
			if (!curve.keyframes.some((item) => item.time === time)) {
				throw new KeyframeEditError('NO_SUCH_KEYFRAME', `No "${id}" keyframe at ${time}.`);
			}
			minTime = Math.min(minTime, time);
			maxTime = Math.max(maxTime, time);
		}
	}
	const lowest = -minTime;
	const highest = Math.max(clip.duration, maxTime) - maxTime;
	const appliedDelta = Math.min(highest, Math.max(lowest, Math.round(deltaTime)));
	if (appliedDelta === 0) return { clip, appliedDelta: 0 };
	let next = clip;
	for (const [id, times] of groups) {
		const curve = curveOf(next, id)!;
		if (!isAnimated(curve)) continue;
		const moved: Keyframe<PropertyValue>[] = [];
		const stay: Keyframe<PropertyValue>[] = [];
		for (const key of curve.keyframes) {
			if (times.has(key.time)) moved.push({ ...key, time: key.time + appliedDelta });
			else stay.push(key);
		}
		const movedTimes = new Set(moved.map((item) => item.time));
		const survivors = stay.filter((item) => !movedTimes.has(item.time));
		next = withCurve(next, id, sortKeys([...survivors, ...moved], curve));
	}
	return { clip: next, appliedDelta };
}

/** Deletes keyframes; removing the last one of a property flattens it to a constant. */
export function deleteKeyframes(clip: Clip, selection: readonly KeyframeRef[]): Clip {
	let next = clip;
	for (const [id, times] of groupByProperty(selection)) {
		let curve = curveOf(next, id);
		if (!curve || !isAnimated(curve)) continue;
		for (const time of times) curve = removeKeyframe(curve, time);
		next = withCurve(next, id, curve);
	}
	return next;
}

export function setKeyframeValue(
	clip: Clip,
	propertyId: PropertyId,
	time: Time,
	rawValue: PropertyValue,
	editedChannel?: number
): Clip {
	const desc = descriptor(propertyId);
	const curve = curveOf(clip, propertyId);
	if (!curve || !isAnimated(curve)) {
		throw new KeyframeEditError('NOT_ANIMATED', `${desc.label} is not animated.`);
	}
	if (!curve.keyframes.some((item) => item.time === time)) {
		throw new KeyframeEditError('NO_SUCH_KEYFRAME', `No keyframe at ${time}.`);
	}
	const value = clampPropertyValue(desc, checkValue(desc, rawValue), editedChannel);
	return withCurve(clip, propertyId, {
		...curve,
		keyframes: curve.keyframes.map((item) => (item.time === time ? { ...item, value } : item))
	});
}

function applyPreset(
	keys: Keyframe<PropertyValue>[],
	index: number,
	preset: Exclude<InterpolationPreset, 'bezier'>
): void {
	const key = keys[index]!;
	if (preset === 'linear' || preset === 'hold') {
		const { easeIn: _in, easeOut: _out, ...plain } = key;
		void _in;
		void _out;
		keys[index] = { ...plain, interpolation: preset };
		return;
	}
	if (preset === 'spring' || preset === 'elastic' || preset === 'bounce') {
		const { easeOut: _out, ...plain } = key;
		void _out;
		keys[index] = { ...plain, interpolation: preset };
		return;
	}
	const wantsIn = preset === 'ease-in' || preset === 'ease-in-out';
	const wantsOut = preset === 'ease-out' || preset === 'ease-in-out';
	let next: Keyframe<PropertyValue> = { ...key };
	if (wantsOut) next = { ...next, interpolation: 'bezier', easeOut: EASE_OUT_HANDLE };
	if (wantsIn) next = { ...next, easeIn: EASE_IN_HANDLE };
	keys[index] = next;
	if (wantsIn) {
		const previous = keys[index - 1];
		if (previous && previous.interpolation !== 'bezier') {
			keys[index - 1] = {
				...previous,
				interpolation: previous.interpolation === 'hold' ? 'hold' : 'bezier',
				easeOut: previous.easeOut ?? LINEAR_OUT_HANDLE
			};
		}
	}
	if (wantsOut) {
		const following = keys[index + 1];
		if (following && !following.easeIn)
			keys[index + 1] = { ...following, easeIn: LINEAR_IN_HANDLE };
	}
}

/**
 * Applies an interpolation preset to the selected keyframes. A keyframe's own interpolation shapes
 * the segment that follows it: `ease-out` slows away from the key, `ease-in` slows into it (via the
 * previous segment's bezier), and `ease-in-out` does both. Neighbouring handles are filled with
 * straight-line equivalents so easing one key never bends an unrelated segment.
 */
export function setKeyframeInterpolation(
	clip: Clip,
	selection: readonly KeyframeRef[],
	preset: Exclude<InterpolationPreset, 'bezier'>
): Clip {
	if (selection.length === 0) throw new KeyframeEditError('EMPTY_SELECTION', 'Nothing selected.');
	let next = clip;
	for (const [id, times] of groupByProperty(selection)) {
		const curve = curveOf(next, id);
		if (!curve || !isAnimated(curve)) {
			throw new KeyframeEditError('NOT_ANIMATED', `Property "${id}" is not animated.`);
		}
		const keys = [...curve.keyframes];
		keys.forEach((key, index) => {
			if (times.has(key.time)) applyPreset(keys, index, preset);
		});
		next = withCurve(next, id, { ...curve, keyframes: keys });
	}
	return next;
}

/** Custom bezier handles for one keyframe (x clamped to [0, 1]); marks the keyframe as bezier. */
export function setBezierHandles(
	clip: Clip,
	propertyId: PropertyId,
	time: Time,
	handles: { easeIn?: BezierHandle; easeOut?: BezierHandle }
): Clip {
	const curve = curveOf(clip, propertyId);
	if (!curve || !isAnimated(curve)) {
		throw new KeyframeEditError('NOT_ANIMATED', `Property "${propertyId}" is not animated.`);
	}
	if (!curve.keyframes.some((item) => item.time === time)) {
		throw new KeyframeEditError('NO_SUCH_KEYFRAME', `No keyframe at ${time}.`);
	}
	return withCurve(clip, propertyId, {
		...curve,
		keyframes: curve.keyframes.map((item) => {
			if (item.time !== time) return item;
			return {
				...item,
				interpolation: 'bezier' as const,
				...(handles.easeIn ? { easeIn: clampHandle(handles.easeIn) } : {}),
				...(handles.easeOut ? { easeOut: clampHandle(handles.easeOut) } : {})
			};
		})
	});
}

export function copyKeyframes(clip: Clip, selection: readonly KeyframeRef[]): KeyframeClipboard {
	if (selection.length === 0) throw new KeyframeEditError('EMPTY_SELECTION', 'Nothing selected.');
	const origin = Math.min(...selection.map((ref) => ref.time));
	const entries: KeyframeClipboardEntry[] = [];
	for (const [id, times] of groupByProperty(selection)) {
		const curve = curveOf(clip, id);
		if (!curve || !isAnimated(curve)) continue;
		for (const key of curve.keyframes) {
			if (!times.has(key.time)) continue;
			entries.push({
				propertyId: id,
				relativeTime: key.time - origin,
				value: key.value,
				interpolation: key.interpolation,
				...(key.easeIn ? { easeIn: key.easeIn } : {}),
				...(key.easeOut ? { easeOut: key.easeOut } : {})
			});
		}
	}
	if (entries.length === 0) throw new KeyframeEditError('NO_SUCH_KEYFRAME', 'No keyframes copied.');
	return { entries };
}

/**
 * Pastes at a clip-local time. Without `targetPropertyId` each entry returns to its own property;
 * with it, a single-property clipboard is retargeted (the value shape must match). Entries that
 * would land outside [0, clip duration] are skipped; keyframes at identical times are replaced.
 * Returns the clip and the pasted refs so the UI can select them.
 */
export function pasteKeyframes(
	source: Clip,
	clipboard: KeyframeClipboard,
	atLocalTime: Time,
	targetPropertyId?: PropertyId
): { clip: Clip; pasted: KeyframeRef[] } {
	const ids = new Set(clipboard.entries.map((entry) => entry.propertyId));
	if (targetPropertyId && ids.size > 1) {
		throw new KeyframeEditError(
			'SHAPE_MISMATCH',
			'Select a single property to paste several properties.'
		);
	}
	let clip = migrateLegacyTransform(source);
	const pasted: KeyframeRef[] = [];
	for (const id of ids) {
		const destination = targetPropertyId ?? id;
		const desc = descriptor(destination);
		const entries = clipboard.entries.filter((entry) => entry.propertyId === id);
		for (const entry of entries) checkValue(desc, entry.value);
		const base = curveOf(clip, destination);
		const existing = base && isAnimated(base) ? base.keyframes : [];
		const incoming: Keyframe<PropertyValue>[] = [];
		for (const entry of entries) {
			const time = Math.round(atLocalTime + entry.relativeTime);
			if (time < 0 || time > clip.duration) continue;
			incoming.push({
				time,
				value: clampPropertyValue(desc, entry.value),
				interpolation: entry.interpolation,
				...(entry.easeIn ? { easeIn: entry.easeIn } : {}),
				...(entry.easeOut ? { easeOut: entry.easeOut } : {})
			});
			pasted.push({ propertyId: destination, time });
		}
		if (incoming.length === 0) continue;
		const incomingTimes = new Set(incoming.map((item) => item.time));
		const merged = [...existing.filter((item) => !incomingTimes.has(item.time)), ...incoming];
		clip = withCurve(clip, destination, sortKeys(merged, base ?? { value: 0 }));
	}
	return { clip, pasted };
}
