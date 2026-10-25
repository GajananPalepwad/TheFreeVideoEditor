import { expect, test } from '@playwright/test';

test('toggles preview safe margins, rule of thirds, and social media guides overlay', async ({
	page
}) => {
	await page.goto('/editor');
	await page.getByRole('button', { name: 'New project' }).click();
	await page
		.getByRole('dialog', { name: 'Create a Project' })
		.getByRole('button', { name: 'Create project' })
		.click();
	await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();

	// Verify Guides toggle button in TransportBar
	const guidesButton = page.locator('[data-testid="toggle-guides-button"]');
	await expect(guidesButton).toBeVisible();
	await expect(guidesButton).not.toHaveClass(/is-active/);

	// Overlay should not be visible when all guides are off
	await expect(page.locator('[data-testid="preview-guides-overlay"]')).not.toBeVisible();

	// 1. Open the Guides dropdown menu
	await guidesButton.click();
	const menu = page.locator('.guides-dropdown-menu');
	await expect(menu).toBeVisible();

	// 2. Toggle Safe Margins (80% & 90%)
	const safeMarginsItem = page.locator('[data-testid="toggle-safe-margins-button"]');
	await expect(safeMarginsItem).toBeVisible();
	await safeMarginsItem.click();

	// Verify Guides button is now active and safe margins SVG overlay rendered
	await expect(guidesButton).toHaveClass(/is-active/);
	const overlay = page.locator('[data-testid="preview-guides-overlay"]');
	await expect(overlay).toBeVisible();
	const safeMarginsGroup = page.locator('[data-testid="guide-safe-margins"]');
	await expect(safeMarginsGroup).toBeVisible();
	await expect(safeMarginsGroup.getByText('90% ACTION SAFE')).toBeVisible();
	await expect(safeMarginsGroup.getByText('80% TITLE SAFE')).toBeVisible();

	// 3. Toggle Rule of Thirds
	const ruleOfThirdsItem = page.locator('[data-testid="toggle-rule-of-thirds-button"]');
	await expect(ruleOfThirdsItem).toBeVisible();
	await ruleOfThirdsItem.click();

	// Verify Rule of Thirds grid is rendered concurrently with Safe Margins
	const ruleOfThirdsGroup = page.locator('[data-testid="guide-rule-of-thirds"]');
	await expect(ruleOfThirdsGroup).toBeVisible();
	await expect(safeMarginsGroup).toBeVisible();

	// 4. Toggle TikTok / Reels Safe Zone
	const socialGuideItem = page.locator('[data-testid="toggle-social-guide-button"]');
	await expect(socialGuideItem).toBeVisible();
	await socialGuideItem.click();

	// Verify Social Media overlay is rendered with safe zone badge
	const socialGroup = page.locator('[data-testid="guide-social-media"]');
	await expect(socialGroup).toBeVisible();
	await expect(socialGroup.getByText('SAFE ZONE FOR CAPTIONS & TITLES')).toBeVisible();

	// 5. Click Clear All Guides action
	const clearAction = page.locator('[data-testid="toggle-all-guides-button"]');
	await expect(clearAction).toBeVisible();
	await expect(clearAction).toContainText('Clear All Guides');
	await clearAction.click();

	// Verify all overlays are removed and Guides button is no longer active
	await expect(guidesButton).not.toHaveClass(/is-active/);
	await expect(overlay).not.toBeVisible();

	// 6. Click Show Standard Guides when all are off
	await expect(clearAction).toContainText('Show Standard Guides');
	await clearAction.click();
	await expect(guidesButton).toHaveClass(/is-active/);
	await expect(safeMarginsGroup).toBeVisible();
	await expect(ruleOfThirdsGroup).toBeVisible();
	await expect(socialGroup).not.toBeVisible();

	// 7. Press Escape to close the menu
	await page.keyboard.press('Escape');
	await expect(menu).not.toBeVisible();
});
