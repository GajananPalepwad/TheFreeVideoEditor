/**
 * Standard ES2023 Array polyfills for older browser environments
 * (Safari < 16.4, Chrome < 110, Firefox < 115).
 */

declare global {
	interface Array<T> {
		toSorted(compareFn?: (a: T, b: T) => number): T[];
		toReversed(): T[];
		toSpliced(start: number, deleteCount?: number, ...items: T[]): T[];
		with(index: number, value: T): T[];
	}
}

if (!Array.prototype.toSorted) {
	Array.prototype.toSorted = function <T>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
		const copy = [...this];
		return compareFn ? copy.sort(compareFn) : copy.sort();
	};
}

if (!Array.prototype.toReversed) {
	Array.prototype.toReversed = function <T>(this: T[]): T[] {
		return [...this].reverse();
	};
}

if (!Array.prototype.toSpliced) {
	Array.prototype.toSpliced = function <T>(
		this: T[],
		start: number,
		deleteCount?: number,
		...items: T[]
	): T[] {
		const copy = [...this];
		if (deleteCount === undefined) {
			copy.splice(start);
		} else {
			copy.splice(start, deleteCount, ...items);
		}
		return copy;
	};
}

if (!Array.prototype.with) {
	Array.prototype.with = function <T>(this: T[], index: number, value: T): T[] {
		const len = this.length;
		const actualIndex = index < 0 ? len + index : index;
		if (actualIndex < 0 || actualIndex >= len) {
			throw new RangeError(`Invalid index: ${index}`);
		}
		const copy = [...this];
		copy[actualIndex] = value;
		return copy;
	};
}

export {};
