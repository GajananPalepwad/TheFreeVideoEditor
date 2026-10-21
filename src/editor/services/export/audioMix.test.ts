import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../core';
import { audioSchedulesForChunk, decodeAudioAssets } from './audioMix';
import { WorkerAudioMixer } from './workerAudioMix';

describe('export audio mix scheduling', () => {
	it('honors muted tracks, trimmed source time, speed, volume, and chunk boundaries', () => {
		const project = createEmptyProject({ name: 'Audio mix' });
		const track = project.tracks.find((item) => item.kind === 'audio');
		if (!track) throw new Error('Factory did not create an audio track.');
		const assetId = 'tone' as keyof typeof project.assets;
		project.assets[assetId] = {
			id: assetId,
			kind: 'audio',
			name: 'tone.wav',
			mimeType: 'audio/wav',
			size: 5,
			duration: 8_000_000,
			hasAudio: true,
			opfsPath: 'tone.wav'
		};
		track.clips.push({
			id: 'tone-clip' as (typeof track.clips)[number]['id'],
			assetId,
			start: 2_000_000,
			duration: 4_000_000,
			sourceIn: 1_000_000,
			sourceOut: 5_000_000,
			speed: 2,
			volume: 0.5
		});

		expect(audioSchedulesForChunk(project, 0, 3_000_000)).toEqual([
			{
				clipId: 'tone-clip',
				assetId,
				whenSeconds: 2,
				sourceOffsetSeconds: 1,
				sourceDurationSeconds: 2,
				playbackRate: 2,
				volume: 0.5
			}
		]);
		expect(audioSchedulesForChunk(project, 3_000_000, 3_000_000)[0]).toMatchObject({
			whenSeconds: 0,
			sourceOffsetSeconds: 3,
			sourceDurationSeconds: 2
		});
		track.muted = true;
		expect(audioSchedulesForChunk(project, 0, 6_000_000)).toEqual([]);
	});

	it('skips an unsupported audio asset with a visible warning instead of failing export', async () => {
		const project = createEmptyProject({ name: 'Unsupported audio' });
		const track = project.tracks.find((item) => item.kind === 'audio');
		if (!track) throw new Error('Factory did not create an audio track.');
		const assetId = 'unsupported' as keyof typeof project.assets;
		project.assets[assetId] = {
			id: assetId,
			kind: 'audio',
			name: 'unsupported.wav',
			mimeType: 'audio/wav',
			size: 5,
			duration: 1_000_000,
			hasAudio: true,
			audioDecodable: false,
			opfsPath: 'unsupported.wav'
		};
		track.clips.push({
			id: 'unsupported-clip' as (typeof track.clips)[number]['id'],
			assetId,
			start: 0,
			duration: 1_000_000,
			sourceIn: 0,
			sourceOut: 1_000_000,
			speed: 1,
			volume: 1
		});
		const warnings: string[] = [];
		const buffers = await decodeAudioAssets(
			project,
			{
				decodeAudioData: async () => {
					throw new Error('Must not decode unsupported audio.');
				}
			},
			async () => {
				throw new Error('Must not read unsupported audio.');
			},
			(message) => warnings.push(message)
		);

		expect(buffers.size).toBe(0);
		expect(warnings).toEqual([
			'Audio from “unsupported.wav” was skipped: its codec is not decodable.'
		]);
	});

	it('continues worker mixdown with silence and warns when an individual asset cannot be read', async () => {
		const project = createEmptyProject({ name: 'Worker audio failure' });
		const track = project.tracks.find((item) => item.kind === 'audio');
		if (!track) throw new Error('Factory did not create an audio track.');
		const assetId = 'missing' as keyof typeof project.assets;
		project.assets[assetId] = {
			id: assetId,
			kind: 'audio',
			name: 'missing.wav',
			mimeType: 'audio/wav',
			size: 5,
			duration: 1_000_000,
			hasAudio: true,
			opfsPath: 'missing.wav'
		};
		track.clips.push({
			id: 'missing-clip' as (typeof track.clips)[number]['id'],
			assetId,
			start: 0,
			duration: 1_000_000,
			sourceIn: 0,
			sourceOut: 1_000_000,
			speed: 1,
			volume: 1
		});
		const warnings: string[] = [];
		const mixer = new WorkerAudioMixer(
			project,
			async () => {
				throw new Error('The source file is missing.');
			},
			(message) => warnings.push(message)
		);
		try {
			const sample = await mixer.mixChunk(0, 1_000_000, 48_000);
			expect(sample).not.toBeNull();
			expect(sample?.numberOfFrames).toBe(48_000);
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain('missing.wav');
			sample?.close();
			await mixer.mixChunk(0, 1_000_000, 48_000);
			expect(warnings).toHaveLength(1);
		} finally {
			await mixer.dispose();
		}
	});

	it('supports planar mixing for loudness normalization calculation', async () => {
		const project = createEmptyProject({ name: 'Planar mix test' });
		const track = project.tracks.find((item) => item.kind === 'audio');
		if (!track) throw new Error('Factory did not create an audio track.');
		const mixer = new WorkerAudioMixer(project, async () => {
			throw new Error('No files');
		});
		try {
			const emptyPlanar = await mixer.mixChunkPlanar(0, 1_000_000, 48_000);
			// Without clips, returns null
			expect(emptyPlanar).toBeNull();
		} finally {
			await mixer.dispose();
		}
	});
});
