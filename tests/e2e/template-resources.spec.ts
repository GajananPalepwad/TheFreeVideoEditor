import { expect, test, type Page } from '@playwright/test';

async function openProject(page: Page): Promise<void> {
	await page.goto('/editor');
	// Importing these modules for the first time can make Vite re-optimise and reload the page, so
	// load them before a project exists.
	await page.evaluate(async () => {
		const path = (name: string) => `/src/editor/${name}`;
		await import(/* @vite-ignore */ path('core/templates/builtinTemplates.ts'));
		await import(/* @vite-ignore */ path('core/templates/templateResources.ts'));
		await import(/* @vite-ignore */ path('core/templates/templateService.ts'));
		await import(/* @vite-ignore */ path('services/templates/templateResources.ts'));
		await import(/* @vite-ignore */ path('services/render/text/fontLoader.ts'));
	});
	await page.waitForLoadState('load');
	await page.goto('/editor');
	const manager = page.locator('.project-manager-dialog');
	await manager.waitFor({ state: 'visible', timeout: 5000 });
	await manager.getByRole('button', { name: 'New project' }).click();
	const createDialog = page.getByRole('dialog', { name: 'Create a Project' });
	await createDialog.getByRole('textbox', { name: 'Project name' }).fill('Template resources');
	await createDialog.getByRole('button', { name: 'Create project' }).click();
	await expect(manager).not.toBeVisible();
	await page.waitForFunction(() => Boolean((window as any).__TFVE_STORE__?.getState().project));
}

test.describe('fonts and media inside a template file', () => {
	test('a custom font travels with the template and is installed on import', async ({ page }) => {
		await openProject(page);

		const result = await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			const fonts = (await import(
				/* @vite-ignore */ path('services/render/text/fontLoader.ts')
			)) as typeof import('../../src/editor/services/render/text/fontLoader');
			const service = (await import(
				/* @vite-ignore */ path('services/templates/templateResources.ts')
			)) as typeof import('../../src/editor/services/templates/templateResources');
			const templates = (await import(
				/* @vite-ignore */ path('core/templates/templateService.ts')
			)) as typeof import('../../src/editor/core/templates/templateService');
			const { getBuiltinMotionTemplate } = (await import(
				/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');

			// A font this machine only has because the user added it.
			const family = 'Resource Test Font';
			const bytes = await (await fetch('/fonts/BebasNeue-Regular.ttf')).arrayBuffer();
			await fonts.saveCustomFont({ family, fileName: 'ResourceTest.ttf', data: bytes });

			const template = structuredClone(getBuiltinMotionTemplate('minimal-editorial')!);
			for (const track of template.tracks) {
				for (const clip of track.clips) {
					if (clip.source?.type === 'text')
						clip.source.style = { ...clip.source.style, fontFamily: family };
				}
			}

			const project = (window as any).__TFVE_STORE__.getState().project;
			const bundled = await service.bundleTemplateResources(template, project);
			const file = templates.serializeTemplate(bundled);

			// The next machine: it does not have the font.
			await fonts.deleteCustomFont(family);
			for (const face of [...document.fonts]) {
				if (face.family.replace(/["']/g, '') === family) document.fonts.delete(face);
			}
			const hadFontBefore = service.isFontAvailable(family);

			const imported = await service.prepareImportedTemplate(
				templates.deserializeTemplate(file),
				async () => ({ imported: [], failed: [] })
			);

			return {
				embedded: bundled.resources?.fonts?.map((font) => font.family),
				embeddedBytes: bundled.resources?.fonts?.[0]
					? atob(bundled.resources.fonts[0].data).length
					: 0,
				fileBytes: bytes.byteLength,
				hadFontBefore,
				installed: imported.fonts,
				hasFontAfter: service.isFontAvailable(family),
				browserHasFont: document.fonts.check(`16px "${family}"`),
				keptResources: imported.template.resources,
				missing: imported.missing
			};
		});

		expect(result.embedded).toEqual(['Resource Test Font']);
		expect(result.embeddedBytes).toBe(result.fileBytes);
		expect(result.hadFontBefore).toBe(false);
		expect(result.installed).toEqual(['Resource Test Font']);
		expect(result.hasFontAfter).toBe(true);
		expect(result.browserHasFont).toBe(true);
		expect(result.keptResources).toBeUndefined();
		expect(result.missing).toEqual({ fonts: [], assets: [] });
	});

	test('a font that ships with the editor is not embedded', async ({ page }) => {
		await openProject(page);

		const embedded = await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			const service = (await import(
				/* @vite-ignore */ path('services/templates/templateResources.ts')
			)) as typeof import('../../src/editor/services/templates/templateResources');
			const { getBuiltinMotionTemplate } = (await import(
				/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');
			const project = (window as any).__TFVE_STORE__.getState().project;
			const bundled = await service.bundleTemplateResources(
				getBuiltinMotionTemplate('cinematic-blockbuster')!,
				project
			);
			return bundled.resources ?? null;
		});

		expect(embedded).toBeNull();
	});

	test('a template reports the font it needs when nothing carries it', async ({ page }) => {
		await openProject(page);

		const missing = await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			const service = (await import(
				/* @vite-ignore */ path('services/templates/templateResources.ts')
			)) as typeof import('../../src/editor/services/templates/templateResources');
			const resources = (await import(
				/* @vite-ignore */ path('core/templates/templateResources.ts')
			)) as typeof import('../../src/editor/core/templates/templateResources');
			const { getBuiltinMotionTemplate } = (await import(
				/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');
			const template = structuredClone(getBuiltinMotionTemplate('minimal-editorial')!);
			for (const track of template.tracks) {
				for (const clip of track.clips) {
					if (clip.source?.type === 'text') {
						clip.source.style = { ...clip.source.style, fontFamily: 'Nobody Has This' };
					}
				}
			}
			return resources.missingTemplateResources(template, service.isFontAvailable);
		});

		expect(missing.fonts).toEqual(['Nobody Has This']);
	});

	test('media travels with the template and is imported into the project', async ({ page }) => {
		await openProject(page);

		const result = await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			const service = (await import(
				/* @vite-ignore */ path('services/templates/templateResources.ts')
			)) as typeof import('../../src/editor/services/templates/templateResources');
			const templates = (await import(
				/* @vite-ignore */ path('core/templates/templateService.ts')
			)) as typeof import('../../src/editor/core/templates/templateService');
			const { getBuiltinMotionTemplate } = (await import(
				/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');
			const store = (window as any).__TFVE_STORE__;

			const canvas = new OffscreenCanvas(64, 48);
			const context = canvas.getContext('2d')!;
			context.fillStyle = '#e11';
			context.fillRect(0, 0, 64, 48);
			const blob = await canvas.convertToBlob({ type: 'image/png' });
			const picture = new File([blob], 'logo.png', { type: 'image/png' });
			const first = await store.getState().importMedia([picture]);
			const assetId = first.imported[0].id as string;

			const template = structuredClone(getBuiltinMotionTemplate('minimal-editorial')!);
			template.tracks[0]!.clips.push({
				...template.tracks[0]!.clips[0]!,
				id: 'tpl_logo' as any,
				start: 0,
				assetId: assetId as any,
				source: { type: 'asset' }
			});
			template.tracks[0]!.clips = [template.tracks[0]!.clips[0]!];
			template.tracks.push({
				...template.tracks[0]!,
				id: 'track_logo' as any,
				name: 'Logo',
				clips: [
					{
						...template.tracks[0]!.clips[0]!,
						id: 'tpl_logo' as any,
						assetId: assetId as any,
						source: { type: 'asset' }
					}
				]
			});

			const bundled = await service.bundleTemplateResources(template, store.getState().project);
			const file = templates.serializeTemplate(bundled);

			const imported = await service.prepareImportedTemplate(
				templates.deserializeTemplate(file),
				(files) => store.getState().importMedia(files)
			);
			const logoClip = imported.template.tracks
				.flatMap((track) => track.clips)
				.find((clip) => clip.id === ('tpl_logo' as any))!;
			const project = store.getState().project;
			return {
				embedded: bundled.resources?.assets?.map((asset) => asset.name),
				originalId: assetId,
				newId: logoClip.assetId as string,
				inProject: Boolean(project.assets[logoClip.assetId as string]),
				imported: imported.assets,
				kept: imported.template.resources,
				missing: imported.missing
			};
		});

		expect(result.embedded).toEqual(['logo.png']);
		expect(result.imported).toBe(1);
		expect(result.newId).not.toBe(result.originalId);
		expect(result.inProject).toBe(true);
		expect(result.kept).toBeUndefined();
		expect(result.missing.assets).toEqual([]);
	});

	test('importing a template file in the Graphics panel installs its font and says so', async ({
		page
	}) => {
		await openProject(page);
		const file = await page.evaluate(async () => {
			const path = (name: string) => `/src/editor/${name}`;
			const resources = (await import(
				/* @vite-ignore */ path('core/templates/templateResources.ts')
			)) as typeof import('../../src/editor/core/templates/templateResources');
			const templates = (await import(
				/* @vite-ignore */ path('core/templates/templateService.ts')
			)) as typeof import('../../src/editor/core/templates/templateService');
			const { getBuiltinMotionTemplate } = (await import(
				/* @vite-ignore */ path('core/templates/builtinTemplates.ts')
			)) as typeof import('../../src/editor/core/templates/builtinTemplates');
			const template = structuredClone(getBuiltinMotionTemplate('minimal-editorial')!);
			template.id = 'imported-with-font';
			template.name = 'Imported With Font';
			for (const track of template.tracks) {
				for (const clip of track.clips) {
					if (clip.source?.type === 'text') {
						clip.source.style = { ...clip.source.style, fontFamily: 'Panel Import Font' };
					}
				}
			}
			const bytes = new Uint8Array(
				await (await fetch('/fonts/BebasNeue-Regular.ttf')).arrayBuffer()
			);
			const bundled = resources.embedTemplateResources(template, {
				fonts: new Map([['Panel Import Font', { fileName: 'PanelImport.ttf', data: bytes }]]),
				assets: new Map()
			});
			return templates.serializeTemplate(bundled);
		});

		await page.locator('#graphics-panel-title').click();
		await page.getByTestId('tab-graphic-custom').click();
		await page.locator('.custom-templates-toolbar input[type="file"]').setInputFiles({
			name: 'imported.grafree',
			mimeType: 'application/json',
			buffer: Buffer.from(file)
		});

		await expect(page.getByTestId('stack-graphics').getByRole('status')).toContainText(
			'Installed font Panel Import Font'
		);
		expect(await page.evaluate(() => document.fonts.check('16px "Panel Import Font"'))).toBe(true);
		const saved = await page.evaluate(() =>
			(JSON.parse(localStorage.getItem('tfve_custom_motion_templates_v1') ?? '[]') as any[]).find(
				(template) => template.id === 'imported-with-font'
			)
		);
		expect(saved).toBeTruthy();
		// The font is installed, so the kept copy does not carry it again.
		expect(saved.resources).toBeUndefined();
	});
});
