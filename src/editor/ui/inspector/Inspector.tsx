import {
	useCallback,
	useRef,
	useState,
	type ChangeEvent,
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent
} from 'react';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import {
	descriptorFor,
	hasKeyframeAt,
	isAnimated,
	nextKeyframeTime,
	prevKeyframeTime,
	propertyCurve,
	readProperty,
	snapLocalTime,
	type Clip,
	type PropertyDescriptor,
	type PropertyId,
	type PropertyValue,
	type Time
} from '../../core';
import EffectsSection from './EffectsSection';
import MasksSection from './MasksSection';
import { TrackingSection } from './TrackingSection';
import TimeRemapSection from './TimeRemapSection';
import { TextSection } from './TextSection';
import { ShapeSection } from './ShapeSection';
import { MotionTemplateSection } from './MotionTemplateSection';
import { isMotionTemplateClip } from '../../core/templates/templateTypes';
import { findClipInSequence } from '../../core/sequences/access';
import { TransitionInspector } from './TransitionInspector';
import { audioEffectRegistry } from '../../core/audio/effects';
import { ColorPickerField } from './ColorPickerField';
import './inspector.css';

export interface ConfirmDisableState {
	propertyId: PropertyId;
	clipId: Clip['id'];
}

export default function Inspector() {
	const store = useEditorStoreApi();
	const project = useEditorStore((state) => state.project);
	const playhead = useEditorStore((state) => state.timeline.playhead);
	const selectedClipIds = useEditorStore((state) => state.timeline.selection.clipIds);
	const selectedTransitionId = useEditorStore((state) => state.timeline.selection.transitionId);
	const inspector = useEditorStore((state) => state.inspector);
	const activeSequenceId = useEditorStore((state) => state.activeSequenceId);
	const openSequenceSettingsDialog = useEditorStore((state) => state.openSequenceSettingsDialog);

	const [confirmDisable, setConfirmDisable] = useState<ConfirmDisableState | null>(null);

	// Find selected transition if any
	let selectedTransition: {
		transition: import('../../core/types').Transition;
		track: import('../../core/types').Track;
	} | null = null;
	if (project && selectedTransitionId) {
		for (const track of project.tracks) {
			const tr = (track.transitions ?? []).find((t) => t.id === selectedTransitionId);
			if (tr) {
				selectedTransition = { transition: tr, track };
				break;
			}
		}
	}

	// Find the single selected clip
	const selectedClip: Clip | null =
		project && selectedClipIds.length === 1
			? findClipInSequence(project, activeSequenceId, selectedClipIds[0]!)
			: null;

	if (!project) {
		return (
			<div className="inspector-container">
				<div className="inspector-empty">
					<p className="inspector-hint">Open a project to view its properties.</p>
				</div>
			</div>
		);
	}

	if (selectedTransition) {
		return (
			<TransitionInspector
				transition={selectedTransition.transition}
				track={selectedTransition.track}
				project={project}
			/>
		);
	}

	function ChevronIcon() {
		return (
			<svg
				className="section-chevron"
				viewBox="0 0 16 16"
				width="11"
				height="11"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M6 3.5l4.5 4.5L6 12.5" />
			</svg>
		);
	}

	if (selectedClipIds.length === 0) {
		const activeSeq = project.sequences?.[store.getState().activeSequenceId] ?? project;
		return (
			<div className="inspector-container">
				<div className="inspector-empty">
					<div className="inspector-empty-card">
						<div className="inspector-empty-icon" aria-hidden="true">
							<svg
								width="24"
								height="24"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
							>
								<rect x="2" y="4" width="20" height="16" rx="2" />
								<path d="M7 4v16M17 4v16M2 12h20M2 8h5M2 16h5M17 8h5M17 16h5" />
							</svg>
						</div>
						<h3 className="inspector-empty-title">No Clip Selected</h3>
						<p className="inspector-hint">
							Select a clip in the timeline to view and adjust its properties, transform, effects,
							and audio.
						</p>
					</div>

					<div className="inspector-sequence-card">
						<div className="inspector-sequence-header">
							<span className="inspector-sequence-title">
								{activeSeq.name ?? 'Sequence Settings'}
							</span>
							<button
								type="button"
								className="secondary-button"
								style={{ fontSize: '11px', padding: '2px 8px', height: 'auto', cursor: 'pointer' }}
								onClick={() => openSequenceSettingsDialog(activeSequenceId)}
								title="Open Sequence Settings to change aspect ratio or frame rate"
							>
								Settings ⚙
							</button>
						</div>
						<div className="inspector-sequence-pills">
							<span className="timeline-counter-badge">
								{project.settings.width} × {project.settings.height}
							</span>
							<span className="timeline-counter-badge">{project.settings.fps} fps</span>
							<span className="timeline-counter-badge">
								{project.settings.sampleRate.toLocaleString()} Hz
							</span>
						</div>
					</div>
				</div>
			</div>
		);
	}

	if (selectedClipIds.length > 1 || !selectedClip) {
		return (
			<div className="inspector-container">
				<div className="inspector-multiselect">
					<div className="inspector-empty-card">
						<h3 className="inspector-empty-title">{selectedClipIds.length} Clips Selected</h3>
						<p className="inspector-hint">
							Multi-clip editing is not supported. Select a single clip to edit transform and crop
							properties.
						</p>
					</div>
				</div>
			</div>
		);
	}

	const localTime = playhead - selectedClip.start;
	const isTransformExpanded = inspector.expanded.transform !== false;
	const isCropExpanded = Boolean(inspector.expanded.crop);

	const isAdjustment = selectedClip.source?.type === 'adjustment';
	const isSpeedExpanded = inspector.expanded.speed !== false;
	const isMasksExpanded = inspector.expanded.masks !== false;
	const isEffectsExpanded = inspector.expanded.effects !== false;
	const isAudioExpanded = inspector.expanded.audio !== false;

	const clipAsset = selectedClip.assetId ? project.assets[selectedClip.assetId] : undefined;
	const clipTrack = project.tracks.find((t) => t.clips.some((c) => c.id === selectedClip.id));
	const isText = selectedClip.source?.type === 'text';
	const isTextExpanded = inspector.expanded.text !== false;
	const isShape = selectedClip.source?.type === 'shape';
	const isShapeExpanded = inspector.expanded.shape !== false;
	const isSolid = selectedClip.source?.type === 'solid';
	const isSolidExpanded = inspector.expanded.solid !== false;
	const hasAudio =
		!isText && !isShape && (clipTrack?.kind === 'audio' || (clipAsset?.hasAudio ?? false));

	const isTemplate = isMotionTemplateClip(selectedClip);

	const kindLabel = isTemplate
		? 'Motion Template'
		: isText
			? 'Text'
			: isShape
				? 'Shape'
				: isSolid
					? 'Solid Color'
					: isAdjustment
						? 'Adjustment'
						: clipTrack?.kind === 'audio'
							? 'Audio'
							: selectedClip.source?.type === 'sequence'
								? 'Sequence'
								: 'Video';
	const clipDurationSec = (selectedClip.duration / 1_000_000).toFixed(2);
	const templateName =
		selectedClip.source?.type === 'sequence' ? selectedClip.source.templateName : undefined;

	return (
		<div className="inspector-container">
			{/* Selected Clip Summary Banner */}
			<div className="inspector-clip-banner">
				<div className="inspector-clip-title-row">
					<span
						className="inspector-clip-name"
						title={clipAsset?.name ?? templateName ?? kindLabel}
					>
						{clipAsset?.name ?? templateName ?? `${kindLabel} Clip`}
					</span>
					<span
						className="timeline-counter-badge"
						style={{
							color: isTemplate ? '#ec4899' : '#38bdf8',
							borderColor: isTemplate ? 'rgba(236, 72, 153, 0.35)' : 'rgba(56, 189, 248, 0.3)'
						}}
					>
						<span className="timeline-badge-dot" aria-hidden="true" />
						{kindLabel}
					</span>
				</div>
				<div className="inspector-clip-badges">
					{clipTrack && <span className="timeline-counter-badge">Track: {clipTrack.name}</span>}
					<span className="timeline-counter-badge">{clipDurationSec}s</span>
				</div>
			</div>

			{/* Motion Graphic Template Section */}
			{isTemplate && (
				<section className="inspector-section is-open">
					<div className="inspector-section-header" style={{ cursor: 'default' }}>
						<span className="inspector-section-title">
							<ChevronIcon />
							Template Customizer
						</span>
					</div>
					<MotionTemplateSection clip={selectedClip} />
				</section>
			)}

			{/* Text Section */}
			{isText && (
				<section className={`inspector-section ${isTextExpanded ? 'is-open' : ''}`}>
					<button
						type="button"
						className="inspector-section-header"
						onClick={() => store.getState().setInspectorExpanded('text', !isTextExpanded)}
						aria-expanded={isTextExpanded}
					>
						<span className="inspector-section-title">
							<ChevronIcon />
							Text
						</span>
					</button>
					{isTextExpanded && (
						<TextSection
							clip={selectedClip}
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
					)}
				</section>
			)}

			{/* Shape Section */}
			{isShape && selectedClip.source?.type === 'shape' && (
				<section className={`inspector-section ${isShapeExpanded ? 'is-open' : ''}`}>
					<button
						type="button"
						className="inspector-section-header"
						onClick={() => store.getState().setInspectorExpanded('shape', !isShapeExpanded)}
						aria-expanded={isShapeExpanded}
					>
						<span className="inspector-section-title">
							<ChevronIcon />
							Shape
						</span>
					</button>
					{isShapeExpanded && (
						<ShapeSection
							clip={selectedClip}
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
					)}
				</section>
			)}

			{/* Solid Color Section */}
			{isSolid && selectedClip.source?.type === 'solid' && (
				<section className={`inspector-section ${isSolidExpanded ? 'is-open' : ''}`}>
					<button
						type="button"
						className="inspector-section-header"
						onClick={() => store.getState().setInspectorExpanded('solid', !isSolidExpanded)}
						aria-expanded={isSolidExpanded}
					>
						<span className="inspector-section-title">
							<ChevronIcon />
							Solid / Gradient Color
						</span>
					</button>
					{isSolidExpanded && (
						<div className="inspector-section-content">
							<div className="property-row">
								<span className="property-label">Color</span>
								<ColorPickerField
									value={selectedClip.source.color}
									onChange={(rgba) => {
										store.getState().setSolidColor(selectedClip.id, {
											r: rgba[0],
											g: rgba[1],
											b: rgba[2],
											a: rgba[3]
										});
									}}
									label="Solid Color"
									hasAlpha={true}
									gradient={{
										type: selectedClip.source.gradientType ?? 'none',
										colorEnd: selectedClip.source.gradientColorEnd,
										angle: selectedClip.source.gradientAngle ?? 90
									}}
									onGradientChange={({ type, colorEnd, angle }) => {
										store.getState().setSolidGradient(selectedClip.id, {
											gradientType: type,
											gradientColorEnd: {
												r: colorEnd[0],
												g: colorEnd[1],
												b: colorEnd[2],
												a: colorEnd[3]
											},
											gradientAngle: angle
										});
									}}
								/>
							</div>
						</div>
					)}
				</section>
			)}

			{/* Transform Section */}
			<section className={`inspector-section ${isTransformExpanded ? 'is-open' : ''}`}>
				<button
					type="button"
					className="inspector-section-header"
					onClick={() => store.getState().setInspectorExpanded('transform', !isTransformExpanded)}
					aria-expanded={isTransformExpanded}
				>
					<span className="inspector-section-title">
						<ChevronIcon />
						Transform
					</span>
				</button>
				{isTransformExpanded && (
					<div className="inspector-section-content">
						<PropertyRow
							clip={selectedClip}
							propertyId="position"
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
						<PropertyRow
							clip={selectedClip}
							propertyId="scale"
							localTime={localTime}
							fps={project.settings.fps}
							linkScale={inspector.linkScale}
							onToggleLinkScale={() => store.getState().setInspectorLinkScale(!inspector.linkScale)}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
						<PropertyRow
							clip={selectedClip}
							propertyId="rotation"
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
						<PropertyRow
							clip={selectedClip}
							propertyId="anchor"
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
						<PropertyRow
							clip={selectedClip}
							propertyId="opacity"
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
					</div>
				)}
			</section>

			{/* Audio Section (Volume dB, Pan, Fades) */}
			{hasAudio && (
				<section className={`inspector-section ${isAudioExpanded ? 'is-open' : ''}`}>
					<button
						type="button"
						className="inspector-section-header"
						onClick={() => store.getState().setInspectorExpanded('audio', !isAudioExpanded)}
						aria-expanded={isAudioExpanded}
					>
						<span className="inspector-section-title">
							<ChevronIcon />
							Audio
						</span>
					</button>
					{isAudioExpanded && (
						<div className="inspector-section-content">
							<PropertyRow
								clip={selectedClip}
								propertyId="audio.volume"
								localTime={localTime}
								fps={project.settings.fps}
								confirmDisable={confirmDisable}
								onStartDisableConfirm={setConfirmDisable}
								onCancelDisableConfirm={() => setConfirmDisable(null)}
							/>
							<PropertyRow
								clip={selectedClip}
								propertyId="audio.pan"
								localTime={localTime}
								fps={project.settings.fps}
								confirmDisable={confirmDisable}
								onStartDisableConfirm={setConfirmDisable}
								onCancelDisableConfirm={() => setConfirmDisable(null)}
							/>
							<div className="mt-2 border-t border-[var(--color-hairline)] pt-2">
								<div className="audio-fade-grid">
									<div className="audio-fade-row">
										<span className="audio-fade-label">Fade In (s)</span>
										<div className="flex items-center gap-1">
											<input
												type="number"
												min="0"
												step="0.1"
												value={((selectedClip.fadeInUs ?? 0) / 1_000_000).toFixed(2)}
												onChange={(e) => {
													const sec = Math.max(0, parseFloat(e.target.value) || 0);
													store.getState().setClipFade(selectedClip.id, {
														fadeInUs: Math.round(sec * 1_000_000)
													});
												}}
												className="audio-fade-input"
											/>
										</div>
									</div>
									<div className="audio-fade-row">
										<span className="audio-fade-label">Fade Out (s)</span>
										<div className="flex items-center gap-1">
											<input
												type="number"
												min="0"
												step="0.1"
												value={((selectedClip.fadeOutUs ?? 0) / 1_000_000).toFixed(2)}
												onChange={(e) => {
													const sec = Math.max(0, parseFloat(e.target.value) || 0);
													store.getState().setClipFade(selectedClip.id, {
														fadeOutUs: Math.round(sec * 1_000_000)
													});
												}}
												className="audio-fade-input"
											/>
										</div>
									</div>
									<div className="audio-fade-row">
										<span className="audio-fade-label">Fade Curve</span>
										<select
											value={selectedClip.fadeCurve ?? 'equalPower'}
											onChange={(e) => {
												store.getState().setClipFade(selectedClip.id, {
													fadeCurve: e.target.value as 'equalPower' | 'linear'
												});
											}}
											className="tracking-select"
										>
											<option value="equalPower">Equal Power (sin)</option>
											<option value="linear">Linear</option>
										</select>
									</div>
								</div>
							</div>

							{/* Applied Audio Effects Stack */}
							<div className="mt-3 border-t border-[var(--color-hairline)] pt-2">
								<div className="mb-1.5 flex items-center justify-between">
									<span className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase">
										Audio Effects ({selectedClip.audioEffects?.length ?? 0})
									</span>
								</div>
								{!selectedClip.audioEffects || selectedClip.audioEffects.length === 0 ? (
									<p className="text-[10px] text-[var(--color-text-tertiary)] italic">
										No audio effects applied. Use Effects panel to add audio effects.
									</p>
								) : (
									<div className="space-y-1.5">
										{selectedClip.audioEffects.map((fx) => (
											<div
												key={fx.id}
												className="flex items-center justify-between rounded border border-[var(--color-hairline)] bg-[var(--color-surface-sunken)] px-2 py-1 text-[11px]"
											>
												<span className={fx.bypass ? 'line-through opacity-50' : 'font-medium'}>
													{audioEffectRegistry.get(fx.type)?.name ?? fx.type}
												</span>
												<div className="flex items-center gap-1">
													<button
														type="button"
														onClick={() => {
															const next = selectedClip.audioEffects!.map((item) =>
																item.id === fx.id ? { ...item, bypass: !item.bypass } : item
															);
															store.getState().setClipAudioEffects(selectedClip.id, next);
														}}
														className={`cursor-pointer rounded px-1.5 py-0.5 text-[9px] font-bold ${
															fx.bypass ? 'bg-[#334155] text-[#94a3b8]' : 'bg-[#0284c7] text-white'
														}`}
														title={fx.bypass ? 'Enable effect' : 'Bypass effect'}
													>
														fx
													</button>
													<button
														type="button"
														onClick={() => {
															const next = selectedClip.audioEffects!.filter(
																(item) => item.id !== fx.id
															);
															store.getState().setClipAudioEffects(selectedClip.id, next);
														}}
														className="cursor-pointer px-1 text-[11px] text-red-400 hover:text-red-300"
														title="Remove effect"
													>
														✕
													</button>
												</div>
											</div>
										))}
									</div>
								)}
							</div>
						</div>
					)}
				</section>
			)}

			{/* Crop Section (hidden on adjustment layers) */}
			{!isAdjustment && (
				<section className={`inspector-section ${isCropExpanded ? 'is-open' : ''}`}>
					<button
						type="button"
						className="inspector-section-header"
						onClick={() => store.getState().setInspectorExpanded('crop', !isCropExpanded)}
						aria-expanded={isCropExpanded}
					>
						<span className="inspector-section-title">
							<ChevronIcon />
							Crop
						</span>
					</button>
					{isCropExpanded && (
						<div className="inspector-section-content">
							<PropertyRow
								clip={selectedClip}
								propertyId="crop"
								localTime={localTime}
								fps={project.settings.fps}
								confirmDisable={confirmDisable}
								onStartDisableConfirm={setConfirmDisable}
								onCancelDisableConfirm={() => setConfirmDisable(null)}
							/>
						</div>
					)}
				</section>
			)}

			{/* Time Remapping Section */}
			<section className={`inspector-section ${isSpeedExpanded ? 'is-open' : ''}`}>
				<button
					type="button"
					className="inspector-section-header"
					onClick={() => store.getState().setInspectorExpanded('speed', !isSpeedExpanded)}
					aria-expanded={isSpeedExpanded}
				>
					<span className="inspector-section-title">
						<ChevronIcon />
						Speed & Time Remap
						{selectedClip.timeRemap && (
							<span className="section-badge" style={{ marginLeft: 6, fontSize: '0.6875rem' }}>
								(Curve)
							</span>
						)}
					</span>
				</button>
				{isSpeedExpanded && (
					<div className="inspector-section-content">
						<TimeRemapSection
							clip={selectedClip}
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
					</div>
				)}
			</section>

			{/* Masks Section */}
			<section className={`inspector-section ${isMasksExpanded ? 'is-open' : ''}`}>
				<button
					type="button"
					className="inspector-section-header"
					onClick={() => store.getState().setInspectorExpanded('masks', !isMasksExpanded)}
					aria-expanded={isMasksExpanded}
				>
					<span className="inspector-section-title">
						<ChevronIcon />
						Masks
						{selectedClip.masks && selectedClip.masks.length > 0 && (
							<span className="section-badge" style={{ marginLeft: 6, fontSize: '0.6875rem' }}>
								({selectedClip.masks.length})
							</span>
						)}
					</span>
				</button>
				{isMasksExpanded && (
					<div className="inspector-section-content">
						<MasksSection
							clip={selectedClip}
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
					</div>
				)}
			</section>

			{/* Motion Tracking Section */}
			{!isText && !isSolid && !isAdjustment && (
				<section
					className={`inspector-section ${inspector.expanded.tracking !== false ? 'is-open' : ''}`}
				>
					<button
						type="button"
						className="inspector-section-header"
						onClick={() =>
							store
								.getState()
								.setInspectorExpanded('tracking', inspector.expanded.tracking === false)
						}
						aria-expanded={inspector.expanded.tracking !== false}
					>
						<span className="inspector-section-title">
							<ChevronIcon />
							Motion Tracking
							{selectedClip.trackers && selectedClip.trackers.length > 0 && (
								<span className="section-badge" style={{ marginLeft: 6, fontSize: '0.6875rem' }}>
									({selectedClip.trackers.length})
								</span>
							)}
						</span>
					</button>
					{inspector.expanded.tracking !== false && (
						<div className="inspector-section-content">
							<TrackingSection clip={selectedClip} fps={project.settings.fps} />
						</div>
					)}
				</section>
			)}

			{/* Effects Section */}
			<section className={`inspector-section ${isEffectsExpanded ? 'is-open' : ''}`}>
				<button
					type="button"
					className="inspector-section-header"
					onClick={() => store.getState().setInspectorExpanded('effects', !isEffectsExpanded)}
					aria-expanded={isEffectsExpanded}
				>
					<span className="inspector-section-title">
						<ChevronIcon />
						Effects
						{selectedClip.effects && selectedClip.effects.length > 0 && (
							<span className="section-badge" style={{ marginLeft: 6, fontSize: '0.6875rem' }}>
								({selectedClip.effects.length})
							</span>
						)}
					</span>
				</button>
				{isEffectsExpanded && (
					<div className="inspector-section-content">
						<EffectsSection
							clip={selectedClip}
							localTime={localTime}
							fps={project.settings.fps}
							confirmDisable={confirmDisable}
							onStartDisableConfirm={setConfirmDisable}
							onCancelDisableConfirm={() => setConfirmDisable(null)}
						/>
					</div>
				)}
			</section>
		</div>
	);
}

interface PropertyRowProps {
	clip: Clip;
	propertyId: PropertyId;
	localTime: Time;
	fps: number;
	linkScale?: boolean;
	onToggleLinkScale?: () => void;
	confirmDisable: ConfirmDisableState | null;
	onStartDisableConfirm: (state: ConfirmDisableState) => void;
	onCancelDisableConfirm: () => void;
}

export function PropertyRow({
	clip,
	propertyId,
	localTime,
	fps,
	linkScale,
	onToggleLinkScale,
	confirmDisable,
	onStartDisableConfirm,
	onCancelDisableConfirm
}: PropertyRowProps) {
	const store = useEditorStoreApi();
	const desc = descriptorFor(propertyId);
	if (!desc) return null;

	const curve = propertyCurve(clip, propertyId);
	const animated = Boolean(curve && isAnimated(curve));
	const evaluatedValue = readProperty(clip, propertyId, localTime);
	const snappedTime = snapLocalTime(clip, localTime, fps);
	const hasKeyframe = hasKeyframeAt(clip, propertyId, snappedTime);
	const prevKey = animated ? prevKeyframeTime(clip, [propertyId], localTime) : null;
	const nextKey = animated ? nextKeyframeTime(clip, [propertyId], localTime) : null;

	const isConfirmingDisable =
		confirmDisable?.clipId === clip.id && confirmDisable?.propertyId === propertyId;

	const handleStopwatchClick = () => {
		if (!animated) {
			store.getState().enableAnimation(clip.id, propertyId);
		} else {
			const keyCount = curve && isAnimated(curve) ? curve.keyframes.length : 0;
			if (keyCount > 1) {
				onStartDisableConfirm({ clipId: clip.id, propertyId });
			} else {
				store.getState().disableAnimation(clip.id, propertyId, 'flatten-current');
			}
		}
	};

	const handleReset = () => {
		const defaultVal = desc.defaultValue;
		store.getState().setProperty(clip.id, propertyId, defaultVal, { autoKey: true });
	};

	// Determine if value is different from default
	const isDefault = Array.isArray(evaluatedValue)
		? (desc.defaultValue as number[]).every(
				(v, i) => Math.abs(v - (evaluatedValue as number[])[i]!) < 0.0001
			)
		: Math.abs((desc.defaultValue as number) - (evaluatedValue as number)) < 0.0001;

	return (
		<div className="property-row">
			<div className="property-header">
				<div className="property-meta">
					<button
						type="button"
						className={`property-stopwatch ${animated ? 'is-active' : ''}`}
						onClick={handleStopwatchClick}
						title={animated ? 'Disable animation' : 'Enable animation'}
						aria-label={`${animated ? 'Disable' : 'Enable'} animation for ${desc.label}`}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<circle cx="12" cy="14" r="8" />
							<line x1="12" y1="2" x2="12" y2="6" />
							<line x1="12" y1="14" x2="15" y2="11" />
						</svg>
					</button>
					<span className="property-label" title={desc.label}>
						{desc.label}
					</span>
				</div>

				<div className="property-controls">
					{animated && (
						<div className="keyframe-nav">
							<button
								type="button"
								className="keyframe-nav-btn"
								disabled={prevKey === null}
								onClick={() => {
									if (prevKey !== null) store.getState().setPlayhead(clip.start + prevKey);
								}}
								title="Previous keyframe (J)"
								aria-label="Previous keyframe"
							>
								<svg
									width="10"
									height="10"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="15 18 9 12 15 6" />
								</svg>
							</button>
							<button
								type="button"
								className="keyframe-diamond-btn"
								onClick={() => store.getState().toggleKeyframe(clip.id, propertyId)}
								title={hasKeyframe ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'}
								aria-label={hasKeyframe ? 'Remove keyframe' : 'Add keyframe'}
							>
								<svg
									width="10"
									height="10"
									viewBox="0 0 24 24"
									fill={hasKeyframe ? 'currentColor' : 'none'}
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polygon points="12 2 22 12 12 22 2 12" />
								</svg>
							</button>
							<button
								type="button"
								className="keyframe-nav-btn"
								disabled={nextKey === null}
								onClick={() => {
									if (nextKey !== null) store.getState().setPlayhead(clip.start + nextKey);
								}}
								title="Next keyframe (K)"
								aria-label="Next keyframe"
							>
								<svg
									width="10"
									height="10"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="9 18 15 12 9 6" />
								</svg>
							</button>
						</div>
					)}
					{!isDefault && (
						<button
							type="button"
							className="property-reset"
							onClick={handleReset}
							title="Reset to default"
							aria-label={`Reset ${desc.label} to default`}
						>
							<svg
								width="11"
								height="11"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
								<polyline points="3 3 3 8 8 8" />
							</svg>
						</button>
					)}
				</div>
			</div>

			{isConfirmingDisable && (
				<div className="disable-confirm-box">
					<span>Turn off animation? Existing keyframes will be removed.</span>
					<div className="disable-confirm-actions">
						<button
							type="button"
							className="disable-confirm-btn"
							onClick={() => {
								store.getState().disableAnimation(clip.id, propertyId, 'flatten-current');
								onCancelDisableConfirm();
							}}
						>
							Flatten
						</button>
						<button
							type="button"
							className="disable-confirm-btn is-danger"
							onClick={() => {
								store.getState().disableAnimation(clip.id, propertyId, 'discard');
								onCancelDisableConfirm();
							}}
						>
							Discard
						</button>
						<button type="button" className="disable-confirm-btn" onClick={onCancelDisableConfirm}>
							Cancel
						</button>
					</div>
				</div>
			)}

			<div className="property-inputs-wrapper">
				{desc.shape === 'vec4' &&
				desc.channels.length === 4 &&
				desc.channels[0] === 'R' &&
				desc.channels[1] === 'G' &&
				desc.channels[2] === 'B' &&
				desc.channels[3] === 'A' ? (
					<ColorPickerField
						value={
							Array.isArray(evaluatedValue) && evaluatedValue.length >= 4
								? [evaluatedValue[0]!, evaluatedValue[1]!, evaluatedValue[2]!, evaluatedValue[3]!]
								: [1, 1, 1, 1]
						}
						onChange={(nextRgba, coalesce) => {
							store.getState().setProperty(clip.id, propertyId, nextRgba, {
								autoKey: true,
								coalesce
							});
						}}
						label={desc.label}
						hasAlpha={true}
						gradient={
							propertyId === 'text.fillColor' && clip.source?.type === 'text'
								? {
										type: clip.source.box?.gradientType ?? 'none',
										colorEnd: clip.source.box?.gradientColorEnd,
										angle: clip.source.box?.gradientAngle ?? 90
									}
								: undefined
						}
						onGradientChange={
							propertyId === 'text.fillColor' && clip.source?.type === 'text'
								? ({ type, colorEnd, angle }) => {
										store.getState().setTextGradient(clip.id, {
											gradientType: type,
											gradientColorEnd: {
												r: colorEnd[0],
												g: colorEnd[1],
												b: colorEnd[2],
												a: colorEnd[3]
											},
											gradientAngle: angle
										});
									}
								: undefined
						}
					/>
				) : (
					<div className="property-inputs">
						{desc.channels.map((channelLabel, channelIdx) => (
							<ChannelField
								key={channelLabel}
								clip={clip}
								desc={desc}
								channelIdx={channelIdx}
								channelLabel={channelLabel}
								evaluatedValue={evaluatedValue}
								linkScale={linkScale}
							/>
						))}
					</div>
				)}
				{propertyId === 'scale' && onToggleLinkScale && (
					<button
						type="button"
						className={`link-scale-btn ${linkScale ? 'is-linked' : ''}`}
						onClick={onToggleLinkScale}
						title={linkScale ? 'Scale linked (proportional)' : 'Scale unlinked'}
						aria-label={linkScale ? 'Unlink scale axes' : 'Link scale axes'}
					>
						{linkScale ? (
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
								<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
							</svg>
						) : (
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								style={{ opacity: 0.55 }}
							>
								<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
								<path d="m5.16 11.75-1.72 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
								<line x1="2" y1="2" x2="22" y2="22" />
							</svg>
						)}
					</button>
				)}
			</div>
		</div>
	);
}

interface ChannelFieldProps {
	clip: Clip;
	desc: PropertyDescriptor;
	channelIdx: number;
	channelLabel: string;
	evaluatedValue: PropertyValue;
	linkScale?: boolean;
}

function ChannelField({
	clip,
	desc,
	channelIdx,
	channelLabel,
	evaluatedValue,
	linkScale
}: ChannelFieldProps) {
	const store = useEditorStoreApi();

	const numericValue = Array.isArray(evaluatedValue)
		? (evaluatedValue[channelIdx] ?? 0)
		: evaluatedValue;

	const displayVal = Number((numericValue * desc.displayFactor).toFixed(2));
	const [textDraft, setTextDraft] = useState<string | null>(null);
	const isDraggingRef = useRef(false);
	const startDragPos = useRef(0);
	const startDragVal = useRef(0);
	const dragSessionIdRef = useRef<string | null>(null);

	const commitValue = useCallback(
		(nextDisplayVal: number, coalesce: boolean, sessionId?: string) => {
			if (!Number.isFinite(nextDisplayVal)) return;
			const storedSingle = nextDisplayVal / desc.displayFactor;
			const mergeKey = sessionId ? `scrub:${clip.id}:${desc.id}:${sessionId}` : undefined;
			const coalesceWindowMs = sessionId ? 3600000 : undefined;

			if (desc.shape === 'number') {
				store.getState().setProperty(clip.id, desc.id, storedSingle, {
					autoKey: true,
					coalesce,
					mergeKey,
					coalesceWindowMs
				});
			} else {
				const currentArr = Array.isArray(evaluatedValue)
					? [...evaluatedValue]
					: [evaluatedValue, evaluatedValue];
				const oldChannelVal = currentArr[channelIdx] ?? 1;
				currentArr[channelIdx] = storedSingle;

				// Linked scale handling:
				if (desc.id === 'scale' && linkScale) {
					const otherIdx = channelIdx === 0 ? 1 : 0;
					const oldOtherVal = currentArr[otherIdx] ?? 1;
					if (Math.abs(oldChannelVal) > 0.0001) {
						const ratio = oldOtherVal / oldChannelVal;
						currentArr[otherIdx] = storedSingle * ratio;
					} else {
						currentArr[otherIdx] = storedSingle;
					}
				}

				store.getState().setProperty(clip.id, desc.id, currentArr, {
					autoKey: true,
					editedChannel: channelIdx,
					coalesce,
					mergeKey,
					coalesceWindowMs
				});
			}
		},
		[clip.id, desc, channelIdx, evaluatedValue, linkScale, store]
	);

	const isCommittedRef = useRef(false);

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			if (textDraft !== null) {
				const parsed = parseFloat(textDraft);
				isCommittedRef.current = true;
				setTextDraft(null);
				if (!Number.isNaN(parsed)) commitValue(parsed, false);
			}
			e.currentTarget.blur();
		} else if (e.key === 'Escape') {
			isCommittedRef.current = true;
			setTextDraft(null);
			e.currentTarget.blur();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
			const step = desc.step * multiplier * (e.key === 'ArrowUp' ? 1 : -1);
			const current = textDraft !== null ? parseFloat(textDraft) || displayVal : displayVal;
			const next = current + step;
			commitValue(next, false);
			setTextDraft(String(Number(next.toFixed(2))));
		}
	};

	const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
		isCommittedRef.current = false;
		setTextDraft(e.target.value);
	};

	const handleBlur = () => {
		if (isCommittedRef.current) {
			isCommittedRef.current = false;
			return;
		}
		if (textDraft !== null) {
			const parsed = parseFloat(textDraft);
			setTextDraft(null);
			if (!Number.isNaN(parsed)) commitValue(parsed, false);
		}
	};

	const handlePointerDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
		e.preventDefault();
		isDraggingRef.current = true;
		startDragPos.current = e.clientX;
		startDragVal.current = displayVal;
		dragSessionIdRef.current = `scrub-${clip.id}-${desc.id}-${channelIdx}-${Date.now()}`;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	};

	const handlePointerMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
		if (!isDraggingRef.current) return;
		const deltaPx = e.clientX - startDragPos.current;
		const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
		const next = startDragVal.current + deltaPx * desc.step * 0.5 * multiplier;
		commitValue(next, true, dragSessionIdRef.current ?? undefined);
	};

	const handlePointerUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
		if (!isDraggingRef.current) return;
		isDraggingRef.current = false;
		dragSessionIdRef.current = null;
		try {
			(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {}
	};

	const valueToShow = textDraft !== null ? textDraft : String(displayVal);

	return (
		<div className="channel-field">
			<span
				className="channel-label"
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				title={`Drag to adjust ${channelLabel}`}
			>
				{channelLabel}
			</span>
			<input
				type="text"
				inputMode="decimal"
				className="channel-input"
				value={valueToShow}
				onChange={handleChange}
				onKeyDown={handleKeyDown}
				onBlur={handleBlur}
				aria-label={desc.shape === 'number' ? desc.label : `${desc.label} ${channelLabel}`}
			/>
			<span className="channel-unit">{desc.unit}</span>
		</div>
	);
}
