import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readProperty, resolveFrame } from '../core';
import type { Clip, SequenceId } from '../core';
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

const RED = { r: 1, g: 0, b: 0, a: 1 };
const BLUE = { r: 0, g: 0, b: 1, a: 1 };

async function withSolid(): Promise<{ store: Store; id: Clip['id'] }> {
	const store = createEditorStore();
	await store.getState().createProject({ name: 'Gradient stops' });
	const id = store.getState().addSolidLayer('#ff0000')!;
	store.getState().setSolidGradient(id, {
		gradientType: 'linear-horizontal',
		gradientColorEnd: BLUE,
		gradientAngle: 0
	});
	return { store, id };
}

function clipOf(store: Store, id: Clip['id']): Clip {
	return store
		.getState()
		.project!.tracks.flatMap((track) => track.clips)
		.find((clip) => clip.id === id)!;
}

const stopsOf = (clip: Clip) => (clip.source as { gradientStops?: unknown[] }).gradientStops;

describe('gradient stop actions', () => {
	beforeEach(() => {
		resetServiceMocks();
	});

	it('adding the first extra stop turns the fill and end colour into a list of three', async () => {
		const { store, id } = await withSolid();

		expect(store.getState().addGradientStop(id)).toBe(true);

		const stops = stopsOf(clipOf(store, id)) as Array<{ offset: number; color: typeof RED }>;
		expect(stops).toHaveLength(3);
		expect(stops[0]).toEqual({ offset: 0, color: RED });
		expect(stops[1]).toEqual({ offset: 1, color: BLUE });
		expect(stops[2]!.offset).toBe(0.5);
		expect(stops[2]!.color.r).toBeCloseTo(0.5, 6);
	});

	it('sets the whole list in one undoable step', async () => {
		const { store, id } = await withSolid();
		store.getState().addGradientStop(id);
		const before = stopsOf(clipOf(store, id));

		const next = [
			{ offset: 0, color: BLUE },
			{ offset: 0.3, color: RED },
			{ offset: 1, color: BLUE }
		];
		expect(store.getState().setGradientStops(id, next)).toBe(true);
		expect(stopsOf(clipOf(store, id))).toEqual(next);

		store.getState().undo();
		expect(stopsOf(clipOf(store, id))).toEqual(before);
	});

	it('refuses a list that is too short, too long or has a position outside 0 to 1', async () => {
		const { store, id } = await withSolid();
		expect(store.getState().setGradientStops(id, [{ offset: 0, color: RED }])).toBe(false);
		expect(
			store.getState().setGradientStops(id, [
				{ offset: 0, color: RED },
				{ offset: 1.5, color: BLUE }
			])
		).toBe(false);
		const many = Array.from({ length: 17 }, (_, index) => ({ offset: index / 16, color: RED }));
		expect(store.getState().setGradientStops(id, many)).toBe(false);
		expect(stopsOf(clipOf(store, id))).toBeUndefined();
	});

	it('removes a stop and keeps what the later stops animate', async () => {
		const { store, id } = await withSolid();
		store.getState().addGradientStop(id);
		store.getState().setPlayhead(0);
		store.getState().toggleKeyframe(id, 'gradient.stop2.offset');

		expect(store.getState().removeGradientStop(id, 1)).toBe(true);

		const clip = clipOf(store, id);
		expect(stopsOf(clip)).toHaveLength(2);
		expect(clip.properties?.['gradient.stop2.offset']).toBeUndefined();
		expect(clip.properties?.['gradient.stop1.offset']).toBeDefined();
	});

	it('does not remove below two stops', async () => {
		const { store, id } = await withSolid();
		store.getState().addGradientStop(id);
		store.getState().removeGradientStop(id, 0);
		expect(store.getState().removeGradientStop(id, 0)).toBe(false);
		expect(stopsOf(clipOf(store, id))).toHaveLength(2);
	});

	it('animates a stop through the normal keyframe actions and draws it', async () => {
		const { store, id } = await withSolid();
		store.getState().addGradientStop(id);
		store.getState().selectClips([id]);
		const start = clipOf(store, id).start;
		store.getState().setPlayhead(start);
		store.getState().toggleKeyframe(id, 'gradient.stop2.offset');
		store.getState().setPlayhead(start + 1_000_000);
		store.getState().toggleKeyframe(id, 'gradient.stop2.offset');
		store.getState().setKeyframeValue(id, 'gradient.stop2.offset', 1_000_000, 0.9);

		const clip = clipOf(store, id);
		expect(readProperty(clip, 'gradient.stop2.offset', 1_000_000)).toBeCloseTo(0.9, 6);
		const frame = resolveFrame(store.getState().project!, start + 1_000_000);
		const offsets = frame.videoLayers[0]!.solidGradientStops!.map((stop) => stop.offset);
		expect(offsets).toEqual([0, 0.9, 1]);
	});

	it('turns a gradient on, changes its type and turns it off, each one undo step', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Type' });
		const id = store.getState().addSolidLayer('#ff0000')!;
		const type = () => (clipOf(store, id).source as { gradientType?: string }).gradientType;

		expect(store.getState().setGradientType(id, 'radial')).toBe(true);
		expect(type()).toBe('radial');
		expect(
			resolveFrame(store.getState().project!, 0).videoLayers[0]!.solidGradientStops
		).toHaveLength(2);

		store.getState().setGradientType(id, 'none');
		expect(
			resolveFrame(store.getState().project!, 0).videoLayers[0]!.solidGradientStops
		).toBeUndefined();

		store.getState().undo();
		expect(type()).toBe('radial');
	});

	it('works on a layer inside a template sequence', async () => {
		const store = createEditorStore();
		await store.getState().createProject({ name: 'Inside' });
		store.getState().instantiateTemplate(getBuiltinMotionTemplate('minimal-editorial')!, 0);
		const [instance] = store.getState().project!.tracks.flatMap((track) => track.clips);
		const sequenceId = (instance!.source as { sequenceId: SequenceId }).sequenceId;
		store.getState().openSequence(sequenceId);
		const sequence = () => store.getState().project!.sequences![sequenceId]!;
		const text = sequence()
			.tracks.flatMap((track) => track.clips)
			.find((clip) => clip.source?.type === 'text')!;
		store.getState().setTextGradient(text.id, { gradientType: 'radial', gradientColorEnd: BLUE });

		expect(store.getState().addGradientStop(text.id)).toBe(true);

		const stops = (
			sequence()
				.tracks.flatMap((track) => track.clips)
				.find((clip) => clip.id === text.id)!.source as { box: { gradientStops: unknown[] } }
		).box.gradientStops;
		expect(stops).toHaveLength(3);
	});
});
