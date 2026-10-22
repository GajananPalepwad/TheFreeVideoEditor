import { describe, expect, it } from 'vitest';
import {
	GRAPHIC_TEMPLATES,
	GRAPHIC_ANIMATION_PRESETS,
	getGraphicTemplate,
	createGraphicClip,
	applyGraphicTemplateToClip,
	computeColorRuns
} from './graphicsTemplates';
import { evaluate } from '../animation';
import { createEditorStore } from '../../state/store';
import { createEmptyProject } from '../factory';

describe('Graphic Motion Templates & Kinetic Typography', () => {
	it('defines curated graphic templates with valid metadata, colors, and frame styles', () => {
		expect(GRAPHIC_TEMPLATES.length).toBe(19);

		const categories = new Set(GRAPHIC_TEMPLATES.map((t) => t.category));
		expect(categories.has('lower-third')).toBe(true);
		expect(categories.has('titles')).toBe(true);

		const ids = new Set(GRAPHIC_TEMPLATES.map((t) => t.id));
		expect(ids.has('mixkit-minimal-wipe-lower-third')).toBe(true);
		expect(ids.has('mixkit-bold-italic-split-title')).toBe(true);
		expect(ids.has('cinematic-blockbuster')).toBe(true);

		for (const tpl of GRAPHIC_TEMPLATES) {
			expect(tpl.id).toBeTruthy();
			expect(tpl.name).toBeTruthy();
			expect(tpl.defaultText).toBeTruthy();
			expect(tpl.style.fontFamily).toBeTruthy();
			expect(tpl.animationPresetId).toBeTruthy();
			expect(tpl.accentColor).toBeDefined();
			expect(tpl.previewColors.background).toBeTruthy();
		}
	});

	it('defines extended kinetic motion animation presets', () => {
		const animIds = GRAPHIC_ANIMATION_PRESETS.map((a) => a.id);
		expect(animIds).toContain('kinetic-zoom');
		expect(animIds).toContain('bounce-in');
		expect(animIds).toContain('split-slide');
		expect(animIds).toContain('glitch-snap');
		expect(animIds).toContain('smooth-drift');
		expect(animIds).toContain('pop-out');
	});

	it('creates a motion graphic clip with template styles and animated properties', () => {
		const tpl = getGraphicTemplate('mixkit-minimal-wipe-lower-third');
		expect(tpl).toBeDefined();
		if (!tpl) return;

		const clip = createGraphicClip('mixkit-minimal-wipe-lower-third', 1_000_000, 4_000_000);
		expect(clip.start).toBe(1_000_000);
		expect(clip.duration).toBe(4_000_000);
		expect(clip.source?.type).toBe('text');

		if (clip.source?.type === 'text') {
			expect(clip.source.text).toBe(tpl.defaultText);
			expect(clip.source.graphicTemplateId).toBe('mixkit-minimal-wipe-lower-third');
			expect(clip.source.box?.frameStyle).toBe('accent-bar');
			expect(clip.source.box?.accentBarColor).toEqual(tpl.box.accentBarColor);
		}
	});

	it('computes color runs for highlighted accent words', () => {
		const mockTpl = {
			...getGraphicTemplate('mixkit-minimal-wipe-lower-third')!,
			highlightWord: 'MATT TYLER'
		};

		const runs = computeColorRuns(mockTpl.defaultText, mockTpl);
		expect(runs.length).toBe(1);
		expect(runs[0]?.startIndex).toBe(0);
		expect(runs[0]?.endIndex).toBe(10);
		expect(runs[0]?.fillColor).toEqual(mockTpl.accentColor);
	});

	it('applies a graphic template onto an existing clip', () => {
		const originalClip = createGraphicClip('mixkit-minimal-wipe-lower-third', 0, 3_000_000, 'CUSTOM HEADLINE');
		const updated = applyGraphicTemplateToClip(originalClip, 'mixkit-minimal-wipe-lower-third');

		expect(updated.source?.type).toBe('text');
		if (updated.source?.type === 'text') {
			expect(updated.source.text).toBe('CUSTOM HEADLINE');
			expect(updated.source.graphicTemplateId).toBe('mixkit-minimal-wipe-lower-third');
		}
	});

	it('integrates store methods: addGraphicClip, applyGraphicTemplate, and setGraphicAccentColor', () => {
		const store = createEditorStore();
		const project = createEmptyProject({ name: 'Graphics Test' });
		store.setState({ project });

		// Add graphic clip to track via store
		const clipId = store.getState().addGraphicClip('mixkit-minimal-wipe-lower-third');
		expect(clipId).toBeTruthy();

		const projectAfter = store.getState().project;
		const addedClip = projectAfter?.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
		expect(addedClip).toBeDefined();
		expect(addedClip?.source?.type).toBe('text');

		// Apply template
		store.getState().applyGraphicTemplate(clipId!, 'mixkit-minimal-wipe-lower-third');
		const modifiedClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		if (modifiedClip?.source?.type === 'text') {
			expect(modifiedClip.source.graphicTemplateId).toBe('mixkit-minimal-wipe-lower-third');
		}

		// Update accent color
		store.getState().setGraphicAccentColor(clipId!, { r: 1, g: 0, b: 0.5, a: 1 });
		const accentClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		if (accentClip?.source?.type === 'text') {
			expect(accentClip.source.box?.accentBarColor?.r).toBe(1);
			expect(accentClip.source.box?.accentBarColor?.b).toBe(0.5);
		}
	});

	it('reliably undoes and redoes all graphic operations: add, text edit, template switch, animation, color', () => {
		const store = createEditorStore();
		const project = createEmptyProject({ name: 'Undo Redo Graphics Test' });
		store.setState({ project, isProjectManagerOpen: false });

		// 1. Add graphic clip
		const clipId = store.getState().addGraphicClip('mixkit-minimal-wipe-lower-third')!;
		expect(clipId).toBeTruthy();
		expect(store.getState().history.canUndo).toBe(true);
		expect(store.getState().timeline.selection.clipIds).toEqual([clipId]);

		// Undo adding clip
		expect(store.getState().undo()).toBe(true);
		expect(
			store
				.getState()
				.project?.tracks.flatMap((t) => t.clips)
				.find((c) => c.id === clipId)
		).toBeUndefined();
		expect(store.getState().timeline.selection.clipIds).toEqual([]);

		// Redo adding clip
		expect(store.getState().redo()).toBe(true);
		expect(
			store
				.getState()
				.project?.tracks.flatMap((t) => t.clips)
				.find((c) => c.id === clipId)
		).toBeDefined();
		expect(store.getState().timeline.selection.clipIds).toEqual([clipId]);

		// 2. Edit text content
		store.getState().setTextContent(clipId, 'NEW HEADLINE\nAND LINE TWO');
		let currentClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		expect(currentClip?.source?.type === 'text' && currentClip.source.text).toBe(
			'NEW HEADLINE\nAND LINE TWO'
		);

		// Undo text edit
		expect(store.getState().undo()).toBe(true);
		currentClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		expect(currentClip?.source?.type === 'text' && currentClip.source.text).toBe(
			'MATT TYLER\nART DEPARTMENT ASSISTANT'
		);

		// Redo text edit
		expect(store.getState().redo()).toBe(true);
		currentClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		expect(currentClip?.source?.type === 'text' && currentClip.source.text).toBe(
			'NEW HEADLINE\nAND LINE TWO'
		);

		// 3. Switch template
		store.getState().applyGraphicTemplate(clipId, 'mixkit-minimal-wipe-lower-third');
		currentClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		expect(currentClip?.source?.type === 'text' && currentClip.source.graphicTemplateId).toBe(
			'mixkit-minimal-wipe-lower-third'
		);

		// 4. Apply animation preset
		store.getState().applyTextAnimation(clipId, 'bounce-in');
		currentClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		expect(currentClip?.properties?.['scale']).toBeDefined();

		// Undo animation preset
		expect(store.getState().undo()).toBe(true);

		// Redo animation preset
		expect(store.getState().redo()).toBe(true);

		// 5. Update accent color
		store.getState().setGraphicAccentColor(clipId, { r: 0.1, g: 0.8, b: 0.9, a: 1 });
		currentClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		if (currentClip?.source?.type === 'text') {
			expect(currentClip.source.box?.accentBarColor?.r).toBeCloseTo(0.1, 2);
		}

		// Undo color
		expect(store.getState().undo()).toBe(true);

		// Redo color
		expect(store.getState().redo()).toBe(true);
		currentClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === clipId);
		if (currentClip?.source?.type === 'text') {
			expect(currentClip.source.box?.accentBarColor?.r).toBeCloseTo(0.1, 2);
		}
	});
});
