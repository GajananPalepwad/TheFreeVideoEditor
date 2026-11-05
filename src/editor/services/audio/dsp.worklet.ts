// AudioWorklet processor for DSP racks in TheFreeVideoEditor

import type { AudioEffectInstance } from '../../core/types';
import { buildAudioRack, type BuiltAudioRack } from './rack';

declare function registerProcessor(
	name: string,
	processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;

declare class AudioWorkletProcessor {
	readonly port: MessagePort;
	process(
		inputs: Float32Array[][],
		outputs: Float32Array[][],
		parameters: Record<string, Float32Array>
	): boolean;
}

declare const sampleRate: number;

const BaseProcessor: typeof AudioWorkletProcessor =
	typeof AudioWorkletProcessor !== 'undefined'
		? AudioWorkletProcessor
		: (class MockAudioWorkletProcessor {
				readonly port = {
					onmessage: null as ((e: MessageEvent) => void) | null,
					postMessage: () => {}
				} as unknown as MessagePort;
			} as unknown as typeof AudioWorkletProcessor);

export class DspAudioWorkletProcessor extends BaseProcessor {
	private rack: BuiltAudioRack | null = null;
	private chBuffers: [Float32Array, Float32Array] = [new Float32Array(128), new Float32Array(128)];

	constructor(options?: AudioWorkletNodeOptions) {
		super();
		const initialEffects = options?.processorOptions?.effects as AudioEffectInstance[] | undefined;
		if (initialEffects && initialEffects.length > 0) {
			const sr =
				typeof sampleRate === 'number'
					? sampleRate
					: (options?.processorOptions?.sampleRate ?? 48000);
			this.rack = buildAudioRack(initialEffects, sr, 2);
		}

		this.port.onmessage = (
			event: MessageEvent<{ type: string; effects?: AudioEffectInstance[] }>
		) => {
			const msg = event.data;
			if (msg && msg.type === 'update-effects') {
				if (msg.effects && msg.effects.length > 0) {
					const sr = typeof sampleRate === 'number' ? sampleRate : 48000;
					this.rack = buildAudioRack(msg.effects, sr, 2);
				} else {
					this.rack = null;
				}
			} else if (msg && msg.type === 'reset') {
				this.rack?.reset();
			}
		};
	}

	process(inputs: Float32Array[][], outputs: Float32Array[][], ..._unused: unknown[]): boolean {
		void _unused;
		const input = inputs[0];
		const output = outputs[0];
		if (!output || output.length === 0) return true;

		const frameCount = output[0]!.length;
		if (this.chBuffers[0].length < frameCount) {
			this.chBuffers[0] = new Float32Array(frameCount);
			this.chBuffers[1] = new Float32Array(frameCount);
		}

		const in0 = input?.[0];
		const in1 = input && input.length > 1 ? input[1] : in0;

		if (!in0 || !this.rack) {
			if (in0) {
				output[0]!.set(in0);
				if (output.length > 1) {
					output[1]!.set(in1 ?? in0);
				}
			} else {
				output[0]!.fill(0);
				if (output.length > 1) {
					output[1]!.fill(0);
				}
			}
			return true;
		}

		try {
			this.chBuffers[0].subarray(0, frameCount).set(in0);
			this.chBuffers[1].subarray(0, frameCount).set(in1 ?? in0);

			this.rack.process(this.chBuffers, frameCount);

			// Sanitize output buffers against NaN / non-finite
			for (let c = 0; c < 2; c++) {
				const buf = this.chBuffers[c]!;
				for (let s = 0; s < frameCount; s++) {
					if (!Number.isFinite(buf[s])) {
						buf[s] = 0;
					}
				}
			}

			output[0]!.set(this.chBuffers[0].subarray(0, frameCount));
			if (output.length > 1) {
				output[1]!.set(this.chBuffers[1].subarray(0, frameCount));
			}
		} catch {
			output[0]!.set(in0);
			if (output.length > 1) {
				output[1]!.set(in1 ?? in0);
			}
		}

		return true;
	}
}

if (typeof registerProcessor === 'function') {
	registerProcessor('tfve-dsp-processor', DspAudioWorkletProcessor);
}
