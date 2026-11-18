import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createEditorStore } from '../../state/store';
import { EditorStoreContext } from '../../state/EditorProvider';
import MediaLibrary from './MediaLibrary';
import { createEmptyProject, addAsset, markAssetOffline } from '../../core';
import type { Asset, AssetId } from '../../core/types';

describe('MediaLibrary Relink Dialog UI', () => {
	const testAsset: Asset = {
		id: 'asset-test-relink' as AssetId,
		name: 'mixkit-soccer-player-juggling-the-ball.mp4',
		kind: 'video',
		mimeType: 'video/mp4',
		size: 25_000_000,
		duration: 15_000_000,
		width: 1920,
		height: 1080,
		fps: 30,
		hasAudio: true,
		audioChecked: true,
		opfsPath: 'test.mp4'
	};

	it('renders modern relink dialog with target card, dropzone, and action buttons', () => {
		const store = createEditorStore();
		let project = createEmptyProject({ name: 'Relink Test' });

		project = addAsset(project, { asset: testAsset });
		project = markAssetOffline(project, { assetId: testAsset.id });

		store.setState({ project });
		store.getInitialState = () => store.getState();

		const html = renderToString(
			<EditorStoreContext.Provider value={store}>
				<MediaLibrary initialRelinkId={testAsset.id} />
			</EditorStoreContext.Provider>
		);

		// Media library contains the offline chip and relink button
		expect(html).toContain('is-offline');
		expect(html).toContain('Relink…');

		// Header elements
		expect(html).toContain('media-relink-dialog');
		expect(html).toContain('RELINK MEDIA');
		expect(html).toContain('Relink Missing Asset');
		expect(html).toContain('aria-label="Close dialog"');

		// Target asset card
		expect(html).toContain('media-relink-target-card');
		expect(html).toContain('media-relink-kind-badge is-video');
		expect(html).toContain('mixkit-soccer-player-juggling-the-ball.mp4');
		expect(html).toContain('media-relink-status-badge');
		expect(html).toContain('1920×1080');
		expect(html).toContain('24 MB');

		// Hidden file input and custom dropzone
		expect(html).toContain('media-relink-hidden-input');
		expect(html).toContain('media-relink-dropzone');
		expect(html).toContain('media-relink-drop-icon-wrapper');
		expect(html).toContain('Choose file');
		expect(html).toContain('drag &amp; drop replacement');

		// Actions
		expect(html).toContain('Browse File…');
		expect(html).toContain('Cancel');
	});

	it('renders mismatch banner and danger override button when differences are detected', () => {
		const store = createEditorStore();
		let project = createEmptyProject({ name: 'Relink Test' });

		project = addAsset(project, { asset: testAsset });
		project = markAssetOffline(project, { assetId: testAsset.id });

		store.setState({ project });
		store.getInitialState = () => store.getState();

		const mismatchMsg =
			"The selected file's duration differs by more than 0.5 seconds. Relink anyway?";

		const html = renderToString(
			<EditorStoreContext.Provider value={store}>
				<MediaLibrary initialRelinkId={testAsset.id} initialRelinkMismatch={mismatchMsg} />
			</EditorStoreContext.Provider>
		);

		// Warning banner
		expect(html).toContain('media-relink-mismatch-banner');
		expect(html).toContain('File Mismatch Detected');
		expect(html).toContain('duration differs by more than 0.5 seconds. Relink anyway?');

		// Action buttons for mismatch
		expect(html).toContain('Choose Different File…');
		expect(html).toContain('Relink Anyway');
		expect(html).toContain('danger-button');
	});
});
