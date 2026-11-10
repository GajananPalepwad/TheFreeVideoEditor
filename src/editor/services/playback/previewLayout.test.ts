import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { observePreviewScale } from './previewLayout';

describe('observePreviewScale', () => {
	let originalResizeObserver: typeof ResizeObserver | undefined;
	let originalRequestAnimationFrame: typeof requestAnimationFrame | undefined;
	let originalCancelAnimationFrame: typeof cancelAnimationFrame | undefined;
	let rafCallbacks: ((time: number) => void)[] = [];
	let rafIdCounter = 0;

	beforeEach(() => {
		originalResizeObserver = globalThis.ResizeObserver;
		originalRequestAnimationFrame = globalThis.requestAnimationFrame;
		originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
		rafCallbacks = [];
		rafIdCounter = 0;

		globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
			const id = ++rafIdCounter;
			rafCallbacks.push(cb);
			return id;
		});

		globalThis.cancelAnimationFrame = vi.fn(() => {});
	});

	afterEach(() => {
		if (originalResizeObserver) {
			globalThis.ResizeObserver = originalResizeObserver;
		} else {
			delete (globalThis as unknown as Record<string, unknown>).ResizeObserver;
		}
		if (originalRequestAnimationFrame) {
			globalThis.requestAnimationFrame = originalRequestAnimationFrame;
		} else {
			delete (globalThis as unknown as Record<string, unknown>).requestAnimationFrame;
		}
		if (originalCancelAnimationFrame) {
			globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
		} else {
			delete (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame;
		}
	});

	function flushRaf() {
		const current = [...rafCallbacks];
		rafCallbacks = [];
		for (const cb of current) {
			cb(performance.now());
		}
	}

	it('computes initial scale immediately without waiting for rAF', () => {
		const onScale = vi.fn();
		const mockElement = {
			getBoundingClientRect: () => ({ width: 960, height: 540 })
		} as HTMLElement;

		const unsubscribe = observePreviewScale(mockElement, { width: 1920, height: 1080 }, onScale);

		expect(onScale).toHaveBeenCalledTimes(1);
		expect(onScale).toHaveBeenCalledWith(0.5);

		unsubscribe();
	});

	it('ignores subpixel changes smaller than 0.001 to prevent feedback loops', () => {
		let triggerResize: (() => void) | undefined;
		class MockResizeObserver {
			constructor(cb: () => void) {
				triggerResize = cb;
			}
			observe() {}
			disconnect() {}
		}
		globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

		const onScale = vi.fn();
		let currentWidth = 960;
		const mockElement = {
			getBoundingClientRect: () => ({ width: currentWidth, height: 540 })
		} as HTMLElement;

		const unsubscribe = observePreviewScale(mockElement, { width: 1920, height: 1080 }, onScale);

		expect(onScale).toHaveBeenCalledTimes(1);
		expect(onScale).toHaveBeenLastCalledWith(0.5);

		// Tiny jitter: 960.5 px -> nextScale = 960.5 / 1920 = 0.50026 (diff = 0.00026 <= 0.001)
		currentWidth = 960.5;
		if (triggerResize) triggerResize();
		flushRaf();

		// Should NOT call onScale because difference is <= 0.001
		expect(onScale).toHaveBeenCalledTimes(1);

		// Significant change: 800 px -> nextScale = 800 / 1920 = 0.41666 (diff = 0.0833 > 0.001)
		currentWidth = 800;
		if (triggerResize) triggerResize();
		flushRaf();

		expect(onScale).toHaveBeenCalledTimes(2);
		expect(onScale).toHaveBeenLastCalledWith(800 / 1920);

		unsubscribe();
	});

	it('coalesces multiple rapid resize events in the same frame', () => {
		let triggerResize: (() => void) | undefined;
		class MockResizeObserver {
			constructor(cb: () => void) {
				triggerResize = cb;
			}
			observe() {}
			disconnect() {}
		}
		globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

		const onScale = vi.fn();
		let currentWidth = 960;
		const mockElement = {
			getBoundingClientRect: () => ({ width: currentWidth, height: 540 })
		} as HTMLElement;

		const unsubscribe = observePreviewScale(mockElement, { width: 1920, height: 1080 }, onScale);

		expect(onScale).toHaveBeenCalledTimes(1);

		// Trigger multiple events before rAF flushes
		currentWidth = 800;
		if (triggerResize) triggerResize();
		currentWidth = 700;
		if (triggerResize) triggerResize();
		currentWidth = 600;
		if (triggerResize) triggerResize();

		// Only one rAF should have been scheduled
		expect(rafCallbacks.length).toBe(1);

		flushRaf();

		// Only one update with final width (600)
		expect(onScale).toHaveBeenCalledTimes(2);
		expect(onScale).toHaveBeenLastCalledWith(600 / 1920);

		unsubscribe();
	});

	it('cleans up observer and cancels pending rAF on unsubscribe', () => {
		let disconnected = false;
		class MockResizeObserver {
			observe() {}
			disconnect() {
				disconnected = true;
			}
		}
		globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

		const mockElement = {
			getBoundingClientRect: () => ({ width: 960, height: 540 })
		} as HTMLElement;

		const unsubscribe = observePreviewScale(mockElement, { width: 1920, height: 1080 }, () => {});

		unsubscribe();
		expect(disconnected).toBe(true);
	});
});
