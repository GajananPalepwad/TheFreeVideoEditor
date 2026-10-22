import type { Clip, Track, TrackId, ClipId, PropertyId } from '../types';
import type {
	MotionGraphicTemplate,
	PublishedTemplateParam,
	TemplateCategory
} from './templateTypes';
import {
	GRAPHIC_TEMPLATES,
	createGraphicClip,
	type GraphicTemplate,
	type GraphicCategory
} from '../text/graphicsTemplates';
import { createTemplateFromClips } from './templateService';

function hexToRgba(hex: string, alpha = 1): { r: number; g: number; b: number; a: number } {
	let clean = hex.replace('#', '').trim();
	if (clean.length === 3) {
		clean = clean
			.split('')
			.map((c) => c + c)
			.join('');
	}
	const num = parseInt(clean, 16);
	if (Number.isNaN(num)) return { r: 1, g: 1, b: 1, a: alpha };
	const r = ((num >> 16) & 255) / 255;
	const g = ((num >> 8) & 255) / 255;
	const b = (num & 255) / 255;
	return { r, g, b, a: alpha };
}

function arrayToRgba(arr?: unknown): { r: number; g: number; b: number; a: number } {
	if (Array.isArray(arr) && arr.length >= 3) {
		return {
			r: arr[0] ?? 1,
			g: arr[1] ?? 1,
			b: arr[2] ?? 1,
			a: arr[3] ?? 1
		};
	}
	return { r: 1, g: 1, b: 1, a: 1 };
}

/** The largest the Text Size slider goes, as a multiple of the size a template is drawn at. */
export const TEXT_SIZE_MAX_SCALE = 1.5;

/**
 * A slider for the size of one text layer, from half to `TEXT_SIZE_MAX_SCALE` times the size it is
 * drawn at. The template's bounds are measured at the largest size so that text never gets cut off.
 */
function textSizeParam(
	id: string,
	name: string,
	targetClipId: ClipId,
	size: number
): PublishedTemplateParam {
	return {
		id,
		name,
		type: 'number',
		targetClipId,
		targetProperty: 'text.fontSize',
		defaultValue: size,
		min: Math.round(size / 2),
		max: Math.round(size * TEXT_SIZE_MAX_SCALE),
		step: 1
	};
}

export function mapCategory(cat: GraphicCategory): TemplateCategory {
	switch (cat) {
		case 'kinetic':
			return 'Kinetic';
		case 'lower-third':
			return 'Lower Thirds';
		case 'titles':
			return 'Titles';
		case 'social':
			return 'Social';
		case 'callouts':
			return 'Callouts';
		case 'badge':
			return 'Badges';
		case 'neon':
			return 'Kinetic';
		case 'minimal':
			return 'Titles';
		default:
			return 'Titles';
	}
}

/** Text properties that only paint the text clip's own box, border or accent bar. */
const TEXT_FRAME_PROPERTIES = [
	'text.backgroundBoxColor',
	'text.backgroundBoxRadius',
	'text.backgroundBoxPadding',
	'text.boxBorderColor',
	'text.boxBorderWidth',
	'text.accentBarColor',
	'text.accentBarWidth'
] as const;

/** Removes the frame a text clip draws for itself, for use when a separate shape layer takes over. */
function stripTextFrame(clip: Clip): void {
	if (clip.source?.type !== 'text') return;
	const box = { ...clip.source.box, frameStyle: 'none' as const };
	delete box.borderColor;
	delete box.borderWidth;
	delete box.borderRadius;
	delete box.accentBarColor;
	delete box.accentBarWidth;
	delete box.badgeText;
	clip.source.box = box;
	if (!clip.properties) return;
	for (const id of TEXT_FRAME_PROPERTIES) delete clip.properties[id];
}

/**
 * Converts a legacy GraphicTemplate into a full-featured, multi-layer,
 * animated Motion Graphic Template (.tfvetemplate).
 */
export function convertGraphicTemplateToMotionTemplate(
	template: GraphicTemplate,
	duration: number = 5_000_000
): MotionGraphicTemplate {
	if (template.id === 'mixkit-minimal-wipe-lower-third') {
		return createMixkitMinimalWipeTemplate();
	}

	// 1. Build the primary animated text clip
	const textClip = createGraphicClip(template.id, 0, duration, template.defaultText);
	textClip.id = `clip_text_${template.id}` as ClipId;

	// Extract primary text fill color for published params
	const primaryColor =
		textClip.source?.type === 'text' && textClip.source.colorRuns?.[0]?.fillColor
			? textClip.source.colorRuns[0].fillColor
			: template.properties?.['text.fillColor']
				? arrayToRgba(template.properties['text.fillColor'])
				: { r: 1, g: 1, b: 1, a: 1 };

	// 2. Build the Shape / Background frame if applicable
	const frameStyle = template.frameStyle || template.box?.frameStyle;
	let shapeClip: Clip | null = null;

	if (frameStyle && frameStyle !== 'none') {
		const shapeId = `clip_shape_${template.id}` as ClipId;
		let shapeType: 'rect' | 'circle' | 'ellipse' | 'triangle' | 'diamond' | 'star' = 'rect';
		let width = 560;
		let height = 220;
		let cornerRadius = 12;
		let fillColor: { r: number; g: number; b: number; a: number } = { r: 0.1, g: 0.1, b: 0.15, a: 0.9 };
		let strokeColor: { r: number; g: number; b: number; a: number } | undefined = undefined;
		let strokeWidth = 0;
		let shapeRotation = 0;

		const basePos = textClip.properties?.position
			? (textClip.properties.position as any).value ?? [0, 0]
			: [0, 0];
		let shapePos: [number, number] = [basePos[0], basePos[1]];

		switch (frameStyle) {
			case 'card':
				shapeType = 'rect';
				width = 620;
				height = 250;
				cornerRadius = 16;
				fillColor = template.properties?.['text.backgroundBoxColor']
					? arrayToRgba(template.properties['text.backgroundBoxColor'])
					: template.previewColors?.accent
						? hexToRgba(template.previewColors.accent, 1)
						: { r: 0.98, g: 0.98, b: 0.98, a: 1 };
				break;

			case 'circle':
				shapeType = 'circle';
				width = 380;
				height = 380;
				fillColor = { r: 0, g: 0, b: 0, a: 0 };
				strokeColor = template.accentColor;
				strokeWidth = 3;
				break;

			case 'frame':
			case 'cinematic-box':
			case 'divided-box':
				shapeType = 'rect';
				width = 600;
				height = 230;
				cornerRadius = 4;
				fillColor = { r: 0, g: 0, b: 0, a: 0 };
				strokeColor = template.accentColor;
				strokeWidth = 2.5;
				break;

			case 'badge-header':
			case 'title-badge':
			case 'social-pill':
				shapeType = 'rect';
				width = 460;
				height = 68;
				cornerRadius = 34;
				fillColor = template.accentColor;
				break;

			case 'lower-third-line':
				shapeType = 'rect';
				width = 620;
				height = 5;
				cornerRadius = 2;
				fillColor = template.accentColor;
				shapePos = [basePos[0], basePos[1] + 48];
				break;

			case 'lower-third-glass':
				shapeType = 'rect';
				width = 660;
				height = 110;
				cornerRadius = 10;
				fillColor = { r: 0.06, g: 0.09, b: 0.16, a: 0.85 };
				strokeColor = template.accentColor;
				strokeWidth = 1.5;
				shapePos = [basePos[0], basePos[1]];
				break;

			case 'accent-bar':
				shapeType = 'rect';
				width = 6;
				height = 105;
				cornerRadius = 3;
				fillColor = template.accentColor;
				shapePos = [basePos[0] - 220, basePos[1]];
				break;

			case 'callout-pointer':
				shapeType = 'rect';
				width = 360;
				height = 84;
				cornerRadius = 12;
				fillColor = { r: 0.08, g: 0.1, b: 0.16, a: 0.92 };
				strokeColor = template.accentColor;
				strokeWidth = 2;
				break;

			case 'split-slash':
				shapeType = 'rect';
				width = 560;
				height = 5;
				cornerRadius = 3;
				fillColor = template.accentColor;
				shapeRotation = -12;
				break;

			case 'diagonal-repeat':
				shapeType = 'rect';
				width = 660;
				height = 230;
				cornerRadius = 8;
				fillColor = { r: 0.04, g: 0.05, b: 0.08, a: 0.7 };
				strokeColor = template.accentColor;
				strokeWidth = 2;
				shapeRotation = -18;
				break;

			default:
				shapeType = 'rect';
				width = 560;
				height = 200;
				cornerRadius = 8;
				fillColor = { r: 0.08, g: 0.08, b: 0.12, a: 0.75 };
				break;
		}

		// Replicate text keyframes onto shape clip so shape animates in sync
		const shapeProps: Record<PropertyId, any> = {
			position: { value: shapePos },
			rotation: { value: shapeRotation }
		};

		if (textClip.properties) {
			for (const propId of ['position', 'scale', 'opacity'] as const) {
				const p = textClip.properties[propId];
				if (p && 'keyframes' in p && Array.isArray((p as any).keyframes)) {
					if (propId === 'position') {
						const dx = shapePos[0] - basePos[0];
						const dy = shapePos[1] - basePos[1];
						shapeProps.position = {
							keyframes: (p as any).keyframes.map((kf: any) => ({
								...kf,
								value: [kf.value[0] + dx, kf.value[1] + dy]
							}))
						};
					} else {
						shapeProps[propId] = JSON.parse(JSON.stringify(p));
					}
				}
			}
		}

		shapeClip = {
			id: shapeId,
			start: 0,
			duration,
			sourceIn: 0,
			sourceOut: duration,
			speed: 1,
			volume: 0,
			source: {
				type: 'shape',
				shapeType,
				width,
				height,
				cornerRadius,
				fillColor,
				strokeColor,
				strokeWidth
			},
			properties: shapeProps,
			effects: []
		};
	}

	// The shape layer is the frame now; leaving the text's own frame as well draws it twice.
	if (shapeClip) stripTextFrame(textClip);

	// 3. Define Published Editable Parameters
	const publishedParams: PublishedTemplateParam[] = [
		{
			id: 'param_title_text',
			name: 'Title Text',
			type: 'text',
			targetClipId: textClip.id,
			targetProperty: 'text.content',
			defaultValue: template.defaultText
		},
		{
			id: 'param_font_family',
			name: 'Font Family',
			type: 'font',
			targetClipId: textClip.id,
			targetProperty: 'text.fontFamily',
			defaultValue: template.style.fontFamily || 'Montserrat'
		},
		textSizeParam(
			'param_text_size',
			'Text Size',
			textClip.id,
			(textClip.properties?.['text.fontSize'] as { value?: number } | undefined)?.value ?? 56
		),
		{
			id: 'param_text_color',
			name: 'Text Color',
			type: 'color',
			targetClipId: textClip.id,
			targetProperty: 'text.fill',
			defaultValue: primaryColor
		}
	];

	if (shapeClip && shapeClip.source?.type === 'shape') {
		publishedParams.push({
			id: 'param_shape_fill',
			name: 'Accent / Background Color',
			type: 'color',
			targetClipId: shapeClip.id,
			targetProperty: 'shape.fill',
			defaultValue: shapeClip.source.fillColor || template.accentColor
		});

		if (shapeClip.source.strokeWidth && shapeClip.source.strokeWidth > 0 && shapeClip.source.strokeColor) {
			publishedParams.push({
				id: 'param_shape_stroke',
				name: 'Border Color',
				type: 'color',
				targetClipId: shapeClip.id,
				targetProperty: 'shape.stroke',
				defaultValue: shapeClip.source.strokeColor
			});
		}
	}

	// 4. Organize into tracks. The first track is the top layer, so the text goes first and the
	// background shape sits beneath it.
	const tracks: Track[] = [];
	const clipsToPackage: Clip[] = [];

	clipsToPackage.push(textClip);
	tracks.push({
		id: 'track_text' as TrackId,
		kind: 'video',
		name: 'Title Text',
		muted: false,
		locked: false,
		hidden: false,
		clips: [textClip]
	});

	if (shapeClip) {
		clipsToPackage.push(shapeClip);
		tracks.push({
			id: 'track_bg' as TrackId,
			kind: 'video',
			name: 'Background Frame',
			muted: false,
			locked: false,
			hidden: false,
			clips: [shapeClip]
		});
	}

	// 5. Package via createTemplateFromClips for automatic bounding box & coordinate centering
	const motionTemplate = createTemplateFromClips({
		name: template.name,
		category: mapCategory(template.category),
		description: template.description,
		author: 'TheFreeVideoEditor',
		clips: clipsToPackage,
		tracks,
		publishedParams,
		responsiveTiming: {
			introDuration: template.inDurationUs || 500_000,
			outroDuration: template.outDurationUs || 400_000
		},
		textScale: TEXT_SIZE_MAX_SCALE
	});

	// Preserve exact original template ID
	motionTemplate.id = template.id;

	return motionTemplate;
}

/**
 * Converts all built-in GraphicTemplates into full MotionGraphicTemplates (.tfvetemplate).
 */
export function convertAllGraphicTemplates(): MotionGraphicTemplate[] {
	return GRAPHIC_TEMPLATES.map((tpl) => convertGraphicTemplateToMotionTemplate(tpl));
}

/**
 * Creates the authentic Mixkit 312 reference template:
 * Clean modern lower third with cobalt accent bar, smooth white block wipe reveal,
 * and wide-tracked subtitle.
 */
export function createMixkitMinimalWipeTemplate(): MotionGraphicTemplate {
	const duration = 5_900_000;

	// Track 1: Accent Lead Bar (Cyan Pill)
	const accentBarClip: Clip = {
		id: 'tpl_clip_accent_bar' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'shape',
			shapeType: 'rect',
			width: 18,
			height: 104,
			cornerRadius: 4,
			fillColor: { r: 0.0, g: 0.82, b: 0.95, a: 1 },
			strokeWidth: 0
		},
		properties: {
			position: { value: [-360, 0] },
			scale: {
				keyframes: [
					{
						time: 0,
						value: [1, 0],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 },
						easeIn: { x: 0.3, y: 1 }
					},
					{ time: 300_000, value: [1, 1.15], interpolation: 'linear' },
					{ time: 450_000, value: [1, 1.0], interpolation: 'linear' },
					{
						time: 4_900_000,
						value: [1, 1.0],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 }
					},
					{ time: 5_400_000, value: [1, 0.0], interpolation: 'linear' }
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 200_000, value: 1, interpolation: 'linear' },
					{ time: 4_900_000, value: 1, interpolation: 'linear' },
					{ time: 5_400_000, value: 0, interpolation: 'linear' }
				]
			}
		}
	};

	// Track 2: Title Text
	const titleTextClip: Clip = {
		id: 'tpl_clip_title' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'text',
			text: 'MATT TYLER',
			style: {
				fontFamily: 'Montserrat',
				fontWeight: '900',
				alignment: 'left',
				letterSpacing: 2
			},
			box: {
				autoSize: true,
				verticalAnchor: 'top',
				paddingX: 0,
				paddingY: 0,
				frameStyle: 'none'
			},
			colorRuns: [
				{
					startIndex: 0,
					endIndex: 10,
					fillColor: { r: 1, g: 1, b: 1, a: 1 }
				}
			],
			graphicTemplateId: 'mixkit-minimal-wipe-lower-third'
		},
		properties: {
			position: { value: [-320, -22] },
			'text.fontSize': { value: 58 },
			'text.fillColor': { value: [1, 1, 1, 1] },
			'text.letterSpacing': { value: 2 },
			// Crop insets are fractions of the source: [left, top, right, bottom].
			crop: {
				keyframes: [
					{ time: 0, value: [0, 0, 1, 0], interpolation: 'linear' },
					{ time: 500_000, value: [0, 0, 1, 0], interpolation: 'linear' },
					{ time: 850_000, value: [0, 0, 0.55, 0], interpolation: 'linear' },
					{ time: 1_250_000, value: [0, 0, 0, 0], interpolation: 'linear' },
					{ time: 4_600_000, value: [0, 0, 0, 0], interpolation: 'linear' },
					{ time: 5_200_000, value: [0, 0, 1, 0], interpolation: 'linear' }
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 500_000, value: 1, interpolation: 'linear' },
					{ time: 5_200_000, value: 1, interpolation: 'linear' },
					{ time: 5_400_000, value: 0, interpolation: 'linear' }
				]
			}
		}
	};

	// Track 3: Sliding Wipe Block
	const wipeBlockClip: Clip = {
		id: 'tpl_clip_wipe_block' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'shape',
			shapeType: 'rect',
			width: 220,
			height: 76,
			cornerRadius: 2,
			fillColor: { r: 1, g: 1, b: 1, a: 1 },
			strokeWidth: 0
		},
		properties: {
			position: {
				keyframes: [
					{ time: 0, value: [-320, -22], interpolation: 'linear' },
					{
						time: 450_000,
						value: [-320, -22],
						interpolation: 'bezier',
						easeOut: { x: 0.2, y: 1 }
					},
					{ time: 750_000, value: [-190, -22], interpolation: 'linear' },
					{ time: 1_050_000, value: [-40, -22], interpolation: 'linear' },
					{ time: 1_300_000, value: [120, -22], interpolation: 'linear' },
					{ time: 1_450_000, value: [180, -22], interpolation: 'linear' },
					{ time: 4_450_000, value: [180, -22], interpolation: 'linear' },
					{
						time: 4_600_000,
						value: [120, -22],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 }
					},
					{ time: 4_900_000, value: [-60, -22], interpolation: 'linear' },
					{ time: 5_200_000, value: [-320, -22], interpolation: 'linear' }
				]
			},
			scale: {
				keyframes: [
					{ time: 0, value: [1, 1], interpolation: 'linear' },
					{ time: 1_250_000, value: [1, 1], interpolation: 'linear' },
					{ time: 1_400_000, value: [0.1, 1], interpolation: 'linear' },
					{ time: 4_550_000, value: [0.1, 1], interpolation: 'linear' },
					{ time: 4_650_000, value: [1, 1], interpolation: 'linear' },
					{ time: 5_350_000, value: [0.1, 1], interpolation: 'linear' }
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 450_000, value: 1, interpolation: 'linear' },
					{ time: 1_250_000, value: 1, interpolation: 'linear' },
					{ time: 1_400_000, value: 0, interpolation: 'linear' },
					{ time: 4_550_000, value: 0, interpolation: 'linear' },
					{ time: 4_650_000, value: 1, interpolation: 'linear' },
					{ time: 5_200_000, value: 1, interpolation: 'linear' },
					{ time: 5_350_000, value: 0, interpolation: 'linear' }
				]
			}
		}
	};

	// Track 4: Subtitle Text
	const subtitleTextClip: Clip = {
		id: 'tpl_clip_subtitle' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'text',
			text: 'ART DEPARTMENT ASSISTANT',
			style: {
				fontFamily: 'Montserrat',
				fontWeight: '600',
				alignment: 'left',
				letterSpacing: 4
			},
			box: {
				autoSize: true,
				verticalAnchor: 'top',
				paddingX: 0,
				paddingY: 0,
				frameStyle: 'none'
			},
			colorRuns: [
				{
					startIndex: 0,
					endIndex: 24,
					fillColor: { r: 1, g: 1, b: 1, a: 1 }
				}
			]
		},
		properties: {
			position: {
				keyframes: [
					{ time: 0, value: [-320, 42], interpolation: 'linear' },
					{
						time: 850_000,
						value: [-320, 42],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 }
					},
					{ time: 1_350_000, value: [-320, 28], interpolation: 'linear' },
					{
						time: 4_650_000,
						value: [-320, 28],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 }
					},
					{ time: 5_150_000, value: [-320, 42], interpolation: 'linear' }
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 850_000, value: 0, interpolation: 'linear' },
					{ time: 1_350_000, value: 1, interpolation: 'linear' },
					{ time: 4_650_000, value: 1, interpolation: 'linear' },
					{ time: 5_150_000, value: 0, interpolation: 'linear' }
				]
			},
			'text.fontSize': { value: 22 },
			'text.letterSpacing': { value: 4 },
			'text.fillColor': { value: [1, 1, 1, 1] }
		}
	};

	const tracks: Track[] = [
		{
			id: 'tpl_trk_accent' as TrackId,
			kind: 'video',
			name: 'Accent Lead Bar',
			muted: false,
			locked: false,
			hidden: false,
			clips: [accentBarClip]
		},
		{
			id: 'tpl_trk_title' as TrackId,
			kind: 'video',
			name: 'Title Text',
			muted: false,
			locked: false,
			hidden: false,
			clips: [titleTextClip]
		},
		{
			id: 'tpl_trk_wipe' as TrackId,
			kind: 'video',
			name: 'Wipe Block',
			muted: false,
			locked: false,
			hidden: false,
			clips: [wipeBlockClip]
		},
		{
			id: 'tpl_trk_subtitle' as TrackId,
			kind: 'video',
			name: 'Subtitle Text',
			muted: false,
			locked: false,
			hidden: false,
			clips: [subtitleTextClip]
		}
	];

	const publishedParams: PublishedTemplateParam[] = [
		{
			id: 'param_title_text',
			name: 'Title Text',
			type: 'text',
			targetClipId: 'tpl_clip_title' as ClipId,
			targetProperty: 'text.content',
			defaultValue: 'MATT TYLER'
		},
		{
			id: 'param_title_font',
			name: 'Title Font',
			type: 'font',
			targetClipId: 'tpl_clip_title' as ClipId,
			targetProperty: 'text.fontFamily',
			defaultValue: 'Montserrat'
		},
		textSizeParam('param_title_size', 'Title Size', 'tpl_clip_title' as ClipId, 58),
		{
			id: 'param_title_color',
			name: 'Title Color',
			type: 'color',
			targetClipId: 'tpl_clip_title' as ClipId,
			targetProperty: 'text.fill',
			defaultValue: { r: 1, g: 1, b: 1, a: 1 }
		},
		{
			id: 'param_subtitle_text',
			name: 'Subtitle Text',
			type: 'text',
			targetClipId: 'tpl_clip_subtitle' as ClipId,
			targetProperty: 'text.content',
			defaultValue: 'ART DEPARTMENT ASSISTANT'
		},
		textSizeParam('param_subtitle_size', 'Subtitle Size', 'tpl_clip_subtitle' as ClipId, 22),
		{
			id: 'param_subtitle_color',
			name: 'Subtitle Color',
			type: 'color',
			targetClipId: 'tpl_clip_subtitle' as ClipId,
			targetProperty: 'text.fill',
			defaultValue: { r: 1, g: 1, b: 1, a: 1 }
		},
		{
			id: 'param_accent_color',
			name: 'Accent Bar Color',
			type: 'color',
			targetClipId: 'tpl_clip_accent_bar' as ClipId,
			targetProperty: 'shape.fill',
			defaultValue: { r: 0.0, g: 0.82, b: 0.95, a: 1 }
		},
		{
			id: 'param_wipe_color',
			name: 'Wipe Block Color',
			type: 'color',
			targetClipId: 'tpl_clip_wipe_block' as ClipId,
			targetProperty: 'shape.fill',
			defaultValue: { r: 1, g: 1, b: 1, a: 1 }
		}
	];

	return {
		version: 1,
		id: 'mixkit-minimal-wipe-lower-third',
		name: 'Clean Minimal Wipe Lower Third',
		category: 'Lower Thirds',
		description:
			'Clean modern lower third with cyan accent bar, smooth white block wipe reveal, and wide-tracked subtitle inspired by Mixkit 312',
		author: 'TheFreeVideoEditor',
		createdAt: 1792312600000,
		duration,
		responsiveTiming: {
			introDuration: 1_400_000,
			outroDuration: 1_200_000
		},
		bounds: {
			width: 1100,
			height: 180,
			originX: -340,
			originY: 280
		},
		tracks,
		publishedParams
	};
}


