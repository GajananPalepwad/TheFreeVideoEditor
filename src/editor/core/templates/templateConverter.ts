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
import { createTemplateFromClips, measureTextClip } from './templateService';

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
 * animated Motion Graphic Template (.grafree).
 */
export function convertGraphicTemplateToMotionTemplate(
	template: GraphicTemplate,
	duration: number = 5_000_000
): MotionGraphicTemplate {
	if (template.id === 'mixkit-minimal-wipe-lower-third') {
		return createMixkitMinimalWipeTemplate();
	}
	if (template.id === 'mixkit-bold-italic-split-title') {
		return createMixkitBoldItalicSplitTitleTemplate();
	}
	if (template.id === 'word-cascade') {
		return createWordCascadeTemplate();
	}
	if (template.id === 'kinetic-marquee-stack') {
		return createKineticMarqueeStackTemplate();
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
		let fillColor: { r: number; g: number; b: number; a: number } = {
			r: 0.1,
			g: 0.1,
			b: 0.15,
			a: 0.9
		};
		let strokeColor: { r: number; g: number; b: number; a: number } | undefined = undefined;
		let strokeWidth = 0;
		let shapeRotation = 0;

		const basePos = textClip.properties?.position
			? ((textClip.properties.position as any).value ?? [0, 0])
			: [0, 0];

		// The block the text draws, which the frame has to wrap. Text sits on its position point
		// when it is left or right aligned, and is centred on it otherwise.
		const block = measureTextClip(textClip);
		const alignment =
			textClip.source?.type === 'text' ? textClip.source.style?.alignment : undefined;
		const centerX =
			basePos[0] +
			(alignment === 'left' ? block.width / 2 : alignment === 'right' ? -block.width / 2 : 0);
		const centerY = basePos[1];
		let shapePos: [number, number] = [centerX, centerY];
		const wrap = (extraX: number, extraY: number) => {
			width = Math.round(block.width + extraX);
			height = Math.round(block.height + extraY);
		};

		switch (frameStyle) {
			case 'card':
				shapeType = 'rect';
				wrap(24, 16);
				cornerRadius = 16;
				fillColor = template.properties?.['text.backgroundBoxColor']
					? arrayToRgba(template.properties['text.backgroundBoxColor'])
					: template.previewColors?.accent
						? hexToRgba(template.previewColors.accent, 1)
						: { r: 0.98, g: 0.98, b: 0.98, a: 1 };
				break;

			case 'circle':
				shapeType = 'circle';
				width = height = Math.round(Math.hypot(block.width, block.height) + 16);
				fillColor = { r: 0, g: 0, b: 0, a: 0 };
				strokeColor = template.accentColor;
				strokeWidth = 3;
				break;

			case 'frame':
			case 'cinematic-box':
			case 'divided-box':
				shapeType = 'rect';
				wrap(16, 8);
				cornerRadius = 4;
				fillColor = { r: 0, g: 0, b: 0, a: 0 };
				strokeColor = template.accentColor;
				strokeWidth = 2.5;
				break;

			case 'badge-header':
			case 'title-badge':
			case 'social-pill':
				shapeType = 'rect';
				wrap(32, 12);
				cornerRadius = Math.round(height / 2);
				fillColor = template.accentColor;
				break;

			case 'lower-third-line':
				shapeType = 'rect';
				width = Math.round(block.width);
				height = 5;
				cornerRadius = 2;
				fillColor = template.accentColor;
				shapePos = [centerX, centerY + block.height / 2 + 4];
				break;

			case 'lower-third-glass':
				shapeType = 'rect';
				wrap(40, 20);
				cornerRadius = 10;
				fillColor = { r: 0.06, g: 0.09, b: 0.16, a: 0.85 };
				strokeColor = template.accentColor;
				strokeWidth = 1.5;
				break;

			case 'accent-bar':
				shapeType = 'rect';
				width = 6;
				height = Math.round(block.height);
				cornerRadius = 3;
				fillColor = template.accentColor;
				shapePos = [centerX - block.width / 2 - 14, centerY];
				break;

			case 'callout-pointer':
				shapeType = 'rect';
				wrap(24, 16);
				cornerRadius = 12;
				fillColor = { r: 0.08, g: 0.1, b: 0.16, a: 0.92 };
				strokeColor = template.accentColor;
				strokeWidth = 2;
				break;

			case 'split-slash':
				shapeType = 'rect';
				width = Math.round(block.width);
				height = 5;
				cornerRadius = 3;
				fillColor = template.accentColor;
				shapeRotation = -12;
				break;

			case 'diagonal-repeat':
				shapeType = 'rect';
				wrap(60, 40);
				cornerRadius = 8;
				fillColor = { r: 0.04, g: 0.05, b: 0.08, a: 0.7 };
				strokeColor = template.accentColor;
				strokeWidth = 2;
				shapeRotation = -18;
				break;

			default:
				shapeType = 'rect';
				wrap(24, 16);
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

		if (
			shapeClip.source.strokeWidth &&
			shapeClip.source.strokeWidth > 0 &&
			shapeClip.source.strokeColor
		) {
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
 * Converts all built-in GraphicTemplates into full MotionGraphicTemplates (.grafree).
 */
export function convertAllGraphicTemplates(): MotionGraphicTemplate[] {
	return GRAPHIC_TEMPLATES.map((tpl) => convertGraphicTemplateToMotionTemplate(tpl));
}

/**
 * Creates the Streetwear Kinetic Marquee Stack template:
 * Edgy -6° angled kinetic typography with matching slanted frame,
 * dynamic snap punch zoom with overshoot, live breathing camera drift,
 * and rapid exit snap.
 */
export function createKineticMarqueeStackTemplate(): MotionGraphicTemplate {
	const duration = 5_000_000;
	const angle = -6;

	const scaleKeyframes = [
		{
			time: 0,
			value: [0.35, 0.35],
			interpolation: 'bezier' as const,
			easeOut: { x: 0.16, y: 1 },
			easeIn: { x: 0.3, y: 1 }
		},
		{
			time: 300_000,
			value: [1.08, 1.08],
			interpolation: 'bezier' as const,
			easeOut: { x: 0.25, y: 0.1 },
			easeIn: { x: 0.25, y: 1 }
		},
		{ time: 450_000, value: [1.0, 1.0], interpolation: 'linear' as const },
		{
			time: 4_550_000,
			value: [1.0, 1.0],
			interpolation: 'linear' as const,
			anchor: 'end' as const
		},
		{
			time: 4_800_000,
			value: [1.07, 1.07],
			interpolation: 'bezier' as const,
			easeOut: { x: 0.16, y: 1 },
			easeIn: { x: 0.3, y: 1 },
			anchor: 'end' as const
		},
		{
			time: 5_000_000,
			value: [0.35, 0.35],
			interpolation: 'linear' as const,
			anchor: 'end' as const
		}
	];

	const opacityKeyframes = [
		{ time: 0, value: 0, interpolation: 'linear' as const },
		{ time: 180_000, value: 1, interpolation: 'linear' as const },
		{ time: 4_550_000, value: 1, interpolation: 'linear' as const, anchor: 'end' as const },
		{ time: 5_000_000, value: 0, interpolation: 'linear' as const, anchor: 'end' as const }
	];

	const textClip: Clip = {
		id: 'clip_text_kinetic-marquee-stack' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'text',
			text: 'NEVER STOP\nTHE FUTURE IS CREATED TODAY',
			style: {
				fontFamily: 'Montserrat',
				fontWeight: '900',
				alignment: 'center',
				letterSpacing: -0.5
			},
			box: {
				autoSize: true,
				verticalAnchor: 'center',
				paddingX: 36,
				paddingY: 22,
				frameStyle: 'none'
			},
			colorRuns: [],
			graphicTemplateId: 'kinetic-marquee-stack',
			animationPresetId: 'kinetic-zoom'
		},
		properties: {
			position: { value: [0, 0] },
			rotation: { value: angle },
			'text.fontSize': { value: 64 },
			'text.letterSpacing': { value: -0.5 },
			'text.fillColor': { value: [1, 1, 1, 1] },
			'text.lineHeight': { value: 1.15 },
			'text.shadowColor': { value: [1, 0.18, 0.48, 0.5] },
			'text.shadowBlur': { value: 16 },
			opacity: { keyframes: opacityKeyframes },
			scale: { keyframes: scaleKeyframes }
		},
		effects: []
	};

	const shapeClip: Clip = {
		id: 'clip_shape_kinetic-marquee-stack' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'shape',
			shapeType: 'rect',
			width: 1240,
			height: 240,
			cornerRadius: 8,
			fillColor: { r: 0.04, g: 0.05, b: 0.08, a: 0.75 },
			strokeColor: { r: 1, g: 0.18, b: 0.48, a: 1 },
			strokeWidth: 2.5,
			shadowColor: { r: 1, g: 0.18, b: 0.48, a: 0.45 },
			shadowBlur: 20
		},
		properties: {
			position: { value: [0, 0] },
			rotation: { value: angle },
			scale: { keyframes: scaleKeyframes },
			opacity: { keyframes: opacityKeyframes }
		},
		effects: []
	};

	const tracks: Track[] = [
		{
			id: 'track_text' as TrackId,
			kind: 'video',
			name: 'Title Text',
			muted: false,
			locked: false,
			hidden: false,
			clips: [textClip]
		},
		{
			id: 'track_bg' as TrackId,
			kind: 'video',
			name: 'Background Frame',
			muted: false,
			locked: false,
			hidden: false,
			clips: [shapeClip]
		}
	];

	const publishedParams: PublishedTemplateParam[] = [
		{
			id: 'param_title_text',
			name: 'Title Text',
			type: 'text',
			targetClipId: textClip.id,
			targetProperty: 'text.content',
			defaultValue: 'NEVER STOP\nTHE FUTURE IS CREATED TODAY'
		},
		{
			id: 'param_font_family',
			name: 'Font Family',
			type: 'font',
			targetClipId: textClip.id,
			targetProperty: 'text.fontFamily',
			defaultValue: 'Montserrat'
		},
		textSizeParam('param_text_size', 'Text Size', textClip.id, 64),
		{
			id: 'param_text_color',
			name: 'Text Color',
			type: 'color',
			targetClipId: textClip.id,
			targetProperty: 'text.fill',
			defaultValue: { r: 1, g: 1, b: 1, a: 1 }
		},
		{
			id: 'param_shape_fill',
			name: 'Accent / Background Color',
			type: 'color',
			targetClipId: shapeClip.id,
			targetProperty: 'shape.fill',
			defaultValue: { r: 0.04, g: 0.05, b: 0.08, a: 0.75 }
		},
		{
			id: 'param_shape_stroke',
			name: 'Border Color',
			type: 'color',
			targetClipId: shapeClip.id,
			targetProperty: 'shape.stroke',
			defaultValue: { r: 1, g: 0.18, b: 0.48, a: 1 }
		}
	];

	const template = createTemplateFromClips({
		name: 'Kinetic Marquee Stack',
		category: 'Kinetic',
		description:
			'Streetwear kinetic typography with bold angular frame and punch zoom for music videos',
		author: 'TheFreeVideoEditor',
		clips: [textClip, shapeClip],
		tracks,
		publishedParams,
		responsiveTiming: { introDuration: 450_000, outroDuration: 450_000 },
		textScale: TEXT_SIZE_MAX_SCALE
	});
	template.id = 'kinetic-marquee-stack';
	return template;
}

/**
 * Kinetic type built from stacked layers: three lines, each on its own track, that reveal word by
 * word one after another while sliding up into place.
 */
export function createWordCascadeTemplate(): MotionGraphicTemplate {
	const duration = 5_000_000;
	const lines = [
		{ id: 'tpl_clip_line_1', name: 'Line 1', text: 'MAKE EVERY', y: -120, color: [1, 1, 1, 1] },
		{ id: 'tpl_clip_line_2', name: 'Line 2', text: 'WORD', y: 0, color: [0.98, 0.85, 0.2, 1] },
		{ id: 'tpl_clip_line_3', name: 'Line 3', text: 'COUNT', y: 120, color: [1, 1, 1, 1] }
	];

	const clips = lines.map((line, index): Clip => {
		const start = 300_000 + index * 450_000;
		const revealed = start + 450_000;
		return {
			id: line.id as ClipId,
			start: 0,
			duration,
			sourceIn: 0,
			sourceOut: duration,
			speed: 1,
			volume: 0,
			source: {
				type: 'text',
				text: line.text,
				style: {
					fontFamily: 'Montserrat',
					fontWeight: '900',
					alignment: 'center',
					letterSpacing: 4,
					revealUnit: 'word'
				},
				box: {
					autoSize: true,
					verticalAnchor: 'center',
					paddingX: 0,
					paddingY: 0,
					frameStyle: 'none'
				}
			},
			properties: {
				'text.fontSize': { value: 96 },
				'text.fillColor': { value: line.color },
				'text.letterSpacing': { value: 4 },
				'text.lineHeight': { value: 1.2 },
				'text.reveal': {
					keyframes: [
						{ time: 0, value: 0, interpolation: 'linear' },
						{ time: start, value: 0, interpolation: 'linear' },
						{ time: revealed, value: 1, interpolation: 'linear' }
					]
				},
				position: {
					keyframes: [
						{ time: 0, value: [0, line.y + 40], interpolation: 'linear' },
						{ time: start, value: [0, line.y + 40], interpolation: 'linear' },
						{
							time: revealed,
							value: [0, line.y],
							interpolation: 'bezier',
							easeOut: { x: 0.16, y: 1 },
							easeIn: { x: 0.3, y: 1 }
						}
					]
				},
				opacity: {
					keyframes: [
						{ time: 0, value: 1, interpolation: 'linear' },
						{ time: duration - 400_000, value: 1, interpolation: 'linear' },
						{ time: duration, value: 0, interpolation: 'linear' }
					]
				}
			},
			effects: []
		};
	});

	const tracks: Track[] = clips.map((clip, index) => ({
		id: `track_line_${index + 1}` as TrackId,
		kind: 'video',
		name: lines[index]!.name,
		muted: false,
		locked: false,
		hidden: false,
		clips: [clip]
	}));

	const publishedParams: PublishedTemplateParam[] = [];
	lines.forEach((line, index) => {
		const n = index + 1;
		publishedParams.push(
			{
				id: `param_line_${n}_text`,
				name: `Line ${n} Text`,
				type: 'text',
				targetClipId: line.id as ClipId,
				targetProperty: 'text.content',
				defaultValue: line.text
			},
			textSizeParam(`param_line_${n}_size`, `Line ${n} Size`, line.id as ClipId, 96),
			{
				id: `param_line_${n}_color`,
				name: `Line ${n} Color`,
				type: 'color',
				targetClipId: line.id as ClipId,
				targetProperty: 'text.fill',
				defaultValue: arrayToRgba(line.color)
			}
		);
	});

	const template = createTemplateFromClips({
		name: 'Word Cascade',
		category: 'Kinetic',
		description:
			'Three stacked lines of bold type that reveal word by word and slide into place, one after the other',
		author: 'TheFreeVideoEditor',
		clips,
		tracks,
		publishedParams,
		responsiveTiming: { introDuration: 1_650_000, outroDuration: 400_000 },
		textScale: TEXT_SIZE_MAX_SCALE
	});
	template.id = 'word-cascade';
	return template;
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
			height: 80,
			cornerRadius: 4,
			fillColor: { r: 0.0, g: 0.82, b: 0.95, a: 1 },
			strokeWidth: 0
		},
		properties: {
			position: { value: [-360, -3] },
			scale: {
				keyframes: [
					{
						time: 0,
						value: [1, 0],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 },
						easeIn: { x: 0.3, y: 1 }
					},
					{ time: 300_000, value: [1, 1.12], interpolation: 'linear' },
					{ time: 450_000, value: [1, 1.0], interpolation: 'linear' },
					{
						time: 5_100_000,
						value: [1, 1.0],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 },
						anchor: 'end'
					},
					{ time: 5_400_000, value: [1, 0.0], interpolation: 'linear', anchor: 'end' }
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 200_000, value: 1, interpolation: 'linear' },
					{ time: 5_100_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 5_400_000, value: 0, interpolation: 'linear', anchor: 'end' }
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
				verticalAnchor: 'bottom',
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
			position: { value: [-320, 8] },
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
					{ time: 4_600_000, value: [0, 0, 0, 0], interpolation: 'linear', anchor: 'end' },
					{ time: 5_100_000, value: [0, 0, 1, 0], interpolation: 'linear', anchor: 'end' }
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 500_000, value: 1, interpolation: 'linear' },
					{ time: 5_100_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 5_300_000, value: 0, interpolation: 'linear', anchor: 'end' }
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
			width: 110,
			height: 62,
			cornerRadius: 2,
			fillColor: { r: 1, g: 1, b: 1, a: 1 },
			strokeWidth: 0
		},
		properties: {
			position: {
				keyframes: [
					{ time: 0, value: [-265, -13], interpolation: 'linear' },
					{
						time: 450_000,
						value: [-265, -13],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 }
					},
					{ time: 850_000, value: [-76, -13], interpolation: 'linear' },
					{ time: 1_250_000, value: [148, -13], interpolation: 'linear' },
					{ time: 1_400_000, value: [195, -13], interpolation: 'linear' },
					{ time: 4_450_000, value: [195, -13], interpolation: 'linear', anchor: 'end' },
					{
						time: 4_600_000,
						value: [148, -13],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 },
						anchor: 'end'
					},
					{ time: 4_850_000, value: [-76, -13], interpolation: 'linear', anchor: 'end' },
					{ time: 5_100_000, value: [-265, -13], interpolation: 'linear', anchor: 'end' }
				]
			},
			scale: {
				keyframes: [
					{ time: 0, value: [1, 1], interpolation: 'linear' },
					{ time: 1_250_000, value: [1, 1], interpolation: 'linear' },
					{ time: 1_400_000, value: [0.05, 1], interpolation: 'linear' },
					{ time: 4_450_000, value: [0.05, 1], interpolation: 'linear', anchor: 'end' },
					{ time: 4_600_000, value: [1, 1], interpolation: 'linear', anchor: 'end' },
					{ time: 5_000_000, value: [1, 1], interpolation: 'linear', anchor: 'end' },
					{ time: 5_150_000, value: [0.05, 1], interpolation: 'linear', anchor: 'end' }
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 450_000, value: 1, interpolation: 'linear' },
					{ time: 1_250_000, value: 1, interpolation: 'linear' },
					{ time: 1_400_000, value: 0, interpolation: 'linear' },
					{ time: 4_450_000, value: 0, interpolation: 'linear', anchor: 'end' },
					{ time: 4_600_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 5_000_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 5_150_000, value: 0, interpolation: 'linear', anchor: 'end' }
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
					{ time: 0, value: [-320, 32], interpolation: 'linear' },
					{
						time: 850_000,
						value: [-320, 32],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 }
					},
					{ time: 1_350_000, value: [-320, 18], interpolation: 'linear' },
					{
						time: 4_650_000,
						value: [-320, 18],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 },
						anchor: 'end'
					},
					{ time: 5_150_000, value: [-320, 32], interpolation: 'linear', anchor: 'end' }
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 850_000, value: 0, interpolation: 'linear' },
					{ time: 1_350_000, value: 1, interpolation: 'linear' },
					{ time: 4_650_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 5_150_000, value: 0, interpolation: 'linear', anchor: 'end' }
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

/**
 * Creates the Minimal Italic Split Title template (Mixkit 117 / Title 08):
 * Bold italic stacked typography ("MINIMAL" / "DESIGN") split by an expanding
 * horizontal divider line with synchronized left-to-right wipe reveals and
 * wide-spaced category eyebrow.
 */
export function createMixkitBoldItalicSplitTitleTemplate(): MotionGraphicTemplate {
	const duration = 7_000_000;

	// Track 1: Category Eyebrow Subtitle
	const eyebrowClip: Clip = {
		id: 'tpl_clip_eyebrow' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'text',
			text: '#PREMIRE PRO AND AFTER EFFECTS',
			style: {
				fontFamily: 'Kanit',
				fontWeight: '500',
				fontStyle: 'italic',
				alignment: 'left',
				letterSpacing: 3
			},
			box: {
				autoSize: true,
				verticalAnchor: 'center',
				paddingX: 12,
				paddingY: 6,
				frameStyle: 'none'
			},
			colorRuns: [],
			graphicTemplateId: 'mixkit-bold-italic-split-title'
		},
		properties: {
			position: { value: [-270, -155] },
			'text.fontSize': { value: 24 },
			'text.fillColor': { value: [1, 1, 1, 1] },
			'text.letterSpacing': { value: 3 },
			'text.lineHeight': { value: 1.2 },
			crop: {
				keyframes: [
					{ time: 0, value: [0, 0, 1, 0], interpolation: 'linear' },
					{ time: 600_000, value: [0, 0, 1, 0], interpolation: 'linear' },
					{
						time: 1_650_000,
						value: [0, 0, 0, 0],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 }
					},
					{ time: 5_300_000, value: [0, 0, 0, 0], interpolation: 'linear', anchor: 'end' },
					{
						time: 6_250_000,
						value: [0, 0, 1, 0],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 },
						anchor: 'end'
					}
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 600_000, value: 0, interpolation: 'linear' },
					{ time: 1_000_000, value: 1, interpolation: 'linear' },
					{ time: 6_100_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 6_300_000, value: 0, interpolation: 'linear', anchor: 'end' }
				]
			}
		}
	};

	// Track 2: Title Top ("MINIMAL")
	const titleTopClip: Clip = {
		id: 'tpl_clip_title_top' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'text',
			text: 'MINIMAL',
			style: {
				fontFamily: 'Kanit',
				fontWeight: '900',
				fontStyle: 'italic',
				alignment: 'center',
				letterSpacing: 2
			},
			box: {
				autoSize: true,
				verticalAnchor: 'center',
				paddingX: 20,
				paddingY: 10,
				frameStyle: 'none'
			},
			colorRuns: [],
			graphicTemplateId: 'mixkit-bold-italic-split-title'
		},
		properties: {
			position: { value: [0, -68] },
			'text.fontSize': { value: 120 },
			'text.fillColor': { value: [1, 1, 1, 1] },
			'text.letterSpacing': { value: 2 },
			'text.lineHeight': { value: 1.1 },
			crop: {
				keyframes: [
					{ time: 0, value: [0, 0, 1, 0], interpolation: 'linear' },
					{ time: 350_000, value: [0, 0, 1, 0], interpolation: 'linear' },
					{
						time: 1_500_000,
						value: [0, 0, 0, 0],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 }
					},
					{ time: 5_400_000, value: [0, 0, 0, 0], interpolation: 'linear', anchor: 'end' },
					{
						time: 6_450_000,
						value: [0, 0, 1, 0],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 },
						anchor: 'end'
					}
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 300_000, value: 1, interpolation: 'linear' },
					{ time: 6_400_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 6_550_000, value: 0, interpolation: 'linear', anchor: 'end' }
				]
			}
		}
	};

	// Track 3: Horizontal Center Divider Line
	const dividerLineClip: Clip = {
		id: 'tpl_clip_line' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'shape',
			shapeType: 'rect',
			width: 680,
			height: 4,
			cornerRadius: 2,
			fillColor: { r: 1, g: 1, b: 1, a: 1 },
			strokeWidth: 0
		},
		properties: {
			position: { value: [0, 0] },
			crop: {
				keyframes: [
					{ time: 0, value: [0, 0, 1, 0], interpolation: 'linear' },
					{ time: 250_000, value: [0, 0, 1, 0], interpolation: 'linear' },
					{
						time: 1_400_000,
						value: [0, 0, 0, 0],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 }
					},
					{ time: 5_400_000, value: [0, 0, 0, 0], interpolation: 'linear', anchor: 'end' },
					{
						time: 6_500_000,
						value: [0, 0, 1, 0],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 },
						anchor: 'end'
					}
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 200_000, value: 1, interpolation: 'linear' },
					{ time: 6_450_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 6_600_000, value: 0, interpolation: 'linear', anchor: 'end' }
				]
			}
		}
	};

	// Track 4: Title Bottom ("DESIGN")
	const titleBottomClip: Clip = {
		id: 'tpl_clip_title_bottom' as ClipId,
		start: 0,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'text',
			text: 'DESIGN',
			style: {
				fontFamily: 'Kanit',
				fontWeight: '900',
				fontStyle: 'italic',
				alignment: 'center',
				letterSpacing: 2
			},
			box: {
				autoSize: true,
				verticalAnchor: 'center',
				paddingX: 20,
				paddingY: 10,
				frameStyle: 'none'
			},
			colorRuns: [],
			graphicTemplateId: 'mixkit-bold-italic-split-title'
		},
		properties: {
			position: { value: [0, 68] },
			'text.fontSize': { value: 120 },
			'text.fillColor': { value: [1, 1, 1, 1] },
			'text.letterSpacing': { value: 2 },
			'text.lineHeight': { value: 1.1 },
			crop: {
				keyframes: [
					{ time: 0, value: [0, 0, 1, 0], interpolation: 'linear' },
					{ time: 350_000, value: [0, 0, 1, 0], interpolation: 'linear' },
					{
						time: 1_500_000,
						value: [0, 0, 0, 0],
						interpolation: 'bezier',
						easeOut: { x: 0.16, y: 1 }
					},
					{ time: 5_400_000, value: [0, 0, 0, 0], interpolation: 'linear', anchor: 'end' },
					{
						time: 6_450_000,
						value: [0, 0, 1, 0],
						interpolation: 'bezier',
						easeIn: { x: 0.3, y: 1 },
						anchor: 'end'
					}
				]
			},
			opacity: {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 300_000, value: 1, interpolation: 'linear' },
					{ time: 6_400_000, value: 1, interpolation: 'linear', anchor: 'end' },
					{ time: 6_550_000, value: 0, interpolation: 'linear', anchor: 'end' }
				]
			}
		}
	};

	const tracks: Track[] = [
		{
			id: 'tpl_trk_eyebrow' as TrackId,
			kind: 'video',
			name: 'Eyebrow Subtitle',
			muted: false,
			locked: false,
			hidden: false,
			clips: [eyebrowClip]
		},
		{
			id: 'tpl_trk_title_top' as TrackId,
			kind: 'video',
			name: 'Title Top',
			muted: false,
			locked: false,
			hidden: false,
			clips: [titleTopClip]
		},
		{
			id: 'tpl_trk_line' as TrackId,
			kind: 'video',
			name: 'Divider Line',
			muted: false,
			locked: false,
			hidden: false,
			clips: [dividerLineClip]
		},
		{
			id: 'tpl_trk_title_bottom' as TrackId,
			kind: 'video',
			name: 'Title Bottom',
			muted: false,
			locked: false,
			hidden: false,
			clips: [titleBottomClip]
		}
	];

	const publishedParams: PublishedTemplateParam[] = [
		{
			id: 'param_title_1',
			name: 'Title Top Text',
			type: 'text',
			targetClipId: 'tpl_clip_title_top' as ClipId,
			targetProperty: 'text.content',
			defaultValue: 'MINIMAL'
		},
		{
			id: 'param_title_2',
			name: 'Title Bottom Text',
			type: 'text',
			targetClipId: 'tpl_clip_title_bottom' as ClipId,
			targetProperty: 'text.content',
			defaultValue: 'DESIGN'
		},
		{
			id: 'param_subtitle',
			name: 'Eyebrow Subtitle',
			type: 'text',
			targetClipId: 'tpl_clip_eyebrow' as ClipId,
			targetProperty: 'text.content',
			defaultValue: '#PREMIRE PRO AND AFTER EFFECTS'
		},
		{
			id: 'param_font_family',
			name: 'Font Family',
			type: 'font',
			targetClipId: 'tpl_clip_title_top' as ClipId,
			targetProperty: 'text.fontFamily',
			defaultValue: 'Kanit'
		},
		{
			id: 'param_title_size',
			name: 'Title Size',
			type: 'number',
			targetClipId: 'tpl_clip_title_top' as ClipId,
			targetProperty: 'text.fontSize',
			defaultValue: 120,
			min: 60,
			max: 180,
			step: 2
		},
		{
			id: 'param_color_top',
			name: 'Color Top',
			type: 'color',
			targetClipId: 'tpl_clip_title_top' as ClipId,
			targetProperty: 'text.fill',
			defaultValue: { r: 1, g: 1, b: 1, a: 1 }
		},
		{
			id: 'param_color_bottom',
			name: 'Color Bottom',
			type: 'color',
			targetClipId: 'tpl_clip_title_bottom' as ClipId,
			targetProperty: 'text.fill',
			defaultValue: { r: 1, g: 1, b: 1, a: 1 }
		},
		{
			id: 'param_color_eyebrow',
			name: 'Color Eyebrow',
			type: 'color',
			targetClipId: 'tpl_clip_eyebrow' as ClipId,
			targetProperty: 'text.fill',
			defaultValue: { r: 1, g: 1, b: 1, a: 1 }
		},
		{
			id: 'param_color_line',
			name: 'Color Line',
			type: 'color',
			targetClipId: 'tpl_clip_line' as ClipId,
			targetProperty: 'shape.fill',
			defaultValue: { r: 1, g: 1, b: 1, a: 1 }
		}
	];

	return {
		version: 1,
		id: 'mixkit-bold-italic-split-title',
		name: 'Minimal Italic Split Title',
		category: 'Titles',
		description:
			'Bold high-energy italic title with central dividing split line and synchronized left-to-right wipe reveals, inspired by Mixkit 117',
		author: 'TheFreeVideoEditor',
		createdAt: 1792688800000,
		duration,
		responsiveTiming: {
			introDuration: 1_800_000,
			outroDuration: 1_400_000
		},
		bounds: {
			width: 1500,
			height: 600,
			originX: 0,
			originY: 0
		},
		tracks,
		publishedParams
	};
}
