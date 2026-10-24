import { expect, test } from '@playwright/test';

declare global {
	interface Window {
		__TFVE_STORE__?: {
			getState: () => {
				addTimelineTrack: (kind: 'video' | 'audio') => void;
				setZoom: (zoom: number) => void;
				addTextClip: () => void;
				setPlayhead: (time: number) => void;
				clearSelection: () => void;
				timeline: {
					selection: {
						clipIds: string[];
					};
				};
			};
		};
	}
}

test('timeline auto-scrolls horizontally and vertically during marquee selection', async ({
	page
}) => {
	await page.goto('/editor');
	await page.getByRole('button', { name: 'New project' }).click();
	await page
		.getByRole('dialog', { name: 'Create a Project' })
		.getByRole('button', { name: 'Create project' })
		.click();
	await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();

	const scroller = page.locator('.timeline-scroll');
	await expect(scroller).toBeVisible();

	// Add extra tracks and zoom in slightly so both horizontal and vertical scrolling are active
	await page.evaluate(() => {
		const store = window.__TFVE_STORE__!;
		store.getState().addTimelineTrack('video');
		store.getState().addTimelineTrack('video');
		store.getState().addTimelineTrack('audio');
		store.getState().addTimelineTrack('audio');
		store.getState().setZoom(200);
	});

	const scrollerBox = await scroller.boundingBox();
	expect(scrollerBox).not.toBeNull();

	const initialScroll = await scroller.evaluate((el) => ({
		scrollLeft: el.scrollLeft,
		scrollTop: el.scrollTop,
		scrollWidth: el.scrollWidth,
		scrollHeight: el.scrollHeight,
		clientWidth: el.clientWidth,
		clientHeight: el.clientHeight
	}));
	expect(initialScroll.scrollLeft).toBe(0);

	// Start marquee drag in the track lane area (to the right of track headers)
	const startX = scrollerBox!.x + 350;
	const startY = scrollerBox!.y + 100;

	await page.mouse.move(startX, startY);
	await page.mouse.down();

	// 1. Drag past the right edge of the timeline scroller -> auto-scrolls right
	await page.mouse.move(scrollerBox!.x + scrollerBox!.width + 40, startY, { steps: 5 });

	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollLeft), { timeout: 4000 })
		.toBeGreaterThan(30);

	// 2. Drag to the left into the header area -> auto-scrolls left back towards 0
	await page.mouse.move(scrollerBox!.x + 50, startY, { steps: 5 });

	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollLeft), { timeout: 4000 })
		.toBeLessThan(20);

	// 3. Drag past the bottom edge -> auto-scrolls down
	await page.mouse.move(startX, scrollerBox!.y + scrollerBox!.height + 40, { steps: 5 });

	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollTop), { timeout: 4000 })
		.toBeGreaterThan(15);

	// 4. Drag back towards the top (near ruler) -> auto-scrolls up back towards 0
	await page.mouse.move(startX, scrollerBox!.y + 20, { steps: 5 });

	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollTop), { timeout: 4000 })
		.toBeLessThan(15);

	await page.mouse.up();
});

test('timeline auto-scrolls horizontally and vertically during clip drag', async ({ page }) => {
	await page.goto('/editor');
	await page.getByRole('button', { name: 'New project' }).click();
	await page
		.getByRole('dialog', { name: 'Create a Project' })
		.getByRole('button', { name: 'Create project' })
		.click();
	await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();

	const scroller = page.locator('.timeline-scroll');
	await expect(scroller).toBeVisible();

	await page.evaluate(() => {
		const store = window.__TFVE_STORE__!;
		store.getState().addTimelineTrack('video');
		store.getState().addTimelineTrack('video');
		store.getState().addTimelineTrack('audio');
		store.getState().addTimelineTrack('audio');
		store.getState().setZoom(200);
		store.getState().addTextClip();
	});

	const clip = page.locator('.timeline-clip').first();
	await expect(clip).toBeVisible();

	const clipBox = await clip.boundingBox();
	expect(clipBox).not.toBeNull();

	const scrollerBox = await scroller.boundingBox();
	expect(scrollerBox).not.toBeNull();

	// Grab clip and drag to the right past scroller edge
	await page.mouse.move(clipBox!.x + 20, clipBox!.y + 15);
	await page.mouse.down();
	await page.mouse.move(scrollerBox!.x + scrollerBox!.width + 40, clipBox!.y + 15, { steps: 5 });

	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollLeft), { timeout: 4000 })
		.toBeGreaterThan(30);

	// Drag towards left edge into header
	await page.mouse.move(scrollerBox!.x + 50, clipBox!.y + 15, { steps: 5 });

	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollLeft), { timeout: 4000 })
		.toBeLessThan(20);

	// Drag past bottom edge
	await page.mouse.move(clipBox!.x + 20, scrollerBox!.y + scrollerBox!.height + 40, { steps: 5 });

	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollTop), { timeout: 4000 })
		.toBeGreaterThan(15);

	await page.mouse.up();
});

test('marquee selection accurately selects clips that scroll into view during auto-scroll', async ({
	page
}) => {
	await page.goto('/editor');
	await page.getByRole('button', { name: 'New project' }).click();
	await page
		.getByRole('dialog', { name: 'Create a Project' })
		.getByRole('button', { name: 'Create project' })
		.click();
	await expect(page.getByRole('heading', { name: 'Untitled Project' })).toBeVisible();

	const scroller = page.locator('.timeline-scroll');
	await expect(scroller).toBeVisible();

	await page.evaluate(() => {
		const store = window.__TFVE_STORE__!;
		store.getState().setZoom(100);
		store.getState().addTextClip();
		store.getState().setPlayhead(3_000_000);
		store.getState().addTextClip();
		store.getState().setPlayhead(0);
		store.getState().clearSelection();
	});

	const scrollerBox = await scroller.boundingBox();
	expect(scrollerBox).not.toBeNull();

	const startX = scrollerBox!.x + 220;
	const startY = scrollerBox!.y + 60;

	await page.mouse.move(startX, startY);
	await page.mouse.down();

	await page.mouse.move(scrollerBox!.x + scrollerBox!.width + 40, startY + 80, { steps: 5 });

	await expect
		.poll(async () => scroller.evaluate((el) => el.scrollLeft), { timeout: 4000 })
		.toBeGreaterThan(200);

	await page.mouse.up();

	const selectedCount = await page.evaluate(() => {
		const store = window.__TFVE_STORE__!;
		return store.getState().timeline.selection.clipIds.length;
	});
	expect(selectedCount).toBe(2);
});
