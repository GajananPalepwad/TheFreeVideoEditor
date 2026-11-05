import '../polyfills';
import { useEffect } from 'react';
import EditorShell from './ui/shell/EditorShell';
import { EditorProvider } from './state/EditorProvider';
import { trackEditorOpen } from '../services/activityTracking';

export default function Editor() {
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
