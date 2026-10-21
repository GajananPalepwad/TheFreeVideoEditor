import { describe, expect, it } from 'vitest';
import { PROJECT_PRESETS, type ProjectPreset } from './NewProjectDialog';

describe('NewProjectDialog Presets', () => {
	it('defines social media and film presets with valid dimensions and wireframes', () => {
		expect(PROJECT_PRESETS.length).toBeGreaterThanOrEqual(6);

		for (const preset of PROJECT_PRESETS) {
			expect(preset.id).toBeTruthy();
			expect(preset.title).toBeTruthy();
			expect(preset.width).toBeGreaterThan(0);
			expect(preset.height).toBeGreaterThan(0);
			expect(preset.fps).toBeGreaterThan(0);
			expect(preset.wireframe.w).toBeGreaterThan(0);
			expect(preset.wireframe.h).toBeGreaterThan(0);
		}
	});

	it('includes 9:16 vertical shorts/reels and 1:1 / 4:5 social presets', () => {
		const verticalShorts = PROJECT_PRESETS.find((p) => p.id === 'tiktok-reels-shorts');
		expect(verticalShorts).toBeDefined();
		expect(verticalShorts?.aspectRatioLabel).toBe('9:16');
		expect(verticalShorts?.width).toBe(1080);
		expect(verticalShorts?.height).toBe(1920);

		const squarePost = PROJECT_PRESETS.find((p) => p.id === 'instagram-square');
		expect(squarePost).toBeDefined();
		expect(squarePost?.aspectRatioLabel).toBe('1:1');
		expect(squarePost?.width).toBe(1080);
		expect(squarePost?.height).toBe(1080);

		const portrait = PROJECT_PRESETS.find((p) => p.id === 'instagram-portrait');
		expect(portrait).toBeDefined();
		expect(portrait?.aspectRatioLabel).toBe('4:5');
		expect(portrait?.width).toBe(1080);
		expect(portrait?.height).toBe(1350);
	});

	it('includes widescreen 16:9 and cinema 21:9 film presets', () => {
		const film4k = PROJECT_PRESETS.find((p) => p.id === 'film-4k');
		expect(film4k).toBeDefined();
		expect(film4k?.width).toBe(3840);
		expect(film4k?.height).toBe(2160);

		const cinemaUltrawide = PROJECT_PRESETS.find((p) => p.id === 'cinema-ultrawide');
		expect(cinemaUltrawide).toBeDefined();
		expect(cinemaUltrawide?.aspectRatioLabel).toBe('21:9');
		expect(cinemaUltrawide?.width).toBe(2560);
		expect(cinemaUltrawide?.height).toBe(1080);
	});

	it('categorizes presets into social and film categories correctly', () => {
		const social = PROJECT_PRESETS.filter((p) => p.category === 'social');
		const film = PROJECT_PRESETS.filter((p) => p.category === 'film');

		expect(social.length).toBeGreaterThanOrEqual(4);
		expect(film.length).toBeGreaterThanOrEqual(3);
	});
});

