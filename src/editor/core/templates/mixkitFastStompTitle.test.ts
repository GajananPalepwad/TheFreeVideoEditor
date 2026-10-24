import { describe, expect, it } from 'vitest';
import { getBuiltinMotionTemplate } from './builtinTemplates';
import { createEmptyProject } from '../factory';
import { instantiateTemplateIntoProject } from './templateService';
import { resolveFrame } from '../playback';
import type { SequenceId } from '../types';

describe('mixkit-fast-stomp-title motion graphic template', () => {
	const template = getBuiltinMotionTemplate('mixkit-fast-stomp-title');

	it('loads cleanly from public/templates/', () => {
		expect(template).toBeDefined();
		expect(template?.id).toBe('mixkit-fast-stomp-title');
		expect(template?.name).toBe('Fast Stomp Kinetic Title');
		expect(template?.category).toBe('Kinetic');
		expect(template?.duration).toBe(5_000_000);
		expect(template?.responsiveTiming?.introDuration).toBe(1_400_000);
		expect(template?.responsiveTiming?.outroDuration).toBe(1_000_000);
	});

	it('has video tracks with non-overlapping clips', () => {
		expect(template?.tracks.length).toBeGreaterThanOrEqual(5);

		for (const track of template!.tracks) {
			const clips = [...track.clips].sort((a, b) => a.start - b.start);
			for (let i = 1; i < clips.length; i += 1) {
				const prev = clips[i - 1]!;
				expect(clips[i]!.start, `${track.name}`).toBeGreaterThanOrEqual(prev.start + prev.duration);
			}
		}
	});

	it('publishes editable text, font size sliders and colors', () => {
		const params = template!.publishedParams;
		const paramProps = params.map((p) => p.targetProperty);

		expect(paramProps.filter((p) => p === 'text.content').length).toBeGreaterThanOrEqual(4);
		expect(paramProps.filter((p) => p === 'text.fontSize').length).toBeGreaterThanOrEqual(1);
		expect(paramProps.filter((p) => p === 'shape.fill').length).toBeGreaterThanOrEqual(3);

		for (const p of params.filter((p) => p.targetProperty === 'text.fontSize')) {
			expect(p.type).toBe('number');
			const val = Number(p.defaultValue);
			expect(p.min!).toBeLessThan(val);
			expect(p.max!).toBeGreaterThan(val);
			expect(p.step!).toBeGreaterThan(0);
		}
	});

	it('instantiates into a project and resolves frame layers across playback', () => {
		const empty = createEmptyProject({ name: 'Fast Stomp Test' });
		const { project } = instantiateTemplateIntoProject(empty, 'root' as SequenceId, template!, 0);

		// Intro beat 1 (0.05s = 50,000 µs): "NEW" text and gold background
		const frameIntro1 = resolveFrame(project, 50_000);
		const layersIntro1 = frameIntro1.videoLayers[0]?.nested?.layers ?? [];
		expect(layersIntro1.length).toBe(2);
		expect(layersIntro1.some((l) => l.kind === 'text' && l.textData?.text === 'NEW')).toBe(true);

		// Intro beat 3 (0.4s = 400,000 µs): "WAY" text and red background
		const frameIntro3 = resolveFrame(project, 400_000);
		const layersIntro3 = frameIntro3.videoLayers[0]?.nested?.layers ?? [];
		expect(layersIntro3.length).toBe(2);
		expect(layersIntro3.some((l) => l.kind === 'text' && l.textData?.text === 'WAY')).toBe(true);

		// Main scene (2.0s = 2,000,000 µs): "Y", "O", "U" letters and "MIXKIT" subtitle
		const frameMain = resolveFrame(project, 2_000_000);
		const layersMain = frameMain.videoLayers[0]?.nested?.layers ?? [];
		expect(layersMain.length).toBe(4);
		const texts = layersMain.map((l) => l.textData?.text).filter(Boolean);
		expect(texts).toContain('Y');
		expect(texts).toContain('O');
		expect(texts).toContain('U');
		expect(texts).toContain('MIXKIT');

		// Outro phase (4.8s = 4,800,000 µs): All text has slid off-screen to the left
		const frameOutro = resolveFrame(project, 4_800_000);
		const layersOutro = frameOutro.videoLayers[0]?.nested?.layers ?? [];
		for (const layer of layersOutro) {
			if (layer.transform?.x !== undefined) {
				expect(layer.transform.x).toBeLessThanOrEqual(-800);
			}
		}

		// Past template duration (5.0s = 5,000,000 µs): Entire template clip has ended
		const framePast = resolveFrame(project, 5_000_000);
		expect(framePast.videoLayers.length).toBe(0);
	});
});
