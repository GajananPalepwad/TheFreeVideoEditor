import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../core';
import { BUILTIN_MOTION_TEMPLATES } from '../core/templates/builtinTemplates';
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

/** Replaces every generated id with a number in order of first appearance, so two runs compare. */
function withoutIds(value: unknown): unknown {
	const seen = new Map<string, string>();
	const idKeys = new Set(['id', 'sequenceId', 'trackId', 'clipId', 'targetClipId']);
	const walk = (node: unknown, key?: string): unknown => {
		if (typeof node === 'string' && key && idKeys.has(key)) {
			if (!seen.has(node)) seen.set(node, `#${seen.size}`);
			return seen.get(node);
		}
		if (Array.isArray(node)) return node.map((item) => walk(item));
		if (node && typeof node === 'object') {
			return Object.fromEntries(
				Object.entries(node).map(([entryKey, entry]) => [entryKey, walk(entry, entryKey)])
			);
		}
		return node;
	};
	return walk(value);
}

/** The root timeline and every template sequence, with ids and the instance's start removed. */
function placed(store: Store): unknown {
	const project = store.getState().project!;
	const tracks = project.tracks.map((track) => ({
		...track,
		clips: track.clips.map((clip) => ({ ...clip, start: 0 }))
	}));
	return withoutIds({ tracks, sequences: Object.values(project.sequences ?? {}) });
}

function expectNoOverlap(tracks: Track[], where: string): void {
	for (const track of tracks) {
		const clips = [...track.clips].sort((a, b) => a.start - b.start);
		for (let index = 1; index < clips.length; index += 1) {
			expect(clips[index]!.start, where).toBeGreaterThanOrEqual(
				clips[index - 1]!.start + clips[index - 1]!.duration
			);
		}
	}
}

async function newStore(): Promise<Store> {
	const store = createEditorStore();
	await store.getState().createProject({ name: 'Placement' });
	return store;
}

describe('placing a template on the timeline', () => {
	beforeEach(() => {
		resetServiceMocks();
	});

	for (const template of BUILTIN_MOTION_TEMPLATES) {
		it(`${template.id}: a drop onto a track builds the same instance as "+ Add" at the playhead`, async () => {
			const dropped = await newStore();
			const trackId = dropped
				.getState()
				.project!.tracks.find((track) => track.kind === 'video')!.id;
			dropped.getState().instantiateTemplate(template, 3_000_000, trackId);

			const added = await newStore();
			added.getState().setPlayhead(3_000_000);
			added.getState().instantiateTemplate(template);

			expect(placed(dropped)).toEqual(placed(added));
			const [clip] = dropped.getState().project!.tracks.flatMap((track) => track.clips);
			expect(clip!.start).toBe(3_000_000);
		});

		it(`${template.id}: repeated drops at one time never overlap on a track`, async () => {
			const store = await newStore();
			const trackId = store.getState().project!.tracks.find((track) => track.kind === 'video')!.id;
			for (let index = 0; index < 3; index += 1) {
				store.getState().instantiateTemplate(template, 1_000_000, trackId);
			}
			const project = store.getState().project!;
			expect(project.tracks.flatMap((track) => track.clips)).toHaveLength(3);
			expectNoOverlap(project.tracks, template.id);
		});
	}
});
