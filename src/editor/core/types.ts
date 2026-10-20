import type { AudioEffectInstance } from './audio/effects/registry';
export type { AudioEffectInstance } from './audio/effects/registry';

export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type ProjectId = Brand<string, 'ProjectId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type TrackId = Brand<string, 'TrackId'>;
export type ClipId = Brand<string, 'ClipId'>;
export type MarkerId = Brand<string, 'MarkerId'>;
export type TrackerId = Brand<string, 'TrackerId'>;

export type Time = number;

export interface ProjectSettings {
	width: number;
	height: number;
	fps: number;
	sampleRate: number;
}

export type AssetKind = 'video' | 'audio' | 'image' | 'lut' | 'font';

export interface AssetVideoMetadata {
	width?: number;
	height?: number;
	fps?: number;
	fpsEstimated?: boolean;
	codec?: string;
	decodable?: boolean;
	bitDepth?: number;
	colorSpace?: VideoColorSpaceInit;
	isHdr?: boolean;
	isInterlaced?: boolean;
	isVfr?: boolean;
	transfer?: string;
	primaries?: string;
	matrix?: string;
	fullRange?: boolean;
}

export interface AssetAudioMetadata {
	sampleRate?: number;
	channels?: number;
	codec?: string;
	decodable?: boolean;
	bitDepth?: number;
}

export interface Asset {
	id: AssetId;
	kind: AssetKind;
	name: string;
	mimeType: string;
	size: number;
	duration: Time;
	width?: number;
	height?: number;
	fps?: number;
	fpsEstimated?: boolean;
	hasAudio: boolean;
	audioChecked?: boolean;
	audioDecodable?: boolean;
	audioCodec?: string;
	videoDecodable?: boolean;
	videoCodec?: string;
	opfsPath: string;
	offline?: boolean;
	proxy?: ProxyInfo;
	// Professional Codecs Expanded Metadata (Slice 1)
	bitDepth?: number;
	colorSpace?: VideoColorSpaceInit;
	isHdr?: boolean;
	isInterlaced?: boolean;
	isVfr?: boolean;
	transfer?: string;
	video?: AssetVideoMetadata;
	audio?: AssetAudioMetadata;
}

export type Interpolation = 'linear' | 'hold' | 'bezier' | 'spring' | 'elastic' | 'bounce';

/** Cubic-bezier control point in normalized segment space; x must stay within [0, 1]. */
export interface BezierHandle {
	x: number;
	y: number;
}

export interface Keyframe<T> {
	/** Clip-local time in microseconds, measured from the clip's timeline start. */
	time: Time;
	value: T;
	interpolation: Interpolation;
	easeOut?: BezierHandle;
	easeIn?: BezierHandle;
}

export type AngleMode = 'unwrapped' | 'shortest';

export type AnimatedValue<T> = { value: T } | { keyframes: Keyframe<T>[]; angleMode?: AngleMode };

export type PropertyId = string;
export type SequenceId = Brand<string, 'SequenceId'>;

export type JsonValue =
	string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface EffectInstance {
	id: string;
	type: string;
	version?: number;
	enabled?: boolean;
	params: Record<string, JsonValue | AnimatedValue<unknown>>;
}

/** Phase 1 name, kept so existing imports continue to compile. */
export type Effect = EffectInstance;

export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';

export interface TextStyle {
	fontFamily: string;
	fontWeight?:
		'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
	fontStyle?: 'normal' | 'italic';
	alignment?: 'left' | 'center' | 'right';
	lineHeight?: number;
	letterSpacing?: number;
}

export type GraphicFrameStyle =
	| 'none'
	| 'card'
	| 'frame'
	| 'circle'
	| 'accent-bar'
	| 'badge-header'
	| 'title-badge'
	| 'split-slash'
	| 'divided-box'
	| 'diagonal-repeat'
	| 'lower-third-line'
	| 'lower-third-glass'
	| 'social-pill'
	| 'callout-pointer'
	| 'cinematic-box';

export interface TextBox {
	width?: number;
	height?: number;
	autoSize?: boolean;
	verticalAnchor?: 'top' | 'center' | 'bottom';
	paddingX?: number;
	paddingY?: number;
	frameStyle?: GraphicFrameStyle;
	badgeText?: string;
	borderColor?: { r: number; g: number; b: number; a: number };
	borderWidth?: number;
	borderRadius?: number;
	accentBarColor?: { r: number; g: number; b: number; a: number };
	accentBarWidth?: number;
	gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
	gradientColorEnd?: { r: number; g: number; b: number; a: number };
	gradientAngle?: number;
}

export interface TextColorRun {
	startIndex: number;
	endIndex: number;
	fillColor?: { r: number; g: number; b: number; a: number };
	strokeColor?: { r: number; g: number; b: number; a: number };
}

export type PublishedPropertyType = 'text' | 'color' | 'font' | 'number';

export interface PublishedTemplateParam {
	id: string;
	name: string;
	type: PublishedPropertyType;
	targetClipId: ClipId;
	targetProperty:
		| 'text.content'
		| 'text.fontFamily'
		| 'text.fontSize'
		| 'text.fill'
		| 'text.stroke'
		| 'text.accentBarColor'
		| 'shape.fill'
		| 'shape.stroke'
		| 'shape.gradient'
		| 'solid.color'
		| 'transform.scale'
		| 'transform.opacity';
	defaultValue: any;
	min?: number;
	max?: number;
	step?: number;
}

export type ClipSource =
	| { type: 'asset' }
	| {
			type: 'text';
			text: string;
			style?: TextStyle;
			box?: TextBox;
			colorRuns?: TextColorRun[];
			graphicTemplateId?: string;
			animationPresetId?: string;
	  }
	| {
			type: 'sequence';
			sequenceId: SequenceId;
			templateId?: string;
			templateName?: string;
			templateCategory?: string;
			publishedParams?: PublishedTemplateParam[];
			paramOverrides?: Record<string, any>;
			responsiveTiming?: {
				introDuration: Time;
				outroDuration: Time;
			};
	  }
	| {
			type: 'solid';
			color: { r: number; g: number; b: number; a: number };
			gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
			gradientColorEnd?: { r: number; g: number; b: number; a: number };
			gradientAngle?: number;
	  }
	| { type: 'adjustment' }
	| {
			type: 'shape';
			shapeType: import('./shapes/shapeTypes').ShapeKind;
			width: number;
			height: number;
			fillColor: { r: number; g: number; b: number; a: number };
			strokeColor?: { r: number; g: number; b: number; a: number };
			strokeWidth?: number;
			strokeStyle?: 'solid' | 'dashed' | 'dotted';
			cornerRadius?: number;
			points?: number;
			innerRadius?: number;
			shadowColor?: { r: number; g: number; b: number; a: number };
			shadowBlur?: number;
			shadowOffsetX?: number;
			shadowOffsetY?: number;
			gradientType?: 'none' | 'linear-horizontal' | 'linear-vertical' | 'radial' | 'linear-angle';
			gradientColorEnd?: { r: number; g: number; b: number; a: number };
			gradientAngle?: number;
	  };

export interface MaskPoint {
	x: number;
	y: number;
	inHandle?: { x: number; y: number };
	outHandle?: { x: number; y: number };
}

export interface Mask {
	id: string;
	name?: string;
	type: 'rect' | 'ellipse' | 'path';
	mode: 'add' | 'subtract' | 'intersect';
	inverted: boolean;
	feather: number;
	expansion: number;
	opacity: number;
	enabled?: boolean;
	closed?: boolean;
	shape?: number[];
	points?: MaskPoint[];
	effectId?: string;
	properties?: Record<PropertyId, AnimatedValue<unknown>>;
}

export type TransitionEdge =
	| { kind: 'cut'; fromClipId: ClipId; toClipId: ClipId }
	| { kind: 'head'; clipId: ClipId }
	| { kind: 'tail'; clipId: ClipId };

export interface Transition {
	id: string;
	type: string;
	duration: Time;
	alignment: 'center' | 'start' | 'end';
	easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
	audioCrossfade?: boolean;
	edge: TransitionEdge;
	params: Record<string, JsonValue>;
}

export interface Sequence {
	id: SequenceId;
	name: string;
	settings?: ProjectSettings;
	tracks: Track[];
	markers?: Marker[];
}

export type ProxyStatus = 'none' | 'queued' | 'working' | 'ready' | 'failed' | 'stale' | 'pending';

export interface ProxyInfo {
	opfsPath?: string;
	width?: number;
	height?: number;
	status: ProxyStatus;
	progress?: number;
	error?: string;
	codec?: string;
	container?: string;
	bytes?: number;
	fps?: number;
	durationUs?: Time;
	fingerprint?: string;
	createdAt?: string;
}

export type ProxyTargetHeight = 360 | 540 | 720;
export type ProxyAutoMode = 'off' | 'large' | 'all';

export interface ProjectProxySettings {
	enabled: boolean;
	targetHeight: ProxyTargetHeight;
	auto: ProxyAutoMode;
}

export interface ClipTransform {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	opacity: number;
}

export interface EqBand {
	type: 'lowshelf' | 'peaking' | 'highshelf';
	frequencyHz: number;
	gainDb: number;
	q: number;
}

export interface TrackEq {
	enabled: boolean;
	bands: [EqBand, EqBand, EqBand, EqBand];
}

export interface TrackCompressor {
	enabled: boolean;
	thresholdDb: number;
	ratio: number;
	attackMs: number;
	releaseMs: number;
	kneeDb: number;
	makeupDb: number;
}

export type AutomationMode = 'off' | 'read' | 'write' | 'touch' | 'latch';

export interface TrackSend {
	busId: string;
	levelDb: number;
	pre: boolean;
	enabled: boolean;
}

export interface AudioBus {
	id: string;
	name: string;
	gainDb: number;
	pan: number;
	trimDb?: number;
	width?: number; // 0..2 (1.0 = 100%)
	muted: boolean;
	solo: boolean;
	output: 'master' | string; // target busId
	effects?: AudioEffectInstance[];
	automation?: Record<string, AnimatedValue<number>>;
	automationMode?: AutomationMode;
}

export interface TrackAudio {
	gainDb: number;
	pan: number;
	trimDb?: number;
	width?: number; // 0..2 (1.0 = 100%)
	solo: boolean;
	output?: 'master' | string; // master or busId
	sends?: TrackSend[];
	effects?: AudioEffectInstance[];
	automation?: Record<string, AnimatedValue<number>>;
	automationMode?: AutomationMode;
	channelMode?: 'stereo' | 'mono';
	phaseInvert?: boolean;
	soloSafe?: boolean;
	eq?: TrackEq;
	compressor?: TrackCompressor;
}

export interface ProjectMaster {
	gainDb: number;
	limiter: boolean;
	loudnessTargetLufs?: number;
	effects?: AudioEffectInstance[];
	automation?: Record<string, AnimatedValue<number>>;
	automationMode?: AutomationMode;
}

export interface Clip {
	id: ClipId;
	assetId?: AssetId;
	start: Time;
	duration: Time;
	sourceIn: Time;
	sourceOut: Time;
	speed: number;
	volume: number;
	linkId?: string;
	effects?: EffectInstance[];
	bypassEffects?: boolean;
	audioEffects?: AudioEffectInstance[];
	audioTag?: 'dialogue' | 'music' | 'sfx' | 'ambience';
	channelRouting?: 'stereo' | 'mono-left' | 'mono-right' | 'mono-sum' | 'swap' | 'invert-lr';
	transform?: ClipTransform;
	text?: string;
	source?: ClipSource;
	properties?: Record<PropertyId, AnimatedValue<unknown>>;
	masks?: Mask[];
	blendMode?: BlendMode;
	/** Speed curve over clip-local time; 1 is normal, negative reverses, 0 freezes. */
	timeRemap?: AnimatedValue<number>;
	/** Pitch preservation for speed changes (defaults to true). */
	maintainPitch?: boolean;
	fadeInUs?: Time;
	fadeOutUs?: Time;
	fadeCurve?: 'equalPower' | 'linear';
	trackers?: Tracker[];
	markers?: ClipMarker[];
}

export type TrackerType = 'point' | 'planar' | 'stabilize';

export interface TrackerRegion {
	/** Normalized center x in source coordinates [0, 1] */
	x: number;
	/** Normalized center y in source coordinates [0, 1] */
	y: number;
	/** Normalized feature search template width [0, 1] */
	width: number;
	/** Normalized feature search template height [0, 1] */
	height: number;
	/** Normalized search area padding multiplier or width [0, 1] */
	searchMultiplier?: number;
}

export interface TrackerParams {
	trackTranslation: boolean;
	trackRotation: boolean;
	trackScale: boolean;
	pyramidLevels: number;
	searchRadiusPx: number;
	maxIterations: number;
	tolerance: number;
	nccThreshold: number;
	huberThreshold: number;
	confidenceThreshold: number;
	analysisWidth?: number;
}

export interface TrackerSample {
	/** Source time in microseconds */
	sourceTime: Time;
	/** Normalized center x [0, 1] */
	x: number;
	/** Normalized center y [0, 1] */
	y: number;
	/** Rotation angle in radians relative to seed frame */
	rotation: number;
	/** Scale multiplier relative to seed frame */
	scale: number;
	/** Tracking match confidence [0, 1] */
	confidence: number;
	/** Whether tracking lost or below threshold at this frame */
	lost?: boolean;
	/** Stop or loss reason if tracking ended/failed here */
	reason?: 'loss' | 'occlusion' | 'out_of_bounds' | 'user_cancel' | 'complete';
}

export interface TrackerSmoothing {
	enabled: boolean;
	windowFrames: number;
	positionSigma?: number;
	rotationSigma?: number;
	scaleSigma?: number;
}

export interface Tracker {
	id: TrackerId;
	name: string;
	type: TrackerType;
	enabled: boolean;
	/** Source time in microseconds when tracking was initiated / seeded */
	seedTime: Time;
	/** Initial normalized feature region at seedTime */
	initialRegion: TrackerRegion;
	params: TrackerParams;
	samples: TrackerSample[];
	smoothing?: TrackerSmoothing;
	/** Hash of source asset at time of tracking to detect stale cache */
	assetFingerprint?: string;
	/** Target layer or property live binding if connected */
	binding?: {
		targetClipId: ClipId;
		applyPosition: boolean;
		applyRotation: boolean;
		applyScale: boolean;
		offsetPosition: [number, number];
		offsetRotation: number;
		offsetScale: [number, number];
	};
}

export type TrackKind = 'video' | 'audio' | 'caption';

export type CaptionPositionPreset = 'bottom' | 'center' | 'top' | 'custom';
export type CaptionHighlightMode = 'none' | 'word' | 'progressive';

export interface RgbaColor {
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface CaptionWord {
	text: string;
	start: Time;
	end: Time;
	confidence?: number;
}

export interface CaptionSegment {
	id: string;
	start: Time;
	end: Time;
	text: string;
	words?: CaptionWord[];
	speaker?: string;
}

export interface CaptionStyle {
	fontFamily: string;
	fontSize: number;
	fontWeight?:
		'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
	fontStyle?: 'normal' | 'italic';
	color: RgbaColor;
	backgroundColor?: RgbaColor;
	strokeColor?: RgbaColor;
	strokeWidth?: number;
	shadowColor?: RgbaColor;
	shadowBlur?: number;
	shadowOffsetX?: number;
	shadowOffsetY?: number;
	positionPreset: CaptionPositionPreset;
	customX?: number;
	customY?: number;
	alignment: 'left' | 'center' | 'right';
	marginPercent?: number;
	maxLines: number;
	maxCharsPerLine: number;
	highlightMode?: CaptionHighlightMode;
	highlightColor?: RgbaColor;
	fadeMs?: number;
}

export interface Track {
	id: TrackId;
	kind: TrackKind;
	name: string;
	muted: boolean;
	locked: boolean;
	hidden: boolean;
	clips: Clip[];
	transitions?: Transition[];
	audio?: TrackAudio;
	captions?: CaptionSegment[];
	captionStyle?: CaptionStyle;
}

export type MarkerColor =
	'green' | 'red' | 'purple' | 'orange' | 'yellow' | 'white' | 'blue' | 'cyan';

export type MarkerType = 'comment' | 'chapter' | 'segment' | 'web-link';

export interface Marker {
	id: MarkerId;
	time: Time;
	duration?: Time;
	name: string;
	label?: string; // Backwards-compatibility alias for older projects
	comment?: string;
	color: MarkerColor;
	type?: MarkerType;
	url?: string;
}

export type ClipMarker = Marker;

export interface Project {
	id: ProjectId;
	schemaVersion: number;
	name: string;
	createdAt: string;
	updatedAt: string;
	settings: ProjectSettings;
	assets: Record<AssetId, Asset>;
	tracks: Track[];
	markers: Marker[];
	sequences?: Record<SequenceId, Sequence>;
	masterAudio?: ProjectMaster;
	proxy?: ProjectProxySettings;
	audioBuses?: AudioBus[];
}

export interface ProjectSummary {
	id: ProjectId;
	name: string;
	updatedAt: string;
	duration: Time;
	assetCount: number;
}

export type TimelineDragKind =
	'move' | 'trim-start' | 'trim-end' | 'asset' | 'slip' | 'graphic-template' | 'shape';

export interface DragPosition {
	clipId: ClipId;
	trackId: TrackId;
	start: Time;
	duration: Time;
	sourceIn: Time;
	sourceOut: Time;
}

export interface DragSession {
	kind: TimelineDragKind;
	clipIds: ClipId[];
	original: DragPosition[];
	preview: DragPosition[];
	pointerStartTime: Time;
	pointerTime: Time;
	targetTrackId?: TrackId;
	createTrackKind?: Track['kind'];
	assetId?: AssetId;
	graphicTemplateId?: string;
	/** Full template being dragged; the drop instantiates this exact template. */
	motionTemplate?: import('./templates/templateTypes').MotionGraphicTemplate;
	shapeConfig?: import('./shapes/shapeTypes').ShapeConfig;
	snappedTo?: Time;
	allowed: boolean;
	unlink: boolean;
}
