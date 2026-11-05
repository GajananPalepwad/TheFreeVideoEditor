import { describe, expect, it } from 'vitest';
import './polyfills';

describe('ES2023 Array polyfills', () => {
	it('polyills Array.prototype.toSorted without mutating original', () => {
		const original = [3, 1, 4, 1, 5, 9, 2];
		const sorted = original.toSorted((a, b) => a - b);

		expect(sorted).toEqual([1, 1, 2, 3, 4, 5, 9]);
		expect(original).toEqual([3, 1, 4, 1, 5, 9, 2]); // Not mutated
	});

	it('toSorted works with default comparator', () => {
		const original = ['banana', 'apple', 'cherry'];
		const sorted = original.toSorted();

		expect(sorted).toEqual(['apple', 'banana', 'cherry']);
		expect(original).toEqual(['banana', 'apple', 'cherry']);
	});

	it('polyills Array.prototype.toReversed without mutating original', () => {
		const original = [1, 2, 3];
		const reversed = original.toReversed();

		expect(reversed).toEqual([3, 2, 1]);
		expect(original).toEqual([1, 2, 3]);
	});

	it('polyills Array.prototype.toSpliced without mutating original', () => {
		const original = ['a', 'b', 'c', 'd'];
		const spliced = original.toSpliced(1, 2, 'x', 'y');

		expect(spliced).toEqual(['a', 'x', 'y', 'd']);
		expect(original).toEqual(['a', 'b', 'c', 'd']);
	});

	it('polyills Array.prototype.with without mutating original', () => {
		const original = [10, 20, 30];
		const replaced = original.with(1, 99);

		expect(replaced).toEqual([10, 99, 30]);
		expect(original).toEqual([10, 20, 30]);
	});
});
