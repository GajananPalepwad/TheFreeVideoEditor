import { evaluate, isAnimatedValue } from './animation';
import { clampCrop, type Crop } from './crop';
import { getEffectDefinition } from './effects/registry';
import type { AnimatedValue, Clip, ClipTransform, PropertyId, Time } from './types';

export type PropertyShape = 'number' | 'vec2' | 'vec4' | 'numberArray';
export type PropertyValue = number | number[];

export interface PropertyDescriptor {
	id: PropertyId;
	label: string;
	shape: PropertyShape;
	/** Channel labels, one per component. */
	channels: readonly string[];
	defaultValue: PropertyValue;
	/** Lower/upper bound applied to every component (before any property-specific rule). */
	min?: number;
	max?: number;
	/** Display unit and the factor from stored value to displayed value (scale is stored as 1 = 100%). */
	unit: 'px' | '%' | '°' | 'EV' | '';
	displayFactor: number;
	/** Arrow-key step in display units. */
	step: number;
}

export const PROPERTY_DESCRIPTORS: Readonly<Record<string, PropertyDescriptor>> = {
	position: {
		id: 'position',
		label: 'Position',
		shape: 'vec2',
		channels: ['X', 'Y'],
		defaultValue: [0, 0],
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	scale: {
		id: 'scale',
		label: 'Scale',
		shape: 'vec2',
		channels: ['X', 'Y'],
		defaultValue: [1, 1],
		min: 0.001,
		max: 100,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	rotation: {
		id: 'rotation',
		label: 'Rotation',
		shape: 'number',
		channels: ['Angle'],
		defaultValue: 0,
		unit: '°',
		displayFactor: 1,
		step: 1
	},
	anchor: {
		id: 'anchor',
		label: 'Anchor',
		shape: 'vec2',
		channels: ['X', 'Y'],
		defaultValue: [0, 0],
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	opacity: {
		id: 'opacity',
		label: 'Opacity',
		shape: 'number',
		channels: ['Opacity'],
		defaultValue: 1,
		min: 0,
		max: 1,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	crop: {
		id: 'crop',
		label: 'Crop',
		shape: 'vec4',
		channels: ['Left', 'Top', 'Right', 'Bottom'],
		defaultValue: [0, 0, 0, 0],
		min: 0,
		max: 1,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	timeRemap: {
		id: 'timeRemap',
		label: 'Speed',
		shape: 'number',
		channels: ['Speed'],
		defaultValue: 1,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	'audio.volume': {
		id: 'audio.volume',
		label: 'Volume',
		shape: 'number',
		channels: ['Level'],
		defaultValue: 0,
		min: -96,
		max: 24,
		unit: '',
		displayFactor: 1,
		step: 0.5
	},
	'audio.pan': {
		id: 'audio.pan',
		label: 'Pan',
		shape: 'number',
		channels: ['Pan'],
		defaultValue: 0,
		min: -1,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.05
	},
	'text.fontSize': {
		id: 'text.fontSize',
		label: 'Font Size',
		shape: 'number',
		channels: ['Size'],
		defaultValue: 48,
		min: 1,
		max: 1000,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.fillColor': {
		id: 'text.fillColor',
		label: 'Fill Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [1, 1, 1, 1],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'text.strokeColor': {
		id: 'text.strokeColor',
		label: 'Stroke Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [0, 0, 0, 1],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'text.strokeWidth': {
		id: 'text.strokeWidth',
		label: 'Stroke Width',
		shape: 'number',
		channels: ['Width'],
		defaultValue: 0,
		min: 0,
		max: 50,
		unit: 'px',
		displayFactor: 1,
		step: 0.5
	},
	'text.letterSpacing': {
		id: 'text.letterSpacing',
		label: 'Letter Spacing',
		shape: 'number',
		channels: ['Spacing'],
		defaultValue: 0,
		min: -50,
		max: 200,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.lineHeight': {
		id: 'text.lineHeight',
		label: 'Line Height',
		shape: 'number',
		channels: ['Height'],
		defaultValue: 1.2,
		min: 0.5,
		max: 5,
		unit: '',
		displayFactor: 1,
		step: 0.1
	},
	'text.reveal': {
		id: 'text.reveal',
		label: 'Reveal',
		shape: 'number',
		channels: ['Progress'],
		defaultValue: 1,
		min: 0,
		max: 1,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	'text.anim.progress': {
		id: 'text.anim.progress',
		label: 'Animate In',
		shape: 'number',
		channels: ['Progress'],
		defaultValue: 1,
		min: 0,
		max: 1,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	'text.anim.stagger': {
		id: 'text.anim.stagger',
		label: 'Animate Stagger',
		shape: 'number',
		channels: ['Stagger'],
		defaultValue: 0.6,
		min: 0,
		max: 1,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	'text.anim.offsetX': {
		id: 'text.anim.offsetX',
		label: 'Animate From X',
		shape: 'number',
		channels: ['X'],
		defaultValue: 0,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.anim.offsetY': {
		id: 'text.anim.offsetY',
		label: 'Animate From Y',
		shape: 'number',
		channels: ['Y'],
		defaultValue: 40,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.anim.scale': {
		id: 'text.anim.scale',
		label: 'Animate From Scale',
		shape: 'number',
		channels: ['Scale'],
		defaultValue: 1,
		min: 0,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	'text.anim.rotation': {
		id: 'text.anim.rotation',
		label: 'Animate From Rotation',
		shape: 'number',
		channels: ['Rotation'],
		defaultValue: 0,
		unit: '°',
		displayFactor: 1,
		step: 1
	},
	'text.anim.opacity': {
		id: 'text.anim.opacity',
		label: 'Animate From Opacity',
		shape: 'number',
		channels: ['Opacity'],
		defaultValue: 0,
		min: 0,
		max: 1,
		unit: '%',
		displayFactor: 100,
		step: 1
	},
	'text.boxBorderColor': {
		id: 'text.boxBorderColor',
		label: 'Border Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [1, 1, 1, 1],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'text.boxBorderWidth': {
		id: 'text.boxBorderWidth',
		label: 'Border Width',
		shape: 'number',
		channels: ['Width'],
		defaultValue: 0,
		min: 0,
		max: 50,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.backgroundBoxColor': {
		id: 'text.backgroundBoxColor',
		label: 'Background Box Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [0, 0, 0, 0],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'text.backgroundBoxRadius': {
		id: 'text.backgroundBoxRadius',
		label: 'Box Radius',
		shape: 'number',
		channels: ['Radius'],
		defaultValue: 0,
		min: 0,
		max: 200,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.backgroundBoxPadding': {
		id: 'text.backgroundBoxPadding',
		label: 'Box Padding',
		shape: 'number',
		channels: ['Padding'],
		defaultValue: 0,
		min: 0,
		max: 200,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.accentBarColor': {
		id: 'text.accentBarColor',
		label: 'Accent Bar Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [1, 1, 1, 1],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'text.accentBarWidth': {
		id: 'text.accentBarWidth',
		label: 'Accent Bar Width',
		shape: 'number',
		channels: ['Width'],
		defaultValue: 0,
		min: 0,
		max: 50,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.shadowColor': {
		id: 'text.shadowColor',
		label: 'Shadow Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [0, 0, 0, 0.6],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'text.shadowBlur': {
		id: 'text.shadowBlur',
		label: 'Shadow Blur',
		shape: 'number',
		channels: ['Blur'],
		defaultValue: 0,
		min: 0,
		max: 100,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.shadowOffsetX': {
		id: 'text.shadowOffsetX',
		label: 'Shadow Offset X',
		shape: 'number',
		channels: ['X'],
		defaultValue: 0,
		min: -100,
		max: 100,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'text.shadowOffsetY': {
		id: 'text.shadowOffsetY',
		label: 'Shadow Offset Y',
		shape: 'number',
		channels: ['Y'],
		defaultValue: 0,
		min: -100,
		max: 100,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'shape.width': {
		id: 'shape.width',
		label: 'Width',
		shape: 'number',
		channels: ['Width'],
		defaultValue: 300,
		min: 1,
		max: 8192,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'shape.height': {
		id: 'shape.height',
		label: 'Height',
		shape: 'number',
		channels: ['Height'],
		defaultValue: 200,
		min: 1,
		max: 8192,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'shape.fillColor': {
		id: 'shape.fillColor',
		label: 'Fill Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [1, 1, 1, 1],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'shape.strokeColor': {
		id: 'shape.strokeColor',
		label: 'Stroke Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [1, 1, 1, 1],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'shape.strokeWidth': {
		id: 'shape.strokeWidth',
		label: 'Stroke Width',
		shape: 'number',
		channels: ['Width'],
		defaultValue: 0,
		min: 0,
		max: 50,
		unit: 'px',
		displayFactor: 1,
		step: 0.5
	},
	'shape.cornerRadius': {
		id: 'shape.cornerRadius',
		label: 'Corner Radius',
		shape: 'number',
		channels: ['Radius'],
		defaultValue: 0,
		min: 0,
		max: 2000,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'shape.shadowColor': {
		id: 'shape.shadowColor',
		label: 'Shadow Color',
		shape: 'vec4',
		channels: ['R', 'G', 'B', 'A'],
		defaultValue: [0, 0, 0, 0.6],
		min: 0,
		max: 1,
		unit: '',
		displayFactor: 1,
		step: 0.01
	},
	'shape.shadowBlur': {
		id: 'shape.shadowBlur',
		label: 'Shadow Blur',
		shape: 'number',
		channels: ['Blur'],
		defaultValue: 0,
		min: 0,
		max: 100,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'shape.shadowOffsetX': {
		id: 'shape.shadowOffsetX',
		label: 'Shadow Offset X',
		shape: 'number',
		channels: ['X'],
		defaultValue: 0,
		min: -100,
		max: 100,
		unit: 'px',
		displayFactor: 1,
		step: 1
	},
	'shape.shadowOffsetY': {
		id: 'shape.shadowOffsetY',
		label: 'Shadow Offset Y',
		shape: 'number',
		channels: ['Y'],
		defaultValue: 0,
		min: -100,
		max: 100,
		unit: 'px',
		displayFactor: 1,
		step: 1
	}
};

export const ANIMATABLE_PROPERTY_IDS = Object.keys(PROPERTY_DESCRIPTORS);

export function descriptorFor(id: PropertyId): PropertyDescriptor | undefined {
	if (PROPERTY_DESCRIPTORS[id]) return PROPERTY_DESCRIPTORS[id];
	if (id.startsWith('effect:')) {
		const parts = id.split(':');
		if (parts.length >= 4) {
			const [, effectType, , paramName] = parts;
			const def = getEffectDefinition(effectType!);
			const param = def?.params[paramName!];
			if (param) {
				const isPoint = param.type === 'point';
				const unit =
					(param.unit as 'px' | '%' | '°' | 'EV' | '') ?? (param.type === 'angle' ? '°' : '');
				const displayFactor =
					param.unit === 'px' || param.unit === 'EV' || param.unit === '°'
						? 1
						: param.min !== undefined && param.min < 0
							? 1
							: 100;
				return {
					id,
					label: `${def!.name} ${param.label}`,
					shape: isPoint ? 'vec2' : 'number',
					channels: isPoint ? ['X', 'Y'] : [param.label],
					defaultValue: param.defaultValue as PropertyValue,
					min: param.min,
					max: param.max,
					step: param.step ?? (isPoint ? 0.01 : 1),
					unit,
					displayFactor
				};
			}
		}
	}
	if (id.startsWith('mask:')) {
		const parts = id.split(':');
		const paramName = parts[parts.length - 1];
		if (paramName === 'feather') {
			return {
				id,
				label: 'Mask Feather',
				shape: 'number',
				channels: ['Feather'],
				defaultValue: 0,
				min: 0,
				max: 1000,
				unit: 'px',
				displayFactor: 1,
				step: 1
			};
		}
		if (paramName === 'expansion') {
			return {
				id,
				label: 'Mask Expansion',
				shape: 'number',
				channels: ['Expansion'],
				defaultValue: 0,
				min: -500,
				max: 500,
				unit: 'px',
				displayFactor: 1,
				step: 1
			};
		}
		if (paramName === 'opacity') {
			return {
				id,
				label: 'Mask Opacity',
				shape: 'number',
				channels: ['Opacity'],
				defaultValue: 1,
				min: 0,
				max: 1,
				unit: '%',
				displayFactor: 100,
				step: 1
			};
		}
		if (paramName === 'shape') {
			return {
				id,
				label: 'Mask Shape',
				shape: 'numberArray',
				channels: ['Shape'],
				defaultValue: [0.5, 0.5, 0.4, 0.4, 0, 0],
				unit: '',
				displayFactor: 1,
				step: 0.01
			};
		}
	}
	return undefined;
}

export function shapeLength(shape: PropertyShape): number {
	return shape === 'number' ? 1 : shape === 'vec2' ? 2 : shape === 'vec4' ? 4 : 0;
}

export function matchesShape(
	descriptor: PropertyDescriptor,
	value: unknown
): value is PropertyValue {
	if (descriptor.shape === 'number') return typeof value === 'number' && Number.isFinite(value);
	if (descriptor.shape === 'numberArray') {
		return (
			Array.isArray(value) &&
			value.length > 0 &&
			value.every((item) => typeof item === 'number' && Number.isFinite(item))
		);
	}
	return (
		Array.isArray(value) &&
		value.length === shapeLength(descriptor.shape) &&
		value.every((item) => typeof item === 'number' && Number.isFinite(item))
	);
}

/** Clamps a value to the descriptor's rules; `editedChannel` lets crop insets give way correctly. */
export function clampPropertyValue(
	descriptor: PropertyDescriptor,
	value: PropertyValue,
	editedChannel?: number
): PropertyValue {
	if (descriptor.shape === 'numberArray' && Array.isArray(value)) {
		return [...value];
	}
	const bound = (item: number): number =>
		Math.min(descriptor.max ?? Infinity, Math.max(descriptor.min ?? -Infinity, item));
	if (descriptor.id === 'crop' && Array.isArray(value)) {
		return [...clampCrop(value as unknown as Crop, editedChannel)];
	}
	if (typeof value === 'number') return bound(value);
	return value.map(bound);
}

export function defaultValueOf(descriptor: PropertyDescriptor): PropertyValue {
	return typeof descriptor.defaultValue === 'number'
		? descriptor.defaultValue
		: [...descriptor.defaultValue];
}

/** The value a property takes when the clip has no `properties` entry: legacy transform, else default. */
export function legacyValue(clip: Clip, id: PropertyId): PropertyValue | undefined {
	const transform = clip.transform;
	if (!transform) return undefined;
	switch (id) {
		case 'position':
			return [transform.x, transform.y];
		case 'scale':
			return [transform.scaleX, transform.scaleY];
		case 'rotation':
			return transform.rotation;
		case 'opacity':
			return transform.opacity;
		default:
			return undefined;
	}
}

/** The shape clip's own (static) value for a `shape.*` property, so animating starts from what is drawn. */
function shapeSourceValue(clip: Clip, id: PropertyId): PropertyValue | undefined {
	const source = clip.source;
	if (source?.type !== 'shape' || !id.startsWith('shape.')) return undefined;
	const color = (value: { r: number; g: number; b: number; a: number } | undefined) =>
		value ? [value.r, value.g, value.b, value.a] : undefined;
	switch (id) {
		case 'shape.width':
			return source.width;
		case 'shape.height':
			return source.height;
		case 'shape.fillColor':
			return color(source.fillColor);
		case 'shape.strokeColor':
			return color(source.strokeColor);
		case 'shape.strokeWidth':
			return source.strokeWidth;
		case 'shape.cornerRadius':
			return source.cornerRadius;
		case 'shape.shadowColor':
			return color(source.shadowColor);
		case 'shape.shadowBlur':
			return source.shadowBlur;
		case 'shape.shadowOffsetX':
			return source.shadowOffsetX;
		case 'shape.shadowOffsetY':
			return source.shadowOffsetY;
		default:
			return undefined;
	}
}

export function propertyCurve(
	clip: Clip,
	id: PropertyId
): AnimatedValue<PropertyValue> | undefined {
	if (id.startsWith('effect:')) {
		const parts = id.split(':');
		if (parts.length >= 4) {
			const [, , effectId, paramName] = parts;
			const effect = clip.effects?.find((e) => e.id === effectId);
			if (effect && paramName! in effect.params) {
				const raw = effect.params[paramName!];
				if (isAnimatedValue(raw)) return raw as AnimatedValue<PropertyValue>;
				return { value: raw as PropertyValue };
			}
		}
	}
	if (id.startsWith('mask:')) {
		const parts = id.split(':');
		const paramName = parts[parts.length - 1]!;
		const maskId = parts.length >= 4 ? parts[2]! : parts[1]!;
		const mask = clip.masks?.find((m) => m.id === maskId);
		if (mask) {
			if (mask.properties && paramName in mask.properties) {
				const raw = mask.properties[paramName];
				if (isAnimatedValue(raw)) return raw as AnimatedValue<PropertyValue>;
				return { value: raw as PropertyValue };
			}
			const staticVal = (mask as unknown as Record<string, unknown>)[paramName];
			if (staticVal !== undefined) return { value: staticVal as PropertyValue };
		}
	}
	if (id === 'timeRemap') {
		if (clip.timeRemap) return clip.timeRemap as AnimatedValue<PropertyValue>;
		return { value: clip.speed };
	}
	return clip.properties?.[id] as AnimatedValue<PropertyValue> | undefined;
}

/** Evaluated property at a clip-local time, falling back to the legacy transform and then the default. */
export function readProperty(clip: Clip, id: PropertyId, localTime: Time): PropertyValue {
	if (id === 'timeRemap') {
		if (clip.timeRemap) return evaluate(clip.timeRemap, localTime);
		return clip.speed;
	}
	const curve = propertyCurve(clip, id);
	if (curve) return evaluate(curve, localTime);
	const descriptor = descriptorFor(id);
	const legacy = legacyValue(clip, id);
	if (legacy !== undefined) return legacy;
	const fromSource = shapeSourceValue(clip, id);
	if (fromSource !== undefined) return fromSource;
	if (!descriptor) throw new RangeError(`Unknown property "${id}".`);
	return defaultValueOf(descriptor);
}

const LEGACY_IDS: readonly PropertyId[] = ['position', 'scale', 'rotation', 'opacity'];

/**
 * Converts a legacy `transform` into constant `properties` entries (existing entries win) and drops
 * `transform`. `evaluateLayerProperties` reads both, so the rendered result is unchanged.
 */
export function migrateLegacyTransform(clip: Clip): Clip {
	if (!clip.transform) return clip;
	const { transform: _legacy, ...rest } = clip;
	void _legacy;
	const properties: Record<PropertyId, AnimatedValue<unknown>> = { ...clip.properties };
	for (const id of LEGACY_IDS) {
		if (properties[id]) continue;
		const value = legacyValue(clip, id);
		if (value !== undefined) properties[id] = { value };
	}
	return { ...rest, properties };
}

export type { ClipTransform };
