import {
	useEffect,
	useRef,
	useState,
	type MouseEvent,
	type SyntheticEvent,
	type ChangeEvent
} from 'react';
import { useEditorStore } from '../../state/EditorProvider';
import { isRootSequence } from '../../core/sequences/access';
import { ASPECT_RATIO_PRESETS, findMatchingPreset } from '../../core/aspectRatio';

export default function SequenceSettingsDialog() {
	const open = useEditorStore((state) => state.isSequenceSettingsDialogOpen);
	const targetSeqId = useEditorStore((state) => state.sequenceSettingsDialogId);
	const project = useEditorStore((state) => state.project);
	const close = useEditorStore((state) => state.closeSequenceSettingsDialog);
	const updateSettings = useEditorStore((state) => state.updateSequenceSettings);

	const isRoot = !targetSeqId || isRootSequence(targetSeqId);
	const seq = (!isRoot && targetSeqId && project?.sequences?.[targetSeqId]) || null;
	const currentSettings = seq?.settings ?? project?.settings;

	const [inheritFromProject, setInheritFromProject] = useState<boolean>(!seq?.settings && !isRoot);
	const [width, setWidth] = useState<number>(1920);
	const [height, setHeight] = useState<number>(1080);
	const [fps, setFps] = useState<number>(30);
	const [sampleRate, setSampleRate] = useState<number>(48000);

	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		if (open && currentSettings) {
			setInheritFromProject(!seq?.settings && !isRoot);
			setWidth(currentSettings.width ?? 1920);
			setHeight(currentSettings.height ?? 1080);
			setFps(currentSettings.fps ?? 30);
			setSampleRate(currentSettings.sampleRate ?? 48000);
		}
	}, [open, currentSettings, seq, isRoot]);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
		}
		if (!open && dialog.open) {
			dialog.close();
		}
	}, [open]);

	function handleBackdropClick(e: MouseEvent<HTMLDialogElement>) {
		if (e.target === dialogRef.current) {
			close();
		}
	}

	function handleSave(e: SyntheticEvent) {
		e.preventDefault();
		if (!targetSeqId) return;

		if (isRoot) {
			updateSettings(targetSeqId, {
				width,
				height,
				fps,
				sampleRate
			});
		} else if (inheritFromProject) {
			// Clear custom settings to inherit from root
			updateSettings(targetSeqId, undefined);
		} else {
			updateSettings(targetSeqId, {
				width,
				height,
				fps,
				sampleRate
			});
		}
		close();
	}

	if (!open) return null;

	const sequenceName = isRoot
		? (project?.name ?? 'Main Timeline')
		: (seq?.name ?? 'Nested Sequence');

	const matchingPreset = findMatchingPreset(width, height);
	const currentPresetId = matchingPreset?.id ?? 'custom';

	function handlePresetChange(e: ChangeEvent<HTMLSelectElement>) {
		const selectedId = e.target.value;
		if (selectedId === 'custom') return;
		const preset = ASPECT_RATIO_PRESETS.find((item) => item.id === selectedId);
		if (preset) {
			setWidth(preset.width);
			setHeight(preset.height);
		}
	}

	return (
		<dialog
			ref={dialogRef}
			className="editor-dialog sequence-settings-dialog"
			onClick={handleBackdropClick}
			onClose={close}
			aria-labelledby="seq-settings-title"
			style={{ width: 'min(460px, 94vw)', maxWidth: '460px' }}
		>
			<form className="dialog-content" onSubmit={handleSave}>
				<div className="dialog-heading">
					<div>
						<p className="dialog-eyebrow">SEQUENCE</p>
						<h2 id="seq-settings-title">Sequence Settings: {sequenceName}</h2>
					</div>
					<button
						type="button"
						className="icon-button dialog-close"
						onClick={close}
						aria-label="Close"
					>
						✕
					</button>
				</div>

				{!isRoot && (
					<label
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '8px',
							fontSize: '12px',
							color: '#cbd5e1',
							cursor: 'pointer'
						}}
					>
						<input
							type="checkbox"
							checked={inheritFromProject}
							onChange={(e) => setInheritFromProject(e.target.checked)}
							data-testid="inherit-settings-checkbox"
							style={{ accentColor: '#38bdf8', width: '15px', height: '15px' }}
						/>
						<span>Inherit resolution and frame rate from main project</span>
					</label>
				)}

				<fieldset
					disabled={!isRoot && inheritFromProject}
					style={{
						border: 'none',
						padding: 0,
						margin: 0,
						display: 'flex',
						flexDirection: 'column',
						gap: '12px',
						opacity: !isRoot && inheritFromProject ? 0.45 : 1
					}}
				>
					<label className="dialog-field">
						<span>Aspect Ratio Preset</span>
						<select
							value={currentPresetId}
							onChange={handlePresetChange}
							data-testid="seq-aspect-ratio-select"
						>
							{ASPECT_RATIO_PRESETS.map((p) => (
								<option key={p.id} value={p.id}>
									{p.label}
								</option>
							))}
							<option value="custom">Custom</option>
						</select>
					</label>

					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
						<label className="dialog-field">
							<span>Width (px)</span>
							<input
								type="number"
								min="16"
								max="7680"
								step="2"
								value={width}
								onChange={(e) => setWidth(Math.max(16, Number(e.target.value) || 16))}
								data-testid="seq-width-input"
							/>
						</label>

						<label className="dialog-field">
							<span>Height (px)</span>
							<input
								type="number"
								min="16"
								max="4320"
								step="2"
								value={height}
								onChange={(e) => setHeight(Math.max(16, Number(e.target.value) || 16))}
								data-testid="seq-height-input"
							/>
						</label>
					</div>

					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
						<label className="dialog-field">
							<span>Frame Rate (fps)</span>
							<select
								value={fps}
								onChange={(e) => setFps(Number(e.target.value))}
								data-testid="seq-fps-select"
							>
								<option value="24">24 fps (Cinema)</option>
								<option value="25">25 fps (PAL)</option>
								<option value="30">30 fps (Standard)</option>
								<option value="50">50 fps</option>
								<option value="60">60 fps (Smooth)</option>
							</select>
						</label>

						<label className="dialog-field">
							<span>Sample Rate (Hz)</span>
							<select
								value={sampleRate}
								onChange={(e) => setSampleRate(Number(e.target.value))}
								data-testid="seq-samplerate-select"
							>
								<option value="44100">44,100 Hz (CD)</option>
								<option value="48000">48,000 Hz (Pro Video)</option>
							</select>
						</label>
					</div>
				</fieldset>

				<div className="dialog-actions">
					<button type="button" className="secondary-button" onClick={close}>
						Cancel
					</button>
					<button type="submit" className="primary-button" data-testid="seq-settings-save-button">
						Apply Settings
					</button>
				</div>
			</form>
		</dialog>
	);
}
