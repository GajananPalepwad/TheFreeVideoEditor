import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	EncodedAudioPacketSource,
	EncodedPacketSink,
	EncodedVideoPacketSource,
	Input,
	Output,
	WebMOutputFormat
} from 'mediabunny';
import type { InputAudioTrack, InputVideoTrack } from 'mediabunny';
import type { ActiveLayer, Project } from '../../core';
import { resolveFrame } from '../../core';
import { renderFrame } from '../playback/compositor';
import { getMediaFile } from '../storage/opfs';
import { audioSchedulesForChunk, decodeAudioAssets } from './audioMix';
import type { ExportProgress } from './exporter';
import { ExportError } from './exporter';
import { CompatibilityFrameProvider } from './compatibilityFrameProvider';
import { buildExportPlan, type ExportSettings } from './plan';

export interface RecorderExportResult {
	blob: Blob;
	mimeType: string;
	filename: string;
}

function chooseRecorderMimeType(audio: boolean): string {
	const candidates = audio
		? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
		: ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];
	const selected = candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
	if (!selected) {
		throw new ExportError('UNSUPPORTED_CODEC', 'This browser cannot record WebM video.');
	}
	return selected;
}

async function finalizeWebm(blob: Blob, signal?: AbortSignal): Promise<Blob> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	let outputStarted = false;
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) throw new Error('The browser recording did not contain a video track.');
		const videoCodec = await videoTrack.getCodec();
		if (!videoCodec) throw new Error('The recorded video codec could not be identified.');
		const videoDecoderConfig = await videoTrack.getDecoderConfig();
		const videoSource = new EncodedVideoPacketSource(videoCodec);
		output.addVideoTrack(videoSource);

		const audioTrack = await input.getPrimaryAudioTrack();
		const audioCodec = await audioTrack?.getCodec();
		if (audioTrack && !audioCodec)
			throw new Error('The recorded audio codec could not be identified.');
		const audioSource = audioCodec ? new EncodedAudioPacketSource(audioCodec) : null;
		const audioDecoderConfig = await audioTrack?.getDecoderConfig();
		if (audioSource) output.addAudioTrack(audioSource);
		await output.start();
		outputStarted = true;

		const copyVideoPackets = async (track: InputVideoTrack) => {
			const packets = new EncodedPacketSink(track);
			let firstPacket = true;
			for await (const packet of packets.packets()) {
				if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
				await videoSource.add(
					packet,
					firstPacket && videoDecoderConfig ? { decoderConfig: videoDecoderConfig } : undefined
				);
				firstPacket = false;
			}
			videoSource.close();
		};
		const copyAudioPackets = async (track: InputAudioTrack) => {
			if (!audioSource) return;
			const packets = new EncodedPacketSink(track);
			let firstPacket = true;
			for await (const packet of packets.packets()) {
				if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
				await audioSource.add(
					packet,
					firstPacket && audioDecoderConfig ? { decoderConfig: audioDecoderConfig } : undefined
				);
				firstPacket = false;
			}
			audioSource.close();
		};

		const copyVideo = copyVideoPackets(videoTrack);
		const copyAudio = audioTrack && audioSource ? copyAudioPackets(audioTrack) : Promise.resolve();
		await Promise.all([copyVideo, copyAudio]);
		if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
		await output.finalize();
		if (!target.buffer) throw new Error('Could not finalize the WebM recording.');
		return new Blob([target.buffer], { type: 'video/webm' });
	} catch (error) {
		if (outputStarted && output.state !== 'finalized' && output.state !== 'canceled') {
			await output.cancel();
		}
		throw error;
	} finally {
		input.dispose();
	}
}

async function activeAudioSources(
	project: Project,
	context: AudioContext,
	destination: MediaStreamAudioDestinationNode,
	getFile: typeof getMediaFile = getMediaFile,
	onWarning?: (message: string) => void
): Promise<void> {
	const buffers = await decodeAudioAssets(project, context, getFile, onWarning);
	const duration = Math.max(
		1,
		project.tracks
			.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration))
			.reduce((latest, end) => Math.max(latest, end), 0)
	);
	const schedules = audioSchedulesForChunk(project, 0, duration);
	for (const schedule of schedules) {
		const buffer = buffers.get(schedule.assetId);
		if (!buffer) continue;
		const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === schedule.clipId);
		const source = context.createBufferSource();
		const when = context.currentTime + 0.15 + schedule.whenSeconds;
		if (clip && (clip.timeRemap || clip.speed < 0)) {
			const { renderRemappedAudio } = await import('../audio/renderRemappedAudio');
			const sourceChannels: Float32Array[] = [];
			for (let c = 0; c < buffer.numberOfChannels; c++) {
				sourceChannels.push(buffer.getChannelData(c));
			}
			const remapped = renderRemappedAudio({
				clip,
				sourceChannels,
				sourceSampleRate: buffer.sampleRate
			});
			const numChan = remapped.channels.length;
			const numFrames = remapped.channels[0]?.length ?? 0;
			if (numFrames > 0) {
				const remappedBuffer = context.createBuffer(numChan, numFrames, remapped.sampleRate);
				for (let c = 0; c < numChan; c++) {
					remappedBuffer.copyToChannel(
						remapped.channels[c] as unknown as Float32Array<ArrayBuffer>,
						c
					);
				}
				source.buffer = remappedBuffer;
				source.playbackRate.value = 1;
				const gain = context.createGain();
				gain.gain.value = schedule.volume;
				source.connect(gain).connect(destination);
				source.start(when);
			}
			continue;
		}
		source.buffer = buffer;
		source.playbackRate.value = schedule.playbackRate;
		const gain = context.createGain();
		gain.gain.value = schedule.volume;
		source.connect(gain).connect(destination);
		source.start(when, schedule.sourceOffsetSeconds, schedule.sourceDurationSeconds);
	}
}

function progress(
	onProgress: ((event: ExportProgress) => void) | undefined,
	framesDone: number,
	totalFrames: number,
	fps: number,
	etaMs: number
): void {
	onProgress?.({
		framesDone,
		totalFrames,
		fps,
		etaMs,
		phase: 'rendering',
		percent: totalFrames ? Math.min(99, Math.round((framesDone / totalFrames) * 100)) : 0
	});
}

export async function exportWithMediaRecorder(
	project: Project,
	settings: ExportSettings,
	options: {
		signal?: AbortSignal;
		onProgress?: (event: ExportProgress) => void;
		getFile?: typeof getMediaFile;
		onWarning?: (message: string) => void;
	} = {}
): Promise<RecorderExportResult> {
	if (typeof MediaRecorder === 'undefined') {
		throw new ExportError('UNSUPPORTED_CODEC', 'MediaRecorder is unavailable in this browser.');
	}
	if (settings.format !== 'webm') {
		throw new ExportError(
			'UNSUPPORTED_CODEC',
			'Compatibility recording exports WebM. Select WebM or use WebCodecs MP4 export.'
		);
	}
	const plan = buildExportPlan(project, settings);
	const snapshot = structuredClone(project);
	const canvas = document.createElement('canvas');
	canvas.width = plan.width;
	canvas.height = plan.height;
	const context = canvas.getContext('2d');
	if (!context || !canvas.captureStream) {
		throw new ExportError('UNSUPPORTED_CODEC', 'Canvas stream capture is unavailable.');
	}
	const stream = canvas.captureStream(plan.fps);
	if (stream.getVideoTracks().length === 0) {
		stream.getTracks().forEach((track) => track.stop());
		throw new ExportError(
			'UNSUPPORTED_CODEC',
			'Canvas stream capture did not produce a video track.'
		);
	}
	const audioContext = settings.audio ? new AudioContext() : null;
	const audioDestination = audioContext?.createMediaStreamDestination() ?? null;
	const frameProvider = new CompatibilityFrameProvider(snapshot, options.getFile);
	const mimeType = chooseRecorderMimeType(settings.audio);
	const recorder = new MediaRecorder(
		audioDestination
			? new MediaStream([...stream.getVideoTracks(), ...audioDestination.stream.getAudioTracks()])
			: stream,
		{ mimeType }
	);
	const chunks: Blob[] = [];
	let startedAt = 0;
	let aborted = false;
	let stopRecorder = () => {};
	let recording: Promise<Blob> | null = null;
	try {
		if (options.signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
		if (audioContext && audioDestination) {
			await activeAudioSources(
				snapshot,
				audioContext,
				audioDestination,
				options.getFile,
				options.onWarning
			);
			await audioContext.resume();
		}
		recording = new Promise<Blob>((resolve, reject) => {
			recorder.addEventListener('dataavailable', (event) => {
				if (event.data.size > 0) chunks.push(event.data);
			});
			recorder.addEventListener('stop', () => {
				if (aborted) reject(new DOMException('Export cancelled.', 'AbortError'));
				else resolve(new Blob(chunks, { type: mimeType }));
			});
			recorder.addEventListener('error', (event) =>
				reject(new Error('The browser media recorder failed.', { cause: event }))
			);
			stopRecorder = () => {
				if (recorder.state !== 'inactive') recorder.stop();
			};
		});
		recorder.start(250);
		startedAt = performance.now();
		for (let frame = 0; frame < plan.totalFrames; frame += 1) {
			if (options.signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
			const timestamp = plan.timestamp(frame);
			const resolved = resolveFrame(snapshot, timestamp);
			await frameProvider.prepare(resolved.videoLayers, options.signal);
			renderFrame(
				context,
				{ width: plan.width, height: plan.height },
				resolved.videoLayers,
				(layer: ActiveLayer) => frameProvider.getFrame(layer)
			);
			const elapsed = performance.now() - startedAt;
			progress(
				options.onProgress,
				frame + 1,
				plan.totalFrames,
				((frame + 1) * 1000) / Math.max(1, elapsed),
				Math.max(0, (plan.totalFrames - frame - 1) * (1_000_000 / plan.fps) - elapsed)
			);
			const nextDeadline = startedAt + ((frame + 1) * 1000) / plan.fps;
			const delay = nextDeadline - performance.now();
			if (delay > 0) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
		}
		stopRecorder();
		const recordedBlob = await recording;
		progress(options.onProgress, plan.totalFrames, plan.totalFrames, plan.fps, 0);
		options.onProgress?.({
			framesDone: plan.totalFrames,
			totalFrames: plan.totalFrames,
			fps: plan.fps,
			etaMs: 0,
			phase: 'finalizing',
			percent: 99
		});
		const blob = await finalizeWebm(recordedBlob, options.signal);
		options.onProgress?.({
			framesDone: plan.totalFrames,
			totalFrames: plan.totalFrames,
			fps: plan.fps,
			etaMs: 0,
			phase: 'complete',
			percent: 100
		});
		return {
			blob,
			mimeType,
			filename: settings.filename.replace(/\.[^.]+$/, '.webm')
		};
	} catch (error) {
		aborted =
			options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
		stopRecorder();
		if (recording) await recording.catch(() => {});
		if (aborted) throw new ExportError('CANCELLED', 'Export cancelled.', { cause: error });
		throw new ExportError(
			error instanceof Error && error.name === 'FrameProviderError'
				? 'DECODE_FAILED'
				: 'ENCODE_FAILED',
			error instanceof Error ? error.message : 'Compatibility recording failed.',
			{ cause: error }
		);
	} finally {
		frameProvider.dispose();
		stream.getTracks().forEach((track) => track.stop());
		audioDestination?.stream.getTracks().forEach((track) => track.stop());
		if (audioContext && audioContext.state !== 'closed') await audioContext.close();
	}
}
