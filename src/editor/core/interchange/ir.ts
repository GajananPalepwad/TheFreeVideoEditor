import type { AssetId, Project } from '../types';
import { sourceExtent } from '../timeRemap';
import { timelineDuration } from '../timeline';
import { flattenForInterchange } from '../sequences/operations';
import { type RationalRate, microsToFrames, resolveRate } from './time';
import { sanitizeFilename } from '../../services/export/presets';

export type InterchangeMappingStatus = 'native' | 'approximated' | 'metadata-only' | 'omitted';

export interface InterchangeFeatureAudit {
	feature: string;
	xmeml: { status: InterchangeMappingStatus; note: string };
	edl: { status: InterchangeMappingStatus; note: string };
	fcpxml: { status: InterchangeMappingStatus; note: string };
	otio: { status: InterchangeMappingStatus; note: string };
}

export interface InterchangeTransform {
	position: [number, number];
	scale: [number, number];
	rotation: number;
	opacity: number;
}

export interface InterchangeCrop {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface InterchangeText {
	content: string;
	fontSize?: number;
	fill?: string;
	align?: 'left' | 'center' | 'right';
}

export interface InterchangeClip {
	id: string;
	name: string;
	assetId: AssetId | null;
	mediaPath: string;
	recordIn: number;
	recordOut: number;
	duration: number;
	sourceIn: number;
	sourceOut: number;
	speed: number;
	timeRemap?: boolean;
	volume: number;
	pan: number;
	fadeInFrames?: number;
	fadeOutFrames?: number;
	transform?: InterchangeTransform;
	crop?: InterchangeCrop;
	text?: InterchangeText;
	caption?: { text: string; speaker?: string };
	linkId?: string;
}

export interface InterchangeTrack {
	id: string;
	name: string;
	kind: 'video' | 'audio' | 'caption';
	enabled: boolean;
	locked: boolean;
	volume: number;
	pan: number;
	clips: InterchangeClip[];
	transitions?: Array<{ type: string; inFrame: number; durationFrames: number }>;
}

export interface InterchangeMarker {
	id: string;
	frame: number;
	name: string;
	comment?: string;
	color?: string;
}

export interface InterchangeAsset {
	id: AssetId;
	name: string;
	path: string;
	durationFrames: number;
	width?: number;
	height?: number;
	hasAudio: boolean;
	sampleRate?: number;
	mimeType?: string;
	size?: number;
}

export interface InterchangeTimeline {
	name: string;
	rate: RationalRate;
	width: number;
	height: number;
	durationFrames: number;
	tracks: InterchangeTrack[];
	markers: InterchangeMarker[];
	assets: Map<AssetId, InterchangeAsset>;
	omissions: string[];
	featureAudits: InterchangeFeatureAudit[];
}

export interface ProjectToInterchangeOptions {
	mediaPaths?: ReadonlyMap<AssetId, string>;
	dropFrame?: boolean;
}

export function buildFeatureAudits(timeline: {
	tracks: InterchangeTrack[];
	markers: InterchangeMarker[];
}): InterchangeFeatureAudit[] {
	let hasTransitions = false;
	let hasSpeed = false;
	let hasTransforms = false;
	let hasAudioAutomation = false;
	let hasText = false;
	let hasCaptions = false;
	const hasMarkers = timeline.markers.length > 0;

	for (const track of timeline.tracks) {
		if (track.transitions && track.transitions.length > 0) hasTransitions = true;
		if (track.volume !== 1 || track.pan !== 0) hasAudioAutomation = true;
		for (const clip of track.clips) {
			if (clip.speed !== 1 || clip.timeRemap) hasSpeed = true;
			if (
				clip.transform &&
				(clip.transform.opacity !== 1 ||
					clip.transform.rotation !== 0 ||
					clip.transform.scale[0] !== 1 ||
					clip.transform.scale[1] !== 1)
			)
				hasTransforms = true;
			if (clip.volume !== 1 || clip.pan !== 0 || clip.fadeInFrames || clip.fadeOutFrames)
				hasAudioAutomation = true;
			if (clip.text) hasText = true;
			if (clip.caption) hasCaptions = true;
		}
	}

	return [
		{
			feature: 'Cuts, Trims, & Track Lanes',
			xmeml: { status: 'native', note: 'Supported via <track> and <clipitem>.' },
			edl: { status: 'native', note: 'Video cuts per track; one EDL per video track.' },
			fcpxml: { status: 'native', note: 'Primary spine and connected asset-clip lanes.' },
			otio: { status: 'native', note: 'Supported via Stack.1 and Track.1 elements.' }
		},
		{
			feature: 'Linked Audio & Video',
			xmeml: { status: 'native', note: 'Exported via <link> clip references.' },
			edl: { status: 'omitted', note: 'CMX3600 EDL does not support A/V link references.' },
			fcpxml: { status: 'native', note: 'Exported with paired audio/video asset references.' },
			otio: { status: 'metadata-only', note: 'Stored in thefreevideoeditor.linkId metadata.' }
		},
		{
			feature: 'Speed Changes & Retiming',
			xmeml: {
				status: hasSpeed ? 'native' : 'native',
				note: 'Expressed via clip duration and source frame ranges.'
			},
			edl: {
				status: hasSpeed ? 'omitted' : 'native',
				note: 'CMX3600 cuts assume standard 1.0x playback rate.'
			},
			fcpxml: {
				status: hasSpeed ? 'native' : 'native',
				note: 'Expressed via rational time warp in asset-clip.'
			},
			otio: { status: hasSpeed ? 'native' : 'native', note: 'Expressed via LinearTimeWarp effect.' }
		},
		{
			feature: 'Transforms & Opacity',
			xmeml: {
				status: hasTransforms ? 'native' : 'native',
				note: 'Expressed as Basic Motion and Opacity filters.'
			},
			edl: {
				status: hasTransforms ? 'omitted' : 'native',
				note: 'EDL does not support spatial transforms.'
			},
			fcpxml: {
				status: hasTransforms ? 'native' : 'native',
				note: 'Expressed as adjust-transform and adjust-opacity.'
			},
			otio: {
				status: hasTransforms ? 'metadata-only' : 'native',
				note: 'Stored in thefreevideoeditor.transform metadata.'
			}
		},
		{
			feature: 'Audio Levels & Pan',
			xmeml: {
				status: hasAudioAutomation ? 'native' : 'native',
				note: 'Expressed as volume and pan filter parameters.'
			},
			edl: {
				status: hasAudioAutomation ? 'omitted' : 'native',
				note: 'CMX3600 audio levels omitted.'
			},
			fcpxml: {
				status: hasAudioAutomation ? 'native' : 'native',
				note: 'Expressed via adjust-volume and audio roles.'
			},
			otio: {
				status: hasAudioAutomation ? 'metadata-only' : 'native',
				note: 'Stored in thefreevideoeditor.volume/pan metadata.'
			}
		},
		{
			feature: 'Markers & Comments',
			xmeml: {
				status: hasMarkers ? 'native' : 'native',
				note: 'Expressed as sequence and clip <marker> tags.'
			},
			edl: {
				status: hasMarkers ? 'approximated' : 'native',
				note: 'Formatted as CMX3600 remark comments (* MARKER).'
			},
			fcpxml: {
				status: hasMarkers ? 'native' : 'native',
				note: 'Expressed as native <marker> tags.'
			},
			otio: {
				status: hasMarkers ? 'native' : 'native',
				note: 'Expressed as native Marker.1 elements.'
			}
		},
		{
			feature: 'Titles, Text, & Captions',
			xmeml: {
				status: hasText || hasCaptions ? 'approximated' : 'native',
				note: 'Expressed as title generator clipitems.'
			},
			edl: {
				status: hasText || hasCaptions ? 'omitted' : 'native',
				note: 'EDL does not support text/caption elements.'
			},
			fcpxml: {
				status: hasText || hasCaptions ? 'native' : 'native',
				note: 'Expressed as native <title> elements.'
			},
			otio: {
				status: hasText || hasCaptions ? 'metadata-only' : 'native',
				note: 'Stored in thefreevideoeditor.text/caption metadata.'
			}
		},
		{
			feature: 'Transitions',
			xmeml: {
				status: hasTransitions ? 'approximated' : 'native',
				note: 'Mapped to Cross Dissolve or cut boundaries.'
			},
			edl: {
				status: hasTransitions ? 'approximated' : 'native',
				note: 'Mapped to D (Dissolve) event or omitted.'
			},
			fcpxml: {
				status: hasTransitions ? 'native' : 'native',
				note: 'Expressed as native <transition> element.'
			},
			otio: {
				status: hasTransitions ? 'native' : 'native',
				note: 'Expressed as native Transition.1 element.'
			}
		}
	];
}

/**
 * Pure converter from application Project model to unified InterchangeTimeline.
 */
export function projectToInterchange(
	sourceProject: Project,
	options: ProjectToInterchangeOptions = {}
): InterchangeTimeline {
	// 1. Flatten nested sequences first
	const { project, omissions } = flattenForInterchange(sourceProject);

	// 2. Resolve exact rational rate
	const rate = resolveRate(project.settings.fps, options.dropFrame ?? false);

	// 3. Prepare assets
	const assets = new Map<AssetId, InterchangeAsset>();
	for (const asset of Object.values(project.assets)) {
		const path = options.mediaPaths?.get(asset.id) ?? `media/${sanitizeFilename(asset.name, '')}`;
		assets.set(asset.id, {
			id: asset.id,
			name: asset.name,
			path,
			durationFrames: microsToFrames(asset.duration, rate),
			width: asset.width,
			height: asset.height,
			hasAudio: asset.hasAudio ?? false,
			sampleRate: 48000,
			mimeType: asset.mimeType,
			size: asset.size
		});
	}

	// 4. Map tracks and clips
	const tracks: InterchangeTrack[] = project.tracks.map((track) => {
		const clips: InterchangeClip[] = [];
		const sorted = track.clips.toSorted((a, b) => a.start - b.start);

		for (const clip of sorted) {
			const startFrame = microsToFrames(clip.start, rate);
			const durationFrames = Math.max(1, microsToFrames(clip.duration, rate));
			const extent = sourceExtent(clip);
			const sourceInFrame = microsToFrames(extent.min, rate);
			const sourceOutFrame = Math.max(sourceInFrame, microsToFrames(extent.max, rate) - 1);

			let assetName = 'Clip';
			let mediaPath = '';
			if (clip.assetId) {
				const a = assets.get(clip.assetId);
				if (a) {
					assetName = a.name;
					mediaPath = a.path;
				}
			}

			const irClip: InterchangeClip = {
				id: clip.id,
				name: assetName,
				assetId: clip.assetId ?? null,
				mediaPath,
				recordIn: startFrame,
				recordOut: startFrame + durationFrames,
				duration: durationFrames,
				sourceIn: sourceInFrame,
				sourceOut: sourceOutFrame,
				speed: clip.speed ?? 1,
				timeRemap: Boolean(clip.timeRemap),
				volume: clip.volume ?? 1,
				pan: (clip as { pan?: number }).pan ?? 0,
				linkId: clip.linkId
			};

			// Text / Captions mapping
			if (clip.text) {
				irClip.text = {
					content: clip.text,
					fontSize: 48,
					fill: '#ffffff',
					align: 'center'
				};
				irClip.name = clip.text.slice(0, 30);
			}

			// Transforms
			if (clip.transform) {
				const t = clip.transform as unknown as Record<string, unknown>;
				const pos = Array.isArray(t.position)
					? (t.position as [number, number])
					: [Number(t.x ?? 0), Number(t.y ?? 0)];
				const sc = Array.isArray(t.scale)
					? (t.scale as [number, number])
					: [Number(t.scaleX ?? 1), Number(t.scaleY ?? 1)];
				irClip.transform = {
					position: [pos[0] ?? 0, pos[1] ?? 0],
					scale: [sc[0] ?? 1, sc[1] ?? 1],
					rotation: Number(t.rotation ?? 0),
					opacity: Number(t.opacity ?? 1)
				};
			}

			clips.push(irClip);
		}

		return {
			id: track.id,
			name: track.name,
			kind: track.kind,
			enabled: !(track.hidden || track.muted),
			locked: track.locked ?? false,
			volume: 1,
			pan: 0,
			clips,
			transitions: track.transitions?.map((t) => ({
				type: t.type,
				inFrame: 0,
				durationFrames: Math.max(1, microsToFrames(t.duration ?? 500000, rate))
			}))
		};
	});

	// 5. Map markers
	const markers: InterchangeMarker[] = project.markers.map((m) => ({
		id: m.id,
		frame: microsToFrames(m.time, rate),
		name: m.name ?? m.label ?? 'Marker',
		comment: m.name ?? m.label ?? '',
		color: m.color
	}));

	const totalMicros = timelineDuration(project);
	const durationFrames = Math.max(1, microsToFrames(totalMicros, rate));

	const featureAudits = buildFeatureAudits({ tracks, markers });

	return {
		name: project.name,
		rate,
		width: project.settings.width,
		height: project.settings.height,
		durationFrames,
		tracks,
		markers,
		assets,
		omissions,
		featureAudits
	};
}
