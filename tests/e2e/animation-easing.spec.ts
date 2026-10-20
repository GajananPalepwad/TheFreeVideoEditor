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
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));
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

test.describe('graph editor curves', () => {
	test('a keyframed text colour shows one curve per channel', async ({ page }) => {
		await openProject(page);
		await page.evaluate(() => {
			const store = (window as any).__TFVE_STORE__;
			const id = store.getState().addTextClip({ text: 'Colour' }) as string;
			const start = store.getState().project.tracks.flatMap((t: any) => t.clips)[0].start;
			store.getState().selectClips([id]);
			store.getState().setPlayhead(start);
			store.getState().toggleKeyframe(id, 'text.fillColor');
			store.getState().setPlayhead(start + 1_000_000);
			store.getState().toggleKeyframe(id, 'text.fillColor');
			store.getState().setKeyframeValue(id, 'text.fillColor', 1_000_000, [1, 0, 0, 1]);
			store.getState().toggleGraphEditor();
		});

		const panel = page.locator('.graph-editor-panel');
		await panel.locator('.graph-filter-btn', { hasText: 'Fill Color' }).first().click();
		await expect(panel.locator('.graph-curve-path')).toHaveCount(4);
	});

	test('double-clicking beside a curve keys that curve, not the first one', async ({ page }) => {
		await openProject(page);
		const clipId = await page.evaluate(() => {
			const store = (window as any).__TFVE_STORE__;
			const id = store.getState().addTextClip({ text: 'Two curves' }) as string;
			const start = store.getState().project.tracks.flatMap((t: any) => t.clips)[0].start;
			store.getState().selectClips([id]);
			store.getState().setPlayhead(start);
			store.getState().toggleKeyframe(id, 'rotation');
			store.getState().toggleKeyframe(id, 'opacity');
			store.getState().setPlayhead(start + 1_000_000);
			store.getState().toggleKeyframe(id, 'rotation');
			store.getState().toggleKeyframe(id, 'opacity');
			store.getState().setKeyframeValue(id, 'rotation', 1_000_000, 90);
			store.getState().setKeyframeValue(id, 'opacity', 1_000_000, 0);
			store.getState().toggleGraphEditor();
			return id;
		});

		const panel = page.locator('.graph-editor-panel');
		// Rotation (0 to 90) is listed first; opacity (100 % to 0 %) is the second path.
		const opacityPath = panel.locator('.graph-curve-path').nth(1);
		await expect(opacityPath).toBeVisible();
		const d = (await opacityPath.getAttribute('d'))!;
		const points = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => ({
			x: Number(m[1]),
			y: Number(m[2])
		}));
		const point = points[Math.floor(points.length / 4)]!;
		const box = (await panel.locator('svg.graph-svg').boundingBox())!;
		await page.mouse.dblclick(box.x + point.x, box.y + point.y);

		const counts = await page.evaluate((id) => {
			const clip = (window as any).__TFVE_STORE__
				.getState()
				.project.tracks.flatMap((t: any) => t.clips)
				.find((c: any) => c.id === id);
			return {
				rotation: clip.properties.rotation.keyframes.length,
				opacity: clip.properties.opacity.keyframes.length
			};
		}, clipId);
		expect(counts).toEqual({ rotation: 2, opacity: 3 });
	});
});
