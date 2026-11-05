import React, { useState, useRef, useEffect } from 'react';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { localSttService } from '../../services/captions/sttService';
import { segmentWords } from '../../core/captions/segmentation';
import {
	STT_MODELS,
	type SttProgressEvent,
	type SttModelMetadata
} from '../../services/captions/sttProtocol';
import { trackFeatureUsed } from '../../../services/activityTracking';

export const AutoCaptionAiView: React.FC = () => {
	const store = useEditorStoreApi();
	const project = useEditorStore((state) => state.project);
	const selection = useEditorStore((state) => state.timeline.selection);

	const [status, setStatus] = useState<SttProgressEvent>({
		phase: 'idle',
		progress: 0,
		message: ''
	});
	const [isRunning, setIsRunning] = useState(false);
	const [audioSource, setAudioSource] = useState<'all' | 'selected' | 'range'>('all');
	const [selectedTrackId, setSelectedTrackId] = useState<string>('all');
	const [selectedModelId, setSelectedModelId] = useState<string>('whisper-tiny.en');
	const [language, setLanguage] = useState<string>('auto');
	const [task, setTask] = useState<'transcribe' | 'translate'>('transcribe');
	const [hardwareMode, setHardwareMode] = useState<'webgpu' | 'wasm'>('webgpu');
	const [installedModels, setInstalledModels] = useState<string[]>([]);
	const [hasWebGpu, setHasWebGpu] = useState(false);
	const [showModelManager, setShowModelManager] = useState(false);

	const [consentGranted, setConsentGranted] = useState(() => {
		try {
			if (typeof localStorage !== 'undefined') {
				return localStorage.getItem('tfve_stt_consent') === 'true';
			}
		} catch {}
		return false;
	});

	const abortControllerRef = useRef<AbortController | null>(null);

	useEffect(() => {
		void localSttService.checkHardwareSupport().then((sup) => {
			setHasWebGpu(sup.hasWebGpu);
			if (!sup.hasWebGpu) setHardwareMode('wasm');
		});
		void localSttService.listInstalledModels().then((models) => {
			setInstalledModels(models);
		});
	}, []);

	const selectedModel: SttModelMetadata =
		STT_MODELS[selectedModelId] ?? STT_MODELS['whisper-tiny.en']!;
	const audioTracks = (project?.tracks ?? []).filter(
		(t) => t.kind === 'audio' || t.kind === 'video'
	);

	const handleGrantConsent = () => {
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
				message: `Successfully generated ${segments.length} caption cues on timeline.`
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
		abortControllerRef.current?.abort();
	};

	if (!project) {
		return (
			<div className="ai-intro-card">
				<p className="ai-intro-desc">Open or create a project to generate auto-captions.</p>
			</div>
		);
	}

	return (
		<div className="auto-caption-ai-view" data-testid="auto-caption-ai-view">
			{/* Intro Card */}
			<div className="ai-intro-card">
				<div className="ai-intro-title">Auto Caption (Speech-to-Text)</div>
				<p className="ai-intro-desc">
					Automatically transcribe speech and dialogue from your timeline clips into
					word-synchronized subtitle cues using on-device Whisper AI.
				</p>
			</div>

			{/* Privacy Callout */}
			<div className="ai-privacy-card">
				<span className="ai-privacy-highlight">🔒 100% On-Device:</span> All audio processing and
				speech inference run completely inside your browser using WebGPU/WASM. Audio never leaves
				your device.
			</div>

			{!consentGranted ? (
				/* Consent Flow */
				<div className="ai-consent-card">
					<div className="ai-consent-title">AI Model Download Required</div>
					<p className="ai-consent-desc">
						Speech recognition requires a one-time download of the lightweight on-device AI model
						weights ({selectedModel.sizeLabel}) from Hugging Face (ONNX Community / MIT License).
						Once downloaded, captions generate completely offline.
					</p>
					<div style={{ display: 'flex', marginTop: '2px' }}>
						<button
							type="button"
							className="ai-btn-primary"
							onClick={handleGrantConsent}
							style={{ flex: 'none' }}
						>
							<svg
								className="ai-btn-icon"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M8 2v8m-3-3l3 3 3-3" />
								<path d="M2 12v1a1 1 0 001 1h10a1 1 0 001-1v-1" />
							</svg>
							<span>Enable Local AI & Continue</span>
						</button>
					</div>
				</div>
			) : (
				<>
					{/* Model Selection */}
					<div className="ai-section">
						<div className="ai-section-title">
							<span>Whisper Model</span>
							{installedModels.some((m) => m.includes(selectedModel.id)) ? (
								<span
									style={{
										fontSize: '10.5px',
										color: '#22c55e',
										textTransform: 'none',
										fontWeight: 500
									}}
								>
									✓ Cached locally
								</span>
							) : (
								<span
									className="ai-helper-text"
									style={{ fontSize: '10.5px', textTransform: 'none' }}
								>
									Requires {selectedModel.sizeLabel} download
								</span>
							)}
						</div>
						<select
							className="ai-select"
							value={selectedModelId}
							disabled={isRunning}
							onChange={(e) => setSelectedModelId(e.target.value)}
						>
							{Object.values(STT_MODELS).map((m) => (
								<option key={m.id} value={m.id}>
									{m.name} ({m.sizeLabel})
								</option>
							))}
						</select>
						<span className="ai-helper-text">
							{selectedModel.description} (License: {selectedModel.license})
						</span>
					</div>

					{/* Audio Source */}
					<div className="ai-section">
						<div className="ai-section-title">Audio Source</div>
						<div style={{ display: 'flex', gap: '8px' }}>
							<select
								className="ai-select"
								style={{ flex: 1 }}
								disabled={isRunning}
								value={audioSource}
								onChange={(e) => setAudioSource(e.target.value as 'all' | 'selected' | 'range')}
							>
								<option value="all">Entire Sequence Mix</option>
								<option value="selected">Selected Clips ({selection.clipIds.length})</option>
							</select>

							{audioSource === 'all' && (
								<select
									className="ai-select"
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
					<div className="ai-section">
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
							<div className="ai-field">
								<label className="ai-field-label">Language</label>
								<select
									className="ai-select"
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

							<div className="ai-field">
								<label className="ai-field-label">Task</label>
								<select
									className="ai-select"
									disabled={isRunning}
									value={task}
									onChange={(e) => setTask(e.target.value as 'transcribe' | 'translate')}
								>
									<option value="transcribe">Transcribe</option>
									<option value="translate">Translate to English</option>
								</select>
							</div>
						</div>
					</div>

					{/* Engine Runtime */}
					<div className="ai-section">
						<div className="ai-section-title">Inference Engine</div>
						<select
							className="ai-select"
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

					{/* Progress & Status */}
					{status.message && (
						<div
							className={`ai-status-card ${
								status.phase === 'error'
									? 'is-error'
									: status.phase === 'completed'
										? 'is-complete'
										: ''
							}`}
							aria-live="polite"
						>
							<div className="ai-status-header">
								<span>{status.message}</span>
								<span>{Math.round(status.progress * 100)}%</span>
							</div>
							{isRunning && (
								<progress
									max={100}
									value={Math.round(status.progress * 100)}
									className="ai-progress-bar"
								/>
							)}
							{status.speedBytesPerSec && status.speedBytesPerSec > 0 && (
								<span className="ai-status-speed">
									Speed: {(status.speedBytesPerSec / 1_000_000).toFixed(1)} MB/s
								</span>
							)}
						</div>
					)}

					{/* Action Buttons */}
					<div className="ai-actions-row">
						<button
							type="button"
							className="ai-btn-primary"
							disabled={isRunning}
							onClick={() => void handleStart()}
						>
							{isRunning ? (
								<>
									<span className="ai-spinner" aria-hidden="true" />
									<span>Transcribing…</span>
								</>
							) : (
								<>
									<svg
										className="ai-btn-icon"
										viewBox="0 0 16 16"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.6"
										strokeLinecap="round"
										strokeLinejoin="round"
										aria-hidden="true"
									>
										<path d="M8 1.5a2.5 2.5 0 00-2.5 2.5v4a2.5 2.5 0 005 0V4a2.5 2.5 0 00-2.5-2.5z" />
										<path d="M12.5 7a4.5 4.5 0 01-9 0" />
										<line x1="8" y1="11.5" x2="8" y2="14.5" />
										<line x1="5.5" y1="14.5" x2="10.5" y2="14.5" />
									</svg>
									<span>Start Auto-Caption</span>
								</>
							)}
						</button>
						{isRunning && (
							<button type="button" className="ai-btn-secondary" onClick={handleCancel}>
								<span>Cancel</span>
							</button>
						)}
					</div>

					{/* Model Cache Toggle */}
					<div style={{ borderTop: '1px solid #1e1e2c', paddingTop: '10px' }}>
						<button
							type="button"
							className="ai-btn-secondary"
							style={{ width: '100%', fontSize: '11px', height: '28px', minHeight: '28px' }}
							onClick={() => setShowModelManager(!showModelManager)}
						>
							{showModelManager ? 'Hide Model Cache Manager' : 'Model Cache & Storage'}
						</button>

						{showModelManager && (
							<div
								style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}
							>
								{Object.values(STT_MODELS).map((model) => (
									<div key={model.id} className="ai-model-card">
										<div>
											<div className="ai-model-card-name">{model.name}</div>
											<div className="ai-model-card-meta">
												Size: {model.sizeLabel} ·{' '}
												{installedModels.some((m) => m.includes(model.id))
													? 'Cached'
													: 'Not downloaded'}
											</div>
										</div>
										<button
											type="button"
											className="ai-btn-secondary ai-btn-sm"
											disabled={!installedModels.some((m) => m.includes(model.id))}
											onClick={() => void handleDeleteModel(model.id)}
										>
											Clear
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
};

export default AutoCaptionAiView;
