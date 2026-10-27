import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	buildCheatSheet,
	createEditorShortcutRegistry,
	findShortcutConflicts,
	matchesShortcut,
	registerShortcutListener,
	shouldSuppressShortcut,
	type ShortcutEntry
} from './registry';

function entry(id: string, keys: string, scope = 'editor'): ShortcutEntry {
	return {
		id,
		keys: { mac: keys, other: keys },
		label: id,
		group: 'Test',
		scope,
		handler: () => {},
		preventDefault: true
	};
}

function keyEvent(key: string, modifiers: Partial<KeyboardEventInit> = {}): KeyboardEvent {
	const event = new Event('keydown', { cancelable: true }) as KeyboardEvent;
	for (const [name, value] of Object.entries({
		key,
		altKey: false,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		isComposing: false,
		...modifiers
	})) {
		Object.defineProperty(event, name, { configurable: true, value });
	}
	return event;
}

describe('keyboard shortcut registry', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('contains no overlapping key combinations', () => {
		const registry = createEditorShortcutRegistry({});
		expect(findShortcutConflicts(registry, 'mac')).toEqual([]);
		expect(findShortcutConflicts(registry, 'other')).toEqual([]);
		expect(
			findShortcutConflicts([entry('first', 'mod+z'), entry('second', 'mod+z')], 'mac')
		).toEqual([{ first: 'first', second: 'second', key: 'mod+z' }]);
	});

	it('contains no browser-reserved shortcut combinations', () => {
		const registry = createEditorShortcutRegistry({});
		const reservedCombos = new Set(['mod+shift+r', 'mod+shift+c', 'mod+shift+i', 'f12', 'mod+r']);
		for (const item of registry) {
			const macKeys = Array.isArray(item.keys.mac) ? item.keys.mac : [item.keys.mac];
			const otherKeys = Array.isArray(item.keys.other) ? item.keys.other : [item.keys.other];
			for (const k of [...macKeys, ...otherKeys]) {
				expect(reservedCombos.has(k.toLowerCase())).toBe(false);
				expect(k.toLowerCase().startsWith('ctrl+alt+')).toBe(false);
			}
		}
	});

	it('maps platform modifiers and Ctrl+Y redo correctly', () => {
		expect(matchesShortcut(keyEvent('z', { metaKey: true }), 'mod+z')).toBe(true);
		expect(matchesShortcut(keyEvent('z', { ctrlKey: true }), 'mod+z')).toBe(true);
		expect(matchesShortcut(keyEvent('y', { ctrlKey: true }), 'ctrl+y')).toBe(true);
		expect(matchesShortcut(keyEvent('y', { metaKey: true }), 'ctrl+y')).toBe(false);
	});

	it('ignores unrelated modifier combinations and honors scoped duplicates', () => {
		expect(matchesShortcut(keyEvent('arrowleft', { altKey: true }), 'arrowleft')).toBe(false);
		expect(
			findShortcutConflicts(
				[entry('preview', 'arrowleft', 'preview'), entry('clip', 'arrowleft', 'clip')],
				'other'
			)
		).toEqual([]);
	});

	it('suppresses composing, already-handled, text-target, and modal events', () => {
		const event = keyEvent('z');
		expect(shouldSuppressShortcut(keyEvent('z', { isComposing: true }))).toBe(true);
		event.preventDefault();
		expect(shouldSuppressShortcut(event)).toBe(true);
		expect(shouldSuppressShortcut(keyEvent('z'), null, true)).toBe(true);

		class FakeHTMLElement extends EventTarget {
			isContentEditable = false;
			closest(selector: string): Element | null {
				return selector.includes('input') ? ({} as Element) : null;
			}
		}
		vi.stubGlobal('HTMLElement', FakeHTMLElement);
		expect(shouldSuppressShortcut(keyEvent('z'), new FakeHTMLElement(), false)).toBe(true);

		// Alt+P (toggle proxy) and Alt+C (add caption) must not trigger while typing
		// (on macOS Option+P produces π and Option+C produces ç)
		expect(
			shouldSuppressShortcut(keyEvent('p', { altKey: true }), new FakeHTMLElement(), false)
		).toBe(true);
		expect(
			shouldSuppressShortcut(keyEvent('c', { altKey: true }), new FakeHTMLElement(), false)
		).toBe(true);

		class ContentEditableElement extends FakeHTMLElement {
			override isContentEditable = true;
			override closest(): Element | null {
				return null;
			}
		}
		expect(
			shouldSuppressShortcut(keyEvent('p', { altKey: true }), new ContentEditableElement(), false)
		).toBe(true);
		expect(
			shouldSuppressShortcut(keyEvent('c', { altKey: true }), new ContentEditableElement(), false)
		).toBe(true);
	});

	it('generates grouped platform-specific cheat-sheet entries from the registry', () => {
		const registry = createEditorShortcutRegistry({});
		const mac = buildCheatSheet(registry, 'mac');
		const other = buildCheatSheet(registry, 'other');
		expect(mac.find((item) => item.id === 'undo')?.keys).toBe('⌘Z');
		expect(other.find((item) => item.id === 'redo')?.keys).toBe('Ctrl+Shift+Z / Ctrl+Y');
		expect(mac.some((item) => item.id === 'export-dialog')).toBe(false);
	});

	it('runs timeline-only nudge shortcuts only when the timeline owns focus', () => {
		class FakeHTMLElement extends EventTarget {
			isContentEditable = false;

			constructor(private readonly timeline: boolean) {
				super();
			}

			closest(selector: string): Element | null {
				return this.timeline && selector.includes('.timeline-scroll') ? ({} as Element) : null;
			}
		}
		vi.stubGlobal('HTMLElement', FakeHTMLElement);
		const nudge = vi.fn();
		const entries = createEditorShortcutRegistry({ 'nudge-frame-back': nudge }).filter(
			(item) => item.id === 'nudge-frame-back'
		);
		const timeline = new FakeHTMLElement(true);
		const preview = new FakeHTMLElement(false);
		registerShortcutListener(entries, { target: timeline as unknown as Window, platform: 'other' });
		timeline.dispatchEvent(keyEvent('arrowleft', { altKey: true }));
		expect(nudge).toHaveBeenCalledOnce();

		registerShortcutListener(entries, { target: preview as unknown as Window, platform: 'other' });
		preview.dispatchEvent(keyEvent('arrowleft', { altKey: true }));
		expect(nudge).toHaveBeenCalledOnce();
	});

	it('dispatches all registered shortcuts to their wired handlers without errors', () => {
		const handledActions = new Set<string>();
		const mockHandlers: Record<string, () => void> = {};
		const proxyHandlers = new Proxy(mockHandlers, {
			get: (_target, prop: string) => () => {
				handledActions.add(prop);
			}
		});

		const registry = createEditorShortcutRegistry(proxyHandlers);
		expect(registry.length).toBeGreaterThan(50);

		for (const item of registry) {
			const evt = keyEvent('a');
			item.handler({ event: evt, platform: 'mac' });
		}

		// Ensure key action types are registered and wired
		expect(handledActions.has('play-pause')).toBe(true);
		expect(handledActions.has('split')).toBe(true);
		expect(handledActions.has('delete')).toBe(true);
		expect(handledActions.has('undo')).toBe(true);
		expect(handledActions.has('redo')).toBe(true);
		expect(handledActions.has('workspace-1')).toBe(true);
		expect(handledActions.has('workspace-2')).toBe(true);
		expect(handledActions.has('workspace-3')).toBe(true);
		expect(handledActions.has('workspace-4')).toBe(true);
		expect(handledActions.has('workspace-5')).toBe(true);
		expect(handledActions.has('workspace-6')).toBe(true);
		expect(handledActions.has('workspace-7')).toBe(true);
		expect(handledActions.has('add-marker')).toBe(true);
		expect(handledActions.has('toggle-snap')).toBe(true);
		expect(handledActions.has('tool-select')).toBe(true);
		expect(handledActions.has('tool-razor')).toBe(true);
		expect(handledActions.has('tool-ripple')).toBe(true);
	});

	it('single space triggers play-pause and prevents default on buttons and option controls', () => {
		const playPause = vi.fn();
		const entries = createEditorShortcutRegistry({ 'play-pause': playPause });

		class ButtonElement extends EventTarget {
			isContentEditable = false;
			tagName = 'BUTTON';
			closest(selector: string): Element | null {
				return selector.includes('button') ? (this as unknown as Element) : null;
			}
			matches(selector: string): boolean {
				return selector.includes('button');
			}
		}
		class CheckboxElement extends EventTarget {
			isContentEditable = false;
			tagName = 'INPUT';
			type = 'checkbox';
			getAttribute(name: string): string | null {
				return name === 'type' ? 'checkbox' : null;
			}
			closest(selector: string): Element | null {
				return selector.includes('input') ? (this as unknown as Element) : null;
			}
			matches(): boolean {
				return false;
			}
		}
		class TextInputElement extends EventTarget {
			isContentEditable = false;
			tagName = 'INPUT';
			type = 'text';
			getAttribute(name: string): string | null {
				return name === 'type' ? 'text' : null;
			}
			closest(selector: string): Element | null {
				return selector.includes('input') ? (this as unknown as Element) : null;
			}
			matches(): boolean {
				return false;
			}
		}

		vi.stubGlobal('HTMLElement', EventTarget);

		const mockWindow = new EventTarget() as unknown as Window;
		const cleanup = registerShortcutListener(entries, { target: mockWindow, platform: 'mac' });

		// 1. Space on button -> play-pause called, default prevented (doesn't toggle button)
		const btn = new ButtonElement();
		const btnEvent = keyEvent(' ', { code: 'Space' });
		Object.defineProperty(btnEvent, 'target', { value: btn });
		mockWindow.dispatchEvent(btnEvent);
		expect(playPause).toHaveBeenCalledTimes(1);
		expect(btnEvent.defaultPrevented).toBe(true);

		// 2. Space on checkbox -> play-pause called, default prevented (doesn't toggle checkbox)
		const cb = new CheckboxElement();
		const cbEvent = keyEvent(' ', { code: 'Space' });
		Object.defineProperty(cbEvent, 'target', { value: cb });
		mockWindow.dispatchEvent(cbEvent);
		expect(playPause).toHaveBeenCalledTimes(2);
		expect(cbEvent.defaultPrevented).toBe(true);

		// 3. Space in text input -> suppressed (typing spaces allowed in text fields)
		const textInput = new TextInputElement();
		const textEvent = keyEvent(' ', { code: 'Space' });
		Object.defineProperty(textEvent, 'target', { value: textInput });
		mockWindow.dispatchEvent(textEvent);
		expect(playPause).toHaveBeenCalledTimes(2); // not called again
		expect(textEvent.defaultPrevented).toBe(false);

		cleanup();
	});

	it('dispatches group-clips on Cmd/Ctrl+G and ungroup-clips on Cmd/Ctrl+Shift+G', () => {
		const groupHandler = vi.fn();
		const ungroupHandler = vi.fn();
		const entries = createEditorShortcutRegistry({
			'group-clips': groupHandler,
			'ungroup-clips': ungroupHandler
		});

		const mockWindow = new EventTarget() as unknown as Window;
		const cleanup = registerShortcutListener(entries, { target: mockWindow, platform: 'mac' });

		const groupEvent = keyEvent('g', { metaKey: true });
		mockWindow.dispatchEvent(groupEvent);
		expect(groupHandler).toHaveBeenCalledTimes(1);
		expect(groupEvent.defaultPrevented).toBe(true);

		const ungroupEvent = keyEvent('g', { metaKey: true, shiftKey: true });
		mockWindow.dispatchEvent(ungroupEvent);
		expect(ungroupHandler).toHaveBeenCalledTimes(1);
		expect(ungroupEvent.defaultPrevented).toBe(true);

		cleanup();
	});
});
