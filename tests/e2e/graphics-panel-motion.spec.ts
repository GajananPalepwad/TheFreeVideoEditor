import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	await page.waitForLoadState('load');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Graphics motion');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));
}

/** Adds a text layer, selects it and shows the Graphics panel. Returns the layer's id. */
async function selectTextLayerInGraphics(page: Page): Promise<string> {
	return page.evaluate(() => {
		const store = (window as any).__TFVE_STORE__;
		const id = store.getState().addTextClip({ text: 'Motion' });
		store.getState().selectClips([id]);
		store.getState().switchWorkspace('graphics');
		return id as string;
	});
}

async function openEditGraphicTab(page: Page): Promise<void> {
	await page.getByRole('tab', { name: /Edit Graphic/ }).click();
}

async function clipProperty(page: Page, clipId: string, propertyId: string): Promise<any> {
	return page.evaluate(
		({ id, property }) => {
			const state = (window as any).__TFVE_STORE__.getState();
			const clip = state.project.tracks
				.flatMap((track: any) => track.clips)
				.find((candidate: any) => candidate.id === id);
			return clip?.properties?.[property] ?? null;
		},
		{ id: clipId, property: propertyId }
	);
}

test.describe('Graphics panel motion buttons', () => {
	test('Keyframe at Playhead keys the current values instead of resetting them', async ({
		page
	}) => {
		await openProject(page);
		const clipId = await selectTextLayerInGraphics(page);
		await page.evaluate((id) => {
			(window as any).__TFVE_STORE__.getState().setProperty(id, 'opacity', 0.5, { autoKey: false });
		}, clipId);

		await openEditGraphicTab(page);
		await page.getByRole('button', { name: /Keyframe at Playhead/ }).click();

		const opacity = await clipProperty(page, clipId, 'opacity');
		expect(opacity.keyframes).toHaveLength(1);
		expect(opacity.keyframes[0].value).toBe(0.5);
		const scale = await clipProperty(page, clipId, 'scale');
		expect(scale.keyframes).toHaveLength(1);
	});

	test('Open Graph Editor shows the graph editor', async ({ page }) => {
		await openProject(page);
		await selectTextLayerInGraphics(page);

		await openEditGraphicTab(page);
		await page.getByRole('button', { name: /Open Graph Editor/ }).click();

		await expect
			.poll(() =>
				page.evaluate(() => (window as any).__TFVE_STORE__.getState().keyframes.graph.open)
			)
			.toBe(true);
		await expect(page.getByRole('button', { name: 'Bounce' })).toBeVisible();
	});
});
