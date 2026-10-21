import { z } from 'zod';
import type {
	AnimatedValue,
	AssetId,
	ClipId,
	ClipSource,
	JsonValue,
	Marker,
	MarkerColor,
	MarkerId,
	Project,
	ProjectId,
	SequenceId,
	TrackId,
	TrackerId
} from './types';

export const CURRENT_SCHEMA_VERSION = 2;

export const projectIdSchema = z.custom<ProjectId>(
	(value) => typeof value === 'string' && value.length > 0
);
export const assetIdSchema = z.custom<AssetId>(
	(value) => typeof value === 'string' && value.length > 0
);
export const trackIdSchema = z.custom<TrackId>(
	(value) => typeof value === 'string' && value.length > 0
);
export const clipIdSchema = z.custom<ClipId>(
	(value) => typeof value === 'string' && value.length > 0
);
export const markerIdSchema = z.custom<MarkerId>(
	(value) => typeof value === 'string' && value.length > 0
);
export const trackerIdSchema = z.custom<TrackerId>(
	(value) => typeof value === 'string' && value.length > 0
);
export const timeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const projectSettingsSchema = z.object({
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	fps: z.number().positive(),
	sampleRate: z.number().int().positive()
});

const bezierHandleSchema = z.object({ x: z.number(), y: z.number() });

const keyframeSchema = z.object({
	time: timeSchema,
	value: z.unknown().refine((value) => value !== undefined, 'Keyframe value is required.'),
	interpolation: z.enum(['linear', 'hold', 'bezier', 'spring', 'elastic', 'bounce']),
	easeOut: bezierHandleSchema.optional(),
	easeIn: bezierHandleSchema.optional(),
	anchor: z.literal('end').optional()
});

export const animatedValueSchema = z.union([
	z.object({
		keyframes: z
			.array(keyframeSchema)
			.min(1)
			.refine(
				(frames) =>
					frames.every((frame, index) => index === 0 || frame.time > frames[index - 1]!.time),
				'Keyframes must be sorted by strictly increasing time.'
			),
		angleMode: z.enum(['unwrapped', 'shortest']).optional()
	}),
	z.object({ value: z.unknown().refine((value) => value !== undefined, 'Value is required.') })
]) as unknown as z.ZodType<AnimatedValue<unknown>>;

const propertiesSchema = z.record(z.string().min(1), animatedValueSchema);

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema)
	])
);

export const effectSchema = z.object({
	id: z.string().min(1),
	type: z.string().min(1),
	version: z.number().int().nonnegative().optional(),
	enabled: z.boolean().optional(),
	params: z.record(z.string(), z.union([jsonValueSchema, animatedValueSchema]))
});

const colorSchema = z.object({
	r: z.number(),
	g: z.number(),
	b: z.number(),
	a: z.number()
});

export const textStyleSchema = z.object({
	fontFamily: z.string().min(1),
	fontWeight: z
		.enum(['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'])
		.optional(),
	fontStyle: z.enum(['normal', 'italic']).optional(),
	alignment: z.enum(['left', 'center', 'right']).optional(),
	lineHeight: z.number().positive().optional(),
	letterSpacing: z.number().optional(),
	revealUnit: z.enum(['char', 'word', 'line']).optional()
});

export const gradientTypeSchema = z.enum([
	'none',
	'linear-horizontal',
	'linear-vertical',
	'radial',
	'linear-angle'
]);

export const textColorRunSchema = z.object({
	startIndex: z.number().int().nonnegative(),
	endIndex: z.number().int().nonnegative(),
	fillColor: colorSchema.optional(),
	strokeColor: colorSchema.optional()
});

export const textBoxSchema = z.object({
	width: z.number().positive().optional(),
	height: z.number().positive().optional(),
	autoSize: z.boolean().optional(),
	verticalAnchor: z.enum(['top', 'center', 'bottom']).optional(),
	paddingX: z.number().nonnegative().optional(),
	paddingY: z.number().nonnegative().optional(),
	frameStyle: z.string().optional(),
	badgeText: z.string().optional(),
	borderColor: colorSchema.optional(),
	borderWidth: z.number().nonnegative().optional(),
	borderRadius: z.number().nonnegative().optional(),
	accentBarColor: colorSchema.optional(),
	accentBarWidth: z.number().nonnegative().optional(),
	gradientType: gradientTypeSchema.optional(),
	gradientColorEnd: colorSchema.optional(),
	gradientAngle: z.number().optional()
});

export const clipSourceSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('asset') }),
	z.object({
		type: z.literal('text'),
		text: z.string(),
		style: textStyleSchema.optional(),
		box: textBoxSchema.optional(),
		colorRuns: z.array(textColorRunSchema).optional(),
		graphicTemplateId: z.string().optional(),
		animationPresetId: z.string().optional()
	}),
	z.object({
		type: z.literal('sequence'),
		sequenceId: z.string().min(1),
		templateId: z.string().optional(),
		templateName: z.string().optional(),
		templateCategory: z.string().optional(),
		publishedParams: z.array(z.any()).optional(),
		paramOverrides: z.record(z.string(), z.any()).optional(),
		responsiveTiming: z
			.object({
				introDuration: z.number().nonnegative(),
				outroDuration: z.number().nonnegative()
			})
			.optional()
	}),
	z.object({
		type: z.literal('solid'),
		color: colorSchema,
		gradientType: gradientTypeSchema.optional(),
		gradientColorEnd: colorSchema.optional(),
		gradientAngle: z.number().optional()
	}),
	z.object({ type: z.literal('adjustment') }),
	z.object({
		type: z.literal('shape'),
		shapeType: z.string(),
		width: z.number().positive(),
		height: z.number().positive(),
		fillColor: colorSchema,
		strokeColor: colorSchema.optional(),
		strokeWidth: z.number().nonnegative().optional(),
		strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional(),
		cornerRadius: z.number().nonnegative().optional(),
		points: z.number().nonnegative().optional(),
		innerRadius: z.number().nonnegative().optional(),
		shadowColor: colorSchema.optional(),
		shadowBlur: z.number().nonnegative().optional(),
		shadowOffsetX: z.number().optional(),
		shadowOffsetY: z.number().optional(),
		gradientType: gradientTypeSchema.optional(),
		gradientColorEnd: colorSchema.optional(),
		gradientAngle: z.number().optional()
	})
]) as unknown as z.ZodType<ClipSource>;

export const maskPointSchema = z.object({
	x: z.number(),
	y: z.number(),
	inHandle: z.object({ x: z.number(), y: z.number() }).optional(),
	outHandle: z.object({ x: z.number(), y: z.number() }).optional()
});

export const maskSchema = z.object({
	id: z.string().min(1),
	name: z.string().optional(),
	type: z.enum(['rect', 'ellipse', 'path']),
	mode: z.enum(['add', 'subtract', 'intersect']),
	inverted: z.boolean(),
	feather: z.number(),
	expansion: z.number(),
	opacity: z.number().min(0).max(1),
	enabled: z.boolean().optional(),
	closed: z.boolean().optional(),
	shape: z.array(z.number()).optional(),
	points: z.array(maskPointSchema).optional(),
	effectId: z.string().optional(),
	properties: propertiesSchema.optional()
});

export const transitionSchema = z.object({
	id: z.string().min(1),
	type: z.string().min(1),
	duration: timeSchema,
	alignment: z.enum(['center', 'start', 'end']),
	edge: z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('cut'), fromClipId: clipIdSchema, toClipId: clipIdSchema }),
		z.object({ kind: z.literal('head'), clipId: clipIdSchema }),
		z.object({ kind: z.literal('tail'), clipId: clipIdSchema })
	]),
	params: z.record(z.string(), jsonValueSchema)
});

export const proxyStatusSchema = z.enum([
	'none',
	'queued',
	'working',
	'ready',
	'failed',
	'stale',
	'pending'
]);

export const proxyInfoSchema = z.object({
	opfsPath: z.string().optional(),
	width: z.number().int().nonnegative().optional(),
	height: z.number().int().nonnegative().optional(),
	status: proxyStatusSchema,
	progress: z.number().min(0).max(1).optional(),
	error: z.string().optional(),
	codec: z.string().optional(),
	container: z.string().optional(),
	bytes: z.number().nonnegative().optional(),
	fps: z.number().positive().optional(),
	durationUs: timeSchema.optional(),
	fingerprint: z.string().optional(),
	createdAt: z.string().optional()
});

export const projectProxySettingsSchema = z.object({
	enabled: z.boolean(),
	targetHeight: z.union([z.literal(360), z.literal(540), z.literal(720)]),
	auto: z.enum(['off', 'large', 'all'])
});

export const clipTransformSchema = z.object({
	x: z.number(),
	y: z.number(),
	scaleX: z.number(),
	scaleY: z.number(),
	rotation: z.number(),
	opacity: z.number().min(0).max(1)
});

export const audioParamValueSchema = z.union([
	z.number(),
	z.string(),
	z.boolean(),
	animatedValueSchema
]);

export const audioEffectInstanceSchema = z.object({
	id: z.string().min(1),
	type: z.string().min(1),
	name: z.string().optional(),
	version: z.number().int().nonnegative().optional(),
	enabled: z.boolean().optional(),
	bypass: z.boolean().optional(),
	mix: z.number().min(0).max(1).optional(),
	params: z.record(z.string(), audioParamValueSchema),
	managedBy: z.enum(['user', 'essential', 'ducking']).optional()
});

export const clipSchema = z.object({
	id: clipIdSchema,
	assetId: assetIdSchema.optional(),
	start: timeSchema,
	duration: timeSchema.positive(),
	sourceIn: timeSchema,
	sourceOut: timeSchema,
	speed: z.number().refine((val) => val !== 0, 'Speed must be non-zero'),
	volume: z.number().nonnegative(),
	linkId: z.string().min(1).optional(),
	effects: z.array(effectSchema).optional(),
	bypassEffects: z.boolean().optional(),
	audioEffects: z.array(audioEffectInstanceSchema).optional(),
	audioTag: z.enum(['dialogue', 'music', 'sfx', 'ambience']).optional(),
	channelRouting: z
		.enum(['stereo', 'mono-left', 'mono-right', 'mono-sum', 'swap', 'invert-lr'])
		.optional(),
	transform: clipTransformSchema.optional(),
	text: z.string().optional(),
	source: clipSourceSchema.optional(),
	properties: propertiesSchema.optional(),
	masks: z.array(maskSchema).optional(),
	blendMode: z.enum(['normal', 'add', 'multiply', 'screen']).optional(),
	timeRemap: (animatedValueSchema as unknown as z.ZodType<AnimatedValue<number>>)
		.refine(
			(curve) =>
				'keyframes' in curve
					? curve.keyframes.every((frame) => Number.isFinite(frame.value))
					: Number.isFinite(curve.value),
			'Time remap values must be finite numbers.'
		)
		.optional(),
	maintainPitch: z.boolean().optional(),
	fadeInUs: timeSchema.nonnegative().optional(),
	fadeOutUs: timeSchema.nonnegative().optional(),
	fadeCurve: z.enum(['equalPower', 'linear']).optional(),
	trackers: z.array(z.lazy(() => trackerSchema)).optional(),
	markers: z.array(z.lazy(() => markerSchema)).optional()
});

export const trackerRegionSchema = z.object({
	x: z.number().min(0).max(1),
	y: z.number().min(0).max(1),
	width: z.number().positive().max(1),
	height: z.number().positive().max(1),
	searchMultiplier: z.number().positive().optional()
});

export const trackerParamsSchema = z.object({
	trackTranslation: z.boolean(),
	trackRotation: z.boolean(),
	trackScale: z.boolean(),
	pyramidLevels: z.number().int().min(1).max(6),
	searchRadiusPx: z.number().positive(),
	maxIterations: z.number().int().positive(),
	tolerance: z.number().positive(),
	nccThreshold: z.number().min(0).max(1),
	huberThreshold: z.number().positive(),
	confidenceThreshold: z.number().min(0).max(1),
	analysisWidth: z.number().int().positive().optional()
});

export const trackerSampleSchema = z.object({
	sourceTime: timeSchema,
	x: z.number(),
	y: z.number(),
	rotation: z.number(),
	scale: z.number().positive(),
	confidence: z.number().min(0).max(1),
	lost: z.boolean().optional(),
	reason: z.enum(['loss', 'occlusion', 'out_of_bounds', 'user_cancel', 'complete']).optional()
});

export const trackerSmoothingSchema = z.object({
	enabled: z.boolean(),
	windowFrames: z.number().int().positive(),
	positionSigma: z.number().positive().optional(),
	rotationSigma: z.number().positive().optional(),
	scaleSigma: z.number().positive().optional()
});

export const trackerSchema = z.object({
	id: trackerIdSchema,
	name: z.string().min(1),
	type: z.enum(['point', 'planar', 'stabilize']),
	enabled: z.boolean(),
	seedTime: timeSchema,
	initialRegion: trackerRegionSchema,
	params: trackerParamsSchema,
	samples: z.array(trackerSampleSchema),
	smoothing: trackerSmoothingSchema.optional(),
	assetFingerprint: z.string().optional(),
	binding: z
		.object({
			targetClipId: clipIdSchema,
			applyPosition: z.boolean(),
			applyRotation: z.boolean(),
			applyScale: z.boolean(),
			offsetPosition: z.tuple([z.number(), z.number()]),
			offsetRotation: z.number(),
			offsetScale: z.tuple([z.number(), z.number()])
		})
		.optional()
});

export const eqBandSchema = z.object({
	type: z.enum(['lowshelf', 'peaking', 'highshelf']),
	frequencyHz: z.number().min(20).max(20000),
	gainDb: z.number().min(-24).max(24),
	q: z.number().min(0.1).max(18)
});

export const trackEqSchema = z.object({
	enabled: z.boolean(),
	bands: z.tuple([eqBandSchema, eqBandSchema, eqBandSchema, eqBandSchema])
});

export const trackCompressorSchema = z.object({
	enabled: z.boolean(),
	thresholdDb: z.number().min(-60).max(0),
	ratio: z.number().min(1).max(20),
	attackMs: z.number().min(0.1).max(500),
	releaseMs: z.number().min(5).max(2000),
	kneeDb: z.number().min(0).max(12),
	makeupDb: z.number().min(0).max(24)
});

export const automationModeSchema = z.enum(['off', 'read', 'write', 'touch', 'latch']);

export const trackSendSchema = z.object({
	busId: z.string().min(1),
	levelDb: z.number().min(-96).max(24),
	pre: z.boolean(),
	enabled: z.boolean()
});

export const audioBusSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	gainDb: z.number().min(-96).max(24),
	pan: z.number().min(-1).max(1),
	muted: z.boolean(),
	solo: z.boolean(),
	output: z.string().min(1), // 'master' or target busId
	effects: z.array(audioEffectInstanceSchema).optional(),
	automation: z
		.record(z.string(), animatedValueSchema as unknown as z.ZodType<AnimatedValue<number>>)
		.optional(),
	automationMode: automationModeSchema.optional()
});

export const trackAudioSchema = z.object({
	gainDb: z.number().min(-96).max(24),
	pan: z.number().min(-1).max(1),
	solo: z.boolean(),
	output: z.string().optional(),
	sends: z.array(trackSendSchema).optional(),
	effects: z.array(audioEffectInstanceSchema).optional(),
	automation: z
		.record(z.string(), animatedValueSchema as unknown as z.ZodType<AnimatedValue<number>>)
		.optional(),
	automationMode: automationModeSchema.optional(),
	channelMode: z.enum(['stereo', 'mono']).optional(),
	phaseInvert: z.boolean().optional(),
	soloSafe: z.boolean().optional(),
	eq: trackEqSchema.optional(),
	compressor: trackCompressorSchema.optional()
});

export const projectMasterSchema = z.object({
	gainDb: z.number().min(-96).max(24),
	limiter: z.boolean(),
	loudnessTargetLufs: z.number().optional(),
	effects: z.array(audioEffectInstanceSchema).optional(),
	automation: z
		.record(z.string(), animatedValueSchema as unknown as z.ZodType<AnimatedValue<number>>)
		.optional(),
	automationMode: automationModeSchema.optional()
});

export const videoColorSpaceSchema = z
	.object({
		primaries: z.string().nullable().optional(),
		transfer: z.string().nullable().optional(),
		matrix: z.string().nullable().optional(),
		fullRange: z.boolean().nullable().optional()
	})
	.catchall(z.unknown()) as unknown as z.ZodType<VideoColorSpaceInit>;

export const assetSchema = z.object({
	id: assetIdSchema,
	kind: z.enum(['video', 'audio', 'image', 'lut', 'font']),
	name: z.string().min(1),
	mimeType: z.string().min(1),
	size: z.number().int().nonnegative(),
	duration: timeSchema,
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	fps: z.number().positive().optional(),
	fpsEstimated: z.boolean().optional(),
	hasAudio: z.boolean(),
	audioChecked: z.boolean().optional(),
	audioDecodable: z.boolean().optional(),
	audioCodec: z.string().min(1).optional(),
	videoDecodable: z.boolean().optional(),
	videoCodec: z.string().min(1).optional(),
	opfsPath: z.string(),
	offline: z.boolean().optional(),
	proxy: proxyInfoSchema.optional(),
	bitDepth: z.number().int().positive().optional(),
	colorSpace: videoColorSpaceSchema.optional(),
	isHdr: z.boolean().optional(),
	isInterlaced: z.boolean().optional(),
	isVfr: z.boolean().optional(),
	transfer: z.string().optional(),
	video: z
		.object({
			width: z.number().int().positive().optional(),
			height: z.number().int().positive().optional(),
			fps: z.number().positive().optional(),
			fpsEstimated: z.boolean().optional(),
			codec: z.string().optional(),
			decodable: z.boolean().optional(),
			bitDepth: z.number().int().positive().optional(),
			colorSpace: videoColorSpaceSchema.optional(),
			isHdr: z.boolean().optional(),
			isInterlaced: z.boolean().optional(),
			isVfr: z.boolean().optional(),
			transfer: z.string().optional(),
			primaries: z.string().optional(),
			matrix: z.string().optional(),
			fullRange: z.boolean().optional()
		})
		.optional(),
	audio: z
		.object({
			sampleRate: z.number().int().positive().optional(),
			channels: z.number().int().positive().optional(),
			codec: z.string().optional(),
			decodable: z.boolean().optional(),
			bitDepth: z.number().int().positive().optional()
		})
		.optional()
});

export const captionWordSchema = z.object({
	text: z.string(),
	start: timeSchema,
	end: timeSchema,
	confidence: z.number().min(0).max(1).optional()
});

export const captionSegmentSchema = z.object({
	id: z.string().min(1),
	start: timeSchema,
	end: timeSchema,
	text: z.string(),
	words: z.array(captionWordSchema).optional(),
	speaker: z.string().optional()
});

export const captionPositionPresetSchema = z.enum(['bottom', 'center', 'top', 'custom']);
export const captionHighlightModeSchema = z.enum(['none', 'word', 'progressive']);

export const captionStyleSchema = z.object({
	fontFamily: z.string().min(1),
	fontSize: z.number().positive(),
	fontWeight: z
		.enum(['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'])
		.optional(),
	fontStyle: z.enum(['normal', 'italic']).optional(),
	color: colorSchema,
	backgroundColor: colorSchema.optional(),
	strokeColor: colorSchema.optional(),
	strokeWidth: z.number().nonnegative().optional(),
	shadowColor: colorSchema.optional(),
	shadowBlur: z.number().nonnegative().optional(),
	shadowOffsetX: z.number().optional(),
	shadowOffsetY: z.number().optional(),
	positionPreset: captionPositionPresetSchema,
	customX: z.number().optional(),
	customY: z.number().optional(),
	alignment: z.enum(['left', 'center', 'right']),
	marginPercent: z.number().min(0).max(50).optional(),
	maxLines: z.number().int().min(1).max(5),
	maxCharsPerLine: z.number().int().min(10).max(120),
	highlightMode: captionHighlightModeSchema.optional(),
	highlightColor: colorSchema.optional(),
	fadeMs: z.number().nonnegative().optional()
});

export const trackSchema = z.object({
	id: trackIdSchema,
	kind: z.enum(['video', 'audio', 'caption']),
	name: z.string().min(1),
	muted: z.boolean(),
	locked: z.boolean(),
	hidden: z.boolean(),
	clips: z.array(clipSchema),
	transitions: z.array(transitionSchema).optional(),
	audio: trackAudioSchema.optional(),
	captions: z.array(captionSegmentSchema).optional(),
	captionStyle: captionStyleSchema.optional()
});

export const markerColorSchema = z.enum([
	'green',
	'red',
	'purple',
	'orange',
	'yellow',
	'white',
	'blue',
	'cyan'
]);

export const markerTypeSchema = z.enum(['comment', 'chapter', 'segment', 'web-link']);

export const markerSchema = z
	.object({
		id: markerIdSchema,
		time: timeSchema,
		duration: timeSchema.nonnegative().optional(),
		name: z.string().optional(),
		label: z.string().optional(),
		comment: z.string().optional(),
		color: z.union([markerColorSchema, z.string()]).optional(),
		type: markerTypeSchema.optional(),
		url: z.string().optional()
	})
	.transform((val) => {
		const name = val.name ?? val.label ?? 'Marker';
		const validColors = [
			'green',
			'red',
			'purple',
			'orange',
			'yellow',
			'white',
			'blue',
			'cyan'
		] as const;
		const color: MarkerColor =
			val.color && validColors.includes(val.color as MarkerColor)
				? (val.color as MarkerColor)
				: 'green';
		return {
			...val,
			name,
			label: val.label ?? name,
			color,
			type: val.type ?? 'comment'
		} as Marker;
	});

export const sequenceSchema = z.object({
	id: z.custom<SequenceId>((value) => typeof value === 'string' && value.length > 0),
	name: z.string().min(1),
	settings: projectSettingsSchema.optional(),
	tracks: z.array(trackSchema),
	markers: z.array(z.lazy(() => markerSchema)).optional()
});

export const projectSchema = z
	.object({
		id: projectIdSchema,
		schemaVersion: z.number().int().positive(),
		name: z.string().trim().min(1).max(80),
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
		settings: projectSettingsSchema,
		assets: z.record(assetIdSchema, assetSchema),
		tracks: z.array(trackSchema),
		markers: z.array(markerSchema),
		sequences: z
			.record(
				z.custom<SequenceId>((value) => typeof value === 'string' && value.length > 0),
				sequenceSchema
			)
			.optional(),
		masterAudio: projectMasterSchema.optional(),
		proxy: projectProxySettingsSchema.optional(),
		audioBuses: z.array(audioBusSchema).optional()
	})
	.superRefine((project, context) => {
		// Validate routing cycles for buses and tracks
		if (project.audioBuses && project.audioBuses.length > 0) {
			const busIds = new Set(project.audioBuses.map((b) => b.id));
			for (const bus of project.audioBuses) {
				let current = bus.output;
				const visited = new Set<string>([bus.id]);
				while (current !== 'master') {
					if (!busIds.has(current)) {
						context.addIssue({
							code: 'custom',
							path: ['audioBuses'],
							message: `Bus "${bus.name}" routes to non-existent bus "${current}".`
						});
						break;
					}
					if (visited.has(current)) {
						context.addIssue({
							code: 'custom',
							path: ['audioBuses'],
							message: `Audio routing cycle detected involving bus "${bus.name}".`
						});
						break;
					}
					visited.add(current);
					const nextBus = project.audioBuses.find((b) => b.id === current);
					current = nextBus ? nextBus.output : 'master';
				}
			}
		}
		const ids = new Set<string>([project.id]);
		for (const [assetKey, asset] of Object.entries(project.assets)) {
			if (assetKey !== asset.id) {
				context.addIssue({
					code: 'custom',
					path: ['assets', assetKey, 'id'],
					message: 'Asset id must match its asset record key.'
				});
			}
			if (ids.has(asset.id)) {
				context.addIssue({
					code: 'custom',
					path: ['assets', assetKey, 'id'],
					message: 'Project entity ids must be unique.'
				});
			}
			ids.add(asset.id);
		}

		const checkTracks = (tracks: typeof project.tracks, base: Array<string | number>) => {
			const clipIds = new Set<string>();
			for (const [trackIndex, track] of tracks.entries()) {
				const trackPath = [...base, trackIndex];
				if (ids.has(track.id)) {
					context.addIssue({
						code: 'custom',
						path: [...trackPath, 'id'],
						message: 'Project entity ids must be unique.'
					});
				}
				ids.add(track.id);
				for (const [clipIndex, clip] of track.clips.entries()) {
					const clipPath = [...trackPath, 'clips', clipIndex];
					if (ids.has(clip.id)) {
						context.addIssue({
							code: 'custom',
							path: [...clipPath, 'id'],
							message: 'Project entity ids must be unique.'
						});
					}
					ids.add(clip.id);
					clipIds.add(clip.id);
					if (!clip.source || clip.source.type === 'asset') {
						if (!clip.assetId || !project.assets[clip.assetId]) {
							context.addIssue({
								code: 'custom',
								path: [...clipPath, 'assetId'],
								message: 'Clip must reference an asset in this project.'
							});
						}
					}
					const nested = [
						...(clip.effects ?? []).map((effect) => ['effects', effect.id] as const),
						...(clip.masks ?? []).map((mask) => ['masks', mask.id] as const)
					];
					for (const [kind, id] of nested) {
						if (ids.has(id)) {
							context.addIssue({
								code: 'custom',
								path: [...clipPath, kind],
								message: 'Project entity ids must be unique.'
							});
						}
						ids.add(id);
					}
					if (!clip.timeRemap && (clip.speed ?? 1) > 0 && clip.sourceOut <= clip.sourceIn) {
						context.addIssue({
							code: 'custom',
							path: [...clipPath, 'sourceOut'],
							message: 'Clip sourceOut must be greater than sourceIn.'
						});
					}
				}
				for (const [captionIndex, caption] of (track.captions ?? []).entries()) {
					const captionPath = [...trackPath, 'captions', captionIndex];
					if (ids.has(caption.id)) {
						context.addIssue({
							code: 'custom',
							path: [...captionPath, 'id'],
							message: 'Project entity ids must be unique.'
						});
					}
					ids.add(caption.id);
					if (caption.end <= caption.start) {
						context.addIssue({
							code: 'custom',
							path: [...captionPath, 'end'],
							message: 'Caption end time must be greater than start time.'
						});
					}
				}
				const sortedCaptions = [...(track.captions ?? [])].sort((a, b) => a.start - b.start);
				for (let i = 1; i < sortedCaptions.length; i++) {
					if (sortedCaptions[i]!.start < sortedCaptions[i - 1]!.end) {
						context.addIssue({
							code: 'custom',
							path: [...trackPath, 'captions'],
							message: 'Caption segments must not overlap.'
						});
						break;
					}
				}
			}
			for (const [trackIndex, track] of tracks.entries()) {
				for (const [transitionIndex, transition] of (track.transitions ?? []).entries()) {
					const path = [...base, trackIndex, 'transitions', transitionIndex];
					if (ids.has(transition.id)) {
						context.addIssue({
							code: 'custom',
							path: [...path, 'id'],
							message: 'Project entity ids must be unique.'
						});
					}
					ids.add(transition.id);
					const edge = transition.edge;
					const referenced = edge.kind === 'cut' ? [edge.fromClipId, edge.toClipId] : [edge.clipId];
					if (referenced.some((id) => !clipIds.has(id))) {
						context.addIssue({
							code: 'custom',
							path: [...path, 'edge'],
							message: 'Transition must reference clips in this project.'
						});
					}
				}
			}
		};
		checkTracks(project.tracks, ['tracks']);
		for (const [sequenceKey, sequence] of Object.entries(project.sequences ?? {})) {
			if (sequenceKey !== sequence.id) {
				context.addIssue({
					code: 'custom',
					path: ['sequences', sequenceKey, 'id'],
					message: 'Sequence id must match its record key.'
				});
			}
			if (ids.has(sequence.id)) {
				context.addIssue({
					code: 'custom',
					path: ['sequences', sequenceKey, 'id'],
					message: 'Project entity ids must be unique.'
				});
			}
			ids.add(sequence.id);
			checkTracks(sequence.tracks, ['sequences', sequenceKey, 'tracks']);
		}

		for (const [markerIndex, marker] of project.markers.entries()) {
			if (ids.has(marker.id)) {
				context.addIssue({
					code: 'custom',
					path: ['markers', markerIndex, 'id'],
					message: 'Project entity ids must be unique.'
				});
			}
			ids.add(marker.id);
		}
	});

export type ProjectInput = z.input<typeof projectSchema>;

export class ProjectMigrationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProjectMigrationError';
	}
}

export function migrate(raw: unknown): Project {
	const versionResult = z.object({ schemaVersion: z.number().int() }).safeParse(raw);
	if (!versionResult.success) {
		throw new ProjectMigrationError(
			'Project data is missing a valid schema version and cannot be opened.'
		);
	}

	if (versionResult.data.schemaVersion > CURRENT_SCHEMA_VERSION) {
		throw new ProjectMigrationError(
			`This project uses schema version ${versionResult.data.schemaVersion}, which is newer than this editor supports (version ${CURRENT_SCHEMA_VERSION}). Update the editor to open it.`
		);
	}

	if (versionResult.data.schemaVersion === 1) {
		// v1 → v2 only adds optional fields, so existing data is valid unchanged.
		return projectSchema.parse({ ...(raw as object), schemaVersion: CURRENT_SCHEMA_VERSION });
	}

	if (versionResult.data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
		throw new ProjectMigrationError(
			`No migration is available for project schema version ${versionResult.data.schemaVersion}.`
		);
	}

	return projectSchema.parse(raw);
}
