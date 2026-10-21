import { describe, expect, it, vi } from 'vitest';
import worker, {
	isYoutubeUrl,
	isInstagramUrl,
	extractShortcode,
	extractYoutubeId
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
			expect(extractShortcode('https://www.instagram.com/p/DZxvMgyH8yR/?igsh=123')).toBe('DZxvMgyH8yR');
			expect(extractShortcode('invalid')).toBeNull();
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
		});

		it('delegates non-API requests to env.ASSETS.fetch', async () => {
			const req = new Request('https://thefreevideoeditor.com/editor');
			const res = await worker.fetch(req, mockEnv);
			expect(res.status).toBe(200);
			expect(await res.text()).toBe('mock static asset: /editor');
			expect(mockEnv.ASSETS.fetch).toHaveBeenCalledWith(req);
		});
	});
});

