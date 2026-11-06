// src/editor/ui/shell/touchScroll.ts
// Utility for checking scrollable overflow during touch interactions.

/**
 * Determines whether a DOM element (or any of its ancestors up to root)
 * has scrollable overflow in either horizontal or vertical orientation.
 */
export function isElementScrollable(
	target: HTMLElement | null,
	root?: HTMLElement | null
): boolean {
	if (typeof window === 'undefined' || !target) {
		return false;
	}

	const stopElement = root ?? (typeof document !== 'undefined' ? document.body : null);
	let current: HTMLElement | null = target;

	while (
		current &&
		current !== stopElement &&
		(typeof document === 'undefined' || current !== document.documentElement)
	) {
		const style = window.getComputedStyle(current);
		const hasOverflowY =
			(style.overflowY === 'auto' || style.overflowY === 'scroll') &&
			current.scrollHeight > current.clientHeight;
		const hasOverflowX =
			(style.overflowX === 'auto' || style.overflowX === 'scroll') &&
			current.scrollWidth > current.clientWidth;

		if (hasOverflowY || hasOverflowX) {
			return true;
		}
		current = current.parentElement;
	}

	return false;
}
