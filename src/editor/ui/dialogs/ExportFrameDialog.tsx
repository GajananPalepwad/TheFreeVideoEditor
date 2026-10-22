import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { ticksToTimecode } from '../../core/time';
import { saveFile, type SaveFileType } from '../../services/storage/fileAccess';
import { useEditorStore } from '../../state/EditorProvider';

type ImageFormat = 'png' | 'jpeg' | 'webp';

export default function ExportFrameDialog() {
	const open = useEditorStore((state) => state.isExportFrameDialogOpen);
	const close = useEditorStore((state) => state.closeExportFrameDialog);
	const project = useEditorStore((state) => state.project);
	const playhead = useEditorStore((state) => state.timeline.playhead);

	const [format, setFormat] = useState<ImageFormat>('png');
	const [quality, setQuality] = useState<number>(0.92);
	const [filename, setFilename] = useState<string>('');
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState<boolean>(false);

	const dialogRef = useRef<HTMLDialogElement>(null);
	const filenameInputRef = useRef<HTMLInputElement>(null);

	// Synchronize frame preview and initial filename when dialog opens
	useEffect(() => {
		if (!open || !project) {
			setPreviewUrl(null);
			return;
		}

		const fps = project.settings.fps || 30;
		const tcStr = ticksToTimecode(playhead, fps).replace(/:/g, '-');
		const safeProjectName = project.name.trim().replace(/[^\w-]/g, '_') || 'frame';
		setFilename(`${safeProjectName}_${tcStr}`);

		const canvas = document.querySelector<HTMLCanvasElement>(
			'canvas[data-testid="preview-canvas"]'
		);
		if (canvas && canvas.width > 0 && canvas.height > 0) {
			try {
				const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
				setPreviewUrl(dataUrl);
			} catch {
				setPreviewUrl(null);
			}
		}
	}, [open, project, playhead]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			filenameInputRef.current?.select();
			filenameInputRef.current?.focus();
		}
		if (!open && dialog.open) {
			dialog.close();
		}
	}, [open]);

	async function handleSubmit(event: SyntheticEvent) {
		event.preventDefault();
		if (!project || isSaving) return;

		const canvas = document.querySelector<HTMLCanvasElement>(
			'canvas[data-testid="preview-canvas"]'
		);
		if (!canvas) {
			close();
			return;
		}

		setIsSaving(true);
		try {
			const mimeType =
				format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
			const ext = format === 'jpeg' ? 'jpg' : format;
			const safeBaseName = filename.trim().replace(/[^\w-]/g, '_') || 'frame';
			const outputName = `${safeBaseName}.${ext}`;

			const blob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob(resolve, mimeType, format === 'png' ? undefined : quality);
			});

			if (blob) {
				const types: SaveFileType[] = [
					{
						description: `${format.toUpperCase()} Image`,
						accept: { [mimeType]: [`.${ext}`] }
					}
				];
				await saveFile(blob, outputName, types);
			}
			close();
		} finally {
			setIsSaving(false);
		}
	}

	if (!project) return null;

	const fps = project.settings.fps || 30;
	const timecode = ticksToTimecode(playhead, fps);

	return (
		<dialog
			ref={dialogRef}
			className="editor-dialog export-frame-dialog"
			aria-labelledby="export-frame-title"
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
			onClick={(event: MouseEvent<HTMLDialogElement>) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<form className="dialog-content" onSubmit={handleSubmit} style={{ minWidth: '22rem' }}>
				<div className="dialog-heading">
					<div>
						<p className="dialog-eyebrow">STILL FRAME</p>
						<h2 id="export-frame-title">Export Frame</h2>
					</div>
					<button
						className="icon-button dialog-close"
						type="button"
						aria-label="Close export frame dialog"
						onClick={close}
					>
						×
					</button>
				</div>

				<div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
					{previewUrl && (
						<div
							style={{
								width: '100%',
								maxHeight: '160px',
								borderRadius: 'var(--radius-sm)',
								overflow: 'hidden',
								backgroundColor: 'var(--color-canvas-sunken, #000)',
								border: '1px solid var(--color-hairline, rgba(255,255,255,0.1))',
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center'
							}}
						>
							<img
								src={previewUrl}
								alt="Captured frame preview"
								style={{ maxWidth: '100%', maxHeight: '160px', objectFit: 'contain' }}
							/>
						</div>
					)}

					<div
						style={{
							fontSize: 'var(--text-body-sm)',
							color: 'var(--color-mute)',
							display: 'flex',
							justifyContent: 'space-between'
						}}
					>
						<span>
							Resolution: {project.settings.width} × {project.settings.height}
						</span>
						<span style={{ fontFamily: 'var(--font-mono)' }}>{timecode}</span>
					</div>

					<label
						className="dialog-field"
						style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
					>
						<span>Format</span>
						<select
							value={format}
							aria-label="Image format"
							style={{ width: '8rem' }}
							onChange={(e) => setFormat(e.currentTarget.value as ImageFormat)}
						>
							<option value="png">PNG (Lossless)</option>
							<option value="jpeg">JPEG</option>
							<option value="webp">WebP</option>
						</select>
					</label>

					{format !== 'png' && (
						<label
							className="dialog-field"
							style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
						>
							<span>Quality</span>
							<div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
								<input
									type="range"
									min="0.5"
									max="1"
									step="0.01"
									value={quality}
									aria-label="Image quality"
									style={{ width: '6rem' }}
									onChange={(e) => setQuality(parseFloat(e.currentTarget.value))}
								/>
								<span
									style={{ width: '2.5rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}
								>
									{Math.round(quality * 100)}%
								</span>
							</div>
						</label>
					)}

					<label
						className="dialog-field"
						style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xxs)' }}
					>
						<span>File Name</span>
						<input
							ref={filenameInputRef}
							type="text"
							value={filename}
							aria-label="File name"
							required
							onChange={(e) => setFilename(e.currentTarget.value)}
						/>
					</label>
				</div>

				<div className="dialog-actions">
					<button type="button" className="secondary-button" onClick={close} disabled={isSaving}>
						Cancel
					</button>
					<button type="submit" className="primary-button" disabled={!filename.trim() || isSaving}>
						{isSaving ? 'Exporting…' : 'Export'}
					</button>
				</div>
			</form>
		</dialog>
	);
}
