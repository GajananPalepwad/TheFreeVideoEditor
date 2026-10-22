// Regenerates public/templates/*.tfvetemplate from the legacy graphic-template converter.
//
// The shipped files are the source of truth at runtime; this script is the authoring path for the
// templates that are still defined in src/editor/core/text/graphicsTemplates.ts. Run it with
// `npm run templates:generate` after changing the converter, then commit the result.
//
// A template's bounds come from measuring its text, which needs a canvas and the bundled fonts, so
// the converter runs inside headless Chromium (the same engine the editor's end-to-end tests use).
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'public', 'templates');

const bundled = await build({
	stdin: {
		contents: `
			export { convertAllGraphicTemplates } from './src/editor/core/templates/templateConverter';
			export { serializeTemplate } from './src/editor/core/templates/templateService';
			export { BUNDLED_FONTS } from './src/editor/services/render/text/fontLoader';
		`,
		resolveDir: root,
		loader: 'ts'
	},
	bundle: true,
	write: false,
	platform: 'browser',
	format: 'iife',
	globalName: 'TFVE',
	logLevel: 'error'
});

// Fonts are read here and handed to the page, which has no server to load them from.
const fontFiles = [
	'Inter-VariableFont_opsz,wght.ttf',
	'Montserrat-VariableFont_wght.ttf',
	'PlayfairDisplay-VariableFont_wght.ttf',
	'RobotoMono-VariableFont_wght.ttf',
	'Caveat-VariableFont_wght.ttf',
	'BebasNeue-Regular.ttf'
].map((file) => readFileSync(join(root, 'public', 'fonts', file)).toString('base64'));

// Keep the original creation time so regenerating does not churn every file.
const createdAt = {};
if (existsSync(outDir)) {
	for (const name of (await import('node:fs')).readdirSync(outDir)) {
		if (!name.endsWith('.tfvetemplate')) continue;
		try {
			const parsed = JSON.parse(readFileSync(join(outDir, name), 'utf8'));
			if (parsed.createdAt) createdAt[parsed.id] = parsed.createdAt;
		} catch {
			// An unreadable file is simply overwritten.
		}
	}
}

const browser = await chromium.launch();
try {
	const page = await browser.newPage();
	await page.addScriptTag({ content: bundled.outputFiles[0].text });
	const files = await page.evaluate(
		async ({ fonts, created }) => {
			const { convertAllGraphicTemplates, serializeTemplate, BUNDLED_FONTS } = window.TFVE;
			for (const [index, font] of BUNDLED_FONTS.entries()) {
				const bytes = Uint8Array.from(atob(fonts[index]), (c) => c.charCodeAt(0));
				const face = new FontFace(font.family, bytes.buffer, { weight: '100 900' });
				document.fonts.add(await face.load());
			}
			return convertAllGraphicTemplates().map((template) => {
				if (created[template.id]) template.createdAt = created[template.id];
				return { id: template.id, json: serializeTemplate(template) };
			});
		},
		{ fonts: fontFiles, created: createdAt }
	);

	mkdirSync(outDir, { recursive: true });
	let written = 0;
	for (const { id, json } of files) {
		const file = join(outDir, `${id}.tfvetemplate`);
		if (!existsSync(file) || readFileSync(file, 'utf8') !== json) {
			writeFileSync(file, json, 'utf8');
			written += 1;
			console.log(`wrote ${id}.tfvetemplate`);
		}
	}
	console.log(written === 0 ? 'Templates are up to date.' : `Updated ${written} template file(s).`);
} finally {
	await browser.close();
}
