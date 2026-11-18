import { describe, expect, it } from 'vitest';
import {
	createMask,
	evaluateMask,
	evaluateMatteCpu,
	addMaskToClip,
	removeMaskFromClip,
	updateMaskInClip,
	reorderMasksInClip
} from './masks';
import {
	assertSamePointCount,
	pointsToPathShape,
	pathShapeToPoints,
	hitTestAnchor,
	hitTestHandle,
	hitTestEdge,
	cubicBezier,
	flattenBezier,
	pointInPolygon
} from './maskGeometry';
import { splitClipAnimation } from './clipAnimation';
import type { Clip, Mask, ClipId, AssetId } from './types';

describe('Mask Geometry & Utilities', () => {
	it('converts between flat PathShape and MaskPoints losslessly', () => {
		const points = [
			{ x: 0.1, y: 0.2, outHandle: { x: 0.05, y: 0.01 } },
			{ x: 0.5, y: 0.6, inHandle: { x: -0.05, y: -0.02 }, outHandle: { x: 0.05, y: 0.02 } },
			{ x: 0.8, y: 0.9, inHandle: { x: -0.04, y: -0.01 } }
		];
		const flat = pointsToPathShape(points);
		expect(flat.length).toBe(18); // 3 points * 6 numbers

		const restored = pathShapeToPoints(flat);
		expect(restored.length).toBe(3);
		expect(restored[0]!.x).toBeCloseTo(0.1);
		expect(restored[0]!.y).toBeCloseTo(0.2);
		expect(restored[0]!.outHandle?.x).toBeCloseTo(0.05);
		expect(restored[1]!.inHandle?.x).toBeCloseTo(-0.05);
	});

	it('enforces same-point-count invariant on path keyframes', () => {
		const shapeA = [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]; // 2 points
		const shapeB = [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0]; // 2 points
		const shapeC = [0, 0, 0, 0, 0, 0]; // 1 point

		expect(() => assertSamePointCount(shapeA, shapeB)).not.toThrow();
		expect(() => assertSamePointCount(shapeA, shapeC)).toThrow(RangeError);
	});

	it('hit-tests anchor points and tangent handles', () => {
		const points = [
			{ x: 0.2, y: 0.2, outHandle: { x: 0.05, y: 0 } },
			{ x: 0.8, y: 0.8, inHandle: { x: -0.05, y: 0 } }
		];
		expect(hitTestAnchor(points, { x: 0.205, y: 0.198 }, 0.02)).toBe(0);
		expect(hitTestAnchor(points, { x: 0.5, y: 0.5 }, 0.02)).toBeNull();

		expect(hitTestHandle(points, { x: 0.252, y: 0.201 }, 0.02)).toEqual({
			pointIndex: 0,
			handle: 'out'
		});
		expect(hitTestHandle(points, { x: 0.748, y: 0.799 }, 0.02)).toEqual({
			pointIndex: 1,
			handle: 'in'
		});
	});

	it('hit-tests edges on closed paths', () => {
		const points = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0, y: 1 }
		];
		const hit = hitTestEdge(points, true, { x: 0.5, y: 0.005 }, 0.02);
		expect(hit).not.toBeNull();
		expect(hit?.segmentIndex).toBe(0);
	});
});

describe('Mask Core Operations', () => {
	it('creates rect, ellipse, and path masks with sensible defaults', () => {
		const rect = createMask('rect');
		expect(rect.type).toBe('rect');
		expect(rect.shape).toHaveLength(6);
		expect(rect.mode).toBe('add');
		expect(rect.opacity).toBe(1);

		const ellipse = createMask('ellipse');
		expect(ellipse.type).toBe('ellipse');
		expect(ellipse.shape).toHaveLength(5);

		const path = createMask('path');
		expect(path.type).toBe('path');
		expect(path.shape?.length).toBeGreaterThanOrEqual(18);
	});

	it('mutates masks on clip immutably (add, update, remove, reorder)', () => {
		const clip: Clip = {
			id: 'c1' as ClipId,
			assetId: 'a1' as AssetId,
			start: 0,
			duration: 1_000_000,
			sourceIn: 0,
			sourceOut: 1_000_000,
			speed: 1,
			volume: 1
		};

		const m1 = createMask('rect', { id: 'm1' });
		const m2 = createMask('ellipse', { id: 'm2' });

		const withM1 = addMaskToClip(clip, m1);
		expect(withM1.masks).toHaveLength(1);

		const withBoth = addMaskToClip(withM1, m2);
		expect(withBoth.masks).toHaveLength(2);

		const updated = updateMaskInClip(withBoth, 'm1', { feather: 20 });
		expect(updated.masks![0]!.feather).toBe(20);

		const reordered = reorderMasksInClip(updated, 0, 1);
		expect(reordered.masks![0]!.id).toBe('m2');
		expect(reordered.masks![1]!.id).toBe('m1');

		const removed = removeMaskFromClip(reordered, 'm2');
		expect(removed.masks).toHaveLength(1);
		expect(removed.masks![0]!.id).toBe('m1');
	});

	it('evaluates animated mask properties over time', () => {
		const mask: Mask = {
			...createMask('rect', { id: 'm_anim' }),
			feather: 0,
			properties: {
				feather: {
					keyframes: [
						{ time: 0, value: 10, interpolation: 'linear' },
						{ time: 1_000_000, value: 50, interpolation: 'linear' }
					]
				}
			}
		};

		const at0 = evaluateMask(mask, 0);
		expect(at0.feather).toBe(10);

		const atMid = evaluateMask(mask, 500_000);
		expect(atMid.feather).toBeCloseTo(30);

		const atEnd = evaluateMask(mask, 1_000_000);
		expect(atEnd.feather).toBe(50);
	});

	it('evaluates animated path mask shape and interpolates points over time', () => {
		const shapeAt0 = pointsToPathShape([
			{ x: 0.2, y: 0.2 },
			{ x: 0.8, y: 0.2 },
			{ x: 0.5, y: 0.8 }
		]);
		const shapeAt1 = pointsToPathShape([
			{ x: 0.4, y: 0.4 },
			{ x: 0.9, y: 0.3 },
			{ x: 0.6, y: 0.9 }
		]);

		const mask: Mask = {
			id: 'mask-path-anim',
			type: 'path',
			mode: 'add',
			inverted: false,
			feather: 0,
			expansion: 0,
			opacity: 1,
			points: [
				{ x: 0.2, y: 0.2 },
				{ x: 0.8, y: 0.2 },
				{ x: 0.5, y: 0.8 }
			],
			shape: shapeAt0,
			properties: {
				shape: {
					keyframes: [
						{ time: 0, value: shapeAt0, interpolation: 'linear' },
						{ time: 1_000_000, value: shapeAt1, interpolation: 'linear' }
					]
				}
			}
		};

		const at0 = evaluateMask(mask, 0);
		expect(at0.points).toBeDefined();
		expect(at0.points![0]!.x).toBeCloseTo(0.2);
		expect(at0.points![0]!.y).toBeCloseTo(0.2);

		const atMid = evaluateMask(mask, 500_000);
		expect(atMid.points).toBeDefined();
		expect(atMid.points![0]!.x).toBeCloseTo(0.3); // midway between 0.2 and 0.4
		expect(atMid.points![0]!.y).toBeCloseTo(0.3); // midway between 0.2 and 0.4
		expect(atMid.points![1]!.x).toBeCloseTo(0.85); // midway between 0.8 and 0.9

		const atEnd = evaluateMask(mask, 1_000_000);
		expect(atEnd.points).toBeDefined();
		expect(atEnd.points![0]!.x).toBeCloseTo(0.4);
		expect(atEnd.points![0]!.y).toBeCloseTo(0.4);
		expect(atEnd.points![2]!.x).toBeCloseTo(0.6);
	});
});

describe('CPU Matte Oracle', () => {
	const W = 32;
	const H = 32;

	it('neutral skip: returns 1.0 everywhere if no active masks exist', () => {
		const matte = evaluateMatteCpu([], W, H);
		expect(matte.every((v) => v === 1.0)).toBe(true);
	});

	it('evaluates single add rect mask', () => {
		const rectMask = evaluateMask(
			createMask('rect', {
				shape: [0.5, 0.5, 0.4, 0.4, 0, 0] // center 0.5, 0.5, size 0.4x0.4
			}),
			0
		);
		const matte = evaluateMatteCpu([rectMask], W, H);

		// Center pixel should be 1.0
		const centerIdx = Math.floor(H / 2) * W + Math.floor(W / 2);
		expect(matte[centerIdx]).toBe(1.0);

		// Corner pixel (0, 0) should be 0.0
		expect(matte[0]).toBe(0.0);
	});

	it('evaluates inverted mask: inside is 0, outside is 1', () => {
		const rectMask = evaluateMask(
			createMask('rect', {
				inverted: true,
				shape: [0.5, 0.5, 0.4, 0.4, 0, 0]
			}),
			0
		);
		const matte = evaluateMatteCpu([rectMask], W, H);
		const centerIdx = Math.floor(H / 2) * W + Math.floor(W / 2);
		expect(matte[centerIdx]).toBe(0.0);
		expect(matte[0]).toBe(1.0);
	});

	it('combines masks: add, subtract, intersect', () => {
		// m1 covers left half: cx=0.25, w=0.5, h=1.0
		const m1 = evaluateMask(
			createMask('rect', {
				mode: 'add',
				shape: [0.25, 0.5, 0.5, 1.0, 0, 0]
			}),
			0
		);

		// m2 subtracts top half: cx=0.5, cy=0.25, w=1.0, h=0.5
		const m2 = evaluateMask(
			createMask('rect', {
				mode: 'subtract',
				shape: [0.5, 0.25, 1.0, 0.5, 0, 0]
			}),
			0
		);

		const matte = evaluateMatteCpu([m1, m2], W, H);

		// Top-left should be subtracted (0.0)
		const topLeftIdx = Math.floor(H * 0.2) * W + Math.floor(W * 0.2);
		expect(matte[topLeftIdx]).toBe(0.0);

		// Bottom-left should remain (1.0)
		const bottomLeftIdx = Math.floor(H * 0.8) * W + Math.floor(W * 0.2);
		expect(matte[bottomLeftIdx]).toBe(1.0);

		// Right side was never added (0.0)
		const rightIdx = Math.floor(H * 0.8) * W + Math.floor(W * 0.8);
		expect(matte[rightIdx]).toBe(0.0);
	});

	it('applies feather blur smoothing on CPU', () => {
		const sharpMask = evaluateMask(
			createMask('rect', {
				feather: 0,
				shape: [0.5, 0.5, 0.4, 0.4, 0, 0]
			}),
			0
		);
		const featheredMask = evaluateMask(
			createMask('rect', {
				feather: 4,
				shape: [0.5, 0.5, 0.4, 0.4, 0, 0]
			}),
			0
		);

		const sharpMatte = evaluateMatteCpu([sharpMask], W, H);
		const featheredMatte = evaluateMatteCpu([featheredMask], W, H);

		// Just outside the sharp boundary, sharp is 0.0, but feathered has a smooth transition > 0
		// Boundary x is roughly 0.5 - 0.2 = 0.3 (around x=9 out of 32)
		const edgeIdx = Math.floor(H / 2) * W + 8;
		expect(sharpMatte[edgeIdx]).toBe(0.0);
		expect(featheredMatte[edgeIdx]!).toBeGreaterThan(0.0);
	});

	it('combine-rule oracle: subtract mode starting accumulator equals 1.0', () => {
		// When first mask is subtract, accumulator starts at 1.0 and subtracts mask area
		const subMask = evaluateMask(
			createMask('rect', {
				mode: 'subtract',
				shape: [0.5, 0.5, 0.4, 0.4, 0, 0]
			}),
			0
		);
		const matte = evaluateMatteCpu([subMask], W, H);
		const centerIdx = Math.floor(H / 2) * W + Math.floor(W / 2);
		expect(matte[centerIdx]).toBe(0.0); // subtracted inside
		expect(matte[0]).toBe(1.0); // remained 1.0 outside
	});

	it('combine-rule oracle: intersect mode keeps only intersection', () => {
		// m1 covers left half (cx=0.25, w=0.5, h=1.0)
		const m1 = evaluateMask(
			createMask('rect', {
				mode: 'add',
				shape: [0.25, 0.5, 0.5, 1.0, 0, 0]
			}),
			0
		);
		// m2 intersects top half (cy=0.25, w=1.0, h=0.5)
		const m2 = evaluateMask(
			createMask('rect', {
				mode: 'intersect',
				shape: [0.5, 0.25, 1.0, 0.5, 0, 0]
			}),
			0
		);
		const matte = evaluateMatteCpu([m1, m2], W, H);
		// Top-left (0.2, 0.2) is in both: 1.0
		const tlIdx = Math.floor(H * 0.2) * W + Math.floor(W * 0.2);
		expect(matte[tlIdx]).toBe(1.0);
		// Bottom-left (0.2, 0.8) is only in m1: 0.0
		const blIdx = Math.floor(H * 0.8) * W + Math.floor(W * 0.2);
		expect(matte[blIdx]).toBe(0.0);
		// Top-right (0.8, 0.2) is only in m2: 0.0
		const trIdx = Math.floor(H * 0.2) * W + Math.floor(W * 0.8);
		expect(matte[trIdx]).toBe(0.0);
	});
});

describe('Mask Keyframing, Geometry & Split Continuity (Gate L Verification)', () => {
	it('interpolates numeric shape arrays smoothly via animation evaluate', () => {
		const shapeA = [0.2, 0.2, 0.2, 0.2, 0, 0];
		const shapeB = [0.8, 0.8, 0.6, 0.6, 90, 0.5];
		const mask: Mask = {
			...createMask('rect', { id: 'm_shape_anim' }),
			shape: shapeA,
			properties: {
				shape: {
					keyframes: [
						{ time: 0, value: shapeA, interpolation: 'linear' },
						{ time: 1_000_000, value: shapeB, interpolation: 'linear' }
					]
				}
			}
		};

		const mid = evaluateMask(mask, 500_000);
		expect(mid.shape[0]).toBeCloseTo(0.5); // cx
		expect(mid.shape[1]).toBeCloseTo(0.5); // cy
		expect(mid.shape[2]).toBeCloseTo(0.4); // width
		expect(mid.shape[3]).toBeCloseTo(0.4); // height
		expect(mid.shape[4]).toBeCloseTo(45); // rotation
		expect(mid.shape[5]).toBeCloseTo(0.25); // roundness
	});

	it('bezier flattening accuracy matches cubic bezier curve samples', () => {
		const p0 = { x: 0, y: 0 };
		const cp0 = { x: 0.2, y: 0.8 };
		const cp1 = { x: 0.8, y: 0.2 };
		const p1 = { x: 1, y: 1 };

		const samples = flattenBezier(p0, cp0, cp1, p1, 16);
		expect(samples).toHaveLength(17);
		expect(samples[0]!.x).toBe(0);
		expect(samples[16]!.x).toBe(1);

		for (let i = 0; i <= 16; i++) {
			const expected = cubicBezier(p0, cp0, cp1, p1, i / 16);
			expect(samples[i]!.x).toBeCloseTo(expected.x, 5);
			expect(samples[i]!.y).toBeCloseTo(expected.y, 5);
		}
	});

	it('point-in-polygon correctly tests convex and concave vertices', () => {
		// L-shaped polygon
		const lPoly = [
			{ x: 0, y: 0 },
			{ x: 0.5, y: 0 },
			{ x: 0.5, y: 0.5 },
			{ x: 1.0, y: 0.5 },
			{ x: 1.0, y: 1.0 },
			{ x: 0, y: 1.0 }
		];
		expect(pointInPolygon(0.2, 0.2, lPoly)).toBe(true);
		expect(pointInPolygon(0.2, 0.8, lPoly)).toBe(true);
		expect(pointInPolygon(0.8, 0.8, lPoly)).toBe(true);
		expect(pointInPolygon(0.8, 0.2, lPoly)).toBe(false); // notch in L
		expect(pointInPolygon(1.5, 0.5, lPoly)).toBe(false); // outside
	});

	it('splitClipAnimation preserves continuity of animated mask shape and properties across cut', () => {
		const shapeStart = [0.2, 0.2, 0.2, 0.2, 0, 0];
		const shapeEnd = [0.8, 0.8, 0.4, 0.4, 0, 0];
		const clip: Clip = {
			id: 'c1' as ClipId,
			assetId: 'a1' as AssetId,
			start: 0,
			duration: 2_000_000,
			sourceIn: 0,
			sourceOut: 2_000_000,
			speed: 1,
			volume: 1,
			masks: [
				{
					...createMask('rect', { id: 'm1' }),
					shape: shapeStart,
					properties: {
						shape: {
							keyframes: [
								{ time: 0, value: shapeStart, interpolation: 'linear' },
								{ time: 2_000_000, value: shapeEnd, interpolation: 'linear' }
							]
						},
						feather: {
							keyframes: [
								{ time: 0, value: 0, interpolation: 'linear' },
								{ time: 2_000_000, value: 50, interpolation: 'linear' }
							]
						}
					}
				}
			]
		};

		const [left, right] = splitClipAnimation(clip, 1_000_000);
		expect(left.masks).toHaveLength(1);
		expect(right.masks).toHaveLength(1);

		const leftMask = left.masks![0]!;
		const rightMask = right.masks![0]!;

		// At split point (t = 1_000_000 on left, t = 0 on rebased right):
		const evalLeft = evaluateMask(leftMask, 1_000_000);
		const evalRight = evaluateMask(rightMask, 0);

		expect(evalLeft.shape[0]).toBeCloseTo(0.5);
		expect(evalRight.shape[0]).toBeCloseTo(0.5);
		expect(evalLeft.shape[1]).toBeCloseTo(0.5);
		expect(evalRight.shape[1]).toBeCloseTo(0.5);
		expect(evalLeft.feather).toBeCloseTo(25);
		expect(evalRight.feather).toBeCloseTo(25);
	});

	it('maintains perpendicular corners (no shearing) for rotated masks on 16:9 layers', async () => {
		const { maskLocalToMonitor } = await import('../ui/preview/MaskOverlay');
		const { layerAffine } = await import('./layerGeometry');

		const sourceWidth = 1920;
		const sourceHeight = 1080;
		const compW = 1920;
		const compH = 1080;
		const aspect = sourceWidth / sourceHeight;

		// Layer rotated 45 degrees
		const layer = {
			transform: { rotation: 45, scaleX: 1, scaleY: 1, x: 0, y: 0, opacity: 1 },
			anchor: { x: 0, y: 0 },
			crop: [0, 0, 0, 0] as [number, number, number, number],
			fit: 'contain' as const
		};
		const affine = layerAffine(layer, sourceWidth, sourceHeight, compW, compH);
		const toMonitor = (p: { x: number; y: number }) => ({
			x: affine.a * p.x + affine.c * p.y + affine.e,
			y: affine.b * p.x + affine.d * p.y + affine.f
		});

		// Mask rotated 30 degrees
		const cx = 0.5, cy = 0.5, w = 0.4, h = 0.3, rotDeg = 30;
		const p0 = maskLocalToMonitor(-w / 2, -h / 2, cx, cy, rotDeg, aspect, toMonitor);
		const p1 = maskLocalToMonitor(+w / 2, -h / 2, cx, cy, rotDeg, aspect, toMonitor);
		const p2 = maskLocalToMonitor(+w / 2, +h / 2, cx, cy, rotDeg, aspect, toMonitor);

		// Vector top edge: p1 - p0
		const topEdge = { x: p1.x - p0.x, y: p1.y - p0.y };
		// Vector right edge: p2 - p1
		const rightEdge = { x: p2.x - p1.x, y: p2.y - p1.y };

		// Dot product of top edge and right edge must be exactly 0 (perpendicular, zero shear!)
		const dot = topEdge.x * rightEdge.x + topEdge.y * rightEdge.y;
		expect(Math.abs(dot)).toBeLessThan(1e-4);

		// Total rotation angle on screen should be 45 + 30 = 75 degrees
		// Top edge vector from p0 to p1: in unrotated local frame, points along +X (dx > 0, dy = 0)
		// When rotated 75 degrees clockwise (+Y is down):
		// dx = len * cos(75°), dy = len * sin(75°)
		const expectedAngleRad = (75 * Math.PI) / 180;
		const actualAngleRad = Math.atan2(topEdge.y, topEdge.x);
		expect(actualAngleRad).toBeCloseTo(expectedAngleRad, 4);
	});
});
