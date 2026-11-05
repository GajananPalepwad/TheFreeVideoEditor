import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createDspRackNode,
	ensureDspWorklet,
	isDspWorkletLoaded,
	setDspWorkletLoadedForTest
} from './dspWorklet';
import { DspAudioWorkletProcessor } from './dsp.worklet';
import { audioEffectRegistry } from '../../core/audio/effects';
import type { AudioEffectInstance } from '../../core/types';

describe('dsp.worklet & AudioWorklet DSP Racks', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe('DspAudioWorkletProcessor', () => {
		it('processes 128-sample audio blocks through active DSP rack', () => {
			const gainEffect: AudioEffectInstance = {
				id: 'fx-1',
				type: 'gain-trim',
				enabled: true,
				params: { gainDb: 6 } // ~2x gain
			};

			const processor = new DspAudioWorkletProcessor({
				processorOptions: {
					effects: [gainEffect],
					sampleRate: 48000,
					channels: 2
				}
			});

			const inLeft = new Float32Array(128).fill(0.5);
			const inRight = new Float32Array(128).fill(-0.5);
			const outLeft = new Float32Array(128);
			const outRight = new Float32Array(128);

			const keepAlive = processor.process([[inLeft, inRight]], [[outLeft, outRight]], {});
			expect(keepAlive).toBe(true);

			// 0.5 * 10^(6/20) ~= 0.5 * 1.99526 ~= 0.9976
			expect(outLeft[0]).toBeCloseTo(0.9976, 2);
			expect(outRight[0]).toBeCloseTo(-0.9976, 2);
		});

		it('converts mono input to stereo output', () => {
			const gainEffect: AudioEffectInstance = {
				id: 'fx-mono',
				type: 'gain-trim',
				enabled: true,
				params: { gainDb: 0 }
			};

			const processor = new DspAudioWorkletProcessor({
				processorOptions: {
					effects: [gainEffect],
					sampleRate: 48000,
					channels: 2
				}
			});

			const monoIn = new Float32Array(128).fill(0.75);
			const outLeft = new Float32Array(128);
			const outRight = new Float32Array(128);

			processor.process([[monoIn]], [[outLeft, outRight]], {});

			expect(outLeft[0]).toBeCloseTo(0.75, 4);
			expect(outRight[0]).toBeCloseTo(0.75, 4);
		});

		it('sanitizes NaN and non-finite output to 0', () => {
			// Register a dummy effect that outputs NaN
			audioEffectRegistry.register({
				id: 'test-nan-fx',
				name: 'NaN Test',
				category: 'utility',
				version: 1,
				paramSchemas: [],
				latencySamples: () => 0,
				createDSP: () => ({
					reset: () => {},
					latencySamples: () => 0,
					process: (channels) => {
						channels[0]![0] = NaN;
						channels[1]![0] = Infinity;
					}
				})
			});

			const processor = new DspAudioWorkletProcessor({
				processorOptions: {
					effects: [{ id: 'nan-1', type: 'test-nan-fx', enabled: true, params: {} }],
					sampleRate: 48000,
					channels: 2
				}
			});

			const inLeft = new Float32Array(128).fill(0.5);
			const inRight = new Float32Array(128).fill(0.5);
			const outLeft = new Float32Array(128);
			const outRight = new Float32Array(128);

			processor.process([[inLeft, inRight]], [[outLeft, outRight]], {});

			expect(outLeft[0]).toBe(0);
			expect(outRight[0]).toBe(0);
		});

		it('updates effects dynamically via message port', () => {
			const processor = new DspAudioWorkletProcessor({
				processorOptions: {
					effects: [{ id: 'fx-1', type: 'gain-trim', enabled: true, params: { gainDb: 0 } }],
					sampleRate: 48000
				}
			});

			// Message port handler exists
			expect(typeof processor.port.onmessage).toBe('function');

			// Send update-effects message with +6 dB gain
			processor.port.onmessage!({
				data: {
					type: 'update-effects',
					effects: [{ id: 'fx-1', type: 'gain-trim', enabled: true, params: { gainDb: 6 } }]
				}
			} as MessageEvent);

			const inL = new Float32Array(128).fill(0.5);
			const outL = new Float32Array(128);
			processor.process([[inL, inL]], [[outL, outL]], {});

			expect(outL[0]).toBeCloseTo(0.9976, 2);

			// Send empty effects to bypass DSP processing
			processor.port.onmessage!({
				data: { type: 'update-effects', effects: [] }
			} as MessageEvent);

			processor.process([[inL, inL]], [[outL, outL]], {});
			expect(outL[0]).toBeCloseTo(0.5, 4);
		});
	});

	describe('ensureDspWorklet', () => {
		it('returns false when ctx.audioWorklet is not available', async () => {
			const mockContext = {} as BaseAudioContext;
			const loaded = await ensureDspWorklet(mockContext);
			expect(loaded).toBe(false);
			expect(isDspWorkletLoaded(mockContext)).toBe(false);
		});

		it('calls addModule once and returns true on success', async () => {
			const addModuleMock = vi.fn().mockResolvedValue(undefined);
			const mockContext = {
				audioWorklet: {
					addModule: addModuleMock
				}
			} as unknown as BaseAudioContext;

			const loaded1 = await ensureDspWorklet(mockContext);
			expect(loaded1).toBe(true);
			expect(addModuleMock).toHaveBeenCalledTimes(1);
			expect(isDspWorkletLoaded(mockContext)).toBe(true);

			// Calling again should return cached true without second addModule call
			const loaded2 = await ensureDspWorklet(mockContext);
			expect(loaded2).toBe(true);
			expect(addModuleMock).toHaveBeenCalledTimes(1);
		});

		it('returns false and does not throw when addModule rejects', async () => {
			const addModuleMock = vi.fn().mockRejectedValue(new Error('CSP block'));
			const mockContext = {
				audioWorklet: {
					addModule: addModuleMock
				}
			} as unknown as BaseAudioContext;

			const loaded = await ensureDspWorklet(mockContext);
			expect(loaded).toBe(false);
			expect(isDspWorkletLoaded(mockContext)).toBe(false);
		});
	});

	describe('createDspRackNode', () => {
		it('returns undefined when there are no active effects', () => {
			const mockContext = {} as BaseAudioContext;
			expect(createDspRackNode(mockContext, [])).toBeUndefined();
			expect(
				createDspRackNode(mockContext, [{ id: '1', type: 'gain-trim', bypass: true, params: {} }])
			).toBeUndefined();
		});

		it('instantiates AudioWorkletNode when worklet module is loaded', () => {
			const postMessageMock = vi.fn();
			const disconnectMock = vi.fn();

			class MockAudioWorkletNode {
				port = { postMessage: postMessageMock };
				disconnect = disconnectMock;
				constructor(
					public ctx: unknown,
					public name: string,
					public options: unknown
				) {}
			}

			// Mock global AudioWorkletNode
			vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);

			const mockContext = {
				sampleRate: 48000
			} as BaseAudioContext;

			setDspWorkletLoadedForTest(mockContext, true);

			const effects: AudioEffectInstance[] = [
				{ id: '1', type: 'gain-trim', enabled: true, params: { gainDb: 3 } }
			];

			const rack = createDspRackNode(mockContext, effects);
			expect(rack).toBeDefined();
			expect(rack!.type).toBe('worklet');
			expect(rack!.node).toBeInstanceOf(MockAudioWorkletNode);

			const nodeInstance = rack!.node as unknown as MockAudioWorkletNode;
			expect(nodeInstance.name).toBe('tfve-dsp-processor');
			expect(nodeInstance.options).toEqual({
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				processorOptions: {
					effects,
					sampleRate: 48000,
					channels: 2
				}
			});

			// Test updateEffects and reset
			rack!.updateEffects([]);
			expect(postMessageMock).toHaveBeenCalledWith({ type: 'update-effects', effects: [] });

			rack!.reset();
			expect(postMessageMock).toHaveBeenCalledWith({ type: 'reset' });

			rack!.disconnect();
			expect(disconnectMock).toHaveBeenCalled();
		});

		it('falls back to ScriptProcessorNode when AudioWorklet is unavailable', () => {
			vi.stubGlobal('AudioWorkletNode', undefined);

			const disconnectMock = vi.fn();
			const mockScriptProcessor = {
				onaudioprocess: null,
				disconnect: disconnectMock
			};

			const mockContext = {
				sampleRate: 48000,
				createScriptProcessor: vi.fn(() => mockScriptProcessor)
			} as unknown as BaseAudioContext;

			const effects: AudioEffectInstance[] = [
				{ id: '1', type: 'gain-trim', enabled: true, params: { gainDb: 3 } }
			];

			const rack = createDspRackNode(mockContext, effects);
			expect(rack).toBeDefined();
			expect(rack!.type).toBe('script-processor');
			expect(mockContext.createScriptProcessor).toHaveBeenCalledWith(4096, 2, 2);
			expect(rack!.node).toBe(mockScriptProcessor as unknown as AudioNode);

			rack!.disconnect();
			expect(disconnectMock).toHaveBeenCalled();
		});
	});
});
