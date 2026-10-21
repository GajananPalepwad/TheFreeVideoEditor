import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { resolveFrame } from './playback';
import { migrate } from './schema';
import type { Clip, ClipId, Project } from './types';

const gradientEnd = { r: 0.1, g: 0.2, b: 0.9, a: 1 };
const clipBase = {
	start: 0,
	duration: 1_000_000,
	sourceIn: 0,
	sourceOut: 1_000_000,
	speed: 1,
	volume: 1
};

function projectWith(clips: Clip[]): Project {
	const project = createEmptyProject({ name: 'Graphics persistence' });
	project.tracks[0]!.clips.push(...clips);
	return project;
}

/** What a save followed by a reload does to a project. */
function saveAndReload(project: Project): Project {
	return migrate(JSON.parse(JSON.stringify(project)));
}

describe('graphics fields survive a save and reload', () => {
	it('keeps shape gradients', () => {
		const project = projectWith([
			{
				...clipBase,
				id: 'shape' as ClipId,
				source: {
					type: 'shape',
					shapeType: 'rect',
					width: 300,
					height: 100,
					fillColor: { r: 1, g: 0, b: 0, a: 1 },
					gradientType: 'linear-angle',
					gradientColorEnd: gradientEnd,
					gradientAngle: 45
				}
			}
		]);
		expect(saveAndReload(project).tracks[0]!.clips[0]!.source).toEqual(
			project.tracks[0]!.clips[0]!.source
		);
	});

	it('keeps solid gradients', () => {
		const project = projectWith([
			{
				...clipBase,
				id: 'solid' as ClipId,
				source: {
					type: 'solid',
					color: { r: 0, g: 0, b: 0, a: 1 },
					gradientType: 'radial',
					gradientColorEnd: gradientEnd,
					gradientAngle: 0
				}
			}
		]);
		expect(saveAndReload(project).tracks[0]!.clips[0]!.source).toEqual(
			project.tracks[0]!.clips[0]!.source
		);
	});

	it('keeps text box gradients', () => {
		const project = projectWith([
			{
				...clipBase,
				id: 'text' as ClipId,
				source: {
					type: 'text',
					text: 'Hello',
					box: {
						frameStyle: 'card',
						gradientType: 'linear-vertical',
						gradientColorEnd: gradientEnd,
						gradientAngle: 90
					}
				}
			}
		]);
		expect(saveAndReload(project).tracks[0]!.clips[0]!.source).toEqual(
			project.tracks[0]!.clips[0]!.source
		);
	});

	it('keeps bypassEffects', () => {
		const project = projectWith([
			{
				...clipBase,
				id: 'fx' as ClipId,
				bypassEffects: true,
				source: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }
			}
		]);
		expect(saveAndReload(project).tracks[0]!.clips[0]!.bypassEffects).toBe(true);
	});

	it('still draws the gradient after a reload', () => {
		const project = projectWith([
			{
				...clipBase,
				id: 'shape' as ClipId,
				source: {
					type: 'shape',
					shapeType: 'rect',
					width: 300,
					height: 100,
					fillColor: { r: 1, g: 0, b: 0, a: 1 },
					gradientType: 'linear-horizontal',
					gradientColorEnd: gradientEnd
				}
			}
		]);
		const [layer] = resolveFrame(saveAndReload(project), 0).videoLayers;
		expect(layer!.shapeData).toMatchObject({
			gradientType: 'linear-horizontal',
			gradientColorEnd: gradientEnd
		});
	});
});

describe('text reveal unit persistence', () => {
	it('keeps the reveal unit of a text style through a save and reload', () => {
		const project = projectWith([
			{
				...clipBase,
				id: 'text-reveal' as ClipId,
				source: {
					type: 'text',
					text: 'one two three',
					style: { fontFamily: 'sans-serif', revealUnit: 'word' }
				}
			}
		]);
		const [layer] = resolveFrame(saveAndReload(project), 0).videoLayers;
		expect(layer!.textData!.style.revealUnit).toBe('word');
	});
});
