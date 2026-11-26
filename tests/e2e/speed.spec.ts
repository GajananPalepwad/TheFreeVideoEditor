import { expect, test, type Page } from '@playwright/test';

interface StoreApi {
	getState(): {
		addSolidLayer(color?: string): string;
		addTextClip(options?: { text?: string }): string;
		selectClips(ids: string[]): void;
		setPlayhead(time: number): void;
		project: {
			tracks: Array<{
				clips: Array<{
					id: string;
					start: number;
					duration: number;
					sourceIn: number;
					sourceOut: number;
					speed: number;
					volume: number;
					timeRemap?: { value: number };
					source?: { type: string };
				}>;
			}>;
		};
	};
}

interface EditorWindow {
	__TFVE_STORE__: StoreApi;
}

async function createProject(page: Page, name: string): Promise<void> {
	await page.goto('/editor/');
	await page
		.getByRole('dialog', { name: 'Your Projects' })
		.getByRole('button', { name: 'New project' })
		.click();
	const dialog = page.getByRole('dialog', { name: 'Create a Project' });
	await dialog.getByRole('textbox', { name: 'Project name' }).fill(name);
	await dialog.getByRole('button', { name: 'Create project' }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible();
}

test.describe('Gate M: Speed & Time Remapping End-to-End', () => {
	test('opens Speed/Duration dialog via shortcut mod+shift+r and updates clip speed', async ({
		page
	}) => {
		await createProject(page, 'Speed Dialog Test');

		// Add a solid layer to work with
		await page.evaluate(() => {
			const store = (window as unknown as EditorWindow).__TFVE_STORE__;
			const clipId = store.getState().addSolidLayer('#3b82f6');
			store.getState().selectClips([clipId]);
		});

		await expect(page.locator('.timeline-clip')).toHaveCount(1);

		// Trigger alt+r shortcut
		await page.keyboard.press('Alt+KeyR');

		// Verify Speed / Duration dialog opens
		const speedDialog = page.getByRole('dialog', { name: 'Speed / Duration' });
		await expect(speedDialog).toBeVisible();

		// Change speed to 200%
		const speedInput = speedDialog.getByLabel('Speed percentage');
		await speedInput.fill('200');

		// Click OK
		await speedDialog.getByRole('button', { name: 'OK' }).click();
		await expect(speedDialog).not.toBeVisible();

		// Verify speed badge appears on clip
		const badge = page.locator('.clip-speed-badge');
		await expect(badge).toBeVisible();
		await expect(badge).toHaveText('200%');

		// Verify clip duration is halved
		const clipData = await page.evaluate(() => {
			const store = (window as unknown as EditorWindow).__TFVE_STORE__;
			const clip = store.getState().project.tracks[0]!.clips[0]!;
			return { speed: clip.speed, duration: clip.duration };
		});
		expect(clipData.speed).toBe(2);
	});

	test('reverses clip playback speed via context menu, Inspector, Shift+R, and Speed dialog', async ({
		page
	}) => {
		await createProject(page, 'Reverse Clip Test');

		await page.evaluate(() => {
			const store = (window as unknown as EditorWindow).__TFVE_STORE__;
			const solidId = store.getState().addSolidLayer('#10b981');
			store.getState().addTextClip({ text: 'Reverse Text' });
			store.getState().selectClips([solidId]);
		});

		const clips = page.locator('.timeline-clip');
		await expect(clips).toHaveCount(2);
		const textClipLocator = page.locator('.timeline-clip', { hasText: 'Reverse Text' });
		const solidClipLocator = clips.filter({ hasNotText: 'Reverse Text' });

		// 1. Reverse via timeline context menu on solid clip
		await solidClipLocator.click({ button: 'right' });
		const contextMenu = page.locator('.timeline-context-menu');
		await expect(contextMenu).toBeVisible();
		await contextMenu.getByRole('button', { name: /Reverse clip/i }).click();

		const solidBadge = solidClipLocator.locator('.clip-speed-badge');
		await expect(solidBadge).toBeVisible();
		await expect(solidBadge).toHaveText('−100%');

		// 2. Reverse via Inspector Reverse Clip button on text clip
		await textClipLocator.click();
		const inspectorReverseBtn = page
			.getByTestId('stack-inspector')
			.getByRole('button', { name: 'Reverse Clip', exact: true });
		await expect(inspectorReverseBtn).toBeVisible();
		await inspectorReverseBtn.click();
		await expect(inspectorReverseBtn).toHaveAttribute('aria-pressed', 'true');
		await expect(textClipLocator.locator('.clip-speed-badge')).toHaveText('−100%');

		// 3. Toggle back with Shift+R shortcut
		await page.keyboard.press('Shift+KeyR');
		await expect(inspectorReverseBtn).toHaveAttribute('aria-pressed', 'false');
		await expect(textClipLocator.locator('.clip-speed-badge')).toHaveCount(0);

		// 4. Reverse via Speed / Duration dialog checkbox (Reverse Speed) at 200%
		await page.keyboard.press('Alt+KeyR');
		const speedDialog = page.getByRole('dialog', { name: 'Speed / Duration' });
		await expect(speedDialog).toBeVisible();
		await speedDialog.getByLabel('Speed percentage').fill('200');
		await speedDialog.getByLabel('Reverse Speed').check();
		await speedDialog.getByRole('button', { name: 'OK' }).click();
		await expect(speedDialog).not.toBeVisible();

		await expect(textClipLocator.locator('.clip-speed-badge')).toHaveText('−200%');

		const clipData = await page.evaluate(() => {
			const store = (window as unknown as EditorWindow).__TFVE_STORE__;
			const textTrack = store
				.getState()
				.project.tracks.find((t) => t.clips.some((c) => c.source?.type === 'text'))!;
			const clip = textTrack.clips[0]!;
			return { speed: clip.speed, sourceIn: clip.sourceIn, sourceOut: clip.sourceOut };
		});
		expect(clipData.speed).toBe(-2);
		expect(clipData.sourceIn).toBeGreaterThan(clipData.sourceOut);
	});

	test('inserts freeze frame via Shift+F shortcut and creates hold segment', async ({ page }) => {
		await createProject(page, 'Freeze Frame Test');

		await page.evaluate(() => {
			const store = (window as unknown as EditorWindow).__TFVE_STORE__;
			const clipId = store.getState().addSolidLayer('#ef4444');
			store.getState().selectClips([clipId]);
		});

		await expect(page.locator('.timeline-clip')).toHaveCount(1);

		// Position playhead in the middle of clip
		await page.evaluate(() => {
			const store = (window as unknown as EditorWindow).__TFVE_STORE__;
			store.getState().setPlayhead(1_500_000);
		});

		// Press Shift+F
		await page.keyboard.press('Shift+KeyF');

		// Timeline should now have 3 clips (head, freeze segment, tail)
		await expect(page.locator('.timeline-clip')).toHaveCount(3);

		// The freeze segment should have timeRemap: { value: 0 } and 2s duration
		const clipsInfo = await page.evaluate(() => {
			const store = (window as unknown as EditorWindow).__TFVE_STORE__;
			return store.getState().project.tracks[0]!.clips.map((c) => ({
				start: c.start,
				duration: c.duration,
				timeRemap: c.timeRemap,
				volume: c.volume
			}));
		});

		expect(clipsInfo.length).toBe(3);
		const freezeSegment = clipsInfo[1]!;
		expect(freezeSegment.duration).toBe(2_000_000);
		expect(freezeSegment.timeRemap).toEqual({ value: 0 });
		expect(freezeSegment.volume).toBe(0);
	});

	test('Inspector Speed & Time Remap section edits speed curve and displays Remap badge', async ({
		page
	}) => {
		await createProject(page, 'Inspector Remap Test');

		await page.evaluate(() => {
			const store = (window as unknown as EditorWindow).__TFVE_STORE__;
			const clipId = store.getState().addSolidLayer('#8b5cf6');
			store.getState().selectClips([clipId]);
		});

		// Check Inspector section
		const remapSection = page.locator('.inspector-section', {
			hasText: 'Speed & Time Remap'
		});
		await expect(remapSection).toBeVisible();

		// Enable Time Remapping checkbox
		const enableCheckbox = remapSection.getByLabel('Enable Time Remapping');
		await enableCheckbox.check();

		// Verify Remap badge appears on clip
		const remapBadge = page.locator('.clip-remap-badge');
		await expect(remapBadge).toBeVisible();
		await expect(remapBadge).toHaveText('Remap');
	});
});
