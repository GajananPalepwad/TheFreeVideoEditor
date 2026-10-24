import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	BUILTIN_MOTION_TEMPLATES,
	filterBuiltinTemplates,
	populatedCategoryIds,
	getBuiltinMotionTemplate,
	resolveMotionTemplate
} from './builtinTemplates';
import { createEmptyProject } from '../factory';
import { resolveFrame } from '../playback';
import type { SequenceId } from '../types';
import {
	deserializeTemplate,
	instantiateTemplateIntoProject,
	serializeTemplate
} from './templateService';

const DIR = 'public/templates';
const read = (name: string) => readFileSync(`${DIR}/${name}`, 'utf8');
const libraryFiles = () =>
	readdirSync(DIR)
		.filter((name) => name.endsWith('.grafree') && name !== 'example.grafree')
		.sort();

describe('built-in templates are data', () => {
	it('is exactly the shipped files, byte for byte as data', () => {
		const files = libraryFiles();
		expect(files.length).toBeGreaterThan(0);
		expect(BUILTIN_MOTION_TEMPLATES).toHaveLength(files.length);
		for (const name of files) {
			const fromFile = deserializeTemplate(read(name));
			expect(getBuiltinMotionTemplate(fromFile.id), name).toEqual(fromFile);
		}
	});

	it('has unique ids and lists templates in file-name order', () => {
		const ids = BUILTIN_MOTION_TEMPLATES.map((template) => template.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(libraryFiles().map((name) => name.replace(/\.grafree$/, '')));
	});

	it('resolves a built-in id and returns undefined for an unknown one', () => {
		expect(resolveMotionTemplate('cinematic-blockbuster')?.name).toBe('Cinematic Blockbuster');
		expect(resolveMotionTemplate('no-such-template')).toBeUndefined();
	});
});

describe('example template', () => {
	it('ships a valid sample for authors but keeps it out of the library', () => {
		const example = deserializeTemplate(read('example.grafree'));
		expect(example.tracks.length).toBeGreaterThan(0);
		expect(getBuiltinMotionTemplate(example.id)).toBeUndefined();
		expect(deserializeTemplate(serializeTemplate(example))).toEqual(example);
	});

	it('instantiates and renders its own text, with every published field pointing at a clip', () => {
		const example = deserializeTemplate(read('example.grafree'));
		const clipIds = new Set(example.tracks.flatMap((track) => track.clips.map((clip) => clip.id)));
		for (const param of example.publishedParams) expect(clipIds.has(param.targetClipId)).toBe(true);

		const { project } = instantiateTemplateIntoProject(
			createEmptyProject({ name: 'Example' }),
			'root' as SequenceId,
			example,
			0
		);
		const [layer] = resolveFrame(project, 1_500_000).videoLayers;
		const text = layer!.nested!.layers.find((nested) => nested.kind === 'text');
		expect(text!.textData!.text).toBe('YOUR NAME HERE');
	});
});

describe('filtering the library', () => {
	it('returns everything for "all" and an empty query', () => {
		expect(filterBuiltinTemplates('all', '')).toEqual(BUILTIN_MOTION_TEMPLATES);
	});

	it('filters by the category ids the panel uses', () => {
		const lower = filterBuiltinTemplates('lower-third');
		expect(lower.length).toBeGreaterThan(0);
		expect(lower.every((template) => template.category === 'Lower Thirds')).toBe(true);
		const titles = filterBuiltinTemplates('titles');
		expect(titles.every((template) => template.category === 'Titles')).toBe(true);
	});

	it('searches names and the text a template shows by default', () => {
		expect(filterBuiltinTemplates('all', 'cinematic').map((template) => template.id)).toContain(
			'cinematic-blockbuster'
		);
		expect(
			filterBuiltinTemplates('all', 'epic adventure').map((template) => template.id)
		).toContain('cinematic-blockbuster');
		expect(filterBuiltinTemplates('all', 'zzz-no-match')).toEqual([]);
	});
});

describe('category tabs', () => {
	it('keeps "all" and the categories that hold a template, in the given order', () => {
		const ids = populatedCategoryIds(['all', 'kinetic', 'lower-third', 'titles', 'neon']);
		expect(ids[0]).toBe('all');
		expect(ids).toContain('titles');
		expect(ids).toContain('lower-third');
		expect(ids.indexOf('lower-third')).toBeLessThan(ids.indexOf('titles'));
	});

	it('drops a category that no template belongs to', () => {
		expect(populatedCategoryIds(['all', 'neon', 'minimal'])).toEqual(['all']);
	});
});
