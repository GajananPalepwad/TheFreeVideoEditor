import { test, expect } from '@playwright/test';

test.describe('Tool Guides & Tutorials', () => {
	test('navigates to /guides hub, filters by category, and searches tools', async ({ page }) => {
		await page.goto('/guides/');

		// Header & Eyebrow
		await expect(
			page.getByRole('heading', { name: /Master Every Tool in The Free Video Editor/i })
		).toBeVisible();

		// Check all 18 tool cards are rendered
		const cards = page.locator('.guide-card');
		await expect(cards).toHaveCount(18);

		// Category filtering: click 'AI Magic Tools'
		const aiTab = page.getByRole('tab', { name: 'AI Magic Tools' });
		await aiTab.click();
		await expect(aiTab).toHaveAttribute('aria-selected', 'true');

		// Check visible cards are only AI category
		const aiCards = page.locator('.guide-card[data-category="ai"]');
		await expect(aiCards.first()).toBeVisible();
		for (let i = 0; i < (await aiCards.count()); i++) {
			await expect(aiCards.nth(i)).toBeVisible();
		}

		// Reset to 'All Tools'
		const allTab = page.getByRole('tab', { name: 'All Tools' });
		await allTab.click();
		await expect(allTab).toHaveAttribute('aria-selected', 'true');

		// Search filtering: search for 'razor'
		const searchInput = page.locator('#guide-search-input');
		await searchInput.fill('razor');

		const razorCard = page.locator('.guide-card[data-title*="razor"]');
		await expect(razorCard).toBeVisible();

		const selectionCard = page.locator('.guide-card[data-title*="selection"]');
		await expect(selectionCard).toBeHidden();

		// Search count badge
		await expect(page.locator('#search-count')).toHaveText('1 tool');

		// Clear search
		await searchInput.fill('');
		await expect(cards).toHaveCount(18);
	});

	test('navigates to individual tool guide page and verifies video embed and detailed sections', async ({
		page
	}) => {
		await page.goto('/guides/razor-tool/');

		// Hero elements
		await expect(page.getByRole('heading', { level: 1, name: 'Razor Tool' })).toBeVisible();
		await expect(page.locator('.shortcut-pill')).toContainText('C');
		await expect(page.locator('.workspace-value')).toHaveText('Editing');

		// Breadcrumbs
		const breadcrumb = page.locator('.guide-breadcrumb-nav');
		await expect(breadcrumb).toContainText('Home');
		await expect(breadcrumb).toContainText('Guides');
		await expect(breadcrumb).toContainText('Razor Tool');

		// Video Walkthrough Section is hidden when tool has no video ID configured
		const videoSection = page.locator('#video-tutorial');
		await expect(videoSection).toHaveCount(0);

		// Overview Section & Checklist
		const overviewSection = page.locator('#overview');
		await expect(overviewSection).toBeVisible();
		await expect(overviewSection.locator('.checklist li')).toHaveCount(5);

		// Visual Anatomy Section
		const anatomySection = page.locator('#anatomy');
		await expect(anatomySection).toBeVisible();
		await expect(anatomySection.locator('.anatomy-card')).toHaveCount(4);

		// How to Use Section with sequential steps
		const stepsSection = page.locator('#how-to-use');
		await expect(stepsSection).toBeVisible();
		const stepNumbers = stepsSection.locator('.step-number');
		await expect(stepNumbers).toHaveCount(5);
		await expect(stepNumbers.nth(0)).toHaveText('1');
		await expect(stepNumbers.nth(1)).toHaveText('2');

		// Pro Tips Section
		const proTipsSection = page.locator('#pro-tips');
		await expect(proTipsSection).toBeVisible();
		await expect(proTipsSection.locator('.tip-card')).toHaveCount(4);

		// Keyboard Shortcuts Table
		const shortcutsSection = page.locator('#shortcuts');
		await expect(shortcutsSection).toBeVisible();
		const tableRows = shortcutsSection.locator('.shortcuts-table tbody tr');
		await expect(tableRows).toHaveCount(4);
		await expect(tableRows.first()).toContainText('Activate Razor Tool');

		// FAQ Section
		const faqSection = page.locator('#faq');
		await expect(faqSection).toBeVisible();
		const faqItems = faqSection.locator('.faq-item');
		await expect(faqItems).toHaveCount(3);

		// Next / Prev Navigation
		const nextCard = page.locator('.next-card');
		await expect(nextCard).toBeVisible();

		// Verify tool WITH configured video tutorial renders video embed
		await page.goto('/guides/marker-tool/');
		const markerVideoSection = page.locator('#video-tutorial');
		await expect(markerVideoSection).toBeVisible();
		const iframe = markerVideoSection.locator('iframe');
		await expect(iframe).toBeVisible();
		await expect(iframe).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/OVfbxcjQhsk/);
	});

	test('navigates to Guides from main site header navigation and features banner', async ({
		page
	}) => {
		await page.goto('/');

		// Click 'Guides' in the top header
		const guidesNavLink = page.locator('.site-nav').getByRole('link', { name: 'Guides' });
		await expect(guidesNavLink).toBeVisible();
		await guidesNavLink.click();

		await expect(page).toHaveURL(/\/guides/);
		await expect(
			page.getByRole('heading', { name: /Master Every Tool in The Free Video Editor/i })
		).toBeVisible();
	});

	test('header is responsive without horizontal scrollbar across desktop, laptop, tablet, and mobile', async ({
		page
	}) => {
		for (const pageUrl of ['/', '/guides/', '/about/']) {
			for (const viewport of [
				{ width: 1440, height: 900, name: 'desktop' },
				{ width: 1100, height: 800, name: 'laptop-devtools' },
				{ width: 850, height: 800, name: 'tablet-split' },
				{ width: 375, height: 667, name: 'mobile' }
			]) {
				await page.setViewportSize({ width: viewport.width, height: viewport.height });
				await page.goto(pageUrl);

				// Verify zero horizontal overflow on the document
				const isHorizontallyScrollable = await page.evaluate(() => {
					return document.documentElement.scrollWidth > document.documentElement.clientWidth;
				});
				expect(isHorizontallyScrollable).toBe(false);

				if (viewport.width <= 1024) {
					// Tablet & mobile: hamburger menu exists and opens drawer
					const hamburger = page.locator('#mobile-menu-toggle');
					await expect(hamburger).toBeVisible();
					await hamburger.click();
					const drawer = page.locator('#mobile-nav-drawer');
					await expect(drawer).toBeVisible();
					await hamburger.click();
				} else {
					// Desktop & laptop: site-nav links are visible
					await expect(page.locator('.site-nav')).toBeVisible();
				}
			}
		}
	});

	test('renders comprehensive SEO tags and valid Schema.org JSON-LD structured data on guides hub and individual guide', async ({
		page
	}) => {
		// 1. Check Guides Hub (/guides/)
		await page.goto('/guides/');
		await expect(page).toHaveTitle(/Tool Guides & Tutorials — The Free Video Editor/);
		const hubCanonical = page.locator('link[rel="canonical"]');
		await expect(hubCanonical).toHaveAttribute('href', 'https://thefreevideoeditor.com/guides/');

		// Parse JSON-LD on /guides/
		const hubSchemas = await page.evaluate(() => {
			const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
			return scripts.flatMap((s) => JSON.parse(s.textContent || '[]'));
		});

		const collectionSchema = hubSchemas.find((s) => s['@type'] === 'CollectionPage');
		expect(collectionSchema).toBeDefined();
		expect(collectionSchema.mainEntity?.['@type']).toBe('ItemList');
		expect(collectionSchema.mainEntity?.itemListElement?.length).toBe(18);

		// 2. Check Individual Tool Guide (/guides/razor-tool/)
		await page.goto('/guides/razor-tool/');
		await expect(page).toHaveTitle(/Razor Tool Tutorial & Complete Workflow Guide/);
		const guideCanonical = page.locator('link[rel="canonical"]');
		await expect(guideCanonical).toHaveAttribute(
			'href',
			'https://thefreevideoeditor.com/guides/razor-tool/'
		);

		const ogType = page.locator('meta[property="og:type"]');
		await expect(ogType).toHaveAttribute('content', 'article');

		const articleSection = page.locator('meta[property="article:section"]');
		await expect(articleSection).toHaveAttribute('content', 'Timeline & Cuts');

		// Parse JSON-LD on /guides/razor-tool
		const guideSchemas = await page.evaluate(() => {
			const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
			return scripts.flatMap((s) => JSON.parse(s.textContent || '[]'));
		});

		const techArticleSchema = guideSchemas.find((s) => s['@type'] === 'TechArticle');
		expect(techArticleSchema).toBeDefined();
		expect(techArticleSchema.headline).toContain('Razor Tool');

		const howToSchema = guideSchemas.find((s) => s['@type'] === 'HowTo');
		expect(howToSchema).toBeDefined();
		expect(howToSchema.step?.length).toBeGreaterThan(0);

		const faqSchema = guideSchemas.find((s) => s['@type'] === 'FAQPage');
		expect(faqSchema).toBeDefined();
		expect(faqSchema.mainEntity?.length).toBe(3);
	});
});
