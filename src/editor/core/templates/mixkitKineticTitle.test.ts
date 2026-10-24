import { describe, expect, it } from 'vitest';
import { getBuiltinMotionTemplate } from './builtinTemplates';
import { createEmptyProject } from '../factory';
import { instantiateTemplateIntoProject } from './templateService';
import { resolveFrame } from '../playback';
import type { SequenceId } from '../types';

describe('mixkit-kinetic-title motion graphic template', () => {
	const template = getBuiltinMotionTemplate('mixkit-kinetic-title');

	it('loads cleanly from public/templates/', () => {
		expect(template).toBeDefined();
		expect(template?.id).toBe('mixkit-kinetic-title');
		expect(template?.name).toBe('Kinetic Title Animation');
		expect(template?.category).toBe('Kinetic');
		expect(template?.duration).toBe(5_000_000);
		expect(template?.responsiveTiming?.introDuration).toBe(1_800_000);
		expect(template?.responsiveTiming?.outroDuration).toBe(1_550_000);
	});

	it('has 3 stacked video tracks with non-overlapping clips', () => {
		expect(template?.tracks).toHaveLength(3);
		const trackNames = template?.tracks.map((t) => t.name);
		expect(trackNames).toEqual(['Top Text', 'Title Text', 'Subtitle Text']);

		for (const track of template!.tracks) {
			expect(track.clips).toHaveLength(1);
			expect(track.clips[0]!.duration).toBe(5_000_000);
			expect(track.clips[0]!.source?.type).toBe('text');
		}
	});

	it('publishes editable text, font, font size sliders and colors', () => {
		const params = template!.publishedParams;
		const paramProps = params.map((p) => p.targetProperty);

		expect(paramProps.filter((p) => p === 'text.content')).toHaveLength(3);
		expect(paramProps.filter((p) => p === 'text.fontFamily')).toHaveLength(3);
		expect(paramProps.filter((p) => p === 'text.fontSize')).toHaveLength(3);
		expect(paramProps.filter((p) => p === 'text.fill')).toHaveLength(3);

		// Size sliders must have min < default < max and step > 0
		for (const p of params.filter((p) => p.targetProperty === 'text.fontSize')) {
			expect(p.type).toBe('number');
			const val = Number(p.defaultValue);
			expect(p.min!).toBeLessThan(val);
			expect(p.max!).toBeGreaterThan(val);
			expect(p.step!).toBeGreaterThan(0);
		}
	});

	it('instantiates into a project and resolves frame layers across playback', () => {
		const empty = createEmptyProject({ name: 'Kinetic Test' });
		const { project } = instantiateTemplateIntoProject(empty, 'root' as SequenceId, template!, 0);

		// Check intro phase (0.5s = 500,000 µs): KINETIC is revealed, TITLE is still off-screen
		const frameIntro = resolveFrame(project, 500_000);
		const layersIntro = frameIntro.videoLayers[0]?.nested?.layers ?? [];
		expect(layersIntro.length).toBeGreaterThanOrEqual(1);

		// Check apex of jump (1.18s = 1,180,000 µs): KINETIC has jumped up and rotated
		const frameJump = resolveFrame(project, 1_180_000);
		const layersJump = frameJump.videoLayers[0]?.nested?.layers ?? [];
		const kineticJump = layersJump.find((l) => l.textData?.text === 'KINETIC');
		expect(kineticJump?.transform?.y).toBeLessThan(-200);
		expect(kineticJump?.transform?.rotation).toBeCloseTo(-8, 1);

		// Check hold phase (2.5s = 2,500,000 µs): all 3 layers are settled at rest
		const frameHold = resolveFrame(project, 2_500_000);
		const layersHold = frameHold.videoLayers[0]?.nested?.layers ?? [];
		const kinetic = layersHold.find((l) => l.textData?.text === 'KINETIC');
		const title = layersHold.find((l) => l.textData?.text === 'TITLE');
		const anim = layersHold.find((l) => l.textData?.text === 'ANIMATIONS');

		expect(kinetic?.transform?.y).toBe(-145);
		expect(kinetic?.transform?.rotation).toBe(0);
		expect(title?.transform?.y).toBe(40);
		expect(title?.transform?.x).toBe(0);
		expect(anim?.transform?.y).toBe(190);

		// Check outro phase (4.5s = 4,500,000 µs): animation has completed and faded out
		const frameOutro = resolveFrame(project, 4_500_000);
		const layersOutro = frameOutro.videoLayers[0]?.nested?.layers ?? [];
		for (const layer of layersOutro) {
			expect(layer.transform?.opacity).toBe(0);
		}
	});
});

