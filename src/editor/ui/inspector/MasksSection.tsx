import { useState, type ChangeEvent } from 'react';
import {
	hasKeyframeAt,
	isAnimated,
	nextKeyframeTime,
	pointsToPathShape,
	prevKeyframeTime,
	propertyCurve,
	snapLocalTime,
	type Clip,
	type Mask,
	type PropertyId
} from '../../core';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { PropertyRow, type ConfirmDisableState } from './Inspector';

interface MasksSectionProps {
	clip: Clip;
	localTime: number;
	fps: number;
	confirmDisable?: ConfirmDisableState | null;
	onStartDisableConfirm?: (state: ConfirmDisableState) => void;
	onCancelDisableConfirm?: () => void;
}

export default function MasksSection({
	clip,
	localTime,
	fps,
	confirmDisable = null,
	onStartDisableConfirm = () => {},
	onCancelDisableConfirm = () => {}
}: MasksSectionProps) {
	const store = useEditorStoreApi();
	const selectedMaskId = useEditorStore((state) => state.maskTool.selectedMaskId);
	const selectedPointIndex = useEditorStore((state) => state.maskTool.selectedPointIndex);
	const maskTool = useEditorStore((state) => state.maskTool);
	const masks = clip.masks ?? [];
	const [expandedMaskId, setExpandedMaskId] = useState<string | null>(
		masks.length > 0 ? masks[0]!.id : null
	);

	const handleAddMask = (type: 'rect' | 'ellipse' | 'path') => {
		const newId = store.getState().addMask(clip.id, type);
		if (newId) {
			setExpandedMaskId(newId);
		}
	};

	const handleDeleteMask = (maskId: string) => {
		store.getState().removeMask(clip.id, maskId);
		if (expandedMaskId === maskId) {
			setExpandedMaskId(null);
		}
	};

	const handleToggleEnable = (mask: Mask) => {
		store.getState().updateMask(clip.id, mask.id, {
			enabled: mask.enabled === false ? true : false
		});
	};

	const handleToggleInvert = (mask: Mask) => {
		store.getState().updateMask(clip.id, mask.id, {
			inverted: !mask.inverted
		});
	};

	const handleModeChange = (mask: Mask, e: ChangeEvent<HTMLSelectElement>) => {
		store.getState().updateMask(clip.id, mask.id, {
			mode: e.target.value as 'add' | 'subtract' | 'intersect'
		});
	};

	const handleEffectLinkChange = (mask: Mask, e: ChangeEvent<HTMLSelectElement>) => {
		const effectId = e.target.value ? e.target.value : undefined;
		store.getState().updateMask(clip.id, mask.id, { effectId });
	};

	const handleReorder = (fromIdx: number, toIdx: number) => {
		store.getState().reorderMask(clip.id, fromIdx, toIdx);
	};

	return (
		<div className="masks-section">
			{/* Add mask button bar */}
			<div className="mask-add-bar">
				<button
					type="button"
					className="mask-type-btn"
					onClick={() => handleAddMask('rect')}
					title="Add rectangle mask"
					aria-label="Add rectangle mask"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
					</svg>
					Rectangle
				</button>
				<button
					type="button"
					className="mask-type-btn"
					onClick={() => handleAddMask('ellipse')}
					title="Add ellipse mask"
					aria-label="Add ellipse mask"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<ellipse cx="8" cy="8" rx="5.5" ry="4.5" />
					</svg>
					Ellipse
				</button>
				<button
					type="button"
					className="mask-type-btn"
					onClick={() => handleAddMask('path')}
					title="Add freeform bezier path mask"
					aria-label="Add path mask"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M3 13L4.5 9.5L11.5 2.5C12 2 13 2 13.5 2.5C14 3 14 4 13.5 4.5L6.5 11.5L3 13Z" />
						<circle cx="12.5" cy="3.5" r="0.5" fill="currentColor" />
					</svg>
					Path
				</button>
				{masks.length > 0 && (
					<button
						type="button"
						className={`mask-type-btn ${maskTool.showOverlay ? 'is-active' : ''}`}
						onClick={() => store.getState().setMaskOverlayVisible(!maskTool.showOverlay)}
						title="Toggle mask overlay on canvas"
						aria-label="Toggle mask overlay on canvas"
						style={{ marginLeft: 'auto' }}
					>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
						>
							<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
							<circle cx="12" cy="12" r="3" />
						</svg>
						{maskTool.showOverlay ? 'Overlay' : 'Hidden'}
					</button>
				)}
			</div>

			{masks.length === 0 ? (
				<p
					className="inspector-hint"
					style={{ margin: '8px 0', fontSize: '0.75rem', opacity: 0.7 }}
				>
					No masks on this clip. Click above to add a shape mask.
				</p>
			) : (
				<div className="mask-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
					{masks.map((mask, idx) => {
						const isExpanded = expandedMaskId === mask.id;
						const isSelected = selectedMaskId === mask.id;

						return (
							<div
								key={mask.id}
								className={`mask-card ${isSelected ? 'is-selected' : ''}`}
								style={{
									border: isSelected
										? '1px solid var(--color-accent, #6366f1)'
										: '1px solid rgba(255, 255, 255, 0.1)',
									borderRadius: 6,
									padding: 8,
									background: 'rgba(255, 255, 255, 0.03)'
								}}
							>
								{/* Card Header */}
								<div
									className="mask-card-header"
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 6,
										cursor: 'pointer',
										userSelect: 'none'
									}}
									onClick={() => {
										setExpandedMaskId(isExpanded ? null : mask.id);
										store.getState().selectMask(mask.id);
									}}
								>
									<svg
										style={{
											transform: isExpanded ? 'rotate(90deg)' : 'none',
											transition: 'transform 0.15s ease',
											opacity: 0.65,
											flexShrink: 0
										}}
										width="10"
										height="10"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.5"
										strokeLinecap="round"
										strokeLinejoin="round"
										aria-hidden="true"
									>
										<polyline points="9 18 15 12 9 6" />
									</svg>
									<input
										type="checkbox"
										checked={mask.enabled !== false}
										onChange={(e) => {
											e.stopPropagation();
											handleToggleEnable(mask);
										}}
										aria-label={`Enable ${mask.name ?? mask.type}`}
										title="Toggle mask enabled"
										style={{ cursor: 'pointer' }}
									/>
									<span style={{ fontWeight: 500, fontSize: '0.8125rem', flex: 1 }}>
										{mask.name ?? `${mask.type.charAt(0).toUpperCase() + mask.type.slice(1)} Mask`}
									</span>
									<span
										className="badge"
										style={{
											fontSize: '0.625rem',
											padding: '2px 4px',
											background: 'rgba(255,255,255,0.08)',
											borderRadius: 4
										}}
									>
										{mask.type}
									</span>
									<button
										type="button"
										className="mask-btn-ghost mask-btn-danger"
										onClick={(e) => {
											e.stopPropagation();
											handleDeleteMask(mask.id);
										}}
										title="Delete mask"
										aria-label={`Delete mask ${mask.id}`}
									>
										✕
									</button>
								</div>

								{/* Card Content */}
								{isExpanded && (
									<div
										className="mask-card-body"
										style={{
											display: 'flex',
											flexDirection: 'column',
											gap: 8,
											marginTop: 8,
											paddingTop: 8,
											borderTop: '1px solid rgba(255,255,255,0.06)'
										}}
									>
										{/* Combine Mode & Invert */}
										<div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
											<label
												style={{
													fontSize: '0.75rem',
													display: 'flex',
													alignItems: 'center',
													gap: 4
												}}
											>
												Mode:
												<select
													value={mask.mode}
													onChange={(e) => handleModeChange(mask, e)}
													style={{
														background: 'rgba(0,0,0,0.3)',
														color: 'inherit',
														border: '1px solid rgba(255,255,255,0.15)',
														borderRadius: 4,
														fontSize: '0.75rem',
														padding: '2px 4px'
													}}
												>
													<option value="add">Add</option>
													<option value="subtract">Subtract</option>
													<option value="intersect">Intersect</option>
												</select>
											</label>

											<label
												style={{
													fontSize: '0.75rem',
													display: 'flex',
													alignItems: 'center',
													gap: 4,
													cursor: 'pointer'
												}}
											>
												<input
													type="checkbox"
													checked={mask.inverted}
													onChange={() => handleToggleInvert(mask)}
												/>
												Inverted
											</label>
										</div>

										{/* Effect Link */}
										{clip.effects && clip.effects.length > 0 && (
											<div
												style={{
													display: 'flex',
													alignItems: 'center',
													gap: 6,
													fontSize: '0.75rem'
												}}
											>
												<span>Apply to:</span>
												<select
													value={mask.effectId ?? ''}
													onChange={(e) => handleEffectLinkChange(mask, e)}
													style={{
														background: 'rgba(0,0,0,0.3)',
														color: 'inherit',
														border: '1px solid rgba(255,255,255,0.15)',
														borderRadius: 4,
														fontSize: '0.75rem',
														padding: '2px 4px',
														flex: 1
													}}
												>
													<option value="">Full Clip Alpha</option>
													{clip.effects.map((eff) => (
														<option key={eff.id} value={eff.id}>
															Effect: {eff.type}
														</option>
													))}
												</select>
											</div>
										)}

										{/* Shape Keyframing Row */}
										{(() => {
											const shapePropId = `mask:${mask.id}:shape` as PropertyId;
											const shapeCurve = propertyCurve(clip, shapePropId);
											const isShapeAnimated = Boolean(shapeCurve && isAnimated(shapeCurve));
											const snappedTime = snapLocalTime(clip, localTime, fps);
											const hasShapeKey = hasKeyframeAt(clip, shapePropId, snappedTime);
											const prevShapeKey = isShapeAnimated
												? prevKeyframeTime(clip, [shapePropId], localTime)
												: null;
											const nextShapeKey = isShapeAnimated
												? nextKeyframeTime(clip, [shapePropId], localTime)
												: null;

											const handleToggleShapeAnimation = () => {
												if (!isShapeAnimated) {
													const coords =
														mask.type === 'path' && mask.points && mask.points.length > 0
															? pointsToPathShape(mask.points)
															: mask.shape
																? [...mask.shape]
																: [];
													store.getState().enableAnimation(clip.id, shapePropId);
													if (coords.length > 0) {
														store
															.getState()
															.setProperty(clip.id, shapePropId, coords, { autoKey: true });
													}
												} else {
													store
														.getState()
														.disableAnimation(clip.id, shapePropId, 'flatten-current');
												}
											};

											return (
												<div className="property-row">
													<div className="property-header">
														<div className="property-meta">
															<button
																type="button"
																className={`property-stopwatch ${isShapeAnimated ? 'is-active' : ''}`}
																onClick={handleToggleShapeAnimation}
																title={
																	isShapeAnimated
																		? 'Disable shape animation'
																		: 'Enable shape animation'
																}
																aria-label={`${isShapeAnimated ? 'Disable' : 'Enable'} shape animation`}
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
															<span className="property-label">Mask Shape</span>
														</div>

														<div className="property-controls">
															{clip.trackers && clip.trackers.length > 0 && (
																<select
																	defaultValue=""
																	onChange={(e) => {
																		const trkId = e.target
																			.value as import('../../core/types').TrackerId;
																		if (trkId) {
																			store
																				.getState()
																				.bakeTrackerToMask(clip.id, mask.id, trkId, 0.5);
																			e.target.value = '';
																		}
																	}}
																	className="rounded border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[10px]"
																	title="Track mask to motion tracker"
																	aria-label="Track mask to motion tracker"
																>
																	<option value="" disabled>
																		Track with...
																	</option>
																	{clip.trackers.map((t) => (
																		<option key={t.id} value={t.id}>
																			{t.name}
																		</option>
																	))}
																</select>
															)}
															{isShapeAnimated && (
																<div className="keyframe-nav">
																	<button
																		type="button"
																		className="keyframe-nav-btn"
																		disabled={prevShapeKey === null}
																		onClick={() => {
																			if (prevShapeKey !== null)
																				store.getState().setPlayhead(clip.start + prevShapeKey);
																		}}
																		title="Previous shape keyframe"
																		aria-label="Previous shape keyframe"
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
																		onClick={() => {
																			store.getState().toggleKeyframe(clip.id, shapePropId);
																		}}
																		title={
																			hasShapeKey
																				? 'Remove shape keyframe at playhead'
																				: 'Add shape keyframe at playhead'
																		}
																		aria-label={
																			hasShapeKey ? 'Remove shape keyframe' : 'Add shape keyframe'
																		}
																	>
																		<svg
																			width="10"
																			height="10"
																			viewBox="0 0 24 24"
																			fill={hasShapeKey ? 'currentColor' : 'none'}
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
																		disabled={nextShapeKey === null}
																		onClick={() => {
																			if (nextShapeKey !== null)
																				store.getState().setPlayhead(clip.start + nextShapeKey);
																		}}
																		title="Next shape keyframe"
																		aria-label="Next shape keyframe"
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
														</div>
													</div>
												</div>
											);
										})()}

										{/* Feather, Expansion, Opacity PropertyRows */}
										<PropertyRow
											clip={clip}
											propertyId={`mask:${mask.id}:feather` as PropertyId}
											localTime={localTime}
											fps={fps}
											confirmDisable={confirmDisable}
											onStartDisableConfirm={onStartDisableConfirm}
											onCancelDisableConfirm={onCancelDisableConfirm}
										/>
										<PropertyRow
											clip={clip}
											propertyId={`mask:${mask.id}:expansion` as PropertyId}
											localTime={localTime}
											fps={fps}
											confirmDisable={confirmDisable}
											onStartDisableConfirm={onStartDisableConfirm}
											onCancelDisableConfirm={onCancelDisableConfirm}
										/>
										<PropertyRow
											clip={clip}
											propertyId={`mask:${mask.id}:opacity` as PropertyId}
											localTime={localTime}
											fps={fps}
											confirmDisable={confirmDisable}
											onStartDisableConfirm={onStartDisableConfirm}
											onCancelDisableConfirm={onCancelDisableConfirm}
										/>

										{/* Shape specific readouts / buttons */}
										{mask.type === 'path' && (
											<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
												<div
													style={{
														display: 'flex',
														justifyContent: 'space-between',
														alignItems: 'center',
														fontSize: '0.75rem'
													}}
												>
													<span style={{ opacity: 0.8 }}>
														{mask.points?.length ??
															(mask.shape ? Math.floor(mask.shape.length / 6) : 0)}{' '}
														points
													</span>
													<button
														type="button"
														className="mask-btn-secondary"
														onClick={() => {
															store
																.getState()
																.updateMask(clip.id, mask.id, { closed: !mask.closed });
														}}
													>
														{mask.closed ? 'Open Path' : 'Close Path'}
													</button>
												</div>

												{/* Selected point actions */}
												{selectedPointIndex !== null && selectedMaskId === mask.id && (
													<div
														style={{
															display: 'flex',
															alignItems: 'center',
															justifyContent: 'space-between',
															background: 'rgba(255, 255, 255, 0.05)',
															padding: '4px 8px',
															borderRadius: 4,
															fontSize: '0.72rem'
														}}
													>
														<span>Point #{selectedPointIndex + 1}</span>
														<div style={{ display: 'flex', gap: 4 }}>
															<button
																type="button"
																className="mask-btn-ghost"
																onClick={() => {
																	const pts = (mask.points ?? []).map((p) => ({
																		...p,
																		inHandle: p.inHandle ? { ...p.inHandle } : undefined,
																		outHandle: p.outHandle ? { ...p.outHandle } : undefined
																	}));
																	const pt = pts[selectedPointIndex];
																	if (!pt) return;
																	if (pt.inHandle || pt.outHandle) {
																		delete pt.inHandle;
																		delete pt.outHandle;
																	} else {
																		const prev =
																			pts[(selectedPointIndex - 1 + pts.length) % pts.length]!;
																		const next = pts[(selectedPointIndex + 1) % pts.length]!;
																		pt.inHandle = {
																			x: -(next.x - prev.x) * 0.15,
																			y: -(next.y - prev.y) * 0.15
																		};
																		pt.outHandle = {
																			x: (next.x - prev.x) * 0.15,
																			y: (next.y - prev.y) * 0.15
																		};
																	}
																	store.getState().updateMask(clip.id, mask.id, { points: pts });
																}}
																title="Toggle smooth curves / sharp corner"
															>
																Smooth/Sharp
															</button>
															<button
																type="button"
																className="mask-btn-ghost mask-btn-danger"
																disabled={(mask.points?.length ?? 0) <= 3}
																onClick={() => {
																	const pts = (mask.points ?? []).filter(
																		(_, idx) => idx !== selectedPointIndex
																	);
																	store.getState().updateMask(clip.id, mask.id, { points: pts });
																	store.getState().selectMaskPoint(null);
																}}
																title="Delete selected point"
															>
																Delete
															</button>
														</div>
													</div>
												)}

												<p style={{ margin: 0, fontSize: '0.68rem', opacity: 0.6 }}>
													Click path edge in preview to add points. Drag handles to curve.
												</p>
											</div>
										)}

										{/* Reorder buttons */}
										<div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
											<button
												type="button"
												className="mask-btn-ghost"
												disabled={idx === 0}
												onClick={() => handleReorder(idx, idx - 1)}
												title="Move mask up"
											>
												↑ Move Up
											</button>
											<button
												type="button"
												className="mask-btn-ghost"
												disabled={idx === masks.length - 1}
												onClick={() => handleReorder(idx, idx + 1)}
												title="Move mask down"
											>
												↓ Move Down
											</button>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
