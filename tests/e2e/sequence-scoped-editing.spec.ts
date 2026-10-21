import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	// Importing these modules for the first time can make Vite re-optimise and reload the page, so
	// load them before a project exists.
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
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Inside a template');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__));
}

/** Adds the template, opens its sequence and selects its text layer. Returns that layer's id. */
async function openTemplateTextLayer(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const path = (name: string) => `/src/editor/${name}`;
		const { getBuiltinMotionTemplate } = (await import(
			/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
		)) as typeof import('../../src/editor/core/templates/builtinTemplates');
		const state = (window as any).__TFVE_STORE__.getState();
		state.instantiateTemplate(getBuiltinMotionTemplate('cinematic-blockbuster')!);
		const [instance] = (window as any).__TFVE_STORE__
			.getState()
			.project.tracks.flatMap((track: any) => track.clips);
		(window as any).__TFVE_STORE__.getState().openSequence(instance.source.sequenceId);
		const sequence = (window as any).__TFVE_STORE__.getState().project.sequences[
			instance.source.sequenceId
		];
		const text = sequence.tracks
			.flatMap((track: any) => track.clips)
			.find((clip: any) => clip.source?.type === 'text');
		(window as any).__TFVE_STORE__.getState().selectClips([text.id]);
		return text.id as string;
	});
}

/** The rotation of the layer inside the open sequence, read from the store. */
async function innerRotation(page: Page, clipId: string): Promise<unknown> {
	return page.evaluate((id) => {
		const state = (window as any).__TFVE_STORE__.getState();
		const sequence = Object.values<any>(state.project.sequences)[0];
		const clip = sequence.tracks
			.flatMap((track: any) => track.clips)
			.find((candidate: any) => candidate.id === id);
		return clip.properties?.rotation ?? clip.transform?.rotation ?? null;
	}, clipId);
}

test.describe('editing inside a template sequence', () => {
	test('the Inspector shows the selected inner layer and edits it', async ({ page }) => {
		await openProject(page);
		const clipId = await openTemplateTextLayer(page);

		const inspector = page.locator('.inspector-container');
		await expect(inspector.getByText('Multi-clip editing is not supported')).toHaveCount(0);
		const rotation = inspector.getByRole('textbox', { name: 'Rotation', exact: true }).first();
		await expect(rotation).toBeVisible();

		await rotation.fill('25');
		await rotation.press('Enter');

		await expect.poll(() => innerRotation(page, clipId)).not.toBeNull();
		expect(JSON.stringify(await innerRotation(page, clipId))).toContain('25');
	});

	test('animating an inner layer adds keyframes to the nested clip', async ({ page }) => {
		await openProject(page);
		const clipId = await openTemplateTextLayer(page);

		await page.getByRole('button', { name: 'Enable animation for Rotation' }).first().click();

		await expect(
			page.getByRole('button', { name: 'Disable animation for Rotation' }).first()
		).toBeVisible();
		expect(JSON.stringify(await innerRotation(page, clipId))).toContain('keyframes');
	});

	test('an effect added to an inner layer lands on the nested clip and can be removed', async ({
		page
	}) => {
		await openProject(page);
		const clipId = await openTemplateTextLayer(page);

		const effectCount = (): Promise<number> =>
			page.evaluate((id) => {
				const state = (window as any).__TFVE_STORE__.getState();
				const sequence = Object.values<any>(state.project.sequences)[0];
				const clip = sequence.tracks
					.flatMap((track: any) => track.clips)
					.find((candidate: any) => candidate.id === id);
				return (clip.effects ?? []).length;
			}, clipId);

		const effectId = await page.evaluate((id) => {
			const state = (window as any).__TFVE_STORE__.getState();
			return state.addEffect(id, 'gaussianBlur')?.id ?? null;
		}, clipId);
		expect(effectId).not.toBeNull();
		await expect.poll(effectCount).toBe(1);

		await page.evaluate(
			([id, effect]) =>
				(window as any).__TFVE_STORE__.getState().removeEffect(id as string, effect as string),
			[clipId, effectId]
		);
		await expect.poll(effectCount).toBe(0);
	});
});
