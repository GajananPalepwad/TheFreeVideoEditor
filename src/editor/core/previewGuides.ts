/**
 * Mathematical calculations and models for preview monitor overlays:
 * - Title safe (80%) and Action safe (90%) margins
 * - Rule of thirds (3x3 grid)
 * - Social media (TikTok / Instagram Reels) UI guide bounds
 */

export interface RectBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SafeMarginsGuide {
	actionSafe: RectBounds;
	titleSafe: RectBounds;
	centerCrosshair: {
		x: number;
		y: number;
		size: number;
	};
}

export interface RuleOfThirdsGuide {
	verticals: [number, number];
	horizontals: [number, number];
	powerPoints: Array<{ x: number; y: number }>;
}

export interface SocialMediaGuide {
	container: RectBounds;
	isPortrait: boolean;
	topHeader: RectBounds;
	rightButtons: RectBounds;
	bottomCaption: RectBounds;
	bottomNav: RectBounds;
	safeContent: RectBounds;
}

/**
 * Computes broadcast standard 90% Action Safe and 80% Title Safe areas.
 *
 * - Action safe: 5% inset on each edge (90% width x 90% height)
 * - Title safe: 10% inset on each edge (80% width x 80% height)
 */
export function computeSafeMargins(width: number, height: number): SafeMarginsGuide {
	const w = Math.max(1, width);
	const h = Math.max(1, height);

	const actionInsetX = w * 0.05;
	const actionInsetY = h * 0.05;

	const titleInsetX = w * 0.1;
	const titleInsetY = h * 0.1;

	const crosshairSize = Math.max(12, Math.min(28, Math.min(w, h) * 0.035));

	return {
		actionSafe: {
			x: actionInsetX,
			y: actionInsetY,
			width: w * 0.9,
			height: h * 0.9
		},
		titleSafe: {
			x: titleInsetX,
			y: titleInsetY,
			width: w * 0.8,
			height: h * 0.8
		},
		centerCrosshair: {
			x: w / 2,
			y: h / 2,
			size: crosshairSize
		}
	};
}

/**
 * Computes Rule-of-Thirds 3x3 grid lines and the 4 intersection power points.
 */
export function computeRuleOfThirds(width: number, height: number): RuleOfThirdsGuide {
	const w = Math.max(1, width);
	const h = Math.max(1, height);

	const v1 = w / 3;
	const v2 = (w * 2) / 3;
	const h1 = h / 3;
	const h2 = (h * 2) / 3;

	return {
		verticals: [v1, v2],
		horizontals: [h1, h2],
		powerPoints: [
			{ x: v1, y: h1 },
			{ x: v2, y: h1 },
			{ x: v1, y: h2 },
			{ x: v2, y: h2 }
		]
	};
}

/**
 * Computes TikTok / Instagram Reels UI obstruction zones and the unobstructed safe content zone.
 * On 9:16 vertical video, maps directly to viewport.
 * On landscape/square video, centers a 9:16 target container with pillarboxing.
 */
export function computeSocialMediaGuide(width: number, height: number): SocialMediaGuide {
	const w = Math.max(1, width);
	const h = Math.max(1, height);

	const targetRatio = 9 / 16;
	const currentRatio = w / h;

	let container: RectBounds;
	let isPortrait = false;

	if (currentRatio <= targetRatio + 0.02) {
		// Native 9:16 or narrower portrait video
		container = { x: 0, y: 0, width: w, height: h };
		isPortrait = true;
	} else {
		// Landscape or square video: fit 9:16 in the center
		const containerHeight = h;
		const containerWidth = containerHeight * targetRatio;
		const offsetX = (w - containerWidth) / 2;
		container = {
			x: offsetX,
			y: 0,
			width: containerWidth,
			height: containerHeight
		};
	}

	const cw = container.width;
	const ch = container.height;
	const cx = container.x;
	const cy = container.y;

	// Danger zone 1: Top header (search, following/for you tabs, camera) ~ 12%
	const topHeader: RectBounds = {
		x: cx,
		y: cy,
		width: cw,
		height: ch * 0.12
	};

	// Danger zone 2: Right interaction column (avatar, like, comment, bookmark, share, music disc) ~ 18% width
	const rightButtonsWidth = cw * 0.18;
	const rightButtons: RectBounds = {
		x: cx + cw - rightButtonsWidth,
		y: cy + ch * 0.38,
		width: rightButtonsWidth,
		height: ch * 0.5
	};

	// Danger zone 3: Bottom captions and sound marquee ~ 20%
	const bottomCaption: RectBounds = {
		x: cx + cw * 0.04,
		y: cy + ch * 0.7,
		width: cw * 0.76,
		height: ch * 0.2
	};

	// Danger zone 4: Bottom app navigation & progress bar ~ 8%
	const bottomNav: RectBounds = {
		x: cx,
		y: cy + ch * 0.92,
		width: cw,
		height: ch * 0.08
	};

	// Safe content zone: Area free from UI buttons, captions, and headers
	const safeContent: RectBounds = {
		x: cx + cw * 0.06,
		y: cy + ch * 0.14,
		width: cw * 0.74,
		height: ch * 0.54
	};

	return {
		container,
		isPortrait,
		topHeader,
		rightButtons,
		bottomCaption,
		bottomNav,
		safeContent
	};
}
