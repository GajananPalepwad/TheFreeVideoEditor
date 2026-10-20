import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject, isAnimated, propertyCurve, readProperty } from '../core';
import type {
	AssetId,
	ClipId,
	DragPosition,
	ProjectId,
	ProjectSummary,
	SequenceId,
	TrackId
} from '../core';
import { getBuiltinMotionTemplate } from '../core/templates/builtinTemplates';
import type { MotionGraphicTemplate } from '../core/templates/templateTypes';
import { registerProjectExport } from '../services/export/session';
import { createEditorStore } from './store';

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
	writeMedia: vi.fn(),
	deleteDerived: vi.fn(),
	deleteProjectDerived: vi.fn()
}));

vi.mock('../services/storage/projectDb', () => ({
	CorruptProjectError: class CorruptProjectError extends Error {
		projectId: ProjectId;
		rawJson: string;

		constructor(projectId: ProjectId, _raw: unknown, cause: unknown) {
			super('This saved project is corrupt and could not be opened.', { cause });
			this.projectId = projectId;
			this.rawJson = '{}';
		}
	},
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

vi.mock('../services/storage/mediaCache', () => ({
	deleteDerived: services.deleteDerived,
	deleteProjectDerived: services.deleteProjectDerived
}));

vi.mock('../services/media/derived', () => ({
	generateDerived: vi.fn().mockResolvedValue({
		poster: new Blob(),
		thumbs: [],
		waveformStatus: 'none'
	})
}));

vi.mock('../services/theme/theme', () => ({
	applyTheme: vi.fn().mockReturnValue(true),
	initializeTheme: vi.fn().mockReturnValue({ mode: 'dark', persistenceAvailable: true })
}));

describe('editor store', () => {
	beforeEach(() => {
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
		services.deleteDerived.mockResolvedValue(undefined);
		services.deleteProjectDerived.mockResolvedValue(undefined);
	});

	it('provides one default editor state for each editor instance', () => {
		const store = createEditorStore();

		expect(store.getState().projectName).toBe('Untitled Project');
		expect(store.getState().theme).toBe('dark');
		expect(store.getState().project).toBeNull();
		expect(store.getState().revision).toBe(0);
	});

	it('keeps rename draft changes in the shared store and can cancel them', () => {
		const store = createEditorStore();

		store.getState().beginRename();
		store.getState().setProjectNameDraft('Unsaved Name');
		expect(store.getState().projectNameDraft).toBe('Unsaved Name');

		store.getState().cancelRename();
		expect(store.getState().projectName).toBe('Untitled Project');
		expect(store.getState().projectNameDraft).toBe('Untitled Project');
		expect(store.getState().isRenaming).toBe(false);
	});

	it('clamps panel resizing through a store action', () => {
		const store = createEditorStore();

		store.getState().resizePanel('media', 24);
		expect(store.getState().mediaWidth).toBe(288);

		store.getState().resizePanel('media', 1000);
		expect(store.getState().mediaWidth).toBe(420);
	});

	it('creates and renames the active project through the shared mutation path', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'First cut', settings: { fps: 30 } });

		const firstId = store.getState().project?.id;
		expect(store.getState().project?.name).toBe('First cut');
		expect(store.getState().project?.settings.width).toBe(1920);
		expect(store.getState().revision).toBe(1);

		store.getState().renameProject('Final cut');
		expect(store.getState().project?.name).toBe('Final cut');
		expect(store.getState().projectName).toBe('Final cut');
		expect(store.getState().revision).toBe(2);
		expect(store.getState().project?.id).toBe(firstId);
	});

	it('undoes and redoes project mutations while revisions continue to advance', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'History test' });
		store.getState().renameProject('Renamed');
		expect(store.getState().history.undoLabel).toBe('Rename project');

		expect(store.getState().undo()).toBe(true);
		expect(store.getState().project?.name).toBe('History test');
		expect(store.getState().revision).toBe(3);
		expect(store.getState().history.redoLabel).toBe('Rename project');

		expect(store.getState().redo()).toBe(true);
		expect(store.getState().project?.name).toBe('Renamed');
		expect(store.getState().revision).toBe(4);
	});

	it('blocks history while a timeline drag or project manager is active', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Blocked history' });
		store.getState().renameProject('Changed');
		store.getState().beginTimelineDrag({
			kind: 'move',
			clipIds: [],
			original: [],
			preview: [],
			pointerStartTime: 0,
			pointerTime: 0,
			allowed: true,
			unlink: false
		});

		expect(store.getState().undo()).toBe(false);
		store.getState().cancelTimelineDrag();
		store.getState().openProjectManager();
		expect(store.getState().undo()).toBe(false);
	});

	it('clears session history when switching projects', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'First project' });
		store.getState().renameProject('Edited first project');
		const nextProject = createEmptyProject({ name: 'Second project' });
		services.getProject.mockResolvedValue(nextProject);

		await store.getState().openProject(nextProject.id);

		expect(store.getState().project?.id).toBe(nextProject.id);
		expect(store.getState().history.canUndo).toBe(false);
		expect(store.getState().history.canRedo).toBe(false);
	});

	it('opens a saved project without marking it dirty', async () => {
		const store = createEditorStore();
		const project = createEmptyProject({ name: 'Previously saved' });
		services.getProject.mockResolvedValue(project);

		await store.getState().openProject(project.id);

		expect(store.getState().project).toEqual(project);
		expect(store.getState().revision).toBe(0);
		expect(store.getState().saveStatus).toBe('saved');
		expect(services.setLastOpenedId).toHaveBeenCalledWith(project.id);
	});

	it('duplicates the project with a new id and an incremented revision', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'My First Cut' });
		const firstId = store.getState().project?.id;

		await store.getState().duplicateProject(firstId as ProjectId);

		expect(store.getState().project?.id).not.toBe(firstId);
		expect(store.getState().project?.name).toBe('My First Cut copy');
		expect(store.getState().revision).toBe(2);
	});

	it('deletes the active project and returns to the manager', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Delete me' });
		const id = store.getState().project?.id;
		const deleted = await store.getState().deleteProject(id as ProjectId);

		expect(deleted).toBe(true);
		expect(store.getState().project).toBeNull();
		expect(store.getState().isProjectManagerOpen).toBe(true);
		expect(services.deleteProjectDir).toHaveBeenCalledWith(id);
		expect(services.deleteProject).toHaveBeenCalledWith(id);
	});

	it('keeps project summaries in the store after refresh', async () => {
		const store = createEditorStore();
		const summary: ProjectSummary = {
			id: 'summary' as ProjectId,
			name: 'Listed',
			updatedAt: new Date().toISOString(),
			duration: 0,
			assetCount: 0
		};
		services.listProjects.mockResolvedValue([summary]);

		await store.getState().refreshProjects();

		expect(store.getState().projects).toEqual([summary]);
	});

	it('shows a recovery state instead of throwing for a corrupt last-opened project', async () => {
		const store = createEditorStore();
		const project = createEmptyProject({ name: 'Corrupt' });
		services.getLastOpenedId.mockResolvedValue(project.id);
		const { CorruptProjectError } = await import('../services/storage/projectDb');
		services.getProject.mockRejectedValue(
			new CorruptProjectError(project.id, { invalid: true }, new Error('invalid'))
		);

		await store.getState().initialize();

		expect(store.getState().project).toBeNull();
		expect(store.getState().recovery?.projectId).toBe(project.id);
	});

	it('adds a linked clip and commits a drag as exactly one project revision', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Timeline editing' });
		const project = store.getState().project!;
		const assetId = 'timeline-store-asset' as AssetId;
		const withAsset = {
			...project,
			assets: {
				[assetId]: {
					id: assetId,
					kind: 'video' as const,
					name: 'sample.mp4',
					mimeType: 'video/mp4',
					size: 100,
					duration: 5_000_000,
					hasAudio: true,
					opfsPath: `projects/${project.id}/media/${assetId}.mp4`
				}
			}
		};
		await store.getState().replaceProject(withAsset);
		const videoTrack = store.getState().project!.tracks.find((track) => track.kind === 'video')!;
		expect(store.getState().addAssetToTimeline(assetId, videoTrack.id, 0)).toBe(true);
		const state = store.getState();
		const clips = state.project!.tracks.flatMap((track) => track.clips);
		expect(clips).toHaveLength(2);
		expect(clips[0]?.linkId).toBe(clips[1]?.linkId);
		const revision = state.revision;
		const original: DragPosition[] = clips.map((clip) => ({
			clipId: clip.id,
			trackId: state.project!.tracks.find((track) => track.clips.includes(clip))!.id,
			start: clip.start,
			duration: clip.duration,
			sourceIn: clip.sourceIn,
			sourceOut: clip.sourceOut
		}));
		store.getState().beginTimelineDrag({
			kind: 'move',
			clipIds: [clips[0]!.id],
			original,
			preview: original,
			pointerStartTime: 0,
			pointerTime: 0,
			allowed: true,
			unlink: false
		});
		store.getState().updateTimelineDrag(1_000_000);
		expect(store.getState().revision).toBe(revision);
		expect(store.getState().timeline.drag?.preview.map((entry) => entry.start)).toEqual([
			1_000_000, 1_000_000
		]);
		expect(store.getState().commitTimelineDrag()).toBe(true);
		expect(store.getState().revision).toBe(revision + 1);
		expect(
			store
				.getState()
				.project?.tracks.flatMap((track) => track.clips)
				.map((clip) => clip.start)
		).toEqual([1_000_000, 1_000_000]);
	});

	it('cancels a drag without changing the project and resets timeline on close', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Cancel drag' });
		const revision = store.getState().revision;
		store.getState().setPlayhead(2_000_000);
		store.getState().setZoom(100);
		store.getState().beginTimelineDrag({
			kind: 'move',
			clipIds: [],
			original: [],
			preview: [],
			pointerStartTime: 0,
			pointerTime: 0,
			allowed: true,
			unlink: false
		});
		store.getState().cancelTimelineDrag();
		expect(store.getState().project?.tracks).toHaveLength(2);
		expect(store.getState().revision).toBe(revision);
		expect(store.getState().timeline.drag).toBeNull();
		await store.getState().closeProject();
		expect(store.getState().timeline.playhead).toBe(0);
		expect(store.getState().timeline.pixelsPerSecond).toBe(64);
		expect(store.getState().timeline.selection.clipIds).toEqual([]);
	});

	it('prunes deleted clips and restores the selection on undo', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Prune selection' });
		const project = store.getState().project!;
		const assetId = 'selection-asset' as AssetId;
		const clipId = 'selection-clip' as ClipId;
		const projectWithClip = {
			...project,
			assets: {
				[assetId]: {
					id: assetId,
					kind: 'audio' as const,
					name: 'tone.wav',
					mimeType: 'audio/wav',
					size: 10,
					duration: 1_000_000,
					hasAudio: true,
					opfsPath: `projects/${project.id}/media/${assetId}.wav`
				}
			},
			tracks: project.tracks.map((track) =>
				track.kind === 'audio'
					? {
							...track,
							clips: [
								{
									id: clipId,
									assetId,
									start: 0,
									duration: 1_000_000,
									sourceIn: 0,
									sourceOut: 1_000_000,
									speed: 1,
									volume: 1
								}
							]
						}
					: track
			)
		};
		await store.getState().replaceProject(projectWithClip);
		store.getState().selectClips([clipId]);
		expect(store.getState().deleteSelection()).toBe(true);
		expect(store.getState().timeline.selection.clipIds).toEqual([]);
		expect(store.getState().undo()).toBe(true);
		expect(store.getState().timeline.selection.clipIds).toEqual([clipId]);
		expect(
			store
				.getState()
				.project?.tracks.flatMap((track) => track.clips)
				.map((clip) => clip.id)
		).toContain(clipId);
	});

	it('asks before switching projects during export and waits for cancellation', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Current export project' });
		const currentProject = store.getState().project;
		if (!currentProject) throw new Error('Project was not created.');
		const nextProject = createEmptyProject({ name: 'Next project' });
		services.getProject.mockResolvedValueOnce(nextProject);

		const controller = new AbortController();
		const unregister = registerProjectExport(currentProject.id, controller);
		await store.getState().openProject(nextProject.id);
		expect(store.getState().isExportClosePromptOpen).toBe(true);
		expect(store.getState().project?.id).toBe(currentProject.id);

		const switching = store.getState().confirmCancelExportAndContinue();
		expect(controller.signal.aborted).toBe(true);
		unregister();
		await switching;
		expect(store.getState().isExportClosePromptOpen).toBe(false);
		expect(store.getState().project?.id).toBe(nextProject.id);
	});

	it('manages keyframes, undo/redo restores keyframe selection, and handles copy/paste', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Keyframe project' });
		const project = store.getState().project;
		if (!project) throw new Error('Project was not created.');
		const clipId = 'clip-kf-1' as ClipId;
		const assetId = 'asset-kf-1' as AssetId;
		const projectWithClip = {
			...project,
			assets: {
				[assetId]: {
					id: assetId,
					kind: 'video' as const,
					name: 'video.mp4',
					mimeType: 'video/mp4',
					size: 100,
					duration: 2_000_000,
					hasAudio: false,
					opfsPath: `projects/${project.id}/media/${assetId}.mp4`
				}
			},
			tracks: project.tracks.map((track) =>
				track.kind === 'video'
					? {
							...track,
							clips: [
								{
									id: clipId,
									assetId,
									start: 0,
									duration: 2_000_000,
									sourceIn: 0,
									sourceOut: 2_000_000,
									speed: 1,
									volume: 1,
									properties: {}
								}
							]
						}
					: track
			)
		};
		const ok = await store.getState().replaceProject(projectWithClip);
		expect(ok).toBe(true);
		store.getState().selectClips([clipId]);

		// Enable animation on opacity
		store.getState().setPlayhead(500_000);
		store.getState().enableAnimation(clipId, 'opacity');
		expect(store.getState().keyframes.selection).toEqual([
			{ clipId, propertyId: 'opacity', time: 500_000 }
		]);

		// Set property with autokey at 1_000_000
		store.getState().setPlayhead(1_000_000);
		store.getState().setProperty(clipId, 'opacity', 0.5, { autoKey: true });

		// Check next / prev keyframe navigation
		store.getState().setPlayhead(0);
		store.getState().nextKeyframe();
		expect(store.getState().timeline.playhead).toBe(500_000);
		store.getState().nextKeyframe();
		expect(store.getState().timeline.playhead).toBe(1_000_000);
		store.getState().prevKeyframe();
		expect(store.getState().timeline.playhead).toBe(500_000);

		// Select keyframe, copy and paste
		store.getState().selectKeyframe({ clipId, propertyId: 'opacity', time: 500_000 });
		store.getState().copySelectedKeyframes();
		expect(store.getState().keyframes.clipboard?.entries.length).toBe(1);

		store.getState().setPlayhead(1_500_000);
		store.getState().pasteKeyframes();
		expect(store.getState().keyframes.selection).toEqual([
			{ clipId, propertyId: 'opacity', time: 1_500_000 }
		]);

		// Easy ease
		store.getState().easyEase();

		// Move selected keyframe multiple consecutive times (as in dragging)
		store.getState().selectKeyframe({ clipId, propertyId: 'opacity', time: 1_500_000 });
		store.getState().moveSelectedKeyframes(100_000, false);
		expect(store.getState().keyframes.selection).toEqual([
			{ clipId, propertyId: 'opacity', time: 1_600_000 }
		]);
		store.getState().moveSelectedKeyframes(100_000, false);
		expect(store.getState().keyframes.selection).toEqual([
			{ clipId, propertyId: 'opacity', time: 1_700_000 }
		]);
		store.getState().moveSelectedKeyframes(0, true);
		expect(store.getState().keyframes.selection).toEqual([
			{ clipId, propertyId: 'opacity', time: 1_700_000 }
		]);

		// Undo restores keyframe selection
		expect(store.getState().undo()).toBe(true);
		expect(store.getState().redo()).toBe(true);
	});

	it('manages clip effects, color correction, adjustment and solid layers', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Effects Test' });

		// 1. Add Adjustment layer
		store.getState().setPlayhead(1_000_000);
		const adjClipId = store.getState().addAdjustmentLayer();
		expect(adjClipId).toBeTruthy();
		const adjClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === adjClipId);
		expect(adjClip?.source?.type).toBe('adjustment');
		expect(adjClip?.duration).toBe(5_000_000);

		// 2. Add Solid layer
		const solidClipId = store.getState().addSolidLayer('#ff0000');
		expect(solidClipId).toBeTruthy();
		const solidClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === solidClipId);
		expect(solidClip?.source?.type).toBe('solid');

		// 3. Add effect to adjustment layer
		const blur = store.getState().addEffect(adjClipId!, 'gaussianBlur', { radius: 10 });
		expect(blur).toBeTruthy();
		expect(blur?.type).toBe('gaussianBlur');
		expect(store.getState().effectsUi.selectedEffectId).toBe(blur!.id);

		// 4. Set effect parameter
		store.getState().setEffectParam(adjClipId!, blur!.id, 'radius', 25);
		const clipWithBlur = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === adjClipId);
		expect(clipWithBlur?.effects?.[0]?.params.radius).toEqual({ value: 25 });

		// 5. Duplicate effect
		const duplicated = store.getState().duplicateEffect(adjClipId!, blur!.id);
		expect(duplicated).toBeTruthy();
		expect(duplicated?.id).not.toBe(blur!.id);
		expect(
			store
				.getState()
				.project?.tracks.flatMap((t) => t.clips)
				.find((c) => c.id === adjClipId)?.effects?.length
		).toBe(2);

		// 6. Toggle and reset effect
		store.getState().toggleEffect(adjClipId!, blur!.id, false);
		const clipAfterToggle = (store.getState().project?.tracks.flatMap((t) => t.clips) ?? []).find(
			(c) => c.id === adjClipId
		);
		expect(clipAfterToggle?.effects?.[0]?.enabled).toBe(false);

		store.getState().resetEffect(adjClipId!, blur!.id);
		const clipAfterReset = (store.getState().project?.tracks.flatMap((t) => t.clips) ?? []).find(
			(c) => c.id === adjClipId
		);
		// Default radius for gaussianBlur is 0
		expect(clipAfterReset?.effects?.[0]?.params.radius).toBe(0);

		// 7. Copy and paste effects to solid clip
		store.getState().copyClipEffects(adjClipId!);
		expect(store.getState().effectsClipboard?.length).toBe(2);
		store.getState().pasteClipEffects(solidClipId!);
		const solidWithEffects = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === solidClipId);
		expect(solidWithEffects?.effects?.length).toBe(2);

		// 8. Ensure color correction
		const cc = store.getState().ensureColorCorrection(solidClipId!);
		expect(cc?.type).toBe('colorCorrection');
		const existingCc = store.getState().ensureColorCorrection(solidClipId!);
		expect(existingCc?.id).toBe(cc?.id);

		// 9. Remove effect
		store.getState().removeEffect(adjClipId!, blur!.id);
		expect(
			store
				.getState()
				.project?.tracks.flatMap((t) => t.clips)
				.find((c) => c.id === adjClipId)?.effects?.length
		).toBe(1);

		// 10. Undo restores removed effect
		expect(store.getState().undo()).toBe(true);
		expect(
			store
				.getState()
				.project?.tracks.flatMap((t) => t.clips)
				.find((c) => c.id === adjClipId)?.effects?.length
		).toBe(2);

		// 10b. Solo effect and master bypass
		store.getState().soloEffect(adjClipId!, blur!.id);
		const soloedClip = (store.getState().project?.tracks.flatMap((t) => t.clips) ?? []).find(
			(c) => c.id === adjClipId
		);
		expect(soloedClip?.effects?.[0]?.enabled).toBe(true);
		expect(soloedClip?.effects?.[1]?.enabled).toBe(false);

		store.getState().toggleBypassClipEffects(adjClipId!, true);
		const bypassedClip = (store.getState().project?.tracks.flatMap((t) => t.clips) ?? []).find(
			(c) => c.id === adjClipId
		);
		expect(bypassedClip?.bypassEffects).toBe(true);

		store.getState().toggleBypassClipEffects(adjClipId!, false);
		const restoredClip = (store.getState().project?.tracks.flatMap((t) => t.clips) ?? []).find(
			(c) => c.id === adjClipId
		);
		expect(restoredClip?.bypassEffects).toBe(false);

		// 11. Scopes & Color UI state
		store.getState().setScopesOpen(true);
		expect(store.getState().scopes.open).toBe(true);
		store.getState().setScopesMode('vectorscope');
		expect(store.getState().scopes.mode).toBe('vectorscope');
		store.getState().setColorTab('wheels');
		expect(store.getState().colorUi.activeTab).toBe('wheels');

		// 12. Import LUT
		const cubeContent = `
TITLE "Test"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;
		const lutAssetId = await store.getState().importLut('TestLut', cubeContent);
		expect(lutAssetId).toBeTruthy();
		expect(store.getState().project?.assets[lutAssetId!]?.kind).toBe('lut');
	});

	it('manages Gate M speed, reverse, time remap, and freeze frame actions', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Speed Store Test' });

		const solidId = store.getState().addSolidLayer('#3b82f6')!;
		expect(solidId).toBeTruthy();
		store.getState().selectClips([solidId]);

		// Speed Dialog toggle
		store.getState().openSpeedDialog(solidId);
		expect(store.getState().isSpeedDialogOpen).toBe(true);
		expect(store.getState().speedDialogClipId).toBe(solidId);
		store.getState().closeSpeedDialog();
		expect(store.getState().isSpeedDialogOpen).toBe(false);

		// Import Dialog toggle
		store.getState().openImportDialog();
		expect(store.getState().isImportDialogOpen).toBe(true);
		store.getState().closeImportDialog();
		expect(store.getState().isImportDialogOpen).toBe(false);

		// setClipSpeed
		expect(store.getState().setClipSpeed([solidId], 2, { maintainPitch: true })).toBe(true);
		let clip = store.getState().project?.tracks[0]?.clips[0];
		expect(clip?.speed).toBe(2);
		expect(clip?.maintainPitch).toBe(true);

		// reverseClips
		expect(store.getState().reverseClips([solidId])).toBe(true);
		clip = store.getState().project?.tracks[0]?.clips[0];
		expect(clip?.speed).toBe(-2);
		expect(clip?.sourceIn).toBeGreaterThan(clip?.sourceOut ?? 0);

		// enableTimeRemap / disableTimeRemap
		expect(store.getState().enableTimeRemap(solidId)).toBe(true);
		clip = store.getState().project?.tracks[0]?.clips[0];
		expect(clip?.timeRemap).toBeTruthy();

		expect(store.getState().disableTimeRemap(solidId, 'average')).toBe(true);
		clip = store.getState().project?.tracks[0]?.clips[0];
		expect(clip?.timeRemap).toBeUndefined();

		// addFreezeFrame
		store.getState().setPlayhead(1_000_000);
		expect(store.getState().addFreezeFrame(solidId)).toBe(true);
		const clips = store.getState().project?.tracks[0]?.clips ?? [];
		expect(clips.length).toBe(3);
		expect(clips[1]?.timeRemap).toEqual({ value: 0 });

		// undo restores state
		expect(store.getState().undo()).toBe(true);
		expect(store.getState().project?.tracks[0]?.clips.length).toBe(1);
	});

	it('adds text, caption, solid, adjustment, and graphic layers in new tracks when clips already exist in existing tracks', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Layers In New Track Test' });

		// 1. Existing initial track gets a base clip
		const initialTrack = store.getState().project!.tracks.find((t) => t.kind === 'video')!;
		const baseSolidId = store.getState().addSolidLayer('#333333', initialTrack.id, 0, 10_000_000);
		expect(baseSolidId).toBeTruthy();
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(1);

		// 2. Add Text Layer - since base track already has a clip, it MUST be added in a new track!
		store.getState().setPlayhead(1_000_000);
		const textClipId = store.getState().addTextClip({ text: 'Overlay Title' });
		expect(textClipId).toBeTruthy();
		const videoTracksAfterText = store.getState().project!.tracks.filter((t) => t.kind === 'video');
		expect(videoTracksAfterText.length).toBe(2);
		const textTrack = videoTracksAfterText.find((t) => t.clips.some((c) => c.id === textClipId));
		expect(textTrack).toBeDefined();
		expect(textTrack!.id).not.toBe(initialTrack.id);

		// 3. Add Adjustment Layer - since existing video tracks already have clips, it MUST be added in a new track!
		const adjClipId = store.getState().addAdjustmentLayer();
		expect(adjClipId).toBeTruthy();
		const videoTracksAfterAdj = store.getState().project!.tracks.filter((t) => t.kind === 'video');
		expect(videoTracksAfterAdj.length).toBe(3);
		const adjTrack = videoTracksAfterAdj.find((t) => t.clips.some((c) => c.id === adjClipId));
		expect(adjTrack).toBeDefined();
		expect(adjTrack!.id).not.toBe(initialTrack.id);
		expect(adjTrack!.id).not.toBe(textTrack!.id);

		// 4. Add Solid Layer - since existing video tracks already have clips, it MUST be added in a new track!
		const solidClipId = store.getState().addSolidLayer('#ff5500');
		expect(solidClipId).toBeTruthy();
		const videoTracksAfterSolid = store
			.getState()
			.project!.tracks.filter((t) => t.kind === 'video');
		expect(videoTracksAfterSolid.length).toBe(4);
		const solidTrack = videoTracksAfterSolid.find((t) => t.clips.some((c) => c.id === solidClipId));
		expect(solidTrack).toBeDefined();

		// 5. Add Graphic Template Layer - since existing video tracks already have clips, it MUST be added in a new track!
		const graphicClipId = store.getState().addGraphicClip('modern-clean');
		expect(graphicClipId).toBeTruthy();
		const videoTracksAfterGraphic = store
			.getState()
			.project!.tracks.filter((t) => t.kind === 'video');
		expect(videoTracksAfterGraphic.length).toBe(5);
		const graphicTrack = videoTracksAfterGraphic.find((t) =>
			t.clips.some((c) => c.id === graphicClipId)
		);
		expect(graphicTrack).toBeDefined();

		// 6. Add Caption Layer - creates first caption track
		const firstCapId = store.getState().addCaptionAtPlayhead('Caption 1');
		expect(firstCapId).toBeTruthy();
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'caption').length).toBe(1);

		// 7. Add Caption Layer again while playhead is at 1s (overlapping with Caption 1) - MUST create a new track!
		const secondCapId = store.getState().addCaptionAtPlayhead('Caption 2');
		expect(secondCapId).toBeTruthy();
		const captionTracks = store.getState().project!.tracks.filter((t) => t.kind === 'caption');
		expect(captionTracks.length).toBe(2);
		expect(
			captionTracks[0]!.captions?.some((c) => c.id === secondCapId) ||
				captionTracks[1]!.captions?.some((c) => c.id === secondCapId)
		).toBe(true);
		expect(captionTracks[0]!.id).not.toBe(captionTracks[1]!.id);

		// 8. ONLY add track if there is another clip in that range:
		// When playhead is at 20s (no clips in range 20s-25s), adding text MUST NOT add a new track!
		store.getState().setPlayhead(20_000_000);
		const nonOverlapTextId = store.getState().addTextClip({ text: 'Non Overlapping' });
		expect(nonOverlapTextId).toBeTruthy();
		const videoTracksAfterNonOverlap = store
			.getState()
			.project!.tracks.filter((t) => t.kind === 'video');
		expect(videoTracksAfterNonOverlap.length).toBe(5); // Still 5 tracks, no unnecessary track added!

		// When playhead is at 10s (no caption cues in range 10s-12s), adding caption MUST NOT add a new caption track!
		store.getState().setPlayhead(10_000_000);
		const nonOverlapCapId = store.getState().addCaptionAtPlayhead('Caption 3');
		expect(nonOverlapCapId).toBeTruthy();
		const captionTracksAfterNonOverlap = store
			.getState()
			.project!.tracks.filter((t) => t.kind === 'caption');
		expect(captionTracksAfterNonOverlap.length).toBe(2); // Still 2 caption tracks!
	});

	it('reuses existing higher video tracks when adding text/solid/adjustment at spaced playhead positions', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Sequential Layers Test' });
		const initialTrack = store.getState().project!.tracks.find((t) => t.kind === 'video')!;
		// Base track has clips spanning 0 to 60s
		store.getState().addSolidLayer('#111111', initialTrack.id, 0, 60_000_000);

		// At 2s, add text -> Video 2 should be created (1 clip on Video 2: 2s-7s)
		store.getState().setPlayhead(2_000_000);
		const text1 = store.getState().addTextClip({ text: 'Text 1' });
		expect(text1).toBeTruthy();
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(2);

		// At 9s, add text -> Video 2 is free in 9s-14s! MUST REUSE Video 2, NOT create Video 3!
		store.getState().setPlayhead(9_000_000);
		const text2 = store.getState().addTextClip({ text: 'Text 2' });
		expect(text2).toBeTruthy();
		console.log(
			'Video tracks count after 9s text:',
			store.getState().project!.tracks.filter((t) => t.kind === 'video').length
		);
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(2);

		// At 15s, add text -> Video 2 is free in 15s-20s!
		store.getState().setPlayhead(15_433_333);
		const text3 = store.getState().addTextClip({ text: 'Text 3' });
		expect(text3).toBeTruthy();
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(2);

		// Now add a 3rd video track with a clip at 22s-27s
		store.getState().addTimelineTrack('video');
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(3);
		const v3 = store.getState().project!.tracks.find((t) => t.kind === 'video')!;
		store.getState().addSolidLayer('#00ffff', v3.id, 22_000_000, 5_000_000);

		// Now we have:
		// Video 1 (base): 0 - 60s
		// Video 2: 2-7s, 9-14s, 15.43-20.43s
		// Video 3: 22-27s
		// At 35s, both Video 2 and Video 3 have free space!
		// Adding text at 35s MUST reuse an existing free track, NOT create Video 4!
		store.getState().setPlayhead(35_000_000);
		const text4 = store.getState().addTextClip({ text: 'Text 4' });
		expect(text4).toBeTruthy();
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(3);

		// Adding solid at 45s MUST reuse an existing free track, NOT create Video 4!
		store.getState().setPlayhead(45_000_000);
		const solid1 = store.getState().addSolidLayer('#00ff00');
		expect(solid1).toBeTruthy();
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(3);

		// Adding adjustment layer at 50s MUST reuse an existing free track, NOT create Video 4!
		store.getState().setPlayhead(50_000_000);
		const adj1 = store.getState().addAdjustmentLayer();
		expect(adj1).toBeTruthy();
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(3);

		// Explicit selection of Track 3 directs new layer to Track 3 if free in range:
		store.getState().selectTrack(v3.id);
		store.getState().setPlayhead(55_000_000);
		const textOnV3 = store.getState().addTextClip({ text: 'Directed to V3' });
		expect(textOnV3).toBeTruthy();
		expect(store.getState().project!.tracks.filter((t) => t.kind === 'video').length).toBe(3);
		const v3Track = store.getState().project!.tracks.find((t) => t.id === v3.id)!;
		expect(v3Track.clips.some((c) => c.id === textOnV3)).toBe(true);
	});

	it('setActiveTimelineTool("type") adds text layer and preserves selection/pointer tool', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Text tool test' });
		expect(store.getState().timeline.activeTool).toBe('select');

		store.getState().setActiveTimelineTool('type');

		// A text clip should be added
		const videoTracks = store.getState().project!.tracks.filter((t) => t.kind === 'video');
		const allClips = videoTracks.flatMap((t) => t.clips);
		expect(allClips.some((c) => c.source?.type === 'text')).toBe(true);

		// Active tool must remain 'select' (pointer tool), not 'type'
		expect(store.getState().timeline.activeTool).toBe('select');
	});

	it('manages export complete dialog lifecycle and resets export flags', () => {
		const store = createEditorStore();
		store.getState().openExportDialog();
		store.getState().setExporting(true);
		expect(store.getState().isExportDialogOpen).toBe(true);
		expect(store.getState().isExporting).toBe(true);
		expect(store.getState().exportCompletedResult).toBeNull();

		store.getState().openExportCompleteDialog({
			filename: 'render.mp4',
			format: 'MP4',
			width: 1920,
			height: 1080,
			fps: 30,
			durationSec: 10,
			fileSizeBytes: 5242880
		});

		expect(store.getState().isExportDialogOpen).toBe(false);
		expect(store.getState().isExporting).toBe(false);
		expect(store.getState().exportCompletedResult).toEqual({
			filename: 'render.mp4',
			format: 'MP4',
			width: 1920,
			height: 1080,
			fps: 30,
			durationSec: 10,
			fileSizeBytes: 5242880
		});

		store.getState().closeExportCompleteDialog();
		expect(store.getState().exportCompletedResult).toBeNull();
	});

	it('updates solid and text gradients via setSolidGradient and setTextGradient', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Gradient Store Test' });

		const solidId = store.getState().addSolidLayer('#3b82f6')!;
		expect(solidId).toBeTruthy();

		const solidUpdated = store.getState().setSolidGradient(solidId, {
			gradientType: 'linear-vertical',
			gradientColorEnd: { r: 1, g: 0.8, b: 0.2, a: 1 },
			gradientAngle: 90
		});
		expect(solidUpdated).toBe(true);

		const solidClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === solidId);
		expect(solidClip?.source?.type).toBe('solid');
		if (solidClip?.source?.type === 'solid') {
			expect(solidClip.source.gradientType).toBe('linear-vertical');
			expect(solidClip.source.gradientColorEnd).toEqual({ r: 1, g: 0.8, b: 0.2, a: 1 });
			expect(solidClip.source.gradientAngle).toBe(90);
		}

		// Add a graphic or text clip and set gradient
		const graphicId = store.getState().addGraphicClip('minimal-clean');
		expect(graphicId).toBeTruthy();

		const textUpdated = store.getState().setTextGradient(graphicId!, {
			gradientType: 'linear-angle',
			gradientColorEnd: { r: 0.9, g: 0.1, b: 0.5, a: 1 },
			gradientAngle: 45
		});
		expect(textUpdated).toBe(true);

		const textClip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === graphicId);
		expect(textClip?.source?.type).toBe('text');
		if (textClip?.source?.type === 'text') {
			expect(textClip.source.box?.gradientType).toBe('linear-angle');
			expect(textClip.source.box?.gradientColorEnd).toEqual({ r: 0.9, g: 0.1, b: 0.5, a: 1 });
			expect(textClip.source.box?.gradientAngle).toBe(45);
		}
	});

	it('addKeyframeAtTime on a static property starts an animation instead of rewriting the value', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Static Keyframe Test' });
		const solidId = store.getState().addSolidLayer('#ffffff')!;
		const find = () =>
			store
				.getState()
				.project?.tracks.flatMap((t) => t.clips)
				.find((c) => c.id === solidId);
		expect(isAnimated(propertyCurve(find()!, 'opacity') ?? { value: 1 })).toBe(false);

		store.getState().addKeyframeAtTime(solidId, 'opacity', 1_000_000, 0.4);

		const curve = propertyCurve(find()!, 'opacity');
		expect(curve && isAnimated(curve)).toBe(true);
		const keys = curve && isAnimated(curve) ? curve.keyframes : [];
		expect(keys.map((key) => [key.time, key.value])).toEqual([[1_000_000, 0.4]]);
		expect(store.getState().keyframes.selection).toEqual([
			{ clipId: solidId, propertyId: 'opacity', time: 1_000_000 }
		]);
	});

	it('supports GraphEditor keyframe manipulations: addKeyframeAtTime, setKeyframeValue, and setBezierHandles', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Keyframe Graph Test' });

		const solidId = store.getState().addSolidLayer('#ffffff')!;
		expect(solidId).toBeTruthy();

		// Enable animation on opacity
		store.getState().enableAnimation(solidId, 'opacity');

		// Add a keyframe at 1 second (1_000_000 ticks) with value 0.4
		store.getState().addKeyframeAtTime(solidId, 'opacity', 1_000_000, 0.4);

		let clip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === solidId);
		let curve = clip?.properties?.opacity as any;
		expect(curve?.keyframes).toHaveLength(2);
		expect(curve?.keyframes[1].value).toBe(0.4);

		// Adjust the keyframe value via setKeyframeValue
		store.getState().setKeyframeValue(solidId, 'opacity', 1_000_000, 0.85);
		clip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === solidId);
		curve = clip?.properties?.opacity as any;
		expect(curve?.keyframes[1].value).toBe(0.85);

		// Adjust bezier handles
		store.getState().setBezierHandles(solidId, 'opacity', 1_000_000, {
			easeIn: { x: 0.4, y: 0.8 },
			easeOut: { x: 0.6, y: 0.2 }
		});
		clip = store
			.getState()
			.project?.tracks.flatMap((t) => t.clips)
			.find((c) => c.id === solidId);
		curve = clip?.properties?.opacity as any;
		expect(curve?.keyframes[1].interpolation).toBe('bezier');
		expect(curve?.keyframes[1].easeIn).toEqual({ x: 0.4, y: 0.8 });
		expect(curve?.keyframes[1].easeOut).toEqual({ x: 0.6, y: 0.2 });
	});

	it('coalesces multi-property resize drags and reverts them in a single undo', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Gizmo Coalesce Test' });

		const textClipId = store.getState().addTextClip({ text: 'Resize Me' })!;
		expect(textClipId).toBeTruthy();

		const getClip = () =>
			store
				.getState()
				.project?.tracks.flatMap((t) => t.clips)
				.find((c) => c.id === textClipId);

		const initialScale = readProperty(getClip()!, 'scale', 0);
		const initialPos = readProperty(getClip()!, 'position', 0);
		expect(initialScale).toEqual([1, 1]);
		expect(initialPos).toEqual([0, 0]);

		const historySizeBeforeDrag = store.getState().history.size;

		// Simulate gizmo drag updates: 10 pointer move updates with combined scale and position
		const sessionId = 'test-drag-session-1';
		for (let i = 1; i <= 10; i++) {
			store.getState().setProperties(
				textClipId,
				[
					{ propertyId: 'scale', value: [1 + i * 0.1, 1 + i * 0.1] },
					{ propertyId: 'position', value: [i * 5, i * 2] }
				],
				{
					coalesce: true,
					mergeKey: `gizmo-drag:${textClipId}:${sessionId}`,
					coalesceWindowMs: 3600000
				}
			);
		}

		// Only 1 history entry should have been recorded for the entire drag sequence
		expect(store.getState().history.size).toBe(historySizeBeforeDrag + 1);

		// Verify final drag state
		expect(readProperty(getClip()!, 'scale', 0)).toEqual([2, 2]);
		expect(readProperty(getClip()!, 'position', 0)).toEqual([50, 20]);

		// Single undo should revert the entire drag sequence back to initial values!
		expect(store.getState().undo()).toBe(true);
		expect(store.getState().history.size).toBe(historySizeBeforeDrag);
		expect(readProperty(getClip()!, 'scale', 0)).toEqual(initialScale);
		expect(readProperty(getClip()!, 'position', 0)).toEqual(initialPos);

		// Redo should restore to the final drag state in a single step
		expect(store.getState().redo()).toBe(true);
		expect(store.getState().history.size).toBe(historySizeBeforeDrag + 1);
		expect(readProperty(getClip()!, 'scale', 0)).toEqual([2, 2]);
		expect(readProperty(getClip()!, 'position', 0)).toEqual([50, 20]);
	});

	describe('template drag-and-drop', () => {
		function dragTemplate(
			store: ReturnType<typeof createEditorStore>,
			template: MotionGraphicTemplate,
			time: number,
			trackId?: TrackId
		): boolean {
			store.getState().beginTimelineDrag({
				kind: 'graphic-template',
				clipIds: [],
				original: [],
				preview: [],
				pointerStartTime: 0,
				pointerTime: time,
				graphicTemplateId: template.id,
				motionTemplate: template,
				allowed: true,
				unlink: false
			});
			store.getState().updateTimelineDrag(time, { targetTrackId: trackId });
			return store.getState().commitTimelineDrag();
		}

		function instanceClips(store: ReturnType<typeof createEditorStore>) {
			return store
				.getState()
				.project!.tracks.flatMap((track) => track.clips)
				.filter((clip) => clip.source?.type === 'sequence');
		}

		function firstVideoTrackId(store: ReturnType<typeof createEditorStore>): TrackId {
			return store.getState().project!.tracks.find((track) => track.kind === 'video')!.id;
		}

		it('drops a nested template instance with the template duration, not a flat 5 s text clip', async () => {
			const store = createEditorStore();
			await store.getState().createProject({ name: 'Template drop' });
			const template: MotionGraphicTemplate = {
				...getBuiltinMotionTemplate('cinematic-blockbuster')!,
				duration: 5_900_000
			};

			expect(dragTemplate(store, template, 1_000_000, firstVideoTrackId(store))).toBe(true);

			const [clip] = instanceClips(store);
			expect(clip?.duration).toBe(5_900_000);
			expect(clip?.source).toMatchObject({ type: 'sequence', templateId: 'cinematic-blockbuster' });
			expect(store.getState().project!.tracks.flatMap((track) => track.clips)).toHaveLength(1);
		});

		it('drops a custom template as itself instead of falling back to the first built-in', async () => {
			const store = createEditorStore();
			await store.getState().createProject({ name: 'Custom drop' });
			const template: MotionGraphicTemplate = {
				...getBuiltinMotionTemplate('cinematic-blockbuster')!,
				id: 'my-custom-template',
				name: 'My Custom Template'
			};

			expect(dragTemplate(store, template, 0, firstVideoTrackId(store))).toBe(true);

			const [clip] = instanceClips(store);
			expect(clip?.source).toMatchObject({
				type: 'sequence',
				templateId: 'my-custom-template',
				templateName: 'My Custom Template'
			});
		});

		it('produces the same clip structure as the "+ Add" path', async () => {
			const template = getBuiltinMotionTemplate('cinematic-blockbuster')!;
			const dragged = createEditorStore();
			await dragged.getState().createProject({ name: 'Dragged' });
			dragTemplate(dragged, template, 2_000_000, firstVideoTrackId(dragged));

			const added = createEditorStore();
			await added.getState().createProject({ name: 'Added' });
			added.getState().instantiateTemplate(template, 2_000_000, firstVideoTrackId(added));

			const strip = (store: ReturnType<typeof createEditorStore>) => {
				const [clip] = instanceClips(store);
				const sequenceId = (clip!.source as { sequenceId: string }).sequenceId;
				const sequence = store.getState().project!.sequences![sequenceId as SequenceId]!;
				return {
					start: clip!.start,
					duration: clip!.duration,
					transform: clip!.transform,
					source: { ...clip!.source, sequenceId: undefined, publishedParams: undefined },
					params: (clip!.source as { publishedParams: unknown[] }).publishedParams.length,
					tracks: sequence.tracks.map((track) => ({
						kind: track.kind,
						clips: track.clips.map((inner) => ({
							start: inner.start,
							duration: inner.duration,
							source: inner.source?.type
						}))
					}))
				};
			};
			expect(strip(dragged)).toEqual(strip(added));
		});

		it('never overlaps an occupied track when dropping or adding a template', async () => {
			const store = createEditorStore();
			await store.getState().createProject({ name: 'Occupied track' });
			const template = getBuiltinMotionTemplate('cinematic-blockbuster')!;
			const trackId = firstVideoTrackId(store);

			expect(dragTemplate(store, template, 0, trackId)).toBe(true);
			expect(dragTemplate(store, template, 1_000_000, trackId)).toBe(true);
			store.getState().instantiateTemplate(template, 2_000_000, trackId);

			for (const track of store.getState().project!.tracks) {
				const clips = [...track.clips].sort((a, b) => a.start - b.start);
				for (let index = 1; index < clips.length; index += 1) {
					expect(clips[index]!.start).toBeGreaterThanOrEqual(
						clips[index - 1]!.start + clips[index - 1]!.duration
					);
				}
			}
			expect(instanceClips(store)).toHaveLength(3);
		});

		it('records one undo entry for a template drop', async () => {
			const store = createEditorStore();
			await store.getState().createProject({ name: 'Undo drop' });
			const before = store.getState().history.size;

			dragTemplate(
				store,
				getBuiltinMotionTemplate('cinematic-blockbuster')!,
				0,
				firstVideoTrackId(store)
			);

			expect(store.getState().history.size).toBe(before + 1);
			expect(store.getState().undo()).toBe(true);
			expect(instanceClips(store)).toHaveLength(0);
		});
	});

	describe('editing a shape that has keyframes', () => {
		async function shapeStore() {
			const store = createEditorStore();
			await store.getState().createProject({ name: 'Shape keys' });
			const clipId = store.getState().addShapeClip({ cornerRadius: 10 })!;
			return { store, clipId };
		}
		const shapeClip = (store: ReturnType<typeof createEditorStore>, clipId: ClipId) =>
			store
				.getState()
				.project!.tracks.flatMap((track) => track.clips)
				.find((clip) => clip.id === clipId)!;

		it('keeps an animated property animated when the Shape panel changes it', async () => {
			const { store, clipId } = await shapeStore();
			store.getState().enableAnimation(clipId, 'shape.cornerRadius');

			store.getState().updateShapeProperties(clipId, { cornerRadius: 40 });

			const clip = shapeClip(store, clipId);
			const curve = propertyCurve(clip, 'shape.cornerRadius');
			expect(curve && isAnimated(curve)).toBe(true);
			expect(readProperty(clip, 'shape.cornerRadius', 0)).toBe(40);
		});

		it('still stores a plain property as a constant', async () => {
			const { store, clipId } = await shapeStore();

			store.getState().updateShapeProperties(clipId, { cornerRadius: 40 });

			const curve = propertyCurve(shapeClip(store, clipId), 'shape.cornerRadius');
			expect(curve && isAnimated(curve)).toBe(false);
			expect(readProperty(shapeClip(store, clipId), 'shape.cornerRadius', 0)).toBe(40);
		});
	});
});
