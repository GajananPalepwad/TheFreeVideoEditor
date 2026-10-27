import { ticksToSeconds } from '../../core';
import type { Asset, ProjectId } from '../../core';
import { getMediaFile } from '../storage/opfs';
import { getDerived, putDerived, type AudioPeaks, type DerivedData } from '../storage/mediaCache';

export type DerivedStatus = 'queued' | 'working' | 'ready' | 'failed';
export type WaveformStatus = DerivedData['waveformStatus'];

export interface DerivedOptions {
	signal?: AbortSignal;
	onStatus?: (status: DerivedStatus) => void;
}

const MAX_WAVEFORM_FILE_BYTES = 300 * 1024 * 1024;
const WAVEFORM_BUCKETS_PER_SECOND = 20;
let derivedQueue: Promise<void> = Promise.resolve();

function abortIfNeeded(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
}

function serializeDerived<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	const result = derivedQueue.then(() => {
		abortIfNeeded(signal);
		return task();
	});
	derivedQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error('The browser could not encode a media preview.'));
			},
			'image/webp',
			0.82
		);
	});
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	const scale = Math.min(1, 500 / width, 160 / height);
	canvas.width = Math.max(1, Math.round(width * scale));
	canvas.height = Math.max(1, Math.round(height * scale));
	return canvas;
}

function waitForLoadedData(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
	if (video.readyState >= 2) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(
			() => finish(new Error('Timed out while preparing a preview.')),
			10_000
		);
		const loaded = () => finish();
		const failed = () => finish(new Error('The browser could not decode this media for preview.'));
		const abort = () => finish(new DOMException('The operation was aborted.', 'AbortError'));
		function finish(error?: Error): void {
			window.clearTimeout(timeout);
			video.removeEventListener('loadeddata', loaded);
			video.removeEventListener('error', failed);
			signal?.removeEventListener('abort', abort);
			if (error) reject(error);
			else resolve();
		}
		video.addEventListener('loadeddata', loaded, { once: true });
		video.addEventListener('error', failed, { once: true });
		signal?.addEventListener('abort', abort, { once: true });
	});
}

function seekVideo(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(
			() => finish(new Error('Timed out while extracting a video frame.')),
			5_000
		);
		const finish = (error?: Error) => {
			window.clearTimeout(timeout);
			video.removeEventListener('seeked', onSeeked);
			signal?.removeEventListener('abort', onAbort);
			if (error) reject(error);
			else resolve();
		};
		const onSeeked = () => finish();
		const onAbort = () => finish(new DOMException('The operation was aborted.', 'AbortError'));
		if (Math.abs(video.currentTime - time) < 0.01 && video.readyState >= 2) {
			window.clearTimeout(timeout);
			resolve();
			return;
		}
		video.addEventListener('seeked', onSeeked, { once: true });
		signal?.addEventListener('abort', onAbort, { once: true });
		try {
			video.currentTime = time;
		} catch (error) {
			finish(error instanceof Error ? error : new Error('Could not seek to the requested frame.'));
		}
	});
}

async function extractVideoDerived(
	file: File,
	asset: Asset,
	signal?: AbortSignal
): Promise<{ poster: Blob; thumbs: DerivedData['thumbs'] }> {
	const url = URL.createObjectURL(file);
	const video = document.createElement('video');
	video.preload = 'auto';
	video.muted = true;
	video.playsInline = true;
	video.setAttribute('aria-hidden', 'true');
	video.style.position = 'fixed';
	video.style.width = '1px';
	video.style.height = '1px';
	video.style.opacity = '0';
	video.style.pointerEvents = 'none';
	document.body.append(video);
	try {
		const loaded = waitForLoadedData(video, signal);
		video.src = url;
		await loaded;
		const duration = ticksToSeconds(asset.duration);
		const posterTime = Math.min(Math.max(0.05, duration * 0.1), Math.max(0.05, duration - 0.01));
		const count = Math.min(60, Math.max(1, Math.ceil(duration)));
		const maxTime = Math.max(0, duration - 0.02);
		const times =
			count === 1
				? [0]
				: Array.from({ length: count }, (_, index) => (index / (count - 1)) * maxTime);
		const capture = async (time: number): Promise<Blob> => {
			abortIfNeeded(signal);
			await seekVideo(video, Math.max(0, time), signal);
			const canvas = makeCanvas(video.videoWidth, video.videoHeight);
			const context = canvas.getContext('2d');
			if (!context) throw new Error('This browser cannot render video thumbnails.');
			context.drawImage(video, 0, 0, canvas.width, canvas.height);
			return canvasBlob(canvas);
		};
		const poster = await capture(posterTime);
		const thumbs: DerivedData['thumbs'] = [];
		for (const time of times)
			thumbs.push({ time: Math.round(time * 1_000_000), blob: await capture(time) });
		return { poster, thumbs };
	} finally {
		video.pause();
		video.removeAttribute('src');
		video.load();
		video.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}

async function extractImageDerived(
	file: File
): Promise<{ poster: Blob; thumbs: DerivedData['thumbs'] }> {
	const image = new Image();
	const url = URL.createObjectURL(file);
	try {
		const loaded = new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('The browser could not decode this image.'));
			image.src = url;
		});
		await loaded;
		const canvas = makeCanvas(image.naturalWidth, image.naturalHeight);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('This browser cannot render image previews.');
		context.drawImage(image, 0, 0, canvas.width, canvas.height);
		const poster = await canvasBlob(canvas);
		return { poster, thumbs: [{ time: 0, blob: poster }] };
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function decodePeaks(file: File, signal?: AbortSignal): Promise<AudioPeaks> {
	const AudioContextConstructor = window.OfflineAudioContext;
	if (!AudioContextConstructor)
		throw new Error('Offline audio decoding is not supported in this browser.');
	const context = new AudioContextConstructor(1, 1, 48_000);
	try {
		const decoded = await context.decodeAudioData(await file.arrayBuffer());
		abortIfNeeded(signal);
		const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) =>
			decoded.getChannelData(index)
		);
		const samples = new Float32Array(decoded.length);
		for (const channel of channels) {
			for (let index = 0; index < channel.length; index += 1) {
				const value = channel[index] ?? 0;
				if (Math.abs(value) > Math.abs(samples[index] ?? 0)) samples[index] = value;
			}
		}
		return await new Promise<AudioPeaks>((resolve, reject) => {
			const worker = new Worker(new URL('./waveform.worker.ts', import.meta.url), {
				type: 'module'
			});
			const cleanup = () => worker.terminate();
			const onAbort = () => {
				cleanup();
				reject(new DOMException('The operation was aborted.', 'AbortError'));
			};
			worker.addEventListener(
				'message',
				(event: MessageEvent<AudioPeaks>) => {
					cleanup();
					signal?.removeEventListener('abort', onAbort);
					resolve(event.data);
				},
				{ once: true }
			);
			worker.addEventListener(
				'error',
				(event) => {
					cleanup();
					signal?.removeEventListener('abort', onAbort);
					reject(new Error(`Waveform worker failed: ${event.message}`));
				},
				{ once: true }
			);
			signal?.addEventListener('abort', onAbort, { once: true });
			worker.postMessage(
				{ samples, sampleRate: decoded.sampleRate, bucketsPerSecond: WAVEFORM_BUCKETS_PER_SECOND },
				[samples.buffer]
			);
		});
	} finally {
	}
}

export async function generateDerived(
	projectId: ProjectId,
	asset: Asset,
	options: DerivedOptions = {}
): Promise<DerivedData> {
	options.onStatus?.('queued');
	return serializeDerived(async () => {
		options.onStatus?.('working');
		try {
			const cached = await getDerived(projectId, asset.id);
			if (cached) {
				const isBogusVideoCache =
					asset.kind === 'video' &&
					(cached.thumbs.length === 0 ||
						cached.thumbs[0]?.time !== 0 ||
						(cached.thumbs.length > 2 &&
							cached.thumbs.every((t) => t.blob.size === cached.thumbs[0]?.blob.size)));
				if (!isBogusVideoCache) {
					options.onStatus?.('ready');
					return cached;
				}
			}
			const file = await getMediaFile(projectId, asset);
			let imageVideo: { poster: Blob; thumbs: DerivedData['thumbs'] };
			if (asset.kind === 'image') imageVideo = await extractImageDerived(file);
			else if (asset.kind === 'video') {
				imageVideo = await extractVideoDerived(file, asset, options.signal);
			} else {
				const placeholder = new Blob([], { type: 'image/webp' });
				imageVideo = { poster: placeholder, thumbs: [] };
			}

			let peaks: AudioPeaks | undefined = cached?.peaks;
			let waveformStatus: DerivedData['waveformStatus'] = cached?.waveformStatus ?? 'none';
			if ((asset.kind === 'audio' || asset.hasAudio) && !peaks) {
				if (file.size > MAX_WAVEFORM_FILE_BYTES) {
					waveformStatus = 'unavailable';
				} else {
					try {
						peaks = await decodePeaks(file, options.signal);
						waveformStatus = 'ready';
					} catch (error) {
						if (options.signal?.aborted) throw error;
						waveformStatus = 'unavailable';
						console.info(`Waveform generation unavailable for ${asset.name}.`, error);
					}
				}
			}
			const result: DerivedData = {
				...imageVideo,
				...(peaks ? { peaks } : {}),
				waveformStatus
			};
			await putDerived(projectId, asset.id, result);
			options.onStatus?.('ready');
			return result;
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				options.onStatus?.('failed');
			}
			throw error;
		}
	}, options.signal);
}

export function cancelDerivedQueue(): void {
	derivedQueue = Promise.resolve();
}
