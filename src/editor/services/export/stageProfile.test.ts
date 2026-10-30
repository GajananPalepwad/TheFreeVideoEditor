import { describe, expect, it } from 'vitest';
import { createStageLap, createStageProfile } from './stageProfile';

describe('export stage profile', () => {
	it('starts with every stage at zero', () => {
		expect(createStageProfile()).toEqual({
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
		});
	});

	it('adds the time since the previous lap to the named stage', () => {
		const profile = createStageProfile();
		const clock = [100, 104, 110, 111, 125];
		const lap = createStageLap(profile, () => clock.shift()!);

		lap('resolve');
		lap('prepare');
		lap('render');
		lap('prepare');

		expect(profile.ms).toEqual({
			resolve: 4,
			raster: 0,
			decode: 0,
			copy: 0,
			bitmap: 0,
			prepare: 6 + 14,
			render: 1,
			encode: 0,
			audio: 0,
			yield: 0
		});
	});

	it('does nothing and never reads the clock when profiling is off', () => {
		const lap = createStageLap(undefined, () => {
			throw new Error('clock read while profiling is off');
		});

		expect(() => lap('render')).not.toThrow();
	});
});
