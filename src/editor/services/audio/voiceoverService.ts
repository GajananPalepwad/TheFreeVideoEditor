import type { Time, TrackId } from '../../core/types';
import type { EditorStore } from '../../state/store';
import { encodeWavBlob } from './wavEncoder';

export interface ConvertAudioOptions {
	createAudioContext?: () => Pick<AudioContext, 'decodeAudioData' | 'close'>;
}

/**
 * Converts any audio Blob (e.g. MediaRecorder WebM/OGG) into a PCM 16-bit WAV Blob using Web Audio API.
 */
export async function convertAudioBlobToWav(
	blob: Blob,
	options: ConvertAudioOptions = {}
): Promise<Blob> {
	const arrayBuffer = await blob.arrayBuffer();
	const createCtx =
		options.createAudioContext ??
		(() => {
			const AudioContextConstructor =
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			return new AudioContextConstructor();
		});

	const ctx = createCtx();
	try {
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
		const channels: Float32Array[] = [];
		for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
			channels.push(audioBuffer.getChannelData(i));
		}
		return encodeWavBlob(channels, audioBuffer.sampleRate);
	} finally {
		if ('close' in ctx && typeof ctx.close === 'function') {
			await ctx.close();
		}
	}
}

export interface SaveAndInsertVoiceoverOptions {
	wavBlob: Blob;
	trackId: TrackId;
	startTime: Time;
	store: EditorStore;
}

/**
 * Saves the WAV blob to OPFS as an asset and inserts it as a clip on the specified audio track.
 */
export async function saveAndInsertVoiceover(
	options: SaveAndInsertVoiceoverOptions
): Promise<boolean> {
	const { wavBlob, trackId, startTime, store } = options;
	const project = store.getState().project;
	if (!project) return false;

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const filename = `voiceover-${timestamp}.wav`;
	const file = new File([wavBlob], filename, {
		type: 'audio/wav',
		lastModified: Date.now()
	});

	const importResult = await store.getState().importMedia([file]);
	if (!importResult || importResult.imported.length === 0) {
		return false;
	}

	const asset = importResult.imported[0];
	if (!asset) return false;

	return store.getState().addAssetToTimeline(asset.id, trackId, startTime);
}
