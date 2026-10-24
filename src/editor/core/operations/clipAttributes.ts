import { createAssetId } from '../ids';
import type {
	AnimatedValue,
	AudioEffectInstance,
	Clip,
	ClipId,
	ClipTransform,
	EffectInstance,
	Project,
	Track
} from '../types';

function makeId(): string {
	return createAssetId();
}

function tracksWithClips(project: Project, update: (track: Track) => Track): Project {
	return { ...project, tracks: project.tracks.map(update) };
}

const COLOR_EFFECT_TYPES = new Set(['colorCorrection', 'curves', 'lut3d']);

export interface ClipAttributesPayload {
	sourceClipId: ClipId;
	transform?: {
		transform?: ClipTransform;
		properties?: {
			position?: AnimatedValue<unknown>;
			scale?: AnimatedValue<unknown>;
			rotation?: AnimatedValue<unknown>;
			opacity?: AnimatedValue<unknown>;
		};
	};
	crop?: AnimatedValue<unknown>;
	colorGrading?: {
		effects: EffectInstance[];
	};
	videoEffects?: {
		effects: EffectInstance[];
	};
	audio?: {
		volume: number;
		properties?: {
			'audio.volume'?: AnimatedValue<unknown>;
			'audio.pan'?: AnimatedValue<unknown>;
		};
		audioEffects?: AudioEffectInstance[];
		audioTag?: Clip['audioTag'];
		channelRouting?: Clip['channelRouting'];
	};
}

export interface PasteAttributesOptions {
	transform?: boolean;
	crop?: boolean;
	colorGrading?: boolean;
	videoEffects?: boolean;
	audio?: boolean;
}

/** Extracts the copyable styling, grading, effects, audio, and transform attributes from a clip. */
export function extractClipAttributes(clip: Clip): ClipAttributesPayload {
	const payload: ClipAttributesPayload = {
		sourceClipId: clip.id
	};

	// 1. Transform (Position, Scale, Rotation, Opacity)
	const transformProps: Record<string, AnimatedValue<unknown>> = {};
	if (clip.properties?.position) {
		transformProps.position = structuredClone(clip.properties.position);
	}
	if (clip.properties?.scale) {
		transformProps.scale = structuredClone(clip.properties.scale);
	}
	if (clip.properties?.rotation) {
		transformProps.rotation = structuredClone(clip.properties.rotation);
	}
	if (clip.properties?.opacity) {
		transformProps.opacity = structuredClone(clip.properties.opacity);
	}

	if (clip.transform || Object.keys(transformProps).length > 0) {
		payload.transform = {
			...(clip.transform ? { transform: structuredClone(clip.transform) } : {}),
			...(Object.keys(transformProps).length > 0 ? { properties: transformProps } : {})
		};
	}

	// 2. Crop insets
	if (clip.properties?.crop) {
		payload.crop = structuredClone(clip.properties.crop);
	}

	// 3. Color Grading (Basic, Curves, LUT)
	const colorEffects = (clip.effects ?? []).filter((e) => COLOR_EFFECT_TYPES.has(e.type));
	if (colorEffects.length > 0) {
		payload.colorGrading = {
			effects: structuredClone(colorEffects)
		};
	}

	// 4. Video Effects (all effects other than color correction / curves / lut)
	const videoEffects = (clip.effects ?? []).filter((e) => !COLOR_EFFECT_TYPES.has(e.type));
	if (videoEffects.length > 0) {
		payload.videoEffects = {
			effects: structuredClone(videoEffects)
		};
	}

	// 5. Audio (Volume, Pan, Audio Effects, Tag, Channel Routing)
	const audioProps: Record<string, AnimatedValue<unknown>> = {};
	if (clip.properties?.['audio.volume']) {
		audioProps['audio.volume'] = structuredClone(clip.properties['audio.volume']);
	}
	if (clip.properties?.['audio.pan']) {
		audioProps['audio.pan'] = structuredClone(clip.properties['audio.pan']);
	}

	const hasAudioData =
		clip.volume !== undefined ||
		Object.keys(audioProps).length > 0 ||
		(clip.audioEffects && clip.audioEffects.length > 0) ||
		clip.audioTag !== undefined ||
		clip.channelRouting !== undefined;

	if (hasAudioData) {
		payload.audio = {
			volume: clip.volume ?? 1,
			...(Object.keys(audioProps).length > 0 ? { properties: audioProps } : {}),
			...(clip.audioEffects && clip.audioEffects.length > 0
				? { audioEffects: structuredClone(clip.audioEffects) }
				: {}),
			...(clip.audioTag ? { audioTag: clip.audioTag } : {}),
			...(clip.channelRouting ? { channelRouting: clip.channelRouting } : {})
		};
	}

	return payload;
}

/** Applies selected attributes from payload to a target clip. */
export function applyClipAttributes(
	target: Clip,
	payload: ClipAttributesPayload,
	options: PasteAttributesOptions
): Clip {
	const updated = { ...target };

	// 1. Transform (Position, Scale, Rotation, Opacity)
	if (options.transform && payload.transform) {
		if (payload.transform.transform) {
			updated.transform = structuredClone(payload.transform.transform);
		}
		if (payload.transform.properties) {
			updated.properties = { ...(updated.properties ?? {}) };
			for (const [key, value] of Object.entries(payload.transform.properties)) {
				updated.properties[key] = structuredClone(value);
			}
		}
	}

	// 2. Crop insets
	if (options.crop && payload.crop) {
		updated.properties = {
			...(updated.properties ?? {}),
			crop: structuredClone(payload.crop)
		};
	}

	// 3. Color Grading (Basic, Curves, LUT)
	if (options.colorGrading && payload.colorGrading) {
		const existingNonColor = (updated.effects ?? []).filter((e) => !COLOR_EFFECT_TYPES.has(e.type));
		const freshColorEffects = payload.colorGrading.effects.map((e) => ({
			...structuredClone(e),
			id: makeId()
		}));
		updated.effects = [...existingNonColor, ...freshColorEffects];
	}

	// 4. Video Effects (appends non-color effects with fresh IDs)
	if (options.videoEffects && payload.videoEffects) {
		const freshVideoEffects = payload.videoEffects.effects.map((e) => ({
			...structuredClone(e),
			id: makeId()
		}));
		updated.effects = [...(updated.effects ?? []), ...freshVideoEffects];
	}

	// 5. Audio Volume, Pan, and Audio Effects
	if (options.audio && payload.audio) {
		updated.volume = payload.audio.volume;
		if (payload.audio.properties) {
			updated.properties = { ...(updated.properties ?? {}) };
			for (const [key, value] of Object.entries(payload.audio.properties)) {
				updated.properties[key] = structuredClone(value);
			}
		}
		if (payload.audio.audioEffects && payload.audio.audioEffects.length > 0) {
			const freshAudioEffects = payload.audio.audioEffects.map((ae) => ({
				...structuredClone(ae),
				id: makeId()
			}));
			updated.audioEffects = [...(updated.audioEffects ?? []), ...freshAudioEffects];
		}
		if (payload.audio.audioTag) {
			updated.audioTag = payload.audio.audioTag;
		}
		if (payload.audio.channelRouting) {
			updated.channelRouting = payload.audio.channelRouting;
		}
	}

	return updated;
}

/** Pastes selected attributes across target clips in a project. */
export function pasteAttributesToClips(
	project: Project,
	targetClipIds: readonly ClipId[],
	payload: ClipAttributesPayload,
	options: PasteAttributesOptions
): Project {
	if (targetClipIds.length === 0) return project;
	const idSet = new Set(targetClipIds);

	return tracksWithClips(project, (track) => ({
		...track,
		clips: track.clips.map((clip) =>
			idSet.has(clip.id) ? applyClipAttributes(clip, payload, options) : clip
		)
	}));
}
