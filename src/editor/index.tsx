import '../polyfills';
import { useEffect } from 'react';
import EditorShell from './ui/shell/EditorShell';
import { isElementScrollable } from './ui/shell/touchScroll';
import { EditorProvider } from './state/EditorProvider';
import { trackEditorOpen } from '../services/activityTracking';

export default function Editor() {
	useEffect(() => {
		// Ensure the viewport is locked at the origin for the editor application
		window.scrollTo(0, 0);
		const handleResize = () => window.scrollTo(0, 0);
		window.addEventListener('resize', handleResize);

		const handleTouchMove = (e: TouchEvent) => {
			const target = e.target as HTMLElement | null;
			if (!isElementScrollable(target) && e.cancelable) {
				e.preventDefault();
			}
		};

		document.addEventListener('touchmove', handleTouchMove, { passive: false });

		return () => {
			window.removeEventListener('resize', handleResize);
			document.removeEventListener('touchmove', handleTouchMove);
		};
	}, []);

	useEffect(() => {
		trackEditorOpen();
		const loader = document.getElementById('editor-screen-loader');
		if (loader) {
			loader.setAttribute('aria-busy', 'false');
			loader.setAttribute('aria-hidden', 'true');
			loader.classList.add('is-ready');
			const timer = setTimeout(() => {
				loader.remove();
			}, 500);
			return () => clearTimeout(timer);
		}
	}, []);

	return (
		<EditorProvider>
			<EditorShell />
		</EditorProvider>
	);
}
