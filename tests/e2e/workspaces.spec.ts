import { test, expect } from '@playwright/test';

test.describe('Workspaces & Layouts', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/editor/');
		// Ensure fresh workspace state for test start
		await page.evaluate(() => {
			window.localStorage.removeItem('tfve:workspace-state');
		});
		// Ensure the editor shell is loaded
		await expect(page.locator('.editor-shell')).toBeVisible();

		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		await expect(manager).toBeVisible();
		await manager.getByRole('button', { name: 'New project' }).click();
		const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await createDialog
			.getByRole('textbox', { name: 'Project name' })
			.fill('Workspace Test Project');
		await createDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(createDialog).toHaveCount(0);
		await expect(manager).toHaveCount(0);
		await expect(page.locator('.editor-workspace')).toBeVisible();
		await page.evaluate(() => {
			(document.activeElement as HTMLElement)?.blur?.();
		});
	});

	test('renders all 7 Premiere Pro style workspace tabs', async ({ page }) => {
		const tabs = page.locator('.workspace-tab');
		await expect(tabs).toHaveCount(7);

		const names = ['Assembly', 'AI', 'Editing', 'Color', 'Effects', 'Audio', 'Graphics'];
		for (let i = 0; i < names.length; i++) {
			await expect(tabs.nth(i)).toHaveText(names[i]);
		}

		// Default active tab is Editing
		const activeTab = page.locator('.workspace-tab[data-active="true"]');
		await expect(activeTab).toHaveText('Editing');
		await expect(activeTab).toHaveAttribute('aria-selected', 'true');
	});

	test('switches workspaces by clicking tabs', async ({ page }) => {
		// Switch to AI workspace
		await page.click('.workspace-tab:has-text("AI")');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('AI');

		// Switch to Color workspace
		await page.click('.workspace-tab:has-text("Color")');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Color');
		// Color panel should be visible
		await expect(page.locator('.layout-panel-body.color-panel')).toBeVisible();

		// Switch to Effects workspace
		await page.click('.workspace-tab:has-text("Effects")');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Effects');
		// Effects library should be visible
		await expect(page.locator('.effects-library')).toBeVisible();

		// Switch to Assembly workspace
		await page.click('.workspace-tab:has-text("Assembly")');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Assembly');
		// Media library should be visible
		await expect(page.locator('.media-library')).toBeVisible();

		// Switch back to Editing
		await page.click('.workspace-tab:has-text("Editing")');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Editing');
	});

	test('switches workspaces using keyboard shortcuts Alt+Shift+1..7', async ({ page }) => {
		// Alt+Shift+4 -> Color
		await page.keyboard.press('Alt+Shift+4');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Color');

		// Alt+Shift+5 -> Effects
		await page.keyboard.press('Alt+Shift+5');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Effects');

		// Alt+Shift+1 -> Assembly
		await page.keyboard.press('Alt+Shift+1');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Assembly');

		// Alt+Shift+2 -> AI
		await page.keyboard.press('Alt+Shift+2');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('AI');

		// Alt+Shift+3 -> Editing
		await page.keyboard.press('Alt+Shift+3');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Editing');
	});

	test('preserves Program monitor WebGL canvas across workspace switches (no remount)', async ({
		page
	}) => {
		// Tag the canvas element with an expando property
		const canvasHandle = page.locator('.preview-canvas');
		await expect(canvasHandle).toBeVisible();

		await page.evaluate(() => {
			const canvas = document.querySelector('.preview-canvas') as HTMLCanvasElement & {
				__persisted_test_id?: number;
			};
			if (canvas) {
				canvas.__persisted_test_id = 4299;
			}
		});

		// Switch between workspaces
		const workspaces = ['Assembly', 'AI', 'Color', 'Effects', 'Audio', 'Graphics', 'Editing'];
		for (const ws of workspaces) {
			await page.click(`.workspace-tab:has-text("${ws}")`);
			await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText(ws);

			// Verify canvas retained its exact JS object identity (was kept alive in keepAlive slot, not remounted)
			const hasId = await page.evaluate(() => {
				const canvas = document.querySelector('.preview-canvas') as HTMLCanvasElement & {
					__persisted_test_id?: number;
				};
				return canvas?.__persisted_test_id === 4299;
			});
			expect(hasId).toBe(true);
		}
	});

	test('maximizes panel on Backquote key and restores', async ({ page }) => {
		// Hover over timeline editor
		const timeline = page.locator('.timeline-panel');
		await expect(timeline).toBeVisible();
		await timeline.hover();

		// Press Backquote `
		await page.keyboard.press('Backquote');

		// Root should now be maximized
		await expect(page.locator('.workspace-root--maximized')).toBeVisible();

		// Press Backquote again to restore
		await page.keyboard.press('Backquote');
		await expect(page.locator('.workspace-root--maximized')).toHaveCount(0);
	});

	test('persists workspace preference in localStorage across page reloads', async ({ page }) => {
		// Switch to Audio workspace
		await page.click('.workspace-tab:has-text("Audio")');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Audio');

		// Reload page
		await page.reload();
		await expect(page.locator('.editor-shell')).toBeVisible();

		// If Project Manager dialog appears on reload, open existing project or close it
		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		if (await manager.isVisible()) {
			const openBtn = manager.getByRole('button', { name: 'Open', exact: true });
			if ((await openBtn.count()) > 0) {
				await openBtn.first().click();
			} else {
				await manager.getByRole('button', { name: 'New project' }).click();
				const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
				await createDialog
					.getByRole('textbox', { name: 'Project name' })
					.fill('Workspace Test Reload');
				await createDialog.getByRole('button', { name: 'Create project' }).click();
			}
		}

		// Should still be on Audio workspace
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Audio');
	});

	test('manages custom workspaces via Edit Workspaces dialog', async ({ page }) => {
		// Click workspace overflow / options button
		await page.click('button[aria-label="More workspaces and layout options"]');

		// Click "Save as New Workspace..."
		// Handle dialog prompt
		page.once('dialog', async (dialog) => {
			expect(dialog.type()).toBe('prompt');
			await dialog.accept('My Custom Layout');
		});
		await page.click('button:has-text("Save as New Workspace…")');

		// Verify custom tab exists
		await expect(page.locator('.workspace-tab:has-text("My Custom Layout")')).toBeVisible();
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('My Custom Layout');

		// Open Edit Workspaces dialog
		await page.click('button[aria-label="More workspaces and layout options"]');
		await page.click('button:has-text("Edit Workspaces…")');

		// Dialog is visible
		await expect(page.locator('.edit-workspaces-dialog')).toBeVisible();
		await expect(page.locator('.edit-workspaces-item:has-text("My Custom Layout")')).toBeVisible();

		// Close dialog
		await page.click('button[data-testid="done-workspaces-btn"]');
		await expect(page.locator('.edit-workspaces-dialog')).toHaveCount(0);
	});

	test('maximizes and restores panels without removeChild or depth errors', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (err) => errors.push(err.message));

		// Maximize project/media panel via header maximize button
		const mediaStack = page.locator('[data-testid="stack-media"]');
		await mediaStack.locator('button[title="Maximize panel"]').click();
		await expect(page.locator('.workspace-root--maximized')).toBeVisible();

		// Restore via Restore button
		await page.getByRole('button', { name: 'Restore' }).click();
		await expect(page.locator('.workspace-root--maximized')).toHaveCount(0);

		// Maximize and restore using Backquote shortcut on timeline
		const timeline = page.locator('.timeline-panel');
		await timeline.hover();
		await page.keyboard.press('Backquote');
		await expect(page.locator('.workspace-root--maximized')).toBeVisible();
		await page.keyboard.press('Backquote');
		await expect(page.locator('.workspace-root--maximized')).toHaveCount(0);

		expect(errors).toHaveLength(0);
	});
});
