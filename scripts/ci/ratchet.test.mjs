import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeProperty, parseArgs, regressed, splitNul } from './ratchet.mjs';

test('a file regresses only when it gets worse than it was on the base branch', () => {
	assert.equal(regressed(0, 0), false, 'clean stays clean');
	assert.equal(regressed(3, 3), false, 'existing debt is tolerated');
	assert.equal(regressed(2, 3), false, 'fewer problems is an improvement');
	assert.equal(regressed(4, 3), true, 'one more problem than before');
	assert.equal(regressed(1, 0), true, 'clean file turned dirty');
});

test('a new file has no base, so every problem in it counts', () => {
	assert.equal(regressed(1, null), true);
	assert.equal(regressed(0, null), false);
});

test('splitNul keeps names with spaces and drops the empty tail', () => {
	assert.deepEqual(splitNul('a b.ts\0c.ts\0'), ['a b.ts', 'c.ts']);
	assert.deepEqual(splitNul(''), []);
});

test('parseArgs reads the three flags and rejects bad input', () => {
	const sha = 'a'.repeat(40);
	assert.deepEqual(parseArgs(['--tool', 'eslint', '--base', sha, '--files', 'list.nul']), {
		tool: 'eslint',
		base: sha,
		files: 'list.nul'
	});
	assert.throws(() => parseArgs(['--tool', 'tslint', '--base', sha, '--files', 'x']), /--tool/);
	assert.throws(
		() => parseArgs(['--tool', 'eslint', '--base', 'main; rm -rf', '--files', 'x']),
		/--base/
	);
	assert.throws(() => parseArgs(['--tool', 'eslint', '--base', sha]), /--files/);
});

test('annotation properties cannot smuggle a second workflow command', () => {
	assert.equal(escapeProperty('a\n::error::x'), 'a%0A%3A%3Aerror%3A%3Ax');
	assert.equal(escapeProperty('100%,a:b'), '100%25%2Ca%3Ab');
});
