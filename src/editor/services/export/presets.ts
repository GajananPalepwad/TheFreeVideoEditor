import type { Project } from '../../core';
import type { ExportSettings } from './plan';

export type ResolutionPreset =
	| 'project'
	| '4k'
	| '1440p'
	| '1080p'
	| '720p'
	| '480p'
	| '9:16'
	| '1:1'
	| '4:5'
	| '21:9'
	| 'custom';
export type ExportQuality = 'low' | 'medium' | 'high' | 'pro' | 'custom';

export type DestinationPresetId =
	| 'custom'
	| 'youtube-1080p'
	| 'youtube-4k'
	| 'tiktok-reels-shorts'
	| 'instagram-post'
	| 'instagram-portrait';

export interface DestinationPreset {
	id: DestinationPresetId;
	label: string;
	description: string;
	resolutionPreset: ResolutionPreset;
	width: number;
	height: number;
	bitrateMbps: number;
	targetLufs: number;
	format: ExportSettings['format'];
}

export const DESTINATION_PRESETS: readonly DestinationPreset[] = [
	{
		id: 'youtube-1080p',
		label: 'YouTube (16:9 · 1080p Full HD)',
		description: '1920×1080 @ 16 Mbps · -14 LUFS',
		resolutionPreset: '1080p',
		width: 1920,
		height: 1080,
		bitrateMbps: 16,
		targetLufs: -14.0,
		format: 'mp4'
	},
	{
		id: 'youtube-4k',
		label: 'YouTube 4K (16:9 · 2160p Ultra HD)',
		description: '3840×2160 @ 45 Mbps · -14 LUFS',
		resolutionPreset: '4k',
		width: 3840,
		height: 2160,
		bitrateMbps: 45,
		targetLufs: -14.0,
		format: 'mp4'
	},
	{
		id: 'tiktok-reels-shorts',
		label: 'TikTok / Reels / Shorts (9:16 Vertical)',
		description: '1080×1920 @ 16 Mbps · -14 LUFS',
		resolutionPreset: '9:16',
		width: 1080,
		height: 1920,
		bitrateMbps: 16,
		targetLufs: -14.0,
		format: 'mp4'
	},
	{
		id: 'instagram-post',
		label: 'Instagram Post (1:1 Square)',
		description: '1080×1080 @ 10 Mbps · -14 LUFS',
		resolutionPreset: '1:1',
		width: 1080,
		height: 1080,
		bitrateMbps: 10,
		targetLufs: -14.0,
		format: 'mp4'
	},
	{
		id: 'instagram-portrait',
		label: 'Instagram Portrait (4:5 Social)',
		description: '1080×1350 @ 12 Mbps · -14 LUFS',
		resolutionPreset: '4:5',
		width: 1080,
		height: 1350,
		bitrateMbps: 12,
		targetLufs: -14.0,
		format: 'mp4'
	}
] as const;

const FIXED_DIMENSIONS: Partial<Record<ResolutionPreset, { width: number; height: number }>> = {
	'9:16': { width: 1080, height: 1920 },
	'1:1': { width: 1080, height: 1080 },
	'4:5': { width: 1080, height: 1350 },
	'21:9': { width: 2560, height: 1080 }
};

const HEIGHTS: Partial<Record<ResolutionPreset, number>> = {
	'4k': 2160,
	'1440p': 1440,
	'1080p': 1080,
	'720p': 720,
	'480p': 480
};

const QUALITY_MULTIPLIER: Record<ExportQuality, number> = {
	low: 0.55,
	medium: 1,
	high: 1.6,
	pro: 2.8,
	custom: 1
};

export function dimensionsForPreset(
	project: Project,
	preset: ResolutionPreset,
	format: ExportSettings['format'],
	customDimensions?: { width: number; height: number }
): { width: number; height: number } {
	let width = project.settings.width;
	let height = project.settings.height;

	if (customDimensions) {
		width = customDimensions.width;
		height = customDimensions.height;
	} else if (FIXED_DIMENSIONS[preset]) {
		const fixed = FIXED_DIMENSIONS[preset]!;
		width = fixed.width;
		height = fixed.height;
	} else if (preset !== 'project' && HEIGHTS[preset]) {
		height = HEIGHTS[preset]!;
		width = Math.max(2, Math.round((height * project.settings.width) / project.settings.height));
	}

	if (format === 'mp4' || format === 'mov') {
		width -= width % 2;
		height -= height % 2;
	} else if (format === 'wav') {
		width = 2;
		height = 2;
	}
	return { width, height };
}

export function bitrateFor(
	width: number,
	height: number,
	fps: number,
	quality: ExportQuality
): number {
	const pixelsPerSecond = width * height * fps;
	const base = Math.round(pixelsPerSecond * 0.085);
	return Math.max(500_000, Math.round(base * QUALITY_MULTIPLIER[quality]));
}

export function sanitizeFilename(name: string, extension: string): string {
	const explicitExtension = extension
		.replace(/^\.+/, '')
		.replace(/[^a-z0-9]/gi, '')
		.toLowerCase();
	const sourceExtension = /\.[^.]+$/.exec(name.trim())?.[0]?.slice(1) ?? '';
	const safeExtension =
		explicitExtension || sourceExtension.replace(/[^a-z0-9]/gi, '').toLowerCase();
	const basename = name
		.trim()
		.replace(/\.[^.]*$/, '')
		.normalize('NFKC')
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
		.replace(/\s+/g, ' ')
		.replace(/[. ]+$/g, '')
		.slice(0, 120);
	return `${basename || 'untitled'}${safeExtension ? `.${safeExtension}` : ''}`;
}

export function settingsForPreset(
	project: Project,
	options: {
		format: ExportSettings['format'];
		preset: ResolutionPreset;
		quality: ExportQuality;
		audio: boolean;
		filename: string;
		codecId?: string;
		audioCodecId?: string;
		colorSpaceTag?: string;
		bitDepth?: number;
		alpha?: boolean;
		customBitrateBps?: number;
		customDimensions?: { width: number; height: number };
		normalizeAudio?: boolean;
		loudnessTargetLufs?: number;
	}
): ExportSettings {
	const { width, height } = dimensionsForPreset(
		project,
		options.preset,
		options.format,
		options.customDimensions
	);
	const videoBitrate =
		options.quality === 'custom' && options.customBitrateBps
			? options.customBitrateBps
			: bitrateFor(width, height, project.settings.fps, options.quality);

	return {
		format: options.format,
		codecId: options.codecId,
		width,
		height,
		fps: project.settings.fps,
		videoBitrate,
		audio: options.audio,
		audioBitrate: 192_000,
		audioCodecId: options.audioCodecId,
		colorSpaceTag: options.colorSpaceTag,
		bitDepth: options.bitDepth,
		alpha: options.alpha,
		filename: sanitizeFilename(options.filename, options.format),
		range: 'timeline',
		normalizeAudio: options.normalizeAudio,
		loudnessTargetLufs: options.loudnessTargetLufs
	};
}
