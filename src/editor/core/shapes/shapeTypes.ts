export type ShapeKind =
	| 'rect'
	| 'rounded-rect'
	| 'circle'
	| 'ellipse'
	| 'triangle'
	| 'star'
	| 'polygon'
	| 'heart'
	| 'arrow'
	| 'line'
	| 'diamond'
	| 'callout'
	| 'badge';

export interface RgbaColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface ShapeConfig {
	shapeType: ShapeKind;
	width: number;
	height: number;
	fillColor: RgbaColor;
	strokeColor?: RgbaColor;
	strokeWidth?: number;
	strokeStyle?: 'solid' | 'dashed' | 'dotted';
	cornerRadius?: number;
	points?: number;
	innerRadius?: number;
	shadowColor?: RgbaColor;
	shadowBlur?: number;
	shadowOffsetX?: number;
	shadowOffsetY?: number;
	gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
	gradientColorEnd?: RgbaColor;
	gradientAngle?: number;
	gradientStops?: Array<{ offset: number; color: RgbaColor }>;
}

export interface ShapePreset {
	id: string;
	name: string;
	category: 'basic' | 'symbols' | 'badges' | 'neon';
	config: ShapeConfig;
}

export const SHAPE_PRESETS: ShapePreset[] = [
	// Basic
	{
		id: 'rect-solid-cyan',
		name: 'Cyan Rectangle',
		category: 'basic',
		config: {
			shapeType: 'rect',
			width: 400,
			height: 250,
			fillColor: { r: 0.02, g: 0.71, b: 0.83, a: 1 },
			strokeColor: { r: 1, g: 1, b: 1, a: 0.8 },
			strokeWidth: 2,
			strokeStyle: 'solid',
			cornerRadius: 0
		}
	},
	{
		id: 'rounded-rect-violet',
		name: 'Rounded Card',
		category: 'basic',
		config: {
			shapeType: 'rounded-rect',
			width: 420,
			height: 260,
			fillColor: { r: 0.39, g: 0.4, b: 0.95, a: 0.9 },
			strokeColor: { r: 0.64, g: 0.65, b: 1, a: 0.9 },
			strokeWidth: 3,
			strokeStyle: 'solid',
			cornerRadius: 24,
			shadowColor: { r: 0.39, g: 0.4, b: 0.95, a: 0.5 },
			shadowBlur: 20
		}
	},
	{
		id: 'circle-accent',
		name: 'Accent Circle',
		category: 'basic',
		config: {
			shapeType: 'circle',
			width: 300,
			height: 300,
			fillColor: { r: 0.98, g: 0.45, b: 0.09, a: 1 },
			strokeColor: { r: 1, g: 1, b: 1, a: 0.9 },
			strokeWidth: 4,
			strokeStyle: 'solid'
		}
	},
	{
		id: 'ellipse-translucent',
		name: 'Translucent Ellipse',
		category: 'basic',
		config: {
			shapeType: 'ellipse',
			width: 440,
			height: 240,
			fillColor: { r: 0.06, g: 0.73, b: 0.51, a: 0.75 },
			strokeColor: { r: 0.43, g: 0.93, b: 0.77, a: 1 },
			strokeWidth: 2,
			strokeStyle: 'solid'
		}
	},
	{
		id: 'triangle-amber',
		name: 'Warning Triangle',
		category: 'basic',
		config: {
			shapeType: 'triangle',
			width: 320,
			height: 280,
			fillColor: { r: 0.96, g: 0.62, b: 0.04, a: 1 },
			strokeColor: { r: 1, g: 1, b: 1, a: 0.9 },
			strokeWidth: 3,
			strokeStyle: 'solid'
		}
	},
	{
		id: 'diamond-emerald',
		name: 'Emerald Diamond',
		category: 'basic',
		config: {
			shapeType: 'diamond',
			width: 300,
			height: 300,
			fillColor: { r: 0.06, g: 0.73, b: 0.51, a: 0.9 },
			strokeColor: { r: 1, g: 1, b: 1, a: 0.8 },
			strokeWidth: 2,
			strokeStyle: 'solid'
		}
	},
	// Symbols
	{
		id: 'star-gold',
		name: 'Golden Star',
		category: 'symbols',
		config: {
			shapeType: 'star',
			width: 320,
			height: 320,
			fillColor: { r: 0.98, g: 0.75, b: 0.14, a: 1 },
			strokeColor: { r: 1, g: 0.9, b: 0.4, a: 0.9 },
			strokeWidth: 3,
			strokeStyle: 'solid',
			points: 5,
			innerRadius: 0.45,
			shadowColor: { r: 0.98, g: 0.75, b: 0.14, a: 0.6 },
			shadowBlur: 16
		}
	},
	{
		id: 'heart-coral',
		name: 'Vibrant Heart',
		category: 'symbols',
		config: {
			shapeType: 'heart',
			width: 320,
			height: 300,
			fillColor: { r: 0.96, g: 0.25, b: 0.37, a: 1 },
			strokeColor: { r: 1, g: 0.6, b: 0.7, a: 0.9 },
			strokeWidth: 3,
			strokeStyle: 'solid',
			shadowColor: { r: 0.96, g: 0.25, b: 0.37, a: 0.5 },
			shadowBlur: 20
		}
	},
	{
		id: 'arrow-callout',
		name: 'Directional Arrow',
		category: 'symbols',
		config: {
			shapeType: 'arrow',
			width: 380,
			height: 200,
			fillColor: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
			strokeColor: { r: 1, g: 1, b: 1, a: 0.9 },
			strokeWidth: 3,
			strokeStyle: 'solid'
		}
	},
	{
		id: 'line-divider',
		name: 'Accent Divider',
		category: 'symbols',
		config: {
			shapeType: 'line',
			width: 480,
			height: 40,
			fillColor: { r: 0.02, g: 0.71, b: 0.83, a: 1 },
			strokeColor: { r: 0.02, g: 0.71, b: 0.83, a: 1 },
			strokeWidth: 6,
			strokeStyle: 'solid'
		}
	},
	{
		id: 'polygon-hexagon',
		name: 'Hexagon Badge',
		category: 'symbols',
		config: {
			shapeType: 'polygon',
			width: 320,
			height: 320,
			fillColor: { r: 0.55, g: 0.36, b: 0.96, a: 0.9 },
			strokeColor: { r: 0.77, g: 0.65, b: 1, a: 0.9 },
			strokeWidth: 3,
			strokeStyle: 'solid',
			points: 6
		}
	},
	{
		id: 'callout-speech',
		name: 'Speech Bubble',
		category: 'symbols',
		config: {
			shapeType: 'callout',
			width: 420,
			height: 260,
			fillColor: { r: 0.12, g: 0.14, b: 0.2, a: 0.95 },
			strokeColor: { r: 0.22, g: 0.75, b: 0.95, a: 0.9 },
			strokeWidth: 3,
			strokeStyle: 'solid',
			cornerRadius: 16
		}
	},
	// Badges & Neon
	{
		id: 'badge-starburst',
		name: 'Offer Starburst',
		category: 'badges',
		config: {
			shapeType: 'badge',
			width: 340,
			height: 340,
			fillColor: { r: 0.93, g: 0.16, b: 0.36, a: 1 },
			strokeColor: { r: 1, g: 0.85, b: 0.3, a: 1 },
			strokeWidth: 4,
			strokeStyle: 'solid',
			points: 12,
			innerRadius: 0.8
		}
	},
	{
		id: 'neon-cyber-box',
		name: 'Cyber Neon Box',
		category: 'neon',
		config: {
			shapeType: 'rounded-rect',
			width: 400,
			height: 240,
			fillColor: { r: 0.05, g: 0.07, b: 0.12, a: 0.85 },
			strokeColor: { r: 0.02, g: 0.95, b: 0.95, a: 1 },
			strokeWidth: 3,
			strokeStyle: 'solid',
			cornerRadius: 12,
			shadowColor: { r: 0.02, g: 0.95, b: 0.95, a: 0.8 },
			shadowBlur: 24
		}
	},
	{
		id: 'neon-pink-pill',
		name: 'Neon Pink Pill',
		category: 'neon',
		config: {
			shapeType: 'rounded-rect',
			width: 420,
			height: 140,
			fillColor: { r: 0.1, g: 0.04, b: 0.1, a: 0.85 },
			strokeColor: { r: 0.98, g: 0.18, b: 0.65, a: 1 },
			strokeWidth: 3,
			strokeStyle: 'solid',
			cornerRadius: 70,
			shadowColor: { r: 0.98, g: 0.18, b: 0.65, a: 0.8 },
			shadowBlur: 20
		}
	},
	{
		id: 'dashed-frame',
		name: 'Dashed Outline Frame',
		category: 'basic',
		config: {
			shapeType: 'rounded-rect',
			width: 440,
			height: 260,
			fillColor: { r: 0, g: 0, b: 0, a: 0 },
			strokeColor: { r: 0.98, g: 0.75, b: 0.14, a: 1 },
			strokeWidth: 3,
			strokeStyle: 'dashed',
			cornerRadius: 16
		}
	}
];
