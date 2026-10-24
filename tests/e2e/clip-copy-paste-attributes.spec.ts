import { expect, test } from '@playwright/test';

type E2EStore = {
	getState: () => {
		addTextClip: () => void;
		setPlayhead: (time: number) => void;
		project?: {
			tracks: Array<{
				clips: Array<{
					start: number;
				}>;
			}>;
		};
	};
};

test('copies and pastes clips on timeline using shortcuts and context menu', async ({ page }) => {
	await page.goto('/editor');
	await page.getByRole('button', { name: 'New project' }).click();
	await page
		.getByRole('dialog', { name: 'Create a Project' })
		.getByRole('button', { name: 'Create project' })
		.click();
	await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();

	// Add an initial text clip at 0s
	await page.evaluate(() => {
		const store = (window as unknown as { __TFVE_STORE__?: E2EStore }).__TFVE_STORE__!;
		store.getState().addTextClip();
	});

	const clip = page.locator('.timeline-clip').first();
	await expect(clip).toBeVisible();

	// Select the clip
	await clip.click();

	// 1. Copy clip via Cmd+C / Ctrl+C
	const isMac = process.platform === 'darwin';
	await page.keyboard.press(isMac ? 'Meta+KeyC' : 'Control+KeyC');

	// Set playhead to end of timeline (5s)
	await page.evaluate(() => {
		const store = (window as unknown as { __TFVE_STORE__?: E2EStore }).__TFVE_STORE__!;
		store.getState().setPlayhead(5_000_000);
	});

	// 2. Paste clip via Cmd+V / Ctrl+V
	await page.keyboard.press(isMac ? 'Meta+KeyV' : 'Control+KeyV');

	// Verify two clips now exist across the timeline
	await expect
		.poll(async () => {
			return page.evaluate(() => {
				const store = (window as unknown as { __TFVE_STORE__?: E2EStore }).__TFVE_STORE__!;
				const clips = store.getState().project?.tracks.flatMap((t) => t.clips) ?? [];
				return clips.length;
			});
		})
		.toBe(2);

	// Verify the second clip starts at 5s right after the first
	const secondClipStart = await page.evaluate(() => {
		const store = (window as unknown as { __TFVE_STORE__?: E2EStore }).__TFVE_STORE__!;
		const clips = store.getState().project?.tracks.flatMap((t) => t.clips) ?? [];
		return clips[1]?.start;
	});
	expect(secondClipStart).toBe(5_000_000);
});

test('opens paste attributes dialog and applies attributes to target clip', async ({ page }) => {
	await page.goto('/editor');
	await page.getByRole('button', { name: 'New project' }).click();
	await page
		.getByRole('dialog', { name: 'Create a Project' })
		.getByRole('button', { name: 'Create project' })
		.click();
	await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();

	// Add two text clips: first at 0s, second at 3s
	await page.evaluate(() => {
		const store = (window as unknown as { __TFVE_STORE__?: E2EStore }).__TFVE_STORE__!;
		store.getState().setPlayhead(0);
		store.getState().addTextClip();
		store.getState().setPlayhead(3_000_000);
		store.getState().addTextClip();
	});

	const clips = page.locator('.timeline-clip');
	await expect(clips).toHaveCount(2);

	// Select the first clip
	await clips.first().click();

	// Copy first clip (Cmd+C / Ctrl+C)
	const isMac = process.platform === 'darwin';
	await page.keyboard.press(isMac ? 'Meta+KeyC' : 'Control+KeyC');

	// Select second clip
	await clips.nth(1).click();

	// Open Paste Attributes dialog via Cmd+Alt+V / Ctrl+Alt+V
	await page.keyboard.press(isMac ? 'Alt+Meta+KeyV' : 'Control+Alt+KeyV');

	const dialog = page.locator('dialog.paste-attributes-dialog');
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('heading', { name: 'Paste Attributes' })).toBeVisible();

	// Checkboxes for all 5 required attribute groups should be present
	await expect(dialog.getByText('Transform')).toBeVisible();
	await expect(dialog.getByText('Crop insets')).toBeVisible();
	await expect(dialog.getByText('Color Grading')).toBeVisible();
	await expect(dialog.getByText('Video Effects')).toBeVisible();
	await expect(dialog.getByText('Audio Volume, Pan, and Audio Effects')).toBeVisible();

	// Click "Paste" to confirm
	await dialog.getByRole('button', { name: 'Paste', exact: true }).click();
	await expect(dialog).not.toBeVisible();
});
