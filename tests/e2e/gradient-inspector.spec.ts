import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Gradient inspector');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));
}

/** A red solid layer, selected. Returns its id. */
async function selectedSolid(page: Page): Promise<string> {
	return page.evaluate(() => {
		const store = (window as any).__TFVE_STORE__;
		const id = store.getState().addSolidLayer('#ff0000') as string;
		store.getState().selectClips([id]);
		return id;
	});
}

async function source(page: Page, clipId: string): Promise<any> {
	return page.evaluate(
		(id) =>
			(window as any).__TFVE_STORE__
				.getState()
				.project.tracks.flatMap((track: any) => track.clips)
				.find((clip: any) => clip.id === id).source,
		clipId
	);
}

test.describe('Gradient section in the Inspector', () => {
	test('turns a gradient on, adds stops and removes them', async ({ page }) => {
		await openProject(page);
		const clipId = await selectedSolid(page);
		const section = page.locator('.inspector-section', { hasText: 'Gradient' }).last();
		await expect(section).toBeVisible();
		await expect(section.getByRole('group', { name: 'Gradient stop 1', exact: true })).toHaveCount(
			0
		);

		await section.getByLabel('Gradient type').selectOption('radial');
		await expect(
			section.getByRole('group', { name: 'Gradient stop 1', exact: true })
		).toBeVisible();
		await expect(
			section.getByRole('group', { name: 'Gradient stop 2', exact: true })
		).toBeVisible();
		expect((await source(page, clipId)).gradientType).toBe('radial');

		await section.getByRole('button', { name: 'Add stop' }).click();
		await expect(
			section.getByRole('group', { name: 'Gradient stop 3', exact: true })
		).toBeVisible();
		await expect.poll(async () => (await source(page, clipId)).gradientStops?.length).toBe(3);

		await section.getByRole('button', { name: 'Remove gradient stop 3' }).click();
		await expect(section.getByRole('group', { name: 'Gradient stop 3', exact: true })).toHaveCount(
			0
		);
		await expect.poll(async () => (await source(page, clipId)).gradientStops?.length).toBe(2);
		await expect(section.getByRole('button', { name: 'Remove gradient stop 1' })).toBeDisabled();
	});

	test('a stop position can be typed and keyframed', async ({ page }) => {
		await openProject(page);
		const clipId = await selectedSolid(page);
		const section = page.locator('.inspector-section', { hasText: 'Gradient' }).last();
		await section.getByLabel('Gradient type').selectOption('linear-horizontal');
		await section.getByRole('button', { name: 'Add stop' }).click();

		const stop = section.getByRole('group', { name: 'Gradient stop 3', exact: true });
		await stop
			.getByRole('button', { name: /Enable animation for Gradient Stop 3 Position/ })
			.click();

		const properties = await page.evaluate(
			(id) =>
				(window as any).__TFVE_STORE__
					.getState()
					.project.tracks.flatMap((track: any) => track.clips)
					.find((clip: any) => clip.id === id).properties,
			clipId
		);
		const animated = properties['gradient.stop2.offset'];
		expect(animated.keyframes).toHaveLength(1);
		// The keyframe starts from where the stop is, not from a default.
		expect(animated.keyframes[0].value).toBeCloseTo(0.5, 6);
	});

	test('the angle shows only for an angled gradient', async ({ page }) => {
		await openProject(page);
		await selectedSolid(page);
		const section = page.locator('.inspector-section', { hasText: 'Gradient' }).last();
		await section.getByLabel('Gradient type').selectOption('linear-horizontal');
		await expect(section.getByText('Gradient Angle')).toHaveCount(0);
		await section.getByLabel('Gradient type').selectOption('linear-angle');
		await expect(section.getByText('Gradient Angle')).toBeVisible();
	});

	test('turning the gradient off keeps its stops for when it comes back', async ({ page }) => {
		await openProject(page);
		const clipId = await selectedSolid(page);
		const section = page.locator('.inspector-section', { hasText: 'Gradient' }).last();
		await section.getByLabel('Gradient type').selectOption('radial');
		await section.getByRole('button', { name: 'Add stop' }).click();
		await section.getByLabel('Gradient type').selectOption('none');
		await expect(section.getByRole('group', { name: 'Gradient stop 1', exact: true })).toHaveCount(
			0
		);

		await section.getByLabel('Gradient type').selectOption('radial');
		await expect(
			section.getByRole('group', { name: 'Gradient stop 3', exact: true })
		).toBeVisible();
		expect((await source(page, clipId)).gradientStops).toHaveLength(3);
	});
});
