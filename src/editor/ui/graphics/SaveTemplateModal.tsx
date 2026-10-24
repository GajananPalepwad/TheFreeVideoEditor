import React, { useState, useMemo } from 'react';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { viewProject } from '../../core/sequences/access';
import {
	detectPublishableProperties,
	downloadTemplateFile
} from '../../core/templates/templateService';
import type { PublishedTemplateParam, TemplateCategory } from '../../core/templates/templateTypes';
import './saveTemplateModal.css';

interface SaveTemplateModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess?: (templateName: string) => void;
}

const CATEGORIES: TemplateCategory[] = [
	'Titles',
	'Lower Thirds',
	'Callouts',
	'Social',
	'Transitions',
	'Kinetic',
	'Badges',
	'Custom'
];

export function SaveTemplateModal({ isOpen, onClose, onSuccess }: SaveTemplateModalProps) {
	const store = useEditorStoreApi();
	const project = useEditorStore((state) => state.project);
	const activeSeqId = useEditorStore((state) => state.activeSequenceId);
	const selectedClipIds = useEditorStore((state) => state.timeline.selection.clipIds);

	const selectedClips = useMemo(() => {
		if (!project || selectedClipIds.length === 0) return [];
		const view = viewProject(project, activeSeqId);
		return view.tracks.flatMap((t) => t.clips).filter((c) => selectedClipIds.includes(c.id));
	}, [project, activeSeqId, selectedClipIds]);

	// Auto-detect publishable parameters from selection
	const detectedParams = useMemo(() => {
		return detectPublishableProperties(selectedClips);
	}, [selectedClips]);

	const [templateName, setTemplateName] = useState('My Motion Template');
	const [category, setCategory] = useState<TemplateCategory>('Lower Thirds');
	const [description, setDescription] = useState('');
	const [author, setAuthor] = useState('');
	const [protectTiming, setProtectTiming] = useState(true);
	const [introSec, setIntroSec] = useState('0.8');
	const [outroSec, setOutroSec] = useState('0.6');

	// Map of param.id -> { enabled: boolean; label: string }
	const [paramConfigs, setParamConfigs] = useState<
		Record<string, { enabled: boolean; label: string }>
	>({});

	// Initialize paramConfigs when detectedParams changes
	React.useEffect(() => {
		const initial: Record<string, { enabled: boolean; label: string }> = {};
		detectedParams.forEach((param) => {
			initial[param.id] = {
				enabled: true,
				label: param.name
			};
		});
		setParamConfigs(initial);
	}, [detectedParams]);

	if (!isOpen) return null;

	const handleSave = (shouldExportFile: boolean) => {
		if (!templateName.trim()) return;

		// Filter enabled params and assign custom labels
		const publishedParams: PublishedTemplateParam[] = detectedParams
			.filter((p) => paramConfigs[p.id]?.enabled ?? true)
			.map((p) => ({
				...p,
				name: paramConfigs[p.id]?.label?.trim() || p.name
			}));

		const introDuration = Math.round(Math.max(0, parseFloat(introSec) || 0) * 1_000_000);
		const outroDuration = Math.round(Math.max(0, parseFloat(outroSec) || 0) * 1_000_000);

		const template = store.getState().saveSelectionAsTemplate({
			name: templateName.trim(),
			category,
			description: description.trim(),
			author: author.trim() || 'Creator',
			publishedParams,
			responsiveTiming: protectTiming
				? {
						introDuration,
						outroDuration
					}
				: undefined
		});

		if (template) {
			if (shouldExportFile) {
				downloadTemplateFile(template);
			}
			onSuccess?.(template.name);
			onClose();
		}
	};

	return (
		<div className="template-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
			<div className="template-modal-card" onClick={(e) => e.stopPropagation()}>
				<div className="template-modal-header">
					<div className="template-modal-title-group">
						<span className="template-modal-icon">✦</span>
						<div>
							<h3 className="template-modal-title">Create Motion Graphic Template</h3>
							<p className="template-modal-subtitle">
								Package {selectedClips.length} selected clip{selectedClips.length === 1 ? '' : 's'}{' '}
								into a single, fully editable template (.grafree).
							</p>
						</div>
					</div>
					<button
						type="button"
						className="template-modal-close"
						onClick={onClose}
						aria-label="Close dialog"
					>
						✕
					</button>
				</div>

				<div className="template-modal-body">
					{/* Basic Metadata */}
					<div className="template-field-group">
						<label className="template-field-label">Template Name</label>
						<input
							type="text"
							className="template-text-input"
							value={templateName}
							onChange={(e) => setTemplateName(e.target.value)}
							placeholder="e.g. Clean Kinetic Lower Third"
							autoFocus
						/>
					</div>

					<div className="template-form-row">
						<div className="template-field-group">
							<label className="template-field-label">Category</label>
							<select
								className="template-select-input"
								value={category}
								onChange={(e) => setCategory(e.target.value as TemplateCategory)}
							>
								{CATEGORIES.map((cat) => (
									<option key={cat} value={cat}>
										{cat}
									</option>
								))}
							</select>
						</div>

						<div className="template-field-group">
							<label className="template-field-label">Author (Optional)</label>
							<input
								type="text"
								className="template-text-input"
								value={author}
								onChange={(e) => setAuthor(e.target.value)}
								placeholder="Your name or handle"
							/>
						</div>
					</div>

					<div className="template-field-group">
						<label className="template-field-label">Description (Optional)</label>
						<input
							type="text"
							className="template-text-input"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Brief summary of this motion graphic"
						/>
					</div>

					{/* Responsive Timing Section */}
					<div className="template-section-box">
						<div className="template-section-box-header">
							<label className="template-checkbox-label">
								<input
									type="checkbox"
									checked={protectTiming}
									onChange={(e) => setProtectTiming(e.target.checked)}
								/>
								<span className="template-checkbox-title">
									Responsive Design - Time (Intro/Outro Protection)
								</span>
							</label>
							<span className="template-hint">
								Keeps entrance & exit animations at 1x speed when the clip is stretched or trimmed.
							</span>
						</div>

						{protectTiming && (
							<div className="template-timing-inputs">
								<div className="template-timing-item">
									<span>Intro Duration</span>
									<div className="template-input-with-unit">
										<input
											type="number"
											step="0.1"
											min="0"
											max="10"
											value={introSec}
											onChange={(e) => setIntroSec(e.target.value)}
										/>
										<span>sec</span>
									</div>
								</div>
								<div className="template-timing-item">
									<span>Outro Duration</span>
									<div className="template-input-with-unit">
										<input
											type="number"
											step="0.1"
											min="0"
											max="10"
											value={outroSec}
											onChange={(e) => setOutroSec(e.target.value)}
										/>
										<span>sec</span>
									</div>
								</div>
							</div>
						)}
					</div>

					{/* Published Parameters Section */}
					<div className="template-section-box">
						<div className="template-section-box-header">
							<span className="template-checkbox-title">
								Editable Properties (Exposed in Inspector)
							</span>
							<span className="template-hint">
								Select which text lines, colors, and fonts future users can edit directly from the
								Inspector.
							</span>
						</div>

						<div className="template-params-list">
							{detectedParams.length === 0 ? (
								<p className="template-empty-hint">
									No publishable text or shape properties detected in selection.
								</p>
							) : (
								detectedParams.map((param) => {
									const isEnabled = paramConfigs[param.id]?.enabled ?? true;
									const label = paramConfigs[param.id]?.label ?? param.name;

									return (
										<div
											key={param.id}
											className={`template-param-row ${isEnabled ? 'is-active' : 'is-disabled'}`}
										>
											<input
												type="checkbox"
												checked={isEnabled}
												onChange={(e) =>
													setParamConfigs((prev) => ({
														...prev,
														[param.id]: {
															enabled: e.target.checked,
															label: prev[param.id]?.label || param.name
														}
													}))
												}
											/>
											<span className={`template-param-badge badge-${param.type}`}>
												{param.type.toUpperCase()}
											</span>
											<input
												type="text"
												className="template-param-label-input"
												value={label}
												disabled={!isEnabled}
												onChange={(e) =>
													setParamConfigs((prev) => ({
														...prev,
														[param.id]: {
															enabled: prev[param.id]?.enabled ?? true,
															label: e.target.value
														}
													}))
												}
												placeholder="Field Label"
											/>
											<span className="template-param-default-val">
												{typeof param.defaultValue === 'string'
													? `"${param.defaultValue}"`
													: param.type === 'color'
														? 'Color/Gradient'
														: String(param.defaultValue)}
											</span>
										</div>
									);
								})
							)}
						</div>
					</div>
				</div>

				<div className="template-modal-footer">
					<button type="button" className="template-btn-secondary" onClick={onClose}>
						Cancel
					</button>
					<button
						type="button"
						className="template-btn-secondary"
						onClick={() => handleSave(true)}
						disabled={!templateName.trim() || selectedClips.length === 0}
						title="Save to your template library and download .grafree file"
					>
						<span>Export File (.grafree)</span>
					</button>
					<button
						type="button"
						className="template-btn-primary"
						onClick={() => handleSave(false)}
						disabled={!templateName.trim() || selectedClips.length === 0}
					>
						<span>Save to My Templates</span>
					</button>
				</div>
			</div>
		</div>
	);
}
