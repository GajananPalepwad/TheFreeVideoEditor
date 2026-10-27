import { CURRENT_SCHEMA_VERSION } from './schema';
import { rebaseMediaPath } from './ids';
import type {
	Asset,
	AssetId,
	ClipId,
	MarkerId,
	Project,
	ProjectId,
	ProjectSettings,
	Sequence,
	SequenceId,
	Track,
	TrackId
} from './types';

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
	width: 1920,
	height: 1080,
	fps: 30,
	sampleRate: 48_000
};

function randomId(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
		const random = Math.floor(Math.random() * 16);
		const value = character === 'x' ? random : (random & 0x3) | 0x8;
		return value.toString(16);
	});
}

function makeTrack(id: TrackId, kind: Track['kind'], name: string): Track {
	return {
		id,
		kind,
		name,
		muted: false,
		locked: false,
		hidden: false,
		clips: []
	};
}

export function createEmptyProject(options: {
	name: string;
	settings?: Partial<ProjectSettings>;
}): Project {
	const now = new Date().toISOString();
	const videoTrackId = randomId() as TrackId;
	const audioTrackId = randomId() as TrackId;
	return {
		id: randomId() as ProjectId,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		name: options.name.trim(),
		createdAt: now,
		updatedAt: now,
		settings: { ...DEFAULT_PROJECT_SETTINGS, ...options.settings },
		assets: {},
		tracks: [
			makeTrack(videoTrackId, 'video', 'Video 1'),
			makeTrack(audioTrackId, 'audio', 'Audio 1')
		],
		markers: []
	};
}

export function duplicateProject(project: Project): Project {
	const nextId = randomId() as ProjectId;
	const assetIdMap = new Map<string, string>();
	const trackIdMap = new Map<string, string>();
	const clipIdMap = new Map<string, string>();
	const markerIdMap = new Map<string, string>();
	const linkIdMap = new Map<string, string>();
	const groupIdMap = new Map<string, string>();

	for (const asset of Object.values(project.assets)) assetIdMap.set(asset.id, randomId());
	const sequenceIdMap = new Map<string, string>();
	const allTracks = [
		...project.tracks,
		...Object.values(project.sequences ?? {}).flatMap((sequence) => sequence.tracks)
	];
	for (const sequence of Object.values(project.sequences ?? {})) {
		sequenceIdMap.set(sequence.id, randomId());
	}
	for (const track of allTracks) {
		trackIdMap.set(track.id, randomId());
		for (const clip of track.clips) clipIdMap.set(clip.id, randomId());
	}
	for (const marker of project.markers) markerIdMap.set(marker.id, randomId());
	for (const track of allTracks) {
		for (const clip of track.clips) {
			if (clip.linkId && !linkIdMap.has(clip.linkId)) {
				linkIdMap.set(clip.linkId, randomId());
			}
			if (clip.groupId && !groupIdMap.has(clip.groupId)) {
				groupIdMap.set(clip.groupId, randomId());
			}
		}
	}

	const now = new Date().toISOString();
	const assets = Object.fromEntries(
		Object.values(project.assets).map((asset) => {
			const id = assetIdMap.get(asset.id) as AssetId;
			const copy: Asset = {
				...asset,
				id,
				opfsPath: rebaseMediaPath(nextId, id, asset.opfsPath),
				offline: true
			};
			// Proxies are derived data and are regenerated once the media is relinked.
			delete copy.proxy;
			return [id, copy];
		})
	) as Project['assets'];

	const remapTrack = (track: Track): Track => ({
		...track,
		id: trackIdMap.get(track.id) as TrackId,
		clips: track.clips.map((clip) => ({
			...clip,
			id: clipIdMap.get(clip.id) as ClipId,
			...(clip.assetId ? { assetId: assetIdMap.get(clip.assetId) as AssetId } : {}),
			...(clip.linkId ? { linkId: linkIdMap.get(clip.linkId) } : {}),
			...(clip.groupId ? { groupId: groupIdMap.get(clip.groupId) } : {}),
			effects: clip.effects?.map((effect) => ({ ...effect, id: randomId() })),
			...(clip.masks ? { masks: clip.masks.map((mask) => ({ ...mask, id: randomId() })) } : {}),
			...(clip.markers
				? {
						markers: clip.markers.map((marker) => ({
							...marker,
							id: randomId() as MarkerId
						}))
					}
				: {}),
			...(clip.source?.type === 'sequence'
				? {
						source: {
							...clip.source,
							sequenceId: sequenceIdMap.get(clip.source.sequenceId) as SequenceId
						}
					}
				: {})
		})),
		...(track.transitions
			? {
					transitions: track.transitions.map((transition) => ({
						...transition,
						id: randomId(),
						edge:
							transition.edge.kind === 'cut'
								? {
										kind: 'cut' as const,
										fromClipId: clipIdMap.get(transition.edge.fromClipId) as ClipId,
										toClipId: clipIdMap.get(transition.edge.toClipId) as ClipId
									}
								: {
										kind: transition.edge.kind,
										clipId: clipIdMap.get(transition.edge.clipId) as ClipId
									}
					}))
				}
			: {})
	});

	return {
		...project,
		id: nextId,
		name: `${project.name} copy`,
		createdAt: now,
		updatedAt: now,
		assets,
		tracks: project.tracks.map(remapTrack),
		...(project.sequences
			? {
					sequences: Object.fromEntries(
						Object.values(project.sequences).map((sequence) => {
							const id = sequenceIdMap.get(sequence.id) as SequenceId;
							return [
								id,
								{
									...sequence,
									id,
									tracks: sequence.tracks.map(remapTrack),
									...(sequence.markers
										? {
												markers: sequence.markers.map((marker) => ({
													...marker,
													id: randomId() as MarkerId
												}))
											}
										: {})
								}
							];
						})
					) as Record<SequenceId, Sequence>
				}
			: {}),
		markers: project.markers.map((marker) => ({
			...marker,
			id: markerIdMap.get(marker.id) as MarkerId
		}))
	};
}
