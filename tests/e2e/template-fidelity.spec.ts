import { expect, test, type Page } from '@playwright/test';

/**
 * Dragging a template card onto the timeline and pressing "+ Add" are two routes to the same
 * instance. Both are driven through the real UI here, for every built-in template.
 */

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	await page.evaluate(async () => {
		const path = (name: string) => `/src/editor/${name}`;
		await import(/* @vite-ignore */ path('core/templates/builtinTemplates.ts'));
	});
	await page.waitForLoadState('load');
	await page.goto('/editor');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Template fidelity');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));
}

/** Both instances, with generated ids replaced by their order of appearance. */
async function instances(page: Page): Promise<{ sequences: unknown[]; clips: unknown[] }> {
	return page.evaluate(() => {
		const project = (window as any).__TFVE_STORE__.getState().project;
		const idKeys = new Set(['id', 'sequenceId', 'trackId', 'clipId', 'targetClipId']);
		// Numbers ids in order of appearance, starting again for each value it is given.
		const normalise = (value: any): any => {
			const seen = new Map<string, string>();
			const walk = (node: any, key?: string): any => {
				if (typeof node === 'string' && key && idKeys.has(key)) {
					if (!seen.has(node)) seen.set(node, `#${seen.size}`);
					return seen.get(node);
				}
				if (Array.isArray(node)) return node.map((item) => walk(item));
				if (node && typeof node === 'object') {
					return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
				}
				return node;
			};
			return walk(value);
		};
		const clips = project.tracks.flatMap((track: any) =>
			track.clips.map((clip: any) => ({ ...clip, start: 0 }))
		);
		// Each instance gets its own sequence, so compare them one after the other.
		return {
			sequences: Object.values(project.sequences ?? {}).map((sequence) => normalise(sequence)),
			clips: clips.map((clip: any) => normalise(clip))
		};
	});
}

test.describe('Dragging a template card equals "+ Add"', () => {
	test.beforeEach(async ({ page }) => {
		await openProject(page);
		await page.locator('#graphics-panel-title').click();
	});

	const ids = [
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

	for (const id of ids) {
		test(`${id}: both routes build the same instance and never overlap`, async ({ page }) => {
			const card = page.getByTestId(`graphic-card-${id}`);
			await expect(card).toBeVisible();
			const lane = page.locator('.timeline-track-row.track-video .timeline-track-lane').first();

			await card.dragTo(lane, { targetPosition: { x: 120, y: 20 } });
			const clips = page.locator('.timeline-clip:not(.is-ghost)');
			await expect(clips).toHaveCount(1);

			await card.hover();
			await card.getByRole('button', { name: '+ Add' }).click();
			await expect(clips).toHaveCount(2);

			const { sequences, clips: placed } = await instances(page);
			expect(sequences).toHaveLength(2);
			expect(sequences[1]).toEqual(sequences[0]);
			const [first, second] = placed as Array<Record<string, any>>;
			expect(second!.duration).toBe(first!.duration);
			expect(second!.source.templateId).toBe(first!.source.templateId);
			expect(first!.source.templateId).toBe(id);

			const overlapping = await page.evaluate(() => {
				const project = (window as any).__TFVE_STORE__.getState().project;
				return project.tracks.some((track: any) => {
					const sorted = [...track.clips].sort((a: any, b: any) => a.start - b.start);
					return sorted.some(
						(clip: any, index: number) =>
							index > 0 && clip.start < sorted[index - 1].start + sorted[index - 1].duration
					);
				});
			});
			expect(overlapping).toBe(false);
		});
	}
});
