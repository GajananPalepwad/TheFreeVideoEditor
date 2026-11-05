import type { ActiveAudio } from '../../core/playback';
import type { AssetId, Clip, Project, TrackAudio } from '../../core/types';
import type { MediaPool } from '../playback/mediaPool';
import { buildAudioGraph, type BuiltAudioGraph } from './graph';
import { resolveAudibleTracks } from '../../core/audioMath';
import { createDspRackNode, ensureDspWorklet, type DspRackNode } from './dspWorklet';

const AUDIO_RAMP_SECONDS = 0.015;
const AUDIO_VOLUME_KEY = 'tfve:playback-volume';
const AUDIO_MUTED_KEY = 'tfve:playback-muted';

export interface AudioControllerOptions {
	createContext?: () => AudioContext;
	onError?: (error: Error, assetId?: AssetId) => void;
	onStateChange?: (state: AudioContextState) => void;
	onWorkletError?: (error: string) => void;
}

interface ConnectedAudio {
	clipId: Clip['id'];
	assetId: AssetId;
	trackId: string;
	element: HTMLAudioElement;
	source: MediaElementAudioSourceNode;
	clipGain: GainNode;
	clipPan?: StereoPannerNode;
	clipRackNode?: AudioNode;
	clipDspNode?: DspRackNode;
	volume: number;
}

export class AudioGraphController {
	private context: AudioContext | null = null;
	private graph: BuiltAudioGraph | null = null;
	private currentProject: Project | null = null;
	private readonly connected = new Map<HTMLAudioElement, ConnectedAudio>();
	private readonly sourceByElement = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
	private readonly createContext: () => AudioContext;
	private masterVolume = 1;
	private isMutedState = false;
	private disposed = false;
	private unavailable = false;
	private syncRevision = 0;
	private topologyKey = '';
	private readonly scriptProcessors = new Set<ScriptProcessorNode>();
	private mockMasterGain: GainNode | null = null;
	private mockAnalyser: AnalyserNode | null = null;
	private workletError: string | null = null;

	constructor(
		private readonly pool: Pick<MediaPool, 'getAudioElement'>,
		private readonly options: AudioControllerOptions = {}
	) {
		this.createContext = options.createContext ?? (() => new AudioContext());
		this.masterVolume = readNumberPreference(AUDIO_VOLUME_KEY, 1, (err) => this.reportError(err));
		this.isMutedState = readBooleanPreference(AUDIO_MUTED_KEY, false, (err) =>
			this.reportError(err)
		);
	}

	get volume(): number {
		return this.masterVolume;
	}

	get isMuted(): boolean {
		return this.isMutedState;
	}

	get debugContextState(): AudioContextState | 'uninitialized' {
		return this.context?.state ?? 'uninitialized';
	}

	get debugMasterAnalyser(): AnalyserNode | null {
		return this.graph?.masterNodes.meters?.analyserL ?? null;
	}

	get debugMasterAnalysers(): { analyserL: AnalyserNode; analyserR: AnalyserNode } | null {
		const meters = this.graph?.masterNodes.meters;
		if (!meters) return null;
		return { analyserL: meters.analyserL, analyserR: meters.analyserR };
	}

	getWorkletError(): string | null {
		return this.workletError;
	}

	getConnectedCount(): number {
		return this.connected.size;
	}

	getNodeCount(): number {
		let count = this.graph?.getNodeCount?.() ?? 0;
		// Count clip nodes
		for (const conn of this.connected.values()) {
			count += 2; // sourceNode + clipGain
			if (conn.clipPan) count += 1;
			if (conn.clipRackNode) count += 1;
		}
		return count;
	}

	async unlock(): Promise<void> {
		if (this.disposed || this.unavailable) return;
		try {
			const context = this.ensureContext();
			await ensureDspWorklet(context);
			if (context.state === 'suspended') {
				await context.resume();
				this.options.onStateChange?.(context.state);
			}
		} catch (error) {
			this.unavailable = true;
			this.reportError(error);
		}
	}

	private computeTopologyKey(project: Project): string {
		const formatEffect = (e: {
			id: string;
			type: string;
			bypass?: boolean;
			enabled?: boolean;
			mix?: number;
			params?: Record<string, unknown>;
		}) =>
			`${e.id}:${e.type}:${e.bypass ?? false}:${e.enabled !== false}:${e.mix ?? 1}:${JSON.stringify(e.params ?? {})}`;

		const trackKeys = project.tracks.map((t) => {
			const effectsKey = (t.audio?.effects ?? []).map(formatEffect).join(',');
			const clipEffectsKey = t.clips
				.map((c) => `${c.id}:${(c.audioEffects ?? []).map(formatEffect).join(',')}`)
				.join(';');
			return `${t.id}:${t.kind}:${t.audio?.output ?? 'master'}:${t.audio?.trimDb ?? 0}:[${effectsKey}]:[${clipEffectsKey}]`;
		});
		const busKeys = (project.audioBuses ?? []).map((b) => {
			const effectsKey = (b.effects ?? []).map(formatEffect).join(',');
			return `${b.id}:${b.output}:[${effectsKey}]`;
		});
		const masterEffectsKey = (project.masterAudio?.effects ?? []).map(formatEffect).join(',');
		return `${trackKeys.join('|')}||${busKeys.join('|')}||${masterEffectsKey}`;
	}

	updateProject(project: Project): void {
		if (this.disposed) return;
		this.currentProject = project;

		if (!this.context) return; // Will build on first playback / context init

		const nextTopologyKey = this.computeTopologyKey(project);
		if (!this.graph || this.topologyKey !== nextTopologyKey) {
			// Structural change: rebuild graph and re-route active elements cleanly
			this.rebuildGraph(project, nextTopologyKey);
		} else {
			// Parameter-only diff: smooth AudioParam scheduling without rebuild
			this.applyParameterDiffs(project);
		}
	}

	private applyParameterDiffs(project: Project): void {
		if (!this.graph) return;
		const audibleTracks = resolveAudibleTracks(project.tracks);

		// 1. Update tracks
		for (const track of project.tracks) {
			if (track.kind !== 'audio') continue;
			const audio: TrackAudio = track.audio ?? { gainDb: 0, pan: 0, solo: false };
			const isAudible = audibleTracks.has(track.id) && !track.muted;
			this.graph.updateTrackParams(track.id, audio, isAudible);
		}

		// 2. Update master
		const masterGainDb = this.isMutedState
			? -96
			: (project.masterAudio?.gainDb ?? 0) +
				(this.masterVolume < 1 ? 20 * Math.log10(Math.max(0.0001, this.masterVolume)) : 0);
		this.graph.updateMasterParams(masterGainDb, project.masterAudio?.limiter ?? false);

		// 3. Update buses
		for (const bus of project.audioBuses ?? []) {
			this.graph.updateBusParams?.(bus.id, bus.gainDb, bus.pan, bus.muted);
		}
	}

	private routeClipTail(
		conn: ConnectedAudio,
		project: Project,
		targetIn?: AudioNode,
		isNew = false
	): void {
		const context = this.context;
		if (!context) return;

		if (!isNew) {
			// Disconnect previous DSP node if any and remove reference
			if (conn.clipDspNode) {
				conn.clipDspNode.disconnect();
				if (conn.clipRackNode) {
					this.scriptProcessors.delete(conn.clipRackNode as ScriptProcessorNode);
				}
				conn.clipRackNode = undefined;
				conn.clipDspNode = undefined;
			} else if (conn.clipRackNode) {
				try {
					conn.clipRackNode.disconnect();
				} catch {}
				this.scriptProcessors.delete(conn.clipRackNode as ScriptProcessorNode);
				conn.clipRackNode = undefined;
			}

			if (conn.clipPan) {
				try {
					conn.clipPan.disconnect();
				} catch {}
			}
			try {
				conn.clipGain.disconnect();
			} catch {}
		}

		// Reconnect clipGain to clipPan
		let clipTail: AudioNode = conn.clipGain;
		if (conn.clipPan) {
			conn.clipGain.connect(conn.clipPan);
			clipTail = conn.clipPan;
		}

		const fallbackTarget =
			this.graph?.masterNodes.input ?? this.mockMasterGain ?? context.destination;

		if (typeof context.sampleRate !== 'number') {
			try {
				clipTail.connect(targetIn ?? fallbackTarget);
			} catch {}
			return;
		}

		// Build and insert clip DSP rack if active audio effects exist
		const track = project.tracks.find((t) => t.id === conn.trackId);
		const clip = track?.clips.find((c) => c.id === conn.clipId);
		const dspRack = createDspRackNode(context, clip?.audioEffects, {
			sampleRate: context.sampleRate,
			channels: 2
		});

		if (dspRack) {
			if (dspRack.type === 'script-processor') {
				this.scriptProcessors.add(dspRack.node as ScriptProcessorNode);
			}
			clipTail.connect(dspRack.node);
			clipTail = dspRack.node;
			conn.clipRackNode = dspRack.node;
			conn.clipDspNode = dspRack;
		}

		try {
			clipTail.connect(targetIn ?? fallbackTarget);
		} catch {}
	}

	private rebuildGraph(project: Project, topologyKey: string): void {
		const context = this.ensureContext();
		if (typeof context.sampleRate !== 'number') return;
		const oldGraph = this.graph;

		const newGraph = buildAudioGraph(context, project, { enableMeters: true });
		this.graph = newGraph;
		this.topologyKey = topologyKey;

		// Re-route active media elements into new graph track inputs with updated effect chains
		for (const conn of this.connected.values()) {
			const targetIn = newGraph.trackNodes.get(conn.trackId)?.input ?? newGraph.masterNodes.input;
			this.routeClipTail(conn, project, targetIn);
		}

		// Cleanly dispose old graph
		if (oldGraph) {
			oldGraph.dispose();
		}
	}

	async sync(
		sources: readonly ActiveAudio[],
		project: Project,
		playing: boolean,
		rate: number
	): Promise<void> {
		if (this.disposed) return;
		const revision = ++this.syncRevision;

		if (!playing || rate !== 1 || sources.length === 0) {
			for (const audio of this.connected.values()) {
				ramp(audio.clipGain.gain, 0, this.context?.currentTime ?? 0);
				audio.volume = 0;
				audio.element.pause();
			}
			return;
		}

		await this.unlock();
		if (this.disposed || revision !== this.syncRevision) return;
		const context = this.context;
		if (!context) return;

		this.updateProject(project);

		const active = new Set<HTMLAudioElement>();
		for (const source of sources) {
			const asset = project.assets[source.assetId];
			const element = this.pool.getAudioElement(source);
			if (!asset || !element) continue;
			active.add(element);

			const track = project.tracks.find((t) => t.id === source.trackId);
			const clip = track?.clips.find((c) => c.id === source.clipId);
			const panProp = clip?.properties?.['audio.pan'];
			const panVal = panProp && 'value' in panProp ? Number(panProp.value) || 0 : 0;

			const connection = this.connectElement(
				element,
				source.clipId,
				asset.id,
				source.trackId,
				source.volume,
				panVal
			);

			if (connection.volume !== source.volume) {
				ramp(connection.clipGain.gain, source.volume, context.currentTime);
				connection.volume = source.volume;
			}
			if (connection.clipPan && connection.clipPan.pan.value !== panVal) {
				connection.clipPan.pan.setValueAtTime(panVal, context.currentTime);
			}

			element.volume = 1;
			element.playbackRate = 1;
			if (element.paused) {
				void element.play().catch((error: unknown) => {
					if (isInterruptedPlay(error)) return;
					this.reportError(error, asset.id);
				});
			}
		}

		for (const [element, audio] of this.connected) {
			if (active.has(element)) continue;
			ramp(audio.clipGain.gain, 0, context.currentTime);
			audio.volume = 0;
			element.pause();
		}
	}

	private connectElement(
		element: HTMLAudioElement,
		clipId: Clip['id'],
		assetId: AssetId,
		trackId: string,
		volume: number,
		pan: number
	): ConnectedAudio {
		const context = this.ensureContext();
		const graph = this.graph;
		const targetIn = graph?.trackNodes.get(trackId)?.input ?? graph?.masterNodes.input;

		const existing = this.connected.get(element);
		if (existing) {
			const trackChanged = existing.trackId !== trackId;
			const clipChanged = existing.clipId !== clipId;
			existing.clipId = clipId;
			existing.assetId = assetId;
			existing.trackId = trackId;
			if ((trackChanged || clipChanged) && this.currentProject) {
				this.routeClipTail(existing, this.currentProject, targetIn);
			}
			return existing;
		}

		let source = this.sourceByElement.get(element);
		if (!source) {
			source = context.createMediaElementSource(element);
			this.sourceByElement.set(element, source);
		}

		const clipGain = context.createGain();
		clipGain.gain.value = volume;
		source.connect(clipGain);

		let clipPan: StereoPannerNode | undefined;
		if (typeof context.createStereoPanner === 'function') {
			clipPan = context.createStereoPanner();
			clipPan.pan.value = pan;
		}

		const conn: ConnectedAudio = {
			clipId,
			assetId,
			trackId,
			element,
			source,
			clipGain,
			clipPan,
			volume: 0
		};
		this.connected.set(element, conn);

		if (this.currentProject) {
			this.routeClipTail(conn, this.currentProject, targetIn, true);
		} else {
			clipGain.connect(targetIn ?? context.destination);
		}

		return conn;
	}

	setVolume(volume: number): void {
		if (!Number.isFinite(volume)) throw new RangeError('Master volume must be finite.');
		this.masterVolume = Math.max(0, Math.min(1, volume));
		this.persist(AUDIO_VOLUME_KEY, String(this.masterVolume));
		if (this.mockMasterGain) {
			ramp(
				this.mockMasterGain.gain,
				this.isMutedState ? 0 : this.masterVolume,
				this.context?.currentTime ?? 0
			);
		}
		if (this.currentProject) this.applyParameterDiffs(this.currentProject);
	}

	setMuted(muted: boolean): void {
		this.isMutedState = muted;
		this.persist(AUDIO_MUTED_KEY, String(muted));
		if (this.mockMasterGain) {
			ramp(this.mockMasterGain.gain, muted ? 0 : this.masterVolume, this.context?.currentTime ?? 0);
		}
		if (this.currentProject) this.applyParameterDiffs(this.currentProject);
	}

	getLevel(): number {
		if (this.mockAnalyser) {
			const samples = new Float32Array(this.mockAnalyser.fftSize);
			this.mockAnalyser.getFloatTimeDomainData(samples);
			let squareSum = 0;
			for (const sample of samples) squareSum += sample * sample;
			return Math.sqrt(squareSum / Math.max(1, samples.length));
		}
		if (!this.graph?.masterNodes.meters) return 0;
		const m = this.graph.getMasterMeterLevels();
		return Math.max(m.rmsL, m.rmsR);
	}

	getTrackMeterLevels(trackId: string): {
		peakL: number;
		peakR: number;
		rmsL: number;
		rmsR: number;
	} {
		return this.graph?.getTrackMeterLevels(trackId) ?? { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
	}

	getMasterMeterLevels(): { peakL: number; peakR: number; rmsL: number; rmsR: number } {
		return this.graph?.getMasterMeterLevels() ?? { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
	}

	getBusMeterLevels(busId: string): { peakL: number; peakR: number; rmsL: number; rmsR: number } {
		return this.graph?.getBusMeterLevels(busId) ?? { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
	}

	releaseElement(element: HTMLAudioElement): void {
		const connection = this.connected.get(element);
		if (!connection) return;
		element.pause();
		if (connection.clipDspNode) {
			connection.clipDspNode.disconnect();
			if (connection.clipRackNode) {
				this.scriptProcessors.delete(connection.clipRackNode as ScriptProcessorNode);
			}
			connection.clipDspNode = undefined;
			connection.clipRackNode = undefined;
		} else if (connection.clipRackNode) {
			try {
				connection.clipRackNode.disconnect();
			} catch {}
			this.scriptProcessors.delete(connection.clipRackNode as ScriptProcessorNode);
			connection.clipRackNode = undefined;
		}
		if (connection.clipPan) {
			try {
				connection.clipPan.disconnect();
			} catch {}
		}
		try {
			connection.clipGain.disconnect();
		} catch {}
		try {
			connection.source.disconnect();
		} catch {}
		this.connected.delete(element);
		this.sourceByElement.delete(element);
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		this.syncRevision += 1;
		for (const element of Array.from(this.connected.keys())) {
			this.releaseElement(element);
		}
		this.scriptProcessors.clear();
		if (this.graph) {
			this.graph.dispose();
			this.graph = null;
		}
		this.mockMasterGain = null;
		this.mockAnalyser = null;
		const context = this.context;
		this.context = null;
		if (context && context.state !== 'closed') {
			await context.close();
		}
	}

	private ensureContext(): AudioContext {
		if (this.context) return this.context;
		const context = this.createContext();
		if (typeof context.addEventListener === 'function') {
			context.addEventListener('statechange', () => {
				this.options.onStateChange?.(context.state);
			});
		}
		this.context = context;
		void ensureDspWorklet(context).then((loaded) => {
			if (loaded && !this.disposed && this.currentProject) {
				const nextTopology = this.computeTopologyKey(this.currentProject);
				this.rebuildGraph(this.currentProject, nextTopology);
			}
		});
		if (typeof context.sampleRate !== 'number') {
			this.mockMasterGain = context.createGain();
			this.mockMasterGain.gain.value = this.isMutedState ? 0 : this.masterVolume;
			if (typeof context.createAnalyser === 'function') {
				this.mockAnalyser = context.createAnalyser();
				this.mockAnalyser.fftSize = 256;
				this.mockMasterGain.connect(this.mockAnalyser);
				this.mockAnalyser.connect(context.destination);
			} else {
				this.mockMasterGain.connect(context.destination);
			}
			return context;
		}
		if (this.currentProject) {
			this.rebuildGraph(this.currentProject, this.computeTopologyKey(this.currentProject));
		}
		return context;
	}

	private persist(key: string, value: string): void {
		try {
			localStorage.setItem(key, value);
		} catch (error) {
			this.reportError(
				new Error('Playback preference could not be saved in local storage.', { cause: error })
			);
		}
	}

	private reportError(error: unknown, assetId?: AssetId): void {
		this.options.onError?.(
			error instanceof Error ? error : new Error('Audio playback failed.'),
			assetId
		);
	}
}

function isInterruptedPlay(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function ramp(parameter: AudioParam, value: number, currentTime: number): void {
	parameter.cancelScheduledValues(currentTime);
	parameter.setValueAtTime(parameter.value, currentTime);
	parameter.linearRampToValueAtTime(value, currentTime + AUDIO_RAMP_SECONDS);
}

function readNumberPreference(
	key: string,
	fallback: number,
	onError: (error: Error) => void
): number {
	try {
		const stored = localStorage.getItem(key);
		if (stored === null) return fallback;
		const value = Number(stored);
		return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
	} catch (error) {
		onError(
			new Error('Playback preferences could not be read from local storage.', { cause: error })
		);
		return fallback;
	}
}

function readBooleanPreference(
	key: string,
	fallback: boolean,
	onError: (error: Error) => void
): boolean {
	try {
		const stored = localStorage.getItem(key);
		return stored === 'true' ? true : stored === 'false' ? false : fallback;
	} catch (error) {
		onError(
			new Error('Playback preferences could not be read from local storage.', { cause: error })
		);
		return fallback;
	}
}
