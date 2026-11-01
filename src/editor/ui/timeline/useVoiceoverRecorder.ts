import { useCallback, useEffect, useRef } from 'react';
import type { TrackId } from '../../core/types';
import type { EditorStore } from '../../state/store';
import {
	convertAudioBlobToWav,
	saveAndInsertVoiceover
} from '../../services/audio/voiceoverService';

export function useVoiceoverRecorder(store: EditorStore) {
	const streamRef = useRef<MediaStream | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const animFrameRef = useRef<number | null>(null);
	const recordingTrackIdRef = useRef<TrackId | null>(null);
	const recordingStartTimeRef = useRef<number | null>(null);
	const recordStartPerfTimeRef = useRef<number>(0);

	const cleanup = useCallback(() => {
		if (countdownTimerRef.current !== null) {
			clearTimeout(countdownTimerRef.current);
			countdownTimerRef.current = null;
		}
		if (animFrameRef.current !== null) {
			cancelAnimationFrame(animFrameRef.current);
			animFrameRef.current = null;
		}
		if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
			try {
				mediaRecorderRef.current.stop();
			} catch {
				// Ignore if already stopping
			}
			mediaRecorderRef.current = null;
		}
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}
		chunksRef.current = [];
		recordingTrackIdRef.current = null;
		recordingStartTimeRef.current = null;
	}, []);

	const stopRecording = useCallback(async () => {
		if (animFrameRef.current !== null) {
			cancelAnimationFrame(animFrameRef.current);
			animFrameRef.current = null;
		}

		const recorder = mediaRecorderRef.current;
		if (recorder && recorder.state === 'recording') {
			store.getState().setVoiceoverState({ phase: 'saving' });
			recorder.stop();
		} else {
			cleanup();
			store.getState().resetVoiceoverState();
		}
	}, [cleanup, store]);

	const startRecording = useCallback(
		async (trackId: TrackId) => {
			const project = store.getState().project;
			if (!project) return;

			const targetTrack = project.tracks.find((t) => t.id === trackId);
			if (!targetTrack || targetTrack.kind !== 'audio' || targetTrack.locked) {
				return;
			}

			// Clean up any stale recording session
			cleanup();

			store.getState().setVoiceoverState({
				phase: 'requesting',
				recordingTrackId: trackId
			});

			let stream: MediaStream;
			try {
				if (!navigator.mediaDevices?.getUserMedia) {
					throw new Error('Microphone recording is not supported in this browser.');
				}
				stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			} catch (err) {
				const message =
					err instanceof DOMException && err.name === 'NotAllowedError'
						? 'Microphone permission was denied. Please allow microphone access in browser settings.'
						: 'Could not access microphone: ' + (err instanceof Error ? err.message : String(err));
				store.getState().setTimelineMessage(message);
				store.getState().resetVoiceoverState();
				return;
			}

			streamRef.current = stream;
			recordingTrackIdRef.current = trackId;

			// Countdown 3 -> 2 -> 1
			let currentCount = 3;
			store.getState().setVoiceoverState({
				phase: 'countdown',
				countdownValue: currentCount,
				recordingTrackId: trackId
			});

			const tickCountdown = () => {
				currentCount -= 1;
				if (currentCount > 0) {
					store.getState().setVoiceoverState({ countdownValue: currentCount });
					countdownTimerRef.current = setTimeout(tickCountdown, 1000);
				} else {
					// Countdown finished, begin recording!
					const startTime = store.getState().timeline.playhead;
					recordingStartTimeRef.current = startTime;
					recordStartPerfTimeRef.current = performance.now();
					chunksRef.current = [];

					let mimeType: string | undefined;
					if (typeof MediaRecorder !== 'undefined') {
						if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
							mimeType = 'audio/webm;codecs=opus';
						} else if (MediaRecorder.isTypeSupported('audio/webm')) {
							mimeType = 'audio/webm';
						} else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
							mimeType = 'audio/ogg;codecs=opus';
						}
					}

					const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
					mediaRecorderRef.current = recorder;

					recorder.ondataavailable = (event: BlobEvent) => {
						if (event.data && event.data.size > 0) {
							chunksRef.current.push(event.data);
						}
					};

					recorder.onstop = async () => {
						const finalChunks = [...chunksRef.current];
						const recordedStartTime = recordingStartTimeRef.current ?? startTime;
						const targetTrackId = recordingTrackIdRef.current ?? trackId;

						// Release microphone stream immediately
						if (streamRef.current) {
							for (const track of streamRef.current.getTracks()) {
								track.stop();
							}
							streamRef.current = null;
						}

						try {
							if (finalChunks.length > 0) {
								const rawBlob = new Blob(finalChunks, {
									type: recorder.mimeType || 'audio/webm'
								});
								const wavBlob = await convertAudioBlobToWav(rawBlob);
								await saveAndInsertVoiceover({
									wavBlob,
									trackId: targetTrackId,
									startTime: recordedStartTime,
									store
								});
							}
						} catch (error) {
							store
								.getState()
								.setTimelineMessage(
									'Failed to save voiceover: ' +
										(error instanceof Error ? error.message : String(error))
								);
						} finally {
							cleanup();
							store.getState().resetVoiceoverState();
						}
					};

					store.getState().setVoiceoverState({
						phase: 'recording',
						countdownValue: null,
						recordingStartTime: startTime,
						elapsedDuration: 0
					});

					recorder.start(100);

					const onFrame = () => {
						const elapsedMs = performance.now() - recordStartPerfTimeRef.current;
						const elapsedUs = Math.round(elapsedMs * 1000);
						store.getState().setVoiceoverState({ elapsedDuration: elapsedUs });
						store.getState().setPlayhead(startTime + elapsedUs);
						animFrameRef.current = requestAnimationFrame(onFrame);
					};
					animFrameRef.current = requestAnimationFrame(onFrame);
				}
			};

			countdownTimerRef.current = setTimeout(tickCountdown, 1000);
		},
		[cleanup, store]
	);

	useEffect(() => {
		return () => {
			cleanup();
		};
	}, [cleanup]);

	return {
		startRecording,
		stopRecording
	};
}
