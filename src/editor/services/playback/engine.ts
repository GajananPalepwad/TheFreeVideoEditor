import { nextBoundary, resolveFrame, type ActiveLayer } from '../../core/playback';
import { framesToTicks, ticksToTimecode, timelineDuration } from '../../core';
import { viewProject } from '../../core/sequences/access';
import type { AssetId, ClipId, Project, Time, TrackId } from '../../core';
import type { EditorStore } from '../../state/store';
import { AudioEngine } from './audioEngine';
import type { FrameSource, LastGoodFrames } from './compositor';
import {
	createFrameRenderer,
	type RendererKind,
	type FrameRenderer,
	type RenderStats
} from '../render';
import { extractCanvasScopeFrame, type ScopeFrameData } from '../render/passes/scopes';
import { createPlaybackClock, type PlaybackRate } from './clock';
import { MediaPool } from './mediaPool';
import { TextRasterCache } from '../render/text/cache';
import { ensureFontLoaded, isFontLoaded, onFontLoaded } from '../render/text/fontLoader';
import { ensureLutLoaded, getParsedLut } from '../media/lutCache';
import { rasterizeShape } from '../render/shapes/shapeRasterizer';

export interface PlaybackSnapshot {
	time: Time;
	duration: Time;
	playing: boolean;
	rate: PlaybackRate;
	looping: boolean;
	volume: number;
	muted: boolean;
	meter: number;
	missing: AssetId[];
	loading: boolean;
	error: string;
	proxyActive?: boolean;
}

export interface PlaybackDebugStats {
	elementCount: number;
	rafRunning: boolean;
	audioContextState: AudioContextState | 'uninitialized';
	meter: number;
	time: Time;
	duration: Time;
	playing: boolean;
	rate: PlaybackRate;
	looping: boolean;
	activeVideoAssets: Array<{ id: AssetId; name: string; trackId: ActiveLayer['trackId'] }>;
	render: RenderStats | null;
	proxyActive?: boolean;
}

export interface PlaybackEngine {
	readonly projectId: Project['id'];
	readonly snapshot: PlaybackSnapshot;
	attach(canvas: HTMLCanvasElement, renderer?: RendererKind): void;
	detach(): void;
	setProject(project: Project): void;
	play(): void;
	pause(): void;
	toggle(): void;
	seek(time: Time): void;
	stepFrames(count: number): void;
	jumpTo(target: 'start' | 'end' | 'prevEdge' | 'nextEdge'): void;
	shuttle(direction: -1 | 1): void;
	setLoop(looping: boolean): void;
	setVolume(volume: number): void;
	setMuted(muted: boolean): void;
	subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void;
	getDebugStats(): PlaybackDebugStats;
	enableScopes(enabled: boolean): void;
	getLastScopeFrame(): ScopeFrameData | null;
	getRenderer(): FrameRenderer | null;
	getDebugMasterAnalyser?(): AnalyserNode | null;
	getDebugMasterAnalysers?(): { analyserL: AnalyserNode; analyserR: AnalyserNode } | null;
	getTrackMeterLevels?(trackId: string): {
		peakL: number;
		peakR: number;
		rmsL: number;
		rmsR: number;
	};
	getMasterMeterLevels?(): { peakL: number; peakR: number; rmsL: number; rmsR: number };
	getBusMeterLevels?(busId: string): { peakL: number; peakR: number; rmsL: number; rmsR: number };
	getAudioNodeCount?(): number;
	unlock?(): Promise<void>;
	dispose(): void;
}

export function createPlaybackEngine(store: EditorStore, initialProject: Project): PlaybackEngine {
	const duration = timelineDuration(initialProject);
	const clock = createPlaybackClock({
		duration,
		fps: initialProject.settings.fps,
		initialTime: store.getState().timeline.playhead
	});
	const bridge: {
		current: PlaybackEngineImpl | null;
		audio: AudioEngine | null;
	} = { current: null, audio: null };
	const pool = new MediaPool(initialProject, {
		onFrame: () => bridge.current?.onPoolFrame(),
		onMissing: (assetId) => bridge.current?.onPoolMissing(assetId),
		onError: (error) => bridge.current?.onPoolError(error),
		onStall: (clipId) => bridge.current?.onMediaStall(clipId),
		onReady: (clipId) => bridge.current?.onMediaReady(clipId),
		onReleaseAudioElement: (element) => bridge.audio?.releaseElement(element)
	});
	const audio = new AudioEngine(pool, { onError: (error) => bridge.current?.onPoolError(error) });
	bridge.audio = audio;
	const engine = new PlaybackEngineImpl(store, initialProject, clock, pool, audio);
	bridge.current = engine;
	return engine;
}

class PlaybackEngineImpl implements PlaybackEngine {
	private project: Project;
	private canvas: HTMLCanvasElement | null = null;
	private renderer: FrameRenderer | null = null;
	private renderHandle: number | null = null;
	private loadingTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly listeners = new Set<(snapshot: PlaybackSnapshot) => void>();
	private readonly lastGoodFrames: LastGoodFrames = new Map();
	private readonly textCache = new TextRasterCache();
	private readonly fontUnsubscribe?: () => void;
	private readonly runtimeMissing = new Set<AssetId>();
	private readonly clockUnsubscribe: () => void;
	private readonly storeUnsubscribe: () => void;
	private readonly visibilityListener: () => void;
	private resumeAfterVisible = false;
	private allProjectClipIds = new Set<string>();
	private cachedResolvedFrame: {
		time: Time;
		project: Project;
		resolved: ReturnType<typeof resolveFrame>;
	} | null = null;
	private writingPlayhead = false;
	private disposed = false;
	private snapshotValue: PlaybackSnapshot;
	onPoolFrame = (): void => this.requestRender();
	onPoolMissing = (assetId: AssetId): void => this.markMissing(assetId);
	onPoolError = (error: Error): void => this.reportError(error);
	onMediaStall = (_clipId: ClipId): void => {
		void _clipId;
		// Do not halt playback transport on transient decoder buffer dips or micro-stalls.
		// The compositor gracefully holds the last good frame (frame dropping)
		// while the timeline clock and audio stay in sync.
	};
	onMediaReady = (_clipId: ClipId): void => {
		void _clipId;
		if (!this.disposed) {
			this.requestRender();
		}
	};

	private get activeProject(): Project {
		const storeProj = this.store.getState().project ?? this.project;
		const activeSeqId = this.store.getState().activeSequenceId;
		return viewProject(storeProj, activeSeqId);
	}

	private updateAllProjectClipIds(): void {
		const clips: string[] = [];
		for (const track of this.project.tracks) {
			for (const clip of track.clips) clips.push(clip.id);
		}
		if (this.project.sequences) {
			for (const seq of Object.values(this.project.sequences)) {
				for (const track of seq.tracks) {
					for (const clip of track.clips) clips.push(clip.id);
				}
			}
		}
		this.allProjectClipIds = new Set(clips);
	}

	private getResolvedFrame(proj: Project, time: Time): ReturnType<typeof resolveFrame> {
		if (
			this.cachedResolvedFrame &&
			this.cachedResolvedFrame.time === time &&
			this.cachedResolvedFrame.project === proj
		) {
			return this.cachedResolvedFrame.resolved;
		}
		const resolved = resolveFrame(proj, time);
		this.cachedResolvedFrame = { time, project: proj, resolved };
		return resolved;
	}

	constructor(
		private readonly store: EditorStore,
		project: Project,
		private readonly clock: ReturnType<typeof createPlaybackClock>,
		private readonly pool: MediaPool,
		private readonly audio: AudioEngine
	) {
		this.project = project;
		this.updateAllProjectClipIds();
		this.snapshotValue = {
			time: clock.time,
			duration: timelineDuration(project),
			playing: false,
			rate: clock.rate,
			looping: clock.looping,
			volume: audio.masterVolume,
			muted: audio.isMuted,
			meter: 0,
			missing: [],
			loading: false,
			error: ''
		};
		this.clockUnsubscribe = clock.onTick((time, playing, rate) => {
			if (this.disposed) return;
			const aiState = this.store.getState().ai;
			if (playing && aiState?.virtualPreview && aiState.detectedSilences.length > 0) {
				const currentSilence = aiState.detectedSilences.find(
					(s) => s.included && time >= s.cutStartUs && time < s.cutEndUs
				);
				if (currentSilence && currentSilence.cutEndUs > time) {
					clock.seek(currentSilence.cutEndUs);
					return;
				}
			}
			this.writingPlayhead = true;
			try {
				this.store.getState().setPlayhead(time);
			} finally {
				this.writingPlayhead = false;
			}
			this.store.getState().setTimelineFollowing(playing);
			this.updateSnapshot({
				time,
				playing,
				rate,
				looping: clock.looping,
				meter: audio.getLevel(),
				...(playing && this.snapshotValue.loading ? { loading: false } : {})
			});
			this.syncAndRender();
		});
		this.storeUnsubscribe = store.subscribe((state, previous) => {
			if (this.disposed || this.writingPlayhead) return;
			if (state.project && state.project !== this.project && state.project.id === this.project.id) {
				this.setProject(state.project);
			}
			if (state.isExporting && !previous.isExporting) {
				clock.pause();
				void audio
					.sync([], this.project, false, clock.rate)
					.catch((error: unknown) => this.reportError(error));
			}
			if (state.activeSequenceId !== previous.activeSequenceId) {
				const currentProj = state.project ?? this.project;
				const activeProject = viewProject(currentProj, state.activeSequenceId);
				const duration = timelineDuration(activeProject);
				clock.setDuration(duration);
				clock.seek(state.timeline.playhead);
				this.cachedResolvedFrame = null;
				this.updateSnapshot({ duration });
				this.resizeCanvas();
				this.syncAndRender();
				return;
			}
			if (state.timeline.playhead !== previous.timeline.playhead) {
				clock.seek(state.timeline.playhead);
				if (clock.playing) {
					void audio.unlock().catch((error: unknown) => this.reportError(error));
				}
				this.syncAndRender();
			}
			if (state.scopes?.open !== previous.scopes?.open) {
				if (state.scopes?.open) {
					this.renderer?.enableScopes?.(true);
				}
				this.syncAndRender();
			}
		});
		this.visibilityListener = () => {
			if (document.visibilityState === 'hidden') {
				this.resumeAfterVisible = clock.playing;
				clock.pause();
				void audio
					.sync([], this.project, false, clock.rate)
					.catch((error: unknown) => this.reportError(error));
				return;
			}
			if (this.resumeAfterVisible) {
				this.resumeAfterVisible = false;
				this.play();
			}
		};
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', this.visibilityListener);
		}
		this.fontUnsubscribe = onFontLoaded(() => {
			this.textCache.clear();
			this.requestRender();
		});
	}

	get snapshot(): PlaybackSnapshot {
		return this.snapshotValue;
	}

	get projectId(): Project['id'] {
		return this.project.id;
	}

	attach(canvas: HTMLCanvasElement, rendererKind: RendererKind = 'canvas2d'): void {
		if (this.disposed) throw new Error('Cannot attach a disposed playback engine.');
		this.detach();
		const renderer = createFrameRenderer(canvas, {
			forceCanvas2d: rendererKind === 'canvas2d',
			preserveDrawingBuffer: true,
			onContextRestored: () => this.requestRender()
		});
		if (!renderer) {
			this.reportError(new Error('The preview canvas could not be initialised for rendering.'));
			return;
		}
		this.canvas = canvas;
		this.renderer = renderer;
		this.resizeCanvas();
		this.syncAndRender();
	}

	detach(): void {
		if (this.renderHandle !== null) cancelAnimationFrame(this.renderHandle);
		this.renderHandle = null;
		this.canvas = null;
		this.renderer?.dispose();
		this.renderer = null;
	}

	setProject(project: Project): void {
		if (project.id !== this.project.id) {
			throw new Error(
				'A playback engine cannot switch projects; dispose it and create a new engine.'
			);
		}
		const previousProject = this.project;
		this.project = project;
		this.updateAllProjectClipIds();
		this.cachedResolvedFrame = null;
		this.pool.setProject(project);
		this.audio.updateProject(project);
		for (const assetId of this.runtimeMissing) {
			if (project.assets[assetId]?.opfsPath !== previousProject.assets[assetId]?.opfsPath) {
				this.runtimeMissing.delete(assetId);
			}
		}
		const duration = timelineDuration(project);
		this.clock.setDuration(duration);
		this.updateSnapshot({ duration });
		this.resizeCanvas();
		this.syncAndRender();
	}

	play(): void {
		if (this.disposed) return;
		void this.audio.unlock().catch((error: unknown) => this.reportError(error));
		this.clock.play();
		this.store.getState().setTimelineFollowing(this.clock.playing);
		this.syncAndRender();
	}

	pause(): void {
		this.resumeAfterVisible = false;
		this.clock.pause();
		this.store.getState().setTimelineFollowing(false);
		void this.audio
			.sync([], this.project, false, this.clock.rate)
			.catch((error: unknown) => this.reportError(error));
	}

	toggle(): void {
		if (this.clock.playing) this.pause();
		else this.play();
	}

	seek(time: Time): void {
		if (this.disposed) return;
		void this.audio.unlock().catch((error: unknown) => this.reportError(error));
		this.clock.seek(time);
		this.syncAndRender();
	}

	stepFrames(count: number): void {
		if (!Number.isSafeInteger(count)) throw new RangeError('Frame step must be an integer.');
		const delta =
			Math.sign(count) * framesToTicks(Math.abs(count), this.activeProject.settings.fps);
		this.seek(Math.max(0, this.clock.time + delta));
	}

	jumpTo(target: 'start' | 'end' | 'prevEdge' | 'nextEdge'): void {
		if (target === 'start') this.seek(0);
		else if (target === 'end') this.seek(this.snapshotValue.duration);
		else {
			const boundary = nextBoundary(
				this.activeProject,
				this.clock.time,
				target === 'nextEdge' ? 1 : -1
			);
			if (boundary !== null) this.seek(boundary);
		}
	}

	shuttle(direction: -1 | 1): void {
		const sign = direction;
		const current = this.clock.rate;
		const magnitude = Math.sign(current) === sign ? Math.min(8, Math.abs(current) * 2) : 1;
		this.clock.setRate(rateForDirection(sign, magnitude));
		this.play();
	}

	setLoop(looping: boolean): void {
		this.clock.setLoop(looping);
		this.updateSnapshot({ looping });
	}

	setVolume(volume: number): void {
		this.audio.setVolume(volume);
		this.updateSnapshot({ volume: this.audio.masterVolume });
	}

	setMuted(muted: boolean): void {
		this.audio.setMuted(muted);
		this.updateSnapshot({ muted: this.audio.isMuted });
	}

	subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void {
		this.listeners.add(listener);
		listener(this.snapshotValue);
		return () => this.listeners.delete(listener);
	}

	getDebugStats(): PlaybackDebugStats {
		return {
			elementCount: this.pool.elementCount,
			rafRunning: this.clock.playing || this.renderHandle !== null,
			audioContextState: this.audioContextState,
			meter: this.audio.getLevel(),
			time: this.clock.time,
			duration: this.snapshotValue.duration,
			playing: this.clock.playing,
			rate: this.clock.rate,
			looping: this.clock.looping,
			render: this.renderer?.stats ?? null,
			activeVideoAssets: resolveFrame(this.project, this.clock.time).videoLayers.flatMap(
				(layer) => {
					if (layer.transition) {
						const assets: Array<{ id: AssetId; name: string; trackId: TrackId }> = [];
						const aA = layer.transition.fromLayer.assetId
							? this.project.assets[layer.transition.fromLayer.assetId]
							: undefined;
						if (aA) assets.push({ id: aA.id, name: aA.name, trackId: layer.trackId });
						const aB = layer.transition.toLayer.assetId
							? this.project.assets[layer.transition.toLayer.assetId]
							: undefined;
						if (aB) assets.push({ id: aB.id, name: aB.name, trackId: layer.trackId });
						return assets;
					}
					const asset = layer.assetId ? this.project.assets[layer.assetId] : undefined;
					return asset ? [{ id: asset.id, name: asset.name, trackId: layer.trackId }] : [];
				}
			)
		};
	}

	enableScopes(enabled: boolean): void {
		this.renderer?.enableScopes?.(enabled);
		if (enabled) {
			this.requestRender();
		}
	}

	getLastScopeFrame(): ScopeFrameData | null {
		const fromRenderer = this.renderer?.getLastScopeFrame?.();
		if (fromRenderer) return fromRenderer;
		if (this.canvas && this.canvas.width > 0 && this.canvas.height > 0) {
			return extractCanvasScopeFrame(this.canvas);
		}
		return null;
	}

	getRenderer(): FrameRenderer | null {
		return this.renderer;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.clock.pause();
		this.detach();
		this.clockUnsubscribe();
		this.storeUnsubscribe();
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.visibilityListener);
		}
		this.clock.dispose();
		if (this.loadingTimer !== null) clearTimeout(this.loadingTimer);
		this.loadingTimer = null;
		this.cachedResolvedFrame = null;
		const audioDispose = this.audio.dispose();
		this.pool.dispose();
		void audioDispose.catch((error: unknown) => this.reportError(error));
		this.listeners.clear();
		this.lastGoodFrames.clear();
		this.fontUnsubscribe?.();
		this.textCache.dispose();
	}

	private get audioContextState(): AudioContextState | 'uninitialized' {
		return this.audio.debugContextState;
	}

	private syncAndRender(): void {
		if (this.disposed) return;
		const proj = this.activeProject;
		const resolved = this.getResolvedFrame(proj, this.clock.time);
		const missing = new Set([...resolved.missing, ...this.runtimeMissing]);
		this.updateSnapshot({
			missing: [...missing]
		});
		void this.pool
			.reconcile(resolved, this.clock.time, this.clock.playing, this.clock.rate)
			.catch((error: unknown) => this.reportError(error));
		void this.audio
			.sync(resolved.audioSources, proj, this.clock.playing, this.clock.rate)
			.catch((error: unknown) => this.reportError(error));
		this.requestRender();
	}

	private requestRender(): void {
		if (this.disposed || !this.renderer || this.renderHandle !== null) return;
		this.renderHandle = requestAnimationFrame(() => {
			this.renderHandle = null;
			this.drawCurrentFrame();
		});
	}

	private drawCurrentFrame(): void {
		const renderer = this.renderer;
		const canvas = this.canvas;
		if (!renderer || !canvas || this.disposed) return;
		const proj = this.activeProject;
		const resolved = this.getResolvedFrame(proj, this.clock.time);
		const liveKeys = new Set<string>(this.allProjectClipIds);
		for (const layer of resolved.videoLayers) {
			const k = layer.instanceKey ?? layer.clipId;
			liveKeys.add(k);
		}
		for (const key of this.lastGoodFrames.keys()) {
			if (!liveKeys.has(key)) this.lastGoodFrames.delete(key);
		}
		renderer.releaseUnused(liveKeys);
		const missing = new Set([...resolved.missing, ...this.runtimeMissing]);
		const layers = resolved.videoLayers.filter((layer) => {
			if (layer.transition) {
				const fromId = layer.transition.fromLayer.assetId;
				const toId = layer.transition.toLayer.assetId;
				if (fromId && missing.has(fromId)) return false;
				if (toId && missing.has(toId)) return false;
				return true;
			}
			return !layer.assetId || !missing.has(layer.assetId);
		});
		let loading = false;
		let proxyActive = false;
		const scopesOpen = this.store.getState().scopes?.open ?? false;
		renderer.enableScopes?.(scopesOpen);

		const checkLayerLuts = (layersToCheck: readonly ActiveLayer[]): void => {
			for (const layer of layersToCheck) {
				if (layer.effects) {
					for (const eff of layer.effects) {
						if (eff.type === 'lut3d' && eff.params?.lutAssetId) {
							const assetId = eff.params.lutAssetId as string;
							if (assetId && !getParsedLut(assetId)) {
								const asset = proj.assets[assetId as AssetId];
								if (asset) {
									void ensureLutLoaded(proj.id, asset).then((parsed) => {
										if (parsed && !this.disposed) this.requestRender();
									});
								}
							}
						}
					}
				}
				if (layer.nested?.layers) {
					checkLayerLuts(layer.nested.layers);
				}
			}
		};
		checkLayerLuts(layers);

		renderer.render(
			{ width: proj.settings.width, height: proj.settings.height },
			layers,
			(layer: ActiveLayer): FrameSource | null => {
				if (layer.kind === 'shape' && layer.shapeData) {
					const rendered = rasterizeShape(layer.shapeData);
					return rendered.canvas as FrameSource;
				}
				if (layer.kind === 'text' && layer.textData) {
					const data = layer.textData;
					if (data.style.fontFamily && !isFontLoaded(data.style.fontFamily)) {
						void ensureFontLoaded(data.style.fontFamily).then((loaded) => {
							if (loaded) {
								this.textCache.clear();
								this.requestRender();
							}
						});
					}
					const scale = Math.max(layer.transform?.scaleX ?? 1, layer.transform?.scaleY ?? 1);
					return this.textCache.get({
						text: data.text,
						style: data.style,
						box: data.box,
						fontSize: data.fontSize,
						fillColor: data.fillColor,
						strokeColor: data.strokeColor,
						strokeWidth: data.strokeWidth,
						letterSpacing: data.letterSpacing,
						lineHeight: data.lineHeight,
						reveal: data.reveal,
						shadowColor: data.shadowColor,
						shadowBlur: data.shadowBlur,
						shadowOffsetX: data.shadowOffsetX,
						shadowOffsetY: data.shadowOffsetY,
						backgroundBoxColor: data.backgroundBoxColor,
						backgroundBoxPadding: data.backgroundBoxPadding,
						backgroundBoxRadius: data.backgroundBoxRadius,
						boxBorderColor: data.boxBorderColor,
						boxBorderWidth: data.boxBorderWidth,
						accentBarColor: data.accentBarColor,
						accentBarWidth: data.accentBarWidth,
						frameStyle: data.frameStyle,
						badgeText: data.badgeText,
						gradientType: data.gradientType,
						gradientColorEnd: data.gradientColorEnd,
						gradientAngle: data.gradientAngle,
					animator: data.animator,
						colorRuns: data.colorRuns,
						scale
					});
				}
				const source = this.pool.getFrameSource(layer, this.clock.playing, this.clock.rate);
				if (!source) {
					// Only indicate loading when playback is paused/scrubbing and no frame is available yet.
					// During active playback, compositor holds lastGoodFrames smoothly without showing loading overlays.
					if (!this.clock.playing && !this.lastGoodFrames.has(layer.clipId)) {
						loading = true;
					}
				} else if (this.pool.isUsingProxy(layer)) {
					proxyActive = true;
				}
				return source;
			},
			this.lastGoodFrames,
			{ playing: this.clock.playing }
		);
		this.updateSnapshot({ proxyActive });
		canvas.setAttribute(
			'aria-label',
			`Preview, ${ticksToTimecode(this.clock.time, proj.settings.fps)}`
		);
		if (loading && !this.clock.playing) {
			if (this.loadingTimer === null) {
				this.loadingTimer = setTimeout(() => {
					this.loadingTimer = null;
					if (!this.clock.playing) {
						this.updateSnapshot({ loading: true });
					}
				}, 150);
			}
		} else {
			if (this.loadingTimer !== null) clearTimeout(this.loadingTimer);
			this.loadingTimer = null;
			if (this.snapshotValue.loading) {
				this.updateSnapshot({ loading: false });
			}
		}
	}

	private resizeCanvas(): void {
		if (!this.canvas) return;
		const { width, height } = this.activeProject.settings;
		if (this.canvas.width !== width) this.canvas.width = width;
		if (this.canvas.height !== height) this.canvas.height = height;
	}

	private markMissing(assetId: AssetId): void {
		if (this.runtimeMissing.has(assetId)) return;
		this.runtimeMissing.add(assetId);
		this.syncAndRender();
	}

	private reportError(error: unknown): void {
		const message = error instanceof Error ? error.message : 'Playback failed unexpectedly.';
		this.updateSnapshot({ error: message });
	}

	getDebugMasterAnalyser(): AnalyserNode | null {
		return this.audio.debugMasterAnalyser;
	}

	getDebugMasterAnalysers(): { analyserL: AnalyserNode; analyserR: AnalyserNode } | null {
		return this.audio.debugMasterAnalysers;
	}

	getTrackMeterLevels(trackId: string) {
		return this.audio.getTrackMeterLevels(trackId);
	}

	getMasterMeterLevels() {
		return this.audio.getMasterMeterLevels();
	}

	getBusMeterLevels(busId: string) {
		return this.audio.getBusMeterLevels(busId);
	}

	getAudioNodeCount(): number {
		return this.audio.getNodeCount();
	}

	async unlock(): Promise<void> {
		await this.audio.unlock();
	}

	private updateSnapshot(patch: Partial<PlaybackSnapshot>): void {
		this.snapshotValue = { ...this.snapshotValue, ...patch };
		for (const listener of this.listeners) listener(this.snapshotValue);
	}
}

function rateForDirection(direction: -1 | 1, magnitude: number): PlaybackRate {
	if (magnitude === 1) return direction;
	if (magnitude === 2) return direction === 1 ? 2 : -2;
	if (magnitude === 4) return direction === 1 ? 4 : -4;
	return direction === 1 ? 8 : -8;
}
