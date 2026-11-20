import type { ActiveAudio, ActiveLayer } from '../../core/playback';
import type { Asset, AssetId, Clip, Project } from '../../core/types';
import { isProxyStale } from '../../core/proxy';
import { getMediaFile, getMediaObjectUrl, getProxyObjectUrl } from '../storage/opfs';
import type { FrameSource } from './compositor';

export const MEDIA_LOOKAHEAD_SECONDS = 1.5;
export const MEDIA_IDLE_RELEASE_MS = 5_000;
export const MEDIA_POOL_LIMIT = 6;
export const VIDEO_DRIFT_THRESHOLD_SECONDS = 0.08;
export const VIDEO_PLAYING_DRIFT_THRESHOLD_SECONDS = 0.25;
export const VIDEO_HARD_SEEK_DRIFT_THRESHOLD_SECONDS = 0.8;
const MEDIA_HAVE_METADATA = 1;
const MEDIA_HAVE_CURRENT_DATA = 2;

export interface MediaUrlReference {
	url: string;
	release: () => void;
}

export interface MediaPoolOptions {
	maxElements?: number;
	now?: () => number;
	getUrl?: (projectId: Project['id'], asset: Asset) => Promise<MediaUrlReference>;
	getProxyUrl?: (projectId: Project['id'], asset: Asset) => Promise<MediaUrlReference>;
	getFile?: typeof getMediaFile;
	createVideo?: () => HTMLVideoElement;
	createAudio?: () => HTMLAudioElement;
	decodeImage?: (file: Blob) => Promise<ImageBitmap>;
	onMissing?: (assetId: AssetId) => void;
	onStall?: (clipId: Clip['id']) => void;
	onReady?: (clipId: Clip['id']) => void;
	onError?: (error: Error) => void;
	onFrame?: () => void;
	onReleaseAudioElement?: (element: HTMLAudioElement) => void;
}

interface PoolEntryBase {
	entryKey: string;
	clipId: Clip['id'];
	assetId: AssetId;
	isProxy?: boolean;
	ready: Promise<void>;
	releaseUrl?: () => void;
	lastUsed: number;
	idleTimer: ReturnType<typeof setTimeout> | null;
	seeking: boolean;
	pendingSeek: number | null;
	seekResolvers: Array<() => void>;
	prewarmed?: boolean;
}

type PoolEntry = PoolEntryBase &
	({ kind: 'video'; element: HTMLVideoElement } | { kind: 'audio'; element: HTMLAudioElement });

export function needsDriftCorrection(
	actualSeconds: number,
	expectedSeconds: number,
	threshold = VIDEO_DRIFT_THRESHOLD_SECONDS
): boolean {
	return Math.abs(actualSeconds - expectedSeconds) > threshold + 1e-9;
}

export class MediaPool {
	private readonly entries = new Map<string, PoolEntry>();
	private readonly images = new Map<AssetId, Promise<ImageBitmap>>();
	private readonly imageSources = new Map<AssetId, ImageBitmap>();
	private readonly liveLimit: number;
	private readonly now: () => number;
	private project: Project;
	private disposed = false;

	constructor(
		project: Project,
		private readonly options: MediaPoolOptions = {}
	) {
		this.project = project;
		this.liveLimit = Math.max(1, options.maxElements ?? MEDIA_POOL_LIMIT);
		this.now = options.now ?? (() => performance.now());
	}

	get elementCount(): number {
		return this.entries.size;
	}

	setProject(project: Project): void {
		const previousAssets = this.project.assets;
		const previousProxyEnabled = this.project.proxy?.enabled ?? false;
		const nextProxyEnabled = project.proxy?.enabled ?? false;
		const proxyEnabledChanged = previousProxyEnabled !== nextProxyEnabled;
		this.project = project;
		for (const entry of this.entries.values()) {
			const asset = project.assets[entry.assetId];
			const previous = previousAssets[entry.assetId];
			const proxyChanged =
				entry.kind === 'video' &&
				(proxyEnabledChanged ||
					entry.isProxy !==
						(nextProxyEnabled && asset?.proxy?.status === 'ready' && !isProxyStale(asset)) ||
					asset?.proxy?.opfsPath !== previous?.proxy?.opfsPath);
			if (!asset || asset.offline || asset.opfsPath !== previous?.opfsPath || proxyChanged) {
				this.removeEntry(entry);
			}
		}
		for (const [assetId, bitmapPromise] of this.images) {
			if (project.assets[assetId]?.opfsPath === previousAssets[assetId]?.opfsPath) continue;
			this.images.delete(assetId);
			this.imageSources.delete(assetId);
			void bitmapPromise
				.then((bitmap) => bitmap.close())
				.catch((error: unknown) => {
					this.reportError(error, assetId);
				});
		}
	}

	async reconcile(
		resolved: { videoLayers: readonly ActiveLayer[]; audioSources: readonly ActiveAudio[] },
		time: number,
		playing: boolean,
		rate: number
	): Promise<void> {
		if (this.disposed) return;
		const wanted = new Set<string>();
		const desired: Array<{
			clip: Clip;
			asset: Asset;
			kind: 'video' | 'audio';
			entryKey: string;
			prewarm?: boolean;
		}> = [];
		for (const layer of resolved.videoLayers) {
			if (layer.transition) {
				const fromL = layer.transition.fromLayer;
				const toL = layer.transition.toLayer;
				if (fromL.assetId) {
					const clip = findClip(this.project, fromL.clipId);
					const asset = this.project.assets[fromL.assetId];
					if (clip && asset)
						desired.push({
							clip,
							asset,
							kind: 'video',
							entryKey: fromL.instanceKey ?? fromL.clipId
						});
				}
				if (toL.assetId) {
					const clip = findClip(this.project, toL.clipId);
					const asset = this.project.assets[toL.assetId];
					if (clip && asset)
						desired.push({ clip, asset, kind: 'video', entryKey: toL.instanceKey ?? toL.clipId });
				}
				continue;
			}
			if (!layer.assetId) continue;
			const clip = findClip(this.project, layer.clipId);
			const asset = this.project.assets[layer.assetId];
			if (clip && asset)
				desired.push({ clip, asset, kind: 'video', entryKey: layer.instanceKey ?? layer.clipId });
		}
		for (const source of resolved.audioSources) {
			const clip = findClip(this.project, source.clipId);
			const asset = this.project.assets[source.assetId];
			if (clip && asset) desired.push({ clip, asset, kind: 'audio', entryKey: source.clipId });
		}

		const currentSeconds = time / 1_000_000;
		for (const track of this.project.tracks) {
			if ((track.kind === 'video' && track.hidden) || (track.kind === 'audio' && track.muted)) {
				continue;
			}
			for (const clip of track.clips) {
				const startSeconds = clip.start / 1_000_000;
				if (
					startSeconds <= currentSeconds ||
					startSeconds - currentSeconds > MEDIA_LOOKAHEAD_SECONDS
				) {
					continue;
				}
				if (!clip.assetId) continue;
				const asset = this.project.assets[clip.assetId];
				if (!asset || asset.offline) continue;
				if (track.kind === 'video' && (asset.kind === 'video' || asset.kind === 'image')) {
					if (asset.kind === 'image') {
						void this.getImageSource(asset).catch((error: unknown) =>
							this.reportError(error, asset.id)
						);
					} else {
						desired.push({ clip, asset, kind: 'video', entryKey: clip.id, prewarm: true });
					}
				}
				if (track.kind === 'audio' && asset.hasAudio) {
					desired.push({ clip, asset, kind: 'audio', entryKey: clip.id, prewarm: true });
				}
			}
		}

		const pending: Promise<void>[] = [];
		for (const item of desired) {
			if (item.asset.offline || item.asset.kind === 'image') continue;
			const key = poolKey(item.entryKey, item.kind);
			wanted.add(key);
			const entry = this.ensureEntry(item.clip, item.asset, item.kind, item.entryKey);
			if (entry) {
				if (!item.prewarm) {
					entry.lastUsed = this.now();
					entry.prewarmed = false;
				}
				if (entry.idleTimer !== null) {
					clearTimeout(entry.idleTimer);
					entry.idleTimer = null;
				}
				pending.push(entry.ready);
				if (item.prewarm && !entry.prewarmed) {
					entry.prewarmed = true;
					pending.push(
						entry.ready.then(() => {
							this.requestSeek(entry, item.clip.sourceIn / 1_000_000);
						})
					);
				}
			}
		}

		for (const entry of this.entries.values()) {
			if (wanted.has(poolKey(entry.entryKey, entry.kind))) {
				if (entry.kind === 'audio') {
					const isActive = resolved.audioSources.some((source) => source.clipId === entry.clipId);
					if (!isActive || !playing || rate !== 1) entry.element.pause();
				}
				continue;
			}
			entry.element.pause();
			this.scheduleIdleRelease(entry);
		}
		this.enforceLimit(wanted);
		await Promise.all(pending);
	}

	getFrameSource(layer: ActiveLayer, playing: boolean, rate: number): FrameSource | null {
		if (!layer.assetId) return null;
		const asset = this.project.assets[layer.assetId];
		const clip = findClip(this.project, layer.clipId);
		if (!asset || !clip || asset.offline) return null;
		if (asset.kind === 'image') {
			const bitmap = this.imageSources.get(asset.id);
			if (bitmap) return bitmap;
			void this.getImageSource(asset).catch((error: unknown) => this.reportError(error, asset.id));
			return null;
		}
		const entryKey = layer.instanceKey ?? layer.clipId;
		const entry = this.ensureEntry(clip, asset, 'video', entryKey);
		if (!entry || entry.kind !== 'video') return null;
		const video = entry.element;
		entry.lastUsed = this.now();
		const expected = layer.sourceTime / 1_000_000;
		if (video.readyState < MEDIA_HAVE_METADATA) return null;

		const isConstantInRange = !clip.timeRemap && clip.speed >= 0.25 && clip.speed <= 4;
		if (playing && rate > 0 && isConstantInRange) {
			let effectiveRate = rate * clip.speed;
			const drift = expected - video.currentTime;
			const absDrift = Math.abs(drift);

			if (absDrift > VIDEO_DRIFT_THRESHOLD_SECONDS) {
				if (absDrift > VIDEO_HARD_SEEK_DRIFT_THRESHOLD_SECONDS) {
					this.requestSeek(entry, expected);
				} else {
					// Dynamic clock rate adjustment to catch up seamlessly without flushing decoder buffers
					const skewMultiplier =
						drift > 0 ? (drift > 0.35 ? 1.1 : 1.05) : drift < -0.35 ? 0.9 : 0.95;
					effectiveRate *= skewMultiplier;
				}
			}

			if (Math.abs(video.playbackRate - effectiveRate) > 0.005) {
				video.playbackRate = effectiveRate;
			}
			const targetPitch = clip.maintainPitch ?? true;
			if (video.preservesPitch !== targetPitch) {
				video.preservesPitch = targetPitch;
			}

			if (video.paused)
				void video.play().catch((error: unknown) => {
					if (error instanceof DOMException && error.name === 'AbortError') return;
					this.reportError(error, asset.id);
				});
		} else {
			if (!video.paused) video.pause();
			this.requestSeek(entry, expected);
		}
		return video.readyState >= MEDIA_HAVE_CURRENT_DATA ? video : null;
	}

	isUsingProxy(layer: ActiveLayer): boolean {
		if (!layer.assetId) return false;
		const clip = findClip(this.project, layer.clipId);
		if (!clip) return false;
		const entryKey = layer.instanceKey ?? layer.clipId;
		const entry = this.entries.get(poolKey(entryKey, 'video'));
		return entry?.isProxy ?? false;
	}

	getAudioElement(source: ActiveAudio): HTMLAudioElement | null {
		const asset = this.project.assets[source.assetId];
		const clip = findClip(this.project, source.clipId);
		if (!asset || !clip || asset.offline) return null;
		const entry = this.ensureEntry(clip, asset, 'audio');
		if (!entry || entry.kind !== 'audio') return null;
		entry.lastUsed = this.now();
		const audio = entry.element;
		if (audio.readyState >= MEDIA_HAVE_METADATA) {
			const isConstantInRange = !clip.timeRemap && clip.speed >= 0.25 && clip.speed <= 4;
			if (isConstantInRange) {
				const targetRate = clip.speed;
				if (Math.abs(audio.playbackRate - targetRate) > 0.005) {
					audio.playbackRate = targetRate;
				}
				const targetPitch = clip.maintainPitch ?? true;
				if (audio.preservesPitch !== targetPitch) {
					audio.preservesPitch = targetPitch;
				}
			}
			const expected = source.sourceTime / 1_000_000;
			if (needsDriftCorrection(audio.currentTime, expected, 0.15))
				this.requestSeek(entry, expected);
		}
		return audio;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const entry of [...this.entries.values()]) this.removeEntry(entry);
		for (const bitmapPromise of this.images.values()) {
			void bitmapPromise
				.then((bitmap) => bitmap.close())
				.catch((error: unknown) => this.reportError(error));
		}
		this.images.clear();
		this.imageSources.clear();
	}

	private getImageSource(asset: Asset): Promise<ImageBitmap> {
		const cached = this.images.get(asset.id);
		if (cached) return cached;
		const getFile = this.options.getFile ?? getMediaFile;
		const decode = this.options.decodeImage ?? createImageBitmap;
		const promise = getFile(this.project.id, asset).then((file) => decode(file));
		this.images.set(asset.id, promise);
		void promise.then(
			(bitmap) => {
				if (this.disposed) bitmap.close();
				else {
					this.imageSources.set(asset.id, bitmap);
					this.options.onFrame?.();
				}
			},
			() => {
				this.images.delete(asset.id);
			}
		);
		return promise;
	}

	private ensureEntry(
		clip: Clip,
		asset: Asset,
		kind: 'video' | 'audio',
		keyPrefix: string = clip.id
	): PoolEntry | null {
		if (this.disposed || asset.offline) return null;
		const key = poolKey(keyPrefix, kind);
		const existing = this.entries.get(key);
		if (existing && existing.assetId === asset.id) return existing;
		if (existing) this.removeEntry(existing);
		const common = {
			entryKey: keyPrefix,
			clipId: clip.id,
			assetId: asset.id,
			ready: Promise.resolve(),
			lastUsed: this.now(),
			idleTimer: null,
			seeking: false,
			pendingSeek: null,
			seekResolvers: [],
			prewarmed: false
		} satisfies Omit<PoolEntryBase, 'releaseUrl'>;
		const entry: PoolEntry =
			kind === 'video'
				? {
						...common,
						kind,
						element: this.options.createVideo?.() ?? document.createElement('video')
					}
				: {
						...common,
						kind,
						element: this.options.createAudio?.() ?? document.createElement('audio')
					};
		const element = entry.element;
		element.preload = 'auto';
		if (entry.kind === 'video') {
			entry.element.muted = true;
			entry.element.playsInline = true;
			entry.element.crossOrigin = 'anonymous';
		} else {
			entry.element.muted = false;
		}
		element.addEventListener('seeked', () => this.onSeeked(entry));
		element.addEventListener('loadedmetadata', () => {
			if (entry.pendingSeek !== null) this.requestSeek(entry, entry.pendingSeek);
			this.options.onFrame?.();
		});
		element.addEventListener('loadeddata', () => this.options.onFrame?.());
		const markStalled = () => {
			if (!element.paused) this.options.onStall?.(clip.id);
		};
		element.addEventListener('waiting', markStalled);
		element.addEventListener('stalled', markStalled);
		element.addEventListener('canplay', () => {
			this.options.onReady?.(clip.id);
			this.options.onFrame?.();
		});
		element.addEventListener('playing', () => this.options.onReady?.(clip.id));
		element.addEventListener('error', () => {
			this.reportError(new Error(`Browser could not decode “${asset.name}”.`), asset.id);
		});
		this.entries.set(key, entry);
		const useProxy =
			kind === 'video' &&
			(this.project.proxy?.enabled ?? false) &&
			asset.proxy?.status === 'ready' &&
			Boolean(asset.proxy.opfsPath) &&
			!isProxyStale(asset);
		entry.isProxy = useProxy;

		const fetchUrl = useProxy
			? () => (this.options.getProxyUrl ?? getProxyObjectUrl)(this.project.id, asset)
			: () => (this.options.getUrl ?? getMediaObjectUrl)(this.project.id, asset);

		entry.ready = fetchUrl()
			.then((reference) => {
				if (this.disposed || this.entries.get(key) !== entry) {
					reference.release();
					return;
				}
				entry.releaseUrl = reference.release;
				element.src = reference.url;
				element.load();
				this.options.onFrame?.();
			})
			.catch((error: unknown) => {
				this.removeEntry(entry);
				this.reportError(error, asset.id);
			});
		return entry;
	}

	private requestSeek(entry: PoolEntry, seconds: number): void {
		if (!Number.isFinite(seconds) || seconds < 0) return;
		const element = entry.element;
		if (element.readyState < MEDIA_HAVE_METADATA) {
			entry.pendingSeek = seconds;
			return;
		}
		if (entry.seeking) {
			entry.pendingSeek = seconds;
			return;
		}
		const tolerance = !element.paused ? 0.05 : 0.015;
		if (!needsDriftCorrection(element.currentTime, seconds, tolerance)) return;
		entry.seeking = true;
		entry.pendingSeek = null;
		try {
			element.currentTime = seconds;
		} catch (error) {
			entry.seeking = false;
			this.reportError(error, entry.assetId);
		}
	}

	private onSeeked(entry: PoolEntry): void {
		const pending = entry.pendingSeek;
		const isPlaying = !entry.element.paused;
		const threshold = isPlaying ? 0.08 : 0.02;
		if (pending !== null && needsDriftCorrection(entry.element.currentTime, pending, threshold)) {
			entry.pendingSeek = null;
			try {
				entry.element.currentTime = pending;
				return;
			} catch (error) {
				this.reportError(error, entry.assetId);
			}
		}
		entry.pendingSeek = null;
		entry.seeking = false;
		const video = entry.kind === 'video' ? entry.element : null;
		if (video?.requestVideoFrameCallback) {
			video.requestVideoFrameCallback(() => {
				for (const resolve of entry.seekResolvers.splice(0)) resolve();
				this.options.onFrame?.();
			});
		} else {
			for (const resolve of entry.seekResolvers.splice(0)) resolve();
			this.options.onFrame?.();
		}
	}

	private scheduleIdleRelease(entry: PoolEntry): void {
		if (entry.idleTimer !== null) return;
		entry.idleTimer = setTimeout(() => {
			entry.idleTimer = null;
			if (this.now() - entry.lastUsed >= MEDIA_IDLE_RELEASE_MS) this.removeEntry(entry);
		}, MEDIA_IDLE_RELEASE_MS);
	}

	private enforceLimit(wanted: ReadonlySet<string>): void {
		while (this.entries.size > this.liveLimit) {
			const candidates = [...this.entries.values()].toSorted((a, b) => a.lastUsed - b.lastUsed);
			const victim =
				candidates.find((entry) => !wanted.has(poolKey(entry.entryKey, entry.kind))) ??
				candidates[0];
			if (!victim) return;
			this.removeEntry(victim);
		}
	}

	private removeEntry(entry: PoolEntry): void {
		const key = poolKey(entry.entryKey, entry.kind);
		if (this.entries.get(key) === entry) this.entries.delete(key);
		if (entry.idleTimer !== null) clearTimeout(entry.idleTimer);
		entry.element.pause();
		if (entry.kind === 'audio') {
			this.options.onReleaseAudioElement?.(entry.element);
		}
		entry.element.removeAttribute('src');
		entry.element.load();
		entry.releaseUrl?.();
		entry.releaseUrl = undefined;
	}

	private reportError(error: unknown, assetId?: AssetId): void {
		if (
			error instanceof DOMException &&
			(error.name === 'AbortError' || error.name === 'NotFoundError')
		) {
			if (assetId) this.options.onMissing?.(assetId);
			return;
		}
		if (assetId && error instanceof Error && error.name === 'MediaMissingError') {
			this.options.onMissing?.(assetId);
			return;
		}
		this.options.onError?.(
			error instanceof Error ? error : new Error('A playback media operation failed.')
		);
	}
}

function poolKey(key: string, kind: 'video' | 'audio'): string {
	return `${key}:${kind}`;
}

function findClip(project: Project, clipId: Clip['id']): Clip | undefined {
	const inRoot = project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
	if (inRoot) return inRoot;
	for (const seq of Object.values(project.sequences ?? {})) {
		const inSeq = seq.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
		if (inSeq) return inSeq;
	}
	return undefined;
}
