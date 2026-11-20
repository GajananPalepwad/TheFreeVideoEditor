import React, { useMemo, useRef, useEffect } from 'react';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { ticksToTimecode } from '../../core/time';
import type { SilenceTrimMode, SilenceApplyTarget } from '../../core/ai/types';
import { trackFeatureUsed } from '../../../services/activityTracking';

export const SilenceTrimPanel: React.FC = () => {
	const storeApi = useEditorStoreApi();
	const project = useEditorStore((state) => state.project);
	const fps = project?.settings.fps ?? 30;
	const activeSequenceId = useEditorStore((state) => state.activeSequenceId);
	const options = useEditorStore((state) => state.ai.silenceOptions);
	const silences = useEditorStore((state) => state.ai.detectedSilences);
	const isAnalyzing = useEditorStore((state) => state.ai.isAnalyzingSilence);
	const analysisProgress = useEditorStore((state) => state.ai.analysisProgress);
	const virtualPreview = useEditorStore((state) => state.ai.virtualPreview);
	const cachedFeatures = useEditorStore((state) => state.ai.cachedFeatures);
	const setSilenceOptions = useEditorStore((state) => state.setSilenceOptions);
	const toggleSilenceIncluded = useEditorStore((state) => state.toggleSilenceIncluded);
	const includeAllSilences = useEditorStore((state) => state.includeAllSilences);
	const setSilenceVirtualPreview = useEditorStore((state) => state.setSilenceVirtualPreview);
	const applySilenceTrimAction = useEditorStore((state) => state.applySilenceTrimAction);
	const setPlayhead = useEditorStore((state) => state.setPlayhead);

	const resultsRef = useRef<HTMLDivElement>(null);
	const shouldScrollRef = useRef(false);

	const scrollToNextOptions = () => {
		if (resultsRef.current && typeof resultsRef.current.scrollIntoView === 'function') {
			resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	};

	// Audio tracks in current sequence (including video tracks that carry audio)
	const audioTracks = useMemo(() => {
		if (!project) return [];
		const seq =
			activeSequenceId === 'root' ? project : (project.sequences?.[activeSequenceId] ?? project);
		return seq.tracks.filter((t) => t.kind === 'audio' || t.kind === 'video');
	}, [project, activeSequenceId]);

	const includedSilences = useMemo(() => silences.filter((s) => s.included), [silences]);

	const totalRemovedUs = useMemo(
		() => includedSilences.reduce((sum, s) => sum + s.cutDurationUs, 0),
		[includedSilences]
	);

	const handleTrackToggle = (trackId: string) => {
		const allTrackIds = audioTracks.map((t) => t.id);
		const current = options.trackIds.length === 0 ? allTrackIds : options.trackIds;
		const next = current.includes(trackId)
			? current.filter((id) => id !== trackId)
			: [...current, trackId];
		setSilenceOptions({ trackIds: next });
	};

	const handleSelectDialogueOnly = () => {
		// Pick tracks that have "dialogue", "vocal", "mic", or "voice" in their name, or first audio track
		const dialogueTracks = audioTracks.filter(
			(t) =>
				/dialogue|voice|vocal|mic|speech|host|guest/i.test(t.name) || audioTracks.indexOf(t) === 0
		);
		setSilenceOptions({ trackIds: dialogueTracks.map((t) => t.id) });
	};

	const handleDetectSilences = async () => {
		trackFeatureUsed('smart_cut', { action: 'detect' });
		shouldScrollRef.current = true;
		try {
			scrollToNextOptions();
			await storeApi.getState().analyzeSilence();
		} finally {
			setTimeout(() => {
				scrollToNextOptions();
				shouldScrollRef.current = false;
			}, 60);
		}
	};

	useEffect(() => {
		if (shouldScrollRef.current && silences.length > 0) {
			shouldScrollRef.current = false;
			setTimeout(scrollToNextOptions, 60);
		}
	}, [silences.length]);

	return (
		<div className="silence-trim-panel" data-testid="silence-trim-panel">
			{/* Tool Header & Description */}
			<div className="ai-intro-card">
				<div className="ai-intro-title">Silence & Pause Removal</div>
				<p className="ai-intro-desc">
					Automatically scan dialogue and voice tracks for dead air and pauses, and ripple-trim them
					across the timeline while keeping audio and video in sync.
				</p>
			</div>

			{/* Tracks Selection */}
			<div className="ai-section">
				<div className="ai-section-title">
					<span>Tracks to Consider</span>
					<button
						type="button"
						className="ai-btn-secondary"
						style={{ padding: '2px 6px', fontSize: '10px' }}
						onClick={handleSelectDialogueOnly}
					>
						Dialogue Only
					</button>
				</div>
				<div className="ai-checkbox-group">
					{audioTracks.length === 0 ? (
						<span className="ai-helper-text">No audio tracks found.</span>
					) : (
						audioTracks.map((track) => {
							const isChecked =
								options.trackIds.length === 0 || options.trackIds.includes(track.id);
							return (
								<label key={track.id} className="ai-checkbox-label">
									<input
										type="checkbox"
										className="ai-checkbox"
										checked={isChecked}
										onChange={() => handleTrackToggle(track.id)}
									/>
									<span>{track.name}</span>
								</label>
							);
						})
					)}
				</div>
			</div>

			{/* Silence Detection Parameters */}
			<div className="ai-section">
				<div className="ai-section-title">Silence Parameters</div>

				{/* Max silence to keep */}
				<div className="ai-field">
					<div className="ai-field-row">
						<label className="ai-field-label" htmlFor="max-silence-input">
							Max silence between voices
						</label>
						<span className="ai-field-val">{options.maxSilenceSec.toFixed(2)} s</span>
					</div>
					<input
						id="max-silence-input"
						type="range"
						className="ai-slider"
						min="0.0"
						max="2.0"
						step="0.05"
						value={options.maxSilenceSec}
						onChange={(e) => setSilenceOptions({ maxSilenceSec: parseFloat(e.target.value) })}
					/>
				</div>

				{/* Min silence to cut */}
				<div className="ai-field">
					<div className="ai-field-row">
						<label className="ai-field-label" htmlFor="min-silence-input">
							Min silence to cut
						</label>
						<span className="ai-field-val">{options.minSilenceSec.toFixed(2)} s</span>
					</div>
					<input
						id="min-silence-input"
						type="range"
						className="ai-slider"
						min="0.1"
						max="1.5"
						step="0.05"
						value={options.minSilenceSec}
						onChange={(e) => setSilenceOptions({ minSilenceSec: parseFloat(e.target.value) })}
					/>
				</div>

				{/* Threshold mode & Sensitivity */}
				<div className="ai-field">
					<div className="ai-field-row">
						<span className="ai-field-label">Silence Threshold</span>
						<div style={{ display: 'flex', gap: '4px' }}>
							<button
								type="button"
								className={`ai-btn-secondary ${options.thresholdMode === 'auto' ? 'is-active' : ''}`}
								style={{ padding: '2px 8px', fontSize: '10px' }}
								onClick={() => setSilenceOptions({ thresholdMode: 'auto' })}
							>
								Auto
							</button>
							<button
								type="button"
								className={`ai-btn-secondary ${options.thresholdMode === 'manual' ? 'is-active' : ''}`}
								style={{ padding: '2px 8px', fontSize: '10px' }}
								onClick={() => setSilenceOptions({ thresholdMode: 'manual' })}
							>
								Manual
							</button>
						</div>
					</div>

					{options.thresholdMode === 'auto' ? (
						<div style={{ marginTop: '4px' }}>
							<div className="ai-field-row">
								<span className="ai-field-label ai-field-sublabel">Sensitivity</span>
								<span className="ai-field-val">{(options.sensitivity * 100).toFixed(0)}%</span>
							</div>
							<input
								type="range"
								className="ai-slider"
								min="0.0"
								max="1.0"
								step="0.05"
								value={options.sensitivity}
								onChange={(e) => setSilenceOptions({ sensitivity: parseFloat(e.target.value) })}
							/>
						</div>
					) : (
						<div style={{ marginTop: '4px' }}>
							<div className="ai-field-row">
								<span className="ai-field-label ai-field-sublabel">Threshold (dB)</span>
								<span className="ai-field-val">{options.manualThresholdDb} dB</span>
							</div>
							<input
								type="range"
								className="ai-slider"
								min="-60"
								max="-15"
								step="1"
								value={options.manualThresholdDb}
								onChange={(e) =>
									setSilenceOptions({ manualThresholdDb: parseInt(e.target.value, 10) })
								}
							/>
						</div>
					)}
				</div>

				{/* Padding before/after */}
				<div className="ai-field-row">
					<div className="ai-field" style={{ flex: 1 }}>
						<label className="ai-field-label" style={{ fontSize: '11px' }}>
							Pad Before: {options.paddingBeforeMs}ms
						</label>
						<input
							type="range"
							className="ai-slider"
							min="0"
							max="300"
							step="10"
							value={options.paddingBeforeMs}
							onChange={(e) => setSilenceOptions({ paddingBeforeMs: parseInt(e.target.value, 10) })}
						/>
					</div>
					<div className="ai-field" style={{ flex: 1 }}>
						<label className="ai-field-label" style={{ fontSize: '11px' }}>
							Pad After: {options.paddingAfterMs}ms
						</label>
						<input
							type="range"
							className="ai-slider"
							min="0"
							max="300"
							step="10"
							value={options.paddingAfterMs}
							onChange={(e) => setSilenceOptions({ paddingAfterMs: parseInt(e.target.value, 10) })}
						/>
					</div>
				</div>

				{/* Toggles */}
				<div className="ai-field" style={{ marginTop: '4px', gap: '8px' }}>
					<label className="ai-checkbox-label">
						<input
							type="checkbox"
							className="ai-checkbox"
							checked={options.voiceOnly}
							onChange={(e) => setSilenceOptions({ voiceOnly: e.target.checked })}
						/>
						<span>Voice only (ignore noise / music via VAD)</span>
					</label>

					<label className="ai-checkbox-label">
						<input
							type="checkbox"
							className="ai-checkbox"
							checked={options.keepBreaths}
							onChange={(e) => setSilenceOptions({ keepBreaths: e.target.checked })}
						/>
						<span>Keep natural breaths before speech</span>
					</label>

					<label className="ai-checkbox-label">
						<input
							type="checkbox"
							className="ai-checkbox"
							checked={options.trimLeadingTrailing}
							onChange={(e) => setSilenceOptions({ trimLeadingTrailing: e.target.checked })}
						/>
						<span>Also trim leading/trailing silence</span>
					</label>
				</div>
			</div>

			{/* Trim Mode & Output Target */}
			<div className="ai-section">
				<div className="ai-section-title">Output Options</div>

				<div className="ai-field-row">
					<span className="ai-field-label">Action Mode</span>
					<select
						className="ai-select"
						value={options.mode}
						onChange={(e) => setSilenceOptions({ mode: e.target.value as SilenceTrimMode })}
					>
						<option value="shorten">Shorten to max silence</option>
						<option value="ripple">Remove & ripple cut</option>
						<option value="markers">Mark only with markers</option>
					</select>
				</div>

				<div className="ai-field-row">
					<span className="ai-field-label">Apply To</span>
					<select
						className="ai-select"
						value={options.applyTarget}
						onChange={(e) =>
							setSilenceOptions({ applyTarget: e.target.value as SilenceApplyTarget })
						}
					>
						<option value="all-tracks">All tracks (keeps A/V sync)</option>
						<option value="linked-only">Linked tracks only</option>
					</select>
				</div>

				{options.applyTarget === 'linked-only' && (
					<span style={{ fontSize: '10px', color: '#f59e0b', marginTop: '2px' }}>
						⚠️ Warning: Applying to linked tracks only may desynchronize background music or
						unlinked b-roll.
					</span>
				)}

				<div className="ai-field-row">
					<span className="ai-field-label">Crossfade (Audio)</span>
					<span className="ai-field-val">{options.crossfadeMs} ms</span>
				</div>
				<input
					type="range"
					className="ai-slider"
					min="0"
					max="50"
					step="1"
					value={options.crossfadeMs}
					onChange={(e) => setSilenceOptions({ crossfadeMs: parseInt(e.target.value, 10) })}
				/>
			</div>

			{/* Detection Button */}
			<div className="ai-actions-row">
				<button
					type="button"
					className="ai-btn-primary"
					disabled={isAnalyzing}
					onClick={() => void handleDetectSilences()}
				>
					{isAnalyzing ? (
						<>
							<span className="ai-spinner" aria-hidden="true" />
							<span>Analyzing Audio ({analysisProgress}%)...</span>
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
								<circle cx="5" cy="4" r="2.5" />
								<circle cx="5" cy="12" r="2.5" />
								<line x1="7.5" y1="5.5" x2="14" y2="12" />
								<line x1="7.5" y1="10.5" x2="14" y2="4" />
							</svg>
							<span>Detect Silences</span>
						</>
					)}
				</button>
			</div>

			{/* Review Results */}
			{silences.length > 0 && (
				<div ref={resultsRef} className="ai-section" data-testid="silence-review-section">
					<div className="ai-summary-banner">
						<div>
							<span className="ai-summary-badge">{includedSilences.length} Silences</span>
							<span style={{ marginLeft: '8px' }}>
								Removed: {(totalRemovedUs / 1_000_000).toFixed(2)}s
							</span>
						</div>
						<button
							type="button"
							className={`ai-btn-secondary ${virtualPreview ? 'is-active' : ''}`}
							style={{ padding: '3px 8px', fontSize: '11px' }}
							onClick={() => setSilenceVirtualPreview(!virtualPreview)}
						>
							{virtualPreview ? '⏸ Virtual Preview ON' : '▶ Virtual Preview'}
						</button>
					</div>

					<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<span style={{ fontSize: '11px', color: '#94a3b8' }}>Detected Silence Regions:</span>
						<div style={{ display: 'flex', gap: '4px' }}>
							<button
								type="button"
								className="ai-btn-secondary"
								style={{ padding: '1px 5px', fontSize: '10px' }}
								onClick={() => includeAllSilences(true)}
							>
								Select All
							</button>
							<button
								type="button"
								className="ai-btn-secondary"
								style={{ padding: '1px 5px', fontSize: '10px' }}
								onClick={() => includeAllSilences(false)}
							>
								Deselect All
							</button>
						</div>
					</div>

					<div className="ai-silence-list" role="list">
						{silences.map((silence, idx) => (
							<div
								key={silence.id}
								className={`ai-silence-item ${!silence.included ? 'is-excluded' : ''}`}
								onClick={() => setPlayhead(silence.startUs)}
								role="listitem"
							>
								<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<input
										type="checkbox"
										className="ai-checkbox"
										checked={silence.included}
										onChange={(e) => {
											e.stopPropagation();
											toggleSilenceIncluded(silence.id);
										}}
									/>
									<span style={{ color: '#94a3b8' }}>#{idx + 1}</span>
									<span className="ai-silence-time">{ticksToTimecode(silence.startUs, fps)}</span>
								</div>
								<div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
									<span style={{ color: '#64748b' }}>
										{(silence.durationUs / 1_000_000).toFixed(2)}s
									</span>
									<span className="ai-silence-cut-badge">
										-{(silence.cutDurationUs / 1_000_000).toFixed(2)}s
									</span>
								</div>
							</div>
						))}
					</div>

					{/* Apply Output Buttons */}
					<div className="ai-actions-row" style={{ marginTop: '8px' }}>
						<button
							type="button"
							className="ai-btn-primary"
							onClick={() => {
								trackFeatureUsed('smart_cut', { action: 'apply', target: 'new-sequence' });
								applySilenceTrimAction('new-sequence');
							}}
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
								<polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
							</svg>
							<span>Apply to New Sequence</span>
						</button>
						<button
							type="button"
							className="ai-btn-secondary"
							onClick={() => {
								trackFeatureUsed('smart_cut', { action: 'apply', target: 'in-place' });
								applySilenceTrimAction('in-place');
							}}
						>
							<span>Apply in Place</span>
						</button>
					</div>
				</div>
			)}

			{silences.length === 0 && !isAnalyzing && cachedFeatures && (
				<div ref={resultsRef} className="ai-section" data-testid="silence-empty-section">
					<div
						style={{
							textAlign: 'center',
							color: '#94a3b8',
							fontSize: '11px',
							padding: '8px 0'
						}}
					>
						No silences detected matching current threshold and duration criteria.
					</div>
				</div>
			)}
		</div>
	);
};
