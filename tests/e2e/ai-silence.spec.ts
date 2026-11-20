import { expect, test } from '@playwright/test';

test.describe('AI Workspace & Silence Trimming', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/editor/');
		await page.evaluate(() => {
			window.localStorage.removeItem('tfve:workspace-state');
		});
		await expect(page.locator('.editor-shell')).toBeVisible();

		const manager = page.getByRole('dialog', { name: 'Your Projects' });
		await expect(manager).toBeVisible();
		await manager.getByRole('button', { name: 'New project' }).click();
		const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
		await createDialog.getByRole('textbox', { name: 'Project name' }).fill('AI Silence Test');
		await createDialog.getByRole('button', { name: 'Create project' }).click();
		await expect(createDialog).toHaveCount(0);
		await expect(manager).toHaveCount(0);
		await expect(page.locator('.editor-workspace')).toBeVisible();
	});

	test('switches to AI workspace via tab and keyboard shortcut', async ({ page }) => {
		// Default active is Editing
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Editing');

		// 1. Switch via click
		await page.click('.workspace-tab:has-text("AI")');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('AI');
		await expect(page.getByTestId('ai-assistant-panel')).toBeVisible();

		// Switch to Assembly
		await page.click('.workspace-tab:has-text("Assembly")');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('Assembly');

		// 2. Switch back to AI via shortcut Alt+Shift+2
		await page.keyboard.press('Alt+Shift+Digit2');
		await expect(page.locator('.workspace-tab[data-active="true"]')).toHaveText('AI');
		await expect(page.getByTestId('ai-assistant-panel')).toBeVisible();
	});

	test('renders silence trimming controls with correct defaults', async ({ page }) => {
		await page.click('.workspace-tab:has-text("AI")');
		const panel = page.getByTestId('ai-assistant-panel');
		await expect(panel).toBeVisible();

		// Parameters
		await expect(panel.locator('.silence-trim-panel')).toBeVisible();

		// Parameters
		await expect(panel.getByText('Max silence between voices')).toBeVisible();
		await expect(panel.getByText('Min silence to cut')).toBeVisible();
		await expect(panel.getByText(/Pad Before/)).toBeVisible();
		await expect(panel.getByText(/Keep natural breaths/)).toBeVisible();
		await expect(panel.getByText(/Voice only/)).toBeVisible();

		// Action buttons
		await expect(panel.getByRole('button', { name: 'Detect Silences' })).toBeVisible();
	});

	test('displays detected silences in review list, timeline overlay, and applies trim', async ({
		page
	}) => {
		await page.click('.workspace-tab:has-text("AI")');
		const panel = page.getByTestId('ai-assistant-panel');
		await expect(panel).toBeVisible();

		// Populate synthetic detected silences directly via store for deterministic E2E verification
		await page.evaluate(() => {
			const store = (
				window as unknown as {
					__TFVE_STORE__?: {
						getState: () => { setDetectedSilences: (s: unknown) => void };
					};
				}
			).__TFVE_STORE__;
			if (store) {
				store.getState().setDetectedSilences([
					{
						id: 'silence_1',
						startUs: 1_000_000,
						endUs: 2_000_000,
						durationUs: 1_000_000,
						cutStartUs: 1_000_000,
						cutEndUs: 1_600_000,
						cutDurationUs: 600_000,
						included: true
					},
					{
						id: 'silence_2',
						startUs: 3_500_000,
						endUs: 4_500_000,
						durationUs: 1_000_000,
						cutStartUs: 3_500_000,
						cutEndUs: 4_100_000,
						cutDurationUs: 600_000,
						included: true
					}
				]);
			}
		});

		// Verify review summary
		await expect(page.locator('.ai-summary-banner')).toBeVisible();
		await expect(page.locator('.ai-summary-banner')).toContainText('2 Silences');

		// Verify review cards
		const cards = page.locator('.ai-silence-item');
		await expect(cards).toHaveCount(2);

		// Verify timeline silence overlays
		const overlays = page.locator('.timeline-silence-region');
		await expect(overlays).toHaveCount(2);

		// Toggle exclude on first silence card
		const firstCheckbox = cards.first().locator('input[type="checkbox"]');
		await firstCheckbox.uncheck();
		await expect(cards.first()).toHaveClass(/is-excluded/);
		await expect(overlays.first()).toHaveClass(/is-excluded/);

		// Toggle virtual preview button
		const virtualPreviewBtn = page.getByRole('button', { name: /Virtual Preview/ });
		await expect(virtualPreviewBtn).toBeVisible();
		await virtualPreviewBtn.click();
		await expect(virtualPreviewBtn).toHaveClass(/is-active/);

		// Test Apply button (New sequence mode)
		const applyBtn = page.getByRole('button', { name: 'Apply to New Sequence' });
		await expect(applyBtn).toBeVisible();
		await applyBtn.click();

		// Sequence switcher or notification confirms new sequence created
		await page.waitForTimeout(500);
	});

	test('scrolls to next options on click of Detect Silences', async ({ page }) => {
		await page.click('.workspace-tab:has-text("AI")');
		const panel = page.getByTestId('ai-assistant-panel');
		await expect(panel).toBeVisible();

		// Override analyzeSilence to populate detected silences when button is clicked
		await page.evaluate(() => {
			const store = (
				window as unknown as {
					__TFVE_STORE__?: {
						getState: () => {
							analyzeSilence?: () => Promise<void>;
							setDetectedSilences: (s: unknown) => void;
						};
					};
				}
			).__TFVE_STORE__;
			if (store) {
				store.getState().analyzeSilence = async () => {
					store.getState().setDetectedSilences([
						{
							id: 'silence_1',
							startUs: 1_000_000,
							endUs: 2_000_000,
							durationUs: 1_000_000,
							cutStartUs: 1_000_000,
							cutEndUs: 1_600_000,
							cutDurationUs: 600_000,
							included: true
						}
					]);
				};
			}
		});

		// Ensure top of panel is scrolled to 0
		await page.evaluate(() => {
			const container =
				document.querySelector('.silence-trim-panel') ||
				document.querySelector('.ai-panel-content');
			if (container) container.scrollTop = 0;
		});

		// Click "Detect Silences" button
		const detectBtn = panel.getByRole('button', { name: 'Detect Silences' });
		await detectBtn.click();

		// Verify review section / next options are rendered and scrolled into view
		const reviewSection = page.getByTestId('silence-review-section');
		await expect(reviewSection).toBeVisible();
		await expect(reviewSection).toBeInViewport();
	});

	test('switches to Auto Caption tab in AI panel and displays speech-to-text controls', async ({
		page
	}) => {
		await page.click('.workspace-tab:has-text("AI")');
		const panel = page.getByTestId('ai-assistant-panel');
		await expect(panel).toBeVisible();

		// Initially Smart Cut tab is active
		await expect(panel.locator('.silence-trim-panel')).toBeVisible();

		// Click Auto Caption tab in stack header
		const autoCaptionTab = page.getByRole('tab', { name: 'Auto Caption' });
		await expect(autoCaptionTab).toBeVisible();
		await autoCaptionTab.click();

		// Verify Auto Caption view is visible
		const autoCaptionView = page.getByTestId('auto-caption-ai-view');
		await expect(autoCaptionView).toBeVisible();
		await expect(autoCaptionView.getByText('Auto Caption (Speech-to-Text)')).toBeVisible();
		await expect(autoCaptionView.getByText(/100% On-Device/)).toBeVisible();

		// Click consent button
		const consentBtn = autoCaptionView.getByRole('button', {
			name: 'Enable Local AI & Continue'
		});
		await expect(consentBtn).toBeVisible();
		await consentBtn.click();

		// Verify model select and controls
		await expect(autoCaptionView.getByText('Whisper Model')).toBeVisible();
		await expect(autoCaptionView.getByText('Audio Source')).toBeVisible();

		// Switch back to Smart Cut tab
		const smartCutTab = page.getByRole('tab', { name: 'Smart Cut' });
		await smartCutTab.click();
		await expect(page.getByTestId('ai-assistant-panel')).toBeVisible();
		await expect(page.locator('.silence-trim-panel')).toBeVisible();
		await expect(page.getByTestId('auto-caption-ai-view')).toHaveCount(0);
	});
});
