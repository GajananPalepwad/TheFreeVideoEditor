import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../factory';
import { resolveFrame, type ActiveLayer } from '../playback';
import { migrate, projectSchema } from '../schema';
import type { Clip, Project, SequenceId } from '../types';
import { BUILTIN_MOTION_TEMPLATES } from './builtinTemplates';
import { instantiateTemplateIntoProject } from './templateService';
import type { MotionGraphicTemplate } from './templateTypes';

const SAMPLE_FRACTIONS = [0.1, 0.5, 0.9];

function instantiate(template: MotionGraphicTemplate, start = 0): Project {
	return instantiateTemplateIntoProject(
		createEmptyProject({ name: 'Fidelity' }),
		'root' as SequenceId,
		template,
		start
	).project;
}

const round = (value: number | undefined) =>
	value === undefined ? undefined : Math.round(value * 100) / 100;

/** What a viewer would see of one nested layer: enough to notice any drift, nothing incidental. */
function summarise(layer: ActiveLayer) {
	return {
		kind: layer.kind,
		text: layer.textData?.text,
		fontSize: round(layer.textData?.fontSize),
		lineHeight: round(layer.textData?.lineHeight),
		reveal: round(layer.textData?.reveal),
		fill: layer.textData ? Object.values(layer.textData.fillColor).map(round) : undefined,
		x: round(layer.transform?.x),
		y: round(layer.transform?.y),
		scale: [round(layer.transform?.scaleX), round(layer.transform?.scaleY)],
		rotation: round(layer.transform?.rotation),
		opacity: round(layer.transform?.opacity)
	};
}

function nestedLayers(project: Project, time: number): ActiveLayer[] {
	const [instance] = resolveFrame(project, time).videoLayers;
	return instance?.nested?.layers ?? [];
}

function expectNoOverlap(tracks: Project['tracks'], where: string): void {
	for (const track of tracks) {
		const clips = [...track.clips].sort((a, b) => a.start - b.start);
		for (let index = 1; index < clips.length; index += 1) {
			const previous = clips[index - 1]!;
			expect(clips[index]!.start, `${where} / ${track.name}`).toBeGreaterThanOrEqual(
				previous.start + previous.duration
			);
		}
	}
}

describe('template fidelity', () => {
	describe('saving and reopening a project', () => {
		for (const template of BUILTIN_MOTION_TEMPLATES) {
			it(`${template.id}: survives save and reload unchanged and renders the same`, () => {
				const project = instantiate(template);
				const reopened = migrate(projectSchema.parse(JSON.parse(JSON.stringify(project))));

				expect(reopened.sequences).toEqual(project.sequences);
				expect(reopened.tracks).toEqual(project.tracks);
				for (const fraction of SAMPLE_FRACTIONS) {
					const time = Math.round(template.duration * fraction);
					expect(nestedLayers(reopened, time).map(summarise)).toEqual(
						nestedLayers(project, time).map(summarise)
					);
				}
			});
		}
	});

	describe('what a template draws', () => {
		for (const template of BUILTIN_MOTION_TEMPLATES) {
			it(`${template.id}: draws the same layers at ${SAMPLE_FRACTIONS.join(', ')} of its length`, () => {
				const project = instantiate(template);
				const frames = SAMPLE_FRACTIONS.map((fraction) =>
					nestedLayers(project, Math.round(template.duration * fraction)).map(summarise)
				);

				expect(frames.every((layers) => layers.length > 0)).toBe(true);
				expect(frames).toMatchSnapshot();
			});
		}

		it('shows each template its own text, not another template’s', () => {
			const drawn = BUILTIN_MOTION_TEMPLATES.map((template) => {
				const layers = nestedLayers(instantiate(template), Math.round(template.duration * 0.5));
				return layers.find((layer) => layer.kind === 'text')?.textData?.text;
			});
			expect(drawn.every((text) => typeof text === 'string' && text.length > 0)).toBe(true);
			expect(new Set(drawn).size).toBe(BUILTIN_MOTION_TEMPLATES.length);
		});
	});

	describe('placing templates', () => {
		it('starts every instance at the time it was dropped at, whatever the template', () => {
			for (const template of BUILTIN_MOTION_TEMPLATES) {
				const project = instantiate(template, 2_000_000);
				const [instance] = project.tracks.flatMap((track) => track.clips) as Clip[];
				expect(instance!.start, template.id).toBe(2_000_000);
				expect(instance!.duration, template.id).toBe(template.duration);
			}
		});

		it('never overlaps clips on a track inside a template sequence', () => {
			for (const template of BUILTIN_MOTION_TEMPLATES) {
				const project = instantiate(template);
				for (const sequence of Object.values(project.sequences ?? {})) {
					expectNoOverlap(sequence.tracks, template.id);
				}
			}
		});
	});
});
