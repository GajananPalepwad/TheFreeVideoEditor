import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { timelineDuration } from '../core';
import { createEditorStore, type EditorStore, type EditorState } from './store';
import { attachAutosave } from '../services/storage/autosave';
import { deleteMediaFile } from '../services/storage/opfs';

export const EditorStoreContext = createContext<EditorStore | null>(null);

export function EditorProvider({ children }: { children: ReactNode }) {
	const [store] = useState(createEditorStore);

	useEffect(() => {
		if (import.meta.env.DEV) {
			(window as unknown as { __TFVE_STORE__?: EditorStore }).__TFVE_STORE__ = store;
			window.__TFVE_EXPORT_TEST_HOOKS__ ??= {};
			window.__TFVE_EXPORT_TEST_HOOKS__.hideFirstVideoTrack = (hidden) => {
				const state = store.getState();
				const videoTrack = state.project?.tracks.find((track) => track.kind === 'video');
				return videoTrack ? state.setTimelineTrackFlags(videoTrack.id, { hidden }) : false;
			};
			window.__TFVE_EXPORT_TEST_HOOKS__.addSecondClipAfterGap = () => {
				const state = store.getState();
				const project = state.project;
				const videoTrack = state.project?.tracks.find((track) => track.kind === 'video');
				const clip = videoTrack?.clips[0];
				return project && videoTrack && clip && clip.assetId
					? state.addAssetToTimeline(
							clip.assetId,
							videoTrack.id,
							timelineDuration(project) + 2_000_000
						)
					: false;
			};
			window.__TFVE_EXPORT_TEST_HOOKS__.addSampleOverlay = () => {
				const state = store.getState();
				const project = state.project;
				const videoTrack = project?.tracks.find((track) => track.kind === 'video');
				const clip = videoTrack?.clips[0];
				const sample = Object.values(project?.assets ?? {}).find(
					(asset) => asset.name === 'sample.mp4'
				);
				if (!clip || !sample || !state.addAssetOnNewTrack(sample.id, 'video', clip.start)) {
					return false;
				}
				const overlayTrack = store
					.getState()
					.project?.tracks.find((track) =>
						track.clips.some((overlayClip) => overlayClip.assetId === sample.id)
					);
				return overlayTrack ? state.reorderTimelineTrack(overlayTrack.id, 0) : false;
			};
			window.__TFVE_EXPORT_TEST_HOOKS__.hideTopVideoTrack = (hidden) => {
				const state = store.getState();
				const videoTracks = state.project?.tracks.filter((track) => track.kind === 'video') ?? [];
				const topTrack = videoTracks[0];
				return topTrack ? state.setTimelineTrackFlags(topTrack.id, { hidden }) : false;
			};
			window.__TFVE_EXPORT_TEST_HOOKS__.createUiAuditFixture = async () => {
				let state = store.getState();
				let project = state.project;
				const asset = Object.values(project?.assets ?? {}).find((item) => !item.offline);
				const firstVideoTrack = project?.tracks.find((track) => track.kind === 'video');
				if (!project || !asset || !firstVideoTrack || firstVideoTrack.clips.length === 0) {
					return false;
				}
				for (let index = 0; index < 8; index += 1) {
					project = store.getState().project;
					if (
						!project ||
						!store
							.getState()
							.addAssetToTimeline(
								asset.id,
								firstVideoTrack.id,
								timelineDuration(project) + 2_000_000
							)
					) {
						return false;
					}
				}
				for (let index = 0; index < 2; index += 1) {
					store.getState().addTimelineTrack('video');
					state = store.getState();
					const videoTracks = state.project?.tracks.filter((track) => track.kind === 'video') ?? [];
					const addedTrack = videoTracks[0];
					if (!addedTrack || !state.addAssetToTimeline(asset.id, addedTrack.id, 0)) return false;
				}
				await store.getState().flushSave();
				store.getState().selectAssets([]);
				await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
				const currentProject = store.getState().project;
				if (!currentProject) return false;
				await deleteMediaFile(currentProject.id, asset);
				const tracks = currentProject.tracks;
				return {
					trackCount: tracks.length,
					clipCount: tracks.reduce((count, track) => count + track.clips.length, 0)
				};
			};
		}
		const autosave = attachAutosave(store);
		store.getState().setAutosaveFlush(autosave.flush);
		void store.getState().initialize();
		return () => {
			store.getState().setAutosaveFlush(null);
			autosave.dispose();
			if (import.meta.env.DEV) {
				delete (window as unknown as { __TFVE_STORE__?: EditorStore }).__TFVE_STORE__;
				if (window.__TFVE_EXPORT_TEST_HOOKS__) {
					delete window.__TFVE_EXPORT_TEST_HOOKS__.hideFirstVideoTrack;
					delete window.__TFVE_EXPORT_TEST_HOOKS__.addSecondClipAfterGap;
					delete window.__TFVE_EXPORT_TEST_HOOKS__.addSampleOverlay;
					delete window.__TFVE_EXPORT_TEST_HOOKS__.hideTopVideoTrack;
					delete window.__TFVE_EXPORT_TEST_HOOKS__.createUiAuditFixture;
				}
			}
		};
	}, [store]);

	return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>;
}

export function useEditorStore<T>(selector: (state: EditorState) => T): T {
	const store = useContext(EditorStoreContext);
	if (!store) throw new Error('useEditorStore must be used inside EditorProvider.');

	return useStore(store, selector);
}

export function useEditorStoreApi(): EditorStore {
	const store = useContext(EditorStoreContext);
	if (!store) throw new Error('useEditorStoreApi must be used inside EditorProvider.');
	return store;
}
