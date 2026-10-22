import { expect, test, type Page } from '@playwright/test';

/**
 * Draws one text clip with the real frame renderer and measures where its ink is, so per-unit
 * animation is checked by what it looks like.
 */

const WIDTH = 900;
const HEIGHT = 300;

async function warmUp(page: Page): Promise<void> {
	await page.goto('/editor');
	await page.evaluate(async () => {
		const path = (name: string) => `/src/editor/${name}`;
		await import(/* @vite-ignore */ path('core/index.ts'));
		await import(/* @vite-ignore */ path('core/factory.ts'));
		await import(/* @vite-ignore */ path('services/render/frameRenderer.ts'));
		await import(/* @vite-ignore */ path('services/export/compatibilityFrameProvider.ts'));
		await import(/* @vite-ignore */ path('services/render/text/fontLoader.ts'));
	});
	await page.waitForLoadState('load');
	await page.goto('/editor');
	await page.waitForLoadState('load');
}

interface Ink {
	columns: number[];
	rows: number[];
	total: number;
}

async function ink(page: Page, clip: unknown, time = 0): Promise<Ink> {
	return page.evaluate(
		async ({ clip, time, width, height }) => {
			const path = (name: string) => `/src/editor/${name}`;
			const { resolveFrame } = await import(/* @vite-ignore */ path('core/index.ts'));
			const { createEmptyProject } = await import(/* @vite-ignore */ path('core/factory.ts'));
			const { createFrameRenderer } = await import(
				/* @vite-ignore */ path('services/render/frameRenderer.ts')
			);
			const { CompatibilityFrameProvider } = await import(
				/* @vite-ignore */ path('services/export/compatibilityFrameProvider.ts')
			);
			const { BUNDLED_FONTS } = await import(
				/* @vite-ignore */ path('services/render/text/fontLoader.ts')
			);
			for (const font of BUNDLED_FONTS) {
				const face = new FontFace(font.family, `url(${font.url})`, { weight: '100 900' });
				document.fonts.add(await face.load());
			}
			const base = createEmptyProject({ name: 'Text animation', settings: { width, height } });
			const project = {
				...base,
				tracks: [
					{
						id: 'track',
						kind: 'video',
						name: 'Video',
						muted: false,
						locked: false,
						hidden: false,
						clips: [clip]
					}
				]
			};
			const canvas = new OffscreenCanvas(width, height);
			const renderer = createFrameRenderer(canvas, {
				forceCanvas2d: true,
				preserveDrawingBuffer: true
			})!;
			const frame = resolveFrame(project, time);
			const provider = new CompatibilityFrameProvider(project);
			await provider.prepare(frame.videoLayers);
			renderer.render(
				{ width, height },
				frame.videoLayers,
				(layer: unknown) => provider.getFrame(layer),
				new Map(),
				{ transparent: true }
			);
			provider.dispose();
			const copy = new OffscreenCanvas(width, height);
			const context = copy.getContext('2d', { willReadFrequently: true })!;
			context.drawImage(canvas, 0, 0);
			const { data } = context.getImageData(0, 0, width, height);
			const columns = new Array<number>(width).fill(0);
			const rows = new Array<number>(height).fill(0);
			let total = 0;
			for (let y = 0; y < height; y += 1) {
				for (let x = 0; x < width; x += 1) {
					if (data[(y * width + x) * 4 + 3]! > 128) {
						columns[x]! += 1;
						rows[y]! += 1;
						total += 1;
					}
				}
			}
			renderer.dispose();
			return { columns, rows, total };
		},
		{ clip, time, width: WIDTH, height: HEIGHT }
	);
}

function textClip(properties: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
	const { alignment = 'center', revealUnit, text = 'ABCDEFGH', ...source } = extra;
	return {
		id: 'animated-text',
		start: 0,
		duration: 3_000_000,
		sourceIn: 0,
		sourceOut: 3_000_000,
		speed: 1,
		volume: 0,
		source: {
			type: 'text',
			text,
			style: { fontFamily: 'Montserrat', fontWeight: '900', alignment, revealUnit },
			box: { autoSize: true, verticalAnchor: 'center', paddingX: 0, paddingY: 0 },
			...source
		},
		properties: { 'text.fontSize': { value: 100 }, ...properties }
	};
}

const span = (columns: number[]) => {
	const lit = columns.map((count, x) => (count > 0 ? x : -1)).filter((x) => x >= 0);
	return { left: Math.min(...lit), right: Math.max(...lit) };
};

const centreOfRows = (rows: number[]) => {
	let sum = 0;
	let weight = 0;
	rows.forEach((count, y) => {
		sum += y * count;
		weight += count;
	});
	return sum / weight;
};

test.describe('per-unit text animation', () => {
	test.beforeEach(async ({ page }) => {
		await warmUp(page);
	});

	test('at full progress the text is drawn as if it had no animation', async ({ page }) => {
		const plain = await ink(page, textClip());
		const finished = await ink(
			page,
			textClip({ 'text.anim.progress': { value: 1 }, 'text.anim.offsetY': { value: 80 } })
		);
		expect(finished.total).toBeGreaterThan(1000);
		expect(Math.abs(finished.total - plain.total) / plain.total).toBeLessThan(0.01);
		// Drawn glyph by glyph, an edge can differ by a pixel or two of anti-aliasing.
		expect(Math.abs(span(finished.columns).left - span(plain.columns).left)).toBeLessThanOrEqual(3);
		expect(Math.abs(span(finished.columns).right - span(plain.columns).right)).toBeLessThanOrEqual(
			3
		);
	});

	test('left aligned text stays on its anchor with an animation set up', async ({ page }) => {
		const plain = await ink(page, textClip({}, { alignment: 'left' }));
		const finished = await ink(
			page,
			textClip(
				{ 'text.anim.progress': { value: 1 }, 'text.anim.offsetY': { value: 80 } },
				{ alignment: 'left' }
			)
		);
		expect(Math.abs(span(finished.columns).left - span(plain.columns).left)).toBeLessThanOrEqual(3);
	});

	test('at no progress and no opacity nothing is drawn', async ({ page }) => {
		const hidden = await ink(
			page,
			textClip({ 'text.anim.progress': { value: 0 }, 'text.anim.opacity': { value: 0 } })
		);
		expect(hidden.total).toBe(0);
	});

	test('characters arrive one after another, from the left', async ({ page }) => {
		const clip = textClip({
			'text.anim.progress': { value: 0.5 },
			'text.anim.stagger': { value: 0.8 },
			'text.anim.opacity': { value: 0 },
			'text.anim.offsetY': { value: 0 }
		});
		const done = await ink(page, textClip());
		const middle = await ink(page, clip);
		const full = span(done.columns);
		const part = span(middle.columns);
		expect(middle.total).toBeGreaterThan(0);
		expect(middle.total).toBeLessThan(done.total * 0.9);
		// The first letters are in place and the last ones have not arrived.
		expect(part.left).toBeLessThanOrEqual(full.left + 2);
		expect(part.right).toBeLessThan(full.right - (full.right - full.left) * 0.2);
	});

	test('words arrive one after another when the unit is a word', async ({ page }) => {
		const properties = {
			'text.anim.progress': { value: 0.5 },
			'text.anim.stagger': { value: 0.9 },
			'text.anim.opacity': { value: 0 },
			'text.anim.offsetY': { value: 0 }
		};
		const extra = { text: 'ONE TWO THREE FOUR', revealUnit: 'word' };
		const done = await ink(page, textClip({}, extra));
		const middle = await ink(page, textClip(properties, extra));
		const full = span(done.columns);
		const part = span(middle.columns);
		expect(middle.total).toBeGreaterThan(0);
		expect(part.left).toBeLessThanOrEqual(full.left + 2);
		expect(part.right).toBeLessThan(full.right - (full.right - full.left) * 0.15);
	});

	test('a unit that starts below its place is drawn lower and is not cut off', async ({ page }) => {
		const settled = await ink(page, textClip({ 'text.anim.progress': { value: 1 } }));
		const away = await ink(
			page,
			textClip({
				'text.anim.progress': { value: 0 },
				'text.anim.opacity': { value: 1 },
				'text.anim.offsetY': { value: 60 }
			})
		);
		// Nothing is lost at the edge of the picture of the text, so the amount of ink is the same.
		expect(Math.abs(away.total - settled.total) / settled.total).toBeLessThan(0.01);
		expect(centreOfRows(away.rows) - centreOfRows(settled.rows)).toBeGreaterThan(55);
		expect(centreOfRows(away.rows) - centreOfRows(settled.rows)).toBeLessThan(65);
	});

	test('the progress keyframes drive the animation over time', async ({ page }) => {
		const clip = textClip({
			'text.anim.progress': {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 1_000_000, value: 1, interpolation: 'linear' }
				]
			},
			'text.anim.stagger': { value: 0.5 },
			'text.anim.opacity': { value: 0 },
			'text.anim.offsetY': { value: 0 }
		});
		const early = await ink(page, clip, 0);
		const middle = await ink(page, clip, 500_000);
		const late = await ink(page, clip, 1_500_000);
		const plain = await ink(page, textClip());
		expect(early.total).toBe(0);
		expect(middle.total).toBeGreaterThan(0);
		expect(middle.total).toBeLessThan(plain.total * 0.95);
		expect(Math.abs(late.total - plain.total) / plain.total).toBeLessThan(0.01);
	});
});
