import { assetDefaults, classifyMime, secondsToTicks } from '../../core';
import type {
	AssetKind,
	ProjectSettings,
	Time,
	AssetVideoMetadata,
	AssetAudioMetadata
} from '../../core';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ProbedMedia {
	kind: AssetKind;
	duration: Time;
	width?: number;
	height?: number;
	fps?: number;
	fpsEstimated?: boolean;
	hasAudio: boolean;
	audioChecked: boolean;
	audioDecodable?: boolean;
	audioCodec?: string;
	videoDecodable?: boolean;
	videoCodec?: string;
	bitDepth?: number;
	colorSpace?: VideoColorSpaceInit;
	isHdr?: boolean;
	isInterlaced?: boolean;
	isVfr?: boolean;
	transfer?: string;
	video?: AssetVideoMetadata;
	audio?: AssetAudioMetadata;
}

function waitForEvent(
	element: HTMLMediaElement | HTMLImageElement,
	events: string[],
	signal: AbortSignal | undefined,
	timeoutMs: number
): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = window.setTimeout(() => {
			cleanup();
			reject(new Error('Timed out while reading media metadata.'));
		}, timeoutMs);
		const cleanup = () => {
			window.clearTimeout(timeout);
			for (const eventName of events) element.removeEventListener(eventName, onSuccess);
			element.removeEventListener('error', onError);
			signal?.removeEventListener('abort', onAbort);
		};
		const onSuccess = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("Browser can't decode this file; try MP4 (H.264/AAC) or WebM."));
		};
		const onAbort = () => {
			cleanup();
			reject(new DOMException('The operation was aborted.', 'AbortError'));
		};
		for (const eventName of events) element.addEventListener(eventName, onSuccess, { once: true });
		element.addEventListener('error', onError, { once: true });
		signal?.addEventListener('abort', onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}

async function estimateFrameRate(
	video: HTMLVideoElement,
	fallback: number,
	signal?: AbortSignal
): Promise<{ fps: number; estimated: boolean }> {
	if (!video.requestVideoFrameCallback) return { fps: fallback, estimated: true };
	video.muted = true;
	video.playsInline = true;
	video.preload = 'metadata';
	let frames = 0;
	let start = 0;
	let end = 0;
	try {
		await video.play();
		await new Promise<void>((resolve) => {
			const stop = window.setTimeout(resolve, 1_500);
			const onAbort = () => {
				window.clearTimeout(stop);
				resolve();
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
				if (frames === 0) start = metadata.mediaTime;
				end = metadata.mediaTime;
				frames += 1;
				if (frames >= 10 || signal?.aborted) {
					window.clearTimeout(stop);
					signal?.removeEventListener('abort', onAbort);
					resolve();
					return;
				}
				video.requestVideoFrameCallback(onFrame);
			};
			video.requestVideoFrameCallback(onFrame);
		});
	} catch {
		return { fps: fallback, estimated: true };
	} finally {
		video.pause();
	}
	if (frames < 2 || end <= start) return { fps: fallback, estimated: true };
	const measured = (frames - 1) / (end - start);
	if (!Number.isFinite(measured) || measured < 1 || measured > 240) {
		return { fps: fallback, estimated: true };
	}
	return { fps: Math.round(measured * 100) / 100, estimated: false };
}

function makeProbeVideo(): HTMLVideoElement {
	const video = document.createElement('video');
	video.crossOrigin = 'anonymous';
	video.preload = 'metadata';
	video.muted = true;
	video.playsInline = true;
	video.setAttribute('aria-hidden', 'true');
	video.style.position = 'fixed';
	video.style.width = '1px';
	video.style.height = '1px';
	video.style.opacity = '0';
	video.style.pointerEvents = 'none';
	document.body.append(video);
	return video;
}

async function probeContainer(
	file: File,
	kind: AssetKind,
	fallbackFps: number
): Promise<ProbedMedia> {
	const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
	try {
		const videoTrack = kind === 'video' ? await input.getPrimaryVideoTrack() : null;
		const audioTrack =
			kind === 'audio' ? await input.getPrimaryAudioTrack() : await input.getPrimaryAudioTrack();
		const primaryTrack = kind === 'video' ? videoTrack : audioTrack;
		if (!primaryTrack) throw new Error(`No ${kind} track was found in “${file.name}”.`);

		const duration = await input.getDurationFromMetadata([
			...(videoTrack ? [videoTrack] : []),
			...(audioTrack ? [audioTrack] : [])
		]);
		if (duration === null || !Number.isFinite(duration) || duration <= 0) {
			throw new Error(`Could not read a valid duration from “${file.name}”.`);
		}

		const videoCodec = videoTrack ? await videoTrack.getCodecParameterString() : null;
		const audioCodec = audioTrack ? await audioTrack.getCodecParameterString() : null;
		const [
			videoDecodable,
			audioDecodable,
			displayWidth,
			displayHeight,
			frameRate,
			colorSpace,
			hasHdr,
			audioChannels,
			audioSampleRate
		] = await Promise.all([
			videoTrack?.canDecode().catch(() => false),
			audioTrack?.canDecode().catch(() => false),
			videoTrack?.getDisplayWidth().catch(() => undefined),
			videoTrack?.getDisplayHeight().catch(() => undefined),
			videoTrack?.computeFrameRateMetrics({ targetPacketCount: 64 }).catch(() => null),
			videoTrack?.getColorSpace().catch(() => undefined),
			videoTrack?.hasHighDynamicRange().catch(() => false),
			audioTrack?.getNumberOfChannels().catch(() => undefined),
			audioTrack?.getSampleRate().catch(() => undefined)
		]);
		const fps = frameRate?.bestGuessFrameRate ?? fallbackFps;

		let bitDepth = 8;
		const transfer = colorSpace?.transfer as string | undefined;
		const isHdr = Boolean(
			hasHdr ||
			transfer === 'smpte2084' ||
			transfer === 'pq' ||
			transfer === 'arib-std-b67' ||
			transfer === 'hlg'
		);
		if (isHdr) {
			bitDepth = 10;
		} else if (videoCodec) {
			const c = videoCodec.toLowerCase();
			if (
				c.startsWith('vp09.02') ||
				c.startsWith('av01.0.10') ||
				c.startsWith('hvc1.2') ||
				c.startsWith('hev1.2') ||
				c.includes('prores') ||
				c.includes('apch') ||
				c.includes('ap4h')
			) {
				bitDepth = 10;
			}
		}
		const isVfr = videoTrack ? (frameRate ? !frameRate.frameRateIsConstant : false) : false;

		const videoMetadata: AssetVideoMetadata | undefined = videoTrack
			? {
					width: displayWidth,
					height: displayHeight,
					fps,
					fpsEstimated: !frameRate?.frameRateIsConstant,
					codec: videoCodec ?? undefined,
					decodable: videoDecodable ?? false,
					bitDepth,
					colorSpace: colorSpace ?? undefined,
					isHdr,
					isInterlaced: false,
					isVfr,
					transfer: colorSpace?.transfer ?? undefined,
					primaries: colorSpace?.primaries ?? undefined,
					matrix: colorSpace?.matrix ?? undefined,
					fullRange: colorSpace?.fullRange ?? undefined
				}
			: undefined;

		const audioMetadata: AssetAudioMetadata | undefined = audioTrack
			? {
					sampleRate: audioSampleRate ?? undefined,
					channels: audioChannels ?? undefined,
					codec: audioCodec ?? undefined,
					decodable: audioDecodable ?? false,
					bitDepth: 16
				}
			: undefined;

		return {
			kind,
			duration: secondsToTicks(duration),
			...(displayWidth === undefined ? {} : { width: displayWidth }),
			...(displayHeight === undefined ? {} : { height: displayHeight }),
			...(videoTrack ? { fps, fpsEstimated: !frameRate?.frameRateIsConstant } : {}),
			hasAudio: audioTrack !== null,
			audioChecked: true,
			...(audioTrack ? { audioDecodable: audioDecodable ?? false } : {}),
			...(audioCodec ? { audioCodec } : {}),
			...(videoTrack ? { videoDecodable: videoDecodable ?? false } : {}),
			...(videoCodec ? { videoCodec } : {}),
			bitDepth,
			colorSpace: colorSpace ?? undefined,
			isHdr,
			isInterlaced: false,
			isVfr,
			transfer: colorSpace?.transfer ?? undefined,
			video: videoMetadata,
			audio: audioMetadata
		};
	} finally {
		input.dispose();
	}
}

async function probeWithBrowser(
	file: File,
	kind: AssetKind,
	settings: Pick<ProjectSettings, 'fps'>,
	options: { signal?: AbortSignal; timeoutMs: number }
): Promise<ProbedMedia> {
	const url = URL.createObjectURL(file);
	try {
		if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
		if (kind === 'font') {
			const familyName = file.name.replace(/\.[^/.]+$/, '');
			try {
				if (typeof FontFace !== 'undefined') {
					const face = new FontFace(familyName, `url(${url})`, { display: 'swap' });
					await face.load();
					if (typeof document !== 'undefined' && document.fonts) {
						document.fonts.add(face);
					}
				}
			} catch {
				// font loading failed or not supported in current environment
			}
			return {
				kind,
				duration: 0,
				hasAudio: false,
				audioChecked: true
			};
		}

		if (kind === 'image') {
			const image = new Image();
			const loaded = waitForEvent(image, ['load'], options.signal, options.timeoutMs);
			image.src = url;
			await loaded;
			return {
				kind,
				duration: assetDefaults('image').duration,
				width: image.naturalWidth,
				height: image.naturalHeight,
				hasAudio: false,
				audioChecked: true
			};
		}

		if (kind === 'audio') {
			const audio = document.createElement('audio');
			audio.preload = 'metadata';
			const loaded = waitForEvent(audio, ['loadedmetadata'], options.signal, options.timeoutMs);
			audio.src = url;
			await loaded;
			if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
				throw new Error("Browser can't read this file's audio metadata.");
			}
			return {
				kind,
				duration: secondsToTicks(audio.duration),
				hasAudio: true,
				audioChecked: false
			};
		}

		const video = makeProbeVideo();
		try {
			const loaded = waitForEvent(video, ['loadedmetadata'], options.signal, options.timeoutMs);
			video.src = url;
			await loaded;
			if (!Number.isFinite(video.duration) || video.duration <= 0) {
				throw new Error("Browser can't read this file's video metadata.");
			}
			const frameRate = await estimateFrameRate(video, settings.fps, options.signal);
			return {
				kind,
				duration: secondsToTicks(video.duration),
				width: video.videoWidth,
				height: video.videoHeight,
				fps: frameRate.fps,
				fpsEstimated: true,
				hasAudio: false,
				audioChecked: false
			};
		} finally {
			video.pause();
			video.removeAttribute('src');
			video.load();
			video.remove();
		}
	} finally {
		URL.revokeObjectURL(url);
	}
}

export async function probeMedia(
	file: File,
	settings: Pick<ProjectSettings, 'fps'>,
	options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ProbedMedia> {
	const kind = classifyMime(file.type, file.name);
	if (!kind)
		throw new Error('Unsupported media type. Choose a supported video, audio, or image file.');
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
	if (kind === 'lut') {
		return {
			kind,
			duration: 0,
			hasAudio: false,
			audioChecked: true
		};
	}
	if (kind === 'font' || kind === 'image') {
		return probeWithBrowser(file, kind, settings, { ...options, timeoutMs });
	}
	try {
		return await probeContainer(file, kind, settings.fps);
	} catch (containerError) {
		if (containerError instanceof DOMException && containerError.name === 'AbortError') {
			throw containerError;
		}
		try {
			return await probeWithBrowser(file, kind, settings, { ...options, timeoutMs });
		} catch (browserError) {
			const detail =
				containerError instanceof Error ? ` Container inspection: ${containerError.message}` : '';
			if (browserError instanceof Error) {
				throw new Error(`${browserError.message}${detail}`, { cause: browserError });
			}
			throw browserError;
		}
	}
}
