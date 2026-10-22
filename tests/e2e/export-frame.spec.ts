import { expect, test } from '@playwright/test';

test.describe('Still Frame Export Dialog', () => {
	test('opens via transport button and Shift+E shortcut with correct slider styling', async ({
		page
	}) => {
		await page.goto('/editor');
		await page
			.getByRole('dialog', { name: 'Your Projects' })
			.getByRole('button', { name: 'New project' })
			.click();
		await page
			.getByRole('dialog', { name: 'Create a Project' })
			.getByRole('button', { name: 'Create project' })
			.click();
		await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();

		// 1. Verify button in TransportBar and open dialog
		const captureBtn = page.getByRole('button', { name: 'Export frame' });
		await expect(captureBtn).toBeVisible();
		await captureBtn.click();

		const dialog = page.locator('dialog.export-frame-dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('heading', { name: 'Export Frame' })).toBeVisible();

		// 2. JPEG is selected by default -> verify Quality slider dimensions
		const slider = dialog.locator('input.export-frame-slider');
		await expect(slider).toBeVisible();
		const box = await slider.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.height).toBeLessThanOrEqual(20);

		const qualityVal = dialog.locator('.export-frame-quality-val');
		await expect(qualityVal).toHaveText('92%');

		// 3. Format switching: PNG hides slider, WebP shows slider
		await dialog.getByRole('radio', { name: 'PNG' }).click();
		await expect(slider).not.toBeVisible();

		await dialog.getByRole('radio', { name: 'WebP' }).click();
		await expect(slider).toBeVisible();

		// 4. Close via Cancel button
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).not.toBeVisible();

		// 5. Test Shift+E shortcut opens dialog
		await page.keyboard.press('Shift+E');
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Close export frame dialog' }).click();
		await expect(dialog).not.toBeVisible();
	});
});
