import type { AudioEffectInstance } from '../../core/types';
import { audioEffectRegistry, type AudioEffectDSP } from '../../core/audio/effects';

export interface BuiltAudioRack {
	effects: AudioEffectInstance[];
	dsps: AudioEffectDSP[];
	totalLatencySamples: number;
	process: (channels: Float32Array[], frameCount: number) => void;
	reset: () => void;
}

/**
 * Builds a DSP processing rack from a list of AudioEffectInstances.
 * Runs in-place, supports mix / wet-dry, bypass, and computes total latency for PDC.
 */
export function buildAudioRack(
	effects: readonly AudioEffectInstance[] | undefined,
	sampleRate = 48000,
	channels = 2
): BuiltAudioRack {
	if (!effects || effects.length === 0) {
		return {
			effects: [],
			dsps: [],
			totalLatencySamples: 0,
			process: () => {},
			reset: () => {}
		};
	}

	const activeInstances: AudioEffectInstance[] = [];
	const dsps: AudioEffectDSP[] = [];
	let totalLatency = 0;

	for (const inst of effects) {
		if (!inst || inst.enabled === false || inst.bypass === true) continue;
		const def = audioEffectRegistry.get(inst.type);
		if (!def) continue;

		const dsp = def.createDSP({ sampleRate, channels }, inst.params);
		dsps.push(dsp);
		activeInstances.push(inst);
		totalLatency += def.latencySamples(inst.params);
	}

	// Scratch buffers for wet/dry mixing if mix < 1.0
	const dryBuffers = Array.from({ length: channels }, () => new Float32Array(0));

	const process = (chData: Float32Array[], frameCount: number) => {
		for (let i = 0; i < dsps.length; i++) {
			const dsp = dsps[i]!;
			const inst = activeInstances[i]!;
			const mix = inst.mix ?? 1.0;

			if (mix >= 0.999) {
				dsp.process(chData, frameCount);
			} else if (mix <= 0.001) {
				// Pure dry, skip DSP processing
				continue;
			} else {
				// Dry/wet blend: save dry
				for (let c = 0; c < chData.length; c++) {
					if (dryBuffers[c]!.length < frameCount) {
						dryBuffers[c] = new Float32Array(frameCount);
					}
					dryBuffers[c]!.set(chData[c]!.subarray(0, frameCount));
				}

				dsp.process(chData, frameCount);

				// Blend: ch = mix * wet + (1 - mix) * dry
				const dryGain = 1.0 - mix;
				for (let c = 0; c < chData.length; c++) {
					const wet = chData[c]!;
					const dry = dryBuffers[c]!;
					for (let s = 0; s < frameCount; s++) {
						wet[s] = mix * wet[s]! + dryGain * dry[s]!;
					}
				}
			}
		}
	};

	const reset = () => {
		for (const dsp of dsps) dsp.reset();
	};

	return {
		effects: activeInstances,
		dsps,
		totalLatencySamples: totalLatency,
		process,
		reset
	};
}
