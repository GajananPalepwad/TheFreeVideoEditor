import { describe, expect, it } from 'vitest';
import { applyAffine, layerAffine } from './layerGeometry';
import type { ActiveLayer } from './playback';

describe('layerAffine', () => {
	it('is the identity fit when the source matches the composition', () => {
		const affine = layerAffine({}, 1920, 1080, 1920, 1080);
		expect(applyAffine(affine, 0, 0)).toEqual({ x: 0, y: 0 });
		expect(applyAffine(affine, 1, 1)).toEqual({ x: 1920, y: 1080 });
	});

	it('letterboxes with contain fit', () => {
		const affine = layerAffine({}, 400, 300, 640, 360);
		const topLeft = applyAffine(affine, 0, 0);
		const bottomRight = applyAffine(affine, 1, 1);
		expect(topLeft.x).toBeCloseTo(80);
		expect(topLeft.y).toBeCloseTo(0);
		expect(bottomRight.x).toBeCloseTo(560);
		expect(bottomRight.y).toBeCloseTo(360);
	});

	it('rotates about the composition centre', () => {
		const affine = layerAffine(
			{ transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 } },
			100,
			100,
			100,
			100
		);
		const point = applyAffine(affine, 1, 0.5);
		expect(point.x).toBeCloseTo(50);
		expect(point.y).toBeCloseTo(100);
	});

	it('rotates about an anchor offset and keeps the anchor fixed', () => {
		const layer = {
			transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 45, opacity: 1 },
			anchor: { x: 20, y: 10 }
		};
		const affine = layerAffine(layer, 200, 100, 200, 100);
		// The anchor sits at centre + anchor in the unrotated image; after rotation about
		// that point it must not move.
		const fixed = applyAffine(affine, (100 + 20) / 200, (50 + 10) / 100);
		expect(fixed.x).toBeCloseTo(120);
		expect(fixed.y).toBeCloseTo(60);
	});

	it('applies translation and scale', () => {
		const affine = layerAffine(
			{ transform: { x: 10, y: -5, scaleX: 0.5, scaleY: 2, rotation: 0, opacity: 1 } },
			100,
			100,
			100,
			100
		);
		expect(applyAffine(affine, 0.5, 0.5)).toEqual({ x: 60, y: 45 });
		expect(applyAffine(affine, 1, 1)).toEqual({ x: 85, y: 145 });
	});

	it('supports fit: none without letterboxing or scaling', () => {
		const affine = layerAffine({ fit: 'none' }, 400, 200, 1920, 1080);
		// Centers unscaled 400x200 box in 1920x1080 composition
		// Top-left: (1920 - 400)/2 = 760, (1080 - 200)/2 = 440
		const topLeft = applyAffine(affine, 0, 0);
		const bottomRight = applyAffine(affine, 1, 1);
		expect(topLeft.x).toBeCloseTo(760);
		expect(topLeft.y).toBeCloseTo(440);
		expect(bottomRight.x).toBeCloseTo(1160);
		expect(bottomRight.y).toBeCloseTo(640);
	});

	it('supports text alignment (left, center, right) with fit: none', () => {
		// Left alignment: starts at center X (960)
		const leftAffine = layerAffine(
			{
				fit: 'none',
				kind: 'text',
				textData: {
					text: 'Hi',
					style: { fontFamily: 'sans-serif', alignment: 'left' },
					box: { autoSize: true }
				} as unknown as NonNullable<ActiveLayer['textData']>
			},
			200,
			100,
			1920,
			1080
		);
		const leftTop = applyAffine(leftAffine, 0, 0);
		expect(leftTop.x).toBeCloseTo(960);

		// Right alignment: ends at center X (960) -> starts at 960 - 200 = 760
		const rightAffine = layerAffine(
			{
				fit: 'none',
				kind: 'text',
				textData: {
					text: 'Hi',
					style: { fontFamily: 'sans-serif', alignment: 'right' },
					box: { autoSize: true }
				} as unknown as NonNullable<ActiveLayer['textData']>
			},
			200,
			100,
			1920,
			1080
		);
		const rightTop = applyAffine(rightAffine, 0, 0);
		expect(rightTop.x).toBeCloseTo(760);
	});

	it('supports vertical anchor (top, center, bottom) with fit: none', () => {
		// Top anchor: starts at center Y (540)
		const topAffine = layerAffine(
			{
				fit: 'none',
				kind: 'text',
				textData: {
					text: 'Hi',
					style: { fontFamily: 'sans-serif', alignment: 'center' },
					box: { autoSize: true, verticalAnchor: 'top' }
				} as unknown as NonNullable<ActiveLayer['textData']>
			},
			200,
			100,
			1920,
			1080
		);
		const topPoint = applyAffine(topAffine, 0, 0);
		expect(topPoint.y).toBeCloseTo(540);

		// Bottom anchor: ends at center Y (540) -> starts at 540 - 100 = 440
		const bottomAffine = layerAffine(
			{
				fit: 'none',
				kind: 'text',
				textData: {
					text: 'Hi',
					style: { fontFamily: 'sans-serif', alignment: 'center' },
					box: { autoSize: true, verticalAnchor: 'bottom' }
				} as unknown as NonNullable<ActiveLayer['textData']>
			},
			200,
			100,
			1920,
			1080
		);
		const bottomPoint = applyAffine(bottomAffine, 0, 0);
		expect(bottomPoint.y).toBeCloseTo(440);
	});
});

describe('text animation margin', () => {
	const animated = (alignment: 'left' | 'center' | 'right', offsetY: number) =>
		({
			kind: 'text',
			fit: 'none',
			textData: {
				text: 'x',
				fontSize: 50,
				style: { fontFamily: 'Inter', alignment },
				animator: {
					progress: 1,
					stagger: 0.5,
					offsetX: 0,
					offsetY,
					scale: 1,
					rotation: 0,
					opacity: 0
				}
			}
		}) as unknown as Parameters<typeof layerAffine>[0];

	// A 120 x 60 picture of the text with a 20 pixel margin all round: the text itself is 80 x 20.
	it('keeps the text itself on the anchor, not the margin around it', () => {
		const left = layerAffine(animated('left', 20), 120, 60, 1000, 500);
		// The picture starts 20 pixels before the centre so the text starts at the centre.
		expect(applyAffine(left, 0, 0).x).toBeCloseTo(480, 6);
		const right = layerAffine(animated('right', 20), 120, 60, 1000, 500);
		// The picture ends 20 pixels after the centre so the text ends at the centre.
		expect(applyAffine(right, 1, 0).x).toBeCloseTo(520, 6);
	});

	it('leaves centred text where it was', () => {
		const centred = layerAffine(animated('center', 20), 120, 60, 1000, 500);
		expect(applyAffine(centred, 0.5, 0.5).x).toBeCloseTo(500, 6);
	});

	it('is the same as before for text with no animation', () => {
		const plain = layerAffine(
			{
				kind: 'text',
				fit: 'none',
				textData: { text: 'x', fontSize: 50, style: { fontFamily: 'Inter', alignment: 'left' } }
			} as unknown as Parameters<typeof layerAffine>[0],
			120,
			60,
			1000,
			500
		);
		expect(applyAffine(plain, 0, 0).x).toBeCloseTo(500, 6);
	});
});
