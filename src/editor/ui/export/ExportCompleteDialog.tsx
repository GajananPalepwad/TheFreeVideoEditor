import { useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '../../state/EditorProvider';
import { saveFile } from '../../services/storage/fileAccess';
import type { SaveFileType } from '../../services/storage/fileAccess';
import { ExportFeedbackCard } from './ExportFeedbackCard';
import './export-complete-dialog.css';

function formatBytes(bytes?: number): string {
	if (!bytes || bytes <= 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds?: number): string {
	if (!seconds || seconds <= 0) return '';
	const rounded = Math.round(seconds);
	const mins = Math.floor(rounded / 60);
	const secs = rounded % 60;
	if (mins < 60) {
		return `${mins}:${secs.toString().padStart(2, '0')}`;
	}
	const hrs = Math.floor(mins / 60);
	const remMins = mins % 60;
	return `${hrs}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

const CONFETTI_PARTICLES = [
	{ tx: '-60px', ty: '-80px', rot: '45deg', color: '#38bdf8', size: '7px' },
	{ tx: '65px', ty: '-75px', rot: '-35deg', color: '#34d399', size: '6px' },
	{ tx: '-90px', ty: '-35px', rot: '60deg', color: '#a855f7', size: '8px' },
	{ tx: '95px', ty: '-40px', rot: '-50deg', color: '#38bdf8', size: '7px' },
	{ tx: '-110px', ty: '15px', rot: '30deg', color: '#f43f5e', size: '6px' },
	{ tx: '115px', ty: '10px', rot: '-25deg', color: '#34d399', size: '8px' },
	{ tx: '-80px', ty: '65px', rot: '70deg', color: '#fbbf24', size: '6px' },
	{ tx: '85px', ty: '60px', rot: '-65deg', color: '#a855f7', size: '7px' },
	{ tx: '-40px', ty: '85px', rot: '20deg', color: '#38bdf8', size: '8px' },
	{ tx: '45px', ty: '90px', rot: '-15deg', color: '#34d399', size: '6px' },
	{ tx: '-15px', ty: '-100px', rot: '-40deg', color: '#f43f5e', size: '7px' },
	{ tx: '20px', ty: '-95px', rot: '55deg', color: '#fbbf24', size: '8px' }
];

export default function ExportCompleteDialog() {
	const result = useEditorStore((state) => state.exportCompletedResult);
	const close = useEditorStore((state) => state.closeExportCompleteDialog);
	const openExportDialog = useEditorStore((state) => state.openExportDialog);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const doneBtnRef = useRef<HTMLButtonElement>(null);

	const previewUrl = useMemo(() => {
		if (!result?.blob) return null;
		return URL.createObjectURL(result.blob);
	}, [result?.blob]);

	useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [previewUrl]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;

		if (result && !dialog.open) {
			dialog.showModal();
			window.requestAnimationFrame(() => {
				doneBtnRef.current?.focus();
			});
		} else if (!result && dialog.open) {
			dialog.close();
		}
	}, [result]);

	const isVideo = result?.format === 'MP4' || result?.format === 'WEBM' || result?.format === 'MOV';
	const isAudio = result?.format === 'WAV';

	const handleClose = () => {
		const dialog = dialogRef.current;
		if (dialog?.open) {
			dialog.close();
		}
		close();
	};

	const handleSaveAgain = async () => {
		if (!result?.blob) return;
		const mimeType = isVideo
			? result.format === 'MP4'
				? 'video/mp4'
				: result.format === 'MOV'
					? 'video/quicktime'
					: 'video/webm'
			: isAudio
				? 'audio/wav'
				: 'application/octet-stream';

		const types: SaveFileType[] = [
			{
				description: `${result.format} File`,
				accept: { [mimeType]: [`.${result.format.toLowerCase()}`] }
			}
		];
		await saveFile(result.blob, result.filename, types);
	};

	const handleExportAnother = () => {
		const dialog = dialogRef.current;
		if (dialog?.open) {
			dialog.close();
		}
		close();
		window.requestAnimationFrame(() => {
			openExportDialog();
		});
	};

	return (
		<dialog
			ref={dialogRef}
			className="editor-dialog export-complete-dialog"
			aria-labelledby="export-complete-title"
			aria-describedby="export-complete-subtitle"
			onCancel={(e) => {
				e.preventDefault();
				handleClose();
			}}
			onClick={(e) => {
				if (e.target === dialogRef.current) {
					handleClose();
				}
			}}
		>
			{result && (
				<div className="export-complete-container">
					{/* Top-right close button */}
					<button
						type="button"
						className="export-complete-close-btn"
						aria-label="Close dialog"
						onClick={handleClose}
					>
						<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
							<path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
						</svg>
					</button>

					{/* Confetti particles burst */}
					<div className="export-confetti-wrap" aria-hidden="true">
						{CONFETTI_PARTICLES.map((p, idx) => (
							<div
								key={idx}
								className="export-confetti-particle"
								style={
									{
										'--tx': p.tx,
										'--ty': p.ty,
										'--rot': p.rot,
										backgroundColor: p.color,
										width: p.size,
										height: p.size,
										animationDelay: `${idx * 0.03}s`
									} as React.CSSProperties
								}
							/>
						))}
					</div>

					{/* Celebration Badge with Animated Checkmark */}
					<div className="export-complete-badge-wrap">
						<div className="export-complete-pulse-ring" aria-hidden="true" />
						<div className="export-complete-badge">
							<svg
								className="export-complete-check-icon"
								viewBox="0 0 24 24"
								width="36"
								height="36"
								fill="none"
								stroke="currentColor"
								strokeWidth="3"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</div>
					</div>

					{/* Headings */}
					<div className="export-complete-header">
						<h2 id="export-complete-title" className="export-complete-title">
							Export Complete!
						</h2>
						<p id="export-complete-subtitle" className="export-complete-subtitle">
							Your {result.format} file is ready to share.
						</p>
					</div>

					{/* Interactive Video or Audio Preview Player */}
					{previewUrl && isVideo && (
						<div className="export-complete-video-container">
							<video
								src={previewUrl}
								controls
								playsInline
								preload="metadata"
								title={result.filename}
							/>
						</div>
					)}

					{previewUrl && isAudio && (
						<div className="export-complete-audio-container">
							<audio src={previewUrl} controls preload="metadata" />
						</div>
					)}

					{/* Specifications Card */}
					<div className="export-complete-meta-card">
						<div className="export-complete-file-row">
							<svg
								className="export-complete-file-icon"
								viewBox="0 0 16 16"
								width="16"
								height="16"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z" />
							</svg>
							<span className="export-complete-filename">{result.filename}</span>
						</div>

						<div className="export-complete-specs-row">
							<span className="export-complete-spec-pill highlight">{result.format}</span>
							{result.width && result.height && (
								<span className="export-complete-spec-pill">
									{result.width} × {result.height}
								</span>
							)}
							{result.fps && <span className="export-complete-spec-pill">{result.fps} fps</span>}
							{result.fileSizeBytes && (
								<span className="export-complete-spec-pill highlight">
									{formatBytes(result.fileSizeBytes)}
								</span>
							)}
							{result.durationSec && (
								<span className="export-complete-spec-pill">
									{formatDuration(result.durationSec)}
								</span>
							)}
						</div>
					</div>

					{/* Warnings or Notices if any */}
					{result.warnings && result.warnings.length > 0 && (
						<div className="export-complete-notice" role="status">
							<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
								<path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
							</svg>
							<span>{result.warnings.join(' ')}</span>
						</div>
					)}

					{/* Post-Export Feedback */}
					<ExportFeedbackCard />

					{/* Action Buttons */}
					<div className="export-complete-actions">
						<button type="button" className="secondary-button" onClick={handleExportAnother}>
							Export Another
						</button>

						{result.blob && (
							<button
								type="button"
								className="secondary-button"
								onClick={handleSaveAgain}
								title="Download file again"
							>
								<svg
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									className="export-complete-btn-icon"
								>
									<path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
									<path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z" />
								</svg>
								<span>Save Copy</span>
							</button>
						)}

						<button
							ref={doneBtnRef}
							type="button"
							className="primary-button export-complete-done-btn"
							onClick={handleClose}
						>
							<svg
								viewBox="0 0 16 16"
								width="14"
								height="14"
								fill="currentColor"
								className="export-complete-btn-icon"
							>
								<path d="M12.736 3.97a.733.733 0 0 1 1.047 0c.286.289.29.756.01 1.05L7.88 12.01a.733.733 0 0 1-1.065.02L3.217 8.384a.757.757 0 0 1 0-1.06.733.733 0 0 1 1.047 0l3.052 3.093 5.4-6.425a.247.247 0 0 1 .02-.022Z" />
							</svg>
							<span>Done</span>
						</button>
					</div>
				</div>
			)}
		</dialog>
	);
}
