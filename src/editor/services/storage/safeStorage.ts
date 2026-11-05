/**
 * Resilient localStorage wrapper with in-memory fallback.
 *
 * Protects against SecurityError: "The operation is insecure." thrown by Safari
 * in Private Browsing mode or iframe sandboxes where localStorage access is restricted.
 */

const memoryFallback = new Map<string, string>();

function getNativeLocalStorage(): Storage | null {
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

export const safeLocalStorage = {
	getItem(key: string): string | null {
		const storage = getNativeLocalStorage();
		if (storage) {
			try {
				return storage.getItem(key);
			} catch {
				// Access restricted / Private mode SecurityError
			}
		}
		return memoryFallback.get(key) ?? null;
	},

	setItem(key: string, value: string): void {
		const storage = getNativeLocalStorage();
		if (storage) {
			try {
				storage.setItem(key, value);
				return;
			} catch {
				// Access restricted / Quota exceeded / SecurityError
			}
		}
		memoryFallback.set(key, value);
	},

	removeItem(key: string): void {
		const storage = getNativeLocalStorage();
		if (storage) {
			try {
				storage.removeItem(key);
			} catch {
				// Access restricted
			}
		}
		memoryFallback.delete(key);
	},

	clear(): void {
		const storage = getNativeLocalStorage();
		if (storage) {
			try {
				storage.clear();
			} catch {
				// Access restricted
			}
		}
		memoryFallback.clear();
	}
};
