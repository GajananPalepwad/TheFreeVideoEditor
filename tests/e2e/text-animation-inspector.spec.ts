import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog
		.getByRole('textbox', { name: 'Project name' })
		.fill('Text animation inspector');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));
}

async function selectedText(page: Page): Promise<string> {
	return page.evaluate(() => {
		const store = (window as any).__TFVE_STORE__;
		const id = store.getState().addTextClip({ text: 'Kinetic type' }) as string;
		store.getState().selectClips([id]);
		return id;
	});
}

async function property(page: Page, clipId: string, id: string): Promise<any> {
	return page.evaluate(
		({ clipId, id }) =>
			(window as any).__TFVE_STORE__
				.getState()
				.project.tracks.flatMap((track: any) => track.clips)
				.find((clip: any) => clip.id === clipId).properties?.[id] ?? null,
		{ clipId, id }
	);
}

test.describe('text animation in the Inspector', () => {
	test('Animate in keys the progress from 0 to 1', async ({ page }) => {
		await openProject(page);
		const clipId = await selectedText(page);
		expect(await property(page, clipId, 'text.anim.progress')).toBeNull();

		await page.getByRole('button', { name: 'Animate in', exact: true }).click();

		const progress = await property(page, clipId, 'text.anim.progress');
		expect(progress.keyframes).toHaveLength(2);
		expect(progress.keyframes.map((key: any) => key.value)).toEqual([0, 1]);
		expect(progress.keyframes[0].time).toBe(0);
		expect(progress.keyframes[1].time).toBe(1_000_000);
	});

	test('the controls name the unit that follows Reveal by', async ({ page }) => {
		await openProject(page);
		await selectedText(page);
		await expect(page.getByText('Animate each character')).toBeVisible();

		await page.getByLabel('Reveal by').selectOption('word');
		await expect(page.getByText('Animate each word')).toBeVisible();
		await page.getByLabel('Reveal by').selectOption('line');
		await expect(page.getByText('Animate each line')).toBeVisible();
	});

	test('the starting pose has its own rows with sensible defaults', async ({ page }) => {
		await openProject(page);
		await selectedText(page);
		for (const label of [
			'Animate In',
			'Animate Stagger',
			'Animate From X',
			'Animate From Y',
			'Animate From Scale',
			'Animate From Rotation',
			'Animate From Opacity'
		]) {
			await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
		}
	});

	test('the progress is offered in the graph editor', async ({ page }) => {
		await openProject(page);
		const clipId = await selectedText(page);
		await page.getByRole('button', { name: 'Animate in', exact: true }).click();
		await page.evaluate(() => {
			const store = (window as any).__TFVE_STORE__;
			if (!store.getState().keyframes.graph.open) store.getState().toggleGraphEditor();
		});
		const panel = page.locator('.graph-editor-panel');
		await panel.locator('.graph-filter-btn', { hasText: 'Animate In' }).first().click();
		await expect(panel.locator('.graph-curve-path')).toHaveCount(1);
		void clipId;
	});
});
