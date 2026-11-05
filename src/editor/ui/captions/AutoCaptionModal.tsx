import { useState, useRef, useEffect } from 'react';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { localSttService } from '../../services/captions/sttService';
import { segmentWords } from '../../core/captions/segmentation';
import {
	STT_MODELS,
	type SttProgressEvent,
	type SttModelMetadata
} from '../../services/captions/sttProtocol';
import { trackFeatureUsed } from '../../../services/activityTracking';
import './captions.css';

export interface AutoCaptionModalProps {
	open: boolean;
	onClose: () => void;
	initialSource?: 'all' | 'selected' | 'range';
}

export function AutoCaptionModal({ open, onClose, initialSource = 'all' }: AutoCaptionModalProps) {
	const store = useEditorStoreApi();
	const project = useEditorStore((state) => state.project);
	const selection = useEditorStore((state) => state.timeline.selection);

	const [status, setStatus] = useState<SttProgressEvent>({
		phase: 'idle',
		progress: 0,
		message: ''
	});
	const [isRunning, setIsRunning] = useState(false);
	const [audioSource, setAudioSource] = useState<'all' | 'selected' | 'range'>(initialSource);
	const [selectedTrackId, setSelectedTrackId] = useState<string>('all');
	const [selectedModelId, setSelectedModelId] = useState<string>('whisper-tiny.en');
	const [language, setLanguage] = useState<string>('auto');
	const [task, setTask] = useState<'transcribe' | 'translate'>('transcribe');
	const [hardwareMode, setHardwareMode] = useState<'webgpu' | 'wasm'>('webgpu');
	const [installedModels, setInstalledModels] = useState<string[]>([]);
	const [hasWebGpu, setHasWebGpu] = useState(false);
	const [activeTab, setActiveTab] = useState<'transcribe' | 'models'>('transcribe');

	// Consent state
	const [consentGranted, setConsentGranted] = useState(() => {
		try {
			if (typeof localStorage !== 'undefined') {
				return localStorage.getItem('tfve_stt_consent') === 'true';
			}
		} catch {}
		return false;
	});

	const abortControllerRef = useRef<AbortController | null>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			setStatus({ phase: 'idle', progress: 0, message: '' });
			// Query hardware & installed models
			void localSttService.checkHardwareSupport().then((sup) => {
				setHasWebGpu(sup.hasWebGpu);
				if (!sup.hasWebGpu) setHardwareMode('wasm');
			});
			void localSttService.listInstalledModels().then((models) => {
				setInstalledModels(models);
			});
		} else if (!open && dialog.open) {
			dialog.close();
		}
	}, [open]);

	const selectedModel: SttModelMetadata =
		STT_MODELS[selectedModelId] ?? STT_MODELS['whisper-tiny.en']!;
	const audioTracks = (project?.tracks ?? []).filter(
		(t) => t.kind === 'audio' || t.kind === 'video'
	);

	const handleGrantConsentAndDownload = () => {
		setConsentGranted(true);
		try {
			if (typeof localStorage !== 'undefined') {
				localStorage.setItem('tfve_stt_consent', 'true');
			}
		} catch {}
	};

	const handleDeleteModel = async (modelId: string) => {
		const updated = await localSttService.deleteModel(modelId);
		setInstalledModels(updated);
	};

	const handleStart = async () => {
		if (!project) return;
		setIsRunning(true);
		const controller = new AbortController();
		abortControllerRef.current = controller;
		trackFeatureUsed('auto_caption', {
			model: selectedModelId,
			language,
			hardware: hardwareMode
		});

		try {
			// Check for selected clips or range
			const clipIds = audioSource === 'selected' ? selection.clipIds : undefined;

			const words = await localSttService.transcribeProject(project, {
				trackId: selectedTrackId === 'all' ? undefined : selectedTrackId,
				clipIds,
				modelId: selectedModelId,
				language,
				task,
				useWebGpu: hardwareMode === 'webgpu',
				signal: controller.signal,
				onProgress: (evt) => {
					setStatus(evt);
				}
			});

			if (words.length === 0) {
				setStatus({
					phase: 'completed',
					progress: 1.0,
					message: 'No speech recognized in the selected audio range.'
				});
				return;
			}

			// Segment words into non-overlapping caption cues
			const segments = segmentWords(words, {
				maxLines: 2,
				maxCharsPerLine: 40,
				maxDurationUs: 4_500_000
			});

			if (segments.length > 0) {
				const capTrackId = store.getState().addCaptionSegmentsBulk(
					segments.map((seg) => ({
						start: seg.start,
						end: seg.end,
						text: seg.text,
						words: seg.words
					})),
					'Auto Captions'
				);

				if (capTrackId) {
					store.getState().selectCaption(capTrackId, segments[0]?.id);
				}
			}

			setStatus({
				phase: 'completed',
				progress: 1.0,
				message: `Successfully generated ${segments.length} caption cues.`
			});
		} catch (err: unknown) {
			if (err instanceof DOMException && err.name === 'AbortError') {
				setStatus({ phase: 'idle', progress: 0, message: 'Transcription cancelled.' });
			} else {
				setStatus({
					phase: 'error',
					progress: 0,
					message: err instanceof Error ? err.message : 'Transcription failed.'
				});
			}
		} finally {
			setIsRunning(false);
			abortControllerRef.current = null;
		}
	};

	const handleCancel = () => {
		if (isRunning) {
			abortControllerRef.current?.abort();
		}
		onClose();
	};

	if (!open) return null;

	return (
		<dialog
			ref={dialogRef}
			className="editor-dialog auto-caption-dialog"
			style={{ width: 'min(540px, 94vw)', maxWidth: '540px' }}
		>
			<div className="dialog-content">
				{/* Header */}
				<div className="dialog-header auto-caption-header">
					<div>
						<h2 className="auto-caption-title">Local AI Speech-to-Text</h2>
						<p className="auto-caption-subtitle">
							Client-side speech recognition running directly on your CPU/GPU.
						</p>
					</div>

					<div className="modal-tab-group">
						<button
							type="button"
							aria-pressed={activeTab === 'transcribe'}
							className={`modal-tab-btn ${activeTab === 'transcribe' ? 'is-active' : ''}`}
							onClick={() => setActiveTab('transcribe')}
						>
							Transcribe
						</button>
						<button
							type="button"
							aria-pressed={activeTab === 'models'}
							className={`modal-tab-btn ${activeTab === 'models' ? 'is-active' : ''}`}
							onClick={() => setActiveTab('models')}
						>
							Models Manager
						</button>
					</div>
				</div>

				{/* Privacy guarantee banner */}
				<div className="auto-caption-privacy-banner">
					<span className="auto-caption-privacy-badge">🔒 100% Private:</span>
					<span>
						All audio processing and speech-to-text inference run locally in your browser. Audio
						never leaves your device. Only the one-time model weight download touches the network.
					</span>
				</div>

				{/* TAB 1: MODELS MANAGER */}
				{activeTab === 'models' && (
					<div className="auto-caption-models-list">
						<h3 className="auto-caption-models-title">Available AI Models & Local Storage Cache</h3>

						{Object.values(STT_MODELS).map((model) => (
							<div key={model.id} className="auto-caption-model-item">
								<div>
									<div className="auto-caption-model-name">
										{model.name}{' '}
										<span
											className={`auto-caption-cache-status ${
												installedModels.some((m) => m.includes(model.id))
													? 'is-cached'
													: 'is-uncached'
											}`}
										>
											(
											{installedModels.some((m) => m.includes(model.id))
												? 'Cached'
												: 'Not downloaded'}
											)
										</span>
									</div>
									<div className="auto-caption-model-meta">
										Size: {model.sizeLabel} · License: {model.license}
									</div>
								</div>

								<div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
									<button
										type="button"
										className="secondary-button"
										style={{
											height: '28px',
											minHeight: '28px',
											fontSize: '11.5px',
											padding: '0 10px'
										}}
										onClick={() => void handleDeleteModel(model.id)}
										title="Delete downloaded model from browser cache"
										disabled={!installedModels.some((m) => m.includes(model.id))}
									>
										Clear Cache
									</button>
								</div>
							</div>
						))}
					</div>
				)}

				{/* TAB 2: TRANSCRIBE & CONSENT */}
				{activeTab === 'transcribe' && (
					<>
						{!consentGranted ? (
							/* Consent Dialog Flow */
							<div
								className="auto-caption-consent-box"
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: '12px',
									padding: '14px',
									border: '1px solid #0284c7',
									borderRadius: '8px'
								}}
							>
								<h3
									style={{
										margin: 0,
										fontSize: '0.95rem',
										fontWeight: 600,
										color: '#f1f5f9'
									}}
								>
									Model Download Consent
								</h3>
								<p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8' }}>
									Speech recognition requires downloading the on-device AI model weights (
									{selectedModel.sizeLabel}) from Hugging Face (ONNX Community / MIT License).
								</p>
								<div style={{ fontSize: '0.78rem', color: '#64748b' }}>
									• Source: {selectedModel.hfModelId}
									<br />
									• Execution: Client-side WebGPU / WASM
									<br />• Once downloaded, speech recognition operates completely offline.
								</div>
								<div
									style={{
										display: 'flex',
										justifyContent: 'flex-end',
										gap: '8px',
										marginTop: '6px'
									}}
								>
									<button type="button" className="secondary-button" onClick={onClose}>
										Cancel
									</button>
									<button
										type="button"
										className="primary-button"
										onClick={handleGrantConsentAndDownload}
									>
										Download & Enable Local AI
									</button>
								</div>
							</div>
						) : (
							/* Standard Transcription Setup */
							<div className="auto-caption-form">
								{/* Model Selector */}
								<div className="auto-caption-field">
									<label className="auto-caption-label">Model</label>
									<select
										className="auto-caption-select"
										disabled={isRunning}
										value={selectedModelId}
										onChange={(e) => setSelectedModelId(e.target.value)}
									>
										{Object.values(STT_MODELS).map((m) => (
											<option key={m.id} value={m.id}>
												{m.name} ({m.sizeLabel})
											</option>
										))}
									</select>
									<span className="auto-caption-hint">
										{selectedModel.description} (License: {selectedModel.license})
									</span>
								</div>

								{/* Audio Source */}
								<div className="auto-caption-field">
									<label className="auto-caption-label">Audio Source</label>
									<div className="auto-caption-row">
										<select
											className="auto-caption-select"
											style={{ flex: 1 }}
											disabled={isRunning}
											value={audioSource}
											onChange={(e) =>
												setAudioSource(e.target.value as 'all' | 'selected' | 'range')
											}
										>
											<option value="all">Entire Sequence Mix</option>
											<option value="selected">Selected Clips ({selection.clipIds.length})</option>
										</select>

										{audioSource === 'all' && (
											<select
												className="auto-caption-select"
												style={{ flex: 1 }}
												disabled={isRunning}
												value={selectedTrackId}
												onChange={(e) => setSelectedTrackId(e.target.value)}
											>
												<option value="all">All Tracks</option>
												{audioTracks.map((t, i) => (
													<option key={t.id} value={t.id}>
														{t.name || `Track ${i + 1}`}
													</option>
												))}
											</select>
										)}
									</div>
								</div>

								{/* Language & Task */}
								<div className="auto-caption-grid-2">
									<div className="auto-caption-field">
										<label className="auto-caption-label">Language</label>
										<select
											className="auto-caption-select"
											disabled={isRunning}
											value={language}
											onChange={(e) => setLanguage(e.target.value)}
										>
											<option value="auto">Auto-Detect</option>
											<option value="en">English</option>
											<option value="es">Spanish</option>
											<option value="fr">French</option>
											<option value="de">German</option>
											<option value="ja">Japanese</option>
											<option value="zh">Chinese</option>
										</select>
									</div>

									<div className="auto-caption-field">
										<label className="auto-caption-label">Task</label>
										<select
											className="auto-caption-select"
											disabled={isRunning}
											value={task}
											onChange={(e) => setTask(e.target.value as 'transcribe' | 'translate')}
										>
											<option value="transcribe">Transcribe</option>
											<option value="translate">Translate to English</option>
										</select>
									</div>
								</div>

								{/* Hardware Engine Mode */}
								<div className="auto-caption-field">
									<label className="auto-caption-label">Engine Runtime</label>
									<select
										className="auto-caption-select"
										disabled={isRunning}
										value={hardwareMode}
										onChange={(e) => setHardwareMode(e.target.value as 'webgpu' | 'wasm')}
									>
										<option value="webgpu" disabled={!hasWebGpu}>
											WebGPU (Hardware Accelerated) {!hasWebGpu ? '(Unavailable)' : ''}
										</option>
										<option value="wasm">WASM CPU Fallback (Universal)</option>
									</select>
								</div>
							</div>
						)}
					</>
				)}

				{/* Progress & Status */}
				{status.message && (
					<div
						className={`auto-caption-status-box ${
							status.phase === 'error'
								? 'is-error'
								: status.phase === 'completed'
									? 'is-complete'
									: ''
						}`}
						aria-live="polite"
					>
						<div className="auto-caption-status-header">
							<span>{status.message}</span>
							<span>{Math.round(status.progress * 100)}%</span>
						</div>
						{isRunning && (
							<progress
								max={100}
								value={Math.round(status.progress * 100)}
								className="auto-caption-progress-bar"
							/>
						)}
						{status.speedBytesPerSec && status.speedBytesPerSec > 0 && (
							<span className="auto-caption-speed">
								Speed: {(status.speedBytesPerSec / 1_000_000).toFixed(1)} MB/s
							</span>
						)}
					</div>
				)}

				{/* Modal Footer Actions */}
				<div className="dialog-actions">
					<button type="button" className="secondary-button" onClick={handleCancel}>
						{status.phase === 'completed' ? 'Done' : isRunning ? 'Cancel' : 'Close'}
					</button>

					{consentGranted && activeTab === 'transcribe' && status.phase !== 'completed' && (
						<button
							type="button"
							className="primary-button"
							disabled={isRunning}
							onClick={() => void handleStart()}
						>
							{isRunning ? 'Transcribing…' : 'Start Auto-Caption'}
						</button>
					)}
				</div>
			</div>
		</dialog>
	);
}
