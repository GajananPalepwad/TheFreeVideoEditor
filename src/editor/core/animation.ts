import { bounceEase, elasticEase, springEase, type EasingFunction } from './easing';
import type { AnimatedValue, BezierHandle, Interpolation, Keyframe, Time } from './types';

export const DEFAULT_EASE_OUT: BezierHandle = { x: 0.42, y: 0 };
export const DEFAULT_EASE_IN: BezierHandle = { x: 0.58, y: 1 };

const CLOSED_FORM_EASINGS: Partial<Record<Interpolation, EasingFunction>> = {
	spring: springEase,
	elastic: elasticEase,
	bounce: bounceEase
};

type Lerpable = number | readonly number[] | Readonly<Record<string, number>>;

function isNumberRecord(value: unknown): value is Readonly<Record<string, number>> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((entry) => typeof entry === 'number')
	);
}

function isNumberArray(value: unknown): value is readonly number[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'number');
}

function lerpNumber(a: number, b: number, amount: number): number {
	return a + (b - a) * amount;
}

/**
 * Numbers, number tuples (vectors) and number records (colors in gamma-encoded
 * sRGB, crops) interpolate component-wise. Everything else holds its left value.
 */
export function lerpValue<T>(a: T, b: T, amount: number, shortestAngle = false): T {
	if (typeof a === 'number' && typeof b === 'number') {
		if (shortestAngle) {
			const delta = ((((b - a + 180) % 360) + 360) % 360) - 180;
			return (a + delta * amount) as T;
		}
		return lerpNumber(a, b, amount) as T;
	}
	if (isNumberArray(a) && isNumberArray(b) && a.length === b.length) {
		return a.map((entry, index) => lerpNumber(entry, b[index]!, amount)) as T;
	}
	if (isNumberRecord(a) && isNumberRecord(b)) {
		const next: Record<string, number> = {};
		for (const [key, entry] of Object.entries(a)) {
			next[key] = lerpNumber(entry, b[key] ?? entry, amount);
		}
		return next as T;
	}
	return a;
}

export function isLerpable(value: unknown): value is Lerpable {
	return typeof value === 'number' || isNumberArray(value) || isNumberRecord(value);
}

interface Point {
	x: number;
	y: number;
}

function bezierAxis(p1: number, p2: number, s: number): number {
	const inverse = 1 - s;
	return 3 * inverse * inverse * s * p1 + 3 * inverse * s * s * p2 + s * s * s;
}

function bezierAxisDerivative(p1: number, p2: number, s: number): number {
	const inverse = 1 - s;
	return 3 * inverse * inverse * p1 + 6 * inverse * s * (p2 - p1) + 3 * s * s * (1 - p2);
}

/** Solves x(s) = u for the monotonic cubic-bezier time axis and returns the parameter s. */
export function solveBezierParameter(x1: number, x2: number, u: number): number {
	if (u <= 0) return 0;
	if (u >= 1) return 1;
	let s = u;
	for (let iteration = 0; iteration < 8; iteration += 1) {
		const error = bezierAxis(x1, x2, s) - u;
		if (Math.abs(error) < 1e-12) return s;
		const slope = bezierAxisDerivative(x1, x2, s);
		if (Math.abs(slope) < 1e-9) break;
		s -= error / slope;
	}
	let low = 0;
	let high = 1;
	s = u;
	for (let iteration = 0; iteration < 80; iteration += 1) {
		const x = bezierAxis(x1, x2, s);
		if (Math.abs(x - u) < 1e-13) return s;
		if (x < u) low = s;
		else high = s;
		s = (low + high) / 2;
	}
	return s;
}

export function cubicBezierEase(
	handleOut: BezierHandle,
	handleIn: BezierHandle,
	u: number
): number {
	const s = solveBezierParameter(handleOut.x, handleIn.x, u);
	return bezierAxis(handleOut.y, handleIn.y, s);
}

function clampHandle(handle: BezierHandle): BezierHandle {
	return { x: Math.min(1, Math.max(0, handle.x)), y: handle.y };
}

function handlesFor(
	from: Keyframe<unknown>,
	to: Keyframe<unknown>
): { out: BezierHandle; in: BezierHandle } {
	return {
		out: from.easeOut ?? DEFAULT_EASE_OUT,
		in: to.easeIn ?? DEFAULT_EASE_IN
	};
}

function sortedKeyframes<T>(keyframes: readonly Keyframe<T>[]): Keyframe<T>[] {
	return keyframes.toSorted((a, b) => a.time - b.time);
}

export function isAnimated<T>(
	value: AnimatedValue<T>
): value is { keyframes: Keyframe<T>[]; angleMode?: 'unwrapped' | 'shortest' } {
	return 'keyframes' in value;
}

export function constant<T>(value: T): AnimatedValue<T> {
	return { value };
}

export function evaluate<T>(animated: AnimatedValue<T>, localTime: Time): T {
	if (!isAnimated(animated)) return animated.value;
	const keyframes = animated.keyframes;
	const first = keyframes[0];
	const last = keyframes[keyframes.length - 1];
	if (!first || !last) throw new RangeError('An animated value needs at least one keyframe.');
	if (localTime <= first.time) return first.value;
	if (localTime >= last.time) return last.value;

	let low = 0;
	let high = keyframes.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if (keyframes[middle]!.time <= localTime) low = middle;
		else high = middle;
	}
	const from = keyframes[low]!;
	const to = keyframes[high]!;
	if (localTime === from.time) return from.value;
	if (from.interpolation === 'hold') return from.value;
	const linear = (localTime - from.time) / (to.time - from.time);
	const closedForm = CLOSED_FORM_EASINGS[from.interpolation];
	const amount =
		from.interpolation === 'bezier'
			? (() => {
					const handles = handlesFor(from, to);
					return cubicBezierEase(handles.out, handles.in, linear);
				})()
			: closedForm
				? closedForm(linear)
				: linear;
	return lerpValue(from.value, to.value, amount, animated.angleMode === 'shortest');
}

function withKeyframes<T>(animated: AnimatedValue<T>, keyframes: Keyframe<T>[]): AnimatedValue<T> {
	const angleMode = isAnimated(animated) ? animated.angleMode : undefined;
	return angleMode ? { keyframes, angleMode } : { keyframes };
}

export function addKeyframe<T>(
	animated: AnimatedValue<T>,
	keyframe: Keyframe<T>
): AnimatedValue<T> {
	assertKeyframeTime(keyframe.time);
	const existing = isAnimated(animated) ? animated.keyframes : [];
	const next = sortedKeyframes([
		...existing.filter((item) => item.time !== keyframe.time),
		keyframe
	]);
	return withKeyframes(animated, next);
}

export function removeKeyframe<T>(animated: AnimatedValue<T>, time: Time): AnimatedValue<T> {
	if (!isAnimated(animated)) return animated;
	const remaining = animated.keyframes.filter((item) => item.time !== time);
	if (remaining.length === animated.keyframes.length) return animated;
	if (remaining.length === 0) {
		return { value: evaluate(animated, time) };
	}
	return withKeyframes(animated, remaining);
}

export function moveKeyframe<T>(
	animated: AnimatedValue<T>,
	fromTime: Time,
	toTime: Time
): AnimatedValue<T> {
	assertKeyframeTime(toTime);
	if (!isAnimated(animated)) return animated;
	const moving = animated.keyframes.find((item) => item.time === fromTime);
	if (!moving) return animated;
	const rest = animated.keyframes.filter((item) => item.time !== fromTime && item.time !== toTime);
	return withKeyframes(animated, sortedKeyframes([...rest, { ...moving, time: toTime }]));
}

export function setInterpolation<T>(
	animated: AnimatedValue<T>,
	time: Time,
	interpolation: Interpolation,
	handles: { easeIn?: BezierHandle; easeOut?: BezierHandle } = {}
): AnimatedValue<T> {
	if (!isAnimated(animated)) return animated;
	return withKeyframes(
		animated,
		animated.keyframes.map((item) => {
			if (item.time !== time) return item;
			const rest: Keyframe<T> = {
				time: item.time,
				value: item.value,
				interpolation,
				...(item.anchor ? { anchor: item.anchor } : {})
			};
			return {
				...rest,
				...(handles.easeIn ? { easeIn: clampHandle(handles.easeIn) } : {}),
				...(handles.easeOut ? { easeOut: clampHandle(handles.easeOut) } : {})
			};
		})
	);
}

export function shiftAnimatedValue<T>(animated: AnimatedValue<T>, delta: Time): AnimatedValue<T> {
	if (!isAnimated(animated) || delta === 0) return animated;
	return withKeyframes(
		animated,
		animated.keyframes.map((item) => {
			const time = item.time + delta;
			assertKeyframeTime(time);
			return { ...item, time };
		})
	);
}

function assertKeyframeTime(time: Time): void {
	if (!Number.isSafeInteger(time) || time < 0) {
		throw new RangeError('Keyframe time must be a non-negative integer tick value.');
	}
}

function splitCubic(
	p0: Point,
	p1: Point,
	p2: Point,
	p3: Point,
	s: number
): { left: [Point, Point, Point, Point]; right: [Point, Point, Point, Point] } {
	const mix = (a: Point, b: Point): Point => ({
		x: a.x + (b.x - a.x) * s,
		y: a.y + (b.y - a.y) * s
	});
	const p01 = mix(p0, p1);
	const p12 = mix(p1, p2);
	const p23 = mix(p2, p3);
	const p012 = mix(p01, p12);
	const p123 = mix(p12, p23);
	const p0123 = mix(p012, p123);
	return { left: [p0, p01, p012, p0123], right: [p0123, p123, p23, p3] };
}

const BAKE_STEPS = 64;

/**
 * Replaces the segment after keyframe `index` with short linear steps that follow its curve. A
 * closed-form easing cannot be cut in two the way a bezier can, so splitting bakes it first.
 */
function bakeSegment<T>(animated: AnimatedValue<T>, index: number): AnimatedValue<T> {
	if (!isAnimated(animated)) return animated;
	const keyframes = animated.keyframes;
	const from = keyframes[index]!;
	const to = keyframes[index + 1]!;
	const steps: Keyframe<T>[] = [];
	for (let step = 1; step < BAKE_STEPS; step += 1) {
		const time = from.time + Math.round(((to.time - from.time) * step) / BAKE_STEPS);
		if (time <= (steps[steps.length - 1]?.time ?? from.time) || time >= to.time) continue;
		steps.push({
			time,
			value: evaluate(animated, time),
			interpolation: 'linear',
			...(from.anchor && to.anchor ? { anchor: 'end' as const } : {})
		});
	}
	const { easeOut: _out, ...plain } = from;
	void _out;
	return withKeyframes(animated, [
		...keyframes.slice(0, index),
		{ ...plain, interpolation: 'linear' },
		...steps,
		...keyframes.slice(index + 1)
	]);
}

/**
 * Splits at a clip-local time. The left side keeps its time base; the right side is shifted so
 * the split point becomes time 0. Cubic-bezier segments are cut with de Casteljau so both sides
 * reproduce the original curve exactly.
 */
export function splitAnimatedValue<T>(
	animated: AnimatedValue<T>,
	atLocalTime: Time
): [AnimatedValue<T>, AnimatedValue<T>] {
	assertKeyframeTime(atLocalTime);
	if (!isAnimated(animated)) return [animated, animated];
	const keyframes = animated.keyframes;
	const first = keyframes[0]!;
	const last = keyframes[keyframes.length - 1]!;
	if (atLocalTime <= first.time) {
		const right = shiftAnimatedValue(animated, -atLocalTime);
		return [{ value: first.value }, right];
	}
	if (atLocalTime >= last.time) {
		return [animated, { value: last.value }];
	}
	const exact = keyframes.findIndex((item) => item.time === atLocalTime);
	if (exact >= 0) {
		return [
			withKeyframes(animated, keyframes.slice(0, exact + 1)),
			shiftAnimatedValue(withKeyframes(animated, keyframes.slice(exact)), -atLocalTime)
		];
	}

	let index = 0;
	while (keyframes[index + 1]!.time < atLocalTime) index += 1;
	const from = keyframes[index]!;
	const to = keyframes[index + 1]!;
	if (CLOSED_FORM_EASINGS[from.interpolation]) {
		return splitAnimatedValue(bakeSegment(animated, index), atLocalTime);
	}
	const boundaryValue = evaluate(animated, atLocalTime);
	const leftKeys = keyframes.slice(0, index + 1);
	const rightKeys = keyframes.slice(index + 1);
	const anchor = from.anchor && to.anchor ? { anchor: 'end' as const } : {};
	let leftFrom: Keyframe<T> = from;
	let leftBoundary: Keyframe<T> = {
		time: atLocalTime,
		value: boundaryValue,
		interpolation: from.interpolation,
		...anchor
	};
	let rightBoundary: Keyframe<T> = {
		time: atLocalTime,
		value: boundaryValue,
		interpolation: from.interpolation,
		...anchor
	};
	let rightTo: Keyframe<T> = to;

	if (from.interpolation === 'bezier') {
		const handles = handlesFor(from, to);
		const u = (atLocalTime - from.time) / (to.time - from.time);
		const s = solveBezierParameter(handles.out.x, handles.in.x, u);
		const { left, right } = splitCubic({ x: 0, y: 0 }, handles.out, handles.in, { x: 1, y: 1 }, s);
		const cut = left[3];
		const safeY = Math.abs(cut.y) < 1e-12 ? 1 : cut.y;
		const safeRest = Math.abs(1 - cut.y) < 1e-12 ? 1 : 1 - cut.y;
		const normalizeLeft = (point: Point): BezierHandle => ({
			x: point.x / cut.x,
			y: point.y / safeY
		});
		const normalizeRight = (point: Point): BezierHandle => ({
			x: (point.x - cut.x) / (1 - cut.x),
			y: (point.y - cut.y) / safeRest
		});
		leftFrom = { ...from, easeOut: normalizeLeft(left[1]) };
		leftBoundary = { ...leftBoundary, easeIn: normalizeLeft(left[2]) };
		rightBoundary = { ...rightBoundary, easeOut: normalizeRight(right[1]) };
		rightTo = { ...to, easeIn: normalizeRight(right[2]) };
	}

	const leftSide = withKeyframes(animated, [...leftKeys.slice(0, -1), leftFrom, leftBoundary]);
	const rightSide = shiftAnimatedValue(
		withKeyframes(animated, [rightBoundary, rightTo, ...rightKeys.slice(1)]),
		-atLocalTime
	);
	return [leftSide, rightSide];
}

/** Trimming a clip's head by `trimmed` ticks keeps every value at the same absolute time. */
export function retimeAnimatedValue<T>(
	animated: AnimatedValue<T>,
	trimmed: Time
): AnimatedValue<T> {
	if (trimmed === 0) return animated;
	return splitAnimatedValue(animated, trimmed)[1];
}

/**
 * Re-times the end-anchored keys after a tail trim or extension so an out animation still finishes
 * on the last frame. A trim drops the keys the moved group would run into and squeezes a group longer
 * than the clip into it; an extension only adds room, so it keeps every other key. Curves with no
 * anchored keys are returned as they are.
 */
export function retimeAnimatedValueTail<T>(
	animated: AnimatedValue<T>,
	oldDuration: Time,
	newDuration: Time
): AnimatedValue<T> {
	if (!isAnimated(animated) || oldDuration === newDuration) return animated;
	const anchored = animated.keyframes.filter((key) => key.anchor === 'end');
	const first = anchored[0];
	if (!first) return animated;
	const delta = newDuration - oldDuration;
	const lastTime = anchored[anchored.length - 1]!.time;
	const lastMoved = Math.max(0, lastTime + delta);
	const span = lastTime - first.time;
	const squeeze = span > 0 && first.time + delta < 0 ? lastMoved / span : 1;
	const moved: Keyframe<T>[] = [];
	for (const key of anchored) {
		const time = Math.round(lastMoved - (lastTime - key.time) * squeeze);
		if (moved[moved.length - 1]?.time !== time) moved.push({ ...key, time });
	}
	const movedTimes = new Set(moved.map((key) => key.time));
	const others = animated.keyframes.filter((key) => key.anchor !== 'end');
	if (delta > 0) {
		const kept = others.filter((key) => !movedTimes.has(key.time));
		return withKeyframes(
			animated,
			[...kept, ...moved].sort((a, b) => a.time - b.time)
		);
	}
	const kept = others.filter((key) => key.time < moved[0]!.time);
	return withKeyframes(animated, [...kept, ...moved]);
}

export function evaluateOr<T>(
	animated: AnimatedValue<T> | undefined,
	localTime: Time,
	fallback: T
): T {
	return animated ? evaluate(animated, localTime) : fallback;
}

export function mapAnimatedRecord(
	record: Record<string, AnimatedValue<unknown>> | undefined,
	transform: (value: AnimatedValue<unknown>) => AnimatedValue<unknown>
): Record<string, AnimatedValue<unknown>> | undefined {
	if (!record) return undefined;
	return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, transform(value)]));
}

export function isAnimatedValue(value: unknown): value is AnimatedValue<unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	return 'keyframes' in value || 'value' in value;
}
