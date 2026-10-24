import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../factory';
import type { Clip, ClipId, Project } from '../types';
import {
	applyClipAttributes,
	extractClipAttributes,
	pasteAttributesToClips
} from './clipAttributes';

function makeBaseClip(id: string, start = 0): Clip {
	return {
		id: id as ClipId,
		start,
		duration: 1_000_000,
		sourceIn: 0,
		sourceOut: 1_000_000,
		speed: 1,
		volume: 1
	};
}

describe('clipAttributes', () => {
	it('extracts and applies transform attributes', () => {
		const source: Clip = {
			...makeBaseClip('c1'),
			transform: {
				x: 50,
				y: -20,
				scaleX: 1.5,
				scaleY: 1.5,
				rotation: 45,
				opacity: 0.8
			},
			properties: {
				position: { value: [50, -20] },
				rotation: { value: 45 }
			}
		};

		const payload = extractClipAttributes(source);
		expect(payload.transform?.transform).toEqual(source.transform);
		expect(payload.transform?.properties?.position).toEqual({ value: [50, -20] });

		const target = makeBaseClip('target');
		const result = applyClipAttributes(target, payload, { transform: true });

		expect(result.transform).toEqual(source.transform);
		expect(result.properties?.position).toEqual({ value: [50, -20] });
		expect(result.properties?.rotation).toEqual({ value: 45 });
	});

	it('extracts and applies crop insets', () => {
		const source: Clip = {
			...makeBaseClip('c1'),
			properties: {
				crop: { value: [0.1, 0.05, 0.1, 0.05] }
			}
		};

		const payload = extractClipAttributes(source);
		expect(payload.crop).toEqual({ value: [0.1, 0.05, 0.1, 0.05] });

		const target = makeBaseClip('target');
		const result = applyClipAttributes(target, payload, { crop: true });

		expect(result.properties?.crop).toEqual({ value: [0.1, 0.05, 0.1, 0.05] });
	});

	it('extracts and applies color grading (replaces color effects, keeps video effects)', () => {
		const source: Clip = {
			...makeBaseClip('c1'),
			effects: [
				{
					id: 'eff1',
					type: 'colorCorrection',
					params: { exposure: 0.5, contrast: 1.2 }
				},
				{
					id: 'eff2',
					type: 'curves',
					params: {
						rgb: [
							{ x: 0, y: 0 },
							{ x: 1, y: 1 }
						]
					}
				},
				{
					id: 'eff3',
					type: 'gaussianBlur',
					params: { radius: 10 }
				}
			]
		};

		const payload = extractClipAttributes(source);
		expect(payload.colorGrading?.effects).toHaveLength(2);
		expect(payload.videoEffects?.effects).toHaveLength(1);

		const target: Clip = {
			...makeBaseClip('target'),
			effects: [
				{
					id: 'old-cc',
					type: 'colorCorrection',
					params: { exposure: -1 }
				},
				{
					id: 'existing-glow',
					type: 'glow',
					params: { intensity: 2 }
				}
			]
		};

		const result = applyClipAttributes(target, payload, { colorGrading: true });
		expect(result.effects).toHaveLength(3);
		// Glow preserved
		expect(result.effects?.some((e) => e.type === 'glow')).toBe(true);
		// Old color correction replaced by new one
		expect(result.effects?.find((e) => e.type === 'colorCorrection')?.params.exposure).toBe(0.5);
		// New curves added
		expect(result.effects?.some((e) => e.type === 'curves')).toBe(true);
		// Generated new effect IDs
		expect(result.effects?.find((e) => e.type === 'colorCorrection')?.id).not.toBe('eff1');
	});

	it('extracts and applies video effects', () => {
		const source: Clip = {
			...makeBaseClip('c1'),
			effects: [
				{
					id: 'eff1',
					type: 'chromaKey',
					params: { keyColor: '#00ff00', tolerance: 0.2 }
				}
			]
		};

		const payload = extractClipAttributes(source);
		const target: Clip = {
			...makeBaseClip('target'),
			effects: [
				{
					id: 'existing',
					type: 'vignette',
					params: { amount: 0.5 }
				}
			]
		};

		const result = applyClipAttributes(target, payload, { videoEffects: true });
		expect(result.effects).toHaveLength(2);
		expect(result.effects?.some((e) => e.type === 'vignette')).toBe(true);
		expect(result.effects?.some((e) => e.type === 'chromaKey')).toBe(true);
	});

	it('extracts and applies audio volume, pan, and audio effects', () => {
		const source: Clip = {
			...makeBaseClip('c1'),
			volume: 0.65,
			properties: {
				'audio.volume': { value: -3.5 },
				'audio.pan': { value: 0.2 }
			},
			audioEffects: [
				{
					id: 'ae1',
					type: 'compressor',
					params: { threshold: -12, ratio: 4 }
				}
			],
			audioTag: 'dialogue',
			channelRouting: 'stereo'
		};

		const payload = extractClipAttributes(source);
		expect(payload.audio?.volume).toBe(0.65);
		expect(payload.audio?.properties?.['audio.pan']).toEqual({ value: 0.2 });
		expect(payload.audio?.audioEffects).toHaveLength(1);

		const target = makeBaseClip('target');
		const result = applyClipAttributes(target, payload, { audio: true });

		expect(result.volume).toBe(0.65);
		expect(result.properties?.['audio.volume']).toEqual({ value: -3.5 });
		expect(result.properties?.['audio.pan']).toEqual({ value: 0.2 });
		expect(result.audioEffects).toHaveLength(1);
		expect(result.audioEffects?.[0]?.type).toBe('compressor');
		expect(result.audioEffects?.[0]?.id).not.toBe('ae1');
		expect(result.audioTag).toBe('dialogue');
		expect(result.channelRouting).toBe('stereo');
	});

	it('pasteAttributesToClips applies selected attributes to all specified target clips in a project', () => {
		const source: Clip = {
			...makeBaseClip('c1', 0),
			transform: { x: 100, y: 50, scaleX: 2, scaleY: 2, rotation: 0, opacity: 1 },
			properties: { crop: { value: [0.2, 0.2, 0.2, 0.2] } }
		};

		const target1 = makeBaseClip('t1', 1_000_000);
		const target2 = makeBaseClip('t2', 2_000_000);
		const other = makeBaseClip('other', 3_000_000);

		const base = createEmptyProject({ name: 'Test Project' });
		const vTrack = base.tracks.find((t) => t.kind === 'video')!;
		const project: Project = {
			...base,
			tracks: base.tracks.map((t) =>
				t.id === vTrack.id ? { ...t, clips: [source, target1, target2, other] } : t
			)
		};

		const payload = extractClipAttributes(source);
		const updated = pasteAttributesToClips(project, ['t1' as ClipId, 't2' as ClipId], payload, {
			transform: true,
			crop: true
		});

		const t1After = updated.tracks[0]!.clips.find((c) => c.id === 't1')!;
		const t2After = updated.tracks[0]!.clips.find((c) => c.id === 't2')!;
		const otherAfter = updated.tracks[0]!.clips.find((c) => c.id === 'other')!;

		expect(t1After.transform).toEqual(source.transform);
		expect(t1After.properties?.crop).toEqual({ value: [0.2, 0.2, 0.2, 0.2] });

		expect(t2After.transform).toEqual(source.transform);
		expect(t2After.properties?.crop).toEqual({ value: [0.2, 0.2, 0.2, 0.2] });

		// Clip 'other' was not targeted, so should remain untouched
		expect(otherAfter.transform).toBeUndefined();
		expect(otherAfter.properties?.crop).toBeUndefined();
	});
});
