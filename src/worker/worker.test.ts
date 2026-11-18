import { describe, expect, it, vi } from 'vitest';
import worker, {
	isYoutubeUrl,
	isInstagramUrl,
	extractShortcode,
	extractYoutubeId,
	decodeBase64Json,
	getEncodedSnapApp,
	decodeSnapApp
} from './index';

describe('Cloudflare Worker API', () => {
	describe('URL validators & parsers', () => {
		it('validates YouTube URLs correctly', () => {
			expect(isYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
			expect(isYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
			expect(isYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
			expect(isYoutubeUrl('https://example.com/not-youtube')).toBe(false);
			expect(isYoutubeUrl('')).toBe(false);
		});

		it('extracts YouTube video IDs', () => {
			expect(extractYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
			expect(extractYoutubeId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
			expect(extractYoutubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
			expect(extractYoutubeId('invalid')).toBeNull();
		});

		it('validates Instagram URLs correctly', () => {
			expect(isInstagramUrl('https://www.instagram.com/reel/DehR-cGhfPv/')).toBe(true);
			expect(isInstagramUrl('https://www.instagram.com/p/DZxvMgyH8yR/')).toBe(true);
			expect(isInstagramUrl('https://instagr.am/p/DZxvMgyH8yR')).toBe(true);
			expect(isInstagramUrl('https://youtube.com')).toBe(false);
			expect(isInstagramUrl('')).toBe(false);
		});

		it('extracts Instagram shortcodes', () => {
			expect(extractShortcode('https://www.instagram.com/reel/DehR-cGhfPv/')).toBe('DehR-cGhfPv');
			expect(extractShortcode('https://www.instagram.com/p/DZxvMgyH8yR/?igsh=123')).toBe(
				'DZxvMgyH8yR'
			);
			expect(extractShortcode('invalid')).toBeNull();
		});
	});

	describe('Instagram unpacker & base64 helpers', () => {
		it('safely decodes base64 JSON with URL-safe characters', () => {
			const payload = { url: 'https://instagram.fbcdn.net/video.mp4', filename: 'clip.mp4' };
			const rawJson = JSON.stringify(payload);
			const b64 = Buffer.from(rawJson).toString('base64');
			const decoded = decodeBase64Json<typeof payload>(b64);
			expect(decoded).toEqual(payload);

			expect(decodeBase64Json('invalid-json')).toBeNull();
		});

		it('extracts encoded parameters from SnapApp payload and safely handles decode', () => {
			const fakeScript =
				'something;eval(function(p,a,c,k,e,r){return decodeURIComponent(escape(r))}("arg1","arg2","arg3",12,34,56));more';
			const params = getEncodedSnapApp(fakeScript);
			expect(params).toEqual(['arg1', 'arg2', 'arg3', '12', '34', '56']);

			expect(getEncodedSnapApp('nothing here')).toBeNull();
			expect(decodeSnapApp(['', '', '0123456789', '0', '0'])).toBe('');
		});
	});

	describe('Worker fetch router', () => {
		const mockEnv = {
			ASSETS: {
				fetch: vi.fn().mockImplementation((req: Request) => {
					return Promise.resolve(new Response('mock static asset: ' + new URL(req.url).pathname));
				})
			}
		};

		it('handles CORS OPTIONS preflight', async () => {
			const req = new Request('https://thefreevideoeditor.com/api/youtube-info', {
				method: 'OPTIONS'
			});
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(204);
			expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
			expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Content-Length');
			expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Content-Disposition');
		});

		it('returns 400 for invalid YouTube URL in /api/youtube-info', async () => {
			const req = new Request('https://thefreevideoeditor.com/api/youtube-info?url=not-valid');
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(400);
			const data = (await res.json()) as { error: string };
			expect(data.error).toContain('Please enter a valid YouTube URL');
		});

		it('returns 400 for invalid YouTube download request', async () => {
			const req = new Request('https://thefreevideoeditor.com/api/download-youtube', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: 'https://not-youtube.com' })
			});
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(400);
			const data = (await res.json()) as { error: string };
			expect(data.error).toContain('Please enter a valid YouTube URL');
		});

		it('returns 400 for invalid Instagram URL in /api/instagram-info', async () => {
			const req = new Request('https://thefreevideoeditor.com/api/instagram-info?url=not-valid');
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(400);
			const data = (await res.json()) as { error: string };
			expect(data.error).toContain('Please enter a valid Instagram Reel or Post link');

			// Also verifies endpoint works when invoked with trailing slash
			const reqWithSlash = new Request(
				'https://thefreevideoeditor.com/api/instagram-info/?url=not-valid'
			);
			const resWithSlash = await worker.fetch(reqWithSlash, mockEnv);
			expect(resWithSlash.status).toBe(400);
		});

		it('returns 400 for invalid Instagram download request', async () => {
			const req = new Request('https://thefreevideoeditor.com/api/download-instagram', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: 'https://not-instagram.com' })
			});
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(400);
			const data = (await res.json()) as { error: string };
			expect(data.error).toContain('Please enter a valid Instagram Reel or Post link');

			// Also verifies endpoint works when invoked with trailing slash
			const reqWithSlash = new Request('https://thefreevideoeditor.com/api/download-instagram/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ url: 'https://not-instagram.com' })
			});
			const resWithSlash = await worker.fetch(reqWithSlash, mockEnv);
			expect(resWithSlash.status).toBe(400);
		});

		it('redirects HTTP requests to HTTPS with 301', async () => {
			const req = new Request('http://thefreevideoeditor.com/');
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(301);
			expect(res.headers.get('Location')).toBe('https://thefreevideoeditor.com/');
		});

		it('redirects www hostname to apex domain with 301', async () => {
			const req = new Request('https://www.thefreevideoeditor.com/guides/razor-tool/');
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(301);
			expect(res.headers.get('Location')).toBe('https://thefreevideoeditor.com/guides/razor-tool/');
		});

		it('redirects page routes missing trailing slash with 301', async () => {
			const req = new Request('https://thefreevideoeditor.com/guides/razor-tool');
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(301);
			expect(res.headers.get('Location')).toBe('https://thefreevideoeditor.com/guides/razor-tool/');
		});

		it('preserves query strings during canonical redirects', async () => {
			const req = new Request('http://www.thefreevideoeditor.com/guides/?category=export');
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(301);
			expect(res.headers.get('Location')).toBe(
				'https://thefreevideoeditor.com/guides/?category=export'
			);
		});

		it('does not redirect static assets or API routes', async () => {
			const staticReq = new Request('https://thefreevideoeditor.com/robots.txt');
			const staticRes = await worker.fetch(staticReq, mockEnv);
			expect(staticRes.status).toBe(200);

			const sitemapReq = new Request('https://thefreevideoeditor.com/sitemap.xml');
			const sitemapRes = await worker.fetch(sitemapReq, mockEnv);
			expect(sitemapRes.status).toBe(200);
		});

		it('delegates canonical non-API requests to env.ASSETS.fetch', async () => {
			const req = new Request('https://thefreevideoeditor.com/editor/');
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('mock static asset: /editor/');
			expect(mockEnv.ASSETS.fetch).toHaveBeenCalledWith(req);
		});

		it('returns 200 with metadata on valid instagram-info request', async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
				const urlStr =
					typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
				if (urlStr.includes('/api/v1/oembed/')) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								title: 'Test Reel Caption',
								author_name: 'test_creator',
								thumbnail_url: 'https://example.com/thumbnail.jpg'
							}),
							{ status: 200, headers: { 'Content-Type': 'application/json' } }
						)
					);
				}
				if (urlStr.includes('snapsave.app/action.php')) {
					return Promise.resolve(new Response('no streams', { status: 200 }));
				}
				return Promise.resolve(new Response('not found', { status: 404 }));
			});

			try {
				const req = new Request(
					'https://thefreevideoeditor.com/api/instagram-info?url=https://www.instagram.com/reel/TestCode123/'
				);
				const res = await worker.fetch(req, mockEnv);
				expect(res.status).toBe(200);
				const data = (await res.json()) as {
					id: string;
					title: string;
					uploader: string;
					thumbnail: string;
				};
				expect(data.id).toBe('TestCode123');
				expect(data.title).toBe('Test Reel Caption');
				expect(data.uploader).toBe('test_creator');
				expect(data.thumbnail).toBe('https://example.com/thumbnail.jpg');
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it('streams video with proper headers on valid instagram download request', async () => {
			const originalFetch = globalThis.fetch;
			const sampleVideoPayload = Buffer.from('fake-video-stream-content');
			const jwtPayload = Buffer.from(
				JSON.stringify({
					url: 'https://instagram.fbcdn.net/sample_video.mp4',
					filename: 'sample.mp4'
				})
			).toString('base64');
			const fakeTokenUrl = `https://d.rapidcdn.app/v2?token=header.${jwtPayload}.sig`;

			globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
				const urlStr =
					typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
				if (urlStr.includes('/api/v1/oembed/')) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								title: 'Sample Video Download',
								author_name: 'videomaker'
							}),
							{ status: 200, headers: { 'Content-Type': 'application/json' } }
						)
					);
				}
				if (urlStr.includes('snapsave.app/action.php')) {
					return Promise.resolve(
						new Response(
							`<div class="download-items"><a href="${fakeTokenUrl}">Download</a></div>`,
							{
								status: 200
							}
						)
					);
				}
				if (urlStr.includes('sample_video.mp4')) {
					return Promise.resolve(
						new Response(sampleVideoPayload, {
							status: 200,
							headers: {
								'Content-Type': 'video/mp4',
								'Content-Length': String(sampleVideoPayload.length)
							}
						})
					);
				}
				return Promise.resolve(new Response('not found', { status: 404 }));
			});

			try {
				const req = new Request('https://thefreevideoeditor.com/api/download-instagram', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						url: 'https://www.instagram.com/reel/Download123/',
						formatType: 'video',
						quality: 'best'
					})
				});
				const res = await worker.fetch(req, mockEnv);
				expect(res.status).toBe(200);
				expect(res.headers.get('Content-Type')).toBe('video/mp4');
				expect(res.headers.get('Content-Disposition')).toContain('Sample Video Download.mp4');
				expect(res.headers.get('X-File-Type')).toBe('mp4');
				expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
				const bodyBytes = await res.arrayBuffer();
				expect(bodyBytes.byteLength).toBe(sampleVideoPayload.length);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});
});
