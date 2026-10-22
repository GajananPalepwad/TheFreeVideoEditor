import { fitRect } from '../../core/composition';
import { croppedFitRect } from '../../core/layerGeometry';
import { textAnimationInset } from '../../core/text/animator';
import type { ActiveLayer } from '../../core/playback';
import { layerGradient, type GradientStop } from '../../core/gradient';
import type { BlendMode } from '../../core/types';
import { createGradientPaint, rgbaCss } from '../render/gradientPaint';

const CANVAS_BLEND: Record<BlendMode, GlobalCompositeOperation> = {
	normal: 'source-over',
	add: 'lighter',
	multiply: 'multiply',
	screen: 'screen'
};

export type FrameSource = CanvasImageSource | VideoFrame;
export type FrameProvider = (layer: ActiveLayer) => FrameSource | null;
export type LastGoodFrames = Map<string, FrameSource>;

/** Offscreen surface a nested sequence is rendered into before it is composited. */
export type ScratchCanvas = HTMLCanvasElement | OffscreenCanvas;

function createScratchCanvas(width: number, height: number): ScratchCanvas {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

/**
 * Reusable scratch canvases for nested sequences, keyed by size. Owned by the renderer so frames
 * reuse surfaces instead of allocating a full-size canvas per nested layer per frame.
 */
export class ScratchCanvasPool {
	private readonly free = new Map<string, ScratchCanvas[]>();

	constructor(
		private readonly create: (width: number, height: number) => ScratchCanvas = createScratchCanvas
	) {}

	acquire(width: number, height: number): ScratchCanvas {
		return this.free.get(`${width}x${height}`)?.pop() ?? this.create(width, height);
	}

	release(canvas: ScratchCanvas): void {
		const key = `${canvas.width}x${canvas.height}`;
		const list = this.free.get(key) ?? [];
		if (list.length < 4) list.push(canvas);
		this.free.set(key, list);
	}

	clear(): void {
		this.free.clear();
	}
}

export interface CompositionSize {
	width: number;
	height: number;
}

export interface CompositionContext {
	canvas?: { width: number; height: number } | OffscreenCanvasRenderingContext2D['canvas'];
	fillStyle: string | CanvasGradient | CanvasPattern;
	globalAlpha: number;
	globalCompositeOperation?: GlobalCompositeOperation;
	clearRect(x: number, y: number, width: number, height: number): void;
	fillRect(x: number, y: number, width: number, height: number): void;
	createLinearGradient?(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
	createRadialGradient?(
		x0: number,
		y0: number,
		r0: number,
		x1: number,
		y1: number,
		r1: number
	): CanvasGradient;
	drawImage(
		image: CanvasImageSource | VideoFrame,
		x: number,
		y: number,
		width: number,
		height: number
	): void;
	drawImage(
		image: CanvasImageSource | VideoFrame,
		sx: number,
		sy: number,
		sw: number,
		sh: number,
		dx: number,
		dy: number,
		dw: number,
		dh: number
	): void;
	save(): void;
	restore(): void;
	translate(x: number, y: number): void;
	rotate(angle: number): void;
	scale(x: number, y: number): void;
}

function sourceDimensions(source: FrameSource): { width: number; height: number } {
	if ('displayWidth' in source && 'displayHeight' in source) {
		return { width: source.displayWidth, height: source.displayHeight };
	}
	if ('videoWidth' in source && 'videoHeight' in source) {
		return { width: source.videoWidth, height: source.videoHeight };
	}
	if ('naturalWidth' in source && 'naturalHeight' in source) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}
	if ('width' in source && 'height' in source) {
		const { width, height } = source;
		if (typeof width === 'number' && typeof height === 'number') return { width, height };
	}
	return { width: 0, height: 0 };
}

function applySolidFill(
	context: CompositionContext,
	color: { r: number; g: number; b: number; a: number },
	gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle',
	gradientColorEnd?: { r: number; g: number; b: number; a: number },
	gradientAngle?: number,
	gradientStops?: GradientStop[],
	rect?: { x: number; y: number; width: number; height: number }
): void {
	const gradient = layerGradient(gradientType, color, gradientColorEnd, gradientAngle, gradientStops);
	if (
		gradient &&
		rect &&
		typeof context.createLinearGradient === 'function' &&
		typeof context.createRadialGradient === 'function'
	) {
		context.fillStyle = createGradientPaint(context as CanvasRenderingContext2D, gradient, rect);
	} else {
		context.fillStyle = rgbaCss(color);
	}
}

export function renderFrame(
	context: CompositionContext,
	size: CompositionSize,
	layers: readonly ActiveLayer[],
	frameProvider: FrameProvider,
	lastGoodFrames: LastGoodFrames = new Map(),
	options: { transparent?: boolean; scratch?: ScratchCanvasPool } = {}
): void {
	if (![size.width, size.height].every((value) => Number.isSafeInteger(value) && value > 0)) {
		throw new RangeError('Composition size must use positive integer dimensions.');
	}

	const scratch = options.scratch ?? new ScratchCanvasPool();
	const borrowed: ScratchCanvas[] = [];
	/** Nested sequences are drawn into a pooled canvas, which then composites like any other source. */
	const renderNested = (layer: ActiveLayer): ScratchCanvas | null => {
		const nested = layer.nested;
		if (!nested) return null;
		const { width, height } = nested.size;
		if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) return null;
		const canvas = scratch.acquire(width, height);
		borrowed.push(canvas);
		const nestedContext = canvas.getContext('2d');
		if (!nestedContext) return null;
		renderFrame(nestedContext, nested.size, nested.layers, frameProvider, lastGoodFrames, {
			transparent: true,
			scratch
		});
		return canvas;
	};
	const resolveSource = (layer: ActiveLayer): FrameSource | null =>
		layer.kind === 'sequence'
			? renderNested(layer)
			: (frameProvider(layer) ?? lastGoodFrames.get(layer.clipId) ?? null);

	context.clearRect(0, 0, size.width, size.height);
	if (!options.transparent) {
		context.fillStyle = '#000';
		context.fillRect(0, 0, size.width, size.height);
	}

	for (const layer of layers) {
		if (layer.transition) {
			const tr = layer.transition;
			const renderSubLayer = (sub: ActiveLayer, alphaMultiplier: number) => {
				if (sub.kind === 'solid') {
					const c = sub.solidColor ?? { r: 0, g: 0, b: 0, a: 1 };
					const transform = sub.transform;
					const blendMode = sub.blendMode ?? 'normal';
					const [cropLeft, cropTop, cropRight, cropBottom] = sub.crop ?? [0, 0, 0, 0];
					const drawRect = {
						x: cropLeft * size.width,
						y: cropTop * size.height,
						width: size.width * (1 - cropLeft - cropRight),
						height: size.height * (1 - cropTop - cropBottom)
					};
					const drawSolid = (offsetX: number, offsetY: number): void => {
						applySolidFill(
							context,
							c,
							sub.solidGradientType,
							sub.solidGradientColorEnd,
							sub.solidGradientAngle,
							sub.solidGradientStops,
							{
								x: drawRect.x - offsetX,
								y: drawRect.y - offsetY,
								width: drawRect.width,
								height: drawRect.height
							}
						);
						context.fillRect(
							drawRect.x - offsetX,
							drawRect.y - offsetY,
							drawRect.width,
							drawRect.height
						);
					};
					if (!transform && blendMode === 'normal') {
						context.save();
						context.globalAlpha = alphaMultiplier;
						drawSolid(0, 0);
						context.restore();
						return;
					}
					context.save();
					context.globalAlpha = (transform?.opacity ?? 1) * alphaMultiplier;
					context.globalCompositeOperation = CANVAS_BLEND[blendMode];
					const anchor = sub.anchor ?? { x: 0, y: 0 };
					context.translate(
						size.width / 2 + (transform?.x ?? 0) + anchor.x,
						size.height / 2 + (transform?.y ?? 0) + anchor.y
					);
					if (transform?.rotation) {
						context.rotate((transform.rotation * Math.PI) / 180);
					}
					context.scale(transform?.scaleX ?? 1, transform?.scaleY ?? 1);
					drawSolid(size.width / 2 + anchor.x, size.height / 2 + anchor.y);
					context.restore();
					return;
				}
				const src = resolveSource(sub);
				if (!src) return;
				const dims = sourceDimensions(src);
				if (dims.width <= 0 || dims.height <= 0) return;
				if (sub.kind !== 'sequence') lastGoodFrames.set(sub.clipId, src);
				const rect = fitRect(dims.width, dims.height, size.width, size.height);
				const transform = sub.transform;
				const blendMode = sub.blendMode ?? 'normal';
				const [cropLeft, cropTop, cropRight, cropBottom] = sub.crop ?? [0, 0, 0, 0];
				const cropped = Boolean(sub.crop);
				const drawRect = {
					x: rect.x + cropLeft * rect.width,
					y: rect.y + cropTop * rect.height,
					width: rect.width * (1 - cropLeft - cropRight),
					height: rect.height * (1 - cropTop - cropBottom)
				};
				const sourceRect = {
					x: cropLeft * dims.width,
					y: cropTop * dims.height,
					width: dims.width * (1 - cropLeft - cropRight),
					height: dims.height * (1 - cropTop - cropBottom)
				};
				const draw = (offsetX: number, offsetY: number): void => {
					if (cropped) {
						context.drawImage(
							src,
							sourceRect.x,
							sourceRect.y,
							sourceRect.width,
							sourceRect.height,
							drawRect.x - offsetX,
							drawRect.y - offsetY,
							drawRect.width,
							drawRect.height
						);
					} else {
						context.drawImage(src, rect.x - offsetX, rect.y - offsetY, rect.width, rect.height);
					}
				};

				context.save();
				context.globalAlpha = (transform?.opacity ?? 1) * alphaMultiplier;
				context.globalCompositeOperation = CANVAS_BLEND[blendMode];
				if (!transform) {
					draw(0, 0);
				} else {
					const anchor = sub.anchor ?? { x: 0, y: 0 };
					context.translate(
						size.width / 2 + (transform.x ?? 0) + anchor.x,
						size.height / 2 + (transform.y ?? 0) + anchor.y
					);
					if (transform.rotation) {
						context.rotate((transform.rotation * Math.PI) / 180);
					}
					context.scale(transform.scaleX ?? 1, transform.scaleY ?? 1);
					draw(size.width / 2 + anchor.x, size.height / 2 + anchor.y);
				}
				context.restore();
			};

			renderSubLayer(tr.fromLayer, 1 - tr.progress);
			renderSubLayer(tr.toLayer, tr.progress);
			continue;
		}

		if (layer.kind === 'solid') {
			const c = layer.solidColor ?? { r: 0, g: 0, b: 0, a: 1 };
			const transform = layer.transform;
			const blendMode = layer.blendMode ?? 'normal';
			const [cropLeft, cropTop, cropRight, cropBottom] = layer.crop ?? [0, 0, 0, 0];
			const drawRect = {
				x: cropLeft * size.width,
				y: cropTop * size.height,
				width: size.width * (1 - cropLeft - cropRight),
				height: size.height * (1 - cropTop - cropBottom)
			};
			const drawSolid = (offsetX: number, offsetY: number): void => {
				applySolidFill(
					context,
					c,
					layer.solidGradientType,
					layer.solidGradientColorEnd,
					layer.solidGradientAngle,
					layer.solidGradientStops,
					{
						x: drawRect.x - offsetX,
						y: drawRect.y - offsetY,
						width: drawRect.width,
						height: drawRect.height
					}
				);
				context.fillRect(
					drawRect.x - offsetX,
					drawRect.y - offsetY,
					drawRect.width,
					drawRect.height
				);
			};

			if (!transform && blendMode === 'normal') {
				drawSolid(0, 0);
				continue;
			}

			context.save();
			context.globalAlpha = transform?.opacity ?? 1;
			context.globalCompositeOperation = CANVAS_BLEND[blendMode];
			const anchor = layer.anchor ?? { x: 0, y: 0 };
			context.translate(
				size.width / 2 + (transform?.x ?? 0) + anchor.x,
				size.height / 2 + (transform?.y ?? 0) + anchor.y
			);
			if (transform?.rotation) {
				context.rotate((transform.rotation * Math.PI) / 180);
			}
			context.scale(transform?.scaleX ?? 1, transform?.scaleY ?? 1);
			drawSolid(size.width / 2 + anchor.x, size.height / 2 + anchor.y);
			context.restore();
			continue;
		}
		const source = resolveSource(layer);
		if (!source) continue;
		const dimensions = sourceDimensions(source);
		if (dimensions.width <= 0 || dimensions.height <= 0) continue;
		if (layer.kind !== 'sequence') lastGoodFrames.set(layer.clipId, source);
		const fit = layer.fit ?? 'contain';
		const isText = layer.kind === 'text';
		const isAutoSize = layer.textData?.box?.autoSize !== false;
		const alignment = isText && isAutoSize ? layer.textData?.style?.alignment : undefined;
		const verticalAnchor = isText && isAutoSize ? layer.textData?.box?.verticalAnchor : undefined;
		const rect = croppedFitRect(
			undefined,
			dimensions.width,
			dimensions.height,
			size.width,
			size.height,
			fit,
			alignment,
			verticalAnchor,
			isText ? textAnimationInset(layer.textData) : 0
		);
		const transform = layer.transform;
		const blendMode = layer.blendMode ?? 'normal';
		const [cropLeft, cropTop, cropRight, cropBottom] = layer.crop ?? [0, 0, 0, 0];
		const cropped = Boolean(layer.crop);
		const drawRect = {
			x: rect.x + cropLeft * rect.width,
			y: rect.y + cropTop * rect.height,
			width: rect.width * (1 - cropLeft - cropRight),
			height: rect.height * (1 - cropTop - cropBottom)
		};
		const sourceRect = {
			x: cropLeft * dimensions.width,
			y: cropTop * dimensions.height,
			width: dimensions.width * (1 - cropLeft - cropRight),
			height: dimensions.height * (1 - cropTop - cropBottom)
		};
		const draw = (offsetX: number, offsetY: number): void => {
			if (cropped) {
				context.drawImage(
					source,
					sourceRect.x,
					sourceRect.y,
					sourceRect.width,
					sourceRect.height,
					drawRect.x - offsetX,
					drawRect.y - offsetY,
					drawRect.width,
					drawRect.height
				);
			} else {
				context.drawImage(source, rect.x - offsetX, rect.y - offsetY, rect.width, rect.height);
			}
		};
		if (!transform && blendMode === 'normal') {
			draw(0, 0);
			continue;
		}

		context.save();
		context.globalAlpha = transform?.opacity ?? 1;
		context.globalCompositeOperation = CANVAS_BLEND[blendMode];
		const anchor = layer.anchor ?? { x: 0, y: 0 };
		context.translate(
			size.width / 2 + (transform?.x ?? 0) + anchor.x,
			size.height / 2 + (transform?.y ?? 0) + anchor.y
		);
		context.rotate(((transform?.rotation ?? 0) * Math.PI) / 180);
		context.scale(transform?.scaleX ?? 1, transform?.scaleY ?? 1);
		draw(size.width / 2 + anchor.x, size.height / 2 + anchor.y);
		context.restore();
	}
	for (const canvas of borrowed) scratch.release(canvas);
}
