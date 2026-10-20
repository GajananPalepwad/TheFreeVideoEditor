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
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Graphics controls');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__));
}

/** Reads one clip's `properties` entry straight from the store (root timeline). */
async function clipProperty(page: Page, clipId: string, propertyId: string): Promise<unknown> {
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

test.describe('text shadow controls', () => {
	test('the Inspector edits the shadow of a text layer', async ({ page }) => {
		await openProject(page);
		const clipId = await page.evaluate(() => {
			const state = (window as any).__TFVE_STORE__.getState();
			const id = state.addTextClip({ text: 'Shadow' });
			(window as any).__TFVE_STORE__.getState().selectClips([id]);
			return id as string;
		});

		const inspector = page.locator('.inspector-container');
		for (const name of ['Shadow Blur', 'Shadow Offset X', 'Shadow Offset Y']) {
			await expect(inspector.getByRole('textbox', { name, exact: true })).toBeVisible();
		}
		const blur = inspector.getByRole('textbox', { name: 'Shadow Blur', exact: true });
		await blur.fill('12');
		await blur.press('Enter');

		await expect
			.poll(async () => JSON.stringify(await clipProperty(page, clipId, 'text.shadowBlur')))
			.toContain('12');
	});
});

test.describe('number parameters', () => {
	test('a template shows a Text Size slider that resizes the text', async ({ page }) => {
		await openProject(page);
		const instanceId = await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			const { getBuiltinMotionTemplate } = (await import(
				/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');
			const id = (window as any).__TFVE_STORE__
				.getState()
				.instantiateTemplate(getBuiltinMotionTemplate('cinematic-blockbuster')!);
			(window as any).__TFVE_STORE__.getState().selectClips([id]);
			return id as string;
		});

		const slider = page.locator('.motion-template-slider').first();
		await expect(slider).toBeVisible();
		await slider.fill('70');

		await expect
			.poll(() =>
				page.evaluate((id) => {
					const state = (window as any).__TFVE_STORE__.getState();
					const clip = state.project.tracks
						.flatMap((track: any) => track.clips)
						.find((candidate: any) => candidate.id === id);
					return Object.values(clip.source.paramOverrides ?? {});
				}, instanceId)
			)
			.toContain(70);
	});
});

test.describe('shape keyframes', () => {
	test('a shape property can be animated from the Inspector', async ({ page }) => {
		await openProject(page);
		const clipId = await page.evaluate(() => {
			const state = (window as any).__TFVE_STORE__.getState();
			const id = state.addShapeClip({ cornerRadius: 10 });
			(window as any).__TFVE_STORE__.getState().selectClips([id]);
			return id as string;
		});

		await page.getByRole('button', { name: 'Enable animation for Corner Radius' }).first().click();

		await expect(
			page.getByRole('button', { name: 'Disable animation for Corner Radius' }).first()
		).toBeVisible();
		expect(JSON.stringify(await clipProperty(page, clipId, 'shape.cornerRadius'))).toContain(
			'keyframes'
		);
	});

	test('editing the Shape panel afterwards keeps the keyframes', async ({ page }) => {
		await openProject(page);
		const clipId = await page.evaluate(() => {
			const state = (window as any).__TFVE_STORE__.getState();
			const id = state.addShapeClip({ cornerRadius: 10 });
			state.enableAnimation(id, 'shape.cornerRadius');
			(window as any).__TFVE_STORE__.getState().selectClips([id]);
			return id as string;
		});

		await page.evaluate(
			(id) =>
				(window as any).__TFVE_STORE__.getState().updateShapeProperties(id, { cornerRadius: 30 }),
			clipId
		);

		expect(JSON.stringify(await clipProperty(page, clipId, 'shape.cornerRadius'))).toContain(
			'keyframes'
		);
	});
});
