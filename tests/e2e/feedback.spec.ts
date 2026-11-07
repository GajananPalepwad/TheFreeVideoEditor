import { expect, test } from '@playwright/test';

test.describe('Feedback collection system', () => {
	test('submits feedback from the home screen', async ({ page }) => {
		let capturedPayload: unknown = null;

		await page.route('https://sggsapp.co.in/video_editor/submit_feedback.php', async (route) => {
			const request = route.request();
			capturedPayload = JSON.parse(request.postData() || '{}');
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					message: 'Thank you for your feedback!',
					id: 101
				})
			});
		});

		await page.goto('/');

		const feedbackSection = page.locator('#feedback');
		await expect(feedbackSection).toBeVisible();

		// Check category pill selection
		const featureRequestPill = feedbackSection.locator('button[data-category="feature_request"]');
		await featureRequestPill.click();
		await expect(featureRequestPill).toHaveClass(/is-active/);

		// Check that stars start empty at beginning
		await expect(feedbackSection.locator('#rating-value-label')).toContainText('Tap to rate');
		await expect(feedbackSection.locator('button[data-star="1"]')).toHaveClass(/is-empty/);

		// Check rating 4 stars
		const star4 = feedbackSection.locator('button[data-star="4"]');
		await star4.click();
		await expect(feedbackSection.locator('#rating-value-label')).toContainText('4 · Very Good');

		// Fill message
		const messageBox = feedbackSection.locator('#feedback-message');
		await messageBox.fill('Please add support for custom video transitions.');

		// Submit
		await feedbackSection.locator('#feedback-submit-btn').click();

		// Verify success state
		const successBanner = feedbackSection.locator('#feedback-success-state');
		await expect(successBanner).toBeVisible();
		await expect(feedbackSection.locator('#feedback-success-message')).toContainText(
			'Thank you for your feedback!'
		);

		// Verify API payload
		expect(capturedPayload).toMatchObject({
			category: 'feature_request',
			rating: 4,
			message: 'Please add support for custom video transitions.',
			page: '/'
		});
		expect((capturedPayload as { session_id?: string }).session_id).toBeTruthy();
	});

	test('submits feedback after export in the editor', async ({ page }) => {
		let capturedExportPayload: unknown = null;

		await page.route('https://sggsapp.co.in/video_editor/submit_feedback.php', async (route) => {
			const request = route.request();
			capturedExportPayload = JSON.parse(request.postData() || '{}');
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					message: 'Thank you for your feedback!',
					id: 102
				})
			});
		});

		await page.goto('/editor/');

		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		await manager.getByRole('button', { name: 'New project' }).click();
		const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Feedback Test');
		await createDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(page.getByRole('heading', { name: 'Feedback Test' })).toBeVisible();

		// Wait for the store to be available on window
		await page.waitForFunction(() =>
			Boolean((window as unknown as { __TFVE_STORE__?: unknown }).__TFVE_STORE__)
		);

		// Simulate export completion by setting exportCompletedResult on store
		await page.evaluate(() => {
			const store = (
				window as unknown as {
					__TFVE_STORE__: {
						getState: () => {
							openExportCompleteDialog: (res: {
								filename: string;
								format: string;
								width: number;
								height: number;
								fps: number;
								durationSec: number;
								fileSizeBytes: number;
							}) => void;
						};
					};
				}
			).__TFVE_STORE__;

			store.getState().openExportCompleteDialog({
				filename: 'MyExportedVideo.mp4',
				format: 'MP4',
				width: 1920,
				height: 1080,
				fps: 30,
				durationSec: 15,
				fileSizeBytes: 1024 * 1024 * 5
			});
		});

		const completeDialog = page.locator('.export-complete-dialog');
		await expect(completeDialog).toBeVisible();

		// Post-export feedback card is present inside the dialog
		const feedbackCard = completeDialog.locator('.export-complete-feedback-card');
		await expect(feedbackCard).toBeVisible();
		await expect(feedbackCard.locator('.export-feedback-title')).toContainText(
			'Rate your export experience'
		);

		// Category toggle options default to 'export' active chip (replacing dropdown)
		const exportCategoryChip = feedbackCard.locator('button[data-category="export"]');
		await expect(exportCategoryChip).toHaveClass(/is-active/);

		// Stars start empty at beginning
		await expect(feedbackCard.locator('.export-feedback-rating-hint')).toContainText('Tap to rate');
		await expect(feedbackCard.locator('button[data-star="5"]')).toHaveClass(/is-empty/);

		// Click 5 stars
		await feedbackCard.locator('button[data-star="5"]').click();
		await expect(feedbackCard.locator('.export-feedback-rating-hint')).toContainText(
			'5 · Excellent'
		);

		// Fill feedback message
		const input = feedbackCard.locator('.export-feedback-input');
		await input.fill('The MP4 export was super fast and high quality!');

		// Submit
		await feedbackCard.locator('.export-feedback-submit-btn').click();

		// Success confirmation visible in dialog
		const successState = completeDialog.locator('.export-feedback-submitted');
		await expect(successState).toBeVisible();
		await expect(successState.locator('.export-feedback-success-title')).toContainText(
			'Thank you for your feedback!'
		);

		// Verify API payload
		expect(capturedExportPayload).toMatchObject({
			category: 'export',
			rating: 5,
			message: 'The MP4 export was super fast and high quality!',
			page: '/editor'
		});
		expect((capturedExportPayload as { session_id?: string }).session_id).toBeTruthy();

		// Verify user can still click Done to dismiss the dialog
		await completeDialog.locator('.export-complete-done-btn').click();
		await expect(completeDialog).not.toBeVisible();
	});

	test('opens feedback dialog from editor header menu beside Guide and submits feedback', async ({
		page
	}) => {
		let capturedEditorPayload: unknown = null;

		await page.route('https://sggsapp.co.in/video_editor/submit_feedback.php', async (route) => {
			const request = route.request();
			capturedEditorPayload = JSON.parse(request.postData() || '{}');
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					message: 'Thank you for your feedback!',
					id: 103
				})
			});
		});

		await page.goto('/editor/');

		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		await manager.getByRole('button', { name: 'New project' }).click();
		const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Header Feedback Test');
		await createDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(page.getByRole('heading', { name: 'Header Feedback Test' })).toBeVisible();

		// Verify Feedback button is in the application menu bar beside Guide
		const menuBar = page.locator('.menu-bar');
		const guideBtn = menuBar.getByRole('button', { name: 'Guide', exact: true });
		const feedbackBtn = menuBar.getByRole('button', { name: 'Feedback', exact: true });

		await expect(guideBtn).toBeVisible();
		await expect(feedbackBtn).toBeVisible();

		// Click Feedback button in the header
		await feedbackBtn.click();

		// Feedback modal dialog opens with the reused component
		const feedbackDialog = page.locator('.editor-feedback-modal-dialog');
		await expect(feedbackDialog).toBeVisible();
		await expect(feedbackDialog.locator('.export-feedback-title')).toContainText(
			'Share Your Feedback'
		);

		// Select category 'ui_ux'
		const uiUxChip = feedbackDialog.locator('button[data-category="ui_ux"]');
		await uiUxChip.click();
		await expect(uiUxChip).toHaveClass(/is-active/);

		// Click 5 stars
		await feedbackDialog.locator('button[data-star="5"]').click();
		await expect(feedbackDialog.locator('.export-feedback-rating-hint')).toContainText(
			'5 · Excellent'
		);

		// Enter feedback message
		const input = feedbackDialog.locator('.export-feedback-input');
		await input.fill('The editor timeline is super smooth and easy to use!');

		// Submit
		await feedbackDialog.locator('.export-feedback-submit-btn').click();

		// Success confirmation visible inside the dialog
		const successState = feedbackDialog.locator('.export-feedback-submitted');
		await expect(successState).toBeVisible();
		await expect(successState.locator('.export-feedback-success-title')).toContainText(
			'Thank you for your feedback!'
		);

		// Verify API payload
		expect(capturedEditorPayload).toMatchObject({
			category: 'ui_ux',
			rating: 5,
			message: 'The editor timeline is super smooth and easy to use!',
			page: '/editor'
		});

		// Verify that the corner close button is removed to eliminate overlapping buttons
		await expect(feedbackDialog.locator('.editor-feedback-close-btn')).not.toBeVisible();

		// Verify Done button closes the modal
		await feedbackDialog.locator('.export-feedback-done-btn').click();
		await expect(feedbackDialog).not.toBeVisible();
	});

	test('allows submitting rating with an empty review text out of 5', async ({ page }) => {
		let capturedPayload: unknown = null;

		await page.route('https://sggsapp.co.in/video_editor/submit_feedback.php', async (route) => {
			const request = route.request();
			capturedPayload = JSON.parse(request.postData() || '{}');
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					message: 'Thank you for your feedback!',
					id: 104
				})
			});
		});

		await page.goto('/');

		const feedbackSection = page.locator('#feedback');
		await expect(feedbackSection).toBeVisible();

		// Select 5 stars, leave review textarea empty
		const star5 = feedbackSection.locator('button[data-star="5"]');
		await star5.click();
		await expect(feedbackSection.locator('#rating-value-label')).toContainText('5 · Excellent');

		// Submit button should be enabled and allow sending empty review out of 5
		const submitBtn = feedbackSection.locator('#feedback-submit-btn');
		await expect(submitBtn).toBeEnabled();
		await submitBtn.click();

		// Success confirmation visible
		const successBanner = feedbackSection.locator('#feedback-success-state');
		await expect(successBanner).toBeVisible();

		// Verify API payload sent rating 5 and empty message
		expect(capturedPayload).toMatchObject({
			category: 'general',
			rating: 5,
			message: '',
			page: '/'
		});
	});

	test('header navigation displays Feedback in PC mode and both Editor and Feedback in mobile mode', async ({
		page
	}) => {
		// 1. Desktop viewport (PC mode)
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto('/');

		const desktopNav = page.locator('nav.site-nav.desktop-only');
		await expect(desktopNav).toBeVisible();
		await expect(desktopNav.getByRole('link', { name: 'Feedback' })).toBeVisible();
		await expect(desktopNav.getByRole('link', { name: 'Editor' })).not.toBeVisible();
		await expect(page.locator('.header-cta-btn.desktop-only')).toBeVisible();

		// 2. Mobile viewport (Mobile mode)
		await page.setViewportSize({ width: 375, height: 667 });
		const mobileDrawer = page.locator('#mobile-nav-drawer');
		const mobileToggle = page.locator('#mobile-menu-toggle');
		await mobileToggle.click();
		await expect(mobileDrawer).toBeVisible();
		await expect(mobileDrawer.locator('.mobile-nav-link', { hasText: 'Editor' })).toBeVisible();
		await expect(mobileDrawer.locator('.mobile-nav-link', { hasText: 'Feedback' })).toBeVisible();
	});
});
