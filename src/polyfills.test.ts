import { describe, expect, it } from 'vitest';
import { patchNodeDomMethods } from './polyfills';

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

describe('DOM reconciliation safety guards', () => {
	it('safely removes child from actual parentNode when reparented externally', () => {
		class TestNode {
			parentNode: TestNode | null = null;
			removeChild(child: TestNode): TestNode {
				if (child.parentNode !== this) {
					throw new Error(
						"Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node."
					);
				}
				child.parentNode = null;
				return child;
			}
			insertBefore(newNode: TestNode, refNode: TestNode | null): TestNode {
				if (refNode && refNode.parentNode !== this) {
					throw new Error(
						"Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node."
					);
				}
				newNode.parentNode = this;
				return newNode;
			}
			appendChild(newNode: TestNode): TestNode {
				newNode.parentNode = this;
				return newNode;
			}
		}

		patchNodeDomMethods(TestNode as unknown as typeof Node);

		const originalParent = new TestNode();
		const foreignParent = new TestNode();
		const child = new TestNode();

		foreignParent.appendChild(child);
		expect(child.parentNode).toBe(foreignParent);

		// Without the patch, originalParent.removeChild(child) would throw NotFoundError
		const removed = originalParent.removeChild(child as unknown as Node);
		expect(removed).toBe(child);
		expect(child.parentNode).toBeNull();
	});

	it('safely handles insertBefore when referenceNode was reparented externally', () => {
		class TestNode {
			parentNode: TestNode | null = null;
			removeChild(child: TestNode): TestNode {
				child.parentNode = null;
				return child;
			}
			insertBefore(newNode: TestNode, refNode: TestNode | null): TestNode {
				if (refNode && refNode.parentNode !== this) {
					throw new Error("Failed to execute 'insertBefore' on 'Node'");
				}
				newNode.parentNode = this;
				return newNode;
			}
			appendChild(newNode: TestNode): TestNode {
				newNode.parentNode = this;
				return newNode;
			}
		}

		patchNodeDomMethods(TestNode as unknown as typeof Node);

		const originalParent = new TestNode();
		const foreignParent = new TestNode();
		const refNode = new TestNode();
		const newNode = new TestNode();

		foreignParent.appendChild(refNode);

		// Calling originalParent.insertBefore with refNode attached to foreignParent
		const inserted = originalParent.insertBefore(
			newNode as unknown as Node,
			refNode as unknown as Node
		);
		expect(inserted).toBe(newNode);
		expect(newNode.parentNode).toBe(foreignParent);
	});
});
