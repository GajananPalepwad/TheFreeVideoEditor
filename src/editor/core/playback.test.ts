import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { fitRect, previewScale } from './composition';
import { nextBoundary, resolveFrame } from './playback';
import type { Asset, AssetId, Clip, Project, Track, TrackId } from './types';

function makeAsset(id: string, kind: Asset['kind'], overrides: Partial<Asset> = {}): Asset {
	return {
		id: id as AssetId,
		kind,
		name: `${id}.${kind === 'image' ? 'png' : kind === 'audio' ? 'wav' : 'mp4'}`,
		mimeType: kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/wav' : 'video/mp4',
		size: 100,
		duration: 2_000_000,
		hasAudio: kind !== 'image',
		opfsPath: `projects/project/media/${id}`,
		...overrides
	};
}

function makeClip(id: string, assetId: string, start: number, overrides: Partial<Clip> = {}): Clip {
	return {
		id: id as Clip['id'],
		assetId: assetId as AssetId,
		start,
		duration: 1_000_000,
		sourceIn: 0,
		sourceOut: 1_000_000,
		speed: 1,
		volume: 1,
		...overrides
	};
}

function makeTrack(
	id: string,
	kind: Track['kind'],
	clips: Clip[],
	overrides: Partial<Track> = {}
): Track {
	return {
		id: id as Track['id'],
		kind,
		name: id,
		muted: false,
		locked: false,
		hidden: false,
		clips,
		...overrides
	};
}

function projectWith(tracks: Track[], assets: Asset[]): Project {
	const project = createEmptyProject({ name: 'Playback test' });
	return {
		...project,
		assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
		tracks
	};
}

describe('resolveFrame', () => {
	it('uses start-inclusive, end-exclusive clip bounds and speed-aware source time', () => {
		const asset = makeAsset('video-a', 'video');
		const clip = makeClip('clip-a', asset.id, 1_000_000, {
			duration: 500_000,
			sourceIn: 250_000,
			sourceOut: 750_000,
			speed: 2
		});
		const project = projectWith(
			[makeTrack('video', 'video', [clip]), makeTrack('audio', 'audio', [])],
			[asset]
		);

		expect(resolveFrame(project, 1_000_000).videoLayers[0]?.sourceTime).toBe(250_000);
		expect(resolveFrame(project, 1_250_000).videoLayers[0]?.sourceTime).toBe(750_000);
		expect(resolveFrame(project, 1_500_000).videoLayers).toEqual([]);
	});

	it('draws the first video track on top and excludes hidden and offline media', () => {
		const top = makeAsset('top', 'video');
		const lower = makeAsset('lower', 'image');
		const hidden = makeAsset('hidden', 'video');
		const offline = makeAsset('offline', 'video', { offline: true });
		const project = projectWith(
			[
				makeTrack('top-track', 'video', [makeClip('top-clip', top.id, 0)]),
				makeTrack('hidden-track', 'video', [makeClip('hidden-clip', hidden.id, 0)], {
					hidden: true
				}),
				makeTrack('lower-track', 'video', [
					makeClip('lower-clip', lower.id, 0),
					makeClip('offline-clip', offline.id, 0)
				]),
				makeTrack('audio-track', 'audio', [])
			],
			[top, lower, hidden, offline]
		);

		const resolved = resolveFrame(project, 500_000);
		expect(resolved.videoLayers.map((layer) => layer.clipId)).toEqual(['lower-clip', 'top-clip']);
		expect(resolved.missing).toEqual([offline.id]);
		expect(resolveFrame(project, 1_000_000).videoLayers).toEqual([]);
	});

	it('resolves audio clips, volume and mute state without filling timeline gaps', () => {
		const audio = makeAsset('audio-a', 'audio');
		const linkedVideo = makeAsset('linked-video', 'video');
		const project = projectWith(
			[
				makeTrack('video', 'video', []),
				makeTrack(
					'audio',
					'audio',
					[
						makeClip('audio-clip', audio.id, 0, { volume: 0.4 }),
						makeClip('linked-clip', linkedVideo.id, 0, { linkId: 'pair' })
					],
					{ muted: true }
				)
			],
			[audio, linkedVideo]
		);

		expect(resolveFrame(project, 500_000).audioSources).toEqual([]);
		const audible = {
			...project,
			tracks: project.tracks.map((track) =>
				track.kind === 'audio' ? { ...track, muted: false } : track
			)
		};
		expect(resolveFrame(audible, 500_000).audioSources).toMatchObject([
			{ clipId: 'audio-clip', sourceTime: 500_000, volume: 0.4 },
			{ clipId: 'linked-clip', sourceTime: 500_000, volume: 1 }
		]);
		expect(resolveFrame(audible, 1_000_000).audioSources).toEqual([]);
	});

	it('resolves text clips into ActiveLayer of kind "text" with full textData', () => {
		const textClip: Clip = {
			id: 'text-1' as Clip['id'],
			start: 0,
			duration: 2_000_000,
			sourceIn: 0,
			sourceOut: 2_000_000,
			speed: 1,
			volume: 0,
			source: {
				type: 'text',
				text: 'Sample Headline',
				style: { fontFamily: 'Montserrat', alignment: 'center' },
				box: { autoSize: true, verticalAnchor: 'center' }
			},
			properties: {
				'text.fontSize': { value: 72 },
				'text.fillColor': { value: [1, 0.8, 0, 1] },
				'text.strokeColor': { value: [0, 0, 0, 1] },
				'text.strokeWidth': { value: 2 },
				'text.reveal': { value: 1 }
			}
		};
		const project = projectWith([makeTrack('video-track', 'video', [textClip])], []);

		const resolved = resolveFrame(project, 500_000);
		expect(resolved.videoLayers).toHaveLength(1);
		const layer = resolved.videoLayers[0]!;
		expect(layer.kind).toBe('text');
		expect(layer.clipId).toBe('text-1');
		expect(layer.fit).toBe('none');
		expect(layer.textData).toBeDefined();
		expect(layer.textData?.text).toBe('Sample Headline');
		expect(layer.textData?.fontSize).toBe(72);
		expect(layer.textData?.fillColor).toEqual({ r: 1, g: 0.8, b: 0, a: 1 });
		expect(layer.textData?.strokeWidth).toBe(2);
		expect(layer.textData?.style.fontFamily).toBe('Montserrat');
	});

	it('reports boundaries in the requested direction', () => {
		const asset = makeAsset('video-a', 'video');
		const project = projectWith(
			[
				makeTrack('video', 'video', [
					makeClip('first', asset.id, 1_000_000),
					makeClip('second', asset.id, 3_000_000)
				]),
				makeTrack('audio', 'audio', [])
			],
			[asset]
		);

		expect(nextBoundary(project, 1_000_000, 1)).toBe(2_000_000);
		expect(nextBoundary(project, 2_000_000, 1)).toBe(3_000_000);
		expect(nextBoundary(project, 3_000_000, -1)).toBe(2_000_000);
		expect(nextBoundary(project, 0, -1)).toBeNull();
	});

	it('resolves active caption tracks into ActiveLayer of kind "text" with word highlights', () => {
		const captionTrack: Track = {
			id: 'track-cap' as TrackId,
			kind: 'caption',
			name: 'Captions',
			muted: false,
			locked: false,
			hidden: false,
			clips: [],
			captions: [
				{
					id: 'cap-1',
					start: 1_000_000,
					end: 4_000_000,
					text: 'Hello world',
					words: [
						{ text: 'Hello', start: 1_000_000, end: 2_000_000 },
						{ text: 'world', start: 2_000_000, end: 3_500_000 }
					]
				}
			],
			captionStyle: {
				fontFamily: 'Inter',
				fontSize: 40,
				positionPreset: 'bottom',
				alignment: 'center',
				maxLines: 2,
				maxCharsPerLine: 40,
				color: { r: 1, g: 1, b: 1, a: 1 },
				highlightMode: 'word',
				highlightColor: { r: 1, g: 1, b: 0, a: 1 }
			}
		};

		const project = projectWith([captionTrack], []);

		// Before caption: no layers
		const frameBefore = resolveFrame(project, 500_000);
		expect(frameBefore.videoLayers).toHaveLength(0);

		// During first word (1.5s): caption active with 'Hello' highlighted
		const frameWord1 = resolveFrame(project, 1_500_000);
		expect(frameWord1.videoLayers).toHaveLength(1);
		const layer1 = frameWord1.videoLayers[0]!;
		expect(layer1.kind).toBe('text');
		expect(layer1.textData?.text).toBe('Hello world');
		expect(layer1.textData?.fontSize).toBe(40);
		expect(layer1.textData?.colorRuns).toBeDefined();
		expect(layer1.textData?.colorRuns).toHaveLength(1);
		expect(layer1.textData?.colorRuns![0]!.startIndex).toBe(0);
		expect(layer1.textData?.colorRuns![0]!.endIndex).toBe(5);
		expect(layer1.textData?.colorRuns![0]!.fillColor).toEqual({ r: 1, g: 1, b: 0, a: 1 });

		// During second word (2.5s): 'world' highlighted
		const frameWord2 = resolveFrame(project, 2_500_000);
		const layer2 = frameWord2.videoLayers[0]!;
		expect(layer2.textData?.colorRuns![0]!.startIndex).toBe(6);
		expect(layer2.textData?.colorRuns![0]!.endIndex).toBe(11);

		// After caption: no layers
		const frameAfter = resolveFrame(project, 4_500_000);
		expect(frameAfter.videoLayers).toHaveLength(0);
	});
});

describe('composition geometry', () => {
	it('fits the full source in the project output and computes preview scale', () => {
		expect(fitRect(1920, 1080, 1080, 1080)).toEqual({
			x: 0,
			y: 236.25,
			width: 1080,
			height: 607.5
		});
		expect(fitRect(1920, 1080, 1080, 1080, 'cover')).toEqual({
			x: -420,
			y: 0,
			width: 1920,
			height: 1080
		});
		expect(previewScale(1920, 1080, 960, 540)).toBe(0.5);
	});
});

describe('text animation on layers', () => {
	function textClip(properties: Clip['properties']): Clip {
		return {
			id: 'anim-text' as Clip['id'],
			start: 0,
			duration: 2_000_000,
			sourceIn: 0,
			sourceOut: 2_000_000,
			speed: 1,
			volume: 0,
			source: { type: 'text', text: 'Kinetic' },
			properties
		};
	}

	const layerAt = (clip: Clip, time: number) =>
		resolveFrame(projectWith([makeTrack('video', 'video', [clip])], []), time).videoLayers[0]!;

	it('has no animator when the clip does not set text.anim.progress', () => {
		expect(layerAt(textClip({ 'text.anim.offsetY': { value: 10 } }), 0).textData?.animator).toBeUndefined();
	});

	it('follows the progress over time and takes the pose from the other properties', () => {
		const clip = textClip({
			'text.anim.progress': {
				keyframes: [
					{ time: 0, value: 0, interpolation: 'linear' },
					{ time: 1_000_000, value: 1, interpolation: 'linear' }
				]
			},
			'text.anim.offsetY': { value: 60 },
			'text.anim.stagger': { value: 0.3 }
		});
		const start = layerAt(clip, 0).textData!.animator!;
		const half = layerAt(clip, 500_000).textData!.animator!;
		const end = layerAt(clip, 1_500_000).textData!.animator!;
		expect(start).toMatchObject({ progress: 0, offsetY: 60, stagger: 0.3 });
		expect(half.progress).toBeCloseTo(0.5, 6);
		expect(end.progress).toBe(1);
	});
});
