import { textAnimationInset } from './text/animator';
import { fitRect } from './composition';
import type { ActiveLayer } from './playback';

/** The fitted source rect with the crop insets removed, in composition pixels (unscaled, unrotated). */
export function croppedFitRect(
	crop: ActiveLayer['crop'],
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number,
	fit: 'contain' | 'none' = 'contain',
	alignment?: 'left' | 'center' | 'right',
	verticalAnchor?: 'top' | 'center' | 'bottom',
	/** Empty room all round the source that alignment should not count, as text animation leaves. */
	inset = 0
): { x: number; y: number; width: number; height: number } {
	let fitX = (width - sourceWidth) / 2;
	let fitY = (height - sourceHeight) / 2;

	if (fit === 'none') {
		if (alignment === 'left') {
			fitX = width / 2 - inset;
		} else if (alignment === 'right') {
			fitX = width / 2 - sourceWidth + inset;
		} else {
			fitX = (width - sourceWidth) / 2;
		}

		if (verticalAnchor === 'top') {
			fitY = height / 2 - inset;
		} else if (verticalAnchor === 'bottom') {
			fitY = height / 2 - sourceHeight + inset;
		} else {
			fitY = (height - sourceHeight) / 2;
		}
	}

	const fitted =
		fit === 'none'
			? {
					x: fitX,
					y: fitY,
					width: sourceWidth,
					height: sourceHeight
				}
			: fitRect(sourceWidth, sourceHeight, width, height);
	const [left, top, right, bottom] = crop ?? [0, 0, 0, 0];
	return {
		x: fitted.x + left * fitted.width,
		y: fitted.y + top * fitted.height,
		width: fitted.width * (1 - left - right),
		height: fitted.height * (1 - top - bottom)
	};
}

/** Row-major affine: x' = a·u + c·v + e, y' = b·u + d·v + f. */
export interface Affine2D {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

/**
 * Maps a layer's unit quad (u, v in [0, 1], origin at the top-left of the visible, cropped image) to
 * composition pixels (y down). This is the single source of truth shared by the GPU compositor and
 * its tests; it mirrors the Canvas2D reference path exactly.
 */
export function layerAffine(
	layer: Pick<ActiveLayer, 'transform' | 'anchor' | 'crop' | 'fit'> & {
		kind?: string;
		textData?: ActiveLayer['textData'];
	},
	sourceWidth: number,
	sourceHeight: number,
	width: number,
	height: number
): Affine2D {
	const isText = layer.kind === 'text';
	const isAutoSize = layer.textData?.box?.autoSize !== false;
	const alignment = isText && isAutoSize ? layer.textData?.style?.alignment : undefined;
	const verticalAnchor = isText && isAutoSize ? layer.textData?.box?.verticalAnchor : undefined;

	const rect = croppedFitRect(
		layer.crop,
		sourceWidth,
		sourceHeight,
		width,
		height,
		layer.fit ?? 'contain',
		alignment,
		verticalAnchor,
		isText ? textAnimationInset(layer.textData) : 0
	);
	const transform = layer.transform;
	const anchor = layer.anchor ?? { x: 0, y: 0 };
	const radians = ((transform?.rotation ?? 0) * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const scaleX = transform?.scaleX ?? 1;
	const scaleY = transform?.scaleY ?? 1;
	const originX = rect.x - width / 2 - anchor.x;
	const originY = rect.y - height / 2 - anchor.y;
	const translateX = width / 2 + (transform?.x ?? 0) + anchor.x;
	const translateY = height / 2 + (transform?.y ?? 0) + anchor.y;
	return {
		a: cos * scaleX * rect.width,
		b: sin * scaleX * rect.width,
		c: -sin * scaleY * rect.height,
		d: cos * scaleY * rect.height,
		e: cos * scaleX * originX - sin * scaleY * originY + translateX,
		f: sin * scaleX * originX + cos * scaleY * originY + translateY
	};
}

export function applyAffine(affine: Affine2D, u: number, v: number): { x: number; y: number } {
	return { x: affine.a * u + affine.c * v + affine.e, y: affine.b * u + affine.d * v + affine.f };
}
