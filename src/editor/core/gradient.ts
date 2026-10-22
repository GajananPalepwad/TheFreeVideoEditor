import type { Clip } from './types';

export type GradientType =
	'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';

export interface GradientColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

/** One colour on a gradient, `offset` being its place from 0 (start) to 1 (end). */
export interface GradientStop {
	offset: number;
	color: GradientColor;
}

/** The gradient fields a text box, shape or solid keeps on its source. */
export interface GradientFields {
	gradientType?: GradientType;
	gradientColorEnd?: GradientColor;
	gradientAngle?: number;
	/** The whole list of colours. It replaces the fill and `gradientColorEnd` when it has two or more. */
	gradientStops?: GradientStop[];
}

export interface ResolvedGradient {
	type: Exclude<GradientType, 'none'>;
	/** Degrees, used by `linear-angle`. */
	angle: number;
	/** Sorted by offset, at least two. */
	stops: GradientStop[];
}

const DEFAULT_ANGLE = 45;

/** The gradient fields of a clip's source: a text box keeps them on its box, a shape or solid on itself. */
export function gradientFieldsOf(clip: Clip): GradientFields | null {
	const source = clip.source;
	if (!source) return null;
	if (source.type === 'text') return source.box ?? null;
	if (source.type === 'shape' || source.type === 'solid') return source;
	return null;
}

/** How many stops the clip's gradient has, 0 for none. */
export function gradientStopCount(clip: Clip): number {
	const fields = gradientFieldsOf(clip);
	if (!fields?.gradientType || fields.gradientType === 'none') return 0;
	if (fields.gradientStops && fields.gradientStops.length >= 2) return fields.gradientStops.length;
	return fields.gradientColorEnd ? 2 : 0;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function colorFrom(value: unknown): GradientColor | null {
	if (!Array.isArray(value) || value.length < 4) return null;
	const [r, g, b, a] = value as unknown[];
	return [r, g, b, a].every((channel) => typeof channel === 'number' && Number.isFinite(channel))
		? { r: r as number, g: g as number, b: b as number, a: a as number }
		: null;
}

function numberFrom(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The gradient to draw at one moment, or null for none. The stops come from the source (or the
 * fill and end colour of the old two colour fields). The `gradient.angle` and
 * `gradient.stop<N>.offset` / `.color` properties, when present, replace their value so a
 * gradient can be keyframed. `read` returns a property's value at that moment, or undefined.
 */
export function resolveGradient(
	fields: GradientFields,
	fill: GradientColor,
	read: (propertyId: string) => unknown
): ResolvedGradient | null {
	const type = fields.gradientType;
	if (!type || type === 'none') return null;

	let stops: GradientStop[];
	if (fields.gradientStops && fields.gradientStops.length >= 2) {
		stops = fields.gradientStops.map((stop) => ({ offset: stop.offset, color: stop.color }));
	} else if (fields.gradientColorEnd) {
		stops = [
			{ offset: 0, color: fill },
			{ offset: 1, color: fields.gradientColorEnd }
		];
	} else {
		return null;
	}

	stops = stops.map((stop, index) => ({
		offset: numberFrom(read(`gradient.stop${index}.offset`)) ?? stop.offset,
		color: colorFrom(read(`gradient.stop${index}.color`)) ?? stop.color
	}));
	stops = stops
		.map((stop) => ({ offset: clamp01(stop.offset), color: stop.color }))
		.sort((a, b) => a.offset - b.offset);

	return {
		type,
		angle: numberFrom(read('gradient.angle')) ?? fields.gradientAngle ?? DEFAULT_ANGLE,
		stops
	};
}

/**
 * The gradient a renderer draws from the fields a layer carries: its stops when it has them,
 * otherwise the fill and end colour. Null when there is nothing to blend.
 */
export function layerGradient(
	type: GradientType | undefined,
	fill: GradientColor,
	end: GradientColor | undefined,
	angle: number | undefined,
	stops: GradientStop[] | undefined
): ResolvedGradient | null {
	return resolveGradient(
		{ gradientType: type, gradientColorEnd: end, gradientAngle: angle, gradientStops: stops },
		fill,
		() => undefined
	);
}

const channel = (value: number): number => Math.round(value * 1000) / 1000;

/** A string that is equal for equal gradients, for caching what was drawn with one. */
export function gradientKey(gradient: ResolvedGradient | null): string {
	if (!gradient) return 'none';
	const stops = gradient.stops
		.map(
			(stop) =>
				`${channel(stop.offset)}:${channel(stop.color.r)},${channel(stop.color.g)},${channel(stop.color.b)},${channel(stop.color.a)}`
		)
		.join('|');
	return `${gradient.type}@${channel(gradient.angle)}[${stops}]`;
}
