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

/**
 * Resilient DOM reconciliation safety guards.
 *
 * In complex React applications, browser translation extensions (e.g. Google Translate),
 * browser plugins, or imperative keepalive reparenting can reparent or wrap DOM nodes.
 * When React unmounts or reconciles fibers, calling parent.removeChild(child) or
 * parent.insertBefore(newNode, refNode) throws a DOMException (NotFoundError: The node
 * to be removed is not a child of this node) if the node's parent was mutated externally,
 * crashing React's commit phase.
 *
 * These guards make removeChild and insertBefore resilient by routing the operation to
 * the child's actual parentNode if reparented, preventing fatal commit crashes.
 */
export function patchNodeDomMethods(targetNode: {
	prototype: {
		removeChild: (child: Node) => Node;
		insertBefore: (newNode: Node, referenceNode: Node | null) => Node;
		appendChild?: (newNode: Node) => Node;
	};
}): void {
	if (!targetNode || !targetNode.prototype) return;

	const proto = targetNode.prototype;
	const originalRemoveChild = proto.removeChild;
	proto.removeChild = function <T extends Node>(this: Node, child: T): T {
		if (child && child.parentNode !== this) {
			if (child.parentNode) {
				return child.parentNode.removeChild(child) as T;
			}
			return child;
		}
		return originalRemoveChild.call(this, child) as T;
	};

	const originalInsertBefore = proto.insertBefore;
	proto.insertBefore = function <T extends Node>(
		this: Node,
		newNode: T,
		referenceNode: Node | null
	): T {
		if (referenceNode && referenceNode.parentNode !== this) {
			if (referenceNode.parentNode) {
				return referenceNode.parentNode.insertBefore(newNode, referenceNode) as T;
			}
			return (proto.appendChild ? proto.appendChild.call(this, newNode) : newNode) as T;
		}
		return originalInsertBefore.call(this, newNode, referenceNode) as T;
	};
}

if (typeof Node !== 'undefined' && Node.prototype) {
	patchNodeDomMethods(Node);
}
