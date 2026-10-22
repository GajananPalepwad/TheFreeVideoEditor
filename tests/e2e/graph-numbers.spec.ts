import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Graph numbers');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));
}

/** A text clip whose opacity eases from 0 to 1 over a second, first key selected, graph open. */
async function easedOpacityClip(page: Page): Promise<string> {
	return page.evaluate(() => {
		const store = (window as any).__TFVE_STORE__;
		const id = store.getState().addTextClip({ text: 'Numbers' }) as string;
		const start = store.getState().project.tracks.flatMap((t: any) => t.clips)[0].start;
		store.getState().selectClips([id]);
		store.getState().setPlayhead(start);
		store.getState().toggleKeyframe(id, 'opacity');
		store.getState().setPlayhead(start + 1_000_000);
		store.getState().toggleKeyframe(id, 'opacity');
		store.getState().setKeyframeValue(id, 'opacity', 0, 0);
		store.getState().setKeyframeSelection([
			{ clipId: id, propertyId: 'opacity', time: 0 },
			{ clipId: id, propertyId: 'opacity', time: 1_000_000 }
		]);
		store.getState().setKeyframeInterpolation('ease-in-out');
		store.getState().setKeyframeSelection([{ clipId: id, propertyId: 'opacity', time: 0 }]);
		if (!store.getState().keyframes.graph.open) store.getState().toggleGraphEditor();
		return id;
	});
}

async function keyframes(page: Page, clipId: string): Promise<any[]> {
	return page.evaluate(
		(id) =>
			(window as any).__TFVE_STORE__
				.getState()
				.project.tracks.flatMap((t: any) => t.clips)
				.find((c: any) => c.id === id).properties.opacity.keyframes,
		clipId
	);
}

async function type(page: Page, name: string, text: string): Promise<void> {
	const field = page.locator('.graph-editor-panel').getByLabel(name, { exact: true });
	await field.fill(text);
	await field.press('Enter');
}

test.describe('typing exact keyframe numbers', () => {
	test('the selected keyframe shows its time, value and handles', async ({ page }) => {
		await openProject(page);
		await easedOpacityClip(page);

		const panel = page.locator('.graph-editor-panel');
		await expect(panel.getByLabel('Time', { exact: true })).toHaveValue('0');
		await expect(panel.getByLabel('Value', { exact: true })).toHaveValue('0');
		await expect(panel.getByLabel('Out influence')).toBeVisible();
		await expect(panel.getByLabel('Out value')).toBeVisible();
		// The first key has nothing before it, so there is no in handle.
		await expect(panel.getByLabel('In influence')).toHaveCount(0);
	});

	test('typing a value changes the keyframe', async ({ page }) => {
		await openProject(page);
		const clipId = await easedOpacityClip(page);

		await type(page, 'Value', '40');

		await expect.poll(async () => (await keyframes(page, clipId))[0].value).toBeCloseTo(0.4, 5);
	});

	test('typing a time moves the keyframe', async ({ page }) => {
		await openProject(page);
		const clipId = await easedOpacityClip(page);

		await type(page, 'Time', '0.25');

		await expect.poll(async () => (await keyframes(page, clipId))[0].time).toBe(250_000);
	});

	test('typing a handle influence and value sets the bezier handle exactly', async ({ page }) => {
		await openProject(page);
		const clipId = await easedOpacityClip(page);

		await type(page, 'Out influence', '25');
		await type(page, 'Out value', '60');

		await expect
			.poll(async () => (await keyframes(page, clipId))[0].easeOut)
			.toEqual({ x: 0.25, y: 0.6 });
	});

	test('the in handle of the second key is measured backwards from that key', async ({ page }) => {
		await openProject(page);
		const clipId = await easedOpacityClip(page);
		await page.evaluate((id) => {
			(window as any).__TFVE_STORE__
				.getState()
				.setKeyframeSelection([{ clipId: id, propertyId: 'opacity', time: 1_000_000 }]);
		}, clipId);

		await type(page, 'In influence', '30');
		await type(page, 'In value', '10');

		await expect
			.poll(async () => (await keyframes(page, clipId))[1].easeIn)
			.toEqual({ x: 0.7, y: 0.9 });
	});

	test('a number that is not a number is ignored', async ({ page }) => {
		await openProject(page);
		const clipId = await easedOpacityClip(page);
		const before = (await keyframes(page, clipId))[0].value;

		const field = page.locator('.graph-editor-panel').getByLabel('Value', { exact: true });
		await field.fill('');
		await field.press('Enter');

		expect((await keyframes(page, clipId))[0].value).toBe(before);
		await expect(field).toHaveValue('0');
	});

	test('one typed change is one undo step', async ({ page }) => {
		await openProject(page);
		const clipId = await easedOpacityClip(page);

		await type(page, 'Value', '40');
		await expect.poll(async () => (await keyframes(page, clipId))[0].value).toBeCloseTo(0.4, 5);
		await page.evaluate(() => (window as any).__TFVE_STORE__.getState().undo());

		await expect.poll(async () => (await keyframes(page, clipId))[0].value).toBe(0);
	});
});

test.describe('speed graph', () => {
	test('shows how fast the curve changes and switches back to the value graph', async ({
		page
	}) => {
		await openProject(page);
		await easedOpacityClip(page);
		const panel = page.locator('.graph-editor-panel');
		await expect(panel.locator('.graph-curve-path')).toHaveCount(1);

		await panel.getByRole('button', { name: 'Speed', exact: true }).click();
		const speed = panel.getByTestId('speed-graph');
		await expect(speed).toBeVisible();
		await expect(panel.getByRole('button', { name: 'Speed', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		// The graph spans the whole clip. The ease runs for the first second, is fastest half way
		// through it, and the curve is flat before and after.
		const clipSeconds = await page.evaluate(
			() =>
				(window as any).__TFVE_STORE__.getState().project.tracks.flatMap((t: any) => t.clips)[0]
					.duration / 1_000_000
		);
		const d = (await speed.locator('.graph-speed-path').getAttribute('d'))!;
		const ys = [...d.matchAll(/[ML] (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) =>
			Number(m[2])
		);
		const top = Math.min(...ys);
		const peakAt = ys.indexOf(top) / (ys.length - 1);
		expect(peakAt).toBeGreaterThan((0.5 / clipSeconds) * 0.8);
		expect(peakAt).toBeLessThan((0.5 / clipSeconds) * 1.2);
		expect(ys[0]).toBeGreaterThan(top + 20);
		expect(ys[ys.length - 1]).toBeGreaterThan(top + 20);
		expect(ys[0]).toBeCloseTo(ys[ys.length - 1]!, 0);

		await panel.getByRole('button', { name: 'Speed', exact: true }).click();
		await expect(speed).toHaveCount(0);
		await expect(panel.locator('.graph-curve-path')).toHaveCount(1);
	});
});
