import { createStore } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';
import { enablePatches, produceWithPatches } from 'immer';
import {
	createEmptyProject,
	duplicateProject as duplicateProjectData,
	createAssetId,
	getAssetUsage,
	migrate,
	renameAsset as renameProjectAsset,
	removeAsset as removeProjectAsset,
	relinkAsset as relinkProjectAsset,
	classifyMime,
	projectSchema,
	ticksToSeconds,
	framesToTicks,
	addClipFromAsset as addClipFromAssetOperation,
	addTrack as addTrackOperation,
	deleteClips as deleteClipsOperation,
	duplicateClips as duplicateClipsOperation,
	moveClips as moveClipsOperation,
	linkClips as linkClipsOperation,
	reorderTrack as reorderTrackOperation,
	removeTrack as removeTrackOperation,
	renameTrack as renameTrackOperation,
	rippleDeleteClips as rippleDeleteClipsOperation,
	rippleDeleteGap as rippleDeleteGapOperation,
	setTrackFlags as setTrackFlagsOperation,
	setTrackHeight as setTrackHeightOperation,
	splitClipsAt,
	trimClip as trimClipOperation,
	rippleTrimClip,
	unlinkClips as unlinkClipsOperation,
	timelineDuration,
	groupOf,
	snapToFrame,
	setConstantSpeed,
	reverseClip,
	enableTimeRemap as enableClipTimeRemap,
	disableTimeRemap as disableClipTimeRemap,
	addFreezeFrame as addFreezeFrameOperation,
	freezeFrameToEnd as freezeFrameToEndOperation,
	descriptorFor,
	ANIMATABLE_PROPERTY_IDS,
	propertyCurve,
	isAnimated,
	setPropertyAtTime,
	enableAnimation as enableClipAnimation,
	disableAnimation as disableClipAnimation,
	toggleKeyframe as toggleClipKeyframe,
	nextKeyframeTime,
	prevKeyframeTime,
	moveKeyframes as moveClipKeyframes,
	deleteKeyframes as deleteClipKeyframes,
	setKeyframeInterpolation as setClipKeyframeInterpolation,
	setBezierHandles as setClipBezierHandles,
	setKeyframeValue as setClipKeyframeValue,
	evaluate,
	readProperty,
	copyKeyframes,
	pasteKeyframes,
	createAdjustmentClip,
	createSolidClip,
	createTextClip,
	createShapeClip,
	applyTextTemplatePreset,
	applyTextAnimationPreset,
	clearTextAnimations,
	insertClip,
	createEffectInstance,
	addEffectToClip,
	removeEffectFromClip,
	reorderEffectInClip,
	toggleEffectInClip,
	soloEffectInClip,
	toggleBypassClipEffects,
	duplicateEffectInClip,
	copyClipEffects as copyClipEffectsCore,
	pasteClipEffects as pasteClipEffectsCore,
	getEffectDefinition,
	parseCubeLut,
	normalizeProjectTransitions,
	getTransitionDefinition,
	createMask,
	addMaskToClip,
	removeMaskFromClip,
	updateMaskInClip,
	reorderMasksInClip,
	type Mask,
	type ColorRgba,
	type EffectInstance,
	type EffectType,
	type Transition,
	type TransitionType,
	type TransitionAlignment,
	type Asset,
	type AssetId,
	type BezierHandle,
	type Clip,
	type ClipId,
	type DragPosition,
	type DragSession,
	type InterpolationPreset,
	type JsonValue,
	type KeyframeClipboard,
	type KeyframeRef,
	type Project,
	type ProjectId,
	type ProjectSettings,
	type ProjectSummary,
	type PropertyId,
	type PropertyValue,
	type Time,
	type Track,
	type TrackId,
	type TrackEq,
	type TrackCompressor,
	type AnimatedValue,
	type CaptionWord,
	type CaptionStyle,
	type ProjectProxySettings,
	type SequenceId,
	type Tracker,
	type TrackerId,
	type TrackerRegion,
	type TrackerSample,
	type TrackerType
} from '../core';
import { trackingService } from '../services/tracking/trackingService';
import { captureBindingOffsets, bakeTrackingToKeyframes } from '../core/tracking/apply';
import { bakeTrackingToMask } from '../core/tracking/maskTracking';
import { computeStabilization, bakeStabilizationToClip } from '../core/tracking/stabilize';
import { evaluateTracker } from '../core/tracking/evaluateTracker';
import {
	addMarker as addMarkerCore,
	updateMarker as updateMarkerCore,
	deleteMarker as deleteMarkerCore,
	deleteMarkers as deleteMarkersCore,
	moveMarker as moveMarkerCore,
	convertMarkerRange,
	duplicateMarker as duplicateMarkerCore,
	setMarkerColor as setMarkerColorCore,
	setMarkerType as setMarkerTypeCore,
	findNextMarker,
	findPrevMarker,
	generateMarkerId,
	type Marker,
	type MarkerColor,
	type MarkerId,
	type MarkerType
} from '../core';
import {
	ROOT_SEQUENCE_ID,
	viewProject,
	applyToSequence,
	findClipInSequence,
	isRootSequence
} from '../core/sequences/access';
import {
	createSequence as createSequenceOp,
	deleteSequence as deleteSequenceOp,
	renameSequence as renameSequenceOp,
	duplicateSequence as duplicateSequenceOp,
	nestSelection as nestSelectionOp,
	expandSequenceInstance as expandSequenceInstanceOp,
	makeInstanceUnique as makeInstanceUniqueOp,
	addSequenceInstance as addSequenceInstanceOp
} from '../core/sequences/operations';
import { shouldAutoGenerateProxy, shouldSuggestProxy } from '../core/proxy';
import { proxyService } from '../services/media/proxyService';
import { deleteProxyFile } from '../services/storage/opfs';
import {
	addCaptionSegment as addCaptionSegmentOp,
	splitCaptionSegment as splitCaptionSegmentOp,
	mergeCaptionSegments as mergeCaptionSegmentsOp,
	deleteCaptionSegment as deleteCaptionSegmentOp,
	retimeCaptionSegment as retimeCaptionSegmentOp,
	setCaptionText as setCaptionTextOp,
	createCaptionTrack as createCaptionTrackOp
} from '../core/captions/operations';
import { parseSrt, serializeSrt } from '../core/captions/srt';
import { parseVtt, serializeVtt } from '../core/captions/vtt';
import { DEFAULT_CAPTION_STYLE } from '../core/captions/presets';
import {
	createGraphicClip,
	applyGraphicTemplateToClip,
	getGraphicTemplate,
	computeColorRuns,
	GRAPHIC_ANIMATION_PRESETS,
	applyAnimationPresetToClip
} from '../core/text/graphicsTemplates';
import {
	createTemplateFromClips,
	detectPublishableProperties,
	instantiateTemplateIntoProject,
	createTemplateInstanceClip,
	pickTemplateHostTrack,
	unpackTemplateInstanceClip,
	saveCustomTemplate
} from '../core/templates/templateService';
import { resolveMotionTemplate } from '../core/templates/builtinTemplates';
import type {
	MotionGraphicTemplate,
	PublishedTemplateParam,
	TemplateCategory
} from '../core/templates/templateTypes';
import { detectVoiceActivity, generateDuckingKeyframes } from '../core/audio/ducking';
import { defaultTrackAudio } from '../core/audioMath';
import { ensureLutLoaded, storeParsedLut } from '../services/media/lutCache';
import {
	BUNDLED_FONTS,
	ensureFontLoaded,
	loadSavedCustomFonts
} from '../services/render/text/fontLoader';
import type { ScopeFrameData } from '../services/render/passes/scopes';
import {
	CorruptProjectError,
	deleteProject as deleteProjectRecord,
	getLastOpenedId,
	getProject,
	listProjects,
	saveProject as saveProjectRecord,
	setLastOpenedId
} from '../services/storage/projectDb';
import {
	copyProjectMedia,
	deleteProjectDir,
	ensureProjectDir,
	isSupported as isOpfsSupported,
	collectMediaGarbage,
	reconcileProjectMedia,
	writeMedia,
	deleteMediaFile
} from '../services/storage/opfs';
import { deleteDerived, deleteProjectDerived } from '../services/storage/mediaCache';
import { cancelProjectExport, isProjectExportActive } from '../services/export/session';
import { generateDerived, type DerivedStatus } from '../services/media/derived';
import {
	importFiles as runMediaImport,
	type ImportPhase,
	type ImportProgress,
	type ImportBatchResult
} from '../services/media/import';
import { probeMedia } from '../services/media/probe';
import { repairProjectAudioMetadata } from '../services/media/repairAudio';
import {
	trackProjectCreate,
	trackMediaImport,
	trackFeatureUsed
} from '../../services/activityTracking';
import { projectNameSchema } from '../services/project/projectName';
import { applyTheme, initializeTheme, type ThemeMode } from '../services/theme/theme';
import { clampPanelSize } from '../ui/shell/panelSizing';
import { createHistory, type HistorySnapshot, type HistoryKeyframeRef } from './history';
import type { LayoutNode, PanelId, UserWorkspaceState, Workspace } from '../ui/layout/types';
import {
	loadUserWorkspaceState,
	persistUserWorkspaceState,
	resolveWorkspaceLayout,
	validateAndNormalizeLayout,
	setPanelVisible,
	activateTab,
	collectPanels,
	migrateOldPanelSizes
} from '../ui/layout/operations';
import {
	DEFAULT_SILENCE_OPTIONS,
	type AudioFeatures,
	type DetectedSilence,
	type SilenceTrimOptions
} from '../core/ai/types';
import { extractAudioFeatures } from '../core/ai/silence/features';
import { detectSpeechIntervals } from '../core/ai/silence/vad';
import { computeSilenceRegions } from '../core/ai/silence/detector';
import { applySilenceTrimToProject } from '../core/ai/silence/operations';
import { prepareProjectAudioForStt } from '../services/captions/audioPreparation';

enablePatches();

export type ResizeHandle = 'media' | 'inspector' | 'timeline';
export type SaveStatus = 'saved' | 'saving' | 'error' | 'unsaved';

const PANEL_LIMITS = {
	media: { min: 200, max: 420 },
	inspector: { min: 210, max: 400 },
	timeline: { min: 170, max: 460 }
} as const;

export interface ProjectOptions {
	name: string;
	settings?: Partial<ProjectSettings>;
}

export interface RecoveryState {
	projectId: ProjectId;
	rawJson: string;
	message: string;
}

export interface ImportJob {
	id: string;
	projectId: ProjectId;
	name: string;
	file: File;
	status: ImportPhase | 'cancelled';
	progress: number;
	reason?: string;
}

export interface MediaState {
	importQueue: ImportJob[];
	derivedStatus: Record<AssetId, DerivedStatus>;
	viewMode: 'grid' | 'list';
	search: string;
	selectedAssetIds: AssetId[];
}

export interface DeleteAssetResult {
	deleted: boolean;
	usage: Clip[];
}

export interface RelinkAssetResult {
	relinked: boolean;
	mismatch?: string;
}

export interface TimelineGapSelection {
	trackId: TrackId;
	start: Time;
	end: Time;
}

export interface TimelineSelection {
	clipIds: ClipId[];
	trackId?: TrackId;
	transitionId?: string;
	captionId?: string;
	markerIds?: MarkerId[];
	gap?: TimelineGapSelection;
}

export type TimelineTool =
	'select' | 'track-select' | 'ripple' | 'razor' | 'slip' | 'pen' | 'rect' | 'hand' | 'type';

export interface TimelineState {
	pixelsPerSecond: number;
	scrollLeft: number;
	scrollTop: number;
	playhead: Time;
	selection: TimelineSelection;
	drag: DragSession | null;
	snapEnabled: boolean;
	snapToMarkers: boolean;
	rippleMode: false;
	message: string;
	followPlayhead: boolean;
	activeTool: TimelineTool;
}

export interface TimelineZoomAnchor {
	time: Time;
	pixel: number;
}

export interface TrackRemovalResult {
	removed: boolean;
	clipCount: number;
}

export interface InspectorState {
	expanded: Record<string, boolean>;
	linkScale: boolean;
}

export interface KeyframeSelectionRef {
	clipId: ClipId;
	propertyId: PropertyId;
	time: Time;
}

export interface GraphViewport {
	minTime: number;
	maxTime: number;
	minValue: number;
	maxValue: number;
}

export interface GraphState {
	open: boolean;
	visibleProperties: PropertyId[];
	viewport?: GraphViewport;
}

export interface KeyframeState {
	selection: KeyframeSelectionRef[];
	clipboard: KeyframeClipboard | null;
	showLanes: 'selected' | 'all' | 'off';
	graph: GraphState;
}

export interface EffectsUiState {
	libraryQuery: string;
	selectedEffectId: string | null;
}

export interface ScopesUiState {
	open: boolean;
	mode: 'waveform' | 'parade' | 'histogram' | 'vectorscope';
	channel: 'luma' | 'rgb';
	lastCapture?: ScopeFrameData | null;
}

export interface ColorUiState {
	activeTab: 'basic' | 'curves' | 'wheels' | 'lut';
}

const INSPECTOR_STORAGE_KEY = 'tfve:inspector-prefs';

function loadInspectorPrefs(): InspectorState {
	const fallback: InspectorState = {
		expanded: { transform: true, crop: false },
		linkScale: true
	};
	if (typeof localStorage === 'undefined') return fallback;
	try {
		const raw = localStorage.getItem(INSPECTOR_STORAGE_KEY);
		if (!raw) return fallback;
		const parsed = JSON.parse(raw);
		return {
			expanded: { ...fallback.expanded, ...(parsed.expanded ?? {}) },
			linkScale: typeof parsed.linkScale === 'boolean' ? parsed.linkScale : true
		};
	} catch {
		return fallback;
	}
}

function persistInspectorPrefs(prefs: InspectorState): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(INSPECTOR_STORAGE_KEY, JSON.stringify(prefs));
	} catch {}
}

function createKeyframeState(): KeyframeState {
	return {
		selection: [],
		clipboard: null,
		showLanes: 'selected',
		graph: {
			open: false,
			visibleProperties: ['position', 'scale', 'rotation', 'opacity', 'crop']
		}
	};
}

type ProjectRecipe = (project: Project) => Project;
type HistoryPolicy = 'record' | 'skip';

const EMPTY_HISTORY: HistorySnapshot = {
	canUndo: false,
	canRedo: false,
	undoLabel: null,
	redoLabel: null,
	size: 0
};

function createTimelineState(): TimelineState {
	return {
		pixelsPerSecond: 64,
		scrollLeft: 0,
		scrollTop: 0,
		playhead: 0,
		selection: { clipIds: [] },
		drag: null,
		snapEnabled: true,
		snapToMarkers: true,
		rippleMode: false,
		message: '',
		followPlayhead: false,
		activeTool: 'select'
	};
}

function projectClipPositions(
	project: Project,
	clipIds: readonly ClipId[],
	sequenceId: SequenceId = ROOT_SEQUENCE_ID
): DragPosition[] {
	const ids = new Set(clipIds);
	const activeProj = viewProject(project, sequenceId);
	return activeProj.tracks.flatMap((track) =>
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

export interface ExportCompletedResult {
	filename: string;
	format: string;
	width?: number;
	height?: number;
	fps?: number;
	durationSec?: number;
	fileSizeBytes?: number;
	blob?: Blob;
	warnings?: string[];
	notice?: string;
}

export interface EditorState {
	theme: ThemeMode;
	themeMessage: string;
	mediaWidth: number;
	inspectorWidth: number;
	timelineHeight: number;
	projectName: string;
	projectNameDraft: string;
	isRenaming: boolean;
	isFileMenuOpen: boolean;
	projectMessage: string;
	project: Project | null;
	revision: number;
	projects: ProjectSummary[];
	saveStatus: SaveStatus;
	history: HistorySnapshot;
	historyMessage: string;
	isInitialized: boolean;
	isProjectManagerOpen: boolean;
	isNewProjectDialogOpen: boolean;
	isSaveCopyPromptOpen: boolean;
	saveCopyPromptShown: boolean;
	isExportDialogOpen: boolean;
	isExportClosePromptOpen: boolean;
	isExporting: boolean;
	exportCompletedResult: ExportCompletedResult | null;
	isImportDialogOpen: boolean;
	isSpeedDialogOpen: boolean;
	speedDialogClipId: ClipId | null;
	proxySuggestion: { assetId: AssetId; assetName: string } | null;
	recovery: RecoveryState | null;
	media: MediaState;
	timeline: TimelineState;
	inspector: InspectorState;
	keyframes: KeyframeState;
	effectsUi: EffectsUiState;
	scopes: ScopesUiState;
	colorUi: ColorUiState;
	effectsClipboard: EffectInstance[] | null;
	activeSequenceId: SequenceId;
	sequencePlayheads: Record<SequenceId, Time>;
	isSequenceSettingsDialogOpen: boolean;
	sequenceSettingsDialogId: SequenceId | null;
	// Markers State
	selectedMarkerId: MarkerId | null;
	selectedMarkerIds: MarkerId[];
	isMarkerDialogOpen: boolean;
	editingMarkerId: MarkerId | null;
	// Workspace Layout State
	workspaces: UserWorkspaceState;
	activeWorkspaceId: string;
	activeLayout: LayoutNode;
	maximizedPanelId: PanelId | null;
	workspaceMessage: string;
	initialize: () => Promise<void>;
	toggleTheme: () => void;
	beginRename: () => void;
	cancelRename: () => void;
	toggleFileMenu: () => void;
	closeFileMenu: () => void;
	setProjectNameDraft: (value: string) => void;
	saveProjectName: () => void;
	renameProject: (name: string) => void;
	renameSavedProject: (id: ProjectId, name: string) => Promise<boolean>;
	repairAudioMetadata: () => Promise<{ project: Project | null; warnings: string[] }>;
	resizePanel: (handle: ResizeHandle, delta: number) => void;
	createProject: (options: ProjectOptions) => Promise<void>;
	openProject: (id: ProjectId) => Promise<void>;
	closeProject: () => Promise<void>;
	duplicateProject: (id: ProjectId) => Promise<void>;
	deleteProject: (id: ProjectId) => Promise<boolean>;
	refreshProjects: () => Promise<void>;
	replaceProject: (project: Project) => Promise<boolean>;
	importMedia: (files: File[]) => Promise<ImportBatchResult | null>;
	cancelImport: (jobId: string) => void;
	deleteAsset: (assetId: AssetId, options?: { force?: boolean }) => Promise<DeleteAssetResult>;
	renameAsset: (assetId: AssetId, name: string) => boolean;
	relinkAsset: (
		assetId: AssetId,
		file: File,
		options?: { acceptMismatch?: boolean }
	) => Promise<RelinkAssetResult>;
	setMediaView: (viewMode: MediaState['viewMode']) => void;
	setMediaSearch: (search: string) => void;
	selectAssets: (assetIds: AssetId[]) => void;
	generateAssetDerived: (assetId: AssetId) => void;
	openProjectManager: () => void;
	closeProjectManager: () => void;
	openNewProjectDialog: () => void;
	closeNewProjectDialog: () => void;
	openSaveCopyPrompt: () => void;
	closeSaveCopyPrompt: () => void;
	openExportDialog: () => void;
	closeExportDialog: () => void;
	openExportCompleteDialog: (result: ExportCompletedResult) => void;
	closeExportCompleteDialog: () => void;
	openImportDialog: () => void;
	closeImportDialog: () => void;
	openSpeedDialog: (clipId?: ClipId) => void;
	closeSpeedDialog: () => void;
	setClipSpeed: (
		clipIds: ClipId[],
		speedMultiplier: number,
		options?: { ripple?: boolean; maintainPitch?: boolean }
	) => boolean;
	reverseClips: (clipIds: ClipId[]) => boolean;
	enableTimeRemap: (clipId: ClipId) => boolean;
	disableTimeRemap: (clipId: ClipId, mode?: 'average' | 'initial') => boolean;
	setClipTimeRemap: (clipId: ClipId, timeRemap: AnimatedValue<number>) => boolean;
	addFreezeFrame: (clipId: ClipId, duration?: Time, options?: { ripple?: boolean }) => boolean;
	freezeFrameToEnd: (clipId: ClipId) => boolean;
	setMaintainPitch: (clipIds: ClipId[], maintainPitch: boolean) => boolean;
	setExporting: (exporting: boolean) => void;
	confirmCancelExportAndContinue: () => Promise<void>;
	dismissExportClosePrompt: () => void;
	setProjectMessage: (message: string) => void;
	setSaveStatus: (status: SaveStatus) => void;
	setAutosaveFlush: (flush: (() => Promise<void>) | null) => void;
	flushSave: () => Promise<void>;
	undo: () => boolean;
	redo: () => boolean;
	clearHistory: (reason?: string) => void;
	deleteCorruptProject: () => Promise<void>;
	clearRecovery: () => void;
	setZoom: (pixelsPerSecond: number, anchor?: TimelineZoomAnchor) => void;
	zoomToFit: (viewportWidth?: number) => void;
	setScroll: (scrollLeft: number, scrollTop: number) => void;
	setTimelineFollowing: (following: boolean) => void;
	setPlayhead: (time: Time) => void;
	selectClips: (ids: ClipId[], mode?: 'replace' | 'toggle' | 'add') => void;
	selectTrack: (trackId: TrackId | null) => void;
	clearSelection: () => void;
	toggleSnap: () => void;
	setActiveTimelineTool: (tool: TimelineTool) => void;
	beginTimelineDrag: (session: DragSession) => void;
	updateTimelineDrag: (
		pointerTime: Time,
		options?: {
			targetTrackId?: TrackId;
			createTrackKind?: Track['kind'];
			unlink?: boolean;
			snappedTo?: Time;
		}
	) => void;
	cancelTimelineDrag: () => void;
	commitTimelineDrag: () => boolean;
	addAssetToTimeline: (assetId: AssetId, trackId: TrackId, time: Time) => boolean;
	addAssetOnNewTrack: (assetId: AssetId, kind: Track['kind'], time: Time) => boolean;
	moveClips: (ids: ClipId[], deltaTime: Time, targetTrackId?: TrackId, unlink?: boolean) => boolean;
	trimClip: (id: ClipId, edge: 'start' | 'end', time: Time, unlink?: boolean) => boolean;
	splitClipAt: (clipId: ClipId, time: Time, unlink?: boolean) => ClipId[];
	splitAtPlayhead: (unlink?: boolean) => boolean;
	deleteSelection: (unlink?: boolean) => boolean;
	rippleDeleteSelection: () => boolean;
	selectGap: (trackId: TrackId, start: Time, end: Time) => void;
	rippleDeleteGap: (trackId: TrackId, start: Time, end: Time) => boolean;
	duplicateSelection: () => boolean;
	addTimelineTrack: (kind: Track['kind']) => void;
	addCaptionTrack: (name?: string) => TrackId | null;
	addCaptionSegment: (
		trackId: TrackId,
		segment: {
			start: Time;
			end: Time;
			text: string;
			words?: CaptionWord[];
			speaker?: string;
		}
	) => string | null;
	addCaptionSegmentsBulk: (
		segments: Array<{
			start: Time;
			end: Time;
			text: string;
			words?: CaptionWord[];
			speaker?: string;
		}>,
		trackName?: string
	) => TrackId | null;
	updateCaptionSegment: (
		trackId: TrackId,
		segmentId: string,
		updates: Partial<{ start: Time; end: Time; text: string; speaker?: string }>
	) => boolean;
	deleteCaptionSegment: (trackId: TrackId, segmentId: string) => boolean;
	splitCaptionSegmentAt: (trackId: TrackId, segmentId: string, splitTime?: Time) => boolean;
	mergeCaptionSegmentsWith: (trackId: TrackId, firstId: string, secondId: string) => boolean;
	setCaptionTrackStyle: (trackId: TrackId, style: Partial<CaptionStyle>) => boolean;
	importCaptionsToTrack: (trackId: TrackId, content: string, format?: 'srt' | 'vtt') => boolean;
	exportCaptionsFromTrack: (trackId: TrackId, format?: 'srt' | 'vtt') => string;
	selectCaption: (trackId?: TrackId | null, captionId?: string | null) => void;
	addCaptionAtPlayhead: (text?: string, trackId?: TrackId) => string | null;
	removeTimelineTrack: (id: TrackId, options?: { force?: boolean }) => TrackRemovalResult;
	reorderTimelineTrack: (id: TrackId, targetIndex: number) => boolean;
	renameTimelineTrack: (id: TrackId, name: string) => boolean;
	setTimelineTrackFlags: (
		id: TrackId,
		flags: Partial<Pick<Track, 'muted' | 'locked' | 'hidden'>>
	) => boolean;
	setTimelineTrackHeight: (id: TrackId, height: number) => boolean;
	linkSelection: () => boolean;
	unlinkSelection: () => boolean;
	setTimelineMessage: (message: string) => void;
	setInspectorExpanded: (sectionId: string, expanded: boolean) => void;
	setInspectorLinkScale: (link: boolean) => void;
	setKeyframeSelection: (selection: KeyframeSelectionRef[]) => void;
	selectKeyframe: (ref: KeyframeSelectionRef, mode?: 'set' | 'toggle' | 'extend') => void;
	clearKeyframeSelection: () => void;
	setShowKeyframeLanes: (mode: 'selected' | 'all' | 'off') => void;
	toggleKeyframeLanes: () => void;
	setGraphOpen: (open: boolean) => void;
	toggleGraphEditor: () => void;
	setGraphVisibleProperties: (properties: PropertyId[]) => void;
	setGraphViewport: (viewport: GraphViewport) => void;
	setProperty: (
		clipId: ClipId,
		propertyId: PropertyId,
		value: PropertyValue,
		options?: {
			autoKey?: boolean;
			editedChannel?: number;
			coalesce?: boolean;
			mergeKey?: string;
			coalesceWindowMs?: number;
			label?: string;
		}
	) => void;
	setProperties: (
		clipId: ClipId,
		properties: Array<{ propertyId: PropertyId; value: PropertyValue; editedChannel?: number }>,
		options?: {
			autoKey?: boolean;
			coalesce?: boolean;
			mergeKey?: string;
			coalesceWindowMs?: number;
			label?: string;
		}
	) => void;
	enableAnimation: (clipId: ClipId, propertyId: PropertyId) => void;
	disableAnimation: (
		clipId: ClipId,
		propertyId: PropertyId,
		mode?: 'flatten-current' | 'discard'
	) => void;
	toggleKeyframe: (clipId: ClipId, propertyId: PropertyId) => void;
	deleteSelectedKeyframes: () => void;
	moveSelectedKeyframes: (deltaTime: Time, commit?: boolean) => void;
	setKeyframeInterpolation: (preset: Exclude<InterpolationPreset, 'bezier'>) => void;
	setBezierHandles: (
		clipId: ClipId,
		propertyId: PropertyId,
		time: Time,
		handles: { easeIn?: BezierHandle; easeOut?: BezierHandle },
		commit?: boolean
	) => void;
	setKeyframeValue: (
		clipId: ClipId,
		propertyId: PropertyId,
		time: Time,
		value: PropertyValue,
		editedChannel?: number,
		commit?: boolean
	) => void;
	addKeyframeAtTime: (
		clipId: ClipId,
		propertyId: PropertyId,
		time: Time,
		value?: PropertyValue
	) => void;
	copySelectedKeyframes: () => void;
	pasteKeyframes: (targetClipId?: ClipId, targetPropertyId?: PropertyId) => void;
	nextKeyframe: () => void;
	prevKeyframe: () => void;
	easyEase: () => void;
	setEffectsLibraryQuery: (query: string) => void;
	setSelectedEffectId: (effectId: string | null) => void;
	setScopesOpen: (open: boolean) => void;
	toggleScopesOpen: () => void;
	setScopesMode: (mode: ScopesUiState['mode']) => void;
	setScopesChannel: (channel: ScopesUiState['channel']) => void;
	setColorTab: (tab: ColorUiState['activeTab']) => void;
	addEffect: (
		clipId: ClipId,
		effectType: EffectType,
		initialParams?: Record<string, unknown>
	) => EffectInstance | null;
	removeEffect: (clipId: ClipId, effectId: string) => boolean;
	reorderEffect: (clipId: ClipId, effectId: string, toIndex: number) => boolean;
	toggleEffect: (clipId: ClipId, effectId: string, enabled?: boolean) => boolean;
	soloEffect: (clipId: ClipId, effectId: string) => boolean;
	toggleBypassClipEffects: (clipId: ClipId, bypass?: boolean) => boolean;
	duplicateEffect: (clipId: ClipId, effectId: string) => EffectInstance | null;
	resetEffect: (clipId: ClipId, effectId: string) => boolean;
	setEffectParam: (
		clipId: ClipId,
		effectId: string,
		paramName: string,
		value: unknown,
		options?: { autoKey?: boolean; coalesce?: boolean }
	) => void;
	copyClipEffects: (clipId: ClipId) => void;
	pasteClipEffects: (clipId: ClipId) => boolean;
	ensureColorCorrection: (clipId: ClipId) => EffectInstance | null;
	addAdjustmentLayer: (trackId?: TrackId, start?: Time, duration?: Time) => ClipId | null;
	addSolidLayer: (
		color?: ColorRgba | string,
		trackId?: TrackId,
		start?: Time,
		duration?: Time
	) => ClipId | null;
	importLut: (name: string, cubeText: string) => Promise<AssetId | null>;
	// Transition actions
	addTransition: (
		trackId: TrackId,
		type: TransitionType,
		edge: Transition['edge'],
		duration?: Time,
		alignment?: TransitionAlignment,
		params?: Record<string, JsonValue>
	) => string | null;
	updateTransition: (
		transitionId: string,
		updates: Partial<
			Pick<Transition, 'type' | 'duration' | 'alignment' | 'easing' | 'audioCrossfade' | 'params'>
		>
	) => boolean;
	removeTransition: (transitionId: string) => boolean;
	selectTransition: (transitionId: string | null) => void;
	applyDefaultTransition: (type?: TransitionType) => boolean;
	// Mask actions
	maskTool: {
		activeTool: 'select' | 'pen' | 'rect' | 'ellipse';
		selectedMaskId: string | null;
		selectedPointIndex: number | null;
		selectedPoints: number[];
		showOverlay: boolean;
		blockedMessage: string | null;
	};
	setMaskTool: (tool: 'select' | 'pen' | 'rect' | 'ellipse') => void;
	selectMask: (maskId: string | null) => void;
	selectMaskPoint: (index: number | null) => void;
	selectMaskPoints: (indices: number[]) => void;
	toggleMaskPoint: (index: number, multiSelect?: boolean) => void;
	setMaskOverlayVisible: (visible: boolean) => void;
	setMaskBlockedMessage: (message: string | null) => void;
	addMask: (
		clipId: ClipId,
		type: 'rect' | 'ellipse' | 'path',
		overrides?: Partial<Mask>
	) => string | null;
	removeMask: (clipId: ClipId, maskId: string) => boolean;
	updateMask: (
		clipId: ClipId,
		maskId: string,
		patch: Partial<Mask>,
		options?: { coalesce?: boolean }
	) => boolean;
	reorderMask: (clipId: ClipId, fromIndex: number, toIndex: number) => boolean;
	setMaskParam: (
		clipId: ClipId,
		maskId: string,
		param: string,
		value: unknown,
		options?: { autoKey?: boolean; coalesce?: boolean }
	) => void;
	// Audio actions
	isMixerOpen: boolean;
	toggleMixer: () => void;
	setTrackAudioGain: (trackId: TrackId, gainDb: number, coalesce?: boolean) => boolean;
	setTrackAudioPan: (trackId: TrackId, pan: number, coalesce?: boolean) => boolean;
	setTrackAudioTrim: (trackId: TrackId, trimDb: number, coalesce?: boolean) => boolean;
	setTrackAudioOutput: (trackId: TrackId, output: 'master' | string) => boolean;
	setTrackAudioSolo: (trackId: TrackId, solo?: boolean, exclusive?: boolean) => boolean;
	setTrackAudioEq: (trackId: TrackId, eq: TrackEq) => boolean;
	setTrackAudioCompressor: (trackId: TrackId, compressor: TrackCompressor) => boolean;
	resetTrackAudio: (trackId: TrackId) => boolean;
	setMasterAudioGain: (gainDb: number, coalesce?: boolean) => boolean;
	setMasterAudioLimiter: (limiter: boolean) => boolean;
	setMasterAudioLoudnessTarget: (targetLufs?: number) => boolean;
	addAudioBus: (name?: string, output?: 'master' | string) => string | null;
	removeAudioBus: (busId: string) => boolean;
	setBusAudioGain: (busId: string, gainDb: number, coalesce?: boolean) => boolean;
	setBusAudioPan: (busId: string, pan: number, coalesce?: boolean) => boolean;
	setBusAudioMute: (busId: string, muted?: boolean) => boolean;
	setBusAudioSolo: (busId: string, solo?: boolean) => boolean;
	setTrackSend: (
		trackId: TrackId,
		send: { busId: string; levelDb: number; pre: boolean; enabled: boolean }
	) => boolean;
	setTrackAudioPhaseInvert: (trackId: TrackId, phaseInvert: boolean) => boolean;
	setTrackAudioSoloSafe: (trackId: TrackId, soloSafe: boolean) => boolean;
	setTrackAudioChannelMode: (trackId: TrackId, channelMode: 'stereo' | 'mono') => boolean;
	setTrackAudioEffects: (
		trackId: TrackId,
		effects: import('../core/types').AudioEffectInstance[]
	) => boolean;
	setBusAudioEffects: (
		busId: string,
		effects: import('../core/types').AudioEffectInstance[]
	) => boolean;
	setMasterAudioEffects: (effects: import('../core/types').AudioEffectInstance[]) => boolean;
	setAutomationMode: (
		targetType: 'track' | 'bus' | 'master',
		targetId: string,
		mode: 'off' | 'read' | 'write' | 'touch' | 'latch'
	) => boolean;
	setClipAudioTag: (
		clipId: ClipId,
		tag: 'dialogue' | 'music' | 'sfx' | 'ambience' | undefined
	) => boolean;
	setClipAudioEffects: (
		clipId: ClipId,
		effects: import('../core/types').AudioEffectInstance[]
	) => boolean;
	applyAutoDucking: (targetClipId: ClipId) => boolean;
	setClipFade: (
		clipId: ClipId,
		fade: { fadeInUs?: Time; fadeOutUs?: Time; fadeCurve?: 'equalPower' | 'linear' }
	) => boolean;
	// Text actions
	editingTextClipId: ClipId | null;
	setEditingTextClipId: (clipId: ClipId | null) => void;
	addTextClip: (options?: { text?: string; template?: string }) => ClipId | null;
	setTextContent: (clipId: ClipId, text: string) => boolean;
	setTextStyle: (clipId: ClipId, style: Partial<import('../core/types').TextStyle>) => boolean;
	setTextBox: (clipId: ClipId, box: Partial<import('../core/types').TextBox>) => boolean;
	applyTextTemplate: (clipId: ClipId, templateId: string) => boolean;
	applyTextAnimation: (clipId: ClipId, presetId: string) => boolean;
	clearTextAnimations: (clipId: ClipId) => boolean;
	addGraphicClip: (
		templateId: string,
		options?: { text?: string; trackId?: TrackId; start?: Time; duration?: Time }
	) => ClipId | null;
	applyGraphicTemplate: (clipId: ClipId, templateId: string, customText?: string) => boolean;
	setGraphicAccentColor: (
		clipId: ClipId,
		color: { r: number; g: number; b: number; a: number }
	) => boolean;
	setSolidColor: (
		clipId: ClipId,
		color: { r: number; g: number; b: number; a?: number }
	) => boolean;
	setSolidGradient: (
		clipId: ClipId,
		options: {
			gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
			gradientColorEnd?: { r: number; g: number; b: number; a: number };
			gradientAngle?: number;
		}
	) => boolean;
	setTextGradient: (
		clipId: ClipId,
		options: {
			gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
			gradientColorEnd?: { r: number; g: number; b: number; a: number };
			gradientAngle?: number;
		}
	) => boolean;
	// Shape actions
	addShapeClip: (
		configOrOptions?: Partial<import('../core/shapes/shapeTypes').ShapeConfig> & {
			trackId?: TrackId;
			start?: Time;
			duration?: Time;
		},
		placement?: {
			trackId?: TrackId;
			start?: Time;
			duration?: Time;
		}
	) => ClipId | null;
	updateShapeProperties: (
		clipId: ClipId,
		updates: Partial<import('../core/shapes/shapeTypes').ShapeConfig>
	) => boolean;
	// Proxy actions
	setProjectProxySettings: (settings: Partial<ProjectProxySettings>) => boolean;
	toggleProxiesEnabled: () => boolean;
	createProxy: (assetId: AssetId) => void;
	createAllProxies: () => void;
	deleteProxy: (assetId: AssetId) => Promise<boolean>;
	deleteAllProxies: () => Promise<boolean>;
	cancelProxyGeneration: (assetId: AssetId) => void;
	retryProxyGeneration: (assetId: AssetId) => void;
	dismissProxySuggestion: (neverAsk?: boolean) => void;
	acceptProxySuggestion: () => void;
	// Sequence actions
	openSequence: (id: SequenceId) => void;
	closeSequence: () => void;
	createSequence: (name: string, settings?: ProjectSettings) => SequenceId | null;
	deleteSequence: (id: SequenceId, removeInstances?: boolean) => boolean;
	renameSequence: (id: SequenceId, name: string) => boolean;
	duplicateSequence: (id: SequenceId) => SequenceId | null;
	nestSelection: (name?: string) => ClipId | null;
	expandSequenceInstance: (clipId: ClipId) => boolean;
	makeInstanceUnique: (clipId: ClipId) => SequenceId | null;
	addSequenceToTimeline: (sequenceId: SequenceId, time: Time, trackId?: TrackId) => ClipId | null;
	openSequenceSettingsDialog: (sequenceId?: SequenceId) => void;
	closeSequenceSettingsDialog: () => void;
	updateSequenceSettings: (sequenceId: SequenceId, settings: ProjectSettings | undefined) => void;
	// Motion Graphic Template actions
	saveSelectionAsTemplate: (options: {
		name: string;
		category?: TemplateCategory;
		description?: string;
		author?: string;
		publishedParams?: PublishedTemplateParam[];
		responsiveTiming?: { introDuration: Time; outroDuration: Time };
	}) => MotionGraphicTemplate | null;
	instantiateTemplate: (
		template: MotionGraphicTemplate,
		start?: Time,
		trackId?: TrackId
	) => ClipId | null;
	setTemplateParamOverride: (clipId: ClipId, paramId: string, value: any) => void;
	resetTemplateParamOverrides: (clipId: ClipId) => void;
	unpackTemplateClip: (clipId: ClipId) => boolean;
	// Workspace actions
	switchWorkspace: (workspaceId: string) => void;
	updateLayout: (layout: LayoutNode) => void;
	resetWorkspaceLayout: (workspaceId?: string) => void;
	saveAsNewWorkspace: (name: string) => string | null;
	deleteCustomWorkspace: (workspaceId: string) => boolean;
	renameCustomWorkspace: (workspaceId: string, newName: string) => boolean;
	reorderWorkspaces: (order: string[]) => void;
	togglePanelVisibility: (panelId: PanelId) => void;
	toggleMaximizePanel: (panelId?: PanelId) => void;
	// Tracking actions
	selectedTrackerId: TrackerId | null;
	isTrackingActive: boolean;
	trackingProgress: { processedFrames: number; totalFrames: number } | null;
	selectTracker: (trackerId: TrackerId | null) => void;
	addTracker: (
		clipId: ClipId,
		type?: TrackerType,
		initialRegion?: Partial<TrackerRegion>
	) => TrackerId | null;
	removeTracker: (clipId: ClipId, trackerId: TrackerId) => boolean;
	updateTracker: (clipId: ClipId, trackerId: TrackerId, patch: Partial<Tracker>) => boolean;
	startTracking: (
		clipId: ClipId,
		trackerId: TrackerId,
		direction: 'forward' | 'backward'
	) => Promise<boolean>;
	cancelTracking: () => Promise<void>;
	bindToTracker: (
		trackedClipId: ClipId,
		trackerId: TrackerId,
		config: {
			targetClipId: ClipId;
			applyPosition: boolean;
			applyRotation: boolean;
			applyScale: boolean;
		}
	) => boolean;
	unbindTracker: (trackedClipId: ClipId, trackerId: TrackerId) => boolean;
	bakeTracker: (
		trackedClipId: ClipId,
		trackerId: TrackerId,
		thinningTolerancePx?: number
	) => boolean;
	bakeTrackerToMask: (
		clipId: ClipId,
		maskId: string,
		trackerId: TrackerId,
		thinningTolerancePx?: number
	) => boolean;
	stabilizeClip: (
		clipId: ClipId,
		trackerId: TrackerId,
		options?: import('../core/tracking/stabilize').StabilizationOptions
	) => boolean;
	// Marker Actions
	addMarker: (options?: Time | Partial<Marker>) => MarkerId | null;
	updateMarker: (id: MarkerId, patch: Partial<Marker>, options?: { coalesce?: boolean }) => void;
	deleteMarker: (id: MarkerId) => void;
	deleteMarkers: (ids: MarkerId[]) => void;
	moveMarker: (id: MarkerId, newTime: Time, options?: { coalesce?: boolean }) => void;
	setMarkerRange: (id: MarkerId, duration: Time) => void;
	duplicateMarker: (id: MarkerId) => void;
	setMarkerColor: (ids: MarkerId | MarkerId[], color: MarkerColor) => void;
	setMarkerType: (ids: MarkerId | MarkerId[], type: MarkerType) => void;
	selectMarker: (id: MarkerId | null, multi?: boolean) => void;
	clearMarkerSelection: () => void;
	seekToNextMarker: () => void;
	seekToPrevMarker: () => void;
	setSnapToMarkers: (enabled: boolean) => void;
	openMarkerDialog: (id?: MarkerId) => void;
	closeMarkerDialog: () => void;
	// AI Assistant State & Actions
	ai: {
		silenceOptions: SilenceTrimOptions;
		detectedSilences: DetectedSilence[];
		cachedFeatures: AudioFeatures | null;
		cachedTrackKey: string | null;
		isAnalyzingSilence: boolean;
		analysisProgress: number;
		virtualPreview: boolean;
	};
	setSilenceOptions: (opts: Partial<SilenceTrimOptions>) => void;
	setDetectedSilences: (silences: DetectedSilence[]) => void;
	toggleSilenceIncluded: (id: string) => void;
	includeAllSilences: (included: boolean) => void;
	setSilenceVirtualPreview: (active: boolean) => void;
	analyzeSilence: () => Promise<void>;
	recomputeSilencesFromCache: () => void;
	applySilenceTrimAction: (mode: 'new-sequence' | 'in-place') => void;
}

function resolveDragTemplate(drag: DragSession): MotionGraphicTemplate {
	const template =
		drag.motionTemplate ??
		(drag.graphicTemplateId ? resolveMotionTemplate(drag.graphicTemplateId) : undefined);
	if (!template) throw new Error(`Template "${drag.graphicTemplateId}" was not found.`);
	return template;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'An unexpected project error occurred.';
}

export function createEditorStore() {
	let autosaveFlush: (() => Promise<void>) | null = null;
	let afterExportAction: (() => Promise<void>) | null = null;
	const projectHistory = createHistory();
	const importControllers = new Map<
		string,
		{ projectId: ProjectId; controller: AbortController }
	>();
	const derivedControllers = new Map<
		AssetId,
		{ projectId: ProjectId; controller: AbortController }
	>();

	return createStore<EditorState>()(
		immer((set, get) => {
			function deferForActiveExport(project: Project | null, action: () => Promise<void>): boolean {
				if (!project || !isProjectExportActive(project.id)) return false;
				afterExportAction = action;
				set((state) => {
					state.isExportClosePromptOpen = true;
				});
				return true;
			}

			projectHistory.subscribe((snapshot) => {
				set((state) => {
					state.history = snapshot;
				});
			});

			/**
			 * Runs a recipe against the sequence open in the timeline (the root when none is open), so an
			 * edit made inside a template instance changes that sequence and stays one undo entry.
			 */
			function scoped(recipe: ProjectRecipe): ProjectRecipe {
				return (project) => applyToSequence(project, get().activeSequenceId, recipe);
			}

			function mutateProject(
				label: string,
				recipe: ProjectRecipe | null,
				options: {
					target?: Project;
					initial?: Project;
					activate?: boolean;
					dirty?: boolean;
					history?: HistoryPolicy;
					mergeKey?: string;
					coalesceWindowMs?: number;
					resetHistory?: boolean;
					updateKeyframeSelection?: (
						selection: { clipId: ClipId; propertyId: PropertyId; time: Time }[]
					) => { clipId: ClipId; propertyId: PropertyId; time: Time }[];
				} = {}
			): Project | null {
				const current = options.target ?? get().project ?? options.initial;
				const switchingProject = options.activate === true && current?.id !== get().project?.id;
				if (options.resetHistory || recipe === null || switchingProject) {
					const history = projectHistory.snapshot();
					if (history.canUndo || history.canRedo) {
						const reason = switchingProject
							? 'the active project changed'
							: recipe === null
								? 'the project closed'
								: 'a new project session started';
						set((state) => {
							state.historyMessage = `Undo history cleared because ${reason}.`;
						});
					}
					projectHistory.clear();
				}
				if (recipe === null) {
					if (!current) return null;
					set((state) => {
						state.project = null;
						state.projectName = 'Untitled Project';
						state.projectNameDraft = 'Untitled Project';
						state.isRenaming = false;
						state.saveStatus = 'saved';
						state.timeline = createTimelineState();
					});
					return null;
				}

				if (!current) {
					throw new Error('Open a project before changing project data.');
				}
				const selectionBefore = [...get().timeline.selection.clipIds];
				const keyframeSelectionBefore = [...get().keyframes.selection];
				const activeSequenceBefore = get().activeSequenceId;
				const [updated, patches, inversePatches] = produceWithPatches(current, () => {
					return normalizeProjectTransitions(recipe(current));
				});
				const dirty = options.dirty ?? true;
				const shouldActivate = options.activate ?? get().project?.id === current.id;
				if (shouldActivate) {
					const project = dirty ? { ...updated, updatedAt: new Date().toISOString() } : updated;
					set((state) => {
						const switchedProject = state.project?.id !== project.id;
						state.project = project;
						state.projectName = project.name;
						state.projectNameDraft = project.name;
						state.revision += dirty ? 1 : 0;
						if (dirty) state.saveStatus = 'unsaved';
						if (switchedProject) {
							state.timeline = createTimelineState();
							state.keyframes = createKeyframeState();
							state.effectsUi.selectedEffectId = null;
						} else {
							const clipsMap = new Map<ClipId, Clip>();
							const activeSeqId = state.activeSequenceId;
							const activeProj = viewProject(project, activeSeqId);
							for (const track of activeProj.tracks) {
								for (const clip of track.clips) {
									clipsMap.set(clip.id, clip);
								}
							}
							state.timeline.selection.clipIds = state.timeline.selection.clipIds.filter((id) =>
								clipsMap.has(id)
							);
							if (
								state.timeline.selection.trackId &&
								!activeProj.tracks.some((track) => track.id === state.timeline.selection.trackId)
							) {
								delete state.timeline.selection.trackId;
							}
							if (options.updateKeyframeSelection) {
								state.keyframes.selection = options.updateKeyframeSelection(
									state.keyframes.selection
								);
							}
							state.keyframes.selection = state.keyframes.selection.filter((ref) => {
								const clip = clipsMap.get(ref.clipId);
								if (!clip) return false;
								const curve = propertyCurve(clip, ref.propertyId);
								return (
									curve && isAnimated(curve) && curve.keyframes.some((k) => k.time === ref.time)
								);
							});
						}
					});
					if (dirty && options.history !== 'skip' && patches.length > 0) {
						const state = get();
						projectHistory.record({
							id: `${current.id}:${state.revision}`,
							label,
							...(options.mergeKey ? { mergeKey: options.mergeKey } : {}),
							...(options.coalesceWindowMs ? { coalesceWindowMs: options.coalesceWindowMs } : {}),
							timestamp: Date.now(),
							patches,
							inversePatches,
							selectionBefore,
							selectionAfter: [...state.timeline.selection.clipIds],
							keyframeSelectionBefore,
							keyframeSelectionAfter: [...state.keyframes.selection],
							activeSequenceIdBefore: activeSequenceBefore,
							activeSequenceIdAfter: state.activeSequenceId
						});
					}
					return get().project;
				}
				if (!dirty) return updated;
				const changed = { ...updated, updatedAt: new Date().toISOString() };
				set((state) => {
					state.revision += 1;
					state.saveStatus = 'unsaved';
				});
				return changed;
			}

			function historyActionBlocked(): boolean {
				const state = get();
				if (
					state.timeline.drag ||
					state.isProjectManagerOpen ||
					state.isNewProjectDialogOpen ||
					state.isSaveCopyPromptOpen ||
					state.recovery
				) {
					return true;
				}
				return (
					typeof document !== 'undefined' &&
					document.querySelector('dialog[open], [role="dialog"]') !== null
				);
			}

			function restoreHistorySelection(
				ids: readonly ClipId[],
				keyframeRefs: readonly HistoryKeyframeRef[] | undefined,
				project: Project
			): void {
				const activeProj = viewProject(project, get().activeSequenceId);
				const clipsMap = new Map<ClipId, Clip>();
				for (const track of activeProj.tracks) {
					for (const clip of track.clips) {
						clipsMap.set(clip.id, clip);
					}
				}
				const tracks = new Set(activeProj.tracks.map((track) => track.id));
				set((state) => {
					state.timeline.selection.clipIds = ids.filter((id) => clipsMap.has(id));
					if (state.timeline.selection.trackId && !tracks.has(state.timeline.selection.trackId)) {
						delete state.timeline.selection.trackId;
					}
					if (keyframeRefs) {
						state.keyframes.selection = keyframeRefs.filter((ref) => {
							const clip = clipsMap.get(ref.clipId);
							if (!clip) return false;
							const curve = propertyCurve(clip, ref.propertyId);
							return curve && isAnimated(curve) && curve.keyframes.some((k) => k.time === ref.time);
						});
					}
					state.timeline.playhead = Math.min(state.timeline.playhead, timelineDuration(project));
				});
			}

			async function refreshProjects(): Promise<void> {
				try {
					const projects = await listProjects();
					set((state) => {
						state.projects = projects;
					});
				} catch (error) {
					set((state) => {
						state.projectMessage = `Could not list saved projects: ${errorMessage(error)}`;
					});
				}
			}

			async function collectProjectGarbage(project: Project): Promise<void> {
				if (isProjectExportActive(project.id)) return;
				const report = await collectMediaGarbage(project);
				const removedCount = report.removedFiles.length + report.removedCacheAssetIds.length;
				if (removedCount > 0 || report.foreignFiles.length > 0) {
					const details = [
						removedCount > 0 ? `Removed ${removedCount} unreferenced media item(s).` : '',
						report.foreignFiles.length > 0
							? `Kept ${report.foreignFiles.length} unrecognized file(s) for safety.`
							: ''
					]
						.filter(Boolean)
						.join(' ');
					set((state) => {
						state.projectMessage = details;
					});
				}
			}

			async function rememberStorageAvailability(projectId: ProjectId): Promise<void> {
				try {
					const directory = await ensureProjectDir(projectId);
					if (!directory) {
						set((state) => {
							state.projectMessage =
								'Project data is saved in this browser, but persistent media storage is unavailable. Media import requires OPFS support.';
						});
					}
				} catch (error) {
					set((state) => {
						state.projectMessage = `Project folder could not be prepared: ${errorMessage(error)}`;
					});
				}
			}

			function cancelMediaWork(projectId?: ProjectId): void {
				for (const [jobId, entry] of importControllers) {
					if (!projectId || entry.projectId === projectId) {
						entry.controller.abort();
						importControllers.delete(jobId);
					}
				}
				for (const [assetId, entry] of derivedControllers) {
					if (!projectId || entry.projectId === projectId) {
						entry.controller.abort();
						derivedControllers.delete(assetId);
					}
				}
			}

			async function reconcileProject(project: Project): Promise<Project> {
				let reconciled: Project;
				if (!isOpfsSupported()) {
					set((state) => {
						state.projectMessage =
							'Persistent media storage is unavailable in this browser. Media assets are marked offline.';
					});
					const assets = Object.fromEntries(
						Object.values(project.assets).map((asset) => [asset.id, { ...asset, offline: true }])
					) as Project['assets'];
					reconciled = { ...project, assets };
				} else {
					const result = await reconcileProjectMedia(project);
					if (result.unknownFiles.length > 0) {
						set((state) => {
							state.projectMessage = `Found ${result.unknownFiles.length} untracked file(s) in this project's media folder. They were preserved.`;
						});
					}
					reconciled = result.changed ? { ...project, assets: result.assets } : project;
				}
				const audioRepair = await repairProjectAudioMetadata(reconciled);
				if (audioRepair.warnings.length > 0) {
					set((state) => {
						state.projectMessage = audioRepair.warnings.join(' ');
					});
				}
				return audioRepair.project;
			}

			function scheduleDerived(projectId: ProjectId, asset: Asset): void {
				if (asset.offline) return;
				if (asset.kind === 'lut') {
					void ensureLutLoaded(projectId, asset);
					return;
				}
				derivedControllers.get(asset.id)?.controller.abort();
				const controller = new AbortController();
				derivedControllers.set(asset.id, { projectId, controller });
				set((state) => {
					state.media.derivedStatus[asset.id] = 'queued';
				});
				void generateDerived(projectId, asset, {
					signal: controller.signal,
					onStatus(status) {
						set((state) => {
							state.media.derivedStatus[asset.id] = status;
						});
					}
				})
					.catch((error: unknown) => {
						if (!(error instanceof DOMException && error.name === 'AbortError')) {
							set((state) => {
								state.media.derivedStatus[asset.id] = 'failed';
								state.projectMessage = `Could not generate previews for ${asset.name}: ${errorMessage(error)}`;
							});
						}
					})
					.finally(() => {
						if (derivedControllers.get(asset.id)?.controller === controller) {
							derivedControllers.delete(asset.id);
						}
					});
			}

			return {
				theme: 'dark',
				themeMessage: '',
				mediaWidth: 264,
				inspectorWidth: 256,
				timelineHeight: 360,
				projectName: 'Untitled Project',
				projectNameDraft: 'Untitled Project',
				isRenaming: false,
				isFileMenuOpen: false,
				projectMessage: '',
				project: null,
				revision: 0,
				projects: [],
				saveStatus: 'saved',
				history: EMPTY_HISTORY,
				historyMessage: '',
				isInitialized: false,
				isProjectManagerOpen: true,
				isNewProjectDialogOpen: false,
				isSaveCopyPromptOpen: false,
				saveCopyPromptShown: false,
				isExportDialogOpen: false,
				isExportClosePromptOpen: false,
				isExporting: false,
				exportCompletedResult: null,
				isImportDialogOpen: false,
				isSpeedDialogOpen: false,
				speedDialogClipId: null,
				isSequenceSettingsDialogOpen: false,
				sequenceSettingsDialogId: null,
				selectedMarkerId: null,
				selectedMarkerIds: [],
				isMarkerDialogOpen: false,
				editingMarkerId: null,
				proxySuggestion: null,
				recovery: null,
				media: {
					importQueue: [],
					derivedStatus: {},
					viewMode: 'list',
					search: '',
					selectedAssetIds: []
				},
				timeline: createTimelineState(),
				inspector: loadInspectorPrefs(),
				keyframes: createKeyframeState(),
				effectsUi: {
					libraryQuery: '',
					selectedEffectId: null
				},
				scopes: {
					open: false,
					mode: 'waveform',
					channel: 'luma'
				},
				colorUi: {
					activeTab: 'basic'
				},
				maskTool: {
					activeTool: 'select',
					selectedMaskId: null,
					selectedPointIndex: null,
					selectedPoints: [],
					showOverlay: true,
					blockedMessage: null
				},
				isMixerOpen: false,
				effectsClipboard: null,
				activeSequenceId: ROOT_SEQUENCE_ID,
				sequencePlayheads: {},
				...(() => {
					const loaded = loadUserWorkspaceState();
					const activeId = loaded.activeWorkspaceId || 'editing';
					const resolved = resolveWorkspaceLayout(activeId, loaded);
					return {
						workspaces: loaded,
						activeWorkspaceId: activeId,
						activeLayout: resolved.layout
					};
				})(),
				maximizedPanelId: null,
				workspaceMessage: '',
				ai: {
					silenceOptions: structuredClone(DEFAULT_SILENCE_OPTIONS),
					detectedSilences: [],
					cachedFeatures: null,
					cachedTrackKey: null,
					isAnalyzingSilence: false,
					analysisProgress: 0,
					virtualPreview: false
				},
				async initialize() {
					if (get().isInitialized) return;
					set((state) => {
						state.isInitialized = true;
					});
					const loadedWorkspaces = loadUserWorkspaceState();
					// If no editing override exists but old panel sizes are present, migrate them
					if (!loadedWorkspaces.overrides['editing']) {
						const currentMediaW = get().mediaWidth;
						const currentInspW = get().inspectorWidth;
						const currentTimeH = get().timelineHeight;
						if (currentMediaW !== 264 || currentInspW !== 256 || currentTimeH !== 360) {
							loadedWorkspaces.overrides['editing'] = migrateOldPanelSizes({
								mediaWidth: currentMediaW,
								inspectorWidth: currentInspW,
								timelineHeight: currentTimeH
							});
							persistUserWorkspaceState(loadedWorkspaces);
						}
					}
					const activeId = loadedWorkspaces.activeWorkspaceId || 'editing';
					const resolved = resolveWorkspaceLayout(activeId, loadedWorkspaces);
					set((state) => {
						state.workspaces = loadedWorkspaces;
						state.activeWorkspaceId = activeId;
						state.activeLayout = resolved.layout;
					});
					const theme = initializeTheme();
					set((state) => {
						state.theme = theme.mode;
						state.themeMessage = theme.persistenceAvailable
							? ''
							: 'Theme preference could not be read.';
					});

					// Pre-warm fonts so canvas rendering doesn't drop to fallback on page refresh
					void loadSavedCustomFonts().catch(() => {});
					for (const font of BUNDLED_FONTS) {
						void ensureFontLoaded(font.family).catch(() => {});
					}

					try {
						const projects = await listProjects();
						set((state) => {
							state.projects = projects;
						});
						const lastOpenedId = await getLastOpenedId();
						if (!lastOpenedId) {
							set((state) => {
								state.isProjectManagerOpen = true;
							});
							return;
						}

						try {
							const project = await getProject(lastOpenedId);
							if (!project) {
								await setLastOpenedId(null);
								set((state) => {
									state.isProjectManagerOpen = true;
								});
								return;
							}
							await collectProjectGarbage(project);
							const reconciled = await reconcileProject(project);
							mutateProject('Open last project', () => reconciled, {
								target: reconciled,
								activate: true,
								dirty: reconciled !== project,
								history: 'skip',
								resetHistory: true
							});
							for (const asset of Object.values(reconciled.assets))
								scheduleDerived(reconciled.id, asset);
							set((state) => {
								state.isProjectManagerOpen = false;
							});
						} catch (error) {
							if (!(error instanceof CorruptProjectError)) throw error;
							mutateProject('Recover corrupt project', null);
							set((state) => {
								state.recovery = {
									projectId: error.projectId,
									rawJson: error.rawJson,
									message: error.message
								};
								state.isProjectManagerOpen = false;
							});
						}
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not load saved projects: ${errorMessage(error)}`;
							state.isProjectManagerOpen = true;
						});
					}
				},
				toggleTheme() {
					const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
					const saved = applyTheme(nextTheme);
					set((state) => {
						state.theme = nextTheme;
						state.themeMessage = saved
							? `${nextTheme === 'dark' ? 'Dark' : 'Light'} theme enabled.`
							: 'Theme changed, but this browser could not save the preference.';
					});
				},
				beginRename() {
					if (!get().project) return;
					set((state) => {
						state.projectNameDraft = state.projectName;
						state.projectMessage = '';
						state.isRenaming = true;
					});
				},
				cancelRename() {
					set((state) => {
						state.projectNameDraft = state.projectName;
						state.projectMessage = '';
						state.isRenaming = false;
					});
				},
				toggleFileMenu() {
					set((state) => {
						state.isFileMenuOpen = !state.isFileMenuOpen;
					});
				},
				closeFileMenu() {
					set((state) => {
						state.isFileMenuOpen = false;
					});
				},
				setProjectNameDraft(value) {
					set((state) => {
						state.projectNameDraft = value;
						state.projectMessage = '';
					});
				},
				saveProjectName() {
					get().renameProject(get().projectNameDraft);
				},
				renameProject(name) {
					const parsed = projectNameSchema.safeParse(name);
					if (!parsed.success) {
						set((state) => {
							state.projectMessage =
								parsed.error.issues[0]?.message ?? 'Enter a valid project name.';
						});
						return;
					}
					if (!get().project) {
						set((state) => {
							state.projectMessage = 'Open a project before renaming it.';
						});
						return;
					}

					mutateProject('Rename project', (project) => ({ ...project, name: parsed.data }), {
						history: 'record',
						mergeKey: 'project-name'
					});
					set((state) => {
						state.projectMessage = `Project renamed to “${parsed.data}”.`;
						state.isRenaming = false;
					});
				},
				async renameSavedProject(id, name) {
					const parsed = projectNameSchema.safeParse(name);
					if (!parsed.success) {
						set((state) => {
							state.projectMessage =
								parsed.error.issues[0]?.message ?? 'Enter a valid project name.';
						});
						return false;
					}
					try {
						const project = get().project?.id === id ? get().project : await getProject(id);
						if (!project) throw new Error('This project no longer exists.');
						const updated = mutateProject(
							'Rename saved project',
							(current) => ({ ...current, name: parsed.data }),
							{
								target: project,
								activate: get().project?.id === id,
								history: get().project?.id === id ? 'record' : 'skip',
								mergeKey: 'project-name'
							}
						);
						if (updated) await saveProjectRecord(projectSchema.parse(updated));
						await refreshProjects();
						set((state) => {
							state.projectMessage = `Project renamed to “${parsed.data}”.`;
						});
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not rename project: ${errorMessage(error)}`;
						});
						return false;
					}
				},
				resizePanel(handle, delta) {
					const limits = PANEL_LIMITS[handle];
					set((state) => {
						if (handle === 'media') {
							state.mediaWidth = clampPanelSize(state.mediaWidth + delta, limits.min, limits.max);
						} else if (handle === 'inspector') {
							state.inspectorWidth = clampPanelSize(
								state.inspectorWidth + delta,
								limits.min,
								limits.max
							);
						} else {
							state.timelineHeight = clampPanelSize(
								state.timelineHeight + delta,
								limits.min,
								limits.max
							);
						}
					});
				},
				async createProject(options) {
					if (
						deferForActiveExport(get().project, async () => {
							await get().createProject(options);
						})
					)
						return;
					const name = projectNameSchema.safeParse(options.name);
					if (!name.success) {
						set((state) => {
							state.projectMessage = name.error.issues[0]?.message ?? 'Enter a valid project name.';
						});
						return;
					}
					try {
						const project = projectSchema.parse(
							createEmptyProject({ name: name.data, settings: options.settings })
						);
						await rememberStorageAvailability(project.id);
						await setLastOpenedId(project.id);
						mutateProject('Create project', () => project, {
							initial: project,
							activate: true,
							history: 'skip',
							resetHistory: true
						});
						set((state) => {
							state.isProjectManagerOpen = false;
							state.isNewProjectDialogOpen = false;
							state.recovery = null;
						});
						trackProjectCreate('editor_store', {
							fps: options.settings?.fps,
							resolution: options.settings
								? `${options.settings.width}x${options.settings.height}`
								: undefined
						});
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not create project: ${errorMessage(error)}`;
						});
					}
				},
				async openProject(id) {
					const activeProject = get().project;
					if (
						activeProject?.id !== id &&
						deferForActiveExport(activeProject, async () => {
							await get().openProject(id);
						})
					)
						return;
					set((state) => {
						state.projectMessage = '';
					});
					try {
						const loadedProject = await getProject(id);
						if (!loadedProject) throw new Error('This project no longer exists.');
						cancelMediaWork();
						const activeProject = get().project;
						if (activeProject && activeProject.id !== loadedProject.id) {
							await collectProjectGarbage(activeProject);
						}
						await collectProjectGarbage(loadedProject);
						const project = await reconcileProject(loadedProject);
						await setLastOpenedId(id);
						mutateProject('Open project', () => project, {
							target: project,
							activate: true,
							dirty: project !== loadedProject,
							history: 'skip',
							resetHistory: true
						});
						for (const asset of Object.values(project.assets)) scheduleDerived(project.id, asset);
						set((state) => {
							state.isProjectManagerOpen = false;
							state.recovery = null;
							state.saveStatus = 'saved';
						});
					} catch (error) {
						if (error instanceof CorruptProjectError) {
							set((state) => {
								state.recovery = {
									projectId: error.projectId,
									rawJson: error.rawJson,
									message: error.message
								};
								state.isProjectManagerOpen = false;
							});
							return;
						}
						set((state) => {
							state.projectMessage = `Could not open project: ${errorMessage(error)}`;
						});
					}
				},
				async closeProject() {
					const project = get().project;
					if (!project) return;
					if (
						deferForActiveExport(project, async () => {
							await get().closeProject();
						})
					)
						return;
					set((state) => {
						state.projectMessage = '';
					});
					try {
						await collectProjectGarbage(project);
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not clean unused media before closing: ${errorMessage(error)}`;
						});
						return;
					}
					cancelMediaWork(project.id);
					mutateProject('Close project', null, { history: 'skip', resetHistory: true });
					set((state) => {
						state.media.importQueue = [];
						state.media.derivedStatus = {};
						state.media.selectedAssetIds = [];
					});
					try {
						await setLastOpenedId(null);
						await refreshProjects();
						set((state) => {
							state.isProjectManagerOpen = true;
						});
					} catch (error) {
						set((state) => {
							state.isProjectManagerOpen = true;
							state.projectMessage = `Project closed, but its last-opened state could not be cleared: ${errorMessage(error)}`;
						});
					}
				},
				async duplicateProject(id) {
					if (
						deferForActiveExport(get().project, async () => {
							await get().duplicateProject(id);
						})
					)
						return;
					try {
						const source = get().project?.id === id ? get().project : await getProject(id);
						if (!source) throw new Error('This project no longer exists.');
						const duplicate = await copyProjectMedia(
							source,
							projectSchema.parse(duplicateProjectData(source))
						);
						await rememberStorageAvailability(duplicate.id);
						await setLastOpenedId(duplicate.id);
						mutateProject('Duplicate project', () => duplicate, {
							initial: duplicate,
							activate: true,
							history: 'skip',
							resetHistory: true
						});
						for (const asset of Object.values(duplicate.assets)) {
							scheduleDerived(duplicate.id, asset);
						}
						set((state) => {
							state.isProjectManagerOpen = false;
						});
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not duplicate project: ${errorMessage(error)}`;
						});
					}
				},
				async deleteProject(id) {
					if (
						deferForActiveExport(get().project?.id === id ? get().project : null, async () => {
							await get().deleteProject(id);
						})
					)
						return false;
					try {
						cancelMediaWork(id);
						await deleteProjectDir(id);
						await deleteProjectDerived(id);
						await deleteProjectRecord(id);
						if (get().project?.id === id) {
							mutateProject('Delete active project', null, {
								history: 'skip',
								resetHistory: true
							});
						}
						await refreshProjects();
						set((state) => {
							state.recovery = state.recovery?.projectId === id ? null : state.recovery;
							state.isProjectManagerOpen = !state.project;
							state.projectMessage = '';
							state.media.importQueue = state.media.importQueue.filter(
								(job) => job.projectId !== id
							);
						});
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not delete project: ${errorMessage(error)}`;
						});
						return false;
					}
				},
				async refreshProjects() {
					await refreshProjects();
				},
				async repairAudioMetadata() {
					const project = get().project;
					if (!project) return { project: null, warnings: [] };
					const result = await repairProjectAudioMetadata(project);
					if (result.project !== project) {
						mutateProject('Repair audio metadata', () => result.project, {
							target: project,
							dirty: true,
							history: 'skip'
						});
					}
					if (result.warnings.length > 0) {
						set((state) => {
							state.projectMessage = result.warnings.join(' ');
						});
					}
					return { project: get().project, warnings: result.warnings };
				},
				async replaceProject(rawProject) {
					if (
						deferForActiveExport(get().project, async () => {
							await get().replaceProject(rawProject);
						})
					)
						return false;
					set((state) => {
						state.projectMessage = '';
					});
					try {
						let project = migrate(rawProject);
						const existing = await getProject(project.id);
						if (existing) {
							const originalName = project.name;
							project = { ...duplicateProjectData(project), name: originalName };
						}
						cancelMediaWork();
						const activeProject = get().project;
						if (activeProject) await collectProjectGarbage(activeProject);
						await collectProjectGarbage(project);
						project = await reconcileProject(project);
						await rememberStorageAvailability(project.id);
						await setLastOpenedId(project.id);
						mutateProject('Replace current project', () => project, {
							initial: project,
							activate: true,
							history: 'skip',
							resetHistory: true
						});
						set((state) => {
							state.isProjectManagerOpen = false;
							state.isNewProjectDialogOpen = false;
						});
						for (const asset of Object.values(project.assets)) scheduleDerived(project.id, asset);
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not open project file: ${errorMessage(error)}`;
						});
						return false;
					}
				},
				async importMedia(files) {
					const project = get().project;
					if (!project) {
						set((state) => {
							state.projectMessage = 'Create or open a project before importing media.';
						});
						return null;
					}
					if (files.length === 0) return { imported: [], failed: [] };
					const jobs = files.map((file) => ({
						id: createAssetId(),
						projectId: project.id,
						name: file.name,
						file,
						status: 'queued' as const,
						progress: 0
					}));
					const controllers = jobs.map(() => new AbortController());
					for (const [index, job] of jobs.entries()) {
						const controller = controllers[index];
						if (controller) {
							importControllers.set(job.id, { projectId: project.id, controller });
						}
					}
					set((state) => {
						state.media.importQueue = [...state.media.importQueue, ...jobs];
						state.projectMessage = '';
					});
					try {
						const result = await runMediaImport(files, {
							projectId: project.id,
							fps: project.settings.fps,
							signalForFile: (index) => controllers[index]?.signal,
							mutateProject(label, recipe) {
								if (get().project?.id !== project.id) {
									throw new Error('The active project changed before media import completed.');
								}
								mutateProject(label, recipe, { history: 'record' });
							},
							onProgress(progress: ImportProgress) {
								const job = jobs[progress.index];
								if (!job) return;
								set((state) => {
									const current = state.media.importQueue.find((entry) => entry.id === job.id);
									if (!current) return;
									current.status = progress.phase;
									current.progress =
										progress.total > 0
											? Math.min(100, (progress.loaded / progress.total) * 100)
											: 100;
									if (progress.reason) current.reason = progress.reason;
								});
							},
							scheduleDerived(asset) {
								scheduleDerived(project.id, asset);
							}
						});
						if (get().project?.id === project.id) {
							set((state) => {
								state.projectMessage =
									result.failed.length === 0
										? `Imported ${result.imported.length} media file(s).`
										: `Imported ${result.imported.length} file(s); ${result.failed.length} failed.`;
							});
							const activeProject = get().project;
							const autoMode = activeProject?.proxy?.auto ?? 'large';
							const proxiesEnabled = activeProject?.proxy?.enabled ?? false;
							for (const asset of result.imported) {
								if (asset.kind !== 'video' || asset.offline) continue;
								if (proxiesEnabled && shouldAutoGenerateProxy(asset, autoMode)) {
									get().createProxy(asset.id);
								} else if (!proxiesEnabled && autoMode !== 'off' && shouldSuggestProxy(asset)) {
									set((state) => {
										if (!state.proxySuggestion) {
											state.proxySuggestion = {
												assetId: asset.id,
												assetName: asset.name
											};
										}
									});
								}
							}
						}
						if (result.imported.length > 0) {
							const kinds = Array.from(new Set(result.imported.map((a) => a.kind)));
							trackMediaImport(result.imported.length, kinds);
						}
						return result;
					} catch (error) {
						const message = errorMessage(error);
						set((state) => {
							state.projectMessage = `Media import failed: ${message}`;
							for (const job of state.media.importQueue) {
								if (jobs.some((j) => j.id === job.id) && job.status !== 'done') {
									job.status = 'failed';
									job.reason = message;
								}
							}
						});
						return null;
					} finally {
						for (const job of jobs) importControllers.delete(job.id);
					}
				},
				cancelImport(jobId) {
					importControllers.get(jobId)?.controller.abort();
					set((state) => {
						const job = state.media.importQueue.find((entry) => entry.id === jobId);
						if (job && job.status !== 'done' && job.status !== 'failed') job.status = 'cancelled';
					});
				},
				async deleteAsset(assetId, options = {}) {
					const project = get().project;
					if (!project) return { deleted: false, usage: [] };
					try {
						const usage = getAssetUsage(project, assetId);
						if (usage.length > 0 && !options.force) return { deleted: false, usage };
						derivedControllers.get(assetId)?.controller.abort();
						derivedControllers.delete(assetId);
						mutateProject(
							'Delete media',
							(current) => removeProjectAsset(current, { assetId, force: options.force }),
							{ history: 'record' }
						);
						set((state) => {
							delete state.media.derivedStatus[assetId];
							state.media.selectedAssetIds = state.media.selectedAssetIds.filter(
								(id) => id !== assetId
							);
							state.media.importQueue = state.media.importQueue.filter(
								(job) => job.name !== project.assets[assetId]?.name
							);
						});
						return { deleted: true, usage };
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not delete media: ${errorMessage(error)}`;
						});
						return { deleted: false, usage: [] };
					}
				},
				renameAsset(assetId, name) {
					try {
						mutateProject(
							'Rename asset',
							(project) => renameProjectAsset(project, { assetId, name }),
							{ history: 'record', mergeKey: `asset-name:${assetId}` }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not rename media: ${errorMessage(error)}`;
						});
						return false;
					}
				},
				async relinkAsset(assetId, file, options = {}) {
					const project = get().project;
					const asset = project?.assets[assetId];
					if (!project || !asset) return { relinked: false };
					try {
						if (classifyMime(file.type, file.name) !== asset.kind) {
							throw new Error('Choose a file of the same media type to relink this asset.');
						}
						const metadata = await probeMedia(file, { fps: project.settings.fps });
						const differences: string[] = [];
						if (file.size !== asset.size) differences.push('file size differs');
						if (
							asset.kind !== 'image' &&
							ticksToSeconds(Math.abs(metadata.duration - asset.duration)) > 0.5
						) {
							differences.push('duration differs by more than 0.5 seconds');
						}
						if (differences.length > 0 && !options.acceptMismatch) {
							return {
								relinked: false,
								mismatch: `The selected file's ${differences.join(' and ')}. Relink anyway?`
							};
						}
						const reason = 'Relinking replaces the stored media file and cannot be undone safely.';
						const cleared = projectHistory.barrier(reason);
						if (cleared) {
							set((state) => {
								state.historyMessage = `History cleared — ${reason}`;
							});
						}
						const opfsPath = await writeMedia(project.id, assetId, file);
						if (asset.opfsPath !== opfsPath) await deleteMediaFile(project.id, asset);
						mutateProject(
							'Relink media',
							(current) =>
								relinkProjectAsset(current, {
									assetId,
									opfsPath,
									mimeType: file.type || asset.mimeType,
									size: file.size
								}),
							{ history: 'skip' }
						);
						await deleteDerived(project.id, assetId);
						if (asset.proxy) {
							await deleteProxyFile(project.id, assetId);
							mutateProject(
								'Mark proxy stale',
								(curr) => {
									const a = curr.assets[assetId];
									if (!a || !a.proxy) return curr;
									return {
										...curr,
										assets: {
											...curr.assets,
											[assetId]: {
												...a,
												proxy: {
													...a.proxy,
													status: 'stale'
												}
											}
										}
									};
								},
								{ history: 'skip' }
							);
							if (project.proxy?.enabled && project.proxy?.auto !== 'off') {
								get().createProxy(assetId);
							}
						}
						set((state) => {
							delete state.media.derivedStatus[assetId];
							state.projectMessage = `${asset.name} was relinked.`;
						});
						scheduleDerived(project.id, { ...asset, opfsPath, offline: false });
						return { relinked: true };
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not relink media: ${errorMessage(error)}`;
						});
						return { relinked: false };
					}
				},
				setMediaView(viewMode) {
					set((state) => {
						state.media.viewMode = viewMode;
					});
				},
				setMediaSearch(search) {
					set((state) => {
						state.media.search = search;
					});
				},
				selectAssets(assetIds) {
					set((state) => {
						state.media.selectedAssetIds = assetIds;
					});
				},
				generateAssetDerived(assetId) {
					const project = get().project;
					const asset = project?.assets[assetId];
					if (!project || !asset || asset.offline || derivedControllers.has(assetId)) return;
					scheduleDerived(project.id, asset);
				},
				openProjectManager() {
					void refreshProjects();
					set((state) => {
						state.isProjectManagerOpen = true;
						state.isFileMenuOpen = false;
					});
				},
				closeProjectManager() {
					if (!get().project) return;
					set((state) => {
						state.isProjectManagerOpen = false;
					});
				},
				openNewProjectDialog() {
					set((state) => {
						state.projectMessage = '';
						state.isProjectManagerOpen = false;
						state.isNewProjectDialogOpen = true;
						state.isFileMenuOpen = false;
					});
				},
				closeNewProjectDialog() {
					set((state) => {
						state.isNewProjectDialogOpen = false;
						state.isProjectManagerOpen = !state.project;
					});
				},
				openSaveCopyPrompt() {
					set((state) => {
						state.isSaveCopyPromptOpen = true;
						state.saveCopyPromptShown = true;
					});
				},
				closeSaveCopyPrompt() {
					set((state) => {
						state.isSaveCopyPromptOpen = false;
					});
				},
				openExportDialog() {
					set((state) => {
						state.isExportDialogOpen = true;
						state.isFileMenuOpen = false;
					});
				},
				closeExportDialog() {
					if (get().isExporting) return;
					set((state) => {
						state.isExportDialogOpen = false;
					});
				},
				openExportCompleteDialog(result) {
					set((state) => {
						state.isExporting = false;
						state.isExportDialogOpen = false;
						state.exportCompletedResult = result;
					});
				},
				closeExportCompleteDialog() {
					set((state) => {
						state.exportCompletedResult = null;
					});
				},
				openImportDialog() {
					set((state) => {
						state.isImportDialogOpen = true;
						state.isFileMenuOpen = false;
					});
				},
				closeImportDialog() {
					set((state) => {
						state.isImportDialogOpen = false;
					});
				},
				openSpeedDialog(clipId) {
					const targetId = clipId ?? get().timeline.selection.clipIds[0];
					if (!targetId) return;
					set((state) => {
						state.isSpeedDialogOpen = true;
						state.speedDialogClipId = targetId;
						state.isFileMenuOpen = false;
					});
				},
				closeSpeedDialog() {
					set((state) => {
						state.isSpeedDialogOpen = false;
						state.speedDialogClipId = null;
					});
				},
				setClipSpeed(clipIds, speedMultiplier, options) {
					const project = get().project;
					if (!project || clipIds.length === 0) return false;
					const allIds = new Set<ClipId>();
					for (const id of clipIds) {
						for (const member of groupOf(project, id)) {
							allIds.add(member.id);
						}
					}
					return Boolean(
						mutateProject('Change clip speed', (current) => {
							let updated = setConstantSpeed(current, Array.from(allIds), speedMultiplier, options);
							if (options?.maintainPitch !== undefined) {
								updated = {
									...updated,
									tracks: updated.tracks.map((track) => ({
										...track,
										clips: track.clips.map((clip) => {
											if (allIds.has(clip.id)) {
												return { ...clip, maintainPitch: options.maintainPitch };
											}
											return clip;
										})
									}))
								};
							}
							return updated;
						})
					);
				},
				reverseClips(clipIds) {
					const project = get().project;
					if (!project || clipIds.length === 0) return false;
					const allIds = new Set<ClipId>();
					for (const id of clipIds) {
						for (const member of groupOf(project, id)) {
							allIds.add(member.id);
						}
					}
					return Boolean(
						mutateProject('Reverse clip', (current) => {
							return {
								...current,
								tracks: current.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (allIds.has(clip.id)) {
											return reverseClip(clip);
										}
										return clip;
									})
								}))
							};
						})
					);
				},
				enableTimeRemap(clipId) {
					const project = get().project;
					if (!project) return false;
					const allIds = new Set<ClipId>(groupOf(project, clipId).map((m) => m.id));
					return Boolean(
						mutateProject('Enable time remapping', (current) => {
							return {
								...current,
								tracks: current.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (allIds.has(clip.id)) {
											return enableClipTimeRemap(clip);
										}
										return clip;
									})
								}))
							};
						})
					);
				},
				disableTimeRemap(clipId, mode = 'average') {
					const project = get().project;
					if (!project) return false;
					const allIds = new Set<ClipId>(groupOf(project, clipId).map((m) => m.id));
					return Boolean(
						mutateProject('Disable time remapping', (current) => {
							return {
								...current,
								tracks: current.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (allIds.has(clip.id)) {
											return disableClipTimeRemap(clip, mode);
										}
										return clip;
									})
								}))
							};
						})
					);
				},
				setClipTimeRemap(clipId, timeRemap) {
					return Boolean(
						mutateProject('Set time remapping curve', (current) => ({
							...current,
							tracks: current.tracks.map((track) => ({
								...track,
								clips: track.clips.map((clip) => {
									if (clip.id === clipId) {
										return { ...clip, timeRemap };
									}
									return clip;
								})
							}))
						}))
					);
				},
				addFreezeFrame(clipId, duration, options) {
					const playhead = get().timeline.playhead;
					return Boolean(
						mutateProject('Add freeze frame', (current) => {
							return addFreezeFrameOperation(current, clipId, playhead, duration, options);
						})
					);
				},
				freezeFrameToEnd(clipId) {
					const playhead = get().timeline.playhead;
					return Boolean(
						mutateProject('Freeze frame to end', (current) => {
							return freezeFrameToEndOperation(current, clipId, playhead);
						})
					);
				},
				setMaintainPitch(clipIds, maintainPitch) {
					const project = get().project;
					if (!project || clipIds.length === 0) return false;
					const allIds = new Set<ClipId>();
					for (const id of clipIds) {
						for (const member of groupOf(project, id)) {
							allIds.add(member.id);
						}
					}
					return Boolean(
						mutateProject('Toggle maintain pitch', (current) => {
							return {
								...current,
								tracks: current.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (allIds.has(clip.id)) {
											return { ...clip, maintainPitch };
										}
										return clip;
									})
								}))
							};
						})
					);
				},
				setExporting(exporting) {
					set((state) => {
						state.isExporting = exporting;
					});
				},
				async confirmCancelExportAndContinue() {
					const project = get().project;
					if (project) await cancelProjectExport(project.id);
					set((state) => {
						state.isExportClosePromptOpen = false;
						state.isExportDialogOpen = false;
					});
					const action = afterExportAction;
					afterExportAction = null;
					if (action) await action();
				},
				dismissExportClosePrompt() {
					afterExportAction = null;
					set((state) => {
						state.isExportClosePromptOpen = false;
					});
				},
				setProjectMessage(message) {
					set((state) => {
						state.projectMessage = message;
					});
				},
				setSaveStatus(status) {
					set((state) => {
						state.saveStatus = status;
					});
				},
				setAutosaveFlush(flush) {
					autosaveFlush = flush;
				},
				async flushSave() {
					if (!autosaveFlush) {
						throw new Error('Autosave is not ready yet. Try saving again in a moment.');
					}
					await autosaveFlush();
				},
				undo() {
					const project = get().project;
					if (!project || historyActionBlocked()) return false;
					const result = projectHistory.undo(project);
					if (!result) return false;
					const restored = { ...result.project, updatedAt: new Date().toISOString() };
					mutateProject(`Undo ${result.entry.label}`, () => restored, { history: 'skip' });

					// Restore active sequence
					const targetSeqId = (result.entry.activeSequenceIdBefore ??
						ROOT_SEQUENCE_ID) as SequenceId;
					const seqExists =
						isRootSequence(targetSeqId) || Boolean(restored.sequences?.[targetSeqId]);
					const finalSeqId = seqExists ? targetSeqId : ROOT_SEQUENCE_ID;
					if (get().activeSequenceId !== finalSeqId) {
						get().openSequence(finalSeqId);
					}

					restoreHistorySelection(
						result.entry.selectionBefore,
						result.entry.keyframeSelectionBefore,
						restored
					);
					set((state) => {
						state.historyMessage = `Undid ${result.entry.label}`;
					});
					return true;
				},
				redo() {
					const project = get().project;
					if (!project || historyActionBlocked()) return false;
					const result = projectHistory.redo(project);
					if (!result) return false;
					const restored = { ...result.project, updatedAt: new Date().toISOString() };
					mutateProject(`Redo ${result.entry.label}`, () => restored, { history: 'skip' });

					// Restore active sequence
					const targetSeqId = (result.entry.activeSequenceIdAfter ??
						ROOT_SEQUENCE_ID) as SequenceId;
					const seqExists =
						isRootSequence(targetSeqId) || Boolean(restored.sequences?.[targetSeqId]);
					const finalSeqId = seqExists ? targetSeqId : ROOT_SEQUENCE_ID;
					if (get().activeSequenceId !== finalSeqId) {
						get().openSequence(finalSeqId);
					}

					restoreHistorySelection(
						result.entry.selectionAfter,
						result.entry.keyframeSelectionAfter,
						restored
					);
					set((state) => {
						state.historyMessage = `Redid ${result.entry.label}`;
					});
					return true;
				},
				clearHistory(reason = '') {
					const discarded = reason
						? projectHistory.barrier(reason)
						: (projectHistory.clear(), false);
					if (discarded) {
						set((state) => {
							state.historyMessage = `History cleared — ${reason}`;
						});
					}
				},
				async deleteCorruptProject() {
					const recovery = get().recovery;
					if (!recovery) return;
					const deleted = await get().deleteProject(recovery.projectId);
					if (!deleted) return;
					set((state) => {
						state.recovery = null;
						state.isProjectManagerOpen = true;
					});
				},
				clearRecovery() {
					set((state) => {
						state.recovery = null;
						state.isProjectManagerOpen = true;
					});
				},
				setZoom(pixelsPerSecond, anchor) {
					if (!Number.isFinite(pixelsPerSecond)) return;
					const nextZoom = Math.max(8, Math.min(400, pixelsPerSecond));
					const current = get().timeline;
					const zoomAnchor = anchor ?? {
						time: current.playhead,
						pixel: Math.max(
							0,
							(current.playhead * current.pixelsPerSecond) / 1_000_000 - current.scrollLeft
						)
					};
					set((state) => {
						state.timeline.pixelsPerSecond = nextZoom;
						state.timeline.scrollLeft = Math.max(
							0,
							(zoomAnchor.time / 1_000_000) * nextZoom - zoomAnchor.pixel
						);
					});
				},
				zoomToFit(viewportWidth = 800) {
					const project = get().project;
					if (!project) return;
					const duration = Math.max(
						timelineDuration(project),
						framesToTicks(10, project.settings.fps)
					);
					const usableWidth = Math.max(100, viewportWidth - 180);
					get().setZoom(Math.max(8, Math.min(400, (usableWidth - 40) / (duration / 1_000_000))), {
						time: 0,
						pixel: 0
					});
					set((state) => {
						state.timeline.scrollLeft = 0;
					});
				},
				setScroll(scrollLeft, scrollTop) {
					set((state) => {
						state.timeline.scrollLeft = Math.max(0, scrollLeft);
						state.timeline.scrollTop = Math.max(0, scrollTop);
					});
				},
				setTimelineFollowing(following) {
					set((state) => {
						state.timeline.followPlayhead = following;
					});
				},
				setPlayhead(time) {
					const project = get().project;
					if (!project) return;
					set((state) => {
						state.timeline.playhead = snapToFrame(
							Math.max(0, Math.round(time)),
							project.settings.fps
						);
					});
				},
				selectClips(ids, mode = 'replace') {
					const project = get().project;
					if (!project) return;
					const activeProj = viewProject(project, get().activeSequenceId);
					const available = new Set(
						activeProj.tracks.flatMap((track) => track.clips.map((clip) => clip.id))
					);
					const validIds = ids.filter((id) => available.has(id));
					set((state) => {
						if (mode === 'replace') {
							state.timeline.selection.clipIds = [...new Set(validIds)];
							delete state.timeline.selection.gap;
							if (validIds.length === 1) {
								const parentTrack = activeProj.tracks.find((track) =>
									track.clips.some((clip) => clip.id === validIds[0])
								);
								if (parentTrack) {
									state.timeline.selection.trackId = parentTrack.id;
								}
							}
						} else if (mode === 'add') {
							state.timeline.selection.clipIds = [
								...new Set([...state.timeline.selection.clipIds, ...validIds])
							];
						} else {
							const selected = new Set(state.timeline.selection.clipIds);
							for (const id of validIds) {
								if (selected.has(id)) selected.delete(id);
								else selected.add(id);
							}
							state.timeline.selection.clipIds = [...selected];
						}
					});
				},
				selectTrack(trackId) {
					set((state) => {
						if (trackId) {
							state.timeline.selection.trackId = trackId;
						} else {
							delete state.timeline.selection.trackId;
						}
					});
				},
				selectGap(trackId, start, end) {
					set((state) => {
						state.timeline.selection = {
							clipIds: [],
							trackId,
							gap: { trackId, start, end }
						};
					});
				},
				clearSelection() {
					set((state) => {
						state.timeline.selection = { clipIds: [] };
					});
				},
				setTimelineMessage(message) {
					set((state) => {
						state.timeline.message = message;
					});
				},
				toggleSnap() {
					set((state) => {
						state.timeline.snapEnabled = !state.timeline.snapEnabled;
					});
				},
				setActiveTimelineTool(tool) {
					if (tool === 'type') {
						get().addTextClip();
						if (get().timeline.activeTool !== 'select') {
							set((state) => {
								state.timeline.activeTool = 'select';
								state.maskTool.activeTool = 'select';
							});
						}
						return;
					}
					set((state) => {
						state.timeline.activeTool = tool;
						if (tool === 'pen') {
							state.maskTool.activeTool = 'pen';
						} else if (tool === 'rect') {
							state.maskTool.activeTool = 'rect';
						} else if (tool === 'select') {
							state.maskTool.activeTool = 'select';
						}
					});
				},
				beginTimelineDrag(session) {
					set((state) => {
						state.timeline.drag = session;
						state.timeline.message = '';
					});
				},
				updateTimelineDrag(pointerTime, options = {}) {
					const drag = get().timeline.drag;
					const project = get().project;
					if (!drag || !project) return;
					const activeSeqId = get().activeSequenceId;
					const activeView = viewProject(project, activeSeqId);
					let targetTrackId =
						'targetTrackId' in options ? options.targetTrackId : drag.targetTrackId;
					const createTrackKind =
						'createTrackKind' in options ? options.createTrackKind : drag.createTrackKind;
					if (
						!createTrackKind &&
						targetTrackId &&
						!activeView.tracks.some((t) => t.id === targetTrackId)
					) {
						targetTrackId = undefined;
					}
					const unlink = options.unlink ?? drag.unlink;
					const snappedTime = snapToFrame(
						Math.max(0, Math.round(pointerTime)),
						project.settings.fps
					);
					try {
						let previewBase = activeView;
						if (createTrackKind) {
							previewBase = addTrackOperation(activeView, createTrackKind);
							const created = previewBase.tracks.find(
								(candidate) => !activeView.tracks.some((existing) => existing.id === candidate.id)
							);
							if (created) {
								targetTrackId = created.id;
							}
						}

						let previewProject = previewBase;
						if (drag.kind === 'asset' && drag.assetId && targetTrackId) {
							previewProject = addClipFromAssetOperation(previewBase, {
								assetId: drag.assetId,
								trackId: targetTrackId,
								start: snappedTime
							});
						} else if (
							(drag.kind === 'graphic-template' || drag.graphicTemplateId) &&
							drag.graphicTemplateId &&
							targetTrackId
						) {
							const template = resolveDragTemplate(drag);
							const picked = pickTemplateHostTrack(
								previewBase,
								snappedTime,
								template.duration,
								targetTrackId
							);
							previewBase = picked.view;
							targetTrackId = picked.trackId;
							const clip = createTemplateInstanceClip(
								template,
								snappedTime,
								template.id as SequenceId
							);
							previewProject = insertClip(previewBase, targetTrackId, clip);
						} else if (
							(drag.kind === 'shape' || drag.shapeConfig) &&
							drag.shapeConfig &&
							targetTrackId
						) {
							const clip = createShapeClip(snappedTime, 5_000_000, drag.shapeConfig);
							const targetTrack = previewBase.tracks.find((t) => t.id === targetTrackId);
							if (
								targetTrack &&
								targetTrack.clips.some(
									(c) => c.start < clip.start + clip.duration && c.start + c.duration > clip.start
								)
							) {
								const prevIds = new Set(previewBase.tracks.map((t) => t.id));
								previewBase = addTrackOperation(previewBase, 'video');
								const created = previewBase.tracks.find(
									(candidate) => !prevIds.has(candidate.id) && candidate.kind === 'video'
								);
								if (created) {
									targetTrackId = created.id;
								}
							}
							previewProject = insertClip(previewBase, targetTrackId, clip);
						} else if (drag.kind === 'move') {
							previewProject = moveClipsOperation(previewBase, {
								clipIds: drag.clipIds,
								deltaTime: snappedTime - drag.pointerStartTime,
								targetTrackId,
								unlink
							});
						} else if (drag.kind === 'slip' && drag.clipIds[0]) {
							const original = drag.original[0];
							if (original) {
								const delta = snappedTime - drag.pointerStartTime;
								const candidateIn = Math.max(0, original.sourceIn + delta);
								const candidateOut = candidateIn + original.duration;
								previewProject = {
									...previewBase,
									tracks: previewBase.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) =>
											c.id === drag.clipIds[0]
												? { ...c, sourceIn: candidateIn, sourceOut: candidateOut }
												: c
										)
									}))
								};
							}
						} else if (drag.clipIds[0]) {
							const original = drag.original[0];
							const baseTime =
								drag.kind === 'trim-start'
									? original?.start
									: original
										? original.start + original.duration
										: undefined;
							if (baseTime !== undefined) {
								previewProject = trimClipOperation(
									previewBase,
									drag.clipIds[0],
									drag.kind === 'trim-start' ? 'start' : 'end',
									baseTime + snappedTime - drag.pointerStartTime,
									unlink
								);
							}
						}
						const previewIds =
							drag.kind === 'asset' ||
							drag.kind === 'graphic-template' ||
							Boolean(drag.graphicTemplateId) ||
							drag.kind === 'shape' ||
							Boolean(drag.shapeConfig)
								? previewProject.tracks
										.flatMap((track) => track.clips)
										.filter(
											(clip) =>
												!activeView.tracks.some((track) =>
													track.clips.some((old) => old.id === clip.id)
												)
										)
										.map((clip) => clip.id)
								: drag.clipIds.flatMap((id) =>
										drag.unlink ? [id] : groupOf(activeView, id).map((clip) => clip.id)
									);
						set((state) => {
							if (!state.timeline.drag) return;
							state.timeline.drag.pointerTime = snappedTime;
							state.timeline.drag.targetTrackId = targetTrackId;
							state.timeline.drag.createTrackKind = createTrackKind;
							state.timeline.drag.unlink = unlink;
							state.timeline.drag.allowed = true;
							state.timeline.drag.snappedTo = options.snappedTo;
							state.timeline.drag.preview = projectClipPositions(
								previewProject,
								previewIds,
								activeSeqId
							);
							state.timeline.message = '';
						});
					} catch (error) {
						set((state) => {
							if (!state.timeline.drag) return;
							state.timeline.drag.pointerTime = snappedTime;
							state.timeline.drag.targetTrackId = targetTrackId;
							state.timeline.drag.createTrackKind = createTrackKind;
							state.timeline.drag.unlink = unlink;
							state.timeline.drag.allowed = false;
							delete state.timeline.drag.snappedTo;
							state.timeline.drag.preview = [];
							state.timeline.message = errorMessage(error);
						});
					}
				},
				cancelTimelineDrag() {
					set((state) => {
						state.timeline.drag = null;
					});
				},
				commitTimelineDrag() {
					const drag = get().timeline.drag;
					if (!drag || !drag.allowed) {
						if (drag) {
							set((state) => {
								state.timeline.drag = null;
							});
						}
						return false;
					}
					// If the user just clicked without dragging/moving/trimming, do not mutate or trigger autosave
					const delta = drag.pointerTime - drag.pointerStartTime;
					const originalAnchor = drag.original[0];
					const unchangedMove =
						drag.kind === 'move' &&
						delta === 0 &&
						!drag.createTrackKind &&
						(!drag.targetTrackId ||
							!originalAnchor ||
							drag.targetTrackId === originalAnchor.trackId);
					const unchangedTrimOrSlip =
						(drag.kind === 'trim-start' || drag.kind === 'trim-end' || drag.kind === 'slip') &&
						delta === 0;

					if (unchangedMove || unchangedTrimOrSlip) {
						set((state) => {
							state.timeline.drag = null;
						});
						return false;
					}

					if (drag.kind === 'graphic-template' || drag.graphicTemplateId) {
						// Same instantiation as "+ Add", so a dropped template is structurally identical.
						try {
							const template = resolveDragTemplate(drag);
							const activeSeqId = get().activeSequenceId;
							const previousClipIds = new Set(
								viewProject(get().project!, activeSeqId).tracks.flatMap((track) =>
									track.clips.map((clip) => clip.id)
								)
							);
							mutateProject(
								`Add template ${template.name}`,
								(project) => {
									let base = project;
									let targetTrackId = drag.targetTrackId;
									if (drag.createTrackKind) {
										const before = viewProject(base, activeSeqId);
										base = applyToSequence(base, activeSeqId, (view) =>
											addTrackOperation(view, drag.createTrackKind!)
										);
										targetTrackId = viewProject(base, activeSeqId).tracks.find(
											(track) => !before.tracks.some((existing) => existing.id === track.id)
										)?.id;
									}
									return instantiateTemplateIntoProject(
										base,
										activeSeqId,
										template,
										drag.pointerTime,
										targetTrackId
									).project;
								},
								{ history: 'record' }
							);
							const added = viewProject(get().project!, activeSeqId)
								.tracks.flatMap((track) => track.clips)
								.filter((clip) => !previousClipIds.has(clip.id))
								.map((clip) => clip.id);
							get().selectClips(added);
							projectHistory.updateSelectionAfter(added);
							set((state) => {
								state.timeline.drag = null;
								state.timeline.message = 'Timeline edit applied.';
							});
							return true;
						} catch (error) {
							set((state) => {
								state.timeline.drag = null;
								state.timeline.message = errorMessage(error);
							});
							return false;
						}
					}

					try {
						const activeSeqId = get().activeSequenceId;
						const activeViewBefore = viewProject(get().project!, activeSeqId);
						const previousClipIds = new Set(
							activeViewBefore.tracks.flatMap((track) => track.clips.map((clip) => clip.id))
						);
						mutateProject(
							drag.kind === 'asset'
								? 'Add clip'
								: drag.kind === 'shape' || drag.shapeConfig
									? 'Add shape'
									: drag.kind === 'move'
										? 'Move clips'
										: 'Trim clip',
							(project) =>
								applyToSequence(project, activeSeqId, (view) => {
									let currentView = view;
									let actualTargetTrackId = drag.targetTrackId;
									if (
										!drag.createTrackKind &&
										actualTargetTrackId &&
										!view.tracks.some((t) => t.id === actualTargetTrackId)
									) {
										actualTargetTrackId = undefined;
									}
									if (drag.createTrackKind) {
										currentView = addTrackOperation(view, drag.createTrackKind);
										const created = currentView.tracks.find(
											(candidate) => !view.tracks.some((existing) => existing.id === candidate.id)
										);
										if (created) {
											actualTargetTrackId = created.id;
										}
									}

									if (drag.kind === 'asset' && drag.assetId && actualTargetTrackId) {
										return addClipFromAssetOperation(currentView, {
											assetId: drag.assetId,
											trackId: actualTargetTrackId,
											start: drag.pointerTime
										});
									}
									if (
										(drag.kind === 'shape' || drag.shapeConfig) &&
										drag.shapeConfig &&
										actualTargetTrackId
									) {
										const clip = createShapeClip(drag.pointerTime, 5_000_000, drag.shapeConfig);
										let trackToUse = currentView.tracks.find((t) => t.id === actualTargetTrackId);
										if (
											!trackToUse ||
											trackToUse.clips.some(
												(c) =>
													c.start < clip.start + clip.duration && c.start + c.duration > clip.start
											)
										) {
											const prevIds = new Set(currentView.tracks.map((t) => t.id));
											currentView = addTrackOperation(currentView, 'video');
											trackToUse = currentView.tracks.find(
												(t) => !prevIds.has(t.id) && t.kind === 'video'
											);
										}
										return insertClip(currentView, trackToUse!.id, clip);
									}
									if (drag.kind === 'move') {
										return moveClipsOperation(currentView, {
											clipIds: drag.clipIds,
											deltaTime: drag.pointerTime - drag.pointerStartTime,
											targetTrackId: actualTargetTrackId,
											unlink: drag.unlink
										});
									}
									if (drag.kind === 'slip' && drag.clipIds[0]) {
										const original = drag.original[0];
										if (!original) return view;
										const delta = drag.pointerTime - drag.pointerStartTime;
										const candidateIn = Math.max(0, original.sourceIn + delta);
										const candidateOut = candidateIn + original.duration;
										return {
											...view,
											tracks: view.tracks.map((t) => ({
												...t,
												clips: t.clips.map((c) =>
													c.id === drag.clipIds[0]
														? { ...c, sourceIn: candidateIn, sourceOut: candidateOut }
														: c
												)
											}))
										};
									}
									const original = drag.original[0];
									const baseTime =
										drag.kind === 'trim-start'
											? original?.start
											: original
												? original.start + original.duration
												: undefined;
									if (!drag.clipIds[0] || baseTime === undefined) return view;
									return trimClipOperation(
										view,
										drag.clipIds[0],
										drag.kind === 'trim-start' ? 'start' : 'end',
										baseTime + drag.pointerTime - drag.pointerStartTime,
										drag.unlink
									);
								}),
							{ history: 'record' }
						);
						const committed = get().project;
						if (
							committed &&
							(drag.kind === 'asset' || drag.kind === 'shape' || Boolean(drag.shapeConfig))
						) {
							const activeViewAfter = viewProject(committed, activeSeqId);
							const added = activeViewAfter.tracks
								.flatMap((track) => track.clips)
								.filter((clip) => !previousClipIds.has(clip.id));
							get().selectClips(added.map((clip) => clip.id));
							projectHistory.updateSelectionAfter(added.map((clip) => clip.id));
						}
						set((state) => {
							state.timeline.drag = null;
							state.timeline.message = 'Timeline edit applied.';
						});
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.drag = null;
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				addAssetToTimeline(assetId, trackId, time) {
					try {
						const activeSeqId = get().activeSequenceId;
						const activeViewBefore = viewProject(get().project!, activeSeqId);
						const beforeIds = new Set(
							activeViewBefore.tracks.flatMap((track) => track.clips.map((clip) => clip.id))
						);
						mutateProject(
							'Add clip',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									addClipFromAssetOperation(view, {
										assetId,
										trackId,
										start: snapToFrame(time, project.settings.fps)
									})
								),
							{ history: 'record' }
						);
						const project = get().project;
						if (!project) return false;
						const activeViewAfter = viewProject(project, activeSeqId);
						const added = activeViewAfter.tracks.flatMap((track) =>
							track.clips.filter((clip) => !beforeIds.has(clip.id)).map((clip) => clip.id)
						);
						get().selectClips(added);
						projectHistory.updateSelectionAfter(added);
						set((state) => {
							state.timeline.message = 'Clip added to timeline.';
						});
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				addAssetOnNewTrack(assetId, kind, time) {
					try {
						const activeSeqId = get().activeSequenceId;
						const activeViewBefore = viewProject(get().project!, activeSeqId);
						const beforeIds = new Set(
							activeViewBefore.tracks.flatMap((track) => track.clips.map((clip) => clip.id))
						);
						mutateProject(
							`${kind === 'video' ? 'Add video' : 'Add audio'} track`,
							(project) =>
								applyToSequence(project, activeSeqId, (view) => {
									const asset = project.assets[assetId];
									if (!asset) throw new Error(`Media asset “${assetId}” does not exist.`);
									if (
										(kind === 'video' && asset.kind === 'audio') ||
										(kind === 'audio' && asset.kind !== 'audio')
									) {
										throw new Error('The media asset is not compatible with this track.');
									}
									const withTrack = addTrackOperation(view, kind);
									const track = withTrack.tracks.find(
										(candidate) => !view.tracks.some((existing) => existing.id === candidate.id)
									);
									if (!track) throw new Error('Could not create a timeline track.');
									return addClipFromAssetOperation(withTrack, {
										assetId,
										trackId: track.id,
										start: snapToFrame(time, project.settings.fps)
									});
								}),
							{ history: 'record' }
						);
						const project = get().project;
						if (project) {
							const activeViewAfter = viewProject(project, activeSeqId);
							const added = activeViewAfter.tracks.flatMap((track) =>
								track.clips.filter((clip) => !beforeIds.has(clip.id)).map((clip) => clip.id)
							);
							get().selectClips(added);
							projectHistory.updateSelectionAfter(added);
						}
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				moveClips(ids, deltaTime, targetTrackId, unlink = false) {
					try {
						const activeSeqId = get().activeSequenceId;
						mutateProject(
							'Move clips',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									moveClipsOperation(view, {
										clipIds: ids,
										deltaTime: snapToFrame(deltaTime, project.settings.fps),
										targetTrackId,
										unlink
									})
								),
							{ history: 'record', mergeKey: `move:${[...ids].toSorted().join(',')}` }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				trimClip(id, edge, time, unlink = false) {
					try {
						const activeSeqId = get().activeSequenceId;
						const isRipple = get().timeline.activeTool === 'ripple';
						mutateProject(
							isRipple ? 'Ripple trim clip' : 'Trim clip',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									isRipple
										? rippleTrimClip(
												view,
												id,
												edge,
												snapToFrame(time, project.settings.fps),
												unlink
											)
										: trimClipOperation(
												view,
												id,
												edge,
												snapToFrame(time, project.settings.fps),
												unlink
											)
								),
							{ history: 'record', mergeKey: `trim:${id}:${edge}` }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				splitClipAt(clipId, time, unlink = false) {
					const project = get().project;
					if (!project) return [];
					const activeSeqId = get().activeSequenceId;
					try {
						let splitResultIds: ClipId[] = [];
						mutateProject(
							'Split clip',
							(p) =>
								applyToSequence(p, activeSeqId, (view) => {
									const result = splitClipsAt(
										view,
										snapToFrame(time, project.settings.fps),
										[clipId],
										unlink
									);
									splitResultIds = result.splitClipIds;
									return result.project;
								}),
							{ history: 'record' }
						);
						if (splitResultIds.length > 0) {
							get().selectClips(splitResultIds);
							projectHistory.updateSelectionAfter(splitResultIds);
							set((state) => {
								state.timeline.message = 'Split clip.';
							});
						}
						return splitResultIds;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return [];
					}
				},
				splitAtPlayhead(unlink = false) {
					const project = get().project;
					if (!project) return false;
					const sel = get().timeline.selection;
					if (sel.clipIds.length === 0 && sel.captionId && sel.trackId) {
						return get().splitCaptionSegmentAt(sel.trackId, sel.captionId, get().timeline.playhead);
					}
					const activeSeqId = get().activeSequenceId;
					const activeView = viewProject(project, activeSeqId);
					const selection = sel.clipIds;
					const ids =
						selection.length > 0
							? selection
							: activeView.tracks
									.filter((track) => !track.locked)
									.flatMap((track) =>
										track.clips
											.filter(
												(clip) =>
													clip.start < get().timeline.playhead &&
													clip.start + clip.duration > get().timeline.playhead
											)
											.map((clip) => clip.id)
									);
					try {
						let splitResultIds: ClipId[] = [];
						mutateProject(
							'Split clip',
							(p) =>
								applyToSequence(p, activeSeqId, (view) => {
									const result = splitClipsAt(view, get().timeline.playhead, ids, unlink);
									splitResultIds = result.splitClipIds;
									return result.project;
								}),
							{ history: 'record' }
						);
						if (splitResultIds.length === 0) {
							set((state) => {
								state.timeline.message = 'No selected clips cross the playhead.';
							});
							return false;
						}
						get().selectClips(splitResultIds);
						projectHistory.updateSelectionAfter(splitResultIds);
						set((state) => {
							state.timeline.message = 'Split clip.';
						});
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				deleteSelection(unlink = false) {
					const sel = get().timeline.selection;
					if (sel.gap) {
						return get().rippleDeleteGap(sel.gap.trackId, sel.gap.start, sel.gap.end);
					}
					if (sel.clipIds.length === 0) {
						if (sel.captionId && sel.trackId) {
							return get().deleteCaptionSegment(sel.trackId, sel.captionId);
						}
						return false;
					}
					const ids = sel.clipIds;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Delete clips',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									deleteClipsOperation(view, ids, unlink)
								),
							{ history: 'record' }
						);
						get().clearSelection();
						set((state) => {
							state.timeline.message = 'Deleted selected clips.';
						});
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				rippleDeleteSelection() {
					const sel = get().timeline.selection;
					if (sel.gap) {
						return get().rippleDeleteGap(sel.gap.trackId, sel.gap.start, sel.gap.end);
					}
					const ids = sel.clipIds;
					if (ids.length === 0) return false;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Ripple delete',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									rippleDeleteClipsOperation(view, ids)
								),
							{ history: 'record' }
						);
						get().clearSelection();
						set((state) => {
							state.timeline.message = 'Ripple deleted selected clips.';
						});
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				rippleDeleteGap(trackId, start, end) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Ripple delete gap',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									rippleDeleteGapOperation(view, trackId, start, end)
								),
							{ history: 'record' }
						);
						get().clearSelection();
						set((state) => {
							state.timeline.message = 'Ripple deleted gap.';
							const curPlayhead = state.timeline.playhead;
							if (curPlayhead > start) {
								const gapDuration = end - start;
								if (curPlayhead <= end) {
									state.timeline.playhead = start;
								} else {
									state.timeline.playhead = Math.max(start, curPlayhead - gapDuration);
								}
							}
						});
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				duplicateSelection() {
					const ids = get().timeline.selection.clipIds;
					if (ids.length === 0) return false;
					const activeSeqId = get().activeSequenceId;
					try {
						const activeViewBefore = viewProject(get().project!, activeSeqId);
						const beforeIds = new Set(
							activeViewBefore.tracks.flatMap((track) => track.clips.map((clip) => clip.id))
						);
						mutateProject(
							'Duplicate clips',
							(project) =>
								applyToSequence(project, activeSeqId, (view) => duplicateClipsOperation(view, ids)),
							{ history: 'record' }
						);
						const project = get().project;
						if (project) {
							const activeViewAfter = viewProject(project, activeSeqId);
							const added = activeViewAfter.tracks.flatMap((track) =>
								track.clips.filter((clip) => !beforeIds.has(clip.id)).map((clip) => clip.id)
							);
							get().selectClips(added);
							projectHistory.updateSelectionAfter(added);
						}
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				addTimelineTrack(kind) {
					try {
						const activeSeqId = get().activeSequenceId;
						mutateProject(
							`Add ${kind} track`,
							(project) =>
								applyToSequence(project, activeSeqId, (view) => addTrackOperation(view, kind)),
							{ history: 'record' }
						);
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
					}
				},
				addCaptionTrack(name) {
					const project = get().project;
					if (!project) return null;
					try {
						const newTrack = createCaptionTrackOp(name ?? 'Captions', project.tracks);
						mutateProject(
							'Add caption track',
							(p) => ({
								...p,
								tracks: [newTrack, ...p.tracks]
							}),
							{ history: 'record' }
						);
						return newTrack.id;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},
				addCaptionSegment(trackId, segment) {
					const project = get().project;
					if (!project) return null;
					let createdId: string | null = null;
					try {
						mutateProject(
							'Add caption',
							(p) => {
								const trackIndex = p.tracks.findIndex((t) => t.id === trackId);
								if (trackIndex === -1) throw new Error('Caption track not found.');
								const track = { ...p.tracks[trackIndex]! };
								const added = addCaptionSegmentOp(track, segment);
								createdId = added.id;
								const tracks = [...p.tracks];
								tracks[trackIndex] = track;
								return { ...p, tracks };
							},
							{ history: 'record' }
						);
						return createdId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},
				addCaptionSegmentsBulk(segments, trackName = 'Auto Captions') {
					const project = get().project;
					if (!project || segments.length === 0) return null;
					let targetTrackId: TrackId | null = null;
					try {
						mutateProject(
							'Generate captions',
							(p) => {
								let existingTrackIndex = p.tracks.findIndex((t) => t.kind === 'caption');
								let updatedTracks = [...p.tracks];
								let targetTrack: Track;

								if (existingTrackIndex === -1) {
									targetTrack = createCaptionTrackOp(trackName, p.tracks);
									updatedTracks = [targetTrack, ...updatedTracks];
									existingTrackIndex = 0;
								} else {
									targetTrack = { ...p.tracks[existingTrackIndex]! };
								}

								for (const seg of segments) {
									addCaptionSegmentOp(targetTrack, seg);
								}

								targetTrackId = targetTrack.id;
								updatedTracks[existingTrackIndex] = targetTrack;
								return { ...p, tracks: updatedTracks };
							},
							{ history: 'record' }
						);
						return targetTrackId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},
				updateCaptionSegment(trackId, segmentId, updates) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Update caption',
							(p) => {
								const trackIndex = p.tracks.findIndex((t) => t.id === trackId);
								if (trackIndex === -1) throw new Error('Caption track not found.');
								const origTrack = p.tracks[trackIndex]!;
								const track = {
									...origTrack,
									captions: [...(origTrack.captions ?? [])]
								};
								const seg = track.captions.find((c) => c.id === segmentId);
								if (!seg) throw new Error('Caption segment not found.');

								if (updates.text !== undefined) {
									setCaptionTextOp(track, segmentId, updates.text);
								}
								if (updates.speaker !== undefined) {
									track.captions = track.captions.map((c) =>
										c.id === segmentId ? { ...c, speaker: updates.speaker } : c
									);
								}
								if (updates.start !== undefined || updates.end !== undefined) {
									const newStart = updates.start ?? seg.start;
									const newEnd = updates.end ?? seg.end;
									retimeCaptionSegmentOp(track, segmentId, newStart, newEnd);
								}
								const tracks = [...p.tracks];
								tracks[trackIndex] = track;
								return { ...p, tracks };
							},
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				deleteCaptionSegment(trackId, segmentId) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Delete caption',
							(p) => {
								const trackIndex = p.tracks.findIndex((t) => t.id === trackId);
								if (trackIndex === -1) throw new Error('Caption track not found.');
								const track = { ...p.tracks[trackIndex]! };
								deleteCaptionSegmentOp(track, segmentId);
								const tracks = [...p.tracks];
								tracks[trackIndex] = track;
								return { ...p, tracks };
							},
							{ history: 'record' }
						);
						set((state) => {
							if (state.timeline.selection.captionId === segmentId) {
								state.timeline.selection.captionId = undefined;
							}
						});
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				splitCaptionSegmentAt(trackId, segmentId, splitTime) {
					const project = get().project;
					if (!project) return false;
					const time = splitTime ?? get().timeline.playhead;
					try {
						let splitSuccess = false;
						mutateProject(
							'Split caption',
							(p) => {
								const trackIndex = p.tracks.findIndex((t) => t.id === trackId);
								if (trackIndex === -1) throw new Error('Caption track not found.');
								const track = { ...p.tracks[trackIndex]! };
								const res = splitCaptionSegmentOp(track, segmentId, time);
								splitSuccess = res !== null;
								const tracks = [...p.tracks];
								tracks[trackIndex] = track;
								return { ...p, tracks };
							},
							{ history: 'record' }
						);
						return splitSuccess;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				mergeCaptionSegmentsWith(trackId, firstId, secondId) {
					const project = get().project;
					if (!project) return false;
					try {
						let mergeSuccess = false;
						mutateProject(
							'Merge captions',
							(p) => {
								const trackIndex = p.tracks.findIndex((t) => t.id === trackId);
								if (trackIndex === -1) throw new Error('Caption track not found.');
								const track = { ...p.tracks[trackIndex]! };
								const res = mergeCaptionSegmentsOp(track, firstId, secondId);
								mergeSuccess = res !== null;
								const tracks = [...p.tracks];
								tracks[trackIndex] = track;
								return { ...p, tracks };
							},
							{ history: 'record' }
						);
						return mergeSuccess;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				setCaptionTrackStyle(trackId, style) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Update caption style',
							(p) => {
								const trackIndex = p.tracks.findIndex((t) => t.id === trackId);
								if (trackIndex === -1) throw new Error('Caption track not found.');
								const track = {
									...p.tracks[trackIndex]!,
									captionStyle: {
										...(p.tracks[trackIndex]!.captionStyle ?? DEFAULT_CAPTION_STYLE),
										...style
									}
								};
								const tracks = [...p.tracks];
								tracks[trackIndex] = track;
								return { ...p, tracks };
							},
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				importCaptionsToTrack(trackId, content, format = 'srt') {
					const project = get().project;
					if (!project) return false;
					try {
						const segments =
							format === 'vtt' || content.includes('WEBVTT')
								? parseVtt(content)
								: parseSrt(content);
						if (segments.length === 0) {
							throw new Error('No valid subtitle cues found in content.');
						}
						mutateProject(
							'Import captions',
							(p) => {
								const trackIndex = p.tracks.findIndex((t) => t.id === trackId);
								if (trackIndex === -1) throw new Error('Caption track not found.');
								const track = { ...p.tracks[trackIndex]!, captions: segments };
								const tracks = [...p.tracks];
								tracks[trackIndex] = track;
								return { ...p, tracks };
							},
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				exportCaptionsFromTrack(trackId, format = 'srt') {
					const project = get().project;
					if (!project) return '';
					const track = project.tracks.find((t) => t.id === trackId);
					if (!track || !track.captions) return '';
					return format === 'vtt' ? serializeVtt(track.captions) : serializeSrt(track.captions);
				},
				selectCaption(trackId, captionId) {
					set((state) => {
						if (captionId && trackId) {
							state.timeline.selection = {
								clipIds: [],
								trackId,
								captionId
							};
						} else {
							state.timeline.selection = {
								clipIds: [],
								trackId: trackId ?? undefined
							};
						}
					});
				},
				addCaptionAtPlayhead(text = 'New Caption', trackId?: TrackId) {
					const project = get().project;
					if (!project) return null;
					const playhead = get().timeline.playhead;
					const defaultDur = 2_000_000;

					const selTrackId =
						trackId ??
						get().timeline.selection.trackId ??
						(get().timeline.selection.captionId
							? project.tracks.find((t) =>
									(t.captions ?? []).some((c) => c.id === get().timeline.selection.captionId)
								)?.id
							: undefined);

					const captionTracks = project.tracks.filter((t) => t.kind === 'caption' && !t.locked);
					const hasCueOverlap = (t: Track) =>
						(t.captions ?? []).some((c) => c.start < playhead + defaultDur && c.end > playhead);

					let targetTrackId: TrackId | undefined = undefined;
					if (selTrackId) {
						const selTrack = captionTracks.find((t) => t.id === selTrackId);
						if (selTrack && !hasCueOverlap(selTrack)) {
							targetTrackId = selTrack.id;
						}
					}
					if (!targetTrackId) {
						const candidates = captionTracks.slice().reverse();
						const availableTrack = candidates.find((t) => !hasCueOverlap(t));
						if (availableTrack) {
							targetTrackId = availableTrack.id;
						} else {
							targetTrackId = get().addCaptionTrack() ?? undefined;
						}
					}
					if (!targetTrackId) return null;

					const track = get().project?.tracks.find((t) => t.id === targetTrackId);
					const captions = (track?.captions ?? []).slice().sort((a, b) => a.start - b.start);
					let start = playhead;

					// If playhead is inside an existing segment, place immediately after it
					const covering = captions.find((c) => c.start <= playhead && playhead < c.end);
					if (covering) {
						start = covering.end;
					}

					// Fit in the gap before the next segment
					const next = captions.find((c) => c.start > start);
					let end = next ? Math.min(start + defaultDur, next.start) : start + defaultDur;

					// If the gap is too narrow (< 200ms) and another segment follows, advance past it
					if (end - start < 200_000 && next) {
						start = next.end;
						const following = captions.find((c) => c.start > start);
						end = following ? Math.min(start + defaultDur, following.start) : start + defaultDur;
					}

					const segId = get().addCaptionSegment(targetTrackId, {
						start,
						end,
						text
					});
					if (segId) {
						get().selectCaption(targetTrackId, segId);
					}
					return segId;
				},
				removeTimelineTrack(id, options = {}) {
					const project = get().project;
					if (!project) return { removed: false, clipCount: 0 };
					const activeSeqId = get().activeSequenceId;
					const activeView = viewProject(project, activeSeqId);
					const track = activeView.tracks.find((item) => item.id === id);
					if (!track) return { removed: false, clipCount: 0 };
					if (track.clips.length > 0 && !options.force) {
						return { removed: false, clipCount: track.clips.length };
					}
					try {
						let clipCount = track.clips.length;
						mutateProject(
							'Remove track',
							(p) =>
								applyToSequence(p, activeSeqId, (view) => {
									const result = removeTrackOperation(view, id);
									clipCount = result.clipCount;
									return result.project;
								}),
							{ history: 'record' }
						);
						return { removed: true, clipCount };
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return { removed: false, clipCount: track.clips.length };
					}
				},
				reorderTimelineTrack(id, targetIndex) {
					try {
						const activeSeqId = get().activeSequenceId;
						mutateProject(
							'Reorder track',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									reorderTrackOperation(view, id, targetIndex)
								),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				renameTimelineTrack(id, name) {
					try {
						const activeSeqId = get().activeSequenceId;
						mutateProject(
							'Rename track',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									renameTrackOperation(view, id, name)
								),
							{
								history: 'record',
								mergeKey: `track-name:${id}`
							}
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				setTimelineTrackFlags(id, flags) {
					try {
						const activeSeqId = get().activeSequenceId;
						mutateProject(
							flags.muted !== undefined ? 'Mute track' : 'Change track settings',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									setTrackFlagsOperation(view, id, flags)
								),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				setTimelineTrackHeight(id, height) {
					try {
						const activeSeqId = get().activeSequenceId;
						mutateProject(
							'Resize track',
							(project) =>
								applyToSequence(project, activeSeqId, (view) =>
									setTrackHeightOperation(view, id, height)
								),
							{
								history: 'record',
								mergeKey: `track-height:${id}`
							}
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				linkSelection() {
					const ids = get().timeline.selection.clipIds;
					if (ids.length < 2) return false;
					try {
						const activeSeqId = get().activeSequenceId;
						mutateProject(
							'Link clips',
							(project) =>
								applyToSequence(project, activeSeqId, (view) => linkClipsOperation(view, ids)),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				unlinkSelection() {
					const ids = get().timeline.selection.clipIds;
					if (!ids.length) return false;
					try {
						const activeSeqId = get().activeSequenceId;
						mutateProject(
							'Unlink clips',
							(project) =>
								applyToSequence(project, activeSeqId, (view) => unlinkClipsOperation(view, ids)),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},
				setInspectorExpanded(sectionId, expanded) {
					set((state) => {
						state.inspector.expanded[sectionId] = expanded;
						persistInspectorPrefs(state.inspector);
					});
				},
				setInspectorLinkScale(link) {
					set((state) => {
						state.inspector.linkScale = link;
						persistInspectorPrefs(state.inspector);
					});
				},
				setKeyframeSelection(selection) {
					set((state) => {
						state.keyframes.selection = [...selection];
					});
				},
				selectKeyframe(ref, mode = 'set') {
					set((state) => {
						if (mode === 'set') {
							state.keyframes.selection = [ref];
						} else if (mode === 'toggle') {
							const idx = state.keyframes.selection.findIndex(
								(s) =>
									s.clipId === ref.clipId && s.propertyId === ref.propertyId && s.time === ref.time
							);
							if (idx >= 0) {
								state.keyframes.selection.splice(idx, 1);
							} else {
								state.keyframes.selection.push(ref);
							}
						} else if (mode === 'extend') {
							const exists = state.keyframes.selection.some(
								(s) =>
									s.clipId === ref.clipId && s.propertyId === ref.propertyId && s.time === ref.time
							);
							if (!exists) {
								state.keyframes.selection.push(ref);
							}
						}
						if (!state.timeline.selection.clipIds.includes(ref.clipId)) {
							state.timeline.selection.clipIds = [ref.clipId];
						}
					});
				},
				clearKeyframeSelection() {
					set((state) => {
						state.keyframes.selection = [];
					});
				},
				setShowKeyframeLanes(mode) {
					set((state) => {
						state.keyframes.showLanes = mode;
					});
				},
				toggleKeyframeLanes() {
					set((state) => {
						state.keyframes.showLanes =
							state.keyframes.showLanes === 'off'
								? 'selected'
								: state.keyframes.showLanes === 'selected'
									? 'all'
									: 'off';
					});
				},
				setGraphOpen(open) {
					set((state) => {
						state.keyframes.graph.open = open;
					});
				},
				toggleGraphEditor() {
					set((state) => {
						state.keyframes.graph.open = !state.keyframes.graph.open;
					});
				},
				setGraphVisibleProperties(properties) {
					set((state) => {
						state.keyframes.graph.visibleProperties = properties;
					});
				},
				setGraphViewport(viewport) {
					set((state) => {
						state.keyframes.graph.viewport = viewport;
					});
				},
				setProperties(clipId, properties, options) {
					const project = get().project;
					if (!project || properties.length === 0) return;
					try {
						const label =
							options?.label ??
							(properties.length === 1
								? `Change ${descriptorFor(properties[0]!.propertyId)?.label ?? properties[0]!.propertyId}`
								: 'Change properties');
						const defaultMergeKey =
							properties.length === 1
								? `set-prop:${clipId}:${properties[0]!.propertyId}`
								: `set-props:${clipId}`;
						const mergeKey = options?.mergeKey ?? (options?.coalesce ? defaultMergeKey : undefined);

						mutateProject(
							label,
							scoped((proj) => {
								let updatedTargetClip: Clip | null = null;
								const nextTracks = proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== clipId) return clip;
										const localTime = get().timeline.playhead - clip.start;
										let updated = clip;
										for (const prop of properties) {
											updated = setPropertyAtTime(updated, prop.propertyId, localTime, prop.value, {
												autoKey: options?.autoKey ?? true,
												fps: proj.settings.fps,
												editedChannel: prop.editedChannel
											});
										}
										updatedTargetClip = updated;
										return updated;
									})
								}));

								const hasTransform = properties.some(
									(p) =>
										p.propertyId === 'position' ||
										p.propertyId === 'scale' ||
										p.propertyId === 'rotation'
								);
								if (updatedTargetClip && hasTransform) {
									const target = updatedTargetClip;
									const playhead = get().timeline.playhead;
									for (const track of nextTracks) {
										track.clips = track.clips.map((c) => {
											if (!c.trackers || c.trackers.length === 0) return c;
											let trackersChanged = false;
											const nextTrackers = c.trackers.map((tracker) => {
												if (tracker.binding && tracker.binding.targetClipId === clipId) {
													trackersChanged = true;
													const offsets = captureBindingOffsets(
														proj,
														c,
														target,
														tracker,
														playhead,
														c.assetId ? (proj.assets[c.assetId]?.width ?? 1920) : 1920,
														c.assetId ? (proj.assets[c.assetId]?.height ?? 1080) : 1080
													);
													return {
														...tracker,
														binding: {
															...tracker.binding,
															offsetPosition: offsets.offsetPosition,
															offsetRotation: offsets.offsetRotation,
															offsetScale: offsets.offsetScale
														}
													};
												}
												return tracker;
											});
											return trackersChanged ? { ...c, trackers: nextTrackers } : c;
										});
									}
								}

								return {
									...proj,
									tracks: nextTracks
								};
							}),
							{
								history: 'record',
								mergeKey,
								coalesceWindowMs:
									options?.coalesceWindowMs ?? (options?.coalesce ? 1000 : undefined)
							}
						);
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				setProperty(clipId, propertyId, value, options) {
					get().setProperties(
						clipId,
						[{ propertyId, value, editedChannel: options?.editedChannel }],
						options
					);
				},
				enableAnimation(clipId, propertyId) {
					const project = get().project;
					if (!project) return;
					try {
						let addedKeyTime: Time | null = null;
						mutateProject(
							`Animate ${descriptorFor(propertyId)?.label ?? propertyId}`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== clipId) return clip;
										const localTime = get().timeline.playhead - clip.start;
										const updatedClip = enableClipAnimation(
											clip,
											propertyId,
											localTime,
											proj.settings.fps
										);
										const curve = propertyCurve(updatedClip, propertyId);
										if (curve && isAnimated(curve) && curve.keyframes.length > 0) {
											addedKeyTime = curve.keyframes[0]!.time;
										}
										return updatedClip;
									})
								}))
							})),
							{ history: 'record' }
						);
						if (addedKeyTime !== null) {
							set((state) => {
								state.keyframes.selection = [{ clipId, propertyId, time: addedKeyTime! }];
							});
						}
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				disableAnimation(clipId, propertyId, mode = 'flatten-current') {
					const project = get().project;
					if (!project) return;
					try {
						mutateProject(
							`Remove animation from ${descriptorFor(propertyId)?.label ?? propertyId}`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== clipId) return clip;
										const localTime = get().timeline.playhead - clip.start;
										return disableClipAnimation(clip, propertyId, localTime, mode);
									})
								}))
							})),
							{ history: 'record' }
						);
						set((state) => {
							state.keyframes.selection = state.keyframes.selection.filter(
								(ref) => !(ref.clipId === clipId && ref.propertyId === propertyId)
							);
						});
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				toggleKeyframe(clipId, propertyId) {
					const project = get().project;
					if (!project) return;
					try {
						mutateProject(
							`Toggle ${descriptorFor(propertyId)?.label ?? propertyId} keyframe`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== clipId) return clip;
										const localTime = get().timeline.playhead - clip.start;
										return toggleClipKeyframe(clip, propertyId, localTime, proj.settings.fps);
									})
								}))
							})),
							{ history: 'record' }
						);
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				deleteSelectedKeyframes() {
					const project = get().project;
					const selection = get().keyframes.selection;
					if (!project || selection.length === 0) return;
					const byClip = new Map<ClipId, KeyframeRef[]>();
					for (const ref of selection) {
						const list = byClip.get(ref.clipId) ?? [];
						list.push({ propertyId: ref.propertyId, time: ref.time });
						byClip.set(ref.clipId, list);
					}
					try {
						mutateProject(
							selection.length === 1 ? 'Delete keyframe' : `Delete ${selection.length} keyframes`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										const clipKeys = byClip.get(clip.id);
										return clipKeys && clipKeys.length > 0
											? deleteClipKeyframes(clip, clipKeys)
											: clip;
									})
								}))
							})),
							{ history: 'record' }
						);
						set((state) => {
							state.keyframes.selection = [];
						});
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				moveSelectedKeyframes(deltaTime, commit = true) {
					const project = get().project;
					const selection = get().keyframes.selection;
					if (!project || selection.length === 0 || deltaTime === 0) return;
					const byClip = new Map<ClipId, KeyframeRef[]>();
					for (const ref of selection) {
						const list = byClip.get(ref.clipId) ?? [];
						list.push({ propertyId: ref.propertyId, time: ref.time });
						byClip.set(ref.clipId, list);
					}
					try {
						let appliedDelta: Time = 0;
						mutateProject(
							'Move keyframes',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										const clipKeys = byClip.get(clip.id);
										if (clipKeys && clipKeys.length > 0) {
											const res = moveClipKeyframes(clip, clipKeys, deltaTime);
											appliedDelta = res.appliedDelta;
											return res.clip;
										}
										return clip;
									})
								}))
							})),
							{
								history: commit ? 'record' : 'skip',
								mergeKey: !commit ? 'move-keyframes' : undefined,
								updateKeyframeSelection: (sel) =>
									appliedDelta !== 0
										? sel.map((ref) => ({ ...ref, time: ref.time + appliedDelta }))
										: sel
							}
						);
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				setKeyframeInterpolation(preset) {
					const project = get().project;
					const selection = get().keyframes.selection;
					if (!project || selection.length === 0) return;
					const byClip = new Map<ClipId, KeyframeRef[]>();
					for (const ref of selection) {
						const list = byClip.get(ref.clipId) ?? [];
						list.push({ propertyId: ref.propertyId, time: ref.time });
						byClip.set(ref.clipId, list);
					}
					try {
						mutateProject(
							`Set keyframe interpolation: ${preset}`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										const clipKeys = byClip.get(clip.id);
										return clipKeys && clipKeys.length > 0
											? setClipKeyframeInterpolation(clip, clipKeys, preset)
											: clip;
									})
								}))
							})),
							{ history: 'record' }
						);
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				setBezierHandles(clipId, propertyId, time, handles, commit = true) {
					const project = get().project;
					if (!project) return;
					try {
						mutateProject(
							'Adjust bezier handles',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId
											? setClipBezierHandles(clip, propertyId, time, handles)
											: clip
									)
								}))
							})),
							{
								history: commit ? 'record' : 'skip',
								mergeKey: !commit ? `bezier:${clipId}:${propertyId}:${time}` : undefined
							}
						);
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				setKeyframeValue(clipId, propertyId, time, value, editedChannel, commit = true) {
					const project = get().project;
					if (!project) return;
					try {
						mutateProject(
							'Adjust keyframe value',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId
											? setClipKeyframeValue(clip, propertyId, time, value, editedChannel)
											: clip
									)
								}))
							})),
							{
								history: commit ? 'record' : 'skip',
								mergeKey: !commit ? `keyframe-val:${clipId}:${propertyId}:${time}` : undefined
							}
						);
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				addKeyframeAtTime(clipId, propertyId, time, value) {
					const project = get().project;
					if (!project) return;
					try {
						mutateProject(
							`Add ${descriptorFor(propertyId)?.label ?? propertyId} keyframe`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== clipId) return clip;
										const curve = propertyCurve(clip, propertyId);
										const val =
											value !== undefined
												? value
												: curve
													? evaluate(curve, time)
													: readProperty(clip, propertyId, time);
										// A static value has nothing to key into: start the animation first.
										const animatable =
											curve && isAnimated(curve)
												? clip
												: enableClipAnimation(clip, propertyId, time, proj.settings.fps);
										return setPropertyAtTime(animatable, propertyId, time, val, {
											autoKey: true,
											fps: proj.settings.fps
										});
									})
								}))
							})),
							{ history: 'record' }
						);
						set((state) => {
							state.keyframes.selection = [{ clipId, propertyId, time }];
						});
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				copySelectedKeyframes() {
					const project = get().project;
					const selection = get().keyframes.selection;
					if (!project || selection.length === 0) return;
					const clipId = selection[0]!.clipId;
					let targetClip: Clip | null = null;
					for (const track of viewProject(project, get().activeSequenceId).tracks) {
						const clip = track.clips.find((c) => c.id === clipId);
						if (clip) {
							targetClip = clip;
							break;
						}
					}
					if (!targetClip) return;
					const clipSelection = selection
						.filter((ref) => ref.clipId === clipId)
						.map((ref) => ({ propertyId: ref.propertyId, time: ref.time }));
					try {
						const clipboard = copyKeyframes(targetClip, clipSelection);
						set((state) => {
							state.keyframes.clipboard = clipboard;
						});
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				pasteKeyframes(targetClipId, targetPropertyId) {
					const project = get().project;
					const clipboard = get().keyframes.clipboard;
					if (!project || !clipboard || clipboard.entries.length === 0) return;
					const clipId = targetClipId ?? get().timeline.selection.clipIds[0];
					if (!clipId) return;
					try {
						let pastedRefs: KeyframeRef[] = [];
						mutateProject(
							'Paste keyframes',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== clipId) return clip;
										const localTime = get().timeline.playhead - clip.start;
										const res = pasteKeyframes(clip, clipboard, localTime, targetPropertyId);
										pastedRefs = res.pasted;
										return res.clip;
									})
								}))
							})),
							{ history: 'record' }
						);
						if (pastedRefs.length > 0) {
							set((state) => {
								state.keyframes.selection = pastedRefs.map((r) => ({
									clipId,
									propertyId: r.propertyId,
									time: r.time
								}));
							});
						}
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				nextKeyframe() {
					const project = get().project;
					if (!project) return;
					const playhead = get().timeline.playhead;
					const selectedIds = new Set(get().timeline.selection.clipIds);
					const targetClips = viewProject(project, get().activeSequenceId).tracks.flatMap((track) =>
						track.clips.filter((clip) => selectedIds.size === 0 || selectedIds.has(clip.id))
					);
					let nextGlobalTime: Time | null = null;
					for (const clip of targetClips) {
						const localTime = playhead - clip.start;
						const nextLocal = nextKeyframeTime(clip, ANIMATABLE_PROPERTY_IDS, localTime);
						if (nextLocal !== null) {
							const globalTime = clip.start + nextLocal;
							if (
								globalTime > playhead &&
								(nextGlobalTime === null || globalTime < nextGlobalTime)
							) {
								nextGlobalTime = globalTime;
							}
						}
					}
					if (nextGlobalTime !== null) {
						set((state) => {
							state.timeline.playhead = nextGlobalTime!;
						});
					}
				},
				prevKeyframe() {
					const project = get().project;
					if (!project) return;
					const playhead = get().timeline.playhead;
					const selectedIds = new Set(get().timeline.selection.clipIds);
					const targetClips = viewProject(project, get().activeSequenceId).tracks.flatMap((track) =>
						track.clips.filter((clip) => selectedIds.size === 0 || selectedIds.has(clip.id))
					);
					let prevGlobalTime: Time | null = null;
					for (const clip of targetClips) {
						const localTime = playhead - clip.start;
						const prevLocal = prevKeyframeTime(clip, ANIMATABLE_PROPERTY_IDS, localTime);
						if (prevLocal !== null) {
							const globalTime = clip.start + prevLocal;
							if (
								globalTime < playhead &&
								(prevGlobalTime === null || globalTime > prevGlobalTime)
							) {
								prevGlobalTime = globalTime;
							}
						}
					}
					if (prevGlobalTime !== null) {
						set((state) => {
							state.timeline.playhead = prevGlobalTime!;
						});
					}
				},
				easyEase() {
					get().setKeyframeInterpolation('ease-in-out');
				},
				setEffectsLibraryQuery(query) {
					set((state) => {
						state.effectsUi.libraryQuery = query;
					});
				},
				setSelectedEffectId(effectId) {
					set((state) => {
						state.effectsUi.selectedEffectId = effectId;
					});
				},
				setScopesOpen(open) {
					set((state) => {
						state.scopes.open = open;
					});
				},
				toggleScopesOpen() {
					set((state) => {
						state.scopes.open = !state.scopes.open;
					});
				},
				setScopesMode(mode) {
					set((state) => {
						state.scopes.mode = mode;
					});
				},
				setScopesChannel(channel) {
					set((state) => {
						state.scopes.channel = channel;
					});
				},
				setColorTab(tab) {
					set((state) => {
						state.colorUi.activeTab = tab;
					});
				},
				addEffect(clipId, effectType, initialParams) {
					const project = get().project;
					if (!project) return null;
					let instance: EffectInstance | null = null;
					try {
						instance = createEffectInstance(effectType, initialParams);
						const created = instance;
						mutateProject(
							`Add ${instance.type} effect`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? addEffectToClip(clip, created) : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						set((state) => {
							state.effectsUi.selectedEffectId = created.id;
						});
						return created;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return null;
					}
				},
				removeEffect(clipId, effectId) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Remove effect',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? removeEffectFromClip(clip, effectId) : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						set((state) => {
							if (state.effectsUi.selectedEffectId === effectId) {
								state.effectsUi.selectedEffectId = null;
							}
						});
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},
				reorderEffect(clipId, effectId, toIndex) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Reorder effects',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? reorderEffectInClip(clip, effectId, toIndex) : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},
				toggleEffect(clipId, effectId, enabled) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Toggle effect',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? toggleEffectInClip(clip, effectId, enabled) : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},
				soloEffect(clipId, effectId) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Solo effect',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? soloEffectInClip(clip, effectId) : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},
				toggleBypassClipEffects(clipId, bypass) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Toggle bypass effects',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? toggleBypassClipEffects(clip, bypass) : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},
				duplicateEffect(clipId, effectId) {
					const project = get().project;
					if (!project) return null;
					let dup: EffectInstance | null = null;
					try {
						mutateProject(
							'Duplicate effect',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== clipId) return clip;
										const updated = duplicateEffectInClip(clip, effectId);
										const idx = (clip.effects ?? []).findIndex((e) => e.id === effectId);
										if (idx !== -1 && updated.effects?.[idx + 1]) {
											dup = updated.effects[idx + 1]!;
										}
										return updated;
									})
								}))
							})),
							{ history: 'record' }
						);
						if (dup) {
							const dupId = (dup as EffectInstance).id;
							set((state) => {
								state.effectsUi.selectedEffectId = dupId;
							});
						}
						return dup;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return null;
					}
				},
				resetEffect(clipId, effectId) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Reset effect',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== clipId) return clip;
										const effects = (clip.effects ?? []).map((eff) => {
											if (eff.id !== effectId) return eff;
											const fresh = createEffectInstance(eff.type);
											return {
												...fresh,
												id: eff.id,
												enabled: eff.enabled
											};
										});
										return { ...clip, effects };
									})
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},
				setEffectParam(clipId, effectId, paramName, value, options) {
					const project = get().project;
					if (!project) return;
					const targetClip = findClipInSequence(project, get().activeSequenceId, clipId);
					const effectType = targetClip?.effects?.find((e) => e.id === effectId)?.type;
					if (!effectType || !targetClip) return;
					const propertyId = `effect:${effectType}:${effectId}:${paramName}` as PropertyId;
					const curve = propertyCurve(targetClip, propertyId);
					const def = getEffectDefinition(effectType);
					const paramDef = def?.params[paramName];
					const isAnimatable = Boolean(
						paramName === 'mix' || (paramDef?.animatable && paramDef.type !== 'color')
					);
					if ((curve && isAnimated(curve)) || isAnimatable) {
						get().setProperty(clipId, propertyId, value as PropertyValue, options);
						return;
					}
					try {
						mutateProject(
							`Change ${paramName}`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((c) => {
										if (c.id !== clipId) return c;
										return {
											...c,
											effects: (c.effects ?? []).map((eff) => {
												if (eff.id !== effectId) return eff;
												return {
													...eff,
													params: {
														...eff.params,
														[paramName]: value as JsonValue
													}
												};
											})
										};
									})
								}))
							})),
							{
								history: 'record',
								mergeKey: options?.coalesce
									? `set-effect-param:${clipId}:${effectId}:${paramName}`
									: undefined
							}
						);
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},
				copyClipEffects(clipId) {
					const project = get().project;
					if (!project) return;
					const clip = findClipInSequence(project, get().activeSequenceId, clipId);
					if (!clip) return;
					const copied = copyClipEffectsCore(clip);
					set((state) => {
						state.effectsClipboard = copied;
						state.projectMessage = `Copied ${copied.length} effect(s).`;
					});
				},
				pasteClipEffects(clipId) {
					const project = get().project;
					const clipboard = get().effectsClipboard;
					if (!project || !clipboard || clipboard.length === 0) return false;
					try {
						mutateProject(
							`Paste ${clipboard.length} effect(s)`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? pasteClipEffectsCore(clip, clipboard) : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						set((state) => {
							state.projectMessage = `Pasted ${clipboard.length} effect(s).`;
						});
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},
				ensureColorCorrection(clipId) {
					const project = get().project;
					if (!project) return null;
					const clip = findClipInSequence(project, get().activeSequenceId, clipId);
					const existing = clip?.effects?.find((e) => e.type === 'colorCorrection');
					if (existing) return existing;
					return get().addEffect(clipId, 'colorCorrection');
				},
				addAdjustmentLayer(trackId, start, duration) {
					const project = get().project;
					if (!project) return null;
					const activeSeqId = get().activeSequenceId;
					const activeView = viewProject(project, activeSeqId);
					const clipStart = snapToFrame(start ?? get().timeline.playhead, activeView.settings.fps);
					const clipDuration =
						duration ?? framesToTicks(5 * activeView.settings.fps, activeView.settings.fps);

					const selTrackId =
						trackId ??
						get().timeline.selection.trackId ??
						(get().timeline.selection.clipIds.length > 0
							? activeView.tracks.find((t) =>
									t.clips.some((c) => get().timeline.selection.clipIds.includes(c.id))
								)?.id
							: undefined);
					const unlockedVideoTracks = activeView.tracks.filter(
						(t) => t.kind === 'video' && !t.locked
					);
					const hasOverlapAt = (t: Track) =>
						t.clips.some(
							(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
						);

					let targetTrackId: TrackId | undefined = undefined;
					if (selTrackId) {
						const selTrack = unlockedVideoTracks.find((t) => t.id === selTrackId);
						if (selTrack && !hasOverlapAt(selTrack)) {
							targetTrackId = selTrack.id;
						}
					}
					if (!targetTrackId) {
						const candidates = unlockedVideoTracks.slice().reverse();
						const availableTrack = candidates.find((t) => !hasOverlapAt(t));
						if (availableTrack) {
							targetTrackId = availableTrack.id;
						}
					}

					let createdClipId: ClipId | null = null;
					try {
						mutateProject(
							'Add adjustment layer',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => {
									let currentView = view;
									let trackToUse = targetTrackId
										? currentView.tracks.find(
												(t) => t.id === targetTrackId && t.kind === 'video' && !t.locked
											)
										: undefined;
									if (
										trackToUse &&
										trackToUse.clips.some(
											(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
										)
									) {
										trackToUse = undefined;
									}
									if (!trackToUse) {
										const candidates = currentView.tracks
											.filter((t) => t.kind === 'video' && !t.locked)
											.slice()
											.reverse();
										trackToUse = candidates.find(
											(t) =>
												!t.clips.some(
													(c) =>
														c.start < clipStart + clipDuration && c.start + c.duration > clipStart
												)
										);
									}
									if (!trackToUse) {
										const prevIds = new Set(currentView.tracks.map((t) => t.id));
										currentView = addTrackOperation(currentView, 'video');
										trackToUse = currentView.tracks.find(
											(t) => !prevIds.has(t.id) && t.kind === 'video'
										);
									}
									const clip = createAdjustmentClip(clipStart, clipDuration);
									createdClipId = clip.id;
									return insertClip(currentView, trackToUse!.id, clip);
								}),
							{ history: 'record' }
						);
						if (createdClipId) {
							get().selectClips([createdClipId]);
						}
						return createdClipId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},
				addSolidLayer(color = '#000000', trackId, start, duration) {
					const project = get().project;
					if (!project) return null;
					const activeSeqId = get().activeSequenceId;
					const activeView = viewProject(project, activeSeqId);
					const clipStart = snapToFrame(start ?? get().timeline.playhead, activeView.settings.fps);
					const clipDuration =
						duration ?? framesToTicks(5 * activeView.settings.fps, activeView.settings.fps);

					let rgba: ColorRgba = { r: 0, g: 0, b: 0, a: 1 };
					if (typeof color === 'string') {
						const hex = color.replace('#', '');
						if (hex.length === 6) {
							rgba = {
								r: parseInt(hex.slice(0, 2), 16) / 255,
								g: parseInt(hex.slice(2, 4), 16) / 255,
								b: parseInt(hex.slice(4, 6), 16) / 255,
								a: 1
							};
						}
					} else if (typeof color === 'object' && color !== null) {
						rgba = color;
					}

					const selTrackId =
						trackId ??
						get().timeline.selection.trackId ??
						(get().timeline.selection.clipIds.length > 0
							? activeView.tracks.find((t) =>
									t.clips.some((c) => get().timeline.selection.clipIds.includes(c.id))
								)?.id
							: undefined);
					const unlockedVideoTracks = activeView.tracks.filter(
						(t) => t.kind === 'video' && !t.locked
					);
					const hasOverlapAt = (t: Track) =>
						t.clips.some(
							(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
						);

					let targetTrackId: TrackId | undefined = undefined;
					if (selTrackId) {
						const selTrack = unlockedVideoTracks.find((t) => t.id === selTrackId);
						if (selTrack && !hasOverlapAt(selTrack)) {
							targetTrackId = selTrack.id;
						}
					}
					if (!targetTrackId) {
						const candidates = unlockedVideoTracks.slice().reverse();
						const availableTrack = candidates.find((t) => !hasOverlapAt(t));
						if (availableTrack) {
							targetTrackId = availableTrack.id;
						}
					}

					let createdClipId: ClipId | null = null;
					try {
						mutateProject(
							'Add solid color',
							(proj) => {
								return applyToSequence(proj, activeSeqId, (view) => {
									let currentView = view;
									let trackToUse = targetTrackId
										? currentView.tracks.find(
												(t) => t.id === targetTrackId && t.kind === 'video' && !t.locked
											)
										: undefined;
									if (
										trackToUse &&
										trackToUse.clips.some(
											(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
										)
									) {
										trackToUse = undefined;
									}
									if (!trackToUse) {
										const candidates = currentView.tracks
											.filter((t) => t.kind === 'video' && !t.locked)
											.slice()
											.reverse();
										trackToUse = candidates.find(
											(t) =>
												!t.clips.some(
													(c) =>
														c.start < clipStart + clipDuration && c.start + c.duration > clipStart
												)
										);
									}
									if (!trackToUse) {
										const prevIds = new Set(currentView.tracks.map((t) => t.id));
										currentView = addTrackOperation(currentView, 'video');
										trackToUse = currentView.tracks.find(
											(t) => !prevIds.has(t.id) && t.kind === 'video'
										);
									}
									const clip = createSolidClip(clipStart, clipDuration, {
										r: rgba.r,
										g: rgba.g,
										b: rgba.b,
										a: rgba.a ?? 1
									});
									createdClipId = clip.id;
									return insertClip(currentView, trackToUse!.id, clip);
								});
							},
							{ history: 'record' }
						);
						if (createdClipId) {
							get().selectClips([createdClipId]);
						}
						return createdClipId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},
				async importLut(name, cubeText) {
					const project = get().project;
					if (!project) return null;
					try {
						const parsed = parseCubeLut(cubeText);
						const assetId = createAssetId();
						storeParsedLut(assetId, parsed);
						const cleanName = name.endsWith('.cube') ? name : `${name}.cube`;
						const file = new File([cubeText], cleanName, { type: 'text/plain' });
						const opfsPath = await writeMedia(project.id, assetId, file);
						const asset: Asset = {
							id: assetId,
							name: cleanName,
							kind: 'lut',
							duration: 0,
							size: file.size,
							mimeType: 'text/plain',
							hasAudio: false,
							opfsPath
						};
						mutateProject(
							'Import LUT',
							(proj) => ({
								...proj,
								assets: {
									...proj.assets,
									[assetId]: asset
								}
							}),
							{ history: 'record' }
						);
						set((state) => {
							state.projectMessage = `Imported LUT "${cleanName}".`;
						});
						return assetId;
					} catch (error) {
						set((state) => {
							state.projectMessage = `Could not import LUT: ${errorMessage(error)}`;
						});
						return null;
					}
				},

				addTransition(trackId, type, edge, duration, alignment = 'center', params = {}) {
					const project = get().project;
					if (!project) return null;
					const track = viewProject(project, get().activeSequenceId).tracks.find(
						(t) => t.id === trackId
					);
					if (!track) return null;

					const def = getTransitionDefinition(type);
					const effectiveDur = duration ?? def?.defaultDurationUs ?? 1_000_000;
					const id = `tr_${crypto.randomUUID().slice(0, 8)}`;

					// Check if a transition already exists on this edge/cut on this track
					// If so, replace it so duplicate transitions are not stacked at the same cut
					const isSameEdge = (existing: Transition): boolean => {
						if (existing.edge.kind === 'cut' && edge.kind === 'cut') {
							return (
								(existing.edge.fromClipId === edge.fromClipId &&
									existing.edge.toClipId === edge.toClipId) ||
								(existing.edge.fromClipId === edge.toClipId &&
									existing.edge.toClipId === edge.fromClipId)
							);
						}
						if (existing.edge.kind === edge.kind) {
							return (
								(existing.edge as { clipId: string }).clipId === (edge as { clipId: string }).clipId
							);
						}
						return false;
					};

					const newTransition: Transition = {
						id,
						type,
						duration: effectiveDur,
						alignment,
						edge,
						params
					};

					mutateProject(
						`Add Transition (${def?.name ?? type})`,
						scoped((proj) => ({
							...proj,
							tracks: proj.tracks.map((t) =>
								t.id === trackId
									? {
											...t,
											transitions: [
												...(t.transitions ?? []).filter((tr) => !isSameEdge(tr)),
												newTransition
											]
										}
									: t
							)
						})),
						{ history: 'record' }
					);

					set((state) => {
						state.timeline.selection.transitionId = id;
						state.timeline.message = `Added ${def?.name ?? type} transition.`;
					});

					return id;
				},

				updateTransition(transitionId, updates) {
					const project = get().project;
					if (!project) return false;

					let found = false;
					mutateProject(
						'Edit Transition',
						scoped((proj) => ({
							...proj,
							tracks: proj.tracks.map((t) => ({
								...t,
								transitions: (t.transitions ?? []).map((tr) => {
									if (tr.id === transitionId) {
										found = true;
										// If type changed, reset params so incompatible params from previous type don't linger
										const isTypeChange = updates.type && updates.type !== tr.type;
										const mergedParams = isTypeChange
											? (updates.params ?? {})
											: {
													...tr.params,
													...(updates.params ?? {})
												};
										return {
											...tr,
											...updates,
											params: mergedParams
										};
									}
									return tr;
								})
							}))
						})),
						{ history: 'record', mergeKey: `transition:${transitionId}` }
					);

					return found;
				},

				removeTransition(transitionId) {
					const project = get().project;
					if (!project) return false;

					let removed = false;
					mutateProject(
						'Remove Transition',
						scoped((proj) => ({
							...proj,
							tracks: proj.tracks.map((t) => ({
								...t,
								transitions: (t.transitions ?? []).filter((tr) => {
									if (tr.id === transitionId) {
										removed = true;
										return false;
									}
									return true;
								})
							}))
						})),
						{ history: 'record' }
					);

					if (removed) {
						set((state) => {
							if (state.timeline.selection.transitionId === transitionId) {
								delete state.timeline.selection.transitionId;
							}
						});
					}

					return removed;
				},

				selectTransition(transitionId) {
					set((state) => {
						if (transitionId) {
							state.timeline.selection.transitionId = transitionId;
							state.timeline.selection.clipIds = [];
						} else {
							delete state.timeline.selection.transitionId;
						}
					});
				},

				applyDefaultTransition(type: TransitionType = 'crossDissolve') {
					const state = get();
					const project = state.project;
					if (!project) return false;

					// If two adjacent clips are selected, or playhead is near an edit point:
					const selectedIds = state.timeline.selection.clipIds;
					const fps = project.settings.fps || 30;
					const tolerance = Math.round(1_000_000 / fps);

					if (selectedIds.length === 2) {
						// Look for track containing both
						for (const track of project.tracks) {
							const cA = track.clips.find((c) => c.id === selectedIds[0]);
							const cB = track.clips.find((c) => c.id === selectedIds[1]);
							if (cA && cB) {
								const [first, second] = cA.start < cB.start ? [cA, cB] : [cB, cA];
								if (Math.abs(first.start + first.duration - second.start) <= tolerance) {
									state.addTransition(track.id, type, {
										kind: 'cut',
										fromClipId: first.id,
										toClipId: second.id
									});
									return true;
								}
							}
						}
					} else if (selectedIds.length === 1) {
						// Head or tail fade or cut near playhead
						const clipId = selectedIds[0];
						for (const track of project.tracks) {
							const c = track.clips.find((clip) => clip.id === clipId);
							if (c) {
								// Check if adjacent clip exists on same track
								const prevClip = track.clips.find(
									(clip) => Math.abs(clip.start + clip.duration - c.start) <= tolerance
								);
								const nextClip = track.clips.find(
									(clip) => Math.abs(c.start + c.duration - clip.start) <= tolerance
								);
								const playhead = state.timeline.playhead;

								if (prevClip && Math.abs(c.start - playhead) <= tolerance * 3) {
									state.addTransition(track.id, type, {
										kind: 'cut',
										fromClipId: prevClip.id,
										toClipId: c.id
									});
									return true;
								}
								if (nextClip && Math.abs(c.start + c.duration - playhead) <= tolerance * 3) {
									state.addTransition(track.id, type, {
										kind: 'cut',
										fromClipId: c.id,
										toClipId: nextClip.id
									});
									return true;
								}

								// If playhead is near start or end of this clip, cut with adjacent if exists
								if (
									prevClip &&
									Math.abs(playhead - c.start) < Math.abs(playhead - (c.start + c.duration))
								) {
									state.addTransition(track.id, type, {
										kind: 'cut',
										fromClipId: prevClip.id,
										toClipId: c.id
									});
									return true;
								}
								if (
									nextClip &&
									Math.abs(playhead - (c.start + c.duration)) <= Math.abs(playhead - c.start)
								) {
									state.addTransition(track.id, type, {
										kind: 'cut',
										fromClipId: c.id,
										toClipId: nextClip.id
									});
									return true;
								}

								// Fallback: head fade if playhead near start, else tail fade
								if (Math.abs(playhead - c.start) < Math.abs(playhead - (c.start + c.duration))) {
									state.addTransition(track.id, type, {
										kind: 'head',
										clipId: c.id
									});
								} else {
									state.addTransition(track.id, type, {
										kind: 'tail',
										clipId: c.id
									});
								}
								return true;
							}
						}
					} else if (selectedIds.length === 0) {
						// Check if playhead is near any cut point across tracks
						const playhead = state.timeline.playhead;
						for (const track of project.tracks) {
							if (track.kind !== 'video' || track.hidden) continue;
							const sorted = [...track.clips].sort((a, b) => a.start - b.start);
							for (let i = 0; i < sorted.length - 1; i++) {
								const c1 = sorted[i]!;
								const c2 = sorted[i + 1]!;
								if (Math.abs(c1.start + c1.duration - c2.start) <= tolerance) {
									const cutTime = c2.start;
									if (Math.abs(playhead - cutTime) <= tolerance * 5) {
										state.addTransition(track.id, type, {
											kind: 'cut',
											fromClipId: c1.id,
											toClipId: c2.id
										});
										return true;
									}
								}
							}
							// Or if playhead is near any clip boundary
							for (const c of sorted) {
								if (Math.abs(playhead - c.start) <= tolerance * 3) {
									state.addTransition(track.id, type, {
										kind: 'head',
										clipId: c.id
									});
									return true;
								}
								if (Math.abs(playhead - (c.start + c.duration)) <= tolerance * 3) {
									state.addTransition(track.id, type, {
										kind: 'tail',
										clipId: c.id
									});
									return true;
								}
							}
						}
					}
					return false;
				},

				setMaskTool(tool) {
					set((state) => {
						state.maskTool.activeTool = tool;
					});
				},

				selectMask(maskId) {
					set((state) => {
						state.maskTool.selectedMaskId = maskId;
						state.maskTool.selectedPointIndex = null;
					});
				},

				selectMaskPoint(index) {
					set((state) => {
						state.maskTool.selectedPointIndex = index;
						state.maskTool.selectedPoints = index !== null ? [index] : [];
					});
				},

				selectMaskPoints(indices) {
					set((state) => {
						state.maskTool.selectedPoints = [...indices];
						state.maskTool.selectedPointIndex = indices.length > 0 ? indices[0] : null;
					});
				},

				toggleMaskPoint(index, multiSelect) {
					set((state) => {
						if (!multiSelect) {
							state.maskTool.selectedPoints = [index];
							state.maskTool.selectedPointIndex = index;
							return;
						}
						const exists = state.maskTool.selectedPoints.includes(index);
						if (exists) {
							state.maskTool.selectedPoints = state.maskTool.selectedPoints.filter(
								(i) => i !== index
							);
							state.maskTool.selectedPointIndex = state.maskTool.selectedPoints[0] ?? null;
						} else {
							state.maskTool.selectedPoints = [...state.maskTool.selectedPoints, index];
							state.maskTool.selectedPointIndex = index;
						}
					});
				},

				setMaskBlockedMessage(message) {
					set((state) => {
						state.maskTool.blockedMessage = message;
					});
				},

				setMaskOverlayVisible(visible) {
					set((state) => {
						state.maskTool.showOverlay = visible;
					});
				},

				addMask(clipId, type, overrides) {
					const mask = createMask(type, overrides);
					let added = false;
					try {
						mutateProject(
							`Add ${type} mask`,
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => ({
									...t,
									clips: t.clips.map((c) => {
										if (c.id !== clipId) return c;
										added = true;
										return addMaskToClip(c, mask);
									})
								}))
							})),
							{ history: 'record' }
						);
						if (added) {
							set((state) => {
								state.maskTool.selectedMaskId = mask.id;
								state.maskTool.selectedPointIndex = null;
								state.maskTool.selectedPoints = [];
								state.maskTool.blockedMessage = null;
							});
							return mask.id;
						}
						return null;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return null;
					}
				},

				removeMask(clipId, maskId) {
					let removed = false;
					try {
						mutateProject(
							'Remove mask',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => ({
									...t,
									clips: t.clips.map((c) => {
										if (c.id !== clipId) return c;
										removed = true;
										return removeMaskFromClip(c, maskId);
									})
								}))
							})),
							{ history: 'record' }
						);
						if (removed) {
							set((state) => {
								if (state.maskTool.selectedMaskId === maskId) {
									state.maskTool.selectedMaskId = null;
									state.maskTool.selectedPointIndex = null;
									state.maskTool.selectedPoints = [];
									state.maskTool.blockedMessage = null;
								}
							});
						}
						return removed;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},

				updateMask(clipId, maskId, patch, options) {
					const project = get().project;
					if (project) {
						const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
						const mask = clip?.masks?.find((m) => m.id === maskId);
						if (clip && mask) {
							const shapePropId = `mask:${maskId}:shape` as PropertyId;
							const shapeCurve = propertyCurve(clip, shapePropId);
							const shapeAnimated = shapeCurve && isAnimated(shapeCurve);

							// If shape is updated and it is animated, check point count enforcement or auto-key
							if (patch.points && shapeAnimated) {
								const currentPoints = mask.points ?? [];
								if (patch.points.length !== currentPoints.length) {
									get().setMaskBlockedMessage(
										'Cannot add or remove points while mask shape is animated.'
									);
									return false;
								}
								// Same point count: auto-key shape property
								const coords: number[] = [];
								for (const pt of patch.points) {
									coords.push(
										pt.x,
										pt.y,
										pt.inHandle?.x ?? pt.x,
										pt.inHandle?.y ?? pt.y,
										pt.outHandle?.x ?? pt.x,
										pt.outHandle?.y ?? pt.y
									);
								}
								get().setProperty(clipId, shapePropId, coords, { autoKey: true });
							} else if (patch.shape && (shapeAnimated || shapeCurve)) {
								get().setProperty(clipId, shapePropId, [...patch.shape], { autoKey: true });
							}
						}
					}

					const coalesceKey = options?.coalesce ? `mask-update:${clipId}:${maskId}` : undefined;
					try {
						mutateProject(
							'Update mask',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => ({
									...t,
									clips: t.clips.map((c) => {
										if (c.id !== clipId) return c;
										return updateMaskInClip(c, maskId, patch);
									})
								}))
							})),
							{
								history: 'record',
								mergeKey: coalesceKey
							}
						);
						return true;
					} catch {
						return false;
					}
				},

				reorderMask(clipId, fromIndex, toIndex) {
					try {
						mutateProject(
							'Reorder masks',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => ({
									...t,
									clips: t.clips.map((c) => {
										if (c.id !== clipId) return c;
										return reorderMasksInClip(c, fromIndex, toIndex);
									})
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setMaskParam(clipId, maskId, param, value, options) {
					const project = get().project;
					if (!project) return;
					const propertyId = `mask:${maskId}:${param}` as PropertyId;
					const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
					const mask = clip?.masks?.find((m) => m.id === maskId);
					if (!clip || !mask) return;

					const curve = propertyCurve(clip, propertyId);
					const isAnimatable = param === 'feather' || param === 'expansion' || param === 'opacity';
					if ((curve && isAnimated(curve)) || (isAnimatable && options?.autoKey)) {
						get().setProperty(clipId, propertyId, value as PropertyValue, options);
						return;
					}

					get().updateMask(clipId, maskId, { [param]: value } as Partial<Mask>, options);
				},

				toggleMixer() {
					const nextOpen = !get().isMixerOpen;
					set((state) => {
						state.isMixerOpen = nextOpen;
					});
					const currentLayout = get().activeLayout;
					const panels = collectPanels(currentLayout);
					if (nextOpen) {
						if (panels.includes('mixer')) {
							get().updateLayout(activateTab(currentLayout, 'mixer'));
						} else {
							// Show mixer panel beside preview / in inspector stack
							get().updateLayout(setPanelVisible(currentLayout, 'mixer', true, 'program'));
						}
					} else {
						if (panels.includes('mixer')) {
							get().updateLayout(setPanelVisible(currentLayout, 'mixer', false));
						}
					}
				},

				setTrackAudioGain(trackId, gainDb, coalesce = false) {
					try {
						mutateProject(
							'Change track gain',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, gainDb: Math.max(-96, Math.min(24, gainDb)) }
									};
								})
							}),
							{ history: 'record', mergeKey: coalesce ? `track-gain-${trackId}` : undefined }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioPan(trackId, pan, coalesce = false) {
					try {
						mutateProject(
							'Change track pan',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, pan: Math.max(-1, Math.min(1, pan)) }
									};
								})
							}),
							{ history: 'record', mergeKey: coalesce ? `track-pan-${trackId}` : undefined }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioTrim(trackId, trimDb, coalesce = false) {
					try {
						mutateProject(
							'Change track trim',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, trimDb: Math.max(-24, Math.min(24, trimDb)) }
									};
								})
							}),
							{ history: 'record', mergeKey: coalesce ? `track-trim-${trackId}` : undefined }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioOutput(trackId, output) {
					try {
						mutateProject(
							'Change track routing',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, output }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioSolo(trackId, solo, exclusive = false) {
					try {
						mutateProject(
							'Toggle track solo',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.kind !== 'audio') return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									if (exclusive) {
										return {
											...t,
											audio: { ...curAudio, solo: t.id === trackId }
										};
									}
									if (t.id !== trackId) return t;
									const nextSolo = solo !== undefined ? solo : !curAudio.solo;
									return {
										...t,
										audio: { ...curAudio, solo: nextSolo }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioEq(trackId, eq) {
					try {
						mutateProject(
							'Update track EQ',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, eq }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioCompressor(trackId, compressor) {
					try {
						mutateProject(
							'Update track compressor',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, compressor }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				resetTrackAudio(trackId) {
					try {
						mutateProject(
							'Reset track audio',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									return {
										...t,
										audio: defaultTrackAudio()
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setMasterAudioGain(gainDb, coalesce = false) {
					try {
						mutateProject(
							'Change master gain',
							(proj) => ({
								...proj,
								masterAudio: {
									gainDb: Math.max(-96, Math.min(24, gainDb)),
									limiter: proj.masterAudio?.limiter ?? false,
									loudnessTargetLufs: proj.masterAudio?.loudnessTargetLufs
								}
							}),
							{ history: 'record', mergeKey: coalesce ? 'master-gain' : undefined }
						);
						return true;
					} catch {
						return false;
					}
				},

				setMasterAudioLimiter(limiter) {
					try {
						mutateProject(
							'Toggle master limiter',
							(proj) => ({
								...proj,
								masterAudio: {
									gainDb: proj.masterAudio?.gainDb ?? 0,
									limiter,
									loudnessTargetLufs: proj.masterAudio?.loudnessTargetLufs
								}
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setMasterAudioLoudnessTarget(targetLufs) {
					try {
						mutateProject(
							'Set master loudness target',
							(proj) => ({
								...proj,
								masterAudio: {
									gainDb: proj.masterAudio?.gainDb ?? 0,
									limiter: proj.masterAudio?.limiter ?? false,
									loudnessTargetLufs: targetLufs !== undefined ? targetLufs : undefined,
									effects: proj.masterAudio?.effects,
									automation: proj.masterAudio?.automation,
									automationMode: proj.masterAudio?.automationMode
								}
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				addAudioBus(name = 'Submix', output = 'master') {
					try {
						const busId = crypto.randomUUID();
						mutateProject(
							'Add audio bus',
							(proj) => {
								const buses = proj.audioBuses ? [...proj.audioBuses] : [];
								buses.push({
									id: busId,
									name,
									gainDb: 0,
									pan: 0,
									muted: false,
									solo: false,
									output,
									effects: [],
									automationMode: 'read'
								});
								return {
									...proj,
									audioBuses: buses
								};
							},
							{ history: 'record' }
						);
						return busId;
					} catch {
						return null;
					}
				},

				removeAudioBus(busId) {
					try {
						mutateProject(
							'Remove audio bus',
							(proj) => {
								const filteredBuses = (proj.audioBuses ?? [])
									.filter((b) => b.id !== busId)
									.map((b) => (b.output === busId ? { ...b, output: 'master' as const } : b));

								const updatedTracks = proj.tracks.map((t) => {
									if (!t.audio) return t;
									const nextOutput = t.audio.output === busId ? 'master' : t.audio.output;
									const nextSends = (t.audio.sends ?? []).filter((s) => s.busId !== busId);
									return {
										...t,
										audio: {
											...t.audio,
											output: nextOutput,
											sends: nextSends
										}
									};
								});

								return {
									...proj,
									audioBuses: filteredBuses,
									tracks: updatedTracks
								};
							},
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setBusAudioGain(busId, gainDb, coalesce = false) {
					try {
						mutateProject(
							'Change bus gain',
							(proj) => ({
								...proj,
								audioBuses: (proj.audioBuses ?? []).map((b) =>
									b.id === busId ? { ...b, gainDb: Math.max(-96, Math.min(24, gainDb)) } : b
								)
							}),
							{ history: 'record', mergeKey: coalesce ? `bus-gain-${busId}` : undefined }
						);
						return true;
					} catch {
						return false;
					}
				},

				setBusAudioPan(busId, pan, coalesce = false) {
					try {
						mutateProject(
							'Change bus pan',
							(proj) => ({
								...proj,
								audioBuses: (proj.audioBuses ?? []).map((b) =>
									b.id === busId ? { ...b, pan: Math.max(-1, Math.min(1, pan)) } : b
								)
							}),
							{ history: 'record', mergeKey: coalesce ? `bus-pan-${busId}` : undefined }
						);
						return true;
					} catch {
						return false;
					}
				},

				setBusAudioMute(busId, muted) {
					try {
						mutateProject(
							'Toggle bus mute',
							(proj) => ({
								...proj,
								audioBuses: (proj.audioBuses ?? []).map((b) =>
									b.id === busId ? { ...b, muted: muted !== undefined ? muted : !b.muted } : b
								)
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setBusAudioSolo(busId, solo) {
					try {
						mutateProject(
							'Toggle bus solo',
							(proj) => ({
								...proj,
								audioBuses: (proj.audioBuses ?? []).map((b) =>
									b.id === busId ? { ...b, solo: solo !== undefined ? solo : !b.solo } : b
								)
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackSend(trackId, send) {
					try {
						mutateProject(
							'Update track send',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									const sends = curAudio.sends ? [...curAudio.sends] : [];
									const existingIdx = sends.findIndex((s) => s.busId === send.busId);
									if (existingIdx >= 0) {
										sends[existingIdx] = send;
									} else {
										sends.push(send);
									}
									return {
										...t,
										audio: { ...curAudio, sends }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioPhaseInvert(trackId, phaseInvert) {
					try {
						mutateProject(
							'Toggle track phase invert',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, phaseInvert }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioSoloSafe(trackId, soloSafe) {
					try {
						mutateProject(
							'Toggle track solo safe',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, soloSafe }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioChannelMode(trackId, channelMode) {
					try {
						mutateProject(
							'Change track channel mode',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, channelMode }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTrackAudioEffects(trackId, effects) {
					try {
						mutateProject(
							'Update track audio effects',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => {
									if (t.id !== trackId) return t;
									const curAudio = t.audio ?? defaultTrackAudio();
									return {
										...t,
										audio: { ...curAudio, effects }
									};
								})
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setBusAudioEffects(busId, effects) {
					try {
						mutateProject(
							'Update bus audio effects',
							(proj) => ({
								...proj,
								audioBuses: (proj.audioBuses ?? []).map((b) =>
									b.id === busId ? { ...b, effects } : b
								)
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setMasterAudioEffects(effects) {
					try {
						mutateProject(
							'Update master audio effects',
							(proj) => ({
								...proj,
								masterAudio: {
									...(proj.masterAudio ?? { gainDb: 0, limiter: false }),
									effects
								}
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setAutomationMode(targetType, targetId, mode) {
					try {
						mutateProject(
							'Set automation mode',
							(proj) => {
								if (targetType === 'master') {
									return {
										...proj,
										masterAudio: {
											...(proj.masterAudio ?? { gainDb: 0, limiter: false }),
											automationMode: mode
										}
									};
								} else if (targetType === 'bus') {
									return {
										...proj,
										audioBuses: (proj.audioBuses ?? []).map((b) =>
											b.id === targetId ? { ...b, automationMode: mode } : b
										)
									};
								} else {
									return {
										...proj,
										tracks: proj.tracks.map((t) => {
											if (t.id !== targetId) return t;
											const curAudio = t.audio ?? defaultTrackAudio();
											return {
												...t,
												audio: { ...curAudio, automationMode: mode }
											};
										})
									};
								}
							},
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setClipAudioTag(clipId, tag) {
					try {
						mutateProject(
							'Set audio tag',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? { ...clip, audioTag: tag } : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setClipAudioEffects(clipId, effects) {
					try {
						mutateProject(
							'Update clip audio effects',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) =>
										clip.id === clipId ? { ...clip, audioEffects: effects } : clip
									)
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				applyAutoDucking(targetClipId) {
					const project = get().project;
					if (!project) return false;

					let targetClip: Clip | null = null;
					const dialogueClips: Clip[] = [];

					for (const track of project.tracks) {
						for (const clip of track.clips) {
							if (clip.id === targetClipId) {
								targetClip = clip;
							}
							if (clip.audioTag === 'dialogue') {
								dialogueClips.push(clip);
							}
						}
					}

					if (!targetClip || dialogueClips.length === 0) return false;

					const vadSegments = detectVoiceActivity(dialogueClips);
					const keyframes = generateDuckingKeyframes(targetClip, vadSegments);

					try {
						mutateProject(
							'Apply auto-ducking',
							(proj) => ({
								...proj,
								tracks: proj.tracks.map((track) => ({
									...track,
									clips: track.clips.map((clip) => {
										if (clip.id !== targetClipId) return clip;
										return {
											...clip,
											properties: {
												...(clip.properties ?? {}),
												'audio.volume': { keyframes }
											}
										};
									})
								}))
							}),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setClipFade(clipId, fade) {
					try {
						mutateProject(
							'Update clip fade',
							scoped((proj) => ({
								...proj,
								tracks: proj.tracks.map((t) => ({
									...t,
									clips: t.clips.map((c) => {
										if (c.id !== clipId) return c;
										return {
											...c,
											...(fade.fadeInUs !== undefined ? { fadeInUs: fade.fadeInUs } : {}),
											...(fade.fadeOutUs !== undefined ? { fadeOutUs: fade.fadeOutUs } : {}),
											...(fade.fadeCurve !== undefined ? { fadeCurve: fade.fadeCurve } : {})
										};
									})
								}))
							})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				editingTextClipId: null,
				setEditingTextClipId(clipId) {
					set((state) => {
						state.editingTextClipId = clipId;
					});
				},

				addTextClip(options) {
					const project = get().project;
					if (!project) return null;
					const activeSeqId = get().activeSequenceId;
					const activeView = viewProject(project, activeSeqId);
					const clipStart = snapToFrame(get().timeline.playhead, activeView.settings.fps);
					const clipDuration = framesToTicks(5 * activeView.settings.fps, activeView.settings.fps);

					const selTrackId =
						get().timeline.selection.trackId ??
						(get().timeline.selection.clipIds.length > 0
							? activeView.tracks.find((t) =>
									t.clips.some((c) => get().timeline.selection.clipIds.includes(c.id))
								)?.id
							: undefined);
					const unlockedVideoTracks = activeView.tracks.filter(
						(t) => t.kind === 'video' && !t.locked
					);
					const hasOverlapAt = (t: Track) =>
						t.clips.some(
							(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
						);

					let targetTrackId: TrackId | null = null;
					if (selTrackId) {
						const selTrack = unlockedVideoTracks.find((t) => t.id === selTrackId);
						if (selTrack && !hasOverlapAt(selTrack)) {
							targetTrackId = selTrack.id;
						}
					}
					if (!targetTrackId) {
						const candidates = unlockedVideoTracks.slice().reverse();
						const availableTrack = candidates.find((t) => !hasOverlapAt(t));
						if (availableTrack) {
							targetTrackId = availableTrack.id;
						}
					}

					let createdClipId: ClipId | null = null;
					try {
						mutateProject(
							'Add text clip',
							(proj) => {
								return applyToSequence(proj, activeSeqId, (view) => {
									let currentView = view;
									let trackToUse = targetTrackId
										? currentView.tracks.find(
												(t) => t.id === targetTrackId && t.kind === 'video' && !t.locked
											)
										: undefined;
									if (
										trackToUse &&
										trackToUse.clips.some(
											(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
										)
									) {
										trackToUse = undefined;
									}
									if (!trackToUse) {
										const candidates = currentView.tracks
											.filter((t) => t.kind === 'video' && !t.locked)
											.slice()
											.reverse();
										trackToUse = candidates.find(
											(t) =>
												!t.clips.some(
													(c) =>
														c.start < clipStart + clipDuration && c.start + c.duration > clipStart
												)
										);
									}
									if (!trackToUse) {
										const prevIds = new Set(currentView.tracks.map((t) => t.id));
										currentView = addTrackOperation(currentView, 'video');
										trackToUse = currentView.tracks.find(
											(t) => !prevIds.has(t.id) && t.kind === 'video'
										);
									}
									const clip = createTextClip(
										clipStart,
										clipDuration,
										options?.text ?? 'Title Text'
									);
									createdClipId = clip.id;
									return insertClip(currentView, trackToUse!.id, clip);
								});
							},
							{ history: 'record' }
						);
						if (createdClipId) {
							get().selectClips([createdClipId]);
						}
						return createdClipId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},

				addShapeClip(configOrOptions, placement) {
					const options = { ...configOrOptions, ...placement };
					const project = get().project;
					if (!project) return null;
					const activeSeqId = get().activeSequenceId;
					const activeView = viewProject(project, activeSeqId);
					const clipStart =
						options?.start !== undefined
							? snapToFrame(options.start, activeView.settings.fps)
							: snapToFrame(get().timeline.playhead, activeView.settings.fps);
					const clipDuration =
						options?.duration !== undefined
							? options.duration
							: framesToTicks(5 * activeView.settings.fps, activeView.settings.fps);

					const selTrackId =
						options?.trackId ??
						get().timeline.selection.trackId ??
						(get().timeline.selection.clipIds.length > 0
							? activeView.tracks.find((t) =>
									t.clips.some((c) => get().timeline.selection.clipIds.includes(c.id))
								)?.id
							: undefined);
					const unlockedVideoTracks = activeView.tracks.filter(
						(t) => t.kind === 'video' && !t.locked
					);
					const hasOverlapAt = (t: Track) =>
						t.clips.some(
							(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
						);

					let targetTrackId: TrackId | null = null;
					if (selTrackId) {
						const selTrack = unlockedVideoTracks.find((t) => t.id === selTrackId);
						if (selTrack && !hasOverlapAt(selTrack)) {
							targetTrackId = selTrack.id;
						}
					}
					if (!targetTrackId) {
						const candidates = unlockedVideoTracks.slice().reverse();
						const availableTrack = candidates.find((t) => !hasOverlapAt(t));
						if (availableTrack) {
							targetTrackId = availableTrack.id;
						}
					}

					let createdClipId: ClipId | null = null;
					try {
						mutateProject(
							'Add shape clip',
							(proj) => {
								return applyToSequence(proj, activeSeqId, (view) => {
									let currentView = view;
									let trackToUse = targetTrackId
										? currentView.tracks.find(
												(t) => t.id === targetTrackId && t.kind === 'video' && !t.locked
											)
										: undefined;
									if (
										trackToUse &&
										trackToUse.clips.some(
											(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
										)
									) {
										trackToUse = undefined;
									}
									if (!trackToUse) {
										const candidates = currentView.tracks
											.filter((t) => t.kind === 'video' && !t.locked)
											.slice()
											.reverse();
										trackToUse = candidates.find(
											(t) =>
												!t.clips.some(
													(c) =>
														c.start < clipStart + clipDuration && c.start + c.duration > clipStart
												)
										);
									}
									if (!trackToUse) {
										const prevIds = new Set(currentView.tracks.map((t) => t.id));
										currentView = addTrackOperation(currentView, 'video');
										trackToUse = currentView.tracks.find(
											(t) => !prevIds.has(t.id) && t.kind === 'video'
										);
									}
									const clip = createShapeClip(clipStart, clipDuration, options);
									createdClipId = clip.id;
									return insertClip(currentView, trackToUse!.id, clip);
								});
							},
							{ history: 'record' }
						);
						if (createdClipId) {
							get().selectClips([createdClipId]);
						}
						return createdClipId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},

				updateShapeProperties(clipId, updates) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update shape properties',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'shape') return c;
											const currentSource = c.source;
											const newSource = {
												...currentSource,
												...updates
											};
											// Keep the property the renderer reads in step with the source. A property that is
											// animated stays animated: the edit becomes a keyframe at the playhead.
											const mirrored: Array<[PropertyId, number | number[]]> = [];
											const rgba = (color: { r: number; g: number; b: number; a: number }) => [
												color.r,
												color.g,
												color.b,
												color.a
											];
											if (updates.width !== undefined)
												mirrored.push(['shape.width', updates.width]);
											if (updates.height !== undefined)
												mirrored.push(['shape.height', updates.height]);
											if (updates.fillColor !== undefined)
												mirrored.push(['shape.fillColor', rgba(updates.fillColor)]);
											if (updates.strokeColor !== undefined) {
												mirrored.push(['shape.strokeColor', rgba(updates.strokeColor)]);
											}
											if (updates.strokeWidth !== undefined)
												mirrored.push(['shape.strokeWidth', updates.strokeWidth]);
											if (updates.cornerRadius !== undefined) {
												mirrored.push(['shape.cornerRadius', updates.cornerRadius]);
											}
											const localTime = get().timeline.playhead - c.start;
											let next: Clip = { ...c, source: newSource, properties: { ...c.properties } };
											for (const [id, value] of mirrored) {
												const current = propertyCurve(next, id);
												next =
													current && isAnimated(current)
														? setPropertyAtTime(next, id, localTime, value, {
																autoKey: true,
																fps: view.settings.fps
															})
														: { ...next, properties: { ...next.properties, [id]: { value } } };
											}
											return next;
										})
									}))
								})),
							{ history: 'record', mergeKey: `shape-edit-${clipId}`, coalesceWindowMs: 400 }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTextContent(clipId, text) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update text content',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'text') return c;
											const tplId = c.source.graphicTemplateId;
											const tpl = tplId ? getGraphicTemplate(tplId) : undefined;
											const currentAccent = c.source.colorRuns?.[0]?.fillColor;
											const colorRuns = tpl
												? computeColorRuns(text, tpl, currentAccent)
												: c.source.colorRuns;
											return {
												...c,
												text,
												source: {
													...c.source,
													text,
													colorRuns
												}
											};
										})
									}))
								})),
							{ history: 'record', mergeKey: `text-edit-${clipId}`, coalesceWindowMs: 1200 }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTextStyle(clipId, style) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update text style',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'text') return c;
											return {
												...c,
												source: {
													...c.source,
													style: {
														...(c.source.style ?? { fontFamily: 'sans-serif' }),
														...style
													}
												}
											};
										})
									}))
								})),
							{ history: 'record', mergeKey: `text-style-${clipId}` }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTextBox(clipId, box) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update text box',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'text') return c;
											return {
												...c,
												source: {
													...c.source,
													box: {
														...(c.source.box ?? {}),
														...box
													}
												}
											};
										})
									}))
								})),
							{ history: 'record', mergeKey: `text-box-${clipId}` }
						);
						return true;
					} catch {
						return false;
					}
				},

				applyTextTemplate(clipId, templateId) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Apply text template',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'text') return c;
											return applyTextTemplatePreset(c, templateId, true);
										})
									}))
								})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				applyTextAnimation(clipId, presetId) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Apply text animation',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'text') return c;
											const textSrc = c.source;
											const animPreset = GRAPHIC_ANIMATION_PRESETS.find((a) => a.id === presetId);
											if (animPreset) {
												const baseTime =
													animPreset.kind === 'out'
														? Math.max(0, c.duration - animPreset.duration)
														: 0;
												const animated = applyAnimationPresetToClip(c, animPreset, baseTime);
												return {
													...animated,
													source: {
														...textSrc,
														animationPresetId: presetId
													}
												};
											}
											const animated = applyTextAnimationPreset(c, presetId);
											return {
												...animated,
												source: {
													...textSrc,
													animationPresetId: presetId
												}
											};
										})
									}))
								})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				clearTextAnimations(clipId) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Clear text animations',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'text') return c;
											const textSrc = c.source;
											const cleared = clearTextAnimations(c);
											return {
												...cleared,
												source: {
													...textSrc,
													animationPresetId: undefined
												}
											};
										})
									}))
								})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				addGraphicClip(templateId, options) {
					const activeSeqId = get().activeSequenceId;
					const project = get().project;
					if (!project) return null;
					const activeView = viewProject(project, activeSeqId);
					if (!activeView) return null;

					const clipStart = snapToFrame(
						options?.start ?? get().timeline.playhead,
						activeView.settings.fps
					);
					const clipDuration =
						options?.duration ??
						framesToTicks(5 * activeView.settings.fps, activeView.settings.fps);

					const selTrackId =
						options?.trackId ??
						get().timeline.selection.trackId ??
						(get().timeline.selection.clipIds.length > 0
							? activeView.tracks.find((t) =>
									t.clips.some((c) => get().timeline.selection.clipIds.includes(c.id))
								)?.id
							: undefined);
					const unlockedVideoTracks = activeView.tracks.filter(
						(t) => t.kind === 'video' && !t.locked
					);
					const hasOverlapAt = (t: Track) =>
						t.clips.some(
							(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
						);

					let targetTrackId: TrackId | null = null;
					if (selTrackId) {
						const selTrack = unlockedVideoTracks.find((t) => t.id === selTrackId);
						if (selTrack && !hasOverlapAt(selTrack)) {
							targetTrackId = selTrack.id;
						}
					}
					if (!targetTrackId) {
						const candidates = unlockedVideoTracks.slice().reverse();
						const availableTrack = candidates.find((t) => !hasOverlapAt(t));
						if (availableTrack) {
							targetTrackId = availableTrack.id;
						}
					}

					let createdClipId: ClipId | null = null;
					try {
						mutateProject(
							'Add graphic title',
							(proj) => {
								return applyToSequence(proj, activeSeqId, (view) => {
									let currentView = view;
									let trackToUse = targetTrackId
										? currentView.tracks.find(
												(t) => t.id === targetTrackId && t.kind === 'video' && !t.locked
											)
										: undefined;
									if (
										trackToUse &&
										trackToUse.clips.some(
											(c) => c.start < clipStart + clipDuration && c.start + c.duration > clipStart
										)
									) {
										trackToUse = undefined;
									}
									if (!trackToUse) {
										const candidates = currentView.tracks
											.filter((t) => t.kind === 'video' && !t.locked)
											.slice()
											.reverse();
										trackToUse = candidates.find(
											(t) =>
												!t.clips.some(
													(c) =>
														c.start < clipStart + clipDuration && c.start + c.duration > clipStart
												)
										);
									}
									if (!trackToUse) {
										const prevIds = new Set(currentView.tracks.map((t) => t.id));
										currentView = addTrackOperation(currentView, 'video');
										trackToUse = currentView.tracks.find(
											(t) => !prevIds.has(t.id) && t.kind === 'video'
										);
									}
									const clip = createGraphicClip(
										templateId,
										clipStart,
										clipDuration,
										options?.text
									);
									createdClipId = clip.id;
									return insertClip(currentView, trackToUse!.id, clip);
								});
							},
							{ history: 'record' }
						);
						if (createdClipId) {
							get().selectClips([createdClipId]);
							projectHistory.updateSelectionAfter([createdClipId]);
						}
						return createdClipId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},

				applyGraphicTemplate(clipId, templateId, customText) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Apply graphic template',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'text') return c;
											return applyGraphicTemplateToClip(c, templateId, customText);
										})
									}))
								})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				setGraphicAccentColor(clipId, color) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update graphic accent color',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'text') return c;
											const tplId = c.source.graphicTemplateId;
											const tpl = tplId ? getGraphicTemplate(tplId) : undefined;
											const text = c.source.text || '';
											const colorRuns = tpl?.highlightWord
												? computeColorRuns(text, tpl, color)
												: c.source.colorRuns && c.source.colorRuns.length > 0
													? c.source.colorRuns.map((r) => ({ ...r, fillColor: color }))
													: [];
											const box = c.source.box
												? { ...c.source.box, accentBarColor: color }
												: undefined;
											const properties = {
												...(c.properties || {}),
												'text.accentBarColor': { value: [color.r, color.g, color.b, color.a ?? 1] }
											};
											return {
												...c,
												properties,
												source: {
													...c.source,
													...(box ? { box } : {}),
													colorRuns
												}
											};
										})
									}))
								})),
							{ history: 'record', mergeKey: `graphic-accent-${clipId}` }
						);
						return true;
					} catch {
						return false;
					}
				},

				setSolidColor(clipId, color) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update solid color',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'solid') return c;
											return {
												...c,
												source: {
													...c.source,
													color: {
														r: color.r,
														g: color.g,
														b: color.b,
														a: color.a ?? 1
													}
												}
											};
										})
									}))
								})),
							{ history: 'record', mergeKey: `solid-color-${clipId}` }
						);
						return true;
					} catch {
						return false;
					}
				},

				setSolidGradient(clipId, options) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update solid gradient',
							(proj) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'solid') return c;
											return {
												...c,
												source: {
													...c.source,
													...options
												}
											};
										})
									}))
								})),
							{ history: 'record', mergeKey: `solid-gradient-${clipId}` }
						);
						return true;
					} catch {
						return false;
					}
				},

				setTextGradient(clipId, options) {
					return get().setTextBox(clipId, options);
				},

				setProjectProxySettings(settings) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject(
							'Update proxy settings',
							(proj) => ({
								...proj,
								proxy: {
									...(proj.proxy ?? { enabled: false, targetHeight: 540, auto: 'large' }),
									...settings
								}
							}),
							{ history: 'record' }
						);
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},

				toggleProxiesEnabled() {
					const project = get().project;
					if (!project) return false;
					const currentlyEnabled = project.proxy?.enabled ?? false;
					return get().setProjectProxySettings({ enabled: !currentlyEnabled });
				},

				createProxy(assetId) {
					const project = get().project;
					if (!project) return;
					const asset = project.assets[assetId];
					if (!asset || asset.offline || asset.kind !== 'video') return;

					// Wire proxy service callbacks to mutateProject with history: 'skip'
					proxyService.setProject(project, {
						onStatusChange(id, proxyUpdates) {
							mutateProject(
								'Update proxy status',
								(proj) => {
									const currentAsset = proj.assets[id];
									if (!currentAsset) return proj;
									return {
										...proj,
										assets: {
											...proj.assets,
											[id]: {
												...currentAsset,
												proxy: {
													...(currentAsset.proxy ?? {
														opfsPath: '',
														width: 0,
														height: 0,
														status: 'queued'
													}),
													...proxyUpdates
												}
											}
										}
									};
								},
								{ history: 'skip' }
							);
						}
					});

					proxyService.enqueue([assetId]);
				},

				createAllProxies() {
					const project = get().project;
					if (!project) return;
					const videoAssetIds = Object.values(project.assets)
						.filter((a) => a.kind === 'video' && !a.offline)
						.map((a) => a.id);
					if (videoAssetIds.length === 0) return;

					proxyService.setProject(project, {
						onStatusChange(id, proxyUpdates) {
							mutateProject(
								'Update proxy status',
								(proj) => {
									const currentAsset = proj.assets[id];
									if (!currentAsset) return proj;
									return {
										...proj,
										assets: {
											...proj.assets,
											[id]: {
												...currentAsset,
												proxy: {
													...(currentAsset.proxy ?? {
														opfsPath: '',
														width: 0,
														height: 0,
														status: 'queued'
													}),
													...proxyUpdates
												}
											}
										}
									};
								},
								{ history: 'skip' }
							);
						}
					});

					proxyService.enqueue(videoAssetIds);
				},

				async deleteProxy(assetId) {
					const project = get().project;
					if (!project) return false;
					proxyService.cancel(assetId);
					await deleteProxyFile(project.id, assetId);
					mutateProject(
						'Delete proxy',
						(proj) => {
							const currentAsset = proj.assets[assetId];
							if (!currentAsset) return proj;
							const updated = { ...currentAsset };
							delete updated.proxy;
							return {
								...proj,
								assets: {
									...proj.assets,
									[assetId]: updated
								}
							};
						},
						{ history: 'skip' }
					);
					return true;
				},

				async deleteAllProxies() {
					const project = get().project;
					if (!project) return false;
					proxyService.cancelAll();
					for (const asset of Object.values(project.assets)) {
						if (asset.proxy) {
							await deleteProxyFile(project.id, asset.id);
						}
					}
					mutateProject(
						'Delete all proxies',
						(proj) => {
							const assets = { ...proj.assets };
							for (const [id, a] of Object.entries(assets)) {
								if (a.proxy) {
									const clone = { ...a };
									delete clone.proxy;
									assets[id as AssetId] = clone;
								}
							}
							return { ...proj, assets };
						},
						{ history: 'skip' }
					);
					return true;
				},

				cancelProxyGeneration(assetId) {
					proxyService.cancel(assetId);
				},

				retryProxyGeneration(assetId) {
					get().createProxy(assetId);
				},

				dismissProxySuggestion(neverAsk = false) {
					if (neverAsk) {
						get().setProjectProxySettings({ auto: 'off' });
					}
					set((state) => {
						state.proxySuggestion = null;
					});
				},

				acceptProxySuggestion() {
					const suggestion = get().proxySuggestion;
					if (suggestion) {
						get().createProxy(suggestion.assetId);
					}
					set((state) => {
						state.proxySuggestion = null;
					});
				},

				openSequence(id) {
					const project = get().project;
					if (!project) return;
					if (id !== ROOT_SEQUENCE_ID && (!project.sequences || !project.sequences[id])) {
						return;
					}
					const currentActive = get().activeSequenceId;
					if (currentActive === id) return;
					const currentPlayhead = get().timeline.playhead;
					const savedPlayheads: Record<SequenceId, Time> = {
						...get().sequencePlayheads,
						[currentActive]: currentPlayhead
					};
					const targetPlayhead = savedPlayheads[id] ?? 0;
					const targetName =
						id === ROOT_SEQUENCE_ID
							? project.name || 'Main Timeline'
							: (project.sequences?.[id]?.name ?? 'Nested Sequence');
					set((state) => {
						state.activeSequenceId = id;
						state.sequencePlayheads = savedPlayheads;
						state.timeline.playhead = targetPlayhead;
						state.timeline.selection = { clipIds: [] };
						state.timeline.drag = null;
						state.timeline.message = `Opened sequence "${targetName}".`;
					});
				},

				closeSequence() {
					get().openSequence(ROOT_SEQUENCE_ID);
				},

				createSequence(name, settings) {
					const project = get().project;
					if (!project) return null;
					try {
						let createdId: SequenceId | null = null;
						mutateProject(
							'Create sequence',
							(p) => {
								const result = createSequenceOp(p, name, settings);
								createdId = result.sequenceId;
								return result.project;
							},
							{ history: 'record' }
						);
						return createdId;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return null;
					}
				},

				deleteSequence(id, removeInstances = false) {
					const project = get().project;
					if (!project) return false;
					if (id === ROOT_SEQUENCE_ID) return false;
					if (get().activeSequenceId === id) {
						get().closeSequence();
					}
					try {
						mutateProject('Delete sequence', (p) => deleteSequenceOp(p, id, removeInstances), {
							history: 'record'
						});
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},

				renameSequence(id, name) {
					const project = get().project;
					if (!project) return false;
					try {
						mutateProject('Rename sequence', (p) => renameSequenceOp(p, id, name), {
							history: 'record'
						});
						return true;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return false;
					}
				},

				duplicateSequence(id) {
					const project = get().project;
					if (!project) return null;
					try {
						let duplicatedId: SequenceId | null = null;
						mutateProject(
							'Duplicate sequence',
							(p) => {
								const result = duplicateSequenceOp(p, id);
								duplicatedId = result.newSequenceId;
								return result.project;
							},
							{ history: 'record' }
						);
						return duplicatedId;
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
						return null;
					}
				},

				nestSelection(name) {
					const project = get().project;
					if (!project) return null;
					const clipIds = get().timeline.selection.clipIds;
					if (clipIds.length === 0) return null;
					const activeSeqId = get().activeSequenceId;
					try {
						let instanceClipId: ClipId | null = null;
						mutateProject(
							'Nest clips',
							(p) => {
								const result = nestSelectionOp(p, activeSeqId, clipIds, name);
								instanceClipId = result.videoInstanceClipId ?? result.audioInstanceClipId ?? null;
								return result.project;
							},
							{ history: 'record' }
						);
						if (instanceClipId) {
							get().selectClips([instanceClipId]);
						}
						return instanceClipId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},

				expandSequenceInstance(clipId) {
					const project = get().project;
					if (!project) return false;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Expand sequence',
							(p) => expandSequenceInstanceOp(p, activeSeqId, clipId),
							{ history: 'record' }
						);
						get().clearSelection();
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},

				makeInstanceUnique(clipId) {
					const project = get().project;
					if (!project) return null;
					const activeSeqId = get().activeSequenceId;
					try {
						let newSeqId: SequenceId | null = null;
						mutateProject(
							'Make sequence unique',
							(p) => {
								const result = makeInstanceUniqueOp(p, activeSeqId, clipId);
								newSeqId = result.newSequenceId;
								return result.project;
							},
							{ history: 'record' }
						);
						return newSeqId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},

				addSequenceToTimeline(sequenceId, time, trackId) {
					const project = get().project;
					if (!project) return null;
					const activeSeqId = get().activeSequenceId;
					try {
						let createdClipId: ClipId | null = null;
						mutateProject(
							'Add sequence to timeline',
							(p) => {
								const result = addSequenceInstanceOp(
									p,
									activeSeqId,
									sequenceId,
									snapToFrame(time, p.settings.fps),
									trackId
								);
								createdClipId = result.videoClipId ?? result.audioClipId ?? null;
								return result.project;
							},
							{ history: 'record' }
						);
						if (createdClipId) {
							get().selectClips([createdClipId]);
						}
						return createdClipId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},

				openSequenceSettingsDialog(sequenceId) {
					const targetId = sequenceId ?? get().activeSequenceId;
					set((state) => {
						state.isSequenceSettingsDialogOpen = true;
						state.sequenceSettingsDialogId = targetId;
					});
				},

				closeSequenceSettingsDialog() {
					set((state) => {
						state.isSequenceSettingsDialogOpen = false;
						state.sequenceSettingsDialogId = null;
					});
				},

				updateSequenceSettings(sequenceId, settings) {
					const project = get().project;
					if (!project) return;
					try {
						mutateProject(
							'Update sequence settings',
							(p) => {
								if (isRootSequence(sequenceId)) {
									if (!settings) return p;
									return { ...p, settings: { ...p.settings, ...settings } };
								}
								const seq = p.sequences?.[sequenceId];
								if (!seq) return p;
								return {
									...p,
									sequences: {
										...p.sequences,
										[sequenceId]: {
											...seq,
											settings: settings
												? { ...(seq.settings ?? p.settings), ...settings }
												: undefined
										}
									}
								};
							},
							{ history: 'record' }
						);
					} catch (error) {
						set((state) => {
							state.projectMessage = errorMessage(error);
						});
					}
				},

				saveSelectionAsTemplate(options) {
					const project = get().project;
					if (!project) return null;
					const clipIds = get().timeline.selection.clipIds;
					if (clipIds.length === 0) return null;
					const activeSeqId = get().activeSequenceId;
					const activeView = viewProject(project, activeSeqId);
					const selectedClips = activeView.tracks
						.flatMap((t) => t.clips)
						.filter((c) => clipIds.includes(c.id));
					if (selectedClips.length === 0) return null;

					const publishedParams =
						options.publishedParams || detectPublishableProperties(selectedClips);

					try {
						const template = createTemplateFromClips({
							name: options.name,
							category: options.category,
							description: options.description,
							author: options.author,
							clips: selectedClips,
							tracks: activeView.tracks,
							publishedParams,
							projectSettings: activeView.settings,
							responsiveTiming: options.responsiveTiming
						});
						saveCustomTemplate(template);
						return template;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},

				instantiateTemplate(template, start, trackId) {
					const project = get().project;
					if (!project) return null;
					const activeSeqId = get().activeSequenceId;
					const playhead = snapToFrame(start ?? get().timeline.playhead, project.settings.fps);

					try {
						let createdId: ClipId | null = null;
						mutateProject(
							`Add template ${template.name}`,
							(p) => {
								const res = instantiateTemplateIntoProject(
									p,
									activeSeqId,
									template,
									playhead,
									trackId
								);
								createdId = res.instanceClipId;
								return res.project;
							},
							{ history: 'record' }
						);
						if (createdId) {
							get().selectClips([createdId]);
						}
						return createdId;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return null;
					}
				},

				setTemplateParamOverride(clipId, paramId, value) {
					const project = get().project;
					if (!project) return;
					const activeSeqId = get().activeSequenceId;

					try {
						mutateProject(
							'Update template property',
							(p) =>
								applyToSequence(p, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'sequence') return c;
											const currentOverrides = c.source.paramOverrides || {};
											return {
												...c,
												source: {
													...c.source,
													paramOverrides: {
														...currentOverrides,
														[paramId]: value
													}
												}
											};
										})
									}))
								})),
							{ history: 'record' }
						);
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
					}
				},

				resetTemplateParamOverrides(clipId) {
					const project = get().project;
					if (!project) return;
					const activeSeqId = get().activeSequenceId;

					try {
						mutateProject(
							'Reset template properties',
							(p) =>
								applyToSequence(p, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || c.source?.type !== 'sequence') return c;
											return {
												...c,
												source: {
													...c.source,
													paramOverrides: {}
												}
											};
										})
									}))
								})),
							{ history: 'record' }
						);
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
					}
				},

				unpackTemplateClip(clipId) {
					const project = get().project;
					if (!project) return false;
					const activeSeqId = get().activeSequenceId;

					try {
						mutateProject(
							'Unpack motion template',
							(p) => unpackTemplateInstanceClip(p, activeSeqId, clipId),
							{ history: 'record' }
						);
						get().clearSelection();
						return true;
					} catch (error) {
						set((state) => {
							state.timeline.message = errorMessage(error);
						});
						return false;
					}
				},

				switchWorkspace(workspaceId) {
					trackFeatureUsed('switch_workspace', { workspace: workspaceId });
					const currentWorkspaces = get().workspaces;
					const { workspace, layout } = resolveWorkspaceLayout(workspaceId, currentWorkspaces);
					const updatedState: UserWorkspaceState = {
						...currentWorkspaces,
						activeWorkspaceId: workspace.id
					};
					persistUserWorkspaceState(updatedState);

					// Apply the workspace's inspector defaults if it has any
					let nextExpanded = get().inspector.expanded;
					if (workspace.inspectorDefaults) {
						nextExpanded = { ...get().inspector.expanded, ...workspace.inspectorDefaults.expanded };
						persistInspectorPrefs({ ...get().inspector, expanded: nextExpanded });
					}

					set((state) => {
						state.workspaces = updatedState;
						state.activeWorkspaceId = workspace.id;
						state.activeLayout = layout;
						state.workspaceMessage = `Switched to ${workspace.name} workspace`;
						if (workspace.inspectorDefaults) {
							state.inspector.expanded = nextExpanded;
						}
					});
				},

				updateLayout(newLayout) {
					const activeId = get().activeWorkspaceId;
					const normalized = validateAndNormalizeLayout(newLayout);
					const currentWorkspaces = get().workspaces;
					const updatedOverrides = {
						...currentWorkspaces.overrides,
						[activeId]: normalized
					};
					const updatedState: UserWorkspaceState = {
						...currentWorkspaces,
						overrides: updatedOverrides
					};
					persistUserWorkspaceState(updatedState);
					set((state) => {
						state.workspaces = updatedState;
						state.activeLayout = normalized;
					});
				},

				resetWorkspaceLayout(workspaceId) {
					const targetId = workspaceId ?? get().activeWorkspaceId;
					const currentWorkspaces = get().workspaces;
					const updatedOverrides = { ...currentWorkspaces.overrides };
					delete updatedOverrides[targetId];
					const updatedState: UserWorkspaceState = {
						...currentWorkspaces,
						overrides: updatedOverrides
					};
					persistUserWorkspaceState(updatedState);
					const { layout } = resolveWorkspaceLayout(targetId, updatedState);
					set((state) => {
						state.workspaces = updatedState;
						if (targetId === state.activeWorkspaceId) {
							state.activeLayout = layout;
							state.workspaceMessage = `Reset ${targetId} layout to default`;
						}
					});
				},

				saveAsNewWorkspace(name) {
					const trimmed = name.trim();
					if (!trimmed) return null;
					const id = `custom-${Date.now()}`;
					const currentLayout = get().activeLayout;
					const newWs: Workspace = {
						id,
						name: trimmed,
						builtIn: false,
						layout: structuredClone(currentLayout)
					};
					const currentWorkspaces = get().workspaces;
					const updatedState: UserWorkspaceState = {
						...currentWorkspaces,
						activeWorkspaceId: id,
						custom: [...currentWorkspaces.custom, newWs],
						order: [...currentWorkspaces.order, id]
					};
					persistUserWorkspaceState(updatedState);
					set((state) => {
						state.workspaces = updatedState;
						state.activeWorkspaceId = id;
						state.workspaceMessage = `Saved workspace ${trimmed}`;
					});
					return id;
				},

				deleteCustomWorkspace(workspaceId) {
					const currentWorkspaces = get().workspaces;
					const exists = currentWorkspaces.custom.some((w) => w.id === workspaceId);
					if (!exists) return false;
					const updatedCustom = currentWorkspaces.custom.filter((w) => w.id !== workspaceId);
					const updatedOrder = currentWorkspaces.order.filter((id) => id !== workspaceId);
					const updatedOverrides = { ...currentWorkspaces.overrides };
					delete updatedOverrides[workspaceId];
					const nextActive =
						currentWorkspaces.activeWorkspaceId === workspaceId
							? 'editing'
							: currentWorkspaces.activeWorkspaceId;
					const updatedState: UserWorkspaceState = {
						...currentWorkspaces,
						activeWorkspaceId: nextActive,
						custom: updatedCustom,
						order: updatedOrder,
						overrides: updatedOverrides
					};
					persistUserWorkspaceState(updatedState);
					const { layout } = resolveWorkspaceLayout(nextActive, updatedState);
					set((state) => {
						state.workspaces = updatedState;
						state.activeWorkspaceId = nextActive;
						state.activeLayout = layout;
						state.workspaceMessage = `Deleted custom workspace`;
					});
					return true;
				},

				renameCustomWorkspace(workspaceId, newName) {
					const trimmed = newName.trim();
					if (!trimmed) return false;
					const currentWorkspaces = get().workspaces;
					const customWs = currentWorkspaces.custom.find((w) => w.id === workspaceId);
					if (!customWs) return false;
					const updatedCustom = currentWorkspaces.custom.map((w) =>
						w.id === workspaceId ? { ...w, name: trimmed } : w
					);
					const updatedState: UserWorkspaceState = {
						...currentWorkspaces,
						custom: updatedCustom
					};
					persistUserWorkspaceState(updatedState);
					set((state) => {
						state.workspaces = updatedState;
					});
					return true;
				},

				reorderWorkspaces(order) {
					const currentWorkspaces = get().workspaces;
					const updatedState: UserWorkspaceState = {
						...currentWorkspaces,
						order
					};
					persistUserWorkspaceState(updatedState);
					set((state) => {
						state.workspaces = updatedState;
					});
				},

				togglePanelVisibility(panelId) {
					const currentLayout = get().activeLayout;
					const panels = collectPanels(currentLayout);
					const isVisible = panels.includes(panelId);
					const updatedLayout = setPanelVisible(currentLayout, panelId, !isVisible);
					get().updateLayout(updatedLayout);
				},

				toggleMaximizePanel(panelId) {
					set((state) => {
						if (!panelId || state.maximizedPanelId === panelId) {
							state.maximizedPanelId = null;
						} else {
							state.maximizedPanelId = panelId;
						}
					});
				},

				// Tracking state & actions
				selectedTrackerId: null,
				isTrackingActive: false,
				trackingProgress: null,

				selectTracker(trackerId) {
					set((state) => {
						state.selectedTrackerId = trackerId;
					});
				},

				addTracker(clipId, type = 'point', initialRegion) {
					const project = get().project;
					if (!project) return null;
					const activeSeqId = get().activeSequenceId;
					const activeProj = viewProject(project, activeSeqId);
					const trackerId =
						`trk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` as TrackerId;

					const defaultRegion: TrackerRegion = {
						x: initialRegion?.x ?? 0.5,
						y: initialRegion?.y ?? 0.5,
						width: initialRegion?.width ?? 0.08,
						height: initialRegion?.height ?? 0.08,
						searchMultiplier: initialRegion?.searchMultiplier ?? 2.5
					};

					let targetClip: Clip | null = null;
					for (const track of activeProj.tracks) {
						for (const c of track.clips) {
							if (c.id === clipId) targetClip = c;
						}
					}
					const seedSourceTime = targetClip ? targetClip.sourceIn : 0;

					const newTracker: Tracker = {
						id: trackerId,
						name: `Tracker ${trackerId.slice(-4)}`,
						type,
						enabled: true,
						seedTime: seedSourceTime,
						initialRegion: defaultRegion,
						params: {
							trackTranslation: true,
							trackRotation: type !== 'point',
							trackScale: true,
							pyramidLevels: 4,
							searchRadiusPx: 64,
							maxIterations: 25,
							tolerance: 0.005,
							nccThreshold: 0.5,
							huberThreshold: 0.1,
							confidenceThreshold: 0.4
						},
						samples: []
					};

					try {
						mutateProject(
							'Add tracker',
							(proj: Project) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId) return c;
											return {
												...c,
												trackers: [...(c.trackers ?? []), newTracker]
											};
										})
									}))
								})),
							{ history: 'record' }
						);
						set((state) => {
							state.selectedTrackerId = trackerId;
						});
						return trackerId;
					} catch {
						return null;
					}
				},

				removeTracker(clipId, trackerId) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Remove tracker',
							(proj: Project) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || !c.trackers) return c;
											return {
												...c,
												trackers: c.trackers.filter((t) => t.id !== trackerId)
											};
										})
									}))
								})),
							{ history: 'record' }
						);
						set((state) => {
							if (state.selectedTrackerId === trackerId) {
								state.selectedTrackerId = null;
							}
						});
						return true;
					} catch {
						return false;
					}
				},

				updateTracker(clipId, trackerId, patch) {
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update tracker',
							(proj: Project) =>
								applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									tracks: view.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId || !c.trackers) return c;
											return {
												...c,
												trackers: c.trackers.map((t) =>
													t.id === trackerId ? { ...t, ...patch } : t
												)
											};
										})
									}))
								})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},

				async startTracking(clipId, trackerId, direction) {
					const project = get().project;
					if (!project || get().isTrackingActive) return false;
					const activeSeqId = get().activeSequenceId;
					const activeProj = viewProject(project, activeSeqId);

					let targetClip: Clip | null = null;
					for (const track of activeProj.tracks) {
						const found = track.clips.find((c) => c.id === clipId);
						if (found) {
							targetClip = found;
							break;
						}
					}
					if (!targetClip || !targetClip.assetId) return false;

					const asset = project.assets[targetClip.assetId];
					if (!asset) return false;

					const tracker = targetClip.trackers?.find((t) => t.id === trackerId);
					if (!tracker) return false;

					// Determine effective seed time and starting region based on direction & playhead position
					const playhead = get().timeline.playhead;
					const clipStart = targetClip.start;
					const clipEnd = targetClip.start + targetClip.duration;
					const speed = targetClip.speed ?? 1.0;
					const isPlayheadInsideClip = playhead >= clipStart && playhead <= clipEnd;
					const playheadSourceTime =
						targetClip.sourceIn + Math.round((playhead - clipStart) * speed);

					let effectiveSeedTime: number;
					if (direction === 'backward') {
						if (isPlayheadInsideClip && playheadSourceTime > targetClip.sourceIn) {
							effectiveSeedTime = Math.min(targetClip.sourceOut, playheadSourceTime);
						} else if (tracker.samples && tracker.samples.length > 0) {
							const minSampleTime = Math.min(...tracker.samples.map((s) => s.sourceTime));
							effectiveSeedTime =
								minSampleTime > targetClip.sourceIn ? minSampleTime : targetClip.sourceOut;
						} else {
							effectiveSeedTime = targetClip.sourceOut;
						}
					} else {
						// Forward tracking
						if (isPlayheadInsideClip && playheadSourceTime < targetClip.sourceOut) {
							effectiveSeedTime = Math.max(targetClip.sourceIn, playheadSourceTime);
						} else if (tracker.samples && tracker.samples.length > 0) {
							const maxSampleTime = Math.max(...tracker.samples.map((s) => s.sourceTime));
							effectiveSeedTime =
								maxSampleTime < targetClip.sourceOut ? maxSampleTime : targetClip.sourceIn;
						} else {
							effectiveSeedTime = targetClip.sourceIn;
						}
					}

					// Evaluate tracker state at effective seed time so tracking starts from current position & scale
					const seedState = evaluateTracker(tracker, effectiveSeedTime);
					const effectiveTracker: Tracker = {
						...tracker,
						seedTime: effectiveSeedTime,
						initialRegion: {
							...tracker.initialRegion,
							x: seedState.x,
							y: seedState.y
						}
					};

					set((state) => {
						state.isTrackingActive = true;
						state.trackingProgress = { processedFrames: 0, totalFrames: 1 };
					});

					try {
						const newSamples = await trackingService.track(
							project.id,
							asset,
							targetClip,
							effectiveTracker,
							direction,
							(prog) => {
								set((state) => {
									state.trackingProgress = {
										processedFrames: prog.processedFrames,
										totalFrames: prog.totalFrames
									};
								});
							}
						);

						// Merge new samples with any existing samples, deduplicating by sourceTime and sorting ascending
						const sampleMap = new Map<number, TrackerSample>();
						for (const s of tracker.samples ?? []) {
							sampleMap.set(s.sourceTime, s);
						}
						for (const s of newSamples) {
							sampleMap.set(s.sourceTime, s);
						}
						const mergedSamples = Array.from(sampleMap.values()).sort(
							(a, b) => a.sourceTime - b.sourceTime
						);

						get().updateTracker(clipId, trackerId, {
							seedTime: tracker.samples.length === 0 ? effectiveSeedTime : tracker.seedTime,
							samples: mergedSamples
						});
						return true;
					} catch (err) {
						console.error('Tracking error:', err);
						return false;
					} finally {
						set((state) => {
							state.isTrackingActive = false;
							state.trackingProgress = null;
						});
					}
				},

				async cancelTracking() {
					await trackingService.cancel();
					set((state) => {
						state.isTrackingActive = false;
						state.trackingProgress = null;
					});
				},

				bindToTracker(trackedClipId, trackerId, config) {
					const project = get().project;
					if (!project) return false;
					const activeSeqId = get().activeSequenceId;
					const activeProj = viewProject(project, activeSeqId);

					let trackedClip: Clip | null = null;
					let targetClip: Clip | null = null;

					for (const track of activeProj.tracks) {
						for (const c of track.clips) {
							if (c.id === trackedClipId) trackedClip = c;
							if (c.id === config.targetClipId) targetClip = c;
						}
					}

					if (!trackedClip || !targetClip) return false;
					const tracker = trackedClip.trackers?.find((t) => t.id === trackerId);
					if (!tracker) return false;

					const playhead = get().timeline.playhead;
					const offsets = captureBindingOffsets(
						project,
						trackedClip,
						targetClip,
						tracker,
						playhead,
						trackedClip.assetId ? (project.assets[trackedClip.assetId]?.width ?? 1920) : 1920,
						trackedClip.assetId ? (project.assets[trackedClip.assetId]?.height ?? 1080) : 1080
					);

					return get().updateTracker(trackedClipId, trackerId, {
						binding: {
							targetClipId: config.targetClipId,
							applyPosition: config.applyPosition,
							applyRotation: config.applyRotation,
							applyScale: config.applyScale,
							offsetPosition: offsets.offsetPosition,
							offsetRotation: offsets.offsetRotation,
							offsetScale: offsets.offsetScale
						}
					});
				},

				unbindTracker(trackedClipId, trackerId) {
					return get().updateTracker(trackedClipId, trackerId, {
						binding: undefined
					});
				},

				bakeTracker(trackedClipId, trackerId, thinningTolerancePx = 0.5) {
					const project = get().project;
					if (!project) return false;
					const activeSeqId = get().activeSequenceId;
					const activeProj = viewProject(project, activeSeqId);

					let trackedClip: Clip | null = null;
					let targetClip: Clip | null = null;

					for (const track of activeProj.tracks) {
						for (const c of track.clips) {
							if (c.id === trackedClipId) trackedClip = c;
						}
					}
					if (!trackedClip) return false;
					const tracker = trackedClip.trackers?.find((t) => t.id === trackerId);
					if (!tracker || !tracker.binding) return false;

					for (const track of activeProj.tracks) {
						for (const c of track.clips) {
							if (c.id === tracker.binding.targetClipId) targetClip = c;
						}
					}
					if (!targetClip) return false;

					const bakedProps = bakeTrackingToKeyframes(
						project,
						trackedClip,
						targetClip,
						tracker,
						thinningTolerancePx,
						trackedClip.assetId ? (project.assets[trackedClip.assetId]?.width ?? 1920) : 1920,
						trackedClip.assetId ? (project.assets[trackedClip.assetId]?.height ?? 1080) : 1080
					);

					try {
						mutateProject(
							'Bake tracking to keyframes',
							(proj: Project) =>
								applyToSequence(proj, activeSeqId, (seqView) => ({
									...seqView,
									tracks: seqView.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id === trackedClipId && c.trackers) {
												// Unbind live tracker upon baking
												return {
													...c,
													trackers: c.trackers.map((tr) =>
														tr.id === trackerId ? { ...tr, binding: undefined } : tr
													)
												};
											}
											if (c.id === targetClip.id) {
												const cleanBaked: Record<
													string,
													import('../core/types').AnimatedValue<unknown>
												> = {};
												for (const [k, v] of Object.entries(bakedProps)) {
													if (v !== undefined) {
														cleanBaked[k] = v;
													}
												}
												return {
													...c,
													properties: {
														...(c.properties ?? {}),
														...cleanBaked
													}
												};
											}
											return c;
										})
									}))
								})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},
				bakeTrackerToMask(clipId, maskId, trackerId, thinningTolerancePx = 0.5) {
					const project = get().project;
					if (!project) return false;
					const activeSeqId = get().activeSequenceId;
					const activeProj = viewProject(project, activeSeqId);

					let targetClip: Clip | null = null;
					for (const track of activeProj.tracks) {
						for (const c of track.clips) {
							if (c.id === clipId) targetClip = c;
						}
					}
					if (!targetClip) return false;
					const tracker = targetClip.trackers?.find((t) => t.id === trackerId);
					const mask = targetClip.masks?.find((m) => m.id === maskId);
					if (!tracker || !mask) return false;

					const fps = project.settings.fps;
					const width = targetClip.assetId
						? (project.assets[targetClip.assetId]?.width ?? 1920)
						: 1920;
					const height = targetClip.assetId
						? (project.assets[targetClip.assetId]?.height ?? 1080)
						: 1080;

					const bakedShape = bakeTrackingToMask(
						targetClip,
						maskId,
						tracker,
						fps,
						thinningTolerancePx,
						width,
						height
					);
					if (!bakedShape) return false;

					const shapePropId = `mask:${maskId}:shape` as PropertyId;

					try {
						mutateProject(
							'Bake tracking to mask shape',
							(proj: Project) =>
								applyToSequence(proj, activeSeqId, (seqView) => ({
									...seqView,
									tracks: seqView.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId) return c;
											return {
												...c,
												properties: {
													...(c.properties ?? {}),
													[shapePropId]: bakedShape
												}
											};
										})
									}))
								})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},
				stabilizeClip(clipId, trackerId, options) {
					const project = get().project;
					if (!project) return false;
					const activeSeqId = get().activeSequenceId;
					const activeProj = viewProject(project, activeSeqId);

					let targetClip: Clip | null = null;
					for (const track of activeProj.tracks) {
						for (const c of track.clips) {
							if (c.id === clipId) targetClip = c;
						}
					}
					if (!targetClip) return false;
					const tracker = targetClip.trackers?.find((t) => t.id === trackerId);
					if (!tracker || tracker.samples.length === 0) return false;

					const width = targetClip.assetId
						? (project.assets[targetClip.assetId]?.width ?? 1920)
						: 1920;
					const height = targetClip.assetId
						? (project.assets[targetClip.assetId]?.height ?? 1080)
						: 1080;

					const stabilization = computeStabilization(
						tracker.samples,
						width,
						height,
						targetClip.start,
						options
					);

					const updatedProperties = bakeStabilizationToClip(targetClip, stabilization);

					try {
						mutateProject(
							'Stabilize clip',
							(proj: Project) =>
								applyToSequence(proj, activeSeqId, (seqView) => ({
									...seqView,
									tracks: seqView.tracks.map((t) => ({
										...t,
										clips: t.clips.map((c) => {
											if (c.id !== clipId) return c;
											return {
												...c,
												properties: updatedProperties
											};
										})
									}))
								})),
							{ history: 'record' }
						);
						return true;
					} catch {
						return false;
					}
				},
				addMarker(options) {
					const project = get().project;
					if (!project) return null;
					const fps = project.settings.fps;
					const markerOpts =
						typeof options === 'number'
							? { time: options }
							: options && typeof options === 'object'
								? options
								: {};
					const time = markerOpts.time !== undefined ? markerOpts.time : get().timeline.playhead;
					const targetId: MarkerId = markerOpts.id ?? generateMarkerId();
					const activeSeqId = get().activeSequenceId;

					try {
						mutateProject(
							'Add marker',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => {
									const updated = addMarkerCore(
										view.markers,
										{
											...markerOpts,
											id: targetId,
											time
										},
										fps
									);
									return {
										...view,
										markers: updated
									};
								});
							},
							{ history: 'record' }
						);
					} catch {
						return null;
					}

					set((state) => {
						state.selectedMarkerId = targetId;
						state.selectedMarkerIds = [targetId];
					});
					return targetId;
				},
				updateMarker(id, patch, options) {
					const project = get().project;
					if (!project) return;
					const fps = project.settings.fps;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Update marker',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									markers: updateMarkerCore(view.markers, id, patch, fps)
								}));
							},
							{
								history: 'record',
								...(options?.coalesce ? { mergeKey: `marker:${id}:update` } : {})
							}
						);
					} catch {
						// ignore
					}
				},
				deleteMarker(id) {
					const project = get().project;
					if (!project) return;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Delete marker',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									markers: deleteMarkerCore(view.markers, id)
								}));
							},
							{ history: 'record' }
						);
						set((state) => {
							if (state.selectedMarkerId === id) state.selectedMarkerId = null;
							state.selectedMarkerIds = state.selectedMarkerIds.filter((mid) => mid !== id);
							if (state.editingMarkerId === id) {
								state.isMarkerDialogOpen = false;
								state.editingMarkerId = null;
							}
						});
					} catch {
						// ignore
					}
				},
				deleteMarkers(ids) {
					const project = get().project;
					if (!project || ids.length === 0) return;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Delete markers',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									markers: deleteMarkersCore(view.markers, ids)
								}));
							},
							{ history: 'record' }
						);
						set((state) => {
							const idSet = new Set(ids);
							if (state.selectedMarkerId && idSet.has(state.selectedMarkerId)) {
								state.selectedMarkerId = null;
							}
							state.selectedMarkerIds = state.selectedMarkerIds.filter((id) => !idSet.has(id));
							if (state.editingMarkerId && idSet.has(state.editingMarkerId)) {
								state.isMarkerDialogOpen = false;
								state.editingMarkerId = null;
							}
						});
					} catch {
						// ignore
					}
				},
				moveMarker(id, newTime, options) {
					const project = get().project;
					if (!project) return;
					const fps = project.settings.fps;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Move marker',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									markers: moveMarkerCore(view.markers, id, newTime, fps)
								}));
							},
							{
								history: 'record',
								...(options?.coalesce ? { mergeKey: `marker:${id}:move` } : {})
							}
						);
					} catch {
						// ignore
					}
				},
				setMarkerRange(id, duration) {
					const project = get().project;
					if (!project) return;
					const fps = project.settings.fps;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Set marker range',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									markers: convertMarkerRange(view.markers, id, duration, fps)
								}));
							},
							{ history: 'record' }
						);
					} catch {
						// ignore
					}
				},
				duplicateMarker(id) {
					const project = get().project;
					if (!project) return;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Duplicate marker',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									markers: duplicateMarkerCore(view.markers, id)
								}));
							},
							{ history: 'record' }
						);
					} catch {
						// ignore
					}
				},
				setMarkerColor(ids, color) {
					const project = get().project;
					const idList = Array.isArray(ids) ? ids : [ids];
					if (!project || idList.length === 0) return;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Set marker color',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									markers: setMarkerColorCore(view.markers, idList, color)
								}));
							},
							{ history: 'record' }
						);
					} catch {
						// ignore
					}
				},
				setMarkerType(ids, type) {
					const project = get().project;
					const idList = Array.isArray(ids) ? ids : [ids];
					if (!project || idList.length === 0) return;
					const activeSeqId = get().activeSequenceId;
					try {
						mutateProject(
							'Set marker type',
							(proj: Project) => {
								return applyToSequence(proj, activeSeqId, (view) => ({
									...view,
									markers: setMarkerTypeCore(view.markers, idList, type)
								}));
							},
							{ history: 'record' }
						);
					} catch {
						// ignore
					}
				},
				selectMarker(id, multi = false) {
					set((state) => {
						if (!id) {
							state.selectedMarkerId = null;
							state.selectedMarkerIds = [];
							return;
						}
						if (multi) {
							if (state.selectedMarkerIds.includes(id)) {
								state.selectedMarkerIds = state.selectedMarkerIds.filter((mid) => mid !== id);
								state.selectedMarkerId = state.selectedMarkerIds[0] ?? null;
							} else {
								state.selectedMarkerIds.push(id);
								state.selectedMarkerId = id;
							}
						} else {
							state.selectedMarkerId = id;
							state.selectedMarkerIds = [id];
						}
					});
				},
				clearMarkerSelection() {
					set((state) => {
						state.selectedMarkerId = null;
						state.selectedMarkerIds = [];
					});
				},
				seekToNextMarker() {
					const project = get().project;
					if (!project) return;
					const activeProj = viewProject(project, get().activeSequenceId);
					const currentPlayhead = get().timeline.playhead;
					const next = findNextMarker(activeProj.markers, currentPlayhead, { wrap: true });
					if (next) {
						get().setPlayhead(next.time);
						set((state) => {
							state.selectedMarkerId = next.id;
							state.selectedMarkerIds = [next.id];
						});
					}
				},
				seekToPrevMarker() {
					const project = get().project;
					if (!project) return;
					const activeProj = viewProject(project, get().activeSequenceId);
					const currentPlayhead = get().timeline.playhead;
					const prev = findPrevMarker(activeProj.markers, currentPlayhead, { wrap: true });
					if (prev) {
						get().setPlayhead(prev.time);
						set((state) => {
							state.selectedMarkerId = prev.id;
							state.selectedMarkerIds = [prev.id];
						});
					}
				},
				setSnapToMarkers(enabled) {
					set((state) => {
						state.timeline.snapToMarkers = enabled;
					});
				},
				openMarkerDialog(id) {
					const project = get().project;
					if (!project) return;
					const activeProj = viewProject(project, get().activeSequenceId);
					const targetId = id ?? get().selectedMarkerId;
					if (targetId) {
						set((state) => {
							state.editingMarkerId = targetId;
							state.isMarkerDialogOpen = true;
						});
					} else {
						const curPlayhead = get().timeline.playhead;
						const onMarker = activeProj.markers.find((m) => {
							const end = m.duration && m.duration > 0 ? m.time + m.duration : m.time;
							return curPlayhead >= m.time && curPlayhead <= end;
						});
						if (onMarker) {
							set((state) => {
								state.editingMarkerId = onMarker.id;
								state.selectedMarkerId = onMarker.id;
								state.selectedMarkerIds = [onMarker.id];
								state.isMarkerDialogOpen = true;
							});
						}
					}
				},
				closeMarkerDialog() {
					set((state) => {
						state.isMarkerDialogOpen = false;
						state.editingMarkerId = null;
					});
				},
				setSilenceOptions(opts) {
					set((state) => {
						state.ai.silenceOptions = {
							...state.ai.silenceOptions,
							...opts
						};
					});
					get().recomputeSilencesFromCache();
				},
				setDetectedSilences(silences) {
					set((state) => {
						state.ai.detectedSilences = silences;
					});
				},
				toggleSilenceIncluded(id) {
					set((state) => {
						const target = state.ai.detectedSilences.find((s) => s.id === id);
						if (target) {
							target.included = !target.included;
						}
					});
				},
				includeAllSilences(included) {
					set((state) => {
						for (const s of state.ai.detectedSilences) {
							s.included = included;
						}
					});
				},
				setSilenceVirtualPreview(active) {
					set((state) => {
						state.ai.virtualPreview = active;
					});
				},
				async analyzeSilence() {
					const project = get().project;
					if (!project) return;
					const activeSequenceId = get().activeSequenceId;
					const activeView = viewProject(project, activeSequenceId);
					const options = get().ai.silenceOptions;

					let targetTrackIds = options.trackIds;
					if (!targetTrackIds || targetTrackIds.length === 0) {
						targetTrackIds = activeView.tracks.filter((t) => t.kind === 'audio').map((t) => t.id);
					}

					set((state) => {
						state.ai.isAnalyzingSilence = true;
						state.ai.analysisProgress = 0;
					});

					try {
						const prepared = await prepareProjectAudioForStt(activeView, {
							trackIds: targetTrackIds,
							onProgress(ratio) {
								set((state) => {
									state.ai.analysisProgress = Math.round(ratio * 50);
								});
							}
						});

						if (prepared.samples.length === 0) {
							set((state) => {
								state.ai.isAnalyzingSilence = false;
								state.ai.detectedSilences = [];
								state.ai.cachedFeatures = null;
							});
							return;
						}

						const features = extractAudioFeatures(prepared.samples, prepared.sampleRate);
						const speechIntervals = detectSpeechIntervals(features, options);
						const timelineDur = timelineDuration(activeView);
						const result = computeSilenceRegions(
							speechIntervals,
							timelineDur,
							options,
							prepared.samples
						);

						const trackKey = targetTrackIds.sort().join(',') + '_' + prepared.samples.length;

						set((state) => {
							state.ai.isAnalyzingSilence = false;
							state.ai.analysisProgress = 100;
							state.ai.cachedFeatures = features;
							state.ai.cachedTrackKey = trackKey;
							state.ai.detectedSilences = result.silences;
						});
					} catch {
						set((state) => {
							state.ai.isAnalyzingSilence = false;
						});
					}
				},
				recomputeSilencesFromCache() {
					const features = get().ai.cachedFeatures;
					const project = get().project;
					if (!features || !project) return;
					const activeSequenceId = get().activeSequenceId;
					const activeView = viewProject(project, activeSequenceId);
					const options = get().ai.silenceOptions;

					const speechIntervals = detectSpeechIntervals(features, options);
					const timelineDur = timelineDuration(activeView);
					const result = computeSilenceRegions(speechIntervals, timelineDur, options);

					set((state) => {
						state.ai.detectedSilences = result.silences;
					});
				},
				applySilenceTrimAction(mode) {
					const project = get().project;
					if (!project) return;
					const activeSequenceId = get().activeSequenceId;
					const silences = get().ai.detectedSilences;
					const options = get().ai.silenceOptions;

					let createdSeqId: SequenceId | null = null;

					mutateProject(
						'Trim silence',
						(curr) => {
							const res = applySilenceTrimToProject(curr, activeSequenceId, silences, {
								action: options.mode,
								applyTarget: options.applyTarget,
								crossfadeMs: options.crossfadeMs,
								mode
							});
							if (mode === 'new-sequence') {
								createdSeqId = res.resultSequenceId;
							}
							return res.project;
						},
						{ history: 'record' }
					);

					if (createdSeqId) {
						get().openSequence(createdSeqId);
					}

					set((state) => {
						state.ai.virtualPreview = false;
						state.ai.detectedSilences = [];
					});
				}
			};
		})
	);
}

export type EditorStore = ReturnType<typeof createEditorStore>;
