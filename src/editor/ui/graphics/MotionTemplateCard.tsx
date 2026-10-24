import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MotionGraphicTemplate } from '../../core/templates/templateTypes';
import {
	templatePreviewLoopTime,
	templatePreviewSettledTime
} from '../../core/templates/templatePreview';
import { getTemplatePreviewRenderer } from '../../services/render/templatePreview';
import { setTransparentDragImage, startDragGhost, stopDragGhost } from '../drag/dragOverlayService';
import { useEditorStoreApi } from '../../state/EditorProvider';

/** Checks whether any clip in the template has animated properties/keyframes or presets */
export function checkTemplateHasMotion(template: MotionGraphicTemplate): boolean {
	for (const track of template.tracks) {
		for (const clip of track.clips) {
			if (clip.properties) {
				for (const val of Object.values(clip.properties)) {
					if (
						val &&
						typeof val === 'object' &&
						'keyframes' in val &&
						Array.isArray((val as any).keyframes) &&
						(val as any).keyframes.length > 1
					) {
						return true;
					}
				}
			}
			if (
				clip.source?.type === 'text' &&
				(clip.source.animationPresetId || clip.source.graphicTemplateId)
			) {
				return true;
			}
		}
	}
	return false;
}

interface MotionTemplateCardProps {
	template: MotionGraphicTemplate;
	onAdd: () => void;
	onExport: () => void;
	onDelete?: () => void;
	onApply?: () => void;
}

export function MotionTemplateCard({
	template,
	onAdd,
	onExport,
	onDelete,
	onApply
}: MotionTemplateCardProps) {
	const store = useEditorStoreApi();
	const hasMotion = useMemo(() => checkTemplateHasMotion(template), [template]);

	const settledTime = useMemo(() => templatePreviewSettledTime(template), [template]);

	const [isHovered, setIsHovered] = useState(false);
	const [progress, setProgress] = useState(0);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	/** Paints the template at `time` through the shared renderer used by the Program monitor. */
	const paint = useCallback(
		(time: number) => {
			const canvas = canvasRef.current;
			const context = canvas?.getContext('2d');
			if (!canvas || !context) return Promise.resolve(false);
			return getTemplatePreviewRenderer().draw(template, time, {
				context,
				width: canvas.width,
				height: canvas.height
			});
		},
		[template]
	);

	// Still thumbnail whenever the card is idle.
	useEffect(() => {
		if (isHovered && hasMotion) return;
		setProgress(0);
		void paint(settledTime).catch((error: unknown) => {
			console.warn('Template preview failed.', error);
		});
	}, [isHovered, hasMotion, paint, settledTime]);

	// Looping playback while hovered; one frame in flight at a time.
	useEffect(() => {
		if (!isHovered || !hasMotion) return;
		let handle = 0;
		let startTime: number | null = null;
		let inFlight = false;
		let cancelled = false;
		// 2.2s loop duration for a snappy, pleasant preview
		const loopDurationMs = 2200;
		const tick = (now: number) => {
			if (cancelled) return;
			if (startTime === null) startTime = now;
			const fraction = ((now - startTime) % loopDurationMs) / loopDurationMs;
			if (!inFlight) {
				inFlight = true;
				setProgress(fraction);
				void paint(templatePreviewLoopTime(template, fraction))
					.catch((error: unknown) => console.warn('Template preview failed.', error))
					.finally(() => {
						inFlight = false;
					});
			}
			handle = requestAnimationFrame(tick);
		};
		handle = requestAnimationFrame(tick);
		return () => {
			cancelled = true;
			cancelAnimationFrame(handle);
		};
	}, [isHovered, hasMotion, paint, template]);

	// Drag start handler for timeline dropping
	const handleDragStart = (e: React.DragEvent) => {
		setTransparentDragImage(e.dataTransfer);
		startDragGhost({
			title: template.name,
			kind: 'graphic',
			badge: template.category
		});
		e.dataTransfer.setData('application/x-tfve-motion-template', JSON.stringify(template));
		e.dataTransfer.setData('text/plain', template.name);
		e.dataTransfer.effectAllowed = 'copy';
		store.getState().beginTimelineDrag({
			kind: 'graphic-template',
			clipIds: [],
			original: [],
			preview: [],
			pointerStartTime: 0,
			pointerTime: 0,
			graphicTemplateId: template.id,
			motionTemplate: template,
			allowed: true,
			unlink: false
		});
	};

	const handleDragEnd = () => {
		stopDragGhost();
		store.getState().cancelTimelineDrag();
	};

	const durationSec = (template.duration / 1_000_000).toFixed(1);
	const paramCount = template.publishedParams.length;

	return (
		<div
			className={`graphic-card custom-template-grid-card ${isHovered ? 'is-hovered' : ''}`}
			draggable
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDoubleClick={onAdd}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			role="listitem"
			aria-label={`${template.name} motion graphic template`}
			data-testid={`graphic-card-${template.id}`}
		>
			{/* Preview Box */}
			<div className="custom-template-preview-box">
				{/* Top Badges */}
				<div className="custom-template-header-badges">
					<span className="custom-template-cat-pill">{template.category}</span>
					{hasMotion ? (
						<span className={`custom-template-motion-pill ${isHovered ? 'is-playing' : ''}`}>
							{isHovered ? (
								<>
									<span className="pulse-indicator" /> Playing
								</>
							) : (
								`⚡ ${durationSec}s`
							)}
						</span>
					) : (
						<span className="custom-template-mogrt-pill">✦ MOGRT</span>
					)}
				</div>

				{/* Quick Action Overlay (Export & Delete) */}
				<div className="custom-template-hover-actions">
					<button
						type="button"
						className="custom-template-quick-btn"
						onClick={(e) => {
							e.stopPropagation();
							onExport();
						}}
						title="Export .grafree file"
						aria-label="Export template"
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="7 10 12 15 17 10" />
							<line x1="12" y1="15" x2="12" y2="3" />
						</svg>
					</button>
					{onDelete && (
						<button
							type="button"
							className="custom-template-quick-btn delete"
							onClick={(e) => {
								e.stopPropagation();
								onDelete();
							}}
							title="Delete template"
							aria-label="Delete template"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<line x1="18" y1="6" x2="6" y2="18" />
								<line x1="6" y1="6" x2="18" y2="18" />
							</svg>
						</button>
					)}
				</div>

				{/* Real renderer output, drawn from the shared preview canvas */}
				<div className="custom-template-svg-wrap">
					<canvas
						ref={canvasRef}
						width={384}
						height={216}
						className="custom-template-svg"
						data-testid={`graphic-card-canvas-${template.id}`}
					/>
				</div>

				{/* Scrub / Progress Bar during hover playback */}
				{hasMotion && isHovered && (
					<div className="custom-template-scrub-bar">
						<div
							className="custom-template-scrub-fill"
							style={{ width: `${Math.round(progress * 100)}%` }}
						/>
					</div>
				)}
			</div>

			{/* Card Footer */}
			<div className="graphic-card-footer">
				<div className="graphic-card-meta">
					<span className="graphic-card-title" title={template.name}>
						{template.name}
					</span>
					<span className="graphic-card-tag">
						{template.category} • {paramCount} {paramCount === 1 ? 'property' : 'properties'}
					</span>
				</div>
				<div className="graphic-card-actions">
					{onApply && (
						<button
							type="button"
							className="graphic-apply-btn"
							onClick={(e) => {
								e.stopPropagation();
								onApply();
							}}
							title="Apply style to selected clip"
						>
							Apply
						</button>
					)}
					<button
						type="button"
						className="graphic-add-btn"
						onClick={(e) => {
							e.stopPropagation();
							onAdd();
						}}
						title="Add to timeline at playhead"
					>
						+ Add
					</button>
				</div>
			</div>
		</div>
	);
}
export default MotionTemplateCard;
