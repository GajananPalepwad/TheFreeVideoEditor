import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	await page.evaluate(async () => {
		const path = (name: string) => `/src/editor/${name}`;
		await import(/* @vite-ignore */ path('core/templates/builtinTemplates.ts'));
	});
	await page.waitForLoadState('load');
	await page.goto('/editor');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Nested templates');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));
}

/** Puts "Cinematic Blockbuster" on the timeline and opens its sequence. Returns that sequence's id. */
async function openOuterTemplate(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const path = (name: string) => `/src/editor/${name}`;
		const { getBuiltinMotionTemplate } = (await import(
			/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
		)) as typeof import('../../src/editor/core/templates/builtinTemplates');
		const store = (window as any).__TFVE_STORE__;
		store.getState().instantiateTemplate(getBuiltinMotionTemplate('cinematic-blockbuster')!);
		const [instance] = store.getState().project.tracks.flatMap((track: any) => track.clips);
		store.getState().openSequence(instance.source.sequenceId);
		return instance.source.sequenceId as string;
	});
}

async function outerClips(page: Page, sequenceId: string): Promise<any[]> {
	return page.evaluate(
		(id) =>
			(window as any).__TFVE_STORE__
				.getState()
				.project.sequences[id].tracks.flatMap((track: any) => track.clips),
		sequenceId
	);
}

test.describe('A template inside a template', () => {
	test.beforeEach(async ({ page }) => {
		await openProject(page);
	});

	test('"+ Add" in an open template sequence adds the template to that sequence', async ({
		page
	}) => {
		const outerId = await openOuterTemplate(page);
		await page.locator('#graphics-panel-title').click();
		const before = (await outerClips(page, outerId)).length;

		const card = page.getByTestId('graphic-card-subscribe-banner');
		await card.hover();
		await card.getByRole('button', { name: '+ Add' }).click();

		await expect.poll(async () => (await outerClips(page, outerId)).length).toBe(before + 1);
		const clips = await outerClips(page, outerId);
		expect(clips.some((clip) => clip.source?.templateId === 'subscribe-banner')).toBe(true);
		const rootClips = await page.evaluate(() =>
			(window as any).__TFVE_STORE__.getState().project.tracks.flatMap((track: any) => track.clips)
		);
		expect(rootClips).toHaveLength(1);
	});

	test('dragging a card onto the open sequence timeline drops it there', async ({ page }) => {
		const outerId = await openOuterTemplate(page);
		await page.locator('#graphics-panel-title').click();
		const before = (await outerClips(page, outerId)).length;

		const card = page.getByTestId('graphic-card-highlight-callout');
		const lane = page.locator('.timeline-track-row.track-video .timeline-track-lane').first();
		await expect(lane).toBeVisible();
		await card.dragTo(lane, { targetPosition: { x: 120, y: 20 } });

		await expect.poll(async () => (await outerClips(page, outerId)).length).toBe(before + 1);
		const clips = await outerClips(page, outerId);
		expect(clips.some((clip) => clip.source?.templateId === 'highlight-callout')).toBe(true);
	});

	test('the inner template is drawn by the real renderer on the root timeline', async ({
		page
	}) => {
		const outerId = await openOuterTemplate(page);
		await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			const { getBuiltinMotionTemplate } = (await import(
				/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');
			const store = (window as any).__TFVE_STORE__;
			store.getState().instantiateTemplate(getBuiltinMotionTemplate('subscribe-banner')!, 0);
			store.getState().closeSequence();
		});
		expect(await outerClips(page, outerId)).toHaveLength(3);

		const red = await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			const { resolveFrame } = await import(/* @vite-ignore */ path('core/index.ts'));
			const { createFrameRenderer } = await import(
				/* @vite-ignore */ path('services/render/frameRenderer.ts')
			);
			const { CompatibilityFrameProvider } = await import(
				/* @vite-ignore */ path('services/export/compatibilityFrameProvider.ts')
			);
			const project = (window as any).__TFVE_STORE__.getState().project;
			const { width, height } = project.settings;
			const canvas = new OffscreenCanvas(width, height);
			const renderer = createFrameRenderer(canvas, {
				forceCanvas2d: true,
				preserveDrawingBuffer: true
			});
			const frame = resolveFrame(project, 2_000_000);
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
			let count = 0;
			for (let index = 0; index < data.length; index += 4) {
				if (data[index]! > 200 && data[index + 1]! < 80 && data[index + 2]! < 80) count += 1;
			}
			return count;
		});
		// The Subscribe Banner is a red pill; the outer template has no red.
		expect(red).toBeGreaterThan(1000);
	});
});
