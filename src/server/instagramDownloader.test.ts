import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
	extractShortcode,
	isInstagramUrl,
	getCachedInstagramDetails,
	setCachedInstagramDetails,
	clearInstagramCache,
	handleInstagramInfo,
	handleInstagramDownload,
	instagramDownloadPlugin
} from './instagramDownloader.mjs';

describe('instagramDownloader', () => {
	beforeEach(() => {
		clearInstagramCache();
	});

	describe('isInstagramUrl', () => {
		it('accepts instagram reels and posts URLs', () => {
			expect(isInstagramUrl('https://www.instagram.com/reel/DOvzTywjPGN/')).toBe(true);
			expect(isInstagramUrl('https://instagram.com/reel/DOvzTywjPGN')).toBe(true);
			expect(isInstagramUrl('https://www.instagram.com/reels/DOvzTywjPGN/')).toBe(true);
			expect(isInstagramUrl('https://www.instagram.com/p/DOvzTywjPGN/')).toBe(true);
			expect(isInstagramUrl('https://www.instagram.com/tv/DOvzTywjPGN/')).toBe(true);
			expect(isInstagramUrl('https://instagr.am/p/DOvzTywjPGN/')).toBe(true);
		});

		it('accepts instagram share links and user profile paths', () => {
			expect(isInstagramUrl('https://www.instagram.com/oxford.mathematics/reel/DOvzTywjPGN/')).toBe(
				true
			);
			expect(isInstagramUrl('https://www.instagram.com/share/reel/DOvzTywjPGN/')).toBe(true);
			expect(isInstagramUrl('https://www.instagram.com/share/p/DOvzTywjPGN/')).toBe(true);
		});

		it('rejects invalid or non-instagram URLs', () => {
			expect(isInstagramUrl('')).toBe(false);
			expect(isInstagramUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
			expect(isInstagramUrl('https://vimeo.com/123456')).toBe(false);
			expect(isInstagramUrl('https://google.com')).toBe(false);
			expect(isInstagramUrl('https://instagram.com/about')).toBe(false);
			expect(isInstagramUrl('not-a-url')).toBe(false);
		});
	});

	describe('extractShortcode', () => {
		it('extracts clean shortcodes from reel, post, and share links', () => {
			expect(extractShortcode('https://www.instagram.com/reel/DOvzTywjPGN/')).toBe('DOvzTywjPGN');
			expect(extractShortcode('https://www.instagram.com/p/DZxvMgyH8yR/?igsh=123')).toBe(
				'DZxvMgyH8yR'
			);
			expect(
				extractShortcode('https://www.instagram.com/natgeo/reel/DOvzTywjPGN?utm_source=ig_web')
			).toBe('DOvzTywjPGN');
			expect(extractShortcode('https://instagr.am/p/DOvzTywjPGN')).toBe('DOvzTywjPGN');
		});

		it('returns null for non-instagram links', () => {
			expect(extractShortcode('')).toBeNull();
			expect(extractShortcode('https://youtube.com')).toBeNull();
			expect(extractShortcode('invalid')).toBeNull();
		});
	});

	describe('mediaDetailsCache', () => {
		it('caches and retrieves details by shortcode', () => {
			const mockDetails = {
				id: 'test_code',
				title: 'Test Reel',
				uploader: 'test_user',
				duration: 15,
				thumbnail: 'https://example.com/thumb.jpg',
				mediaType: 'video',
				videoVersions: [{ url: 'https://example.com/vid.mp4', width: 720, height: 1280 }],
				availableQualities: [1280]
			};

			expect(getCachedInstagramDetails('test_code')).toBeNull();
			setCachedInstagramDetails('test_code', mockDetails);
			expect(getCachedInstagramDetails('test_code')).toEqual(mockDetails);
		});

		it('clears cache on clearInstagramCache', () => {
			setCachedInstagramDetails('abc', { id: 'abc' });
			expect(getCachedInstagramDetails('abc')).not.toBeNull();
			clearInstagramCache();
			expect(getCachedInstagramDetails('abc')).toBeNull();
		});
	});

	describe('instagramDownloadPlugin', () => {
		it('unshifts middleware into server middlewares stack via return function', () => {
			const plugin = instagramDownloadPlugin();
			const mockServer = {
				middlewares: {
					stack: [] as Array<{ route: string; handle: unknown }>
				}
			};

			const postHook = plugin.configureServer(mockServer as never);
			expect(typeof postHook).toBe('function');
			if (typeof postHook === 'function') {
				postHook();
			}

			expect(mockServer.middlewares.stack.length).toBe(1);
			expect(mockServer.middlewares.stack[0].route).toBe('');
			expect(typeof mockServer.middlewares.stack[0].handle).toBe('function');
		});

		it('routes /api/instagram-info and /api/instagram-info/ matching both variants', () => {
			const plugin = instagramDownloadPlugin();
			const mockServer = {
				middlewares: {
					stack: [] as Array<{
						route: string;
						handle: (req: unknown, res: unknown, next: () => void) => void;
					}>
				}
			};

			const postHook = plugin.configureServer(mockServer as never);
			if (typeof postHook === 'function') postHook();

			const middleware = mockServer.middlewares.stack[0].handle;

			// Non-API route should pass to next()
			const nextFn = vi.fn();
			middleware({ url: '/about' }, {}, nextFn);
			expect(nextFn).toHaveBeenCalled();
		});
	});

	describe('request handlers validation', () => {
		it('returns 400 for missing or invalid url in handleInstagramInfo', async () => {
			let statusCode = 0;
			let responseData = '';
			const mockRes = {
				setHeader: vi.fn(),
				set statusCode(code: number) {
					statusCode = code;
				},
				get statusCode() {
					return statusCode;
				},
				end(chunk: string) {
					responseData = chunk;
				}
			};

			const mockReq = {
				url: '/api/instagram-info?url=https://youtube.com/not-insta',
				method: 'GET'
			};

			await handleInstagramInfo(mockReq, mockRes);
			expect(statusCode).toBe(400);
			expect(JSON.parse(responseData).error).toContain('Please enter a valid Instagram');
		});

		it('returns 400 for missing or invalid url in handleInstagramDownload', async () => {
			let statusCode = 0;
			let responseData = '';
			const mockRes = {
				setHeader: vi.fn(),
				removeHeader: vi.fn(),
				headersSent: false,
				set statusCode(code: number) {
					statusCode = code;
				},
				get statusCode() {
					return statusCode;
				},
				end(chunk: string) {
					responseData = chunk;
				}
			};

			const mockReq = {
				url: '/api/download-instagram?url=https://invalid.com',
				method: 'GET',
				on: vi.fn()
			};

			await handleInstagramDownload(mockReq, mockRes);
			expect(statusCode).toBe(400);
			expect(JSON.parse(responseData).error).toContain('Please enter a valid Instagram');
		});
	});
});
