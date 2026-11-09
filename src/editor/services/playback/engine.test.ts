import { describe, expect, it } from 'vitest';
import { createPlaybackEngine } from './engine';
import { createEmptyProject } from '../../core/factory';
import type { EditorStore } from '../../state/store';
import type { ClipId } from '../../core/types';

if (typeof globalThis.requestAnimationFrame === 'undefined') {
	globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
		setTimeout(() => cb(performance.now()), 16) as unknown as number;
	globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

describe('PlaybackEngine', () => {
	it('does not pause clock or oscillate when onMediaStall is triggered during playback', async () => {
		const project = createEmptyProject({ name: 'Engine Test' });
		const track = project.tracks.find((t) => t.kind === 'video')!;
		track.clips.push({
			id: 'clip-1' as ClipId,
			start: 0,
			duration: 2_000_000,
			sourceIn: 0,
			sourceOut: 2_000_000,
			speed: 1,
			volume: 1
		});
		const store = {
			getState: () => ({
				project,
				activeSequenceId: null,
				timeline: { playhead: 0 },
				isExporting: false,
				scopes: { open: false },
				setPlayhead: () => {},
				setTimelineFollowing: () => {}
			}),
			subscribe: () => () => {}
		} as unknown as EditorStore;

		const engine = createPlaybackEngine(store, project);
		engine.play();
		expect(engine.snapshot.playing).toBe(true);

		// Trigger media stall
		(engine as unknown as { onMediaStall: (id: ClipId) => void }).onMediaStall('clip-1' as ClipId);

		// Clock must remain playing and not pause
		expect(engine.snapshot.playing).toBe(true);

		// Wait 250ms to verify debounce timers don't fire and pause the player
		await new Promise((r) => setTimeout(r, 250));
		expect(engine.snapshot.playing).toBe(true);

		engine.dispose();
	});

	it('immediately starts playback on play() without stall blocking', () => {
		const project = createEmptyProject({ name: 'Engine Test 2' });
		const track = project.tracks.find((t) => t.kind === 'video')!;
		track.clips.push({
			id: 'clip-1' as ClipId,
			start: 0,
			duration: 2_000_000,
			sourceIn: 0,
			sourceOut: 2_000_000,
			speed: 1,
			volume: 1
		});
		const store = {
			getState: () => ({
				project,
				activeSequenceId: null,
				timeline: { playhead: 0 },
				isExporting: false,
				scopes: { open: false },
				setPlayhead: () => {},
				setTimelineFollowing: () => {}
			}),
			subscribe: () => () => {}
		} as unknown as EditorStore;

		const engine = createPlaybackEngine(store, project);
		(engine as unknown as { onMediaStall: (id: ClipId) => void }).onMediaStall('clip-1' as ClipId);
		engine.play();
		expect(engine.snapshot.playing).toBe(true);
		engine.dispose();
	});

	it('safely ignores attach() calls when disposed without throwing', () => {
		const project = createEmptyProject({ name: 'Disposed Engine Test' });
		const store = {
			getState: () => ({
				project,
				activeSequenceId: null,
				timeline: { playhead: 0 },
				isExporting: false,
				scopes: { open: false },
				setPlayhead: () => {},
				setTimelineFollowing: () => {}
			}),
			subscribe: () => () => {}
		} as unknown as EditorStore;

		const engine = createPlaybackEngine(store, project);
		engine.dispose();
		expect(engine.disposed).toBe(true);

		const fakeCanvas = {} as HTMLCanvasElement;
		expect(() => engine.attach(fakeCanvas)).not.toThrow();
	});

	it('supports downscaled resolution immediately and during playback', () => {
		const project = createEmptyProject({
			name: 'Resolution Test',
			settings: { width: 1920, height: 1080 }
		});
		const track = project.tracks.find((t) => t.kind === 'video')!;
		track.clips.push({
			id: 'clip-1' as ClipId,
			start: 0,
			duration: 2_000_000,
			sourceIn: 0,
			sourceOut: 2_000_000,
			speed: 1,
			volume: 1
		});
		const store = {
			getState: () => ({
				project,
				activeSequenceId: null,
				timeline: { playhead: 0 },
				isExporting: false,
				scopes: { open: false },
				playbackResolution: 'full',
				setPlayhead: () => {},
				setTimelineFollowing: () => {}
			}),
			subscribe: () => () => {}
		} as unknown as EditorStore;

		const engine = createPlaybackEngine(store, project);
		const fakeContext = {
			canvas: null as unknown,
			clearRect: () => {},
			fillRect: () => {},
			drawImage: () => {},
			save: () => {},
			restore: () => {},
			scale: () => {}
		};
		const fakeCanvas = {
			width: 1920,
			height: 1080,
			getContext: () => fakeContext,
			setAttribute: () => {}
		} as unknown as HTMLCanvasElement;
		fakeContext.canvas = fakeCanvas;

		engine.attach(fakeCanvas, 'canvas2d');
		expect(fakeCanvas.width).toBe(1920);
		expect(fakeCanvas.height).toBe(1080);
		expect(engine.snapshot.playbackResolution).toBe('full');

		// Set playback resolution to half
		engine.setPlaybackResolution('half');
		expect(engine.snapshot.playbackResolution).toBe('half');
		expect(engine.currentRenderScale).toBe(0.5);
		expect(fakeCanvas.width).toBe(960);
		expect(fakeCanvas.height).toBe(540);

		// During playback, half resolution remains active
		engine.play();
		expect(engine.snapshot.playing).toBe(true);
		expect(engine.currentRenderScale).toBe(0.5);
		expect(fakeCanvas.width).toBe(960);
		expect(fakeCanvas.height).toBe(540);

		// Set quarter resolution
		engine.setPlaybackResolution('quarter');
		expect(engine.currentRenderScale).toBe(0.25);
		expect(fakeCanvas.width).toBe(480);
		expect(fakeCanvas.height).toBe(270);

		// When paused, quarter resolution remains active
		engine.pause();
		expect(engine.snapshot.playing).toBe(false);
		expect(engine.currentRenderScale).toBe(0.25);
		expect(fakeCanvas.width).toBe(480);
		expect(fakeCanvas.height).toBe(270);

		// Restore to full resolution
		engine.setPlaybackResolution('full');
		expect(engine.currentRenderScale).toBe(1);
		expect(fakeCanvas.width).toBe(1920);
		expect(fakeCanvas.height).toBe(1080);

		engine.dispose();
	});
});
