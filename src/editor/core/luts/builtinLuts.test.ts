import { describe, it, expect, beforeEach } from 'vitest';
import { BUILTIN_LUTS, findBuiltinLut, isBuiltinLutId } from './builtinLuts';
import {
	ensureBuiltinLutLoaded,
	getParsedLut,
	clearParsedLuts
} from '../../services/media/lutCache';
import { BUILT_IN_PRESETS } from '../../services/storage/presets';

describe('Built-in LUTs Registry & Loader', () => {
	beforeEach(() => {
		clearParsedLuts();
	});

	it('defines all 7 pre-available LUTs with complete metadata', () => {
		expect(BUILTIN_LUTS).toHaveLength(7);
		const names = BUILTIN_LUTS.map((l) => l.name);
		expect(names).toEqual([
			'35mm Portrait',
			'Classic Chrome',
			'Filmic',
			'Moody Film',
			'Moody Stock',
			'Sunset',
			'Twilight'
		]);

		for (const lut of BUILTIN_LUTS) {
			expect(lut.id).toMatch(/^builtin:/);
			expect(lut.filename).toMatch(/\.cube$/);
			expect(lut.url).toMatch(/^\/luts\/.*\.cube$/);
			expect(lut.category).toBeTruthy();
			expect(lut.description).toBeTruthy();
			expect([32, 64]).toContain(lut.size);
		}
	});

	it('resolves built-in LUTs flexibly by ID, name, filename, or slug', () => {
		expect(findBuiltinLut('builtin:35mm-portrait')?.name).toBe('35mm Portrait');
		expect(findBuiltinLut('35mm Portrait')?.id).toBe('builtin:35mm-portrait');
		expect(findBuiltinLut('Presetpro - 35mm Portrait.cube')?.id).toBe('builtin:35mm-portrait');
		expect(findBuiltinLut('classic-chrome')?.name).toBe('Classic Chrome');
		expect(findBuiltinLut('filmic')?.name).toBe('Filmic');
		expect(findBuiltinLut('sunset')?.name).toBe('Sunset');
		expect(findBuiltinLut('non-existent')).toBeUndefined();
	});

	it('correctly identifies built-in LUT IDs', () => {
		expect(isBuiltinLutId('builtin:35mm-portrait')).toBe(true);
		expect(isBuiltinLutId('builtin:filmic')).toBe(true);
		expect(isBuiltinLutId('custom-asset-id-12345')).toBe(false);
		expect(isBuiltinLutId(null)).toBe(false);
		expect(isBuiltinLutId('')).toBe(false);
	});

	it('loads, parses, and caches all 7 .cube files accurately', async () => {
		for (const lut of BUILTIN_LUTS) {
			const parsed = await ensureBuiltinLutLoaded(lut.id);
			expect(parsed, `Failed to parse ${lut.name}`).not.toBeNull();
			if (!parsed) continue;

			expect(parsed.size).toBe(lut.size);
			const expectedTotalVoxels = lut.size * lut.size * lut.size;
			expect(parsed.data.length).toBe(expectedTotalVoxels * 4);
			expect(parsed.rawRgbData.length).toBe(expectedTotalVoxels * 3);

			// Test alpha values are 1.0 and RGB values are within [0, 1] range
			for (let i = 0; i < Math.min(parsed.data.length, 400); i += 4) {
				const r = parsed.data[i]!;
				const g = parsed.data[i + 1]!;
				const b = parsed.data[i + 2]!;
				const a = parsed.data[i + 3]!;
				expect(r).toBeGreaterThanOrEqual(0);
				expect(r).toBeLessThanOrEqual(1.05);
				expect(g).toBeGreaterThanOrEqual(0);
				expect(g).toBeLessThanOrEqual(1.05);
				expect(b).toBeGreaterThanOrEqual(0);
				expect(b).toBeLessThanOrEqual(1.05);
				expect(a).toBe(1.0);
			}

			// Verify synchronous cache lookup
			const cached = getParsedLut(lut.id);
			expect(cached).toBe(parsed);
			expect(getParsedLut(lut.filename)).toBe(parsed);
		}
	});

	it('includes 7 LUT presets in BUILT_IN_PRESETS', () => {
		const lutPresets = BUILT_IN_PRESETS.filter((p) => p.effect.type === 'lut3d');
		expect(lutPresets).toHaveLength(7);
		for (const preset of lutPresets) {
			const lutId = preset.effect.params.lutAssetId as string;
			expect(isBuiltinLutId(lutId)).toBe(true);
		}
	});
});
