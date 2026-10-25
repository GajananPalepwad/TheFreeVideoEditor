import { describe, expect, it } from 'vitest';
import { computeRuleOfThirds, computeSafeMargins, computeSocialMediaGuide } from './previewGuides';

describe('previewGuides core math', () => {
	describe('computeSafeMargins', () => {
		it('computes 90% action safe and 80% title safe bounds for 1920x1080', () => {
			const margins = computeSafeMargins(1920, 1080);

			// 90% Action Safe: 5% inset on all sides
			expect(margins.actionSafe.x).toBe(96);
			expect(margins.actionSafe.y).toBe(54);
			expect(margins.actionSafe.width).toBe(1728);
			expect(margins.actionSafe.height).toBe(972);

			// 80% Title Safe: 10% inset on all sides
			expect(margins.titleSafe.x).toBe(192);
			expect(margins.titleSafe.y).toBe(108);
			expect(margins.titleSafe.width).toBe(1536);
			expect(margins.titleSafe.height).toBe(864);

			// Center crosshair exactly in the middle
			expect(margins.centerCrosshair.x).toBe(960);
			expect(margins.centerCrosshair.y).toBe(540);
			expect(margins.centerCrosshair.size).toBeGreaterThan(0);
		});

		it('computes bounds for portrait 1080x1920 video', () => {
			const margins = computeSafeMargins(1080, 1920);

			expect(margins.actionSafe.x).toBe(54);
			expect(margins.actionSafe.y).toBe(96);
			expect(margins.actionSafe.width).toBe(972);
			expect(margins.actionSafe.height).toBe(1728);

			expect(margins.titleSafe.x).toBe(108);
			expect(margins.titleSafe.y).toBe(192);
			expect(margins.titleSafe.width).toBe(864);
			expect(margins.titleSafe.height).toBe(1536);

			expect(margins.centerCrosshair.x).toBe(540);
			expect(margins.centerCrosshair.y).toBe(960);
		});
	});

	describe('computeRuleOfThirds', () => {
		it('computes 3x3 grid lines and 4 power points for 1920x1080', () => {
			const thirds = computeRuleOfThirds(1920, 1080);

			expect(thirds.verticals[0]).toBeCloseTo(640, 2);
			expect(thirds.verticals[1]).toBeCloseTo(1280, 2);

			expect(thirds.horizontals[0]).toBeCloseTo(360, 2);
			expect(thirds.horizontals[1]).toBeCloseTo(720, 2);

			expect(thirds.powerPoints).toHaveLength(4);
			expect(thirds.powerPoints[0]).toEqual({ x: 640, y: 360 });
			expect(thirds.powerPoints[1]).toEqual({ x: 1280, y: 360 });
			expect(thirds.powerPoints[2]).toEqual({ x: 640, y: 720 });
			expect(thirds.powerPoints[3]).toEqual({ x: 1280, y: 720 });
		});
	});

	describe('computeSocialMediaGuide', () => {
		it('computes social guide zones for vertical 9:16 (1080x1920)', () => {
			const social = computeSocialMediaGuide(1080, 1920);

			expect(social.isPortrait).toBe(true);
			expect(social.container.x).toBe(0);
			expect(social.container.y).toBe(0);
			expect(social.container.width).toBe(1080);
			expect(social.container.height).toBe(1920);

			// Danger zones are within the container
			expect(social.topHeader.y).toBe(0);
			expect(social.topHeader.height).toBeCloseTo(1920 * 0.12, 1);

			expect(social.rightButtons.x + social.rightButtons.width).toBeCloseTo(1080, 1);
			expect(social.bottomCaption.y).toBeGreaterThan(1920 * 0.6);
			expect(social.bottomNav.y + social.bottomNav.height).toBeCloseTo(1920, 1);

			// Safe content zone is clear of top, right, and bottom danger zones
			expect(social.safeContent.y).toBeGreaterThanOrEqual(
				social.topHeader.y + social.topHeader.height
			);
			expect(social.safeContent.x + social.safeContent.width).toBeLessThanOrEqual(
				social.rightButtons.x
			);
			expect(social.safeContent.y + social.safeContent.height).toBeLessThanOrEqual(
				social.bottomCaption.y + 40
			);
		});

		it('centers a 9:16 container with pillarbox for landscape 16:9 (1920x1080)', () => {
			const social = computeSocialMediaGuide(1920, 1080);

			expect(social.isPortrait).toBe(false);
			// 9:16 height = 1080, width = 1080 * 9 / 16 = 607.5
			expect(social.container.height).toBe(1080);
			expect(social.container.width).toBeCloseTo(607.5, 1);
			expect(social.container.x).toBeCloseTo((1920 - 607.5) / 2, 1);
			expect(social.container.y).toBe(0);
		});
	});
});
