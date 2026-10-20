import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type WheelEvent as ReactWheelEvent,
	type MouseEvent as ReactMouseEvent
} from 'react';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { findClipInSequence } from '../../core/sequences/access';
import { trackFeatureUsed } from '../../../services/activityTracking';
import {
	descriptorFor,
	channelKeyValue,
	evaluate,
	graphPropertyIds,
	TRANSFORM_PROPERTIES,
	nearestChannel,
	isAnimated,
	propertyCurve,
	readProperty,
	type BezierHandle,
	type Clip,
	type ClipId,
	type Keyframe,
	type PropertyDescriptor,
	type PropertyId,
	type PropertyValue,
	type Time
} from '../../core';
import './graph-editor.css';

export interface GraphEditorCurve {
	id: string;
	propertyId: PropertyId;
	channelIdx: number;
	label: string;
	shortLabel: string;
	color: string;
	desc: PropertyDescriptor;
	unit: string;
	keyframes: {
		time: Time;
		value: number; // Display value
		interpolation: Keyframe<PropertyValue>['interpolation'];
		easeIn?: BezierHandle;
		easeOut?: BezierHandle;
	}[];
}

const PROPERTY_COLORS: Record<string, string> = {
	'position:0': '#ef4444', // Red for X
	'position:1': '#22c55e', // Green for Y
	'scale:0': '#f97316', // Orange for X
	'scale:1': '#eab308', // Yellow for Y
	rotation: '#3b82f6', // Blue
	'anchor:0': '#ec4899',
	'anchor:1': '#d946ef',
	opacity: '#a855f7', // Purple
	'crop:0': '#06b6d4', // Left
	'crop:1': '#14b8a6', // Top
	'crop:2': '#0ea5e9', // Right
	'crop:3': '#6366f1', // Bottom
	'text.fontSize': '#38bdf8',
	'text.letterSpacing': '#a855f7',
	'text.lineHeight': '#34d399',
	'text.reveal': '#fbbf24',
	'text.strokeWidth': '#f43f5e'
};

/** Fallback per channel: X/R red, Y/G green, B blue, A grey. */
const CHANNEL_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#9ca3af'];

function safeTicksToSeconds(ticks: number): number {
	return Math.max(0, ticks) / 1_000_000;
}

function safeTicksToFrames(ticks: number, fps: number): number {
	const safeFps = Math.max(1, fps);
	return Math.max(0, Math.round((Math.max(0, ticks) / 1_000_000) * safeFps));
}

function safeFramesToTicks(frames: number, fps: number): Time {
	const wholeFrames = Math.max(0, Math.round(frames));
	const safeFps = Math.max(1, fps);
	return Math.round((wholeFrames / safeFps) * 1_000_000);
}

interface ViewportBounds {
	minT: number;
	maxT: number;
	minV: number;
	maxV: number;
}

interface DragOperation {
	kind: 'keyframe' | 'handle' | 'playhead' | 'marquee' | 'pan';
	startX: number;
	startY: number;
	currentX: number;
	currentY: number;
	keyframe?: {
		clipId: ClipId;
		propertyId: PropertyId;
		channelIdx: number;
		initialTime: Time;
		appliedDeltaTime: number;
		initialDisplayVal: number;
		desc: PropertyDescriptor;
		selectedKeys: Array<{
			clipId: ClipId;
			propertyId: PropertyId;
			channelIdx: number;
			initialTime: Time;
			initialDisplayVal: number;
			desc: PropertyDescriptor;
		}>;
	};
	handle?: {
		clipId: ClipId;
		propertyId: PropertyId;
		keyframeTime: Time;
		isEaseIn: boolean;
		segmentStartTime: Time;
		segmentEndTime: Time;
		segmentStartVal: number;
		segmentEndVal: number;
		lastHandles?: { easeIn?: BezierHandle; easeOut?: BezierHandle };
	};
	initialBounds?: ViewportBounds;
}

export default function GraphEditor() {
	const store = useEditorStoreApi();
	const project = useEditorStore((state) => state.project);
	const playhead = useEditorStore((state) => state.timeline.playhead);
	const selectedClipIds = useEditorStore((state) => state.timeline.selection.clipIds);
	const activeSequenceId = useEditorStore((state) => state.activeSequenceId);
	const visibleProperties = useEditorStore(
		(state) => state.keyframes.graph.visibleProperties ?? TRANSFORM_PROPERTIES
	);
	const selectedKeyframeRefs = useEditorStore((state) => state.keyframes.selection);

	const fps = project?.settings.fps ?? 30;

	// Panel Resizing State
	const [panelHeight, setPanelHeight] = useState<number>(() => {
		if (typeof localStorage !== 'undefined') {
			const saved = localStorage.getItem('tfve:graph-editor-height');
			if (saved) {
				const n = parseInt(saved, 10);
				if (!isNaN(n) && n >= 160 && n <= 600) return n;
			}
		}
		return 240;
	});

	const [viewSize, setViewSize] = useState({ width: 800, height: 190 });
	const [customViewport, setCustomViewport] = useState<ViewportBounds | null>(null);
	const [soloChannelId, setSoloChannelId] = useState<string | null>(null);
	const [marquee, setMarquee] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
	const [hud, setHud] = useState<{
		visible: boolean;
		x: number;
		y: number;
		label: string;
		color: string;
		time: Time;
		value: number;
		unit: string;
	} | null>(null);

	const containerRef = useRef<HTMLDivElement>(null);
	const svgRef = useRef<SVGSVGElement>(null);
	const activeDrag = useRef<DragOperation | null>(null);
	const resizeDrag = useRef<{ startY: number; startHeight: number } | null>(null);

	useEffect(() => {
		trackFeatureUsed('keyframe_editor');
	}, []);

	// Save height preference
	const updatePanelHeight = useCallback((h: number) => {
		const clamped = Math.max(160, Math.min(600, Math.round(h)));
		setPanelHeight(clamped);
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem('tfve:graph-editor-height', String(clamped));
			} catch {}
		}
	}, []);

	// Find active selected clip
	const selectedClip: Clip | null = useMemo(() => {
		if (!project || selectedClipIds.length !== 1) return null;
		return findClipInSequence(project, activeSequenceId, selectedClipIds[0]!);
	}, [project, selectedClipIds, activeSequenceId]);

	// Filter properties available for this clip
	const availableFilterProperties: PropertyId[] = useMemo(
		() => (selectedClip ? graphPropertyIds(selectedClip) : TRANSFORM_PROPERTIES),
		[selectedClip]
	);

	// Extract curves for animated channels on this clip
	const curves: GraphEditorCurve[] = useMemo(() => {
		if (!selectedClip) return [];
		const result: GraphEditorCurve[] = [];
		const activeProps = [...visibleProperties];

		for (const propId of activeProps) {
			const curve = propertyCurve(selectedClip, propId);
			if (!curve || !isAnimated(curve) || curve.keyframes.length === 0) continue;
			const desc = descriptorFor(propId);
			if (!desc) continue;

			const unit =
				desc.id === 'opacity' || desc.id === 'scale' || desc.id === 'crop'
					? '%'
					: desc.id === 'rotation'
						? '°'
						: desc.id === 'position'
							? 'px'
							: '';

			if (desc.shape === 'number') {
				const color = PROPERTY_COLORS[propId] ?? '#8b5cf6';
				result.push({
					id: propId,
					propertyId: propId,
					channelIdx: 0,
					label: desc.label,
					shortLabel: desc.label,
					color,
					desc,
					unit,
					keyframes: curve.keyframes.map((k) => ({
						time: k.time,
						value: (k.value as number) * desc.displayFactor,
						interpolation: k.interpolation,
						easeIn: k.easeIn,
						easeOut: k.easeOut
					}))
				});
			} else {
				desc.channels.forEach((chanLabel, chanIdx) => {
					const colorKey = `${propId}:${chanIdx}`;
					const color = PROPERTY_COLORS[colorKey] ?? CHANNEL_COLORS[chanIdx] ?? '#22c55e';
					result.push({
						id: colorKey,
						propertyId: propId,
						channelIdx: chanIdx,
						label: `${desc.label} ${chanLabel}`,
						shortLabel: chanLabel,
						color,
						desc,
						unit,
						keyframes: curve.keyframes.map((k) => {
							const arr = Array.isArray(k.value) ? k.value : [k.value, k.value];
							return {
								time: k.time,
								value: (arr[chanIdx] ?? 0) * desc.displayFactor,
								interpolation: k.interpolation,
								easeIn: k.easeIn,
								easeOut: k.easeOut
							};
						})
					});
				});
			}
		}

		if (soloChannelId) {
			return result.filter((c) => c.id === soloChannelId);
		}

		return result;
	}, [selectedClip, visibleProperties, soloChannelId]);

	// Auto-fit bounds calculation
	const autoBounds: ViewportBounds = useMemo(() => {
		if (!selectedClip || curves.length === 0) {
			return { minT: 0, maxT: 1_000_000, minV: 0, maxV: 100 };
		}
		let minV = Infinity;
		let maxV = -Infinity;
		for (const curve of curves) {
			for (const k of curve.keyframes) {
				minV = Math.min(minV, k.value);
				maxV = Math.max(maxV, k.value);
			}
		}
		if (minV === Infinity) minV = 0;
		if (maxV === -Infinity) maxV = 100;
		if (minV === maxV) {
			minV -= 20;
			maxV += 20;
		}
		const padV = Math.max(10, (maxV - minV) * 0.2);
		return {
			minT: 0,
			maxT: Math.max(selectedClip.duration, 1_000_000),
			minV: minV - padV,
			maxV: maxV + padV
		};
	}, [selectedClip, curves]);

	const bounds: ViewportBounds = customViewport ?? autoBounds;

	// Canvas coordinate padding
	const padLeft = 56;
	const padRight = 24;
	const padTop = 18;
	const padBottom = 26;
	const plotW = Math.max(10, viewSize.width - padLeft - padRight);
	const plotH = Math.max(10, viewSize.height - padTop - padBottom);

	// Transforms between Time / Value and Screen SVG Coordinates
	const timeToX = useCallback(
		(t: Time) => padLeft + ((t - bounds.minT) / Math.max(1, bounds.maxT - bounds.minT)) * plotW,
		[bounds.minT, bounds.maxT, padLeft, plotW]
	);

	const xToTime = useCallback(
		(x: number) => bounds.minT + ((x - padLeft) / plotW) * (bounds.maxT - bounds.minT),
		[bounds.minT, bounds.maxT, padLeft, plotW]
	);

	const valToY = useCallback(
		(v: number) => padTop + ((bounds.maxV - v) / Math.max(0.001, bounds.maxV - bounds.minV)) * plotH,
		[bounds.minV, bounds.maxV, padTop, plotH]
	);

	const yToVal = useCallback(
		(y: number) => bounds.maxV - ((y - padTop) / plotH) * (bounds.maxV - bounds.minV),
		[bounds.minV, bounds.maxV, padTop, plotH]
	);

	// Selected keyframe interpolation inspection
	const selectedInterpolation = useMemo(() => {
		if (selectedKeyframeRefs.length === 0 || !selectedClip) return null;
		for (const curve of curves) {
			const ref = selectedKeyframeRefs.find(
				(r) => r.clipId === selectedClip.id && r.propertyId === curve.propertyId
			);
			if (ref) {
				const k = curve.keyframes.find((item) => item.time === ref.time);
				if (k) {
					if (k.interpolation === 'hold') return 'hold';
					if (k.interpolation === 'linear') return 'linear';
					if (
						k.interpolation === 'spring' ||
						k.interpolation === 'elastic' ||
						k.interpolation === 'bounce'
					) {
						return k.interpolation;
					}
					if (k.easeIn && k.easeOut) return 'ease-both';
					if (k.easeIn) return 'ease-in';
					if (k.easeOut) return 'ease-out';
					return 'ease-both';
				}
			}
		}
		return null;
	}, [selectedKeyframeRefs, selectedClip, curves]);

	// Dragging handlers: Keyframe diamond, Bezier handle, Canvas Marquee, Playhead
	const handlePointerDownKeyframe = (
		e: ReactPointerEvent,
		curve: GraphEditorCurve,
		k: GraphEditorCurve['keyframes'][number]
	) => {
		e.stopPropagation();
		e.preventDefault();
		if (!selectedClip) return;

		try {
			svgRef.current?.setPointerCapture?.(e.pointerId);
		} catch {}

		const isAlreadySelected = selectedKeyframeRefs.some(
			(r) => r.clipId === selectedClip.id && r.propertyId === curve.propertyId && r.time === k.time
		);

		if (e.shiftKey) {
			store.getState().selectKeyframe(
				{ clipId: selectedClip.id, propertyId: curve.propertyId, time: k.time },
				'toggle'
			);
		} else if (!isAlreadySelected) {
			store.getState().selectKeyframe(
				{ clipId: selectedClip.id, propertyId: curve.propertyId, time: k.time },
				'set'
			);
		}

		// Snapshot selected keys for collective dragging
		const currentSelection = store.getState().keyframes.selection;
		const snapshotKeys = currentSelection.flatMap((ref) => {
			const matchCurve = curves.find(
				(c) =>
					c.propertyId === ref.propertyId &&
					(c.propertyId !== curve.propertyId || c.channelIdx === curve.channelIdx)
			);
			if (!matchCurve) return [];
			const matchKey = matchCurve.keyframes.find((item) => item.time === ref.time);
			if (!matchKey) return [];
			return [
				{
					clipId: ref.clipId,
					propertyId: ref.propertyId,
					channelIdx: matchCurve.channelIdx,
					initialTime: ref.time,
					initialDisplayVal: matchKey.value,
					desc: matchCurve.desc
				}
			];
		});

		// Fallback: If snapshotKeys doesn't include the active keyframe, include it
		if (!snapshotKeys.some((s) => s.propertyId === curve.propertyId && s.initialTime === k.time)) {
			snapshotKeys.push({
				clipId: selectedClip.id,
				propertyId: curve.propertyId,
				channelIdx: curve.channelIdx,
				initialTime: k.time,
				initialDisplayVal: k.value,
				desc: curve.desc
			});
		}

		activeDrag.current = {
			kind: 'keyframe',
			startX: e.clientX,
			startY: e.clientY,
			currentX: e.clientX,
			currentY: e.clientY,
			keyframe: {
				clipId: selectedClip.id,
				propertyId: curve.propertyId,
				channelIdx: curve.channelIdx,
				initialTime: k.time,
				appliedDeltaTime: 0,
				initialDisplayVal: k.value,
				desc: curve.desc,
				selectedKeys: snapshotKeys
			}
		};

		setHud({
			visible: true,
			x: timeToX(k.time),
			y: valToY(k.value),
			label: curve.label,
			color: curve.color,
			time: k.time,
			value: k.value,
			unit: curve.unit
		});
	};

	const handlePointerDownHandle = (
		e: ReactPointerEvent,
		curve: GraphEditorCurve,
		keyframeTime: Time,
		isEaseIn: boolean,
		segStart: { time: Time; value: number },
		segEnd: { time: Time; value: number }
	) => {
		e.stopPropagation();
		e.preventDefault();
		if (!selectedClip) return;
		try {
			svgRef.current?.setPointerCapture?.(e.pointerId);
		} catch {}

		activeDrag.current = {
			kind: 'handle',
			startX: e.clientX,
			startY: e.clientY,
			currentX: e.clientX,
			currentY: e.clientY,
			handle: {
				clipId: selectedClip.id,
				propertyId: curve.propertyId,
				keyframeTime,
				isEaseIn,
				segmentStartTime: segStart.time,
				segmentEndTime: segEnd.time,
				segmentStartVal: segStart.value,
				segmentEndVal: segEnd.value
			}
		};
	};

	// Global Pointer Move & Up listeners so dragging never drops
	useEffect(() => {
		const handleGlobalPointerMove = (e: PointerEvent) => {
			if (!activeDrag.current || !selectedClip) return;
			const drag = activeDrag.current;
			drag.currentX = e.clientX;
			drag.currentY = e.clientY;

			const svg = svgRef.current;
			if (!svg) return;
			const rect = svg.getBoundingClientRect();
			const mouseX = e.clientX - rect.left;
			const mouseY = e.clientY - rect.top;

			if (drag.kind === 'playhead') {
				const clickedTime = Math.max(
					0,
					Math.min(selectedClip.duration, Math.round(xToTime(mouseX)))
				);
				store.getState().setPlayhead(selectedClip.start + clickedTime);
			} else if (drag.kind === 'pan' && drag.initialBounds) {
				const deltaX = e.clientX - drag.startX;
				const deltaY = e.clientY - drag.startY;
				const dt = (deltaX / plotW) * (drag.initialBounds.maxT - drag.initialBounds.minT);
				const dv = (deltaY / plotH) * (drag.initialBounds.maxV - drag.initialBounds.minV);
				setCustomViewport({
					minT: Math.max(0, drag.initialBounds.minT - dt),
					maxT: Math.max(100_000, drag.initialBounds.maxT - dt),
					minV: drag.initialBounds.minV + dv,
					maxV: drag.initialBounds.maxV + dv
				});
			} else if (drag.kind === 'marquee') {
				setMarquee({
					startX: drag.startX - rect.left,
					startY: drag.startY - rect.top,
					currentX: mouseX,
					currentY: mouseY
				});
			} else if (drag.kind === 'keyframe' && drag.keyframe) {
				let deltaScreenX = e.clientX - drag.startX;
				let deltaScreenY = e.clientY - drag.startY;

				if (e.shiftKey) {
					if (Math.abs(deltaScreenX) >= Math.abs(deltaScreenY)) {
						deltaScreenY = 0;
					} else {
						deltaScreenX = 0;
					}
				}

				// Time update (horizontal)
				const targetTime = xToTime(timeToX(drag.keyframe.initialTime) + deltaScreenX);
				const snappedTime = e.altKey
					? Math.max(0, Math.min(selectedClip.duration, Math.round(targetTime)))
					: Math.max(
							0,
							Math.min(
								selectedClip.duration,
								safeFramesToTicks(safeTicksToFrames(targetTime, fps), fps)
							)
						);

				const targetDeltaTime = snappedTime - drag.keyframe.initialTime;
				const incrementalDelta = targetDeltaTime - drag.keyframe.appliedDeltaTime;

				if (incrementalDelta !== 0) {
					store.getState().moveSelectedKeyframes(incrementalDelta, false);
					drag.keyframe.appliedDeltaTime = targetDeltaTime;
				}

				// Value update (vertical)
				const targetDisplayVal = yToVal(valToY(drag.keyframe.initialDisplayVal) + deltaScreenY);
				const deltaDisplayVal = targetDisplayVal - drag.keyframe.initialDisplayVal;

				const currentProject = store.getState().project;
				const freshClip =
					(currentProject &&
						findClipInSequence(currentProject, store.getState().activeSequenceId, selectedClip.id)) ??
					selectedClip;

				// Update value for the dragged keyframe and co-selected keyframes
				for (const k of drag.keyframe.selectedKeys) {
					const currentKeyTime = k.initialTime + drag.keyframe.appliedDeltaTime;
					const newDisplay = k.initialDisplayVal + deltaDisplayVal;
					const internal = newDisplay / (k.desc.displayFactor || 1);

					// Read current keyframe value to preserve other channels if compound
					const rawVal = readProperty(freshClip, k.propertyId, currentKeyTime);
					let finalVal: PropertyValue = internal;
					if (Array.isArray(rawVal)) {
						const nextArr = [...rawVal];
						nextArr[k.channelIdx] = internal;
						finalVal = nextArr as unknown as PropertyValue;
					}

					store
						.getState()
						.setKeyframeValue(k.clipId, k.propertyId, currentKeyTime, finalVal, k.channelIdx, false);
				}

				setHud({
					visible: true,
					x: mouseX,
					y: mouseY,
					label: drag.keyframe.desc.label,
					color: '#3b82f6',
					time: snappedTime,
					value: targetDisplayVal,
					unit: ''
				});
			} else if (drag.kind === 'handle' && drag.handle) {
				const h = drag.handle;
				const segDt = Math.max(1, h.segmentEndTime - h.segmentStartTime);
				const segDv = h.segmentEndVal - h.segmentStartVal;

				const targetT = xToTime(mouseX);
				const targetV = yToVal(mouseY);

				const normX = Math.min(0.99, Math.max(0.01, (targetT - h.segmentStartTime) / segDt));
				const normY =
					Math.abs(segDv) > 0.001
						? Math.min(3, Math.max(-2, (targetV - h.segmentStartVal) / segDv))
						: 0.5;

				const handlesPayload = h.isEaseIn
					? { easeIn: { x: normX, y: normY } }
					: { easeOut: { x: normX, y: normY } };

				h.lastHandles = handlesPayload;

				store.getState().setBezierHandles(
					h.clipId,
					h.propertyId,
					h.keyframeTime,
					handlesPayload,
					false
				);

				setHud({
					visible: true,
					x: mouseX,
					y: mouseY,
					label: h.isEaseIn ? 'Ease In' : 'Ease Out',
					color: '#3b82f6',
					time: Math.round(targetT),
					value: targetV,
					unit: ''
				});
			}
		};

		const handleGlobalPointerUp = (e: PointerEvent) => {
			if (activeDrag.current) {
				const drag = activeDrag.current;
				if (drag.kind === 'keyframe' && drag.keyframe && selectedClip) {
					// Commit move to history
					store.getState().moveSelectedKeyframes(0, true);

					// Commit final values for all moved keys to history
					const currentProject = store.getState().project;
					const freshClip =
						currentProject &&
						findClipInSequence(currentProject, store.getState().activeSequenceId, selectedClip.id);
					if (freshClip) {
						for (const k of drag.keyframe.selectedKeys) {
							const currentKeyTime = k.initialTime + drag.keyframe.appliedDeltaTime;
							const curve = propertyCurve(freshClip, k.propertyId);
							const kf =
								curve && isAnimated(curve)
									? curve.keyframes.find((item) => item.time === currentKeyTime)
									: null;
							const finalVal = kf ? kf.value : readProperty(freshClip, k.propertyId, currentKeyTime);
							if (finalVal !== undefined) {
								store.getState().setKeyframeValue(
									k.clipId,
									k.propertyId,
									currentKeyTime,
									finalVal,
									k.channelIdx,
									true
								);
							}
						}
					}
				} else if (drag.kind === 'handle' && drag.handle?.lastHandles) {
					store.getState().setBezierHandles(
						drag.handle.clipId,
						drag.handle.propertyId,
						drag.handle.keyframeTime,
						drag.handle.lastHandles,
						true
					);
				} else if (drag.kind === 'marquee' && selectedClip && svgRef.current) {
					const rect = svgRef.current.getBoundingClientRect();
					const endX = e.clientX - rect.left;
					const endY = e.clientY - rect.top;
					const x1 = Math.min(drag.startX - rect.left, endX);
					const x2 = Math.max(drag.startX - rect.left, endX);
					const y1 = Math.min(drag.startY - rect.top, endY);
					const y2 = Math.max(drag.startY - rect.top, endY);

					if (Math.abs(x2 - x1) > 4 || Math.abs(y2 - y1) > 4) {
						const selectedRefs: Array<{ clipId: ClipId; propertyId: PropertyId; time: Time }> = [];
						for (const curve of curves) {
							for (const k of curve.keyframes) {
								const kx = timeToX(k.time);
								const ky = valToY(k.value);
								if (kx >= x1 && kx <= x2 && ky >= y1 && ky <= y2) {
									selectedRefs.push({
										clipId: selectedClip.id,
										propertyId: curve.propertyId,
										time: k.time
									});
								}
							}
						}
						store.getState().setKeyframeSelection(selectedRefs);
					} else {
						// Single click on empty canvas: deselect keyframes
						store.getState().clearKeyframeSelection();
					}
					setMarquee(null);
				}
				try {
					if (svgRef.current?.hasPointerCapture?.(e.pointerId)) {
						svgRef.current.releasePointerCapture(e.pointerId);
					}
				} catch {}
				activeDrag.current = null;
				setHud(null);
			}

			if (resizeDrag.current) {
				resizeDrag.current = null;
			}
		};

		window.addEventListener('pointermove', handleGlobalPointerMove);
		window.addEventListener('pointerup', handleGlobalPointerUp);
		window.addEventListener('pointercancel', handleGlobalPointerUp);

		return () => {
			window.removeEventListener('pointermove', handleGlobalPointerMove);
			window.removeEventListener('pointerup', handleGlobalPointerUp);
			window.removeEventListener('pointercancel', handleGlobalPointerUp);
		};
	}, [
		selectedClip,
		curves,
		fps,
		plotW,
		plotH,
		timeToX,
		xToTime,
		valToY,
		yToVal,
		store
	]);

	// Canvas Pointer Down
	const handlePointerDownCanvas = (e: ReactPointerEvent<SVGSVGElement>) => {
		if (!selectedClip || activeDrag.current) return;
		const rect = e.currentTarget.getBoundingClientRect();
		const clickX = e.clientX - rect.left;
		const clickY = e.clientY - rect.top;

		if (e.button === 1 || e.altKey) {
			// Middle-click or Alt+click: pan
			e.preventDefault();
			activeDrag.current = {
				kind: 'pan',
				startX: e.clientX,
				startY: e.clientY,
				currentX: e.clientX,
				currentY: e.clientY,
				initialBounds: { ...bounds }
			};
			return;
		}

		if (clickY < padTop + 14 || clickY > viewSize.height - padBottom - 14) {
			// Scrub playhead
			const clickedTime = Math.max(
				0,
				Math.min(selectedClip.duration, Math.round(xToTime(clickX)))
			);
			store.getState().setPlayhead(selectedClip.start + clickedTime);
			activeDrag.current = {
				kind: 'playhead',
				startX: e.clientX,
				startY: e.clientY,
				currentX: e.clientX,
				currentY: e.clientY
			};
			return;
		}

		// Empty space: Start marquee selection
		activeDrag.current = {
			kind: 'marquee',
			startX: e.clientX,
			startY: e.clientY,
			currentX: e.clientX,
			currentY: e.clientY
		};
	};

	// Double click to add keyframe at time and value
	const handleDoubleClickCanvas = (e: ReactMouseEvent<SVGSVGElement>) => {
		if (!selectedClip || curves.length === 0) return;
		const rect = e.currentTarget.getBoundingClientRect();
		const clickX = e.clientX - rect.left;
		const clickY = e.clientY - rect.top;

		const time = Math.max(0, Math.min(selectedClip.duration, Math.round(xToTime(clickX))));
		const snappedTime = safeFramesToTicks(safeTicksToFrames(time, fps), fps);
		const displayVal = yToVal(clickY);

		const target = nearestChannel(
			selectedClip,
			curves.map((curve) => ({ ...curve, displayFactor: curve.desc.displayFactor })),
			snappedTime,
			displayVal
		);
		if (!target) return;
		store
			.getState()
			.addKeyframeAtTime(
				selectedClip.id,
				target.propertyId,
				snappedTime,
				channelKeyValue(selectedClip, target, snappedTime, displayVal)
			);
	};

	// Wheel Zoom & Pan
	const handleWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
		e.preventDefault();
		const rect = e.currentTarget.getBoundingClientRect();
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		const currentMinT = bounds.minT;
		const currentMaxT = bounds.maxT;
		const currentMinV = bounds.minV;
		const currentMaxV = bounds.maxV;

		if (e.ctrlKey || e.metaKey) {
			// Zoom time axis centered at mouse cursor
			const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
			const tMouse = xToTime(mouseX);
			const newSpan = (currentMaxT - currentMinT) * zoomFactor;
			const ratio = (tMouse - currentMinT) / Math.max(1, currentMaxT - currentMinT);
			const newMinT = Math.max(0, tMouse - ratio * newSpan);
			const newMaxT = newMinT + newSpan;
			setCustomViewport({
				minT: newMinT,
				maxT: newMaxT,
				minV: currentMinV,
				maxV: currentMaxV
			});
		} else if (e.altKey) {
			// Zoom value axis centered at mouse cursor
			const zoomFactor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
			const vMouse = yToVal(mouseY);
			const newSpan = (currentMaxV - currentMinV) * zoomFactor;
			const ratio = (vMouse - currentMinV) / Math.max(0.001, currentMaxV - currentMinV);
			const newMinV = vMouse - ratio * newSpan;
			const newMaxV = newMinV + newSpan;
			setCustomViewport({
				minT: currentMinT,
				maxT: currentMaxT,
				minV: newMinV,
				maxV: newMaxV
			});
		} else {
			// Horizontal pan
			const panPixels = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : e.deltaY * 0.5;
			const dt = (panPixels / plotW) * (currentMaxT - currentMinT);
			const newMinT = Math.max(0, currentMinT + dt);
			const newMaxT = newMinT + (currentMaxT - currentMinT);
			setCustomViewport({
				minT: newMinT,
				maxT: newMaxT,
				minV: currentMinV,
				maxV: currentMaxV
			});
		}
	};

	// Keyboard Navigation Shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

			if (e.key === 'Delete' || e.key === 'Backspace') {
				if (selectedKeyframeRefs.length > 0) {
					e.preventDefault();
					store.getState().deleteSelectedKeyframes();
				}
			} else if (e.key === 'Escape') {
				store.getState().clearKeyframeSelection();
			} else if (e.key === 'f' || e.key === 'F') {
				e.preventDefault();
				setCustomViewport(null);
			} else if (e.key === 'j' || e.key === 'J' || e.key === '[') {
				e.preventDefault();
				store.getState().prevKeyframe();
			} else if (e.key === 'k' || e.key === 'K' || e.key === ']') {
				e.preventDefault();
				store.getState().nextKeyframe();
			} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				if (selectedKeyframeRefs.length > 0) {
					e.preventDefault();
					const stepFrames = e.shiftKey ? 10 : 1;
					const dt = safeFramesToTicks(stepFrames, fps) * (e.key === 'ArrowRight' ? 1 : -1);
					store.getState().moveSelectedKeyframes(dt, true);
				}
			} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
				if (selectedKeyframeRefs.length > 0 && selectedClip) {
					e.preventDefault();
					const deltaDisplay = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
					for (const ref of selectedKeyframeRefs) {
						const curve = curves.find((c) => c.propertyId === ref.propertyId);
						if (!curve) continue;
						const k = curve.keyframes.find((item) => item.time === ref.time);
						if (!k) continue;
						const newDisplay = k.value + deltaDisplay;
						const internal = newDisplay / (curve.desc.displayFactor || 1);

						const raw = readProperty(selectedClip, curve.propertyId, k.time);
						let finalVal: PropertyValue = internal;
						if (Array.isArray(raw)) {
							const nextArr = [...raw];
							nextArr[curve.channelIdx] = internal;
							finalVal = nextArr as unknown as PropertyValue;
						}
						store
							.getState()
							.setKeyframeValue(selectedClip.id, curve.propertyId, k.time, finalVal, curve.channelIdx, true);
					}
				}
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
				if (selectedKeyframeRefs.length > 0) {
					store.getState().copySelectedKeyframes();
				}
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
				store.getState().pasteKeyframes();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [selectedKeyframeRefs, selectedClip, curves, fps, store]);

	// Top Border Resize
	const handleResizeStart = (e: ReactPointerEvent) => {
		e.preventDefault();
		resizeDrag.current = {
			startY: e.clientY,
			startHeight: panelHeight
		};

		const onMove = (ev: PointerEvent) => {
			if (!resizeDrag.current) return;
			const delta = resizeDrag.current.startY - ev.clientY;
			updatePanelHeight(resizeDrag.current.startHeight + delta);
		};

		const onUp = () => {
			resizeDrag.current = null;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};

		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	};

	const toggleFilter = (propId: PropertyId) => {
		const next = visibleProperties.includes(propId)
			? visibleProperties.filter((p) => p !== propId)
			: [...visibleProperties, propId];
		store.getState().setGraphVisibleProperties(next);
		setSoloChannelId(null);
	};

	const localPlayhead = selectedClip ? playhead - selectedClip.start : -1;
	const playheadX = localPlayhead >= 0 ? timeToX(localPlayhead) : -1;

	return (
		<div
			className="graph-editor-panel"
			ref={containerRef}
			style={{ height: `${panelHeight}px` }}
			role="region"
			aria-label="Keyframe Graph Editor"
		>
			{/* Resize Handle at Top Edge */}
			<div
				className="graph-resize-handle"
				onPointerDown={handleResizeStart}
				onDoubleClick={() => updatePanelHeight(240)}
				title="Drag to resize Graph Editor (double-click to reset)"
			>
				<div className="graph-resize-indicator" />
			</div>

			{/* Modern Toolbar */}
			<div className="graph-editor-toolbar">
				{/* Property Pills */}
				<div className="graph-toolbar-group graph-toolbar-pills">
					{availableFilterProperties.map((propId) => {
						const desc = descriptorFor(propId);
						if (!desc) return null;
						const isVisible = visibleProperties.includes(propId);
						const curve = selectedClip ? propertyCurve(selectedClip, propId) : null;
						const isAnim = Boolean(curve && isAnimated(curve) && curve.keyframes.length > 0);

						return (
							<div key={propId} className="graph-toolbar-group">
								<button
									type="button"
									className={`graph-filter-btn ${isVisible ? 'is-active' : ''} ${isAnim ? 'is-animated' : ''}`}
									onClick={() => toggleFilter(propId)}
									title={`Toggle ${desc.label} curve visibility`}
								>
									<span
										className="graph-property-dot"
										style={{ background: PROPERTY_COLORS[`${propId}:0`] ?? PROPERTY_COLORS[propId] ?? '#8b5cf6' }}
									/>
									{desc.label}
								</button>

								{/* Solo channel tags for multi-channel properties */}
								{isVisible && desc.channels.length > 1 && (
									<div className="graph-toolbar-group" style={{ gap: '2px', marginRight: '4px' }}>
										{desc.channels.map((chan, idx) => {
											const channelId = `${propId}:${idx}`;
											const isSolo = soloChannelId === channelId;
											const badge = chan.length > 2 ? chan[0]!.toUpperCase() : chan;
											return (
												<span
													key={chan}
													className={`graph-channel-tag ${isSolo ? 'is-solo' : ''}`}
													style={{ background: PROPERTY_COLORS[channelId] ?? '#3b82f6' }}
													onClick={(e) => {
														e.stopPropagation();
														setSoloChannelId(isSolo ? null : channelId);
													}}
													title={isSolo ? `Show all channels` : `Solo ${desc.label} ${chan}`}
												>
													{badge}
												</span>
											);
										})}
									</div>
								)}
							</div>
						);
					})}
				</div>

				<div className="graph-toolbar-divider" />

				{/* Interpolation Presets */}
				<div className="graph-toolbar-group">
					<div className="graph-preset-group">
						<button
							type="button"
							className={`graph-preset-btn ${selectedInterpolation === 'linear' ? 'is-active' : ''}`}
							onClick={() => store.getState().setKeyframeInterpolation('linear')}
							title="Linear interpolation"
						>
							Linear
						</button>
						<button
							type="button"
							className={`graph-preset-btn ${selectedInterpolation === 'ease-in' ? 'is-active' : ''}`}
							onClick={() => store.getState().setKeyframeInterpolation('ease-in')}
							title="Ease In (slows into keyframe)"
						>
							Ease In
						</button>
						<button
							type="button"
							className={`graph-preset-btn ${selectedInterpolation === 'ease-out' ? 'is-active' : ''}`}
							onClick={() => store.getState().setKeyframeInterpolation('ease-out')}
							title="Ease Out (slows out from keyframe)"
						>
							Ease Out
						</button>
						<button
							type="button"
							className={`graph-preset-btn ${selectedInterpolation === 'ease-both' ? 'is-active' : ''}`}
							onClick={() => store.getState().easyEase()}
							title="Ease Both / Easy Ease"
						>
							Ease Both
						</button>
						<button
							type="button"
							className={`graph-preset-btn ${selectedInterpolation === 'hold' ? 'is-active' : ''}`}
							onClick={() => store.getState().setKeyframeInterpolation('hold')}
							title="Hold (stepped value)"
						>
							Hold
						</button>
						{(
							[
								['spring', 'Spring', 'Spring (overshoots and settles)'],
								['elastic', 'Elastic', 'Elastic (swings past the target)'],
								['bounce', 'Bounce', 'Bounce (rebounds off the target)']
							] as const
						).map(([preset, label, hint]) => (
							<button
								key={preset}
								type="button"
								className={`graph-preset-btn ${selectedInterpolation === preset ? 'is-active' : ''}`}
								onClick={() => store.getState().setKeyframeInterpolation(preset)}
								title={hint}
							>
								{label}
							</button>
						))}
					</div>
				</div>

				<div className="graph-toolbar-divider" />

				{/* Navigation & Keyframe Actions */}
				<div className="graph-toolbar-group">
					<button
						type="button"
						className="graph-icon-btn"
						onClick={() => store.getState().prevKeyframe()}
						title="Previous Keyframe (J)"
						aria-label="Previous Keyframe"
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
							<polyline points="15 18 9 12 15 6" />
						</svg>
					</button>

					<button
						type="button"
						className="graph-icon-btn"
						onClick={() => {
							if (selectedClip && curves.length > 0) {
								const keyed = selectedKeyframeRefs.find((ref) => ref.clipId === selectedClip.id);
								store
									.getState()
									.toggleKeyframe(selectedClip.id, keyed?.propertyId ?? curves[0]!.propertyId);
							}
						}}
						title="Add / Toggle Keyframe at Playhead"
						aria-label="Add or Toggle Keyframe"
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
							<polygon points="12,2 22,12 12,22 2,12" />
						</svg>
					</button>

					<button
						type="button"
						className="graph-icon-btn"
						onClick={() => store.getState().nextKeyframe()}
						title="Next Keyframe (K)"
						aria-label="Next Keyframe"
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
							<polyline points="9 18 15 12 9 6" />
						</svg>
					</button>

					<button
						type="button"
						className="graph-icon-btn"
						onClick={() => store.getState().deleteSelectedKeyframes()}
						disabled={selectedKeyframeRefs.length === 0}
						title="Delete Selected Keyframes (Delete / Backspace)"
						aria-label="Delete Keyframes"
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<polyline points="3 6 5 6 21 6" />
							<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
						</svg>
					</button>
				</div>

				<div className="graph-toolbar-divider" />

				{/* Viewport Zoom & Close */}
				<div className="graph-toolbar-group" style={{ marginLeft: 'auto' }}>
					<button
						type="button"
						className="graph-icon-btn"
						onClick={() => setCustomViewport(null)}
						title="Fit all curves to view (F)"
						aria-label="Fit View"
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
						</svg>
					</button>

					<button
						type="button"
						className="graph-icon-btn"
						onClick={() => {
							const spanT = (bounds.maxT - bounds.minT) * 0.8;
							setCustomViewport({
								minT: bounds.minT,
								maxT: bounds.minT + spanT,
								minV: bounds.minV,
								maxV: bounds.maxV
							});
						}}
						title="Zoom In (Ctrl + Scroll)"
						aria-label="Zoom In"
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<circle cx="11" cy="11" r="8" />
							<line x1="21" y1="21" x2="16.65" y2="16.65" />
							<line x1="11" y1="8" x2="11" y2="14" />
							<line x1="8" y1="11" x2="14" y2="11" />
						</svg>
					</button>

					<button
						type="button"
						className="graph-icon-btn"
						onClick={() => {
							const spanT = (bounds.maxT - bounds.minT) * 1.25;
							setCustomViewport({
								minT: bounds.minT,
								maxT: bounds.minT + spanT,
								minV: bounds.minV,
								maxV: bounds.maxV
							});
						}}
						title="Zoom Out (Ctrl + Scroll)"
						aria-label="Zoom Out"
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
							<circle cx="11" cy="11" r="8" />
							<line x1="21" y1="21" x2="16.65" y2="16.65" />
							<line x1="8" y1="11" x2="14" y2="11" />
						</svg>
					</button>

					<button
						type="button"
						className="graph-close-btn"
						onClick={() => store.getState().setGraphOpen(false)}
						title="Close Graph Editor"
						aria-label="Close Graph Editor"
					>
						✕
					</button>
				</div>
			</div>

			{/* SVG Curve Canvas Container */}
			<div className="graph-canvas-container">
				{!selectedClip ? (
					<div className="graph-empty-state">
						<svg className="graph-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
							<rect x="2" y="3" width="20" height="14" rx="2" />
							<line x1="8" y1="21" x2="16" y2="21" />
							<line x1="12" y1="17" x2="12" y2="21" />
						</svg>
						<span>Select a clip with animated properties to view and edit curves</span>
					</div>
				) : curves.length === 0 ? (
					<div className="graph-empty-state">
						<svg className="graph-empty-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
							<path d="M3 12h4l3 8 4-16 3 8h4" />
						</svg>
						<span>No animated curves active. Turn on keyframes in Inspector or double-click to add a keyframe.</span>
					</div>
				) : (
					<svg
						ref={(el) => {
							(svgRef as any).current = el;
							if (
								el &&
								(el.clientWidth !== viewSize.width || el.clientHeight !== viewSize.height)
							) {
								if (el.clientWidth > 0 && el.clientHeight > 0) {
									setViewSize({ width: el.clientWidth, height: el.clientHeight });
								}
							}
						}}
						className="graph-svg"
						onPointerDown={handlePointerDownCanvas}
						onDoubleClick={handleDoubleClickCanvas}
						onWheel={handleWheel}
					>
						<defs>
							{curves.map((curve) => (
								<linearGradient
									key={`grad-${curve.id}`}
									id={`grad-${curve.id}`}
									x1="0"
									y1="0"
									x2="0"
									y2="1"
								>
									<stop offset="0%" stopColor={curve.color} stopOpacity="0.25" />
									<stop offset="100%" stopColor={curve.color} stopOpacity="0.0" />
								</linearGradient>
							))}
						</defs>

						{/* Horizontal Value Grid Lines */}
						{[0, 0.25, 0.5, 0.75, 1].map((frac) => {
							const val = bounds.minV + (bounds.maxV - bounds.minV) * frac;
							const y = valToY(val);
							const isZero = Math.abs(val) < 0.0001;
							return (
								<g key={frac}>
									<line
										x1={padLeft}
										y1={y}
										x2={viewSize.width - padRight}
										y2={y}
										className={isZero ? 'graph-baseline-zero' : 'graph-grid-line'}
									/>
									<text x={padLeft - 6} y={y + 3.5} textAnchor="end" className="graph-axis-label">
										{val.toFixed(Math.abs(val) < 10 ? 1 : 0)}
									</text>
								</g>
							);
						})}

						{/* Vertical Time Grid Lines */}
						{[0, 0.2, 0.4, 0.6, 0.8, 1].map((frac) => {
							const t = bounds.minT + (bounds.maxT - bounds.minT) * frac;
							const x = timeToX(t);
							const sec = safeTicksToSeconds(t);
							return (
								<g key={frac}>
									<line
										x1={x}
										y1={padTop}
										x2={x}
										y2={viewSize.height - padBottom}
										className="graph-grid-line"
									/>
									<text
										x={x}
										y={viewSize.height - padBottom + 14}
										textAnchor="middle"
										className="graph-time-label"
									>
										{sec.toFixed(1)}s
									</text>
								</g>
							);
						})}

						{/* Axes Lines */}
						<line
							x1={padLeft}
							y1={padTop}
							x2={padLeft}
							y2={viewSize.height - padBottom}
							className="graph-axis-line"
						/>
						<line
							x1={padLeft}
							y1={viewSize.height - padBottom}
							x2={viewSize.width - padRight}
							y2={viewSize.height - padBottom}
							className="graph-axis-line"
						/>

						{/* Render Curves */}
						{curves.map((curve) => {
							const rawCurve = propertyCurve(selectedClip, curve.propertyId);
							if (!rawCurve || !isAnimated(rawCurve)) return null;

							const sampleCount = Math.min(240, Math.max(40, Math.floor(plotW / 3)));
							const points: Array<{ x: number; y: number }> = [];

							for (let i = 0; i <= sampleCount; i++) {
								const t = bounds.minT + (i / sampleCount) * (bounds.maxT - bounds.minT);
								const ev = evaluate(rawCurve, t);
								const num = Array.isArray(ev) ? (ev[curve.channelIdx] ?? 0) : ev;
								const v = num * curve.desc.displayFactor;
								points.push({ x: timeToX(t), y: valToY(v) });
							}

							const pathData = points
								.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
								.join(' ');

							const baselineY = valToY(Math.max(bounds.minV, Math.min(bounds.maxV, 0)));
							const areaData = `${pathData} L ${points[points.length - 1]!.x.toFixed(1)} ${baselineY.toFixed(1)} L ${points[0]!.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;

							return (
								<g key={curve.id}>
									{/* Subtle Area Fill */}
									<path d={areaData} fill={`url(#grad-${curve.id})`} className="graph-curve-area" />

									{/* Smooth Stroke Path */}
									<path d={pathData} stroke={curve.color} className="graph-curve-path" />

									{/* Bezier Tangent Control Handles */}
									{curve.keyframes.map((k, idx) => {
										const isSelected = selectedKeyframeRefs.some(
											(ref) =>
												ref.clipId === selectedClip.id &&
												ref.propertyId === curve.propertyId &&
												ref.time === k.time
										);

										const nextK = curve.keyframes[idx + 1];
										const prevK = curve.keyframes[idx - 1];

										return (
											<g key={`handles-${curve.id}-${idx}`}>
												{/* Ease Out Handle (forward towards next keyframe) */}
												{nextK && isSelected && (
													(() => {
														const dt = nextK.time - k.time;
														const dv = nextK.value - k.value;
														const hx = k.easeOut?.x ?? 0.42;
														const hy = k.easeOut?.y ?? 0.0;
														const handleTime = k.time + hx * dt;
														const handleVal = k.value + hy * dv;
														const hScreenX = timeToX(handleTime);
														const hScreenY = valToY(handleVal);
														const kScreenX = timeToX(k.time);
														const kScreenY = valToY(k.value);

														return (
															<g key="easeOut">
																<line
																	x1={kScreenX}
																	y1={kScreenY}
																	x2={hScreenX}
																	y2={hScreenY}
																	className="graph-handle-stem"
																/>
																{/* Generous invisible hit target */}
																<circle
																	cx={hScreenX}
																	cy={hScreenY}
																	r={12}
																	className="graph-handle-hit"
																	onPointerDown={(e) =>
																		handlePointerDownHandle(
																			e,
																			curve,
																			k.time,
																			false,
																			{ time: k.time, value: k.value },
																			{ time: nextK.time, value: nextK.value }
																		)
																	}
																/>
																{/* Visible handle point */}
																<circle
																	cx={hScreenX}
																	cy={hScreenY}
																	r={4.5}
																	stroke={curve.color}
																	className="graph-handle-point"
																	onPointerDown={(e) =>
																		handlePointerDownHandle(
																			e,
																			curve,
																			k.time,
																			false,
																			{ time: k.time, value: k.value },
																			{ time: nextK.time, value: nextK.value }
																		)
																	}
																>
																	<title>Drag to adjust Ease Out velocity/curve</title>
																</circle>
															</g>
														);
													})()
												)}

												{/* Ease In Handle (backward from previous keyframe) */}
												{prevK && isSelected && (
													(() => {
														const dt = k.time - prevK.time;
														const dv = k.value - prevK.value;
														const hx = k.easeIn?.x ?? 0.58;
														const hy = k.easeIn?.y ?? 1.0;
														const handleTime = prevK.time + hx * dt;
														const handleVal = prevK.value + hy * dv;
														const hScreenX = timeToX(handleTime);
														const hScreenY = valToY(handleVal);
														const kScreenX = timeToX(k.time);
														const kScreenY = valToY(k.value);

														return (
															<g key="easeIn">
																<line
																	x1={kScreenX}
																	y1={kScreenY}
																	x2={hScreenX}
																	y2={hScreenY}
																	className="graph-handle-stem"
																/>
																{/* Generous invisible hit target */}
																<circle
																	cx={hScreenX}
																	cy={hScreenY}
																	r={12}
																	className="graph-handle-hit"
																	onPointerDown={(e) =>
																		handlePointerDownHandle(
																			e,
																			curve,
																			k.time,
																			true,
																			{ time: prevK.time, value: prevK.value },
																			{ time: k.time, value: k.value }
																		)
																	}
																/>
																{/* Visible handle point */}
																<circle
																	cx={hScreenX}
																	cy={hScreenY}
																	r={4.5}
																	stroke={curve.color}
																	className="graph-handle-point"
																	onPointerDown={(e) =>
																		handlePointerDownHandle(
																			e,
																			curve,
																			k.time,
																			true,
																			{ time: prevK.time, value: prevK.value },
																			{ time: k.time, value: k.value }
																		)
																	}
																>
																	<title>Drag to adjust Ease In velocity/curve</title>
																</circle>
															</g>
														);
													})()
												)}
											</g>
										);
									})}

									{/* Keyframe Diamonds */}
									{curve.keyframes.map((k, kIdx) => {
										const kx = timeToX(k.time);
										const ky = valToY(k.value);
										const isSelected = selectedKeyframeRefs.some(
											(ref) =>
												ref.clipId === selectedClip.id &&
												ref.propertyId === curve.propertyId &&
												ref.time === k.time
										);

										return (
											<g key={`kf-${curve.id}-${kIdx}`}>
												{/* Generous invisible hit target */}
												<circle
													cx={kx}
													cy={ky}
													r={14}
													className="graph-keyframe-hit"
													onPointerDown={(e) => handlePointerDownKeyframe(e, curve, k)}
												/>

												{/* Visible Diamond */}
												<polygon
													points={`${kx},${ky - 6} ${kx + 6},${ky} ${kx},${ky + 6} ${kx - 6},${ky}`}
													fill={isSelected ? curve.color : 'var(--color-canvas)'}
													stroke={curve.color}
													className={`graph-keyframe-point ${isSelected ? 'is-selected' : ''}`}
													onPointerDown={(e) => handlePointerDownKeyframe(e, curve, k)}
												>
													<title>{`${curve.label}: ${k.value.toFixed(1)}${curve.unit} at ${(k.time / 1_000_000).toFixed(2)}s`}</title>
												</polygon>
											</g>
										);
									})}
								</g>
							);
						})}

						{/* Selection Marquee Box */}
						{marquee && (
							<rect
								x={Math.min(marquee.startX, marquee.currentX)}
								y={Math.min(marquee.startY, marquee.currentY)}
								width={Math.abs(marquee.currentX - marquee.startX)}
								height={Math.abs(marquee.currentY - marquee.startY)}
								className="graph-selection-marquee"
							/>
						)}

						{/* Playhead Scrubber Line */}
						{playheadX >= padLeft && playheadX <= viewSize.width - padRight && (
							<g>
								<line
									x1={playheadX}
									y1={padTop}
									x2={playheadX}
									y2={viewSize.height - padBottom}
									className="graph-playhead-line"
								/>
								<polygon
									points={`${playheadX - 5},${padTop} ${playheadX + 5},${padTop} ${playheadX},${padTop + 8}`}
									className="graph-playhead-handle"
								/>
							</g>
						)}
					</svg>
				)}

				{/* Floating HUD Tooltip */}
				{hud && hud.visible && (
					<div
						className="graph-hud-tooltip"
						style={{
							left: `${hud.x}px`,
							top: `${hud.y}px`
						}}
					>
						<span className="graph-hud-title">
							<span className="graph-property-dot" style={{ background: hud.color }} />
							{hud.label}
						</span>
						<span className="graph-hud-meta">
							Time: {safeTicksToSeconds(hud.time).toFixed(2)}s ({safeTicksToFrames(hud.time, fps)}f)
						</span>
						<span className="graph-hud-meta" style={{ fontWeight: 600, color: 'var(--color-ink)' }}>
							Value: {hud.value.toFixed(1)}{hud.unit}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
