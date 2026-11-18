import { test, expect } from '@playwright/test';

test.describe('Popup dialog viewport centering', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/editor/');
		const manager = page.locator('.project-manager-dialog');
		try {
			await manager.waitFor({ state: 'visible', timeout: 3000 });
			await manager.getByRole('button', { name: 'New project' }).click();
			const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
			await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Centering Test');
			await createDialog.getByRole('button', { name: 'Create project' }).click();
			await manager.waitFor({ state: 'hidden', timeout: 3000 });
		} catch {}
	});

	test('Export and Import dialogs are centered within viewport', async ({ page }) => {
		const viewport = page.viewportSize() ?? { width: 1280, height: 800 };

		// 1. Export Dialog
		const exportBtn = page.locator('.export-button');
		await exportBtn.click();

		const exportDialog = page.locator('dialog.export-dialog');
		await expect(exportDialog).toBeVisible();

		const exportBox = await exportDialog.boundingBox();
		expect(exportBox).toBeTruthy();
		if (exportBox) {
			const exportCenterX = exportBox.x + exportBox.width / 2;
			const exportCenterY = exportBox.y + exportBox.height / 2;
			expect(Math.abs(exportCenterX - viewport.width / 2)).toBeLessThan(5);
			expect(Math.abs(exportCenterY - viewport.height / 2)).toBeLessThan(5);
		}

		await page.keyboard.press('Escape');
		await expect(exportDialog).not.toBeVisible();

		// 2. Import Dialog
		await page.evaluate(() => {
			(
				window as unknown as {
					__TFVE_STORE__: { getState: () => { openImportDialog: () => void } };
				}
			).__TFVE_STORE__
				.getState()
				.openImportDialog();
		});

		const importDialog = page.locator('dialog.import-dialog');
		await expect(importDialog).toBeVisible();

		const importBox = await importDialog.boundingBox();
		expect(importBox).toBeTruthy();
		if (importBox) {
			const importCenterX = importBox.x + importBox.width / 2;
			const importCenterY = importBox.y + importBox.height / 2;
			expect(Math.abs(importCenterX - viewport.width / 2)).toBeLessThan(5);
			expect(Math.abs(importCenterY - viewport.height / 2)).toBeLessThan(5);
		}

		await page.keyboard.press('Escape');
		await expect(importDialog).not.toBeVisible();
	});
});
