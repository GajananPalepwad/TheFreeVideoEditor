import { textAnimationInset } from './text/animator';
import { clampCrop, type Crop } from './crop';
import { applyAffine, croppedFitRect, layerAffine } from './layerGeometry';
import type { ActiveLayer } from './playback';

/*
 * Coordinate spaces
 *   monitor CSS px  → composition px:  divide by `monitorScale` (monitor px per composition px)
 *   composition px  → layer-local:     subtract the pivot T, undo rotation R, divide by scale S
 * The pivot T = (W/2 + x + ax, H/2 + y + ay) is where the layer rotates and scales; a layer point
 * with rest coordinates o (unscaled, relative to the pivot) lands at T + R·S·o. `layerAffine`
 * is the single source of truth for that mapping.
 */

export interface Point {
	x: number;
	y: number;
}

export type Vec2 = readonly [number, number];

export interface GizmoGeometry {
	sourceWidth: number;
	sourceHeight: number;
	width: number;
	height: number;
	crop?: Crop;
	fit?: 'contain' | 'none';
	kind?: string;
	textData?: ActiveLayer['textData'];
}

export interface GizmoState {
	position: Vec2;
	scale: Vec2;
	/** Degrees. */
	rotation: number;
	anchor: Vec2;
}

export type GizmoHandle =
	'move' | 'rotate' | 'anchor' | `scale-corner:${0 | 1 | 2 | 3}` | `scale-edge:${0 | 1 | 2 | 3}`;

export interface GizmoModifiers {
	shift: boolean;
	alt: boolean;
}

export interface GizmoPartial {
	position?: [number, number];
	scale?: [number, number];
	rotation?: number;
	anchor?: [number, number];
}

export const MIN_GIZMO_SCALE = 0.001;
export const ROTATE_HANDLE_OFFSET_PX = 28;
export const ROTATE_SNAP_DEGREES = 15;

type Corners = [Point, Point, Point, Point];

function layerOf(
	state: GizmoState,
	geometry: GizmoGeometry
): Pick<ActiveLayer, 'transform' | 'anchor' | 'crop' | 'fit'> & {
	kind?: string;
	textData?: ActiveLayer['textData'];
} {
	return {
		transform: {
			x: state.position[0],
			y: state.position[1],
			scaleX: state.scale[0],
			scaleY: state.scale[1],
			rotation: state.rotation,
			opacity: 1
		},
		anchor: { x: state.anchor[0], y: state.anchor[1] },
		...(geometry.crop ? { crop: geometry.crop } : {}),
		fit: geometry.fit ?? 'contain',
		kind: geometry.kind as ActiveLayer['kind'],
		textData: geometry.textData
	};
}

/** Corners in composition px: top-left, top-right, bottom-right, bottom-left (before any rotation = visual order). */
export function layerCorners(
	layer: Pick<ActiveLayer, 'transform' | 'anchor' | 'crop'>,
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number
): Corners {
	const affine = layerAffine(layer, sourceWidth, sourceHeight, width, height);
	return [
		applyAffine(affine, 0, 0),
		applyAffine(affine, 1, 0),
		applyAffine(affine, 1, 1),
		applyAffine(affine, 0, 1)
	];
}

export function stateCorners(state: GizmoState, geometry: GizmoGeometry): Corners {
	return layerCorners(
		layerOf(state, geometry),
		geometry.sourceWidth,
		geometry.sourceHeight,
		geometry.width,
		geometry.height
	);
}

/** The rotation/scale pivot in composition px. */
export function pivotPoint(state: GizmoState, geometry: GizmoGeometry): Point {
	return {
		x: geometry.width / 2 + state.position[0] + state.anchor[0],
		y: geometry.height / 2 + state.position[1] + state.anchor[1]
	};
}

function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function edgeMidpoints(corners: Corners): Corners {
	return [
		midpoint(corners[0], corners[1]),
		midpoint(corners[1], corners[2]),
		midpoint(corners[2], corners[3]),
		midpoint(corners[3], corners[0])
	];
}

/** Where the rotate handle sits: above the top edge, `ROTATE_HANDLE_OFFSET_PX` monitor px away. */
export function rotateHandlePoint(corners: Corners, monitorScale: number): Point {
	const top = midpoint(corners[0], corners[1]);
	const centre = midpoint(corners[0], corners[2]);
	const dx = top.x - centre.x;
	const dy = top.y - centre.y;
	const length = Math.hypot(dx, dy) || 1;
	const offset = ROTATE_HANDLE_OFFSET_PX / monitorScale;
	return { x: top.x + (dx / length) * offset, y: top.y + (dy / length) * offset };
}

function distance(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function insideQuad(point: Point, corners: Corners): boolean {
	let sign = 0;
	for (let index = 0; index < 4; index += 1) {
		const a = corners[index]!;
		const b = corners[(index + 1) % 4]!;
		const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
		if (cross === 0) continue;
		const current = Math.sign(cross);
		if (sign === 0) sign = current;
		else if (sign !== current) return false;
	}
	return true;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const lengthSquared = abx * abx + aby * aby;
	const t =
		lengthSquared === 0
			? 0
			: Math.max(0, Math.min(1, ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared));
	return distance(point, { x: a.x + abx * t, y: a.y + aby * t });
}

/**
 * Finds the handle under a point. `point` is in composition px; `tolerance` is in monitor px and
 * `monitorScale` converts it (monitor px per composition px). Priority: anchor, rotate, corners,
 * edges, then the body (move).
 */
export function hitTest(
	point: Point,
	corners: Corners,
	pivot: Point,
	monitorScale: number,
	tolerance: number
): GizmoHandle | null {
	const tol = tolerance / monitorScale;
	if (distance(point, pivot) <= tol) return 'anchor';
	if (distance(point, rotateHandlePoint(corners, monitorScale)) <= tol) return 'rotate';
	for (let index = 0; index < 4; index += 1) {
		if (distance(point, corners[index]!) <= tol) return `scale-corner:${index as 0 | 1 | 2 | 3}`;
	}
	for (let index = 0; index < 4; index += 1) {
		if (distanceToSegment(point, corners[index]!, corners[(index + 1) % 4]!) <= tol) {
			return `scale-edge:${index as 0 | 1 | 2 | 3}`;
		}
	}
	return insideQuad(point, corners) ? 'move' : null;
}

function rotateVector(vector: Point, degrees: number): Point {
	const radians = (degrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return { x: cos * vector.x - sin * vector.y, y: sin * vector.x + cos * vector.y };
}

/** Rest-frame (unscaled, pivot-relative) coordinates of the unit-quad point (u, v). */
function restPoint(state: GizmoState, geometry: GizmoGeometry, u: number, v: number): Point {
	const isText = geometry.kind === 'text';
	const isAutoSize = geometry.textData?.box?.autoSize !== false;
	const alignment = isText && isAutoSize ? geometry.textData?.style?.alignment : undefined;
	const verticalAnchor = isText && isAutoSize ? geometry.textData?.box?.verticalAnchor : undefined;

	const rect = croppedFitRect(
		geometry.crop,
		geometry.sourceWidth,
		geometry.sourceHeight,
		geometry.width,
		geometry.height,
		geometry.fit ?? 'contain',
		alignment,
		verticalAnchor,
		isText ? textAnimationInset(geometry.textData) : 0
	);
	return {
		x: rect.x + u * rect.width - geometry.width / 2 - state.anchor[0],
		y: rect.y + v * rect.height - geometry.height / 2 - state.anchor[1]
	};
}

const CORNER_UV: ReadonlyArray<readonly [number, number]> = [
	[0, 0],
	[1, 0],
	[1, 1],
	[0, 1]
];
const EDGE_UV: ReadonlyArray<readonly [number, number]> = [
	[0.5, 0],
	[1, 0.5],
	[0.5, 1],
	[0, 0.5]
];

function normalizeDegrees(delta: number): number {
	let value = ((delta + 180) % 360) - 180;
	if (value <= -180) value += 360;
	return value;
}

function clampScale(value: number): number {
	return Number.isFinite(value) ? Math.max(MIN_GIZMO_SCALE, value) : 1;
}

function positionForPivot(
	pivot: Point,
	state: GizmoState,
	geometry: GizmoGeometry
): [number, number] {
	return [
		pivot.x - geometry.width / 2 - state.anchor[0],
		pivot.y - geometry.height / 2 - state.anchor[1]
	];
}

/**
 * Computes the property changes for a drag. Pointer positions are in composition px.
 * - move: translates `position`.
 * - scale-corner: the opposite corner stays fixed; uniform by default, Shift = free, Alt = scale
 *   about the anchor (pivot) instead.
 * - scale-edge: scales one axis, the opposite edge stays fixed (Alt: about the anchor).
 * - rotate: rotates about the anchor following the pointer; Shift snaps to 15°.
 * - anchor: moves the pivot to the pointer and compensates `position` so the image does not move.
 */
export function applyDrag(
	handle: GizmoHandle,
	start: GizmoState,
	geometry: GizmoGeometry,
	pointer: { start: Point; current: Point },
	modifiers: GizmoModifiers
): GizmoPartial {
	const delta = { x: pointer.current.x - pointer.start.x, y: pointer.current.y - pointer.start.y };
	if (handle === 'move') {
		return { position: [start.position[0] + delta.x, start.position[1] + delta.y] };
	}
	const pivot = pivotPoint(start, geometry);
	if (handle === 'rotate') {
		const from = Math.atan2(pointer.start.y - pivot.y, pointer.start.x - pivot.x);
		const to = Math.atan2(pointer.current.y - pivot.y, pointer.current.x - pivot.x);
		let rotation = start.rotation + normalizeDegrees(((to - from) * 180) / Math.PI);
		if (modifiers.shift)
			rotation = Math.round(rotation / ROTATE_SNAP_DEGREES) * ROTATE_SNAP_DEGREES;
		return { rotation };
	}
	if (handle === 'anchor') {
		const target = { x: pivot.x + delta.x, y: pivot.y + delta.y };
		const local = rotateVector({ x: target.x - pivot.x, y: target.y - pivot.y }, -start.rotation);
		const anchor: [number, number] = [
			start.anchor[0] + local.x / start.scale[0],
			start.anchor[1] + local.y / start.scale[1]
		];
		const next: GizmoState = { ...start, anchor };
		return { anchor, position: positionForPivot(target, next, geometry) };
	}

	const [kind, indexText] = handle.split(':') as ['scale-corner' | 'scale-edge', string];
	const index = Number(indexText) as 0 | 1 | 2 | 3;
	const isCorner = kind === 'scale-corner';
	const [u, v] = (isCorner ? CORNER_UV : EDGE_UV)[index]!;
	const [ou, ov] = (isCorner ? CORNER_UV : EDGE_UV)[(index + 2) % 4]!;
	const dragged = restPoint(start, geometry, u, v);
	const opposite = restPoint(start, geometry, ou, ov);
	const scale0: Vec2 = start.scale;
	const pointerLocal = rotateVector(
		{ x: pointer.current.x - pivot.x, y: pointer.current.y - pivot.y },
		-start.rotation
	);
	const axisOnly: 'x' | 'y' | null = isCorner ? null : index % 2 === 0 ? 'y' : 'x';

	let next: [number, number] = [scale0[0], scale0[1]];
	if (modifiers.alt) {
		// Scale about the pivot: the dragged point follows the pointer in the pivot's frame.
		if (axisOnly === 'x' && Math.abs(dragged.x) > 1e-9) next[0] = pointerLocal.x / dragged.x;
		else if (axisOnly === 'y' && Math.abs(dragged.y) > 1e-9) next[1] = pointerLocal.y / dragged.y;
		else if (!axisOnly) {
			if (modifiers.shift) {
				if (Math.abs(dragged.x) > 1e-9) next[0] = pointerLocal.x / dragged.x;
				if (Math.abs(dragged.y) > 1e-9) next[1] = pointerLocal.y / dragged.y;
			} else {
				const w = { x: dragged.x * scale0[0], y: dragged.y * scale0[1] };
				const lengthSquared = w.x * w.x + w.y * w.y;
				if (lengthSquared > 1e-12) {
					const k = (pointerLocal.x * w.x + pointerLocal.y * w.y) / lengthSquared;
					next = [scale0[0] * k, scale0[1] * k];
				}
			}
		}
		next = [clampScale(next[0]), clampScale(next[1])];
		return { scale: next };
	}

	// Opposite point fixed in composition space.
	const oppositeWorld = {
		x:
			pivot.x +
			rotateVector({ x: opposite.x * scale0[0], y: opposite.y * scale0[1] }, start.rotation).x,
		y:
			pivot.y +
			rotateVector({ x: opposite.x * scale0[0], y: opposite.y * scale0[1] }, start.rotation).y
	};
	const d = rotateVector(
		{ x: pointer.current.x - oppositeWorld.x, y: pointer.current.y - oppositeWorld.y },
		-start.rotation
	);
	const span = { x: dragged.x - opposite.x, y: dragged.y - opposite.y };
	if (axisOnly === 'x') {
		if (Math.abs(span.x) > 1e-9) next[0] = d.x / span.x;
	} else if (axisOnly === 'y') {
		if (Math.abs(span.y) > 1e-9) next[1] = d.y / span.y;
	} else if (modifiers.shift) {
		if (Math.abs(span.x) > 1e-9) next[0] = d.x / span.x;
		if (Math.abs(span.y) > 1e-9) next[1] = d.y / span.y;
	} else {
		const w = { x: span.x * scale0[0], y: span.y * scale0[1] };
		const lengthSquared = w.x * w.x + w.y * w.y;
		if (lengthSquared > 1e-12) {
			const k = (d.x * w.x + d.y * w.y) / lengthSquared;
			next = [scale0[0] * k, scale0[1] * k];
		}
	}
	next = [clampScale(next[0]), clampScale(next[1])];
	// New pivot so that the opposite point stays where it was.
	const shifted = rotateVector(
		{ x: opposite.x * next[0], y: opposite.y * next[1] },
		start.rotation
	);
	const newPivot = { x: oppositeWorld.x - shifted.x, y: oppositeWorld.y - shifted.y };
	return { scale: next, position: positionForPivot(newPivot, start, geometry) };
}

/** Clamps crop insets edited by dragging a source edge inward (used by crop-aware callers). */
export function dragCropEdge(start: Crop, index: 0 | 1 | 2 | 3, fraction: number): Crop {
	const next: [number, number, number, number] = [start[0], start[1], start[2], start[3]];
	next[index] = fraction;
	return clampCrop(next, index);
}

export interface Guide {
	axis: 'x' | 'y';
	position: number;
	kind: 'center' | 'edge' | 'third' | 'safe-90' | 'safe-80';
}

export function compositionGuides(width: number, height: number): Guide[] {
	const guides: Guide[] = [];
	const add = (axis: 'x' | 'y', fraction: number, kind: Guide['kind']): void => {
		guides.push({ axis, position: fraction * (axis === 'x' ? width : height), kind });
	};
	for (const axis of ['x', 'y'] as const) {
		add(axis, 0.5, 'center');
		add(axis, 0, 'edge');
		add(axis, 1, 'edge');
		add(axis, 1 / 3, 'third');
		add(axis, 2 / 3, 'third');
		add(axis, 0.05, 'safe-90');
		add(axis, 0.95, 'safe-90');
		add(axis, 0.1, 'safe-80');
		add(axis, 0.9, 'safe-80');
	}
	return guides;
}

export interface GizmoSnapResult {
	dx: number;
	dy: number;
	hits: Guide[];
}

/**
 * Snaps a bounding box (left/centre/right and top/middle/bottom features) to the nearest guide
 * within `tolerance` composition px per axis.
 */
export function snapToGuides(
	box: { left: number; top: number; right: number; bottom: number },
	guides: readonly Guide[],
	tolerance: number
): GizmoSnapResult {
	const result: GizmoSnapResult = { dx: 0, dy: 0, hits: [] };
	const features = {
		x: [box.left, (box.left + box.right) / 2, box.right],
		y: [box.top, (box.top + box.bottom) / 2, box.bottom]
	};
	for (const axis of ['x', 'y'] as const) {
		let best: { delta: number; guide: Guide } | null = null;
		for (const guide of guides) {
			if (guide.axis !== axis) continue;
			for (const feature of features[axis]) {
				const delta = guide.position - feature;
				if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) {
					best = { delta, guide };
				}
			}
		}
		if (best) {
			if (axis === 'x') result.dx = best.delta;
			else result.dy = best.delta;
			result.hits.push(best.guide);
		}
	}
	return result;
}

export function boundingBox(corners: readonly Point[]): {
	left: number;
	top: number;
	right: number;
	bottom: number;
} {
	const xs = corners.map((point) => point.x);
	const ys = corners.map((point) => point.y);
	return {
		left: Math.min(...xs),
		top: Math.min(...ys),
		right: Math.max(...xs),
		bottom: Math.max(...ys)
	};
}
