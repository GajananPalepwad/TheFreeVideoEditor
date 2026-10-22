import { describe, expect, it } from 'vitest';
import type { AssetId, Clip, ClipId, Track, TrackId } from '../types';
import {
	MAX_TEMPLATE_RESOURCE_BYTES,
	base64ToBytes,
	bytesToBase64,
	embedTemplateResources,
	missingTemplateResources,
	remapTemplateAssetIds,
	stripTemplateResources,
	templateAssetIds,
	templateFontFamilies
} from './templateResources';
import { deserializeTemplate, serializeTemplate } from './templateService';
import type { MotionGraphicTemplate } from './templateTypes';

function clip(id: string, extra: Partial<Clip>): Clip {
	return {
		id: id as ClipId,
		start: 0,
		duration: 1_000_000,
		sourceIn: 0,
		sourceOut: 1_000_000,
		speed: 1,
		volume: 1,
		...extra
	} as Clip;
}

function track(id: string, clips: Clip[]): Track {
	return {
		id: id as TrackId,
		kind: 'video',
		name: id,
		muted: false,
		locked: false,
		hidden: false,
		clips
	};
}

function template(
	tracks: Track[],
	extra: Partial<MotionGraphicTemplate> = {}
): MotionGraphicTemplate {
	return {
		version: 1,
		id: 'resources',
		name: 'Resources',
		category: 'Custom',
		duration: 1_000_000,
		tracks,
		publishedParams: [],
		...extra
	} as MotionGraphicTemplate;
}

const text = (id: string, family: string) =>
	clip(id, { source: { type: 'text', text: 'Hi', style: { fontFamily: family } } });

describe('base64', () => {
	it('round trips any bytes, including every byte value', () => {
		const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
		expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
	});

	it('matches the standard encoding', () => {
		expect(bytesToBase64(new TextEncoder().encode('Many hands make light work.'))).toBe(
			'TWFueSBoYW5kcyBtYWtlIGxpZ2h0IHdvcmsu'
		);
		expect(bytesToBase64(new Uint8Array([1]))).toBe('AQ==');
		expect(bytesToBase64(new Uint8Array([]))).toBe('');
	});

	it('handles data bigger than one chunk', () => {
		const bytes = new Uint8Array(200_000).map((_, index) => index % 251);
		expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
	});
});

describe('what a template depends on', () => {
	it('lists each font family used by a text layer once, in order', () => {
		const tpl = template([
			track('a', [text('c1', 'Zilla Slab'), text('c2', 'Inter')]),
			track('b', [text('c3', 'Zilla Slab')])
		]);
		expect(templateFontFamilies(tpl)).toEqual(['Inter', 'Zilla Slab']);
	});

	it('also reads a font set through the text.fontFamily property and a font parameter', () => {
		const tpl = template(
			[
				track('a', [
					clip('c1', {
						source: { type: 'text', text: 'Hi', style: { fontFamily: 'Inter' } },
						properties: { 'text.fontFamily': { value: 'Lobster' } }
					})
				])
			],
			{
				publishedParams: [
					{
						id: 'font',
						name: 'Font',
						type: 'font',
						targetClipId: 'c1' as ClipId,
						targetProperty: 'text.fontFamily',
						defaultValue: 'Pacifico'
					}
				]
			}
		);
		expect(templateFontFamilies(tpl)).toEqual(['Inter', 'Lobster', 'Pacifico']);
	});

	it('lists the media assets its clips use', () => {
		const tpl = template([
			track('a', [
				clip('c1', { assetId: 'asset-b' as AssetId, source: { type: 'asset' } }),
				clip('c2', { assetId: 'asset-a' as AssetId, source: { type: 'asset' } })
			]),
			track('b', [clip('c3', { assetId: 'asset-b' as AssetId, source: { type: 'asset' } })])
		]);
		expect(templateAssetIds(tpl)).toEqual(['asset-a', 'asset-b']);
	});

	it('has no dependencies when it uses only shapes', () => {
		const tpl = template([
			track('a', [
				clip('c1', {
					source: {
						type: 'shape',
						shapeType: 'rect',
						width: 10,
						height: 10,
						fillColor: { r: 1, g: 1, b: 1, a: 1 }
					}
				})
			])
		]);
		expect(templateFontFamilies(tpl)).toEqual([]);
		expect(templateAssetIds(tpl)).toEqual([]);
	});
});

describe('embedding resources', () => {
	const tpl = template(
		[
			track('a', [
				text('c1', 'Zilla Slab'),
				clip('c2', { assetId: 'img' as AssetId, source: { type: 'asset' } })
			])
		],
		{}
	);
	const fontBytes = new Uint8Array([0, 1, 2, 3]);
	const imageBytes = new Uint8Array([9, 8, 7]);

	it('embeds only the fonts and assets the template uses', () => {
		const result = embedTemplateResources(tpl, {
			fonts: new Map([
				['Zilla Slab', { fileName: 'ZillaSlab.ttf', data: fontBytes }],
				['Unused', { fileName: 'Unused.ttf', data: fontBytes }]
			]),
			assets: new Map([
				['img', { name: 'logo.png', mimeType: 'image/png', data: imageBytes }],
				['other', { name: 'x.png', mimeType: 'image/png', data: imageBytes }]
			])
		});
		expect(result.resources?.fonts).toEqual([
			{ family: 'Zilla Slab', fileName: 'ZillaSlab.ttf', data: bytesToBase64(fontBytes) }
		]);
		expect(result.resources?.assets).toEqual([
			{ id: 'img', name: 'logo.png', mimeType: 'image/png', data: bytesToBase64(imageBytes) }
		]);
	});

	it('leaves the original template untouched and adds nothing when nothing is available', () => {
		const result = embedTemplateResources(tpl, { fonts: new Map(), assets: new Map() });
		expect(result.resources).toBeUndefined();
		expect(tpl.resources).toBeUndefined();
	});

	it('refuses to embed more than the size limit, and says which resource did not fit', () => {
		const big = new Uint8Array(MAX_TEMPLATE_RESOURCE_BYTES + 1);
		expect(() =>
			embedTemplateResources(tpl, {
				fonts: new Map([['Zilla Slab', { fileName: 'Big.ttf', data: big }]]),
				assets: new Map()
			})
		).toThrow(/Big\.ttf/);
	});

	it('survives being saved to a file and read back', () => {
		const embedded = embedTemplateResources(tpl, {
			fonts: new Map([['Zilla Slab', { fileName: 'ZillaSlab.ttf', data: fontBytes }]]),
			assets: new Map([['img', { name: 'logo.png', mimeType: 'image/png', data: imageBytes }]])
		});
		const reopened = deserializeTemplate(serializeTemplate(embedded));
		expect(reopened.resources).toEqual(embedded.resources);
	});

	it('rejects a file whose resources are the wrong shape', () => {
		const broken = JSON.parse(serializeTemplate(template([track('a', [text('c1', 'Inter')])])));
		broken.resources = { fonts: [{ family: 'X' }] };
		expect(() => deserializeTemplate(JSON.stringify(broken))).toThrow(/resources/);
	});
});

describe('what is missing', () => {
	const tpl = template([
		track('a', [
			text('c1', 'Zilla Slab'),
			text('c2', 'Inter'),
			clip('c3', { assetId: 'img' as AssetId, source: { type: 'asset' } })
		])
	]);

	it('reports fonts that are neither on the machine nor in the file, and assets not in the file', () => {
		const missing = missingTemplateResources(tpl, (family) => family === 'Inter');
		expect(missing).toEqual({ fonts: ['Zilla Slab'], assets: ['img'] });
	});

	it('does not report what the file carries', () => {
		const embedded = embedTemplateResources(tpl, {
			fonts: new Map([['Zilla Slab', { fileName: 'Z.ttf', data: new Uint8Array([1]) }]]),
			assets: new Map([
				['img', { name: 'a.png', mimeType: 'image/png', data: new Uint8Array([1]) }]
			])
		});
		expect(missingTemplateResources(embedded, () => false)).toEqual({
			fonts: ['Inter'],
			assets: []
		});
	});
});

describe('assets already in the project', () => {
	const tpl = template([
		track('a', [clip('c1', { assetId: 'img' as AssetId, source: { type: 'asset' } })])
	]);

	it('are not reported missing', () => {
		expect(
			missingTemplateResources(
				tpl,
				() => true,
				(id) => id === 'img'
			).assets
		).toEqual([]);
		expect(
			missingTemplateResources(
				tpl,
				() => true,
				() => false
			).assets
		).toEqual(['img']);
	});
});

describe('stripping resources', () => {
	it('drops the embedded data and keeps everything else', () => {
		const embedded = embedTemplateResources(template([track('a', [text('c1', 'Zilla Slab')])]), {
			fonts: new Map([['Zilla Slab', { fileName: 'Z.ttf', data: new Uint8Array([1, 2, 3]) }]]),
			assets: new Map()
		});
		const stripped = stripTemplateResources(embedded);
		expect(stripped.resources).toBeUndefined();
		expect(stripped.tracks).toEqual(embedded.tracks);
		expect(embedded.resources).toBeDefined();
	});

	it('returns a template without resources as it is', () => {
		const plain = template([track('a', [text('c1', 'Inter')])]);
		expect(stripTemplateResources(plain)).toBe(plain);
	});
});

describe('remapping assets', () => {
	it('points clips and embedded resources at the new ids and changes nothing else', () => {
		const tpl = embedTemplateResources(
			template([
				track('a', [
					clip('c1', { assetId: 'old' as AssetId, source: { type: 'asset' } }),
					text('c2', 'Inter')
				])
			]),
			{
				fonts: new Map(),
				assets: new Map([
					['old', { name: 'a.png', mimeType: 'image/png', data: new Uint8Array([1]) }]
				])
			}
		);

		const result = remapTemplateAssetIds(tpl, new Map([['old', 'new']]));

		expect(result.tracks[0]!.clips[0]!.assetId).toBe('new');
		expect(result.tracks[0]!.clips[1]).toEqual(tpl.tracks[0]!.clips[1]);
		expect(result.resources?.assets?.[0]?.id).toBe('new');
		expect(tpl.tracks[0]!.clips[0]!.assetId).toBe('old');
	});
});
