import { describe, expect, it } from 'vitest';
import { ASPECT_RATIO_PRESETS, findMatchingPreset } from '../../core/aspectRatio';

describe('SequenceSettingsDialog aspect ratio presets', () => {
	it('includes all required aspect ratios', () => {
		const labels = ASPECT_RATIO_PRESETS.map((p) => p.label);
		expect(labels).toContain('16:9 Landscape (1920×1080)');
		expect(labels).toContain('16:9 Landscape (3840×2160)');
		expect(labels).toContain('9:16 Vertical (1080×1920)');
		expect(labels).toContain('1:1 Square (1080×1080)');
		expect(labels).toContain('4:5 Social Portrait (1080×1350)');
		expect(labels).toContain('21:9 Ultrawide Cinema (2560×1080)');
	});

	it('maps preset selection to appropriate dimensions', () => {
		const p916 = ASPECT_RATIO_PRESETS.find((p) => p.id === '9:16');
		expect(p916).toBeDefined();
		expect(p916?.width).toBe(1080);
		expect(p916?.height).toBe(1920);

		const p11 = ASPECT_RATIO_PRESETS.find((p) => p.id === '1:1');
		expect(p11).toBeDefined();
		expect(p11?.width).toBe(1080);
		expect(p11?.height).toBe(1080);

		const p45 = ASPECT_RATIO_PRESETS.find((p) => p.id === '4:5');
		expect(p45).toBeDefined();
		expect(p45?.width).toBe(1080);
		expect(p45?.height).toBe(1350);

		const p219 = ASPECT_RATIO_PRESETS.find((p) => p.id === '21:9');
		expect(p219).toBeDefined();
		expect(p219?.width).toBe(2560);
		expect(p219?.height).toBe(1080);
	});

	it('identifies custom resolution when dimensions do not match presets', () => {
		expect(findMatchingPreset(1280, 720)).toBeUndefined();
		expect(findMatchingPreset(1920, 800)).toBeUndefined();
	});
});

