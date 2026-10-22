import { expect, test, type Page } from '@playwright/test';

/**
 * Draws one-clip projects with the real frame renderer and reads pixels back, so a gradient with
 * several stops, or one that is keyframed, is checked by what it looks like and not by its data.
 */

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

interface Sample {
	x: number;
	y: number;
}

/** Renders `clip` alone at `time` and returns the rgba of each sample point. */
async function colours(
	page: Page,
	clip: unknown,
	time: number,
	samples: Sample[],
	renderer: 'canvas2d' | 'webgl2'
): Promise<number[][] | null> {
	return page.evaluate(
		async ({ clip, time, samples, renderer }) => {
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

			const width = 400;
			const height = 200;
			const base = createEmptyProject({ name: 'Gradients', settings: { width, height } });
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
			const frameRenderer = createFrameRenderer(canvas, {
				forceCanvas2d: renderer === 'canvas2d',
				preserveDrawingBuffer: true
			});
			if (!frameRenderer) return null;
			const frame = resolveFrame(project, time);
			const provider = new CompatibilityFrameProvider(project);
			await provider.prepare(frame.videoLayers);
			frameRenderer.render(
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
			const out = samples.map(({ x, y }) => Array.from(context.getImageData(x, y, 1, 1).data));
			frameRenderer.dispose();
			return out;
		},
		{ clip, time, samples, renderer }
	);
}

const RED = { r: 1, g: 0, b: 0, a: 1 };
const GREEN = { r: 0, g: 1, b: 0, a: 1 };
const BLUE = { r: 0, g: 0, b: 1, a: 1 };
const THREE = [
	{ offset: 0, color: RED },
	{ offset: 0.5, color: GREEN },
	{ offset: 1, color: BLUE }
];

function clip(source: unknown, properties: unknown = {}) {
	return {
		id: 'gradient-clip',
		start: 0,
		duration: 2_000_000,
		sourceIn: 0,
		sourceOut: 2_000_000,
		speed: 1,
		volume: 0,
		source,
		properties
	};
}

const dominant = ([r, g, b]: number[]): 'red' | 'green' | 'blue' | 'mixed' => {
	const top = Math.max(r!, g!, b!);
	if (top < 90) return 'mixed';
	if (r === top && g! < top * 0.45 && b! < top * 0.45) return 'red';
	if (g === top && r! < top * 0.45 && b! < top * 0.45) return 'green';
	if (b === top && r! < top * 0.45 && g! < top * 0.45) return 'blue';
	return 'mixed';
};

for (const renderer of ['canvas2d', 'webgl2'] as const) {
	test.describe(`multi-stop gradients on the ${renderer} renderer`, () => {
		test.beforeEach(async ({ page }) => {
			await warmUp(page);
		});

		test('a solid runs through all three stops', async ({ page }) => {
			const result = await colours(
				page,
				clip({
					type: 'solid',
					color: RED,
					gradientType: 'linear-horizontal',
					gradientStops: THREE
				}),
				0,
				[
					{ x: 8, y: 100 },
					{ x: 200, y: 100 },
					{ x: 392, y: 100 }
				],
				renderer
			);
			test.skip(result === null, `${renderer} is not available in this browser`);
			expect(result!.map(dominant)).toEqual(['red', 'green', 'blue']);
		});

		test('a stop whose position is keyframed moves the colour with it', async ({ page }) => {
			const source = {
				type: 'solid',
				color: RED,
				gradientType: 'linear-horizontal',
				gradientStops: THREE
			};
			const properties = {
				'gradient.stop1.offset': {
					keyframes: [
						{ time: 0, value: 0.2, interpolation: 'linear' },
						{ time: 1_000_000, value: 0.8, interpolation: 'linear' }
					]
				}
			};
			const early = await colours(page, clip(source, properties), 0, [{ x: 80, y: 100 }], renderer);
			test.skip(early === null, `${renderer} is not available in this browser`);
			const late = await colours(
				page,
				clip(source, properties),
				1_000_000,
				[{ x: 80, y: 100 }],
				renderer
			);
			// 20 % of the way is the green stop at the start, and mostly red at the end.
			expect(dominant(early![0]!)).toBe('green');
			expect(dominant(late![0]!)).toBe('red');
		});

		test('a stop colour that is keyframed changes the gradient over time', async ({ page }) => {
			const source = {
				type: 'solid',
				color: RED,
				gradientType: 'linear-horizontal',
				gradientStops: THREE
			};
			const properties = {
				'gradient.stop1.color': {
					keyframes: [
						{ time: 0, value: [0, 1, 0, 1], interpolation: 'linear' },
						{ time: 1_000_000, value: [1, 1, 0, 1], interpolation: 'linear' }
					]
				}
			};
			const start = await colours(
				page,
				clip(source, properties),
				0,
				[{ x: 200, y: 100 }],
				renderer
			);
			test.skip(start === null, `${renderer} is not available in this browser`);
			const end = await colours(
				page,
				clip(source, properties),
				1_000_000,
				[{ x: 200, y: 100 }],
				renderer
			);
			expect(start![0]![0]).toBeLessThan(40);
			expect(end![0]![0]).toBeGreaterThan(200);
		});

		test('a shape is filled through its stops', async ({ page }) => {
			const result = await colours(
				page,
				clip({
					type: 'shape',
					shapeType: 'rect',
					width: 300,
					height: 100,
					fillColor: RED,
					gradientType: 'linear-horizontal',
					gradientStops: THREE
				}),
				0,
				[
					{ x: 60, y: 100 },
					{ x: 200, y: 100 },
					{ x: 340, y: 100 }
				],
				renderer
			);
			test.skip(result === null, `${renderer} is not available in this browser`);
			expect(result!.map(dominant)).toEqual(['red', 'green', 'blue']);
		});

		test('the angle of a gradient can be keyframed', async ({ page }) => {
			const source = {
				type: 'solid',
				color: RED,
				gradientType: 'linear-angle',
				gradientAngle: 0,
				gradientStops: [
					{ offset: 0, color: RED },
					{ offset: 1, color: BLUE }
				]
			};
			const properties = {
				'gradient.angle': {
					keyframes: [
						{ time: 0, value: 0, interpolation: 'linear' },
						{ time: 1_000_000, value: 90, interpolation: 'linear' }
					]
				}
			};
			const top = { x: 200, y: 6 };
			const left = { x: 6, y: 100 };
			const flat = await colours(page, clip(source, properties), 0, [left, top], renderer);
			test.skip(flat === null, `${renderer} is not available in this browser`);
			const down = await colours(page, clip(source, properties), 1_000_000, [left, top], renderer);
			// At 0 degrees the colour changes left to right: the left edge is red, the top middle is mixed.
			expect(dominant(flat![0]!)).toBe('red');
			// At 90 degrees it changes top to bottom: the top edge is red whatever x is.
			expect(dominant(down![1]!)).toBe('red');
			expect(dominant(down![0]!)).toBe('mixed');
		});
	});
}

test.describe('multi-stop gradients on text', () => {
	test.beforeEach(async ({ page }) => {
		await warmUp(page);
	});

	test('the letters take their colour from the stops, left to right', async ({ page }) => {
		const text = clip(
			{
				type: 'text',
				text: 'IIIIIIIIIIIIIIII',
				style: {
					fontFamily: 'Montserrat',
					fontWeight: '900',
					alignment: 'center',
					letterSpacing: 6
				},
				box: {
					autoSize: true,
					verticalAnchor: 'center',
					paddingX: 0,
					paddingY: 0,
					gradientType: 'linear-horizontal',
					gradientStops: THREE
				}
			},
			{ 'text.fontSize': { value: 120 } }
		);
		const result = await page.evaluate(
			async ({ clip }) => {
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
				const width = 800;
				const height = 300;
				const base = createEmptyProject({ name: 'Text gradient', settings: { width, height } });
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
				const frame = resolveFrame(project, 0);
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
				// The average colour of the opaque pixels in the left, middle and right fifths.
				const average = (from: number, to: number) => {
					let r = 0;
					let g = 0;
					let b = 0;
					let count = 0;
					for (let y = 0; y < height; y += 1) {
						for (let x = from; x < to; x += 1) {
							const at = (y * width + x) * 4;
							if (data[at + 3]! > 200) {
								r += data[at]!;
								g += data[at + 1]!;
								b += data[at + 2]!;
								count += 1;
							}
						}
					}
					return count > 50 ? [r / count, g / count, b / count] : null;
				};
				const lit: number[] = [];
				for (let x = 0; x < width; x += 1) {
					for (let y = 0; y < height; y += 1) {
						if (data[(y * width + x) * 4 + 3]! > 200) {
							lit.push(x);
							break;
						}
					}
				}
				const left = Math.min(...lit);
				const right = Math.max(...lit);
				const span = right - left;
				return {
					start: average(left, left + Math.floor(span * 0.15)),
					middle: average(left + Math.floor(span * 0.42), left + Math.floor(span * 0.58)),
					end: average(right - Math.floor(span * 0.15), right + 1)
				};
			},
			{ clip: text }
		);
		expect(result.start).not.toBeNull();
		expect(dominant(result.start!)).toBe('red');
		expect(dominant(result.middle!)).toBe('green');
		expect(dominant(result.end!)).toBe('blue');
	});
});
