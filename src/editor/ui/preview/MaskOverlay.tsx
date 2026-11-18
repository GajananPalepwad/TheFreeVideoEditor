import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent
} from 'react';
import {
	distanceToSegment,
	evaluateMask,
	flattenBezier,
	getSequence,
	isAnimated,
	layerAffine,
	propertyCurve,
	readProperty,
	resolveFrame,
	type Clip,
	type EvaluatedMask,
	type MaskPoint,
	type Point2D,
	type Project,
	type PropertyId
} from '../../core';
import { getTextDimensions } from '../../services/render/text/rasterizer';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';

interface MaskOverlayProps {
	project: Project;
	renderedWidth: number;
	renderedHeight: number;
}

type DragHandleType =
	| 'move'
	| 'rotate'
	| 'nw'
	| 'ne'
	| 'se'
	| 'sw'
	| 'n'
	| 'e'
	| 's'
	| 'w'
	| 'path-vertex'
	| 'path-in'
	| 'path-out';

interface DraggingPoint {
	maskId: string;
	pointIndex: number;
	handleType?: DragHandleType;
	handle?: 'in' | 'out';
	startPos: Point2D;
	originalShape: number[];
	originalPoints?: MaskPoint[];
}

interface HoverPathHit {
	maskId: string;
	segmentIndex: number;
	screenPoint: Point2D;
	normPoint: Point2D;
}

/** Finds closest point on path curve in screen coordinates within given threshold (pixels). */
function findClosestPointOnPath(
	mask: EvaluatedMask,
	screenPos: Point2D,
	toMonitor: (p: Point2D) => Point2D,
	fromMonitor: (p: Point2D) => Point2D,
	thresholdPixels = 14
): { segmentIndex: number; screenPoint: Point2D; normPoint: Point2D } | null {
	const pts = mask.points;
	if (!pts || pts.length < 2) return null;
	const count = mask.closed ? pts.length : pts.length - 1;

	let bestDist = thresholdPixels;
	let bestHit: { segmentIndex: number; screenPoint: Point2D; normPoint: Point2D } | null = null;

	for (let i = 0; i < count; i++) {
		const p0 = pts[i]!;
		const p1 = pts[(i + 1) % pts.length]!;

		const cp0: Point2D = p0.outHandle
			? { x: p0.x + p0.outHandle.x, y: p0.y + p0.outHandle.y }
			: { x: p0.x, y: p0.y };
		const cp1: Point2D = p1.inHandle
			? { x: p1.x + p1.inHandle.x, y: p1.y + p1.inHandle.y }
			: { x: p1.x, y: p1.y };

		const mP0 = toMonitor(p0);
		const mP1 = toMonitor(p1);
		const mCp0 = toMonitor(cp0);
		const mCp1 = toMonitor(cp1);

		const samples = flattenBezier(mP0, mCp0, mCp1, mP1, 16);
		for (let s = 0; s < samples.length - 1; s++) {
			const a = samples[s]!;
			const b = samples[s + 1]!;
			const d = distanceToSegment(screenPos, a, b);
			if (d < bestDist) {
				bestDist = d;
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const len2 = dx * dx + dy * dy;
				let segT = 0;
				if (len2 > 0) {
					segT = Math.max(
						0,
						Math.min(1, ((screenPos.x - a.x) * dx + (screenPos.y - a.y) * dy) / len2)
					);
				}
				const projScreen: Point2D = {
					x: a.x + segT * dx,
					y: a.y + segT * dy
				};
				const normPoint = fromMonitor(projScreen);
				bestHit = {
					segmentIndex: i,
					screenPoint: projScreen,
					normPoint
				};
			}
		}
	}

	return bestHit;
}

export function getClipSourceDimensions(
	clip: Clip,
	project: Project,
	localTime: number
): { width: number; height: number } {
	const src = clip.source;
	if (src && 'type' in src && src.type === 'text') {
		const textSrc = src as {
			text: string;
			style?: { fontFamily?: string; letterSpacing?: number; lineHeight?: number };
			box?: import('../../core').TextBox;
		};
		const fontSize = (readProperty(clip, 'text.fontSize', localTime) as number) ?? 48;
		const letterSpacing =
			(readProperty(clip, 'text.letterSpacing', localTime) as number) ??
			textSrc.style?.letterSpacing ??
			0;
		const lineHeight =
			(readProperty(clip, 'text.lineHeight', localTime) as number) ??
			textSrc.style?.lineHeight ??
			1.2;
		const dims = getTextDimensions(
			textSrc.text,
			{
				...(textSrc.style ?? {}),
				fontFamily: textSrc.style?.fontFamily ?? 'sans-serif',
				letterSpacing,
				lineHeight
			},
			textSrc.box,
			fontSize
		);
		return { width: dims.width, height: dims.height };
	}
	if (src && 'type' in src && src.type === 'shape') {
		const shapeSrc = src as { width?: number; height?: number };
		const w = (readProperty(clip, 'shape.width', localTime) as number) ?? shapeSrc.width ?? 300;
		const h = (readProperty(clip, 'shape.height', localTime) as number) ?? shapeSrc.height ?? 200;
		return { width: w, height: h };
	}
	if (src && 'type' in src && src.type === 'sequence') {
		const seqSrc = src as { sequenceId: import('../../core').SequenceId };
		const nestedSeq = getSequence(project, seqSrc.sequenceId);
		if (nestedSeq?.settings?.width && nestedSeq?.settings?.height) {
			return { width: nestedSeq.settings.width, height: nestedSeq.settings.height };
		}
	}
	const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
	return {
		width: asset?.width ?? project.settings.width,
		height: asset?.height ?? project.settings.height
	};
}

/**
 * Maps a mask local offset (lx, ly) in normalized units (where lx is fraction of sourceWidth, ly of sourceHeight)
 * to monitor screen pixels, accounting for source aspect ratio during rotation and layerAffine.
 */
export function maskLocalToMonitor(
	lx: number,
	ly: number,
	cx: number,
	cy: number,
	rotDeg: number,
	aspect: number,
	toMonitor: (p: Point2D) => Point2D
): Point2D {
	const rad = (rotDeg * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	const invAspect = 1 / Math.max(0.0001, aspect);
	const u = cx + lx * cos - ly * invAspect * sin;
	const v = cy + lx * aspect * sin + ly * cos;
	return toMonitor({ x: u, y: v });
}

export default function MaskOverlay({ project, renderedWidth, renderedHeight }: MaskOverlayProps) {
	const store = useEditorStoreApi();
	const selectedClipIds = useEditorStore((state) => state.timeline.selection.clipIds);
	const playhead = useEditorStore((state) => state.timeline.playhead);
	const maskTool = useEditorStore((state) => state.maskTool);

	const [dragging, setDragging] = useState<DraggingPoint | null>(null);
	const [hoverHit, setHoverHit] = useState<HoverPathHit | null>(null);
	const svgRef = useRef<SVGSVGElement>(null);

	// Find the single selected clip
	const selectedClip: Clip | null = useMemo(() => {
		if (selectedClipIds.length !== 1) return null;
		for (const track of project.tracks) {
			if (track.kind !== 'video') continue;
			const clip = track.clips.find((c) => c.id === selectedClipIds[0]);
			if (clip) return clip;
		}
		return null;
	}, [project, selectedClipIds]);

	const masks = useMemo(() => selectedClip?.masks ?? [], [selectedClip]);
	const showOverlay = maskTool.showOverlay && masks.length > 0;

	const localTime = selectedClip ? playhead - selectedClip.start : 0;
	const { width: sourceWidth, height: sourceHeight } = useMemo(() => {
		if (!selectedClip) return { width: project.settings.width, height: project.settings.height };
		return getClipSourceDimensions(selectedClip, project, localTime);
	}, [selectedClip, project, localTime]);

	const aspect = sourceWidth / Math.max(1, sourceHeight);

	// Compute transform matrix from normalized layer space to monitor space
	const { toMonitor, fromMonitor } = useMemo(() => {
		if (!selectedClip) {
			const identity = (p: Point2D) => p;
			return { toMonitor: identity, fromMonitor: identity };
		}

		const resolved = resolveFrame(project, playhead);
		const layer = resolved.videoLayers.find((l) => l.clipId === selectedClip.id);

		const compW = project.settings.width;
		const compH = project.settings.height;
		const scale = renderedWidth / Math.max(1, compW);

		if (!layer) {
			const fallbackToMon = (p: Point2D) => ({
				x: p.x * renderedWidth,
				y: p.y * renderedHeight
			});
			const fallbackFromMon = (p: Point2D) => ({
				x: p.x / renderedWidth,
				y: p.y / renderedHeight
			});
			return { toMonitor: fallbackToMon, fromMonitor: fallbackFromMon };
		}

		const affine = layerAffine(layer, sourceWidth, sourceHeight, compW, compH);
		const det = affine.a * affine.d - affine.b * affine.c;

		const [cropL, cropT, cropR, cropB] = layer.crop ?? [0, 0, 0, 0];
		const cropW = Math.max(0.0001, 1 - cropL - cropR);
		const cropH = Math.max(0.0001, 1 - cropT - cropB);

		const toMon = (p: Point2D): Point2D => {
			const qx = (p.x - cropL) / cropW;
			const qy = (p.y - cropT) / cropH;
			const cx = affine.a * qx + affine.c * qy + affine.e;
			const cy = affine.b * qx + affine.d * qy + affine.f;
			return { x: cx * scale, y: cy * scale };
		};

		const fromMon = (p: Point2D): Point2D => {
			if (Math.abs(det) < 0.000001) return { x: 0.5, y: 0.5 };
			const cx = p.x / scale - affine.e;
			const cy = p.y / scale - affine.f;
			const qx = (affine.d * cx - affine.c * cy) / det;
			const qy = (-affine.b * cx + affine.a * cy) / det;
			return {
				x: cropL + qx * cropW,
				y: cropT + qy * cropH
			};
		};

		return { toMonitor: toMon, fromMonitor: fromMon };
	}, [project, selectedClip, playhead, renderedWidth, renderedHeight, sourceWidth, sourceHeight]);

	// Listen for Delete / Backspace, Arrow keys, Esc
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const activeEl = document.activeElement;
			if (activeEl) {
				const tag = activeEl.tagName.toLowerCase();
				if (tag === 'input' || tag === 'textarea' || (activeEl as HTMLElement).isContentEditable) {
					return;
				}
			}

			// Esc cancels drag/selection
			if (e.key === 'Escape') {
				if (dragging) {
					e.preventDefault();
					setDragging(null);
				}
				return;
			}

			if (maskTool.selectedMaskId && selectedClip) {
				const mask = masks.find((m) => m.id === maskTool.selectedMaskId);
				if (!mask) return;

				// Delete / Backspace removes selected mask point
				if ((e.key === 'Delete' || e.key === 'Backspace') && maskTool.selectedPointIndex !== null) {
					if (mask.type === 'path' && mask.points && mask.points.length > 3) {
						e.preventDefault();
						const pts = mask.points.filter((_, idx) => idx !== maskTool.selectedPointIndex);
						store.getState().updateMask(selectedClip.id, mask.id, { points: pts });
						store.getState().selectMaskPoint(null);
					}
					return;
				}

				// Arrow key nudging
				if (
					e.key === 'ArrowLeft' ||
					e.key === 'ArrowRight' ||
					e.key === 'ArrowUp' ||
					e.key === 'ArrowDown'
				) {
					// Only nudge if monitor svg is focused or active
					if (document.activeElement === svgRef.current) {
						e.preventDefault();
						const multiplier = e.shiftKey ? 10 : 1;
						const dxScr =
							(e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0) * multiplier;
						const dyScr = (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0) * multiplier;

						const p0 = fromMonitor({ x: 0, y: 0 });
						const pShift = fromMonitor({ x: dxScr, y: dyScr });
						const dNormX = pShift.x - p0.x;
						const dNormY = pShift.y - p0.y;

						if ((mask.type === 'rect' || mask.type === 'ellipse') && mask.shape) {
							const shape = [...mask.shape];
							shape[0] = Math.max(0, Math.min(1, shape[0]! + dNormX));
							shape[1] = Math.max(0, Math.min(1, shape[1]! + dNormY));
							store.getState().updateMask(selectedClip.id, mask.id, { shape });
						} else if (mask.type === 'path') {
							const evalMask = evaluateMask(mask, localTime, selectedClip.properties);
							const currentPts = evalMask.points ?? mask.points;
							const ptIdx = maskTool.selectedPointIndex;
							if (ptIdx !== null && currentPts) {
								const pts = currentPts.map((pt, i) =>
									i === ptIdx
										? {
												...pt,
												x: Math.max(0, Math.min(1, pt.x + dNormX)),
												y: Math.max(0, Math.min(1, pt.y + dNormY))
											}
										: pt
								);
								store.getState().updateMask(selectedClip.id, mask.id, { points: pts });
							}
						}
					}
				}
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [
		maskTool.selectedMaskId,
		maskTool.selectedPointIndex,
		selectedClip,
		masks,
		dragging,
		fromMonitor,
		store,
		localTime
	]);

	const evaluatedMasks = selectedClip
		? masks.map((m) => evaluateMask(m, localTime, selectedClip.properties))
		: [];
	const activeMaskId = maskTool.selectedMaskId ?? (masks.length > 0 ? masks[0]!.id : null);
	const activeMask = evaluatedMasks.find((m) => m.id === activeMaskId);
	const activeMaskShapePropId = activeMask ? (`mask:${activeMask.id}:shape` as PropertyId) : null;
	const activeMaskShapeCurve =
		activeMask && selectedClip && activeMaskShapePropId
			? propertyCurve(selectedClip, activeMaskShapePropId)
			: null;
	const isShapeAnimated = Boolean(activeMaskShapeCurve && isAnimated(activeMaskShapeCurve));

	useEffect(() => {
		if (!maskTool.blockedMessage) return;
		const timer = setTimeout(() => {
			store.getState().setMaskBlockedMessage(null);
		}, 2500);
		return () => clearTimeout(timer);
	}, [maskTool.blockedMessage, store]);

	const handlePointerDownHandle = (
		e: ReactPointerEvent,
		mask: EvaluatedMask,
		handleType: DragHandleType,
		idx = 0,
		handle?: 'in' | 'out'
	) => {
		if (!selectedClip) return;
		e.stopPropagation();
		e.preventDefault();
		svgRef.current?.focus();
		try {
			svgRef.current?.setPointerCapture(e.pointerId);
		} catch {
			// ignore if capture fails
		}

		const svg = svgRef.current;
		if (!svg) return;
		const rect = svg.getBoundingClientRect();
		const scaleX = rect.width > 0 ? renderedWidth / rect.width : 1;
		const scaleY = rect.height > 0 ? renderedHeight / rect.height : 1;
		const p = fromMonitor({
			x: (e.clientX - rect.left) * scaleX,
			y: (e.clientY - rect.top) * scaleY
		});

		setDragging({
			maskId: mask.id,
			pointIndex: idx,
			handleType,
			handle,
			startPos: p,
			originalShape: [...mask.shape],
			originalPoints: (mask.points ?? []).map((pt) => ({
				...pt,
				inHandle: pt.inHandle ? { ...pt.inHandle } : undefined,
				outHandle: pt.outHandle ? { ...pt.outHandle } : undefined
			}))
		});
		store.getState().selectMask(mask.id);
		store.getState().selectMaskPoint(idx);
	};

	const handlePointerDownAnchor = (
		e: ReactPointerEvent,
		mask: EvaluatedMask,
		idx: number,
		handle?: 'in' | 'out'
	) => {
		handlePointerDownHandle(
			e,
			mask,
			handle ? (handle === 'in' ? 'path-in' : 'path-out') : 'path-vertex',
			idx,
			handle
		);
	};

	const handleDoubleClickAnchor = (e: React.MouseEvent, mask: EvaluatedMask, idx: number) => {
		if (!selectedClip) return;
		e.stopPropagation();
		e.preventDefault();
		const pts = (mask.points ?? []).map((pt) => ({
			...pt,
			inHandle: pt.inHandle ? { ...pt.inHandle } : undefined,
			outHandle: pt.outHandle ? { ...pt.outHandle } : undefined
		}));
		const pt = pts[idx];
		if (!pt) return;

		if (pt.inHandle || pt.outHandle) {
			// Clear handles (make it sharp corner)
			delete pt.inHandle;
			delete pt.outHandle;
		} else {
			// Add default smooth handles tangent to adjacent points
			const prev = pts[(idx - 1 + pts.length) % pts.length]!;
			const next = pts[(idx + 1) % pts.length]!;
			const dx = (next.x - prev.x) * 0.15;
			const dy = (next.y - prev.y) * 0.15;
			pt.inHandle = { x: -dx, y: -dy };
			pt.outHandle = { x: dx, y: dy };
		}
		store.getState().updateMask(selectedClip.id, mask.id, { points: pts });
	};

	const handlePathPointerDown = (e: ReactPointerEvent, mask: EvaluatedMask) => {
		if (!selectedClip || isShapeAnimated) return;
		const svg = svgRef.current;
		if (!svg) return;
		const rect = svg.getBoundingClientRect();
		const scaleX = rect.width > 0 ? renderedWidth / rect.width : 1;
		const scaleY = rect.height > 0 ? renderedHeight / rect.height : 1;
		const screenPos = {
			x: (e.clientX - rect.left) * scaleX,
			y: (e.clientY - rect.top) * scaleY
		};
		const hit = findClosestPointOnPath(mask, screenPos, toMonitor, fromMonitor, 24);
		if (!hit) return;

		e.stopPropagation();
		e.preventDefault();
		svgRef.current?.focus();

		const pts: MaskPoint[] = (mask.points ?? []).map((pt) => ({
			...pt,
			inHandle: pt.inHandle ? { ...pt.inHandle } : undefined,
			outHandle: pt.outHandle ? { ...pt.outHandle } : undefined
		}));

		// Insert new point at segmentIndex + 1
		const insertIdx = hit.segmentIndex + 1;
		const newPt: MaskPoint = {
			x: Math.max(-2, Math.min(3, hit.normPoint.x)),
			y: Math.max(-2, Math.min(3, hit.normPoint.y))
		};
		pts.splice(insertIdx, 0, newPt);

		const updated = store.getState().updateMask(selectedClip.id, mask.id, { points: pts });
		if (!updated) return;
		store.getState().selectMask(mask.id);
		store.getState().selectMaskPoint(insertIdx);

		// Immediately start dragging the newly added point
		try {
			svgRef.current?.setPointerCapture(e.pointerId);
		} catch {
			// ignore if capture fails
		}
		setDragging({
			maskId: mask.id,
			pointIndex: insertIdx,
			handleType: 'path-vertex',
			startPos: hit.normPoint,
			originalShape: [...mask.shape],
			originalPoints: pts.map((pt) => ({
				...pt,
				inHandle: pt.inHandle ? { ...pt.inHandle } : undefined,
				outHandle: pt.outHandle ? { ...pt.outHandle } : undefined
			}))
		});
		setHoverHit(null);
	};

	const updateDrag = (clientX: number, clientY: number, shiftKey: boolean) => {
		if (!dragging || !selectedClip) return;
		const svg = svgRef.current;
		if (!svg) return;
		const rect = svg.getBoundingClientRect();
		const scaleX = rect.width > 0 ? renderedWidth / rect.width : 1;
		const scaleY = rect.height > 0 ? renderedHeight / rect.height : 1;
		const currentScreen = {
			x: (clientX - rect.left) * scaleX,
			y: (clientY - rect.top) * scaleY
		};
		const currentNorm = fromMonitor(currentScreen);

		const currentMask = masks.find((m) => m.id === dragging.maskId);
		if (!currentMask) return;
		const handleType =
			dragging.handleType ??
			(dragging.handle
				? dragging.handle === 'in'
					? 'path-in'
					: 'path-out'
				: currentMask.type === 'path'
					? 'path-vertex'
					: 'move');

		if (currentMask.type === 'rect') {
			const [origCx, origCy, origW, origH, origRot = 0] = dragging.originalShape as [
				number,
				number,
				number,
				number,
				number?
			];
			const rotRad = ((origRot ?? 0) * Math.PI) / 180;
			const cos = Math.cos(rotRad);
			const sin = Math.sin(rotRad);

			if (handleType === 'move') {
				const dx = currentNorm.x - dragging.startPos.x;
				const dy = currentNorm.y - dragging.startPos.y;
				const shape = [...dragging.originalShape];
				shape[0] = Math.max(-2, Math.min(3, origCx + dx));
				shape[1] = Math.max(-2, Math.min(3, origCy + dy));
				store
					.getState()
					.updateMask(selectedClip.id, dragging.maskId, { shape }, { coalesce: true });
			} else if (handleType === 'rotate') {
				const pMouseLayer = currentNorm;
				const dxPix = (pMouseLayer.x - origCx) * sourceWidth;
				const dyPix = (pMouseLayer.y - origCy) * sourceHeight;
				let angleDeg = (((Math.atan2(dxPix, -dyPix) * (180 / Math.PI)) % 360) + 360) % 360;
				if (shiftKey) {
					angleDeg = Math.round(angleDeg / 15) * 15;
				}
				const shape = [...dragging.originalShape];
				shape[4] = Math.round(angleDeg);
				store
					.getState()
					.updateMask(selectedClip.id, dragging.maskId, { shape }, { coalesce: true });
			} else {
				// Resizing rectangle handles ('nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w')
				const pMouseLayer = currentNorm;
				const dxPix = (pMouseLayer.x - origCx) * sourceWidth;
				const dyPix = (pMouseLayer.y - origCy) * sourceHeight;
				const rotPixX = dxPix * cos + dyPix * sin;
				const rotPixY = -dxPix * sin + dyPix * cos;

				const shape = [...dragging.originalShape];
				let w = origW;
				let h = origH;

				const newW = Math.max(0.02, Math.min(2, (2 * Math.abs(rotPixX)) / sourceWidth));
				const newH = Math.max(0.02, Math.min(2, (2 * Math.abs(rotPixY)) / sourceHeight));

				if (handleType === 'e' || handleType === 'w') {
					w = newW;
				} else if (handleType === 'n' || handleType === 's') {
					h = newH;
				} else {
					// Corners
					w = newW;
					h = newH;
					if (shiftKey) {
						const scaleW = newW / Math.max(0.001, origW);
						const scaleH = newH / Math.max(0.001, origH);
						const s = Math.max(scaleW, scaleH);
						w = Math.max(0.02, Math.min(2, origW * s));
						h = Math.max(0.02, Math.min(2, origH * s));
					}
				}
				shape[2] = w;
				shape[3] = h;
				store
					.getState()
					.updateMask(selectedClip.id, dragging.maskId, { shape }, { coalesce: true });
			}
			return;
		} else if (currentMask.type === 'ellipse') {
			const [origCx, origCy, origRx, origRy, origRot = 0] = dragging.originalShape as [
				number,
				number,
				number,
				number,
				number?
			];
			const rotRad = ((origRot ?? 0) * Math.PI) / 180;
			const cos = Math.cos(rotRad);
			const sin = Math.sin(rotRad);

			if (handleType === 'move') {
				const dx = currentNorm.x - dragging.startPos.x;
				const dy = currentNorm.y - dragging.startPos.y;
				const shape = [...dragging.originalShape];
				shape[0] = Math.max(-2, Math.min(3, origCx + dx));
				shape[1] = Math.max(-2, Math.min(3, origCy + dy));
				store
					.getState()
					.updateMask(selectedClip.id, dragging.maskId, { shape }, { coalesce: true });
			} else if (handleType === 'rotate') {
				const pMouseLayer = currentNorm;
				const dxPix = (pMouseLayer.x - origCx) * sourceWidth;
				const dyPix = (pMouseLayer.y - origCy) * sourceHeight;
				let angleDeg = (((Math.atan2(dxPix, -dyPix) * (180 / Math.PI)) % 360) + 360) % 360;
				if (shiftKey) {
					angleDeg = Math.round(angleDeg / 15) * 15;
				}
				const shape = [...dragging.originalShape];
				shape[4] = Math.round(angleDeg);
				store
					.getState()
					.updateMask(selectedClip.id, dragging.maskId, { shape }, { coalesce: true });
			} else {
				// Resizing ellipse handles ('e', 'w', 'n', 's', 'nw', 'ne', 'se', 'sw')
				const pMouseLayer = currentNorm;
				const dxPix = (pMouseLayer.x - origCx) * sourceWidth;
				const dyPix = (pMouseLayer.y - origCy) * sourceHeight;
				const rotPixX = dxPix * cos + dyPix * sin;
				const rotPixY = -dxPix * sin + dyPix * cos;

				const shape = [...dragging.originalShape];
				let rx = origRx;
				let ry = origRy;

				const newRx = Math.max(0.01, Math.min(1.5, Math.abs(rotPixX) / sourceWidth));
				const newRy = Math.max(0.01, Math.min(1.5, Math.abs(rotPixY) / sourceHeight));

				if (handleType === 'e' || handleType === 'w') {
					rx = newRx;
				} else if (handleType === 'n' || handleType === 's') {
					ry = newRy;
				} else {
					// Corners
					rx = newRx;
					ry = newRy;
					if (shiftKey) {
						const scaleRx = newRx / Math.max(0.001, origRx);
						const scaleRy = newRy / Math.max(0.001, origRy);
						const s = Math.max(scaleRx, scaleRy);
						rx = Math.max(0.01, Math.min(1.5, origRx * s));
						ry = Math.max(0.01, Math.min(1.5, origRy * s));
					}
				}
				shape[2] = rx;
				shape[3] = ry;
				store
					.getState()
					.updateMask(selectedClip.id, dragging.maskId, { shape }, { coalesce: true });
			}
			return;
		} else if (currentMask.type === 'path' && dragging.originalPoints) {
			const dx = currentNorm.x - dragging.startPos.x;
			const dy = currentNorm.y - dragging.startPos.y;

			if (handleType === 'move') {
				let clampedDx = dx;
				let clampedDy = dy;
				for (const pt of dragging.originalPoints) {
					if (pt.x + clampedDx < -2) clampedDx = -2 - pt.x;
					if (pt.x + clampedDx > 3) clampedDx = 3 - pt.x;
					if (pt.y + clampedDy < -2) clampedDy = -2 - pt.y;
					if (pt.y + clampedDy > 3) clampedDy = 3 - pt.y;
				}
				const points = dragging.originalPoints.map((origPt) => ({
					...origPt,
					x: origPt.x + clampedDx,
					y: origPt.y + clampedDy,
					inHandle: origPt.inHandle ? { ...origPt.inHandle } : undefined,
					outHandle: origPt.outHandle ? { ...origPt.outHandle } : undefined
				}));
				store
					.getState()
					.updateMask(selectedClip.id, dragging.maskId, { points }, { coalesce: true });
				return;
			}

			const points = dragging.originalPoints.map((pt) => ({
				...pt,
				inHandle: pt.inHandle ? { ...pt.inHandle } : undefined,
				outHandle: pt.outHandle ? { ...pt.outHandle } : undefined
			}));
			const pt = points[dragging.pointIndex];
			if (pt) {
				const origPt = dragging.originalPoints[dragging.pointIndex]!;
				if (dragging.handle === 'in' || handleType === 'path-in') {
					const origIn = origPt.inHandle ?? { x: 0, y: 0 };
					pt.inHandle = { x: origIn.x + dx, y: origIn.y + dy };
				} else if (dragging.handle === 'out' || handleType === 'path-out') {
					const origOut = origPt.outHandle ?? { x: 0, y: 0 };
					pt.outHandle = { x: origOut.x + dx, y: origOut.y + dy };
				} else {
					pt.x = Math.max(-2, Math.min(3, origPt.x + dx));
					pt.y = Math.max(-2, Math.min(3, origPt.y + dy));
				}
				store
					.getState()
					.updateMask(selectedClip.id, dragging.maskId, { points }, { coalesce: true });
			}
			return;
		}
	};

	useEffect(() => {
		if (!dragging) return;
		const onPointerMove = (e: PointerEvent) => {
			updateDrag(e.clientX, e.clientY, e.shiftKey);
		};
		const onPointerUp = (e: PointerEvent) => {
			try {
				svgRef.current?.releasePointerCapture(e.pointerId);
			} catch {}
			setDragging(null);
		};
		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerUp);
		return () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerUp);
		};
	}, [
		dragging,
		selectedClip,
		masks,
		fromMonitor,
		renderedWidth,
		renderedHeight,
		sourceWidth,
		sourceHeight,
		aspect,
		store
	]);

	const handlePointerMove = (e: ReactPointerEvent) => {
		if (dragging) {
			updateDrag(e.clientX, e.clientY, e.shiftKey);
			return;
		}

		// When not dragging, check for hover over active path mask to show add-point indicator
		const svg = svgRef.current;
		if (!svg) return;
		const rect = svg.getBoundingClientRect();
		const scaleX = rect.width > 0 ? renderedWidth / rect.width : 1;
		const scaleY = rect.height > 0 ? renderedHeight / rect.height : 1;
		const currentScreen = {
			x: (e.clientX - rect.left) * scaleX,
			y: (e.clientY - rect.top) * scaleY
		};

		if (activeMask && activeMask.type === 'path' && !isShapeAnimated) {
			const hit = findClosestPointOnPath(activeMask, currentScreen, toMonitor, fromMonitor, 14);
			if (hit) {
				setHoverHit({
					maskId: activeMask.id,
					segmentIndex: hit.segmentIndex,
					screenPoint: hit.screenPoint,
					normPoint: hit.normPoint
				});
			} else {
				if (hoverHit) setHoverHit(null);
			}
		} else {
			if (hoverHit) setHoverHit(null);
		}
	};

	const handleSvgPointerDown = (e: ReactPointerEvent) => {
		if (e.target !== svgRef.current) return;
		store.getState().selectMaskPoint(null);
	};

	const handlePointerUp = (e: ReactPointerEvent) => {
		if (dragging) {
			try {
				svgRef.current?.releasePointerCapture(e.pointerId);
			} catch {}
			setDragging(null);
		}
	};

	if (!showOverlay || !selectedClip) return null;

	return (
		<>
			{/* Blocked Edit Message Banner */}
			{maskTool.blockedMessage && (
				<div
					className="mask-blocked-banner"
					role="alert"
					aria-live="assertive"
					data-testid="mask-blocked-banner"
				>
					{maskTool.blockedMessage}
				</div>
			)}

			<svg
				ref={svgRef}
				className="mask-canvas-overlay"
				width={renderedWidth}
				height={renderedHeight}
				tabIndex={0}
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					pointerEvents: 'all',
					userSelect: 'none',
					zIndex: 20,
					cursor: hoverHit ? 'crosshair' : undefined
				}}
				onPointerDown={handleSvgPointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerLeave={() => {
					setHoverHit(null);
				}}
			>
				{evaluatedMasks.map((mask) => {
					const isSelected = mask.id === activeMaskId;
					const strokeColor = isSelected ? '#3b82f6' : 'rgba(255, 255, 255, 0.6)';

					if (mask.type === 'rect') {
						const [cx, cy, w, h, rotDeg = 0] = mask.shape;

						// 4 corners in rotated layer space mapped to monitor
						const p0 = maskLocalToMonitor(-w / 2, -h / 2, cx, cy, rotDeg, aspect, toMonitor);
						const p1 = maskLocalToMonitor(+w / 2, -h / 2, cx, cy, rotDeg, aspect, toMonitor);
						const p2 = maskLocalToMonitor(+w / 2, +h / 2, cx, cy, rotDeg, aspect, toMonitor);
						const p3 = maskLocalToMonitor(-w / 2, +h / 2, cx, cy, rotDeg, aspect, toMonitor);
						const center = toMonitor({ x: cx, y: cy });

						// 4 edge midpoints
						const pTopMid = maskLocalToMonitor(0, -h / 2, cx, cy, rotDeg, aspect, toMonitor);
						const pRightMid = maskLocalToMonitor(+w / 2, 0, cx, cy, rotDeg, aspect, toMonitor);
						const pBotMid = maskLocalToMonitor(0, +h / 2, cx, cy, rotDeg, aspect, toMonitor);
						const pLeftMid = maskLocalToMonitor(-w / 2, 0, cx, cy, rotDeg, aspect, toMonitor);

						// Rotation stem
						const upDir = { x: pTopMid.x - center.x, y: pTopMid.y - center.y };
						const upLen = Math.hypot(upDir.x, upDir.y) || 1;
						const pRot = {
							x: pTopMid.x + (upDir.x / upLen) * 22,
							y: pTopMid.y + (upDir.y / upLen) * 22
						};

						// Feather indicator in local coordinates
						let f0 = p0;
						let f1 = p1;
						let f2 = p2;
						let f3 = p3;
						if (isSelected && mask.feather > 0) {
							const fW = (mask.feather / sourceWidth) * 2;
							const fH = (mask.feather / sourceHeight) * 2;
							f0 = maskLocalToMonitor(
								-(w + fW) / 2,
								-(h + fH) / 2,
								cx,
								cy,
								rotDeg,
								aspect,
								toMonitor
							);
							f1 = maskLocalToMonitor(
								+(w + fW) / 2,
								-(h + fH) / 2,
								cx,
								cy,
								rotDeg,
								aspect,
								toMonitor
							);
							f2 = maskLocalToMonitor(
								+(w + fW) / 2,
								+(h + fH) / 2,
								cx,
								cy,
								rotDeg,
								aspect,
								toMonitor
							);
							f3 = maskLocalToMonitor(
								-(w + fW) / 2,
								+(h + fH) / 2,
								cx,
								cy,
								rotDeg,
								aspect,
								toMonitor
							);
						}

						return (
							<g key={mask.id}>
								{/* Visual feather indicator when selected */}
								{isSelected && mask.feather > 0 && (
									<polygon
										points={`${f0.x},${f0.y} ${f1.x},${f1.y} ${f2.x},${f2.y} ${f3.x},${f3.y}`}
										fill="none"
										stroke="rgba(59, 130, 246, 0.35)"
										strokeWidth={1}
										strokeDasharray="3 3"
									/>
								)}

								{/* Main body of rectangle (dragging inside or on stroke moves the mask) */}
								<polygon
									points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`}
									fill="rgba(59, 130, 246, 0.05)"
									stroke={strokeColor}
									strokeWidth={1.5}
									strokeDasharray={isSelected ? undefined : '4 4'}
									style={{ cursor: 'move', pointerEvents: 'all' }}
									onPointerDown={(e) => handlePointerDownHandle(e, mask, 'move')}
								/>

								{/* Center move handle */}
								<circle
									cx={center.x}
									cy={center.y}
									r={5}
									fill="#ffffff"
									stroke={strokeColor}
									strokeWidth={2}
									data-handle="move"
									style={{ cursor: 'move', pointerEvents: 'all' }}
									onPointerDown={(e) => handlePointerDownHandle(e, mask, 'move')}
								>
									<title>Drag to move mask</title>
								</circle>

								{/* Handles when selected */}
								{isSelected && (
									<>
										{/* Rotation stem & circle */}
										<line
											x1={pTopMid.x}
											y1={pTopMid.y}
											x2={pRot.x}
											y2={pRot.y}
											stroke="#3b82f6"
											strokeWidth={1.5}
											strokeDasharray="2 2"
										/>
										<circle
											cx={pRot.x}
											cy={pRot.y}
											r={5}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={2}
											style={{ cursor: 'grab' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'rotate')}
										>
											<title>Drag to rotate mask (Shift to snap 15°)</title>
										</circle>

										{/* 4 Corner handles (resize both width and height) */}
										<rect
											x={p0.x - 4}
											y={p0.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'nwse-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'nw')}
										/>
										<rect
											x={p1.x - 4}
											y={p1.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'nesw-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'ne')}
										/>
										<rect
											x={p2.x - 4}
											y={p2.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'nwse-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'se')}
										/>
										<rect
											x={p3.x - 4}
											y={p3.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'nesw-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'sw')}
										/>

										{/* 4 Edge handles (resize width or height) */}
										<rect
											x={pTopMid.x - 4}
											y={pTopMid.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'ns-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'n')}
										/>
										<rect
											x={pRightMid.x - 4}
											y={pRightMid.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'ew-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'e')}
										/>
										<rect
											x={pBotMid.x - 4}
											y={pBotMid.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'ns-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 's')}
										/>
										<rect
											x={pLeftMid.x - 4}
											y={pLeftMid.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'ew-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'w')}
										/>
									</>
								)}
							</g>
						);
					}

					if (mask.type === 'ellipse') {
						const [cx, cy, rx, ry, rotDeg = 0] = mask.shape;

						const center = toMonitor({ x: cx, y: cy });

						// 4 cardinal handles in monitor coordinates
						const pTop = maskLocalToMonitor(0, -ry, cx, cy, rotDeg, aspect, toMonitor);
						const pRight = maskLocalToMonitor(+rx, 0, cx, cy, rotDeg, aspect, toMonitor);
						const pBot = maskLocalToMonitor(0, +ry, cx, cy, rotDeg, aspect, toMonitor);
						const pLeft = maskLocalToMonitor(-rx, 0, cx, cy, rotDeg, aspect, toMonitor);

						// 4 bounding box corner handles
						const pTL = maskLocalToMonitor(-rx, -ry, cx, cy, rotDeg, aspect, toMonitor);
						const pTR = maskLocalToMonitor(+rx, -ry, cx, cy, rotDeg, aspect, toMonitor);
						const pBR = maskLocalToMonitor(+rx, +ry, cx, cy, rotDeg, aspect, toMonitor);
						const pBL = maskLocalToMonitor(-rx, +ry, cx, cy, rotDeg, aspect, toMonitor);

						// Generate 32-sample smooth polygon path for rotated ellipse in monitor coordinates
						const numSamples = 32;
						let ellipsePath = '';
						for (let s = 0; s < numSamples; s++) {
							const t = (s / numSamples) * Math.PI * 2;
							const sp = maskLocalToMonitor(
								rx * Math.cos(t),
								ry * Math.sin(t),
								cx,
								cy,
								rotDeg,
								aspect,
								toMonitor
							);
							ellipsePath += s === 0 ? `M ${sp.x} ${sp.y}` : ` L ${sp.x} ${sp.y}`;
						}
						ellipsePath += ' Z';

						// Rotation stem extending from top handle
						const upDir = { x: pTop.x - center.x, y: pTop.y - center.y };
						const upLen = Math.hypot(upDir.x, upDir.y) || 1;
						const pRot = {
							x: pTop.x + (upDir.x / upLen) * 22,
							y: pTop.y + (upDir.y / upLen) * 22
						};

						// Feather guide outline
						let featherPath = '';
						if (isSelected && mask.feather > 0) {
							const fRx = rx + mask.feather / sourceWidth;
							const fRy = ry + mask.feather / sourceHeight;
							for (let s = 0; s < numSamples; s++) {
								const t = (s / numSamples) * Math.PI * 2;
								const sp = maskLocalToMonitor(
									fRx * Math.cos(t),
									fRy * Math.sin(t),
									cx,
									cy,
									rotDeg,
									aspect,
									toMonitor
								);
								featherPath += s === 0 ? `M ${sp.x} ${sp.y}` : ` L ${sp.x} ${sp.y}`;
							}
							featherPath += ' Z';
						}

						return (
							<g key={mask.id}>
								{/* Visual feather indicator when selected */}
								{featherPath && (
									<path
										d={featherPath}
										fill="none"
										stroke="rgba(59, 130, 246, 0.35)"
										strokeWidth={1}
										strokeDasharray="3 3"
									/>
								)}

								{/* Main body of ellipse (dragging inside or on stroke moves the mask) */}
								<path
									d={ellipsePath}
									fill="rgba(59, 130, 246, 0.05)"
									stroke={strokeColor}
									strokeWidth={1.5}
									strokeDasharray={isSelected ? undefined : '4 4'}
									style={{ cursor: 'move', pointerEvents: 'all' }}
									onPointerDown={(e) => handlePointerDownHandle(e, mask, 'move')}
								/>

								{/* Center move handle */}
								<circle
									cx={center.x}
									cy={center.y}
									r={5}
									fill="#ffffff"
									stroke={strokeColor}
									strokeWidth={2}
									data-handle="move"
									style={{ cursor: 'move', pointerEvents: 'all' }}
									onPointerDown={(e) => handlePointerDownHandle(e, mask, 'move')}
								>
									<title>Drag to move mask</title>
								</circle>

								{/* Handles when selected */}
								{isSelected && (
									<>
										{/* Rotation stem & circle */}
										<line
											x1={pTop.x}
											y1={pTop.y}
											x2={pRot.x}
											y2={pRot.y}
											stroke="#3b82f6"
											strokeWidth={1.5}
											strokeDasharray="2 2"
										/>
										<circle
											cx={pRot.x}
											cy={pRot.y}
											r={5}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={2}
											style={{ cursor: 'grab' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'rotate')}
										>
											<title>Drag to rotate mask (Shift to snap 15°)</title>
										</circle>

										{/* Bounding box outline */}
										<polygon
											points={`${pTL.x},${pTL.y} ${pTR.x},${pTR.y} ${pBR.x},${pBR.y} ${pBL.x},${pBL.y}`}
											fill="none"
											stroke="rgba(59, 130, 246, 0.25)"
											strokeWidth={1}
											strokeDasharray="3 3"
										/>

										{/* 4 Cardinal handles (resizes horizontal or vertical radius) */}
										<rect
											x={pRight.x - 4}
											y={pRight.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'ew-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'e')}
										/>
										<rect
											x={pLeft.x - 4}
											y={pLeft.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'ew-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'w')}
										/>
										<rect
											x={pTop.x - 4}
											y={pTop.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'ns-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'n')}
										/>
										<rect
											x={pBot.x - 4}
											y={pBot.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'ns-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 's')}
										/>

										{/* 4 Corner handles (resizes both radii simultaneously) */}
										<rect
											x={pTL.x - 4}
											y={pTL.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'nwse-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'nw')}
										/>
										<rect
											x={pTR.x - 4}
											y={pTR.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'nesw-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'ne')}
										/>
										<rect
											x={pBR.x - 4}
											y={pBR.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'nwse-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'se')}
										/>
										<rect
											x={pBL.x - 4}
											y={pBL.y - 4}
											width={8}
											height={8}
											rx={1}
											fill="#ffffff"
											stroke="#3b82f6"
											strokeWidth={1.5}
											style={{ cursor: 'nesw-resize' }}
											onPointerDown={(e) => handlePointerDownHandle(e, mask, 'sw')}
										/>
									</>
								)}
							</g>
						);
					}

					if (mask.type === 'path' && mask.points && mask.points.length > 0) {
						const pts = mask.points;
						const screenPts = pts.map((p) => toMonitor({ x: p.x, y: p.y }));

						// Centroid for center move handle
						const centroidX = pts.reduce((sum, pt) => sum + pt.x, 0) / pts.length;
						const centroidY = pts.reduce((sum, pt) => sum + pt.y, 0) / pts.length;
						const center = toMonitor({ x: centroidX, y: centroidY });

						let d = `M ${screenPts[0]!.x} ${screenPts[0]!.y}`;
						for (let i = 1; i < screenPts.length; i++) {
							const prevPt = pts[i - 1]!;
							const currPt = pts[i]!;
							if (prevPt.outHandle || currPt.inHandle) {
								const cp1 = toMonitor({
									x: prevPt.x + (prevPt.outHandle?.x ?? 0),
									y: prevPt.y + (prevPt.outHandle?.y ?? 0)
								});
								const cp2 = toMonitor({
									x: currPt.x + (currPt.inHandle?.x ?? 0),
									y: currPt.y + (currPt.inHandle?.y ?? 0)
								});
								d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${screenPts[i]!.x} ${screenPts[i]!.y}`;
							} else {
								d += ` L ${screenPts[i]!.x} ${screenPts[i]!.y}`;
							}
						}
						if (mask.closed && pts.length >= 3) {
							const lastPt = pts[pts.length - 1]!;
							const firstPt = pts[0]!;
							if (lastPt.outHandle || firstPt.inHandle) {
								const cp1 = toMonitor({
									x: lastPt.x + (lastPt.outHandle?.x ?? 0),
									y: lastPt.y + (lastPt.outHandle?.y ?? 0)
								});
								const cp2 = toMonitor({
									x: firstPt.x + (firstPt.inHandle?.x ?? 0),
									y: firstPt.y + (firstPt.inHandle?.y ?? 0)
								});
								d += ` C ${cp1.x} ${cp1.y}, ${cp2.x} ${cp2.y}, ${screenPts[0]!.x} ${screenPts[0]!.y}`;
							}
							d += ' Z';
						}

						const maskShapePropId = `mask:${mask.id}:shape` as PropertyId;
						const maskShapeCurve = selectedClip
							? propertyCurve(selectedClip, maskShapePropId)
							: null;
						const maskShapeAnimated = Boolean(maskShapeCurve && isAnimated(maskShapeCurve));

						return (
							<g key={mask.id}>
								{/* Visible stroke path (dragging inside moves entire path mask) */}
								<path
									d={d}
									fill="rgba(59, 130, 246, 0.05)"
									stroke={strokeColor}
									strokeWidth={1.5}
									strokeDasharray={isSelected ? undefined : '4 4'}
									style={{ cursor: 'move', pointerEvents: mask.closed ? 'all' : 'stroke' }}
									onPointerDown={(e) => handlePointerDownHandle(e, mask, 'move')}
								/>
								{/* Thick hit path for easy clicking anywhere along the edge to add points */}
								{!maskShapeAnimated && (
									<path
										d={d}
										fill="none"
										stroke="rgba(0, 0, 0, 0.001)"
										strokeWidth={24}
										style={{ cursor: 'crosshair', pointerEvents: 'stroke' }}
										onPointerDown={(e) => handlePathPointerDown(e, mask)}
									/>
								)}

								{/* Center move handle */}
								<circle
									cx={center.x}
									cy={center.y}
									r={14}
									fill="transparent"
									stroke="transparent"
									style={{ cursor: 'move', pointerEvents: 'all' }}
									onPointerDown={(e) => handlePointerDownHandle(e, mask, 'move')}
								/>
								<circle
									cx={center.x}
									cy={center.y}
									r={5}
									fill="#ffffff"
									stroke={strokeColor}
									strokeWidth={2}
									data-handle="move"
									style={{ cursor: 'move', pointerEvents: 'none' }}
								>
									<title>Drag to move mask</title>
								</circle>

								{/* Vertices & Tangent Handles */}
								{screenPts.map((p, idx) => {
									const pt = pts[idx]!;
									const isPointSelected = isSelected && maskTool.selectedPointIndex === idx;

									return (
										<g key={idx}>
											{/* If point is selected, display tangent handles if they exist */}
											{isPointSelected && (
												<>
													{pt.inHandle && (
														<>
															<line
																x1={p.x}
																y1={p.y}
																x2={
																	toMonitor({ x: pt.x + pt.inHandle.x, y: pt.y + pt.inHandle.y }).x
																}
																y2={
																	toMonitor({ x: pt.x + pt.inHandle.x, y: pt.y + pt.inHandle.y }).y
																}
																stroke="#3b82f6"
																strokeWidth={1.5}
																strokeDasharray="2 2"
															/>
															<circle
																cx={
																	toMonitor({ x: pt.x + pt.inHandle.x, y: pt.y + pt.inHandle.y }).x
																}
																cy={
																	toMonitor({ x: pt.x + pt.inHandle.x, y: pt.y + pt.inHandle.y }).y
																}
																r={12}
																fill="transparent"
																stroke="transparent"
																style={{ cursor: 'pointer', pointerEvents: 'all' }}
																onPointerDown={(e) => handlePointerDownAnchor(e, mask, idx, 'in')}
															/>
															<circle
																cx={
																	toMonitor({ x: pt.x + pt.inHandle.x, y: pt.y + pt.inHandle.y }).x
																}
																cy={
																	toMonitor({ x: pt.x + pt.inHandle.x, y: pt.y + pt.inHandle.y }).y
																}
																r={4}
																fill="#ffffff"
																stroke="#3b82f6"
																strokeWidth={1.5}
																style={{ cursor: 'pointer', pointerEvents: 'none' }}
															/>
														</>
													)}
													{pt.outHandle && (
														<>
															<line
																x1={p.x}
																y1={p.y}
																x2={
																	toMonitor({ x: pt.x + pt.outHandle.x, y: pt.y + pt.outHandle.y })
																		.x
																}
																y2={
																	toMonitor({ x: pt.x + pt.outHandle.x, y: pt.y + pt.outHandle.y })
																		.y
																}
																stroke="#3b82f6"
																strokeWidth={1.5}
																strokeDasharray="2 2"
															/>
															<circle
																cx={
																	toMonitor({ x: pt.x + pt.outHandle.x, y: pt.y + pt.outHandle.y })
																		.x
																}
																cy={
																	toMonitor({ x: pt.x + pt.outHandle.x, y: pt.y + pt.outHandle.y })
																		.y
																}
																r={12}
																fill="transparent"
																stroke="transparent"
																style={{ cursor: 'pointer', pointerEvents: 'all' }}
																onPointerDown={(e) => handlePointerDownAnchor(e, mask, idx, 'out')}
															/>
															<circle
																cx={
																	toMonitor({ x: pt.x + pt.outHandle.x, y: pt.y + pt.outHandle.y })
																		.x
																}
																cy={
																	toMonitor({ x: pt.x + pt.outHandle.x, y: pt.y + pt.outHandle.y })
																		.y
																}
																r={4}
																fill="#ffffff"
																stroke="#3b82f6"
																strokeWidth={1.5}
																style={{ cursor: 'pointer', pointerEvents: 'none' }}
															/>
														</>
													)}
												</>
											)}

											{/* Anchor Vertex */}
											<circle
												cx={p.x}
												cy={p.y}
												r={14}
												fill="transparent"
												stroke="transparent"
												style={{ cursor: 'pointer', pointerEvents: 'all' }}
												onPointerDown={(e) => handlePointerDownAnchor(e, mask, idx)}
												onDoubleClick={(e) => handleDoubleClickAnchor(e, mask, idx)}
											/>
											<circle
												cx={p.x}
												cy={p.y}
												r={isPointSelected ? 5.5 : 4.5}
												fill={isPointSelected ? '#3b82f6' : '#ffffff'}
												stroke={strokeColor}
												strokeWidth={1.5}
												style={{ cursor: 'pointer', pointerEvents: 'none' }}
											>
												<title>
													Click and drag to move vertex. Double-click to toggle smooth/corner.
												</title>
											</circle>
										</g>
									);
								})}
							</g>
						);
					}

					return null;
				})}

				{/* Visual hover indicator along path when hovering to insert point */}
				{hoverHit && (
					<circle
						cx={hoverHit.screenPoint.x}
						cy={hoverHit.screenPoint.y}
						r={5}
						fill="#3b82f6"
						stroke="#ffffff"
						strokeWidth={2}
						style={{ pointerEvents: 'none' }}
					/>
				)}
			</svg>
		</>
	);
}
