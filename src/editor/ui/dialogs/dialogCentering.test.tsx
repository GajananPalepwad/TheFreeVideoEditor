import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createEditorStore } from '../../state/store';
import { EditorStoreContext } from '../../state/EditorProvider';
import ExportDialog from '../export/ExportDialog';
import ImportDialog from './ImportDialog';
import { createEmptyProject } from '../../core';

describe('Dialog centering and structural classes', () => {
	it('renders ExportDialog with editor-dialog export-dialog classes and no nested frame wrappers', () => {
		const store = createEditorStore();
		const project = createEmptyProject({ name: 'Test Project' });
		store.setState({ project });
		store.getState().openExportDialog();
		store.getInitialState = () => store.getState();

		const html = renderToString(
			<EditorStoreContext.Provider value={store}>
				<ExportDialog />
			</EditorStoreContext.Provider>
		);

		// Must use standard editor-dialog class for fixed viewport centering (50%/50% transform)
		expect(html).toContain('class="editor-dialog export-dialog"');
		// Must not have obsolete ad container wrappers that broke centering
		expect(html).not.toContain('dialog-modal-frame');
		expect(html).not.toContain('dialog-modal-layout');
		expect(html).not.toContain('dialog-surface-card');
	});

	it('renders ImportDialog with editor-dialog import-dialog classes and no nested frame wrappers', () => {
		const store = createEditorStore();
		const project = createEmptyProject({ name: 'Test Project' });
		store.setState({ project });
		store.getState().openImportDialog();
		store.getInitialState = () => store.getState();

		const html = renderToString(
			<EditorStoreContext.Provider value={store}>
				<ImportDialog />
			</EditorStoreContext.Provider>
		);

		// Must use standard editor-dialog class for fixed viewport centering (50%/50% transform)
		expect(html).toContain('class="editor-dialog import-dialog"');
		// Must not have obsolete ad container wrappers that broke centering
		expect(html).not.toContain('dialog-modal-frame');
		expect(html).not.toContain('dialog-modal-layout');
		expect(html).not.toContain('dialog-surface-card');
	});
});
