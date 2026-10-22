import { expect, test, type Page } from '@playwright/test';

/** Every built-in template, each compared card-vs-monitor at three times along its length. */
const TEMPLATE_IDS = [
	'bouncy-spring-pop',
	'broadcast-news-header',
	'chapter-marker',
	'cinematic-blockbuster',
	'circle-crest-seal',
	'corporate-name-strap',
	'cyber-glitch-tech',
	'documentary-speaker-card',
	'highlight-callout',
	'kinetic-marquee-stack',
	'minimal-editorial',
	'mixkit-minimal-wipe-lower-third',
	'modern-bold-punch',
	'social-creator-pill',
	'split-slash-action',
	'subscribe-banner',
	'typewriter-terminal',
	'word-cascade'
];
const SAMPLE_FRACTIONS = [0.3, 0.5, 0.75];

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	// Importing these modules for the first time can make Vite re-optimise and reload the page, so
	// load them before a project exists.
	await page.evaluate(async () => {
		const path = (name: string) => `/src/editor/${name}`;
		await import(/* @vite-ignore */ path('services/render/templatePreview.ts'));
	});
	await page.waitForLoadState('load');
	await page.goto('/editor');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Template parity');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__));
}

interface Parity {
	litMonitor: number;
	litCard: number;
	meanDiff: number;
	badFraction: number;
}

/**
 * Puts a template on the timeline, reads the Program monitor, then paints the same template through
 * the card renderer and compares the two over the template bounds.
 */
async function compare(page: Page, id: string): Promise<Parity[]> {
	return page.evaluate(
		async ({ templateId, fractions }) => {
			const path = (name: string) => `/src/editor/${name}`;
			const { getBuiltinMotionTemplate } = (await import(
				/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');
			const preview = (await import(
				/* @vite-ignore */ path('core/templates/templatePreview.ts')
			)) as typeof import('../../src/editor/core/templates/templatePreview');
			const service = (await import(
				/* @vite-ignore */ path('services/render/templatePreview.ts')
			)) as typeof import('../../src/editor/services/render/templatePreview');

			const template = getBuiltinMotionTemplate(templateId)!;
			const state = (window as any).__TFVE_STORE__.getState();
			state.instantiateTemplate(template);
			void preview;

			const measure = async (time: number): Promise<Parity> => {
				state.setPlayhead(time);

				// The canvas is replaced when the project switches renderer, so look it up on every read.
				const monitorCanvas = () =>
					document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]')!;
				const monitor = monitorCanvas();
				const read = (source: CanvasImageSource, width: number, height: number) => {
					const copy = document.createElement('canvas');
					copy.width = width;
					copy.height = height;
					const context = copy.getContext('2d', { willReadFrequently: true })!;
					return { context, copy };
				};
				const lit = (data: Uint8ClampedArray) => {
					let count = 0;
					for (let index = 0; index < data.length; index += 4) {
						if (data[index]! + data[index + 1]! + data[index + 2]! > 30) count += 1;
					}
					return count;
				};

				// Wait for the monitor to settle on the template frame.
				let monitorPixels: Uint8ClampedArray | null = null;
				const bounds = template.bounds ?? {
					width: monitor.width,
					height: monitor.height,
					originX: 0,
					originY: 0
				};
				const bw = Math.round(bounds.width);
				const bh = Math.round(bounds.height);
				const sx = Math.round(monitor.width / 2 + bounds.originX - bw / 2);
				const sy = Math.round(monitor.height / 2 + bounds.originY - bh / 2);
				for (let attempt = 0; attempt < 60; attempt += 1) {
					await new Promise((resolve) => setTimeout(resolve, 100));
					const live = monitorCanvas();
					const { context, copy } = read(live, live.width, live.height);
					context.drawImage(live, 0, 0);
					const data = context.getImageData(sx, sy, bw, bh).data;
					if (lit(data) > 200) {
						monitorPixels = data;
						void copy;
						break;
					}
				}
				if (!monitorPixels) return { litMonitor: 0, litCard: 0, meanDiff: 255, badFraction: 1 };

				// Card path: padded target, then crop the centred bounds-sized region.
				const pad = 0.06;
				const tw = Math.round(bw / (1 - pad * 2));
				const th = Math.round(bh / (1 - pad * 2));
				const target = document.createElement('canvas');
				target.width = tw;
				target.height = th;
				const ok = await service
					.getTemplatePreviewRenderer()
					.draw(template, time, { context: target.getContext('2d')!, width: tw, height: th });
				if (!ok)
					return { litMonitor: lit(monitorPixels), litCard: 0, meanDiff: 255, badFraction: 1 };
				const { context: cardContext } = read(target, tw, th);
				cardContext.drawImage(target, 0, 0);
				const cardPixels = cardContext.getImageData(
					Math.round((tw - bw) / 2),
					Math.round((th - bh) / 2),
					bw,
					bh
				).data;

				let total = 0;
				let bad = 0;
				for (let index = 0; index < cardPixels.length; index += 4) {
					let diff = 0;
					for (let channel = 0; channel < 3; channel += 1) {
						diff = Math.max(
							diff,
							Math.abs(cardPixels[index + channel]! - monitorPixels[index + channel]!)
						);
					}
					total += diff;
					if (diff > 48) bad += 1;
				}
				const pixels = cardPixels.length / 4;
				return {
					litMonitor: lit(monitorPixels),
					litCard: lit(cardPixels),
					meanDiff: total / pixels,
					badFraction: bad / pixels
				};
			};

			const results: Parity[] = [];
			for (const fraction of fractions) {
				results.push(await measure(Math.round(template.duration * fraction)));
			}
			return results;
		},
		{ templateId: id, fractions: SAMPLE_FRACTIONS }
	);
}

test.describe('Template card preview matches the Program monitor', () => {
	for (const id of TEMPLATE_IDS) {
		test(`${id} card pixels match the monitor`, async ({ page }) => {
			await openProject(page);
			const results = await compare(page, id);
			console.log(id, JSON.stringify(results));
			for (const [index, result] of results.entries()) {
				const at = `${id} @${SAMPLE_FRACTIONS[index]}`;
				expect(result.litMonitor, at).toBeGreaterThan(200);
				expect(result.litCard, at).toBeGreaterThan(200);
				expect(result.meanDiff, at).toBeLessThan(3);
				expect(result.badFraction, at).toBeLessThan(0.03);
			}
		});
	}
});

test.describe('Graphics panel cards', () => {
	/** Lit and distinct-colour counts of a card's preview canvas. */
	async function cardPixels(page: Page, id: string): Promise<string> {
		return page.evaluate((templateId) => {
			const canvas = document.querySelector<HTMLCanvasElement>(
				`[data-testid="graphic-card-canvas-${templateId}"]`
			)!;
			const context = canvas.getContext('2d', { willReadFrequently: true })!;
			const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
			let lit = 0;
			let hash = 0;
			for (let index = 0; index < data.length; index += 4) {
				if (data[index + 3]! > 8) lit += 1;
				hash = (hash * 31 + data[index]! + data[index + 1]! * 3 + data[index + 3]! * 7) | 0;
			}
			return `${lit}:${hash}`;
		}, id);
	}

	test('every card paints a real frame and hover plays it', async ({ page }) => {
		await openProject(page);
		await page.locator('#graphics-panel-title').click();
		const templatesTab = page.getByTestId('tab-graphic-templates');
		if (await templatesTab.isVisible()) await templatesTab.click();

		const id = 'cinematic-blockbuster';
		const card = page.getByTestId(`graphic-card-${id}`);
		await expect(card).toBeVisible();
		await expect
			.poll(async () => Number((await cardPixels(page, id)).split(':')[0]), { timeout: 8000 })
			.toBeGreaterThan(500);

		const still = await cardPixels(page, id);
		await card.hover();
		await expect.poll(() => cardPixels(page, id), { timeout: 8000 }).not.toBe(still);
		await page.mouse.move(0, 0);
		await expect.poll(() => cardPixels(page, id), { timeout: 8000 }).toBe(still);
	});
});

test.describe('Templates tab source', () => {
	test('lists the built-in library, in library order', async ({ page }) => {
		await openProject(page);
		await page.locator('#graphics-panel-title').click();
		const templatesTab = page.getByTestId('tab-graphic-templates');
		if (await templatesTab.isVisible()) await templatesTab.click();
		await expect(
			page.locator('[data-testid^="graphic-card-"]:not([data-testid*="canvas"])').first()
		).toBeVisible();

		const shown = await page
			.locator('[data-testid^="graphic-card-"]:not([data-testid*="canvas"])')
			.evaluateAll((nodes) =>
				nodes.map((node) => node.getAttribute('data-testid')!.replace('graphic-card-', ''))
			);
		const library = await page.evaluate(async () => {
			const path = '/src/editor/core/templates/builtinTemplates.ts';
			const { BUILTIN_MOTION_TEMPLATES } = (await import(
				/* @vite-ignore */ path
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');
			return BUILTIN_MOTION_TEMPLATES.map((template) => template.id);
		});
		expect(shown).toEqual(library);
	});
});
