import { isAnimated } from './animation';
import { getEffectDefinition } from './effects/registry';
import { readProperty, type PropertyValue } from './properties';
import type { Clip, PropertyId, Time } from './types';

export const TRANSFORM_PROPERTIES: PropertyId[] = ['position', 'scale', 'rotation', 'opacity', 'crop'];

const PLOTTABLE_EFFECT_PARAMS = new Set(['number', 'angle', 'point']);

/** Every property whose curve the graph editor can offer for this clip. */
export function graphPropertyIds(clip: Clip): PropertyId[] {
	const ids: PropertyId[] = [...TRANSFORM_PROPERTIES];
	if (clip.source?.type === 'text') {
		ids.push(
			'text.fontSize',
			'text.letterSpacing',
			'text.lineHeight',
			'text.reveal',
			'text.anim.progress',
			'text.anim.stagger',
			'text.anim.offsetX',
			'text.anim.offsetY',
			'text.anim.scale',
			'text.anim.rotation',
			'text.anim.opacity',
			'text.strokeWidth',
			'text.shadowBlur',
			'text.shadowOffsetX',
			'text.shadowOffsetY',
			'text.fillColor',
			'text.strokeColor',
			'text.shadowColor'
		);
	}
	if (clip.source?.type === 'shape') {
		ids.push(
			'shape.width',
			'shape.height',
			'shape.strokeWidth',
			'shape.cornerRadius',
			'shape.shadowBlur',
			'shape.shadowOffsetX',
			'shape.shadowOffsetY',
			'shape.fillColor',
			'shape.strokeColor',
			'shape.shadowColor'
		);
	}
	for (const mask of clip.masks ?? []) {
		ids.push(`mask:${mask.id}:feather`, `mask:${mask.id}:expansion`, `mask:${mask.id}:opacity`);
	}
	for (const effect of clip.effects ?? []) {
		const definition = getEffectDefinition(effect.type);
		for (const [name, param] of Object.entries(definition?.params ?? {})) {
			const value = effect.params[name];
			if (!PLOTTABLE_EFFECT_PARAMS.has(param.type)) continue;
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			if (!isAnimated(value as Parameters<typeof isAnimated>[0])) continue;
			ids.push(`effect:${effect.type}:${effect.id}:${name}`);
		}
	}
	return ids;
}

export interface GraphChannel {
	propertyId: PropertyId;
	channelIdx: number;
	/** Stored value times this factor is what the graph shows. */
	displayFactor: number;
}

function channelDisplayValue(clip: Clip, channel: GraphChannel, time: Time): number {
	const value = readProperty(clip, channel.propertyId, time);
	const component = Array.isArray(value) ? (value[channel.channelIdx] ?? 0) : value;
	return component * channel.displayFactor;
}

/** The channel whose curve passes closest to a point clicked on the graph. */
export function nearestChannel<T extends GraphChannel>(
	clip: Clip,
	channels: readonly T[],
	time: Time,
	displayValue: number
): T | undefined {
	let best: T | undefined;
	let bestDistance = Infinity;
	for (const channel of channels) {
		const distance = Math.abs(channelDisplayValue(clip, channel, time) - displayValue);
		if (distance < bestDistance) {
			best = channel;
			bestDistance = distance;
		}
	}
	return best;
}

/** The stored value for a key placed at a displayed height, leaving a vector's other channels as they are. */
export function channelKeyValue(
	clip: Clip,
	channel: GraphChannel,
	time: Time,
	displayValue: number
): PropertyValue {
	const stored = displayValue / (channel.displayFactor || 1);
	const current = readProperty(clip, channel.propertyId, time);
	if (!Array.isArray(current)) return stored;
	return current.map((component, index) => (index === channel.channelIdx ? stored : component));
}
