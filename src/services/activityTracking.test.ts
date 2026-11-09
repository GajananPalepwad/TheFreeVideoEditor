import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	getSessionId,
	sanitizeDetails,
	_setTrackingEnabledForTest,
	_resetSessionForTest,
	trackActivity,
	trackPageView,
	trackEditorOpen,
	trackProjectCreate,
	trackMediaImport,
	trackFeatureUsed,
	trackExportStart,
	trackExportComplete,
	trackExportFailed,
	trackError,
	TRACKING_ENDPOINT
} from './activityTracking';

function createMemoryStorage(): Storage {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = String(value);
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		},
		key: (index: number) => Object.keys(store)[index] ?? null,
		get length() {
			return Object.keys(store).length;
		}
	};
}

describe('activityTracking service', () => {
	const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

	beforeEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: createMemoryStorage(),
			configurable: true,
			writable: true
		});
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: createMemoryStorage(),
			configurable: true,
			writable: true
		});
		_resetSessionForTest();
		_setTrackingEnabledForTest(true);
		vi.restoreAllMocks();
	});

	afterEach(() => {
		_setTrackingEnabledForTest(null);
		_resetSessionForTest();
		if (originalLocalStorage) {
			Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
		} else {
			Reflect.deleteProperty(globalThis, 'localStorage');
		}
		if (originalSessionStorage) {
			Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
		} else {
			Reflect.deleteProperty(globalThis, 'sessionStorage');
		}
	});

	describe('getSessionId', () => {
		it('generates an anonymous session ID starting with s_', () => {
			const id = getSessionId();
			expect(id).toMatch(/^s_[a-z0-9]+$/i);
		});

		it('persists session ID across calls and in localStorage', () => {
			const id1 = getSessionId();
			_resetSessionForTest(); // simulate memory reset / page reload
			const id2 = getSessionId();
			expect(id1).toBe(id2);
			expect(localStorage.getItem('tfve_session_id')).toBe(id1);
		});

		it('reuses pre-existing valid session ID from localStorage', () => {
			localStorage.setItem('tfve_session_id', 's_custom999');
			const id = getSessionId();
			expect(id).toBe('s_custom999');
		});

		it('migrates pre-existing valid session ID from sessionStorage to localStorage', () => {
			sessionStorage.setItem('tfve_session_id', 's_session888');
			const id = getSessionId();
			expect(id).toBe('s_session888');
			expect(localStorage.getItem('tfve_session_id')).toBe('s_session888');
		});
	});

	describe('sanitizeDetails', () => {
		it('returns undefined for empty details', () => {
			expect(sanitizeDetails()).toBeUndefined();
			expect(sanitizeDetails({})).toBeUndefined();
		});

		it('filters out sensitive file names, paths, and content', () => {
			const raw = {
				fileName: 'secret_video.mp4',
				filePath: '/Users/private/test.mov',
				content: 'private user transcript text',
				feature: 'text_layer',
				count: 3
			};
			const sanitized = sanitizeDetails(raw);
			expect(sanitized).toEqual({
				feature: 'text_layer',
				count: 3
			});
			expect(sanitized).not.toHaveProperty('fileName');
			expect(sanitized).not.toHaveProperty('filePath');
			expect(sanitized).not.toHaveProperty('content');
		});

		it('truncates excessively long string values', () => {
			const longStr = 'a'.repeat(200);
			const sanitized = sanitizeDetails({ feature: longStr });
			expect(sanitized?.feature).toHaveLength(100);
		});
	});

	describe('trackActivity and network requests', () => {
		it('does not send requests when tracking is disabled', async () => {
			_setTrackingEnabledForTest(false);
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			await trackActivity('page_view', undefined, '/about');
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('sends correct payload structure when enabled', async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(new Response('{"success":true}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			await trackActivity('feature_used', { feature: 'smart_cut' }, '/editor');

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe(TRACKING_ENDPOINT);
			expect(options.method).toBe('POST');
			expect(options.keepalive).toBe(true);

			const body = JSON.parse(options.body as string) as Record<string, unknown>;
			expect(body.session_id).toMatch(/^s_/);
			expect(body.event).toBe('feature_used');
			expect(body.page).toBe('/editor');
			expect(body.details).toEqual({ feature: 'smart_cut' });
		});

		it('deduplicates identical feature_used calls made in quick succession', async () => {
			const fetchMock = vi
				.fn()
				.mockResolvedValue(new Response('{"success":true}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackFeatureUsed('auto_caption');
			trackFeatureUsed('auto_caption');
			trackFeatureUsed('auto_caption');

			expect(fetchMock).toHaveBeenCalledTimes(1);
		});

		it('silently handles network failure without throwing', async () => {
			const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
			vi.stubGlobal('fetch', fetchMock);

			expect(() => {
				trackExportFailed(new Error('Codec fail'));
			}).not.toThrow();
		});
	});

	describe('event helper functions', () => {
		it('trackPageView sends page_view event', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackPageView('/guides/auto-captions');
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body = JSON.parse(
				(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect(body.event).toBe('page_view');
			expect(body.page).toBe('/guides/auto-captions');
		});

		it('trackEditorOpen sends editor_open event', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackEditorOpen();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body = JSON.parse(
				(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect(body.event).toBe('editor_open');
		});

		it('trackProjectCreate sends project_create event', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackProjectCreate('modal');
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body = JSON.parse(
				(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect(body.event).toBe('project_create');
			expect(body.details).toEqual({ source: 'modal' });
		});

		it('trackMediaImport sends media_import with non-sensitive count and types', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackMediaImport(3, ['video', 'audio']);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body = JSON.parse(
				(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect(body.event).toBe('media_import');
			expect(body.details).toEqual({ count: 3, types: ['video', 'audio'] });
		});

		it('trackExportStart and trackExportComplete send respective events', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackExportStart({ format: 'mp4' });
			trackExportComplete({ format: 'mp4', duration_sec: 12 });

			expect(fetchMock).toHaveBeenCalledTimes(2);
			const body1 = JSON.parse(
				(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			const body2 = JSON.parse(
				(fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect(body1.event).toBe('export_start');
			expect(body2.event).toBe('export_complete');
		});

		it('trackError sanitizes paths and sends error event', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackError(new Error('Failed to load file /Users/private/project.json'));
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body = JSON.parse(
				(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			const details = body.details as Record<string, unknown> | undefined;
			expect(body.event).toBe('error');
			expect(details?.error).toContain('[path]');
			expect(details?.error).not.toContain('/Users/private/project.json');
		});

		it('trackError ignores noisy third-party and extension errors', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackError('Script error.');
			trackError("TypeError: Cannot read properties of undefined (reading 'M_ID')");
			trackError('Error in chrome-extension://abc/script.js');

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('trackError suppresses empty, null, or undefined rejection errors without sending unknown_error', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackError(undefined, 'unhandledrejection');
			trackError(null, 'unhandledrejection');
			trackError('', 'unhandledrejection');
			trackError({}, 'unhandledrejection');
			trackError('unknown_error', 'unhandledrejection');
			trackError('[object Object]', 'unhandledrejection');

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('trackError extracts message from non-Error objects and cross-realm errors', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackError({ message: 'WebGL context was lost' }, 'webgl');
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body1 = JSON.parse(
				(fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect((body1.details as Record<string, unknown>).error).toBe('WebGL context was lost');

			trackError({ name: 'DecoderError', message: 'H.264 profile unsupported' }, 'export');
			expect(fetchMock).toHaveBeenCalledTimes(2);
			const body2 = JSON.parse(
				(fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect((body2.details as Record<string, unknown>).error).toBe(
				'DecoderError: H.264 profile unsupported'
			);

			trackError({ reason: 'Quota exceeded for OPFS storage' }, 'storage');
			expect(fetchMock).toHaveBeenCalledTimes(3);
			const body3 = JSON.parse(
				(fetchMock.mock.calls[2] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect((body3.details as Record<string, unknown>).error).toBe(
				'Quota exceeded for OPFS storage'
			);

			trackError({ status: 503, statusText: 'Service Unavailable' }, 'network');
			expect(fetchMock).toHaveBeenCalledTimes(4);
			const body4 = JSON.parse(
				(fetchMock.mock.calls[3] as [string, RequestInit])[1].body as string
			) as Record<string, unknown>;
			expect((body4.details as Record<string, unknown>).error).toBe('HTTP 503 Service Unavailable');
		});

		it('trackError filters out adblocker, client-blocked, extension, and cancellation errors', async () => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
			vi.stubGlobal('fetch', fetchMock);

			trackError('net::ERR_BLOCKED_BY_CLIENT', 'unhandledrejection');
			trackError(new Error('AbortError: The user aborted a request.'), 'fetch');
			trackError('ResizeObserver loop completed with undelivered notifications.', 'window.onerror');
			trackError('ResizeObserver loop limit exceeded', 'window.onerror');
			trackError('TagError: adsbygoogle.push() error: No slot size', 'ads');
			trackError(
				new Error('The message port closed before a response was received.'),
				'unhandledrejection'
			);
			trackError(
				'A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received',
				'unhandledrejection'
			);

			expect(fetchMock).not.toHaveBeenCalled();
		});
	});
});
