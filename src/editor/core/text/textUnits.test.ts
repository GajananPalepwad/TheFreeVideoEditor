import { describe, expect, it } from 'vitest';
import { chunkUnits, textUnits } from './textUnits';

describe('textUnits', () => {
	it('splits a line into characters and skips the spaces between them', () => {
		expect(textUnits('ab c', 'char')).toEqual([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 3, end: 4 }
		]);
	});

	it('splits a line into words', () => {
		expect(textUnits('one  two', 'word')).toEqual([
			{ start: 0, end: 3 },
			{ start: 5, end: 8 }
		]);
	});

	it('takes a line whole, without the spaces at either end', () => {
		expect(textUnits('  hello world ', 'line')).toEqual([{ start: 2, end: 13 }]);
	});

	it('has no units for an empty line or one of only spaces', () => {
		for (const unit of ['char', 'word', 'line'] as const) {
			expect(textUnits('', unit)).toEqual([]);
			expect(textUnits('   ', unit)).toEqual([]);
		}
	});

	it('keeps an emoji or a letter with a combining mark as one character', () => {
		const text = 'a😀é';
		const units = textUnits(text, 'char');
		expect(units).toHaveLength(3);
		expect(text.slice(units[1]!.start, units[1]!.end)).toBe('😀');
		expect(text.slice(units[2]!.start, units[2]!.end)).toBe('é');
	});

	it('covers every non-space character exactly once for every unit kind', () => {
		const text = 'Make it move';
		for (const unit of ['char', 'word'] as const) {
			const covered = textUnits(text, unit).flatMap((u) => text.slice(u.start, u.end).split(''));
			expect(covered.join('')).toBe(text.replace(/\s/g, ''));
		}
	});
});

describe('chunkUnits', () => {
	const units = textUnits('one two', 'word');

	it('returns the units a chunk covers, with their place in the list', () => {
		expect(chunkUnits(units, 0, 7)).toEqual([
			{ index: 0, start: 0, end: 3 },
			{ index: 1, start: 4, end: 7 }
		]);
	});

	it('cuts a unit that the chunk ends in the middle of, as a reveal does', () => {
		expect(chunkUnits(units, 0, 5)).toEqual([
			{ index: 0, start: 0, end: 3 },
			{ index: 1, start: 4, end: 5 }
		]);
	});

	it('returns only the unit a word-sized chunk is, whatever comes before it in the line', () => {
		expect(chunkUnits(units, 4, 7)).toEqual([{ index: 1, start: 4, end: 7 }]);
	});

	it('returns nothing for a chunk that holds only spaces', () => {
		expect(chunkUnits(units, 3, 4)).toEqual([]);
	});
});
