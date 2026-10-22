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

export const MAX_GRADIENT_STOPS = 16;

/** The list an editor starts from: the clip's stops, or the fill and end colour as two stops. */
export function stopsForEditing(clip: Clip, fill: GradientColor): GradientStop[] {
	const fields = gradientFieldsOf(clip);
	if (fields?.gradientStops && fields.gradientStops.length >= 2) return fields.gradientStops;
	return [
		{ offset: 0, color: fill },
		{ offset: 1, color: fields?.gradientColorEnd ?? fill }
	];
}

const mix = (from: number, to: number, amount: number): number => from + (to - from) * amount;

/**
 * The list with one more stop, in the middle of the widest gap and the colour the gradient has
 * there. The new stop goes on the end so the numbers of the others, which their animation is
 * stored under, stay the same.
 */
export function withNewStop(stops: GradientStop[]): GradientStop[] {
	if (stops.length >= MAX_GRADIENT_STOPS) return stops;
	const sorted = [...stops].sort((a, b) => a.offset - b.offset);
	let widest = 0;
	let at = 0;
	for (let index = 0; index < sorted.length - 1; index += 1) {
		const gap = sorted[index + 1]!.offset - sorted[index]!.offset;
		if (gap > widest) {
			widest = gap;
			at = index;
		}
	}
	const before = sorted[at]!;
	const after = sorted[Math.min(at + 1, sorted.length - 1)]!;
	const color: GradientColor = {
		r: mix(before.color.r, after.color.r, 0.5),
		g: mix(before.color.g, after.color.g, 0.5),
		b: mix(before.color.b, after.color.b, 0.5),
		a: mix(before.color.a, after.color.a, 0.5)
	};
	return [...stops, { offset: (before.offset + after.offset) / 2, color }];
}

/** The clip with its gradient stops set, on the source or text box that keeps them. */
export function setClipGradientStops(clip: Clip, stops: GradientStop[] | undefined): Clip {
	const source = clip.source;
	if (!source) return clip;
	if (source.type === 'text') {
		return { ...clip, source: { ...source, box: { ...source.box, gradientStops: stops } } };
	}
	if (source.type === 'shape' || source.type === 'solid') {
		return { ...clip, source: { ...source, gradientStops: stops } };
	}
	return clip;
}

const STOP_PROPERTY = /^gradient\.stop(\d+)\.(offset|color)$/;

/**
 * The clip without stop `index`, and with the animation of the stops after it moved down one
 * number. A gradient keeps at least two stops, so this returns the clip as it is below that.
 */
export function removeClipGradientStop(clip: Clip, index: number): Clip {
	const stops = gradientFieldsOf(clip)?.gradientStops;
	if (!stops || stops.length <= 2 || index < 0 || index >= stops.length) return clip;

	const remaining = stops.filter((_, at) => at !== index);
	const properties: NonNullable<Clip['properties']> = {};
	for (const [id, value] of Object.entries(clip.properties ?? {})) {
		const match = STOP_PROPERTY.exec(id);
		if (!match) {
			properties[id] = value;
			continue;
		}
		const at = Number(match[1]);
		if (at === index) continue;
		properties[at > index ? `gradient.stop${at - 1}.${match[2]}` : id] = value;
	}
	return { ...setClipGradientStops(clip, remaining), properties };
}

/** The colour a gradient blends to when a clip is first given one. */
export const DEFAULT_GRADIENT_END: GradientColor = { r: 0.2, g: 0.2, b: 0.25, a: 1 };

/**
 * The clip with its gradient type set. A clip that had no colour to blend to gets one, and turning
 * the gradient off keeps its stops so turning it back on restores them.
 */
export function withGradientType(clip: Clip, type: GradientType): Clip {
	const fields = gradientFieldsOf(clip);
	const source = clip.source;
	if (!source || (source.type !== 'text' && source.type !== 'shape' && source.type !== 'solid')) {
		return clip;
	}
	const needsEnd =
		type !== 'none' &&
		!fields?.gradientColorEnd &&
		!(fields?.gradientStops && fields.gradientStops.length >= 2);
	const patch: Partial<GradientFields> = {
		gradientType: type,
		...(needsEnd ? { gradientColorEnd: DEFAULT_GRADIENT_END } : {})
	};
	if (source.type === 'text') {
		return { ...clip, source: { ...source, box: { ...source.box, ...patch } } };
	}
	return { ...clip, source: { ...source, ...patch } };
}
