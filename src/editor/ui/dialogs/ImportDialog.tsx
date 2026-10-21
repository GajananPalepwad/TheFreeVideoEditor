import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { ACCEPTED_MEDIA_INPUT } from '../../core';
import { useEditorStore } from '../../state/EditorProvider';
import { openFiles } from '../../services/storage/fileAccess';
import './import-dialog.css';

type ImportSource = 'computer' | 'youtube' | 'instagram';
type FormatType = 'video' | 'audio' | 'video_only';
type VideoQuality = 'best' | '1080' | '720' | '480' | '360';

interface VideoInfo {
	id: string;
	title: string;
	duration: number;
	thumbnail: string;
	uploader: string;
	availableQualities?: number[];
}

interface InstagramInfo {
	id: string;
	title: string;
	duration: number;
	thumbnail: string;
	uploader: string;
	mediaType: 'video' | 'image';
	availableQualities?: number[];
}

function formatDuration(seconds: number): string {
	if (!seconds || isNaN(seconds)) return '0:00';
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	const h = Math.floor(m / 60);
	const remM = m % 60;
	if (h > 0) {
		return `${h}:${remM.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
	}
	return `${remM}:${s.toString().padStart(2, '0')}`;
}

const YOUTUBE_REGEX =
	/^(https?:\/\/)?(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/;

const INSTAGRAM_REGEX =
	/(?:https?:\/\/)?(?:www\.|m\.)?(?:instagram\.com|instagr\.am)\/(?:[^\/]+\/)?(?:p|reel|reels|tv|share\/reel|share\/p)\/([A-Za-z0-9_-]+)/i;

async function readResponseWithProgress(
	response: Response,
	mimeType: string,
	onProgress: (percent: number | null, loaded: number, total: number) => void
): Promise<Blob> {
	const contentLength = response.headers.get('content-length');
	const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

	if (!response.body) {
		const blob = await response.blob();
		onProgress(100, blob.size, blob.size);
		return blob;
	}

	const reader = response.body.getReader();
	const chunks: BlobPart[] = [];
	let receivedBytes = 0;
	let lastUpdate = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			receivedBytes += value.length;

			const now = Date.now();
			if (now - lastUpdate > 50 || (totalBytes > 0 && receivedBytes >= totalBytes)) {
				lastUpdate = now;
				const pct =
					totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null;
				onProgress(pct, receivedBytes, totalBytes);
			}
		}
	}

	onProgress(100, receivedBytes, totalBytes > 0 ? totalBytes : receivedBytes);
	return new Blob(chunks, { type: mimeType });
}

export default function ImportDialog() {
	const isOpen = useEditorStore((state) => state.isImportDialogOpen);
	const close = useEditorStore((state) => state.closeImportDialog);
	const importMedia = useEditorStore((state) => state.importMedia);
	const project = useEditorStore((state) => state.project);

	const [source, setSource] = useState<ImportSource>('computer');

	// YouTube states
	const [youtubeUrl, setYoutubeUrl] = useState('');
	const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
	const [isFetchingInfo, setIsFetchingInfo] = useState(false);
	const [formatType, setFormatType] = useState<FormatType>('video');
	const [quality, setQuality] = useState<VideoQuality>('best');
	const [saveToComputer, setSaveToComputer] = useState<boolean>(true);

	// Instagram states
	const [instaUrl, setInstaUrl] = useState('');
	const [instaInfo, setInstaInfo] = useState<InstagramInfo | null>(null);
	const [isFetchingInstaInfo, setIsFetchingInstaInfo] = useState(false);
	const [instaFormatType, setInstaFormatType] = useState<FormatType>('video');
	const [instaQuality, setInstaQuality] = useState<VideoQuality>('best');
	const [saveInstaToComputer, setSaveInstaToComputer] = useState<boolean>(true);

	// Shared download & UI states
	const [isDownloading, setIsDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
	const [downloadProgressText, setDownloadProgressText] = useState('');
	const [errorMessage, setErrorMessage] = useState('');
	const [successMessage, setSuccessMessage] = useState('');

	const dialogRef = useRef<HTMLDialogElement>(null);
	const urlInputRef = useRef<HTMLInputElement>(null);
	const instaUrlInputRef = useRef<HTMLInputElement>(null);
	const abortControllerRef = useRef<AbortController | null>(null);
	const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const instaDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Sync dialog open/close
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (isOpen && !dialog.open) {
			dialog.showModal();
			if (source === 'youtube') {
				urlInputRef.current?.focus();
			} else if (source === 'instagram') {
				instaUrlInputRef.current?.focus();
			}
		} else if (!isOpen && dialog.open) {
			dialog.close();
		}
	}, [isOpen, source]);

	// Reset state when opening/closing
	useEffect(() => {
		if (isOpen) {
			setErrorMessage('');
			setSuccessMessage('');
			setDownloadProgress(null);
		} else {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
				abortControllerRef.current = null;
			}
			setIsDownloading(false);
			setDownloadProgress(null);
			setIsFetchingInfo(false);
			setIsFetchingInstaInfo(false);
		}
	}, [isOpen]);

	// Auto-fetch info when valid YouTube URL is entered
	useEffect(() => {
		if (debounceTimeoutRef.current) {
			clearTimeout(debounceTimeoutRef.current);
		}

		const trimmed = youtubeUrl.trim();
		if (!trimmed || !YOUTUBE_REGEX.test(trimmed)) {
			setVideoInfo(null);
			return;
		}

		debounceTimeoutRef.current = setTimeout(async () => {
			setIsFetchingInfo(true);
			try {
				const res = await fetch(`/api/youtube-info?url=${encodeURIComponent(trimmed)}`);
				if (res.ok) {
					const data = (await res.json()) as VideoInfo;
					setVideoInfo(data);
					setErrorMessage('');
				}
			} catch {
				// Non-fatal preview fetch error
			} finally {
				setIsFetchingInfo(false);
			}
		}, 450);

		return () => {
			if (debounceTimeoutRef.current) {
				clearTimeout(debounceTimeoutRef.current);
			}
		};
	}, [youtubeUrl]);

	// Auto-fetch info when valid Instagram URL is entered
	useEffect(() => {
		if (instaDebounceTimeoutRef.current) {
			clearTimeout(instaDebounceTimeoutRef.current);
		}

		const trimmed = instaUrl.trim();
		if (!trimmed || !INSTAGRAM_REGEX.test(trimmed)) {
			setInstaInfo(null);
			return;
		}

		instaDebounceTimeoutRef.current = setTimeout(async () => {
			setIsFetchingInstaInfo(true);
			try {
				const res = await fetch(`/api/instagram-info?url=${encodeURIComponent(trimmed)}`);
				if (res.ok) {
					const data = (await res.json()) as InstagramInfo;
					setInstaInfo(data);
					setErrorMessage('');
				}
			} catch {
				// Non-fatal preview fetch error
			} finally {
				setIsFetchingInstaInfo(false);
			}
		}, 450);

		return () => {
			if (instaDebounceTimeoutRef.current) {
				clearTimeout(instaDebounceTimeoutRef.current);
			}
		};
	}, [instaUrl]);

	const handleBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
		if (e.target === dialogRef.current && !isDownloading) {
			close();
		}
	};

	// 1. Handle Computer File Import
	const handleComputerImport = async () => {
		try {
			const files = await openFiles(ACCEPTED_MEDIA_INPUT);
			if (files.length > 0) {
				close();
				await importMedia(files);
			}
		} catch (err) {
			setErrorMessage(err instanceof Error ? err.message : 'Failed to select files.');
		}
	};

	// 2. Handle YouTube Download
	const handleYoutubeDownload = async (e?: SyntheticEvent, onlySaveComputer = false) => {
		if (e) e.preventDefault();
		const trimmedUrl = youtubeUrl.trim();
		if (!trimmedUrl) {
			setErrorMessage('Please enter a YouTube video URL.');
			return;
		}
		if (!YOUTUBE_REGEX.test(trimmedUrl)) {
			setErrorMessage(
				'Please enter a valid YouTube video link (e.g. https://www.youtube.com/watch?v=...)'
			);
			return;
		}

		setErrorMessage('');
		setSuccessMessage('');
		setIsDownloading(true);
		setDownloadProgress(null);
		setDownloadProgressText('Connecting to YouTube…');

		const controller = new AbortController();
		abortControllerRef.current = controller;

		const progressTimer1 = setTimeout(() => {
			setDownloadProgressText(
				formatType === 'audio'
					? 'Extracting high-quality audio stream…'
					: 'Downloading video & audio streams…'
			);
		}, 1800);

		const progressTimer2 = setTimeout(() => {
			setDownloadProgressText('Processing media with FFmpeg…');
		}, 4000);

		try {
			const response = await fetch('/api/download-youtube', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: trimmedUrl,
					formatType,
					quality
				}),
				signal: controller.signal
			});

			clearTimeout(progressTimer1);
			clearTimeout(progressTimer2);

			if (!response.ok) {
				const errorJson = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(errorJson?.error || `Download failed with HTTP ${response.status}`);
			}

			setDownloadProgressText('Downloading media…');

			const fileExt = formatType === 'audio' ? 'mp3' : 'mp4';
			const mimeType = formatType === 'audio' ? 'audio/mpeg' : 'video/mp4';

			// Parse filename from Content-Disposition header
			const disposition = response.headers.get('Content-Disposition');
			let filename = `youtube_video.${fileExt}`;
			if (disposition) {
				const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
				if (match?.[1]) {
					filename = decodeURIComponent(match[1]);
				}
			} else if (videoInfo?.title) {
				filename = `${videoInfo.title.replace(/[/\\?%*:|"<>]/g, '_')}.${fileExt}`;
			}

			const blob = await readResponseWithProgress(response, mimeType, (pct, loaded, total) => {
				setDownloadProgress(pct);
				if (pct !== null && total > 0) {
					const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
					const totalMB = (total / (1024 * 1024)).toFixed(1);
					setDownloadProgressText(`Downloading media… ${pct}% (${loadedMB} / ${totalMB} MB)`);
				} else {
					const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
					setDownloadProgressText(`Downloading media… ${loadedMB} MB`);
				}
			});

			setDownloadProgress(100);
			setDownloadProgressText(
				onlySaveComputer ? 'Saving file to device…' : 'Importing media into project…'
			);
			const file = new File([blob], filename, { type: mimeType });

			// 1-Click Download: Save file directly to user's computer if enabled or requested
			if (saveToComputer || onlySaveComputer) {
				const downloadUrl = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = downloadUrl;
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				setTimeout(() => URL.revokeObjectURL(downloadUrl), 3000);
			}

			// Also import into project unless onlySaveComputer was requested
			if (!onlySaveComputer) {
				await importMedia([file]);
			}

			const successText = onlySaveComputer
				? `Saved “${filename}” to your Computer Downloads!`
				: saveToComputer
					? `Downloaded to Computer & imported “${filename}”!`
					: `Imported “${filename}” successfully!`;

			setSuccessMessage(successText);
			setIsDownloading(false);
			setTimeout(() => {
				close();
				setYoutubeUrl('');
				setVideoInfo(null);
				setSuccessMessage('');
			}, 1000);
		} catch (err: unknown) {
			clearTimeout(progressTimer1);
			clearTimeout(progressTimer2);
			if (err instanceof Error && err.name === 'AbortError') {
				setDownloadProgressText('');
				setIsDownloading(false);
				return;
			}
			setIsDownloading(false);
			setDownloadProgressText('');
			setErrorMessage(err instanceof Error ? err.message : 'Failed to download YouTube video.');
		} finally {
			abortControllerRef.current = null;
		}
	};

	// 3. Handle Instagram Download (Reel or Post)
	const handleInstagramDownload = async (e?: SyntheticEvent, onlySaveComputer = false) => {
		if (e) e.preventDefault();
		const trimmedUrl = instaUrl.trim();
		if (!trimmedUrl) {
			setErrorMessage('Please enter an Instagram Reel or Post link.');
			return;
		}
		if (!INSTAGRAM_REGEX.test(trimmedUrl)) {
			setErrorMessage(
				'Please enter a valid Instagram Reel or Post link (e.g. https://www.instagram.com/reel/...)'
			);
			return;
		}

		setErrorMessage('');
		setSuccessMessage('');
		setIsDownloading(true);
		setDownloadProgress(null);
		setDownloadProgressText('Connecting to Instagram…');

		const controller = new AbortController();
		abortControllerRef.current = controller;

		const progressTimer1 = setTimeout(() => {
			setDownloadProgressText(
				instaFormatType === 'audio'
					? 'Extracting high-quality audio from Reel…'
					: 'Downloading media stream…'
			);
		}, 1800);

		const progressTimer2 = setTimeout(() => {
			setDownloadProgressText('Processing media with FFmpeg…');
		}, 4000);

		try {
			const response = await fetch('/api/download-instagram', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					url: trimmedUrl,
					formatType: instaFormatType,
					quality: instaQuality
				}),
				signal: controller.signal
			});

			clearTimeout(progressTimer1);
			clearTimeout(progressTimer2);

			if (!response.ok) {
				const errorJson = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(errorJson?.error || `Download failed with HTTP ${response.status}`);
			}

			setDownloadProgressText('Downloading media…');

			const isPhoto = instaInfo?.mediaType === 'image';
			const fileExt = isPhoto ? 'jpg' : instaFormatType === 'audio' ? 'mp3' : 'mp4';
			const mimeType = isPhoto
				? 'image/jpeg'
				: instaFormatType === 'audio'
					? 'audio/mpeg'
					: 'video/mp4';

			// Parse filename from Content-Disposition header
			const disposition = response.headers.get('Content-Disposition');
			let filename = `instagram_media.${fileExt}`;
			if (disposition) {
				const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
				if (match?.[1]) {
					filename = decodeURIComponent(match[1]);
				}
			} else if (instaInfo?.title) {
				filename = `${instaInfo.title.replace(/[/\\?%*:|"<>]/g, '_')}.${fileExt}`;
			}

			const blob = await readResponseWithProgress(response, mimeType, (pct, loaded, total) => {
				setDownloadProgress(pct);
				if (pct !== null && total > 0) {
					const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
					const totalMB = (total / (1024 * 1024)).toFixed(1);
					setDownloadProgressText(`Downloading media… ${pct}% (${loadedMB} / ${totalMB} MB)`);
				} else {
					const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
					setDownloadProgressText(`Downloading media… ${loadedMB} MB`);
				}
			});

			setDownloadProgress(100);
			setDownloadProgressText(
				onlySaveComputer ? 'Saving file to device…' : 'Importing media into project…'
			);
			const file = new File([blob], filename, { type: mimeType });

			// 1-Click Download: Save file directly to user's computer if enabled or requested
			if (saveInstaToComputer || onlySaveComputer) {
				const downloadUrl = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = downloadUrl;
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				setTimeout(() => URL.revokeObjectURL(downloadUrl), 3000);
			}

			// Also import into project unless onlySaveComputer was requested
			if (!onlySaveComputer) {
				await importMedia([file]);
			}

			const successText = onlySaveComputer
				? `Saved “${filename}” to your Computer Downloads!`
				: saveInstaToComputer
					? `Downloaded to Computer & imported “${filename}”!`
					: `Imported “${filename}” successfully!`;

			setSuccessMessage(successText);
			setIsDownloading(false);
			setTimeout(() => {
				close();
				setInstaUrl('');
				setInstaInfo(null);
				setSuccessMessage('');
			}, 1000);
		} catch (err: unknown) {
			clearTimeout(progressTimer1);
			clearTimeout(progressTimer2);
			setDownloadProgress(null);
			if (err instanceof Error && err.name === 'AbortError') {
				setDownloadProgressText('');
				setIsDownloading(false);
				return;
			}
			setIsDownloading(false);
			setDownloadProgressText('');
			setErrorMessage(err instanceof Error ? err.message : 'Failed to download Instagram media.');
		} finally {
			abortControllerRef.current = null;
		}
	};

	const cancelDownload = () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		setIsDownloading(false);
		setDownloadProgressText('');
	};

	if (!isOpen) return null;

	return (
		<dialog
			ref={dialogRef}
			className="editor-dialog import-dialog"
			role="dialog"
			aria-labelledby="import-dialog-title"
			aria-modal="true"
			onClick={handleBackdropClick}
			onCancel={(e) => {
				e.preventDefault();
				if (!isDownloading) close();
			}}
		>
			<div className="dialog-content">
				{/* Dialog Header */}
				<div className="dialog-heading">
					<div>
						<p className="dialog-eyebrow">MEDIA LIBRARY</p>
						<h2 id="import-dialog-title">Import Media</h2>
						<p className="dialog-description">
							Add local files from your device or download media directly from web links.
						</p>
					</div>
					<button
						type="button"
						className="icon-button dialog-close"
						onClick={close}
						disabled={isDownloading}
						aria-label="Close dialog"
					>
						✕
					</button>
				</div>

				{/* Dialog Body */}
				<div className="import-dialog-body">
					{/* 3 Source Options Selector */}
					<div className="import-source-tabs" role="tablist" aria-label="Media import source">
						{/* Option 1: Import from Computer */}
						<button
							type="button"
							role="tab"
							aria-selected={source === 'computer'}
							className={`import-source-tab ${source === 'computer' ? 'is-active' : ''}`}
							onClick={() => {
								setSource('computer');
								setErrorMessage('');
							}}
							disabled={isDownloading}
						>
							<div className="import-tab-icon" aria-hidden="true">
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
									<rect width="20" height="14" x="2" y="3" rx="2" />
									<line x1="8" x2="16" y1="21" y2="21" />
									<line x1="12" x2="12" y1="17" y2="21" />
								</svg>
							</div>
							<span>Computer</span>
						</button>

						{/* Option 2: Download using YouTube Link */}
						<button
							type="button"
							role="tab"
							aria-selected={source === 'youtube'}
							className={`import-source-tab ${source === 'youtube' ? 'is-active' : ''}`}
							onClick={() => {
								setSource('youtube');
								setErrorMessage('');
							}}
							disabled={isDownloading}
						>
							<div className="import-tab-icon youtube-icon" aria-hidden="true">
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
									<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
									<polygon points="10 15 15 12 10 9 10 15" />
								</svg>
							</div>
							<span>YouTube</span>
						</button>

						{/* Option 3: Download using Instagram Link */}
						<button
							type="button"
							role="tab"
							aria-selected={source === 'instagram'}
							className={`import-source-tab ${source === 'instagram' ? 'is-active' : ''}`}
							onClick={() => {
								setSource('instagram');
								setErrorMessage('');
							}}
							disabled={isDownloading}
						>
							<div className="import-tab-icon insta-icon" aria-hidden="true">
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
									<rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
									<path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
									<line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
								</svg>
							</div>
							<span>Instagram</span>
						</button>
					</div>

					{/* Panel 1: Computer Import */}
					{source === 'computer' && (
						<div className="import-panel" role="tabpanel">
							<div>
								<h3 className="import-panel-title">Import from Computer</h3>
								<p className="import-panel-desc">
									Select local video, audio, image, LUT, or font files stored on this device.
								</p>
							</div>

							<div
								className="import-computer-dropzone"
								onClick={() => void handleComputerImport()}
								role="button"
								tabIndex={0}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										void handleComputerImport();
									}
								}}
							>
								<div className="import-dropzone-icon" aria-hidden="true">
									<svg
										width="32"
										height="32"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.75"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
										<polyline points="17 8 12 3 7 8" />
										<line x1="12" x2="12" y1="3" y2="15" />
									</svg>
								</div>
								<div>
									<button
										type="button"
										className="primary-button"
										style={{ pointerEvents: 'none' }}
									>
										Choose Files from Device
									</button>
								</div>
								<div className="import-formats-list">
									<span className="import-format-chip">MP4 / MOV / WebM</span>
									<span className="import-format-chip">WAV / MP3 / AAC</span>
									<span className="import-format-chip">PNG / JPG / WebP</span>
									<span className="import-format-chip">CUBE / TTF / WOFF2</span>
								</div>
							</div>

							{errorMessage && (
								<div className="import-error-banner" role="alert">
									<span aria-hidden="true">⚠️</span>
									<span>{errorMessage}</span>
								</div>
							)}

							<div className="import-dialog-actions">
								<button type="button" className="secondary-button" onClick={close}>
									Cancel
								</button>
							</div>
						</div>
					)}

					{/* Panel 2: YouTube Download */}
					{source === 'youtube' && (
						<form
							className="import-panel"
							role="tabpanel"
							onSubmit={(e) => void handleYoutubeDownload(e)}
						>
							<div>
								<h3 className="import-panel-title">Download using YouTube Link</h3>
								<p className="import-panel-desc">
									Download videos or audio directly from YouTube, save a copy to your computer, and
									import into your timeline.
								</p>
							</div>

							<div className="import-url-group">
								<div className="import-input-wrapper">
									<input
										ref={urlInputRef}
										type="url"
										className="import-url-input"
										placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
										value={youtubeUrl}
										onChange={(e) => setYoutubeUrl(e.target.value)}
										disabled={isDownloading}
										aria-label="YouTube video URL"
									/>
									{youtubeUrl && !isDownloading && (
										<button
											type="button"
											className="import-input-clear"
											onClick={() => {
												setYoutubeUrl('');
												setVideoInfo(null);
												setErrorMessage('');
												urlInputRef.current?.focus();
											}}
											aria-label="Clear URL input"
										>
											✕
										</button>
									)}
								</div>
							</div>

							{/* Video Metadata Preview */}
							{isFetchingInfo && (
								<div
									className="import-progress-status"
									style={{ fontSize: '11px', color: '#94a3b8' }}
								>
									<div className="import-spinner" style={{ width: 12, height: 12 }} />
									<span>Fetching video details…</span>
								</div>
							)}

							{videoInfo && !isDownloading && (
								<div className="import-video-preview">
									{videoInfo.thumbnail && (
										<div className="import-preview-thumb-wrapper">
											<img
												src={videoInfo.thumbnail}
												alt=""
												className="import-preview-thumb"
												loading="lazy"
											/>
											{videoInfo.duration > 0 && (
												<span className="import-preview-duration">
													{formatDuration(videoInfo.duration)}
												</span>
											)}
										</div>
									)}
									<div className="import-preview-details">
										<p className="import-preview-title" title={videoInfo.title}>
											{videoInfo.title}
										</p>
										{videoInfo.uploader && (
											<p className="import-preview-author">{videoInfo.uploader}</p>
										)}
									</div>
								</div>
							)}

							{/* Download Options: Audio / Video & Quality */}
							<div className="import-options-grid">
								{/* Option: Format Mode (Video + Audio / Audio Only / Video Only) */}
								<div className="import-option-field">
									<span className="import-field-label">Media Type</span>
									<div
										className="import-format-segmented"
										role="radiogroup"
										aria-label="Media format"
									>
										<button
											type="button"
											role="radio"
											aria-checked={formatType === 'video'}
											className={`import-format-btn ${formatType === 'video' ? 'is-active' : ''}`}
											onClick={() => setFormatType('video')}
											disabled={isDownloading}
										>
											Video + Audio
										</button>
										<button
											type="button"
											role="radio"
											aria-checked={formatType === 'audio'}
											className={`import-format-btn ${formatType === 'audio' ? 'is-active' : ''}`}
											onClick={() => setFormatType('audio')}
											disabled={isDownloading}
										>
											Audio Only
										</button>
										<button
											type="button"
											role="radio"
											aria-checked={formatType === 'video_only'}
											className={`import-format-btn ${formatType === 'video_only' ? 'is-active' : ''}`}
											onClick={() => setFormatType('video_only')}
											disabled={isDownloading}
										>
											Video Only
										</button>
									</div>
								</div>

								{/* Option: Quality Selection */}
								<div className="import-option-field">
									<span className="import-field-label">Quality</span>
									{formatType === 'audio' ? (
										<select
											className="import-select"
											disabled={isDownloading}
											aria-label="Audio quality"
											value="320"
											onChange={() => {}}
										>
											<option value="320">MP3 · 320 kbps (Best Quality)</option>
										</select>
									) : (
										<select
											className="import-select"
											value={quality}
											onChange={(e) => setQuality(e.target.value as VideoQuality)}
											disabled={isDownloading}
											aria-label="Video quality"
										>
											<option value="best">Best Available (Highest)</option>
											<option value="1080">1080p (Full HD)</option>
											<option value="720">720p (HD)</option>
											<option value="480">480p (Standard)</option>
											<option value="360">360p</option>
										</select>
									)}
								</div>
							</div>

							{/* 1-Click Download & Device Backup Toggle */}
							<label className="import-device-backup-card">
								<input
									type="checkbox"
									className="import-device-backup-checkbox"
									checked={saveToComputer}
									onChange={(e) => setSaveToComputer(e.target.checked)}
									disabled={isDownloading}
								/>
								<div className="import-device-backup-text">
									<span className="import-device-backup-title">
										1-Click Download: Also save copy to Computer (Downloads)
									</span>
									<span className="import-device-backup-sub">
										Keeps the video file safely on your hard drive so it won't be lost when opening
										this project on other devices.
									</span>
								</div>
							</label>

							{/* Active Download Progress */}
							{isDownloading && (
								<div
									className="import-progress-box"
									role="progressbar"
									aria-valuenow={downloadProgress ?? undefined}
									aria-valuemin={0}
									aria-valuemax={100}
								>
									<div className="import-progress-header">
										<div className="import-progress-status">
											<div className="import-spinner" />
											<span>{downloadProgressText}</span>
										</div>
										{downloadProgress !== null && (
											<span className="import-progress-percent">{downloadProgress}%</span>
										)}
									</div>
									<div className="import-progress-bar">
										{downloadProgress !== null ? (
											<div
												className="import-progress-bar-fill"
												style={{ width: `${downloadProgress}%` }}
											/>
										) : (
											<div className="import-progress-bar-inner" />
										)}
									</div>
								</div>
							)}

							{/* Error Banner */}
							{errorMessage && (
								<div className="import-error-banner" role="alert">
									<span aria-hidden="true">⚠️</span>
									<span>{errorMessage}</span>
								</div>
							)}

							{/* Success Banner */}
							{successMessage && (
								<div className="import-success-banner" role="status">
									<span aria-hidden="true">✓</span>
									<span>{successMessage}</span>
								</div>
							)}

							<div className="import-dialog-actions">
								{isDownloading ? (
									<button type="button" className="secondary-button" onClick={cancelDownload}>
										Cancel Download
									</button>
								) : (
									<>
										<button type="button" className="secondary-button" onClick={close}>
											Cancel
										</button>
										<button
											type="button"
											className="secondary-button"
											disabled={!youtubeUrl.trim()}
											onClick={(e) => void handleYoutubeDownload(e, true)}
											title="Download file to computer only"
										>
											Save to Computer Only
										</button>
										<button
											type="submit"
											className="primary-button"
											disabled={!youtubeUrl.trim() || !project}
											title="1-Click download and import into project"
										>
											Download & Import (1-Click)
										</button>
									</>
								)}
							</div>
						</form>
					)}

					{/* Panel 3: Instagram Download (Reels & Posts) */}
					{source === 'instagram' && (
						<form
							className="import-panel"
							role="tabpanel"
							onSubmit={(e) => void handleInstagramDownload(e)}
						>
							<div>
								<h3 className="import-panel-title">Download using Insta Link</h3>
								<p className="import-panel-desc">
									Download Instagram Reels or Posts directly, save a copy to your computer, and
									import into your timeline.
								</p>
							</div>

							<div className="import-url-group">
								<div className="import-input-wrapper">
									<input
										ref={instaUrlInputRef}
										type="url"
										className="import-url-input"
										placeholder="https://www.instagram.com/reel/... or https://www.instagram.com/p/..."
										value={instaUrl}
										onChange={(e) => setInstaUrl(e.target.value)}
										disabled={isDownloading}
										aria-label="Instagram Reel or Post URL"
									/>
									{instaUrl && !isDownloading && (
										<button
											type="button"
											className="import-input-clear"
											onClick={() => {
												setInstaUrl('');
												setInstaInfo(null);
												setErrorMessage('');
												instaUrlInputRef.current?.focus();
											}}
											aria-label="Clear URL input"
										>
											✕
										</button>
									)}
								</div>
							</div>

							{/* Video / Post Metadata Preview */}
							{isFetchingInstaInfo && (
								<div
									className="import-progress-status"
									style={{ fontSize: '11px', color: '#94a3b8' }}
								>
									<div className="import-spinner" style={{ width: 12, height: 12 }} />
									<span>Fetching Instagram details…</span>
								</div>
							)}

							{instaInfo && !isDownloading && (
								<div className="import-video-preview">
									{instaInfo.thumbnail && (
										<div className="import-preview-thumb-wrapper">
											<img
												src={instaInfo.thumbnail}
												alt=""
												className="import-preview-thumb"
												loading="lazy"
											/>
											{instaInfo.duration > 0 ? (
												<span className="import-preview-duration">
													{formatDuration(instaInfo.duration)}
												</span>
											) : instaInfo.mediaType === 'image' ? (
												<span className="import-photo-badge">PHOTO</span>
											) : null}
										</div>
									)}
									<div className="import-preview-details">
										<p className="import-preview-title" title={instaInfo.title}>
											{instaInfo.title}
										</p>
										{instaInfo.uploader && (
											<p className="import-preview-author">@{instaInfo.uploader}</p>
										)}
									</div>
								</div>
							)}

							{/* Download Options: Audio / Video & Quality */}
							{instaInfo?.mediaType === 'image' ? (
								<div className="import-options-grid">
									<div className="import-option-field">
										<span className="import-field-label">Media Type</span>
										<div className="import-format-segmented">
											<button
												type="button"
												className="import-format-btn is-active"
												disabled
												style={{ cursor: 'default' }}
											>
												Photo / Image (High Resolution)
											</button>
										</div>
									</div>
									<div className="import-option-field">
										<span className="import-field-label">Format</span>
										<select
											className="import-select"
											disabled
											aria-label="Image format"
											value="jpeg"
										>
											<option value="jpeg">Original High Quality JPEG</option>
										</select>
									</div>
								</div>
							) : (
								<div className="import-options-grid">
									{/* Option: Format Mode */}
									<div className="import-option-field">
										<span className="import-field-label">Media Type</span>
										<div
											className="import-format-segmented"
											role="radiogroup"
											aria-label="Instagram media format"
										>
											<button
												type="button"
												role="radio"
												aria-checked={instaFormatType === 'video'}
												className={`import-format-btn ${instaFormatType === 'video' ? 'is-active' : ''}`}
												onClick={() => setInstaFormatType('video')}
												disabled={isDownloading}
											>
												Video + Audio
											</button>
											<button
												type="button"
												role="radio"
												aria-checked={instaFormatType === 'audio'}
												className={`import-format-btn ${instaFormatType === 'audio' ? 'is-active' : ''}`}
												onClick={() => setInstaFormatType('audio')}
												disabled={isDownloading}
											>
												Audio Only
											</button>
											<button
												type="button"
												role="radio"
												aria-checked={instaFormatType === 'video_only'}
												className={`import-format-btn ${instaFormatType === 'video_only' ? 'is-active' : ''}`}
												onClick={() => setInstaFormatType('video_only')}
												disabled={isDownloading}
											>
												Video Only
											</button>
										</div>
									</div>

									{/* Option: Quality Selection */}
									<div className="import-option-field">
										<span className="import-field-label">Quality</span>
										{instaFormatType === 'audio' ? (
											<select
												className="import-select"
												disabled={isDownloading}
												aria-label="Audio quality"
												value="320"
												onChange={() => {}}
											>
												<option value="320">MP3 · 320 kbps (Best Quality)</option>
											</select>
										) : (
											<select
												className="import-select"
												value={instaQuality}
												onChange={(e) => setInstaQuality(e.target.value as VideoQuality)}
												disabled={isDownloading}
												aria-label="Video quality"
											>
												<option value="best">Best Available (Highest)</option>
												<option value="1080">1080p (Full HD)</option>
												<option value="720">720p (HD)</option>
												<option value="480">480p (Standard)</option>
												<option value="360">360p</option>
											</select>
										)}
									</div>
								</div>
							)}

							{/* 1-Click Download & Device Backup Toggle */}
							<label className="import-device-backup-card">
								<input
									type="checkbox"
									className="import-device-backup-checkbox"
									checked={saveInstaToComputer}
									onChange={(e) => setSaveInstaToComputer(e.target.checked)}
									disabled={isDownloading}
								/>
								<div className="import-device-backup-text">
									<span className="import-device-backup-title">
										1-Click Download: Also save copy to Computer (Downloads)
									</span>
									<span className="import-device-backup-sub">
										Keeps the video or photo safely on your hard drive so it won't be lost when
										opening this project on other devices.
									</span>
								</div>
							</label>

							{/* Active Download Progress */}
							{isDownloading && (
								<div
									className="import-progress-box"
									role="progressbar"
									aria-valuenow={downloadProgress ?? undefined}
									aria-valuemin={0}
									aria-valuemax={100}
								>
									<div className="import-progress-header">
										<div className="import-progress-status">
											<div className="import-spinner" />
											<span>{downloadProgressText}</span>
										</div>
										{downloadProgress !== null && (
											<span className="import-progress-percent">{downloadProgress}%</span>
										)}
									</div>
									<div className="import-progress-bar">
										{downloadProgress !== null ? (
											<div
												className="import-progress-bar-fill"
												style={{ width: `${downloadProgress}%` }}
											/>
										) : (
											<div className="import-progress-bar-inner" />
										)}
									</div>
								</div>
							)}

							{/* Error Banner */}
							{errorMessage && (
								<div className="import-error-banner" role="alert">
									<span aria-hidden="true">⚠️</span>
									<span>{errorMessage}</span>
								</div>
							)}

							{/* Success Banner */}
							{successMessage && (
								<div className="import-success-banner" role="status">
									<span aria-hidden="true">✓</span>
									<span>{successMessage}</span>
								</div>
							)}

							<div className="import-dialog-actions">
								{isDownloading ? (
									<button type="button" className="secondary-button" onClick={cancelDownload}>
										Cancel Download
									</button>
								) : (
									<>
										<button type="button" className="secondary-button" onClick={close}>
											Cancel
										</button>
										<button
											type="button"
											className="secondary-button"
											disabled={!instaUrl.trim()}
											onClick={(e) => void handleInstagramDownload(e, true)}
											title="Download file to computer only"
										>
											Save to Computer Only
										</button>
										<button
											type="submit"
											className="primary-button"
											disabled={!instaUrl.trim() || !project}
											title="1-Click download and import into project"
										>
											Download & Import (1-Click)
										</button>
									</>
								)}
							</div>
						</form>
					)}
				</div>
			</div>
		</dialog>
	);
}
