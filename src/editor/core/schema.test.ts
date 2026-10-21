import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { CURRENT_SCHEMA_VERSION, migrate, projectSchema } from './schema';

describe('project schema and migrations', () => {
	it('round-trips a complete default project through the schema', () => {
		const project = createEmptyProject({ name: 'Schema test' });
		expect(projectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
	});

	it('keeps a saved track height when the project is opened again', () => {
		const project = createEmptyProject({ name: 'Track height' });
		project.tracks[0]!.height = 160;
		const reopened = migrate(JSON.parse(JSON.stringify(project)));
		expect(reopened.tracks[0]?.height).toBe(160);
		expect(reopened.tracks[1]?.height).toBeUndefined();
	});

	it('returns the current version project unchanged', () => {
		const project = createEmptyProject({ name: 'Migration test' });
		expect(migrate(project)).toEqual(project);
		expect(project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('accepts Gate C clip records without an optional link id', () => {
		const project = createEmptyProject({ name: 'Gate C compatibility' });
		const assetId = 'gate-c-asset' as keyof typeof project.assets;
		project.assets[assetId] = {
			id: assetId,
			kind: 'audio',
			name: 'tone.wav',
			mimeType: 'audio/wav',
			size: 1,
			duration: 1_000_000,
			hasAudio: true,
			opfsPath: `projects/${project.id}/media/${assetId}.wav`
		};
		project.tracks[1]?.clips.push({
			id: 'gate-c-clip' as (typeof project.tracks)[number]['clips'][number]['id'],
			assetId,
			start: 0,
			duration: 1_000_000,
			sourceIn: 0,
			sourceOut: 1_000_000,
			speed: 1,
			volume: 1
		});
		expect(projectSchema.parse(JSON.parse(JSON.stringify(project)))).toEqual(project);
	});

	it('explains when the project was made by a newer editor', () => {
		const project = { ...createEmptyProject({ name: 'Future' }), schemaVersion: 3 };
		expect(() => migrate(project)).toThrow(/newer than this editor supports/);
	});

	it('rejects invalid model data', () => {
		const project = { ...createEmptyProject({ name: 'Invalid' }), settings: { width: 0 } };
		expect(projectSchema.safeParse(project).success).toBe(false);
	});

	it('rejects duplicate entity ids and clips with missing assets', () => {
		const project = createEmptyProject({ name: 'Invalid relationships' });
		project.tracks[1].id = project.tracks[0].id;
		expect(projectSchema.safeParse(project).success).toBe(false);

		const danglingClip = createEmptyProject({ name: 'Dangling asset' });
		danglingClip.tracks[0].clips.push({
			id: 'clip-id' as (typeof danglingClip.tracks)[0]['clips'][number]['id'],
			assetId: 'missing-asset' as keyof typeof danglingClip.assets,
			start: 0,
			duration: 100,
			sourceIn: 0,
			sourceOut: 100,
			speed: 1,
			volume: 1
		});
		expect(projectSchema.safeParse(danglingClip).success).toBe(false);
	});

	it('relaxes sourceOut > sourceIn only when timeRemap is present (Gate M)', () => {
		const project = createEmptyProject({ name: 'Time remap schema test' });
		const assetId = 'test-asset' as keyof typeof project.assets;
		project.assets[assetId] = {
			id: assetId,
			kind: 'video',
			name: 'clip.mp4',
			mimeType: 'video/mp4',
			size: 1000,
			duration: 10_000_000,
			hasAudio: true,
			opfsPath: `projects/${project.id}/media/${assetId}.mp4`
		};

		// Clip without timeRemap where sourceOut <= sourceIn must fail validation
		project.tracks[0]!.clips.push({
			id: 'clip-reversed-no-remap' as (typeof project.tracks)[0]['clips'][number]['id'],
			assetId,
			start: 0,
			duration: 2_000_000,
			sourceIn: 4_000_000,
			sourceOut: 2_000_000,
			speed: 1,
			volume: 1
		});
		expect(projectSchema.safeParse(project).success).toBe(false);

		// With timeRemap, sourceOut <= sourceIn (e.g. reverse or freeze) is accepted
		project.tracks[0]!.clips[0]!.timeRemap = { value: -1 };
		expect(projectSchema.safeParse(project).success).toBe(true);

		// Freeze frame where sourceOut == sourceIn is also accepted with timeRemap
		project.tracks[0]!.clips[0]!.sourceOut = 4_000_000;
		project.tracks[0]!.clips[0]!.timeRemap = { value: 0 };
		expect(projectSchema.safeParse(project).success).toBe(true);
	});
});
