import { expect, test } from '@playwright/test';

test.describe('Import Dialog & Media Downloader', () => {
	test('opens import modal with uniform button sizes, YouTube, and Instagram downloader flows', async ({
		page
	}) => {
		await page.goto('/editor');

		// Open or create a project
		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		await manager.getByRole('button', { name: 'New project' }).click();
		const newProjectDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await newProjectDialog
			.getByRole('textbox', { name: 'Project name' })
			.fill('Import Dialog Test');
		await newProjectDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(page.getByRole('heading', { name: 'Import Dialog Test' })).toBeVisible();

		// Click the Import button in Media Library toolbar
		const importBtn = page.locator('.media-import-button');
		await expect(importBtn).toBeVisible();
		await importBtn.click();

		// Verify Import Media Dialog opens with same theme
		const importDialog = page.getByRole('dialog', { name: 'Import Media' });
		await expect(importDialog).toBeVisible();
		await expect(importDialog.locator('.dialog-eyebrow')).toHaveText('MEDIA LIBRARY');

		// Verify the 3 options exist
		const computerTab = importDialog.getByRole('tab', { name: 'Computer' });
		const youtubeTab = importDialog.getByRole('tab', { name: 'YouTube' });
		const instaTab = importDialog.getByRole('tab', { name: 'Instagram' });

		await expect(computerTab).toBeVisible();
		await expect(youtubeTab).toBeVisible();
		await expect(instaTab).toBeVisible();

		// Test Computer tab panel
		await computerTab.click();
		await expect(importDialog.getByText(/Choose Files from (Device|Computer)/i)).toBeVisible();

		// Verify Cancel button in computer tab
		const compCancelBtn = importDialog.getByRole('button', { name: 'Cancel' });
		await expect(compCancelBtn).toBeVisible();
		const compCancelBox = await compCancelBtn.boundingBox();
		expect(compCancelBox?.height).toBe(32);

		// Test YouTube tab panel and check button sizes
		await youtubeTab.click();
		await expect(
			importDialog.getByRole('heading', { name: 'Download using YouTube Link' })
		).toBeVisible();

		const ytCancelBtn = importDialog.getByRole('button', { name: 'Cancel' });
		const ytSaveOnlyBtn = importDialog.getByRole('button', { name: 'Save to Computer Only' });
		const ytDownloadBtn = importDialog.getByRole('button', { name: /Download & Import/i });

		// Verify that ALL action buttons have identical, fixed 32px height
		const ytCancelBox = await ytCancelBtn.boundingBox();
		const ytSaveOnlyBox = await ytSaveOnlyBtn.boundingBox();
		const ytDownloadBox = await ytDownloadBtn.boundingBox();

		expect(ytCancelBox?.height).toBe(32);
		expect(ytSaveOnlyBox?.height).toBe(32);
		expect(ytDownloadBox?.height).toBe(32);

		const urlInput = importDialog.getByLabel('YouTube video URL');
		await expect(urlInput).toBeVisible();

		// Verify Format Options exist
		const videoAudioBtn = importDialog.getByRole('radio', { name: 'Video + Audio' });
		const audioOnlyBtn = importDialog.getByRole('radio', { name: 'Audio Only' });
		const videoOnlyBtn = importDialog.getByRole('radio', { name: 'Video Only' });
		await expect(videoAudioBtn).toBeVisible();
		await expect(audioOnlyBtn).toBeVisible();
		await expect(videoOnlyBtn).toBeVisible();

		// Verify Quality selector exists
		const qualitySelect = importDialog.getByLabel('Video quality');
		await expect(qualitySelect).toBeVisible();
		await qualitySelect.selectOption('720');

		// Switch to Audio Only
		await audioOnlyBtn.click();
		await expect(importDialog.getByLabel('Audio quality')).toBeVisible();

		// Switch back to Video + Audio
		await videoAudioBtn.click();

		// Verify 1-Click Download checkbox
		const backupCheckbox = importDialog.locator('.import-device-backup-checkbox');
		await expect(backupCheckbox).toBeChecked();

		await expect(ytDownloadBtn).toBeDisabled();

		// Test validation: enter invalid URL
		await urlInput.fill('https://example.com/not-youtube');
		await expect(ytDownloadBtn).toBeEnabled();
		await ytDownloadBtn.click();
		await expect(importDialog.getByText(/Please enter a valid YouTube video link/i)).toBeVisible();

		// Test validation: enter valid YouTube URL
		await urlInput.fill('https://www.youtube.com/watch?v=jNQXAC9IVRw');
		// Details should be fetched or displayed
		await expect(importDialog.getByText(/Me at the zoo/i)).toBeVisible({ timeout: 15_000 });

		// Switch to Instagram Tab
		await instaTab.click();
		await expect(
			importDialog.getByRole('heading', { name: 'Download using Insta Link' })
		).toBeVisible();

		const instaInput = importDialog.getByLabel('Instagram Reel or Post URL');
		await expect(instaInput).toBeVisible();

		const instaCancelBtn = importDialog.getByRole('button', { name: 'Cancel' });
		const instaSaveOnlyBtn = importDialog.getByRole('button', { name: 'Save to Computer Only' });
		const instaDownloadBtn = importDialog.getByRole('button', { name: /Download & Import/i });

		// Verify Instagram action buttons also have identical 32px height
		const instaCancelBox = await instaCancelBtn.boundingBox();
		const instaSaveOnlyBox = await instaSaveOnlyBtn.boundingBox();
		const instaDownloadBox = await instaDownloadBtn.boundingBox();

		expect(instaCancelBox?.height).toBe(32);
		expect(instaSaveOnlyBox?.height).toBe(32);
		expect(instaDownloadBox?.height).toBe(32);

		// Verify format options on Instagram tab
		await expect(importDialog.getByRole('radio', { name: 'Video + Audio' })).toBeVisible();

		// Test Instagram URL validation
		await instaInput.fill('https://example.com/invalid-link');
		await instaDownloadBtn.click();
		await expect(
			importDialog.getByText(/Please enter a valid Instagram Reel or Post link/i)
		).toBeVisible();

		// Close dialog with close button
		await importDialog.getByRole('button', { name: 'Close dialog' }).click();
		await expect(importDialog).not.toBeVisible();
	});

	test('downloads YouTube video, triggers 1-click download, and provides library asset download', async ({
		page
	}) => {
		test.setTimeout(60_000);
		await page.goto('/editor');

		// Open or create a project
		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		await manager.getByRole('button', { name: 'New project' }).click();
		const newProjectDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await newProjectDialog
			.getByRole('textbox', { name: 'Project name' })
			.fill('YouTube DL Project');
		await newProjectDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(page.getByRole('heading', { name: 'YouTube DL Project' })).toBeVisible();

		// Click the Import button
		await page.locator('.media-import-button').click();

		const importDialog = page.getByRole('dialog', { name: 'Import Media' });
		await expect(importDialog).toBeVisible();

		// Go to YouTube tab
		await importDialog.getByRole('tab', { name: 'YouTube' }).click();

		// Fill YouTube link
		const urlInput = importDialog.getByLabel('YouTube video URL');
		await urlInput.fill('https://www.youtube.com/watch?v=jNQXAC9IVRw');

		// Select 360p quality for fastest test download
		await importDialog.getByLabel('Video quality').selectOption('360');

		// Listen for browser download event
		const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

		// Click 1-Click Download & Import
		const downloadBtn = importDialog.getByRole('button', { name: /Download & Import/i });
		await expect(downloadBtn).toBeEnabled({ timeout: 10_000 });
		await downloadBtn.click();

		// Expect progress indicator
		await expect(importDialog.locator('.import-progress-box')).toBeVisible({ timeout: 5000 });

		// Verify 1-click browser download was triggered
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toContain('Me at the zoo');

		// Dialog should close automatically after successful import
		await expect(importDialog).not.toBeVisible({ timeout: 45_000 });

		// Check that the imported asset appears in the media library
		const assets = page.getByRole('listbox', { name: 'Project media' });
		await expect(assets.getByRole('option')).toHaveCount(1, { timeout: 20_000 });
		await expect(assets.getByRole('option').first()).toContainText('Me at the zoo');

		// Verify the 1-click download button on the asset in Media Library
		const assetOption = assets.getByRole('option').first();
		await assetOption.hover();
		const assetDownloadBtn = assetOption.getByRole('button', { name: /Download .* to computer/i });
		await expect(assetDownloadBtn).toBeVisible();

		// Test clicking 1-click download on the asset
		const assetDownloadPromise = page.waitForEvent('download');
		await assetDownloadBtn.click();
		const assetDownload = await assetDownloadPromise;
		expect(assetDownload.suggestedFilename()).toContain('Me at the zoo');
	});

	test('downloads Instagram media, triggers 1-click download, and imports into project', async ({
		page
	}) => {
		test.setTimeout(60_000);
		await page.goto('/editor');

		// Open or create a project
		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		await manager.getByRole('button', { name: 'New project' }).click();
		const newProjectDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await newProjectDialog
			.getByRole('textbox', { name: 'Project name' })
			.fill('Instagram DL Project');
		await newProjectDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(page.getByRole('heading', { name: 'Instagram DL Project' })).toBeVisible();

		// Click the Import button
		await page.locator('.media-import-button').click();

		const importDialog = page.getByRole('dialog', { name: 'Import Media' });
		await expect(importDialog).toBeVisible();

		// Go to Instagram tab
		await importDialog.getByRole('tab', { name: 'Instagram' }).click();

		// Fill Instagram link
		const urlInput = importDialog.getByLabel('Instagram Reel or Post URL');
		await urlInput.fill('https://www.instagram.com/p/DZxvMgyH8yR/');

		// Wait for details preview
		await expect(importDialog.getByText(/Democratic Republic of the Congo/i)).toBeVisible({
			timeout: 15_000
		});

		// Listen for browser download event
		const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

		// Click 1-Click Download & Import
		const downloadBtn = importDialog.getByRole('button', { name: /Download & Import/i });
		await expect(downloadBtn).toBeEnabled({ timeout: 10_000 });
		await downloadBtn.click();

		// Expect progress indicator
		await expect(importDialog.locator('.import-progress-box')).toBeVisible({ timeout: 5000 });

		// Verify 1-click browser download was triggered
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toContain('Democratic Republic');

		// Dialog should close automatically after successful import
		await expect(importDialog).not.toBeVisible({ timeout: 45_000 });

		// Check that the imported asset appears in the media library
		const assets = page.getByRole('listbox', { name: 'Project media' });
		await expect(assets.getByRole('option')).toHaveCount(1, { timeout: 20_000 });
		await expect(assets.getByRole('option').first()).toContainText('Democratic Republic');

		// Verify 1-click download on media library asset
		const assetOption = assets.getByRole('option').first();
		await assetOption.hover();
		const assetDownloadBtn = assetOption.getByRole('button', { name: /Download .* to computer/i });
		await expect(assetDownloadBtn).toBeVisible();

		const assetDownloadPromise = page.waitForEvent('download');
		await assetDownloadBtn.click();
		const assetDownload = await assetDownloadPromise;
		expect(assetDownload.suggestedFilename()).toContain('Democratic Republic');
	});

	test('downloads Instagram Reel video and imports into project timeline', async ({ page }) => {
		test.setTimeout(60_000);
		await page.goto('/editor');

		// Open or create a project
		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		await manager.getByRole('button', { name: 'New project' }).click();
		const newProjectDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await newProjectDialog.getByRole('textbox', { name: 'Project name' }).fill('Instagram Reel DL');
		await newProjectDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(page.getByRole('heading', { name: 'Instagram Reel DL' })).toBeVisible();

		// Click the Import button
		await page.locator('.media-import-button').click();

		const importDialog = page.getByRole('dialog', { name: 'Import Media' });
		await expect(importDialog).toBeVisible();

		// Go to Instagram tab
		await importDialog.getByRole('tab', { name: 'Instagram' }).click();

		// Fill Instagram Reel link
		const urlInput = importDialog.getByLabel('Instagram Reel or Post URL');
		await urlInput.fill('https://www.instagram.com/reel/DehR-cGhfPv/');

		// Wait for details preview
		await expect(importDialog.getByText(/Gyanesh must go/i)).toBeVisible({ timeout: 15_000 });

		// Listen for browser download event
		const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });

		// Click 1-Click Download & Import
		const downloadBtn = importDialog.getByRole('button', { name: /Download & Import/i });
		await expect(downloadBtn).toBeEnabled({ timeout: 10_000 });
		await downloadBtn.click();

		// Expect progress indicator
		await expect(importDialog.locator('.import-progress-box')).toBeVisible({ timeout: 5000 });

		// Verify 1-click browser download was triggered
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toContain('.mp4');

		// Dialog should close automatically after successful import
		await expect(importDialog).not.toBeVisible({ timeout: 45_000 });

		// Check that the imported asset appears in the media library
		const assets = page.getByRole('listbox', { name: 'Project media' });
		await expect(assets.getByRole('option')).toHaveCount(1, { timeout: 20_000 });
	});
});
