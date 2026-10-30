export type ExportStage =
	| 'resolve'
	| 'raster'
	| 'decode'
	| 'copy'
	| 'bitmap'
	| 'prepare'
	| 'render'
	| 'encode'
	| 'audio'
	| 'yield';

export type StageLap = (stage: ExportStage) => void;

/** Wall-clock time the per-frame export loop spent in each stage, summed over the frames done. */
export interface ExportStageProfile {
	frames: number;
	ms: Record<ExportStage, number>;
}

export function createStageProfile(): ExportStageProfile {
	return {
		frames: 0,
		ms: {
			resolve: 0,
			raster: 0,
			decode: 0,
			copy: 0,
			bitmap: 0,
			prepare: 0,
			render: 0,
			encode: 0,
			audio: 0,
			yield: 0
		}
	};
}

/**
 * Returns a function that charges the time since its previous call to the named stage. With no
 * profile it is a no-op that never reads the clock, so normal exports pay nothing.
 */
export function createStageLap(
	profile: ExportStageProfile | undefined,
	now: () => number = () => performance.now()
): StageLap {
	if (!profile) return () => {};
	let last = now();
	return (stage) => {
		const time = now();
		profile.ms[stage] += time - last;
		last = time;
	};
}
