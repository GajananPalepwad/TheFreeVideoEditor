/**
 * Motion Tracking Apply: Follow (live), Bake, offsets, and space conversions.
 * Maps tracked normalized source coordinates into composition pixel space
 * through the tracked clip's evaluated layer geometry (layerAffine),
 * capturing initial target offsets and baking keyframes with thinning.
 */

import { applyAffine, layerAffine } from '../layerGeometry';
import { evaluateLayerProperties } from '../playback';
import { timelineToSource } from '../timeRemap';
import { evaluateTracker, type EvaluatedTrackerState } from './evaluateTracker';
import type {
	AnimatedValue,
	Clip,
	ClipId,
	Keyframe,
	Project,
	PropertyId,
	Time,
	Tracker
} from '../types';

export interface TrackerBindingConfig {
	targetClipId: ClipId;
	applyPosition: boolean;
	applyRotation: boolean;
	applyScale: boolean;
	offsetPosition?: [number, number];
	offsetRotation?: number;
	offsetScale?: [number, number];
}

export interface EvaluatedTrackingMotion {
	/** Composition space position relative to center [pxX, pxY] */
	position: [number, number];
	/** Rotation in degrees */
	rotation: number;
	/** Scale multiplier [sx, sy] */
	scale: [number, number];
	confidence: number;
	lost: boolean;
	active: boolean;
}

/**
 * Maps a tracker sample/state at sourceTime into composition coordinates
 * via the tracked clip's evaluated geometry.
 */
export function trackedPointToComposition(
	trackedClip: Clip,
	trackerState: EvaluatedTrackerState,
	projectWidth: number,
	projectHeight: number,
	sourceWidth: number,
	sourceHeight: number,
	localTime: Time
): { x: number; y: number } {
	const evalProps = evaluateLayerProperties(trackedClip, localTime);

	const affine = layerAffine(
		{
			transform: evalProps.transform,
			anchor: evalProps.anchor,
			crop: evalProps.crop,
			fit: 'contain'
		},
		sourceWidth,
		sourceHeight,
		projectWidth,
		projectHeight
	);

	// Unit quad in cropped coordinate space
	const [cropL, cropT, cropR, cropB] = evalProps.crop ?? [0, 0, 0, 0];
	const denomU = Math.max(1e-6, 1 - cropL - cropR);
	const denomV = Math.max(1e-6, 1 - cropT - cropB);

	const u = (trackerState.x - cropL) / denomU;
	const v = (trackerState.y - cropT) / denomV;

	const mapped = applyAffine(affine, u, v);

	// Composition coordinates relative to composition center
	return {
		x: mapped.x - projectWidth / 2,
		y: mapped.y - projectHeight / 2
	};
}

/**
 * Evaluates live tracking motion binding for targetClip at timeline time t.
 */
export function evaluateLiveTrackingBinding(
	project: Project,
	trackedClip: Clip,
	tracker: Tracker,
	timelineTime: Time,
	sourceWidth: number = 1920,
	sourceHeight: number = 1080
): EvaluatedTrackingMotion | null {
	if (!tracker?.enabled || !tracker.binding) return null;

	// Check whether timelineTime is within trackedClip range
	if (
		timelineTime < trackedClip.start ||
		timelineTime >= trackedClip.start + trackedClip.duration
	) {
		return {
			position: [0, 0],
			rotation: 0,
			scale: [1, 1],
			confidence: 0,
			lost: true,
			active: false
		};
	}

	const sourceTime = timelineToSource(trackedClip, timelineTime);
	const evalState = evaluateTracker(tracker, sourceTime);

	const localTime = timelineTime - trackedClip.start;
	const posComp = trackedPointToComposition(
		trackedClip,
		evalState,
		project.settings.width,
		project.settings.height,
		sourceWidth,
		sourceHeight,
		localTime
	);

	const binding = tracker.binding;
	const offPos = binding.offsetPosition ?? [0, 0];
	const offRot = binding.offsetRotation ?? 0;
	const offScale = binding.offsetScale ?? [1, 1];

	// Target follows tracked rotation & scale relative to initial seed state
	const rotDeg = binding.applyRotation ? (evalState.rotation * 180) / Math.PI : 0;
	const totalRot = binding.applyRotation ? offRot + rotDeg : offRot;

	const scaleMult = binding.applyScale ? offScale[0] * evalState.scale : 1;
	const sx = binding.applyScale ? offScale[0] * evalState.scale : 1;
	const sy = binding.applyScale ? offScale[1] * evalState.scale : 1;

	// Rotate and scale offset vector
	let finalX = posComp.x;
	let finalY = posComp.y;

	if (binding.applyPosition) {
		const rad = (rotDeg * Math.PI) / 180;
		const cosR = Math.cos(rad);
		const sinR = Math.sin(rad);

		const rotOffX = (cosR * offPos[0] - sinR * offPos[1]) * scaleMult;
		const rotOffY = (sinR * offPos[0] + cosR * offPos[1]) * scaleMult;

		finalX += rotOffX;
		finalY += rotOffY;
	} else {
		finalX = offPos[0];
		finalY = offPos[1];
	}

	return {
		position: [finalX, finalY],
		rotation: totalRot,
		scale: [sx, sy],
		confidence: evalState.confidence,
		lost: evalState.lost,
		active: true
	};
}

/**
 * Captures initial target offsets at bind time so target remains visually stationary
 * at the playhead when first bound.
 */
export function captureBindingOffsets(
	project: Project,
	trackedClip: Clip,
	targetClip: Clip,
	tracker: Tracker,
	timelineTime: Time,
	sourceWidth: number = 1920,
	sourceHeight: number = 1080
): {
	offsetPosition: [number, number];
	offsetRotation: number;
	offsetScale: [number, number];
} {
	const sourceTime = timelineToSource(trackedClip, timelineTime);
	const evalState = evaluateTracker(tracker, sourceTime);

	const localTime = timelineTime - trackedClip.start;
	const trackerPosComp = trackedPointToComposition(
		trackedClip,
		evalState,
		project.settings.width,
		project.settings.height,
		sourceWidth,
		sourceHeight,
		localTime
	);

	const targetLocal = timelineTime - targetClip.start;
	const targetProps = evaluateLayerProperties(targetClip, targetLocal);
	const targetTransform = targetProps.transform ?? {
		x: 0,
		y: 0,
		scaleX: 1,
		scaleY: 1,
		rotation: 0,
		opacity: 1
	};

	const deltaRotDeg = (evalState.rotation * 180) / Math.PI;

	// Invert rotation on position offset
	const dx = targetTransform.x - trackerPosComp.x;
	const dy = targetTransform.y - trackerPosComp.y;

	const rad = (-deltaRotDeg * Math.PI) / 180;
	const offX = Math.cos(rad) * dx - Math.sin(rad) * dy;
	const offY = Math.sin(rad) * dx + Math.cos(rad) * dy;

	return {
		offsetPosition: [offX, offY],
		offsetRotation: targetTransform.rotation - deltaRotDeg,
		offsetScale: [1 / Math.max(1e-4, evalState.scale), 1 / Math.max(1e-4, evalState.scale)]
	};
}

/**
 * Douglas-Peucker thinning algorithm for 2D position trajectory.
 */
export function thinPositionKeyframes(
	keyframes: readonly Keyframe<[number, number]>[],
	tolerancePx: number = 0.5
): Keyframe<[number, number]>[] {
	if (keyframes.length <= 2) return [...keyframes];

	const sq = (v: number) => v * v;
	const tolSq = sq(tolerancePx);

	const d2 = (
		p: Keyframe<[number, number]>,
		p1: Keyframe<[number, number]>,
		p2: Keyframe<[number, number]>
	) => {
		const x = p.value[0];
		const y = p.value[1];
		const x1 = p1.value[0];
		const y1 = p1.value[1];
		const x2 = p2.value[0];
		const y2 = p2.value[1];

		const spanTime = p2.time - p1.time;
		if (spanTime <= 0) return sq(x - x1) + sq(y - y1);

		const alpha = (p.time - p1.time) / spanTime;
		const interpX = x1 + alpha * (x2 - x1);
		const interpY = y1 + alpha * (y2 - y1);
		return sq(x - interpX) + sq(y - interpY);
	};

	const simplify = (start: number, end: number, out: Set<number>) => {
		let maxDist = 0;
		let maxIdx = -1;

		for (let i = start + 1; i < end; i++) {
			const dist = d2(keyframes[i]!, keyframes[start]!, keyframes[end]!);
			if (dist > maxDist) {
				maxDist = dist;
				maxIdx = i;
			}
		}

		if (maxDist > tolSq && maxIdx !== -1) {
			out.add(maxIdx);
			simplify(start, maxIdx, out);
			simplify(maxIdx, end, out);
		}
	};

	const kept = new Set<number>([0, keyframes.length - 1]);
	simplify(0, keyframes.length - 1, kept);

	return [...kept].sort((a, b) => a - b).map((idx) => keyframes[idx]!);
}

/**
 * Bakes live tracking motion into discrete keyframes on targetClip.properties,
 * tagging generated keyframes and preserving existing user keyframes where appropriate.
 */
export function bakeTrackingToKeyframes(
	project: Project,
	trackedClip: Clip,
	targetClip: Clip,
	tracker: Tracker,
	thinningTolerancePx: number = 0.5,
	sourceWidth: number = 1920,
	sourceHeight: number = 1080
): Partial<Record<PropertyId, AnimatedValue<unknown>>> {
	if (!tracker.binding) return {};

	const binding = tracker.binding;
	const fps = project.settings.fps;
	const stepUs = Math.max(10_000, Math.round(1_000_000 / fps));

	const posKeyframes: Keyframe<[number, number]>[] = [];
	const rotKeyframes: Keyframe<number>[] = [];
	const scaleKeyframes: Keyframe<[number, number]>[] = [];

	const overlapStart = Math.max(trackedClip.start, targetClip.start);
	const overlapEnd = Math.min(
		trackedClip.start + trackedClip.duration,
		targetClip.start + targetClip.duration
	);

	for (let t = overlapStart; t <= overlapEnd; t += stepUs) {
		const targetLocalTime = t - targetClip.start;
		const motion = evaluateLiveTrackingBinding(
			project,
			trackedClip,
			tracker,
			t,
			sourceWidth,
			sourceHeight
		);
		if (!motion || !motion.active) continue;

		if (binding.applyPosition) {
			posKeyframes.push({
				time: targetLocalTime,
				value: [motion.position[0], motion.position[1]],
				interpolation: 'linear'
			});
		}

		if (binding.applyRotation) {
			rotKeyframes.push({
				time: targetLocalTime,
				value: motion.rotation,
				interpolation: 'linear'
			});
		}

		if (binding.applyScale) {
			const baseSx = targetClip.transform?.scaleX ?? 1;
			const baseSy = targetClip.transform?.scaleY ?? 1;
			scaleKeyframes.push({
				time: targetLocalTime,
				value: [baseSx * motion.scale[0], baseSy * motion.scale[1]],
				interpolation: 'linear'
			});
		}
	}

	const result: Partial<Record<PropertyId, AnimatedValue<unknown>>> = {};

	if (posKeyframes.length > 0) {
		const thinnedPos = thinPositionKeyframes(posKeyframes, thinningTolerancePx);
		result.position = { keyframes: thinnedPos };
	}

	if (rotKeyframes.length > 0) {
		result.rotation = { keyframes: rotKeyframes };
	}

	if (scaleKeyframes.length > 0) {
		result.scale = { keyframes: scaleKeyframes };
	}

	return result;
}
