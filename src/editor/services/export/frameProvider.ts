import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import type { ActiveLayer, Project } from '../../core';
import type { AssetId } from '../../core';
import { getMediaFile } from '../storage/opfs';
import { rasterizeText } from '../render/text/rasterizer';
import { ensureFontLoaded } from '../render/text/fontLoader';
import { rasterizeShape } from '../render/shapes/shapeRasterizer';

interface VideoDecoderEntry {
	input: Input;
	sink: VideoSampleSink;
	lastUsed: number;
}

const MAX_OPEN_INPUTS = 4;

export class FrameProviderError extends Error {
	readonly assetId: AssetId;

	constructor(assetId: AssetId, assetName: string, cause: unknown) {
		super(`Could not decode “${assetName}” for export. Check that its codec is supported.`, {
			cause
		});
		this.name = 'FrameProviderError';
		this.assetId = assetId;
	}
}

export class ExportFrameProvider {
	private readonly decoders = new Map<AssetId, VideoDecoderEntry>();
	private readonly images = new Map<AssetId, ImageBitmap>();
	private readonly canvases = new Map<string, OffscreenCanvas>();
	private readonly prepared = new Map<string, CanvasImageSource>();
	private readonly frameCache = new Map<string, ImageBitmap>();
	private readonly cacheKeys: string[] = [];
	private clock = 0;
	private disposed = false;

	constructor(
		private readonly project: Project,
		private readonly getFile: typeof getMediaFile = getMediaFile
	) {}

	async prepare(layers: readonly ActiveLayer[], signal?: AbortSignal): Promise<void> {
		this.prepared.clear();
		const allLayers: ActiveLayer[] = [];
		const collect = (layerList: readonly ActiveLayer[]) => {
			for (const layer of layerList) {
				if (layer.transition) {
					allLayers.push(layer.transition.fromLayer);
					allLayers.push(layer.transition.toLayer);
				} else {
					allLayers.push(layer);
				}
				if (layer.nested?.layers) {
					collect(layer.nested.layers);
				}
			}
		};
		collect(layers);

		for (const layer of allLayers) {
			const layerKey = layer.instanceKey ?? layer.clipId;
			if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
			if (layer.kind === 'shape' && layer.shapeData) {
				const shapeCanvas = rasterizeShape(layer.shapeData);
				this.prepared.set(layerKey, shapeCanvas.canvas as unknown as CanvasImageSource);
				continue;
			}
			if (layer.kind === 'text' && layer.textData) {
				const data = layer.textData;
				if (data.style.fontFamily) {
					await ensureFontLoaded(data.style.fontFamily);
				}
				const scale = Math.max(layer.transform?.scaleX ?? 1, layer.transform?.scaleY ?? 1);
				const textCanvas = rasterizeText({
					text: data.text,
					style: data.style,
					box: data.box,
					fontSize: data.fontSize,
					fillColor: data.fillColor,
					strokeColor: data.strokeColor,
					strokeWidth: data.strokeWidth,
					letterSpacing: data.letterSpacing,
					lineHeight: data.lineHeight,
					reveal: data.reveal,
					shadowColor: data.shadowColor,
					shadowBlur: data.shadowBlur,
					shadowOffsetX: data.shadowOffsetX,
					shadowOffsetY: data.shadowOffsetY,
					backgroundBoxColor: data.backgroundBoxColor,
					backgroundBoxPadding: data.backgroundBoxPadding,
					backgroundBoxRadius: data.backgroundBoxRadius,
					boxBorderColor: data.boxBorderColor,
					boxBorderWidth: data.boxBorderWidth,
					accentBarColor: data.accentBarColor,
					accentBarWidth: data.accentBarWidth,
					frameStyle: data.frameStyle,
					badgeText: data.badgeText,
					gradientType: data.gradientType,
					gradientColorEnd: data.gradientColorEnd,
					gradientAngle: data.gradientAngle,
					gradientStops: data.gradientStops,
					colorRuns: data.colorRuns,
					scale
				});
				this.prepared.set(layerKey, textCanvas);
				continue;
			}
			if (!layer.assetId) continue;
			const asset = this.project.assets[layer.assetId];
			if (!asset || asset.offline) continue;
			try {
				if (asset.kind === 'image') {
					let image = this.images.get(asset.id);
					if (!image) {
						image = await createImageBitmap(await this.getFile(this.project.id, asset));
						this.images.set(asset.id, image);
					}
					this.prepared.set(layerKey, image);
					continue;
				}
				const timeSec = Math.max(0, layer.sourceTime / 1_000_000);
				const cacheKey = `${asset.id}:${Math.round(timeSec * (asset.fps ?? 30))}`;
				const cached = this.frameCache.get(cacheKey);
				if (cached) {
					this.prepared.set(layerKey, cached);
					continue;
				}

				const decoder = await this.getDecoder(asset.id, asset.name);
				let sample = await decoder.sink.getSample(timeSec);
				if (!sample && layer.sourceTime > 0 && asset.duration > 0) {
					sample = await decoder.sink.getSample(
						Math.max(0, asset.duration - Math.max(1, Math.round(1_000_000 / (asset.fps ?? 30)))) /
							1_000_000
					);
				}
				if (!sample) continue;
				let canvas = this.canvases.get(layerKey);
				if (
					!canvas ||
					canvas.width !== sample.displayWidth ||
					canvas.height !== sample.displayHeight
				) {
					canvas = new OffscreenCanvas(sample.displayWidth, sample.displayHeight);
					this.canvases.set(layerKey, canvas);
				}
				const context = canvas.getContext('2d');
				if (!context) throw new Error('Offscreen canvas 2D rendering is unavailable.');
				try {
					sample.draw(context, 0, 0, canvas.width, canvas.height);
					const bitmap = await createImageBitmap(canvas);
					this.frameCache.set(cacheKey, bitmap);
					this.cacheKeys.push(cacheKey);
					if (this.cacheKeys.length > 64) {
						const evict = this.cacheKeys.shift();
						if (evict) {
							const old = this.frameCache.get(evict);
							old?.close();
							this.frameCache.delete(evict);
						}
					}
					this.prepared.set(layerKey, bitmap);
				} finally {
					sample.close();
				}
			} catch (error) {
				if (error instanceof DOMException && error.name === 'AbortError') throw error;
				throw new FrameProviderError(layer.assetId, asset.name, error);
			}
		}
	}

	getFrame(layer: ActiveLayer): CanvasImageSource | null {
		return this.prepared.get(layer.instanceKey ?? layer.clipId) ?? null;
	}

	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		for (const bitmap of this.frameCache.values()) bitmap.close();
		this.frameCache.clear();
		for (const decoder of this.decoders.values()) decoder.input.dispose();
		this.decoders.clear();
		for (const image of this.images.values()) image.close();
		this.images.clear();
		this.canvases.clear();
		this.prepared.clear();
	}

	private async getDecoder(assetId: AssetId, assetName: string): Promise<VideoDecoderEntry> {
		const existing = this.decoders.get(assetId);
		if (existing) {
			existing.lastUsed = ++this.clock;
			return existing;
		}
		const asset = this.project.assets[assetId];
		if (!asset) throw new Error(`Project asset “${assetId}” is missing.`);
		const file = await this.getFile(this.project.id, asset);
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) throw new Error('The asset has no decodable video track.');
			const entry = {
				input,
				sink: new VideoSampleSink(videoTrack),
				lastUsed: ++this.clock
			};
			if (this.decoders.size >= MAX_OPEN_INPUTS) {
				const oldest = [...this.decoders.entries()].toSorted(
					(first, second) => first[1].lastUsed - second[1].lastUsed
				)[0];
				if (oldest) {
					oldest[1].input.dispose();
					this.decoders.delete(oldest[0]);
				}
			}
			this.decoders.set(assetId, entry);
			return entry;
		} catch (error) {
			input.dispose();
			throw new FrameProviderError(assetId, assetName, error);
		}
	}
}
