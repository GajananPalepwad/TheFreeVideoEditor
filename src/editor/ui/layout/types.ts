import type { ComponentType } from 'react';

export type PanelId =
	| 'media'
	| 'effects'
	| 'captions'
	| 'graphics'
	| 'shapes'
	| 'source'
	| 'program'
	| 'inspector'
	| 'color'
	| 'mixer'
	| 'loudness'
	| 'essential-sound'
	| 'effect-controls-audio'
	| 'timeline'
	| 'graph'
	| 'ai-assistant'
	| 'auto-caption';

export type SplitDirection = 'horizontal' | 'vertical';

export interface LayoutSplitNode {
	type: 'split';
	direction: SplitDirection;
	sizes: number[]; // Relative weights or percentages, e.g. [264, 920, 256] or [60, 40]
	children: LayoutNode[];
}

export interface LayoutStackNode {
	type: 'stack';
	panelIds: PanelId[];
	activeId: PanelId;
}

export type LayoutNode = LayoutSplitNode | LayoutStackNode;

export interface InspectorDefaults {
	expanded: Record<string, boolean>;
	linkScale?: boolean;
}

export interface Workspace {
	id: string;
	name: string;
	builtIn: boolean;
	layout: LayoutNode;
	inspectorDefaults?: InspectorDefaults;
}

export interface UserWorkspaceState {
	version: number;
	activeWorkspaceId: string;
	overrides: Record<string, LayoutNode>;
	custom: Workspace[];
	order: string[];
}

export interface PanelDefinition {
	id: PanelId;
	title: string;
	component: ComponentType<{ [key: string]: unknown }>;
	singleInstance: boolean;
	keepAlive: boolean;
	minSize: { width: number; height: number };
	icon?: string;
}
