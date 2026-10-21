import { describe, expect, it } from 'vitest';
import {
	transitionWindow,
	availableHandles,
	clampTransitionDuration,
	transitionProgress,
	transitionGain,
	normalizeTransitions,
	isTransitionsEnabled
} from './transitions';
import type { AssetId, Clip, ClipId, Project, Track, TrackId } from './types';

describe('core/transitions', () => {
	it('calculates transitionWindow for center, start, end alignment', () => {
		const cut = 5_000_000;
		const dur = 1_000_000;

		const center = transitionWindow(cut, dur, 'center');
		expect(center.start).toBe(4_500_000);
		expect(center.end).toBe(5_500_000);
		expect(center.duration).toBe(dur);

		const start = transitionWindow(cut, dur, 'start');
		expect(start.start).toBe(5_000_000);
		expect(start.end).toBe(6_000_000);

		const end = transitionWindow(cut, dur, 'end');
		expect(end.start).toBe(4_000_000);
		expect(end.end).toBe(5_000_000);
	});

	it('computes transitionProgress with linear, easeIn, easeOut, easeInOut easing', () => {
		const win = transitionWindow(1_000_000, 1_000_000, 'center'); // 500_000 to 1_500_000
		expect(transitionProgress(400_000, win)).toBe(0);
		expect(transitionProgress(1_600_000, win)).toBe(1);

		// mid-point at 1_000_000
		expect(transitionProgress(1_000_000, win, 'linear')).toBe(0.5);
		expect(transitionProgress(1_000_000, win, 'easeIn')).toBe(0.25);
		expect(transitionProgress(1_000_000, win, 'easeOut')).toBe(0.75);
		expect(transitionProgress(1_000_000, win, 'easeInOut')).toBe(0.5);
	});

	it('transitionGain follows the same eased progress as the picture', () => {
		const win = transitionWindow(1_000_000, 1_000_000, 'center');
		const t = 750_000;
		const eased = transitionProgress(t, win, 'easeIn');

		const { gainA, gainB } = transitionGain(t, win, 'linear', 'easeIn');

		expect(gainB).toBeCloseTo(eased, 10);
		expect(gainA).toBeCloseTo(1 - eased, 10);
		expect(transitionGain(t, win, 'linear').gainB).toBeCloseTo(0.25, 10);
	});

	it('computes transitionGain for equalPower and linear crossfade curves', () => {
		const win = transitionWindow(1_000_000, 1_000_000, 'center');

		// At start
		const atStart = transitionGain(500_000, win, 'equalPower');
		expect(atStart.gainA).toBeCloseTo(1, 5);
		expect(atStart.gainB).toBeCloseTo(0, 5);

		// At mid
		const atMid = transitionGain(1_000_000, win, 'equalPower');
		expect(atMid.gainA).toBeCloseTo(Math.SQRT1_2, 5);
		expect(atMid.gainB).toBeCloseTo(Math.SQRT1_2, 5);
		// Equal power condition: gA^2 + gB^2 = 1
		expect(atMid.gainA ** 2 + atMid.gainB ** 2).toBeCloseTo(1, 5);

		// At end
		const atEnd = transitionGain(1_500_000, win, 'equalPower');
		expect(atEnd.gainA).toBeCloseTo(0, 5);
		expect(atEnd.gainB).toBeCloseTo(1, 5);

		// Linear: gA + gB = 1
		const linearMid = transitionGain(1_000_000, win, 'linear');
		expect(linearMid.gainA).toBe(0.5);
		expect(linearMid.gainB).toBe(0.5);
		expect(linearMid.gainA + linearMid.gainB).toBe(1);
	});

	it('calculates available handles correctly', () => {
		const clipA: Clip = {
			id: 'c1' as ClipId,
			assetId: 'a1' as AssetId,
			start: 0,
			duration: 2_000_000,
			sourceIn: 1_000_000,
			sourceOut: 3_000_000,
			speed: 1,
			volume: 1
		};
		const clipB: Clip = {
			id: 'c2' as ClipId,
			assetId: 'a2' as AssetId,
			start: 2_000_000,
			duration: 2_000_000,
			sourceIn: 1_000_000,
			sourceOut: 3_000_000,
			speed: 1,
			volume: 1
		};
		const assetA = {
			id: 'a1' as AssetId,
			duration: 5_000_000, // 2s extra handle at tail
			kind: 'video' as const,
			name: 'A',
			mimeType: 'video/mp4',
			size: 100,
			hasAudio: false,
			opfsPath: ''
		};
		const assetB = {
			id: 'a2' as AssetId,
			duration: 5_000_000, // 1s extra handle at head (sourceIn = 1s)
			kind: 'video' as const,
			name: 'B',
			mimeType: 'video/mp4',
			size: 100,
			hasAudio: false,
			opfsPath: ''
		};
		const project = {
			settings: { fps: 30 }
		} as unknown as Project;

		const handles = availableHandles(clipA, clipB, assetA, assetB, project);
		expect(handles.handleA).toBe(2_000_000);
		expect(handles.handleB).toBe(1_000_000);

		// test clampTransitionDuration
		// clipA.duration = 2s, clipB.duration = 2s, center alignment max is 2 * min(2s, 2s) = 4s
		const clamped = clampTransitionDuration(5_000_000, clipA, clipB, 'center', 30);
		expect(clamped).toBe(4_000_000);
	});

	it('normalizes track transitions: drops orphaned or non-adjacent cuts', () => {
		const track: Track = {
			id: 't1' as TrackId,
			kind: 'video',
			name: 'V1',
			muted: false,
			locked: false,
			hidden: false,
			clips: [
				{
					id: 'c1' as ClipId,
					start: 0,
					duration: 2_000_000,
					sourceIn: 0,
					sourceOut: 2_000_000,
					speed: 1,
					volume: 1
				},
				{
					id: 'c2' as ClipId,
					start: 2_000_000,
					duration: 2_000_000,
					sourceIn: 0,
					sourceOut: 2_000_000,
					speed: 1,
					volume: 1
				},
				{
					id: 'c3' as ClipId,
					start: 5_000_000, // gap between c2 and c3
					duration: 2_000_000,
					sourceIn: 0,
					sourceOut: 2_000_000,
					speed: 1,
					volume: 1
				}
			],
			transitions: [
				// Valid cut between c1 and c2
				{
					id: 'tr1',
					type: 'crossDissolve',
					duration: 1_000_000,
					alignment: 'center',
					edge: { kind: 'cut', fromClipId: 'c1' as ClipId, toClipId: 'c2' as ClipId },
					params: {}
				},
				// Invalid cut between c2 and c3 (gap!)
				{
					id: 'tr2',
					type: 'crossDissolve',
					duration: 1_000_000,
					alignment: 'center',
					edge: { kind: 'cut', fromClipId: 'c2' as ClipId, toClipId: 'c3' as ClipId },
					params: {}
				},
				// Invalid orphaned clip
				{
					id: 'tr3',
					type: 'dipToBlack',
					duration: 1_000_000,
					alignment: 'center',
					edge: { kind: 'cut', fromClipId: 'c2' as ClipId, toClipId: 'nonexistent' as ClipId },
					params: {}
				}
			]
		};

		const norm = normalizeTransitions(track, 30);
		expect(norm.transitions).toHaveLength(1);
		expect(norm.transitions![0].id).toBe('tr1');
	});

	it('enables transitions by default and allows disabling via labs flag', () => {
		expect(isTransitionsEnabled()).toBe(true);
		expect(isTransitionsEnabled('')).toBe(true);
		expect(isTransitionsEnabled('?labs=no-transitions')).toBe(false);
		expect(isTransitionsEnabled('?labs=-transitions')).toBe(false);
		expect(isTransitionsEnabled('?labs=transitions')).toBe(true);
	});
});
