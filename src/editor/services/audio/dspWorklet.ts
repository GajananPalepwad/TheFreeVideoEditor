/**
 * AudioWorklet manager and fallback for DSP audio effect racks.
 *
 * Runs pure TypeScript DSP processors (EQ, compressor, reverb, limiter, etc.)
 * on the dedicated browser audio thread using AudioWorkletNode, avoiding
 * main-thread UI contention, crackles, and buffer underruns.
 *
 * Gracefully falls back to ScriptProcessorNode when AudioWorklet is unsupported.
 */

import type { AudioEffectInstance } from '../../core/types';
import { buildAudioRack } from './rack';
import dspWorkletUrl from './dsp.worklet.ts?worker&url';

export interface DspRackOptions {
	sampleRate?: number;
	channels?: number;
}

export interface DspRackNode {
	readonly node: AudioNode;
	readonly type: 'worklet' | 'script-processor';
	updateEffects: (effects: readonly AudioEffectInstance[]) => void;
	reset: () => void;
	disconnect: () => void;
}

const workletModulesLoaded = new WeakSet<BaseAudioContext>();
const workletModuleLoading = new WeakMap<BaseAudioContext, Promise<boolean>>();

/**
 * Loads the DSP AudioWorklet module onto the given AudioContext if supported.
 * Cached per context to ensure addModule is called at most once.
 */
export async function ensureDspWorklet(ctx: BaseAudioContext): Promise<boolean> {
	if (workletModulesLoaded.has(ctx)) return true;
	if (!ctx.audioWorklet || typeof ctx.audioWorklet.addModule !== 'function') return false;

	const existing = workletModuleLoading.get(ctx);
	if (existing) return existing;

	const promise = (async () => {
		try {
			await ctx.audioWorklet.addModule(dspWorkletUrl);
			workletModulesLoaded.add(ctx);
			return true;
		} catch (error) {
			// Worklet module load failed (e.g. CSP, file protocol, or mock env); fallback to ScriptProcessor
			console.warn('AudioWorklet addModule failed, falling back to ScriptProcessorNode:', error);
			return false;
		} finally {
			workletModuleLoading.delete(ctx);
		}
	})();

	workletModuleLoading.set(ctx, promise);
	return promise;
}

/**
 * Returns true if the DSP AudioWorklet module is loaded and ready on the given context.
 */
export function isDspWorkletLoaded(ctx: BaseAudioContext): boolean {
	return workletModulesLoaded.has(ctx);
}

/**
 * Marks the AudioWorklet module as loaded or unloaded on a context (primarily for testing).
 */
export function setDspWorkletLoadedForTest(ctx: BaseAudioContext, loaded = true): void {
	if (loaded) {
		workletModulesLoaded.add(ctx);
	} else {
		workletModulesLoaded.delete(ctx);
	}
}

/**
 * Creates an audio rack node for active effects.
 * Prefers AudioWorkletNode (dedicated audio thread); falls back to ScriptProcessorNode.
 */
export function createDspRackNode(
	ctx: BaseAudioContext,
	effects: readonly AudioEffectInstance[] | undefined,
	options: DspRackOptions = {}
): DspRackNode | undefined {
	const activeFx = (effects ?? []).filter((e) => e && !e.bypass && e.enabled !== false);
	if (activeFx.length === 0) return undefined;

	const sampleRate = options.sampleRate ?? ctx.sampleRate ?? 48000;
	const channels = options.channels ?? 2;

	// 1. AudioWorkletNode (Audio Thread)
	if (typeof AudioWorkletNode === 'function' && isDspWorkletLoaded(ctx)) {
		try {
			const workletNode = new AudioWorkletNode(ctx, 'tfve-dsp-processor', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [channels],
				processorOptions: {
					effects: activeFx,
					sampleRate,
					channels
				}
			});

			return {
				node: workletNode,
				type: 'worklet',
				updateEffects: (nextEffects: readonly AudioEffectInstance[]) => {
					const nextActive = (nextEffects ?? []).filter(
						(e) => e && !e.bypass && e.enabled !== false
					);
					workletNode.port.postMessage({
						type: 'update-effects',
						effects: nextActive
					});
				},
				reset: () => {
					workletNode.port.postMessage({ type: 'reset' });
				},
				disconnect: () => {
					try {
						workletNode.disconnect();
					} catch {}
				}
			};
		} catch (error) {
			console.warn(
				'AudioWorkletNode instantiation failed, falling back to ScriptProcessorNode:',
				error
			);
		}
	}

	// 2. ScriptProcessorNode Fallback (Main Thread)
	if (typeof ctx.createScriptProcessor === 'function') {
		let currentRack = buildAudioRack(activeFx, sampleRate, channels);
		const sp = ctx.createScriptProcessor(4096, channels, channels);
		const chBuffers: Float32Array[] = Array.from(
			{ length: channels },
			() => new Float32Array(4096)
		);

		sp.onaudioprocess = (e) => {
			const frameCount = e.inputBuffer.length;
			if (chBuffers[0]!.length < frameCount) {
				for (let c = 0; c < channels; c++) {
					chBuffers[c] = new Float32Array(frameCount);
				}
			}
			const in0 = e.inputBuffer.getChannelData(0);
			const in1 = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : in0;
			try {
				chBuffers[0]!.subarray(0, frameCount).set(in0);
				chBuffers[1]!.subarray(0, frameCount).set(in1);
				currentRack.process(chBuffers, frameCount);

				// Sanitize output buffers against NaN / non-finite
				for (let c = 0; c < channels; c++) {
					const buf = chBuffers[c]!;
					for (let s = 0; s < frameCount; s++) {
						if (!Number.isFinite(buf[s])) {
							buf[s] = 0;
						}
					}
				}

				e.outputBuffer.getChannelData(0).set(chBuffers[0]!.subarray(0, frameCount));
				if (e.outputBuffer.numberOfChannels > 1) {
					e.outputBuffer.getChannelData(1).set(chBuffers[1]!.subarray(0, frameCount));
				}
			} catch {
				e.outputBuffer.getChannelData(0).set(in0);
				if (e.outputBuffer.numberOfChannels > 1) {
					e.outputBuffer.getChannelData(1).set(in1);
				}
			}
		};

		return {
			node: sp,
			type: 'script-processor',
			updateEffects: (nextEffects: readonly AudioEffectInstance[]) => {
				const nextActive = (nextEffects ?? []).filter((e) => e && !e.bypass && e.enabled !== false);
				currentRack = buildAudioRack(nextActive, sampleRate, channels);
			},
			reset: () => {
				currentRack.reset();
			},
			disconnect: () => {
				try {
					sp.disconnect();
				} catch {}
			}
		};
	}

	return undefined;
}
