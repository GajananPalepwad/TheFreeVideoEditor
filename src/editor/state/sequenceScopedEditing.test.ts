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
