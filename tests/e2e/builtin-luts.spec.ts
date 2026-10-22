import { expect, test } from '@playwright/test';

test.describe('Pre-available Built-in LUTs', () => {
	test('displays and applies built-in LUT presets in Color panel and Effects inspector', async ({
		page
	}) => {
		await page.goto('/editor');
		const manager = page.locator('.project-manager-dialog');
		await manager.waitFor({ state: 'visible', timeout: 5000 });
		await manager.getByRole('button', { name: 'New project' }).click();
		const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await createDialog.getByRole('textbox', { name: 'Project name' }).fill('LUT Presets Test');
		await createDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(manager).not.toBeVisible();
		await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));

		// Add a sample shape clip and select it
		await page.evaluate(() => {
			const store = (window as any).__TFVE_STORE__;
			const track = store.getState().project?.tracks.find((t: any) => t.kind === 'video');
			if (track) {
				const clipId = store.getState().addShapeClip(
					{
						shapeType: 'rectangle',
						width: 600,
						height: 400,
						fillColor: { r: 0.9, g: 0.4, b: 0.2, a: 1 }
					},
					{ start: 0, trackId: track.id }
				);
				store.getState().selectClips([clipId]);
			}
		});

		// Switch to the Color tab in the right dock panel
		const colorTabBtn = page.getByTestId('tab-color');
		if (await colorTabBtn.isVisible()) {
			await colorTabBtn.click();
		}

		// Switch to LUT sub-tab in Color Panel
		const lutTab = page.getByRole('tab', { name: 'LUT' });
		await expect(lutTab).toBeVisible();
		await lutTab.click();

		// Check the Select 3D LUT dropdown has the preset LUTs
		const lutSelect = page.locator('.lut-select');
		await expect(lutSelect).toBeVisible();

		const optgroup = lutSelect.locator('optgroup[label="Preset LUTs"]');
		await expect(optgroup.locator('option')).toHaveCount(7);

		// Check the Preset Looks buttons grid
		const presetButtons = page.locator('.lut-preset-btn');
		await expect(presetButtons).toHaveCount(7);

		// Click "35mm Portrait" preset button
		const portraitBtn = page.locator('.lut-preset-btn', { hasText: '35mm Portrait' });
		await expect(portraitBtn).toBeVisible();
		await portraitBtn.click();

		// Verify 35mm Portrait button becomes active
		await expect(portraitBtn).toHaveClass(/is-active/);

		// Verify info card appears with description
		const infoCard = page.locator('.lut-builtin-info-card');
		await expect(infoCard).toBeVisible();
		await expect(infoCard.locator('.lut-builtin-info-title')).toHaveText('35mm Portrait');
		await expect(infoCard.locator('.lut-builtin-info-desc')).toContainText('35mm film emulation');

		// Verify store state has lut3d effect applied with builtin:35mm-portrait
		const effectInfo = await page.evaluate(() => {
			const store = (window as any).__TFVE_STORE__;
			const clip = store.getState().project?.tracks[0]?.clips[0];
			const lutEffect = clip?.effects?.find((e: any) => e.type === 'lut3d');
			return {
				hasLutEffect: Boolean(lutEffect),
				lutAssetId: lutEffect?.params?.lutAssetId,
				intensity: lutEffect?.params?.intensity
			};
		});
		expect(effectInfo.hasLutEffect).toBe(true);
		expect(effectInfo.lutAssetId).toBe('builtin:35mm-portrait');

		// Check LUT Intensity slider is displayed
		const intensitySlider = page.locator('.color-slider-row', { hasText: 'LUT Intensity' });
		await expect(intensitySlider).toBeVisible();

		// Take a screenshot of the LUT container showing all presets and info
		const lutContainer = page.locator('.lut-container');
		await lutContainer.screenshot({ path: 'tests/e2e/color-panel-luts.png' });

		// Click another preset: "Filmic"
		const filmicBtn = page.locator('.lut-preset-btn', { hasText: 'Filmic' });
		await filmicBtn.click();
		await expect(filmicBtn).toHaveClass(/is-active/);
		await expect(portraitBtn).not.toHaveClass(/is-active/);
		await expect(infoCard.locator('.lut-builtin-info-title')).toHaveText('Filmic');
		expect(await lutSelect.inputValue()).toBe('builtin:filmic');

		// Select via dropdown: "Classic Chrome"
		await lutSelect.selectOption('builtin:classic-chrome');
		const chromeBtn = page.locator('.lut-preset-btn', { hasText: 'Classic Chrome' });
		await expect(chromeBtn).toHaveClass(/is-active/);
		await expect(filmicBtn).not.toHaveClass(/is-active/);
		await expect(infoCard.locator('.lut-builtin-info-title')).toHaveText('Classic Chrome');

		// Select "(None)" to clear
		await lutSelect.selectOption('');
		await expect(infoCard).not.toBeVisible();
		await expect(chromeBtn).not.toHaveClass(/is-active/);
	});
});
