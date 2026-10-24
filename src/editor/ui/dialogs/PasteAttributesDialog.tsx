import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { PasteAttributesOptions } from '../../core/operations/clipAttributes';
import { useEditorStore } from '../../state/EditorProvider';

export default function PasteAttributesDialog() {
	const isOpen = useEditorStore((state) => state.isPasteAttributesOpen);
	const payload = useEditorStore((state) => state.attributesClipboard);
	const targetClipIds = useEditorStore((state) => state.timeline.selection.clipIds);
	const close = useEditorStore((state) => state.closePasteAttributesDialog);
	const pasteAttributes = useEditorStore((state) => state.pasteAttributes);

	const hasTransform = Boolean(payload?.transform);
	const hasCrop = Boolean(payload?.crop);
	const hasColorGrading = Boolean(payload?.colorGrading?.effects.length);
	const hasVideoEffects = Boolean(payload?.videoEffects?.effects.length);
	const hasAudio = Boolean(payload?.audio);

	const [options, setOptions] = useState<PasteAttributesOptions>({
		transform: true,
		crop: true,
		colorGrading: true,
		videoEffects: true,
		audio: true
	});

	const dialogRef = useRef<HTMLDialogElement>(null);
	const firstCheckboxRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (isOpen) {
			setOptions({
				transform: hasTransform,
				crop: hasCrop,
				colorGrading: hasColorGrading,
				videoEffects: hasVideoEffects,
				audio: hasAudio
			});
		}
	}, [isOpen, hasTransform, hasCrop, hasColorGrading, hasVideoEffects, hasAudio]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (isOpen && !dialog.open) {
			dialog.showModal();
			firstCheckboxRef.current?.focus();
		}
		if (!isOpen && dialog.open) {
			dialog.close();
		}
	}, [isOpen]);

	function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
		event.preventDefault();
		pasteAttributes(options);
	}

	const hasAnySelected = Boolean(
		options.transform ||
		options.crop ||
		options.colorGrading ||
		options.videoEffects ||
		options.audio
	);

	function selectAll(): void {
		setOptions({
			transform: hasTransform,
			crop: hasCrop,
			colorGrading: hasColorGrading,
			videoEffects: hasVideoEffects,
			audio: hasAudio
		});
	}

	function deselectAll(): void {
		setOptions({
			transform: false,
			crop: false,
			colorGrading: false,
			videoEffects: false,
			audio: false
		});
	}

	return (
		<dialog
			ref={dialogRef}
			className="editor-dialog paste-attributes-dialog"
			aria-labelledby="paste-attributes-title"
			onClose={close}
		>
			<form method="dialog" onSubmit={handleSubmit} className="dialog-content">
				<header className="dialog-heading">
					<h2 id="paste-attributes-title">Paste Attributes</h2>
					<button type="button" className="dialog-close" onClick={close} aria-label="Close dialog">
						&times;
					</button>
				</header>

				<p className="dialog-description">
					Select attributes to apply to {targetClipIds.length} target clip
					{targetClipIds.length === 1 ? '' : 's'}:
				</p>

				<div
					className="dialog-body paste-attributes-options"
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: '10px',
						margin: '12px 0 16px 0'
					}}
				>
					<label
						className="dialog-field"
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							cursor: hasTransform ? 'pointer' : 'default',
							opacity: hasTransform ? 1 : 0.6
						}}
					>
						<input
							ref={firstCheckboxRef}
							type="checkbox"
							checked={Boolean(options.transform)}
							disabled={!hasTransform}
							onChange={(e) => setOptions((prev) => ({ ...prev, transform: e.target.checked }))}
						/>
						<span>
							<strong>Transform</strong> (Position, Scale, Rotation, Opacity)
							{!hasTransform && ' — (None on source clip)'}
						</span>
					</label>

					<label
						className="dialog-field"
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							cursor: hasCrop ? 'pointer' : 'default',
							opacity: hasCrop ? 1 : 0.6
						}}
					>
						<input
							type="checkbox"
							checked={Boolean(options.crop)}
							disabled={!hasCrop}
							onChange={(e) => setOptions((prev) => ({ ...prev, crop: e.target.checked }))}
						/>
						<span>
							<strong>Crop insets</strong>
							{!hasCrop && ' — (None on source clip)'}
						</span>
					</label>

					<label
						className="dialog-field"
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							cursor: hasColorGrading ? 'pointer' : 'default',
							opacity: hasColorGrading ? 1 : 0.6
						}}
					>
						<input
							type="checkbox"
							checked={Boolean(options.colorGrading)}
							disabled={!hasColorGrading}
							onChange={(e) => setOptions((prev) => ({ ...prev, colorGrading: e.target.checked }))}
						/>
						<span>
							<strong>Color Grading</strong> (Basic, Curves, LUT)
							{!hasColorGrading && ' — (None on source clip)'}
						</span>
					</label>

					<label
						className="dialog-field"
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							cursor: hasVideoEffects ? 'pointer' : 'default',
							opacity: hasVideoEffects ? 1 : 0.6
						}}
					>
						<input
							type="checkbox"
							checked={Boolean(options.videoEffects)}
							disabled={!hasVideoEffects}
							onChange={(e) => setOptions((prev) => ({ ...prev, videoEffects: e.target.checked }))}
						/>
						<span>
							<strong>Video Effects</strong>
							{!hasVideoEffects && ' — (None on source clip)'}
						</span>
					</label>

					<label
						className="dialog-field"
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '10px',
							cursor: hasAudio ? 'pointer' : 'default',
							opacity: hasAudio ? 1 : 0.6
						}}
					>
						<input
							type="checkbox"
							checked={Boolean(options.audio)}
							disabled={!hasAudio}
							onChange={(e) => setOptions((prev) => ({ ...prev, audio: e.target.checked }))}
						/>
						<span>
							<strong>Audio Volume, Pan, and Audio Effects</strong>
							{!hasAudio && ' — (None on source clip)'}
						</span>
					</label>
				</div>

				<div
					style={{
						display: 'flex',
						gap: '8px',
						marginBottom: '16px'
					}}
				>
					<button
						type="button"
						className="secondary-button"
						style={{ fontSize: '11px', padding: '4px 8px' }}
						onClick={selectAll}
					>
						Select All
					</button>
					<button
						type="button"
						className="secondary-button"
						style={{ fontSize: '11px', padding: '4px 8px' }}
						onClick={deselectAll}
					>
						Deselect All
					</button>
				</div>

				<footer className="dialog-footer">
					<button type="button" className="cancel-button" onClick={close}>
						Cancel
					</button>
					<button type="submit" className="primary-button" disabled={!hasAnySelected}>
						Paste
					</button>
				</footer>
			</form>
		</dialog>
	);
}
