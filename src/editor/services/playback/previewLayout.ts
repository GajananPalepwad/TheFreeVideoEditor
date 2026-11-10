import { previewScale } from '../../core/composition';

export interface PreviewDimensions {
	width: number;
	height: number;
}

export function observePreviewScale(
	element: HTMLElement,
	source: PreviewDimensions,
	onScale: (scale: number) => void
): () => void {
	let lastScale = -1;
	let rafId: number | null = null;

	const measureAndNotify = () => {
		rafId = null;
		const { width, height } = element.getBoundingClientRect();
		if (width <= 0 || height <= 0) return;
		const nextScale = previewScale(source.width, source.height, width, height);
		// Guard against microscopic subpixel float jitter causing repeated re-renders
		if (lastScale < 0 || Math.abs(nextScale - lastScale) > 0.001) {
			lastScale = nextScale;
			onScale(nextScale);
		}
	};

	const scheduleUpdate = () => {
		if (typeof requestAnimationFrame === 'undefined') {
			measureAndNotify();
			return;
		}
		if (rafId !== null) return;
		rafId = requestAnimationFrame(measureAndNotify);
	};

	const observer =
		typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
	observer?.observe(element);
	// Perform immediate initial measurement
	measureAndNotify();

	return () => {
		if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		observer?.disconnect();
	};
}
