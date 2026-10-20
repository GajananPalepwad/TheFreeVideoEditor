import { timelineToSource } from './timeRemap';
import { clipEnd, timelineDuration } from './timeline';
import { evaluateOr } from './animation';
import { clampCrop, isCrop, isDefaultCrop, type Crop } from './crop';
import { evaluateEffect } from './effects/instance';
import type { EvaluatedEffect } from './effects/types';
import { evaluateMask, type EvaluatedMask } from './masks';
import { transitionWindow, transitionProgress, transitionGain } from './transitions';
import { DEFAULT_CAPTION_STYLE } from './captions/presets';
import { findWordSpanInText } from './captions/operations';
import { viewProject, getSequence } from './sequences/access';
import { applyParamOverridesToSequence, computeResponsiveTemplateTime } from './templates/templateService';
import { evaluateLiveTrackingBinding } from './tracking/apply';
import type {
	AnimatedValue,
	AssetId,
	BlendMode,
	Clip,
	ClipId,
	ClipTransform,
	JsonValue,
	Project,
	Time,
	TrackId
} from './types';

const IDENTITY_TRANSFORM: ClipTransform = {
	x: 0,
	y: 0,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
	opacity: 1
};

function numberPair(value: unknown): [number, number] | null {
	return Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'number'
		? [value[0], value[1]]
		: null;
}

function finite(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface TrackingEvaluationContext {
	deltaPosition?: [number, number];
	deltaRotation?: number;
	deltaScale?: [number, number];
}

/**
 * Resolves the tracking evaluation context for a target clip if bound to an active motion tracker.
 */
export function resolveTrackingContext(
	project: Project,
	targetClipId: ClipId,
	timelineTime: Time
): TrackingEvaluationContext | undefined {
	for (const trk of project.tracks) {
		for (const c of trk.clips) {
			if (!c.trackers || c.trackers.length === 0) continue;
			for (const tracker of c.trackers) {
				if (tracker.binding && tracker.binding.targetClipId === targetClipId && tracker.enabled) {
					const motion = evaluateLiveTrackingBinding(
						project,
						c,
						tracker,
						timelineTime,
						c.assetId ? (project.assets[c.assetId]?.width ?? 1920) : 1920,
						c.assetId ? (project.assets[c.assetId]?.height ?? 1080) : 1080
					);
					if (motion && motion.active && !motion.lost) {
						return {
							deltaPosition: tracker.binding.applyPosition ? motion.position : undefined,
							deltaRotation: tracker.binding.applyRotation ? motion.rotation : undefined,
							deltaScale: tracker.binding.applyScale ? motion.scale : undefined
						};
					}
				}
			}
		}
	}
	return undefined;
}

/**
 * Evaluates animated clip properties at a clip-local time and merges them over the legacy
 * static transform. Property ids: position [x, y], scale [x, y], rotation (deg), opacity (0–1),
 * anchor [x, y]. Renderers never read keyframes; they only see this result.
 */
export function evaluateLayerProperties(
	clip: Clip,
	localTime: Time,
	trackingContext?: TrackingEvaluationContext
): Pick<ActiveLayer, 'transform' | 'anchor' | 'blendMode' | 'crop'> {
	const properties = clip.properties;
	const result: Pick<ActiveLayer, 'transform' | 'anchor' | 'blendMode' | 'crop'> = {};
	if (clip.blendMode && clip.blendMode !== 'normal') result.blendMode = clip.blendMode;
	if (!properties) {
		if (clip.transform || trackingContext) {
			const base = clip.transform ?? IDENTITY_TRANSFORM;
			result.transform = {
				x: trackingContext?.deltaPosition ? trackingContext.deltaPosition[0] : base.x,
				y: trackingContext?.deltaPosition ? trackingContext.deltaPosition[1] : base.y,
				scaleX: base.scaleX * (trackingContext?.deltaScale ? trackingContext.deltaScale[0] : 1),
				scaleY: base.scaleY * (trackingContext?.deltaScale ? trackingContext.deltaScale[1] : 1),
				rotation:
					trackingContext?.deltaRotation !== undefined
						? trackingContext.deltaRotation
						: base.rotation,
				opacity: base.opacity
			};
		}
		return result;
	}
	const read = (id: string): unknown => {
		const animated = properties[id] as AnimatedValue<unknown> | undefined;
		return animated ? evaluateOr(animated, localTime, undefined) : undefined;
	};
	const base = clip.transform ?? IDENTITY_TRANSFORM;
	const position = numberPair(read('position'));
	const scale = numberPair(read('scale'));
	const anchor = numberPair(read('anchor'));
	const posX = trackingContext?.deltaPosition
		? trackingContext.deltaPosition[0]
		: (position?.[0] ?? base.x);
	const posY = trackingContext?.deltaPosition
		? trackingContext.deltaPosition[1]
		: (position?.[1] ?? base.y);
	const sX =
		(scale?.[0] ?? base.scaleX) * (trackingContext?.deltaScale ? trackingContext.deltaScale[0] : 1);
	const sY =
		(scale?.[1] ?? base.scaleY) * (trackingContext?.deltaScale ? trackingContext.deltaScale[1] : 1);
	const rot =
		trackingContext?.deltaRotation !== undefined
			? trackingContext.deltaRotation
			: finite(read('rotation'), base.rotation);

	result.transform = {
		x: posX,
		y: posY,
		scaleX: sX,
		scaleY: sY,
		rotation: rot,
		opacity: Math.min(1, Math.max(0, finite(read('opacity'), base.opacity)))
	};
	if (anchor && (anchor[0] !== 0 || anchor[1] !== 0))
		result.anchor = { x: anchor[0], y: anchor[1] };
	const cropValue = read('crop');
	if (isCrop(cropValue)) {
		const crop = clampCrop(cropValue);
		if (!isDefaultCrop(crop)) result.crop = crop;
	}
	return result;
}

export interface ActiveLayer {
	clipId: Clip['id'];
	instanceKey?: string;
	assetId?: AssetId;
	trackId: TrackId;
	trackOrder: number;
	sourceTime: Time;
	kind: 'video' | 'image' | 'solid' | 'adjustment' | 'text' | 'sequence' | 'shape';
	opacity: number;
	transform?: Clip['transform'];
	/** Pivot offset from the layer center, in composition pixels. */
	anchor?: { x: number; y: number };
	blendMode?: BlendMode;
	/** Fit mode: contain (default, letterbox) or none (unscaled 1:1, used for text layers). */
	fit?: 'contain' | 'none';
	/** Source insets [left, top, right, bottom] as fractions; the visible part keeps its position. */
	crop?: Crop;
	solidColor?: { r: number; g: number; b: number; a: number };
	solidGradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
	solidGradientColorEnd?: { r: number; g: number; b: number; a: number };
	solidGradientAngle?: number;
	shapeData?: import('./shapes/shapeTypes').ShapeConfig;
	/** Text content and evaluated styling for text layers */
	textData?: {
		text: string;
		style: import('./types').TextStyle;
		box?: import('./types').TextBox;
		fontSize: number;
		fillColor: { r: number; g: number; b: number; a: number };
		strokeColor: { r: number; g: number; b: number; a: number };
		strokeWidth: number;
		letterSpacing: number;
		lineHeight: number;
		reveal: number;
		shadowColor?: { r: number; g: number; b: number; a: number };
		shadowBlur?: number;
		shadowOffsetX?: number;
		shadowOffsetY?: number;
		backgroundBoxColor?: { r: number; g: number; b: number; a: number };
		backgroundBoxPadding?: number;
		backgroundBoxRadius?: number;
		boxBorderColor?: { r: number; g: number; b: number; a: number };
		boxBorderWidth?: number;
		accentBarColor?: { r: number; g: number; b: number; a: number };
		accentBarWidth?: number;
		frameStyle?: import('./types').GraphicFrameStyle;
		badgeText?: string;
		gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
		gradientColorEnd?: { r: number; g: number; b: number; a: number };
		gradientAngle?: number;
		colorRuns?: Array<{
			startIndex: number;
			endIndex: number;
			fillColor?: { r: number; g: number; b: number; a: number };
			strokeColor?: { r: number; g: number; b: number; a: number };
		}>;
	};
	masks?: EvaluatedMask[];
	effects?: EvaluatedEffect[];
	/** Transition details when this layer represents a transition blend between two layers */
	transition?: {
		type: string;
		progress: number;
		fromLayer: ActiveLayer;
		toLayer: ActiveLayer;
		params: Record<string, JsonValue>;
	};
	/** Nested sequence details when kind === 'sequence' */
	nested?: {
		sequenceId: import('./types').SequenceId;
		nestedTime: Time;
		size: { width: number; height: number };
		layers: ActiveLayer[];
	};
}

export interface ActiveAudio {
	clipId: Clip['id'];
	assetId: AssetId;
	trackId: TrackId;
	trackOrder: number;
	sourceTime: Time;
	volume: number;
}

export interface ResolvedFrame {
	videoLayers: ActiveLayer[];
	audioSources: ActiveAudio[];
	duration: Time;
	missing: AssetId[];
}

import { resolveAudibleTracks, clipGainAt } from './audioMath';

export function resolveFrame(
	project: Project,
	time: Time,
	depth = 0,
	maxDepth = 8,
	instancePrefix = ''
): ResolvedFrame {
	if (!Number.isSafeInteger(time) || time < 0) {
		throw new RangeError('Playback time must be a non-negative integer tick value.');
	}

	const videoLayers: ActiveLayer[] = [];
	const audioSources: ActiveAudio[] = [];
	const missing = new Set<AssetId>();
	const audibleAudioTracks = resolveAudibleTracks(project.tracks);

	// Build clip lookup map per track
	for (const [trackOrder, track] of project.tracks.entries()) {
		if (track.kind === 'video' && track.hidden) {
			continue;
		}
		if (track.kind === 'audio' && !audibleAudioTracks.has(track.id)) {
			continue;
		}

		if (track.kind === 'caption') {
			if (track.hidden) continue;
			const caption = (track.captions ?? []).find((c) => c.start <= time && time < c.end);
			if (!caption) continue;

			const cStyle = track.captionStyle ?? DEFAULT_CAPTION_STYLE;
			const marginPct = (cStyle.marginPercent ?? 7) / 100;
			const posX = cStyle.customX ?? 0;
			let posY = 0;
			if (cStyle.positionPreset === 'top') {
				posY = -Math.round(project.settings.height * (0.5 - marginPct - 0.05));
			} else if (cStyle.positionPreset === 'bottom') {
				posY = Math.round(project.settings.height * (0.5 - marginPct - 0.05));
			} else if (cStyle.positionPreset === 'custom') {
				posY = cStyle.customY ?? 0;
			}

			let opacity = 1;
			if (cStyle.fadeMs && cStyle.fadeMs > 0) {
				const elapsedMs = (time - caption.start) / 1000;
				const remainMs = (caption.end - time) / 1000;
				if (elapsedMs < cStyle.fadeMs) opacity = Math.min(opacity, elapsedMs / cStyle.fadeMs);
				if (remainMs < cStyle.fadeMs) opacity = Math.min(opacity, remainMs / cStyle.fadeMs);
				opacity = Math.max(0, Math.min(1, opacity));
			}

			let colorRuns:
				| Array<{
						startIndex: number;
						endIndex: number;
						fillColor?: { r: number; g: number; b: number; a: number };
						strokeColor?: { r: number; g: number; b: number; a: number };
				  }>
				| undefined;

			if (
				cStyle.highlightMode &&
				cStyle.highlightMode !== 'none' &&
				cStyle.highlightColor &&
				caption.words &&
				caption.words.length > 0
			) {
				const hMode = cStyle.highlightMode;
				const hColor = cStyle.highlightColor;
				const words = caption.words;

				if (hMode === 'word') {
					const activeIdx = words.findIndex((w) => w.start <= time && time < w.end);
					if (activeIdx !== -1) {
						const span = findWordSpanInText(caption.text, words, activeIdx);
						if (span) {
							colorRuns = [
								{
									startIndex: span.start,
									endIndex: span.end,
									fillColor: hColor,
									strokeColor: cStyle.strokeColor
								}
							];
						}
					}
				} else if (hMode === 'progressive') {
					let lastSpokenIdx = -1;
					for (let wIdx = 0; wIdx < words.length; wIdx++) {
						if (time >= words[wIdx]!.start) {
							lastSpokenIdx = wIdx;
						}
					}
					if (lastSpokenIdx !== -1) {
						const span = findWordSpanInText(caption.text, words, lastSpokenIdx);
						if (span) {
							colorRuns = [
								{
									startIndex: 0,
									endIndex: span.end,
									fillColor: hColor,
									strokeColor: cStyle.strokeColor
								}
							];
						}
					}
				}
			}

			videoLayers.push({
				clipId: caption.id as unknown as ClipId,
				trackId: track.id,
				trackOrder,
				sourceTime: time - caption.start,
				kind: 'text',
				fit: 'none',
				opacity,
				transform: {
					x: posX,
					y: posY,
					scaleX: 1,
					scaleY: 1,
					rotation: 0,
					opacity: 1
				},
				textData: {
					text: caption.text,
					style: {
						fontFamily: cStyle.fontFamily,
						fontWeight: cStyle.fontWeight,
						fontStyle: cStyle.fontStyle,
						alignment: cStyle.alignment,
						lineHeight: 1.25,
						letterSpacing: 0
					},
					box: {
						autoSize: true,
						paddingX: cStyle.backgroundColor ? 24 : 0,
						paddingY: cStyle.backgroundColor ? 14 : 0
					},
					fontSize: cStyle.fontSize,
					fillColor: cStyle.color,
					strokeColor: cStyle.strokeColor ?? { r: 0, g: 0, b: 0, a: 0 },
					strokeWidth: cStyle.strokeWidth ?? 0,
					letterSpacing: 0,
					lineHeight: 1.25,
					reveal: 1,
					shadowColor: cStyle.shadowColor,
					shadowBlur: cStyle.shadowBlur,
					shadowOffsetX: cStyle.shadowOffsetX,
					shadowOffsetY: cStyle.shadowOffsetY,
					backgroundBoxColor: cStyle.backgroundColor,
					backgroundBoxPadding: cStyle.backgroundColor ? 18 : 0,
					backgroundBoxRadius: cStyle.backgroundColor ? 8 : 0,
					colorRuns
				}
			});
			continue;
		}

		// Helper to build ActiveLayer for a clip at a timeline time t (even if outside clip.start..clipEnd for handles)
		const makeClipLayer = (clip: Clip, t: Time): ActiveLayer | null => {
			const localTime = t - clip.start;
			const evaluatedEffects =
				!clip.bypassEffects && clip.effects && clip.effects.length > 0
					? clip.effects.map((eff) => evaluateEffect(eff, localTime))
					: undefined;
			const evaluatedMasks =
				clip.masks && clip.masks.length > 0
					? clip.masks.map((m) => evaluateMask(m, localTime, clip.properties))
					: undefined;

			// Check if any tracked clip in the project binds to this clip
			const trackingCtx = resolveTrackingContext(project, clip.id, t);

			if (clip.source?.type === 'adjustment') {
				if (track.kind !== 'video') return null;
				return {
					clipId: clip.id,
					trackId: track.id,
					trackOrder,
					sourceTime: localTime,
					kind: 'adjustment',
					opacity: 1,
					masks: evaluatedMasks,
					effects: evaluatedEffects,
					...evaluateLayerProperties(clip, localTime, trackingCtx)
				};
			}

			if (clip.source?.type === 'solid') {
				if (track.kind !== 'video') return null;
				return {
					clipId: clip.id,
					trackId: track.id,
					trackOrder,
					sourceTime: localTime,
					kind: 'solid',
					solidColor: clip.source.color,
					solidGradientType: clip.source.gradientType,
					solidGradientColorEnd: clip.source.gradientColorEnd,
					solidGradientAngle: clip.source.gradientAngle,
					opacity: 1,
					masks: evaluatedMasks,
					effects: evaluatedEffects,
					...evaluateLayerProperties(clip, localTime, trackingCtx)
				};
			}

			if (clip.source?.type === 'shape') {
				if (track.kind !== 'video') return null;
				const shapeSource = clip.source;
				const props = clip.properties;
				const read = (id: string, fallback: unknown): unknown => {
					const anim = props?.[id] as AnimatedValue<unknown> | undefined;
					return anim ? evaluateOr(anim, localTime, fallback) : fallback;
				};

				const width = finite(
					read('shape.width', shapeSource.width ?? 300),
					shapeSource.width ?? 300
				);
				const height = finite(
					read('shape.height', shapeSource.height ?? 200),
					shapeSource.height ?? 200
				);

				const rawFill = read('shape.fillColor', null);
				const fillColor =
					Array.isArray(rawFill) && rawFill.length >= 4
						? {
								r: finite(rawFill[0], 1),
								g: finite(rawFill[1], 1),
								b: finite(rawFill[2], 1),
								a: finite(rawFill[3], 1)
							}
						: shapeSource.fillColor;

				const rawStroke = read('shape.strokeColor', null);
				const strokeColor =
					Array.isArray(rawStroke) && rawStroke.length >= 4
						? {
								r: finite(rawStroke[0], 0),
								g: finite(rawStroke[1], 0),
								b: finite(rawStroke[2], 0),
								a: finite(rawStroke[3], 1)
							}
						: shapeSource.strokeColor;

				const strokeWidth = finite(read('shape.strokeWidth', shapeSource.strokeWidth ?? 0), 0);
				const cornerRadius = finite(read('shape.cornerRadius', shapeSource.cornerRadius ?? 0), 0);

				const rawShadow = read('shape.shadowColor', null);
				const shadowColor =
					Array.isArray(rawShadow) && rawShadow.length >= 4
						? {
								r: finite(rawShadow[0], 0),
								g: finite(rawShadow[1], 0),
								b: finite(rawShadow[2], 0),
								a: finite(rawShadow[3], 1)
							}
						: shapeSource.shadowColor;
				const shadowBlur = finite(read('shape.shadowBlur', shapeSource.shadowBlur ?? 0), 0);
				const shadowOffsetX = finite(
					read('shape.shadowOffsetX', shapeSource.shadowOffsetX ?? 0),
					0
				);
				const shadowOffsetY = finite(
					read('shape.shadowOffsetY', shapeSource.shadowOffsetY ?? 0),
					0
				);

				return {
					clipId: clip.id,
					trackId: track.id,
					trackOrder,
					sourceTime: localTime,
					kind: 'shape',
					fit: 'none',
					opacity: 1,
					shapeData: {
						shapeType: shapeSource.shapeType,
						width,
						height,
						fillColor,
						strokeColor,
						strokeWidth,
						strokeStyle: shapeSource.strokeStyle,
						cornerRadius,
						points: shapeSource.points,
						innerRadius: shapeSource.innerRadius,
						shadowColor,
						shadowBlur,
						shadowOffsetX,
						shadowOffsetY,
						gradientType: shapeSource.gradientType,
						gradientColorEnd: shapeSource.gradientColorEnd,
						gradientAngle: shapeSource.gradientAngle
					},
					masks: evaluatedMasks,
					effects: evaluatedEffects,
					...evaluateLayerProperties(clip, localTime, trackingCtx)
				};
			}

			if (clip.source?.type === 'text') {
				if (track.kind !== 'video') return null;
				const style = clip.source.style ?? { fontFamily: 'sans-serif' };
				const box = clip.source.box;
				const props = clip.properties;
				const read = (id: string, fallback: unknown): unknown => {
					const anim = props?.[id] as AnimatedValue<unknown> | undefined;
					return anim ? evaluateOr(anim, localTime, fallback) : fallback;
				};

				const fontSize = finite(read('text.fontSize', 48), 48);
				const rawFill = read('text.fillColor', [1, 1, 1, 1]);
				const fillColor =
					Array.isArray(rawFill) && rawFill.length >= 4
						? {
								r: finite(rawFill[0], 1),
								g: finite(rawFill[1], 1),
								b: finite(rawFill[2], 1),
								a: finite(rawFill[3], 1)
							}
						: { r: 1, g: 1, b: 1, a: 1 };
				const rawStroke = read('text.strokeColor', [0, 0, 0, 1]);
				const strokeColor =
					Array.isArray(rawStroke) && rawStroke.length >= 4
						? {
								r: finite(rawStroke[0], 0),
								g: finite(rawStroke[1], 0),
								b: finite(rawStroke[2], 0),
								a: finite(rawStroke[3], 1)
							}
						: { r: 0, g: 0, b: 0, a: 1 };
				const strokeWidth = finite(read('text.strokeWidth', 0), 0);
				const letterSpacing = finite(read('text.letterSpacing', style.letterSpacing ?? 0), 0);
				const lineHeight = finite(read('text.lineHeight', style.lineHeight ?? 1.2), 1.2);
				const reveal = Math.min(1, Math.max(0, finite(read('text.reveal', 1), 1)));

				const rawShadow = read('text.shadowColor', null);
				const shadowBlur = finite(read('text.shadowBlur', 0), 0);
				const shadowOffsetX = finite(read('text.shadowOffsetX', 0), 0);
				const shadowOffsetY = finite(read('text.shadowOffsetY', 0), 0);
				// A shadow with a size or offset but no colour of its own uses the default drop shadow.
				const hasShadowShape = shadowBlur > 0 || shadowOffsetX !== 0 || shadowOffsetY !== 0;
				const shadowColor =
					Array.isArray(rawShadow) && rawShadow.length >= 4
						? {
								r: finite(rawShadow[0], 0),
								g: finite(rawShadow[1], 0),
								b: finite(rawShadow[2], 0),
								a: finite(rawShadow[3], 1)
							}
						: hasShadowShape
							? { r: 0, g: 0, b: 0, a: 0.6 }
							: undefined;

				const rawBg = read('text.backgroundBoxColor', null);
				const backgroundBoxColor =
					Array.isArray(rawBg) && rawBg.length >= 4
						? {
								r: finite(rawBg[0], 0),
								g: finite(rawBg[1], 0),
								b: finite(rawBg[2], 0),
								a: finite(rawBg[3], 1)
							}
						: undefined;
				const backgroundBoxRadius = finite(read('text.backgroundBoxRadius', 0), 0);
				const backgroundBoxPadding = finite(read('text.backgroundBoxPadding', 0), 0);

				const rawBorder = read('text.boxBorderColor', null);
				const boxBorderColor =
					Array.isArray(rawBorder) && rawBorder.length >= 4
						? {
								r: finite(rawBorder[0], 1),
								g: finite(rawBorder[1], 1),
								b: finite(rawBorder[2], 1),
								a: finite(rawBorder[3], 1)
							}
						: clip.source.box?.borderColor;
				const boxBorderWidth = finite(
					read('text.boxBorderWidth', clip.source.box?.borderWidth ?? 0),
					0
				);

				const rawAccentBar = read('text.accentBarColor', null);
				const accentBarColor =
					Array.isArray(rawAccentBar) && rawAccentBar.length >= 4
						? {
								r: finite(rawAccentBar[0], 1),
								g: finite(rawAccentBar[1], 1),
								b: finite(rawAccentBar[2], 1),
								a: finite(rawAccentBar[3], 1)
							}
						: clip.source.box?.accentBarColor;
				const accentBarWidth = finite(
					read('text.accentBarWidth', clip.source.box?.accentBarWidth ?? 0),
					0
				);

				const frameStyle = clip.source.box?.frameStyle;
				const badgeText = clip.source.box?.badgeText;
				const gradientType = clip.source.box?.gradientType;
				const gradientColorEnd = clip.source.box?.gradientColorEnd;
				const gradientAngle = clip.source.box?.gradientAngle;

				const colorRuns =
					'colorRuns' in clip.source && Array.isArray(clip.source.colorRuns)
						? (clip.source.colorRuns as NonNullable<
								import('./playback').ActiveLayer['textData']
							>['colorRuns'])
						: undefined;

				return {
					clipId: clip.id,
					trackId: track.id,
					trackOrder,
					sourceTime: localTime,
					kind: 'text',
					fit: 'none',
					opacity: 1,
					textData: {
						text: clip.source.text,
						style,
						box,
						fontSize,
						fillColor,
						strokeColor,
						strokeWidth,
						letterSpacing,
						lineHeight,
						reveal,
						shadowColor,
						shadowBlur,
						shadowOffsetX,
						shadowOffsetY,
						backgroundBoxColor,
						backgroundBoxRadius,
						backgroundBoxPadding,
						boxBorderColor,
						boxBorderWidth,
						accentBarColor,
						accentBarWidth,
						frameStyle,
						badgeText,
						gradientType,
						gradientColorEnd,
						gradientAngle,
						colorRuns
					},
					masks: evaluatedMasks,
					effects: evaluatedEffects,
					...evaluateLayerProperties(clip, localTime, trackingCtx)
				};
			}

			const hostInstanceKey = instancePrefix ? `${instancePrefix}/${clip.id}` : clip.id;

			if (clip.source?.type === 'sequence') {
				const nestedSeqId = clip.source.sequenceId;
				const nestedSeq = getSequence(project, nestedSeqId);
				if (!nestedSeq || depth >= maxDepth) return null;

				let rawSource = timelineToSource(clip, t);
				const seqDur = nestedSeq.tracks.reduce((d, trk) => {
					const cMax = trk.clips.reduce((lat, c) => Math.max(lat, clipEnd(c)), d);
					return (trk.captions ?? []).reduce((lat, cap) => Math.max(lat, cap.end), cMax);
				}, 0);

				if (clip.source.responsiveTiming && seqDur > 0) {
					rawSource = computeResponsiveTemplateTime(
						rawSource,
						clip.duration,
						seqDur,
						clip.source.responsiveTiming
					);
				}

				// Past sequence end renders transparent (empty layers)
				const isPastEnd = rawSource < 0 || (seqDur > 0 && rawSource >= seqDur);
				let nestedView = viewProject(project, nestedSeqId);
				if (
					clip.source.publishedParams &&
					clip.source.paramOverrides &&
					Object.keys(clip.source.paramOverrides).length > 0
				) {
					const overriddenSeq = applyParamOverridesToSequence(
						nestedSeq,
						clip.source.publishedParams,
						clip.source.paramOverrides
					);
					nestedView = {
						...nestedView,
						tracks: overriddenSeq.tracks
					};
				}
				const childResolved = isPastEnd
					? { videoLayers: [], audioSources: [], duration: seqDur, missing: [] }
					: resolveFrame(nestedView, rawSource, depth + 1, maxDepth, hostInstanceKey);

				for (const m of childResolved.missing) missing.add(m);

				const seqSettings = nestedView.settings;
				const isCustomSized =
					Boolean(nestedSeq.settings?.width && nestedSeq.settings?.height) ||
					Boolean(clip.source.templateId);
				return {
					clipId: clip.id,
					instanceKey: hostInstanceKey,
					trackId: track.id,
					trackOrder,
					sourceTime: rawSource,
					kind: 'sequence',
					opacity: 1,
					fit: isCustomSized ? 'none' : 'contain',
					nested: {
						sequenceId: nestedSeqId,
						nestedTime: rawSource,
						size: { width: seqSettings.width, height: seqSettings.height },
						layers: childResolved.videoLayers
					},
					masks: evaluatedMasks,
					effects: evaluatedEffects,
					...evaluateLayerProperties(clip, localTime, trackingCtx)
				};
			}

			if (!clip.assetId) return null;
			const asset = project.assets[clip.assetId];
			if (!asset) return null;
			if (asset.offline) {
				missing.add(asset.id);
				return null;
			}

			const rawSource = timelineToSource(clip, t);
			const maxSource = asset.duration > 0 ? asset.duration : rawSource;
			const sourceTime = Math.max(0, Math.min(maxSource, rawSource));
			const leafInstanceKey = instancePrefix ? `${instancePrefix}/${clip.id}` : clip.id;
			if (track.kind === 'video' && (asset.kind === 'video' || asset.kind === 'image')) {
				return {
					clipId: clip.id,
					instanceKey: leafInstanceKey,
					assetId: asset.id,
					trackId: track.id,
					trackOrder,
					sourceTime,
					kind: asset.kind,
					opacity: 1,
					masks: evaluatedMasks,
					effects: evaluatedEffects,
					...evaluateLayerProperties(clip, localTime, trackingCtx)
				};
			}
			return null;
		};

		// Check active transitions on this track at current time
		const trackTransitions = track.transitions;
		const activeTransitions =
			trackTransitions && trackTransitions.length > 0
				? trackTransitions.filter((tr) => {
						let cutTime = 0;
						if (tr.edge.kind === 'cut') {
							const edge = tr.edge;
							const cA = track.clips.find((c) => c.id === edge.fromClipId);
							const cB = track.clips.find((c) => c.id === edge.toClipId);
							if (!cA || !cB) return false;
							cutTime = clipEnd(cA);
						} else if (tr.edge.kind === 'head') {
							const edge = tr.edge;
							const c = track.clips.find((c) => c.id === edge.clipId);
							if (!c) return false;
							cutTime = c.start;
						} else {
							const edge = tr.edge;
							const c = track.clips.find((c) => c.id === edge.clipId);
							if (!c) return false;
							cutTime = clipEnd(c);
						}
						const win = transitionWindow(cutTime, tr.duration, tr.alignment);
						return time >= win.start && time < win.end;
					})
				: [];

		if (activeTransitions.length > 0) {
			const tr = activeTransitions[0];
			let cutTime = 0;
			let clipA: Clip | undefined;
			let clipB: Clip | undefined;

			if (tr.edge.kind === 'cut') {
				const edge = tr.edge;
				clipA = track.clips.find((c) => c.id === edge.fromClipId);
				clipB = track.clips.find((c) => c.id === edge.toClipId);
				if (clipA) cutTime = clipEnd(clipA);
			} else if (tr.edge.kind === 'head') {
				const edge = tr.edge;
				clipB = track.clips.find((c) => c.id === edge.clipId);
				if (clipB) cutTime = clipB.start;
			} else {
				const edge = tr.edge;
				clipA = track.clips.find((c) => c.id === edge.clipId);
				if (clipA) cutTime = clipEnd(clipA);
			}

			const win = transitionWindow(cutTime, tr.duration, tr.alignment);
			const progress = transitionProgress(time, win, tr.easing ?? 'linear');

			if (track.kind === 'video') {
				let layerA = clipA ? makeClipLayer(clipA, time) : null;
				let layerB = clipB ? makeClipLayer(clipB, time) : null;

				// If head transition (only clipB), create companion blank layer for layerA
				// so transition shaders (glitch, wipe, dissolve, etc.) execute with full visual fidelity
				if (!layerA && layerB && clipB) {
					layerA = {
						clipId: `blank_head_${clipB.id}` as ClipId,
						trackId: track.id,
						trackOrder,
						sourceTime: 0,
						kind: 'solid',
						solidColor:
							tr.type === 'dipToWhite'
								? { r: 1, g: 1, b: 1, a: 1 }
								: tr.type === 'dipToBlack'
									? { r: 0, g: 0, b: 0, a: 1 }
									: { r: 0, g: 0, b: 0, a: 0 },
						opacity: 1
					};
				} else if (layerA && !layerB && clipA) {
					layerB = {
						clipId: `blank_tail_${clipA.id}` as ClipId,
						trackId: track.id,
						trackOrder,
						sourceTime: 0,
						kind: 'solid',
						solidColor:
							tr.type === 'dipToWhite'
								? { r: 1, g: 1, b: 1, a: 1 }
								: tr.type === 'dipToBlack'
									? { r: 0, g: 0, b: 0, a: 1 }
									: { r: 0, g: 0, b: 0, a: 0 },
						opacity: 1
					};
				}

				if (layerA && layerB) {
					// Both clips present (cut transition or single-clip with companion blank): emit composite transition layer
					videoLayers.push({
						clipId: layerA.clipId,
						trackId: track.id,
						trackOrder,
						sourceTime: layerA.sourceTime,
						kind: layerA.kind,
						opacity: 1,
						transition: {
							type: tr.type,
							progress,
							fromLayer: layerA,
							toLayer: layerB,
							params: tr.params
						}
					});
				}

				// If the video transition has audioCrossfade enabled (default true), apply audio crossfade to the audio components of clipA & clipB
				if (tr.audioCrossfade !== false) {
					const { gainA, gainB } = transitionGain(time, win, 'equalPower');
					if (clipA && clipA.assetId) {
						const assetA = project.assets[clipA.assetId];
						if (assetA?.hasAudio && !assetA.offline) {
							audioSources.push({
								clipId: clipA.id,
								assetId: assetA.id,
								trackId: track.id,
								trackOrder,
								sourceTime: Math.max(0, timelineToSource(clipA, time)),
								volume: clipA.volume * gainA
							});
						}
					}
					if (clipB && clipB.assetId) {
						const assetB = project.assets[clipB.assetId];
						if (assetB?.hasAudio && !assetB.offline) {
							audioSources.push({
								clipId: clipB.id,
								assetId: assetB.id,
								trackId: track.id,
								trackOrder,
								sourceTime: Math.max(0, timelineToSource(clipB, time)),
								volume: clipB.volume * gainB
							});
						}
					}
				}
				continue;
			} else if (track.kind === 'audio') {
				const { gainA, gainB } = transitionGain(time, win, 'equalPower');
				if (clipA && clipA.assetId) {
					const assetA = project.assets[clipA.assetId];
					if (assetA?.hasAudio && !assetA.offline) {
						audioSources.push({
							clipId: clipA.id,
							assetId: assetA.id,
							trackId: track.id,
							trackOrder,
							sourceTime: Math.max(0, timelineToSource(clipA, time)),
							volume: clipA.volume * gainA
						});
					}
				}
				if (clipB && clipB.assetId) {
					const assetB = project.assets[clipB.assetId];
					if (assetB?.hasAudio && !assetB.offline) {
						audioSources.push({
							clipId: clipB.id,
							assetId: assetB.id,
							trackId: track.id,
							trackOrder,
							sourceTime: Math.max(0, timelineToSource(clipB, time)),
							volume: clipB.volume * gainB
						});
					}
				}
				continue;
			}
		}

		// Standard non-transition clip loop (fast path bit-identical to Phase 1 / Gate H/I/J)
		for (const clip of track.clips) {
			if (time < clip.start || time >= clipEnd(clip)) continue;

			if (track.kind === 'video') {
				const layer = makeClipLayer(clip, time);
				if (layer) videoLayers.push(layer);
				continue;
			}

			if (track.kind === 'audio') {
				if (clip.source?.type === 'sequence') {
					const nestedSeqId = clip.source.sequenceId;
					const nestedSeq = getSequence(project, nestedSeqId);
					if (nestedSeq && depth < maxDepth) {
						let rawSource = timelineToSource(clip, time);
						if (clip.source.responsiveTiming) {
							const seqDur = nestedSeq.tracks.reduce((d, trk) => {
								const cMax = trk.clips.reduce((lat, c) => Math.max(lat, clipEnd(c)), d);
								return (trk.captions ?? []).reduce((lat, cap) => Math.max(lat, cap.end), cMax);
							}, 0);
							if (seqDur > 0) {
								rawSource = computeResponsiveTemplateTime(
									rawSource,
									clip.duration,
									seqDur,
									clip.source.responsiveTiming
								);
							}
						}
						const hostInstanceKey = instancePrefix ? `${instancePrefix}/${clip.id}` : clip.id;
						let nestedView = viewProject(project, nestedSeqId);
						if (
							clip.source.publishedParams &&
							clip.source.paramOverrides &&
							Object.keys(clip.source.paramOverrides).length > 0
						) {
							const overriddenSeq = applyParamOverridesToSequence(
								nestedSeq,
								clip.source.publishedParams,
								clip.source.paramOverrides
							);
							nestedView = {
								...nestedView,
								tracks: overriddenSeq.tracks
							};
						}
						const childResolved = resolveFrame(
							nestedView,
							rawSource,
							depth + 1,
							maxDepth,
							hostInstanceKey
						);
						const hostGain = clipGainAt(clip, time);
						for (const src of childResolved.audioSources) {
							audioSources.push({
								...src,
								trackId: track.id,
								trackOrder,
								volume: src.volume * hostGain
							});
						}
					}
					continue;
				}

				if (!clip.assetId) continue;
				const asset = project.assets[clip.assetId];
				if (!asset) continue;
				if (asset.offline) {
					missing.add(asset.id);
					continue;
				}
				if (asset.hasAudio) {
					audioSources.push({
						clipId: clip.id,
						assetId: asset.id,
						trackId: track.id,
						trackOrder,
						sourceTime: Math.max(0, timelineToSource(clip, time)),
						volume: clipGainAt(clip, time)
					});
				}
			}
		}
	}

	return {
		videoLayers: videoLayers.reverse(),
		audioSources,
		duration: timelineDuration(project),
		missing: [...missing]
	};
}

export function nextBoundary(
	project: Project,
	time: Time,
	direction: 1 | -1,
	depth = 0,
	maxDepth = 8
): Time | null {
	if (!Number.isSafeInteger(time) || time < 0) {
		throw new RangeError('Playback time must be a non-negative integer tick value.');
	}
	const boundaries = project.tracks.flatMap((track) => [
		...track.clips.flatMap((clip) => {
			const clipBounds = [clip.start, clipEnd(clip)];
			if (clip.source?.type === 'sequence' && depth < maxDepth) {
				const nestedSeq = getSequence(project, clip.source.sequenceId);
				if (nestedSeq) {
					const nestedView = viewProject(project, clip.source.sequenceId);
					for (const nTrack of nestedView.tracks) {
						for (const nClip of nTrack.clips) {
							// Map nested clip boundaries to host time
							const bStart = clip.start + (nClip.start - clip.sourceIn) / (clip.speed || 1);
							const bEnd = clip.start + (clipEnd(nClip) - clip.sourceIn) / (clip.speed || 1);
							if (bStart >= clip.start && bStart <= clipEnd(clip))
								clipBounds.push(Math.round(bStart));
							if (bEnd >= clip.start && bEnd <= clipEnd(clip)) clipBounds.push(Math.round(bEnd));
						}
					}
				}
			}
			return clipBounds;
		}),
		...(track.captions ?? []).flatMap((cap) => [cap.start, cap.end])
	]);
	if (direction === 1) {
		return boundaries.filter((boundary) => boundary > time).toSorted((a, b) => a - b)[0] ?? null;
	}
	return boundaries.filter((boundary) => boundary < time).toSorted((a, b) => b - a)[0] ?? null;
}
