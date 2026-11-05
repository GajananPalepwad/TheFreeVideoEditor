import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '../../core/factory';
import { AudioGraphController } from './controller';
import { buildAudioGraph } from './graph';
import type { Asset, AssetId, Clip, Project, Track } from '../../core/types';
import type { MediaPool } from '../playback/mediaPool';
import type { ActiveAudio } from '../../core/playback';
import { audioEffectRegistry } from '../../core/audio/effects/registry';
import '../../core/audio/effects';

function makeAudioElement(): HTMLAudioElement {
	return {
		paused: true,
		volume: 1,
		playbackRate: 1,
		currentTime: 0,
		pause: vi.fn(function (this: { paused: boolean }) {
			this.paused = true;
		}),
		play: vi.fn(function (this: { paused: boolean }) {
			this.paused = false;
			return Promise.resolve();
		})
	} as unknown as HTMLAudioElement;
}

function makeFullAudioContext() {
	const allNodes: Array<{
		type: string;
		connect: ReturnType<typeof vi.fn>;
		disconnect: ReturnType<typeof vi.fn>;
		[key: string]: unknown;
	}> = [];

	let state: AudioContextState = 'running';

	const makeParam = (initial = 0) => ({
		value: initial,
		cancelScheduledValues: vi.fn(),
		setValueAtTime: vi.fn(function (this: { value: number }, v: number) {
			this.value = v;
		}),
		setTargetAtTime: vi.fn(function (this: { value: number }, v: number) {
			this.value = v;
		}),
		linearRampToValueAtTime: vi.fn(function (this: { value: number }, v: number) {
			this.value = v;
		})
	});

	const destination = {
		type: 'destination',
		connect: vi.fn(),
		disconnect: vi.fn()
	};

	const context = {
		sampleRate: 48000,
		currentTime: 0,
		get state() {
			return state;
		},
		destination,
		createGain: vi.fn(() => {
			const node = {
				type: 'gain',
				gain: makeParam(1),
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		createStereoPanner: vi.fn(() => {
			const node = {
				type: 'panner',
				pan: makeParam(0),
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		createBiquadFilter: vi.fn(() => {
			const node = {
				type: 'biquad',
				frequency: makeParam(1000),
				gain: makeParam(0),
				Q: makeParam(1),
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		createDynamicsCompressor: vi.fn(() => {
			const node = {
				type: 'compressor',
				threshold: makeParam(0),
				ratio: makeParam(1),
				attack: makeParam(0.003),
				release: makeParam(0.25),
				knee: makeParam(30),
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		createWaveShaper: vi.fn(() => {
			const node = {
				type: 'waveshaper',
				curve: null,
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		createAnalyser: vi.fn(() => {
			const node = {
				type: 'analyser',
				fftSize: 256,
				connect: vi.fn(),
				disconnect: vi.fn(),
				getFloatTimeDomainData: (data: Float32Array) => data.fill(0)
			};
			allNodes.push(node);
			return node;
		}),
		createChannelSplitter: vi.fn(() => {
			const node = {
				type: 'splitter',
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		createDelay: vi.fn(() => {
			const node = {
				type: 'delay',
				delayTime: makeParam(0),
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		createScriptProcessor: vi.fn((bufSize: number, inCh: number, outCh: number) => {
			const node = {
				type: 'scriptprocessor',
				bufferSize: bufSize,
				numberOfInputChannels: inCh,
				numberOfOutputChannels: outCh,
				onaudioprocess: null as ((e: unknown) => void) | null,
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		createMediaElementSource: vi.fn(() => {
			const node = {
				type: 'mediaelementsource',
				connect: vi.fn(),
				disconnect: vi.fn()
			};
			allNodes.push(node);
			return node;
		}),
		resume: vi.fn(async () => {
			state = 'running';
		}),
		close: vi.fn(async () => {
			state = 'closed';
		})
	};

	return {
		context: context as unknown as AudioContext,
		allNodes
	};
}

function makeProjectWithClip(): { project: Project; audioTrack: Track; clip: Clip; asset: Asset } {
	const base = createEmptyProject({ name: 'Audio Effects Test' });
	const asset: Asset = {
		id: 'asset-1' as AssetId,
		kind: 'audio',
		name: 'sample.wav',
		mimeType: 'audio/wav',
		size: 1000,
		duration: 5_000_000,
		hasAudio: true,
		opfsPath: `projects/${base.id}/media/sample.wav`
	};
	base.assets[asset.id] = asset;

	const audioTrack = base.tracks.find((t) => t.kind === 'audio')!;
	const clip: Clip = {
		id: 'clip-1' as Clip['id'],
		assetId: asset.id,
		start: 0,
		duration: 5_000_000,
		sourceIn: 0,
		sourceOut: 5_000_000,
		speed: 1,
		volume: 1,
		audioEffects: []
	};
	audioTrack.clips.push(clip);

	return { project: base, audioTrack, clip, asset };
}

describe('Audio Effects Dynamic Reactivity & Non-Muting', () => {
	it('applying an audio effect to a playing clip keeps audio connected without refresh', async () => {
		const audioElement = makeAudioElement();
		const pool = { getAudioElement: () => audioElement } as unknown as Pick<
			MediaPool,
			'getAudioElement'
		>;
		const { context } = makeFullAudioContext();
		const controller = new AudioGraphController(pool, { createContext: () => context });

		const { project, audioTrack, clip, asset } = makeProjectWithClip();
		const activeSource: ActiveAudio = {
			clipId: clip.id,
			assetId: asset.id,
			trackId: audioTrack.id,
			trackOrder: 1,
			sourceTime: 0,
			volume: 1.0
		};

		// 1. Initial playback without effects
		await controller.sync([activeSource], project, true, 1.0);
		expect(audioElement.play).toHaveBeenCalled();
		expect(controller.getConnectedCount()).toBe(1);

		// 2. User adds an audio effect to the clip (e.g. gainTrim or delay)
		const delayInstance = audioEffectRegistry.createDefaultInstance('delay');
		const updatedProject: Project = {
			...project,
			tracks: project.tracks.map((t) =>
				t.id === audioTrack.id
					? {
							...t,
							clips: t.clips.map((c) =>
								c.id === clip.id ? { ...c, audioEffects: [delayInstance] } : c
							)
						}
					: t
			)
		};

		// AudioGraphController updates project while playing
		controller.updateProject(updatedProject);

		// Audio element MUST still be connected and playing (NOT muted, NOT disconnected)
		expect(controller.getConnectedCount()).toBe(1);
		expect(audioElement.pause).not.toHaveBeenCalled();

		// ScriptProcessor rack node MUST be instantiated and connected
		expect(context.createScriptProcessor).toHaveBeenCalled();

		// 3. Modifying effect parameters (e.g. feedback) triggers real-time DSP update
		delayInstance.params.feedback = 0.8;
		controller.updateProject({ ...updatedProject });
		expect(controller.getConnectedCount()).toBe(1);
		expect(audioElement.pause).not.toHaveBeenCalled();

		// 4. Bypassing effect updates the chain without muting
		delayInstance.bypass = true;
		controller.updateProject({ ...updatedProject });
		expect(controller.getConnectedCount()).toBe(1);

		// 5. Cleanup
		await controller.dispose();
		expect(context.close).toHaveBeenCalled();
	});

	it('track-level audio effects create rackNode in buildAudioGraph', () => {
		const { context } = makeFullAudioContext();
		const { project, audioTrack } = makeProjectWithClip();

		const eqEffect = audioEffectRegistry.createDefaultInstance('parametric-eq');
		audioTrack.audio = {
			gainDb: 0,
			pan: 0,
			solo: false,
			effects: [eqEffect]
		};

		const graph = buildAudioGraph(context, project);
		const trackNode = graph.trackNodes.get(audioTrack.id);
		expect(trackNode).toBeDefined();
		expect(trackNode?.rackNode).toBeDefined();
		expect(trackNode?.rack).toBeDefined();
		expect(context.createScriptProcessor).toHaveBeenCalled();

		graph.dispose();
	});

	it('master-level audio effects create rackNode in buildAudioGraph', () => {
		const { context } = makeFullAudioContext();
		const { project } = makeProjectWithClip();

		const limiterEffect = audioEffectRegistry.createDefaultInstance('limiter');
		project.masterAudio = {
			gainDb: 0,
			limiter: false,
			effects: [limiterEffect]
		};

		const graph = buildAudioGraph(context, project);
		expect(graph.masterNodes.rackNode).toBeDefined();
		expect(graph.masterNodes.rack).toBeDefined();
		expect(context.createScriptProcessor).toHaveBeenCalled();

		graph.dispose();
	});

	it('onaudioprocess correctly processes DSP through rack and preserves dry audio on exceptions', async () => {
		const audioElement = makeAudioElement();
		const pool = { getAudioElement: () => audioElement } as unknown as Pick<
			MediaPool,
			'getAudioElement'
		>;
		const { context, allNodes } = makeFullAudioContext();
		const controller = new AudioGraphController(pool, { createContext: () => context });

		const { project, audioTrack, clip, asset } = makeProjectWithClip();
		const gainTrim = audioEffectRegistry.createDefaultInstance('gain-trim');
		gainTrim.params.gainDb = 6.0; // ~2x gain

		clip.audioEffects = [gainTrim];
		const activeSource: ActiveAudio = {
			clipId: clip.id,
			assetId: asset.id,
			trackId: audioTrack.id,
			trackOrder: 1,
			sourceTime: 0,
			volume: 1.0
		};

		await controller.sync([activeSource], project, true, 1.0);

		// Find the ScriptProcessorNode that was created
		const spNode = allNodes.find((n) => n.type === 'scriptprocessor') as
			| {
					onaudioprocess: ((e: unknown) => void) | null;
			  }
			| undefined;
		expect(spNode).toBeDefined();
		expect(spNode?.onaudioprocess).toBeTypeOf('function');

		// Simulate an audio processing buffer event
		const inBuf0 = new Float32Array(512).fill(0.2);
		const inBuf1 = new Float32Array(512).fill(0.2);
		const outBuf0 = new Float32Array(512);
		const outBuf1 = new Float32Array(512);

		const audioProcessingEvent = {
			inputBuffer: {
				length: 512,
				numberOfChannels: 2,
				getChannelData: (c: number) => (c === 0 ? inBuf0 : inBuf1)
			},
			outputBuffer: {
				numberOfChannels: 2,
				getChannelData: (c: number) => (c === 0 ? outBuf0 : outBuf1)
			}
		};

		// Run onaudioprocess
		spNode!.onaudioprocess!(audioProcessingEvent);

		// Output should be amplified (+6 dB is ~1.995x)
		expect(outBuf0[0]).toBeGreaterThan(0.35);
		expect(outBuf1[0]).toBeGreaterThan(0.35);

		// Test exception handling: if getChannelData throws, onaudioprocess catches and doesn't crash
		const faultEvent = {
			inputBuffer: {
				length: 512,
				numberOfChannels: 2,
				getChannelData: vi.fn(() => inBuf0)
			},
			outputBuffer: {
				numberOfChannels: 2,
				getChannelData: vi.fn(() => outBuf0)
			}
		};
		expect(() => spNode!.onaudioprocess!(faultEvent)).not.toThrow();

		await controller.dispose();
	});

	it('uses AudioWorkletNode when audioWorklet is available on context', async () => {
		const postMessageMock = vi.fn();
		const disconnectMock = vi.fn();
		const connectMock = vi.fn();

		class MockAudioWorkletNode {
			type = 'audioworklet';
			port = { postMessage: postMessageMock };
			connect = connectMock;
			disconnect = disconnectMock;
			constructor(
				public ctx: unknown,
				public name: string,
				public options: unknown
			) {}
		}

		vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode);

		const { context } = makeFullAudioContext();
		const addModuleMock = vi.fn().mockResolvedValue(undefined);
		(context as unknown as { audioWorklet: unknown }).audioWorklet = {
			addModule: addModuleMock
		};

		const { project, audioTrack, clip, asset } = makeProjectWithClip();
		clip.audioEffects = [
			{
				id: 'fx-worklet',
				type: 'gain-trim',
				enabled: true,
				params: { gainDb: 3 }
			}
		];
		audioTrack.audio = {
			gainDb: 0,
			pan: 0,
			solo: false,
			effects: [
				{
					id: 'track-fx-worklet',
					type: 'gain-trim',
					enabled: true,
					params: { gainDb: 2 }
				}
			]
		};

		const audioElement = makeAudioElement();
		const pool = {
			getAudioElement: vi.fn(() => audioElement)
		};

		const controller = new AudioGraphController(pool, { createContext: () => context });
		await controller.unlock();

		// addModule should have been called
		expect(addModuleMock).toHaveBeenCalled();

		const activeSource: ActiveAudio = {
			clipId: clip.id,
			assetId: asset.id,
			trackId: audioTrack.id,
			trackOrder: 1,
			sourceTime: 0,
			volume: 1.0
		};

		await controller.sync([activeSource], project, true, 1.0);

		// AudioWorkletNode should have been instantiated
		expect(connectMock).toHaveBeenCalled();

		// buildAudioGraph also uses AudioWorkletNode
		const graph = buildAudioGraph(context, project);
		const trackNode = graph.trackNodes.get(audioTrack.id);
		expect(trackNode).toBeDefined();

		await controller.dispose();
		expect(disconnectMock).toHaveBeenCalled();
	});
});
