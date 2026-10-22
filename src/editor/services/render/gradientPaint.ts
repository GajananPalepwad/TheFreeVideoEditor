import type { GradientColor, ResolvedGradient } from '../../core/gradient';

export interface PaintRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export function rgbaCss(color: GradientColor): string {
	return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`;
}

/** The canvas gradient for `gradient` spread over `rect`, with every one of its stops. */
export function createGradientPaint(
	context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	gradient: ResolvedGradient,
	rect: PaintRect
): CanvasGradient {
	const { x, y, width, height } = rect;
	const cx = x + width / 2;
	const cy = y + height / 2;
	let paint: CanvasGradient;
	if (gradient.type === 'linear-vertical') {
		paint = context.createLinearGradient(x, y, x, y + height);
	} else if (gradient.type === 'radial') {
		paint = context.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) / 2);
	} else if (gradient.type === 'linear-angle') {
		const radians = (gradient.angle * Math.PI) / 180;
		const half = Math.sqrt(width * width + height * height) / 2;
		paint = context.createLinearGradient(
			cx - Math.cos(radians) * half,
			cy - Math.sin(radians) * half,
			cx + Math.cos(radians) * half,
			cy + Math.sin(radians) * half
		);
	} else {
		paint = context.createLinearGradient(x, y, x + width, y);
	}
	for (const stop of gradient.stops) paint.addColorStop(stop.offset, rgbaCss(stop.color));
	return paint;
}
