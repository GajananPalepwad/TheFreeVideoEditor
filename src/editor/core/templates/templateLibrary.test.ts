import { describe, expect, it } from 'vitest';
import type { Clip } from '../types';
import { BUILTIN_MOTION_TEMPLATES, filterBuiltinTemplates } from './builtinTemplates';

const LIBRARY_CATEGORIES = ['titles', 'kinetic', 'lower-third', 'social', 'callouts'];

function textClips(template: (typeof BUILTIN_MOTION_TEMPLATES)[number]): Clip[] {
	return template.tracks.flatMap((track) =>
		track.clips.filter((clip) => clip.source?.type === 'text')
	);
}

describe('the built-in template library', () => {
	it('ships 23 templates', () => {
		expect(BUILTIN_MOTION_TEMPLATES).toHaveLength(23);
	});

	it('fills every category tab with at least two templates', () => {
		for (const category of LIBRARY_CATEGORIES) {
			expect(filterBuiltinTemplates(category).length, category).toBeGreaterThanOrEqual(2);
		}
	});

	it('puts every template in one of those categories', () => {
		const categorised = LIBRARY_CATEGORIES.flatMap((category) =>
			filterBuiltinTemplates(category).map((template) => template.id)
		);
		expect(new Set(categorised).size).toBe(BUILTIN_MOTION_TEMPLATES.length);
	});

	it('keeps clips on a track from overlapping, which the timeline would not allow', () => {
		for (const template of BUILTIN_MOTION_TEMPLATES) {
			for (const track of template.tracks) {
				const clips = [...track.clips].sort((a, b) => a.start - b.start);
				for (let i = 1; i < clips.length; i += 1) {
					const previous = clips[i - 1]!;
					expect(clips[i]!.start, `${template.id} / ${track.name}`).toBeGreaterThanOrEqual(
						previous.start + previous.duration
					);
				}
			}
		}
	});

	it('names and describes every template', () => {
		const names = BUILTIN_MOTION_TEMPLATES.map((template) => template.name);
		expect(new Set(names).size).toBe(names.length);
		for (const template of BUILTIN_MOTION_TEMPLATES) {
			expect(template.description?.length, template.id).toBeGreaterThan(20);
		}
	});

	it('has a kinetic template built from stacked text layers that reveal in turn', () => {
		const stacked = filterBuiltinTemplates('kinetic').filter((template) => {
			const layers = textClips(template);
			return (
				layers.length >= 3 &&
				layers.every((clip) => {
					const reveal = clip.properties?.['text.reveal'];
					return Boolean(reveal && 'keyframes' in reveal && reveal.keyframes.length >= 2);
				})
			);
		});
		expect(stacked.length).toBeGreaterThanOrEqual(1);
	});

	it('lets the viewer edit the text of every template', () => {
		for (const template of BUILTIN_MOTION_TEMPLATES) {
			const texts = template.publishedParams.filter(
				(param) => param.targetProperty === 'text.content'
			);
			expect(texts.length, template.id).toBeGreaterThanOrEqual(1);
		}
	});
});
