import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAnimated, propertyCurve, readProperty } from '../core';
import type { Clip, PropertyId, SequenceId, Time } from '../core';
import { getBuiltinMotionTemplate } from '../core/templates/builtinTemplates';
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
	CorruptProjectError: class CorruptProjectError extends Error {},
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

type Store = ReturnType<typeof createEditorStore>;

function resetServiceMocks(): void {
	vi.clearAllMocks();
	services.getProject.mockResolvedValue(null);
	services.listProjects.mockResolvedValue([]);
	services.saveProject.mockResolvedValue(undefined);
	services.setLastOpenedId.mockResolvedValue(undefined);
	services.getLastOpenedId.mockResolvedValue(null);
	services.ensureProjectDir.mockResolvedValue(null);
	services.reconcileProjectMedia.mockImplementation(async (project) => ({
		assets: project.assets,
		unknownFiles: [],
		changed: false
	}));
}

/** A store with a template instance on the root timeline and its sequence opened for editing. */
async function openTemplate(): Promise<{ store: Store; sequenceId: SequenceId }> {
	const store = createEditorStore();
	await store.getState().createProject({ name: 'Inside a template' });
	store.getState().instantiateTemplate(getBuiltinMotionTemplate('cinematic-blockbuster')!, 0);
	const [instance] = store.getState().project!.tracks.flatMap((track) => track.clips);
	const sequenceId = (instance!.source as { sequenceId: SequenceId }).sequenceId;
	store.getState().openSequence(sequenceId);
	return { store, sequenceId };
}

/** The nested clips, read fresh from the store. */
function innerClips(store: Store, sequenceId: SequenceId): Clip[] {
	return store.getState().project!.sequences![sequenceId]!.tracks.flatMap((track) => track.clips);
}

/** The template's text layer. It has no rotation keyframes, so tests start from a static property. */
function innerClip(store: Store, sequenceId: SequenceId): Clip {
	return innerClips(store, sequenceId).find((clip) => clip.source?.type === 'text')!;
}

function shapeClip(store: Store, sequenceId: SequenceId): Clip {
	return innerClips(store, sequenceId).find((clip) => clip.source?.type === 'shape')!;
}

function rootClips(store: Store): Clip[] {
	return store.getState().project!.tracks.flatMap((track) => track.clips);
}

/** Puts a keyframe on `propertyId` at clip-local `time` through the toggle action. */
function keyAt(store: Store, clip: Clip, propertyId: PropertyId, time: Time): void {
	store.getState().setPlayhead(clip.start + time);
	store.getState().toggleKeyframe(clip.id, propertyId);
}

function keyframeTimes(clip: Clip, propertyId: PropertyId): Time[] {
	const curve = propertyCurve(clip, propertyId);
	return curve && isAnimated(curve) ? curve.keyframes.map((k) => k.time) : [];
}

describe('keyframe and property edits inside a template sequence', () => {
	beforeEach(() => {
		resetServiceMocks();
	});

	it('setProperties edits the nested clip and leaves the root untouched', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		const rootBefore = rootClips(store);

		store.getState().setProperties(target.id, [{ propertyId: 'rotation', value: 30 }], {
			autoKey: false
		});

		expect(readProperty(innerClip(store, sequenceId), 'rotation', 0)).toBe(30);
		expect(rootClips(store)).toEqual(rootBefore);
	});

	it('setProperties is one undo entry', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);

		// Scale is already animated in the template, so this also writes a keyframe.
		store.getState().setProperties(target.id, [
			{ propertyId: 'rotation', value: 30 },
			{ propertyId: 'scale', value: [2, 2] }
		]);
		expect(readProperty(innerClip(store, sequenceId), 'rotation', 0)).toBe(30);
		expect(store.getState().undo()).toBe(true);

		expect(innerClip(store, sequenceId)).toEqual(target);
	});

	it('enableAnimation adds a keyframe to the nested clip and selects it', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);

		store.getState().enableAnimation(target.id, 'rotation');

		expect(keyframeTimes(innerClip(store, sequenceId), 'rotation').length).toBeGreaterThan(0);
		expect(store.getState().keyframes.selection).toHaveLength(1);
	});

	it('toggleKeyframe adds and removes a keyframe on the nested clip', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);

		store.getState().toggleKeyframe(target.id, 'rotation');
		const added = keyframeTimes(innerClip(store, sequenceId), 'rotation').length;
		store.getState().toggleKeyframe(target.id, 'rotation');

		expect(added).toBeGreaterThan(0);
		expect(keyframeTimes(innerClip(store, sequenceId), 'rotation').length).toBeLessThan(added);
	});

	it('addKeyframeAtTime adds a keyframe at that time on the nested clip', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		keyAt(store, target, 'rotation', 0);

		store.getState().addKeyframeAtTime(target.id, 'rotation', 400_000, 15);

		expect(keyframeTimes(innerClip(store, sequenceId), 'rotation')).toContain(400_000);
	});

	it('setKeyframeValue, interpolation and bezier handles edit the nested keyframe', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		keyAt(store, target, 'rotation', 0);
		keyAt(store, target, 'rotation', 500_000);

		store.getState().setKeyframeValue(target.id, 'rotation', 500_000, 0.4);
		const keyframeAt = (time: Time) => {
			const curve = propertyCurve(innerClip(store, sequenceId), 'rotation');
			return curve && isAnimated(curve) ? curve.keyframes.find((k) => k.time === time) : undefined;
		};
		expect(keyframeAt(500_000)?.value).toBe(0.4);

		store.getState().setKeyframeInterpolation('linear');
		expect(keyframeAt(500_000)?.interpolation).toBe('linear');

		store.getState().setBezierHandles(target.id, 'rotation', 500_000, {
			easeOut: { x: 0.3, y: 0.1 },
			easeIn: { x: 0.6, y: 0.9 }
		});
		expect(keyframeAt(500_000)?.interpolation).toBe('bezier');
	});

	it('moveSelectedKeyframes and deleteSelectedKeyframes work on nested keyframes', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		keyAt(store, target, 'rotation', 0);
		keyAt(store, target, 'rotation', 500_000);
		store.getState().addKeyframeAtTime(target.id, 'rotation', 500_000, 10);

		store.getState().moveSelectedKeyframes(100_000);
		expect(keyframeTimes(innerClip(store, sequenceId), 'rotation')).toContain(600_000);

		store.getState().deleteSelectedKeyframes();
		expect(keyframeTimes(innerClip(store, sequenceId), 'rotation')).not.toContain(600_000);
	});

	it('copy and paste keyframes work between nested clips', async () => {
		const { store, sequenceId } = await openTemplate();
		const source = innerClip(store, sequenceId);
		const destination = shapeClip(store, sequenceId);
		keyAt(store, source, 'rotation', 0);
		keyAt(store, source, 'rotation', 300_000);
		store.getState().addKeyframeAtTime(source.id, 'rotation', 300_000, 5);
		store.getState().copySelectedKeyframes();
		expect(store.getState().keyframes.clipboard?.entries.length).toBeGreaterThan(0);

		const before = keyframeTimes(shapeClip(store, sequenceId), 'rotation');
		store.getState().setPlayhead(destination.start + 1_200_000);
		store.getState().pasteKeyframes(destination.id, 'rotation');

		expect(keyframeTimes(shapeClip(store, sequenceId), 'rotation')).not.toEqual(before);
	});

	it('disableAnimation flattens a nested animated property', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		keyAt(store, target, 'rotation', 0);
		keyAt(store, target, 'rotation', 500_000);

		expect(keyframeTimes(innerClip(store, sequenceId), 'rotation')).toHaveLength(2);

		store.getState().disableAnimation(target.id, 'rotation');

		expect(keyframeTimes(innerClip(store, sequenceId), 'rotation')).toEqual([]);
	});

	it('nextKeyframe and prevKeyframe move the playhead across nested keyframes', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		keyAt(store, target, 'rotation', 0);
		keyAt(store, target, 'rotation', 500_000);
		store.getState().selectClips([target.id]);
		store.getState().setPlayhead(target.start);

		store.getState().nextKeyframe();
		expect(store.getState().timeline.playhead).toBe(target.start + 500_000);

		store.getState().prevKeyframe();
		expect(store.getState().timeline.playhead).toBe(target.start);
	});
});

describe('effect edits inside a template sequence', () => {
	beforeEach(() => {
		resetServiceMocks();
	});

	/** Opens a template and puts a mirror effect on its text layer. */
	async function withMirror(): Promise<{ store: Store; sequenceId: SequenceId; target: Clip }> {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		const effect = store.getState().addEffect(target.id, 'mirror');
		expect(effect).not.toBeNull();
		return { store, sequenceId, target };
	}

	it('addEffect adds the effect to the nested clip, selects it and records one undo step', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		const rootBefore = rootClips(store);

		const effect = store.getState().addEffect(target.id, 'gaussianBlur');

		expect(innerClip(store, sequenceId).effects?.map((e) => e.id)).toEqual([effect!.id]);
		expect(store.getState().effectsUi.selectedEffectId).toBe(effect!.id);
		expect(rootClips(store)).toEqual(rootBefore);
		expect(store.getState().undo()).toBe(true);
		expect(innerClip(store, sequenceId).effects ?? []).toEqual([]);
	});

	it('setEffectParam changes a plain parameter of a nested effect', async () => {
		const { store, sequenceId, target } = await withMirror();
		const effect = innerClip(store, sequenceId).effects![0]!;

		store.getState().setEffectParam(target.id, effect.id, 'mode', 'quad');

		expect(innerClip(store, sequenceId).effects![0]!.params.mode).toBe('quad');
	});

	it('toggleEffect, soloEffect and toggleBypassClipEffects reach the nested clip', async () => {
		const { store, sequenceId, target } = await withMirror();
		const effect = innerClip(store, sequenceId).effects![0]!;

		expect(store.getState().toggleEffect(target.id, effect.id, false)).toBe(true);
		expect(innerClip(store, sequenceId).effects![0]!.enabled).toBe(false);
		expect(store.getState().soloEffect(target.id, effect.id)).toBe(true);
		expect(store.getState().toggleBypassClipEffects(target.id, true)).toBe(true);
		expect(innerClip(store, sequenceId).bypassEffects).toBe(true);
	});

	it('duplicateEffect and reorderEffect work on the nested clip', async () => {
		const { store, sequenceId, target } = await withMirror();
		const effect = innerClip(store, sequenceId).effects![0]!;

		const copy = store.getState().duplicateEffect(target.id, effect.id);
		expect(copy).not.toBeNull();
		expect(innerClip(store, sequenceId).effects).toHaveLength(2);
		expect(store.getState().reorderEffect(target.id, copy!.id, 0)).toBe(true);
		expect(innerClip(store, sequenceId).effects![0]!.id).toBe(copy!.id);
	});

	it('resetEffect and removeEffect work on the nested clip', async () => {
		const { store, sequenceId, target } = await withMirror();
		const effect = innerClip(store, sequenceId).effects![0]!;
		store.getState().setEffectParam(target.id, effect.id, 'mode', 'quad');

		expect(store.getState().resetEffect(target.id, effect.id)).toBe(true);
		expect(innerClip(store, sequenceId).effects![0]!.params.mode).toBe('horizontal');
		expect(store.getState().removeEffect(target.id, effect.id)).toBe(true);
		expect(innerClip(store, sequenceId).effects ?? []).toEqual([]);
	});

	it('copyClipEffects and pasteClipEffects copy between nested clips', async () => {
		const { store, sequenceId, target } = await withMirror();
		const other = shapeClip(store, sequenceId);

		store.getState().copyClipEffects(target.id);
		expect(store.getState().effectsClipboard).toHaveLength(1);
		expect(store.getState().pasteClipEffects(other.id)).toBe(true);

		expect(shapeClip(store, sequenceId).effects).toHaveLength(1);
	});

	it('ensureColorCorrection finds the nested clip instead of adding a second effect', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);

		const first = store.getState().ensureColorCorrection(target.id);
		const second = store.getState().ensureColorCorrection(target.id);

		expect(first).not.toBeNull();
		expect(second?.id).toBe(first?.id);
		expect(innerClip(store, sequenceId).effects).toHaveLength(1);
	});
});

describe('mask, fade and audio edits inside a template sequence', () => {
	beforeEach(() => {
		resetServiceMocks();
	});

	it('addMask adds the mask to the nested clip and selects it', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		const rootBefore = rootClips(store);

		const maskId = store.getState().addMask(target.id, 'rect');

		expect(maskId).not.toBeNull();
		expect(innerClip(store, sequenceId).masks?.map((mask) => mask.id)).toEqual([maskId]);
		expect(store.getState().maskTool.selectedMaskId).toBe(maskId);
		expect(rootClips(store)).toEqual(rootBefore);
	});

	it('updateMask, reorderMask and removeMask work on the nested clip', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);
		const first = store.getState().addMask(target.id, 'rect')!;
		const second = store.getState().addMask(target.id, 'ellipse')!;

		expect(store.getState().updateMask(target.id, first, { feather: 12 })).toBe(true);
		expect(innerClip(store, sequenceId).masks![0]!.feather).toBe(12);
		expect(store.getState().reorderMask(target.id, 1, 0)).toBe(true);
		expect(innerClip(store, sequenceId).masks![0]!.id).toBe(second);
		expect(store.getState().removeMask(target.id, second)).toBe(true);
		expect(innerClip(store, sequenceId).masks?.map((mask) => mask.id)).toEqual([first]);
	});

	it('setClipFade changes the fades of the nested clip', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);

		expect(store.getState().setClipFade(target.id, { fadeInUs: 250_000 })).toBe(true);

		expect(innerClip(store, sequenceId).fadeInUs).toBe(250_000);
	});

	it('setClipAudioTag and setClipAudioEffects change the nested clip', async () => {
		const { store, sequenceId } = await openTemplate();
		const target = innerClip(store, sequenceId);

		expect(store.getState().setClipAudioTag(target.id, 'music')).toBe(true);
		expect(store.getState().setClipAudioEffects(target.id, [])).toBe(true);

		expect(innerClip(store, sequenceId).audioTag).toBe('music');
		expect(innerClip(store, sequenceId).audioEffects).toEqual([]);
	});
});
