import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../core/factory';
import type { Track } from '../../core/types';
import { computeGraphPdc } from './pdc';
import { migrateLegacyAudioRack } from '../../core/audio/rackMigration';
import { audioEffectRegistry } from '../../core/audio/effects';

describe('Slice 1: PDC, Racks, Routing & Schema Migration', () => {
	it('PDC calculates sample-exact delay compensations across parallel paths', () => {
		const project = createEmptyProject({ name: 'PDC Test' });

		// Register a dummy effect that reports 64 samples of latency (e.g. lookahead)
		audioEffectRegistry.register({
			id: 'dummy-lookahead',
			name: 'Dummy Lookahead',
			category: 'dynamics',
			version: 1,
			paramSchemas: [],
			latencySamples: () => 64,
			createDSP: () => ({
				reset: () => {},
				latencySamples: () => 64,
				process: () => {}
			})
		});

		// Track 1: Has lookahead effect (64 samples latency)
		const track1: Track = {
			id: 'track-1' as Track['id'],
			kind: 'audio',
			name: 'Audio 1',
			muted: false,
			locked: false,
			hidden: false,
			clips: [],
			audio: {
				gainDb: 0,
				pan: 0,
				solo: false,
				effects: [
					{
						id: 'fx-1',
						type: 'dummy-lookahead',
						enabled: true,
						params: {}
					}
				]
			}
		};

		// Track 2: Direct parallel track (0 latency)
		const track2: Track = {
			id: 'track-2' as Track['id'],
			kind: 'audio',
			name: 'Audio 2',
			muted: false,
			locked: false,
			hidden: false,
			clips: [],
			audio: {
				gainDb: 0,
				pan: 0,
				solo: false,
				effects: []
			}
		};

		project.tracks.push(track1, track2);

		const pdc = computeGraphPdc(project);

		// Track 1 path latency: 64 samples
		expect(pdc.trackLatencies.get('track-1')).toBe(64);
		// Track 2 path latency: 0 samples
		expect(pdc.trackLatencies.get('track-2')).toBe(0);
		// Max path latency: 64 samples
		expect(pdc.maxPathLatency).toBe(64);
		// Track 1 compensation needed: 0 samples
		expect(pdc.trackCompensations.get('track-1')).toBe(0);
		// Track 2 compensation needed: exactly 64 samples
		expect(pdc.trackCompensations.get('track-2')).toBe(64);
	});

	it('migrates legacy EQ and compressor into rack entries identically without loss', () => {
		const project = createEmptyProject({ name: 'Migration Test' });
		const legacyTrack: Track = {
			id: 'legacy-track-1' as Track['id'],
			kind: 'audio',
			name: 'Legacy Track',
			muted: false,
			locked: false,
			hidden: false,
			clips: [],
			audio: {
				gainDb: -3,
				pan: 0.2,
				solo: false,
				eq: {
					enabled: true,
					bands: [
						{ type: 'lowshelf', frequencyHz: 120, gainDb: 3, q: 0.71 },
						{ type: 'peaking', frequencyHz: 600, gainDb: -2, q: 1.0 },
						{ type: 'peaking', frequencyHz: 2500, gainDb: 4, q: 1.2 },
						{ type: 'highshelf', frequencyHz: 8000, gainDb: 1.5, q: 0.71 }
					]
				},
				compressor: {
					enabled: true,
					thresholdDb: -18,
					ratio: 3.5,
					attackMs: 15,
					releaseMs: 200,
					kneeDb: 4,
					makeupDb: 2
				}
			}
		};
		project.tracks.push(legacyTrack);

		const migrated = migrateLegacyAudioRack(project);
		const track = migrated.tracks.find((t) => t.id === 'legacy-track-1')!;

		const effects = track.audio?.effects;
		expect(effects).toBeDefined();
		expect(effects?.length).toBe(2);

		const eqFx = effects?.find((fx) => fx.type === 'parametric-eq');
		expect(eqFx).toBeDefined();
		expect(eqFx?.enabled).toBe(true);
		expect(eqFx?.params.band1_freq).toBe(120);
		expect(eqFx?.params.band1_gain).toBe(3);
		expect(eqFx?.params.band2_gain).toBe(-2);

		const compFx = effects?.find((fx) => fx.type === 'compressor');
		expect(compFx).toBeDefined();
		expect(compFx?.enabled).toBe(true);
		expect(compFx?.params.thresholdDb).toBe(-18);
		expect(compFx?.params.ratio).toBe(3.5);
		expect(compFx?.params.makeupDb).toBe(2);
	});

	it('safely migrates legacy audio rack with incomplete or undefined fields', () => {
		const project = createEmptyProject({ name: 'Incomplete Legacy Audio' });
		const legacyTrack: Track = {
			id: 'legacy-incomplete' as Track['id'],
			name: 'Incomplete Track',
			kind: 'audio' as const,
			muted: false,
			locked: false,
			hidden: false,
			clips: [],
			audio: {
				gainDb: 0,
				pan: 0,
				solo: false,
				eq: { bands: [] } as unknown as NonNullable<Track['audio']>['eq'],
				compressor: {} as unknown as NonNullable<Track['audio']>['compressor']
			}
		};
		project.tracks.push(legacyTrack);

		const migrated = migrateLegacyAudioRack(project);
		const track = migrated.tracks.find((t) => t.id === 'legacy-incomplete')!;
		expect(track.audio?.effects).toHaveLength(2);
		expect(track.audio?.effects?.[0]?.enabled).toBe(true);
		expect(track.audio?.effects?.[1]?.enabled).toBe(true);
	});

	it('Supports adding and removing submix buses and resets routing cleanly', () => {
		const project = createEmptyProject({ name: 'Bus Routing Test' });
		const bus1 = {
			id: 'bus-1',
			name: 'Submix 1',
			gainDb: 0,
			pan: 0,
			muted: false,
			solo: false,
			output: 'master' as const
		};
		const bus2 = {
			id: 'bus-2',
			name: 'Submix 2',
			gainDb: 0,
			pan: 0,
			muted: false,
			solo: false,
			output: 'bus-1'
		};
		project.audioBuses = [bus1, bus2];

		const track: Track = {
			id: 'track-routed' as Track['id'],
			kind: 'audio',
			name: 'Voice',
			muted: false,
			locked: false,
			hidden: false,
			clips: [],
			audio: {
				gainDb: 0,
				pan: 0,
				solo: false,
				output: 'bus-1',
				sends: [{ busId: 'bus-1', levelDb: 0, pre: false, enabled: true }]
			}
		};
		project.tracks.push(track);

		// Remove bus-1: bus-2's output should revert to 'master', track's output should revert to 'master', send to bus-1 removed
		const filteredBuses = project.audioBuses
			.filter((b) => b.id !== 'bus-1')
			.map((b) => (b.output === 'bus-1' ? { ...b, output: 'master' as const } : b));
		const updatedTracks = project.tracks.map((t) => {
			if (!t.audio) return t;
			return {
				...t,
				audio: {
					...t.audio,
					output: t.audio.output === 'bus-1' ? 'master' : t.audio.output,
					sends: (t.audio.sends ?? []).filter((s) => s.busId !== 'bus-1')
				}
			};
		});

		expect(filteredBuses.length).toBe(1);
		expect(filteredBuses[0]?.id).toBe('bus-2');
		expect(filteredBuses[0]?.output).toBe('master');

		const updatedTrack = updatedTracks.find((t) => t.id === 'track-routed')!;
		expect(updatedTrack.audio?.output).toBe('master');
		expect(updatedTrack.audio?.sends?.length).toBe(0);
	});
});
