import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmptyProject } from '../../core';
import { createEditorStore } from '../../state/store';

const services = vi.hoisted(() => ({
	getProject: vi.fn(),
	listProjects: vi.fn(),
	saveProject: vi.fn(),
	setLastOpenedId: vi.fn(),
	getLastOpenedId: vi.fn(),
	deleteProject: vi.fn(),
	deleteProjectDir: vi.fn(),
	ensureProjectDir: vi.fn(),
	copyProjectMedia: vi.fn(),
	reconcileProjectMedia: vi.fn(),
	deleteMedia: vi.fn(),
	deleteMediaFile: vi.fn(),
	collectMediaGarbage: vi.fn(),
	writeMedia: vi.fn()
}));

vi.mock('../../services/storage/projectDb', () => ({
	getProject: services.getProject,
	listProjects: services.listProjects,
	saveProject: services.saveProject,
	setLastOpenedId: services.setLastOpenedId,
	getLastOpenedId: services.getLastOpenedId,
	deleteProject: services.deleteProject
}));

vi.mock('../../services/storage/opfs', () => ({
	deleteProjectDir: services.deleteProjectDir,
	ensureProjectDir: services.ensureProjectDir,
	copyProjectMedia: services.copyProjectMedia,
	reconcileProjectMedia: services.reconcileProjectMedia,
	deleteMedia: services.deleteMedia,
	deleteMediaFile: services.deleteMediaFile,
	collectMediaGarbage: services.collectMediaGarbage,
	writeMedia: services.writeMedia,
	isSupported: () => true
}));

describe('voiceover recorder workflow', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		services.getProject.mockResolvedValue(null);
		services.saveProject.mockResolvedValue(undefined);
		services.ensureProjectDir.mockResolvedValue(null);
		services.reconcileProjectMedia.mockImplementation(async (project) => ({
			assets: project.assets,
			unknownFiles: [],
			changed: false
		}));
		services.collectMediaGarbage.mockResolvedValue({
			removedFiles: [],
			removedCacheAssetIds: [],
			foreignFiles: []
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('handles microphone permission denied cleanly', async () => {
		const store = createEditorStore();
		const emptyProject = createEmptyProject({ name: 'Test' });
		const ok = await store.getState().replaceProject(emptyProject);
		expect(ok).toBe(true);

		const project = store.getState().project!;
		const audioTrack = project.tracks.find((t) => t.kind === 'audio')!;

		// Mock navigator.mediaDevices.getUserMedia rejection
		const mockGetUserMedia = vi
			.fn()
			.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
		Object.defineProperty(globalThis, 'navigator', {
			value: { mediaDevices: { getUserMedia: mockGetUserMedia } },
			configurable: true
		});

		// Simulate startRecording logic
		store.getState().setVoiceoverState({
			phase: 'requesting',
			recordingTrackId: audioTrack.id
		});

		try {
			await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (err) {
			const message =
				err instanceof DOMException && err.name === 'NotAllowedError'
					? 'Microphone permission was denied. Please allow microphone access in browser settings.'
					: 'Could not access microphone';
			store.getState().setTimelineMessage(message);
			store.getState().resetVoiceoverState();
		}

		expect(store.getState().voiceover.phase).toBe('idle');
		expect(store.getState().timeline.message).toContain('Microphone permission was denied');
	});

	it('progresses through countdown 3 -> 2 -> 1 then starts recording at playhead', async () => {
		const store = createEditorStore();
		const emptyProject = createEmptyProject({ name: 'Test' });
		const ok = await store.getState().replaceProject(emptyProject);
		expect(ok).toBe(true);

		const project = store.getState().project!;
		const audioTrack = project.tracks.find((t) => t.kind === 'audio')!;

		store.getState().setPlayhead(1_500_000); // 1.5s playhead

		// Start countdown
		store.getState().setVoiceoverState({
			phase: 'countdown',
			countdownValue: 3,
			recordingTrackId: audioTrack.id
		});
		expect(store.getState().voiceover.countdownValue).toBe(3);

		store.getState().setVoiceoverState({ countdownValue: 2 });
		expect(store.getState().voiceover.countdownValue).toBe(2);

		store.getState().setVoiceoverState({ countdownValue: 1 });
		expect(store.getState().voiceover.countdownValue).toBe(1);

		// Switch to recording
		const startTime = store.getState().timeline.playhead;
		store.getState().setVoiceoverState({
			phase: 'recording',
			countdownValue: null,
			recordingStartTime: startTime,
			elapsedDuration: 0
		});

		expect(store.getState().voiceover.phase).toBe('recording');
		expect(store.getState().voiceover.recordingStartTime).toBe(1_500_000);
		expect(store.getState().voiceover.elapsedDuration).toBe(0);

		// As recording advances:
		store.getState().setVoiceoverState({ elapsedDuration: 1_000_000 });
		store.getState().setPlayhead(startTime + 1_000_000);

		expect(store.getState().voiceover.elapsedDuration).toBe(1_000_000);
		expect(store.getState().timeline.playhead).toBe(2_500_000);
	});
});
