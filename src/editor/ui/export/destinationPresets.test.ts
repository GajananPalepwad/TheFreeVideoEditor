import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../core';
import { DESTINATION_PRESETS, settingsForPreset } from '../../services/export/presets';

describe('Destination presets and audio normalization for export', () => {
	it('defines presets for YouTube, TikTok/Reels/Shorts, and Instagram', () => {
		const presetIds = DESTINATION_PRESETS.map((p) => p.id);
		expect(presetIds).toContain('youtube-1080p');
		expect(presetIds).toContain('youtube-4k');
		expect(presetIds).toContain('tiktok-reels-shorts');
		expect(presetIds).toContain('instagram-post');
		expect(presetIds).toContain('instagram-portrait');
	});

	it('configures -14 LUFS audio normalization for all social media destinations', () => {
		for (const preset of DESTINATION_PRESETS) {
			expect(preset.targetLufs).toBe(-14.0);
			expect(preset.format).toBe('mp4');
		}
	});

	it('produces correct ExportSettings for YouTube 1080p preset', () => {
		const project = createEmptyProject({ name: 'YT Test', settings: { fps: 30 } });
		const preset = DESTINATION_PRESETS.find((p) => p.id === 'youtube-1080p')!;

		const settings = settingsForPreset(project, {
			format: preset.format,
			preset: preset.resolutionPreset,
			quality: 'custom',
			customBitrateBps: preset.bitrateMbps * 1_000_000,
			audio: true,
			filename: 'youtube_video',
			normalizeAudio: true,
			loudnessTargetLufs: preset.targetLufs
		});

		expect(settings.format).toBe('mp4');
		expect(settings.width).toBe(1920);
		expect(settings.height).toBe(1080);
		expect(settings.videoBitrate).toBe(16_000_000);
		expect(settings.audio).toBe(true);
		expect(settings.normalizeAudio).toBe(true);
		expect(settings.loudnessTargetLufs).toBe(-14.0);
	});

	it('produces correct ExportSettings for TikTok / Reels / Shorts 9:16 preset', () => {
		const project = createEmptyProject({ name: 'Reels Test', settings: { fps: 30 } });
		const preset = DESTINATION_PRESETS.find((p) => p.id === 'tiktok-reels-shorts')!;

		const settings = settingsForPreset(project, {
			format: preset.format,
			preset: preset.resolutionPreset,
			quality: 'custom',
			customBitrateBps: preset.bitrateMbps * 1_000_000,
			audio: true,
			filename: 'short_video',
			normalizeAudio: true,
			loudnessTargetLufs: preset.targetLufs
		});

		expect(settings.format).toBe('mp4');
		expect(settings.width).toBe(1080);
		expect(settings.height).toBe(1920);
		expect(settings.videoBitrate).toBe(16_000_000);
		expect(settings.audio).toBe(true);
		expect(settings.normalizeAudio).toBe(true);
		expect(settings.loudnessTargetLufs).toBe(-14.0);
	});

	it('produces correct ExportSettings for Instagram Post 1:1 preset', () => {
		const project = createEmptyProject({ name: 'IG Square Test', settings: { fps: 30 } });
		const preset = DESTINATION_PRESETS.find((p) => p.id === 'instagram-post')!;

		const settings = settingsForPreset(project, {
			format: preset.format,
			preset: preset.resolutionPreset,
			quality: 'custom',
			customBitrateBps: preset.bitrateMbps * 1_000_000,
			audio: true,
			filename: 'square_post',
			normalizeAudio: true,
			loudnessTargetLufs: preset.targetLufs
		});

		expect(settings.format).toBe('mp4');
		expect(settings.width).toBe(1080);
		expect(settings.height).toBe(1080);
		expect(settings.videoBitrate).toBe(10_000_000);
		expect(settings.audio).toBe(true);
		expect(settings.normalizeAudio).toBe(true);
		expect(settings.loudnessTargetLufs).toBe(-14.0);
	});

	it('produces correct ExportSettings for Instagram Portrait 4:5 preset', () => {
		const project = createEmptyProject({ name: 'IG Portrait Test', settings: { fps: 30 } });
		const preset = DESTINATION_PRESETS.find((p) => p.id === 'instagram-portrait')!;

		const settings = settingsForPreset(project, {
			format: preset.format,
			preset: preset.resolutionPreset,
			quality: 'custom',
			customBitrateBps: preset.bitrateMbps * 1_000_000,
			audio: true,
			filename: 'portrait_post',
			normalizeAudio: true,
			loudnessTargetLufs: preset.targetLufs
		});

		expect(settings.format).toBe('mp4');
		expect(settings.width).toBe(1080);
		expect(settings.height).toBe(1350);
		expect(settings.videoBitrate).toBe(12_000_000);
		expect(settings.audio).toBe(true);
		expect(settings.normalizeAudio).toBe(true);
		expect(settings.loudnessTargetLufs).toBe(-14.0);
	});
});
