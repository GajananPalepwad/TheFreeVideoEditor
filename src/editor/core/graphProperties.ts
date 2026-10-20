import { isAnimated } from './animation';
import { getEffectDefinition } from './effects/registry';
import type { Clip, PropertyId } from './types';

const TRANSFORM_PROPERTIES: PropertyId[] = ['position', 'scale', 'rotation', 'opacity', 'crop'];

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
