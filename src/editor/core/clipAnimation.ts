import {
	isAnimatedValue,
	mapAnimatedRecord,
	retimeAnimatedValue,
	retimeAnimatedValueTail,
	shiftAnimatedValue,
	splitAnimatedValue
} from './animation';
import type { AnimatedValue, Clip, EffectInstance, Mask, Time } from './types';

type AnimatedFields = Pick<Clip, 'properties' | 'effects' | 'masks' | 'timeRemap'>;
type Transform = (value: AnimatedValue<unknown>) => AnimatedValue<unknown>;

function mapEffects(effects: EffectInstance[] | undefined, transform: Transform) {
	return effects?.map((effect) => ({
		...effect,
		params: Object.fromEntries(
			Object.entries(effect.params).map(([key, value]) => [
				key,
				isAnimatedValue(value) ? transform(value) : value
			])
		)
	}));
}

function mapMasks(masks: Mask[] | undefined, transform: Transform) {
	return masks?.map((mask) => {
		const properties = mapAnimatedRecord(mask.properties, transform);
		return { ...mask, ...(properties ? { properties } : {}) };
	});
}

function mapFields(clip: AnimatedFields, transform: Transform): AnimatedFields {
	const properties = mapAnimatedRecord(clip.properties, transform);
	const effects = mapEffects(clip.effects, transform);
	const masks = mapMasks(clip.masks, transform);
	return {
		...(properties ? { properties } : {}),
		...(effects ? { effects } : {}),
		...(masks ? { masks } : {}),
		...(clip.timeRemap
			? { timeRemap: transform(clip.timeRemap as AnimatedValue<unknown>) as AnimatedValue<number> }
			: {})
	};
}

/** Splits every animated field at a clip-local time; the right half is re-based to start at 0. */
export function splitClipAnimation(
	clip: AnimatedFields,
	localTime: Time
): [AnimatedFields, AnimatedFields] {
	return [
		mapFields(clip, (value) => splitAnimatedValue(value, localTime)[0]),
		mapFields(clip, (value) => splitAnimatedValue(value, localTime)[1])
	];
}

/**
 * Re-bases animated fields after a head trim. `trimmed` is the new start minus the old start:
 * positive drops the leading part, negative shifts keyframes later to stay at the same media time.
 */
export function retimeClipAnimation(clip: AnimatedFields, trimmed: Time): AnimatedFields {
	if (trimmed === 0) return {};
	const transform: Transform = (value) =>
		trimmed > 0 ? retimeAnimatedValue(value, trimmed) : shiftAnimatedValue(value, -trimmed);
	return mapFields(clip, transform);
}

/** Moves the end-anchored keyframes of every animated field after a tail trim or extension. */
export function retimeClipTail(
	clip: AnimatedFields,
	oldDuration: Time,
	newDuration: Time
): AnimatedFields {
	if (oldDuration === newDuration) return {};
	return mapFields(clip, (value) => retimeAnimatedValueTail(value, oldDuration, newDuration));
}
