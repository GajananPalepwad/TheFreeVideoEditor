import type { AnimatedValue, Clip, Track } from '../types';
import type { MotionGraphicTemplate, TemplateResources } from './templateTypes';

/** The most a template file may embed, as raw bytes before base64. */
export const MAX_TEMPLATE_RESOURCE_BYTES = 8 * 1024 * 1024;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
	let out = '';
	for (let index = 0; index < bytes.length; index += 3) {
		const a = bytes[index]!;
		const b = bytes[index + 1];
		const c = bytes[index + 2];
		const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
		out += BASE64[(triple >> 18) & 63]! + BASE64[(triple >> 12) & 63]!;
		out += b === undefined ? '=' : BASE64[(triple >> 6) & 63]!;
		out += c === undefined ? '=' : BASE64[triple & 63]!;
	}
	return out;
}

export function base64ToBytes(text: string): Uint8Array {
	const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
	const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let write = 0;
	for (let index = 0; index < clean.length; index += 4) {
		const chunk = clean.slice(index, index + 4);
		let value = 0;
		for (const char of chunk) value = (value << 6) | BASE64.indexOf(char);
		value <<= 6 * (4 - chunk.length);
		bytes[write++] = (value >> 16) & 255;
		if (chunk.length > 2) bytes[write++] = (value >> 8) & 255;
		if (chunk.length > 3) bytes[write++] = value & 255;
	}
	return bytes.slice(0, write);
}

function allClips(template: MotionGraphicTemplate): Clip[] {
	return template.tracks.flatMap((track) => track.clips);
}

/** Every string a property holds over time, for a property that is not animated by number. */
function propertyStrings(value: AnimatedValue<unknown> | undefined): string[] {
	if (!value) return [];
	if ('keyframes' in value) {
		return value.keyframes
			.map((key) => key.value)
			.filter((v): v is string => typeof v === 'string');
	}
	return typeof value.value === 'string' ? [value.value] : [];
}

/** The font families the template's text draws with, sorted and without repeats. */
export function templateFontFamilies(template: MotionGraphicTemplate): string[] {
	const families = new Set<string>();
	for (const clip of allClips(template)) {
		if (clip.source?.type !== 'text') continue;
		const own = clip.source.style?.fontFamily;
		if (own) families.add(own);
		for (const family of propertyStrings(clip.properties?.['text.fontFamily']))
			families.add(family);
	}
	for (const param of template.publishedParams) {
		if (param.type === 'font' && typeof param.defaultValue === 'string' && param.defaultValue) {
			families.add(param.defaultValue);
		}
	}
	return [...families].sort();
}

/** The ids of the media assets the template's clips use, sorted and without repeats. */
export function templateAssetIds(template: MotionGraphicTemplate): string[] {
	const ids = new Set<string>();
	for (const clip of allClips(template)) {
		if (clip.assetId) ids.add(clip.assetId);
	}
	return [...ids].sort();
}

export interface AvailableResources {
	fonts: Map<string, { fileName: string; data: Uint8Array }>;
	assets: Map<string, { name: string; mimeType: string; data: Uint8Array }>;
}

/**
 * A copy of the template that carries the fonts and assets it uses, taken from `available`.
 * Resources it does not use are left out, and nothing is added when nothing is available.
 */
export function embedTemplateResources(
	template: MotionGraphicTemplate,
	available: AvailableResources
): MotionGraphicTemplate {
	const fonts: NonNullable<TemplateResources['fonts']> = [];
	const assets: NonNullable<TemplateResources['assets']> = [];
	let total = 0;
	const take = (name: string, data: Uint8Array) => {
		total += data.byteLength;
		if (total > MAX_TEMPLATE_RESOURCE_BYTES) {
			const limit = Math.round(MAX_TEMPLATE_RESOURCE_BYTES / (1024 * 1024));
			throw new Error(`"${name}" does not fit: a template can embed at most ${limit} MB.`);
		}
	};

	for (const family of templateFontFamilies(template)) {
		const font = available.fonts.get(family);
		if (!font) continue;
		take(font.fileName, font.data);
		fonts.push({ family, fileName: font.fileName, data: bytesToBase64(font.data) });
	}
	for (const id of templateAssetIds(template)) {
		const asset = available.assets.get(id);
		if (!asset) continue;
		take(asset.name, asset.data);
		assets.push({
			id,
			name: asset.name,
			mimeType: asset.mimeType,
			data: bytesToBase64(asset.data)
		});
	}
	if (fonts.length === 0 && assets.length === 0) return template;

	return {
		...template,
		resources: {
			...(fonts.length > 0 ? { fonts } : {}),
			...(assets.length > 0 ? { assets } : {})
		}
	};
}

/** Fonts the template uses that neither the file nor `hasFont` provides, and assets neither the file nor `hasAsset` provides. */
export function missingTemplateResources(
	template: MotionGraphicTemplate,
	hasFont: (family: string) => boolean,
	hasAsset: (id: string) => boolean = () => false
): { fonts: string[]; assets: string[] } {
	const embeddedFonts = new Set((template.resources?.fonts ?? []).map((font) => font.family));
	const embeddedAssets = new Set((template.resources?.assets ?? []).map((asset) => asset.id));
	return {
		fonts: templateFontFamilies(template).filter(
			(family) => !embeddedFonts.has(family) && !hasFont(family)
		),
		assets: templateAssetIds(template).filter((id) => !embeddedAssets.has(id) && !hasAsset(id))
	};
}

/** The template without the embedded fonts and assets, for keeping a light copy once they are installed. */
export function stripTemplateResources(template: MotionGraphicTemplate): MotionGraphicTemplate {
	if (!template.resources) return template;
	const { resources: _resources, ...rest } = template;
	void _resources;
	return rest as MotionGraphicTemplate;
}

/** A copy of the template whose clips and embedded assets use the ids in `idMap`. */
export function remapTemplateAssetIds(
	template: MotionGraphicTemplate,
	idMap: Map<string, string>
): MotionGraphicTemplate {
	const mapId = (id: string) => idMap.get(id) ?? id;
	const tracks: Track[] = template.tracks.map((track) => ({
		...track,
		clips: track.clips.map((clip) =>
			clip.assetId ? { ...clip, assetId: mapId(clip.assetId) as Clip['assetId'] } : clip
		)
	}));
	const assets = template.resources?.assets?.map((asset) => ({ ...asset, id: mapId(asset.id) }));
	return {
		...template,
		tracks,
		...(template.resources
			? { resources: { ...template.resources, ...(assets ? { assets } : {}) } }
			: {})
	};
}
