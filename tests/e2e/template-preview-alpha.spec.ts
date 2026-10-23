import { expect, test, type Page } from '@playwright/test';

async function openEditor(page: Page): Promise<void> {
	await page.goto('/editor?renderer=webgl2');
	// Importing the renderer for the first time can make Vite re-optimise and reload the page, so
	// load it before a project exists.
	await page.evaluate(async () => {
		const path = '/src/editor/services/render/templatePreview.ts';
		await import(/* @vite-ignore */ path);
	});
	await page.waitForLoadState('load');
	await page.goto('/editor?renderer=webgl2');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Template preview alpha');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__));
}

test.describe('Template card preview transparency', () => {
	test('the WebGL2 card preview leaves empty template area see-through', async ({ page }) => {
		await openEditor(page);
		const pixel = await page.evaluate(async () => {
			const loadModule = (name: string) => import(/* @vite-ignore */ `/src/editor/${name}`);
			const service = await loadModule('services/render/templatePreview.ts');
			const { getBuiltinMotionTemplate } = await loadModule('core/templates/builtinTemplates.ts');
			const template = getBuiltinMotionTemplate('chapter-marker');

			const target = document.createElement('canvas');
			target.width = 640;
			target.height = 360;
			const context = target.getContext('2d', { willReadFrequently: true })!;
			const ok = await service
				.getTemplatePreviewRenderer()
				.draw(template, Math.floor(template.duration / 2), {
					context,
					width: target.width,
					height: target.height
				});
			// The middle of the card, where this template has no content at its midpoint.
			const empty = context.getImageData(320, 180, 1, 1).data;
			const { data } = context.getImageData(0, 0, target.width, target.height);
			let painted = 0;
			for (let index = 3; index < data.length; index += 4) if (data[index]! > 0) painted += 1;
			return { ok, emptyAlpha: empty[3], painted };
		});
		expect(pixel.ok).toBe(true);
		// An opaque black plate would make the empty area alpha 255.
		expect(pixel.emptyAlpha).toBe(0);
		expect(pixel.painted).toBeGreaterThan(200);
	});
});
