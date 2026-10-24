import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '../core/factory';
import type { Clip, ClipId, Project } from '../core/types';
import { createEditorStore, type EditorStore } from './store';

const services = vi.hoisted(() => ({
	getProject: vi.fn(),
	listProjects: vi.fn(),
	saveProject: vi.fn(),
	setLastOpenedId: vi.fn(),
	getLastOpenedId: vi.fn(),
	deleteProject: vi.fn(),
	deleteProjectDir: vi.fn(),
	ensureProjectDir: vi.fn(),
	copyProjectMedia: vi.fn(),
	reconcileProjectMedia: vi.fn(),
	deleteMedia: vi.fn(),
	deleteMediaFile: vi.fn(),
	collectMediaGarbage: vi.fn(),
	writeMedia: vi.fn()
}));

vi.mock('../services/storage/projectDb', () => ({
	getProject: services.getProject,
	listProjects: services.listProjects,
	saveProject: services.saveProject,
	setLastOpenedId: services.setLastOpenedId,
	getLastOpenedId: services.getLastOpenedId,
	deleteProject: services.deleteProject
}));

vi.mock('../services/storage/opfs', () => ({
	deleteProjectDir: services.deleteProjectDir,
	ensureProjectDir: services.ensureProjectDir,
	copyProjectMedia: services.copyProjectMedia,
	reconcileProjectMedia: services.reconcileProjectMedia,
	deleteMedia: services.deleteMedia,
	deleteMediaFile: services.deleteMediaFile,
	collectMediaGarbage: services.collectMediaGarbage,
	writeMedia: services.writeMedia,
	isSupported: vi.fn(() => true)
}));

function createTestProject(): Project {
	const base = createEmptyProject({ name: 'Test Project' });
	const vTrack = base.tracks.find((t) => t.kind === 'video')!;

	const c1: Clip = {
		id: 'c1' as ClipId,
		start: 0,
		duration: 2_000_000,
		sourceIn: 0,
		sourceOut: 2_000_000,
		speed: 1,
		volume: 0.8,
		source: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
		transform: { x: 10, y: 20, scaleX: 1.2, scaleY: 1.2, rotation: 15, opacity: 0.9 },
		properties: {
			crop: { value: [0.1, 0.1, 0.1, 0.1] },
			'audio.volume': { value: -2 }
		},
		effects: [
			{
				id: 'cc1',
				type: 'colorCorrection',
				params: { exposure: 0.7 }
			},
			{
				id: 'blur1',
				type: 'gaussianBlur',
				params: { radius: 8 }
			}
		]
	};

	const c2: Clip = {
		id: 'c2' as ClipId,
		start: 4_000_000,
		duration: 2_000_000,
		sourceIn: 0,
		sourceOut: 2_000_000,
		speed: 1,
		volume: 1,
		source: { type: 'solid', color: { r: 0, g: 1, b: 0, a: 1 } }
	};

	return {
		...base,
		tracks: base.tracks.map((track) =>
			track.id === vTrack.id ? { ...track, clips: [c1, c2] } : track
		)
	};
}

describe('clip copy/paste and paste attributes store actions', () => {
	let store: EditorStore;

	beforeEach(async () => {
		vi.clearAllMocks();
		services.getProject.mockResolvedValue(null);
		services.listProjects.mockResolvedValue([]);
		services.saveProject.mockResolvedValue(undefined);
		services.setLastOpenedId.mockResolvedValue(undefined);
		services.getLastOpenedId.mockResolvedValue(null);
		services.deleteProject.mockResolvedValue(undefined);
		services.deleteProjectDir.mockResolvedValue(undefined);
		services.ensureProjectDir.mockResolvedValue(null);
		services.copyProjectMedia.mockImplementation(async (_source, destination) => destination);
		services.reconcileProjectMedia.mockImplementation(async (project) => ({
			assets: project.assets,
			unknownFiles: [],
			changed: false
		}));
		services.deleteMedia.mockResolvedValue(undefined);
		services.deleteMediaFile.mockResolvedValue(undefined);
		services.collectMediaGarbage.mockResolvedValue({
			removedFiles: [],
			removedCacheAssetIds: [],
			foreignFiles: []
		});
		services.writeMedia.mockResolvedValue('projects/project/media/asset.mp4');

		store = createEditorStore();
		const project = createTestProject();
		const ok = await store.getState().replaceProject(project);
		expect(ok).toBe(true);
	});

	it('copies selected clips and attributes to clipboard', () => {
		store.getState().selectClips(['c1' as ClipId]);
		const copied = store.getState().copySelectedClips();
		expect(copied).toBe(true);

		const clipClipboard = store.getState().clipClipboard;
		expect(clipClipboard).not.toBeNull();
		expect(clipClipboard?.items).toHaveLength(1);
		expect(clipClipboard?.items[0]?.clip.id).toBe('c1');

		const attrClipboard = store.getState().attributesClipboard;
		expect(attrClipboard).not.toBeNull();
		expect(attrClipboard?.transform?.transform?.x).toBe(10);
		expect(attrClipboard?.crop).toEqual({ value: [0.1, 0.1, 0.1, 0.1] });
		expect(attrClipboard?.colorGrading?.effects).toHaveLength(1);
		expect(attrClipboard?.videoEffects?.effects).toHaveLength(1);
	});

	it('pastes clips at the playhead and selects newly pasted clips with single undo step', () => {
		store.getState().selectClips(['c1' as ClipId]);
		store.getState().copySelectedClips();

		store.getState().setPlayhead(10_000_000);
		const pasted = store.getState().pasteClips();
		expect(pasted).toBe(true);

		const activeProject = store.getState().project!;
		const v1 = activeProject.tracks.find((t) => t.kind === 'video')!;
		expect(v1.clips).toHaveLength(3);

		const newlyPasted = v1.clips.find((c) => c.start === 10_000_000);
		expect(newlyPasted).toBeDefined();
		expect(newlyPasted?.duration).toBe(2_000_000);
		expect(newlyPasted?.id).not.toBe('c1');

		// Selection should be updated to newly pasted clip
		expect(store.getState().timeline.selection.clipIds).toEqual([newlyPasted?.id]);

		// Single undo restores previous state
		store.getState().undo();
		const afterUndo = store.getState().project!;
		expect(afterUndo.tracks.find((t) => t.kind === 'video')!.clips).toHaveLength(2);
	});

	it('opens and closes paste attributes dialog, and applies attributes to target clips', () => {
		// Copy c1
		store.getState().selectClips(['c1' as ClipId]);
		store.getState().copySelectedClips();

		// Target c2
		store.getState().selectClips(['c2' as ClipId]);

		// Open dialog
		store.getState().openPasteAttributesDialog();
		expect(store.getState().isPasteAttributesOpen).toBe(true);

		// Paste attributes (transform and color grading)
		const applied = store.getState().pasteAttributes({
			transform: true,
			crop: false,
			colorGrading: true,
			videoEffects: false,
			audio: true
		});
		expect(applied).toBe(true);
		expect(store.getState().isPasteAttributesOpen).toBe(false);

		const updatedProject = store.getState().project!;
		const updatedC2 = updatedProject.tracks[0]!.clips.find((c) => c.id === 'c2')!;

		expect(updatedC2.transform?.x).toBe(10);
		expect(updatedC2.volume).toBe(0.8);
		// Crop was set to false, so c2 crop should remain undefined
		expect(updatedC2.properties?.crop).toBeUndefined();
		// Color grading was applied
		expect(updatedC2.effects?.some((e) => e.type === 'colorCorrection')).toBe(true);
		// Video effects was false, so blur was not applied
		expect(updatedC2.effects?.some((e) => e.type === 'gaussianBlur')).toBe(false);

		// Single undo restores c2
		store.getState().undo();
		const afterUndo = store.getState().project!;
		const c2AfterUndo = afterUndo.tracks[0]!.clips.find((c) => c.id === 'c2')!;
		expect(c2AfterUndo.transform).toBeUndefined();
		expect(c2AfterUndo.effects).toBeUndefined();
	});
});
