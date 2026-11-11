import { evaluate, isAnimatedValue } from '../animation';
import type { Clip, EffectInstance, Time } from '../types';
import { getEffectDefinition } from './registry';
import type { EvaluatedEffect } from './types';

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

export function createEffectInstance(
	type: string,
	initialParams: Record<string, unknown> = {}
): EffectInstance {
	const def = getEffectDefinition(type);
	const params: Record<string, unknown> = {};

	if (def) {
		for (const [paramName, schema] of Object.entries(def.params)) {
			params[paramName] =
				paramName in initialParams
					? initialParams[paramName]
					: structuredClone(schema.defaultValue);
		}
	} else {
		Object.assign(params, initialParams);
	}

	return {
		id: randomId(),
		type,
		version: def?.version ?? 1,
		enabled: true,
		params: params as EffectInstance['params']
	};
}

export function evaluateEffect(instance: EffectInstance, localTime: Time): EvaluatedEffect {
	const def = getEffectDefinition(instance.type);
	const enabled = instance?.enabled !== false;
	const evaluatedParams: Record<string, unknown> = {};

	for (const [key, val] of Object.entries(instance.params)) {
		if (isAnimatedValue(val)) {
			evaluatedParams[key] = evaluate(val, localTime);
		} else {
			evaluatedParams[key] = val;
		}
	}

	// Fill any missing defaults from definition
	if (def) {
		for (const [key, schema] of Object.entries(def.params)) {
			if (!(key in evaluatedParams)) {
				evaluatedParams[key] = structuredClone(schema.defaultValue);
			}
		}
	}

	const isNeutral = !enabled || (def ? def.isNeutral(evaluatedParams) : false);

	return {
		id: instance.id,
		type: instance.type,
		enabled,
		params: evaluatedParams,
		isNeutral
	};
}

export function addEffectToClip(clip: Clip, effect: EffectInstance): Clip {
	const existing = clip.effects ?? [];
	return {
		...clip,
		effects: [...existing, effect]
	};
}

export function removeEffectFromClip(clip: Clip, effectId: string): Clip {
	if (!clip.effects) return clip;
	return {
		...clip,
		effects: clip.effects.filter((e) => e.id !== effectId)
	};
}

export function reorderEffectInClip(clip: Clip, effectId: string, toIndex: number): Clip {
	if (!clip.effects) return clip;
	const fromIndex = clip.effects.findIndex((e) => e.id === effectId);
	if (fromIndex === -1) return clip;
	const clampedIndex = Math.max(0, Math.min(clip.effects.length - 1, toIndex));
	if (fromIndex === clampedIndex) return clip;

	const copy = [...clip.effects];
	const [item] = copy.splice(fromIndex, 1);
	if (!item) return clip;
	copy.splice(clampedIndex, 0, item);

	return {
		...clip,
		effects: copy
	};
}

export function toggleEffectInClip(clip: Clip, effectId: string, enabled?: boolean): Clip {
	if (!clip.effects) return clip;
	return {
		...clip,
		effects: clip.effects.map((e) => {
			if (e.id !== effectId) return e;
			const nextEnabled = enabled !== undefined ? enabled : e?.enabled === false;
			return { ...e, enabled: nextEnabled };
		})
	};
}

export function duplicateEffectInClip(clip: Clip, effectId: string): Clip {
	if (!clip.effects) return clip;
	const index = clip.effects.findIndex((e) => e.id === effectId);
	if (index === -1) return clip;
	const source = clip.effects[index]!;
	const duplicate: EffectInstance = {
		...structuredClone(source),
		id: randomId()
	};
	const copy = [...clip.effects];
	copy.splice(index + 1, 0, duplicate);
	return {
		...clip,
		effects: copy
	};
}

export function copyClipEffects(clip: Clip): EffectInstance[] {
	return structuredClone(clip.effects ?? []);
}

export function pasteClipEffects(clip: Clip, effectsToPaste: EffectInstance[]): Clip {
	if (!effectsToPaste.length) return clip;
	const fresh = effectsToPaste.map((e) => ({
		...structuredClone(e),
		id: randomId()
	}));
	return {
		...clip,
		effects: [...(clip.effects ?? []), ...fresh]
	};
}

export function setEffectParamInClip(
	clip: Clip,
	effectId: string,
	paramName: string,
	value: unknown
): Clip {
	if (!clip.effects) return clip;
	return {
		...clip,
		effects: clip.effects.map((e) => {
			if (e.id !== effectId) return e;
			return {
				...e,
				params: {
					...e.params,
					[paramName]: value as EffectInstance['params'][string]
				}
			};
		})
	};
}

export function soloEffectInClip(clip: Clip, effectId: string): Clip {
	if (!clip.effects || clip.effects.length === 0) return clip;
	const isAlreadySoloed = clip.effects.every((e) =>
		e?.id === effectId ? e?.enabled !== false : e?.enabled === false
	);
	return {
		...clip,
		effects: clip.effects.map((e) => ({
			...e,
			enabled: isAlreadySoloed ? true : e.id === effectId
		}))
	};
}

export function toggleBypassClipEffects(clip: Clip, bypass?: boolean): Clip {
	const nextBypass = bypass !== undefined ? bypass : !clip.bypassEffects;
	return {
		...clip,
		bypassEffects: nextBypass
	};
}
