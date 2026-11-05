import type { LayoutNode, LayoutSplitNode, PanelId, UserWorkspaceState, Workspace } from './types';
import { BUILT_IN_WORKSPACES, PRESET_EDITING } from './presets';

export const WORKSPACE_STORAGE_KEY = 'tfve:workspace-state';
export const CURRENT_WORKSPACE_VERSION = 1;

export const KNOWN_PANEL_IDS: ReadonlySet<PanelId> = new Set<PanelId>([
	'media',
	'effects',
	'captions',
	'graphics',
	'shapes',
	'source',
	'program',
	'inspector',
	'color',
	'mixer',
	'loudness',
	'essential-sound',
	'effect-controls-audio',
	'timeline',
	'graph',
	'ai-assistant',
	'auto-caption'
]);

export const REQUIRED_PANELS: readonly PanelId[] = ['program', 'timeline'];

/**
 * Validates and normalizes a layout node tree:
 * 1. Removes unknown panels.
 * 2. Ensures no duplicate panels exist in the entire layout tree.
 * 3. Guarantees required panels ('program' and 'timeline') are present.
 * 4. Ensures stack nodes have a valid activeId.
 * 5. Cleans up empty stacks / redundant single-child splits.
 */
export function validateAndNormalizeLayout(root: LayoutNode): LayoutNode {
	const seenPanels = new Set<PanelId>();

	function filterNode(node: LayoutNode): LayoutNode | null {
		if (node.type === 'stack') {
			const validPanels = node.panelIds.filter((id) => {
				if (!KNOWN_PANEL_IDS.has(id)) return false;
				if (seenPanels.has(id)) return false;
				seenPanels.add(id);
				return true;
			});
			if (validPanels.length === 0) return null;
			const activeId = validPanels.includes(node.activeId) ? node.activeId : validPanels[0]!;
			return {
				type: 'stack',
				panelIds: validPanels,
				activeId
			};
		}

		const filteredChildren: LayoutNode[] = [];
		const filteredSizes: number[] = [];
		for (let i = 0; i < node.children.length; i++) {
			const child = filterNode(node.children[i]!);
			if (child) {
				filteredChildren.push(child);
				filteredSizes.push(node.sizes[i] ?? 100);
			}
		}

		if (filteredChildren.length === 0) return null;
		if (filteredChildren.length === 1) return filteredChildren[0]!;

		return {
			type: 'split',
			direction: node.direction,
			sizes: filteredSizes,
			children: filteredChildren
		};
	}

	let normalized = filterNode(root) ?? structuredClone(PRESET_EDITING.layout);

	// Ensure required panels ('program' and 'timeline') exist
	for (const req of REQUIRED_PANELS) {
		if (!seenPanels.has(req)) {
			normalized = injectPanel(normalized, req);
			seenPanels.add(req);
		}
	}

	// Ensure 'graphics' is placed beside 'captions' if captions is present and graphics is missing
	if (seenPanels.has('captions') && !seenPanels.has('graphics')) {
		normalized = insertPanelBeside(normalized, 'captions', 'graphics');
		seenPanels.add('graphics');
	}

	// Ensure 'shapes' is placed beside 'graphics' (between graphics and media) if shapes is missing
	if (!seenPanels.has('shapes')) {
		if (seenPanels.has('graphics')) {
			normalized = insertPanelBeside(normalized, 'graphics', 'shapes');
			seenPanels.add('shapes');
		} else if (seenPanels.has('media')) {
			normalized = insertPanelBefore(normalized, 'media', 'shapes');
			seenPanels.add('shapes');
		}
	}

	return normalized;
}

/**
 * Inserts a panel right before a target panel inside the same stack,
 * or falls back to injectPanel if target panel is not found.
 */
export function insertPanelBefore(
	root: LayoutNode,
	targetPanelId: PanelId,
	newPanelId: PanelId
): LayoutNode {
	let inserted = false;

	function visit(node: LayoutNode): LayoutNode {
		if (inserted) return node;
		if (node.type === 'stack') {
			const idx = node.panelIds.indexOf(targetPanelId);
			if (idx !== -1 && !node.panelIds.includes(newPanelId)) {
				inserted = true;
				const updated = [...node.panelIds];
				updated.splice(idx, 0, newPanelId);
				return {
					...node,
					panelIds: updated
				};
			}
			return node;
		}
		return {
			...node,
			children: node.children.map((c) => visit(c))
		};
	}

	const result = visit(root);
	if (inserted) return result;
	return injectPanel(root, newPanelId);
}

/**
 * Inserts a panel right after a target panel inside the same stack,
 * or falls back to injectPanel if target panel is not found.
 */
export function insertPanelBeside(
	root: LayoutNode,
	targetPanelId: PanelId,
	newPanelId: PanelId
): LayoutNode {
	let inserted = false;

	function visit(node: LayoutNode): LayoutNode {
		if (inserted) return node;
		if (node.type === 'stack') {
			const idx = node.panelIds.indexOf(targetPanelId);
			if (idx !== -1 && !node.panelIds.includes(newPanelId)) {
				inserted = true;
				const updated = [...node.panelIds];
				updated.splice(idx + 1, 0, newPanelId);
				return {
					...node,
					panelIds: updated
				};
			}
			return node;
		}
		return {
			...node,
			children: node.children.map((c) => visit(c))
		};
	}

	const result = visit(root);
	if (inserted) return result;
	return injectPanel(root, newPanelId);
}

/**
 * Injects a panel into the layout tree if missing.
 */
export function injectPanel(root: LayoutNode, panelId: PanelId): LayoutNode {
	if (root.type === 'stack') {
		return {
			type: 'stack',
			panelIds: [...root.panelIds, panelId],
			activeId: root.activeId
		};
	}

	// Try injecting into the first appropriate branch or split
	const newChildren = [...root.children];
	newChildren[0] = injectPanel(newChildren[0]!, panelId);
	return {
		...root,
		children: newChildren
	};
}

/**
 * Collects all panels present in a layout node.
 */
export function collectPanels(node: LayoutNode): PanelId[] {
	if (node.type === 'stack') return [...node.panelIds];
	return node.children.flatMap((c) => collectPanels(c));
}

/**
 * Activates a tab inside a stack.
 */
export function activateTab(node: LayoutNode, panelId: PanelId): LayoutNode {
	if (node.type === 'stack') {
		if (node.panelIds.includes(panelId)) {
			return { ...node, activeId: panelId };
		}
		return node;
	}
	return {
		...node,
		children: node.children.map((c) => activateTab(c, panelId))
	};
}

/**
 * Shows or hides a panel in the layout.
 * Note: 'program' and 'timeline' cannot be hidden.
 */
export function setPanelVisible(
	root: LayoutNode,
	panelId: PanelId,
	visible: boolean,
	preferredStack?: PanelId
): LayoutNode {
	if (REQUIRED_PANELS.includes(panelId) && !visible) {
		// Program and timeline are required in every layout
		return root;
	}

	if (!visible) {
		// Remove panel
		function removePanel(n: LayoutNode): LayoutNode | null {
			if (n.type === 'stack') {
				const remaining = n.panelIds.filter((p) => p !== panelId);
				if (remaining.length === 0) return null;
				const activeId = n.activeId === panelId ? remaining[0]! : n.activeId;
				return { ...n, panelIds: remaining, activeId };
			}
			const newChildren: LayoutNode[] = [];
			const newSizes: number[] = [];
			for (let i = 0; i < n.children.length; i++) {
				const child = removePanel(n.children[i]!);
				if (child) {
					newChildren.push(child);
					newSizes.push(n.sizes[i] ?? 100);
				}
			}
			if (newChildren.length === 0) return null;
			if (newChildren.length === 1) return newChildren[0]!;
			return { ...n, children: newChildren, sizes: newSizes };
		}
		return removePanel(root) ?? validateAndNormalizeLayout(root);
	}

	// Panel is to be added
	if (collectPanels(root).includes(panelId)) {
		return activateTab(root, panelId);
	}

	// Add to stack containing preferredStack, or first stack
	let added = false;
	function addPanel(n: LayoutNode): LayoutNode {
		if (added) return n;
		if (n.type === 'stack') {
			if (preferredStack && n.panelIds.includes(preferredStack)) {
				added = true;
				return {
					...n,
					panelIds: [...n.panelIds, panelId],
					activeId: panelId
				};
			}
			return n;
		}
		return {
			...n,
			children: n.children.map((c) => addPanel(c))
		};
	}

	let updated = addPanel(root);
	if (!added) {
		// Just add to first stack
		function addToFirstStack(n: LayoutNode): LayoutNode {
			if (added) return n;
			if (n.type === 'stack') {
				added = true;
				return {
					...n,
					panelIds: [...n.panelIds, panelId],
					activeId: panelId
				};
			}
			return {
				...n,
				children: n.children.map((c) => addToFirstStack(c))
			};
		}
		updated = addToFirstStack(root);
	}

	return validateAndNormalizeLayout(updated);
}

/**
 * Resizes split children with min-size clamping and normalization.
 */
export function resizeSplit(
	split: LayoutSplitNode,
	splitIndex: number,
	delta: number,
	totalPixels: number,
	minPixels: number = 180
): LayoutSplitNode {
	if (splitIndex < 0 || splitIndex >= split.sizes.length - 1) return split;

	const sumSizes = split.sizes.reduce((a, b) => a + b, 0);
	if (sumSizes <= 0 || totalPixels <= 0) return split;

	const pixelSizes = split.sizes.map((s) => (s / sumSizes) * totalPixels);
	const currentLeft = pixelSizes[splitIndex]!;
	const currentRight = pixelSizes[splitIndex + 1]!;

	let actualDelta = delta;
	if (currentLeft + actualDelta < minPixels) {
		actualDelta = minPixels - currentLeft;
	} else if (currentRight - actualDelta < minPixels) {
		actualDelta = currentRight - minPixels;
	}

	pixelSizes[splitIndex] = currentLeft + actualDelta;
	pixelSizes[splitIndex + 1] = currentRight - actualDelta;

	// Convert back to relative percentages
	const newSizes = pixelSizes.map((px) => (px / totalPixels) * 100);

	return {
		...split,
		sizes: newSizes
	};
}

/**
 * Creates default initial user workspace state.
 */
export function createDefaultWorkspaceState(): UserWorkspaceState {
	return {
		version: CURRENT_WORKSPACE_VERSION,
		activeWorkspaceId: 'editing',
		overrides: {},
		custom: [],
		order: ['assembly', 'ai', 'editing', 'color', 'effects', 'audio', 'graphics']
	};
}

/**
 * Migrates old panel-size state (mediaWidth, inspectorWidth, timelineHeight)
 * into an Editing override so current users see no change.
 */
export function migrateOldPanelSizes(
	oldSizes: { mediaWidth?: number; inspectorWidth?: number; timelineHeight?: number },
	viewport?: { width: number; height: number }
): LayoutNode {
	const mw = oldSizes.mediaWidth ?? 264;
	const iw = oldSizes.inspectorWidth ?? 256;
	const th = oldSizes.timelineHeight ?? 360;

	const vpWidth = viewport?.width ?? 1440;
	const vpHeight = viewport?.height ?? 900;

	// Calculate center monitor width
	const centerW = Math.max(200, vpWidth - mw - iw);
	const topH = Math.max(200, vpHeight - th);

	const editingCopy = structuredClone(PRESET_EDITING.layout) as LayoutSplitNode;
	// Top vs bottom split
	editingCopy.sizes = [(topH / vpHeight) * 100, (th / vpHeight) * 100];

	// Top horizontal row split
	const topRow = editingCopy.children[0] as LayoutSplitNode;
	if (topRow && topRow.type === 'split') {
		topRow.sizes = [(mw / vpWidth) * 100, (centerW / vpWidth) * 100, (iw / vpWidth) * 100];
	}

	return validateAndNormalizeLayout(editingCopy);
}

/**
 * Loads and validates workspace state from localStorage.
 */
export function loadUserWorkspaceState(): UserWorkspaceState {
	const fallback = createDefaultWorkspaceState();

	try {
		if (typeof localStorage === 'undefined') return fallback;
		const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return fallback;

		const state: UserWorkspaceState = {
			version: typeof parsed.version === 'number' ? parsed.version : CURRENT_WORKSPACE_VERSION,
			activeWorkspaceId:
				typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : 'editing',
			overrides: {},
			custom: Array.isArray(parsed.custom) ? parsed.custom : [],
			order: Array.isArray(parsed.order) ? [...parsed.order] : fallback.order
		};

		// Migrate saved user order: ensure 'ai' is present in order right after 'assembly'
		if (!state.order.includes('ai')) {
			const assemblyIdx = state.order.indexOf('assembly');
			if (assemblyIdx !== -1) {
				state.order.splice(assemblyIdx + 1, 0, 'ai');
			} else {
				state.order.unshift('ai');
			}
		}

		if (parsed.overrides && typeof parsed.overrides === 'object') {
			for (const [id, node] of Object.entries(parsed.overrides)) {
				try {
					let normalized = validateAndNormalizeLayout(node as LayoutNode);
					if (id === 'ai') {
						const ensureAutoCaption = (n: LayoutNode): LayoutNode => {
							if (n.type === 'stack') {
								if (n.panelIds.includes('ai-assistant') && !n.panelIds.includes('auto-caption')) {
									const idx = n.panelIds.indexOf('ai-assistant');
									const newPanelIds = [...n.panelIds];
									newPanelIds.splice(idx + 1, 0, 'auto-caption');
									return { ...n, panelIds: newPanelIds };
								}
								return n;
							}
							return {
								...n,
								children: n.children.map(ensureAutoCaption)
							};
						};
						normalized = ensureAutoCaption(normalized);
					}
					state.overrides[id] = normalized;
				} catch {}
			}
		}

		return state;
	} catch {
		return fallback;
	}
}

/**
 * Persists workspace state to localStorage safely.
 */
export function persistUserWorkspaceState(state: UserWorkspaceState): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(state));
	} catch {}
}

/**
 * Resolves active layout for a given workspace id from state or built-ins.
 */
export function resolveWorkspaceLayout(
	workspaceId: string,
	state: UserWorkspaceState
): { workspace: Workspace; layout: LayoutNode } {
	const custom = state.custom.find((w) => w.id === workspaceId);
	if (custom) {
		const layout = state.overrides[workspaceId] ?? custom.layout;
		return { workspace: custom, layout: validateAndNormalizeLayout(layout) };
	}

	const builtIn = BUILT_IN_WORKSPACES.find((w) => w.id === workspaceId) ?? PRESET_EDITING;
	const layout = state.overrides[builtIn.id] ?? builtIn.layout;
	return { workspace: builtIn, layout: validateAndNormalizeLayout(layout) };
}
