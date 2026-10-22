import {
	base64ToBytes,
	embedTemplateResources,
	missingTemplateResources,
	remapTemplateAssetIds,
	stripTemplateResources,
	templateAssetIds,
	templateFontFamilies,
	type AvailableResources
} from '../../core/templates/templateResources';
import type { MotionGraphicTemplate } from '../../core/templates/templateTypes';
import type { Project } from '../../core/types';
import type { ImportBatchResult } from '../media/import';
import { getMediaFile } from '../storage/opfs';
import {
	BUNDLED_FONTS,
	SYSTEM_FALLBACK_FONTS,
	getCustomFonts,
	saveCustomFont
} from '../render/text/fontLoader';

const PROBE_TEXT = 'mmmmmmmmmmlli1WwQq';
const PROBE_BASES = ['monospace', 'serif', 'sans-serif'];

/** Whether the browser draws `family` differently from every generic fallback, so it must be installed. */
function drawsWithOwnFace(family: string): boolean {
	if (typeof document === 'undefined') return false;
	const context = document.createElement('canvas').getContext('2d');
	if (!context) return false;
	const width = (font: string) => {
		context.font = `64px ${font}`;
		return context.measureText(PROBE_TEXT).width;
	};
	return PROBE_BASES.some((base) => width(`"${family}", ${base}`) !== width(base));
}

/**
 * Whether a family can be drawn right now: shipped with the editor, a custom font, a system
 * fallback, or a face the browser actually has. `document.fonts.check` is not used for the last
 * one because it answers true for a family nothing has registered.
 */
export function isFontAvailable(family: string): boolean {
	const lower = family.trim().toLowerCase();
	return (
		SYSTEM_FALLBACK_FONTS.has(lower) ||
		BUNDLED_FONTS.some((font) => font.family.toLowerCase() === lower) ||
		getCustomFonts().some((font) => font.family.toLowerCase() === lower) ||
		drawsWithOwnFace(family.trim())
	);
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
	return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * A copy of the template that carries the custom fonts and project media it uses, so the file
 * renders the same on another machine. Fonts that ship with the editor are not embedded.
 */
export async function bundleTemplateResources(
	template: MotionGraphicTemplate,
	project: Project | null
): Promise<MotionGraphicTemplate> {
	const available: AvailableResources = { fonts: new Map(), assets: new Map() };

	const custom = new Map(getCustomFonts().map((font) => [font.family.toLowerCase(), font]));
	for (const family of templateFontFamilies(template)) {
		const font = custom.get(family.toLowerCase());
		if (font?.data) {
			available.fonts.set(family, { fileName: font.fileName, data: toBytes(font.data) });
		}
	}

	if (project) {
		for (const id of templateAssetIds(template)) {
			const asset = project.assets[id as keyof typeof project.assets];
			if (!asset) continue;
			try {
				const file = await getMediaFile(project.id, asset);
				available.assets.set(id, {
					name: asset.name,
					mimeType: asset.mimeType,
					data: new Uint8Array(await file.arrayBuffer())
				});
			} catch (error) {
				console.warn('Could not read media to embed in the template:', asset.name, error);
			}
		}
	}

	return embedTemplateResources(template, available);
}

/** Registers the fonts a template file carries, unless the family is already available. */
export async function registerTemplateFonts(template: MotionGraphicTemplate): Promise<string[]> {
	const registered: string[] = [];
	for (const font of template.resources?.fonts ?? []) {
		if (isFontAvailable(font.family)) continue;
		const bytes = base64ToBytes(font.data);
		await saveCustomFont({
			family: font.family,
			fileName: font.fileName,
			data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
		});
		registered.push(font.family);
	}
	return registered;
}

/** The embedded assets as files, keyed by the id the template's clips use. */
export function templateAssetFiles(template: MotionGraphicTemplate): Map<string, File> {
	const files = new Map<string, File>();
	for (const asset of template.resources?.assets ?? []) {
		const bytes = base64ToBytes(asset.data);
		files.set(
			asset.id,
			new File(
				[bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
				asset.name,
				{
					type: asset.mimeType
				}
			)
		);
	}
	return files;
}

export interface ImportedTemplate {
	/** The template to keep: its media is in the project and its fonts are installed. */
	template: MotionGraphicTemplate;
	fonts: string[];
	assets: number;
	/** What the template uses that this machine or project still does not have. */
	missing: { fonts: string[]; assets: string[] };
}

/**
 * Installs what an imported template file carries: its fonts become custom fonts and its media is
 * imported into the open project, with the template's clips pointed at the new assets. The embedded
 * data is then dropped, so the copy that is kept stays small.
 */
export async function prepareImportedTemplate(
	template: MotionGraphicTemplate,
	importMedia: (files: File[]) => Promise<ImportBatchResult | null>
): Promise<ImportedTemplate> {
	const fonts = await registerTemplateFonts(template);

	const files = templateAssetFiles(template);
	const idMap = new Map<string, string>();
	if (files.size > 0) {
		const entries = [...files];
		const result = await importMedia(entries.map(([, file]) => file));
		const unused = [...(result?.imported ?? [])];
		for (const [originalId, file] of entries) {
			const at = unused.findIndex((asset) => asset.name === file.name);
			if (at < 0) continue;
			idMap.set(originalId, unused[at]!.id);
			unused.splice(at, 1);
		}
	}

	const installed = new Set(idMap.values());
	const kept = stripTemplateResources(remapTemplateAssetIds(template, idMap));
	return {
		template: kept,
		fonts,
		assets: idMap.size,
		missing: missingTemplateResources(kept, isFontAvailable, (id) => installed.has(id))
	};
}
