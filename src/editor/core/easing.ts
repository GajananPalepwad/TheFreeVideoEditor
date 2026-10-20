/**
 * Closed-form easing curves that a cubic bezier cannot express. Each maps segment progress
 * [0, 1] to eased progress, starts at exactly 0 and lands on exactly 1.
 */

export type EasingFunction = (progress: number) => number;

function clampUnit(progress: number): number {
	return Math.min(1, Math.max(0, progress));
}

const SPRING_DECAY = 6;
const SPRING_FREQUENCY = 12;

function springRaw(u: number): number {
	const envelope = Math.exp(-SPRING_DECAY * u);
	const phase = SPRING_FREQUENCY * u;
	// The sine weight is decay / frequency, which gives the curve zero velocity at u = 0.
	return 1 - envelope * (Math.cos(phase) + (SPRING_DECAY / SPRING_FREQUENCY) * Math.sin(phase));
}

const SPRING_RESIDUE = 1 - springRaw(1);

/** Under-damped spring that overshoots and settles. A smoothstep closes the tiny residual gap. */
export function springEase(progress: number): number {
	const u = clampUnit(progress);
	if (u === 0 || u === 1) return u;
	return springRaw(u) + SPRING_RESIDUE * u * u * (3 - 2 * u);
}

const ELASTIC_PERIOD = (2 * Math.PI) / 3;

/** Rubber-band ease-out that swings past the target several times. */
export function elasticEase(progress: number): number {
	const u = clampUnit(progress);
	if (u === 0 || u === 1) return u;
	return 2 ** (-10 * u) * Math.sin((10 * u - 0.75) * ELASTIC_PERIOD) + 1;
}

/** Ball dropped onto the target: falls, hits it, and rebounds with shrinking height. */
export function bounceEase(progress: number): number {
	const u = clampUnit(progress);
	const strength = 7.5625;
	const span = 2.75;
	if (u < 1 / span) return strength * u * u;
	if (u < 2 / span) {
		const t = u - 1.5 / span;
		return strength * t * t + 0.75;
	}
	if (u < 2.5 / span) {
		const t = u - 2.25 / span;
		return strength * t * t + 0.9375;
	}
	const t = u - 2.625 / span;
	return strength * t * t + 0.984375;
}
