import { beforeEach, describe, expect, it } from 'vitest';
import { safeLocalStorage } from './safeStorage';

describe('safeLocalStorage', () => {
	beforeEach(() => {
		safeLocalStorage.clear();
	});

	it('reads and writes values normally when storage is accessible', () => {
		safeLocalStorage.setItem('test_key', 'hello_world');
		expect(safeLocalStorage.getItem('test_key')).toBe('hello_world');

		safeLocalStorage.removeItem('test_key');
		expect(safeLocalStorage.getItem('test_key')).toBeNull();
	});

	it('does not throw when localStorage throws SecurityError in Private Browsing', () => {
		const originalLocalStorage = globalThis.localStorage;

		try {
			Object.defineProperty(globalThis, 'localStorage', {
				value: {
					getItem: () => {
						throw new Error('SecurityError: The operation is insecure.');
					},
					setItem: () => {
						throw new Error('SecurityError: The operation is insecure.');
					},
					removeItem: () => {
						throw new Error('SecurityError: The operation is insecure.');
					},
					clear: () => {
						throw new Error('SecurityError: The operation is insecure.');
					}
				},
				configurable: true,
				writable: true
			});

			// Should not throw, should use memory fallback
			expect(() => safeLocalStorage.setItem('secure_test', 'fallback_val')).not.toThrow();
			expect(safeLocalStorage.getItem('secure_test')).toBe('fallback_val');
		} finally {
			if (originalLocalStorage) {
				Object.defineProperty(globalThis, 'localStorage', {
					value: originalLocalStorage,
					configurable: true,
					writable: true
				});
			}
		}
	});
});
