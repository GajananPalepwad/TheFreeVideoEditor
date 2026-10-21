import type { Workspace } from './types';

/**
 * Built-in default workspace presets:
 * 1. Assembly - large Media panel, Source + Program monitors, short timeline, narrow Inspector.
 * 2. Editing - default, bit-identical to current layout: Media bottom-left, Source/Program monitors top, large Timeline, Inspector right.
 * 3. Color - large Program monitor, Color panel and Scopes prominent, compact timeline, media collapsed.
 * 4. Effects - Effects library left, Program monitor, Inspector with Effects/Masks/Keyframes expanded right, Timeline with Graph editor sibling.
 * 5. Audio - Audio mixer prominent, timeline with tall audio tracks and waveforms, Inspector audio section expanded, small Program monitor.
 * 6. Graphics - large Program monitor with on-canvas text/gizmos, Inspector Text section, Captions panel, Fonts/Text visible, timeline below.
 */

export const PRESET_EDITING: Workspace = {
	id: 'editing',
	name: 'Editing',
	builtIn: true,
	inspectorDefaults: {
		expanded: { transform: true, crop: false, effects: true, masks: true, text: true },
		linkScale: true
	},
	layout: {
		type: 'split',
		direction: 'vertical',
		sizes: [55, 45], // Top row 55%, bottom timeline row 45%
		children: [
			{
				type: 'split',
				direction: 'horizontal',
				sizes: [18.3, 63.9, 17.8], // Left media ~264px (18.3%), center monitors ~920px (63.9%), right inspector ~256px (17.8%)
				children: [
					{
						type: 'stack',
						panelIds: ['captions', 'graphics', 'shapes', 'media', 'effects'],
						activeId: 'media'
					},
					{
						type: 'split',
						direction: 'horizontal',
						sizes: [50, 50],
						children: [
							{
								type: 'stack',
								panelIds: ['source'],
								activeId: 'source'
							},
							{
								type: 'stack',
								panelIds: ['program'],
								activeId: 'program'
							}
						]
					},
					{
						type: 'stack',
						panelIds: ['inspector', 'color'],
						activeId: 'inspector'
					}
				]
			},
			{
				type: 'stack',
				panelIds: ['timeline'],
				activeId: 'timeline'
			}
		]
	}
};

export const PRESET_ASSEMBLY: Workspace = {
	id: 'assembly',
	name: 'Assembly',
	builtIn: true,
	inspectorDefaults: {
		expanded: { transform: true, crop: false },
		linkScale: true
	},
	layout: {
		type: 'split',
		direction: 'vertical',
		sizes: [70, 30],
		children: [
			{
				type: 'split',
				direction: 'horizontal',
				sizes: [33, 52, 15],
				children: [
					{
						type: 'stack',
						panelIds: ['media'],
						activeId: 'media'
					},
					{
						type: 'split',
						direction: 'horizontal',
						sizes: [50, 50],
						children: [
							{
								type: 'stack',
								panelIds: ['source'],
								activeId: 'source'
							},
							{
								type: 'stack',
								panelIds: ['program'],
								activeId: 'program'
							}
						]
					},
					{
						type: 'stack',
						panelIds: ['inspector'],
						activeId: 'inspector'
					}
				]
			},
			{
				type: 'stack',
				panelIds: ['timeline'],
				activeId: 'timeline'
			}
		]
	}
};

export const PRESET_COLOR: Workspace = {
	id: 'color',
	name: 'Color',
	builtIn: true,
	inspectorDefaults: {
		expanded: { transform: false, crop: false, effects: true },
		linkScale: true
	},
	layout: {
		type: 'split',
		direction: 'vertical',
		sizes: [72, 28],
		children: [
			{
				type: 'split',
				direction: 'horizontal',
				sizes: [72, 28],
				children: [
					{
						type: 'split',
						direction: 'horizontal',
						sizes: [40, 60],
						children: [
							{
								type: 'stack',
								panelIds: ['source'],
								activeId: 'source'
							},
							{
								type: 'stack',
								panelIds: ['program'],
								activeId: 'program'
							}
						]
					},
					{
						type: 'stack',
						panelIds: ['color', 'inspector'],
						activeId: 'color'
					}
				]
			},
			{
				type: 'stack',
				panelIds: ['timeline'],
				activeId: 'timeline'
			}
		]
	}
};

export const PRESET_EFFECTS: Workspace = {
	id: 'effects',
	name: 'Effects',
	builtIn: true,
	inspectorDefaults: {
		expanded: { transform: true, crop: true, effects: true, masks: true },
		linkScale: true
	},
	layout: {
		type: 'split',
		direction: 'vertical',
		sizes: [60, 40],
		children: [
			{
				type: 'split',
				direction: 'horizontal',
				sizes: [20, 56, 24],
				children: [
					{
						type: 'stack',
						panelIds: ['effects', 'media'],
						activeId: 'effects'
					},
					{
						type: 'split',
						direction: 'horizontal',
						sizes: [40, 60],
						children: [
							{
								type: 'stack',
								panelIds: ['source', 'effect-controls-audio'],
								activeId: 'source'
							},
							{
								type: 'stack',
								panelIds: ['program'],
								activeId: 'program'
							}
						]
					},
					{
						type: 'stack',
						panelIds: ['inspector', 'color'],
						activeId: 'inspector'
					}
				]
			},
			{
				type: 'stack',
				panelIds: ['timeline', 'graph'],
				activeId: 'timeline'
			}
		]
	}
};

export const PRESET_AUDIO: Workspace = {
	id: 'audio',
	name: 'Audio',
	builtIn: true,
	inspectorDefaults: {
		expanded: { audio: true, transform: false },
		linkScale: true
	},
	layout: {
		type: 'split',
		direction: 'vertical',
		sizes: [55, 45],
		children: [
			{
				type: 'split',
				direction: 'horizontal',
				sizes: [18, 30, 28, 24],
				children: [
					{
						type: 'stack',
						panelIds: ['media', 'effects'],
						activeId: 'media'
					},
					{
						type: 'stack',
						panelIds: ['source', 'effect-controls-audio'],
						activeId: 'effect-controls-audio'
					},
					{
						type: 'stack',
						panelIds: ['program'],
						activeId: 'program'
					},
					{
						type: 'stack',
						panelIds: ['essential-sound', 'inspector'],
						activeId: 'essential-sound'
					}
				]
			},
			{
				type: 'split',
				direction: 'horizontal',
				sizes: [65, 35],
				children: [
					{
						type: 'stack',
						panelIds: ['timeline'],
						activeId: 'timeline'
					},
					{
						type: 'stack',
						panelIds: ['mixer', 'loudness'],
						activeId: 'mixer'
					}
				]
			}
		]
	}
};

export const PRESET_GRAPHICS: Workspace = {
	id: 'graphics',
	name: 'Graphics',
	builtIn: true,
	inspectorDefaults: {
		expanded: { text: true, transform: true, effects: true, masks: true },
		linkScale: true
	},
	layout: {
		type: 'split',
		direction: 'vertical',
		sizes: [65, 35],
		children: [
			{
				type: 'split',
				direction: 'horizontal',
				sizes: [20, 56, 24],
				children: [
					{
						type: 'stack',
						panelIds: ['captions', 'graphics', 'shapes', 'media', 'effects'],
						activeId: 'graphics'
					},
					{
						type: 'stack',
						panelIds: ['program'],
						activeId: 'program'
					},
					{
						type: 'stack',
						panelIds: ['inspector'],
						activeId: 'inspector'
					}
				]
			},
			{
				type: 'stack',
				panelIds: ['timeline'],
				activeId: 'timeline'
			}
		]
	}
};

export const PRESET_AI: Workspace = {
	id: 'ai',
	name: 'AI',
	builtIn: true,
	inspectorDefaults: {
		expanded: { transform: true, effects: true },
		linkScale: true
	},
	layout: {
		type: 'split',
		direction: 'vertical',
		sizes: [60, 40],
		children: [
			{
				type: 'split',
				direction: 'horizontal',
				sizes: [18, 28, 32, 22],
				children: [
					{
						type: 'stack',
						panelIds: ['media'],
						activeId: 'media'
					},
					{
						type: 'stack',
						panelIds: ['ai-assistant', 'auto-caption'],
						activeId: 'ai-assistant'
					},
					{
						type: 'stack',
						panelIds: ['program', 'source'],
						activeId: 'program'
					},
					{
						type: 'stack',
						panelIds: ['inspector'],
						activeId: 'inspector'
					}
				]
			},
			{
				type: 'stack',
				panelIds: ['timeline'],
				activeId: 'timeline'
			}
		]
	}
};

export const BUILT_IN_WORKSPACES: readonly Workspace[] = [
	PRESET_ASSEMBLY,
	PRESET_AI,
	PRESET_EDITING,
	PRESET_COLOR,
	PRESET_EFFECTS,
	PRESET_AUDIO,
	PRESET_GRAPHICS
];

export const WORKSPACE_ORDER: readonly string[] = [
	'assembly',
	'ai',
	'editing',
	'color',
	'effects',
	'audio',
	'graphics'
];
