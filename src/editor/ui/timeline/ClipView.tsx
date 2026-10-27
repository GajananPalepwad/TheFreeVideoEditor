import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent,
	type PointerEvent,
	type KeyboardEvent,
	type MouseEvent
} from 'react';
import {
	ANIMATABLE_PROPERTY_IDS,
	calculateFilmstripFrameTimelineTimes,
	descriptorFor,
	isAnimated,
	propertyCurve,
	ticksToTimecode,
	timeToPixels,
	type Asset,
	type Clip,
	type ClipId,
	type InterpolationPreset,
	type Project,
	type PropertyId,
	type Time,
	type Track
} from '../../core';
import { getDerived, type DerivedData } from '../../services/storage/mediaCache';
import { isSpeedExceedingMedia, timelineToSource } from '../../core/timeRemap';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { EFFECT_DEFINITIONS } from '../../core/effects/registry';
import { audioEffectRegistry } from '../../core/audio/effects';
import type { EffectType } from '../../core/effects/types';

interface ClipViewProps {
	clip: Clip;
	asset?: Asset;
	track: Track;
	project: Project;
	pixelsPerSecond: number;
	selected: boolean;
	tabIndex: number;
	ghost?: boolean;
	isLifted?: boolean;
	onPointerDown: (event: PointerEvent<HTMLElement>, clip: Clip, edge?: 'start' | 'end') => void;
	onKeyboardTrim: (clip: Clip, edge: 'start' | 'end', frameDelta: number) => void;
	onSelect: (
		clipId: ClipId,
		modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
	) => void;
	onContextMenu: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, clip: Clip) => void;
}

interface KeyframeContextMenuState {
	x: number;
	y: number;
	propertyId: PropertyId;
	time?: Time;
}

function WaveformCanvas({
	peaks,
	clipDuration,
	pixelsPerSecond
}: {
	peaks: NonNullable<DerivedData['peaks']>;
	clipDuration: Time;
	pixelsPerSecond: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		const width = Math.max(
			1,
			Math.floor(rect.width || timeToPixels(clipDuration, pixelsPerSecond))
		);
		const height = Math.max(1, Math.floor(rect.height || 48));

		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		ctx.scale(dpr, dpr);

		const totalSamples = peaks.max.length;
		if (totalSamples === 0) return;

		const midY = height / 2;
		const halfHeight = height / 2 - 2;

		ctx.clearRect(0, 0, width, height);

		// Center divider line (Premiere Pro style)
		ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(0, midY);
		ctx.lineTo(width, midY);
		ctx.stroke();

		// Premiere Pro waveform filled color
		ctx.fillStyle = '#34d399';

		const step = Math.max(1, width / 400); // 1-2px per column
		for (let x = 0; x < width; x += step) {
			const startSample = Math.floor((x / width) * totalSamples);
			const endSample = Math.min(totalSamples, Math.floor(((x + step) / width) * totalSamples));

			let peakMax = -128;
			let peakMin = 127;
			for (let s = startSample; s <= endSample && s < totalSamples; s++) {
				const maxVal = peaks.max[s] ?? 0;
				const minVal = peaks.min[s] ?? 0;
				if (maxVal > peakMax) peakMax = maxVal;
				if (minVal < peakMin) peakMin = minVal;
			}
			if (peakMax === -128) peakMax = 0;
			if (peakMin === 127) peakMin = 0;

			// Normalizing -128..127 to 0..1 amplitude
			const ampMax = Math.min(1, Math.max(0, Math.abs(peakMax) / 100));
			const ampMin = Math.min(1, Math.max(0, Math.abs(peakMin) / 100));
			const amp = Math.max(0.04, Math.max(ampMax, ampMin));

			const barH = amp * halfHeight;
			const colW = Math.max(1, step - 0.5);

			// Draw mirrored upper & lower bars from center
			ctx.fillRect(x, midY - barH, colW, barH * 2);
		}
	}, [peaks, clipDuration, pixelsPerSecond]);

	return <canvas ref={canvasRef} className="timeline-waveform-canvas" aria-hidden="true" />;
}

function FilmstripView({
	derived,
	poster,
	clip,
	pixelsPerSecond
}: {
	derived: DerivedData | null;
	poster: string;
	clip: Clip;
	pixelsPerSecond: number;
}) {
	const frameWidth = 56; // ~1-1.5 cm frame width
	const frameTimes = calculateFilmstripFrameTimelineTimes(
		clip.start,
		clip.duration,
		pixelsPerSecond,
		frameWidth
	);

	// Pre-create URLs for available thumbs
	const thumbUrls = useMemo(() => {
		if (!derived?.thumbs || derived.thumbs.length === 0) return [];
		return derived.thumbs.map((item) => ({
			time: item.time,
			url: URL.createObjectURL(item.blob)
		}));
	}, [derived?.thumbs]);

	useEffect(() => {
		return () => {
			const toRevoke = [...thumbUrls];
			setTimeout(() => {
				for (const item of toRevoke) {
					URL.revokeObjectURL(item.url);
				}
			}, 2000);
		};
	}, [thumbUrls]);

	if (thumbUrls.length === 0 && poster) {
		return <img className="timeline-thumbnail" src={poster} alt="" />;
	}

	if (thumbUrls.length === 0) {
		return null;
	}

	return (
		<div className="timeline-filmstrip" aria-hidden="true">
			{frameTimes.map((frameTimelineTime, i) => {
				const sourceTime = timelineToSource(clip, frameTimelineTime);

				// Find closest thumb
				let closest = thumbUrls[0]!;
				let minDiff = Math.abs(closest.time - sourceTime);
				for (let t = 1; t < thumbUrls.length; t++) {
					const diff = Math.abs(thumbUrls[t]!.time - sourceTime);
					if (diff < minDiff) {
						minDiff = diff;
						closest = thumbUrls[t]!;
					}
				}

				return (
					<img
						key={i}
						className="timeline-filmstrip-frame"
						src={closest.url}
						alt=""
						style={{ width: `${frameWidth}px` }}
						draggable={false}
					/>
				);
			})}
		</div>
	);
}

function ClipArtwork({
	project,
	asset,
	track,
	clip,
	pixelsPerSecond
}: {
	project: Project;
	asset: Asset;
	track: Track;
	clip: Clip;
	pixelsPerSecond: number;
}) {
	const derivedStatus = useEditorStore((state) => state.media.derivedStatus[asset.id]);
	const [derived, setDerived] = useState<DerivedData | null>(null);
	const [poster, setPoster] = useState('');

	useEffect(() => {
		let active = true;
		let objectUrl = '';
		void getDerived(project.id, asset.id)
			.then((data) => {
				if (!active || !data) return;
				setDerived(data);
				if (data.poster.size > 0) {
					objectUrl = URL.createObjectURL(data.poster);
					setPoster(objectUrl);
				}
			})
			.catch((error: unknown) => console.error(`Could not load preview for ${asset.name}.`, error));
		return () => {
			active = false;
			if (objectUrl) {
				const url = objectUrl;
				setTimeout(() => URL.revokeObjectURL(url), 2000);
			}
		};
	}, [asset.id, asset.name, project.id, derivedStatus]);

	if (track.kind === 'audio') {
		const peak = derived?.peaks;
		if (peak) {
			return (
				<div className="timeline-waveform" aria-hidden="true">
					<WaveformCanvas
						peaks={peak}
						clipDuration={clip.duration}
						pixelsPerSecond={pixelsPerSecond}
					/>
				</div>
			);
		}
	}

	if (asset.kind === 'video') {
		return (
			<FilmstripView
				derived={derived}
				poster={poster}
				clip={clip}
				pixelsPerSecond={pixelsPerSecond}
			/>
		);
	}

	if (poster) {
		return <img className="timeline-thumbnail" src={poster} alt="" width="120" height="68" />;
	}

	return (
		<span className="timeline-clip-placeholder" aria-hidden="true">
			{asset.kind === 'audio' ? '♫' : '▧'}
		</span>
	);
}

export default function ClipView({
	clip,
	asset,
	track,
	project,
	pixelsPerSecond,
	selected,
	tabIndex,
	ghost = false,
	isLifted = false,
	onPointerDown,
	onKeyboardTrim,
	onSelect,
	onContextMenu
}: ClipViewProps) {
	const store = useEditorStoreApi();
	const showLanes = useEditorStore((state) => state.keyframes.showLanes);
	const selectedKeyframeRefs = useEditorStore((state) => state.keyframes.selection);

	const [lanesExpanded, setLanesExpanded] = useState(false);
	const [kfMenu, setKfMenu] = useState<KeyframeContextMenuState | null>(null);

	const start = timeToPixels(clip.start, pixelsPerSecond);
	const width = Math.max(12, timeToPixels(clip.duration, pixelsPerSecond));
	const startLabel = ticksToTimecode(clip.start, project.settings.fps);
	const durationLabel = ticksToTimecode(clip.duration, project.settings.fps);
	const clipRef = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const element = clipRef.current;
		if (!element || ghost) return;
		if (!('IntersectionObserver' in window)) {
			setVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
			{ rootMargin: '80px' }
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ghost]);

	// Animated properties for this clip
	const shouldShowKeyframes =
		!ghost && (showLanes === 'all' || (showLanes === 'selected' && selected));

	const animatedProps: PropertyId[] = useMemo(() => {
		if (!shouldShowKeyframes) return [];
		const propList: PropertyId[] = [...ANIMATABLE_PROPERTY_IDS];
		if (clip.masks) {
			for (const mask of clip.masks) {
				propList.push(`mask:${mask.id}:shape` as PropertyId);
				propList.push(`mask:${mask.id}:feather` as PropertyId);
				propList.push(`mask:${mask.id}:expansion` as PropertyId);
				propList.push(`mask:${mask.id}:opacity` as PropertyId);
			}
		}
		return propList.filter((propId) => {
			const curve = propertyCurve(clip, propId);
			return curve && isAnimated(curve) && curve.keyframes.length > 0;
		});
	}, [clip, shouldShowKeyframes]);

	const summaryKeyframes = useMemo(() => {
		if (animatedProps.length === 0) return [];
		const keys: { propertyId: PropertyId; time: Time }[] = [];
		for (const propId of animatedProps) {
			const curve = propertyCurve(clip, propId);
			if (curve && isAnimated(curve)) {
				for (const k of curve.keyframes) {
					keys.push({ propertyId: propId, time: k.time });
				}
			}
		}
		return keys;
	}, [clip, animatedProps]);

	// Keyframe diamond dragging
	const dragRef = useRef<{
		propertyId: PropertyId;
		keyTime: Time;
		startX: number;
		altKey: boolean;
	} | null>(null);

	const handleDiamondPointerDown = useCallback(
		(e: PointerEvent<HTMLDivElement>, propId: PropertyId, keyTime: Time) => {
			if (e.button !== 0) return;
			e.stopPropagation();
			store
				.getState()
				.selectKeyframe(
					{ clipId: clip.id, propertyId: propId, time: keyTime },
					e.shiftKey ? 'toggle' : 'set'
				);

			dragRef.current = {
				propertyId: propId,
				keyTime,
				startX: e.clientX,
				altKey: e.altKey
			};
			e.currentTarget.setPointerCapture(e.pointerId);
		},
		[clip.id, store]
	);

	const handleDiamondPointerMove = useCallback(
		(e: PointerEvent<HTMLDivElement>) => {
			if (!dragRef.current) return;
			const deltaPx = e.clientX - dragRef.current.startX;
			const deltaSeconds = deltaPx / pixelsPerSecond;
			const deltaTime = Math.round(deltaSeconds * 1_000_000);
			if (deltaTime !== 0) {
				store.getState().moveSelectedKeyframes(deltaTime, false);
				dragRef.current.startX = e.clientX;
			}
		},
		[pixelsPerSecond, store]
	);

	const handleDiamondPointerUp = useCallback(
		(e: PointerEvent<HTMLDivElement>) => {
			if (!dragRef.current) return;
			const wasAlt = dragRef.current.altKey || e.altKey;
			dragRef.current = null;
			try {
				e.currentTarget.releasePointerCapture(e.pointerId);
			} catch {}

			if (wasAlt) {
				store.getState().copySelectedKeyframes();
				store.getState().pasteKeyframes();
			} else {
				store.getState().moveSelectedKeyframes(0, true);
			}
		},
		[store]
	);

	const openDiamondContextMenu = (
		e: MouseEvent<HTMLElement>,
		propertyId: PropertyId,
		time?: Time
	) => {
		e.preventDefault();
		e.stopPropagation();
		setKfMenu({ x: e.clientX, y: e.clientY, propertyId, time });
	};

	const applyInterpolation = (preset: Exclude<InterpolationPreset, 'bezier'>) => {
		store.getState().setKeyframeInterpolation(preset);
		setKfMenu(null);
	};

	const isAdjustment = clip.source?.type === 'adjustment';
	const isSolid = clip.source?.type === 'solid';
	const isText = clip.source?.type === 'text';
	const isShape = clip.source?.type === 'shape';
	const isSequence = clip.source?.type === 'sequence';
	const nestedSeqId = clip.source?.type === 'sequence' ? clip.source.sequenceId : null;
	const nestedSeq = nestedSeqId ? project.sequences?.[nestedSeqId] : null;
	const sequenceName = nestedSeq?.name ?? (isSequence ? 'Nested Sequence' : '');
	const nestedDuration = nestedSeq
		? nestedSeq.tracks.reduce((max, t) => {
				const cMax = t.clips.reduce((cm, c) => Math.max(cm, c.start + c.duration), max);
				return (t.captions ?? []).reduce((cam, cap) => Math.max(cam, cap.end), cMax);
			}, 0)
		: 0;
	const isSequenceEmpty = isSequence && nestedDuration === 0;
	const isPastSequenceEnd =
		isSequence &&
		!isSequenceEmpty &&
		clip.sourceIn + clip.duration * (clip.speed || 1) > nestedDuration;
	const textContent = clip.source?.type === 'text' ? clip.source.text : '';
	const shapeTypeLabel =
		clip.source?.type === 'shape' && clip.source.shapeType
			? clip.source.shapeType.charAt(0).toUpperCase() + clip.source.shapeType.slice(1)
			: 'Shape';
	const isTemplate =
		clip.source?.type === 'sequence' &&
		Boolean(clip.source.templateId || clip.source.publishedParams?.length);
	const templateName = clip.source?.type === 'sequence' ? clip.source.templateName : undefined;

	const clipName =
		asset?.name ??
		(isTemplate
			? `✦ ${templateName || sequenceName || 'Template'}`
			: isSequence
				? `▸ ${sequenceName}`
				: isText
					? `T ${textContent || 'Text'}`
					: isShape
						? `◆ ${shapeTypeLabel}`
						: isAdjustment
							? 'Adjustment Layer'
							: isSolid
								? 'Solid'
								: 'Clip');
	const kindClass =
		track.kind === 'audio'
			? 'is-audio'
			: isTemplate
				? 'is-sequence is-motion-template'
				: isSequence
					? 'is-sequence'
					: isText
						? 'is-text'
						: isShape
							? 'is-shape'
							: isAdjustment
								? 'is-adjustment'
								: isSolid
									? 'is-solid'
									: 'is-video';

	// Drag & Drop effects onto clip
	const [isEffectTarget, setIsEffectTarget] = useState(false);
	const [isEffectInvalid, setIsEffectInvalid] = useState(false);
	const [hoveredEffectName, setHoveredEffectName] = useState<string | null>(null);
	const [isDropCelebrated, setIsDropCelebrated] = useState(false);
	const [celebrationEffectName, setCelebrationEffectName] = useState<string | null>(null);
	const dragCounterRef = useRef(0);

	const isVideoFxCompatible =
		track.kind === 'video' ||
		asset?.kind === 'video' ||
		asset?.kind === 'image' ||
		clip.source?.type === 'text' ||
		clip.source?.type === 'shape' ||
		clip.source?.type === 'adjustment' ||
		clip.source?.type === 'solid' ||
		clip.source?.type === 'sequence';

	const isAudioFxCompatible =
		track.kind === 'audio' ||
		Boolean(asset?.hasAudio) ||
		asset?.kind === 'video' ||
		asset?.kind === 'audio';

	const handleDragEnter = useCallback(
		(e: DragEvent<HTMLDivElement>) => {
			if (ghost) return;
			const isVideoFx = e.dataTransfer.types.includes('application/x-tfve-effect');
			const isAudioFx = e.dataTransfer.types.includes('application/x-tfve-audio-effect');
			if (!isVideoFx && !isAudioFx) return;

			dragCounterRef.current++;
			e.preventDefault();
			e.stopPropagation();

			const isCompatible = isVideoFx ? isVideoFxCompatible : isAudioFxCompatible;

			setIsEffectTarget(isCompatible);
			setIsEffectInvalid(!isCompatible);
			e.dataTransfer.dropEffect = isCompatible ? 'copy' : 'none';

			const fxName =
				e.dataTransfer.getData('application/x-tfve-effect-name') ||
				(isVideoFx ? 'Video Effect' : 'Audio Effect');
			setHoveredEffectName(fxName);
		},
		[ghost, isVideoFxCompatible, isAudioFxCompatible]
	);

	const handleDragOver = useCallback(
		(e: DragEvent<HTMLDivElement>) => {
			if (ghost) return;
			const isVideoFx = e.dataTransfer.types.includes('application/x-tfve-effect');
			const isAudioFx = e.dataTransfer.types.includes('application/x-tfve-audio-effect');
			if (!isVideoFx && !isAudioFx) return;

			e.preventDefault();
			e.stopPropagation();

			const isCompatible = isVideoFx ? isVideoFxCompatible : isAudioFxCompatible;

			e.dataTransfer.dropEffect = isCompatible ? 'copy' : 'none';
			if (!isEffectTarget && isCompatible) {
				setIsEffectTarget(true);
			}
		},
		[ghost, isEffectTarget, isVideoFxCompatible, isAudioFxCompatible]
	);

	const handleDragLeave = useCallback(
		(e: DragEvent<HTMLDivElement>) => {
			if (ghost) return;
			const isVideoFx = e.dataTransfer.types.includes('application/x-tfve-effect');
			const isAudioFx = e.dataTransfer.types.includes('application/x-tfve-audio-effect');
			if (!isVideoFx && !isAudioFx) return;

			dragCounterRef.current--;
			if (dragCounterRef.current <= 0) {
				dragCounterRef.current = 0;
				setIsEffectTarget(false);
				setIsEffectInvalid(false);
				setHoveredEffectName(null);
			}
		},
		[ghost]
	);

	const handleDrop = useCallback(
		(e: DragEvent<HTMLDivElement>) => {
			if (ghost) return;
			dragCounterRef.current = 0;
			const videoEffectId = e.dataTransfer.getData('application/x-tfve-effect');
			const audioEffectId = e.dataTransfer.getData('application/x-tfve-audio-effect');
			if (!videoEffectId && !audioEffectId) return;

			e.preventDefault();
			e.stopPropagation();
			setIsEffectTarget(false);
			setIsEffectInvalid(false);
			setHoveredEffectName(null);

			const effectName =
				e.dataTransfer.getData('application/x-tfve-effect-name') ||
				(videoEffectId ? EFFECT_DEFINITIONS[videoEffectId]?.name : undefined) ||
				(audioEffectId ? audioEffectRegistry.get(audioEffectId)?.name : undefined) ||
				videoEffectId ||
				audioEffectId;

			if (videoEffectId) {
				if (isVideoFxCompatible) {
					store.getState().addEffect(clip.id, videoEffectId as EffectType);
					store.getState().selectClips([clip.id], 'replace');
					store.getState().revealInspectorSection('effects');
					setCelebrationEffectName(effectName);
					setIsDropCelebrated(true);
					setTimeout(() => setIsDropCelebrated(false), 950);
					store.getState().setTimelineMessage(`Applied ${effectName} to ${clipName}.`);
				}
			} else if (audioEffectId) {
				if (isAudioFxCompatible) {
					const existing = clip.audioEffects ? [...clip.audioEffects] : [];
					const newFx = audioEffectRegistry.createDefaultInstance(audioEffectId);
					newFx.managedBy = 'user';
					existing.push(newFx);
					store.getState().setClipAudioEffects(clip.id, existing);
					store.getState().selectClips([clip.id], 'replace');
					store.getState().revealInspectorSection('audio');
					setCelebrationEffectName(effectName);
					setIsDropCelebrated(true);
					setTimeout(() => setIsDropCelebrated(false), 950);
					store.getState().setTimelineMessage(`Applied ${effectName} audio effect to ${clipName}.`);
				}
			}
		},
		[ghost, clip.id, clip.audioEffects, clipName, isVideoFxCompatible, isAudioFxCompatible, store]
	);

	return (
		<div
			ref={clipRef}
			className={`timeline-clip ${kindClass} ${selected ? 'is-selected' : ''} ${clip.groupId ? 'is-grouped' : ''} ${asset?.offline ? 'is-offline' : ''} ${ghost ? 'is-ghost' : ''} ${isLifted ? 'is-drag-lifted' : ''} ${isEffectTarget ? 'is-effect-target' : ''} ${isEffectInvalid ? 'is-effect-invalid' : ''} ${isDropCelebrated ? 'is-drop-celebrated' : ''}`}
			data-clip-id={clip.id}
			data-track-id={track.id}
			role="group"
			tabIndex={ghost ? -1 : tabIndex}
			aria-label={`Clip: ${clipName}, ${track.name}, starts ${startLabel}, duration ${durationLabel}${clip.linkId ? ', linked' : ''}${clip.groupId ? ', grouped' : ''}${asset?.offline ? ', offline' : ''}${selected ? ', selected' : ''}`}
			draggable={false}
			style={{ left: start, width }}
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			onPointerDown={(event) => {
				if (ghost) return;
				if (event.button === 2) {
					// Right-click: if not already selected, select this clip so the context menu targets it.
					// If already selected (e.g. part of a multi-selection), preserve the existing selection.
					if (!selected) {
						onSelect(clip.id, event);
					}
					return;
				}
				if (event.button !== 0) return;
				const hasModifiers = event.shiftKey || event.ctrlKey || event.metaKey;
				if (!selected || hasModifiers) {
					onSelect(clip.id, event);
				}
				if (!(event.target instanceof HTMLElement && event.target.closest('.clip-trim-handle'))) {
					onPointerDown(event, clip);
				}
			}}
			onDoubleClick={(event) => {
				if (ghost) return;
				if (clip.source?.type === 'sequence') {
					event.stopPropagation();
					store.getState().openSequence(clip.source.sequenceId);
				}
			}}
			onContextMenu={(event) => {
				if (ghost) return;
				if (store.getState().timeline.drag) {
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				onContextMenu(event, clip);
			}}
			onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
				if (ghost) return;
				if (event.key === 'Enter') {
					event.preventDefault();
					onSelect(clip.id, event);
				}
				if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
					event.preventDefault();
					onContextMenu(event, clip);
				}
				if (event.key === 'Delete' || event.key === 'Backspace') {
					if (selectedKeyframeRefs.some((r) => r.clipId === clip.id)) {
						event.preventDefault();
						event.stopPropagation();
						store.getState().deleteSelectedKeyframes();
					}
				}
				if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
					if (selectedKeyframeRefs.some((r) => r.clipId === clip.id)) {
						event.preventDefault();
						event.stopPropagation();
						const frames = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1);
						const delta = Math.round((frames / project.settings.fps) * 1_000_000);
						store.getState().moveSelectedKeyframes(delta, true);
					}
				}
			}}
		>
			{!ghost && (
				<>
					<button
						type="button"
						className="clip-trim-start clip-trim-handle"
						aria-label={`Trim start of ${clipName}`}
						title="Use Left/Right Arrow to trim by 1 frame; Shift for 10 frames."
						onPointerDown={(event) => {
							event.stopPropagation();
							onPointerDown(event, clip, 'start');
						}}
						onKeyDown={(event) => {
							if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
							event.preventDefault();
							event.stopPropagation();
							const multiplier = event.shiftKey ? 10 : 1;
							onKeyboardTrim(clip, 'start', (event.key === 'ArrowLeft' ? -1 : 1) * multiplier);
						}}
					/>
					<button
						type="button"
						className="clip-trim-handle clip-trim-end"
						aria-label={`Trim end of ${clipName}`}
						title="Use Left/Right Arrow to trim by 1 frame; Shift for 10 frames."
						onPointerDown={(event) => {
							event.stopPropagation();
							onPointerDown(event, clip, 'end');
						}}
						onKeyDown={(event) => {
							if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
							event.preventDefault();
							event.stopPropagation();
							const multiplier = event.shiftKey ? 10 : 1;
							onKeyboardTrim(clip, 'end', (event.key === 'ArrowLeft' ? -1 : 1) * multiplier);
						}}
					/>
				</>
			)}
			{visible && asset && (
				<ClipArtwork
					project={project}
					asset={asset}
					track={track}
					clip={clip}
					pixelsPerSecond={pixelsPerSecond}
				/>
			)}
			<span className="timeline-clip-name">
				{asset?.offline && <b>Offline · </b>}
				{clipName}
			</span>
			{clip.linkId && (
				<span className="clip-link-mark" aria-label="Linked clip">
					↔
				</span>
			)}
			{clip.groupId && (
				<span className="clip-group-mark" aria-label="Grouped clip" title="Grouped clip">
					⧉
				</span>
			)}
			{clip.speed !== undefined && clip.speed !== 1 && !clip.timeRemap && (
				<span
					className="clip-speed-badge"
					style={{
						position: 'relative',
						zIndex: 1,
						marginLeft: 'var(--spacing-xxs)',
						padding: '1px 4px',
						borderRadius: 'var(--radius-sm, 2px)',
						background: 'color-mix(in srgb, var(--color-ink) 12%, transparent)',
						color: 'var(--color-ink)',
						fontFamily: 'var(--font-mono)',
						fontSize: '0.625rem',
						lineHeight: 1
					}}
					title={`Playback speed: ${Math.round(clip.speed * 100)}%`}
				>
					{clip.speed < 0
						? `−${Math.round(Math.abs(clip.speed) * 100)}%`
						: `${Math.round(clip.speed * 100)}%`}
				</span>
			)}
			{clip.timeRemap && (
				<span
					className="clip-speed-badge clip-remap-badge"
					style={{
						position: 'relative',
						zIndex: 1,
						marginLeft: 'var(--spacing-xxs)',
						padding: '1px 4px',
						borderRadius: 'var(--radius-sm, 2px)',
						background: 'color-mix(in srgb, var(--color-cyan, #06b6d4) 25%, transparent)',
						color: 'var(--color-ink)',
						fontFamily: 'var(--font-mono)',
						fontSize: '0.625rem',
						lineHeight: 1
					}}
					title="Time Remapped"
				>
					Remap
				</span>
			)}
			{isSequenceEmpty && (
				<span
					className="clip-sequence-badge clip-empty-sequence-badge"
					data-testid="empty-sequence-badge"
					style={{
						position: 'relative',
						zIndex: 1,
						marginLeft: 'var(--spacing-xxs)',
						padding: '1px 4px',
						borderRadius: 'var(--radius-sm, 2px)',
						background: 'color-mix(in srgb, var(--color-amber, #f59e0b) 25%, transparent)',
						color: 'var(--color-ink)',
						fontFamily: 'var(--font-mono)',
						fontSize: '0.625rem',
						lineHeight: 1
					}}
					title="Empty sequence"
				>
					Empty
				</span>
			)}
			{isPastSequenceEnd && (
				<span
					className="clip-sequence-badge clip-past-end-badge"
					data-testid="past-sequence-end-badge"
					style={{
						position: 'relative',
						zIndex: 1,
						marginLeft: 'var(--spacing-xxs)',
						padding: '1px 4px',
						borderRadius: 'var(--radius-sm, 2px)',
						background: 'color-mix(in srgb, var(--color-rose, #f43f5e) 25%, transparent)',
						color: 'var(--color-ink)',
						fontFamily: 'var(--font-mono)',
						fontSize: '0.625rem',
						lineHeight: 1
					}}
					title="Extends past sequence end (renders transparent)"
				>
					Past End
				</span>
			)}
			{asset && !ghost && isSpeedExceedingMedia(clip, asset) && (
				<span
					className="clip-speed-exceeds-warning"
					style={{
						position: 'relative',
						zIndex: 1,
						marginLeft: 'var(--spacing-xxs)',
						color: 'var(--color-warning, #f59e0b)',
						fontSize: '0.625rem'
					}}
					title="Speed curve exceeds media duration (freeze hold applied)"
					aria-label="Speed curve exceeds media duration"
				>
					⚠️
				</span>
			)}
			{Boolean(
				!ghost &&
				((clip.effects && clip.effects.length > 0) ||
					(clip.audioEffects && clip.audioEffects.length > 0))
			) && (
				<span
					className="clip-fx-badge"
					title={`Effects applied: ${[
						...(clip.effects?.map((e) => e.type) ?? []),
						...(clip.audioEffects?.map((e) => e.type) ?? [])
					].join(', ')}`}
				>
					fx
				</span>
			)}
			<span className="timeline-clip-duration">{durationLabel}</span>

			{/* Keyframe summary lane */}
			{summaryKeyframes.length > 0 && (
				<div className="clip-keyframe-summary" onClick={(e) => e.stopPropagation()}>
					<button
						type="button"
						className="clip-keyframe-expand-btn"
						onClick={(e) => {
							e.stopPropagation();
							setLanesExpanded(!lanesExpanded);
						}}
						title={lanesExpanded ? 'Collapse keyframe lanes' : 'Expand keyframe lanes'}
						aria-label={lanesExpanded ? 'Collapse keyframe lanes' : 'Expand keyframe lanes'}
					>
						{lanesExpanded ? '▾' : '▸'}
					</button>
					<div className="clip-keyframe-track">
						{summaryKeyframes.map((k) => {
							const kx = timeToPixels(k.time, pixelsPerSecond);
							const isSelected = selectedKeyframeRefs.some(
								(ref) =>
									ref.clipId === clip.id && ref.propertyId === k.propertyId && ref.time === k.time
							);
							return (
								<div
									key={`${k.propertyId}:${k.time}`}
									className={`clip-keyframe-diamond ${isSelected ? 'is-selected' : ''}`}
									style={{ left: `${kx}px` }}
									title={`${k.propertyId} @ ${ticksToTimecode(k.time, project.settings.fps)}`}
									onPointerDown={(e) => handleDiamondPointerDown(e, k.propertyId, k.time)}
									onPointerMove={handleDiamondPointerMove}
									onPointerUp={handleDiamondPointerUp}
									onContextMenu={(e) => openDiamondContextMenu(e, k.propertyId, k.time)}
								/>
							);
						})}
					</div>
				</div>
			)}

			{/* Expandable property lanes */}
			{lanesExpanded && animatedProps.length > 0 && (
				<div className="clip-keyframe-lanes" onClick={(e) => e.stopPropagation()}>
					{animatedProps.map((propId) => {
						const curve = propertyCurve(clip, propId);
						if (!curve || !isAnimated(curve)) return null;
						const desc = descriptorFor(propId);
						return (
							<div
								key={propId}
								className="clip-keyframe-lane-row"
								onContextMenu={(e) => openDiamondContextMenu(e, propId)}
							>
								<span className="clip-lane-label" title={desc?.label ?? propId}>
									{desc?.label ?? propId}
								</span>
								<div className="clip-keyframe-track">
									{curve.keyframes.map((k) => {
										const kx = timeToPixels(k.time, pixelsPerSecond);
										const isSelected = selectedKeyframeRefs.some(
											(ref) =>
												ref.clipId === clip.id && ref.propertyId === propId && ref.time === k.time
										);
										return (
											<div
												key={k.time}
												className={`clip-keyframe-diamond ${isSelected ? 'is-selected' : ''}`}
												style={{ left: `${kx}px` }}
												title={`${desc?.label ?? propId} @ ${ticksToTimecode(k.time, project.settings.fps)}`}
												onPointerDown={(e) => handleDiamondPointerDown(e, propId, k.time)}
												onPointerMove={handleDiamondPointerMove}
												onPointerUp={handleDiamondPointerUp}
												onContextMenu={(e) => openDiamondContextMenu(e, propId, k.time)}
											/>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			)}

			{/* Keyframe Context Menu */}
			{kfMenu && (
				<div
					className="timeline-context-menu"
					style={{
						position: 'fixed',
						left: kfMenu.x,
						top: kfMenu.y,
						zIndex: 100
					}}
					onClick={(e) => e.stopPropagation()}
				>
					{kfMenu.time !== undefined ? (
						<>
							<button type="button" onClick={() => applyInterpolation('linear')}>
								Linear
							</button>
							<button type="button" onClick={() => applyInterpolation('hold')}>
								Hold
							</button>
							<button type="button" onClick={() => applyInterpolation('ease-in')}>
								Ease In
							</button>
							<button type="button" onClick={() => applyInterpolation('ease-out')}>
								Ease Out
							</button>
							<button type="button" onClick={() => applyInterpolation('ease-in-out')}>
								Ease In-Out
							</button>
							<hr />
							<button
								type="button"
								onClick={() => {
									store.getState().copySelectedKeyframes();
									setKfMenu(null);
								}}
							>
								Copy Keyframe
							</button>
							<button
								type="button"
								onClick={() => {
									store.getState().deleteSelectedKeyframes();
									setKfMenu(null);
								}}
							>
								Delete Keyframe
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								onClick={() => {
									store.getState().toggleKeyframe(clip.id, kfMenu.propertyId);
									setKfMenu(null);
								}}
							>
								Add Keyframe at Playhead
							</button>
							<button
								type="button"
								onClick={() => {
									store.getState().pasteKeyframes(clip.id, kfMenu.propertyId);
									setKfMenu(null);
								}}
							>
								Paste Keyframes
							</button>
						</>
					)}
					<hr />
					<button type="button" onClick={() => setKfMenu(null)}>
						Close
					</button>
				</div>
			)}

			{/* Drag & Drop Effect Indicator & Satisfying Feedback */}
			{isEffectTarget && (
				<div className="clip-effect-target-overlay" aria-hidden="true">
					<div className="clip-effect-glow-shimmer" />
					<div className="clip-effect-target-badge">
						<span className="badge-sparkle">✨</span>
						<span className="badge-name">+ {hoveredEffectName || 'Effect'}</span>
					</div>
				</div>
			)}
			{isEffectInvalid && (
				<div className="clip-effect-invalid-overlay" aria-hidden="true">
					<div className="clip-effect-invalid-badge">
						<span>✕</span>
						<span>Incompatible</span>
					</div>
				</div>
			)}
			{isDropCelebrated && (
				<div className="clip-effect-celebration-overlay" aria-hidden="true">
					<div className="clip-drop-flash-ring" />
					<div className="clip-drop-burst-particles" />
					<div className="clip-drop-success-badge">
						<span className="success-check">✓</span>
						<span className="success-text">{celebrationEffectName || 'Effect'} Added!</span>
					</div>
				</div>
			)}
		</div>
	);
}
