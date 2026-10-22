import { expect, test } from '@playwright/test';

test.describe('Inspector Accordion & Reveal on Effect Drop', () => {
	test('closed vs open tabs are distinctly styled and dropping an effect expands and scrolls to it', async ({
		page
	}) => {
		await page.goto('/editor');
		const manager = page.locator('.project-manager-dialog');
		await manager.waitFor({ state: 'visible', timeout: 5000 });
		await manager.getByRole('button', { name: 'New project' }).click();
		const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Inspector Test');
		await createDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(manager).not.toBeVisible();
		await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));

		// Add a text clip so inspector has a clip selected
		await page.evaluate(() => {
			const store = (window as any).__TFVE_STORE__;
			const clipId = store.getState().addTextClip({ text: 'Inspector Test Clip' });
			store.getState().selectClips([clipId]);
		});

		const inspectorContainer = page.locator('.inspector-container');
		await expect(inspectorContainer).toBeVisible();

		// Check sections exist
		const transformSection = page.locator('section[data-section-id="transform"]');
		const effectsSection = page.locator('section[data-section-id="effects"]');
		await expect(transformSection).toBeVisible();
		await expect(effectsSection).toBeVisible();

		// Collapse effects if open
		const isEffectsOpen = await effectsSection.evaluate((el) => el.classList.contains('is-open'));
		if (isEffectsOpen) {
			await effectsSection.locator('.inspector-section-header').click();
			await expect(effectsSection).not.toHaveClass(/is-open/);
			// Wait for 150ms CSS transition to settle
			await page.waitForTimeout(200);
		}

		// Verify closed header style: transparent left border, subtle color
		await expect
			.poll(async () => {
				return effectsSection
					.locator('.inspector-section-header')
					.evaluate((el) => window.getComputedStyle(el).borderLeftColor);
			})
			.toBe('rgba(0, 0, 0, 0)');

		// Verify open header style on transform section: active left border (cyan: rgb(56, 189, 248))
		const openBorderLeft = await transformSection
			.locator('.inspector-section-header')
			.evaluate((el) => window.getComputedStyle(el).borderLeftColor);
		expect(openBorderLeft).toBe('rgb(56, 189, 248)');

		// Now simulate adding/dropping an effect on the selected clip
		await page.evaluate(() => {
			const store = (window as any).__TFVE_STORE__;
			const clipId = store.getState().timeline.selection.clipIds[0];
			if (clipId) {
				store.getState().addEffect(clipId, 'gaussianBlur');
			}
		});

		// Verify effects section is now expanded (is-open)
		await expect(effectsSection).toHaveClass(/is-open/);

		// Verify effects section header transitions to the active cyan border
		await expect
			.poll(async () => {
				return effectsSection
					.locator('.inspector-section-header')
					.evaluate((el) => window.getComputedStyle(el).borderLeftColor);
			})
			.toBe('rgb(56, 189, 248)');

		// Scroll so we can capture closed sections (Crop, Speed, Masks) and open section (Effects) together
		await page.evaluate(() => {
			const store = (window as any).__TFVE_STORE__;
			store.getState().setInspectorExpanded('transform', false);
			store.getState().setInspectorExpanded('crop', false);
			store.getState().setInspectorExpanded('speed', false);
			store.getState().setInspectorExpanded('masks', false);
			store.getState().setInspectorExpanded('tracking', false);
			store.getState().setInspectorExpanded('text', false);
			store.getState().setInspectorExpanded('effects', true);
		});
		await page.waitForTimeout(200);

		// Scroll to top so closed headers (Text, Transform, Crop, Speed, Masks, Tracking) and open Effects are visible together
		await inspectorContainer.evaluate((el) => {
			el.scrollTop = 0;
		});
		await page.waitForTimeout(200);

		// Take a screenshot of the inspector showing closed and open tabs side-by-side
		await inspectorContainer.screenshot({ path: 'tests/e2e/inspector-open-closed.png' });
	});
});
