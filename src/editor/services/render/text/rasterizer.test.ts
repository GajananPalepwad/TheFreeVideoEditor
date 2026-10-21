import { describe, expect, it } from 'vitest';
import { hashTextConfig, type TextRasterConfig } from './rasterizer';

describe('hashTextConfig', () => {
	const baseConfig: TextRasterConfig = {
		text: 'Hello World',
		style: { fontFamily: 'sans-serif' },
		fontSize: 48,
		fillColor: { r: 1, g: 1, b: 1, a: 1 }
	};

	it('produces identical keys for identical configurations', () => {
		const key1 = hashTextConfig(baseConfig);
		const key2 = hashTextConfig({ ...baseConfig });
		expect(key1).toBe(key2);
	});

	it('changes hash when letterSpacing changes', () => {
		const key1 = hashTextConfig({ ...baseConfig, letterSpacing: 0 });
		const key2 = hashTextConfig({ ...baseConfig, letterSpacing: 5 });
		expect(key1).not.toBe(key2);
	});

	it('changes hash when lineHeight changes', () => {
		const key1 = hashTextConfig({ ...baseConfig, lineHeight: 1.2 });
		const key2 = hashTextConfig({ ...baseConfig, lineHeight: 1.8 });
		expect(key1).not.toBe(key2);
	});

	it('changes hash when the style reveals by word instead of character', () => {
		const key1 = hashTextConfig(baseConfig);
		const key2 = hashTextConfig({
			...baseConfig,
			style: { ...baseConfig.style, revealUnit: 'word' }
		});
		expect(key1).not.toBe(key2);
	});

	it('changes hash when fontSize or color changes', () => {
		const key1 = hashTextConfig({ ...baseConfig, fontSize: 48 });
		const key2 = hashTextConfig({ ...baseConfig, fontSize: 64 });
		expect(key1).not.toBe(key2);

		const key3 = hashTextConfig({
			...baseConfig,
			fillColor: { r: 1, g: 0, b: 0, a: 1 }
		});
		expect(key1).not.toBe(key3);
	});

	it('changes hash when colorRuns change', () => {
		const key1 = hashTextConfig(baseConfig);
		const key2 = hashTextConfig({
			...baseConfig,
			colorRuns: [
				{
					startIndex: 0,
					endIndex: 5,
					fillColor: { r: 1, g: 1, b: 0, a: 1 }
				}
			]
		});
		expect(key1).not.toBe(key2);
	});

	it('changes hash when gradientType and gradientColorEnd change', () => {
		const key1 = hashTextConfig(baseConfig);
		const key2 = hashTextConfig({
			...baseConfig,
			gradientType: 'linear-horizontal',
			gradientColorEnd: { r: 1, g: 0.5, b: 0, a: 1 }
		});
		expect(key1).not.toBe(key2);
	});

	it('changes hash when gradientAngle changes for linear-angle', () => {
		const key1 = hashTextConfig({
			...baseConfig,
			gradientType: 'linear-angle',
			gradientColorEnd: { r: 1, g: 0.5, b: 0, a: 1 },
			gradientAngle: 45
		});
		const key2 = hashTextConfig({
			...baseConfig,
			gradientType: 'linear-angle',
			gradientColorEnd: { r: 1, g: 0.5, b: 0, a: 1 },
			gradientAngle: 135
		});
		expect(key1).not.toBe(key2);
	});

	it('changes hash when frameStyle changes to new styles', () => {
		const key1 = hashTextConfig(baseConfig);
		const key2 = hashTextConfig({
			...baseConfig,
			frameStyle: 'lower-third-line'
		});
		const key3 = hashTextConfig({
			...baseConfig,
			frameStyle: 'social-pill'
		});
		expect(key1).not.toBe(key2);
		expect(key2).not.toBe(key3);
	});
});
