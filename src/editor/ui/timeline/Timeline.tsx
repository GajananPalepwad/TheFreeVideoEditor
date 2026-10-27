import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type DragEvent,
	type KeyboardEvent,
	type PointerEvent,
	type MouseEvent,
	type CSSProperties,
	type ReactNode
} from 'react';
import {
	clientXToTimelineTime,
	collectSnapPoints,
	framesToTicks,
	intersectsPixelRange,
	groupOf,
	snapTime,
	ticksToTimecode,
	timeToPixels,
	timelineDuration,
	isTransitionsEnabled
} from '../../core';
import { isRootSequence, viewProject } from '../../core/sequences/access';
import type {
	AssetId,
	Clip,
	ClipId,
	DragPosition,
	DragSession,
	Project,
	SequenceId,
	Time,
	Track,
	TrackId
} from '../../core';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import ClipView from './ClipView';
import { CaptionSegmentView } from './CaptionSegmentView';
import { TransitionBlock } from './TransitionBlock';
import type { TransitionType } from '../../core/transitionsRegistry';
import { createTemplateInstanceClip } from '../../core/templates/templateService';
import { resolveMotionTemplate } from '../../core/templates/builtinTemplates';
import { createShapeClip } from '../../core/adjustment';
import type { ShapeConfig } from '../../core/shapes/shapeTypes';
import { SaveTemplateModal } from '../graphics/SaveTemplateModal';
import {
	isMotionTemplateClip,
	type MotionGraphicTemplate
} from '../../core/templates/templateTypes';
import { EFFECT_DEFINITIONS } from '../../core/effects/registry';
import { audioEffectRegistry } from '../../core/audio/effects';
import type { EffectType } from '../../core/effects/types';
import Playhead from './Playhead';
import TimelineRuler from './TimelineRuler';
import TimelineToolbar from './TimelineToolbar';
import TimelineTools from './TimelineTools';
import GraphEditor from '../graph/GraphEditor';
import './timeline.css';
import '../ai/ai.css';

const DEFAULT_HEADER_WIDTH = 212;
const MOBILE_HEADER_WIDTH = 88;
const TAIL_SECONDS = 12;

function useIsMobile(breakpoint = '(max-width: 48rem)'): boolean {
	const [isMobile, setIsMobile] = useState<boolean>(() => {
		if (typeof window === 'undefined') return false;
		return window.matchMedia(breakpoint).matches;
	});

	useEffect(() => {
		if (typeof window === 'undefined') return;
		const mql = window.matchMedia(breakpoint);
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		setIsMobile(mql.matches);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	}, [breakpoint]);

	return isMobile;
}

interface ContextPosition {
	x: number;
	y: number;
	clip?: Clip;
	lane?: {
		trackId: TrackId;
		time: Time;
	};
	gap?: {
		trackId: TrackId;
		start: Time;
		end: Time;
	};
}

function ConnectedToolbar({
	project,
	clipCount,
	sequenceTabs,
	onSplit,
	onDelete,
	onRippleDelete,
	onZoom,
	onFit,
	onAddTrack,
	pixelsPerSecond
}: {
	project: Project;
	clipCount: number;
	sequenceTabs?: ReactNode;
	onSplit: () => void;
	onDelete: () => void;
	onRippleDelete: () => void;
	onZoom: (value: number) => void;
	onFit: () => void;
	onAddTrack: (kind: Track['kind']) => void;
	pixelsPerSecond: number;
}) {
	const playhead = useEditorStore((state) => state.timeline.playhead);
	const activeSeqId = useEditorStore((state) => state.activeSequenceId);
	const maximizedPanelId = useEditorStore((state) => state.maximizedPanelId);
	const snapToMarkers = useEditorStore((state) => state.timeline.snapToMarkers);
	const snapEnabled = useEditorStore((state) => state.timeline.snapEnabled);
	const showLanes = useEditorStore((state) => state.keyframes.showLanes);
	const graphOpen = useEditorStore((state) => state.keyframes.graph.open);
	const toggleSnap = useEditorStore((state) => state.toggleSnap);
	const setSnapToMarkers = useEditorStore((state) => state.setSnapToMarkers);
	const toggleKeyframeLanes = useEditorStore((state) => state.toggleKeyframeLanes);
	const toggleGraphEditor = useEditorStore((state) => state.toggleGraphEditor);
	const store = useEditorStoreApi();
	const duration = timelineDuration(project);
	const seqMarkers =
		(activeSeqId && project.sequences?.[activeSeqId]?.markers) || project.markers || [];
	return (
		<TimelineToolbar
			playheadLabel={ticksToTimecode(playhead, project.settings.fps)}
			durationLabel={ticksToTimecode(duration, project.settings.fps)}
			clipCount={clipCount}
			sequenceTabs={sequenceTabs}
			isMaximized={maximizedPanelId === 'timeline'}
			onToggleMaximize={() => store.getState().toggleMaximizePanel('timeline')}
			snapEnabled={snapEnabled}
			onToggleSnap={toggleSnap}
			snapToMarkers={snapToMarkers}
			onToggleSnapToMarkers={() => setSnapToMarkers(!snapToMarkers)}
			showLanes={showLanes}
			onToggleKeyframes={toggleKeyframeLanes}
			graphOpen={graphOpen}
			onToggleGraph={toggleGraphEditor}
			markerCount={seqMarkers.length}
			pixelsPerSecond={pixelsPerSecond}
			onSplit={onSplit}
			onDelete={onDelete}
			onRippleDelete={onRippleDelete}
			onZoom={onZoom}
			onFit={onFit}
			onAddTrack={onAddTrack}
			onAddAdjustment={() => store.getState().addAdjustmentLayer()}
			onAddSolid={() => store.getState().addSolidLayer()}
			onAddShape={() => store.getState().addShapeClip()}
			onAddText={() => store.getState().addTextClip()}
			onAddCaption={() => store.getState().addCaptionAtPlayhead()}
		/>
	);
}

function ConnectedPlayhead({
	pixelsPerSecond,
	offset
}: {
	pixelsPerSecond: number;
	offset: number;
}) {
	const playhead = useEditorStore((state) => state.timeline.playhead);
	const scrollLeft = useEditorStore((state) => state.timeline.scrollLeft);
	const playheadPx = timeToPixels(playhead, pixelsPerSecond);
	if (playheadPx < scrollLeft) {
		return null;
	}
	return <Playhead time={playhead} pixelsPerSecond={pixelsPerSecond} offset={offset} />;
}

function TrackHeader({
	track,
	index,
	selected,
	onSelect,
	onRename,
	onRemove,
	onFlag,
	onReorder
}: {
	track: Track;
	index: number;
	selected?: boolean;
	onSelect?: () => void;
	onRename: (trackId: TrackId, name: string) => void;
	onRemove: (track: Track) => void;
	onFlag: (trackId: TrackId, flags: Partial<Pick<Track, 'muted' | 'locked' | 'hidden'>>) => void;
	onReorder: (trackId: TrackId, targetIndex: number) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(track.name);
	const [isDragOver, setIsDragOver] = useState(false);
	const nameInputRef = useRef<HTMLInputElement>(null);
	useEffect(() => setName(track.name), [track.name]);
	useEffect(() => {
		if (editing) nameInputRef.current?.focus();
	}, [editing]);
	return (
		<div
			className={`timeline-track-header track-${track.kind}${selected ? 'is-selected' : ''}${isDragOver ? 'is-track-drag-over' : ''}`}
			draggable
			role="group"
			tabIndex={0}
			aria-label={`${track.name} track controls. Use Alt+Arrow Up or Alt+Arrow Down to reorder.`}
			data-track-header-id={track.id}
			onClick={(event) => {
				if ((event.target as HTMLElement).closest('button, input')) return;
				onSelect?.();
			}}
			onDragStart={(event) => {
				event.dataTransfer.setData('application/x-tfve-track', track.id);
				event.dataTransfer.effectAllowed = 'move';
			}}
			onDragEnter={(event) => {
				if (event.dataTransfer.types.includes('application/x-tfve-track')) {
					setIsDragOver(true);
				}
			}}
			onDragOver={(event) => {
				if (event.dataTransfer.types.includes('application/x-tfve-track')) {
					event.preventDefault();
					event.dataTransfer.dropEffect = 'move';
				}
			}}
			onDragLeave={(event) => {
				if (event.currentTarget.contains(event.relatedTarget as Node)) return;
				setIsDragOver(false);
			}}
			onDrop={(event) => {
				setIsDragOver(false);
				const draggedId = event.dataTransfer.getData('application/x-tfve-track') as TrackId;
				if (!draggedId) return;
				event.preventDefault();
				onReorder(draggedId, index);
			}}
			onKeyDown={(event) => {
				if (!event.altKey) return;
				if (event.key === 'ArrowUp') {
					event.preventDefault();
					event.stopPropagation();
					onReorder(track.id, index - 1);
				} else if (event.key === 'ArrowDown') {
					event.preventDefault();
					event.stopPropagation();
					onReorder(track.id, index + 1);
				}
			}}
		>
			<span className="track-kind" aria-hidden="true">
				{track.kind === 'video' ? 'V' : track.kind === 'caption' ? 'CC' : 'A'}
			</span>
			{editing ? (
				<input
					ref={nameInputRef}
					className="timeline-track-name-input"
					name={`track-name-${track.id}`}
					autoComplete="off"
					value={name}
					aria-label={`Rename ${track.name}`}
					onChange={(event) => setName(event.currentTarget.value)}
					onBlur={() => {
						onRename(track.id, name);
						setEditing(false);
					}}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							onRename(track.id, name);
							setEditing(false);
						} else if (event.key === 'Escape') {
							setName(track.name);
							setEditing(false);
						}
					}}
				/>
			) : (
				<button
					className="timeline-track-name"
					type="button"
					title="Double-click or press Enter to rename. Alt+↑/↓ reorders tracks."
					onDoubleClick={() => setEditing(true)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && event.detail === 0) setEditing(true);
					}}
				>
					{track.name}
				</button>
			)}
			<div className="timeline-track-controls" role="group" aria-label={`${track.name} settings`}>
				<button
					type="button"
					className={`timeline-track-control-btn track-lock-btn ${track.locked ? 'is-active' : ''}`}
					aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`}
					aria-pressed={track.locked}
					title={track.locked ? 'Unlock track' : 'Lock track'}
					onClick={() => onFlag(track.id, { locked: !track.locked })}
				>
					{track.locked ? (
						<svg
							width="11"
							height="11"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0 1 10 0v4" />
						</svg>
					) : (
						<svg
							width="11"
							height="11"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ opacity: 0.55 }}
							aria-hidden="true"
						>
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
							<path d="M7 11V7a5 5 0 0 1 9.9-1" />
						</svg>
					)}
				</button>
				{track.kind === 'audio' && (
					<button
						type="button"
						className={`timeline-track-control-btn track-mute-btn ${track.muted ? 'is-active' : ''}`}
						aria-label={`${track.muted ? 'Unmute' : 'Mute'} ${track.name}`}
						aria-pressed={track.muted}
						title={track.muted ? 'Unmute track (M)' : 'Mute track (M)'}
						onClick={() => onFlag(track.id, { muted: !track.muted })}
					>
						M
					</button>
				)}
				{(track.kind === 'video' || track.kind === 'caption') && (
					<button
						type="button"
						className={`timeline-track-control-btn track-visibility-btn ${track.hidden ? 'is-active' : ''}`}
						aria-label={`${track.hidden ? 'Show' : 'Hide'} ${track.name}`}
						aria-pressed={track.hidden}
						title={track.hidden ? 'Show track' : 'Hide track'}
						onClick={() => onFlag(track.id, { hidden: !track.hidden })}
					>
						{track.hidden ? (
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
								<line x1="1" y1="1" x2="23" y2="23" />
							</svg>
						) : (
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
								<circle cx="12" cy="12" r="3" />
							</svg>
						)}
					</button>
				)}
				<button
					type="button"
					className="timeline-track-control-btn timeline-track-remove"
					aria-label={`Remove ${track.name}`}
					title={track.locked ? 'Unlock this track before removing it.' : 'Remove track'}
					disabled={track.locked}
					onClick={() => onRemove(track)}
				>
					<svg
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>
		</div>
	);
}

function makePosition(project: Project, clipIds: readonly ClipId[]): DragPosition[] {
	const ids = new Set(clipIds);
	return project.tracks.flatMap((track) =>
		track.clips
			.filter((clip) => ids.has(clip.id))
			.map((clip) => ({
				clipId: clip.id,
				trackId: track.id,
				start: clip.start,
				duration: clip.duration,
				sourceIn: clip.sourceIn,
				sourceOut: clip.sourceOut
			}))
	);
}

export default function Timeline() {
	const project = useEditorStore((state) => state.project);

	if (!project) {
		return (
			<div className="timeline-empty">
				<p>No project open</p>
				<span>Open or create a project to view its timeline.</span>
			</div>
		);
	}

	return <ActiveTimeline project={project} />;
}

function ActiveTimeline({ project }: { project: Project }) {
	const store = useEditorStoreApi();
	const pixelsPerSecond = useEditorStore((state) => state.timeline.pixelsPerSecond);
	const playhead = useEditorStore((state) => state.timeline.playhead);
	const scrollLeft = useEditorStore((state) => state.timeline.scrollLeft);
	const scrollTop = useEditorStore((state) => state.timeline.scrollTop);
	const selection = useEditorStore((state) => state.timeline.selection);
	const drag = useEditorStore((state) => state.timeline.drag);
	const snapEnabled = useEditorStore((state) => state.timeline.snapEnabled);
	const snapToMarkers = useEditorStore((state) => state.timeline.snapToMarkers);
	const message = useEditorStore((state) => state.timeline.message);
	const setZoom = useEditorStore((state) => state.setZoom);
	const zoomToFit = useEditorStore((state) => state.zoomToFit);
	const setScroll = useEditorStore((state) => state.setScroll);
	const setTimelineFollowing = useEditorStore((state) => state.setTimelineFollowing);
	const setPlayhead = useEditorStore((state) => state.setPlayhead);
	const selectClips = useEditorStore((state) => state.selectClips);
	const beginTimelineDrag = useEditorStore((state) => state.beginTimelineDrag);
	const updateTimelineDrag = useEditorStore((state) => state.updateTimelineDrag);
	const cancelTimelineDrag = useEditorStore((state) => state.cancelTimelineDrag);
	const commitTimelineDrag = useEditorStore((state) => state.commitTimelineDrag);
	const addAssetToTimeline = useEditorStore((state) => state.addAssetToTimeline);
	const addAssetOnNewTrack = useEditorStore((state) => state.addAssetOnNewTrack);
	const trimTimelineClip = useEditorStore((state) => state.trimClip);
	const splitAtPlayhead = useEditorStore((state) => state.splitAtPlayhead);
	const deleteSelection = useEditorStore((state) => state.deleteSelection);
	const rippleDeleteSelection = useEditorStore((state) => state.rippleDeleteSelection);
	const duplicateSelection = useEditorStore((state) => state.duplicateSelection);
	const addTimelineTrack = useEditorStore((state) => state.addTimelineTrack);
	const removeTimelineTrack = useEditorStore((state) => state.removeTimelineTrack);
	const reorderTimelineTrack = useEditorStore((state) => state.reorderTimelineTrack);
	const renameTimelineTrack = useEditorStore((state) => state.renameTimelineTrack);
	const setTimelineTrackFlags = useEditorStore((state) => state.setTimelineTrackFlags);
	const linkSelection = useEditorStore((state) => state.linkSelection);
	const unlinkSelection = useEditorStore((state) => state.unlinkSelection);
	const groupSelection = useEditorStore((state) => state.groupSelection);
	const ungroupSelection = useEditorStore((state) => state.ungroupSelection);
	const setTimelineMessage = useEditorStore((state) => state.setTimelineMessage);
	const clipClipboard = useEditorStore((state) => state.clipClipboard);
	const keyframeClipboard = useEditorStore((state) => state.keyframes.clipboard);
	const attributesClipboard = useEditorStore((state) => state.attributesClipboard);
	const graphOpen = useEditorStore((state) => state.keyframes.graph.open);
	const activeTool = useEditorStore((state) => state.timeline.activeTool);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const handPanStart = useRef<{ clientX: number; scrollLeft: number } | null>(null);
	const [isPanning, setIsPanning] = useState(false);
	const dragPointer = useRef<number | null>(null);
	const dragStartPos = useRef<{ x: number; y: number } | null>(null);
	const dragHasMoved = useRef<boolean>(false);
	const dragClickedClip = useRef<Clip | null>(null);
	const rulerPointer = useRef<number | null>(null);
	const programmaticScrollLeft = useRef<number | null>(null);
	const dragFrame = useRef<number | null>(null);
	const autoScrollFrame = useRef<number | null>(null);
	const autoScrollPointer = useRef<{
		clientX: number;
		clientY: number;
		pointerId?: number;
		altKey?: boolean;
		ctrlKey?: boolean;
		metaKey?: boolean;
	} | null>(null);
	const pendingDragPreview = useRef<{
		session: DragSession;
		time: Time;
		targetTrackId?: TrackId;
		altKey: boolean;
		commandKey: boolean;
		createTrackKind?: Track['kind'];
	} | null>(null);
	const marqueeStart = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(
		null
	);
	const [marquee, setMarquee] = useState<{
		left: number;
		top: number;
		width: number;
		height: number;
	} | null>(null);
	const [context, setContext] = useState<ContextPosition | null>(null);
	const [viewportWidth, setViewportWidth] = useState(1_000);
	const trackResize = useRef<{
		trackId: TrackId;
		pointerId: number;
		startY: number;
		startHeight: number;
	} | null>(null);
	const [removePending, setRemovePending] = useState<Track | null>(null);
	const removeDialogRef = useRef<HTMLDialogElement>(null);
	const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState(false);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const contextTriggerRef = useRef<HTMLElement | null>(null);

	const isMobile = useIsMobile();
	const headerWidth = isMobile ? MOBILE_HEADER_WIDTH : DEFAULT_HEADER_WIDTH;

	const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const longPressSession = useRef<{
		clip: Clip;
		startX: number;
		startY: number;
		startScrollLeft: number;
		startScrollTop: number;
		pointerId: number;
		session: DragSession;
	} | null>(null);
	const isLongPressDragActive = useRef<boolean>(false);
	const suppressContextMenuUntil = useRef<number>(0);
	const suppressClickUntil = useRef<number>(0);
	const [liftedClipId, setLiftedClipId] = useState<ClipId | null>(null);

	const clips = useMemo(() => project.tracks.flatMap((track) => track.clips), [project]);
	const firstTabStopClipId = selection.clipIds.at(-1) ?? clips[0]?.id;
	const duration = timelineDuration(project);
	const visibleDuration = Math.max(duration + TAIL_SECONDS * 1_000_000, 60_000_000);
	const laneWidth = Math.max(760, timeToPixels(visibleDuration, pixelsPerSecond));
	const worldWidth = headerWidth + laneWidth;
	const clipOverscan = 600;
	const visibleClipRange = {
		start: Math.max(0, scrollLeft - headerWidth - clipOverscan),
		end: scrollLeft + viewportWidth - headerWidth + clipOverscan
	};
	const setTrackHeight = useEditorStore((state) => state.setTimelineTrackHeight);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		if (Math.abs(scroller.scrollLeft - scrollLeft) > 1) scroller.scrollLeft = scrollLeft;
		if (Math.abs(scroller.scrollTop - scrollTop) > 1) scroller.scrollTop = scrollTop;
	}, [scrollLeft, scrollTop]);

	useEffect(() => {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const updateWidth = () => setViewportWidth(scroller.clientWidth);
		updateWidth();
		const observer = new ResizeObserver(updateWidth);
		observer.observe(scroller);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		let previousPlayhead = store.getState().timeline.playhead;
		return store.subscribe((state) => {
			const nextPlayhead = state.timeline.playhead;
			if (nextPlayhead === previousPlayhead) return;
			previousPlayhead = nextPlayhead;
			if (!state.timeline.followPlayhead) return;
			const scroller = scrollerRef.current;
			if (!scroller) return;
			const x = headerWidth + timeToPixels(nextPlayhead, pixelsPerSecond);
			const rightEdge = scroller.scrollLeft + scroller.clientWidth;
			let nextScrollLeft = scroller.scrollLeft;
			if (x > rightEdge - 72) nextScrollLeft = x - scroller.clientWidth + 72;
			else if (x < scroller.scrollLeft + headerWidth + 40) {
				nextScrollLeft = x - headerWidth - 40;
			}
			nextScrollLeft = Math.max(0, nextScrollLeft);
			if (Math.abs(nextScrollLeft - scroller.scrollLeft) < 1) return;
			programmaticScrollLeft.current = nextScrollLeft;
			scroller.scrollLeft = nextScrollLeft;
			setScroll(nextScrollLeft, scroller.scrollTop);
		});
	}, [pixelsPerSecond, setScroll, store, headerWidth]);

	useEffect(() => {
		const dialog = removeDialogRef.current;
		if (!dialog) return;
		if (removePending && !dialog.open) dialog.showModal();
		if (!removePending && dialog.open) dialog.close();
	}, [removePending]);

	useEffect(() => {
		function handleGlobalPointerUp() {
			if (autoScrollFrame.current !== null) {
				cancelAnimationFrame(autoScrollFrame.current);
				autoScrollFrame.current = null;
				autoScrollPointer.current = null;
			}
		}
		window.addEventListener('pointerup', handleGlobalPointerUp);
		window.addEventListener('pointercancel', handleGlobalPointerUp);
		return () => {
			window.removeEventListener('pointerup', handleGlobalPointerUp);
			window.removeEventListener('pointercancel', handleGlobalPointerUp);
			if (autoScrollFrame.current !== null) cancelAnimationFrame(autoScrollFrame.current);
			if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
		};
	}, []);

	useEffect(() => {
		if (!context) return;
		if (contextMenuRef.current) {
			const rect = contextMenuRef.current.getBoundingClientRect();
			const winW = window.innerWidth;
			const winH = window.innerHeight;
			let adjX = context.x;
			let adjY = context.y;
			if (rect.right > winW - 8) {
				adjX = Math.max(8, winW - rect.width - 8);
			}
			if (rect.bottom > winH - 8) {
				adjY = Math.max(8, winH - rect.height - 8);
			}
			if (adjX !== context.x || adjY !== context.y) {
				setContext((prev) => (prev ? { ...prev, x: adjX, y: adjY } : null));
				return;
			}
		}
		contextMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
		const dismiss = (event: globalThis.PointerEvent) => {
			if (event.target instanceof HTMLElement && !event.target.closest('.timeline-context-menu')) {
				setContext(null);
			}
		};
		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === 'Escape') {
				setContext(null);
			}
		};
		window.addEventListener('pointerdown', dismiss);
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('pointerdown', dismiss);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [context]);

	const activeSequenceId = useEditorStore((state) => state.activeSequenceId);
	const detectedSilences = useEditorStore((state) => state.ai?.detectedSilences ?? []);
	const activeProject = useMemo(
		() => viewProject(project, activeSequenceId),
		[project, activeSequenceId]
	);

	function pointerTime(clientX: number): Time {
		const scroller = scrollerRef.current;
		if (!scroller) return 0;
		const rect = scroller.getBoundingClientRect();
		return clientXToTimelineTime(
			clientX,
			rect.left,
			scroller.scrollLeft,
			headerWidth,
			pixelsPerSecond,
			activeProject.settings.fps
		);
	}

	function setSnappedDragTime(
		session: DragSession,
		rawTime: Time,
		targetTrackId?: TrackId,
		altKey = false,
		commandKey = false,
		createTrackKind?: Track['kind']
	) {
		if (!snapEnabled || commandKey || (session.kind === 'asset' && !session.assetId)) {
			updateTimelineDrag(rawTime, { targetTrackId, createTrackKind, unlink: altKey });
			return;
		}
		const excluded = session.clipIds.flatMap((id) =>
			session.unlink || altKey ? [id] : groupOf(activeProject, id).map((clip) => clip.id)
		);
		const points = collectSnapPoints(activeProject, {
			excludeClipIds: excluded,
			playhead: getPlayhead(),
			includeMarkers: snapToMarkers
		});
		const primary = session.original[0];
		const referenceStart =
			session.kind === 'move' && primary
				? primary.start + rawTime - session.pointerStartTime
				: session.kind === 'trim-start' && primary
					? primary.start + rawTime - session.pointerStartTime
					: session.kind === 'trim-end' && primary
						? primary.start + primary.duration + rawTime - session.pointerStartTime
						: rawTime;

		const snapTolerance = framesToTicks(5, activeProject.settings.fps);

		if (session.kind === 'move' && primary) {
			const refStart = Math.max(0, referenceStart);
			const refEnd = refStart + primary.duration;
			const snapStart = snapTime(refStart, points, snapTolerance);
			const snapEnd = snapTime(refEnd, points, snapTolerance);

			let bestDelta: number | undefined;
			let snappedToVal: Time | undefined;

			const startDist =
				snapStart.snappedTo !== undefined ? Math.abs(snapStart.snappedTo - refStart) : Infinity;
			const endDist =
				snapEnd.snappedTo !== undefined ? Math.abs(snapEnd.snappedTo - refEnd) : Infinity;

			if (startDist <= endDist && snapStart.snappedTo !== undefined) {
				bestDelta = snapStart.snappedTo - referenceStart;
				snappedToVal = snapStart.snappedTo;
			} else if (endDist < Infinity && snapEnd.snappedTo !== undefined) {
				bestDelta = snapEnd.snappedTo - primary.duration - referenceStart;
				snappedToVal = snapEnd.snappedTo;
			}

			if (bestDelta !== undefined) {
				updateTimelineDrag(rawTime + bestDelta, {
					targetTrackId,
					createTrackKind,
					unlink: altKey,
					snappedTo: snappedToVal
				});
				return;
			}
		} else {
			const snapResult = snapTime(Math.max(0, referenceStart), points, snapTolerance);
			if (snapResult.snappedTo !== undefined) {
				const delta = snapResult.snappedTo - referenceStart;
				updateTimelineDrag(rawTime + delta, {
					targetTrackId,
					createTrackKind,
					unlink: altKey,
					snappedTo: snapResult.snappedTo
				});
				return;
			}
		}

		updateTimelineDrag(rawTime, { targetTrackId, createTrackKind, unlink: altKey });
	}

	function scheduleDragPreview(
		session: DragSession,
		time: Time,
		targetTrackId: TrackId | undefined,
		altKey: boolean,
		commandKey: boolean,
		createTrackKind?: Track['kind']
	): void {
		pendingDragPreview.current = {
			session,
			time,
			targetTrackId,
			altKey,
			commandKey,
			createTrackKind
		};
		if (dragFrame.current !== null) return;
		dragFrame.current = requestAnimationFrame(() => {
			dragFrame.current = null;
			const pending = pendingDragPreview.current;
			pendingDragPreview.current = null;
			if (pending) {
				setSnappedDragTime(
					pending.session,
					pending.time,
					pending.targetTrackId,
					pending.altKey,
					pending.commandKey,
					pending.createTrackKind
				);
			}
		});
	}

	function getPlayhead(): Time {
		return store.getState().timeline.playhead;
	}

	function beginClipDrag(
		event: PointerEvent<HTMLElement>,
		clip: Clip,
		edge?: 'start' | 'end'
	): void {
		if (event.button !== 0) return;
		if (activeTool === 'hand') return;
		if (activeTool === 'razor') {
			event.preventDefault();
			const time = pointerTime(event.clientX);
			if (time > clip.start && time < clip.start + clip.duration) {
				store.getState().splitClipAt(clip.id, time);
			}
			return;
		}
		if (activeTool === 'track-select') {
			event.preventDefault();
			const time = pointerTime(event.clientX);
			const forwardIds = activeProject.tracks
				.filter((t) => !t.locked)
				.flatMap((t) =>
					t.clips.filter((c) => c.start >= time || (c.start < time && c.start + c.duration > time))
				)
				.map((c) => c.id);
			selectClips(forwardIds, 'replace');
			store.getState().setTimelineMessage(`Selected ${forwardIds.length} forward clip(s).`);
			return;
		}
		event.preventDefault();
		const scroller = scrollerRef.current;
		if (!scroller) return;
		try {
			scroller.setPointerCapture(event.pointerId);
		} catch {
			// Pointer capture can fail on untracked touch or synthetic events
		}
		scroller.focus({ preventScroll: true });
		dragPointer.current = event.pointerId;
		dragStartPos.current = { x: event.clientX, y: event.clientY };
		dragHasMoved.current = false;
		dragClickedClip.current = clip;
		const selectedIds = selection.clipIds.includes(clip.id) ? selection.clipIds : [clip.id];
		const withGroups = [
			...new Set(selectedIds.flatMap((id) => groupOf(activeProject, id).map((item) => item.id)))
		];
		const primaryGroup = groupOf(activeProject, clip.id);
		const allPositions = makePosition(activeProject, [
			...new Set([...withGroups, ...primaryGroup.map((item) => item.id)])
		]);
		const original = [
			...allPositions.filter((item) => item.clipId === clip.id),
			...allPositions.filter((item) => item.clipId !== clip.id)
		];
		const time = pointerTime(event.clientX);
		const isTouch = event.pointerType === 'touch';
		const moveClipIds = event.altKey
			? [clip.id]
			: [clip.id, ...withGroups.filter((id) => id !== clip.id)];

		if (!selection.clipIds.includes(clip.id)) {
			selectClips(moveClipIds, 'replace');
		}

		const session: DragSession = {
			kind:
				activeTool === 'slip'
					? 'slip'
					: edge
						? edge === 'start'
							? 'trim-start'
							: 'trim-end'
						: 'move',
			clipIds: activeTool === 'slip' || edge ? [clip.id] : moveClipIds,
			original,
			preview: original,
			pointerStartTime: time,
			pointerTime: time,
			allowed: true,
			unlink: event.altKey
		};

		if (!isTouch || edge) {
			// Mouse or edge handle trimming: immediate drag
			beginTimelineDrag(session);
			return;
		}

		// Mobile touch on clip body: Hold-to-drag (200ms threshold)
		longPressSession.current = {
			clip,
			startX: event.clientX,
			startY: event.clientY,
			startScrollLeft: scroller.scrollLeft,
			startScrollTop: scroller.scrollTop,
			pointerId: event.pointerId,
			session
		};
		isLongPressDragActive.current = false;
		if (longPressTimer.current) clearTimeout(longPressTimer.current);
		longPressTimer.current = setTimeout(() => {
			longPressTimer.current = null;
			isLongPressDragActive.current = true;
			setLiftedClipId(clip.id);
			try {
				navigator.vibrate?.(25);
			} catch {
				// Ignore if vibrate is disallowed
			}
			beginTimelineDrag(session);
		}, 200);
	}

	function handleClipSelect(
		clipId: ClipId,
		modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey?: boolean }
	): void {
		if (activeTool === 'razor' || activeTool === 'hand' || activeTool === 'track-select') return;
		const mode = modifiers.shiftKey
			? 'add'
			: modifiers.ctrlKey || modifiers.metaKey
				? 'toggle'
				: 'replace';
		const idsToSelect = modifiers.altKey
			? [clipId]
			: groupOf(activeProject, clipId).map((c) => c.id);
		selectClips(idsToSelect, mode);
		store.getState().setScopesOpen(true);
	}

	function handleKeyboardTrim(clip: Clip, edge: 'start' | 'end', frameDelta: number): void {
		const delta = framesToTicks(Math.abs(frameDelta), project.settings.fps) * Math.sign(frameDelta);
		const requestedTime =
			edge === 'start' ? clip.start + delta : clip.start + clip.duration + delta;
		trimTimelineClip(clip.id, edge, Math.max(0, requestedTime));
	}

	function openClipMenu(
		event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
		clip: Clip
	): void {
		if (
			store.getState().timeline.drag ||
			isLongPressDragActive.current ||
			Date.now() < suppressContextMenuUntil.current
		) {
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		event.preventDefault();
		if (!selection.clipIds.includes(clip.id)) {
			const ids = groupOf(activeProject, clip.id).map((c) => c.id);
			selectClips(ids);
		}
		contextTriggerRef.current = event.currentTarget;
		const mouseEvent = 'clientX' in event;
		const rawX = mouseEvent ? event.clientX : 220;
		const rawY = mouseEvent ? event.clientY : 140;
		const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
		const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
		const estimatedW = 240;
		const estimatedH = 340;
		const clampedX = Math.max(10, Math.min(rawX, winW - estimatedW - 10));
		const clampedY = Math.max(10, Math.min(rawY, winH - estimatedH - 10));
		setContext({
			x: clampedX,
			y: clampedY,
			clip
		});
	}

	function closeContextMenu(restoreFocus = true): void {
		setContext(null);
		if (restoreFocus) contextTriggerRef.current?.focus();
		contextTriggerRef.current = null;
	}

	function openGapMenu(
		event: MouseEvent<HTMLElement>,
		trackId: TrackId,
		start: Time,
		end: Time
	): void {
		event.preventDefault();
		event.stopPropagation();
		store.getState().selectGap(trackId, start, end);
		contextTriggerRef.current = event.currentTarget;
		const rawX = event.clientX;
		const rawY = event.clientY;
		const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
		const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
		const estimatedW = 180;
		const estimatedH = 60;
		const clampedX = Math.max(10, Math.min(rawX, winW - estimatedW - 10));
		const clampedY = Math.max(10, Math.min(rawY, winH - estimatedH - 10));
		setContext({
			x: clampedX,
			y: clampedY,
			gap: { trackId, start, end }
		});
	}

	function openLaneMenu(event: MouseEvent<HTMLElement>, trackId: TrackId): void {
		if (
			(event.target as HTMLElement).closest(
				'.timeline-clip, .caption-segment-view, .transition-block, .timeline-gap'
			)
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		store.getState().selectTrack(trackId);
		contextTriggerRef.current = event.currentTarget;
		const rawX = event.clientX;
		const rawY = event.clientY;
		const winW = typeof window !== 'undefined' ? window.innerWidth : 1280;
		const winH = typeof window !== 'undefined' ? window.innerHeight : 800;
		const estimatedW = 180;
		const estimatedH = 120;
		const clampedX = Math.max(10, Math.min(rawX, winW - estimatedW - 10));
		const clampedY = Math.max(10, Math.min(rawY, winH - estimatedH - 10));
		const time = pointerTime(event.clientX);
		setContext({
			x: clampedX,
			y: clampedY,
			lane: { trackId, time }
		});
	}

	function scrubRuler(event: PointerEvent<HTMLDivElement>): void {
		rulerPointer.current = event.pointerId;
		setTimelineFollowing(false);
		setPlayhead(pointerTime(event.clientX));
	}

	function endRulerScrub(): void {
		rulerPointer.current = null;
	}

	function rulerKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
		const frame = Math.round(1_000_000 / activeProject.settings.fps);
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			event.stopPropagation();
			store
				.getState()
				.setPlayhead(
					Math.max(
						0,
						store.getState().timeline.playhead + (event.key === 'ArrowLeft' ? -frame : frame)
					)
				);
		}
	}

	function handleScroll(): void {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		const programmatic = programmaticScrollLeft.current === scroller.scrollLeft;
		programmaticScrollLeft.current = null;
		if (!programmatic) setTimelineFollowing(false);
		setScroll(scroller.scrollLeft, scroller.scrollTop);
	}

	function zoomAt(value: number, clientX?: number): void {
		setTimelineFollowing(false);
		const scroller = scrollerRef.current;
		if (!scroller) {
			setZoom(value);
			return;
		}
		const rect = scroller.getBoundingClientRect();
		const anchorX = clientX ?? rect.left + headerWidth + 100;
		const time = pointerTime(anchorX);
		setZoom(value, { time, pixel: anchorX - rect.left - headerWidth });
	}

	function handleWheel(event: React.WheelEvent<HTMLDivElement>): void {
		const scroller = scrollerRef.current;
		if (!scroller) return;
		setTimelineFollowing(false);
		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			zoomAt(pixelsPerSecond * (event.deltaY < 0 ? 1.1 : 0.9), event.clientX);
		} else if (event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
			scroller.scrollLeft += event.deltaY;
			setScroll(scroller.scrollLeft, scroller.scrollTop);
		}
	}

	function sequenceFromData(dataTransfer: DataTransfer): SequenceId | null {
		const seqId = dataTransfer.getData('application/x-tfve-sequence');
		return seqId ? (seqId as SequenceId) : null;
	}

	function assetFromData(dataTransfer: DataTransfer): AssetId | null {
		const assetId = dataTransfer.getData('application/x-tfve-asset');
		if (assetId) return assetId as AssetId;
		const session = store.getState().timeline.drag;
		return session?.kind === 'asset' ? (session.assetId ?? null) : null;
	}

	function graphicTemplateFromData(dataTransfer: DataTransfer): string | null {
		const templateId = dataTransfer.getData('application/x-tfve-graphic-template');
		if (templateId) return templateId;
		const session = store.getState().timeline.drag;
		return session?.kind === 'graphic-template' ? (session.graphicTemplateId ?? null) : null;
	}

	function customMotionTemplateFromData(dataTransfer: DataTransfer): MotionGraphicTemplate | null {
		const raw = dataTransfer.getData('application/x-tfve-motion-template');
		if (raw) {
			try {
				return JSON.parse(raw) as MotionGraphicTemplate;
			} catch {}
		}
		return null;
	}

	function templateForDrop(
		dataTransfer: DataTransfer,
		templateId: string
	): MotionGraphicTemplate | null {
		return (
			customMotionTemplateFromData(dataTransfer) ??
			store.getState().timeline.drag?.motionTemplate ??
			resolveMotionTemplate(templateId) ??
			null
		);
	}

	function ghostTemplateClip(session: DragSession | null, start: number, duration: number): Clip {
		const template =
			session?.motionTemplate ??
			(session?.graphicTemplateId ? resolveMotionTemplate(session.graphicTemplateId) : undefined);
		const clip = template
			? createTemplateInstanceClip(template, start, template.id as SequenceId)
			: undefined;
		return clip ? { ...clip, duration, sourceOut: duration } : ({ start, duration } as Clip);
	}

	function beginGraphicTemplatePreview(
		event: DragEvent<HTMLElement>,
		targetTrackId: TrackId
	): string | null {
		const templateId = graphicTemplateFromData(event.dataTransfer);
		const track = activeProject.tracks.find((item) => item.id === targetTrackId);
		if (!templateId || !track) return null;
		if (track.kind !== 'video' || track.locked) {
			event.dataTransfer.dropEffect = 'none';
			return templateId;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		const time = pointerTime(event.clientX);
		if (drag?.graphicTemplateId !== templateId || drag?.targetTrackId !== targetTrackId) {
			beginTimelineDrag({
				kind: 'graphic-template',
				clipIds: [],
				original: [],
				preview: [],
				pointerStartTime: 0,
				pointerTime: time,
				targetTrackId,
				createTrackKind: undefined,
				graphicTemplateId: templateId,
				motionTemplate:
					drag?.motionTemplate ?? templateForDrop(event.dataTransfer, templateId) ?? undefined,
				allowed: true,
				unlink: false
			});
		}
		const activeDrag = store.getState().timeline.drag;
		if (activeDrag) scheduleDragPreview(activeDrag, time, targetTrackId, false, false, undefined);
		return templateId;
	}

	function beginGraphicTemplateNewTrackPreview(event: DragEvent<HTMLElement>): string | null {
		const templateId = graphicTemplateFromData(event.dataTransfer);
		if (!templateId) return null;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		const time = pointerTime(event.clientX);
		if (drag?.graphicTemplateId !== templateId || drag?.createTrackKind !== 'video') {
			beginTimelineDrag({
				kind: 'graphic-template',
				clipIds: [],
				original: [],
				preview: [],
				pointerStartTime: 0,
				pointerTime: time,
				targetTrackId: undefined,
				createTrackKind: 'video',
				graphicTemplateId: templateId,
				motionTemplate:
					drag?.motionTemplate ?? templateForDrop(event.dataTransfer, templateId) ?? undefined,
				allowed: true,
				unlink: false
			});
		}
		const activeDrag = store.getState().timeline.drag;
		if (activeDrag) scheduleDragPreview(activeDrag, time, undefined, false, false, 'video');
		return templateId;
	}

	function shapeFromData(dataTransfer: DataTransfer): ShapeConfig | null {
		const raw = dataTransfer.getData('application/x-tfve-shape');
		if (raw) {
			try {
				return JSON.parse(raw) as ShapeConfig;
			} catch {}
		}
		const session = store.getState().timeline.drag;
		return session?.kind === 'shape' ? (session.shapeConfig ?? null) : null;
	}

	function beginShapePreview(
		event: DragEvent<HTMLElement>,
		targetTrackId: TrackId
	): ShapeConfig | null {
		const shapeConfig = shapeFromData(event.dataTransfer);
		const track = activeProject.tracks.find((item) => item.id === targetTrackId);
		if (!shapeConfig || !track) return null;
		if (track.kind !== 'video' || track.locked) {
			event.dataTransfer.dropEffect = 'none';
			return shapeConfig;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		const time = pointerTime(event.clientX);
		if (drag?.kind !== 'shape' || drag?.targetTrackId !== targetTrackId) {
			beginTimelineDrag({
				kind: 'shape',
				clipIds: [],
				original: [],
				preview: [],
				pointerStartTime: 0,
				pointerTime: time,
				targetTrackId,
				createTrackKind: undefined,
				shapeConfig,
				allowed: true,
				unlink: false
			});
		}
		const activeDrag = store.getState().timeline.drag;
		if (activeDrag) scheduleDragPreview(activeDrag, time, targetTrackId, false, false, undefined);
		return shapeConfig;
	}

	function beginShapeNewTrackPreview(event: DragEvent<HTMLElement>): ShapeConfig | null {
		const shapeConfig = shapeFromData(event.dataTransfer);
		if (!shapeConfig) return null;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		const time = pointerTime(event.clientX);
		if (drag?.kind !== 'shape' || drag?.createTrackKind !== 'video') {
			beginTimelineDrag({
				kind: 'shape',
				clipIds: [],
				original: [],
				preview: [],
				pointerStartTime: 0,
				pointerTime: time,
				targetTrackId: undefined,
				createTrackKind: 'video',
				shapeConfig,
				allowed: true,
				unlink: false
			});
		}
		const activeDrag = store.getState().timeline.drag;
		if (activeDrag) scheduleDragPreview(activeDrag, time, undefined, false, false, 'video');
		return shapeConfig;
	}

	function beginAssetPreview(
		event: DragEvent<HTMLElement>,
		targetTrackId: TrackId
	): AssetId | null {
		const assetId = assetFromData(event.dataTransfer);
		const asset = assetId ? activeProject.assets[assetId] : undefined;
		const track = activeProject.tracks.find((item) => item.id === targetTrackId);
		if (!asset || !track) return null;
		const compatible =
			track.kind === 'video'
				? asset.kind === 'video' || asset.kind === 'image'
				: asset.kind === 'audio';
		if (!compatible) {
			event.dataTransfer.dropEffect = 'none';
			return assetId;
		}
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		const time = pointerTime(event.clientX);
		if (drag?.assetId !== assetId) {
			beginTimelineDrag({
				kind: 'asset',
				clipIds: [],
				original: [],
				preview: [],
				pointerStartTime: 0,
				pointerTime: time,
				targetTrackId,
				createTrackKind: undefined,
				assetId: asset.id,
				allowed: true,
				unlink: false
			});
		}
		const activeDrag = store.getState().timeline.drag;
		if (activeDrag) scheduleDragPreview(activeDrag, time, targetTrackId, false, false, undefined);
		return assetId;
	}

	function beginAssetNewTrackPreview(
		event: DragEvent<HTMLElement>,
		kind: Track['kind']
	): AssetId | null {
		const assetId = assetFromData(event.dataTransfer);
		const asset = assetId ? activeProject.assets[assetId] : undefined;
		if (!asset) return null;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'copy';
		const time = pointerTime(event.clientX);
		if (drag?.assetId !== assetId) {
			beginTimelineDrag({
				kind: 'asset',
				clipIds: [],
				original: [],
				preview: [],
				pointerStartTime: 0,
				pointerTime: time,
				targetTrackId: undefined,
				createTrackKind: kind,
				assetId: asset.id,
				allowed: true,
				unlink: false
			});
		}
		const activeDrag = store.getState().timeline.drag;
		if (activeDrag) scheduleDragPreview(activeDrag, time, undefined, false, false, kind);
		return assetId;
	}

	function handleTrackDragOver(event: DragEvent<HTMLDivElement>, track: Track): void {
		if (event.dataTransfer.types.includes('application/x-tfve-track')) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'move';
			return;
		}
		if (event.dataTransfer.types.includes('application/x-tfve-transition')) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
			return;
		}
		if (
			event.dataTransfer.types.includes('application/x-tfve-effect') ||
			event.dataTransfer.types.includes('application/x-tfve-audio-effect')
		) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
			return;
		}
		if (event.dataTransfer.types.includes('application/x-tfve-sequence')) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
			return;
		}

		const laneRect = event.currentTarget.getBoundingClientRect();
		const topEdgeThreshold = 14;
		const bottomEdgeThreshold = 14;
		const isNearTopEdge = event.clientY - laneRect.top < topEdgeThreshold;
		const isNearBottomEdge = laneRect.bottom - event.clientY < bottomEdgeThreshold;
		const firstVideoTrack = activeProject.tracks.find((t) => t.kind === 'video');
		const lastTrack = activeProject.tracks[activeProject.tracks.length - 1];

		const shapeConfig = shapeFromData(event.dataTransfer);
		if (shapeConfig || event.dataTransfer.types.includes('application/x-tfve-shape')) {
			event.stopPropagation();
			if (isNearTopEdge && track.id === firstVideoTrack?.id) {
				beginShapeNewTrackPreview(event);
				return;
			}
			if (isNearBottomEdge && track.id === lastTrack?.id) {
				beginShapeNewTrackPreview(event);
				return;
			}
			if (track.kind === 'video' && !track.locked) {
				beginShapePreview(event, track.id);
			} else {
				beginShapeNewTrackPreview(event);
			}
			return;
		}

		const graphicTemplateId = graphicTemplateFromData(event.dataTransfer);
		if (
			graphicTemplateId ||
			event.dataTransfer.types.includes('application/x-tfve-graphic-template')
		) {
			event.stopPropagation();
			if (isNearTopEdge && track.id === firstVideoTrack?.id) {
				beginGraphicTemplateNewTrackPreview(event);
				return;
			}
			if (isNearBottomEdge && track.id === lastTrack?.id) {
				beginGraphicTemplateNewTrackPreview(event);
				return;
			}
			if (track.kind === 'video' && !track.locked) {
				beginGraphicTemplatePreview(event, track.id);
			} else {
				beginGraphicTemplateNewTrackPreview(event);
			}
			return;
		}

		const assetId = assetFromData(event.dataTransfer);
		const asset = assetId ? activeProject.assets[assetId] : undefined;
		const assetTrackKind: Track['kind'] = asset?.kind === 'audio' ? 'audio' : 'video';

		if (isNearTopEdge && track.id === activeProject.tracks[0]?.id) {
			event.stopPropagation();
			beginAssetNewTrackPreview(event, assetTrackKind);
			return;
		}
		if (isNearBottomEdge && track.id === lastTrack?.id) {
			event.stopPropagation();
			beginAssetNewTrackPreview(event, assetTrackKind);
			return;
		}

		if (!assetId) {
			if (event.dataTransfer.types.includes('application/x-tfve-asset')) {
				event.preventDefault();
				event.dataTransfer.dropEffect = 'copy';
			}
			return;
		}
		event.stopPropagation();
		beginAssetPreview(event, track.id);
	}

	function applyTransitionDrop(track: Track, time: Time, type: TransitionType): void {
		if (track.clips.length === 0) {
			setTimelineMessage('Cannot add transition: track has no clips.');
			return;
		}
		const fps = activeProject?.settings.fps ?? 30;
		const tolerance = Math.round(1_000_000 / fps);
		const sortedClips = [...track.clips].sort((a, b) => a.start - b.start);

		// Check for adjacent cut nearest to time (within tolerance)
		let bestCut: { from: Clip; to: Clip; distance: number } | null = null;
		for (let i = 0; i < sortedClips.length - 1; i++) {
			const c1 = sortedClips[i]!;
			const c2 = sortedClips[i + 1]!;
			if (Math.abs(c1.start + c1.duration - c2.start) <= tolerance) {
				const cutTime = c2.start;
				const dist = Math.abs(time - cutTime);
				if (!bestCut || dist < bestCut.distance) {
					bestCut = { from: c1, to: c2, distance: dist };
				}
			}
		}

		let containingClip = sortedClips.find((c) => time >= c.start && time < c.start + c.duration);
		if (!containingClip) {
			containingClip = sortedClips.reduce((prev, curr) => {
				const prevDist = Math.min(
					Math.abs(time - prev.start),
					Math.abs(time - (prev.start + prev.duration))
				);
				const currDist = Math.min(
					Math.abs(time - curr.start),
					Math.abs(time - (curr.start + curr.duration))
				);
				return currDist < prevDist ? curr : prev;
			});
		}

		if (bestCut && bestCut.distance <= Math.max(2_000_000, tolerance * 15)) {
			store.getState().addTransition(track.id, type, {
				kind: 'cut',
				fromClipId: bestCut.from.id,
				toClipId: bestCut.to.id
			});
			return;
		}

		const distToStart = Math.abs(time - containingClip.start);
		const distToEnd = Math.abs(time - (containingClip.start + containingClip.duration));

		if (distToStart < distToEnd) {
			const prevClip = sortedClips.find(
				(c) => Math.abs(c.start + c.duration - containingClip!.start) <= tolerance
			);
			if (prevClip) {
				store.getState().addTransition(track.id, type, {
					kind: 'cut',
					fromClipId: prevClip.id,
					toClipId: containingClip.id
				});
			} else {
				store.getState().addTransition(track.id, type, {
					kind: 'head',
					clipId: containingClip.id
				});
			}
		} else {
			const nextClip = sortedClips.find(
				(c) => Math.abs(containingClip!.start + containingClip!.duration - c.start) <= tolerance
			);
			if (nextClip) {
				store.getState().addTransition(track.id, type, {
					kind: 'cut',
					fromClipId: containingClip.id,
					toClipId: nextClip.id
				});
			} else {
				store.getState().addTransition(track.id, type, {
					kind: 'tail',
					clipId: containingClip.id
				});
			}
		}
	}

	function handleTrackDrop(event: DragEvent<HTMLDivElement>, track: Track): void {
		event.stopPropagation();
		const draggedTrackId = event.dataTransfer.getData('application/x-tfve-track') as TrackId;
		if (draggedTrackId) {
			event.preventDefault();
			const trackIndex = activeProject.tracks.findIndex((t) => t.id === track.id);
			if (trackIndex >= 0) {
				reorderTimelineTrack(draggedTrackId, trackIndex);
			}
			return;
		}
		const transitionType = event.dataTransfer.getData('application/x-tfve-transition') as
			TransitionType | '';
		if (transitionType) {
			event.preventDefault();
			const time = pointerTime(event.clientX);
			applyTransitionDrop(track, time, transitionType);
			return;
		}
		const videoEffectId = event.dataTransfer.getData('application/x-tfve-effect');
		const audioEffectId = event.dataTransfer.getData('application/x-tfve-audio-effect');
		if (videoEffectId || audioEffectId) {
			event.preventDefault();
			const time = pointerTime(event.clientX);
			const targetClip = track.clips.find((c) => time >= c.start && time < c.start + c.duration);
			if (targetClip) {
				const effectName =
					event.dataTransfer.getData('application/x-tfve-effect-name') ||
					(videoEffectId ? EFFECT_DEFINITIONS[videoEffectId]?.name : undefined) ||
					(audioEffectId ? audioEffectRegistry.get(audioEffectId)?.name : undefined) ||
					videoEffectId ||
					audioEffectId;
				if (videoEffectId && track.kind === 'video') {
					store.getState().addEffect(targetClip.id, videoEffectId as EffectType);
					store.getState().selectClips([targetClip.id], 'replace');
					store.getState().revealInspectorSection('effects');
					store.getState().setTimelineMessage(`Applied ${effectName} to clip.`);
				} else if (audioEffectId) {
					const existing = targetClip.audioEffects ? [...targetClip.audioEffects] : [];
					const newFx = audioEffectRegistry.createDefaultInstance(audioEffectId);
					newFx.managedBy = 'user';
					existing.push(newFx);
					store.getState().setClipAudioEffects(targetClip.id, existing);
					store.getState().selectClips([targetClip.id], 'replace');
					store.getState().revealInspectorSection('audio');
					store.getState().setTimelineMessage(`Applied ${effectName} audio effect to clip.`);
				}
			}
			return;
		}
		const shapeConfig = shapeFromData(event.dataTransfer);
		if (shapeConfig) {
			event.preventDefault();
			const session = store.getState().timeline.drag;
			if (session?.createTrackKind) {
				commitTimelineDrag();
				return;
			}
			if (track.kind !== 'video' || track.locked) {
				cancelTimelineDrag();
				setTimelineMessage('Shapes can only be placed on unlocked video tracks.');
				return;
			}
			if (session?.kind === 'shape' && session.shapeConfig) {
				const time = pointerTime(event.clientX);
				const activeDrag = store.getState().timeline.drag;
				if (activeDrag) setSnappedDragTime(activeDrag, time, track.id, false, false, undefined);
				commitTimelineDrag();
			} else {
				const time = pointerTime(event.clientX);
				store.getState().addShapeClip(shapeConfig, {
					start: time,
					trackId: track.id
				});
			}
			return;
		}
		const graphicTemplateId = graphicTemplateFromData(event.dataTransfer);
		if (graphicTemplateId) {
			event.preventDefault();
			const session = store.getState().timeline.drag;
			if (session?.createTrackKind) {
				commitTimelineDrag();
				return;
			}
			if (track.kind !== 'video' || track.locked) {
				cancelTimelineDrag();
				setTimelineMessage('Graphic titles can only be placed on unlocked video tracks.');
				return;
			}
			if (session?.graphicTemplateId === graphicTemplateId) {
				const time = pointerTime(event.clientX);
				const activeDrag = store.getState().timeline.drag;
				if (activeDrag) setSnappedDragTime(activeDrag, time, track.id, false, false, undefined);
				commitTimelineDrag();
			} else {
				const time = pointerTime(event.clientX);
				const template = templateForDrop(event.dataTransfer, graphicTemplateId);
				if (template) store.getState().instantiateTemplate(template, time, track.id);
			}
			return;
		}
		const customTemplate = customMotionTemplateFromData(event.dataTransfer);
		if (customTemplate) {
			event.preventDefault();
			if (track.kind !== 'video' || track.locked) {
				cancelTimelineDrag();
				setTimelineMessage('Motion templates can only be placed on unlocked video tracks.');
				return;
			}
			const time = pointerTime(event.clientX);
			store.getState().instantiateTemplate(customTemplate, time, track.id);
			return;
		}
		const sequenceId = sequenceFromData(event.dataTransfer);
		if (sequenceId) {
			event.preventDefault();
			const time = pointerTime(event.clientX);
			store.getState().addSequenceToTimeline(sequenceId, time, track.id);
			return;
		}
		const assetId = assetFromData(event.dataTransfer);
		if (!assetId) return;
		event.preventDefault();
		const asset = activeProject.assets[assetId];
		if (!asset) return;
		const compatible =
			track.kind === 'video'
				? asset.kind === 'video' || asset.kind === 'image'
				: asset.kind === 'audio';
		if (!compatible) {
			cancelTimelineDrag();
			setTimelineMessage('This media type is not allowed on this track.');
			return;
		}
		const time = pointerTime(event.clientX);
		const session = store.getState().timeline.drag;
		if (session?.createTrackKind) {
			commitTimelineDrag();
			return;
		}
		if (session?.assetId === assetId) {
			const activeDrag = store.getState().timeline.drag;
			if (activeDrag) setSnappedDragTime(activeDrag, time, track.id, false, false, undefined);
			commitTimelineDrag();
		} else addAssetToTimeline(assetId, track.id, time);
	}

	function beginEmptyTrackDrop(event: DragEvent<HTMLDivElement>): void {
		event.stopPropagation();
		const graphicTemplateId = graphicTemplateFromData(event.dataTransfer);
		if (graphicTemplateId) {
			beginGraphicTemplateNewTrackPreview(event);
			return;
		}
		const assetId = assetFromData(event.dataTransfer);
		const asset = assetId ? activeProject.assets[assetId] : undefined;
		if (!asset) return;
		const kind: Track['kind'] = asset.kind === 'audio' ? 'audio' : 'video';
		beginAssetNewTrackPreview(event, kind);
	}

	function dropOnNewTrack(event: DragEvent<HTMLDivElement>): void {
		event.stopPropagation();
		const graphicTemplateId = graphicTemplateFromData(event.dataTransfer);
		if (graphicTemplateId) {
			event.preventDefault();
			const session = store.getState().timeline.drag;
			if (session?.graphicTemplateId === graphicTemplateId && session.createTrackKind) {
				commitTimelineDrag();
			} else {
				const template = templateForDrop(event.dataTransfer, graphicTemplateId);
				if (template) {
					store.getState().instantiateTemplate(template, pointerTime(event.clientX));
				}
			}
			return;
		}
		const customTemplate = customMotionTemplateFromData(event.dataTransfer);
		if (customTemplate) {
			event.preventDefault();
			const time = pointerTime(event.clientX);
			store.getState().instantiateTemplate(customTemplate, time);
			return;
		}
		const assetId = assetFromData(event.dataTransfer);
		const asset = assetId ? activeProject.assets[assetId] : undefined;
		if (!asset) return;
		event.preventDefault();
		const session = store.getState().timeline.drag;
		if (session?.assetId === assetId && session.createTrackKind) {
			commitTimelineDrag();
		} else {
			addAssetOnNewTrack(
				asset.id,
				asset.kind === 'audio' ? 'audio' : 'video',
				pointerTime(event.clientX)
			);
		}
	}

	function handleTimelineDragOver(event: DragEvent<HTMLDivElement>): void {
		autoScrollPointer.current = {
			clientX: event.clientX,
			clientY: event.clientY
		};
		triggerAutoScroll();
		if (event.dataTransfer.types.includes('application/x-tfve-transition')) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
			return;
		}
		if (
			event.dataTransfer.types.includes('application/x-tfve-effect') ||
			event.dataTransfer.types.includes('application/x-tfve-audio-effect')
		) {
			event.preventDefault();
			event.dataTransfer.dropEffect = 'copy';
			return;
		}
		if (event.dataTransfer.types.includes('application/x-tfve-sequence')) return;

		const shapeConfig = shapeFromData(event.dataTransfer);
		if (shapeConfig || event.dataTransfer.types.includes('application/x-tfve-shape')) {
			const target = document.elementFromPoint(event.clientX, event.clientY);
			const trackLaneEl = target?.closest<HTMLElement>('[data-track-lane]');

			if (
				trackLaneEl &&
				!trackLaneEl.classList.contains('is-preview-lane') &&
				activeProject.tracks.some((t) => t.id === trackLaneEl.dataset.trackLane)
			) {
				const track = activeProject.tracks.find((t) => t.id === trackLaneEl.dataset.trackLane);
				if (track) {
					const laneRect = trackLaneEl.getBoundingClientRect();
					const isNearTopEdge = event.clientY - laneRect.top < 14;
					const isNearBottomEdge = laneRect.bottom - event.clientY < 14;
					const firstVideoTrack = activeProject.tracks.find((t) => t.kind === 'video');
					const lastTrack = activeProject.tracks[activeProject.tracks.length - 1];

					if (isNearTopEdge && track.id === firstVideoTrack?.id) {
						beginShapeNewTrackPreview(event);
						return;
					}
					if (isNearBottomEdge && track.id === lastTrack?.id) {
						beginShapeNewTrackPreview(event);
						return;
					}
					if (track.kind === 'video' && !track.locked) {
						event.preventDefault();
						event.dataTransfer.dropEffect = 'copy';
						beginShapePreview(event, track.id);
					} else {
						beginShapeNewTrackPreview(event);
					}
				} else {
					event.dataTransfer.dropEffect = 'none';
				}
				return;
			}

			const scroller = scrollerRef.current;
			if (!scroller) return;
			const rowsContainer = scroller.querySelector('.timeline-track-rows');
			if (rowsContainer) {
				const trackRows = Array.from(
					rowsContainer.querySelectorAll<HTMLElement>(
						'.timeline-track-row:not(.is-new-track-preview)'
					)
				);
				if (trackRows.length > 0) {
					const firstRowRect = trackRows[0]!.getBoundingClientRect();
					const lastRowRect = trackRows[trackRows.length - 1]!.getBoundingClientRect();

					if (event.clientY < firstRowRect.top + 14 || event.clientY > lastRowRect.bottom - 14) {
						beginShapeNewTrackPreview(event);
					} else {
						for (const row of trackRows) {
							const r = row.getBoundingClientRect();
							if (event.clientY >= r.top && event.clientY <= r.bottom) {
								const lane = row.querySelector<HTMLElement>('[data-track-lane]');
								const tId = lane?.dataset.trackLane as TrackId | undefined;
								const track = activeProject.tracks.find((t) => t.id === tId);
								if (track && track.kind === 'video' && !track.locked) {
									event.preventDefault();
									event.dataTransfer.dropEffect = 'copy';
									beginShapePreview(event, track.id);
								} else {
									beginShapeNewTrackPreview(event);
								}
								break;
							}
						}
					}
				} else {
					beginShapeNewTrackPreview(event);
				}
			}
			return;
		}

		const graphicTemplateId = graphicTemplateFromData(event.dataTransfer);
		if (
			graphicTemplateId ||
			event.dataTransfer.types.includes('application/x-tfve-graphic-template')
		) {
			const target = document.elementFromPoint(event.clientX, event.clientY);
			const trackLaneEl = target?.closest<HTMLElement>('[data-track-lane]');

			if (
				trackLaneEl &&
				!trackLaneEl.classList.contains('is-preview-lane') &&
				activeProject.tracks.some((t) => t.id === trackLaneEl.dataset.trackLane)
			) {
				const track = activeProject.tracks.find((t) => t.id === trackLaneEl.dataset.trackLane);
				if (track) {
					const laneRect = trackLaneEl.getBoundingClientRect();
					const isNearTopEdge = event.clientY - laneRect.top < 14;
					const isNearBottomEdge = laneRect.bottom - event.clientY < 14;
					const firstVideoTrack = activeProject.tracks.find((t) => t.kind === 'video');
					const lastTrack = activeProject.tracks[activeProject.tracks.length - 1];

					if (isNearTopEdge && track.id === firstVideoTrack?.id) {
						beginGraphicTemplateNewTrackPreview(event);
						return;
					}
					if (isNearBottomEdge && track.id === lastTrack?.id) {
						beginGraphicTemplateNewTrackPreview(event);
						return;
					}
					if (track.kind === 'video' && !track.locked) {
						event.preventDefault();
						event.dataTransfer.dropEffect = 'copy';
						beginGraphicTemplatePreview(event, track.id);
					} else {
						beginGraphicTemplateNewTrackPreview(event);
					}
				} else {
					event.dataTransfer.dropEffect = 'none';
				}
				return;
			}

			const scroller = scrollerRef.current;
			if (!scroller) return;
			const rowsContainer = scroller.querySelector('.timeline-track-rows');
			if (rowsContainer) {
				const trackRows = Array.from(
					rowsContainer.querySelectorAll<HTMLElement>(
						'.timeline-track-row:not(.is-new-track-preview)'
					)
				);
				if (trackRows.length > 0) {
					const firstRowRect = trackRows[0]!.getBoundingClientRect();
					const lastRowRect = trackRows[trackRows.length - 1]!.getBoundingClientRect();

					if (event.clientY < firstRowRect.top + 14 || event.clientY > lastRowRect.bottom - 14) {
						beginGraphicTemplateNewTrackPreview(event);
					} else {
						for (const row of trackRows) {
							const r = row.getBoundingClientRect();
							if (event.clientY >= r.top && event.clientY <= r.bottom) {
								const lane = row.querySelector<HTMLElement>('[data-track-lane]');
								const tId = lane?.dataset.trackLane as TrackId | undefined;
								const track = activeProject.tracks.find((t) => t.id === tId);
								if (track && track.kind === 'video' && !track.locked) {
									event.preventDefault();
									event.dataTransfer.dropEffect = 'copy';
									beginGraphicTemplatePreview(event, track.id);
								} else {
									beginGraphicTemplateNewTrackPreview(event);
								}
								break;
							}
						}
					}
				} else {
					beginGraphicTemplateNewTrackPreview(event);
				}
			}
			return;
		}

		const assetId = assetFromData(event.dataTransfer);
		if (!assetId) return;
		const asset = activeProject.assets[assetId];
		if (!asset) return;
		const assetTrackKind: Track['kind'] = asset.kind === 'audio' ? 'audio' : 'video';

		const target = document.elementFromPoint(event.clientX, event.clientY);
		const trackLaneEl = target?.closest<HTMLElement>('[data-track-lane]');

		if (
			trackLaneEl &&
			!trackLaneEl.classList.contains('is-preview-lane') &&
			activeProject.tracks.some((t) => t.id === trackLaneEl.dataset.trackLane)
		) {
			const track = activeProject.tracks.find((t) => t.id === trackLaneEl.dataset.trackLane);
			if (track) {
				const laneRect = trackLaneEl.getBoundingClientRect();
				const isNearTopEdge = event.clientY - laneRect.top < 14;
				const isNearBottomEdge = laneRect.bottom - event.clientY < 14;
				const firstTrack = activeProject.tracks[0];
				const lastTrack = activeProject.tracks[activeProject.tracks.length - 1];

				if (isNearTopEdge && track.id === firstTrack?.id) {
					beginAssetNewTrackPreview(event, assetTrackKind);
					return;
				}
				if (isNearBottomEdge && track.id === lastTrack?.id) {
					beginAssetNewTrackPreview(event, assetTrackKind);
					return;
				}

				const compatible =
					track.kind === 'video'
						? asset.kind === 'video' || asset.kind === 'image'
						: asset.kind === 'audio';
				if (compatible) {
					event.preventDefault();
					event.dataTransfer.dropEffect = 'copy';
					beginAssetPreview(event, track.id);
				} else {
					event.dataTransfer.dropEffect = 'none';
				}
			}
			return;
		}

		const scroller = scrollerRef.current;
		if (!scroller) return;
		const rowsContainer = scroller.querySelector('.timeline-track-rows');
		if (rowsContainer) {
			const trackRows = Array.from(
				rowsContainer.querySelectorAll<HTMLElement>(
					'.timeline-track-row:not(.is-new-track-preview)'
				)
			);
			if (trackRows.length > 0) {
				const firstRowRect = trackRows[0]!.getBoundingClientRect();
				const lastRowRect = trackRows[trackRows.length - 1]!.getBoundingClientRect();

				if (event.clientY < firstRowRect.top + 14 || event.clientY > lastRowRect.bottom - 14) {
					beginAssetNewTrackPreview(event, assetTrackKind);
				} else {
					for (const row of trackRows) {
						const r = row.getBoundingClientRect();
						if (event.clientY >= r.top && event.clientY <= r.bottom) {
							const lane = row.querySelector<HTMLElement>('[data-track-lane]');
							const tId = lane?.dataset.trackLane as TrackId | undefined;
							const track = activeProject.tracks.find((t) => t.id === tId);
							if (track) {
								const compatible =
									track.kind === 'video'
										? asset.kind === 'video' || asset.kind === 'image'
										: asset.kind === 'audio';
								if (compatible) {
									event.preventDefault();
									event.dataTransfer.dropEffect = 'copy';
									beginAssetPreview(event, track.id);
								}
							}
							break;
						}
					}
				}
			} else {
				beginAssetNewTrackPreview(event, assetTrackKind);
			}
		}
	}

	function handleTimelineDrop(event: DragEvent<HTMLDivElement>): void {
		stopAutoScroll();
		autoScrollPointer.current = null;
		const transitionType = event.dataTransfer.getData('application/x-tfve-transition') as
			TransitionType | '';
		if (transitionType) {
			event.preventDefault();
			const target = document.elementFromPoint(event.clientX, event.clientY);
			const trackLaneEl = target?.closest<HTMLElement>('[data-track-lane]');
			const targetTrack =
				(trackLaneEl && activeProject.tracks.find((t) => t.id === trackLaneEl.dataset.trackLane)) ||
				activeProject.tracks.find((t) => t.kind === 'video');
			if (targetTrack) {
				const time = pointerTime(event.clientX);
				applyTransitionDrop(targetTrack, time, transitionType);
			}
			return;
		}
		const shapeConfig = shapeFromData(event.dataTransfer);
		if (shapeConfig) {
			event.preventDefault();
			const session = store.getState().timeline.drag;
			if (session?.kind === 'shape') {
				commitTimelineDrag();
				return;
			}
			const target = document.elementFromPoint(event.clientX, event.clientY);
			const trackLaneEl = target?.closest<HTMLElement>('[data-track-lane]');
			const targetTrack =
				(trackLaneEl &&
					activeProject.tracks.find(
						(t) => t.id === trackLaneEl.dataset.trackLane && t.kind === 'video'
					)) ||
				activeProject.tracks.find((t) => t.kind === 'video' && !t.locked);
			const time = pointerTime(event.clientX);
			store.getState().addShapeClip(shapeConfig, {
				start: time,
				trackId: targetTrack?.id
			});
			return;
		}
		const graphicTemplateId = graphicTemplateFromData(event.dataTransfer);
		if (graphicTemplateId) {
			event.preventDefault();
			const session = store.getState().timeline.drag;
			if (session?.graphicTemplateId === graphicTemplateId) {
				commitTimelineDrag();
				return;
			}
			const target = document.elementFromPoint(event.clientX, event.clientY);
			const trackLaneEl = target?.closest<HTMLElement>('[data-track-lane]');
			const targetTrack =
				(trackLaneEl &&
					activeProject.tracks.find(
						(t) => t.id === trackLaneEl.dataset.trackLane && t.kind === 'video'
					)) ||
				activeProject.tracks.find((t) => t.kind === 'video' && !t.locked);
			const time = pointerTime(event.clientX);
			const template = templateForDrop(event.dataTransfer, graphicTemplateId);
			if (template) store.getState().instantiateTemplate(template, time, targetTrack?.id);
			return;
		}
		const assetId = assetFromData(event.dataTransfer);
		if (!assetId) return;
		const session = store.getState().timeline.drag;
		if (session?.assetId === assetId) {
			if (session.createTrackKind) {
				event.preventDefault();
				commitTimelineDrag();
				return;
			}
			if (session.targetTrackId) {
				event.preventDefault();
				commitTimelineDrag();
				return;
			}
		}
	}

	function handleTimelineDragLeave(event: DragEvent<HTMLDivElement>): void {
		if (event.relatedTarget && scrollerRef.current?.contains(event.relatedTarget as Node)) {
			return;
		}
		stopAutoScroll();
		autoScrollPointer.current = null;
		cancelTimelineDrag();
	}

	function beginMarquee(event: PointerEvent<HTMLDivElement>): void {
		if (event.button !== 0) return;
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (
			target.closest(
				'.timeline-clip, .timeline-track-header, .timeline-ruler, .timeline-track-controls, .timeline-track-resize-handle, .timeline-context-menu, .timeline-gap-ripple-btn'
			)
		)
			return;
		const scroller = scrollerRef.current;
		if (!scroller) return;

		if (activeTool === 'hand') {
			handPanStart.current = { clientX: event.clientX, scrollLeft: scroller.scrollLeft };
			setIsPanning(true);
			scroller.setPointerCapture(event.pointerId);
			return;
		}

		if (activeTool === 'track-select') {
			const time = pointerTime(event.clientX);
			const forwardIds = activeProject.tracks
				.filter((t) => !t.locked)
				.flatMap((t) =>
					t.clips.filter((c) => c.start >= time || (c.start < time && c.start + c.duration > time))
				)
				.map((c) => c.id);
			selectClips(forwardIds, 'replace');
			store.getState().setTimelineMessage(`Selected ${forwardIds.length} forward clip(s).`);
			return;
		}

		if (activeTool === 'type') {
			store.getState().addTextClip();
			store.getState().setActiveTimelineTool('select');
			return;
		}

		const rect = scroller.getBoundingClientRect();
		const x = Math.max(headerWidth, event.clientX - rect.left + scroller.scrollLeft);
		const y = Math.max(32, event.clientY - rect.top + scroller.scrollTop);
		marqueeStart.current = { x, y, clientX: event.clientX, clientY: event.clientY };
		scroller.focus({ preventScroll: true });
	}

	function computeAutoScrollSpeed(clientX: number, clientY: number): { vx: number; vy: number } {
		const scroller = scrollerRef.current;
		if (!scroller || scroller.clientWidth === 0) return { vx: 0, vy: 0 };
		const rect = scroller.getBoundingClientRect();

		const EDGE_ZONE = 40;
		const BASE_SPEED = 8;
		const MAX_SPEED = 24;

		let vx = 0;
		let vy = 0;

		const laneLeft = rect.left + headerWidth;
		const laneRight = rect.right;

		if (clientX < laneLeft + EDGE_ZONE) {
			if (scroller.scrollLeft > 0) {
				const dist = laneLeft + EDGE_ZONE - clientX;
				const ratio = Math.min(dist / EDGE_ZONE, 2.5);
				vx = -Math.round(Math.max(BASE_SPEED, BASE_SPEED * ratio));
				vx = Math.max(-MAX_SPEED, vx);
			}
		} else if (clientX > laneRight - EDGE_ZONE) {
			const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
			if (scroller.scrollLeft < maxScrollLeft) {
				const dist = clientX - (laneRight - EDGE_ZONE);
				const ratio = Math.min(dist / EDGE_ZONE, 2.5);
				vx = Math.round(Math.max(BASE_SPEED, BASE_SPEED * ratio));
				vx = Math.min(MAX_SPEED, vx);
			}
		}

		const trackTop = rect.top + 32;
		const trackBottom = rect.bottom;

		if (clientY < trackTop + EDGE_ZONE) {
			if (scroller.scrollTop > 0) {
				const dist = trackTop + EDGE_ZONE - clientY;
				const ratio = Math.min(dist / EDGE_ZONE, 2.5);
				vy = -Math.round(Math.max(BASE_SPEED, BASE_SPEED * ratio));
				vy = Math.max(-MAX_SPEED, vy);
			}
		} else if (clientY > trackBottom - EDGE_ZONE) {
			const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
			if (scroller.scrollTop < maxScrollTop) {
				const dist = clientY - (trackBottom - EDGE_ZONE);
				const ratio = Math.min(dist / EDGE_ZONE, 2.5);
				vy = Math.round(Math.max(BASE_SPEED, BASE_SPEED * ratio));
				vy = Math.min(MAX_SPEED, vy);
			}
		}

		return { vx, vy };
	}

	function stopAutoScroll(): void {
		if (autoScrollFrame.current !== null) {
			cancelAnimationFrame(autoScrollFrame.current);
			autoScrollFrame.current = null;
		}
	}

	function startAutoScroll(): void {
		if (autoScrollFrame.current !== null) return;

		function tick(): void {
			const pos = autoScrollPointer.current;
			const scroller = scrollerRef.current;
			if (!pos || !scroller) {
				stopAutoScroll();
				return;
			}

			const { vx, vy } = computeAutoScrollSpeed(pos.clientX, pos.clientY);
			if (vx === 0 && vy === 0) {
				stopAutoScroll();
				return;
			}

			const prevScrollLeft = scroller.scrollLeft;
			const prevScrollTop = scroller.scrollTop;

			if (vx !== 0) {
				const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
				scroller.scrollLeft = Math.max(0, Math.min(maxScrollLeft, scroller.scrollLeft + vx));
			}
			if (vy !== 0) {
				const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
				scroller.scrollTop = Math.max(0, Math.min(maxScrollTop, scroller.scrollTop + vy));
			}

			if (scroller.scrollLeft !== prevScrollLeft || scroller.scrollTop !== prevScrollTop) {
				setScroll(scroller.scrollLeft, scroller.scrollTop);

				if (marqueeStart.current) {
					updateMarqueeBox(pos.clientX, pos.clientY);
				} else if (store.getState().timeline.drag) {
					updateClipDragPosition(pos.clientX, pos.clientY, {
						altKey: pos.altKey,
						ctrlKey: pos.ctrlKey,
						metaKey: pos.metaKey
					});
				}
			}

			autoScrollFrame.current = requestAnimationFrame(tick);
		}

		autoScrollFrame.current = requestAnimationFrame(tick);
	}

	function triggerAutoScroll(): void {
		const pos = autoScrollPointer.current;
		if (!pos) return;
		const { vx, vy } = computeAutoScrollSpeed(pos.clientX, pos.clientY);
		if (vx !== 0 || vy !== 0) {
			startAutoScroll();
		} else {
			stopAutoScroll();
		}
	}

	function updateMarqueeBox(clientX: number, clientY: number, pointerId?: number): void {
		const scroller = scrollerRef.current;
		const start = marqueeStart.current;
		if (!scroller || !start) return;
		const rect = scroller.getBoundingClientRect();
		const x = Math.max(headerWidth, clientX - rect.left + scroller.scrollLeft);
		const y = Math.max(32, clientY - rect.top + scroller.scrollTop);
		if (Math.abs(x - start.x) > 3 || Math.abs(y - start.y) > 3) {
			if (pointerId !== undefined && !scroller.hasPointerCapture(pointerId)) {
				try {
					scroller.setPointerCapture(pointerId);
				} catch {
					// ignore
				}
			}
			setMarquee({
				left: Math.min(start.x, x),
				top: Math.min(start.y, y),
				width: Math.abs(x - start.x),
				height: Math.abs(y - start.y)
			});
		}
	}

	function endMarquee(event: PointerEvent<HTMLDivElement>): void {
		stopAutoScroll();
		autoScrollPointer.current = null;
		const scroller = scrollerRef.current;
		const start = marqueeStart.current;
		if (!scroller || !start) return;
		if (scroller.hasPointerCapture(event.pointerId)) {
			try {
				scroller.releasePointerCapture(event.pointerId);
			} catch {
				// ignore
			}
		}
		const rect = scroller.getBoundingClientRect();
		const endX = Math.max(headerWidth, event.clientX - rect.left + scroller.scrollLeft);
		const endY = Math.max(32, event.clientY - rect.top + scroller.scrollTop);
		const didDrag = Math.abs(endX - start.x) > 4 || Math.abs(endY - start.y) > 4;
		if (didDrag) {
			suppressClickUntil.current = Date.now() + 400;
			const marqueeLeft = Math.min(start.x, endX);
			const marqueeRight = Math.max(start.x, endX);
			const marqueeTop = Math.min(start.y, endY);
			const marqueeBottom = Math.max(start.y, endY);

			const hitIds: ClipId[] = [];
			for (const track of activeProject.tracks) {
				const laneEl = scroller.querySelector<HTMLElement>(`[data-track-lane="${track.id}"]`);
				if (!laneEl) continue;
				const laneBox = laneEl.getBoundingClientRect();
				const trackTop = laneBox.top - rect.top + scroller.scrollTop;
				const trackBottom = laneBox.bottom - rect.top + scroller.scrollTop;
				if (trackTop >= marqueeBottom || trackBottom <= marqueeTop) {
					continue;
				}
				for (const clip of track.clips) {
					const clipLeft = headerWidth + timeToPixels(clip.start, pixelsPerSecond);
					const clipRight = headerWidth + timeToPixels(clip.start + clip.duration, pixelsPerSecond);
					if (clipLeft < marqueeRight && clipRight > marqueeLeft) {
						hitIds.push(clip.id);
					}
				}
			}
			selectClips(hitIds, event.shiftKey ? 'add' : 'replace');
		}
		marqueeStart.current = null;
		setMarquee(null);
		stopAutoScroll();
		autoScrollPointer.current = null;
	}

	function updateClipDragPosition(
		clientX: number,
		clientY: number,
		modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
	): void {
		const session = store.getState().timeline.drag;
		const scroller = scrollerRef.current;
		if (!session || !scroller) return;

		let targetTrackId: TrackId | undefined;
		let createTrackKind: Track['kind'] | undefined;

		const target = document.elementFromPoint(clientX, clientY);
		const trackLaneEl = target?.closest<HTMLElement>('[data-track-lane]');
		if (
			trackLaneEl &&
			!trackLaneEl.classList.contains('is-preview-lane') &&
			activeProject.tracks.some((t) => t.id === trackLaneEl.dataset.trackLane)
		) {
			targetTrackId = trackLaneEl.dataset.trackLane as TrackId | undefined;
			createTrackKind = undefined;
		} else {
			const scrollerRect = scroller.getBoundingClientRect();
			if (
				clientX < scrollerRect.left - 40 ||
				clientX > scrollerRect.right + 40 ||
				clientY < scrollerRect.top - 60 ||
				clientY > scrollerRect.bottom + 60
			) {
				targetTrackId = undefined;
				createTrackKind = undefined;
			} else {
				// Check if dragged outside existing tracks
				const primary = session.original[0];
				const primaryTrack = primary
					? activeProject.tracks.find((t) => t.id === primary.trackId)
					: undefined;
				const draggedKind =
					primaryTrack?.kind ??
					(session.assetId ? activeProject.assets[session.assetId]?.kind : undefined) ??
					'video';
				const normalizedKind: Track['kind'] = draggedKind === 'audio' ? 'audio' : 'video';

				const rowsContainer = scroller.querySelector('.timeline-track-rows');
				if (rowsContainer) {
					const trackRows = Array.from(
						rowsContainer.querySelectorAll<HTMLElement>(
							'.timeline-track-row:not(.is-new-track-preview)'
						)
					);
					if (trackRows.length > 0) {
						const firstRowRect = trackRows[0]!.getBoundingClientRect();
						const lastRowRect = trackRows[trackRows.length - 1]!.getBoundingClientRect();

						if (clientY < firstRowRect.top) {
							// Dragged above the top track (Premiere Pro style: add track at top)
							createTrackKind = normalizedKind;
							targetTrackId = undefined;
						} else if (clientY > lastRowRect.bottom) {
							// Dragged below the bottom track (add track at bottom)
							createTrackKind = normalizedKind;
							targetTrackId = undefined;
						} else {
							// Inside tracks vertically: definitely do NOT create a new track
							createTrackKind = undefined;
							for (const row of trackRows) {
								const r = row.getBoundingClientRect();
								if (clientY >= r.top && clientY <= r.bottom) {
									const lane = row.querySelector<HTMLElement>('[data-track-lane]');
									targetTrackId = lane?.dataset.trackLane as TrackId | undefined;
									break;
								}
							}
						}
					}
				}
			}
		}

		const time = pointerTime(clientX);
		scheduleDragPreview(
			session,
			time,
			targetTrackId,
			Boolean(modifiers?.altKey),
			Boolean(modifiers?.ctrlKey || modifiers?.metaKey),
			createTrackKind
		);
	}

	function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
		if (handPanStart.current && scrollerRef.current) {
			const deltaX = event.clientX - handPanStart.current.clientX;
			scrollerRef.current.scrollLeft = Math.max(0, handPanStart.current.scrollLeft - deltaX);
			setScroll(scrollerRef.current.scrollLeft, scrollerRef.current.scrollTop);
			return;
		}
		if (marqueeStart.current) {
			autoScrollPointer.current = {
				clientX: event.clientX,
				clientY: event.clientY,
				pointerId: event.pointerId
			};
			updateMarqueeBox(event.clientX, event.clientY, event.pointerId);
			triggerAutoScroll();
			return;
		}

		if (longPressSession.current && !isLongPressDragActive.current) {
			if (event.pointerId !== longPressSession.current.pointerId) return;
			const dist = Math.hypot(
				event.clientX - longPressSession.current.startX,
				event.clientY - longPressSession.current.startY
			);
			if (dist > 8) {
				if (longPressTimer.current) {
					clearTimeout(longPressTimer.current);
					longPressTimer.current = null;
				}
				const scroller = scrollerRef.current;
				if (scroller) {
					const deltaX = event.clientX - longPressSession.current.startX;
					const deltaY = event.clientY - longPressSession.current.startY;
					scroller.scrollLeft = Math.max(0, longPressSession.current.startScrollLeft - deltaX);
					scroller.scrollTop = Math.max(0, longPressSession.current.startScrollTop - deltaY);
					setScroll(scroller.scrollLeft, scroller.scrollTop);
				}
				return;
			}
			return;
		}

		const session = store.getState().timeline.drag;
		if (!session || dragPointer.current !== event.pointerId) return;
		if (dragStartPos.current) {
			if (
				Math.abs(event.clientX - dragStartPos.current.x) > 3 ||
				Math.abs(event.clientY - dragStartPos.current.y) > 3
			) {
				dragHasMoved.current = true;
			}
		}
		const scroller = scrollerRef.current;
		if (!scroller) return;

		autoScrollPointer.current = {
			clientX: event.clientX,
			clientY: event.clientY,
			pointerId: event.pointerId,
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey
		};
		updateClipDragPosition(event.clientX, event.clientY, {
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey
		});
		triggerAutoScroll();
	}

	function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
		if (handPanStart.current) {
			handPanStart.current = null;
			setIsPanning(false);
		}
		if (marqueeStart.current) {
			endMarquee(event);
			return;
		}

		if (longPressSession.current && event.pointerId === longPressSession.current.pointerId) {
			if (longPressTimer.current) {
				clearTimeout(longPressTimer.current);
				longPressTimer.current = null;
			}
			const wasLongPressDrag = isLongPressDragActive.current;
			isLongPressDragActive.current = false;
			longPressSession.current = null;
			setLiftedClipId(null);
			if (wasLongPressDrag) {
				suppressContextMenuUntil.current = Date.now() + 400;
			}
		}

		if (dragPointer.current !== event.pointerId) return;
		stopAutoScroll();
		autoScrollPointer.current = null;
		dragPointer.current = null;
		if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
		dragFrame.current = null;
		pendingDragPreview.current = null;
		const clickedClip = dragClickedClip.current;
		const didMove = dragHasMoved.current;
		dragStartPos.current = null;
		dragHasMoved.current = false;
		dragClickedClip.current = null;
		const session = store.getState().timeline.drag;
		if (session) {
			const scroller = scrollerRef.current;
			if (!scroller) {
				cancelTimelineInteraction();
				return;
			}
			const scrollerRect = scroller.getBoundingClientRect();
			// If released outside the timeline scroller, CANCEL drag! Do not create a new track!
			if (
				event.clientX < scrollerRect.left ||
				event.clientX > scrollerRect.right ||
				event.clientY < scrollerRect.top - 10 ||
				event.clientY > scrollerRect.bottom + 10
			) {
				cancelTimelineInteraction();
				return;
			}

			let targetTrackId: TrackId | undefined;
			let createTrackKind: Track['kind'] | undefined;

			const target = document.elementFromPoint(event.clientX, event.clientY);
			const trackLaneEl = target?.closest<HTMLElement>('[data-track-lane]');
			if (
				trackLaneEl &&
				!trackLaneEl.classList.contains('is-preview-lane') &&
				activeProject.tracks.some((t) => t.id === trackLaneEl.dataset.trackLane)
			) {
				targetTrackId = trackLaneEl.dataset.trackLane as TrackId | undefined;
				createTrackKind = undefined;
			} else {
				const primary = session.original[0];
				const primaryTrack = primary
					? activeProject.tracks.find((t) => t.id === primary.trackId)
					: undefined;
				const draggedKind =
					primaryTrack?.kind ??
					(session.assetId ? activeProject.assets[session.assetId]?.kind : undefined) ??
					'video';
				const normalizedKind: Track['kind'] = draggedKind === 'audio' ? 'audio' : 'video';

				const rowsContainer = scroller.querySelector('.timeline-track-rows');
				if (rowsContainer) {
					const trackRows = Array.from(
						rowsContainer.querySelectorAll<HTMLElement>(
							'.timeline-track-row:not(.is-new-track-preview)'
						)
					);
					if (trackRows.length > 0) {
						const firstRowRect = trackRows[0]!.getBoundingClientRect();
						const lastRowRect = trackRows[trackRows.length - 1]!.getBoundingClientRect();

						if (event.clientY < firstRowRect.top) {
							createTrackKind = normalizedKind;
							targetTrackId = undefined;
						} else if (event.clientY > lastRowRect.bottom) {
							createTrackKind = normalizedKind;
							targetTrackId = undefined;
						} else {
							createTrackKind = undefined;
							for (const row of trackRows) {
								const r = row.getBoundingClientRect();
								if (event.clientY >= r.top && event.clientY <= r.bottom) {
									const lane = row.querySelector<HTMLElement>('[data-track-lane]');
									targetTrackId = lane?.dataset.trackLane as TrackId | undefined;
									break;
								}
							}
						}
					}
				}
			}

			setSnappedDragTime(
				session,
				pointerTime(event.clientX),
				targetTrackId,
				event.altKey,
				event.ctrlKey || event.metaKey,
				createTrackKind
			);
			commitTimelineDrag();
		}
		if (clickedClip && !didMove && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
			handleClipSelect(clickedClip.id, event);
		}
	}

	function cancelTimelineInteraction(): void {
		if (longPressTimer.current) {
			clearTimeout(longPressTimer.current);
			longPressTimer.current = null;
		}
		longPressSession.current = null;
		isLongPressDragActive.current = false;
		setLiftedClipId(null);
		if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
		dragFrame.current = null;
		pendingDragPreview.current = null;
		dragStartPos.current = null;
		dragHasMoved.current = false;
		dragClickedClip.current = null;
		if (dragPointer.current !== null) {
			const pointerId = dragPointer.current;
			dragPointer.current = null;
			if (scrollerRef.current?.hasPointerCapture(pointerId)) {
				scrollerRef.current.releasePointerCapture(pointerId);
			}
			cancelTimelineDrag();
		}
		if (rulerPointer.current !== null) {
			rulerPointer.current = null;
		}
		marqueeStart.current = null;
		setMarquee(null);
		stopAutoScroll();
		autoScrollPointer.current = null;
	}

	function handleLaneKeyDown(event: KeyboardEvent<HTMLDivElement>, track: Track): void {
		if (event.key === 'Delete' || event.key === 'Backspace') {
			const sel = store.getState().timeline.selection;
			if (sel.gap && sel.gap.trackId === track.id) {
				event.preventDefault();
				event.stopPropagation();
				store.getState().rippleDeleteGap(sel.gap.trackId, sel.gap.start, sel.gap.end);
				return;
			}
		}
		if (event.key !== 'Enter') return;
		const assetId = store.getState().media.selectedAssetIds[0];
		if (!assetId) return;
		event.preventDefault();
		addAssetToTimeline(assetId, track.id, store.getState().timeline.playhead);
	}

	function handleTrackRemoval(track: Track): void {
		const result = removeTimelineTrack(track.id);
		if (!result.removed && result.clipCount > 0) setRemovePending(track);
	}

	function handleZoomFit(): void {
		setTimelineFollowing(false);
		zoomToFit(scrollerRef.current?.clientWidth ?? 800);
	}

	function handleWheelEvent(event: React.WheelEvent<HTMLDivElement>): void {
		handleWheel(event);
	}

	const dragPositionsByTrack = new Map<TrackId, DragPosition[]>();
	for (const position of drag?.preview ?? []) {
		const positions = dragPositionsByTrack.get(position.trackId) ?? [];
		positions.push(position);
		dragPositionsByTrack.set(position.trackId, positions);
	}

	const sequenceTabs = (
		<div className="timeline-tabs" role="group" aria-label="Timeline sequences">
			<button
				type="button"
				className={`panel-tab ${isRootSequence(activeSequenceId) ? 'is-active' : ''}`}
				aria-current={isRootSequence(activeSequenceId) ? 'page' : undefined}
				onClick={() => store.getState().closeSequence()}
			>
				Main
			</button>
			{!isRootSequence(activeSequenceId) && (
				<>
					<span
						className="panel-tab-separator"
						aria-hidden="true"
						style={{ padding: '0 4px', opacity: 0.6 }}
					>
						›
					</span>
					<button
						type="button"
						className="panel-tab is-active"
						aria-current="page"
						onClick={() => store.getState().openSequenceSettingsDialog(activeSequenceId)}
						title="Click to view or edit Sequence Settings"
						style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
					>
						{project.sequences?.[activeSequenceId]?.name ?? 'Nested Sequence'} ⚙
					</button>
				</>
			)}
		</div>
	);

	return (
		<div
			className="timeline-editor"
			style={{ '--timeline-world-width': `${worldWidth}px` } as CSSProperties}
		>
			<div className="timeline-topbar">
				<ConnectedToolbar
					project={activeProject}
					clipCount={clips.length}
					sequenceTabs={sequenceTabs}
					onSplit={() => splitAtPlayhead()}
					onDelete={() => deleteSelection()}
					onRippleDelete={() => rippleDeleteSelection()}
					onZoom={(value) => zoomAt(value)}
					onFit={handleZoomFit}
					onAddTrack={addTimelineTrack}
					pixelsPerSecond={pixelsPerSecond}
				/>
			</div>
			{graphOpen && <GraphEditor />}
			<div className="timeline-body-wrapper">
				<TimelineTools
					activeTool={activeTool}
					onSelectTool={(tool) => store.getState().setActiveTimelineTool(tool)}
					onAddMarker={() => store.getState().addMarker(store.getState().timeline.playhead)}
					onAddText={() => {
						store.getState().addTextClip();
						if (store.getState().timeline.activeTool !== 'select') {
							store.getState().setActiveTimelineTool('select');
						}
					}}
					onAddShape={() => {
						store.getState().addShapeClip();
						if (store.getState().timeline.activeTool !== 'select') {
							store.getState().setActiveTimelineTool('select');
						}
					}}
				/>
				<div
					className={`timeline-scroll ${isPanning ? 'is-panning' : ''}`}
					data-tool={activeTool}
					ref={scrollerRef}
					tabIndex={0}
					onScroll={handleScroll}
					onWheel={handleWheelEvent}
					onPointerDown={beginMarquee}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onPointerCancel={() => {
						cancelTimelineInteraction();
					}}
					onDragOver={handleTimelineDragOver}
					onDrop={handleTimelineDrop}
					onDragLeave={handleTimelineDragLeave}
					onKeyDown={(event) => {
						if (event.key !== 'Escape') return;
						cancelTimelineInteraction();
					}}
					onClick={(event) => {
						if (Date.now() < suppressClickUntil.current) {
							event.stopPropagation();
							return;
						}
						const target = event.target;
						if (
							target instanceof HTMLElement &&
							target.closest('.timeline-track-lane') &&
							!target.closest('.timeline-clip, .caption-segment-view, .transition-block')
						) {
							const lane = target.closest('.timeline-track-lane') as HTMLElement;
							const trackId = lane.getAttribute('data-track-lane') as TrackId | null;
							const clickTime = pointerTime(event.clientX);
							setPlayhead(clickTime);

							if (trackId) {
								const track = activeProject.tracks.find((t) => t.id === trackId);
								if (track && track.kind !== 'caption') {
									const sorted = [...track.clips].sort((a, b) => a.start - b.start);
									let hitGap: { start: Time; end: Time } | null = null;
									if (sorted.length > 0) {
										if (sorted[0]!.start > 0 && clickTime < sorted[0]!.start) {
											hitGap = { start: 0, end: sorted[0]!.start };
										} else {
											for (let i = 0; i < sorted.length - 1; i++) {
												const curEnd = sorted[i]!.start + sorted[i]!.duration;
												const nextStart = sorted[i + 1]!.start;
												if (clickTime >= curEnd && clickTime <= nextStart) {
													hitGap = { start: curEnd, end: nextStart };
													break;
												}
											}
										}
									}
									if (hitGap) {
										store.getState().selectGap(track.id, hitGap.start, hitGap.end);
									} else {
										store.getState().clearSelection();
										store.getState().selectTrack(track.id);
									}
								}
							}
						}
					}}
					aria-label="Timeline tracks and clips"
				>
					<div
						className="timeline-world"
						style={
							{ width: worldWidth, '--timeline-header-width': `${headerWidth}px` } as CSSProperties
						}
					>
						<TimelineRuler
							project={activeProject}
							duration={visibleDuration}
							playhead={playhead}
							pixelsPerSecond={pixelsPerSecond}
							headerWidth={headerWidth}
							visibleStart={visibleClipRange.start}
							visibleEnd={visibleClipRange.end}
							onScrub={scrubRuler}
							onScrubEnd={endRulerScrub}
							onRulerKeyDown={rulerKeyDown}
						/>
						{(() => {
							const newTrackPreviewRow =
								drag?.createTrackKind &&
								drag?.targetTrackId &&
								!activeProject.tracks.some((t) => t.id === drag.targetTrackId) ? (
									<div
										className={`timeline-track-row track-${drag.createTrackKind} is-new-track-preview`}
										role="row"
										style={{ '--track-height': '45px', zIndex: 100 } as CSSProperties}
									>
										<div className={`timeline-track-header track-${drag.createTrackKind}`}>
											<span className="track-kind is-new-badge" aria-hidden="true">
												{drag.createTrackKind === 'audio' ? 'A+' : 'V+'}
											</span>
											<span className="timeline-track-name">
												New {drag.createTrackKind === 'audio' ? 'Audio' : 'Video'} Track
											</span>
										</div>
										<div
											className="timeline-track-lane is-preview-lane"
											data-track-lane={drag.targetTrackId}
											role="gridcell"
											aria-label={`New ${drag.createTrackKind} track preview`}
											onDragOver={(event) => {
												event.stopPropagation();
												if (drag?.createTrackKind) {
													if (drag?.shapeConfig) {
														beginShapeNewTrackPreview(event);
													} else if (drag?.graphicTemplateId) {
														beginGraphicTemplateNewTrackPreview(event);
													} else {
														beginAssetNewTrackPreview(event, drag.createTrackKind);
													}
												}
											}}
											onDrop={(event) => {
												event.stopPropagation();
												event.preventDefault();
												const session = store.getState().timeline.drag;
												if (session?.createTrackKind) {
													commitTimelineDrag();
												}
											}}
										>
											{drag.preview.map((position) => {
												let sourceClip: Clip | undefined;
												for (const row of activeProject.tracks) {
													const found = row.clips.find((c) => c.id === position.clipId);
													if (found) {
														sourceClip = found;
														break;
													}
												}
												const assetId = drag.assetId ?? sourceClip?.assetId;
												const asset = assetId ? activeProject.assets[assetId] : undefined;
												if (
													!asset &&
													(!sourceClip?.source || sourceClip.source.type === 'asset') &&
													!drag.graphicTemplateId &&
													!drag.shapeConfig
												) {
													return null;
												}
												const previewTrack: Track = {
													id: position.trackId,
													kind: drag.createTrackKind!,
													name: `New ${drag.createTrackKind === 'audio' ? 'Audio' : 'Video'} Track`,
													muted: false,
													locked: false,
													hidden: false,
													clips: []
												};
												const ghostClip: Clip = sourceClip
													? {
															...sourceClip,
															start: position.start,
															duration: position.duration,
															sourceIn: position.sourceIn,
															sourceOut: position.sourceOut
														}
													: drag.shapeConfig
														? createShapeClip(position.start, position.duration, drag.shapeConfig)
														: drag.graphicTemplateId
															? ghostTemplateClip(drag, position.start, position.duration)
															: {
																	id: position.clipId,
																	assetId: asset?.id,
																	start: position.start,
																	duration: position.duration,
																	sourceIn: position.sourceIn,
																	sourceOut: position.sourceOut,
																	speed: 1,
																	volume: 1
																};
												return (
													<ClipView
														key={`preview-track-ghost-${position.clipId}`}
														clip={ghostClip}
														asset={asset}
														track={previewTrack}
														project={activeProject}
														pixelsPerSecond={pixelsPerSecond}
														selected={false}
														tabIndex={-1}
														ghost
														onPointerDown={() => undefined}
														onKeyboardTrim={() => undefined}
														onSelect={() => undefined}
														onContextMenu={() => undefined}
													/>
												);
											})}
										</div>
									</div>
								) : null;

							return (
								<div
									className="timeline-track-rows"
									role="grid"
									aria-label="Project timeline tracks"
								>
									{drag?.createTrackKind === 'video' && newTrackPreviewRow}
									{activeProject.tracks.map((track, index) => {
										const previewPositions = dragPositionsByTrack.get(track.id) ?? [];
										return (
											<div
												className={`timeline-track-row track-${track.kind}`}
												role="row"
												key={track.id}
												style={
													{
														'--track-height': `${track.height ?? 45}px`
													} as CSSProperties
												}
											>
												<TrackHeader
													track={track}
													index={index}
													selected={selection.trackId === track.id}
													onSelect={() => store.getState().selectTrack(track.id)}
													onRename={renameTimelineTrack}
													onRemove={handleTrackRemoval}
													onFlag={setTimelineTrackFlags}
													onReorder={reorderTimelineTrack}
												/>
												<div
													className={`timeline-track-lane ${drag?.targetTrackId === track.id && !drag.allowed ? 'is-invalid-drop' : ''}`}
													data-track-lane={track.id}
													role="gridcell"
													aria-label={`${track.name} track lane`}
													tabIndex={0}
													onPointerDown={(event) => {
														if (
															(event.target as HTMLElement).closest(
																'.timeline-clip, .caption-segment-view, .transition-block, .timeline-gap'
															)
														)
															return;
														store.getState().selectTrack(track.id);
													}}
													onContextMenu={(event) => openLaneMenu(event, track.id)}
													onKeyDown={(event) => handleLaneKeyDown(event, track)}
													onDragOver={(event) => handleTrackDragOver(event, track)}
													onDrop={(event) => handleTrackDrop(event, track)}
												>
													{track.kind === 'caption' ? (
														<>
															{(track.captions ?? []).length === 0 && (
																<span className="timeline-empty-track">
																	No captions yet. Click Caption Layer or auto-generate.
																</span>
															)}
															{(track.captions ?? []).map((caption) => {
																const isSelected = selection.captionId === caption.id;
																return (
																	<CaptionSegmentView
																		key={caption.id}
																		segment={caption}
																		track={track}
																		pixelsPerSecond={pixelsPerSecond}
																		selected={isSelected}
																		onSelect={() => {
																			store.getState().selectCaption(track.id, caption.id);
																		}}
																	/>
																);
															})}
														</>
													) : (
														<>
															{track.clips.length === 0 && (
																<span className="timeline-empty-track">
																	Drop compatible media or press Enter to add selection
																</span>
															)}
															{/* Gaps between clips for 1-click selection and ripple delete */}
															{(() => {
																const gaps: { start: Time; end: Time }[] = [];
																const sortedClips = [...track.clips].sort(
																	(a, b) => a.start - b.start
																);
																if (sortedClips.length > 0) {
																	if (sortedClips[0]!.start > 0) {
																		gaps.push({ start: 0, end: sortedClips[0]!.start });
																	}
																	for (let i = 0; i < sortedClips.length - 1; i++) {
																		const curEnd = sortedClips[i]!.start + sortedClips[i]!.duration;
																		const nextStart = sortedClips[i + 1]!.start;
																		if (nextStart > curEnd) {
																			gaps.push({ start: curEnd, end: nextStart });
																		}
																	}
																}
																return gaps.map((gap) => {
																	const isGapSelected =
																		selection.gap?.trackId === track.id &&
																		selection.gap.start === gap.start &&
																		selection.gap.end === gap.end;

																	const gapLeft = timeToPixels(gap.start, pixelsPerSecond);
																	const gapWidth = timeToPixels(
																		gap.end - gap.start,
																		pixelsPerSecond
																	);
																	if (gapWidth < 1) return null;

																	const durationSec = ((gap.end - gap.start) / 1_000_000).toFixed(
																		2
																	);

																	return (
																		<div
																			key={`gap-${gap.start}-${gap.end}`}
																			className={`timeline-gap ${isGapSelected ? 'is-selected' : ''}`}
																			style={{
																				left: `${gapLeft}px`,
																				width: `${gapWidth}px`
																			}}
																			data-gap-start={gap.start}
																			data-gap-end={gap.end}
																			tabIndex={0}
																			title={`Empty space (${durationSec}s) - Click to select, Delete or Ripple to remove`}
																			onClick={(e) => {
																				if (Date.now() < suppressClickUntil.current) {
																					e.stopPropagation();
																					return;
																				}
																				e.stopPropagation();
																				store.getState().selectGap(track.id, gap.start, gap.end);
																				setPlayhead(pointerTime(e.clientX));
																			}}
																			onKeyDown={(e) => {
																				if (e.key === 'Delete' || e.key === 'Backspace') {
																					e.preventDefault();
																					e.stopPropagation();
																					store
																						.getState()
																						.rippleDeleteGap(track.id, gap.start, gap.end);
																				} else if (e.key === 'Escape') {
																					e.preventDefault();
																					e.stopPropagation();
																					store.getState().clearSelection();
																				}
																			}}
																			onContextMenu={(e) => {
																				openGapMenu(e, track.id, gap.start, gap.end);
																			}}
																		>
																			{isGapSelected && (
																				<div className="timeline-gap-selected-indicator">
																					{gapWidth >= 70 && (
																						<button
																							type="button"
																							className="timeline-gap-ripple-btn"
																							title="Ripple Delete Gap"
																							onClick={(e) => {
																								e.stopPropagation();
																								store
																									.getState()
																									.rippleDeleteGap(track.id, gap.start, gap.end);
																							}}
																						>
																							<svg
																								viewBox="0 0 16 16"
																								width="12"
																								height="12"
																								fill="currentColor"
																							>
																								<path d="M2.5 1a1 1 0 0 0-1 1v1h11V2a1 1 0 0 0-1-1h-9zm10 3H1.5v8a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4zm-7 2.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5zm3 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5z" />
																								<path d="M14 6l2 2-2 2V6z" />
																							</svg>
																							<span>Ripple Delete</span>
																						</button>
																					)}
																				</div>
																			)}
																		</div>
																	);
																});
															})()}
															{track.clips.map((clip) => {
																const asset = clip.assetId
																	? activeProject.assets[clip.assetId]
																	: undefined;
																if (!asset && (!clip.source || clip.source.type === 'asset'))
																	return null;
																const position = drag?.preview.find(
																	(item) => item.clipId === clip.id
																);
																if (position && position.trackId !== track.id) return null;
																const clipStart = position?.start ?? clip.start;
																const clipDuration = position?.duration ?? clip.duration;
																if (
																	!intersectsPixelRange(
																		timeToPixels(clipStart, pixelsPerSecond),
																		timeToPixels(clipDuration, pixelsPerSecond),
																		visibleClipRange
																	)
																) {
																	return null;
																}
																const isSelected = selection.clipIds.includes(clip.id);
																const displayedClip = position
																	? {
																			...clip,
																			start: position.start,
																			duration: position.duration,
																			sourceIn: position.sourceIn,
																			sourceOut: position.sourceOut
																		}
																	: clip;
																return (
																	<ClipView
																		key={clip.id}
																		clip={displayedClip}
																		asset={asset}
																		track={track}
																		project={activeProject}
																		pixelsPerSecond={pixelsPerSecond}
																		selected={isSelected}
																		tabIndex={clip.id === firstTabStopClipId ? 0 : -1}
																		isLifted={liftedClipId === clip.id}
																		onPointerDown={beginClipDrag}
																		onKeyboardTrim={handleKeyboardTrim}
																		onSelect={handleClipSelect}
																		onContextMenu={openClipMenu}
																	/>
																);
															})}
														</>
													)}
													{isTransitionsEnabled() &&
														(track.transitions ?? []).map((tr) => (
															<TransitionBlock
																key={tr.id}
																transition={tr}
																track={track}
																pixelsPerSecond={pixelsPerSecond}
																selected={selection.transitionId === tr.id}
																onSelect={(id) => store.getState().selectTransition(id)}
															/>
														))}
													{previewPositions.map((position) => {
														let sourceClip: Clip | undefined;
														let sourceTrack: Track | undefined;
														for (const row of activeProject.tracks) {
															const found = row.clips.find((c) => c.id === position.clipId);
															if (found) {
																sourceClip = found;
																sourceTrack = row;
																break;
															}
														}
														if (sourceTrack?.id === position.trackId) {
															return null;
														}
														const assetId = drag?.assetId ?? sourceClip?.assetId;
														const asset = assetId ? activeProject.assets[assetId] : undefined;
														if (
															!asset &&
															(!sourceClip?.source || sourceClip.source.type === 'asset') &&
															!drag?.graphicTemplateId &&
															!drag?.shapeConfig
														) {
															return null;
														}
														const ghostClip: Clip = sourceClip
															? {
																	...sourceClip,
																	start: position.start,
																	duration: position.duration,
																	sourceIn: position.sourceIn,
																	sourceOut: position.sourceOut
																}
															: drag?.shapeConfig
																? createShapeClip(
																		position.start,
																		position.duration,
																		drag.shapeConfig
																	)
																: drag?.graphicTemplateId
																	? ghostTemplateClip(drag, position.start, position.duration)
																	: {
																			id: position.clipId,
																			assetId: asset?.id,
																			start: position.start,
																			duration: position.duration,
																			sourceIn: position.sourceIn,
																			sourceOut: position.sourceOut,
																			speed: 1,
																			volume: 1
																		};
														return (
															<ClipView
																key={`ghost-${position.clipId}`}
																clip={ghostClip}
																asset={asset}
																track={track}
																project={activeProject}
																pixelsPerSecond={pixelsPerSecond}
																selected={false}
																tabIndex={-1}
																ghost
																onPointerDown={() => undefined}
																onKeyboardTrim={() => undefined}
																onSelect={() => undefined}
																onContextMenu={() => undefined}
															/>
														);
													})}
												</div>
												<button
													className="timeline-track-resize-handle"
													type="button"
													role="separator"
													aria-label={`Resize ${track.name} track height`}
													aria-orientation="horizontal"
													aria-valuemin={48}
													aria-valuemax={240}
													aria-valuenow={track.height ?? 80}
													onPointerDown={(event) => {
														event.preventDefault();
														event.currentTarget.setPointerCapture(event.pointerId);
														trackResize.current = {
															trackId: track.id,
															pointerId: event.pointerId,
															startY: event.clientY,
															startHeight: track.height ?? 80
														};
													}}
													onPointerMove={(event) => {
														const active = trackResize.current;
														if (
															!active ||
															active.trackId !== track.id ||
															active.pointerId !== event.pointerId
														) {
															return;
														}
														setTrackHeight(
															track.id,
															active.startHeight + event.clientY - active.startY
														);
													}}
													onPointerUp={() => {
														trackResize.current = null;
													}}
													onPointerCancel={() => {
														trackResize.current = null;
													}}
													onKeyDown={(event) => {
														const step = event.shiftKey ? 24 : 8;
														const current = track.height ?? 80;
														if (event.key === 'ArrowUp') {
															event.preventDefault();
															setTrackHeight(track.id, current + step);
														} else if (event.key === 'ArrowDown') {
															event.preventDefault();
															setTrackHeight(track.id, current - step);
														} else if (event.key === 'Home') {
															event.preventDefault();
															setTrackHeight(track.id, 48);
														} else if (event.key === 'End') {
															event.preventDefault();
															setTrackHeight(track.id, 240);
														}
													}}
												/>
											</div>
										);
									})}
									{drag?.createTrackKind === 'audio' && newTrackPreviewRow}
									<div
										className={`timeline-new-track-drop ${drag?.createTrackKind ? 'is-active' : ''}`}
										role="group"
										aria-label="Drop outside tracks to create a new track"
										onDragOver={beginEmptyTrackDrop}
										onDrop={dropOnNewTrack}
									>
										{drag?.createTrackKind
											? `Release to create a new ${drag.createTrackKind} track`
											: 'Drop media or drag clips outside tracks to create a new track'}
									</div>
								</div>
							);
						})()}
						{marquee && (
							<div
								className="timeline-marquee"
								style={{
									left: marquee.left,
									top: marquee.top,
									width: marquee.width,
									height: marquee.height
								}}
								aria-hidden="true"
							/>
						)}
						{detectedSilences.map((silence) => {
							const startPx = headerWidth + timeToPixels(silence.cutStartUs, pixelsPerSecond);
							const widthPx = Math.max(2, timeToPixels(silence.cutDurationUs, pixelsPerSecond));
							return (
								<div
									key={silence.id}
									className={`timeline-silence-region ${silence.included ? '' : 'is-excluded'}`}
									style={{
										left: `${startPx}px`,
										width: `${widthPx}px`
									}}
									title={`Silence: ${(silence.durationUs / 1_000_000).toFixed(2)}s (${silence.included ? 'Will cut ' + (silence.cutDurationUs / 1_000_000).toFixed(2) + 's' : 'Excluded'})`}
								>
									<span className="timeline-silence-label">
										{(silence.cutDurationUs / 1_000_000).toFixed(2)}s
									</span>
								</div>
							);
						})}
						<ConnectedPlayhead pixelsPerSecond={pixelsPerSecond} offset={headerWidth} />
						{drag?.snappedTo !== undefined &&
							timeToPixels(drag.snappedTo, pixelsPerSecond) >= scrollLeft && (
								<div
									className="timeline-snap-guide"
									style={{ left: headerWidth + timeToPixels(drag.snappedTo, pixelsPerSecond) }}
									aria-hidden="true"
								/>
							)}
					</div>
				</div>
			</div>
			<div className="timeline-status-row" role="status" aria-live="polite">
				{drag && !drag.allowed ? 'No space or incompatible media for this drop.' : message}
				{drag?.kind === 'move' && drag.allowed && drag.preview[0] && (
					<span>
						{' '}
						{ticksToTimecode(
							Math.abs(drag.preview[0].start - (drag.original[0]?.start ?? drag.preview[0].start)),
							activeProject.settings.fps
						)}
						{drag.preview[0].start >= (drag.original[0]?.start ?? 0) ? ' later' : ' earlier'}
					</span>
				)}
				<span className="timeline-shortcut-hint">
					N Snap · S Split · Alt+←/→ Nudge · Ctrl/⌘+wheel Zoom
				</span>
			</div>
			{context && (
				<div
					ref={contextMenuRef}
					className="timeline-context-menu"
					role="group"
					aria-label={
						context.gap
							? 'Gap actions'
							: context.lane
								? 'Track lane actions'
								: `Actions for ${context.clip?.assetId ? (activeProject.assets[context.clip.assetId]?.name ?? 'clip') : context.clip?.source?.type === 'adjustment' ? 'adjustment layer' : 'solid'}`
					}
					style={{ left: context.x, top: context.y }}
					onKeyDown={(event) => {
						if (event.key === 'Escape') {
							event.preventDefault();
							closeContextMenu();
						}
					}}
				>
					{context.gap ? (
						<button
							type="button"
							onClick={() => {
								store
									.getState()
									.rippleDeleteGap(context.gap!.trackId, context.gap!.start, context.gap!.end);
								closeContextMenu();
							}}
						>
							<svg
								className="menu-icon"
								viewBox="0 0 16 16"
								width="14"
								height="14"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M2.5 1a1 1 0 0 0-1 1v1h11V2a1 1 0 0 0-1-1h-9zm10 3H1.5v8a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4zm-7 2.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5zm3 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5z" />
								<path d="M14 6l2 2-2 2V6z" />
							</svg>
							<span>Ripple Delete Gap</span>
						</button>
					) : context.lane ? (
						<>
							<button
								type="button"
								disabled={!clipClipboard && !keyframeClipboard}
								onClick={() => {
									if (clipClipboard && clipClipboard.items.length > 0) {
										store.getState().pasteClips(context.lane!.time, context.lane!.trackId);
									} else {
										store.getState().pasteKeyframes();
									}
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z" />
									<path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z" />
								</svg>
								<span>Paste</span>
							</button>
							<button
								type="button"
								onClick={() => {
									store.getState().addTimelineTrack('video');
									closeContextMenu();
								}}
							>
								<span>Add Video Track</span>
							</button>
							<button
								type="button"
								onClick={() => {
									store.getState().addTimelineTrack('audio');
									closeContextMenu();
								}}
							>
								<span>Add Audio Track</span>
							</button>
						</>
					) : context.clip ? (
						<>
							<button
								type="button"
								onClick={() => {
									splitAtPlayhead();
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4v-1.5H2.5v-11H6V1H2zm8 0v1.5h3.5v11H10V15h4a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1h-4zm-2.5 0v14h1V1h-1z" />
								</svg>
								<span>Split at playhead</span>
							</button>
							<button
								type="button"
								onClick={() => {
									deleteSelection();
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
									<path
										fillRule="evenodd"
										d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
									/>
								</svg>
								<span>Delete</span>
							</button>
							<button
								type="button"
								onClick={() => {
									rippleDeleteSelection();
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M2.5 1a1 1 0 0 0-1 1v1h11V2a1 1 0 0 0-1-1h-9zm10 3H1.5v8a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4zm-7 2.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5zm3 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5z" />
									<path d="M14 6l2 2-2 2V6z" />
								</svg>
								<span>Ripple delete</span>
							</button>
							<button
								type="button"
								onClick={() => {
									store.getState().copySelectedClips();
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h-1v1H2V6h1V5H2z" />
								</svg>
								<span>Copy</span>
							</button>
							<button
								type="button"
								disabled={!clipClipboard && !keyframeClipboard}
								onClick={() => {
									if (clipClipboard && clipClipboard.items.length > 0) {
										store.getState().pasteClips();
									} else {
										store.getState().pasteKeyframes();
									}
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z" />
									<path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z" />
								</svg>
								<span>Paste</span>
							</button>
							<button
								type="button"
								disabled={!attributesClipboard}
								onClick={() => {
									store.getState().openPasteAttributesDialog();
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M10.854 7.146a.5.5 0 0 1 0 .708l-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7.5 9.793l2.646-2.647a.5.5 0 0 1 .708 0z" />
									<path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z" />
									<path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z" />
								</svg>
								<span>Paste Attributes…</span>
							</button>
							<button
								type="button"
								onClick={() => {
									duplicateSelection();
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H6zM2 5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1h-1v1H2V6h1V5H2z" />
								</svg>
								<span>Duplicate</span>
							</button>
							<hr />
							<button
								type="button"
								onClick={() => {
									store.getState().openSpeedDialog(context.clip!.id);
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z" />
									<path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z" />
								</svg>
								<span>Speed / Duration…</span>
							</button>
							<button
								type="button"
								onClick={() => {
									store.getState().addFreezeFrame(context.clip!.id);
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M8 0a.5.5 0 0 1 .5.5v15a.5.5 0 0 1-1 0V.5A.5.5 0 0 1 8 0zm7.5 8a.5.5 0 0 1-.5.5H1a.5.5 0 0 1 0-1h14a.5.5 0 0 1 .5.5zm-2.146-5.354a.5.5 0 0 1 0 .708L2.707 13.999a.5.5 0 0 1-.707-.708L12.646 2.646a.5.5 0 0 1 .708 0zm-10.647 0a.5.5 0 0 1 .708 0l10.646 10.645a.5.5 0 0 1-.708.708L2.707 3.354a.5.5 0 0 1 0-.708z" />
								</svg>
								<span>Add freeze frame</span>
							</button>
							<button
								type="button"
								onClick={() => {
									store.getState().freezeFrameToEnd(context.clip!.id);
									closeContextMenu();
								}}
							>
								<svg
									className="menu-icon"
									viewBox="0 0 16 16"
									width="14"
									height="14"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M8 0a.5.5 0 0 1 .5.5v15a.5.5 0 0 1-1 0V.5A.5.5 0 0 1 8 0zm7.5 8a.5.5 0 0 1-.5.5H1a.5.5 0 0 1 0-1h14a.5.5 0 0 1 .5.5z" />
									<path d="M12 4l3 4-3 4V4z" />
								</svg>
								<span>Freeze frame to end of clip</span>
							</button>
							{(selection.clipIds.length >= 2 ||
								Boolean(context.clip.linkId) ||
								activeProject.tracks.some((t) =>
									t.clips.some((c) => selection.clipIds.includes(c.id) && c.linkId)
								)) && (
								<>
									<hr />
									{selection.clipIds.length >= 2 && (
										<button
											type="button"
											onClick={() => {
												linkSelection();
												closeContextMenu();
											}}
										>
											<svg
												className="menu-icon"
												viewBox="0 0 16 16"
												width="14"
												height="14"
												fill="currentColor"
												aria-hidden="true"
											>
												<path d="M6.354 5.5H4a3 3 0 0 0 0 6h3a3 3 0 0 0 2.83-4H9c-.086 0-.17.01-.25.031A2 2 0 0 1 7 10.5H4a2 2 0 1 1 0-4h1.535c.218-.376.495-.714.82-1z" />
												<path d="M9 5.5a3 3 0 0 0-2.83 4h.83c.086 0 .17-.01.25-.031A2 2 0 0 1 9 5.5h3a2 2 0 1 1 0 4h-1.535c-.218.376-.495.714-.82 1H12a3 3 0 1 0 0-6H9z" />
											</svg>
											<span>Link selected clips</span>
										</button>
									)}
									{(Boolean(context.clip.linkId) ||
										activeProject.tracks.some((t) =>
											t.clips.some((c) => selection.clipIds.includes(c.id) && c.linkId)
										)) && (
										<button
											type="button"
											onClick={() => {
												unlinkSelection();
												closeContextMenu();
											}}
										>
											<svg
												className="menu-icon"
												viewBox="0 0 16 16"
												width="14"
												height="14"
												fill="currentColor"
												aria-hidden="true"
											>
												<path d="M6.354 5.5H4a3 3 0 0 0 0 6h3a3 3 0 0 0 2.83-4H9c-.086 0-.17.01-.25.031A2 2 0 0 1 7 10.5H4a2 2 0 1 1 0-4h1.535c.218-.376.495-.714.82-1z" />
												<path d="M9 5.5a3 3 0 0 0-2.83 4h.83c.086 0 .17-.01.25-.031A2 2 0 0 1 9 5.5h3a2 2 0 1 1 0 4h-1.535c-.218.376-.495.714-.82 1H12a3 3 0 1 0 0-6H9z" />
											</svg>
											<span>Unlink clips</span>
										</button>
									)}
								</>
							)}
							{(selection.clipIds.length >= 2 ||
								Boolean(context.clip.groupId) ||
								activeProject.tracks.some((t) =>
									t.clips.some((c) => selection.clipIds.includes(c.id) && c.groupId)
								)) && (
								<>
									<hr />
									{selection.clipIds.length >= 2 && (
										<button
											type="button"
											onClick={() => {
												groupSelection();
												closeContextMenu();
											}}
										>
											<svg
												className="menu-icon"
												viewBox="0 0 16 16"
												width="14"
												height="14"
												fill="currentColor"
												aria-hidden="true"
											>
												<path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z" />
											</svg>
											<span>Group selected clips</span>
										</button>
									)}
									{(Boolean(context.clip.groupId) ||
										activeProject.tracks.some((t) =>
											t.clips.some((c) => selection.clipIds.includes(c.id) && c.groupId)
										)) && (
										<button
											type="button"
											onClick={() => {
												ungroupSelection();
												closeContextMenu();
											}}
										>
											<svg
												className="menu-icon"
												viewBox="0 0 16 16"
												width="14"
												height="14"
												fill="currentColor"
												aria-hidden="true"
											>
												<path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3A1.5 1.5 0 0 1 7 2.5v3A1.5 1.5 0 0 1 5.5 7h-3A1.5 1.5 0 0 1 1 5.5v-3zM2.5 2a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 1h3A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-3A1.5 1.5 0 0 1 9 5.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zM1 10.5A1.5 1.5 0 0 1 2.5 9h3A1.5 1.5 0 0 1 7 10.5v3A1.5 1.5 0 0 1 5.5 15h-3A1.5 1.5 0 0 1 1 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3zm6.5.5A1.5 1.5 0 0 1 10.5 9h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 13.5v-3zm1.5-.5a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-3z" />
											</svg>
											<span>Ungroup clips</span>
										</button>
									)}
								</>
							)}
							{context.clip.source?.type === 'sequence' && (
								<>
									<hr />
									<button
										type="button"
										onClick={() => {
											if (context.clip!.source?.type === 'sequence') {
												store.getState().openSequence(context.clip!.source.sequenceId);
											}
											closeContextMenu();
										}}
									>
										<span>Open in Timeline</span>
									</button>
									<button
										type="button"
										disabled={context.clip.speed !== 1 || Boolean(context.clip.timeRemap)}
										title={
											context.clip.speed !== 1 || context.clip.timeRemap
												? 'Cannot expand sequence with remapped speed or speed curve'
												: 'Un-nest sequence clips into timeline'
										}
										onClick={() => {
											store.getState().expandSequenceInstance(context.clip!.id);
											closeContextMenu();
										}}
									>
										<span>Expand Sequence</span>
									</button>
									<button
										type="button"
										onClick={() => {
											store.getState().makeInstanceUnique(context.clip!.id);
											closeContextMenu();
										}}
									>
										<span>Make Unique</span>
									</button>
									<button
										type="button"
										onClick={() => {
											if (context.clip!.source?.type === 'sequence') {
												store
													.getState()
													.openSequenceSettingsDialog(context.clip!.source.sequenceId);
											}
											closeContextMenu();
										}}
									>
										<span>Sequence Settings…</span>
									</button>
									{isMotionTemplateClip(context.clip) && (
										<button
											type="button"
											onClick={() => {
												store.getState().unpackTemplateClip(context.clip!.id);
												closeContextMenu();
											}}
											title="Unpack this motion template into individual tracks"
										>
											<span>✦ Unpack Motion Template</span>
										</button>
									)}
								</>
							)}
							{selection.clipIds.length > 0 && (
								<>
									<hr />
									<button
										type="button"
										onClick={() => {
											setIsSaveTemplateModalOpen(true);
											closeContextMenu();
										}}
										title="Package selected clips into a reusable Motion Graphic Template"
									>
										<span>✦ Save as Motion Template…</span>
									</button>
									<button
										type="button"
										onClick={() => {
											const defaultName = `Sequence ${Object.keys(project.sequences ?? {}).length + 1}`;
											const name = window.prompt('Name for nested sequence:', defaultName);
											if (name) {
												store.getState().nestSelection(name);
											}
											closeContextMenu();
										}}
									>
										<span>Nest Selection…</span>
									</button>
								</>
							)}
						</>
					) : null}
				</div>
			)}
			{message && <span className="sr-only">{message}</span>}
			<SaveTemplateModal
				isOpen={isSaveTemplateModalOpen}
				onClose={() => setIsSaveTemplateModalOpen(false)}
			/>
			<dialog
				ref={removeDialogRef}
				className="editor-dialog timeline-remove-dialog"
				aria-labelledby="timeline-remove-title"
				onCancel={(event) => {
					event.preventDefault();
					setRemovePending(null);
				}}
			>
				{removePending && (
					<div className="dialog-content">
						<h2 id="timeline-remove-title">Remove {removePending.name}?</h2>
						<p>
							This track contains {removePending.clips.length} clips. Removing it also removes
							linked partner clips.
						</p>
						<div className="dialog-actions">
							<button
								className="secondary-button"
								type="button"
								onClick={() => setRemovePending(null)}
							>
								Cancel
							</button>
							<button
								className="danger-button"
								type="button"
								onClick={() => {
									removeTimelineTrack(removePending.id, { force: true });
									setRemovePending(null);
								}}
							>
								Remove track
							</button>
						</div>
					</div>
				)}
			</dialog>
		</div>
	);
}

export type { AssetId };
