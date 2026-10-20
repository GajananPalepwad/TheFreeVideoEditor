import type { Clip, Keyframe, PropertyId, TextStyle, TextBox } from '../types';

export interface TextTemplatePreset {
	id: string;
	name: string;
	description: string;
	text: string;
	style: TextStyle;
	box: TextBox;
	properties: Record<PropertyId, number | number[]>;
}

export interface TextAnimationPreset {
	id: string;
	name: string;
	description: string;
	duration: number; // in microseconds
	kind: 'in' | 'out' | 'emphasis';
	keyframes: Record<PropertyId, Keyframe<number | number[]>[]>;
}

/**
 * 7 Curated Text Template Presets as specified in Gate O:
 * 1. Title: large centered title
 * 2. Subtitle: standard bottom-centered subtitle
 * 3. Lower third: left-aligned news / interview tag with background box
 * 4. Bold outline: high-impact bold headline with thick dark stroke
 * 5. Neon glow: futuristic bright colored title with glow/shadow
 * 6. Typewriter caption: clean typewriter caption
 * 7. Pop-in caption: punchy animated modern social caption
 */
export const TEXT_TEMPLATE_PRESETS: readonly TextTemplatePreset[] = [
	{
		id: 'title',
		name: 'Title',
		description: 'Large, clean centered title headline',
		text: 'TITLE HEADLINE',
		style: {
			fontFamily: 'Montserrat',
			fontWeight: '700',
			alignment: 'center',
			letterSpacing: 2
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center'
		},
		properties: {
			'text.fontSize': 72,
			'text.fillColor': [1, 1, 1, 1],
			'text.strokeWidth': 0,
			'text.letterSpacing': 2,
			'text.lineHeight': 1.1,
			'text.reveal': 1,
			opacity: 1
		}
	},
	{
		id: 'subtitle',
		name: 'Subtitle',
		description: 'Readable bottom-anchored subtitle',
		text: 'Here is an important subtitle explanation for the scene.',
		style: {
			fontFamily: 'Inter',
			fontWeight: '500',
			alignment: 'center',
			letterSpacing: 0
		},
		box: {
			autoSize: false,
			width: 900,
			verticalAnchor: 'bottom',
			paddingX: 20,
			paddingY: 12
		},
		properties: {
			position: [0, 380], // lower third / bottom center
			'text.fontSize': 36,
			'text.fillColor': [1, 1, 1, 1],
			'text.strokeColor': [0, 0, 0, 0.9],
			'text.strokeWidth': 3,
			'text.letterSpacing': 0,
			'text.lineHeight': 1.3,
			'text.reveal': 1,
			opacity: 1
		}
	},
	{
		id: 'lower-third',
		name: 'Lower Third',
		description: 'Left-aligned interview or presenter badge',
		text: 'ALEX RIVERA\nLead Creative Director',
		style: {
			fontFamily: 'Inter',
			fontWeight: '600',
			alignment: 'left',
			letterSpacing: 1
		},
		box: {
			autoSize: false,
			width: 600,
			verticalAnchor: 'center',
			paddingX: 24,
			paddingY: 16
		},
		properties: {
			position: [-300, 360],
			'text.fontSize': 32,
			'text.fillColor': [1, 1, 1, 1],
			'text.strokeWidth': 0,
			'text.lineHeight': 1.25,
			'text.reveal': 1,
			opacity: 1
		}
	},
	{
		id: 'bold-outline',
		name: 'Bold Outline',
		description: 'High-contrast headline with heavy dark stroke',
		text: 'BREAKING NEWS',
		style: {
			fontFamily: 'Bebas Neue',
			fontWeight: 'bold',
			alignment: 'center',
			letterSpacing: 3
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center'
		},
		properties: {
			'text.fontSize': 84,
			'text.fillColor': [1, 0.9, 0.1, 1], // bright yellow
			'text.strokeColor': [0, 0, 0, 1],
			'text.strokeWidth': 8,
			'text.letterSpacing': 3,
			'text.lineHeight': 1.0,
			'text.reveal': 1,
			opacity: 1
		}
	},
	{
		id: 'neon-glow',
		name: 'Neon Glow',
		description: 'Vibrant cyberpunk neon styling',
		text: 'CYBER NIGHTS',
		style: {
			fontFamily: 'Montserrat',
			fontWeight: '800',
			fontStyle: 'italic',
			alignment: 'center',
			letterSpacing: 4
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center'
		},
		properties: {
			'text.fontSize': 68,
			'text.fillColor': [0.2, 0.95, 1, 1], // electric cyan
			'text.strokeColor': [0, 0.4, 0.9, 0.8],
			'text.strokeWidth': 4,
			'text.letterSpacing': 4,
			'text.lineHeight': 1.1,
			'text.reveal': 1,
			opacity: 1
		}
	},
	{
		id: 'typewriter-caption',
		name: 'Typewriter Caption',
		description: 'Monospaced script or coding documentary caption',
		text: 'const message = "System online";',
		style: {
			fontFamily: 'Roboto Mono',
			fontWeight: 'normal',
			alignment: 'left',
			letterSpacing: 0
		},
		box: {
			autoSize: false,
			width: 720,
			verticalAnchor: 'center',
			paddingX: 20,
			paddingY: 16
		},
		properties: {
			'text.fontSize': 34,
			'text.fillColor': [0.3, 1, 0.4, 1], // terminal green
			'text.strokeWidth': 0,
			'text.lineHeight': 1.4,
			'text.reveal': 1,
			opacity: 1
		}
	},
	{
		id: 'pop-in-caption',
		name: 'Pop-in Caption',
		description: 'Punchy social media highlight text',
		text: 'WAIT FOR IT! 🔥',
		style: {
			fontFamily: 'Montserrat',
			fontWeight: '900',
			alignment: 'center',
			letterSpacing: 1
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center'
		},
		properties: {
			'text.fontSize': 76,
			'text.fillColor': [1, 1, 1, 1],
			'text.strokeColor': [0, 0, 0, 1],
			'text.strokeWidth': 6,
			'text.letterSpacing': 1,
			'text.lineHeight': 1.1,
			'text.reveal': 1,
			scale: [1, 1],
			opacity: 1
		}
	}
];

/**
 * Text Animation Presets:
 * 1. Fade In (0.5s)
 * 2. Fade Out (0.5s)
 * 3. Slide In Up (0.6s)
 * 4. Slide In Down (0.6s)
 * 5. Slide In Left (0.6s)
 * 6. Slide In Right (0.6s)
 * 7. Pop In (0.5s bezier: scale 0.6 -> 1.05 -> 1.0)
 * 8. Typewriter (1.5s: reveal 0 -> 1)
 */
export const TEXT_ANIMATION_PRESETS: readonly TextAnimationPreset[] = [
	{
		id: 'fade-in',
		name: 'Fade In',
		description: 'Smooth opacity fade in over 0.5s',
		duration: 500_000,
		kind: 'in',
		keyframes: {
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 500_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'fade-out',
		name: 'Fade Out',
		description: 'Smooth opacity fade out over 0.5s at clip end',
		duration: 500_000,
		kind: 'out',
		keyframes: {
			opacity: [
				{ time: 0, value: 1, interpolation: 'linear' },
				{ time: 500_000, value: 0, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'slide-in-up',
		name: 'Slide In Up',
		description: 'Slide up into place with ease-out curve',
		duration: 600_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [0, 150],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 600_000, value: [0, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 300_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'slide-in-down',
		name: 'Slide In Down',
		description: 'Slide down into place with ease-out curve',
		duration: 600_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [0, -150],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 600_000, value: [0, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 300_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'slide-in-left',
		name: 'Slide In Left',
		description: 'Slide in from left with smooth decel',
		duration: 600_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [-250, 0],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 600_000, value: [0, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 300_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'slide-in-right',
		name: 'Slide In Right',
		description: 'Slide in from right with smooth decel',
		duration: 600_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [250, 0],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 600_000, value: [0, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 300_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'pop-in',
		name: 'Pop In',
		description: 'Punchy scale overshoot pop (0.6 -> 1.05 -> 1.0)',
		duration: 500_000,
		kind: 'in',
		keyframes: {
			scale: [
				{
					time: 0,
					value: [0.6, 0.6],
					interpolation: 'bezier',
					easeOut: { x: 0.34, y: 1.56 },
					easeIn: { x: 0.64, y: 1 }
				},
				{
					time: 350_000,
					value: [1.05, 1.05],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 500_000, value: [1.0, 1.0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 200_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'typewriter',
		name: 'Typewriter',
		description: 'Sequential reveal of characters from 0% to 100%',
		duration: 1_500_000,
		kind: 'in',
		keyframes: {
			'text.reveal': [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 1_500_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'whip-slide-left',
		name: 'Whip Slide Left',
		description: 'Lightning-fast whip pan slide with aggressive deceleration',
		duration: 450_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [-380, 0],
					interpolation: 'bezier',
					easeOut: { x: 0.05, y: 0.95 },
					easeIn: { x: 0.1, y: 1 }
				},
				{ time: 450_000, value: [0, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 180_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'whip-slide-right',
		name: 'Whip Slide Right',
		description: 'Lightning-fast whip slide from right edge',
		duration: 450_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [380, 0],
					interpolation: 'bezier',
					easeOut: { x: 0.05, y: 0.95 },
					easeIn: { x: 0.1, y: 1 }
				},
				{ time: 450_000, value: [0, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 180_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'elastic-spring',
		name: 'Elastic Spring Bounce',
		description: 'High-end AE spring overshoot with multi-bounce settling',
		duration: 700_000,
		kind: 'in',
		keyframes: {
			scale: [
				{
					time: 0,
					value: [0.2, 0.2],
					interpolation: 'bezier',
					easeOut: { x: 0.34, y: 1.56 },
					easeIn: { x: 0.64, y: 1 }
				},
				{
					time: 420_000,
					value: [1.14, 1.14],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 560_000, value: [0.96, 0.96], interpolation: 'linear' },
				{ time: 700_000, value: [1.0, 1.0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 180_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'cinematic-reveal',
		name: 'Cinematic Letterbox Reveal',
		description: 'Dramatic slow push with tracking expansion and film dissolve',
		duration: 900_000,
		kind: 'in',
		keyframes: {
			scale: [
				{
					time: 0,
					value: [0.95, 0.95],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 900_000, value: [1.03, 1.03], interpolation: 'linear' }
			],
			'text.letterSpacing': [
				{
					time: 0,
					value: 12,
					interpolation: 'bezier',
					easeOut: { x: 0.16, y: 1 },
					easeIn: { x: 0.3, y: 1 }
				},
				{ time: 900_000, value: 3, interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 650_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'broadcast-lower-third-in',
		name: 'Broadcast Lower Third Entrance',
		description: 'Television-style smooth horizontal lockup slide with accent lead',
		duration: 550_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [-320, 0],
					interpolation: 'bezier',
					easeOut: { x: 0.16, y: 1 },
					easeIn: { x: 0.3, y: 1 }
				},
				{ time: 550_000, value: [0, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 260_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'pop-pill-in',
		name: 'Pop Pill Badge',
		description: 'Snappy overshoot pop-up tailored for badges, pills, and buttons',
		duration: 420_000,
		kind: 'in',
		keyframes: {
			scale: [
				{
					time: 0,
					value: [0.35, 0.35],
					interpolation: 'bezier',
					easeOut: { x: 0.34, y: 1.56 },
					easeIn: { x: 0.64, y: 1 }
				},
				{ time: 280_000, value: [1.1, 1.1], interpolation: 'linear' },
				{ time: 420_000, value: [1.0, 1.0], interpolation: 'linear' }
			],
			position: [
				{
					time: 0,
					value: [0, 35],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 420_000, value: [0, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 160_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'whip-out-left',
		name: 'Whip Out Left (End)',
		description: 'Aggressive whip pan exit at clip ending',
		duration: 400_000,
		kind: 'out',
		keyframes: {
			position: [
				{
					time: 0,
					value: [0, 0],
					interpolation: 'bezier',
					easeOut: { x: 0.7, y: 0 },
					easeIn: { x: 0.84, y: 0 }
				},
				{ time: 400_000, value: [-450, 0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 1, interpolation: 'linear' },
				{ time: 400_000, value: 0, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'zoom-fade-out',
		name: 'Cinematic Zoom Out (End)',
		description: 'Slow push scale expansion with dissolve exit',
		duration: 500_000,
		kind: 'out',
		keyframes: {
			scale: [
				{ time: 0, value: [1.0, 1.0], interpolation: 'linear' },
				{ time: 500_000, value: [1.15, 1.15], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 1, interpolation: 'linear' },
				{ time: 500_000, value: 0, interpolation: 'linear' }
			]
		}
	}
];

/** Squeezes a preset into `available` microseconds so its keys never land past the clip end. */
export function fitPresetToDuration(
	preset: TextAnimationPreset,
	available: number
): TextAnimationPreset {
	if (available <= 0 || preset.duration <= available) return preset;
	const scale = available / preset.duration;
	return {
		...preset,
		duration: available,
		keyframes: Object.fromEntries(
			Object.entries(preset.keyframes).map(([propertyId, keys]) => [
				propertyId,
				keys.map((key) => ({ ...key, time: Math.round(key.time * scale) }))
			])
		)
	};
}

/**
 * Applies an animation preset to a clip.
 * For 'in' presets, keyframes start at time 0.
 * For 'out' presets, keyframes start at (clip.duration - preset.duration).
 * A preset longer than the clip is squeezed to the clip's length.
 */
export function applyTextAnimationPreset(clip: Clip, presetId: string): Clip {
	const found = TEXT_ANIMATION_PRESETS.find((p) => p.id === presetId);
	if (!found) return clip;
	const preset = fitPresetToDuration(found, clip.duration);

	const properties = { ...(clip.properties ?? {}) };
	const isOut = preset.kind === 'out';
	const baseTime = isOut ? Math.max(0, clip.duration - preset.duration) : 0;

	for (const [propId, keyframes] of Object.entries(preset.keyframes)) {
		const offsetKeyframes = keyframes.map((kf) => ({
			...kf,
			time: baseTime + kf.time
		}));

		// Keep any existing keyframes that don't collide with the preset time range
		const existingCurve = properties[propId];
		let survivingKeyframes: Keyframe<unknown>[] = [];
		if (existingCurve && 'keyframes' in existingCurve) {
			const presetStart = baseTime;
			const presetEnd = baseTime + preset.duration;
			survivingKeyframes = (existingCurve.keyframes as Keyframe<unknown>[]).filter(
				(k) => k.time < presetStart || k.time > presetEnd
			);
		}

		const mergedKeyframes = [...survivingKeyframes, ...offsetKeyframes].sort(
			(a, b) => a.time - b.time
		);

		properties[propId] = {
			keyframes: mergedKeyframes as unknown as Keyframe<number | number[]>[]
		};
	}

	return {
		...clip,
		properties
	};
}

/**
 * Clears text animation keyframes from a clip for the specified or all text/transform properties.
 */
export function clearTextAnimations(clip: Clip, propertyIds?: readonly PropertyId[]): Clip {
	if (!clip.properties) return clip;
	const properties = { ...clip.properties };

	const targetIds =
		propertyIds ??
		([
			'position',
			'scale',
			'rotation',
			'opacity',
			'text.reveal',
			'text.fontSize',
			'text.letterSpacing',
			'text.lineHeight'
		] as PropertyId[]);

	for (const id of targetIds) {
		const val = properties[id];
		if (val && 'keyframes' in val && val.keyframes.length > 0) {
			// Convert keyframe animation back to static value at first keyframe or fallback
			const firstVal = val.keyframes[0]?.value ?? 0;
			properties[id] = { value: firstVal };
		}
	}

	return {
		...clip,
		properties
	};
}

/**
 * Applies a full template preset (style, box, default properties, and optional text) to a clip.
 */
export function applyTextTemplatePreset(
	clip: Clip,
	templateId: string,
	keepExistingText: boolean = true
): Clip {
	const template = TEXT_TEMPLATE_PRESETS.find((t) => t.id === templateId);
	if (!template || clip.source?.type !== 'text') return clip;

	const properties = { ...(clip.properties ?? {}) };
	for (const [propId, val] of Object.entries(template.properties)) {
		properties[propId] = { value: val };
	}

	return {
		...clip,
		source: {
			...clip.source,
			text: keepExistingText && clip.source.text ? clip.source.text : template.text,
			style: { ...template.style },
			box: { ...template.box }
		},
		properties
	};
}
