import {
	AudioSample,
	AudioSampleSource,
	CanvasSource,
	MovOutputFormat,
	Mp4OutputFormat,
	Output,
	VideoSample,
	VideoSampleSource,
	WavOutputFormat,
	WebMOutputFormat,
	type AudioCodec,
	type VideoCodec
} from 'mediabunny';
import { VIDEO_CODEC_REGISTRY } from '../../core/codecs/registry';
import type { AssetId, Project } from '../../core';
import { resolveFrame, type ActiveLayer } from '../../core';
import type { LastGoodFrames } from '../playback/compositor';
import {
	createFrameRenderer,
	GlCompositor,
	type FrameRenderer,
	type RendererKind
} from '../render';
import { projectNeedsGpu } from '../../core/gpuFeatures';
import { getMediaFile } from '../storage/opfs';
import { ensureBuiltinLutLoaded, ensureLutLoaded, isBuiltinLutId } from '../media/lutCache';
import { audioSchedulesForChunk, decodeAudioAssets, mixAudioChunk } from './audioMix';
import { LoudnessMeter } from '../../core/audio/loudness';
import { dbToGain } from '../../core/audioMath';
import { ExportFrameProvider } from './frameProvider';
import { buildExportPlan, type ExportPlan, type ExportSettings } from './plan';
import { createExportSink, createExportSinkForTarget, type ExportSink } from './sink';
import { createStreamingSaveTarget } from '../storage/fileAccess';
import type { StreamingSaveTarget } from '../storage/fileAccess';
import type { ExportWorkerRequest, ExportWorkerResponse } from './workerProtocol';
import { WorkerAudioMixer, createAudioSampleFromPlanar } from './workerAudioMix';
import {
	forcedExportRenderer,
	recordExportPath,
	recordExportRenderer,
	recordExportPlan,
	recordExportProgress,
	recordWorkerTermination
} from './testHooks';
import type { ExportPath } from './testHooks';
import { workerExportFallbackReason, yieldToEventLoop } from './workerSupport';
export { recordExportPath } from './testHooks';

export type ExportProgressPhase =
	'preparing' | 'rendering' | 'encoding' | 'finalizing' | 'complete' | 'cancelled' | 'error';

export interface ExportProgress {
	framesDone: number;
	totalFrames: number;
	fps: number;
	etaMs: number;
	phase: ExportProgressPhase;
	percent: number;
}

export type ExportErrorCode =
	| 'EMPTY_TIMELINE'
	| 'UNSUPPORTED_CODEC'
	| 'OFFLINE_MEDIA'
	| 'DECODE_FAILED'
	| 'ENCODE_FAILED'
	| 'CANCELLED'
	| 'STORAGE_FAILED';

export class ExportError extends Error {
	constructor(
		readonly code: ExportErrorCode,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'ExportError';
	}
}

export interface ExportRunOptions {
	signal?: AbortSignal;
	onProgress?: (progress: ExportProgress) => void;
	onWarning?: (message: string) => void;
	getFile?: typeof getMediaFile;
	sink?: ExportSink;
	videoCodec?: string;
	audioCodec?: string;
	forceMainThread?: boolean;
	workerFactory?: () => Worker;
	onFallback?: (reason: string) => void;
	/** Overrides the automatic renderer choice (WebGL2 only for projects that need it). */
	renderer?: RendererKind;
}

export interface ExportResult {
	blob: Blob | null;
	plan: ExportPlan;
	bytes?: number;
	path?: Exclude<ExportPath, 'compatibility'>;
	renderer?: RendererKind;
}

function emitProgress(
	callback: ExportRunOptions['onProgress'],
	values: Omit<ExportProgress, 'percent'>
): void {
	callback?.({
		...values,
		percent:
			values.phase === 'complete'
				? 100
				: values.totalFrames > 0
					? Math.min(99, Math.round((values.framesDone / values.totalFrames) * 100))
					: 0
	});
	recordExportProgress({
		framesDone: values.framesDone,
		totalFrames: values.totalFrames,
		fps: values.fps,
		phase: values.phase
	});
}

function cancelled(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new ExportError('CANCELLED', 'Export cancelled.', {
			cause: signal.reason
		});
	}
}

async function exportAudioTrack({
	snapshot,
	plan,
	settings,
	audioSource,
	workerAudioMixer,
	audioBuffers,
	signal,
	onChunk
}: {
	snapshot: Project;
	plan: ExportPlan;
	settings: ExportSettings;
	audioSource: AudioSampleSource;
	workerAudioMixer: WorkerAudioMixer | null;
	audioBuffers: Map<AssetId, AudioBuffer> | null;
	signal?: AbortSignal;
	onChunk?: (chunkIndex: number, totalChunks: number) => void;
}): Promise<void> {
	const chunkTicks = 10_000_000;
	const totalChunks = Math.max(1, Math.ceil(plan.durationUs / chunkTicks));
	const targetLufs =
		settings.loudnessTargetLufs ??
		(settings.normalizeAudio ? -14.0 : snapshot.masterAudio?.loudnessTargetLufs);
	const shouldNormalize = targetLufs !== undefined;

	if (workerAudioMixer) {
		const planarList: {
			left: Float32Array;
			right: Float32Array;
			frameCount: number;
			timestamp: number;
		}[] = [];
		const meter = shouldNormalize ? new LoudnessMeter(snapshot.settings.sampleRate, 2) : null;
		let chunkCount = 0;

		for (let chunkStart = 0; chunkStart < plan.durationUs; chunkStart += chunkTicks) {
			cancelled(signal);
			const chunkDuration = Math.min(chunkTicks, plan.durationUs - chunkStart);
			const planar = await workerAudioMixer.mixChunkPlanar(
				chunkStart,
				chunkDuration,
				snapshot.settings.sampleRate,
				signal
			);
			if (planar) {
				if (meter) {
					meter.processFrames([planar.left, planar.right], planar.frameCount);
					planarList.push(planar);
				} else {
					const sample = createAudioSampleFromPlanar(planar, snapshot.settings.sampleRate);
					try {
						await audioSource.add(sample);
					} finally {
						sample.close();
					}
				}
			}
			chunkCount += 1;
			onChunk?.(chunkCount, totalChunks);
			await yieldToEventLoop();
		}

		if (meter && planarList.length > 0) {
			const measurements = meter.getMeasurements();
			let normalizationGain = 1.0;
			if (measurements.integratedLufs > -70 && targetLufs !== undefined) {
				normalizationGain = dbToGain(targetLufs - measurements.integratedLufs);
			}
			for (const p of planarList) {
				if (normalizationGain !== 1.0) {
					for (let i = 0; i < p.frameCount; i++) {
						p.left[i] = Math.max(-1, Math.min(1, p.left[i]! * normalizationGain));
						p.right[i] = Math.max(-1, Math.min(1, p.right[i]! * normalizationGain));
					}
				}
				const sample = createAudioSampleFromPlanar(p, snapshot.settings.sampleRate);
				try {
					await audioSource.add(sample);
				} finally {
					sample.close();
				}
			}
		}
		return;
	}

	if (audioBuffers) {
		const mixedList: { buffer: AudioBuffer; startTicks: number }[] = [];
		const meter = shouldNormalize ? new LoudnessMeter(snapshot.settings.sampleRate, 2) : null;
		let chunkCount = 0;

		for (let chunkStart = 0; chunkStart < plan.durationUs; chunkStart += chunkTicks) {
			cancelled(signal);
			const chunkDuration = Math.min(chunkTicks, plan.durationUs - chunkStart);
			const hasSchedules =
				settings.format === 'wav' ||
				audioSchedulesForChunk(snapshot, chunkStart, chunkDuration).length > 0;

			if (hasSchedules) {
				const mixed = await mixAudioChunk(
					snapshot,
					chunkStart,
					chunkDuration,
					audioBuffers,
					snapshot.settings.sampleRate
				);
				if (meter) {
					meter.processFrames([mixed.getChannelData(0), mixed.getChannelData(1)], mixed.length);
					mixedList.push({ buffer: mixed, startTicks: chunkStart });
				} else {
					for (const sample of AudioSample.fromAudioBuffer(mixed, chunkStart / 1_000_000)) {
						try {
							await audioSource.add(sample);
						} finally {
							sample.close();
						}
					}
				}
			}
			chunkCount += 1;
			onChunk?.(chunkCount, totalChunks);
			await yieldToEventLoop();
		}

		if (meter && mixedList.length > 0) {
			const measurements = meter.getMeasurements();
			let normalizationGain = 1.0;
			if (measurements.integratedLufs > -70 && targetLufs !== undefined) {
				normalizationGain = dbToGain(targetLufs - measurements.integratedLufs);
			}
			for (const item of mixedList) {
				const buf = item.buffer;
				if (normalizationGain !== 1.0) {
					for (let c = 0; c < buf.numberOfChannels; c++) {
						const d = buf.getChannelData(c);
						for (let i = 0; i < d.length; i++) {
							d[i] = Math.max(-1, Math.min(1, d[i]! * normalizationGain));
						}
					}
				}
				for (const sample of AudioSample.fromAudioBuffer(buf, item.startTicks / 1_000_000)) {
					try {
						await audioSource.add(sample);
					} finally {
						sample.close();
					}
				}
			}
		}
	}
}

async function exportTimelineMain(
	project: Project,
	settings: ExportSettings,
	options: ExportRunOptions = {}
): Promise<ExportResult> {
	let plan: ExportPlan;
	try {
		plan = buildExportPlan(project, settings);
		recordExportPlan({
			totalFrames: plan.totalFrames,
			durationUs: plan.durationUs,
			fps: plan.fps
		});
	} catch (error) {
		throw new ExportError(
			'EMPTY_TIMELINE',
			error instanceof Error ? error.message : 'Timeline cannot be exported.',
			{ cause: error }
		);
	}
	const snapshot = structuredClone(project);
	const sink = options.sink ?? (await createExportSink(settings.filename, settings.format));
	if (!sink) throw new ExportError('CANCELLED', 'Export save dialog was cancelled.');
	const frameProvider = new ExportFrameProvider(snapshot, options.getFile);
	let audioContext: AudioContext | null = null;
	let output: Output | null = null;
	let audioSource: AudioSampleSource | null = null;
	let audioBuffers: Map<AssetId, AudioBuffer> | null = null;
	let workerAudioMixer: WorkerAudioMixer | null = null;
	let renderer: FrameRenderer | null = null;
	const lastGoodFrames: LastGoodFrames = new Map();
	const startedAt = performance.now();
	let outputStarted = false;
	let completed = false;
	try {
		cancelled(options.signal);
		if (typeof OffscreenCanvas === 'undefined') {
			throw new ExportError('UNSUPPORTED_CODEC', 'OffscreenCanvas is unavailable in this browser.');
		}
		const is10Bit = (settings.bitDepth ?? 8) > 8;
		const canvas = new OffscreenCanvas(plan.width, plan.height);
		renderer = createFrameRenderer(canvas, {
			forceCanvas2d:
				(options.renderer ??
					forcedExportRenderer() ??
					(is10Bit || projectNeedsGpu(snapshot) ? 'webgl2' : 'canvas2d')) === 'canvas2d',
			preserveDrawingBuffer: true,
			alpha: Boolean(settings.alpha),
			highBitDepth: is10Bit,
			colorSpace: settings.colorSpaceTag === 'rec2020' ? 'display-p3' : 'srgb'
		});
		if (!renderer) throw new ExportError('UNSUPPORTED_CODEC', 'Canvas rendering is unavailable.');
		for (const asset of Object.values(snapshot.assets)) {
			if (asset.kind === 'lut' && !asset.offline) {
				await ensureLutLoaded(snapshot.id, asset, options.getFile);
			}
		}
		const allProjectTracks = [
			...snapshot.tracks,
			...Object.values(snapshot.sequences ?? {}).flatMap((s) => s.tracks ?? [])
		];
		for (const track of allProjectTracks) {
			for (const clip of track.clips ?? []) {
				for (const eff of clip.effects ?? []) {
					if (eff.type === 'lut3d' && eff.params?.lutAssetId) {
						const lutId = String(eff.params.lutAssetId);
						if (isBuiltinLutId(lutId)) {
							await ensureBuiltinLutLoaded(lutId);
						}
					}
				}
			}
		}
		const format =
			settings.format === 'mp4'
				? new Mp4OutputFormat()
				: settings.format === 'mov'
					? new MovOutputFormat()
					: settings.format === 'wav'
						? new WavOutputFormat()
						: new WebMOutputFormat();
		output = new Output({ format, target: sink.target });

		const canUsePlanar10Bit =
			is10Bit && renderer instanceof GlCompositor && renderer.isHighBitDepthSupported();

		if (is10Bit && !canUsePlanar10Bit) {
			options.onWarning?.(
				'10-bit export was requested, but the WebGL2 half-float rendering pipeline is unavailable. Falling back to 8-bit canvas source.'
			);
		}

		let videoSource: CanvasSource | VideoSampleSource | null = null;
		if (settings.format !== 'wav') {
			let videoCodec: VideoCodec = 'avc';
			if (settings.format === 'mp4') {
				if (
					options.videoCodec?.startsWith('hvc1') ||
					options.videoCodec?.startsWith('hev1') ||
					settings.codecId?.includes('hevc')
				) {
					videoCodec = 'hevc';
				} else if (options.videoCodec?.startsWith('av01') || settings.codecId?.includes('av1')) {
					videoCodec = 'av1';
				} else {
					videoCodec = 'avc';
				}
			} else if (settings.format === 'mov') {
				if (
					options.videoCodec?.startsWith('hvc1') ||
					options.videoCodec?.startsWith('hev1') ||
					settings.codecId?.includes('hevc')
				) {
					videoCodec = 'hevc';
				} else if (
					options.videoCodec?.startsWith('prores') ||
					options.videoCodec?.startsWith('ap') ||
					settings.codecId?.includes('prores')
				) {
					videoCodec = 'prores';
				} else {
					videoCodec = 'avc';
				}
			} else {
				if (options.videoCodec?.startsWith('av01') || settings.codecId?.includes('av1')) {
					videoCodec = 'av1';
				} else if (options.videoCodec?.startsWith('vp8')) {
					videoCodec = 'vp8';
				} else {
					videoCodec = 'vp9';
				}
			}

			const fullCodecString =
				options.videoCodec ??
				(settings.codecId
					? VIDEO_CODEC_REGISTRY.find((c) => c.id === settings.codecId)?.videoCodecString
					: undefined);

			if (canUsePlanar10Bit) {
				videoSource = new VideoSampleSource({
					codec: videoCodec,
					...(fullCodecString ? { fullCodecString } : {}),
					bitrate: settings.videoBitrate,
					keyFrameInterval: 2,
					latencyMode: 'quality',
					...(settings.alpha ? { alpha: 'keep' } : {})
				});
			} else {
				videoSource = new CanvasSource(canvas, {
					codec: videoCodec,
					...(fullCodecString ? { fullCodecString } : {}),
					bitrate: settings.videoBitrate,
					keyFrameInterval: 2,
					latencyMode: 'quality',
					...(settings.alpha ? { alpha: 'keep' } : {})
				});
			}
			output.addVideoTrack(videoSource);
		}

		const hasAudioAssets = Object.values(snapshot.assets).some(
			(asset) => asset.hasAudio && !asset.offline
		);
		if ((settings.audio && hasAudioAssets) || settings.format === 'wav') {
			if (typeof AudioContext === 'undefined') {
				workerAudioMixer = new WorkerAudioMixer(
					snapshot,
					options.getFile ?? getMediaFile,
					options.onWarning
				);
			} else {
				audioContext = new AudioContext();
				audioBuffers = await decodeAudioAssets(
					snapshot,
					audioContext,
					options.getFile,
					options.onWarning
				);
			}
			if (
				[...snapshot.tracks].some(
					(track) => track.kind === 'audio' && !track.muted && track.clips.length
				) ||
				settings.format === 'wav'
			) {
				let audioCodec: AudioCodec = 'aac';
				if (settings.format === 'wav') {
					audioCodec =
						settings.audioCodecId === 'pcm24'
							? 'pcm-s24'
							: settings.audioCodecId === 'pcm32f'
								? 'pcm-f32'
								: 'pcm-s16';
				} else if (settings.format === 'mov') {
					if (settings.audioCodecId === 'pcm16') audioCodec = 'pcm-s16';
					else if (settings.audioCodecId === 'pcm24') audioCodec = 'pcm-s24';
					else if (settings.audioCodecId === 'pcm32f') audioCodec = 'pcm-f32';
					else audioCodec = 'aac';
				} else if (settings.format === 'webm') {
					audioCodec = 'opus';
				} else {
					audioCodec = 'aac';
				}

				const isPcm = audioCodec.startsWith('pcm');
				audioSource = new AudioSampleSource({
					codec: audioCodec,
					...(options.audioCodec && !isPcm ? { fullCodecString: options.audioCodec } : {}),
					...(isPcm ? {} : { bitrate: settings.audioBitrate })
				});
				output.addAudioTrack(audioSource);
			}
		}

		if (settings.format === 'wav') {
			emitProgress(options.onProgress, {
				framesDone: 0,
				totalFrames: plan.totalFrames,
				fps: 0,
				etaMs: 0,
				phase: 'preparing'
			});
			await output.start();
			outputStarted = true;
			const chunkTicks = 10_000_000;
			const totalChunks = Math.max(1, Math.ceil(plan.durationUs / chunkTicks));
			if (audioSource) {
				await exportAudioTrack({
					snapshot,
					plan,
					settings,
					audioSource,
					workerAudioMixer,
					audioBuffers,
					signal: options.signal,
					onChunk: (chunkIndex, total) => {
						emitProgress(options.onProgress, {
							framesDone: chunkIndex,
							totalFrames: total,
							fps: 0,
							etaMs: 0,
							phase: 'rendering'
						});
					}
				});
			}
			emitProgress(options.onProgress, {
				framesDone: totalChunks,
				totalFrames: totalChunks,
				fps: 0,
				etaMs: 0,
				phase: 'finalizing'
			});
			await output.finalize();
			output = null;
			const blob = await sink.finish();
			emitProgress(options.onProgress, {
				framesDone: totalChunks,
				totalFrames: totalChunks,
				fps: 0,
				etaMs: 0,
				phase: 'complete'
			});
			return { blob, plan, path: 'main-webcodecs' };
		}

		emitProgress(options.onProgress, {
			framesDone: 0,
			totalFrames: plan.totalFrames,
			fps: 0,
			etaMs: 0,
			phase: 'preparing'
		});
		await output.start();
		outputStarted = true;
		for (let frame = 0; frame < plan.totalFrames; frame += 1) {
			cancelled(options.signal);
			const timestamp = plan.timestamp(frame);
			const resolved = resolveFrame(snapshot, timestamp);
			await frameProvider.prepare(resolved.videoLayers, options.signal);
			if (
				canUsePlanar10Bit &&
				renderer instanceof GlCompositor &&
				videoSource instanceof VideoSampleSource
			) {
				const videoFrame = renderer.renderVideoFrame(
					{ width: plan.width, height: plan.height },
					resolved.videoLayers,
					(layer: ActiveLayer) => frameProvider.getFrame(layer),
					lastGoodFrames,
					{
						transparent: Boolean(settings.alpha),
						dither: true,
						bitDepth: 10,
						matrix: settings.colorSpaceTag === 'rec2020' ? 'bt2020' : 'bt709',
						range: settings.colorSpaceTag === 'rec2020' ? 'limited' : 'full',
						frameIndex: frame,
						timestampUs: Number(timestamp)
					}
				);
				if (!videoFrame) {
					throw new ExportError('ENCODE_FAILED', 'Failed to render 10-bit VideoFrame.');
				}
				const sample = new VideoSample(videoFrame, {
					duration: plan.frameDuration / 1_000_000
				});
				try {
					await videoSource.add(sample, {
						keyFrame: frame % (plan.fps * 2) === 0
					});
				} finally {
					sample.close();
				}
			} else {
				renderer.render(
					{ width: plan.width, height: plan.height },
					resolved.videoLayers,
					(layer) => frameProvider.getFrame(layer),
					lastGoodFrames,
					{
						transparent: Boolean(settings.alpha),
						dither: (settings.bitDepth ?? 8) > 8,
						bitDepth: (settings.bitDepth ?? 8) > 8 ? 10 : 8,
						frameIndex: frame
					}
				);
				if (videoSource instanceof CanvasSource) {
					await videoSource.add(timestamp / 1_000_000, plan.frameDuration / 1_000_000, {
						keyFrame: frame % (plan.fps * 2) === 0
					});
				}
			}

			if (audioSource && frame === 0) {
				await exportAudioTrack({
					snapshot,
					plan,
					settings,
					audioSource,
					workerAudioMixer,
					audioBuffers,
					signal: options.signal
				});
			}
			if (frame === 0 || frame % Math.max(1, Math.floor(plan.fps / 2)) === 0) {
				const elapsed = Math.max(1, performance.now() - startedAt);
				const currentFps = ((frame + 1) * 1000) / elapsed;
				emitProgress(options.onProgress, {
					framesDone: frame + 1,
					totalFrames: plan.totalFrames,
					fps: currentFps,
					etaMs: Math.max(0, ((plan.totalFrames - frame - 1) * 1000) / currentFps),
					phase: 'rendering'
				});
			}
			await yieldToEventLoop();
		}
		cancelled(options.signal);
		emitProgress(options.onProgress, {
			framesDone: plan.totalFrames,
			totalFrames: plan.totalFrames,
			fps: plan.totalFrames / Math.max(0.001, (performance.now() - startedAt) / 1000),
			etaMs: 0,
			phase: 'finalizing'
		});
		await output.finalize();
		const blob = await sink.finish();
		completed = true;
		emitProgress(options.onProgress, {
			framesDone: plan.totalFrames,
			totalFrames: plan.totalFrames,
			fps: plan.totalFrames / Math.max(0.001, (performance.now() - startedAt) / 1000),
			etaMs: 0,
			phase: 'complete'
		});
		recordExportRenderer(renderer.kind);
		return { blob, plan, renderer: renderer.kind };
	} catch (error) {
		if (outputStarted && output && output.state !== 'finalized' && output.state !== 'canceled') {
			await output.cancel();
		}
		await sink.abort(error);
		if (error instanceof ExportError) throw error;
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw new ExportError('CANCELLED', 'Export cancelled.', { cause: error });
		}
		throw new ExportError(
			error instanceof Error &&
				(error.name === 'FrameProviderError' || error.name === 'AudioMixError')
				? 'DECODE_FAILED'
				: 'ENCODE_FAILED',
			error instanceof Error ? error.message : 'Video export failed.',
			{ cause: error }
		);
	} finally {
		renderer?.dispose();
		await frameProvider.dispose();
		await workerAudioMixer?.dispose();
		if (audioContext && audioContext.state !== 'closed') await audioContext.close();
		if (!completed && output?.state === 'started') await output.cancel();
	}
}

function terminateWorker(worker: Worker): void {
	worker.terminate();
	recordWorkerTermination();
}

function workerError(code: string, message: string): ExportError {
	return new ExportError(
		code === 'CANCELLED'
			? 'CANCELLED'
			: code === 'UNSUPPORTED_CODEC'
				? 'UNSUPPORTED_CODEC'
				: code === 'DECODE_FAILED'
					? 'DECODE_FAILED'
					: 'ENCODE_FAILED',
		message
	);
}

async function tryWorkerExport(
	settings: ExportSettings,
	plan: ExportPlan,
	snapshot: Project,
	options: ExportRunOptions,
	streaming: StreamingSaveTarget | null
): Promise<ExportResult | null> {
	const unsupportedReason = workerExportFallbackReason({
		moduleWorker: typeof Worker !== 'undefined',
		offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
		workerWebCodecs: true
	});
	if (unsupportedReason || options.sink || (options.getFile && options.getFile !== getMediaFile)) {
		if (unsupportedReason) options.onFallback?.(unsupportedReason);
		return null;
	}

	let worker: Worker;
	try {
		worker =
			options.workerFactory?.() ??
			new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
	} catch {
		return null;
	}

	const memoryChunks: Uint8Array[] = [];
	let bytes = 0;
	let settled = false;
	let started = false;
	let resolveResult: ((value: ExportResult) => void) | undefined;
	let rejectResult: ((error: Error) => void) | undefined;
	let resolveReady: ((value: { supported: boolean; reason?: string }) => void) | undefined;
	let probeSettled = false;
	let cancelTimer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	const resultPromise = new Promise<ExportResult>((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});

	const finish = async (error?: Error, result?: ExportResult) => {
		if (settled) return;
		settled = true;
		if (cancelTimer !== undefined) clearTimeout(cancelTimer);
		if (onAbort && options.signal) options.signal.removeEventListener('abort', onAbort);
		if (error) {
			try {
				await streaming?.abort(error);
			} catch (abortError) {
				error = new ExportError('STORAGE_FAILED', 'Could not discard the partial export file.', {
					cause: abortError
				});
			}
			rejectResult?.(error);
		} else if (result) {
			resolveResult?.(result);
		}
		terminateWorker(worker);
	};

	const ready = new Promise<{ supported: boolean; reason?: string }>((resolve) => {
		resolveReady = resolve;
	});
	let lastReportedFps = 0;

	worker.addEventListener('message', (event: MessageEvent<ExportWorkerResponse>) => {
		const message = event.data;
		if (message.type === 'ready') {
			if (!probeSettled) {
				probeSettled = true;
				resolveReady?.({
					supported: message.supported,
					...(message.reason ? { reason: message.reason } : {})
				});
			}
			return;
		}
		if (message.type === 'progress') {
			lastReportedFps = message.fps;
			emitProgress(options.onProgress, {
				phase: message.phase as ExportProgressPhase,
				framesDone: message.framesDone,
				totalFrames: message.totalFrames,
				fps: message.fps,
				etaMs: message.etaMs
			});
			return;
		}
		if (message.type === 'warning') {
			options.onWarning?.(message.message);
			return;
		}
		if (message.type === 'chunk') {
			const chunkId = message.chunkId;
			void (async () => {
				try {
					const chunk = new Uint8Array(message.buffer);
					if (streaming) await streaming.write(chunk, message.position);
					else memoryChunks.push(chunk.slice());
					bytes += chunk.byteLength;
					const ack: ExportWorkerRequest = { type: 'ack', jobId: message.jobId, chunkId };
					worker.postMessage(ack);
				} catch (error) {
					const failure =
						error instanceof Error ? error : new Error('Could not write export output.');
					const ack: ExportWorkerRequest = {
						type: 'ack',
						jobId: message.jobId,
						chunkId,
						error: failure.message
					};
					worker.postMessage(ack);
					await finish(new ExportError('STORAGE_FAILED', failure.message, { cause: error }));
				}
			})();
			return;
		}
		if (message.type === 'done') {
			void (async () => {
				try {
					if (message.bytes !== bytes) {
						throw new Error('Export worker output byte count did not match the received chunks.');
					}
					if (streaming) await streaming.close();
					const blob = streaming
						? null
						: new Blob(
								memoryChunks.map((chunk) => {
									const copy = new Uint8Array(chunk.byteLength);
									copy.set(chunk);
									return copy.buffer;
								}),
								{
									type:
										settings.format === 'mp4'
											? 'video/mp4'
											: settings.format === 'mov'
												? 'video/quicktime'
												: settings.format === 'wav'
													? 'audio/wav'
													: 'video/webm'
								}
							);
					emitProgress(options.onProgress, {
						phase: 'complete',
						framesDone: plan.totalFrames,
						totalFrames: plan.totalFrames,
						fps: lastReportedFps,
						etaMs: 0
					});
					if (message.renderer) recordExportRenderer(message.renderer);
					await finish(undefined, {
						blob,
						plan,
						bytes,
						path: 'worker-webcodecs',
						...(message.renderer ? { renderer: message.renderer } : {})
					});
				} catch (error) {
					await finish(
						error instanceof Error ? error : new Error('Could not finalize the export file.')
					);
				}
			})();
			return;
		}
		if (message.type === 'error') {
			if (!started) {
				probeSettled = true;
				resolveReady?.({ supported: false, reason: message.message });
				return;
			}
			void finish(workerError(message.code, message.message));
		}
	});
	worker.addEventListener('error', (event) => {
		if (!started) {
			probeSettled = true;
			resolveReady?.({ supported: false, reason: event.message });
			return;
		}
		void finish(new ExportError('ENCODE_FAILED', event.message || 'The export worker failed.'));
	});
	worker.addEventListener('messageerror', () => {
		if (!started) {
			probeSettled = true;
			resolveReady?.({ supported: false, reason: 'Worker message transfer is unavailable.' });
			return;
		}
		void finish(new ExportError('ENCODE_FAILED', 'Could not transfer export data to the worker.'));
	});

	try {
		const probe: ExportWorkerRequest = { type: 'probe', settings };
		worker.postMessage(probe);
		const workerResult = await Promise.race([
			ready,
			new Promise<{ supported: boolean; reason: string }>((resolve) =>
				setTimeout(
					() => resolve({ supported: false, reason: 'Worker capability check timed out.' }),
					2_000
				)
			)
		]);
		if (!workerResult.supported) {
			terminateWorker(worker);
			options.onFallback?.(
				workerExportFallbackReason({
					moduleWorker: true,
					offscreenCanvas: true,
					workerWebCodecs: false
				}) ??
					workerResult.reason ??
					'Worker WebCodecs is unavailable.'
			);
			return null;
		}

		const files: Array<{ assetId: AssetId; file: File }> = [];
		for (const asset of Object.values(snapshot.assets)) {
			if (asset.offline) continue;
			files.push({
				assetId: asset.id,
				file: await (options.getFile ?? getMediaFile)(snapshot.id, asset)
			});
		}
		const jobId = crypto.randomUUID();
		const effectiveRenderer = options.renderer ?? forcedExportRenderer();
		const message: ExportWorkerRequest = {
			type: 'start',
			jobId,
			project: snapshot,
			settings,
			files,
			...(options.videoCodec ? { videoCodec: options.videoCodec } : {}),
			...(options.audioCodec ? { audioCodec: options.audioCodec } : {}),
			...(effectiveRenderer ? { renderer: effectiveRenderer } : {})
		};
		started = true;
		recordExportPath('worker-webcodecs');
		worker.postMessage(message);
		onAbort = () => {
			if (!started || settled) return;
			const cancel: ExportWorkerRequest = { type: 'cancel', jobId };
			worker.postMessage(cancel);
			cancelTimer = setTimeout(() => {
				void finish(new ExportError('CANCELLED', 'Export cancelled; worker cleanup timed out.'));
			}, 2_000);
		};
		options.signal?.addEventListener('abort', onAbort, { once: true });
		if (options.signal?.aborted) onAbort();
		return await resultPromise;
	} catch (error) {
		if (started) {
			await finish(error instanceof Error ? error : new Error('Worker export failed.'));
			throw error;
		}
		terminateWorker(worker);
		options.onFallback?.('The export worker could not be initialized.');
		if (error instanceof DOMException && error.name === 'AbortError') throw error;
		return null;
	}
}

export async function exportTimeline(
	project: Project,
	settings: ExportSettings,
	options: ExportRunOptions = {}
): Promise<ExportResult> {
	if (options.forceMainThread || options.sink) {
		recordExportPath('main-webcodecs');
		return { ...(await exportTimelineMain(project, settings, options)), path: 'main-webcodecs' };
	}
	const plan = buildExportPlan(project, settings);
	recordExportPlan({
		totalFrames: plan.totalFrames,
		durationUs: plan.durationUs,
		fps: plan.fps
	});
	const snapshot = structuredClone(project);
	let streaming: StreamingSaveTarget | null = null;
	try {
		const mimeType =
			settings.format === 'mp4'
				? 'video/mp4'
				: settings.format === 'mov'
					? 'video/quicktime'
					: settings.format === 'wav'
						? 'audio/wav'
						: 'video/webm';
		const description =
			settings.format === 'mp4'
				? 'MP4 video'
				: settings.format === 'mov'
					? 'QuickTime MOV'
					: settings.format === 'wav'
						? 'WAV audio'
						: 'WebM video';
		streaming = await createStreamingSaveTarget(settings.filename, [
			{
				description,
				accept: {
					[mimeType]: [`.${settings.format}`]
				}
			}
		]);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw new ExportError('CANCELLED', 'Export save dialog was cancelled.', { cause: error });
		}
		throw error;
	}
	try {
		const workerResult = await tryWorkerExport(settings, plan, snapshot, options, streaming);
		if (workerResult) return workerResult;
		recordExportPath('main-webcodecs');
		options.onFallback?.(
			'Worker WebCodecs is unavailable; using the yielding main-thread encoder.'
		);
		const sink = createExportSinkForTarget(settings.format, streaming);
		return {
			...(await exportTimelineMain(project, settings, { ...options, sink })),
			path: 'main-webcodecs'
		};
	} catch (error) {
		if (error instanceof ExportError && error.code === 'CANCELLED') throw error;
		throw error;
	}
}
