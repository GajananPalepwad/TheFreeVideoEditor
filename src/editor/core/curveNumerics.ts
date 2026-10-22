import type { BezierHandle, Time } from './types';

/** A bezier handle as the numbers a person types: both in percent of the segment. */
export interface HandleNumbers {
	/** How far along the segment the handle reaches, 0 to 100. */
	influence: number;
	/** How far along the segment's change in value it reaches. Above 100 or below 0 overshoots. */
	value: number;
}

const roundTo = (value: number, places: number): number => {
	const scale = 10 ** places;
	return Math.round(value * scale) / scale;
};

export function handleToNumbers(handle: BezierHandle): HandleNumbers {
	return { influence: roundTo(handle.x * 100, 2), value: roundTo(handle.y * 100, 2) };
}

/** The handle for typed numbers. The influence stays inside the segment; anything that is not a number counts as 0. */
export function handleFromNumbers(numbers: HandleNumbers): BezierHandle {
	const influence = Number.isFinite(numbers.influence) ? numbers.influence : 0;
	const value = Number.isFinite(numbers.value) ? numbers.value : 0;
	return { x: Math.min(1, Math.max(0, influence / 100)), y: value / 100 };
}

/**
 * An in handle is stored on the keyframe at the end of its segment, measured from the segment's
 * start. The numbers measure it backwards from that keyframe instead, so 42% in matches 42% out.
 */
export function inHandleToNumbers(handle: BezierHandle): HandleNumbers {
	return {
		influence: roundTo((1 - handle.x) * 100, 2),
		value: roundTo((1 - handle.y) * 100, 2)
	};
}

export function inHandleFromNumbers(numbers: HandleNumbers): BezierHandle {
	const influence = Number.isFinite(numbers.influence) ? numbers.influence : 0;
	const value = Number.isFinite(numbers.value) ? numbers.value : 0;
	return {
		x: roundTo(1 - Math.min(100, Math.max(0, influence)) / 100, 6),
		y: roundTo(1 - value / 100, 6)
	};
}

/** Half the window, in microseconds, that velocity is measured over. */
const VELOCITY_HALF_WINDOW: Time = 5_000;

/** How fast a value changes at `time`, in units per second. Negative while it falls. */
export function velocityAt(valueAt: (time: Time) => number, time: Time): number {
	const before = valueAt(time - VELOCITY_HALF_WINDOW);
	const after = valueAt(time + VELOCITY_HALF_WINDOW);
	return ((after - before) / (2 * VELOCITY_HALF_WINDOW)) * 1_000_000;
}

export interface VelocityPoint {
	time: Time;
	velocity: number;
}

/** `count` velocities spread evenly from `start` to `end`, both included. */
export function velocityCurve(
	valueAt: (time: Time) => number,
	start: Time,
	end: Time,
	count: number
): VelocityPoint[] {
	const steps = Math.max(2, Math.floor(count));
	const points: VelocityPoint[] = [];
	for (let index = 0; index < steps; index += 1) {
		const time = Math.round(start + ((end - start) * index) / (steps - 1));
		points.push({ time, velocity: velocityAt(valueAt, time) });
	}
	return points;
}
