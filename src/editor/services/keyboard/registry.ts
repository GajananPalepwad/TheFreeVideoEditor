import { isTransitionsEnabled } from '../../core/transitions';

export type ShortcutPlatform = 'mac' | 'other';
export type ShortcutKey = string;
export type ShortcutKeys = {
	mac: ShortcutKey | readonly ShortcutKey[];
	other: ShortcutKey | readonly ShortcutKey[];
};

export interface ShortcutContext {
	event: KeyboardEvent;
	platform: ShortcutPlatform;
}

export interface ShortcutEntry {
	id: string;
	keys: ShortcutKeys;
	label: string;
	group: string;
	scope: string;
	when?: (context: ShortcutContext) => boolean;
	enabled?: () => boolean;
	handler: (context: ShortcutContext) => void;
	preventDefault: boolean;
}

export interface ShortcutHandlers {
	[key: string]: () => void;
}

export interface CheatSheetItem {
	id: string;
	label: string;
	keys: string;
	group: string;
	enabled: boolean;
}

export function shortcutKeysFor(
	entry: ShortcutEntry,
	platform: ShortcutPlatform
): readonly ShortcutKey[] {
	const value = entry.keys[platform];
	return typeof value === 'string' ? [value] : value;
}

function normalizeKey(key: string): string {
	const lower = key.toLowerCase();
	if (lower === 'space' || lower === 'spacebar') return ' ';
	if (lower === 'esc') return 'escape';
	return lower;
}

function parseCombo(combo: string): { key: string; modifiers: Set<string> } {
	const parts = combo.split('+');
	const key = normalizeKey(parts.pop() ?? '');
	const modifiers = new Set(parts.map((part) => part.toLowerCase()));
	return { key, modifiers };
}

export function matchesShortcut(event: KeyboardEvent, combo: ShortcutKey): boolean {
	const { key, modifiers } = parseCombo(combo);
	const pressed = normalizeKey(event.key);

	// Map shifted symbols back to digits if shift is active (e.g. Shift+3 produces #)
	const SHIFT_DIGIT_MAP: Record<string, string> = {
		'!': '1',
		'@': '2',
		'#': '3',
		$: '4',
		'%': '5',
		'^': '6',
		'&': '7',
		'*': '8',
		'(': '9',
		')': '0'
	};

	let matchesKey = pressed === key;
	if (!matchesKey && modifiers.has('shift') && SHIFT_DIGIT_MAP[pressed] === key) {
		matchesKey = true;
	}
	if (!matchesKey && event.code && event.code.toLowerCase() === `digit${key}`) {
		matchesKey = true;
	}
	if (!matchesKey && event.code && event.code.toLowerCase() === `key${key}`) {
		matchesKey = true;
	}
	if (!matchesKey && event.code && event.code.toLowerCase() === 'space' && key === ' ') {
		matchesKey = true;
	}

	if (!matchesKey) return false;
	if (
		event.altKey !== modifiers.has('alt') ||
		event.shiftKey !== (modifiers.has('shift') || key === '?')
	) {
		return false;
	}
	if (modifiers.has('mod')) {
		if (!(event.metaKey || event.ctrlKey)) return false;
	} else if (event.metaKey !== modifiers.has('meta') || event.ctrlKey !== modifiers.has('ctrl')) {
		return false;
	}
	return true;
}

function scopesOverlap(first: string, second: string): boolean {
	return (
		first === second ||
		first === 'editor' ||
		second === 'editor' ||
		first === 'global' ||
		second === 'global'
	);
}

export function findShortcutConflicts(
	entries: readonly ShortcutEntry[],
	platform: ShortcutPlatform
): Array<{ first: string; second: string; key: string }> {
	const conflicts: Array<{ first: string; second: string; key: string }> = [];
	for (let firstIndex = 0; firstIndex < entries.length; firstIndex += 1) {
		const first = entries[firstIndex];
		if (!first) continue;
		for (let secondIndex = firstIndex + 1; secondIndex < entries.length; secondIndex += 1) {
			const second = entries[secondIndex];
			if (!second || !scopesOverlap(first.scope, second.scope)) continue;
			for (const firstKey of shortcutKeysFor(first, platform)) {
				if (shortcutKeysFor(second, platform).includes(firstKey)) {
					conflicts.push({ first: first.id, second: second.id, key: firstKey });
				}
			}
		}
	}
	return conflicts;
}

function platformLabel(combo: string, platform: ShortcutPlatform): string {
	const parts = combo.split('+').map((part) => {
		const key = part.toLowerCase();
		if (key === 'mod') return platform === 'mac' ? '⌘' : 'Ctrl';
		if (key === 'ctrl') return 'Ctrl';
		if (key === 'meta') return '⌘';
		if (key === 'alt') return platform === 'mac' ? '⌥' : 'Alt';
		if (key === 'shift') return platform === 'mac' ? '⇧' : 'Shift';
		if (key === ' ') return 'Space';
		if (key === 'arrowup') return '↑';
		if (key === 'arrowdown') return '↓';
		if (key === 'arrowleft') return '←';
		if (key === 'arrowright') return '→';
		if (key === 'escape') return 'Esc';
		if (/^f\d+$/i.test(key)) return key.toUpperCase();
		return part.length === 1 ? part.toUpperCase() : part;
	});
	return parts.join(platform === 'mac' ? '' : '+');
}

function isTimelineTarget(target: EventTarget | null): boolean {
	return (
		typeof HTMLElement !== 'undefined' &&
		target instanceof HTMLElement &&
		target.closest('.timeline-scroll, .timeline-track-lane, .timeline-clip') !== null
	);
}

export function buildCheatSheet(
	entries: readonly ShortcutEntry[],
	platform: ShortcutPlatform
): CheatSheetItem[] {
	return entries.map((entry) => ({
		id: entry.id,
		label: entry.label,
		keys: shortcutKeysFor(entry, platform)
			.map((key) => platformLabel(key, platform))
			.join(' / '),
		group: entry.group,
		enabled: entry.enabled?.() ?? true
	}));
}

export function detectShortcutPlatform(
	platformValue: string | undefined = typeof navigator === 'undefined'
		? undefined
		: navigator.platform
): ShortcutPlatform {
	return platformValue?.toLowerCase().includes('mac') ? 'mac' : 'other';
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
	if (
		target.isContentEditable ||
		target.closest('[contenteditable="true"], [contenteditable=""]') !== null
	) {
		return true;
	}
	const el = target.closest('input, textarea, [contenteditable], [role="menu"]');
	if (!el) return false;
	const tag = (el.tagName || '').toLowerCase();
	if (
		(typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement) ||
		tag === 'textarea'
	) {
		return true;
	}
	if (
		(typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement) ||
		tag === 'input' ||
		!tag
	) {
		const inputEl = el as HTMLInputElement;
		const type = (inputEl.type || inputEl.getAttribute?.('type') || 'text').toLowerCase();
		const nonTypingTypes = new Set([
			'checkbox',
			'radio',
			'range',
			'button',
			'submit',
			'reset',
			'color',
			'file',
			'image'
		]);
		if (nonTypingTypes.has(type)) {
			return false;
		}
		return true;
	}
	if (typeof el.matches === 'function' && el.matches('[role="menu"]')) return true;
	return false;
}

function hasOpenDialog(): boolean {
	return (
		typeof document !== 'undefined' &&
		document.querySelector('dialog[open], [role="dialog"]') !== null
	);
}

export function shouldSuppressShortcut(
	event: KeyboardEvent,
	target: EventTarget | null = event.target,
	dialogOpen = hasOpenDialog()
): boolean {
	return event.defaultPrevented || event.isComposing || isTypingTarget(target) || dialogOpen;
}

export function registerShortcutListener(
	entries: readonly ShortcutEntry[],
	options: { platform?: ShortcutPlatform; target?: Window } = {}
): () => void {
	const target = options.target ?? (typeof window === 'undefined' ? undefined : window);
	if (!target) return () => {};
	const platform = options.platform ?? detectShortcutPlatform();
	const onKeyDown = (event: KeyboardEvent) => {
		if (shouldSuppressShortcut(event)) return;
		for (const entry of entries) {
			if (entry.enabled?.() === false) continue;
			if (entry.when && !entry.when({ event, platform })) continue;
			if (!shortcutKeysFor(entry, platform).some((key) => matchesShortcut(event, key))) continue;
			entry.handler({ event, platform });
			if (entry.preventDefault) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
	};
	target.addEventListener('keydown', onKeyDown, true);
	return () => target.removeEventListener('keydown', onKeyDown, true);
}

export function createEditorShortcutRegistry(handlers: ShortcutHandlers): ShortcutEntry[] {
	const action = (id: string) => () => handlers[id]?.();
	const entries: ShortcutEntry[] = [
		{
			id: 'play-pause',
			keys: { mac: 'space', other: 'space' },
			label: 'Play / Pause',
			group: 'Playback',
			scope: 'preview',
			handler: action('play-pause'),
			preventDefault: true
		},
		{
			id: 'pause',
			keys: { mac: 'k', other: 'k' },
			label: 'Pause',
			group: 'Playback',
			scope: 'preview',
			handler: action('pause'),
			preventDefault: true
		},
		{
			id: 'shuttle-back',
			keys: { mac: 'j', other: 'j' },
			label: 'Shuttle Back',
			group: 'Playback',
			scope: 'preview',
			handler: action('shuttle-back'),
			preventDefault: true
		},
		{
			id: 'shuttle-forward',
			keys: { mac: 'l', other: 'l' },
			label: 'Shuttle Forward',
			group: 'Playback',
			scope: 'preview',
			handler: action('shuttle-forward'),
			preventDefault: true
		},
		{
			id: 'loop',
			keys: { mac: 'mod+l', other: 'mod+l' },
			label: 'Toggle Loop',
			group: 'Playback',
			scope: 'preview',
			handler: action('loop'),
			preventDefault: true
		},
		{
			id: 'mute',
			keys: { mac: 'alt+u', other: 'alt+u' },
			label: 'Mute / Unmute',
			group: 'Playback',
			scope: 'preview',
			handler: action('mute'),
			preventDefault: true
		},
		{
			id: 'frame-step',
			keys: { mac: 'arrowleft', other: 'arrowleft' },
			label: 'Step Back One Frame',
			group: 'Navigation',
			scope: 'preview',
			handler: action('frame-step-back'),
			preventDefault: true
		},
		{
			id: 'frame-step-forward',
			keys: { mac: 'arrowright', other: 'arrowright' },
			label: 'Step Forward One Frame',
			group: 'Navigation',
			scope: 'preview',
			handler: action('frame-step-forward'),
			preventDefault: true
		},
		{
			id: 'seek-second-back',
			keys: { mac: 'shift+arrowleft', other: 'shift+arrowleft' },
			label: 'Seek Back One Second',
			group: 'Navigation',
			scope: 'preview',
			handler: action('seek-second-back'),
			preventDefault: true
		},
		{
			id: 'seek-second-forward',
			keys: { mac: 'shift+arrowright', other: 'shift+arrowright' },
			label: 'Seek Forward One Second',
			group: 'Navigation',
			scope: 'preview',
			handler: action('seek-second-forward'),
			preventDefault: true
		},
		{
			id: 'timeline-start',
			keys: { mac: 'home', other: 'home' },
			label: 'Go to Start',
			group: 'Navigation',
			scope: 'editor',
			handler: action('start'),
			preventDefault: true
		},
		{
			id: 'timeline-end',
			keys: { mac: 'end', other: 'end' },
			label: 'Go to End',
			group: 'Navigation',
			scope: 'editor',
			handler: action('end'),
			preventDefault: true
		},
		{
			id: 'previous-edit',
			keys: { mac: 'arrowup', other: 'arrowup' },
			label: 'Previous Edit',
			group: 'Navigation',
			scope: 'preview',
			handler: action('previous-edit'),
			preventDefault: true
		},
		{
			id: 'next-edit',
			keys: { mac: 'arrowdown', other: 'arrowdown' },
			label: 'Next Edit',
			group: 'Navigation',
			scope: 'preview',
			handler: action('next-edit'),
			preventDefault: true
		},
		{
			id: 'split',
			keys: { mac: 's', other: 's' },
			label: 'Split at Playhead',
			group: 'Editing',
			scope: 'editor',
			handler: action('split'),
			preventDefault: true
		},
		{
			id: 'split-command',
			keys: { mac: 'mod+k', other: 'mod+k' },
			label: 'Split at Playhead',
			group: 'Editing',
			scope: 'editor',
			handler: action('split'),
			preventDefault: true
		},
		{
			id: 'delete',
			keys: { mac: 'delete', other: 'delete' },
			label: 'Delete Selected Clips',
			group: 'Editing',
			scope: 'editor',
			handler: action('delete'),
			preventDefault: true
		},
		{
			id: 'backspace-delete',
			keys: { mac: 'backspace', other: 'backspace' },
			label: 'Delete Selected Clips',
			group: 'Editing',
			scope: 'editor',
			handler: action('delete'),
			preventDefault: true
		},
		{
			id: 'ripple-delete',
			keys: {
				mac: ['shift+delete', 'shift+backspace'],
				other: ['shift+delete', 'shift+backspace']
			},
			label: 'Ripple Delete',
			group: 'Editing',
			scope: 'editor',
			handler: action('ripple-delete'),
			preventDefault: true
		},
		{
			id: 'duplicate',
			keys: { mac: 'mod+d', other: 'mod+d' },
			label: 'Duplicate Clips',
			group: 'Editing',
			scope: 'editor',
			handler: action('duplicate'),
			preventDefault: true
		},
		{
			id: 'speed-duration',
			keys: { mac: 'alt+r', other: 'alt+r' },
			label: 'Speed / Duration',
			group: 'Editing',
			scope: 'editor',
			handler: action('speed-duration'),
			preventDefault: true
		},
		{
			id: 'add-freeze-frame',
			keys: { mac: 'shift+f', other: 'shift+f' },
			label: 'Add Freeze Frame',
			group: 'Editing',
			scope: 'editor',
			handler: action('add-freeze-frame'),
			preventDefault: true
		},
		{
			id: 'freeze-frame-to-end',
			keys: { mac: 'alt+shift+f', other: 'alt+shift+f' },
			label: 'Freeze Frame to End of Clip',
			group: 'Editing',
			scope: 'editor',
			handler: action('freeze-frame-to-end'),
			preventDefault: true
		},
		{
			id: 'add-default-transition',
			keys: { mac: 'mod+shift+d', other: 'mod+shift+d' },
			label: 'Apply Default Transition',
			group: 'Editing',
			scope: 'editor',
			enabled: () => isTransitionsEnabled(),
			handler: action('add-default-transition'),
			preventDefault: true
		},
		{
			id: 'select-all',
			keys: { mac: 'mod+a', other: 'mod+a' },
			label: 'Select All Clips',
			group: 'Editing',
			scope: 'editor',
			handler: action('select-all'),
			preventDefault: true
		},
		{
			id: 'deselect',
			keys: { mac: 'escape', other: 'escape' },
			label: 'Deselect / Cancel Drag',
			group: 'Editing',
			scope: 'editor',
			handler: action('deselect'),
			preventDefault: true
		},
		{
			id: 'zoom-in',
			keys: { mac: 'mod+=', other: 'mod+=' },
			label: 'Zoom In',
			group: 'Timeline',
			scope: 'editor',
			handler: action('zoom-in'),
			preventDefault: true
		},
		{
			id: 'zoom-out',
			keys: { mac: 'mod+-', other: 'mod+-' },
			label: 'Zoom Out',
			group: 'Timeline',
			scope: 'editor',
			handler: action('zoom-out'),
			preventDefault: true
		},
		{
			id: 'zoom-fit',
			keys: { mac: '\\', other: '\\' },
			label: 'Fit Timeline',
			group: 'Timeline',
			scope: 'editor',
			handler: action('zoom-fit'),
			preventDefault: true
		},
		{
			id: 'toggle-snap',
			keys: { mac: 'n', other: 'n' },
			label: 'Toggle Snapping',
			group: 'Timeline',
			scope: 'editor',
			handler: action('toggle-snap'),
			preventDefault: true
		},
		{
			id: 'nudge-frame-back',
			keys: { mac: 'alt+arrowleft', other: 'alt+arrowleft' },
			label: 'Nudge Selected Clips Back One Frame',
			group: 'Timeline',
			scope: 'clip',
			when: ({ event }) => isTimelineTarget(event.target),
			handler: action('nudge-frame-back'),
			preventDefault: true
		},
		{
			id: 'nudge-frame-forward',
			keys: { mac: 'alt+arrowright', other: 'alt+arrowright' },
			label: 'Nudge Selected Clips Forward One Frame',
			group: 'Timeline',
			scope: 'clip',
			when: ({ event }) => isTimelineTarget(event.target),
			handler: action('nudge-frame-forward'),
			preventDefault: true
		},
		{
			id: 'nudge-second-back',
			keys: { mac: 'alt+shift+arrowleft', other: 'alt+shift+arrowleft' },
			label: 'Nudge Selected Clips Back One Second',
			group: 'Timeline',
			scope: 'clip',
			when: ({ event }) => isTimelineTarget(event.target),
			handler: action('nudge-second-back'),
			preventDefault: true
		},
		{
			id: 'nudge-second-forward',
			keys: { mac: 'alt+shift+arrowright', other: 'alt+shift+arrowright' },
			label: 'Nudge Selected Clips Forward One Second',
			group: 'Timeline',
			scope: 'clip',
			when: ({ event }) => isTimelineTarget(event.target),
			handler: action('nudge-second-forward'),
			preventDefault: true
		},
		{
			id: 'add-video-track',
			keys: { mac: 'mod+shift+v', other: 'mod+shift+v' },
			label: 'Add Video Track',
			group: 'Timeline',
			scope: 'editor',
			handler: action('add-video-track'),
			preventDefault: true
		},
		{
			id: 'add-audio-track',
			keys: { mac: 'mod+shift+a', other: 'mod+shift+a' },
			label: 'Add Audio Track',
			group: 'Timeline',
			scope: 'editor',
			handler: action('add-audio-track'),
			preventDefault: true
		},
		{
			id: 'tool-select',
			keys: { mac: 'v', other: 'v' },
			label: 'Selection Tool',
			group: 'Tools',
			scope: 'editor',
			handler: action('tool-select'),
			preventDefault: true
		},
		{
			id: 'tool-track-select',
			keys: { mac: 'a', other: 'a' },
			label: 'Track Select Forward Tool',
			group: 'Tools',
			scope: 'editor',
			handler: action('tool-track-select'),
			preventDefault: true
		},
		{
			id: 'tool-ripple',
			keys: { mac: 'b', other: 'b' },
			label: 'Ripple Edit Tool',
			group: 'Tools',
			scope: 'editor',
			handler: action('tool-ripple'),
			preventDefault: true
		},
		{
			id: 'tool-razor',
			keys: { mac: 'c', other: 'c' },
			label: 'Razor Tool',
			group: 'Tools',
			scope: 'editor',
			handler: action('tool-razor'),
			preventDefault: true
		},
		{
			id: 'tool-slip',
			keys: { mac: 'y', other: 'y' },
			label: 'Slip Tool',
			group: 'Tools',
			scope: 'editor',
			handler: action('tool-slip'),
			preventDefault: true
		},
		{
			id: 'tool-pen',
			keys: { mac: 'p', other: 'p' },
			label: 'Pen Tool',
			group: 'Tools',
			scope: 'editor',
			handler: action('tool-pen'),
			preventDefault: true
		},
		{
			id: 'tool-hand',
			keys: { mac: 'h', other: 'h' },
			label: 'Hand Tool',
			group: 'Tools',
			scope: 'editor',
			handler: action('tool-hand'),
			preventDefault: true
		},
		{
			id: 'new-text-clip',
			keys: { mac: 't', other: 't' },
			label: 'New Text Clip',
			group: 'Timeline',
			scope: 'editor',
			handler: action('new-text-clip'),
			preventDefault: true
		},
		{
			id: 'add-caption',
			keys: { mac: 'alt+c', other: 'alt+c' },
			label: 'Add Caption / Subtitle Cue',
			group: 'Timeline',
			scope: 'editor',
			handler: action('add-caption'),
			preventDefault: true
		},
		{
			id: 'undo',
			keys: { mac: 'mod+z', other: 'mod+z' },
			label: 'Undo',
			group: 'History',
			scope: 'editor',
			handler: action('undo'),
			preventDefault: true
		},
		{
			id: 'redo',
			keys: { mac: 'mod+shift+z', other: ['mod+shift+z', 'ctrl+y'] },
			label: 'Redo',
			group: 'History',
			scope: 'editor',
			handler: action('redo'),
			preventDefault: true
		},
		{
			id: 'new-project',
			keys: { mac: 'mod+n', other: 'mod+n' },
			label: 'New Project',
			group: 'Project',
			scope: 'editor',
			handler: action('new-project'),
			preventDefault: true
		},
		{
			id: 'open-project',
			keys: { mac: 'mod+o', other: 'mod+o' },
			label: 'Open Project',
			group: 'Project',
			scope: 'editor',
			handler: action('open-project'),
			preventDefault: true
		},
		{
			id: 'save-project',
			keys: { mac: 'mod+s', other: 'mod+s' },
			label: 'Save Project',
			group: 'Project',
			scope: 'editor',
			handler: action('save-project'),
			preventDefault: true
		},
		{
			id: 'export',
			keys: { mac: 'mod+e', other: 'mod+e' },
			label: 'Export',
			group: 'Project',
			scope: 'editor',
			handler: action('export'),
			preventDefault: true
		},
		{
			id: 'export-frame',
			keys: { mac: 'shift+e', other: 'shift+e' },
			label: 'Export Still Frame',
			group: 'Project',
			scope: 'preview',
			handler: action('export-frame'),
			preventDefault: true
		},
		{
			id: 'import-media',
			keys: { mac: 'mod+i', other: 'mod+i' },
			label: 'Import Media',
			group: 'Project',
			scope: 'editor',
			handler: action('import-media'),
			preventDefault: true
		},
		{
			id: 'cheat-sheet',
			keys: { mac: '?', other: '?' },
			label: 'Keyboard Shortcuts',
			group: 'Help',
			scope: 'editor',
			handler: action('cheat-sheet'),
			preventDefault: true
		},
		{
			id: 'toggle-keyframe',
			keys: { mac: 'alt+k', other: 'alt+k' },
			label: 'Add / Remove Keyframe',
			group: 'Animation',
			scope: 'editor',
			handler: action('toggle-keyframe'),
			preventDefault: true
		},
		{
			id: 'prev-keyframe',
			keys: { mac: 'alt+j', other: 'alt+j' },
			label: 'Previous Keyframe',
			group: 'Animation',
			scope: 'editor',
			handler: action('prev-keyframe'),
			preventDefault: true
		},
		{
			id: 'next-keyframe',
			keys: { mac: 'alt+l', other: 'alt+l' },
			label: 'Next Keyframe',
			group: 'Animation',
			scope: 'editor',
			handler: action('next-keyframe'),
			preventDefault: true
		},
		{
			id: 'easy-ease',
			keys: { mac: 'f9', other: 'f9' },
			label: 'Easy Ease',
			group: 'Animation',
			scope: 'editor',
			handler: action('easy-ease'),
			preventDefault: true
		},
		{
			id: 'toggle-graph-editor',
			keys: { mac: 'shift+g', other: 'shift+g' },
			label: 'Toggle Graph Editor',
			group: 'Animation',
			scope: 'editor',
			handler: action('toggle-graph-editor'),
			preventDefault: true
		},
		{
			id: 'toggle-keyframe-lanes',
			keys: { mac: 'u', other: 'u' },
			label: 'Toggle Keyframe Lanes',
			group: 'Animation',
			scope: 'editor',
			handler: action('toggle-keyframe-lanes'),
			preventDefault: true
		},
		{
			id: 'toggle-scopes',
			keys: { mac: 'alt+w', other: 'alt+w' },
			label: 'Toggle Video Scopes',
			group: 'View',
			scope: 'editor',
			handler: action('toggle-scopes'),
			preventDefault: true
		},
		{
			id: 'toggle-proxies',
			keys: { mac: 'alt+p', other: 'alt+p' },
			label: 'Toggle Proxy Playback',
			group: 'View',
			scope: 'editor',
			handler: action('toggle-proxies'),
			preventDefault: true
		},
		{
			id: 'toggle-mixer',
			keys: { mac: 'alt+m', other: 'alt+m' },
			label: 'Toggle Audio Mixer',
			group: 'Audio',
			scope: 'editor',
			handler: action('toggle-mixer'),
			preventDefault: true
		},
		{
			id: 'reset-fader',
			keys: { mac: 'alt+0', other: 'alt+0' },
			label: 'Reset Fader to 0 dB',
			group: 'Audio',
			scope: 'editor',
			handler: action('reset-fader'),
			preventDefault: true
		},
		{
			id: 'mute-track',
			keys: { mac: 'alt+shift+u', other: 'alt+shift+u' },
			label: 'Mute Selected Track',
			group: 'Audio',
			scope: 'editor',
			handler: action('mute-track'),
			preventDefault: true
		},
		{
			id: 'solo-track',
			keys: { mac: 'alt+shift+s', other: 'alt+shift+s' },
			label: 'Solo Selected Track',
			group: 'Audio',
			scope: 'editor',
			handler: action('solo-track'),
			preventDefault: true
		},
		{
			id: 'nest-selection',
			keys: { mac: 'alt+shift+n', other: 'alt+shift+n' },
			label: 'Nest Selected Clips',
			group: 'Sequences',
			scope: 'editor',
			handler: action('nest-selection'),
			preventDefault: true
		},
		{
			id: 'open-sequence-instance',
			keys: { mac: 'alt+arrowdown', other: 'alt+arrowdown' },
			label: 'Open Selected Sequence in Timeline',
			group: 'Sequences',
			scope: 'editor',
			handler: action('open-sequence-instance'),
			preventDefault: true
		},
		{
			id: 'go-up-sequence',
			keys: { mac: 'alt+arrowup', other: 'alt+arrowup' },
			label: 'Go Up to Host Sequence',
			group: 'Sequences',
			scope: 'editor',
			handler: action('go-up-sequence'),
			preventDefault: true
		},
		{
			id: 'workspace-1',
			keys: { mac: 'alt+shift+1', other: 'alt+shift+1' },
			label: 'Switch to Assembly Workspace',
			group: 'Workspaces',
			scope: 'editor',
			handler: action('workspace-1'),
			preventDefault: true
		},
		{
			id: 'workspace-2',
			keys: { mac: 'alt+shift+2', other: 'alt+shift+2' },
			label: 'Switch to AI Workspace',
			group: 'Workspaces',
			scope: 'editor',
			handler: action('workspace-2'),
			preventDefault: true
		},
		{
			id: 'workspace-3',
			keys: { mac: 'alt+shift+3', other: 'alt+shift+3' },
			label: 'Switch to Editing Workspace',
			group: 'Workspaces',
			scope: 'editor',
			handler: action('workspace-3'),
			preventDefault: true
		},
		{
			id: 'workspace-4',
			keys: { mac: 'alt+shift+4', other: 'alt+shift+4' },
			label: 'Switch to Color Workspace',
			group: 'Workspaces',
			scope: 'editor',
			handler: action('workspace-4'),
			preventDefault: true
		},
		{
			id: 'workspace-5',
			keys: { mac: 'alt+shift+5', other: 'alt+shift+5' },
			label: 'Switch to Effects Workspace',
			group: 'Workspaces',
			scope: 'editor',
			handler: action('workspace-5'),
			preventDefault: true
		},
		{
			id: 'workspace-6',
			keys: { mac: 'alt+shift+6', other: 'alt+shift+6' },
			label: 'Switch to Audio Workspace',
			group: 'Workspaces',
			scope: 'editor',
			handler: action('workspace-6'),
			preventDefault: true
		},
		{
			id: 'workspace-7',
			keys: { mac: 'alt+shift+7', other: 'alt+shift+7' },
			label: 'Switch to Graphics Workspace',
			group: 'Workspaces',
			scope: 'editor',
			handler: action('workspace-7'),
			preventDefault: true
		},
		{
			id: 'toggle-maximize-panel',
			keys: { mac: '`', other: '`' },
			label: 'Maximize / Restore Active Panel',
			group: 'Workspaces',
			scope: 'editor',
			handler: action('toggle-maximize-panel'),
			preventDefault: true
		},
		{
			id: 'add-marker',
			keys: { mac: 'm', other: 'm' },
			label: 'Add Marker at Playhead',
			group: 'Markers',
			scope: 'editor',
			handler: action('add-marker'),
			preventDefault: true
		},
		{
			id: 'add-marker-edit',
			keys: { mac: 'ctrl+m', other: 'ctrl+m' },
			label: 'Add and Edit Marker',
			group: 'Markers',
			scope: 'editor',
			handler: action('add-marker-edit'),
			preventDefault: true
		},
		{
			id: 'next-marker',
			keys: { mac: 'shift+m', other: 'shift+m' },
			label: 'Go to Next Marker',
			group: 'Markers',
			scope: 'editor',
			handler: action('next-marker'),
			preventDefault: true
		},
		{
			id: 'prev-marker',
			keys: { mac: 'alt+shift+m', other: 'alt+shift+m' },
			label: 'Go to Previous Marker',
			group: 'Markers',
			scope: 'editor',
			handler: action('prev-marker'),
			preventDefault: true
		}
	];
	const conflicts = findShortcutConflicts(entries, 'mac').concat(
		findShortcutConflicts(entries, 'other')
	);
	if (conflicts.length > 0) {
		throw new Error(
			`Shortcut registry contains overlapping bindings: ${conflicts
				.map(({ first, second, key }) => `${first}/${second} (${key})`)
				.join(', ')}`
		);
	}
	return entries;
}
