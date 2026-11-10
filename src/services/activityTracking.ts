/**
 * Anonymous activity tracking for TheFreeVideoEditor.com
 *
 * Privacy-first: No user content, video media, project names, or PII ever leave the device.
 * Only anonymous operational metrics are sent in production.
 * All network calls are non-blocking, fire-and-forget, and fail completely silently.
 */

import '../polyfills';

export const TRACKING_ENDPOINT = 'https://sggsapp.co.in/video_editor/record_activity.php';

export type AllowedActivityEvent =
	| 'page_view'
	| 'editor_open'
	| 'project_create'
	| 'media_import'
	| 'feature_used'
	| 'export_start'
	| 'export_complete'
	| 'export_failed'
	| 'error';

export interface ActivityPayload {
	session_id: string;
	event: AllowedActivityEvent;
	page: string;
	details?: Record<string, unknown>;
}

let trackingOverride: boolean | null = null;

/**
 * Used for testing only to enable or disable tracking explicitly.
 */
export function _setTrackingEnabledForTest(enabled: boolean | null): void {
	trackingOverride = enabled;
}

export function isTrackingProduction(): boolean {
	if (trackingOverride !== null) return trackingOverride;
	if (typeof window === 'undefined') return false;

	// In Astro/Vite, import.meta.env.PROD is true in production builds
	if (!import.meta.env.PROD) return false;

	// Extra safeguard: check hostname to avoid recording on local previews or test runners
	const hostname = window.location.hostname;
	if (
		hostname === 'localhost' ||
		hostname === '127.0.0.1' ||
		hostname === '0.0.0.0' ||
		hostname.endsWith('.local') ||
		hostname.endsWith('.internal') ||
		hostname === ''
	) {
		return false;
	}

	// Avoid recording automated test runs
	if (navigator && 'webdriver' in navigator && navigator.webdriver) {
		return false;
	}

	return true;
}

const DEVICE_SESSION_KEY = 'tfve_session_id';
let memorySessionId: string | null = null;

export function _resetSessionForTest(): void {
	memorySessionId = null;
}

function getLocalStorage(): Storage | null {
	try {
		if (typeof window !== 'undefined' && window.localStorage) {
			return window.localStorage;
		}
		if (typeof localStorage !== 'undefined') {
			return localStorage;
		}
	} catch {
		return null;
	}
	return null;
}

function getSessionStorage(): Storage | null {
	try {
		if (typeof window !== 'undefined' && window.sessionStorage) {
			return window.sessionStorage;
		}
		if (typeof sessionStorage !== 'undefined') {
			return sessionStorage;
		}
	} catch {
		return null;
	}
	return null;
}

export function getSessionId(): string {
	if (memorySessionId) {
		return memorySessionId;
	}

	const local = getLocalStorage();
	const session = getSessionStorage();

	// 1. Check localStorage first (constant for this device across all tabs & sessions)
	if (local) {
		try {
			const stored = local.getItem(DEVICE_SESSION_KEY);
			if (stored && /^s_[a-z0-9]+$/i.test(stored)) {
				memorySessionId = stored;
				return stored;
			}
		} catch {
			// localStorage restricted or blocked
		}
	}

	// 2. Check if an existing session ID was saved in sessionStorage (migrate to localStorage)
	if (session) {
		try {
			const sessionStored = session.getItem(DEVICE_SESSION_KEY);
			if (sessionStored && /^s_[a-z0-9]+$/i.test(sessionStored)) {
				memorySessionId = sessionStored;
				local?.setItem(DEVICE_SESSION_KEY, sessionStored);
				return sessionStored;
			}
		} catch {
			// sessionStorage restricted or blocked
		}
	}

	// 3. Generate a constant device session ID once, and persist to localStorage
	const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
	if (!cryptoObj?.getRandomValues) {
		throw new Error('Secure random generator is unavailable');
	}
	const randomBytes = new Uint8Array(8);
	cryptoObj.getRandomValues(randomBytes);
	const randomPart = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');
	const timePart = Date.now().toString(36);
	const newId = `s_${randomPart}${timePart}`;

	if (local) {
		try {
			local.setItem(DEVICE_SESSION_KEY, newId);
		} catch {
			// localStorage unavailable
		}
	}
	if (session) {
		try {
			session.setItem(DEVICE_SESSION_KEY, newId);
		} catch {
			// sessionStorage unavailable
		}
	}

	memorySessionId = newId;
	return newId;
}

const SENSITIVE_KEY_REGEX =
	/file|name|path|content|text|title|prompt|key|token|auth|secret|password|email|url/i;

export function sanitizeDetails(
	details?: Record<string, unknown>
): Record<string, unknown> | undefined {
	if (!details || typeof details !== 'object') return undefined;

	const sanitized: Record<string, unknown> = {};
	let count = 0;

	for (const [key, val] of Object.entries(details)) {
		if (count >= 10) break;
		// Skip sensitive keys unless explicitly allowed (like 'feature' or 'error')
		if (key !== 'feature' && key !== 'error' && SENSITIVE_KEY_REGEX.test(key)) {
			continue;
		}

		if (typeof val === 'string') {
			const maxLen = key === 'error' ? 250 : 100;
			sanitized[key] = val.length > maxLen ? val.slice(0, maxLen) : val;
			count++;
		} else if (typeof val === 'number' || typeof val === 'boolean') {
			sanitized[key] = val;
			count++;
		} else if (Array.isArray(val)) {
			sanitized[key] = val
				.slice(0, 5)
				.map((item) => (typeof item === 'string' ? item.slice(0, 50) : item));
			count++;
		}
	}

	return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

const recentEvents = new Map<string, number>();

function isDuplicate(event: AllowedActivityEvent, dedupeKey: string, cooldownMs: number): boolean {
	const now = Date.now();
	const key = `${event}:${dedupeKey}`;
	const lastTime = recentEvents.get(key);
	if (lastTime && now - lastTime < cooldownMs) {
		return true;
	}
	recentEvents.set(key, now);

	// Prune old entries occasionally
	if (recentEvents.size > 200) {
		for (const [k, time] of recentEvents.entries()) {
			if (now - time > 60000) {
				recentEvents.delete(k);
			}
		}
	}
	return false;
}

export async function trackActivity(
	event: AllowedActivityEvent,
	details?: Record<string, unknown>,
	pageOverride?: string
): Promise<void> {
	try {
		if (!isTrackingProduction()) {
			return;
		}

		const page =
			pageOverride ||
			(typeof window !== 'undefined' && window.location ? window.location.pathname : '/');

		let dedupeKey = page;
		let cooldownMs = 1000;

		if (event === 'page_view') {
			dedupeKey = page;
			cooldownMs = 1500;
		} else if (event === 'editor_open') {
			dedupeKey = 'singleton';
			cooldownMs = 60000;
		} else if (event === 'feature_used') {
			const featureName = String(details?.feature ?? 'unknown');
			dedupeKey = `${page}:${featureName}`;
			cooldownMs = 2000;
		} else if (event === 'error') {
			const errName = String(details?.error ?? details?.message ?? 'generic');
			dedupeKey = errName;
			cooldownMs = 5000;
		}

		if (isDuplicate(event, dedupeKey, cooldownMs)) {
			return;
		}

		const payload: ActivityPayload = {
			session_id: getSessionId(),
			event,
			page,
			details: sanitizeDetails(details)
		};

		if (typeof fetch === 'function') {
			void fetch(TRACKING_ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(payload),
				keepalive: true,
				mode: 'cors'
			}).catch(() => {
				// Completely silent: never throw or disrupt user
			});
		}
	} catch {
		// Completely silent: never throw or disrupt user
	}
}

export function trackPageView(page?: string, details?: Record<string, unknown>): void {
	void trackActivity('page_view', details, page);
}

export function trackEditorOpen(details?: Record<string, unknown>): void {
	void trackActivity('editor_open', details);
}

export function trackProjectCreate(source?: string, details?: Record<string, unknown>): void {
	void trackActivity('project_create', {
		source: source || 'new',
		...details
	});
}

export function trackMediaImport(
	count: number,
	types?: string[],
	details?: Record<string, unknown>
): void {
	void trackActivity('media_import', {
		count,
		types,
		...details
	});
}

export function trackFeatureUsed(feature: string, details?: Record<string, unknown>): void {
	void trackActivity('feature_used', {
		feature,
		...details
	});
}

export function trackExportStart(details?: Record<string, unknown>): void {
	void trackActivity('export_start', details);
}

export function trackExportComplete(details?: Record<string, unknown>): void {
	void trackActivity('export_complete', details);
}

export function trackExportFailed(error?: unknown, details?: Record<string, unknown>): void {
	const errorName =
		error instanceof Error
			? error.name
			: typeof error === 'string'
				? error.slice(0, 50)
				: 'unknown';
	void trackActivity('export_failed', {
		error: errorName,
		...details
	});
}

const IGNORED_ERROR_PATTERNS: readonly (string | RegExp)[] = [
	'Script error.',
	'M_ID',
	'chrome-extension:',
	'moz-extension:',
	'safari-extension:',
	'safari-web-extension:',
	'extension://',
	'The message port closed before a response was received',
	'message channel closed before a response was received',
	'Receiving end does not exist',
	'ResizeObserver loop completed with undelivered notifications',
	'ResizeObserver loop limit exceeded',
	'AbortError',
	'The user aborted a request',
	'signal is aborted without reason',
	'ERR_BLOCKED_BY_CLIENT',
	'adsbygoogle',
	'googletagmanager',
	'google-analytics'
] as const;

/**
 * Safely extracts a meaningful error message from any value (Error instance,
 * string, DOMException, custom object, rejection reason, or event).
 */
export function extractErrorMessage(error: unknown): string {
	if (error === null || error === undefined) {
		return '';
	}

	if (error instanceof Error) {
		const name = error.name || 'Error';
		const msg = error.message || '';
		return msg ? `${name}: ${msg}` : name;
	}

	if (typeof error === 'string') {
		return error.trim();
	}

	if (typeof error === 'object') {
		const obj = error as Record<string, unknown>;
		const name = typeof obj.name === 'string' ? obj.name.trim() : '';
		const message = typeof obj.message === 'string' ? obj.message.trim() : '';
		const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';

		if (name && message) {
			return `${name}: ${message}`;
		}
		if (message) {
			return message;
		}
		if (reason) {
			return reason;
		}
		if (typeof obj.statusText === 'string' && obj.statusText.trim()) {
			return `HTTP ${obj.status ?? ''} ${obj.statusText.trim()}`.trim();
		}
		if (typeof obj.error === 'string' && obj.error.trim()) {
			return obj.error.trim();
		}
		if (typeof obj.description === 'string' && obj.description.trim()) {
			return obj.description.trim();
		}
		if (typeof obj.type === 'string' && obj.type.trim()) {
			return `Event: ${obj.type.trim()}`;
		}
		try {
			const str = JSON.stringify(error);
			if (str && str !== '{}' && str !== '[]') {
				return str;
			}
		} catch {
			// Circular or non-serializable object
		}
	}

	return '';
}

/**
 * Checks if an error message represents known benign browser noise, ad-blocker
 * suppression, third-party extension failures, or non-actionable empty errors.
 */
export function isIgnoredError(message: string): boolean {
	const trimmed = message.trim();
	if (
		!trimmed ||
		trimmed === 'unknown_error' ||
		trimmed === '[object Object]' ||
		trimmed === 'null' ||
		trimmed === 'undefined'
	) {
		return true;
	}

	for (const pattern of IGNORED_ERROR_PATTERNS) {
		if (typeof pattern === 'string') {
			if (trimmed.includes(pattern)) return true;
		} else if (pattern.test(trimmed)) {
			return true;
		}
	}

	return false;
}

/**
 * Records an anonymous error telemetry event. Automatically filters out noisy
 * browser extension messages, adblocker blocks, benign ResizeObserver loops,
 * and empty/unknown promise rejections.
 */
export function trackError(
	error: unknown,
	source?: string,
	details?: Record<string, unknown>
): void {
	const rawMessage = extractErrorMessage(error);
	if (isIgnoredError(rawMessage)) {
		return;
	}

	const sanitizedMessage = rawMessage
		.replace(/\bhttps?:\/\/[^\s]+|(?:\/|[a-zA-Z]:\\)(?:[^\s/\\:]+[/\\])+[^\s]*/g, (match) => {
			if (match.startsWith('http://') || match.startsWith('https://')) {
				return match;
			}
			return '[path]';
		})
		.slice(0, 250);

	void trackActivity('error', {
		source: source || 'app',
		error: sanitizedMessage,
		...details
	});
}

let initialized = false;

export function initActivityTracking(): void {
	if (typeof window === 'undefined' || initialized) return;
	initialized = true;

	trackPageView();

	window.addEventListener('popstate', () => {
		trackPageView();
	});

	window.addEventListener('error', (event: ErrorEvent) => {
		trackError(event.error || event.message, 'window.onerror');
	});

	window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
		trackError(event.reason, 'unhandledrejection');
	});
}
