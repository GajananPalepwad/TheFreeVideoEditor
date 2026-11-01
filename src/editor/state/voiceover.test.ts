import { describe, it, expect } from 'vitest';
import { createEditorStore } from './store';
import type { TrackId } from '../core/types';

describe('voiceover state', () => {
	it('initializes with idle voiceover state', () => {
		const store = createEditorStore();
		expect(store.getState().voiceover).toEqual({
			phase: 'idle',
			countdownValue: null,
			recordingTrackId: null,
			recordingStartTime: null,
			elapsedDuration: 0
		});
	});

	it('updates voiceover state partially via setVoiceoverState', () => {
		const store = createEditorStore();
		const trackId = 'track-audio-1' as TrackId;

		store.getState().setVoiceoverState({
			phase: 'countdown',
			countdownValue: 3,
			recordingTrackId: trackId
		});

		expect(store.getState().voiceover).toEqual({
			phase: 'countdown',
			countdownValue: 3,
			recordingTrackId: trackId,
			recordingStartTime: null,
			elapsedDuration: 0
		});

		store.getState().setVoiceoverState({
			phase: 'recording',
			countdownValue: null,
			recordingStartTime: 500_000,
			elapsedDuration: 1_000_000
		});

		expect(store.getState().voiceover).toEqual({
			phase: 'recording',
			countdownValue: null,
			recordingTrackId: trackId,
			recordingStartTime: 500_000,
			elapsedDuration: 1_000_000
		});
	});

	it('resets voiceover state to idle via resetVoiceoverState', () => {
		const store = createEditorStore();
		const trackId = 'track-audio-1' as TrackId;

		store.getState().setVoiceoverState({
			phase: 'recording',
			countdownValue: null,
			recordingTrackId: trackId,
			recordingStartTime: 500_000,
			elapsedDuration: 2_000_000
		});

		store.getState().resetVoiceoverState();

		expect(store.getState().voiceover).toEqual({
			phase: 'idle',
			countdownValue: null,
			recordingTrackId: null,
			recordingStartTime: null,
			elapsedDuration: 0
		});
	});
});
