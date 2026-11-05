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
});
