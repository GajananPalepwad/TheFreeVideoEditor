import { describe, it, expect, vi } from 'vitest';
import { convertAudioBlobToWav, saveAndInsertVoiceover } from './voiceoverService';
import type { TrackId, Time, AssetId } from '../../core/types';
import type { EditorStore } from '../../state/store';

describe('voiceoverService', () => {
	it('converts an audio Blob into WAV using an audio context', async () => {
		const mockAudioBuffer = {
			numberOfChannels: 1,
			sampleRate: 44100,
			length: 2,
			getChannelData: () => new Float32Array([0.1, -0.1])
		} as unknown as AudioBuffer;

		const mockCtx = {
			decodeAudioData: vi.fn().mockResolvedValue(mockAudioBuffer),
			close: vi.fn().mockResolvedValue(undefined)
		};

		const blob = new Blob(['mock data'], { type: 'audio/webm' });
		const wavBlob = await convertAudioBlobToWav(blob, {
			createAudioContext: () => mockCtx as unknown as AudioContext
		});

		expect(wavBlob.type).toBe('audio/wav');
		expect(wavBlob.size).toBe(44 + 4); // 44 byte header + 2 samples * 2 bytes
		expect(mockCtx.decodeAudioData).toHaveBeenCalled();
		expect(mockCtx.close).toHaveBeenCalled();
	});

	it('saves the WAV file and inserts it on the timeline', async () => {
		const mockTrackId = 'track-1' as TrackId;
		const mockStartTime = 1_000_000 as Time;
		const mockAssetId = 'asset-1' as AssetId;

		const mockStore = {
			getState: vi.fn().mockReturnValue({
				project: { id: 'project-1' },
				importMedia: vi.fn().mockResolvedValue({
					imported: [{ id: mockAssetId, name: 'voiceover.wav' }],
					failed: []
				}),
				addAssetToTimeline: vi.fn().mockReturnValue(true)
			})
		};

		const wavBlob = new Blob(['test'], { type: 'audio/wav' });
		const result = await saveAndInsertVoiceover({
			wavBlob,
			trackId: mockTrackId,
			startTime: mockStartTime,
			store: mockStore as unknown as EditorStore
		});

		expect(result).toBe(true);
		expect(mockStore.getState().importMedia).toHaveBeenCalled();
		expect(mockStore.getState().addAssetToTimeline).toHaveBeenCalledWith(
			mockAssetId,
			mockTrackId,
			mockStartTime
		);
	});
});
