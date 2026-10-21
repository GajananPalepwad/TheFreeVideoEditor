import { timelineDuration } from '../../core';
import type { Project, Time } from '../../core';

export type ExportContainerFormat = 'mp4' | 'webm' | 'mov' | 'wav';

export interface ExportSettings {
	format: ExportContainerFormat;
	codecId?: string;
	width: number;
	height: number;
	fps: number;
	videoBitrate: number;
	audio: boolean;
	audioBitrate: number;
	audioCodecId?: string;
	colorSpaceTag?: string;
	bitDepth?: number;
	alpha?: boolean;
	filename: string;
	range: 'timeline';
	normalizeAudio?: boolean;
	loudnessTargetLufs?: number;
}

export interface ExportPlan {
	totalFrames: number;
	frameDuration: number;
	durationUs: Time;
	width: number;
	height: number;
	fps: number;
	codecCandidates: readonly string[];
	timestamp: (frame: number) => Time;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator - 1n) / denominator;
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
	return (numerator + denominator / 2n) / denominator;
}

export function buildExportPlan(project: Project, settings: ExportSettings): ExportPlan {
	const durationUs = timelineDuration(project);
	if (durationUs <= 0) throw new Error('Add at least one clip to the timeline before exporting.');
	if (!Number.isSafeInteger(settings.fps) || settings.fps <= 0) {
		throw new RangeError('Export frame rate must be a positive integer.');
	}
	const isAudioOnly = settings.format === 'wav';
	if (
		!isAudioOnly &&
		![settings.width, settings.height].every((value) => Number.isSafeInteger(value) && value >= 2)
	) {
		throw new RangeError('Export dimensions must be positive integers of at least 2 pixels.');
	}
	const width =
		settings.format === 'mp4' || settings.format === 'mov'
			? settings.width - (settings.width % 2)
			: isAudioOnly
				? 2
				: settings.width;
	const height =
		settings.format === 'mp4' || settings.format === 'mov'
			? settings.height - (settings.height % 2)
			: isAudioOnly
				? 2
				: settings.height;
	const fps = settings.fps;
	const totalFrames = Number(ceilDivide(BigInt(durationUs) * BigInt(fps), 1_000_000n));
	if (!Number.isSafeInteger(totalFrames) || totalFrames < 1) {
		throw new RangeError('Timeline is too long to export safely.');
	}
	let codecCandidates: readonly string[] = ['avc'];
	if (settings.format === 'wav') {
		codecCandidates = ['pcm'];
	} else if (settings.format === 'mp4') {
		codecCandidates = settings.codecId?.includes('hevc') ? ['hevc', 'avc'] : ['avc'];
	} else if (settings.format === 'mov') {
		codecCandidates = settings.codecId?.includes('hevc') ? ['hevc', 'avc'] : ['avc'];
	} else {
		codecCandidates = settings.codecId?.includes('av1')
			? ['av1', 'vp9', 'vp8']
			: ['vp9', 'av1', 'vp8'];
	}

	return {
		totalFrames,
		frameDuration: 1_000_000 / fps,
		durationUs,
		width,
		height,
		fps,
		codecCandidates,
		timestamp(frame) {
			if (!Number.isSafeInteger(frame) || frame < 0 || frame >= totalFrames) {
				throw new RangeError('Export frame index is outside the plan.');
			}
			return Number(roundDivide(BigInt(frame) * 1_000_000n, BigInt(fps)));
		}
	};
}

export function frameAtTime(time: Time, fps: number): number {
	if (!Number.isSafeInteger(time) || time < 0 || !Number.isSafeInteger(fps) || fps <= 0) {
		throw new RangeError('Time and frame rate must be non-negative integer values.');
	}
	return Number(roundDivide(BigInt(time) * BigInt(fps), 1_000_000n));
}
