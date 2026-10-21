import { describe, expect, it } from 'vitest';
import { ASPECT_RATIO_PRESETS, findMatchingPreset } from './aspectRatio';

describe('ASPECT_RATIO_PRESETS', () => {
	it('defines all required aspect ratio presets', () => {
		const presetIds = ASPECT_RATIO_PRESETS.map((p) => p.id);
		expect(presetIds).toEqual(['16:9-1080p', '16:9-4k', '9:16', '1:1', '4:5', '21:9']);
	});

	it('finds matching preset for exact dimensions', () => {
		expect(findMatchingPreset(1920, 1080)?.id).toBe('16:9-1080p');
		expect(findMatchingPreset(3840, 2160)?.id).toBe('16:9-4k');
		expect(findMatchingPreset(1080, 1920)?.id).toBe('9:16');
		expect(findMatchingPreset(1080, 1080)?.id).toBe('1:1');
		expect(findMatchingPreset(1080, 1350)?.id).toBe('4:5');
		expect(findMatchingPreset(2560, 1080)?.id).toBe('21:9');
	});

	it('returns undefined for non-preset dimensions', () => {
		expect(findMatchingPreset(1280, 720)).toBeUndefined();
		expect(findMatchingPreset(500, 500)).toBeUndefined();
	});
});
