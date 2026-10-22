/**
 * Moves the characters, words or lines of a text layer separately. A single `progress` runs from
 * 0 to 1 over the whole text, and each unit follows it a little later than the one before
 * (`stagger`), from a starting pose (offset, scale, rotation, opacity) to where it normally sits.
 */
export interface TextAnimator {
	/** 0 puts every unit in its starting pose, 1 in its place. */
	progress: number;
	/** 0 moves every unit together; 1 moves them one after another. */
	stagger: number;
	/** The starting pose of each unit, in pixels, ratio, degrees and opacity. */
	offsetX: number;
	offsetY: number;
	scale: number;
	rotation: number;
	opacity: number;
}

export interface UnitPose {
	dx: number;
	dy: number;
	scale: number;
	rotation: number;
	opacity: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

/** The smallest share of the animation each unit takes, so a full stagger still moves every unit. */
const MIN_UNIT_SPAN = 0.05;

/** How far along (0 to 1) unit `index` of `count` is when the whole text is at `progress`. */
export function unitProgress(
	index: number,
	count: number,
	progress: number,
	stagger: number
): number {
	const overall = clamp01(progress);
	if (count <= 1) return overall;
	const span = Math.max(MIN_UNIT_SPAN, 1 - clamp01(stagger));
	const delay = (index / (count - 1)) * (1 - span);
	return clamp01((overall - delay) / span);
}

/** The pose of a unit that is `unit` (0 to 1) of the way from its starting pose to its place. */
export function unitTransform(animator: TextAnimator, unit: number): UnitPose {
	const away = 1 - unit;
	return {
		dx: round(animator.offsetX * away),
		dy: round(animator.offsetY * away),
		scale: round(animator.scale + (1 - animator.scale) * unit),
		rotation: round(animator.rotation * away),
		opacity: round(animator.opacity + (1 - animator.opacity) * unit)
	};
}

/**
 * Pixels of room to keep around the text so a unit that starts away from its place, larger or turned
 * is not cut off by the edge of the picture of the text.
 */
export function animatorMargin(animator: TextAnimator, fontSize: number): number {
	const travel = Math.max(Math.abs(animator.offsetX), Math.abs(animator.offsetY));
	const grow = animator.scale > 1 ? fontSize * (animator.scale - 1) * 0.75 : 0;
	const turn = animator.rotation !== 0 ? fontSize * 0.35 : 0;
	return Math.ceil(Math.max(travel, grow, turn));
}

const DEFAULTS = { stagger: 0.6, offsetX: 0, offsetY: 40, scale: 1, rotation: 0, opacity: 0 };

function numberOr(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The animator a clip has at one moment, or null for none. A clip has one when it sets
 * `text.anim.progress`; the other `text.anim.*` properties it does not set take their defaults.
 */
export function resolveTextAnimator(read: (propertyId: string) => unknown): TextAnimator | null {
	const progress = read('text.anim.progress');
	if (typeof progress !== 'number' || !Number.isFinite(progress)) return null;
	return {
		progress: clamp01(progress),
		stagger: clamp01(numberOr(read('text.anim.stagger'), DEFAULTS.stagger)),
		offsetX: numberOr(read('text.anim.offsetX'), DEFAULTS.offsetX),
		offsetY: numberOr(read('text.anim.offsetY'), DEFAULTS.offsetY),
		scale: Math.max(0, numberOr(read('text.anim.scale'), DEFAULTS.scale)),
		rotation: numberOr(read('text.anim.rotation'), DEFAULTS.rotation),
		opacity: clamp01(numberOr(read('text.anim.opacity'), DEFAULTS.opacity))
	};
}
