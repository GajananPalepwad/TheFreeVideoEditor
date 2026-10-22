import { gradientKey, layerGradient } from '../../../core/gradient';
import type { ShapeConfig, RgbaColor } from '../../../core/shapes/shapeTypes';
import { createGradientPaint } from '../gradientPaint';

function rgbaToString(c: RgbaColor): string {
	return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
}

export interface RenderedShape {
	canvas: OffscreenCanvas | HTMLCanvasElement;
	width: number;
	height: number;
}

const shapeCache = new Map<string, RenderedShape>();
const MAX_CACHE_SIZE = 64;

function buildCacheKey(c: ShapeConfig, scale: number): string {
	return (
		`${c.shapeType}_${c.width}_${c.height}_${c.fillColor.r},${c.fillColor.g},${c.fillColor.b},${c.fillColor.a}_` +
		`${gradientKey(layerGradient(c.gradientType, c.fillColor, c.gradientColorEnd, c.gradientAngle, c.gradientStops))}_` +
		`${c.strokeWidth ?? 0}_${c.strokeStyle ?? 'solid'}_${c.strokeColor?.r},${c.strokeColor?.g},${c.strokeColor?.b},${c.strokeColor?.a}_` +
		`${c.cornerRadius ?? 0}_${c.points ?? 0}_${c.innerRadius ?? 0}_${c.shadowBlur ?? 0}_${c.shadowColor?.a ?? 0}_${scale}`
	);
}

export function rasterizeShape(config: ShapeConfig, scale = 1): RenderedShape {
	const key = buildCacheKey(config, scale);
	const cached = shapeCache.get(key);
	if (cached) return cached;

	const s = Math.max(0.1, scale);
	const canvasWidth = Math.max(10, Math.round(config.width * s));
	const canvasHeight = Math.max(10, Math.round(config.height * s));
	const strokeWidth = (config.strokeWidth ?? 0) * s;
	const shadowBlur = (config.shadowBlur ?? 0) * s;
	const shadowOffsetX = (config.shadowOffsetX ?? 0) * s;
	const shadowOffsetY = (config.shadowOffsetY ?? 0) * s;

	let canvas: OffscreenCanvas | HTMLCanvasElement;
	if (typeof OffscreenCanvas !== 'undefined') {
		canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
	} else if (typeof document !== 'undefined') {
		canvas = document.createElement('canvas');
		canvas.width = canvasWidth;
		canvas.height = canvasHeight;
	} else {
		// Fallback for SSR or non-browser environments
		const fallback: RenderedShape = {
			canvas: null as unknown as HTMLCanvasElement,
			width: canvasWidth,
			height: canvasHeight
		};
		if (shapeCache.size >= MAX_CACHE_SIZE) {
			const firstKey = shapeCache.keys().next().value;
			if (firstKey) shapeCache.delete(firstKey);
		}
		shapeCache.set(key, fallback);
		return fallback;
	}

	const ctx = canvas.getContext('2d') as
		CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (!ctx) {
		return { canvas, width: canvasWidth, height: canvasHeight };
	}

	ctx.clearRect(0, 0, canvasWidth, canvasHeight);

	// Setup Shadow
	if (config.shadowColor && config.shadowColor.a > 0 && shadowBlur > 0) {
		ctx.shadowColor = rgbaToString(config.shadowColor);
		ctx.shadowBlur = shadowBlur;
		ctx.shadowOffsetX = shadowOffsetX;
		ctx.shadowOffsetY = shadowOffsetY;
	}

	// Calculate draw bounds inset by half stroke width so stroke doesn't clip
	const halfStroke = strokeWidth > 0 ? strokeWidth / 2 : 0;
	const left = halfStroke;
	const top = halfStroke;
	const right = canvasWidth - halfStroke;
	const bottom = canvasHeight - halfStroke;
	const baseW = Math.max(0, right - left);
	const baseH = Math.max(0, bottom - top);
	const cx = canvasWidth / 2;
	const cy = canvasHeight / 2;

	ctx.beginPath();

	switch (config.shapeType) {
		case 'rect': {
			ctx.rect(left, top, baseW, baseH);
			break;
		}
		case 'rounded-rect': {
			const rawRadius = (config.cornerRadius ?? 16) * s;
			const radius = Math.min(rawRadius, baseW / 2, baseH / 2);
			if (typeof ctx.roundRect === 'function') {
				ctx.roundRect(left, top, baseW, baseH, radius);
			} else {
				ctx.moveTo(left + radius, top);
				ctx.arcTo(right, top, right, bottom, radius);
				ctx.arcTo(right, bottom, left, bottom, radius);
				ctx.arcTo(left, bottom, left, top, radius);
				ctx.arcTo(left, top, right, top, radius);
				ctx.closePath();
			}
			break;
		}
		case 'circle': {
			const radius = Math.min(baseW, baseH) / 2;
			ctx.arc(cx, cy, radius, 0, Math.PI * 2);
			break;
		}
		case 'ellipse': {
			ctx.ellipse(cx, cy, baseW / 2, baseH / 2, 0, 0, Math.PI * 2);
			break;
		}
		case 'triangle': {
			ctx.moveTo(cx, top);
			ctx.lineTo(right, bottom);
			ctx.lineTo(left, bottom);
			ctx.closePath();
			break;
		}
		case 'diamond': {
			ctx.moveTo(cx, top);
			ctx.lineTo(right, cy);
			ctx.lineTo(cx, bottom);
			ctx.lineTo(left, cy);
			ctx.closePath();
			break;
		}
		case 'star': {
			const numPoints = Math.max(3, config.points ?? 5);
			const outerRadius = Math.min(baseW, baseH) / 2;
			const innerRadius = outerRadius * (config.innerRadius ?? 0.45);
			const step = Math.PI / numPoints;

			for (let i = 0; i < 2 * numPoints; i++) {
				const r = i % 2 === 0 ? outerRadius : innerRadius;
				const angle = i * step - Math.PI / 2;
				const x = cx + r * Math.cos(angle);
				const y = cy + r * Math.sin(angle);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.closePath();
			break;
		}
		case 'polygon': {
			const sides = Math.max(3, config.points ?? 6);
			const radius = Math.min(baseW, baseH) / 2;
			const step = (Math.PI * 2) / sides;
			for (let i = 0; i < sides; i++) {
				const angle = i * step - Math.PI / 2;
				const x = cx + radius * Math.cos(angle);
				const y = cy + radius * Math.sin(angle);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.closePath();
			break;
		}
		case 'heart': {
			const h = baseH;
			ctx.moveTo(cx, top + h * 0.3);
			ctx.bezierCurveTo(cx, top, left, top, left, top + h * 0.35);
			ctx.bezierCurveTo(left, top + h * 0.65, cx, top + h * 0.85, cx, bottom);
			ctx.bezierCurveTo(cx, top + h * 0.85, right, top + h * 0.65, right, top + h * 0.35);
			ctx.bezierCurveTo(right, top, cx, top, cx, top + h * 0.3);
			ctx.closePath();
			break;
		}
		case 'arrow': {
			const shaftHeight = baseH * 0.4;
			const shaftY = cy - shaftHeight / 2;
			const headWidth = baseW * 0.4;
			const headLeft = right - headWidth;

			ctx.moveTo(left, shaftY);
			ctx.lineTo(headLeft, shaftY);
			ctx.lineTo(headLeft, top);
			ctx.lineTo(right, cy);
			ctx.lineTo(headLeft, bottom);
			ctx.lineTo(headLeft, shaftY + shaftHeight);
			ctx.lineTo(left, shaftY + shaftHeight);
			ctx.closePath();
			break;
		}
		case 'line': {
			const lineY = cy;
			ctx.moveTo(left, lineY);
			ctx.lineTo(right, lineY);
			break;
		}
		case 'callout': {
			const bubbleH = baseH * 0.8;
			const bubbleB = top + bubbleH;
			const radius = Math.min(16 * s, baseW / 4, bubbleH / 4);

			ctx.moveTo(left + radius, top);
			ctx.arcTo(right, top, right, bubbleB, radius);
			ctx.arcTo(right, bubbleB, left, bubbleB, radius);

			// Speech pointer tail
			const tailLeft = left + baseW * 0.25;
			const tailRight = tailLeft + baseW * 0.15;
			ctx.lineTo(tailRight, bubbleB);
			ctx.lineTo(tailLeft + baseW * 0.05, bottom);
			ctx.lineTo(tailLeft, bubbleB);

			ctx.arcTo(left, bubbleB, left, top, radius);
			ctx.arcTo(left, top, right, top, radius);
			ctx.closePath();
			break;
		}
		case 'badge': {
			const numPoints = Math.max(6, config.points ?? 12);
			const outerRadius = Math.min(baseW, baseH) / 2;
			const innerRadius = outerRadius * (config.innerRadius ?? 0.82);
			const step = Math.PI / numPoints;

			for (let i = 0; i < 2 * numPoints; i++) {
				const r = i % 2 === 0 ? outerRadius : innerRadius;
				const angle = i * step;
				const x = cx + r * Math.cos(angle);
				const y = cy + r * Math.sin(angle);
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.closePath();
			break;
		}
		default: {
			ctx.rect(left, top, baseW, baseH);
			break;
		}
	}

	// Fill
	if (config.fillColor && config.fillColor.a > 0 && config.shapeType !== 'line') {
		const gradient = layerGradient(
			config.gradientType,
			config.fillColor,
			config.gradientColorEnd,
			config.gradientAngle,
			config.gradientStops
		);
		if (gradient) {
			ctx.fillStyle = createGradientPaint(ctx, gradient, {
				x: left,
				y: top,
				width: right - left,
				height: bottom - top
			});
		} else {
			ctx.fillStyle = rgbaToString(config.fillColor);
		}
		ctx.fill();
	}

	// Stroke
	if (strokeWidth > 0 && config.strokeColor && config.strokeColor.a > 0) {
		ctx.strokeStyle = rgbaToString(config.strokeColor);
		ctx.lineWidth = strokeWidth;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';

		if (config.strokeStyle === 'dashed') {
			ctx.setLineDash([strokeWidth * 3, strokeWidth * 1.5]);
		} else if (config.strokeStyle === 'dotted') {
			ctx.setLineDash([strokeWidth, strokeWidth * 1.5]);
		} else {
			ctx.setLineDash([]);
		}

		ctx.stroke();
	}

	const result: RenderedShape = {
		canvas,
		width: canvasWidth,
		height: canvasHeight
	};

	if (shapeCache.size >= MAX_CACHE_SIZE) {
		const firstKey = shapeCache.keys().next().value;
		if (firstKey) shapeCache.delete(firstKey);
	}
	shapeCache.set(key, result);

	return result;
}
