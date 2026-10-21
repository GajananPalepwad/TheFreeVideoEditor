import { layout, revealCount, getGraphemes, type MeasureFunction } from '../../../core/text/layout';
import type { TextStyle, TextBox } from '../../../core/types';

export interface TextColorRun {
	startIndex: number;
	endIndex: number;
	fillColor?: { r: number; g: number; b: number; a: number };
	strokeColor?: { r: number; g: number; b: number; a: number };
}

export interface TextRasterConfig {
	text: string;
	style: TextStyle;
	box?: TextBox;
	fontSize: number;
	fillColor: { r: number; g: number; b: number; a: number };
	strokeColor?: { r: number; g: number; b: number; a: number };
	strokeWidth?: number;
	letterSpacing?: number;
	lineHeight?: number;
	reveal?: number;
	revealUnit?: 'char' | 'word' | 'line';
	shadowColor?: { r: number; g: number; b: number; a: number };
	shadowBlur?: number;
	shadowOffsetX?: number;
	shadowOffsetY?: number;
	backgroundBoxColor?: { r: number; g: number; b: number; a: number };
	backgroundBoxPadding?: number;
	backgroundBoxRadius?: number;
	boxBorderColor?: { r: number; g: number; b: number; a: number };
	boxBorderWidth?: number;
	accentBarColor?: { r: number; g: number; b: number; a: number };
	accentBarWidth?: number;
	frameStyle?:
		| 'none'
		| 'card'
		| 'frame'
		| 'circle'
		| 'accent-bar'
		| 'badge-header'
		| 'title-badge'
		| 'split-slash'
		| 'divided-box'
		| 'diagonal-repeat'
		| 'lower-third-line'
		| 'lower-third-glass'
		| 'social-pill'
		| 'callout-pointer'
		| 'cinematic-box';
	badgeText?: string;
	gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
	gradientColorEnd?: { r: number; g: number; b: number; a: number };
	gradientAngle?: number;
	colorRuns?: TextColorRun[];
	scale?: number;
}

/**
 * Checks whether the current environment supports ctx.letterSpacing.
 */
let supportsCanvasLetterSpacing: boolean | null = null;
/** The reveal unit a config draws with: its own, else its style's, else character by character. */
function effectiveRevealUnit(config: TextRasterConfig): 'char' | 'word' | 'line' {
	return config.revealUnit ?? config.style.revealUnit ?? 'char';
}

export function hasCanvasLetterSpacing(): boolean {
	if (supportsCanvasLetterSpacing !== null) return supportsCanvasLetterSpacing;
	if (typeof OffscreenCanvas !== 'undefined') {
		try {
			const c = new OffscreenCanvas(1, 1);
			const ctx = c.getContext('2d');
			supportsCanvasLetterSpacing = Boolean(ctx && 'letterSpacing' in ctx);
			return supportsCanvasLetterSpacing;
		} catch {
			// ignore
		}
	}
	if (typeof document !== 'undefined') {
		const c = document.createElement('canvas');
		const ctx = c.getContext('2d');
		supportsCanvasLetterSpacing = Boolean(ctx && 'letterSpacing' in ctx);
		return supportsCanvasLetterSpacing;
	}
	supportsCanvasLetterSpacing = false;
	return false;
}

export function getTextDimensions(
	text: string,
	style: TextStyle,
	box: TextBox | undefined,
	fontSize: number
): { width: number; height: number } {
	const fontFamily = style.fontFamily || 'sans-serif';
	const fontWeight = style.fontWeight || 'normal';
	const fontStyle = style.fontStyle || 'normal';
	const fontString = `${fontStyle} ${fontWeight} ${Math.round(fontSize)}px ${fontFamily}`;

	let measureCanvas: OffscreenCanvas | HTMLCanvasElement;
	if (typeof OffscreenCanvas !== 'undefined') {
		measureCanvas = new OffscreenCanvas(10, 10);
	} else if (typeof document !== 'undefined') {
		measureCanvas = document.createElement('canvas');
		measureCanvas.width = 10;
		measureCanvas.height = 10;
	} else {
		// Fallback
		return { width: 300, height: 100 };
	}
	const mCtx = measureCanvas.getContext('2d') as
		CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (!mCtx) return { width: 300, height: 100 };
	mCtx.font = fontString;
	if ('letterSpacing' in mCtx) {
		try {
			(mCtx as unknown as { letterSpacing: string }).letterSpacing = '0px';
		} catch {
			// ignore
		}
	}

	const measure: MeasureFunction = (str: string) => {
		mCtx.font = fontString;
		const metrics = mCtx.measureText(str);
		const adv = metrics.width;
		if (
			typeof metrics.actualBoundingBoxLeft === 'number' &&
			typeof metrics.actualBoundingBoxRight === 'number'
		) {
			const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
			return Math.max(adv, inkWidth);
		}
		return adv;
	};

	const res = layout(text, style, box, measure, fontSize);
	return { width: Math.max(10, res.boxWidth), height: Math.max(10, res.boxHeight) };
}

/**
 * Rasterize text to an OffscreenCanvas (or HTMLCanvasElement).
 * Draw order: background box -> shadow -> stroke (round joins, behind fill) -> fill.
 * Works in export Web Worker and on main thread.
 */
export function rasterizeText(
	config: TextRasterConfig,
	maxDim: number = 4096
): OffscreenCanvas | HTMLCanvasElement {
	const text = config.text ?? '';
	const style = config.style ?? { fontFamily: 'sans-serif' };
	const fontSize = Math.max(1, config.fontSize || 48);
	const scale = Math.min(2, Math.max(0.1, config.scale || 1));
	const effectiveFontSize = fontSize * scale;

	const fontFamily = style.fontFamily || 'sans-serif';
	const fontWeight = style.fontWeight || 'normal';
	const fontStyle = style.fontStyle || 'normal';
	const fontString = `${fontStyle} ${fontWeight} ${Math.round(effectiveFontSize)}px ${fontFamily}`;

	// Helper measurement canvas
	let measureCanvas: OffscreenCanvas | HTMLCanvasElement;
	if (typeof OffscreenCanvas !== 'undefined') {
		measureCanvas = new OffscreenCanvas(10, 10);
	} else {
		measureCanvas = document.createElement('canvas');
		measureCanvas.width = 10;
		measureCanvas.height = 10;
	}
	const mCtx = measureCanvas.getContext('2d') as
		CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	mCtx.font = fontString;
	if ('letterSpacing' in mCtx) {
		try {
			(mCtx as unknown as { letterSpacing: string }).letterSpacing = '0px';
		} catch {
			// ignore
		}
	}

	const measure: MeasureFunction = (str: string) => {
		mCtx.font = fontString;
		const metrics = mCtx.measureText(str);
		const adv = metrics.width;
		if (
			typeof metrics.actualBoundingBoxLeft === 'number' &&
			typeof metrics.actualBoundingBoxRight === 'number'
		) {
			const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
			return Math.max(adv, inkWidth);
		}
		return adv;
	};

	const effectiveLineHeight = config.lineHeight ?? style.lineHeight ?? 1.2;
	const effectiveLetterSpacing = (config.letterSpacing ?? style.letterSpacing ?? 0) * scale;

	// 1. Layout full text to determine stable layout box dimensions
	const fullLayout = layout(
		text,
		{
			...style,
			lineHeight: effectiveLineHeight,
			letterSpacing: effectiveLetterSpacing
		},
		config.box
			? {
					...config.box,
					width: config.box.width !== undefined ? config.box.width * scale : undefined,
					height: config.box.height !== undefined ? config.box.height * scale : undefined,
					paddingX: (config.box.paddingX ?? 0) * scale,
					paddingY: (config.box.paddingY ?? 0) * scale
				}
			: undefined,
		measure,
		effectiveFontSize
	);

	const boxW = Math.min(maxDim, Math.max(2, fullLayout.boxWidth));
	const boxH = Math.min(maxDim, Math.max(2, fullLayout.boxHeight));

	let canvas: OffscreenCanvas | HTMLCanvasElement;
	if (typeof OffscreenCanvas !== 'undefined') {
		canvas = new OffscreenCanvas(boxW, boxH);
	} else {
		canvas = document.createElement('canvas');
		canvas.width = boxW;
		canvas.height = boxH;
	}

	const ctx = canvas.getContext('2d') as
		CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
	if (!ctx) throw new Error('Could not get 2D context for text rasterization.');

	ctx.clearRect(0, 0, boxW, boxH);

	// 2. Draw background box & frame style decorations
	const frameStyle = config.frameStyle ?? 'none';

	// Circular seal
	if (frameStyle === 'circle') {
		const cx = boxW / 2;
		const cy = boxH / 2;
		const R = Math.max(10, Math.min(boxW, boxH) / 2 - 4 * scale);
		if (config.backgroundBoxColor && config.backgroundBoxColor.a > 0) {
			const bg = config.backgroundBoxColor;
			ctx.fillStyle = `rgba(${Math.round(bg.r * 255)}, ${Math.round(bg.g * 255)}, ${Math.round(bg.b * 255)}, ${bg.a})`;
			ctx.beginPath();
			ctx.arc(cx, cy, R, 0, Math.PI * 2);
			ctx.fill();
		}
		const bWidth = Math.max(2, (config.boxBorderWidth ?? 6) * scale);
		const bColor = config.boxBorderColor ?? config.fillColor;
		const bColorStr = `rgba(${Math.round(bColor.r * 255)}, ${Math.round(bColor.g * 255)}, ${Math.round(bColor.b * 255)}, ${bColor.a})`;
		// Outer thick ring
		ctx.strokeStyle = bColorStr;
		ctx.lineWidth = bWidth;
		ctx.beginPath();
		ctx.arc(cx, cy, Math.max(2, R - bWidth / 2), 0, Math.PI * 2);
		ctx.stroke();
		// Inner fine ring
		const innerR = R - bWidth - 6 * scale;
		if (innerR > 4) {
			ctx.lineWidth = Math.max(1, bWidth * 0.25);
			ctx.beginPath();
			ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
			ctx.stroke();
		}
	} else if (frameStyle === 'social-pill') {
		const r = Math.min(boxW, boxH) / 2;
		const bg = config.backgroundBoxColor ?? { r: 0.12, g: 0.12, b: 0.16, a: 1 };
		ctx.fillStyle = `rgba(${Math.round(bg.r * 255)}, ${Math.round(bg.g * 255)}, ${Math.round(bg.b * 255)}, ${bg.a})`;
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(0, 0, boxW, boxH, r);
			ctx.fill();
		} else {
			ctx.fillRect(0, 0, boxW, boxH);
		}
		if (config.boxBorderWidth && config.boxBorderWidth > 0) {
			const bWidth = Math.max(1, config.boxBorderWidth * scale);
			const bColor = config.boxBorderColor ?? config.fillColor;
			ctx.strokeStyle = `rgba(${Math.round(bColor.r * 255)}, ${Math.round(bColor.g * 255)}, ${Math.round(bColor.b * 255)}, ${bColor.a})`;
			ctx.lineWidth = bWidth;
			if (typeof ctx.roundRect === 'function') {
				ctx.beginPath();
				ctx.roundRect(bWidth / 2, bWidth / 2, boxW - bWidth, boxH - bWidth, r);
				ctx.stroke();
			}
		}
	} else if (frameStyle === 'lower-third-glass') {
		const radius = Math.max(4, 8 * scale);
		const bg = config.backgroundBoxColor ?? { r: 0.07, g: 0.08, b: 0.13, a: 0.88 };
		ctx.fillStyle = `rgba(${Math.round(bg.r * 255)}, ${Math.round(bg.g * 255)}, ${Math.round(bg.b * 255)}, ${bg.a})`;
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(0, 0, boxW, boxH, radius);
			ctx.fill();
		} else {
			ctx.fillRect(0, 0, boxW, boxH);
		}
		// Left vertical accent stripe
		const barW = Math.max(3, (config.accentBarWidth ?? 5) * scale);
		const barCol = config.accentBarColor ?? config.fillColor;
		ctx.fillStyle = `rgba(${Math.round(barCol.r * 255)}, ${Math.round(barCol.g * 255)}, ${Math.round(barCol.b * 255)}, ${barCol.a})`;
		ctx.fillRect(0, 0, barW, boxH);
		// Subtle glass border
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
		ctx.lineWidth = Math.max(1, 1 * scale);
		if (typeof ctx.roundRect === 'function') {
			ctx.beginPath();
			ctx.roundRect(0.5, 0.5, boxW - 1, boxH - 1, radius);
			ctx.stroke();
		}
	} else if (frameStyle === 'callout-pointer') {
		if (config.backgroundBoxColor && config.backgroundBoxColor.a > 0) {
			const bg = config.backgroundBoxColor;
			ctx.fillStyle = `rgba(${Math.round(bg.r * 255)}, ${Math.round(bg.g * 255)}, ${Math.round(bg.b * 255)}, ${bg.a})`;
			const radius = Math.max(2, 4 * scale);
			if (typeof ctx.roundRect === 'function') {
				ctx.beginPath();
				ctx.roundRect(0, 0, boxW, boxH, radius);
				ctx.fill();
			} else {
				ctx.fillRect(0, 0, boxW, boxH);
			}
		}
		// Pointer leader line and anchor circle
		const pColor = config.accentBarColor ?? config.fillColor;
		const pColorStr = `rgba(${Math.round(pColor.r * 255)}, ${Math.round(pColor.g * 255)}, ${Math.round(pColor.b * 255)}, ${pColor.a})`;
		ctx.strokeStyle = pColorStr;
		ctx.fillStyle = pColorStr;
		ctx.lineWidth = Math.max(1.5, 2 * scale);
		const dotR = Math.max(3, 4 * scale);
		ctx.beginPath();
		ctx.arc(dotR + 2, boxH - dotR - 2, dotR, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(dotR * 2 + 4, boxH - dotR - 2);
		ctx.lineTo(boxW - 4, boxH - dotR - 2);
		ctx.stroke();
	} else if (frameStyle === 'cinematic-box') {
		const cColor = config.accentBarColor ?? config.fillColor;
		const cColorStr = `rgba(${Math.round(cColor.r * 255)}, ${Math.round(cColor.g * 255)}, ${Math.round(cColor.b * 255)}, ${cColor.a})`;
		ctx.strokeStyle = cColorStr;
		ctx.lineWidth = Math.max(1.5, 2 * scale);
		const cornerLen = Math.max(8, 16 * scale);
		ctx.beginPath();
		ctx.moveTo(0, cornerLen);
		ctx.lineTo(0, 0);
		ctx.lineTo(cornerLen, 0);
		ctx.moveTo(boxW - cornerLen, 0);
		ctx.lineTo(boxW, 0);
		ctx.lineTo(boxW, cornerLen);
		ctx.moveTo(0, boxH - cornerLen);
		ctx.lineTo(0, boxH);
		ctx.lineTo(cornerLen, boxH);
		ctx.moveTo(boxW - cornerLen, boxH);
		ctx.lineTo(boxW, boxH);
		ctx.lineTo(boxW, boxH - cornerLen);
		ctx.stroke();
	} else {
		// Standard box / card / frame background
		if (config.backgroundBoxColor && config.backgroundBoxColor.a > 0) {
			const bg = config.backgroundBoxColor;
			ctx.fillStyle = `rgba(${Math.round(bg.r * 255)}, ${Math.round(bg.g * 255)}, ${Math.round(bg.b * 255)}, ${bg.a})`;
			const radius = (config.backgroundBoxRadius ?? 0) * scale;
			if (radius > 0 && typeof ctx.roundRect === 'function') {
				ctx.beginPath();
				ctx.roundRect(0, 0, boxW, boxH, radius);
				ctx.fill();
			} else {
				ctx.fillRect(0, 0, boxW, boxH);
			}
		}

		// Border frame if frameStyle is 'frame' or boxBorderWidth > 0 or frameStyle is 'divided-box'
		const hasBorder =
			(config.boxBorderWidth && config.boxBorderWidth > 0) ||
			frameStyle === 'frame' ||
			frameStyle === 'divided-box';
		if (hasBorder) {
			const bWidth = Math.max(
				1,
				(config.boxBorderWidth || (frameStyle === 'frame' ? 4 : 3)) * scale
			);
			const bColor = config.boxBorderColor ?? config.fillColor;
			ctx.strokeStyle = `rgba(${Math.round(bColor.r * 255)}, ${Math.round(bColor.g * 255)}, ${Math.round(bColor.b * 255)}, ${bColor.a})`;
			ctx.lineWidth = bWidth;
			const half = bWidth / 2;
			const radius = Math.max(0, (config.backgroundBoxRadius ?? 0) * scale);
			if (radius > 0 && typeof ctx.roundRect === 'function') {
				ctx.beginPath();
				ctx.roundRect(half, half, boxW - bWidth, boxH - bWidth, radius);
				ctx.stroke();
			} else {
				ctx.strokeRect(half, half, boxW - bWidth, boxH - bWidth);
			}
		}

		// Accent bar on left edge
		if (frameStyle === 'accent-bar' || (config.accentBarWidth && config.accentBarWidth > 0)) {
			const barW = Math.max(2, (config.accentBarWidth ?? 6) * scale);
			const barCol = config.accentBarColor ?? config.fillColor;
			ctx.fillStyle = `rgba(${Math.round(barCol.r * 255)}, ${Math.round(barCol.g * 255)}, ${Math.round(barCol.b * 255)}, ${barCol.a})`;
			ctx.fillRect(0, 0, barW, boxH);
		}
	}

	// 3. Compute revealed prefix if reveal < 1
	const revealProgress = config.reveal !== undefined ? Math.max(0, Math.min(1, config.reveal)) : 1;
	const visibleCharCount = revealCount(text, effectiveRevealUnit(config), revealProgress);

	// Setup font styling
	ctx.font = fontString;
	ctx.textBaseline = 'top';
	ctx.textAlign = 'left';

	const supportsSpacing = hasCanvasLetterSpacing();
	if (supportsSpacing && effectiveLetterSpacing !== 0) {
		try {
			(ctx as unknown as { letterSpacing: string }).letterSpacing = `${effectiveLetterSpacing}px`;
		} catch {
			// ignore
		}
	}

	const strokeWidth = (config.strokeWidth ?? 0) * scale;
	const strokeColor = config.strokeColor;
	const hasStroke = Boolean(strokeColor && strokeWidth > 0 && strokeColor.a > 0);

	const fillColor = config.fillColor ?? { r: 1, g: 1, b: 1, a: 1 };
	let fillStyleStr: string | CanvasGradient =
		`rgba(${Math.round(fillColor.r * 255)}, ${Math.round(fillColor.g * 255)}, ${Math.round(fillColor.b * 255)}, ${fillColor.a})`;

	if (config.gradientType && config.gradientType !== 'none' && config.gradientColorEnd) {
		const end = config.gradientColorEnd;
		const startStr = fillStyleStr;
		const endStr = `rgba(${Math.round(end.r * 255)}, ${Math.round(end.g * 255)}, ${Math.round(end.b * 255)}, ${end.a})`;
		let grad: CanvasGradient;
		if (config.gradientType === 'linear-vertical') {
			grad = ctx.createLinearGradient(0, 0, 0, boxH);
		} else if (config.gradientType === 'radial') {
			const cx = boxW / 2;
			const cy = boxH / 2;
			grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(boxW, boxH) / 2);
		} else if (config.gradientType === 'linear-angle') {
			const angleRad = ((config.gradientAngle ?? 45) * Math.PI) / 180;
			const halfDiag = Math.sqrt(boxW * boxW + boxH * boxH) / 2;
			const cx = boxW / 2;
			const cy = boxH / 2;
			const x0 = cx - Math.cos(angleRad) * halfDiag;
			const y0 = cy - Math.sin(angleRad) * halfDiag;
			const x1 = cx + Math.cos(angleRad) * halfDiag;
			const y1 = cy + Math.sin(angleRad) * halfDiag;
			grad = ctx.createLinearGradient(x0, y0, x1, y1);
		} else {
			grad = ctx.createLinearGradient(0, 0, boxW, 0);
		}
		grad.addColorStop(0, startStr);
		grad.addColorStop(1, endStr);
		fillStyleStr = grad;
	}

	const renderString = (str: string, x: number, y: number, isStroke: boolean) => {
		if (supportsSpacing || effectiveLetterSpacing === 0) {
			if (isStroke) {
				ctx.strokeText(str, x, y);
			} else {
				ctx.fillText(str, x, y);
			}
		} else {
			// Fallback for canvas contexts without ctx.letterSpacing support
			const graphemes = getGraphemes(str);
			let curX = x;
			for (const g of graphemes) {
				if (isStroke) {
					ctx.strokeText(g, curX, y);
				} else {
					ctx.fillText(g, curX, y);
				}
				curX += measure(g, fontString) + effectiveLetterSpacing;
			}
		}
	};

	// Walk lines and draw text characters up to visibleCharCount
	let charsDrawn = 0;

	for (let lineIdx = 0; lineIdx < fullLayout.lines.length; lineIdx++) {
		const line = fullLayout.lines[lineIdx]!;
		if (charsDrawn >= visibleCharCount) break;

		const lineChars = Array.from(line.text);
		const charsToTake = Math.min(lineChars.length, visibleCharCount - charsDrawn);
		const lineSubstring = lineChars.slice(0, charsToTake).join('');
		charsDrawn += lineChars.length;

		if (lineSubstring.length === 0) continue;

		// Frame style decorations per line
		if (frameStyle === 'badge-header' && lineIdx === 0) {
			const padX = 14 * scale;
			const padY = 4 * scale;
			const bColor = config.accentBarColor ?? config.fillColor;
			ctx.fillStyle = `rgba(${Math.round(bColor.r * 255)}, ${Math.round(bColor.g * 255)}, ${Math.round(bColor.b * 255)}, ${bColor.a})`;
			const r = 3 * scale;
			const bgW = line.width + padX * 2;
			const bgH = effectiveFontSize * 1.05 + padY * 2;
			const bgX = line.x - padX;
			const bgY = line.y - padY;
			if (typeof ctx.roundRect === 'function') {
				ctx.beginPath();
				ctx.roundRect(bgX, bgY, bgW, bgH, r);
				ctx.fill();
			} else {
				ctx.fillRect(bgX, bgY, bgW, bgH);
			}
		}

		if (frameStyle === 'badge-header' && lineIdx === 1) {
			const bColor = config.accentBarColor ?? config.fillColor;
			ctx.fillStyle = `rgba(${Math.round(bColor.r * 255)}, ${Math.round(bColor.g * 255)}, ${Math.round(bColor.b * 255)}, ${bColor.a})`;
			ctx.fillRect(line.x, line.y + effectiveFontSize * 1.15, line.width, 3 * scale);
		}

		if (frameStyle === 'lower-third-line' && lineIdx === 0) {
			const bColor = config.accentBarColor ?? config.fillColor;
			ctx.fillStyle = `rgba(${Math.round(bColor.r * 255)}, ${Math.round(bColor.g * 255)}, ${Math.round(bColor.b * 255)}, ${bColor.a})`;
			const lineY = line.y + effectiveFontSize * 1.15;
			ctx.fillRect(line.x, lineY, Math.max(line.width, boxW * 0.7), Math.max(2, 3 * scale));
		}

		if (frameStyle === 'divided-box' && lineIdx === 0) {
			const bColor = config.boxBorderColor ?? config.fillColor;
			ctx.strokeStyle = `rgba(${Math.round(bColor.r * 255)}, ${Math.round(bColor.g * 255)}, ${Math.round(bColor.b * 255)}, ${bColor.a})`;
			ctx.lineWidth = 2 * scale;
			const divY = line.y + effectiveFontSize * 1.25;
			ctx.beginPath();
			ctx.moveTo(12 * scale, divY);
			ctx.lineTo(boxW - 12 * scale, divY);
			ctx.stroke();
		}

		// Line styling override for special kinetic frame styles
		const isSplitStroke = frameStyle === 'split-slash' && lineIdx > 0;
		const isBadgeHeaderText = frameStyle === 'badge-header' && lineIdx === 0;

		const currentFillStyle = isBadgeHeaderText
			? 'rgba(15, 15, 20, 1)'
			: isSplitStroke
				? 'transparent'
				: fillStyleStr;

		// If color runs are specified (e.g. caption word highlighting), draw each word run individually
		if (config.colorRuns && config.colorRuns.length > 0 && line.words && line.words.length > 0) {
			for (const word of line.words) {
				if (word.lineStartIndex !== undefined && word.lineStartIndex >= charsToTake) continue;

				let wordText = word.text;
				if (word.lineEndIndex !== undefined && word.lineEndIndex > charsToTake) {
					const avail = Math.max(0, charsToTake - (word.lineStartIndex ?? 0));
					wordText = word.text.slice(0, avail);
				}
				if (!wordText) continue;

				const run = config.colorRuns.find(
					(r) => r.startIndex < word.endIndex && r.endIndex > word.startIndex
				);

				const curFill = run?.fillColor ?? fillColor;
				const curFillStr = isBadgeHeaderText
					? 'rgba(15, 15, 20, 1)'
					: isSplitStroke
						? 'transparent'
						: `rgba(${Math.round(curFill.r * 255)}, ${Math.round(curFill.g * 255)}, ${Math.round(curFill.b * 255)}, ${curFill.a})`;
				const curStroke = run?.strokeColor ?? strokeColor;
				const curHasStroke =
					isSplitStroke || Boolean(curStroke && strokeWidth > 0 && curStroke.a > 0);

				const wordX = line.x + word.x;

				// Shadow
				if (
					config.shadowColor &&
					(config.shadowBlur || config.shadowOffsetX || config.shadowOffsetY) &&
					!isSplitStroke
				) {
					ctx.save();
					const sColor = config.shadowColor;
					ctx.shadowColor = `rgba(${Math.round(sColor.r * 255)}, ${Math.round(sColor.g * 255)}, ${Math.round(sColor.b * 255)}, ${sColor.a})`;
					ctx.shadowBlur = (config.shadowBlur ?? 4) * scale;
					ctx.shadowOffsetX = (config.shadowOffsetX ?? 2) * scale;
					ctx.shadowOffsetY = (config.shadowOffsetY ?? 2) * scale;
					ctx.fillStyle = curFillStr;
					renderString(wordText, wordX, line.y, false);
					ctx.restore();
				}

				// Stroke
				if (curHasStroke) {
					ctx.save();
					const effectiveStrokeColor =
						isSplitStroke && !curStroke ? fillColor : (curStroke ?? { r: 1, g: 1, b: 1, a: 0.9 });
					ctx.strokeStyle = `rgba(${Math.round(effectiveStrokeColor.r * 255)}, ${Math.round(effectiveStrokeColor.g * 255)}, ${Math.round(effectiveStrokeColor.b * 255)}, ${effectiveStrokeColor.a})`;
					ctx.lineWidth = Math.max(1, (isSplitStroke ? 2 : strokeWidth * 2) * scale);
					ctx.lineJoin = 'round';
					ctx.lineCap = 'round';
					renderString(wordText, wordX, line.y, true);
					ctx.restore();
				}

				// Fill
				if (!isSplitStroke) {
					ctx.fillStyle = curFillStr;
					renderString(wordText, wordX, line.y, false);
				}
			}
			continue;
		}

		// 4. Shadow
		if (
			config.shadowColor &&
			(config.shadowBlur || config.shadowOffsetX || config.shadowOffsetY) &&
			!isSplitStroke
		) {
			ctx.save();
			const sColor = config.shadowColor;
			ctx.shadowColor = `rgba(${Math.round(sColor.r * 255)}, ${Math.round(sColor.g * 255)}, ${Math.round(sColor.b * 255)}, ${sColor.a})`;
			ctx.shadowBlur = (config.shadowBlur ?? 4) * scale;
			ctx.shadowOffsetX = (config.shadowOffsetX ?? 2) * scale;
			ctx.shadowOffsetY = (config.shadowOffsetY ?? 2) * scale;
			ctx.fillStyle = currentFillStyle;
			renderString(lineSubstring, line.x, line.y, false);
			ctx.restore();
		}

		// 5. Stroke
		if (hasStroke || isSplitStroke) {
			ctx.save();
			const effectiveStrokeColor =
				isSplitStroke && !strokeColor ? fillColor : (strokeColor ?? { r: 1, g: 1, b: 1, a: 0.9 });
			ctx.strokeStyle = `rgba(${Math.round(effectiveStrokeColor.r * 255)}, ${Math.round(effectiveStrokeColor.g * 255)}, ${Math.round(effectiveStrokeColor.b * 255)}, ${effectiveStrokeColor.a})`;
			ctx.lineWidth = Math.max(1, (isSplitStroke ? 2 : strokeWidth * 2) * scale);
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			renderString(lineSubstring, line.x, line.y, true);
			ctx.restore();
		}

		// 6. Fill
		if (!isSplitStroke) {
			ctx.fillStyle = currentFillStyle;
			renderString(lineSubstring, line.x, line.y, false);
		}
	}

	// Diagonal slash overlay for split-slash
	if (frameStyle === 'split-slash') {
		ctx.save();
		const slashCol = config.fillColor ?? { r: 1, g: 1, b: 1, a: 1 };
		ctx.strokeStyle = `rgba(${Math.round(slashCol.r * 255)}, ${Math.round(slashCol.g * 255)}, ${Math.round(slashCol.b * 255)}, ${slashCol.a})`;
		ctx.lineWidth = 2 * scale;
		ctx.beginPath();
		ctx.moveTo(boxW * 0.15, 0);
		ctx.lineTo(boxW * 0.85, boxH);
		ctx.stroke();
		ctx.restore();
	}

	return canvas;
}

/**
 * Creates a unique cache key for a rasterized text configuration.
 */
export function hashTextConfig(config: TextRasterConfig): string {
	const scale = Math.round((config.scale || 1) * 100);
	const text = config.text || '';
	const style = config.style;
	const effLetterSpacing = Math.round((config.letterSpacing ?? style.letterSpacing ?? 0) * 100);
	const effLineHeight = Math.round((config.lineHeight ?? style.lineHeight ?? 1.2) * 100);
	const styleKey = `${style.fontFamily}|${style.fontWeight || ''}|${style.fontStyle || ''}|${style.alignment || ''}|${effLetterSpacing}|${effLineHeight}`;
	const boxKey = config.box
		? `${config.box.width || 0}|${config.box.height || 0}|${config.box.autoSize !== false}|${config.box.verticalAnchor || ''}|${config.box.paddingX || 0}|${config.box.paddingY || 0}`
		: '';
	const col = config.fillColor;
	const colorKey = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${Math.round(col.a * 255)}`;
	const stroke = config.strokeColor
		? `${Math.round(config.strokeColor.r * 255)},${Math.round(config.strokeColor.g * 255)},${Math.round(config.strokeColor.b * 255)},${Math.round(config.strokeColor.a * 255)},${config.strokeWidth || 0}`
		: '0';
	const reveal = config.reveal !== undefined ? Math.round(config.reveal * 1000) : 1000;
	const revealUnit = effectiveRevealUnit(config);
	const shadow = config.shadowColor
		? `${Math.round(config.shadowColor.r * 255)},${Math.round(config.shadowColor.g * 255)},${Math.round(config.shadowColor.b * 255)},${Math.round(config.shadowColor.a * 255)},${config.shadowBlur || 0},${config.shadowOffsetX || 0},${config.shadowOffsetY || 0}`
		: '0';
	const bg = config.backgroundBoxColor
		? `${Math.round(config.backgroundBoxColor.r * 255)},${Math.round(config.backgroundBoxColor.g * 255)},${Math.round(config.backgroundBoxColor.b * 255)},${Math.round(config.backgroundBoxColor.a * 255)},${config.backgroundBoxRadius || 0}`
		: '0';
	const borderKey = config.boxBorderColor
		? `${Math.round(config.boxBorderColor.r * 255)},${Math.round(config.boxBorderColor.g * 255)},${Math.round(config.boxBorderColor.b * 255)},${config.boxBorderWidth || 0}`
		: '0';
	const barKey = config.accentBarColor
		? `${Math.round(config.accentBarColor.r * 255)},${Math.round(config.accentBarColor.g * 255)},${Math.round(config.accentBarColor.b * 255)},${config.accentBarWidth || 0}`
		: '0';
	const frameKey = config.frameStyle || 'none';
	const badgeKey = config.badgeText || '';
	const runsKey = (config.colorRuns ?? [])
		.map(
			(r) =>
				`${r.startIndex}-${r.endIndex}:${r.fillColor ? `${Math.round(r.fillColor.r * 255)},${Math.round(r.fillColor.g * 255)},${Math.round(r.fillColor.b * 255)},${r.fillColor.a}` : ''}`
		)
		.join(';');
	const gradKey =
		config.gradientType && config.gradientType !== 'none' && config.gradientColorEnd
			? `${config.gradientType}:${Math.round(config.gradientColorEnd.r * 255)},${Math.round(config.gradientColorEnd.g * 255)},${Math.round(config.gradientColorEnd.b * 255)},${config.gradientColorEnd.a}:${config.gradientAngle ?? 0}`
			: '0';
	return `${styleKey}#${boxKey}#${Math.round(config.fontSize)}#${scale}#${colorKey}#${stroke}#${reveal}#${revealUnit}#${shadow}#${bg}#${borderKey}#${barKey}#${frameKey}#${badgeKey}#${runsKey}#${gradKey}#${text}`;
}
