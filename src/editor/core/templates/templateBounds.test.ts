import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip } from '../types';
import { layout } from '../text/layout';
import { calculateClipsBoundingBox } from './templateService';

/** Padding `calculateClipsBoundingBox` adds on every side of the content. */
const BOUNDS_PADDING = 48;

/** A canvas whose text is 0.5em wide per character, so measuring needs no fonts. */
class FakeCanvas {
	constructor(
		readonly width: number,
		readonly height: number
	) {}

	getContext() {
		let font = '';
		return {
			set font(value: string) {
				font = value;
			},
			get font() {
				return font;
			},
			measureText: (text: string) => ({
				width: text.length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0)
			})
		};
	}
}

function measure(text: string, fontString: string): number {
	return text.length * 0.5 * Number(/(\d+(?:\.\d+)?)px/.exec(fontString)?.[1] ?? 0);
}

function textClip(
	text: string,
	properties: Record<string, unknown> = {},
	letterSpacing?: number
): Clip {
	return {
		id: 'c_text' as Clip['id'],
		start: 0,
		duration: 2_000_000,
		sourceIn: 0,
		sourceOut: 2_000_000,
		speed: 1,
		volume: 1,
		text,
		properties: { 'text.fontSize': { value: 100 }, ...properties },
		source: {
			type: 'text',
			text,
			style: { fontFamily: 'Montserrat', letterSpacing }
		}
	} as unknown as Clip;
}

/** The size of the text block the rasterizer lays out for these settings. */
function drawnSize(text: string, lineHeight: number, fontSize: number, letterSpacing = 0) {
	const result = layout(
		text,
		{ fontFamily: 'Montserrat', lineHeight, letterSpacing },
		undefined,
		measure,
		fontSize
	);
	return { width: result.boxWidth, height: result.boxHeight };
}

describe('calculateClipsBoundingBox text measuring', () => {
	beforeEach(() => {
		vi.stubGlobal('OffscreenCanvas', FakeCanvas);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('uses the layer line height instead of a fixed 1.2', () => {
		const text = 'First line\nSecond line';
		const bounds = calculateClipsBoundingBox([
			textClip(text, { 'text.lineHeight': { value: 1.6 } })
		]);
		const drawn = drawnSize(text, 1.6, 100);

		expect(bounds.height).toBeGreaterThanOrEqual(drawn.height + BOUNDS_PADDING * 2);
		expect(bounds.height).toBeLessThanOrEqual(drawn.height + BOUNDS_PADDING * 2 + 2);
	});

	it('falls back to the style line height, then 1.2', () => {
		const bounds = calculateClipsBoundingBox([textClip('One\nTwo\nThree')]);
		const drawn = drawnSize('One\nTwo\nThree', 1.2, 100);

		expect(bounds.height).toBeGreaterThanOrEqual(drawn.height + BOUNDS_PADDING * 2);
		expect(bounds.height).toBeLessThanOrEqual(drawn.height + BOUNDS_PADDING * 2 + 2);
	});

	it('counts letter spacing once', () => {
		const bounds = calculateClipsBoundingBox([
			textClip('SPACED', { 'text.letterSpacing': { value: 20 } })
		]);
		const drawn = drawnSize('SPACED', 1.2, 100, 20);

		expect(bounds.width).toBeGreaterThanOrEqual(drawn.width + BOUNDS_PADDING * 2);
		expect(bounds.width).toBeLessThanOrEqual(drawn.width + BOUNDS_PADDING * 2 + 2);
	});

	it('measures at a larger text scale when asked to', () => {
		const text = 'Two\nlines';
		const bounds = calculateClipsBoundingBox([textClip(text)], undefined, { textScale: 2 });
		const drawn = drawnSize(text, 1.2, 200);

		expect(bounds.height).toBeGreaterThanOrEqual(drawn.height + BOUNDS_PADDING * 2);
		expect(bounds.width).toBeGreaterThanOrEqual(drawn.width + BOUNDS_PADDING * 2);
	});
});
