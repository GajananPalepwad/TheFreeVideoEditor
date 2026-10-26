import type { APIRoute } from 'astro';
import { TOOL_GUIDES } from '../data/guides';

export const GET: APIRoute = () => {
	const siteUrl = 'https://thefreevideoeditor.com';
	const lastMod = new Date().toISOString().split('T')[0];

	// Canonical pages to include with priority and change frequency
	// Note: 404 and 500 error pages are intentionally excluded from the sitemap.
	const pages = [
		{
			url: `${siteUrl}/`,
			lastmod: lastMod,
			changefreq: 'weekly',
			priority: '1.0'
		},
		{
			url: `${siteUrl}/editor/`,
			lastmod: lastMod,
			changefreq: 'daily',
			priority: '0.9'
		},
		{
			url: `${siteUrl}/guides/`,
			lastmod: lastMod,
			changefreq: 'weekly',
			priority: '0.85'
		},
		...TOOL_GUIDES.map((guide) => ({
			url: `${siteUrl}/guides/${guide.id}/`,
			lastmod: lastMod,
			changefreq: 'weekly',
			priority: '0.75'
		})),
		{
			url: `${siteUrl}/about/`,
			lastmod: lastMod,
			changefreq: 'monthly',
			priority: '0.8'
		},
		{
			url: `${siteUrl}/contact/`,
			lastmod: lastMod,
			changefreq: 'monthly',
			priority: '0.7'
		},
		{
			url: `${siteUrl}/privacy/`,
			lastmod: lastMod,
			changefreq: 'monthly',
			priority: '0.6'
		},
		{
			url: `${siteUrl}/terms/`,
			lastmod: lastMod,
			changefreq: 'monthly',
			priority: '0.6'
		}
	];

	const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
	.map(
		(page) => `  <url>
    <loc>${page.url}</loc>
    <lastmod>${page.lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`
	)
	.join('\n')}
</urlset>`;

	return new Response(sitemap, {
		status: 200,
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'X-Robots-Tag': 'noindex'
		}
	});
};

