import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Easing');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__));
}

/** A text clip whose opacity runs 0 to 1 over its first second, with the first key selected. */
async function animatedTextClip(page: Page): Promise<string> {
	return page.evaluate(() => {
		const store = (window as any).__TFVE_STORE__;
		const id = store.getState().addTextClip({ text: 'Easing' }) as string;
		const start = store.getState().project.tracks.flatMap((t: any) => t.clips)[0].start;
		store.getState().selectClips([id]);
		store.getState().setPlayhead(start);
		store.getState().toggleKeyframe(id, 'opacity');
		store.getState().setPlayhead(start + 1_000_000);
		store.getState().toggleKeyframe(id, 'opacity');
		store.getState().setKeyframeValue(id, 'opacity', 0, 0);
		store.getState().setKeyframeSelection([{ clipId: id, propertyId: 'opacity', time: 0 }]);
		if (!store.getState().keyframes.graph.open) store.getState().toggleGraphEditor();
		return id;
	});
}

async function firstKeyInterpolation(page: Page, clipId: string): Promise<string | undefined> {
	return page.evaluate((id) => {
		const clip = (window as any).__TFVE_STORE__
			.getState()
			.project.tracks.flatMap((t: any) => t.clips)
			.find((c: any) => c.id === id);
		return clip.properties.opacity?.keyframes?.[0]?.interpolation;
	}, clipId);
}

test.describe('spring, elastic and bounce easing', () => {
	for (const [label, kind] of [
		['Spring', 'spring'],
		['Elastic', 'elastic'],
		['Bounce', 'bounce']
	] as const) {
		test(`the graph editor's ${label} button eases the selected keyframe`, async ({ page }) => {
			await openProject(page);
			const clipId = await animatedTextClip(page);

			const button = page.locator('.graph-editor-panel').getByRole('button', { name: label });
			await expect(button).toBeVisible();
			await button.click();

			await expect.poll(() => firstKeyInterpolation(page, clipId)).toBe(kind);
			await expect(button).toHaveClass(/is-active/);
		});
	}
});
