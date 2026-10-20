import type {
	Clip,
	Keyframe,
	PropertyId,
	Time,
	TextStyle,
	TextBox,
	TextColorRun,
	AnimatedValue
} from '../types';
import {
	TEXT_ANIMATION_PRESETS,
	fitPresetToDuration,
	type TextAnimationPreset
} from './presets';

export type GraphicCategory =
	| 'all'
	| 'kinetic'
	| 'lower-third'
	| 'titles'
	| 'social'
	| 'callouts'
	| 'minimal'
	| 'badge'
	| 'neon';

export interface GraphicAnimationPreset extends TextAnimationPreset {
	category?: 'in' | 'out' | 'emphasis';
}

export interface GraphicTemplate {
	id: string;
	name: string;
	category: Exclude<GraphicCategory, 'all'>;
	description: string;
	tags: string[];
	defaultText: string;
	primaryLine: string;
	secondaryLine?: string;
	tertiaryLine?: string;
	highlightWord?: string;
	frameStyle?: import('../types').GraphicFrameStyle;
	badgeText?: string;
	style: TextStyle;
	box: TextBox;
	properties: Record<PropertyId, number | number[]>;
	animationPresetId: string;
	inDurationUs: number;
	outDurationUs?: number;
	accentColor: { r: number; g: number; b: number; a: number };
	previewColors: {
		background: string;
		primary: string;
		accent: string;
		badge?: string;
	};
}

/**
 * Extended Animation Presets for Motion Graphic Titles:
 * Combines core text animation presets with advanced kinetic motion presets
 * (Zoom punch, Bouncy drop, Split slide, Glitch snap, Smooth drift, etc.)
 */
const EXTRA_GRAPHIC_ANIMATIONS: readonly TextAnimationPreset[] = [
	{
		id: 'kinetic-zoom',
		name: 'Kinetic Zoom',
		description: 'Dynamic snap zoom punch (0.3 -> 1.08 -> 1.0) with rapid opacity fade',
		duration: 450_000,
		kind: 'in',
		keyframes: {
			scale: [
				{
					time: 0,
					value: [0.3, 0.3],
					interpolation: 'bezier',
					easeOut: { x: 0.16, y: 1 },
					easeIn: { x: 0.3, y: 1 }
				},
				{
					time: 320_000,
					value: [1.08, 1.08],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 450_000, value: [1.0, 1.0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 180_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'bounce-in',
		name: 'Bouncy Spring Drop',
		description: 'Playful bouncy drop from top with squash-and-stretch scale settling',
		duration: 600_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [0, -180],
					interpolation: 'bezier',
					easeOut: { x: 0.34, y: 1.56 },
					easeIn: { x: 0.64, y: 1 }
				},
				{
					time: 420_000,
					value: [0, 15],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 600_000, value: [0, 0], interpolation: 'linear' }
			],
			scale: [
				{ time: 0, value: [0.85, 1.15], interpolation: 'linear' },
				{ time: 420_000, value: [1.05, 0.95], interpolation: 'linear' },
				{ time: 600_000, value: [1.0, 1.0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 200_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'split-slide',
		name: 'Split Slide & Snap',
		description: 'Sharp horizontal slide with subtle angular rotation snap',
		duration: 500_000,
		kind: 'in',
		keyframes: {
			position: [
				{
					time: 0,
					value: [-180, 0],
					interpolation: 'bezier',
					easeOut: { x: 0.25, y: 0.1 },
					easeIn: { x: 0.25, y: 1 }
				},
				{ time: 500_000, value: [0, 0], interpolation: 'linear' }
			],
			rotation: [
				{ time: 0, value: -3, interpolation: 'bezier' },
				{ time: 500_000, value: 0, interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 250_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'glitch-snap',
		name: 'Glitch Strobe In',
		description: 'Cyberpunk rapid flicker strobe with impact scale punch',
		duration: 350_000,
		kind: 'in',
		keyframes: {
			scale: [
				{ time: 0, value: [1.15, 0.9], interpolation: 'linear' },
				{ time: 100_000, value: [0.95, 1.05], interpolation: 'linear' },
				{ time: 350_000, value: [1.0, 1.0], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'hold' },
				{ time: 80_000, value: 1, interpolation: 'hold' },
				{ time: 140_000, value: 0.25, interpolation: 'hold' },
				{ time: 200_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'smooth-drift',
		name: 'Cinematic Drift',
		description: 'Slow elegant drift and opacity dissolve for luxury or documentary',
		duration: 800_000,
		kind: 'in',
		keyframes: {
			scale: [
				{ time: 0, value: [0.95, 0.95], interpolation: 'linear' },
				{ time: 800_000, value: [1.02, 1.02], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 0, interpolation: 'linear' },
				{ time: 600_000, value: 1, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'pop-out',
		name: 'Pop Out (End)',
		description: 'Punchy scale overshoot pop down and fade out at clip end',
		duration: 400_000,
		kind: 'out',
		keyframes: {
			scale: [
				{ time: 0, value: [1.0, 1.0], interpolation: 'bezier' },
				{ time: 150_000, value: [1.08, 1.08], interpolation: 'linear' },
				{ time: 400_000, value: [0.4, 0.4], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 1, interpolation: 'linear' },
				{ time: 400_000, value: 0, interpolation: 'linear' }
			]
		}
	},
	{
		id: 'slide-out-down',
		name: 'Slide Out Down (End)',
		description: 'Smooth slide down and fade out at clip end',
		duration: 450_000,
		kind: 'out',
		keyframes: {
			position: [
				{ time: 0, value: [0, 0], interpolation: 'linear' },
				{ time: 450_000, value: [0, 120], interpolation: 'linear' }
			],
			opacity: [
				{ time: 0, value: 1, interpolation: 'linear' },
				{ time: 450_000, value: 0, interpolation: 'linear' }
			]
		}
	}
];

export const GRAPHIC_ANIMATION_PRESETS: readonly TextAnimationPreset[] = [
	...TEXT_ANIMATION_PRESETS,
	...EXTRA_GRAPHIC_ANIMATIONS
];

/**
 * 16 Curated Editable Motion Graphic Templates
 * Modeled after professional kinetic typography & After Effects motion design packages
 */
export const GRAPHIC_TEMPLATES: readonly GraphicTemplate[] = [
	{
		id: 'cinematic-blockbuster',
		name: 'Cinematic Blockbuster',
		category: 'titles',
		description: 'Dramatic slow-push letterbox title with wide tracking for movie trailers and epic film intros',
		tags: ['title', 'cinematic', 'trailer', 'movie', 'epic', 'blockbuster', 'gold'],
		defaultText: 'THE HORIZON\nAN EPIC ADVENTURE BEGINS',
		primaryLine: 'THE HORIZON',
		secondaryLine: 'AN EPIC ADVENTURE BEGINS',
		frameStyle: 'cinematic-box',
		accentColor: { r: 0.95, g: 0.78, b: 0.35, a: 1.0 },
		style: {
			fontFamily: 'Montserrat',
			fontWeight: '900',
			alignment: 'center',
			letterSpacing: 8
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 40,
			paddingY: 24,
			frameStyle: 'cinematic-box'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 64,
			'text.letterSpacing': 8,
			'text.fillColor': [1, 1, 1, 1],
			'text.lineHeight': 1.3,
			opacity: 1
		},
		animationPresetId: 'cinematic-reveal',
		inDurationUs: 900_000,
		outDurationUs: 600_000,
		previewColors: {
			background: '#0a0a0f',
			primary: '#ffffff',
			accent: '#f5c759'
		}
	},
	{
		id: 'modern-bold-punch',
		name: 'Modern Bold Punch',
		category: 'titles',
		description: 'Heavy punchy kinetic zoom typography with neon lime accent for product launches and ads',
		tags: ['title', 'bold', 'punch', 'kinetic', 'modern', 'marketing', 'neon'],
		defaultText: 'BOLD IMPACT\nFUTURE OF CREATIVE DESIGN',
		primaryLine: 'BOLD IMPACT',
		secondaryLine: 'FUTURE OF CREATIVE DESIGN',
		frameStyle: 'accent-bar',
		accentColor: { r: 0.65, g: 0.98, b: 0.2, a: 1.0 },
		style: {
			fontFamily: 'Montserrat',
			fontWeight: '900',
			alignment: 'left',
			letterSpacing: -1
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 28,
			paddingY: 16,
			frameStyle: 'accent-bar',
			accentBarColor: { r: 0.65, g: 0.98, b: 0.2, a: 1.0 },
			accentBarWidth: 16
		},
		properties: {
			position: [-160, 0],
			'text.fontSize': 68,
			'text.letterSpacing': -1,
			'text.fillColor': [1, 1, 1, 1],
			'text.accentBarColor': [0.65, 0.98, 0.2, 1],
			'text.accentBarWidth': 16,
			'text.lineHeight': 1.15,
			opacity: 1
		},
		animationPresetId: 'kinetic-zoom',
		inDurationUs: 450_000,
		outDurationUs: 400_000,
		previewColors: {
			background: '#0d1117',
			primary: '#ffffff',
			accent: '#a6fa33'
		}
	},
	{
		id: 'minimal-editorial',
		name: 'Minimal Editorial',
		category: 'titles',
		description: 'Refined luxury editorial title with upward slide and divided frame for fashion and art',
		tags: ['title', 'minimal', 'editorial', 'fashion', 'luxury', 'art', 'clean'],
		defaultText: 'EDITORIAL VOL. 10\nAUTUMN & WINTER COLLECTION',
		primaryLine: 'EDITORIAL VOL. 10',
		secondaryLine: 'AUTUMN & WINTER COLLECTION',
		frameStyle: 'divided-box',
		accentColor: { r: 0.92, g: 0.86, b: 0.76, a: 1.0 },
		style: {
			fontFamily: 'Playfair Display',
			fontWeight: '600',
			alignment: 'center',
			letterSpacing: 5
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 36,
			paddingY: 20,
			frameStyle: 'divided-box'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 52,
			'text.letterSpacing': 5,
			'text.fillColor': [1, 1, 1, 1],
			'text.lineHeight': 1.3,
			opacity: 1
		},
		animationPresetId: 'slide-in-up',
		inDurationUs: 600_000,
		outDurationUs: 500_000,
		previewColors: {
			background: '#121216',
			primary: '#ffffff',
			accent: '#ebdcc2'
		}
	},
	{
		id: 'cyber-glitch-tech',
		name: 'Cyber Glitch Tech',
		category: 'titles',
		description: 'High-tech cyberpunk glitch strobe title with neon glow frame for gaming and sci-fi',
		tags: ['title', 'cyberpunk', 'glitch', 'tech', 'gaming', 'scifi', 'neon', 'cyan'],
		defaultText: 'CYBER PROTOCOL\nSYSTEM INITIALIZED // 2049',
		primaryLine: 'CYBER PROTOCOL',
		secondaryLine: 'SYSTEM INITIALIZED // 2049',
		frameStyle: 'frame',
		accentColor: { r: 1.0, g: 0.15, b: 0.65, a: 1.0 },
		style: {
			fontFamily: 'Roboto Mono',
			fontWeight: '700',
			alignment: 'center',
			letterSpacing: 3
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 32,
			paddingY: 18,
			frameStyle: 'frame'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 58,
			'text.letterSpacing': 3,
			'text.fillColor': [0.0, 0.95, 0.9, 1],
			'text.lineHeight': 1.25,
			opacity: 1
		},
		animationPresetId: 'glitch-snap',
		inDurationUs: 350_000,
		outDurationUs: 400_000,
		previewColors: {
			background: '#070a14',
			primary: '#00f2e6',
			accent: '#ff26a6'
		}
	},
	{
		id: 'bouncy-spring-pop',
		name: 'Bouncy Pop Headline',
		category: 'titles',
		description: 'Energetic spring drop with squash and stretch settling for YouTube vlogs and social videos',
		tags: ['title', 'bouncy', 'pop', 'youtube', 'vlog', 'fun', 'social', 'yellow'],
		defaultText: 'NEW EPISODE!\nWATCH UNTIL THE VERY END',
		primaryLine: 'NEW EPISODE!',
		secondaryLine: 'WATCH UNTIL THE VERY END',
		frameStyle: 'card',
		accentColor: { r: 1.0, g: 0.84, b: 0.15, a: 1.0 },
		style: {
			fontFamily: 'Montserrat',
			fontWeight: '900',
			alignment: 'center',
			letterSpacing: 1
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 36,
			paddingY: 20,
			frameStyle: 'card'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 64,
			'text.letterSpacing': 1,
			'text.fillColor': [0.1, 0.1, 0.14, 1],
			'text.backgroundBoxColor': [1, 0.84, 0.15, 1],
			'text.lineHeight': 1.2,
			opacity: 1
		},
		animationPresetId: 'bounce-in',
		inDurationUs: 600_000,
		outDurationUs: 400_000,
		previewColors: {
			background: '#181822',
			primary: '#1a1a24',
			accent: '#ffd626'
		}
	},
	{
		id: 'split-slash-action',
		name: 'Dynamic Split Angle',
		category: 'titles',
		description: 'High-velocity horizontal slash with angular snap for sports, fitness, and energetic reels',
		tags: ['title', 'action', 'sports', 'dynamic', 'fitness', 'speed', 'red'],
		defaultText: 'BREAKING LIMITS\nTHE ULTIMATE PERFORMANCE',
		primaryLine: 'BREAKING LIMITS',
		secondaryLine: 'THE ULTIMATE PERFORMANCE',
		frameStyle: 'split-slash',
		accentColor: { r: 1.0, g: 0.28, b: 0.12, a: 1.0 },
		style: {
			fontFamily: 'Bebas Neue',
			fontWeight: 'bold',
			fontStyle: 'italic',
			alignment: 'center',
			letterSpacing: 2
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 32,
			paddingY: 18,
			frameStyle: 'split-slash'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 62,
			'text.letterSpacing': 2,
			'text.fillColor': [1, 1, 1, 1],
			'text.lineHeight': 1.2,
			opacity: 1
		},
		animationPresetId: 'split-slide',
		inDurationUs: 500_000,
		outDurationUs: 450_000,
		previewColors: {
			background: '#120d0e',
			primary: '#ffffff',
			accent: '#ff471f'
		}
	},
	{
		id: 'typewriter-terminal',
		name: 'Typewriter Terminal',
		category: 'titles',
		description: 'Authentic character-by-character digital typewriter reveal for coding tutorials and tech intros',
		tags: ['title', 'typewriter', 'code', 'terminal', 'retro', 'tech', 'green'],
		defaultText: 'INITIALIZING SYSTEM...\nCORE ENGINE OPERATIONAL',
		primaryLine: 'INITIALIZING SYSTEM...',
		secondaryLine: 'CORE ENGINE OPERATIONAL',
		frameStyle: 'none',
		accentColor: { r: 0.2, g: 0.95, b: 0.45, a: 1.0 },
		style: {
			fontFamily: 'Roboto Mono',
			fontWeight: 'normal',
			alignment: 'center',
			letterSpacing: 2
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 24,
			paddingY: 16
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 52,
			'text.letterSpacing': 2,
			'text.fillColor': [0.2, 0.95, 0.45, 1],
			'text.lineHeight': 1.3,
			opacity: 1
		},
		animationPresetId: 'typewriter',
		inDurationUs: 1_500_000,
		outDurationUs: 500_000,
		previewColors: {
			background: '#0a100d',
			primary: '#33f273',
			accent: '#33f273'
		}
	},
	{
		id: 'broadcast-news-header',
		name: 'Broadcast News Header',
		category: 'titles',
		description: 'Television-style breaking news banner header with top badge banner for journalism and reports',
		tags: ['title', 'broadcast', 'news', 'press', 'report', 'journalism', 'blue'],
		defaultText: 'BREAKING NEWS\nGLOBAL ECONOMIC SUMMIT',
		primaryLine: 'BREAKING NEWS',
		secondaryLine: 'GLOBAL ECONOMIC SUMMIT',
		frameStyle: 'badge-header',
		accentColor: { r: 0.12, g: 0.45, b: 0.95, a: 1.0 },
		style: {
			fontFamily: 'Inter',
			fontWeight: '800',
			alignment: 'center',
			letterSpacing: 2
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 32,
			paddingY: 18,
			frameStyle: 'badge-header'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 56,
			'text.letterSpacing': 2,
			'text.fillColor': [1, 1, 1, 1],
			'text.lineHeight': 1.25,
			opacity: 1
		},
		animationPresetId: 'slide-in-down',
		inDurationUs: 600_000,
		outDurationUs: 500_000,
		previewColors: {
			background: '#080d1a',
			primary: '#ffffff',
			accent: '#1f73f2'
		}
	},
	{
		id: 'kinetic-marquee-stack',
		name: 'Kinetic Marquee Stack',
		category: 'titles',
		description: 'Streetwear kinetic typography with bold angular frame and punch zoom for music videos',
		tags: ['title', 'kinetic', 'streetwear', 'music', 'trend', 'hype', 'pink'],
		defaultText: 'NEVER STOP\nTHE FUTURE IS CREATED TODAY',
		primaryLine: 'NEVER STOP',
		secondaryLine: 'THE FUTURE IS CREATED TODAY',
		frameStyle: 'diagonal-repeat',
		accentColor: { r: 1.0, g: 0.18, b: 0.48, a: 1.0 },
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
			frameStyle: 'diagonal-repeat'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 64,
			'text.letterSpacing': -0.5,
			'text.fillColor': [1, 1, 1, 1],
			'text.lineHeight': 1.15,
			opacity: 1
		},
		animationPresetId: 'kinetic-zoom',
		inDurationUs: 450_000,
		outDurationUs: 400_000,
		previewColors: {
			background: '#120a10',
			primary: '#ffffff',
			accent: '#ff2e7a'
		}
	},
	{
		id: 'circle-crest-seal',
		name: 'Circular Crest Emblem',
		category: 'titles',
		description: 'Regal circular crest outline badge with smooth pop-in for podcasts, luxury, and creator brands',
		tags: ['title', 'circle', 'seal', 'badge', 'luxury', 'podcast', 'gold'],
		defaultText: 'EST. 2026\nMASTERCLASS SERIES',
		primaryLine: 'EST. 2026',
		secondaryLine: 'MASTERCLASS SERIES',
		frameStyle: 'circle',
		accentColor: { r: 0.88, g: 0.74, b: 0.38, a: 1.0 },
		style: {
			fontFamily: 'Playfair Display',
			fontWeight: '700',
			alignment: 'center',
			letterSpacing: 3
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 44,
			paddingY: 44,
			frameStyle: 'circle'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 46,
			'text.letterSpacing': 3,
			'text.fillColor': [1, 1, 1, 1],
			'text.lineHeight': 1.3,
			opacity: 1
		},
		animationPresetId: 'pop-in',
		inDurationUs: 500_000,
		outDurationUs: 450_000,
		previewColors: {
			background: '#0e0e14',
			primary: '#ffffff',
			accent: '#e0bd61'
		}
	},
	{
		id: 'documentary-speaker-card',
		name: 'Documentary Elegant Card',
		category: 'titles',
		description: 'Glass-morphism lower third card with smooth slide-in-left for documentaries and interviews',
		tags: ['title', 'documentary', 'interview', 'speaker', 'glass', 'executive', 'cyan'],
		defaultText: 'DR. ELENA VANCE\nCHIEF RESEARCH SCIENTIST',
		primaryLine: 'DR. ELENA VANCE',
		secondaryLine: 'CHIEF RESEARCH SCIENTIST',
		frameStyle: 'lower-third-glass',
		accentColor: { r: 0.0, g: 0.82, b: 0.95, a: 1.0 },
		style: {
			fontFamily: 'Inter',
			fontWeight: '700',
			alignment: 'left',
			letterSpacing: 1.5
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 28,
			paddingY: 16,
			frameStyle: 'lower-third-glass'
		},
		properties: {
			position: [-120, 0],
			'text.fontSize': 50,
			'text.letterSpacing': 1.5,
			'text.fillColor': [1, 1, 1, 1],
			'text.lineHeight': 1.25,
			opacity: 1
		},
		animationPresetId: 'slide-in-left',
		inDurationUs: 600_000,
		outDurationUs: 450_000,
		previewColors: {
			background: '#0a1017',
			primary: '#ffffff',
			accent: '#00d2f2'
		}
	},
	{
		id: 'social-creator-pill',
		name: 'Social Creator Pill',
		category: 'titles',
		description: 'Smooth rounded pill badge with bouncy pop-in for YouTube and social media handles',
		tags: ['title', 'social', 'pill', 'creator', 'youtube', 'tiktok', 'instagram', 'purple'],
		defaultText: '@CREATIVE_STUDIO\nFOLLOW FOR WEEKLY DROPS',
		primaryLine: '@CREATIVE_STUDIO',
		secondaryLine: 'FOLLOW FOR WEEKLY DROPS',
		frameStyle: 'social-pill',
		accentColor: { r: 0.55, g: 0.25, b: 0.95, a: 1.0 },
		style: {
			fontFamily: 'Inter',
			fontWeight: '800',
			alignment: 'center',
			letterSpacing: 1
		},
		box: {
			autoSize: true,
			verticalAnchor: 'center',
			paddingX: 32,
			paddingY: 16,
			frameStyle: 'social-pill'
		},
		properties: {
			position: [0, 0],
			'text.fontSize': 46,
			'text.letterSpacing': 1,
			'text.fillColor': [1, 1, 1, 1],
			'text.lineHeight': 1.25,
			opacity: 1
		},
		animationPresetId: 'pop-in',
		inDurationUs: 500_000,
		outDurationUs: 400_000,
		previewColors: {
			background: '#120b1c',
			primary: '#ffffff',
			accent: '#8c40f2'
		}
	},
	{
		id: 'mixkit-minimal-wipe-lower-third',
		name: 'Clean Minimal Wipe Lower Third',
		category: 'lower-third',
		description:
			'Clean modern lower third with cyan accent bar, smooth white block wipe reveal, and wide-tracked subtitle inspired by Mixkit 312',
		tags: ['lower-third', 'mixkit', 'wipe', 'minimal', 'corporate', 'interview', 'clean', 'cyan'],
		defaultText: 'MATT TYLER\nART DEPARTMENT ASSISTANT',
		primaryLine: 'MATT TYLER',
		secondaryLine: 'ART DEPARTMENT ASSISTANT',
		frameStyle: 'accent-bar',
		accentColor: { r: 0.0, g: 0.82, b: 0.95, a: 1.0 },
		style: {
			fontFamily: 'Montserrat',
			fontWeight: '900',
			alignment: 'left',
			letterSpacing: 2
		},
		box: {
			autoSize: true,
			verticalAnchor: 'bottom',
			paddingX: 28,
			paddingY: 16,
			frameStyle: 'accent-bar',
			accentBarColor: { r: 0.0, g: 0.82, b: 0.95, a: 1.0 },
			accentBarWidth: 16
		},
		properties: {
			position: [-240, 320],
			'text.fontSize': 52,
			'text.fillColor': [1, 1, 1, 1],
			'text.strokeWidth': 0,
			'text.letterSpacing': 2,
			'text.lineHeight': 1.25,
			'text.accentBarColor': [0.0, 0.82, 0.95, 1],
			'text.accentBarWidth': 16,
			opacity: 1
		},
		animationPresetId: 'broadcast-lower-third-in',
		inDurationUs: 1_400_000,
		outDurationUs: 1_200_000,
		previewColors: {
			background: '#090d14',
			primary: '#ffffff',
			accent: '#00d2f2',
			badge: '#004d66'
		}
	}
];
export function getGraphicTemplate(id: string): GraphicTemplate | undefined {
	return GRAPHIC_TEMPLATES.find((t) => t.id === id);
}

/**
 * Computes TextColorRun[] so that designated highlight words or lines
 * automatically receive the template's accent color in the canvas rasterizer!
 */
export function computeColorRuns(
	text: string,
	template: GraphicTemplate,
	accentColor: { r: number; g: number; b: number; a: number } = template.accentColor
): TextColorRun[] {
	if (!template.highlightWord || !text) return [];

	const target = template.highlightWord.toLowerCase();
	const lower = text.toLowerCase();
	const index = lower.indexOf(target);

	if (index === -1) {
		// If exact phrase not found, highlight secondary line if present
		if (template.secondaryLine) {
			const secIdx = lower.indexOf(template.secondaryLine.toLowerCase());
			if (secIdx !== -1) {
				return [
					{
						startIndex: secIdx,
						endIndex: secIdx + template.secondaryLine.length,
						fillColor: accentColor
					}
				];
			}
		}

		// Fallback for custom text: if multi-line text, highlight the accent / secondary line
		const lines = text.split('\n');
		if (lines.length > 1) {
			const targetLineIdx = lines.length === 2 ? 1 : 1;
			let charCount = 0;
			for (let i = 0; i < targetLineIdx; i++) {
				charCount += lines[i]!.length + 1; // +1 for \n
			}
			const lineLen = lines[targetLineIdx]!.length;
			if (lineLen > 0) {
				return [
					{
						startIndex: charCount,
						endIndex: charCount + lineLen,
						fillColor: accentColor
					}
				];
			}
		}

		return [];
	}

	return [
		{
			startIndex: index,
			endIndex: index + template.highlightWord.length,
			fillColor: accentColor
		}
	];
}

function randomId(): string {
	const cryptoApi = typeof globalThis.crypto === 'undefined' ? undefined : globalThis.crypto;
	if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
	const bytes = new Uint8Array(16);
	if (cryptoApi) {
		cryptoApi.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
	}
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds a complete animated graphic clip ready for insertion on the timeline.
 */
export function createGraphicClip(
	templateId: string,
	start: Time,
	duration: Time = 5_000_000,
	customText?: string
): Clip {
	const template = getGraphicTemplate(templateId) ?? GRAPHIC_TEMPLATES[0]!;
	const text = customText ?? template.defaultText;
	const colorRuns = computeColorRuns(text, template);

	const clipId = randomId() as Clip['id'];
	const properties: Record<PropertyId, AnimatedValue<unknown>> = {};

	// Base static template properties
	for (const [propId, val] of Object.entries(template.properties)) {
		properties[propId] = { value: val };
	}

	let clip: Clip = {
		id: clipId,
		start,
		duration,
		sourceIn: 0,
		sourceOut: duration,
		speed: 1,
		volume: 0,
		source: {
			type: 'text',
			text,
			style: { ...template.style },
			box: {
				...template.box,
				frameStyle: template.frameStyle,
				badgeText: template.secondaryLine
			},
			colorRuns,
			graphicTemplateId: template.id,
			animationPresetId: template.animationPresetId
		},
		properties,
		effects: []
	};

	// Apply In animation preset
	const animPreset = GRAPHIC_ANIMATION_PRESETS.find((a) => a.id === template.animationPresetId);
	if (animPreset) {
		clip = applyAnimationPresetToClip(clip, animPreset, 0);
	}

	// Apply Out fade out animation if clip duration allows
	if (duration >= 2_000_000) {
		const outPreset = GRAPHIC_ANIMATION_PRESETS.find((a) => a.id === 'fade-out');
		if (outPreset) {
			const outStart = Math.max(0, duration - outPreset.duration);
			clip = applyAnimationPresetToClip(clip, outPreset, outStart);
		}
	}

	return clip;
}

/**
 * Applies a GraphicTemplate to an existing text clip on the timeline,
 * keeping existing text if desired or adopting the template text.
 */
export function applyGraphicTemplateToClip(
	clip: Clip,
	templateId: string,
	customText?: string
): Clip {
	const template = getGraphicTemplate(templateId);
	if (!template || clip.source?.type !== 'text') return clip;

	const text = customText !== undefined ? customText : clip.source.text || template.defaultText;
	const colorRuns = computeColorRuns(text, template);

	const properties = { ...(clip.properties ?? {}) };
	for (const [propId, val] of Object.entries(template.properties)) {
		properties[propId] = { value: val };
	}

	let updated: Clip = {
		...clip,
		source: {
			...clip.source,
			text,
			style: { ...template.style },
			box: {
				...(clip.source.box ?? {}),
				...template.box,
				frameStyle: template.frameStyle,
				badgeText: template.secondaryLine
			},
			colorRuns,
			graphicTemplateId: template.id,
			animationPresetId: template.animationPresetId
		},
		properties
	};

	// Apply in-animation
	const animPreset = GRAPHIC_ANIMATION_PRESETS.find((a) => a.id === template.animationPresetId);
	if (animPreset) {
		updated = applyAnimationPresetToClip(updated, animPreset, 0);
	}

	return updated;
}

/**
 * Applies animation preset keyframes offset by baseTime.
 */
export function applyAnimationPresetToClip(
	clip: Clip,
	source: TextAnimationPreset,
	baseTime: number = 0
): Clip {
	const preset = fitPresetToDuration(source, clip.duration - baseTime);
	const properties = { ...(clip.properties ?? {}) };

	for (const [propId, keyframes] of Object.entries(preset.keyframes)) {
		const offsetKeyframes = keyframes.map((kf) => ({
			...kf,
			time: baseTime + kf.time,
			...(preset.kind === 'out' ? { anchor: 'end' as const } : {})
		}));

		const existing = properties[propId];
		let survivingKeyframes: Keyframe<unknown>[] = [];
		if (existing && 'keyframes' in existing && Array.isArray(existing.keyframes)) {
			const presetStart = baseTime;
			const presetEnd = baseTime + preset.duration;
			survivingKeyframes = (existing.keyframes as Keyframe<unknown>[]).filter(
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
