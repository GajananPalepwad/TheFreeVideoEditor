import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent,
	type KeyboardEvent,
	type MouseEvent,
	type CSSProperties
} from 'react';
import {
	ACCEPTED_MEDIA_INPUT,
	ACCEPTED_TYPES,
	getAssetUsage,
	ticksToTimecode,
	sequenceDuration,
	getSequenceUsage,
	type SequenceId
} from '../../core';
import type { Asset, AssetId, ProjectId } from '../../core';
import { useEditorStore } from '../../state/EditorProvider';
import { getDerived, type DerivedData } from '../../services/storage/mediaCache';
import { getMediaFile, projectMediaSize, projectProxyTotalSize } from '../../services/storage/opfs';
import { setTransparentDragImage, startDragGhost, stopDragGhost } from '../drag/dragOverlayService';
import './media-library.css';

function formatBytes(bytes: number): string {
	if (!bytes || bytes <= 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	const idx = Math.max(0, Math.min(i, sizes.length - 1));
	const val = bytes / Math.pow(k, idx);
	return `${val < 10 && idx > 0 ? val.toFixed(1) : Math.round(val)} ${sizes[idx]}`;
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
	return new Promise((resolve, reject) => {
		entry.file(resolve, reject);
	});
}

async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
	if (entry.isFile) {
		return [await fileFromEntry(entry as FileSystemFileEntry)];
	}
	if (!entry.isDirectory) return [];
	const reader = (entry as FileSystemDirectoryEntry).createReader();
	const entries: FileSystemEntry[] = [];
	while (true) {
		const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
			reader.readEntries(resolve, reject)
		);
		if (batch.length === 0) break;
		entries.push(...batch);
	}
	const nested = await Promise.all(entries.map((child) => filesFromEntry(child)));
	return nested.flat();
}

function timecode(asset: Asset, fps: number): string {
	if (asset.kind === 'image') return '00:00:05:00';
	try {
		return ticksToTimecode(asset.duration, fps);
	} catch {
		return '00:00:00:00';
	}
}

function AssetPreview({ asset, projectId }: { asset: Asset; projectId: ProjectId }) {
	const [derived, setDerived] = useState<DerivedData | null>(null);
	const [posterUrl, setPosterUrl] = useState('');
	useEffect(() => {
		let active = true;
		let objectUrl = '';
		void getDerived(projectId, asset.id)
			.then((value) => {
				if (!active) return;
				setDerived(value);
				if (value?.poster.size) {
					objectUrl = URL.createObjectURL(value.poster);
					setPosterUrl(objectUrl);
				}
			})
			.catch((error: unknown) => {
				console.error(`Could not read media preview for ${asset.name}.`, error);
			});
		return () => {
			active = false;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [asset.id, asset.name, asset.offline, asset.opfsPath, projectId]);
	if (asset.kind === 'audio' && derived?.peaks) {
		const peaks = Array.from(derived.peaks.max.slice(0, 48));
		return (
			<div className="audio-waveform" aria-label="Audio waveform preview">
				{peaks.map((peak, index) => (
					<span key={index} style={{ height: `${Math.max(8, (peak / 127) * 100)}%` }} />
				))}
			</div>
		);
	}
	if (asset.kind === 'audio' && derived?.waveformStatus === 'unavailable') {
		return (
			<div
				className="audio-waveform is-unavailable"
				title="Waveform unavailable for this file or not supported by this browser."
				aria-label="Waveform unavailable"
			>
				{Array.from({ length: 24 }, (_, index) => (
					<span key={index} />
				))}
			</div>
		);
	}
	if (posterUrl) {
		return <img className="asset-poster" src={posterUrl} alt="" width="160" height="100" />;
	}
	return (
		<div className="asset-kind-icon" aria-hidden="true">
			{asset.kind === 'video'
				? '▻'
				: asset.kind === 'audio'
					? '♫'
					: asset.kind === 'font'
						? 'T'
						: asset.kind === 'lut'
							? '◫'
							: '▧'}
		</div>
	);
}

export default function MediaLibrary({
	initialRelinkId = null,
	initialRelinkMismatch = ''
}: {
	initialRelinkId?: AssetId | null;
	initialRelinkMismatch?: string;
} = {}) {
	const project = useEditorStore((state) => state.project);
	const media = useEditorStore((state) => state.media);
	const projectMessage = useEditorStore((state) => state.projectMessage);
	const importMedia = useEditorStore((state) => state.importMedia);
	const openImportDialog = useEditorStore((state) => state.openImportDialog);
	const deleteAsset = useEditorStore((state) => state.deleteAsset);
	const renameAsset = useEditorStore((state) => state.renameAsset);
	const relinkAsset = useEditorStore((state) => state.relinkAsset);
	const setMediaView = useEditorStore((state) => state.setMediaView);
	const setMediaSearch = useEditorStore((state) => state.setMediaSearch);
	const selectAssets = useEditorStore((state) => state.selectAssets);
	const beginTimelineDrag = useEditorStore((state) => state.beginTimelineDrag);
	const cancelTimelineDrag = useEditorStore((state) => state.cancelTimelineDrag);
	const setProjectMessage = useEditorStore((state) => state.setProjectMessage);
	const revision = useEditorStore((state) => state.revision);
	const [isDragging, setIsDragging] = useState(false);
	const [storageBytes, setStorageBytes] = useState(0);
	const [proxyStorageBytes, setProxyStorageBytes] = useState(0);
	const [renamingId, setRenamingId] = useState<AssetId | null>(null);
	const [renameValue, setRenameValue] = useState('');
	const [deleteId, setDeleteId] = useState<AssetId | null>(null);
	const [relinkId, setRelinkId] = useState<AssetId | null>(initialRelinkId);
	const [relinkFile, setRelinkFile] = useState<File | null>(null);
	const [relinkMismatch, setRelinkMismatch] = useState(initialRelinkMismatch);
	const [isRelinkDragOver, setIsRelinkDragOver] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const [activeAssetId, setActiveAssetId] = useState<AssetId | null>(null);
	const [proxySettingsOpen, setProxySettingsOpen] = useState(false);
	const generateAssetDerived = useEditorStore((state) => state.generateAssetDerived);
	const createProxy = useEditorStore((state) => state.createProxy);
	const createAllProxies = useEditorStore((state) => state.createAllProxies);
	const deleteProxy = useEditorStore((state) => state.deleteProxy);
	const deleteAllProxies = useEditorStore((state) => state.deleteAllProxies);
	const retryProxyGeneration = useEditorStore((state) => state.retryProxyGeneration);
	const cancelProxyGeneration = useEditorStore((state) => state.cancelProxyGeneration);
	const setProjectProxySettings = useEditorStore((state) => state.setProjectProxySettings);
	const openSequence = useEditorStore((state) => state.openSequence);
	const createSequence = useEditorStore((state) => state.createSequence);
	const deleteSequence = useEditorStore((state) => state.deleteSequence);
	const renameSequence = useEditorStore((state) => state.renameSequence);
	const duplicateSequence = useEditorStore((state) => state.duplicateSequence);
	const openSequenceSettingsDialog = useEditorStore((state) => state.openSequenceSettingsDialog);
	const [mediaTab, setMediaTab] = useState<'all' | 'media' | 'sequences'>('all');
	const [renamingSeqId, setRenamingSeqId] = useState<SequenceId | null>(null);
	const [renameSeqValue, setRenameSeqValue] = useState('');
	const [deleteSeqId, setDeleteSeqId] = useState<SequenceId | null>(null);

	// 4 seconds baad "Imported" status ko hide karne ke liye
	const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(new Set());
	const scheduledJobIds = useRef<Set<string>>(new Set());

	useEffect(() => {
		const doneJobs = media.importQueue.filter(
			(job) =>
				job.status === 'done' &&
				!dismissedJobIds.has(job.id) &&
				!scheduledJobIds.current.has(job.id)
		);

		if (doneJobs.length === 0) return;

		doneJobs.forEach((job) => {
			scheduledJobIds.current.add(job.id);
			setTimeout(() => {
				setDismissedJobIds((prev) => new Set(prev).add(job.id));
			}, 3000);
		});
	}, [media.importQueue, dismissedJobIds]);

	const proxyDialogRef = useRef<HTMLDialogElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const relinkInputRef = useRef<HTMLInputElement>(null);
	const deleteDialogRef = useRef<HTMLDialogElement>(null);
	const deleteSeqDialogRef = useRef<HTMLDialogElement>(null);
	const relinkDialogRef = useRef<HTMLDialogElement>(null);
	const cardRefs = useRef(new Map<string, HTMLDivElement>());
	const lastDropAt = useRef(0);
	const selectionAnchor = useRef<AssetId | null>(null);
	const assets = useMemo(
		() =>
			Object.values(project?.assets ?? {})
				.slice()
				.reverse(),
		[project?.assets]
	);
	const sequencesList = useMemo(
		() =>
			Object.values(project?.sequences ?? {})
				.slice()
				.reverse(),
		[project?.sequences]
	);
	const filteredAssets = useMemo(() => {
		const needle = media.search.trim().toLocaleLowerCase();
		return assets.filter((asset) => !needle || asset.name.toLocaleLowerCase().includes(needle));
	}, [assets, media.search]);
	const filteredSequences = useMemo(() => {
		const needle = media.search.trim().toLocaleLowerCase();
		return sequencesList.filter((seq) => !needle || seq.name.toLocaleLowerCase().includes(needle));
	}, [sequencesList, media.search]);
	const pendingDelete = assets.find((asset) => asset.id === deleteId) ?? null;
	const hasImportFailures = media.importQueue.some((job) => job.status === 'failed');
	const pendingRelink = assets.find((asset) => asset.id === relinkId) ?? null;
	const deleteUsage = project && pendingDelete ? getAssetUsage(project, pendingDelete.id) : [];
	const rovingAssetId = filteredAssets.some((asset) => asset.id === activeAssetId)
		? activeAssetId
		: filteredAssets[0]?.id;

	useEffect(() => {
		if (!project) {
			setStorageBytes(0);
			setProxyStorageBytes(0);
			return;
		}
		let active = true;
		void projectMediaSize(project.id)
			.then((size) => {
				if (active) setStorageBytes(size);
			})
			.catch((error: unknown) => {
				if (active)
					setProjectMessage(
						`Could not read media storage usage: ${error instanceof Error ? error.message : 'Unknown storage error.'}`
					);
			});
		void projectProxyTotalSize(project.id)
			.then((size) => {
				if (active) setProxyStorageBytes(size);
			})
			.catch(() => {
				// Non-fatal if proxy size fails
			});
		return () => {
			active = false;
		};
	}, [project, assets.length, revision, setProjectMessage]);

	useEffect(() => {
		const dialog = deleteDialogRef.current;
		if (!dialog) return;
		if (pendingDelete && !dialog.open) dialog.showModal();
		if (!pendingDelete && dialog.open) dialog.close();
	}, [pendingDelete]);

	useEffect(() => {
		const dialog = deleteSeqDialogRef.current;
		if (!dialog) return;
		if (deleteSeqId && !dialog.open) dialog.showModal();
		if (!deleteSeqId && dialog.open) dialog.close();
	}, [deleteSeqId]);

	useEffect(() => {
		const dialog = relinkDialogRef.current;
		if (!dialog) return;
		if (pendingRelink && !dialog.open) dialog.showModal();
		if (!pendingRelink && dialog.open) dialog.close();
	}, [pendingRelink]);

	useEffect(() => {
		const dialog = proxyDialogRef.current;
		if (!dialog) return;
		if (proxySettingsOpen && !dialog.open) dialog.showModal();
		if (!proxySettingsOpen && dialog.open) dialog.close();
	}, [proxySettingsOpen]);

	async function importFiles(files: File[]): Promise<void> {
		if (!files.length || isImporting) return;
		setIsImporting(true);
		try {
			await importMedia(files);
		} finally {
			setIsImporting(false);
		}
	}

	function dragEnter(event: DragEvent<HTMLElement>): void {
		event.preventDefault();
		setIsDragging(true);
	}

	function dragLeave(event: DragEvent<HTMLElement>): void {
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
		setIsDragging(false);
	}

	async function dropFiles(event: DragEvent<HTMLElement>): Promise<void> {
		event.preventDefault();
		setIsDragging(false);
		const now = Date.now();
		if (now - lastDropAt.current < 250) return;
		lastDropAt.current = now;
		const files = Array.from(event.dataTransfer.files);
		const entries = Array.from(event.dataTransfer.items)
			.map((item) => item.webkitGetAsEntry())
			.filter((entry): entry is FileSystemEntry => entry !== null);
		const nestedFiles = (await Promise.all(entries.map((entry) => filesFromEntry(entry)))).flat();
		const allFiles = nestedFiles.length ? nestedFiles : files;
		await importFiles(allFiles);
	}

	async function downloadAsset(asset: Asset): Promise<void> {
		if (!project) return;
		try {
			const file = await getMediaFile(project.id, asset);
			const url = URL.createObjectURL(file);
			const a = document.createElement('a');
			a.href = url;
			a.download = asset.name || file.name;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 2000);
		} catch (error) {
			setProjectMessage(
				`Could not download file: ${error instanceof Error ? error.message : 'Unknown storage error.'}`
			);
		}
	}

	function startRename(asset: Asset): void {
		setRenamingId(asset.id);
		setRenameValue(asset.name);
	}

	function commitRename(assetId: AssetId): void {
		if (renameAsset(assetId, renameValue)) setRenamingId(null);
	}

	function selectAsset(
		assetId: AssetId,
		options: { toggle?: boolean; extend?: boolean } = {}
	): void {
		if (options.extend) {
			const anchorId = selectionAnchor.current ?? media.selectedAssetIds[0] ?? assetId;
			const anchorIndex = filteredAssets.findIndex((asset) => asset.id === anchorId);
			const targetIndex = filteredAssets.findIndex((asset) => asset.id === assetId);
			if (anchorIndex >= 0 && targetIndex >= 0) {
				const first = Math.min(anchorIndex, targetIndex);
				const last = Math.max(anchorIndex, targetIndex);
				selectAssets(filteredAssets.slice(first, last + 1).map((asset) => asset.id));
				return;
			}
		}
		if (options.toggle) {
			const selected = new Set(media.selectedAssetIds);
			if (selected.has(assetId)) selected.delete(assetId);
			else selected.add(assetId);
			selectionAnchor.current = assetId;
			selectAssets([...selected]);
			return;
		}
		selectionAnchor.current = assetId;
		selectAssets([assetId]);
	}

	function handleAssetKeyDown(event: KeyboardEvent<HTMLDivElement>, asset: Asset): void {
		if (event.target !== event.currentTarget) return;
		if (event.key === 'F2') {
			event.preventDefault();
			startRename(asset);
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			setDeleteId(asset.id);
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
			event.preventDefault();
			const index = filteredAssets.findIndex((item) => item.id === asset.id);
			const next = filteredAssets[Math.min(index + 1, filteredAssets.length - 1)];
			if (next) {
				setActiveAssetId(next.id);
				if (event.shiftKey) selectAsset(next.id, { extend: true });
				else selectAsset(next.id);
				cardRefs.current.get(next.id)?.focus();
			}
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
			event.preventDefault();
			const index = filteredAssets.findIndex((item) => item.id === asset.id);
			const previous = filteredAssets[Math.max(0, index - 1)];
			if (previous) {
				setActiveAssetId(previous.id);
				if (event.shiftKey) selectAsset(previous.id, { extend: true });
				else selectAsset(previous.id);
				cardRefs.current.get(previous.id)?.focus();
			}
		}
	}

	function dragAsset(event: DragEvent<HTMLDivElement>, asset: Asset): void {
		setTransparentDragImage(event.dataTransfer);
		startDragGhost({
			title: asset.name,
			kind: 'media',
			badge: asset.kind.toUpperCase()
		});
		event.dataTransfer.setData('application/x-tfve-asset', asset.id);
		event.dataTransfer.effectAllowed = 'copy';
		beginTimelineDrag({
			kind: 'asset',
			clipIds: [],
			original: [],
			preview: [],
			pointerStartTime: 0,
			pointerTime: 0,
			assetId: asset.id,
			allowed: true,
			unlink: false
		});
	}

	function handleAssetClick(event: MouseEvent<HTMLDivElement>, assetId: AssetId): void {
		if (
			event.target instanceof HTMLElement &&
			event.target.closest('.media-item-action-btn, .media-rename-form')
		) {
			return;
		}
		setActiveAssetId(assetId);
		selectAsset(assetId, {
			toggle: event.ctrlKey || event.metaKey,
			extend: event.shiftKey
		});
	}

	async function chooseRelinkFile(files: FileList | File[] | null): Promise<void> {
		const file = files instanceof FileList ? files.item(0) : files?.[0];
		if (!file || !pendingRelink) return;
		setRelinkFile(file);
		setRelinkMismatch('');
		try {
			const result = await relinkAsset(pendingRelink.id, file);
			if (result.mismatch) setRelinkMismatch(result.mismatch);
			else if (result.relinked) closeRelink();
		} catch (err) {
			setRelinkMismatch(err instanceof Error ? err.message : 'Failed to relink media file.');
		}
	}

	function closeRelink(): void {
		setRelinkId(null);
		setRelinkFile(null);
		setRelinkMismatch('');
		setIsRelinkDragOver(false);
		if (relinkInputRef.current) relinkInputRef.current.value = '';
	}

	async function confirmRelink(): Promise<void> {
		if (!pendingRelink || !relinkFile) return;
		try {
			const result = await relinkAsset(pendingRelink.id, relinkFile, { acceptMismatch: true });
			if (result.relinked) closeRelink();
		} catch (err) {
			setRelinkMismatch(err instanceof Error ? err.message : 'Failed to relink media file.');
		}
	}

	async function removeSelectedAsset(force = false): Promise<void> {
		if (!pendingDelete) return;
		const result = await deleteAsset(pendingDelete.id, { force });
		if (result.deleted) setDeleteId(null);
	}

	function handleCreateSequence(): void {
		const defaultName = `Sequence ${(project?.sequences ? Object.keys(project.sequences).length : 0) + 1}`;
		const name = window.prompt('Sequence name:', defaultName);
		if (name && name.trim()) {
			const seqId = createSequence(name.trim());
			if (seqId) {
				openSequence(seqId);
			}
		}
	}

	function startRenameSequence(seqId: SequenceId, currentName: string): void {
		setRenamingSeqId(seqId);
		setRenameSeqValue(currentName);
	}

	function commitRenameSequence(seqId: SequenceId): void {
		if (renameSeqValue.trim()) {
			renameSequence(seqId, renameSeqValue.trim());
		}
		setRenamingSeqId(null);
	}

	function dragSequence(event: DragEvent<HTMLDivElement>, seqId: SequenceId): void {
		setTransparentDragImage(event.dataTransfer);
		const seq = project?.sequences?.[seqId];
		startDragGhost({
			title: seq?.name ?? 'Sequence',
			kind: 'media',
			badge: 'SEQUENCE'
		});
		event.dataTransfer.setData('application/x-tfve-sequence', seqId);
		event.dataTransfer.effectAllowed = 'copy';
	}

	return (
		<div
			className={`media-library ${isDragging ? 'is-drop-target' : ''}`}
			style={{ '--media-thumbnail-height': '48px' } as CSSProperties}
			onDragEnter={dragEnter}
			onDragOver={(event) => event.preventDefault()}
			onDragLeave={dragLeave}
			onDrop={(event) => void dropFiles(event)}
			aria-busy={
				isImporting ||
				media.importQueue.some((job) => !['done', 'failed', 'cancelled'].includes(job.status))
			}
		>
			<div className="media-library-header">
				<div className="media-library-toolbar">
					<div className="media-toolbar-actions">
						<button
							className="secondary-button media-import-button"
							type="button"
							disabled={!project || isImporting}
							onClick={() => openImportDialog()}
							title="Import media files"
						>
							<svg
								className="media-btn-icon"
								viewBox="0 0 16 16"
								width="13"
								height="13"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M8 10V2M8 2L5 5M8 2L11 5M2 11v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" />
							</svg>
							<span>Import</span>
						</button>
						<button
							className="secondary-button media-new-sequence-btn"
							type="button"
							disabled={!project}
							onClick={handleCreateSequence}
							title="Create a new sequence"
							aria-label="New sequence"
						>
							<svg
								className="media-btn-icon"
								viewBox="0 0 16 16"
								width="13"
								height="13"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<rect x="2" y="3" width="12" height="10" rx="1.5" />
								<path d="M5 3v10M11 3v10M2 6.5h3M2 9.5h3M11 6.5h3M11 9.5h3" />
							</svg>
							<span>Sequence</span>
						</button>
						<button
							className="secondary-button media-proxy-settings-btn"
							type="button"
							disabled={!project}
							onClick={() => setProxySettingsOpen(true)}
							title="Configure video proxy resolution and auto generation"
							aria-label="Proxy settings"
						>
							<svg
								className="media-btn-icon"
								viewBox="0 0 16 16"
								width="13"
								height="13"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<circle cx="8" cy="8" r="2.5" />
								<path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
							</svg>
							<span>Proxies</span>
						</button>
					</div>
					<input
						ref={fileInputRef}
						type="file"
						name="media-files"
						accept={ACCEPTED_MEDIA_INPUT}
						multiple
						hidden
						onChange={(event) => {
							void importFiles(Array.from(event.currentTarget.files ?? []));
							event.currentTarget.value = '';
						}}
					/>
				</div>
				<div className="media-filter-tabs" role="tablist" aria-label="Filter items">
					<button
						type="button"
						role="tab"
						aria-selected={mediaTab === 'all'}
						className={`filter-pill ${mediaTab === 'all' ? 'is-active' : ''}`}
						onClick={() => setMediaTab('all')}
					>
						All ({assets.length + sequencesList.length})
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={mediaTab === 'media'}
						className={`filter-pill ${mediaTab === 'media' ? 'is-active' : ''}`}
						onClick={() => setMediaTab('media')}
					>
						Media ({assets.length})
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={mediaTab === 'sequences'}
						className={`filter-pill ${mediaTab === 'sequences' ? 'is-active' : ''}`}
						onClick={() => setMediaTab('sequences')}
					>
						Sequences ({sequencesList.length})
					</button>
				</div>
				<div className="media-search-size-row">
					<label className="media-search">
						<span className="sr-only">Search media</span>
						<div className="media-search-input-wrapper">
							<svg
								className="media-search-icon"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<circle cx="6.5" cy="6.5" r="4.5" />
								<path d="M10 10l4 4" />
							</svg>
							<input
								type="search"
								name="media-search"
								autoComplete="off"
								placeholder="Search media…"
								value={media.search}
								onChange={(event) => setMediaSearch(event.currentTarget.value)}
							/>
						</div>
					</label>
					<div className="media-view-toggle" role="group" aria-label="Media view">
						<button
							type="button"
							aria-pressed={media.viewMode === 'list'}
							aria-label="List view"
							title="List view"
							onClick={() => setMediaView('list')}
						>
							<svg
								viewBox="0 0 16 16"
								width="13"
								height="13"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M2.5 3.5h11v1.5h-11zm0 3.75h11v1.5h-11zm0 3.75h11v1.5h-11z" />
							</svg>
						</button>
						<button
							type="button"
							aria-pressed={media.viewMode === 'grid'}
							aria-label="Grid view"
							title="Grid view"
							onClick={() => setMediaView('grid')}
						>
							<svg
								viewBox="0 0 16 16"
								width="13"
								height="13"
								fill="currentColor"
								aria-hidden="true"
							>
								<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
								<rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
								<rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
								<rect x="9" y="9" width="4.5" height="4.5" rx="1" />
							</svg>
						</button>
					</div>
				</div>
				<div className="media-column-heading">
					<span>Name</span>
					<span>Duration</span>
				</div>
			</div>
			<div className="media-assets-scroll-area">
				{!project ? (
					<div className="empty-state">
						<p>No project open</p>
						<span>Create or open a project before importing media.</span>
					</div>
				) : mediaTab === 'media' && assets.length === 0 ? (
					<button className="media-drop-empty" type="button" onClick={() => openImportDialog()}>
						<div className="media-drop-icon-wrapper" aria-hidden="true">
							<svg
								className="media-drop-icon"
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
								<path d="M12 12v9" />
								<path d="m16 16-4-4-4 4" />
							</svg>
						</div>
						<div className="media-drop-text-group">
							<strong className="media-drop-title">Drop media files here</strong>
							<span className="media-drop-subtitle">or choose files from this device</span>
						</div>
						<div className="media-drop-formats">
							<span className="media-format-tag">Video</span>
							<span className="media-format-tag">Audio</span>
							<span className="media-format-tag">Images</span>
							<span className="media-format-tag">Fonts</span>
						</div>
						<small className="media-drop-extensions">{ACCEPTED_TYPES.join(' · ')}</small>
					</button>
				) : mediaTab === 'sequences' && sequencesList.length === 0 ? (
					<div className="empty-state">
						<p>No sequences created yet.</p>
						<button
							className="secondary-button"
							type="button"
							onClick={handleCreateSequence}
							style={{ marginTop: '8px' }}
						>
							+ New Sequence
						</button>
					</div>
				) : mediaTab === 'all' && assets.length === 0 && sequencesList.length === 0 ? (
					<button className="media-drop-empty" type="button" onClick={() => openImportDialog()}>
						<div className="media-drop-icon-wrapper" aria-hidden="true">
							<svg
								className="media-drop-icon"
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
								<path d="M12 12v9" />
								<path d="m16 16-4-4-4 4" />
							</svg>
						</div>
						<div className="media-drop-text-group">
							<strong className="media-drop-title">Drop media files here</strong>
							<span className="media-drop-subtitle">or choose files from this device</span>
						</div>
						<div className="media-drop-formats">
							<span className="media-format-tag">Video</span>
							<span className="media-format-tag">Audio</span>
							<span className="media-format-tag">Images</span>
							<span className="media-format-tag">Fonts</span>
						</div>
						<small className="media-drop-extensions">{ACCEPTED_TYPES.join(' · ')}</small>
					</button>
				) : (mediaTab === 'media' && filteredAssets.length === 0) ||
				  (mediaTab === 'sequences' && filteredSequences.length === 0) ||
				  (mediaTab === 'all' && filteredAssets.length === 0 && filteredSequences.length === 0) ? (
					<div className="empty-state">
						<p>No items match “{media.search}”.</p>
					</div>
				) : (
					<div
						className={`media-assets media-assets-${media.viewMode}`}
						role="listbox"
						aria-label="Project media"
						aria-multiselectable="true"
					>
						{/* Sequences section */}
						{(mediaTab === 'all' || mediaTab === 'sequences') &&
							filteredSequences.map((seq) => {
								const durUs = sequenceDuration(project, seq.id);
								const durTc = ticksToTimecode(durUs, project.settings.fps);
								return (
									<div
										key={seq.id}
										className="media-asset is-sequence-asset"
										role="option"
										aria-selected={false}
										aria-label={`${seq.name}, sequence, ${durTc}`}
										draggable
										onDragStart={(event) => dragSequence(event, seq.id)}
										onDragEnd={() => {
											stopDragGhost();
											cancelTimelineDrag();
										}}
										onDoubleClick={() => openSequence(seq.id)}
									>
										<div className="media-asset-preview">
											<div className="asset-kind-icon sequence-icon" aria-hidden="true">
												<svg
													width="18"
													height="18"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<rect width="20" height="20" x="2" y="2" rx="2.18" ry="2.18" />
													<line x1="7" x2="7" y1="2" y2="22" />
													<line x1="17" x2="17" y1="2" y2="22" />
													<line x1="2" x2="22" y1="12" y2="12" />
													<line x1="2" x2="7" y1="7" y2="7" />
													<line x1="2" x2="7" y1="17" y2="17" />
													<line x1="17" x2="22" y1="7" y2="7" />
													<line x1="17" x2="22" y1="17" y2="17" />
												</svg>
											</div>
										</div>
										<div className="media-asset-details">
											{renamingSeqId === seq.id ? (
												<form
													className="media-rename-form"
													onSubmit={(event) => {
														event.preventDefault();
														commitRenameSequence(seq.id);
													}}
												>
													<label className="sr-only" htmlFor={`seq-rename-${seq.id}`}>
														Rename sequence
													</label>
													<input
														id={`seq-rename-${seq.id}`}
														name="seq-rename"
														autoComplete="off"
														value={renameSeqValue}
														onChange={(event) => setRenameSeqValue(event.currentTarget.value)}
														onKeyDown={(event) => {
															if (event.key === 'Escape') setRenamingSeqId(null);
														}}
													/>
													<button className="sr-only" type="submit">
														Save name
													</button>
												</form>
											) : (
												<button
													className="media-asset-name"
													type="button"
													onClick={() => openSequence(seq.id)}
													onDoubleClick={() => startRenameSequence(seq.id, seq.name)}
													title={`${seq.name} · Double-click to open · F2 to rename`}
												>
													{seq.name}
												</button>
											)}
											<span className="media-asset-meta">
												{durTc} · {seq.tracks.length} tracks
											</span>
											<div className="media-status-line">
												<span className="media-chip">Sequence</span>
												{(() => {
													const instanceCount = project
														? getSequenceUsage(project, seq.id).length
														: 0;
													return instanceCount > 0 ? (
														<span
															className="media-chip is-instance-count"
															data-testid={`instance-count-${seq.id}`}
															title={`Used ${instanceCount} time(s) across timeline`}
														>
															{instanceCount} instance{instanceCount > 1 ? 's' : ''}
														</span>
													) : null;
												})()}
												<button
													className="media-action-link"
													type="button"
													onClick={() => openSequence(seq.id)}
												>
													Open
												</button>
												<button
													className="media-action-link"
													type="button"
													onClick={() => openSequenceSettingsDialog(seq.id)}
												>
													Settings
												</button>
											</div>
										</div>
										<div className="media-asset-actions">
											<button
												type="button"
												aria-label={`Duplicate ${seq.name}`}
												title="Duplicate"
												onClick={() => duplicateSequence(seq.id)}
											>
												⧉
											</button>
											<button
												type="button"
												aria-label={`Rename ${seq.name}`}
												title="Rename (F2)"
												onClick={() => startRenameSequence(seq.id, seq.name)}
											>
												<svg
													width="11"
													height="11"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
													aria-hidden="true"
												>
													<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
													<path d="m15 5 4 4" />
												</svg>
											</button>
											<button
												type="button"
												aria-label={`Delete ${seq.name}`}
												title="Delete"
												onClick={() => setDeleteSeqId(seq.id)}
											>
												×
											</button>
										</div>
									</div>
								);
							})}
						{/* Assets section */}
						{(mediaTab === 'all' || mediaTab === 'media') &&
							filteredAssets.map((asset) => {
								const selected = media.selectedAssetIds.includes(asset.id);
								const job = media.importQueue.find(
									(item) => item.name === asset.name && item.status !== 'done'
								);
								const status = media.derivedStatus[asset.id];
								return (
									<div
										key={asset.id}
										ref={(element) => {
											if (element) cardRefs.current.set(asset.id, element);
											else cardRefs.current.delete(asset.id);
										}}
										className={`media-asset ${selected ? 'is-selected' : ''}`}
										role="option"
										aria-selected={selected}
										aria-label={`${asset.name}, ${asset.kind}, ${timecode(asset, project.settings.fps)}`}
										tabIndex={asset.id === rovingAssetId ? 0 : -1}
										draggable={asset.kind !== 'font' && asset.kind !== 'lut'}
										onDragStart={(event) => {
											if (asset.kind !== 'font' && asset.kind !== 'lut') {
												dragAsset(event, asset);
											}
										}}
										onDragEnd={() => {
											stopDragGhost();
											cancelTimelineDrag();
										}}
										onClick={(event) => handleAssetClick(event, asset.id)}
										onFocus={() => setActiveAssetId(asset.id)}
										onKeyDown={(event) => handleAssetKeyDown(event, asset)}
									>
										<div className="media-asset-preview">
											<AssetPreview asset={asset} projectId={project.id} />
										</div>
										<div className="media-asset-details">
											{renamingId === asset.id ? (
												<form
													className="media-rename-form"
													onSubmit={(event) => {
														event.preventDefault();
														commitRename(asset.id);
													}}
												>
													<label className="sr-only" htmlFor={`media-rename-${asset.id}`}>
														Rename media
													</label>
													<input
														id={`media-rename-${asset.id}`}
														name="media-rename"
														autoComplete="off"
														value={renameValue}
														onChange={(event) => setRenameValue(event.currentTarget.value)}
														onKeyDown={(event) => {
															if (event.key === 'Escape') setRenamingId(null);
														}}
													/>
													<button className="sr-only" type="submit">
														Save name
													</button>
												</form>
											) : (
												<button
													className="media-asset-name"
													type="button"
													onClick={(event) => {
														setActiveAssetId(asset.id);
														selectAsset(asset.id, {
															toggle: event.ctrlKey || event.metaKey,
															extend: event.shiftKey
														});
													}}
													onDoubleClick={() => startRename(asset)}
													title={`${asset.name} · F2 to rename`}
												>
													{asset.name}
												</button>
											)}
											<span className="media-asset-meta">
												{timecode(asset, project.settings.fps)}
												{asset.width && asset.height && ` · ${asset.width} × ${asset.height}`}
												{asset.fps && ` · ${asset.fps}${asset.fpsEstimated ? ' fps*' : ' fps'}`}
												{asset.bitDepth && asset.bitDepth > 8 ? (
													<span
														className="media-chip is-badge is-10bit"
														title={`${asset.bitDepth}-bit color depth`}
													>
														{asset.bitDepth}b
													</span>
												) : null}
												{asset.isHdr ? (
													<span
														className="media-chip is-badge is-hdr"
														title="High Dynamic Range (HDR) content"
													>
														HDR
													</span>
												) : null}
												{asset.isVfr ? (
													<span
														className="media-chip is-badge is-warning"
														title="Variable Frame Rate (VFR) detected: timing may drift; proxy recommended"
													>
														VFR
													</span>
												) : null}
												{asset.isInterlaced ? (
													<span
														className="media-chip is-badge is-warning"
														title="Interlaced video detected: field deinterlacing recommended"
													>
														INT
													</span>
												) : null}
											</span>
											<div className="media-status-line">
												{asset.offline ? (
													<>
														<strong className="media-chip is-offline">Offline</strong>
														<button
															className="media-action-link"
															type="button"
															onClick={() => setRelinkId(asset.id)}
														>
															Relink…
														</button>
													</>
												) : status === 'queued' || status === 'working' ? (
													<span className="media-chip">Generating previews…</span>
												) : status === 'failed' ? (
													<>
														<span className="media-chip is-failed">Preview failed</span>
														<button
															className="media-action-link"
															type="button"
															onClick={() => generateAssetDerived(asset.id)}
														>
															Retry
														</button>
													</>
												) : asset.kind === 'video' && asset.videoDecodable === false ? (
													<span
														className="media-chip is-failed"
														title={`Unsupported video codec: ${asset.videoCodec ?? 'unknown'}. Platform WebCodecs cannot decode this format directly.`}
													>
														Unsupported Codec ({asset.videoCodec ?? 'unknown'})
													</span>
												) : asset.kind === 'video' && asset.audioChecked === false ? (
													<span
														className="media-chip is-failed"
														title="This browser could not inspect the container audio tracks; audio may be omitted."
													>
														Audio track unverified
													</span>
												) : null}
												{asset.kind === 'video' && !asset.offline && (
													<>
														{asset.proxy?.status === 'working' && (
															<span
																className="media-chip is-proxy"
																data-testid="proxy-status-working"
															>
																Proxy {Math.round(asset.proxy.progress ?? 0)}%
																<button
																	className="media-action-link"
																	type="button"
																	onClick={() => cancelProxyGeneration(asset.id)}
																>
																	Cancel
																</button>
															</span>
														)}
														{asset.proxy?.status === 'queued' && (
															<span
																className="media-chip is-proxy"
																data-testid="proxy-status-queued"
															>
																Proxy queued
																<button
																	className="media-action-link"
																	type="button"
																	onClick={() => cancelProxyGeneration(asset.id)}
																>
																	Cancel
																</button>
															</span>
														)}
														{asset.proxy?.status === 'ready' && (
															<span
																className="media-chip is-proxy-ready"
																data-testid="proxy-status-ready"
																title={`Proxy: ${asset.proxy.width}×${asset.proxy.height} (${formatBytes(asset.proxy.bytes ?? 0)})`}
															>
																Proxy ready ({asset.proxy.height}p)
																<button
																	className="media-action-link"
																	type="button"
																	title="Delete proxy"
																	onClick={() => void deleteProxy(asset.id)}
																>
																	Delete
																</button>
															</span>
														)}
														{asset.proxy?.status === 'stale' && (
															<span
																className="media-chip is-failed"
																data-testid="proxy-status-stale"
															>
																Proxy stale
																<button
																	className="media-action-link"
																	type="button"
																	onClick={() => retryProxyGeneration(asset.id)}
																>
																	Update
																</button>
															</span>
														)}
														{asset.proxy?.status === 'failed' && (
															<span
																className="media-chip is-failed"
																data-testid="proxy-status-failed"
																title={asset.proxy.error}
															>
																Proxy failed
																<button
																	className="media-action-link"
																	type="button"
																	onClick={() => retryProxyGeneration(asset.id)}
																>
																	Retry
																</button>
															</span>
														)}
														{(!asset.proxy || asset.proxy.status === 'none') && (
															<button
																className="media-action-link"
																type="button"
																data-testid="create-proxy-button"
																onClick={() => createProxy(asset.id)}
															>
																Create proxy
															</button>
														)}
													</>
												)}
											</div>
										</div>
										<div className="media-asset-actions">
											{asset.kind === 'video' &&
												!asset.offline &&
												(!asset.proxy || asset.proxy.status === 'none') && (
													<button
														type="button"
														aria-label={`Create proxy for ${asset.name}`}
														title="Create proxy"
														onClick={() => createProxy(asset.id)}
													>
														<svg
															width="12"
															height="12"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															strokeWidth="2"
															strokeLinecap="round"
															strokeLinejoin="round"
															aria-hidden="true"
														>
															<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
														</svg>
													</button>
												)}
											{!asset.offline && (
												<button
													type="button"
													aria-label={`Download ${asset.name} to computer`}
													title="Download to computer"
													onClick={(e) => {
														e.stopPropagation();
														void downloadAsset(asset);
													}}
												>
													<svg
														width="12"
														height="12"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2"
														strokeLinecap="round"
														strokeLinejoin="round"
														aria-hidden="true"
													>
														<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
														<polyline points="7 10 12 15 17 10" />
														<line x1="12" y1="15" x2="12" y2="3" />
													</svg>
												</button>
											)}
											<button
												type="button"
												aria-label={`Rename ${asset.name}`}
												title="Rename (F2)"
												onClick={() => startRename(asset)}
											>
												<svg
													width="11"
													height="11"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													strokeLinecap="round"
													strokeLinejoin="round"
													aria-hidden="true"
												>
													<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
													<path d="m15 5 4 4" />
												</svg>
											</button>
											<button
												type="button"
												aria-label={`Delete ${asset.name}`}
												title="Delete"
												onClick={() => setDeleteId(asset.id)}
											>
												×
											</button>
										</div>
										{job &&
											job.status !== 'done' &&
											job.status !== 'failed' &&
											job.status !== 'cancelled' && (
												<div className="media-import-progress">
													<span>
														{job.status === 'probing'
															? 'Reading metadata…'
															: job.status === 'queued'
																? 'Preparing…'
																: `Importing ${Math.round(job.progress)}%`}
													</span>
													<progress
														value={job.progress}
														max={100}
														aria-label={`Import ${job.name}`}
													/>
												</div>
											)}
									</div>
								);
							})}
					</div>
				)}

				{hasImportFailures && (
					<div className="media-failures" role="status" aria-live="polite">
						{media.importQueue
							.filter((job) => job.status === 'failed')
							.map((job) => (
								<p key={job.id}>
									<strong>Failed:</strong> {job.name} — {job.reason}
								</p>
							))}
					</div>
				)}
				<div className="media-live" role="status" aria-live="polite">
					{projectMessage}
				</div>
			</div>
			{media.importQueue.filter((job) => !dismissedJobIds.has(job.id)).length > 0 && (
				<div
					className="media-import-queue"
					aria-label="Media import progress"
					style={{ padding: '8px', borderTop: '1px solid #333', backgroundColor: '#1e1e1e' }}
				>
					{media.importQueue
						.filter((job) => !dismissedJobIds.has(job.id))
						.map((job) => (
							<div
								className="media-import-job"
								key={job.id}
								style={{
									display: 'flex',
									justifyContent: 'space-between',
									fontSize: '12px',
									color: '#aaa'
								}}
							>
								<span
									className="truncate"
									style={{
										maxWidth: '200px',
										whiteSpace: 'nowrap',
										overflow: 'hidden',
										textOverflow: 'ellipsis'
									}}
								>
									{job.name}
								</span>
								<span style={{ color: job.status === 'done' ? '#4ade80' : 'inherit' }}>
									{job.status === 'probing'
										? 'Reading metadata…'
										: job.status === 'queued'
											? 'Preparing…'
											: job.status === 'done'
												? 'Imported'
												: job.status === 'failed'
													? `Failed: ${job.reason}`
													: job.status === 'cancelled'
														? 'Cancelled'
														: `${Math.round(job.progress)}%`}
								</span>
							</div>
						))}
				</div>
			)}
			<footer className="media-library-footer">
				<span className="media-item-count">
					{assets.length} {assets.length === 1 ? 'item' : 'items'}
					{sequencesList.length > 0 ? ` · ${sequencesList.length} seq` : ''}
				</span>
				<span className="media-storage-count">
					{formatBytes(storageBytes)} used
					{proxyStorageBytes > 0 && ` (${formatBytes(proxyStorageBytes)} proxies)`}
				</span>
			</footer>
			<dialog
				ref={deleteDialogRef}
				className="editor-dialog media-delete-dialog"
				aria-labelledby="media-delete-title"
				onCancel={(event) => {
					event.preventDefault();
					setDeleteId(null);
				}}
				onClick={(event: MouseEvent<HTMLDialogElement>) => {
					if (event.target === event.currentTarget) setDeleteId(null);
				}}
			>
				{pendingDelete && project && (
					<div className="dialog-content">
						<h2 id="media-delete-title">Delete “{pendingDelete.name}”?</h2>
						<p>
							{deleteUsage.length > 0
								? `Used by ${deleteUsage.length} clips on the timeline. Delete the asset and its clips? Undo keeps its media available for this session; unused media is cleaned when the project closes.`
								: 'This removes the asset from the project. Its media file and previews are safely cleaned up when the project is closed; undo keeps them available for this session.'}
						</p>
						<div className="dialog-actions">
							<button className="secondary-button" type="button" onClick={() => setDeleteId(null)}>
								Cancel
							</button>
							<button
								className="danger-button"
								type="button"
								onClick={() => void removeSelectedAsset(deleteUsage.length > 0)}
							>
								Delete media
							</button>
						</div>
					</div>
				)}
			</dialog>
			<dialog
				ref={relinkDialogRef}
				className="editor-dialog media-relink-dialog"
				aria-labelledby="media-relink-title"
				onCancel={(event) => {
					event.preventDefault();
					closeRelink();
				}}
				onClick={(event: MouseEvent<HTMLDialogElement>) => {
					if (event.target === event.currentTarget) closeRelink();
				}}
			>
				{pendingRelink && project && (
					<div className="dialog-content">
						<div className="dialog-heading">
							<div>
								<span className="dialog-eyebrow">RELINK MEDIA</span>
								<h2 id="media-relink-title">Relink Missing Asset</h2>
								<p className="dialog-description">
									Select the original or replacement media file to reconnect it to your timeline and
									clips.
								</p>
							</div>
							<button
								type="button"
								className="icon-button dialog-close"
								onClick={closeRelink}
								aria-label="Close dialog"
							>
								✕
							</button>
						</div>

						<div className="media-relink-target-card">
							<div className="media-relink-target-header">
								<div className="media-relink-target-title-group">
									<span className={`media-relink-kind-badge is-${pendingRelink.kind}`}>
										{pendingRelink.kind.toUpperCase()}
									</span>
									<span className="media-relink-target-name" title={pendingRelink.name}>
										{pendingRelink.name}
									</span>
								</div>
								<span className="media-relink-status-badge">Missing</span>
							</div>
							<div className="media-relink-target-meta">
								{pendingRelink.kind !== 'image' && (
									<span className="media-relink-meta-item">
										<span className="media-relink-meta-label">Duration:</span>
										<span className="media-relink-meta-value">
											{timecode(pendingRelink, project.settings.fps)}
										</span>
									</span>
								)}
								{pendingRelink.width && pendingRelink.height && (
									<span className="media-relink-meta-item">
										<span className="media-relink-meta-label">Resolution:</span>
										<span className="media-relink-meta-value">
											{`${pendingRelink.width}×${pendingRelink.height}`}
										</span>
									</span>
								)}
								<span className="media-relink-meta-item">
									<span className="media-relink-meta-label">Original Size:</span>
									<span className="media-relink-meta-value">{formatBytes(pendingRelink.size)}</span>
								</span>
							</div>
						</div>

						<input
							ref={relinkInputRef}
							type="file"
							name="relink-file"
							accept={ACCEPTED_MEDIA_INPUT}
							className="media-relink-hidden-input"
							onChange={(event) => {
								void chooseRelinkFile(event.currentTarget.files);
							}}
						/>

						<div
							className={`media-relink-dropzone ${isRelinkDragOver ? 'is-drag-over' : ''}`}
							role="button"
							tabIndex={0}
							aria-label="Choose replacement media file"
							onClick={() => {
								if (relinkInputRef.current) relinkInputRef.current.value = '';
								relinkInputRef.current?.click();
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									if (relinkInputRef.current) relinkInputRef.current.value = '';
									relinkInputRef.current?.click();
								}
							}}
							onDragOver={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setIsRelinkDragOver(true);
							}}
							onDragLeave={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setIsRelinkDragOver(false);
							}}
							onDrop={(e) => {
								e.preventDefault();
								e.stopPropagation();
								setIsRelinkDragOver(false);
								void chooseRelinkFile(e.dataTransfer.files);
							}}
						>
							<div className="media-relink-drop-icon-wrapper" aria-hidden="true">
								<svg
									width="22"
									height="22"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
									<polyline points="17 8 12 3 7 8" />
									<line x1="12" x2="12" y1="3" y2="15" />
								</svg>
							</div>
							<div className="media-relink-drop-text">
								<span className="media-relink-drop-primary">
									<strong>Choose file</strong> or drag &amp; drop replacement
								</span>
								<span className="media-relink-drop-hint">Matches video, audio, or image files</span>
							</div>
						</div>

						{relinkMismatch && (
							<div className="media-relink-mismatch-banner" role="alert">
								<div className="media-relink-mismatch-icon" aria-hidden="true">
									<svg
										width="18"
										height="18"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
										<line x1="12" y1="9" x2="12" y2="13" />
										<line x1="12" y1="17" x2="12.01" y2="17" />
									</svg>
								</div>
								<div className="media-relink-mismatch-content">
									<strong className="media-relink-mismatch-title">
										{relinkMismatch.includes('Relink anyway?')
											? 'File Mismatch Detected'
											: 'Unable to Relink File'}
									</strong>
									<p className="media-relink-mismatch-desc">{relinkMismatch}</p>
									{relinkFile && (
										<div className="media-relink-mismatch-file">
											Selected: <strong>{relinkFile.name}</strong> ({formatBytes(relinkFile.size)})
										</div>
									)}
								</div>
							</div>
						)}

						<div className="dialog-actions">
							<button className="secondary-button" type="button" onClick={closeRelink}>
								Cancel
							</button>
							{relinkMismatch ? (
								<>
									<button
										className="secondary-button"
										type="button"
										onClick={() => {
											if (relinkInputRef.current) relinkInputRef.current.value = '';
											relinkInputRef.current?.click();
										}}
									>
										Choose Different File…
									</button>
									{relinkMismatch.includes('Relink anyway?') && (
										<button
											className="danger-button"
											type="button"
											onClick={() => void confirmRelink()}
										>
											Relink Anyway
										</button>
									)}
								</>
							) : (
								<button
									className="primary-button"
									type="button"
									onClick={() => {
										if (relinkInputRef.current) relinkInputRef.current.value = '';
										relinkInputRef.current?.click();
									}}
								>
									Browse File…
								</button>
							)}
						</div>
					</div>
				)}
			</dialog>
			<dialog
				ref={proxyDialogRef}
				className="editor-dialog media-proxy-dialog"
				aria-labelledby="media-proxy-title"
				onCancel={(event) => {
					event.preventDefault();
					setProxySettingsOpen(false);
				}}
				onClick={(event: MouseEvent<HTMLDialogElement>) => {
					if (event.target === event.currentTarget) setProxySettingsOpen(false);
				}}
			>
				{project && (
					<div className="dialog-content">
						<h2 id="media-proxy-title">Proxy Settings</h2>
						<p>
							Proxies are lower-resolution video files generated locally in your browser for
							smoother playback and scrubbing. Originals are always used for export and final
							output.
						</p>

						<div className="dialog-field">
							<label htmlFor="proxy-enabled-toggle">
								<input
									id="proxy-enabled-toggle"
									type="checkbox"
									checked={project.proxy?.enabled ?? false}
									onChange={(e) => setProjectProxySettings({ enabled: e.currentTarget.checked })}
								/>{' '}
								Use proxies in preview and timeline
							</label>
						</div>

						<div className="dialog-field">
							<label htmlFor="proxy-target-height">Proxy resolution (height)</label>
							<select
								id="proxy-target-height"
								value={project.proxy?.targetHeight ?? 540}
								onChange={(e) =>
									setProjectProxySettings({
										targetHeight: Number(e.currentTarget.value) as 360 | 540 | 720
									})
								}
							>
								<option value={360}>360p (Fastest, low memory)</option>
								<option value={540}>540p (Balanced, recommended)</option>
								<option value={720}>720p (High clarity)</option>
							</select>
						</div>

						<div className="dialog-field">
							<label htmlFor="proxy-auto-mode">Automatic proxy generation</label>
							<select
								id="proxy-auto-mode"
								value={project.proxy?.auto ?? 'large'}
								onChange={(e) =>
									setProjectProxySettings({
										auto: e.currentTarget.value as 'off' | 'large' | 'all'
									})
								}
							>
								<option value="large">Large media only (&gt;1080p or &gt;60fps)</option>
								<option value="all">All imported videos</option>
								<option value="off">Off (manual only)</option>
							</select>
						</div>

						<div className="media-proxy-dialog-stats">
							<span>
								Current proxy storage: <strong>{formatBytes(proxyStorageBytes)}</strong>
							</span>
						</div>

						<div className="dialog-actions">
							<button
								className="secondary-button"
								type="button"
								onClick={() => void createAllProxies()}
								title="Generate proxies for all video assets in this project"
							>
								Create All Proxies
							</button>
							<button
								className="danger-button"
								type="button"
								onClick={() => void deleteAllProxies()}
								title="Delete all generated proxies to free up local disk space"
							>
								Delete All Proxies
							</button>
							<button
								className="primary-button"
								type="button"
								onClick={() => setProxySettingsOpen(false)}
							>
								Done
							</button>
						</div>
					</div>
				)}
			</dialog>
			<dialog
				ref={deleteSeqDialogRef}
				className="editor-dialog media-delete-dialog"
				aria-labelledby="seq-delete-title"
				onCancel={(event) => {
					event.preventDefault();
					setDeleteSeqId(null);
				}}
				onClick={(event: MouseEvent<HTMLDialogElement>) => {
					if (event.target === event.currentTarget) setDeleteSeqId(null);
				}}
			>
				{deleteSeqId && project && project.sequences?.[deleteSeqId] && (
					<div className="dialog-content">
						<h2 id="seq-delete-title">Delete “{project.sequences[deleteSeqId].name}”?</h2>
						<p>
							{(() => {
								const usage = getSequenceUsage(project, deleteSeqId);
								return usage.length > 0
									? `This sequence is used in ${usage.length} clip(s). Deleting it will also remove those clips.`
									: 'This will delete the sequence and its contents.';
							})()}
						</p>
						<div className="dialog-actions">
							<button
								className="secondary-button"
								type="button"
								onClick={() => setDeleteSeqId(null)}
							>
								Cancel
							</button>
							<button
								className="danger-button"
								type="button"
								onClick={() => {
									deleteSequence(deleteSeqId, true);
									setDeleteSeqId(null);
								}}
							>
								Delete sequence
							</button>
						</div>
					</div>
				)}
			</dialog>
		</div>
	);
}
