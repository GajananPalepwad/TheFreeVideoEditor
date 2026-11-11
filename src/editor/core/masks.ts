import { evaluate } from './animation';
import {
	DEFAULT_ELLIPSE_SHAPE,
	DEFAULT_RECT_SHAPE,
	distanceToSegment,
	isPointInEllipse,
	isPointInRect,
	pathShapeToPoints,
	pointInPolygon,
	pointsToPathShape,
	type EllipseShape,
	type RectShape
} from './maskGeometry';
import type { AnimatedValue, Clip, Mask, MaskPoint, PropertyId, Time } from './types';

export interface EvaluatedMask {
	id: string;
	name?: string;
	type: 'rect' | 'ellipse' | 'path';
	mode: 'add' | 'subtract' | 'intersect';
	inverted: boolean;
	feather: number;
	expansion: number;
	opacity: number;
	enabled: boolean;
	closed: boolean;
	shape: number[];
	points?: MaskPoint[];
	effectId?: string;
}

export function createMask(type: 'rect' | 'ellipse' | 'path', overrides: Partial<Mask> = {}): Mask {
	const id = overrides.id ?? `mask_${Math.random().toString(36).slice(2, 9)}`;
	const name = overrides.name ?? `${type.charAt(0).toUpperCase() + type.slice(1)} Mask`;

	let shape: number[];
	let points: MaskPoint[] | undefined;
	const closed = overrides.closed ?? true;

	if (type === 'rect') {
		shape = [...DEFAULT_RECT_SHAPE];
	} else if (type === 'ellipse') {
		shape = [...DEFAULT_ELLIPSE_SHAPE];
	} else {
		if (overrides.points && overrides.points.length > 0) {
			points = overrides.points.map((p) => ({ ...p }));
			shape = pointsToPathShape(points);
		} else {
			points = [
				{ x: 0.3, y: 0.3 },
				{ x: 0.7, y: 0.3 },
				{ x: 0.5, y: 0.7 }
			];
			shape = pointsToPathShape(points);
		}
	}

	return {
		id,
		name,
		type,
		mode: overrides.mode ?? 'add',
		inverted: overrides.inverted ?? false,
		feather: overrides.feather ?? 0,
		expansion: overrides.expansion ?? 0,
		opacity: overrides.opacity ?? 1,
		enabled: overrides.enabled ?? true,
		closed,
		shape: overrides.shape ?? shape,
		...(points ? { points } : {}),
		...(overrides.effectId ? { effectId: overrides.effectId } : {}),
		...(overrides.properties ? { properties: overrides.properties } : {})
	};
}

export function evaluateMask(
	mask: Mask,
	localTime: Time,
	clipProperties?: Record<PropertyId, AnimatedValue<unknown>>
): EvaluatedMask {
	const props = mask.properties ?? {};

	const evalProp = (key: string, fallback: number): number => {
		const curve = props[key] ?? clipProperties?.[`mask:${mask.id}:${key}`];
		if (!curve) return fallback;
		const val = evaluate(curve as AnimatedValue<number>, localTime);
		return typeof val === 'number' ? val : fallback;
	};

	let shape = mask.shape ?? (mask.type === 'rect' ? DEFAULT_RECT_SHAPE : DEFAULT_ELLIPSE_SHAPE);
	const shapeCurve = props.shape ?? clipProperties?.[`mask:${mask.id}:shape`];
	if (shapeCurve) {
		const val = evaluate(shapeCurve as AnimatedValue<number[]>, localTime);
		if (Array.isArray(val)) shape = val;
	}

	const feather = Math.max(0, evalProp('feather', mask.feather));
	const expansion = evalProp('expansion', mask.expansion);
	const opacity = Math.max(0, Math.min(1, evalProp('opacity', mask.opacity)));

	const points = mask.type === 'path' ? (mask.points ?? pathShapeToPoints(shape)) : undefined;

	return {
		id: mask.id,
		name: mask.name,
		type: mask.type,
		mode: mask.mode,
		inverted: mask.inverted,
		feather,
		expansion,
		opacity,
		enabled: mask?.enabled !== false,
		closed: mask.closed !== false,
		shape,
		points,
		effectId: mask.effectId
	};
}

export function addMaskToClip(clip: Clip, mask: Mask): Clip {
	const masks = [...(clip.masks ?? []), mask];
	return { ...clip, masks };
}

export function removeMaskFromClip(clip: Clip, maskId: string): Clip {
	const masks = (clip.masks ?? []).filter((m) => m.id !== maskId);
	return { ...clip, masks };
}

export function updateMaskInClip(clip: Clip, maskId: string, patch: Partial<Mask>): Clip {
	const masks = (clip.masks ?? []).map((m) => {
		if (m.id !== maskId) return m;
		const updated = { ...m, ...patch };
		if (patch.shape && !patch.points && updated.type === 'path') {
			updated.points = pathShapeToPoints(patch.shape);
		} else if (patch.points && !patch.shape && updated.type === 'path') {
			updated.shape = pointsToPathShape(patch.points);
		}
		return updated;
	});
	return { ...clip, masks };
}

export function reorderMasksInClip(clip: Clip, fromIndex: number, toIndex: number): Clip {
	const masks = [...(clip.masks ?? [])];
	if (fromIndex < 0 || fromIndex >= masks.length || toIndex < 0 || toIndex >= masks.length) {
		return clip;
	}
	const [moved] = masks.splice(fromIndex, 1);
	if (moved) masks.splice(toIndex, 0, moved);
	return { ...clip, masks };
}

/**
 * CPU oracle evaluating combined matte across a resolution of [width, height].
 * Produces a Float32Array where each entry is in [0, 1].
 */
export function evaluateMatteCpu(
	masks: readonly EvaluatedMask[],
	width: number,
	height: number
): Float32Array {
	const buffer = new Float32Array(width * height);
	const active = masks.filter((m) => m?.enabled && !m.effectId);
	if (active.length === 0) {
		buffer.fill(1.0);
		return buffer;
	}

	// Initialize accumulator
	const firstMode = active[0]!.mode;
	buffer.fill(firstMode === 'add' ? 0.0 : 1.0);

	const aspect = width / height;

	for (const mask of active) {
		const maskMatte = new Float32Array(width * height);
		const shape = mask.shape;
		const expNorm = mask.expansion / Math.min(width, height);

		for (let y = 0; y < height; y++) {
			const py = (y + 0.5) / height;
			for (let x = 0; x < width; x++) {
				const px = (x + 0.5) / width;
				const idx = y * width + x;

				let inside = false;
				if (mask.type === 'rect') {
					inside = isPointInRect(px, py, shape as RectShape, expNorm, aspect);
				} else if (mask.type === 'ellipse') {
					inside = isPointInEllipse(px, py, shape as EllipseShape, expNorm, aspect);
				} else if (mask.type === 'path' && mask.points && mask.points.length >= 3) {
					inside = pointInPolygon(px, py, mask.points);
					if (expNorm > 0 && !inside) {
						for (let s = 0; s < mask.points.length; s++) {
							const pA = mask.points[s]!;
							const pB = mask.points[(s + 1) % mask.points.length]!;
							if (distanceToSegment({ x: px, y: py }, pA, pB) <= expNorm) {
								inside = true;
								break;
							}
						}
					} else if (expNorm < 0 && inside) {
						for (let s = 0; s < mask.points.length; s++) {
							const pA = mask.points[s]!;
							const pB = mask.points[(s + 1) % mask.points.length]!;
							if (distanceToSegment({ x: px, y: py }, pA, pB) <= Math.abs(expNorm)) {
								inside = false;
								break;
							}
						}
					}
				}

				let val = inside ? 1.0 : 0.0;
				if (mask.inverted) val = 1.0 - val;
				val *= mask.opacity;
				maskMatte[idx] = val;
			}
		}

		// Apply Gaussian feather blur on CPU if feather > 0
		if (mask.feather > 0) {
			gaussianBlurMatteCpu(maskMatte, width, height, mask.feather / 2);
		}

		// Accumulate
		for (let i = 0; i < buffer.length; i++) {
			const M = buffer[i]!;
			const m = maskMatte[i]!;
			if (mask.mode === 'add') {
				buffer[i] = M + m - M * m;
			} else if (mask.mode === 'subtract') {
				buffer[i] = M * (1.0 - m);
			} else if (mask.mode === 'intersect') {
				buffer[i] = M * m;
			}
		}
	}

	return buffer;
}

/** 1D Separable Gaussian blur on CPU */
function gaussianBlurMatteCpu(
	buffer: Float32Array,
	width: number,
	height: number,
	sigma: number
): void {
	if (sigma <= 0.2) return;
	const radius = Math.ceil(sigma * 3);
	const kernelSize = radius * 2 + 1;
	const kernel = new Float32Array(kernelSize);
	let sum = 0;
	for (let i = 0; i < kernelSize; i++) {
		const d = i - radius;
		const weight = Math.exp(-(d * d) / (2 * sigma * sigma));
		kernel[i] = weight;
		sum += weight;
	}
	for (let i = 0; i < kernelSize; i++) kernel[i]! /= sum;

	const temp = new Float32Array(buffer.length);

	// Horizontal pass
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let acc = 0;
			for (let k = -radius; k <= radius; k++) {
				const sx = Math.max(0, Math.min(width - 1, x + k));
				acc += buffer[y * width + sx]! * kernel[k + radius]!;
			}
			temp[y * width + x] = acc;
		}
	}

	// Vertical pass
	for (let x = 0; x < width; x++) {
		for (let y = 0; y < height; y++) {
			let acc = 0;
			for (let k = -radius; k <= radius; k++) {
				const sy = Math.max(0, Math.min(height - 1, y + k));
				acc += temp[sy * width + x]! * kernel[k + radius]!;
			}
			buffer[y * width + x] = acc;
		}
	}
}
