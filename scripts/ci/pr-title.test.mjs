import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelsFor, parseTitle, TYPES } from './pr-title.mjs';

test('accepts a conventional title with or without scope and breaking marker', () => {
	assert.deepEqual(parseTitle('feat: add magnetic timeline'), {
		type: 'feat',
		scope: null,
		breaking: false,
		subject: 'add magnetic timeline'
	});
	assert.deepEqual(parseTitle('fix(timeline): stop clips overlapping'), {
		type: 'fix',
		scope: 'timeline',
		breaking: false,
		subject: 'stop clips overlapping'
	});
	assert.equal(parseTitle('feat(core)!: change the project format').breaking, true);
	assert.equal(parseTitle('ci: add workflows').type, 'ci');
});

test('rejects titles that are not type(scope): subject', () => {
	for (const title of [
		'Add magnetic timeline',
		'feat add magnetic timeline',
		'feat:no space',
		'feat(): empty scope',
		'feature: wrong type',
		'Feat: capitalised type',
		'feat: ',
		'docs : space before colon',
		''
	]) {
		assert.equal(parseTitle(title), null, title);
	}
});

test('every allowed type maps to labels the repository already has', () => {
	const existing = new Set(['bug', 'enhancement', 'documentation']);
	for (const type of TYPES) {
		const labels = labelsFor(type);
		assert.ok(labels.length > 0, type);
		for (const label of labels) assert.ok(existing.has(label), `${type} -> ${label}`);
	}
	assert.deepEqual(labelsFor('fix'), ['bug']);
	assert.deepEqual(labelsFor('docs'), ['documentation']);
	assert.deepEqual(labelsFor('feat'), ['enhancement']);
	assert.deepEqual(labelsFor('chore'), ['enhancement']);
});
