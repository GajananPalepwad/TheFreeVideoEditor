import { expect, test } from '@playwright/test';

/**
 * Draws every built-in template with the real frame renderer and checks that nothing reaches the
 * outer edge of the template's bounds, which is where text that does not fit gets cut off.
 */

/** Width of the edge ring that has to stay empty. */
const EDGE = 4;

test.describe('Template text fits its bounds', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/editor');
		// Importing these modules for the first time can make Vite re-optimise and reload the page, so
		// load them first.
		await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			await import(/* @vite-ignore */ path('core/templates/builtinTemplates.ts'));
			await import(/* @vite-ignore */ path('core/templates/templatePreview.ts'));
			await import(/* @vite-ignore */ path('core/index.ts'));
			await import(/* @vite-ignore */ path('services/render/frameRenderer.ts'));
			await import(/* @vite-ignore */ path('services/export/compatibilityFrameProvider.ts'));
			await import(/* @vite-ignore */ path('services/render/text/fontLoader.ts'));
		});
		await page.waitForLoadState('load');
		await page.goto('/editor');
		await page.waitForLoadState('load');
	});

	for (const scale of ['default', 'slider-max'] as const) {
		test(`${scale} size leaves the edge of every built-in template empty`, async ({ page }) => {
			const failures = await page.evaluate(
				async ({ mode, edge }) => {
					const path = (name: string) => `/src/editor/${name}`;
					const { BUILTIN_MOTION_TEMPLATES, getBuiltinMotionTemplate } = await import(
						/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
					);
					const { buildTemplatePreviewProject } = await import(
						/* @vite-ignore */ path('core/templates/templatePreview.ts')
					);
					const { resolveFrame } = await import(/* @vite-ignore */ path('core/index.ts'));
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

					const found: string[] = [];
					for (const { id } of BUILTIN_MOTION_TEMPLATES) {
						const template = structuredClone(getBuiltinMotionTemplate(id));
						if (mode === 'slider-max') {
							for (const param of template.publishedParams) {
								if (param.targetProperty !== 'text.fontSize') continue;
								for (const track of template.tracks) {
									for (const clip of track.clips) {
										if (clip.id === param.targetClipId) {
											clip.properties = {
												...clip.properties,
												'text.fontSize': { value: param.max }
											};
										}
									}
								}
							}
						}

						const project = buildTemplatePreviewProject(template);
						const { width, height } = project.settings;
						const canvas = new OffscreenCanvas(width, height);
						const renderer = createFrameRenderer(canvas, {
							forceCanvas2d: true,
							preserveDrawingBuffer: true
						});
						const readback = new OffscreenCanvas(width, height);
						const context = readback.getContext('2d', { willReadFrequently: true })!;

						for (const fraction of [0.3, 0.5, 0.7, 0.9]) {
							const frame = resolveFrame(project, Math.round(template.duration * fraction));
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
							context.clearRect(0, 0, width, height);
							context.drawImage(canvas, 0, 0);

							const strips: Array<[string, number, number, number, number]> = [
								['top', 0, 0, width, edge],
								['bottom', 0, height - edge, width, edge],
								['left', 0, 0, edge, height],
								['right', width - edge, 0, edge, height]
							];
							for (const [side, x, y, w, h] of strips) {
								const data = context.getImageData(x, y, w, h).data;
								for (let i = 3; i < data.length; i += 4) {
									if (data[i] > 8) {
										found.push(`${id} @${fraction}: ink on the ${side} edge of ${width}x${height}`);
										break;
									}
								}
							}
						}
						renderer.dispose();
					}
					return found;
				},
				{ mode: scale, edge: EDGE }
			);

			expect(failures).toEqual([]);
		});
	}
});
