import type { Project, Track, AudioEffectInstance, Sequence, SequenceId } from '../types';

/**
 * Migrates legacy fixed track EQ and compressor to rack effects on tracks.
 * Preserves exact parameter values and bypass state.
 */
export function migrateLegacyAudioRack(project: Project): Project {
	let modified = false;

	const migrateTrack = (track: Track): Track => {
		if (track.kind !== 'audio' || !track.audio) return track;
		const tAudio = track.audio;
		const effects: AudioEffectInstance[] = [...(tAudio.effects ?? [])];
		let trackModified = false;

		// 1. Migrate legacy EQ if present and not already migrated
		if (
			tAudio.eq &&
			tAudio.eq.bands &&
			!effects.some((fx) => fx.id === `migrated-eq-${track.id}`)
		) {
			const eq = tAudio.eq;
			const eqInstance: AudioEffectInstance = {
				id: `migrated-eq-${track.id}`,
				type: 'parametric-eq',
				name: 'Parametric EQ',
				enabled: eq.enabled !== false,
				mix: 1.0,
				params: {
					band1_type: eq.bands[0]?.type ?? 'low-shelf',
					band1_freq: eq.bands[0]?.frequencyHz ?? 80,
					band1_gain: eq.bands[0]?.gainDb ?? 0,
					band1_q: eq.bands[0]?.q ?? 0.71,
					band1_enabled: true,

					band2_type: eq.bands[1]?.type ?? 'peaking',
					band2_freq: eq.bands[1]?.frequencyHz ?? 500,
					band2_gain: eq.bands[1]?.gainDb ?? 0,
					band2_q: eq.bands[1]?.q ?? 1.0,
					band2_enabled: true,

					band3_type: eq.bands[2]?.type ?? 'peaking',
					band3_freq: eq.bands[2]?.frequencyHz ?? 3000,
					band3_gain: eq.bands[2]?.gainDb ?? 0,
					band3_q: eq.bands[2]?.q ?? 1.0,
					band3_enabled: true,

					band4_type: eq.bands[3]?.type ?? 'high-shelf',
					band4_freq: eq.bands[3]?.frequencyHz ?? 12000,
					band4_gain: eq.bands[3]?.gainDb ?? 0,
					band4_q: eq.bands[3]?.q ?? 0.71,
					band4_enabled: true
				}
			};
			effects.push(eqInstance);
			trackModified = true;
		}

		// 2. Migrate legacy Compressor if present and not already migrated
		if (tAudio.compressor && !effects.some((fx) => fx.id === `migrated-comp-${track.id}`)) {
			const comp = tAudio.compressor;
			const compInstance: AudioEffectInstance = {
				id: `migrated-comp-${track.id}`,
				type: 'compressor',
				name: 'Compressor',
				enabled: comp.enabled !== false,
				mix: 1.0,
				params: {
					thresholdDb: comp.thresholdDb ?? -24,
					ratio: comp.ratio ?? 3,
					attackMs: comp.attackMs ?? 20,
					releaseMs: comp.releaseMs ?? 250,
					kneeDb: comp.kneeDb ?? 6,
					makeupDb: comp.makeupDb ?? 0
				}
			};
			effects.push(compInstance);
			trackModified = true;
		}

		if (!trackModified) return track;
		modified = true;
		return {
			...track,
			audio: {
				...tAudio,
				effects
			}
		};
	};

	const migratedTracks = project.tracks.map(migrateTrack);
	let migratedSequences = project.sequences;
	if (project.sequences) {
		const newSeqs: Record<SequenceId, Sequence> = { ...project.sequences };
		for (const [seqId, seq] of Object.entries(project.sequences) as Array<[SequenceId, Sequence]>) {
			newSeqs[seqId] = {
				...seq,
				tracks: seq.tracks.map(migrateTrack)
			};
		}
		migratedSequences = newSeqs;
	}

	if (!modified) return project;
	return {
		...project,
		tracks: migratedTracks,
		sequences: migratedSequences
	};
}
