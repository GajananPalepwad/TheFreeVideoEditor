import { framesToTicks, ticksToFrames } from './time';
import type { Time } from './types';

export interface PixelRange {
	start: number;
	end: number;
}

export function intersectsPixelRange(start: number, width: number, range: PixelRange): boolean {
	if (
		!Number.isFinite(start) ||
		!Number.isFinite(width) ||
		width < 0 ||
		!Number.isFinite(range.start) ||
		!Number.isFinite(range.end) ||
		range.end < range.start
	) {
		throw new RangeError('Pixel range values must be finite and non-negative in width.');
	}
	return start <= range.end && start + width >= range.start;
}

export function pixelsToTime(pixels: number, pixelsPerSecond: number, fps: number): Time {
	if (!Number.isFinite(pixels) || !Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
		throw new RangeError('Pixel position must be finite and timeline zoom must be positive.');
	}
	return framesToTicks(Math.max(0, Math.round((pixels / pixelsPerSecond) * fps)), fps);
}

export function timeToPixels(time: Time, pixelsPerSecond: number): number {
	if (
		!Number.isSafeInteger(time) ||
		time < 0 ||
		!Number.isFinite(pixelsPerSecond) ||
		pixelsPerSecond <= 0
	) {
		throw new RangeError(
			'Timeline time must be non-negative integer ticks and zoom must be positive.'
		);
	}
	return (time / 1_000_000) * pixelsPerSecond;
}

export function clientXToTimelineTime(
	clientX: number,
	viewportLeft: number,
	scrollLeft: number,
	headerWidth: number,
	pixelsPerSecond: number,
	fps: number
): Time {
	return pixelsToTime(clientX - viewportLeft + scrollLeft - headerWidth, pixelsPerSecond, fps);
}

export function snapToFrame(time: Time, fps: number): Time {
	if (!Number.isSafeInteger(time) || time < 0)
		throw new RangeError('Timeline time must be non-negative ticks.');
	return framesToTicks(ticksToFrames(time, fps), fps);
}

/**
 * Computes timeline sample times for filmstrip thumbnail frames based on their
 * physical pixel position along the clip so backward trimming does not shift earlier frames.
 */
export function calculateFilmstripFrameTimelineTimes(
	clipStart: Time,
	clipDuration: Time,
	pixelsPerSecond: number,
	frameWidth = 56
): Time[] {
	if (!Number.isSafeInteger(clipStart) || clipStart < 0) {
		throw new RangeError('Clip start must be non-negative integer ticks.');
	}
	if (!Number.isSafeInteger(clipDuration) || clipDuration <= 0) {
		return [];
	}
	if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) {
		throw new RangeError('Timeline zoom must be positive.');
	}
	if (!Number.isFinite(frameWidth) || frameWidth <= 0) {
		throw new RangeError('Frame width must be positive.');
	}

	const clipWidth = Math.max(12, timeToPixels(clipDuration, pixelsPerSecond));
	const count = Math.max(1, Math.ceil(clipWidth / frameWidth));
	const times: Time[] = [];

	for (let i = 0; i < count; i += 1) {
		const offsetUs = Math.min(
			clipDuration,
			Math.round((((i + 0.5) * frameWidth) / pixelsPerSecond) * 1_000_000)
		);
		times.push(clipStart + offsetUs);
	}

	return times;
}
