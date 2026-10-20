import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { resolveFrame } from './playback';
import type { AnimatedValue, ClipId, Project } from './types';

function textProject(properties: Record<string, AnimatedValue<unknown>>): Project {
	const project = createEmptyProject({ name: 'Text shadow' });
	const track = project.tracks.find((item) => item.kind === 'video')!;
	track.clips.push({
		id: 'text-1' as ClipId,
		start: 0,
		duration: 2_000_000,
		sourceIn: 0,
		sourceOut: 2_000_000,
		speed: 1,
		volume: 1,
		source: { type: 'text', text: 'Shadow' },
		properties
	});
	return project;
}

const textOf = (project: Project) => resolveFrame(project, 500_000).videoLayers[0]!.textData!;

describe('text shadow', () => {
	it('draws no shadow when none is set', () => {
		expect(textOf(textProject({})).shadowColor).toBeUndefined();
	});

	it('draws a visible shadow when only the blur or offset is set', () => {
		const blurOnly = textOf(textProject({ 'text.shadowBlur': { value: 8 } }));
		const offsetOnly = textOf(textProject({ 'text.shadowOffsetY': { value: 6 } }));

		expect(blurOnly.shadowColor!.a).toBeGreaterThan(0);
		expect(offsetOnly.shadowColor!.a).toBeGreaterThan(0);
		expect(blurOnly.shadowBlur).toBe(8);
		expect(offsetOnly.shadowOffsetY).toBe(6);
	});

	it('keeps an explicit shadow colour, including a fully transparent one', () => {
		const red = textOf(
			textProject({ 'text.shadowBlur': { value: 8 }, 'text.shadowColor': { value: [1, 0, 0, 1] } })
		);
		const hidden = textOf(
			textProject({ 'text.shadowBlur': { value: 8 }, 'text.shadowColor': { value: [1, 0, 0, 0] } })
		);

		expect(red.shadowColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
		expect(hidden.shadowColor).toEqual({ r: 1, g: 0, b: 0, a: 0 });
	});
});
