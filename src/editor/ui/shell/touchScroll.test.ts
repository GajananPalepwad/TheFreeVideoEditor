import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isElementScrollable } from './touchScroll';

describe('isElementScrollable', () => {
	const originalWindow = globalThis.window;
	const originalDocument = globalThis.document;

	beforeEach(() => {
		// Mock minimal DOM environment for unit test
		// @ts-expect-error mock window
		globalThis.window = {
			getComputedStyle: vi.fn()
		};
		// @ts-expect-error mock document
		globalThis.document = {
			body: {} as HTMLElement,
			documentElement: {} as HTMLElement
		};
	});

	afterEach(() => {
		globalThis.window = originalWindow;
		globalThis.document = originalDocument;
		vi.restoreAllMocks();
	});

	it('returns false for null or undefined target', () => {
		expect(isElementScrollable(null)).toBe(false);
	});

	it('returns true when element has vertical scrollable overflow', () => {
		const container = {
			scrollHeight: 500,
			clientHeight: 200,
			scrollWidth: 200,
			clientWidth: 200,
			parentElement: null
		} as unknown as HTMLElement;

		vi.mocked(window.getComputedStyle).mockImplementation((el) => {
			if (el === container) {
				return { overflowY: 'auto', overflowX: 'hidden' } as CSSStyleDeclaration;
			}
			return { overflowY: 'visible', overflowX: 'visible' } as CSSStyleDeclaration;
		});

		expect(isElementScrollable(container)).toBe(true);
	});

	it('returns true when child is inside a vertically scrollable ancestor', () => {
		const ancestor = {
			scrollHeight: 600,
			clientHeight: 300,
			scrollWidth: 300,
			clientWidth: 300,
			parentElement: null
		} as unknown as HTMLElement;

		const child = {
			scrollHeight: 50,
			clientHeight: 50,
			scrollWidth: 50,
			clientWidth: 50,
			parentElement: ancestor
		} as unknown as HTMLElement;

		vi.mocked(window.getComputedStyle).mockImplementation((el) => {
			if (el === ancestor) {
				return { overflowY: 'scroll', overflowX: 'hidden' } as CSSStyleDeclaration;
			}
			return { overflowY: 'visible', overflowX: 'visible' } as CSSStyleDeclaration;
		});

		expect(isElementScrollable(child)).toBe(true);
	});

	it('returns false when element content fits completely within bounds', () => {
		const container = {
			scrollHeight: 200,
			clientHeight: 200,
			scrollWidth: 200,
			clientWidth: 200,
			parentElement: null
		} as unknown as HTMLElement;

		vi.mocked(window.getComputedStyle).mockReturnValue({
			overflowY: 'auto',
			overflowX: 'auto'
		} as CSSStyleDeclaration);

		expect(isElementScrollable(container)).toBe(false);
	});
});
