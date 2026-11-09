import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import TransportBar from '../TransportBar';
import { EditorStoreContext } from '../../../state/EditorProvider';
import { createEditorStore } from '../../../state/store';

describe('TransportBar component', () => {
	it('renders playback resolution dropdown with Full, 1/2, and 1/4 options', () => {
		const store = createEditorStore();

		const html = renderToString(
			<EditorStoreContext.Provider value={store}>
				<TransportBar engine={null} fps={30} zoom="fit" onZoomChange={() => {}} />
			</EditorStoreContext.Provider>
		);

		expect(html).toContain('id="preview-resolution"');
		expect(html).toContain('aria-label="Playback resolution"');
		expect(html).toContain('<option value="full" selected="">Full</option>');
		expect(html).toContain('<option value="half">1/2</option>');
		expect(html).toContain('<option value="quarter">1/4</option>');
	});

	it('updates store when playback resolution is changed', () => {
		const store = createEditorStore();

		expect(store.getState().playbackResolution).toBe('full');

		store.getState().setPlaybackResolution('half');
		expect(store.getState().playbackResolution).toBe('half');

		store.getState().setPlaybackResolution('quarter');
		expect(store.getState().playbackResolution).toBe('quarter');

		store.getState().setPlaybackResolution('full');
		expect(store.getState().playbackResolution).toBe('full');
	});
});
