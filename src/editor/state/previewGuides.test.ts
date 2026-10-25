import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorStore } from './store';

// Mock storage services that touch browser APIs
vi.mock('../services/storage/projectDb', () => ({
	saveProject: vi.fn().mockResolvedValue(undefined),
	getProject: vi.fn().mockResolvedValue(null),
	deleteProject: vi.fn().mockResolvedValue(undefined),
	listProjects: vi.fn().mockResolvedValue([]),
	initProjectDb: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../services/storage/opfs', () => ({
	reconcileProjectMedia: vi.fn().mockResolvedValue(undefined),
	collectMediaGarbage: vi.fn().mockResolvedValue({
		removedFiles: [],
		removedCacheAssetIds: [],
		foreignFiles: []
	})
}));

describe('preview guides in editor store', () => {
	let store: ReturnType<typeof createEditorStore>;

	beforeEach(() => {
		store = createEditorStore();
	});

	it('initializes with all guides disabled by default', () => {
		const state = store.getState();
		expect(state.previewGuides).toEqual({
			safeMargins: false,
			ruleOfThirds: false,
			socialGuide: false
		});
	});

	it('toggles safe margins on and off', () => {
		expect(store.getState().previewGuides.safeMargins).toBe(false);

		store.getState().togglePreviewGuide('safeMargins');
		expect(store.getState().previewGuides.safeMargins).toBe(true);

		store.getState().togglePreviewGuide('safeMargins');
		expect(store.getState().previewGuides.safeMargins).toBe(false);
	});

	it('toggles rule of thirds and social guide independently', () => {
		store.getState().togglePreviewGuide('ruleOfThirds');
		expect(store.getState().previewGuides.ruleOfThirds).toBe(true);
		expect(store.getState().previewGuides.safeMargins).toBe(false);
		expect(store.getState().previewGuides.socialGuide).toBe(false);

		store.getState().togglePreviewGuide('socialGuide');
		expect(store.getState().previewGuides.socialGuide).toBe(true);
		expect(store.getState().previewGuides.ruleOfThirds).toBe(true);
	});

	it('sets preview guide explicitly with setPreviewGuide', () => {
		store.getState().setPreviewGuide('safeMargins', true);
		expect(store.getState().previewGuides.safeMargins).toBe(true);

		store.getState().setPreviewGuide('safeMargins', true);
		expect(store.getState().previewGuides.safeMargins).toBe(true);

		store.getState().setPreviewGuide('safeMargins', false);
		expect(store.getState().previewGuides.safeMargins).toBe(false);
	});

	it('resets all preview guides with resetPreviewGuides', () => {
		store.getState().setPreviewGuide('safeMargins', true);
		store.getState().setPreviewGuide('ruleOfThirds', true);
		store.getState().setPreviewGuide('socialGuide', true);

		expect(store.getState().previewGuides).toEqual({
			safeMargins: true,
			ruleOfThirds: true,
			socialGuide: true
		});

		store.getState().resetPreviewGuides();

		expect(store.getState().previewGuides).toEqual({
			safeMargins: false,
			ruleOfThirds: false,
			socialGuide: false
		});
	});
});
