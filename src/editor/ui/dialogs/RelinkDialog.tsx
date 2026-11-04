// src/editor/ui/dialogs/RelinkDialog.tsx
// Interactive missing media relinking modal for interchange imports.

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { InterchangeTimeline } from '../../core/interchange/ir';
import type { MissingAssetInfo } from '../../services/interop/import/relink';
import {
	matchCandidateFile,
	crawlDirectory,
	crawlDataTransferEntries
} from '../../services/interop/import/relink';
import type { AssetId } from '../../core/types';

interface RelinkDialogProps {
	isOpen: boolean;
	timeline: InterchangeTimeline;
	missingAssets: MissingAssetInfo[];
	onRelinkComplete: (relinkedFiles: Map<AssetId, File>) => void;
	onImportOffline: () => void;
	onClose: () => void;
}

export default function RelinkDialog({
	isOpen,
	timeline,
	missingAssets,
	onRelinkComplete,
	onImportOffline,
	onClose
}: RelinkDialogProps) {
	const [matches, setMatches] = useState<
		Map<AssetId, { file: File; reason: string; score?: number }>
	>(new Map());
	const [isDragging, setIsDragging] = useState(false);
	const [isSearching, setIsSearching] = useState(false);
	const [searchStatus, setSearchStatus] = useState('');
	const fileInputRef = useRef<HTMLInputElement>(null);
	const folderInputRef = useRef<HTMLInputElement>(null);

	if (!isOpen) return null;

	const handleFilesScanned = (candidateFiles: File[]) => {
		if (candidateFiles.length === 0) return;
		const newMatches = new Map(matches);
		let newlyMatchedCount = 0;

		for (const missing of missingAssets) {
			const existing = newMatches.get(missing.id);
			const best = matchCandidateFile(missing, candidateFiles);
			if (best) {
				if (!existing || best.score > (existing.score ?? 0)) {
					newMatches.set(missing.id, {
						file: best.file,
						reason: best.reason,
						score: best.score
					});
					if (!existing) newlyMatchedCount += 1;
				}
			}
		}

		setMatches(newMatches);
		if (newlyMatchedCount > 0) {
			setSearchStatus(
				`Matched ${newlyMatchedCount} media file${newlyMatchedCount === 1 ? '' : 's'}.`
			);
		} else {
			setSearchStatus('Scanned folder; no new matching media found.');
		}
	};

	const handleDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragging(false);
		setIsSearching(true);
		setSearchStatus('Scanning dropped files…');
		try {
			const files = await crawlDataTransferEntries(e.dataTransfer);
			handleFilesScanned(files);
		} catch (err) {
			console.warn('Drop scan error:', err);
		} finally {
			setIsSearching(false);
		}
	};

	const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			handleFilesScanned(Array.from(e.target.files));
		}
		e.target.value = '';
	};

	const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			handleFilesScanned(Array.from(e.target.files));
		}
		e.target.value = '';
	};

	const handleSearchFolder = async () => {
		type DirectoryPickerWindow = Window & {
			showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
		};

		const win = window as DirectoryPickerWindow;
		if (typeof win.showDirectoryPicker === 'function') {
			try {
				const dirHandle = await win.showDirectoryPicker();
				setIsSearching(true);
				setSearchStatus('Scanning folder…');
				const files = await crawlDirectory(dirHandle);
				handleFilesScanned(files);
			} catch (err: unknown) {
				if (err instanceof DOMException && err.name === 'AbortError') {
					return;
				}
				console.warn('showDirectoryPicker failed, falling back to input:', err);
				folderInputRef.current?.click();
			} finally {
				setIsSearching(false);
			}
		} else {
			folderInputRef.current?.click();
		}
	};

	const handleManualPick = (missingId: AssetId) => {
		const picker = document.createElement('input');
		picker.type = 'file';
		picker.onchange = () => {
			const file = picker.files?.[0];
			if (file) {
				const newMatches = new Map(matches);
				newMatches.set(missingId, { file, reason: 'Manually selected', score: 1.0 });
				setMatches(newMatches);
			}
		};
		picker.click();
	};

	const matchedCount = matches.size;
	const totalMissing = missingAssets.length;

	const handleConfirmRelink = () => {
		const resultMap = new Map<AssetId, File>();
		for (const [id, m] of matches.entries()) {
			resultMap.set(id, m.file);
		}
		onRelinkComplete(resultMap);
	};

	const content = (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
			role="dialog"
			aria-labelledby="relink-dialog-title"
			aria-modal="true"
		>
			<div
				className="flex max-h-[85vh] w-[min(720px,calc(100vw-2rem))] max-w-[720px] flex-col overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-6 py-4">
					<div>
						<h2
							id="relink-dialog-title"
							className="text-base font-semibold text-[var(--color-text)]"
						>
							Relink Missing Media
						</h2>
						<p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
							Project “{timeline.name}” references {totalMissing} media file(s) that were not found
							in the package.
						</p>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]"
						aria-label="Close dialog"
					>
						✕
					</button>
				</div>

				{/* Drag & Drop Zone */}
				<div className="p-6">
					<div
						onDragOver={(e) => {
							e.preventDefault();
							setIsDragging(true);
						}}
						onDragLeave={() => setIsDragging(false)}
						onDrop={handleDrop}
						className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
							isDragging
								? 'border-blue-500 bg-blue-500/10'
								: 'border-[var(--color-border-subtle)] bg-[var(--color-surface-inset)]'
						}`}
					>
						<p className="text-sm font-medium text-[var(--color-text)]">
							Drop media folder or files here to auto-match
						</p>
						<p className="mt-1 text-xs text-[var(--color-text-muted)]">
							Matches by exact filename, stem, or format variation
						</p>
						<div className="mt-3 flex items-center justify-center gap-2">
							<button
								type="button"
								onClick={handleSearchFolder}
								disabled={isSearching}
								className="rounded-md border border-blue-500/40 bg-blue-600/20 px-3 py-1.5 text-xs font-semibold text-blue-300 shadow-xs hover:bg-blue-600/30 hover:text-blue-200 disabled:opacity-50"
							>
								{isSearching ? 'Scanning…' : 'Search Folder…'}
							</button>
							<button
								type="button"
								onClick={() => fileInputRef.current?.click()}
								disabled={isSearching}
								className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] shadow-xs hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
							>
								Browse Files…
							</button>
						</div>
						{searchStatus && (
							<p
								className="mt-2 text-[11px] text-[var(--color-text-muted)]"
								data-testid="search-status"
							>
								{searchStatus}
							</p>
						)}
						<input
							ref={fileInputRef}
							type="file"
							multiple
							className="hidden"
							onChange={handleFileInputChange}
						/>
						<input
							ref={folderInputRef}
							type="file"
							multiple
							className="hidden"
							onChange={handleFolderInputChange}
							// @ts-expect-error webkitdirectory is a non-standard browser attribute
							webkitdirectory=""
							directory=""
						/>
					</div>

					{/* File List */}
					<div className="mt-4 max-h-60 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-inset)]">
						<table className="w-full text-left text-xs">
							<thead className="sticky top-0 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-text-muted)]">
								<tr>
									<th className="p-2.5">Expected Media</th>
									<th className="p-2.5">Status</th>
									<th className="p-2.5">Matched File</th>
									<th className="p-2.5 text-right">Action</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[var(--color-border-subtle)]">
								{missingAssets.map((asset) => {
									const match = matches.get(asset.id);
									return (
										<tr key={asset.id} className="hover:bg-[var(--color-surface-hover)]">
											<td className="p-2.5 font-medium text-[var(--color-text)]">
												{asset.name}
												<div className="text-[10px] text-[var(--color-text-muted)]">
													{asset.expectedPath}
												</div>
											</td>
											<td className="p-2.5">
												{match ? (
													<span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
														Matched
													</span>
												) : (
													<span className="inline-flex rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-400">
														Missing
													</span>
												)}
											</td>
											<td className="p-2.5 text-[var(--color-text-muted)]">
												{match ? (
													<div>
														<span className="text-[var(--color-text)]">{match.file.name}</span>
														<div className="text-[10px] text-emerald-400/80">{match.reason}</div>
													</div>
												) : (
													'—'
												)}
											</td>
											<td className="p-2.5 text-right">
												<button
													type="button"
													onClick={() => handleManualPick(asset.id)}
													className="text-[11px] text-blue-400 hover:underline"
												>
													Locate…
												</button>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-between border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-6 py-4 text-xs">
					<div className="text-[var(--color-text-muted)]">
						{matchedCount} of {totalMissing} media files relinked
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-3 py-1.5 font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={onImportOffline}
							className="rounded-lg border border-[var(--color-border-subtle)] px-3 py-1.5 font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)]"
						>
							Import as Offline Media
						</button>
						<button
							type="button"
							onClick={handleConfirmRelink}
							disabled={matchedCount === 0}
							className={`rounded-lg px-4 py-1.5 font-medium text-white shadow-xs ${
								matchedCount > 0
									? 'bg-blue-600 hover:bg-blue-500'
									: 'cursor-not-allowed bg-gray-700 opacity-50'
							}`}
						>
							Relink & Import ({matchedCount})
						</button>
					</div>
				</div>
			</div>
		</div>
	);

	if (typeof document === 'undefined') {
		return content;
	}
	return createPortal(content, document.body);
}
