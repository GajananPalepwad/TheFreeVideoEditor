import type { Clip, Project, Track, TrackAudio, SequenceId } from '../../core/types';
import { dbToGain, resolveAudibleTracks, fadeGain } from '../../core/audioMath';
import { renderRemappedAudio } from './renderRemappedAudio';
import { defaultAudioDecodeCache } from './decode';
import { renderOfflineAudio } from './offlineRender';
import { computeGraphPdc } from './pdc';
import { buildAudioRack, type BuiltAudioRack } from './rack';
import { createDspRackNode } from './dspWorklet';
import { migrateLegacyAudioRack } from '../../core/audio/rackMigration';

export interface AudioGraphMeterNodes {
	analyserL: AnalyserNode;
	analyserR: AnalyserNode;
}

export interface TrackAudioNodes {
	input: GainNode;
	delayNode?: DelayNode;
	rackNode?: AudioNode;
	eqNodes?: BiquadFilterNode[];
	compressorNode?: DynamicsCompressorNode;
	faderGain: GainNode;
	panPanner?: StereoPannerNode;
	splitter?: ChannelSplitterNode;
	panGainL?: GainNode;
	panGainR?: GainNode;
	merger?: ChannelMergerNode;
	phaseGain?: GainNode;
	muteGain: GainNode;
	meters?: AudioGraphMeterNodes;
	output: GainNode;
	sendGains?: Map<string, GainNode>;
	rack?: BuiltAudioRack;
}

export interface BusAudioNodes {
	input: GainNode;
	delayNode?: DelayNode;
	rackNode?: AudioNode;
	faderGain: GainNode;
	panPanner?: StereoPannerNode;
	muteGain: GainNode;
	meters?: AudioGraphMeterNodes;
	output: GainNode;
	rack?: BuiltAudioRack;
}

export interface MasterAudioNodes {
	input: GainNode;
	rackNode?: AudioNode;
	faderGain: GainNode;
	limiterNode?: DynamicsCompressorNode;
	clampNode?: WaveShaperNode;
	meters?: AudioGraphMeterNodes;
	output: GainNode;
	rack?: BuiltAudioRack;
}

export interface BuiltAudioGraph {
	trackNodes: Map<string, TrackAudioNodes>;
	busNodes: Map<string, BusAudioNodes>;
	masterNodes: MasterAudioNodes;
	scheduleClip: (
		clip: Clip,
		track: Track,
		whenSeconds: number,
		offsetSeconds: number,
		durationSeconds: number,
		buffer?: AudioBuffer,
		targetNode?: AudioNode
	) => AudioBufferSourceNode | null;
	scheduleProject: (
		timeRange?: { startUs: number; durationUs: number },
		buffers?: ReadonlyMap<string, AudioBuffer>
	) => Promise<AudioBufferSourceNode[]>;
	getTrackMeterLevels: (trackId: string) => {
		peakL: number;
		peakR: number;
		rmsL: number;
		rmsR: number;
	};
	getBusMeterLevels: (busId: string) => {
		peakL: number;
		peakR: number;
		rmsL: number;
		rmsR: number;
	};
	getMasterMeterLevels: () => { peakL: number; peakR: number; rmsL: number; rmsR: number };
	updateTrackParams: (trackId: string, audio: TrackAudio, audible: boolean) => void;
	updateMasterParams: (gainDb: number, limiter?: boolean) => void;
	updateBusParams: (busId: string, gainDb: number, pan: number, muted: boolean) => void;
	getNodeCount: () => number;
	dispose: () => void;
}

export interface BuildAudioGraphOptions {
	enableMeters?: boolean;
	destination?: AudioNode;
}

/**
 * Cache for bounced remapped sequence audio buffers.
 * Key: instanceKey / clipId + sequence content hash.
 */
const bouncedSequenceAudioCache = new Map<string, AudioBuffer>();

/**
 * Invalidate bounced audio cache for a sequence (or all if omitted).
 */
export function invalidateBouncedAudioCache(sequenceId?: SequenceId): void {
	if (!sequenceId) {
		bouncedSequenceAudioCache.clear();
		return;
	}
	for (const key of Array.from(bouncedSequenceAudioCache.keys())) {
		if (key.startsWith(sequenceId + ':')) {
			bouncedSequenceAudioCache.delete(key);
		}
	}
}

function createMeterPair(ctx: BaseAudioContext): AudioGraphMeterNodes {
	const analyserL = ctx.createAnalyser();
	const analyserR = ctx.createAnalyser();
	analyserL.fftSize = 256;
	analyserR.fftSize = 256;
	analyserL.smoothingTimeConstant = 0.5;
	analyserR.smoothingTimeConstant = 0.5;
	return { analyserL, analyserR };
}

function calculateMeterLevels(analyser: AnalyserNode): { peak: number; rms: number } {
	const buffer = new Float32Array(analyser.fftSize);
	analyser.getFloatTimeDomainData(buffer);
	let peak = 0;
	let sumSq = 0;
	for (let i = 0; i < buffer.length; i++) {
		const abs = Math.abs(buffer[i] ?? 0);
		if (abs > peak) peak = abs;
		sumSq += (buffer[i] ?? 0) * (buffer[i] ?? 0);
	}
	const rms = Math.sqrt(sumSq / buffer.length);
	return { peak, rms };
}

function updateMasterClampCurve(shaper: WaveShaperNode | undefined, limiterEnabled: boolean): void {
	if (!shaper) return;
	const samples = 4096;
	const curve = new Float32Array(samples);
	const ceiling = Math.pow(10, -0.5 / 20); // ~0.94406 (-0.5 dBTP)
	for (let i = 0; i < samples; i++) {
		const x = (i / (samples - 1)) * 4 - 2; // -2.0 to +2.0
		if (!limiterEnabled) {
			curve[i] = x;
		} else {
			if (x > ceiling) curve[i] = ceiling;
			else if (x < -ceiling) curve[i] = -ceiling;
			else curve[i] = x;
		}
	}
	shaper.curve = curve;
}

function buildSingleTrackChain(
	ctx: BaseAudioContext,
	track: Track,
	destination: AudioNode,
	isAudible: boolean,
	enableMeters: boolean,
	pdcDelaySamples = 0,
	allNodes?: Set<AudioNode>
): TrackAudioNodes {
	const tAudio = track.audio ?? { gainDb: 0, pan: 0, solo: false };
	const trackIn = ctx.createGain();
	allNodes?.add(trackIn);
	let trackTail: AudioNode = trackIn;

	// PDC Delay Node if compensation is needed
	let delayNode: DelayNode | undefined;
	if (pdcDelaySamples > 0 && typeof ctx.createDelay === 'function') {
		delayNode = ctx.createDelay(Math.max(1, (pdcDelaySamples + 100) / ctx.sampleRate));
		delayNode.delayTime.value = pdcDelaySamples / ctx.sampleRate;
		allNodes?.add(delayNode);
		trackTail.connect(delayNode);
		trackTail = delayNode;
	}

	// Track Inserts Rack
	let rackNode: AudioNode | undefined;
	const activeFx = (tAudio.effects ?? []).filter((e) => e && !e.bypass && e.enabled !== false);
	let rack: BuiltAudioRack | undefined;
	if (activeFx.length > 0) {
		rack = buildAudioRack(activeFx, ctx.sampleRate, 2);
		const dsp = createDspRackNode(ctx, activeFx, { sampleRate: ctx.sampleRate, channels: 2 });
		if (dsp) {
			allNodes?.add(dsp.node);
			trackTail.connect(dsp.node);
			trackTail = dsp.node;
			rackNode = dsp.node;
		}
	} else if (tAudio.effects) {
		rack = buildAudioRack(tAudio.effects, ctx.sampleRate, 2);
	}

	// 1. 4-band Parametric EQ (LowShelf, Peaking, Peaking, HighShelf)
	const defaultBands = [
		{ type: 'lowshelf' as const, frequencyHz: 120, gainDb: 0, q: 0.71 },
		{ type: 'peaking' as const, frequencyHz: 500, gainDb: 0, q: 1.0 },
		{ type: 'peaking' as const, frequencyHz: 2500, gainDb: 0, q: 1.0 },
		{ type: 'highshelf' as const, frequencyHz: 8000, gainDb: 0, q: 0.71 }
	];
	const bands = tAudio.eq?.bands?.length === 4 ? tAudio.eq.bands : defaultBands;
	const eqEnabled = tAudio.eq?.enabled ?? false;

	const eqFilters =
		typeof ctx.createBiquadFilter === 'function'
			? bands.map((band) => {
					const filter = ctx.createBiquadFilter();
					filter.type = band.type;
					filter.frequency.value = band.frequencyHz;
					filter.gain.value = eqEnabled ? band.gainDb : 0;
					filter.Q.value = band.q;
					allNodes?.add(filter);
					return filter;
				})
			: [];
	for (const f of eqFilters) {
		trackTail.connect(f);
		trackTail = f;
	}

	// 2. Dynamics Compressor
	let compNode: DynamicsCompressorNode | undefined;
	if (typeof ctx.createDynamicsCompressor === 'function') {
		compNode = ctx.createDynamicsCompressor();
		allNodes?.add(compNode);
		if (tAudio.compressor?.enabled) {
			compNode.threshold.value = tAudio.compressor.thresholdDb;
			compNode.ratio.value = tAudio.compressor.ratio;
			compNode.attack.value = tAudio.compressor.attackMs / 1000;
			compNode.release.value = tAudio.compressor.releaseMs / 1000;
			compNode.knee.value = tAudio.compressor.kneeDb;
		} else {
			compNode.threshold.value = 0;
			compNode.ratio.value = 1;
		}
		trackTail.connect(compNode);
		trackTail = compNode;
	}

	// 3. Track Gain
	const fader = ctx.createGain();
	fader.gain.value = dbToGain(tAudio.gainDb + (tAudio.trimDb ?? 0));
	allNodes?.add(fader);
	trackTail.connect(fader);
	trackTail = fader;

	// 4. Track Pan
	let panner: StereoPannerNode | undefined;
	if (typeof ctx.createStereoPanner === 'function') {
		panner = ctx.createStereoPanner();
		panner.pan.value = tAudio.pan;
		allNodes?.add(panner);
		trackTail.connect(panner);
		trackTail = panner;
	}

	// 5. Phase Invert
	const phaseGain = ctx.createGain();
	phaseGain.gain.value = tAudio.phaseInvert ? -1.0 : 1.0;
	allNodes?.add(phaseGain);
	trackTail.connect(phaseGain);
	trackTail = phaseGain;

	// 6. Mute/Solo Gate
	const muteGain = ctx.createGain();
	muteGain.gain.value = isAudible ? 1.0 : 0.0;
	allNodes?.add(muteGain);
	trackTail.connect(muteGain);
	trackTail = muteGain;

	// 7. Track Meters
	let trackMeters: AudioGraphMeterNodes | undefined;
	if (
		enableMeters &&
		typeof ctx.createAnalyser === 'function' &&
		typeof ctx.createChannelSplitter === 'function'
	) {
		trackMeters = createMeterPair(ctx);
		allNodes?.add(trackMeters.analyserL);
		allNodes?.add(trackMeters.analyserR);
		const splitter = ctx.createChannelSplitter(2);
		allNodes?.add(splitter);
		trackTail.connect(splitter);
		splitter.connect(trackMeters.analyserL, 0);
		splitter.connect(trackMeters.analyserR, 1);
	}

	// 8. Track Output -> Destination
	const trackOut = ctx.createGain();
	allNodes?.add(trackOut);
	trackTail.connect(trackOut);
	trackOut.connect(destination);

	return {
		input: trackIn,
		delayNode,
		rackNode,
		rack,
		eqNodes: eqFilters,
		compressorNode: compNode,
		faderGain: fader,
		panPanner: panner,
		phaseGain,
		muteGain,
		meters: trackMeters,
		output: trackOut
	};
}

export function buildAudioGraph(
	ctx: BaseAudioContext,
	rawProject: Project,
	options: BuildAudioGraphOptions = {}
): BuiltAudioGraph {
	const project = migrateLegacyAudioRack(rawProject);
	const enableMeters = options.enableMeters ?? false;
	const destination = options.destination ?? ctx.destination;

	const allNodes = new Set<AudioNode>();

	// Compute PDC across project
	const pdc = computeGraphPdc(project);

	// Master Chain
	const masterInput = ctx.createGain();
	allNodes.add(masterInput);
	const masterFader = ctx.createGain();
	allNodes.add(masterFader);
	const masterDb = project.masterAudio?.gainDb ?? 0;
	masterFader.gain.value = dbToGain(masterDb);
	masterInput.connect(masterFader);

	let masterLimiter: DynamicsCompressorNode | undefined;
	let currentMasterTail: AudioNode = masterFader;
	if (typeof ctx.createDynamicsCompressor === 'function') {
		masterLimiter = ctx.createDynamicsCompressor();
		allNodes.add(masterLimiter);
		if (project.masterAudio?.limiter) {
			masterLimiter.threshold.value = -0.5;
			masterLimiter.knee.value = 0;
			masterLimiter.ratio.value = 20;
			masterLimiter.attack.value = 0.001;
			masterLimiter.release.value = 0.05;
		} else {
			masterLimiter.threshold.value = 0;
			masterLimiter.ratio.value = 1;
		}
		masterFader.connect(masterLimiter);
		currentMasterTail = masterLimiter;
	}

	let clampNode: WaveShaperNode | undefined;
	if (typeof ctx.createWaveShaper === 'function') {
		clampNode = ctx.createWaveShaper();
		allNodes.add(clampNode);
		updateMasterClampCurve(clampNode, project.masterAudio?.limiter ?? false);
		currentMasterTail.connect(clampNode);
		currentMasterTail = clampNode;
	}

	const masterOutput = ctx.createGain();
	allNodes.add(masterOutput);
	let masterMeters: AudioGraphMeterNodes | undefined;

	if (
		enableMeters &&
		typeof ctx.createAnalyser === 'function' &&
		typeof ctx.createChannelSplitter === 'function'
	) {
		masterMeters = createMeterPair(ctx);
		allNodes.add(masterMeters.analyserL);
		allNodes.add(masterMeters.analyserR);
		const splitter = ctx.createChannelSplitter(2);
		allNodes.add(splitter);
		currentMasterTail.connect(splitter);
		splitter.connect(masterMeters.analyserL, 0);
		splitter.connect(masterMeters.analyserR, 1);
	}

	let masterRackNode: AudioNode | undefined;
	const activeMasterFx = (project.masterAudio?.effects ?? []).filter(
		(e) => e && !e.bypass && e.enabled !== false
	);
	let masterRack: BuiltAudioRack | undefined;
	if (activeMasterFx.length > 0) {
		masterRack = buildAudioRack(activeMasterFx, ctx.sampleRate, 2);
		const dsp = createDspRackNode(ctx, activeMasterFx, { sampleRate: ctx.sampleRate, channels: 2 });
		if (dsp) {
			allNodes.add(dsp.node);
			currentMasterTail.connect(dsp.node);
			currentMasterTail = dsp.node;
			masterRackNode = dsp.node;
		}
	} else {
		masterRack = buildAudioRack(project.masterAudio?.effects, ctx.sampleRate, 2);
	}

	currentMasterTail.connect(masterOutput);
	masterOutput.connect(destination);

	const masterNodes: MasterAudioNodes = {
		input: masterInput,
		rackNode: masterRackNode,
		faderGain: masterFader,
		limiterNode: masterLimiter,
		clampNode,
		meters: masterMeters,
		output: masterOutput,
		rack: masterRack
	};

	// 1. Build Bus Chains
	const busNodes = new Map<string, BusAudioNodes>();
	for (const bus of project.audioBuses ?? []) {
		const busIn = ctx.createGain();
		allNodes.add(busIn);
		let busTail: AudioNode = busIn;

		// PDC Delay Node for bus
		const pdcDelay = pdc.busCompensations.get(bus.id) ?? 0;
		let delayNode: DelayNode | undefined;
		if (pdcDelay > 0 && typeof ctx.createDelay === 'function') {
			delayNode = ctx.createDelay(Math.max(1, (pdcDelay + 100) / ctx.sampleRate));
			delayNode.delayTime.value = pdcDelay / ctx.sampleRate;
			allNodes.add(delayNode);
			busTail.connect(delayNode);
			busTail = delayNode;
		}

		let busRackNode: AudioNode | undefined;
		const activeBusFx = (bus.effects ?? []).filter((e) => e && !e.bypass && e.enabled !== false);
		let busRack: BuiltAudioRack | undefined;
		if (activeBusFx.length > 0) {
			busRack = buildAudioRack(activeBusFx, ctx.sampleRate, 2);
			const dsp = createDspRackNode(ctx, activeBusFx, { sampleRate: ctx.sampleRate, channels: 2 });
			if (dsp) {
				allNodes.add(dsp.node);
				busTail.connect(dsp.node);
				busTail = dsp.node;
				busRackNode = dsp.node;
			}
		} else {
			busRack = buildAudioRack(bus.effects, ctx.sampleRate, 2);
		}

		const busFader = ctx.createGain();
		busFader.gain.value = dbToGain(bus.gainDb);
		allNodes.add(busFader);
		busTail.connect(busFader);
		busTail = busFader;

		let busPanner: StereoPannerNode | undefined;
		if (typeof ctx.createStereoPanner === 'function') {
			busPanner = ctx.createStereoPanner();
			busPanner.pan.value = bus.pan;
			allNodes.add(busPanner);
			busTail.connect(busPanner);
			busTail = busPanner;
		}

		const busMute = ctx.createGain();
		busMute.gain.value = bus.muted ? 0.0 : 1.0;
		allNodes.add(busMute);
		busTail.connect(busMute);
		busTail = busMute;

		let busMeters: AudioGraphMeterNodes | undefined;
		if (
			enableMeters &&
			typeof ctx.createAnalyser === 'function' &&
			typeof ctx.createChannelSplitter === 'function'
		) {
			busMeters = createMeterPair(ctx);
			allNodes.add(busMeters.analyserL);
			allNodes.add(busMeters.analyserR);
			const splitter = ctx.createChannelSplitter(2);
			allNodes.add(splitter);
			busTail.connect(splitter);
			splitter.connect(busMeters.analyserL, 0);
			splitter.connect(busMeters.analyserR, 1);
		}

		const busOut = ctx.createGain();
		allNodes.add(busOut);
		busTail.connect(busOut);

		busNodes.set(bus.id, {
			input: busIn,
			delayNode,
			rackNode: busRackNode,
			faderGain: busFader,
			panPanner: busPanner,
			muteGain: busMute,
			meters: busMeters,
			output: busOut,
			rack: busRack
		});
	}

	// Connect buses to output target (master or downstream bus)
	for (const bus of project.audioBuses ?? []) {
		const bNode = busNodes.get(bus.id);
		if (!bNode) continue;
		if (bus.output === 'master') {
			bNode.output.connect(masterInput);
		} else {
			const targetBus = busNodes.get(bus.output);
			if (targetBus) {
				bNode.output.connect(targetBus.input);
			} else {
				bNode.output.connect(masterInput);
			}
		}
	}

	// 2. Build Track Chains
	const trackNodes = new Map<string, TrackAudioNodes>();
	const audibleTracks = resolveAudibleTracks(project.tracks);

	for (const track of project.tracks) {
		if (track.kind !== 'audio') continue;
		const trackDest =
			track.audio?.output && track.audio.output !== 'master' && busNodes.has(track.audio.output)
				? busNodes.get(track.audio.output)!.input
				: masterInput;

		const pdcDelay = pdc.trackCompensations.get(track.id) ?? 0;
		const nodes = buildSingleTrackChain(
			ctx,
			track,
			trackDest,
			audibleTracks.has(track.id),
			enableMeters,
			pdcDelay,
			allNodes
		);

		// Connect Auxiliary Sends
		if (track.audio?.sends && track.audio.sends.length > 0) {
			const sendGains = new Map<string, GainNode>();
			for (const send of track.audio.sends) {
				if (!send || !send.enabled) continue;
				const targetBus = busNodes.get(send.busId);
				if (!targetBus) continue;

				const sendGain = ctx.createGain();
				allNodes.add(sendGain);
				sendGain.gain.value = dbToGain(send.levelDb);
				// Pre vs post-fader send
				const sourceNode = send.pre ? nodes.input : nodes.faderGain;
				sourceNode.connect(sendGain);
				sendGain.connect(targetBus.input);
				sendGains.set(send.busId, sendGain);
			}
			nodes.sendGains = sendGains;
		}

		if (!nodes.rack) {
			nodes.rack = buildAudioRack(track.audio?.effects, ctx.sampleRate, 2);
		}
		trackNodes.set(track.id, nodes);
	}

	const activeSources: AudioBufferSourceNode[] = [];

	const scheduleClip = (
		clip: Clip,
		track: Track,
		whenSeconds: number,
		offsetSeconds: number,
		durationSeconds: number,
		buffer?: AudioBuffer,
		targetNode?: AudioNode
	): AudioBufferSourceNode | null => {
		const destInput = targetNode ?? trackNodes.get(track.id)?.input;
		if (!destInput || !buffer) return null;

		let playBuffer = buffer;
		let playRate = clip.speed ?? 1;

		// Remapped or reverse audio
		if (clip.timeRemap || clip.speed !== 1 || clip.maintainPitch !== undefined) {
			const sourceChannels: Float32Array[] = [];
			for (let c = 0; c < buffer.numberOfChannels; c++) {
				sourceChannels.push(buffer.getChannelData(c));
			}
			const remapped = renderRemappedAudio({
				clip,
				sourceChannels,
				sourceSampleRate: buffer.sampleRate,
				timelineStartTicks: Math.max(0, offsetSeconds * 1_000_000),
				timelineDurationTicks: Math.max(1, durationSeconds * 1_000_000)
			});
			if (remapped.channels[0]?.length) {
				const numChan = remapped.channels.length;
				playBuffer = ctx.createBuffer(numChan, remapped.channels[0].length, remapped.sampleRate);
				for (let c = 0; c < numChan; c++) {
					playBuffer.copyToChannel(remapped.channels[c] as unknown as Float32Array<ArrayBuffer>, c);
				}
				playRate = 1.0;
				offsetSeconds = 0;
			}
		}

		// Apply clip-level DSP rack if present
		if (clip.audioEffects && clip.audioEffects.length > 0) {
			const activeFx = clip.audioEffects.filter((e) => !e.bypass);
			if (activeFx.length > 0) {
				const rack = buildAudioRack(activeFx, ctx.sampleRate, playBuffer.numberOfChannels);
				const numChannels = playBuffer.numberOfChannels;
				const frameCount = playBuffer.length;
				const cloned = ctx.createBuffer(numChannels, frameCount, playBuffer.sampleRate);
				const channels: Float32Array[] = [];
				for (let c = 0; c < numChannels; c++) {
					const srcData = playBuffer.getChannelData(c);
					const dstData = cloned.getChannelData(c);
					dstData.set(srcData);
					channels.push(dstData);
				}
				rack.process(channels, frameCount);
				playBuffer = cloned;
			}
		}

		// Clip-level chain: source -> clipGain -> clipPan -> destInput
		const source = ctx.createBufferSource();
		source.buffer = playBuffer;
		source.playbackRate.value = playRate;

		const clipGain = ctx.createGain();
		const volProp = clip.properties?.['audio.volume'];
		const volDb = volProp && 'value' in volProp ? Number(volProp.value) || 0 : 0;
		const baseGain = volProp ? dbToGain(volDb) : (clip.volume ?? 1);
		clipGain.gain.value = baseGain;

		// Fade automation if present
		if (clip.fadeInUs || clip.fadeOutUs) {
			const fadeCurve = clip.fadeCurve ?? 'equalPower';
			const steps = 32;
			const gainValues = new Float32Array(steps);
			for (let i = 0; i < steps; i++) {
				const relTimeTicks = (i / (steps - 1)) * clip.duration;
				gainValues[i] =
					baseGain *
					fadeGain(relTimeTicks, clip.duration, clip.fadeInUs ?? 0, clip.fadeOutUs ?? 0, fadeCurve);
			}
			clipGain.gain.setValueCurveAtTime(gainValues, whenSeconds, durationSeconds);
		}

		let clipTail: AudioNode = clipGain;
		if (typeof ctx.createStereoPanner === 'function') {
			const clipPanner = ctx.createStereoPanner();
			const panProp = clip.properties?.['audio.pan'];
			const panVal = panProp && 'value' in panProp ? Number(panProp.value) || 0 : 0;
			clipPanner.pan.value = panVal;
			clipGain.connect(clipPanner);
			clipTail = clipPanner;
		}

		source.connect(clipGain);
		clipTail.connect(destInput);

		source.start(whenSeconds, offsetSeconds, durationSeconds);
		activeSources.push(source);
		return source;
	};

	const scheduleProject = async (
		timeRange?: { startUs: number; durationUs: number },
		providedBuffers?: ReadonlyMap<string, AudioBuffer>
	): Promise<AudioBufferSourceNode[]> => {
		const startUs = timeRange?.startUs ?? 0;
		const durationUs = timeRange?.durationUs ?? 100_000_000;
		const endUs = startUs + durationUs;
		const sources: AudioBufferSourceNode[] = [];

		for (const track of project.tracks) {
			if (track.kind !== 'audio') continue;
			for (const clip of track.clips) {
				const clipEndUs = clip.start + clip.duration;
				if (clipEndUs <= startUs || clip.start >= endUs) continue;

				const overlapStartUs = Math.max(startUs, clip.start);
				const overlapEndUs = Math.min(endUs, clipEndUs);
				const overlapDurUs = overlapEndUs - overlapStartUs;

				const whenSec = (overlapStartUs - startUs) / 1_000_000;
				const offsetSec =
					(clip.sourceIn + (overlapStartUs - clip.start) * (clip.speed || 1)) / 1_000_000;
				const durSec = overlapDurUs / 1_000_000;

				// Handle sequence clips
				if (clip.source?.type === 'sequence') {
					const seqId = clip.source.sequenceId;
					const { viewProject, sequenceDuration } = await import('../../core/sequences');
					const nestedView = viewProject(project, seqId);
					const isConstantSpeed1 = (clip.speed ?? 1) === 1 && !clip.timeRemap;

					if (isConstantSpeed1) {
						// LIVE SUB-GRAPH (Decision 6):
						const instanceBusIn = ctx.createGain();
						const instanceFader = ctx.createGain();
						const volProp = clip.properties?.['audio.volume'];
						const volDb = volProp && 'value' in volProp ? Number(volProp.value) || 0 : 0;
						const baseGain = volProp ? dbToGain(volDb) : (clip.volume ?? 1);
						instanceFader.gain.value = baseGain;

						if (clip.fadeInUs || clip.fadeOutUs) {
							const fadeCurve = clip.fadeCurve ?? 'equalPower';
							const steps = 32;
							const gainValues = new Float32Array(steps);
							for (let i = 0; i < steps; i++) {
								const relTimeTicks = (i / (steps - 1)) * clip.duration;
								gainValues[i] =
									baseGain *
									fadeGain(
										relTimeTicks,
										clip.duration,
										clip.fadeInUs ?? 0,
										clip.fadeOutUs ?? 0,
										fadeCurve
									);
							}
							instanceFader.gain.setValueCurveAtTime(gainValues, whenSec, durSec);
						}

						instanceBusIn.connect(instanceFader);
						let instanceTail: AudioNode = instanceFader;

						if (typeof ctx.createStereoPanner === 'function') {
							const instancePanner = ctx.createStereoPanner();
							const panProp = clip.properties?.['audio.pan'];
							const panVal = panProp && 'value' in panProp ? Number(panProp.value) || 0 : 0;
							instancePanner.pan.value = panVal;
							instanceFader.connect(instancePanner);
							instanceTail = instancePanner;
						}

						const hostTrackNode = trackNodes.get(track.id);
						if (hostTrackNode) {
							instanceTail.connect(hostTrackNode.input);
						}

						// Build nested track chains routed into instanceBusIn
						const nestedAudible = resolveAudibleTracks(nestedView.tracks);
						const nestedTrackNodes = new Map<string, TrackAudioNodes>();
						for (const nTrack of nestedView.tracks) {
							if (nTrack.kind !== 'audio') continue;
							const nNode = buildSingleTrackChain(
								ctx,
								nTrack,
								instanceBusIn,
								nestedAudible.has(nTrack.id),
								enableMeters
							);
							nestedTrackNodes.set(nTrack.id, nNode);
						}

						const nestedWindowStartUs = clip.sourceIn + (overlapStartUs - clip.start);
						const nestedWindowEndUs = nestedWindowStartUs + overlapDurUs;

						for (const nTrack of nestedView.tracks) {
							if (nTrack.kind !== 'audio') continue;
							const nNode = nestedTrackNodes.get(nTrack.id);
							if (!nNode) continue;

							for (const nClip of nTrack.clips) {
								const nClipEndUs = nClip.start + nClip.duration;
								if (nClipEndUs <= nestedWindowStartUs || nClip.start >= nestedWindowEndUs) continue;

								let nBuffer = providedBuffers?.get(nClip.assetId ?? '');
								const ctxWithDecode = ctx as unknown as {
									decodeAudioData?: (b: ArrayBuffer) => Promise<AudioBuffer>;
								};
								if (
									!nBuffer &&
									nClip.assetId &&
									typeof ctxWithDecode.decodeAudioData === 'function'
								) {
									nBuffer =
										(await defaultAudioDecodeCache.getOrDecode(
											nClip.assetId,
											project,
											ctxWithDecode as Pick<AudioContext, 'decodeAudioData'>
										)) ?? undefined;
								}
								if (!nBuffer) continue;

								const nOverlapStartUs = Math.max(nestedWindowStartUs, nClip.start);
								const nOverlapEndUs = Math.min(nestedWindowEndUs, nClipEndUs);
								const nOverlapDurUs = nOverlapEndUs - nOverlapStartUs;

								const nWhenSec = whenSec + (nOverlapStartUs - nestedWindowStartUs) / 1_000_000;
								const nOffsetSec =
									(nClip.sourceIn + (nOverlapStartUs - nClip.start) * (nClip.speed || 1)) /
									1_000_000;
								const nDurSec = nOverlapDurUs / 1_000_000;

								const nSrc = scheduleClip(
									nClip,
									nTrack,
									nWhenSec,
									nOffsetSec,
									nDurSec,
									nBuffer,
									nNode.input
								);
								if (nSrc) sources.push(nSrc);
							}
						}
						continue;
					} else {
						// BOUNCE PATH for remapped, speed != 1, or reverse
						const cacheKey = `${seqId}:${clip.id}:${clip.speed ?? 1}:${clip.sourceIn}:${clip.duration}`;
						let buffer = bouncedSequenceAudioCache.get(cacheKey);
						const seqDur = sequenceDuration(project, seqId);
						if (!buffer && seqDur > 0) {
							buffer = await renderOfflineAudio({
								project: nestedView,
								durationUs: seqDur,
								sampleRate: ctx.sampleRate
							});
							bouncedSequenceAudioCache.set(cacheKey, buffer);
						}
						if (!buffer) continue;
						const srcNode = scheduleClip(clip, track, whenSec, offsetSec, durSec, buffer);
						if (srcNode) sources.push(srcNode);
						continue;
					}
				}

				// Asset clip
				let buffer: AudioBuffer | undefined;
				if (clip.assetId) {
					buffer = providedBuffers?.get(clip.assetId);
					const ctxWithDecode = ctx as unknown as {
						decodeAudioData?: (b: ArrayBuffer) => Promise<AudioBuffer>;
					};
					if (!buffer && typeof ctxWithDecode.decodeAudioData === 'function') {
						buffer =
							(await defaultAudioDecodeCache.getOrDecode(
								clip.assetId,
								project,
								ctxWithDecode as Pick<AudioContext, 'decodeAudioData'>
							)) ?? undefined;
					}
				}
				if (!buffer) continue;

				const srcNode = scheduleClip(clip, track, whenSec, offsetSec, durSec, buffer);
				if (srcNode) sources.push(srcNode);
			}
		}
		return sources;
	};

	const getTrackMeterLevels = (trackId: string) => {
		const node = trackNodes.get(trackId);
		if (!node?.meters) return { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
		const l = calculateMeterLevels(node.meters.analyserL);
		const r = calculateMeterLevels(node.meters.analyserR);
		return { peakL: l.peak, peakR: r.peak, rmsL: l.rms, rmsR: r.rms };
	};

	const getBusMeterLevels = (busId: string) => {
		const node = busNodes.get(busId);
		if (!node?.meters) return { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
		const l = calculateMeterLevels(node.meters.analyserL);
		const r = calculateMeterLevels(node.meters.analyserR);
		return { peakL: l.peak, peakR: r.peak, rmsL: l.rms, rmsR: r.rms };
	};

	const getMasterMeterLevels = () => {
		if (!masterNodes.meters) return { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
		const l = calculateMeterLevels(masterNodes.meters.analyserL);
		const r = calculateMeterLevels(masterNodes.meters.analyserR);
		return { peakL: l.peak, peakR: r.peak, rmsL: l.rms, rmsR: r.rms };
	};

	const safeSetTarget = (param: AudioParam, value: number, timeConstant = 0.015) => {
		const now = ctx.currentTime;
		if (typeof param.setTargetAtTime === 'function') {
			param.setTargetAtTime(value, now, timeConstant);
		} else if (typeof param.setValueAtTime === 'function') {
			param.setValueAtTime(value, now);
		} else {
			param.value = value;
		}
	};

	const updateTrackParams = (trackId: string, audio: TrackAudio, audible: boolean) => {
		const node = trackNodes.get(trackId);
		if (!node) return;
		safeSetTarget(node.faderGain.gain, dbToGain(audio.gainDb + (audio.trimDb ?? 0)));
		if (node.panPanner) {
			safeSetTarget(node.panPanner.pan, audio.pan);
		}
		safeSetTarget(node.muteGain.gain, audible ? 1.0 : 0.0);

		// Smooth EQ updates
		if (node.eqNodes && node.eqNodes.length > 0) {
			const eqEnabled = audio.eq?.enabled ?? false;
			const bands = audio.eq?.bands ?? [];
			for (let i = 0; i < node.eqNodes.length; i++) {
				const filter = node.eqNodes[i]!;
				const band = bands[i];
				if (band) {
					filter.type = band.type;
					safeSetTarget(filter.frequency, band.frequencyHz);
					safeSetTarget(filter.gain, eqEnabled ? band.gainDb : 0);
					safeSetTarget(filter.Q, band.q);
				} else {
					safeSetTarget(filter.gain, 0);
				}
			}
		}

		if (node.phaseGain && audio.phaseInvert !== undefined) {
			safeSetTarget(node.phaseGain.gain, audio.phaseInvert ? -1.0 : 1.0);
		}

		// Smooth Dynamics Compressor updates
		if (node.compressorNode) {
			const compEnabled = audio.compressor?.enabled ?? false;
			const comp = audio.compressor;
			if (compEnabled && comp) {
				safeSetTarget(node.compressorNode.threshold, comp.thresholdDb);
				safeSetTarget(node.compressorNode.ratio, comp.ratio);
				safeSetTarget(node.compressorNode.attack, comp.attackMs / 1000);
				safeSetTarget(node.compressorNode.release, comp.releaseMs / 1000);
				safeSetTarget(node.compressorNode.knee, comp.kneeDb);
			} else {
				safeSetTarget(node.compressorNode.threshold, 0);
				safeSetTarget(node.compressorNode.ratio, 1);
			}
		}
	};

	const updateMasterParams = (gainDb: number, limiter?: boolean) => {
		safeSetTarget(masterNodes.faderGain.gain, dbToGain(gainDb));
		if (masterNodes.limiterNode && limiter !== undefined) {
			safeSetTarget(masterNodes.limiterNode.threshold, limiter ? -0.5 : 0);
			safeSetTarget(masterNodes.limiterNode.ratio, limiter ? 20 : 1);
		}
		if (masterNodes.clampNode && limiter !== undefined) {
			updateMasterClampCurve(masterNodes.clampNode, limiter);
		}
	};

	const updateBusParams = (busId: string, gainDb: number, pan: number, muted: boolean) => {
		const node = busNodes.get(busId);
		if (!node) return;
		safeSetTarget(node.faderGain.gain, dbToGain(gainDb));
		if (node.panPanner) {
			safeSetTarget(node.panPanner.pan, pan);
		}
		safeSetTarget(node.muteGain.gain, muted ? 0.0 : 1.0);
	};

	const getNodeCount = () => allNodes.size;

	const dispose = () => {
		for (const src of activeSources) {
			try {
				src.stop();
				src.disconnect();
			} catch {}
		}
		activeSources.length = 0;
		for (const node of allNodes) {
			try {
				node.disconnect();
			} catch {}
		}
		allNodes.clear();
		trackNodes.clear();
		busNodes.clear();
	};

	return {
		trackNodes,
		busNodes,
		masterNodes,
		scheduleClip,
		scheduleProject,
		getTrackMeterLevels,
		getBusMeterLevels,
		getMasterMeterLevels,
		updateTrackParams,
		updateMasterParams,
		updateBusParams,
		getNodeCount,
		dispose
	};
}
