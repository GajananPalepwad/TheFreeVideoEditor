import type {
	AssetId,
	ClipId,
	TrackId,
	Project,
	Track,
	Clip,
	Asset,
	Marker,
	MarkerId,
	MarkerColor
} from '../../../core/types';
import { createEmptyProject } from '../../../core/factory';
import type { InterchangeTimeline } from '../../../core/interchange/ir';
import { framesToMicros } from '../../../core/interchange/time';

export interface MissingAssetInfo {
	id: AssetId;
	name: string;
	expectedPath: string;
	durationFrames: number;
	hasAudio: boolean;
	width?: number;
	height?: number;
	size?: number;
}

export interface RelinkMatchCandidate {
	file: File;
	score: number; // 0 to 1
	reason: string;
}

/**
 * Checks which assets in the InterchangeTimeline do not have local file bytes.
 */
export function identifyMissingAssets(
	ir: InterchangeTimeline,
	availablePackageFiles: Map<string, Uint8Array | File> = new Map()
): MissingAssetInfo[] {
	const missing: MissingAssetInfo[] = [];

	for (const [id, asset] of ir.assets.entries()) {
		const cleanPath = asset.path.replace(/^\/+/, '');
		const cleanName = asset.name.toLowerCase();

		let found = false;
		for (const key of availablePackageFiles.keys()) {
			const candidateClean = key.replace(/^\/+/, '');
			if (
				candidateClean.toLowerCase() === cleanPath.toLowerCase() ||
				candidateClean.toLowerCase().endsWith(cleanName)
			) {
				found = true;
				break;
			}
		}

		if (!found) {
			missing.push({
				id,
				name: asset.name,
				expectedPath: asset.path,
				durationFrames: asset.durationFrames,
				hasAudio: asset.hasAudio,
				width: asset.width,
				height: asset.height,
				size: asset.size
			});
		}
	}

	return missing;
}

/**
 * Finds best matching file for a missing asset from a list of candidate user files.
 * Matches by exact filename and size, stem and size, container format variation, or partial name.
 */
export function matchCandidateFile(
	missing: MissingAssetInfo,
	candidates: File[]
): RelinkMatchCandidate | null {
	const targetBase = missing.name.toLowerCase();
	const targetStem = targetBase.replace(/\.[^.]+$/, '');
	const expectedSize = missing.size && missing.size > 0 ? missing.size : null;

	let bestMatch: RelinkMatchCandidate | null = null;

	for (const file of candidates) {
		const fileName = file.name.toLowerCase();
		const fileStem = fileName.replace(/\.[^.]+$/, '');
		const sizeMatches = expectedSize !== null && file.size === expectedSize;

		let score = 0;
		let reason = '';

		// 1. Exact filename match
		if (fileName === targetBase) {
			if (sizeMatches) {
				return { file, score: 1.0, reason: 'Exact filename and size match' };
			}
			score = expectedSize !== null ? 0.95 : 1.0;
			reason = 'Exact filename match';
		} else if (fileStem === targetStem) {
			// 2. Stem match with different container format / extension
			if (sizeMatches) {
				score = 0.92;
				reason = 'Name and file size match (different container)';
			} else {
				score = 0.9;
				reason = 'Name match (different container format)';
			}
		} else if (fileName.includes(targetStem) || targetStem.includes(fileStem)) {
			// 3. Fuzzy substring match
			if (sizeMatches) {
				score = 0.85;
				reason = 'Partial name and file size match';
			} else {
				score = 0.7;
				reason = 'Partial filename match';
			}
		}

		if (score > 0 && (!bestMatch || score > bestMatch.score)) {
			bestMatch = { file, score, reason };
			// If we got a perfect score (1.0), we can exit early
			if (score >= 1.0) {
				return bestMatch;
			}
		}
	}

	return bestMatch;
}

/**
 * Recursively crawls a FileSystemDirectoryHandle and collects all File objects.
 */
export async function crawlDirectory(dirHandle: FileSystemDirectoryHandle): Promise<File[]> {
	const files: File[] = [];

	async function scan(handle: FileSystemDirectoryHandle): Promise<void> {
		const iterator = (handle as unknown as { values(): AsyncIterable<FileSystemHandle> }).values();
		for await (const entry of iterator) {
			if (entry.kind === 'file') {
				try {
					const file = await (entry as FileSystemFileHandle).getFile();
					files.push(file);
				} catch {
					// Ignore unreadable or locked files
				}
			} else if (entry.kind === 'directory') {
				try {
					await scan(entry as FileSystemDirectoryHandle);
				} catch {
					// Ignore inaccessible subdirectories
				}
			}
		}
	}

	await scan(dirHandle);
	return files;
}

/**
 * Recursively extracts File objects from a DataTransfer object,
 * supporting dropped directories via WebKit FileSystemEntry API.
 */
export async function crawlDataTransferEntries(dataTransfer: DataTransfer): Promise<File[]> {
	const files: File[] = [];
	const items = dataTransfer.items;

	if (items && items.length > 0) {
		const entries: FileSystemEntry[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item?.webkitGetAsEntry) {
				const entry = item.webkitGetAsEntry();
				if (entry) entries.push(entry);
			}
		}

		if (entries.length > 0) {
			async function scanEntry(entry: FileSystemEntry): Promise<void> {
				if (entry.isFile) {
					await new Promise<void>((resolve) => {
						(entry as FileSystemFileEntry).file(
							(file) => {
								files.push(file);
								resolve();
							},
							() => resolve()
						);
					});
				} else if (entry.isDirectory) {
					const reader = (entry as FileSystemDirectoryEntry).createReader();
					const readBatch = (): Promise<FileSystemEntry[]> =>
						new Promise((resolve) => {
							reader.readEntries(
								(res) => resolve(res),
								() => resolve([])
							);
						});

					let batch: FileSystemEntry[];
					do {
						batch = await readBatch();
						for (const child of batch) {
							await scanEntry(child);
						}
					} while (batch.length > 0);
				}
			}

			for (const entry of entries) {
				await scanEntry(entry);
			}
			return files;
		}
	}

	if (dataTransfer.files && dataTransfer.files.length > 0) {
		return Array.from(dataTransfer.files);
	}

	return files;
}

/**
 * Converts an InterchangeTimeline into a native Project data structure.
 */
export function interchangeToProject(
	ir: InterchangeTimeline,
	resolvedFiles: Map<AssetId, File> = new Map()
): { project: Project; offlineCount: number } {
	const project = createEmptyProject({
		name: ir.name,
		settings: {
			width: ir.width || 1920,
			height: ir.height || 1080,
			fps: ir.rate.numerator / ir.rate.denominator
		}
	});

	let offlineCount = 0;

	// Assets
	for (const [id, irAsset] of ir.assets.entries()) {
		const file = resolvedFiles.get(id);
		const isOffline = !file;
		if (isOffline) offlineCount += 1;

		const asset: Asset = {
			id,
			kind: irAsset.width ? 'video' : 'audio',
			name: irAsset.name,
			mimeType: file?.type || irAsset.mimeType || (irAsset.width ? 'video/mp4' : 'audio/wav'),
			size: file?.size || 0,
			duration: framesToMicros(irAsset.durationFrames, ir.rate),
			width: irAsset.width,
			height: irAsset.height,
			hasAudio: irAsset.hasAudio,
			offline: isOffline,
			opfsPath: isOffline ? '' : `projects/${project.id}/media/${id}`
		};

		project.assets[id] = asset;
	}

	// Tracks & Clips
	project.tracks = ir.tracks.map((irTrack, trackIdx): Track => {
		const clips: Clip[] = irTrack.clips.map((irClip, clipIdx): Clip => {
			const start = framesToMicros(irClip.recordIn, ir.rate);
			const duration = framesToMicros(irClip.duration, ir.rate);
			const sourceIn = framesToMicros(irClip.sourceIn, ir.rate);
			const sourceOut = framesToMicros(irClip.sourceOut, ir.rate);

			const clip: Clip = {
				id: `clip-${trackIdx + 1}-${clipIdx + 1}` as ClipId,
				assetId: irClip.assetId ?? undefined,
				start,
				duration,
				sourceIn,
				sourceOut,
				speed: irClip.speed ?? 1,
				volume: irClip.volume ?? 1,
				linkId: irClip.linkId
			};

			if (irClip.text) {
				clip.text = irClip.text.content;
				clip.source = {
					type: 'text',
					text: irClip.text.content,
					style: {
						fontFamily: 'Geist',
						alignment: irClip.text.align ?? 'center'
					}
				};
			}

			if (irClip.transform) {
				clip.transform = {
					x: irClip.transform.position[0],
					y: irClip.transform.position[1],
					scaleX: irClip.transform.scale[0],
					scaleY: irClip.transform.scale[1],
					rotation: irClip.transform.rotation,
					opacity: irClip.transform.opacity
				};
			}

			return clip;
		});

		return {
			id: `track-${trackIdx + 1}` as TrackId,
			name: irTrack.name,
			kind: irTrack.kind,
			muted: !irTrack.enabled,
			hidden: !irTrack.enabled,
			locked: irTrack.locked,
			clips
		};
	});

	// Markers
	project.markers = ir.markers.map((m, idx): Marker => ({
		id: `marker-${idx}-${Date.now().toString(36)}` as MarkerId,
		time: framesToMicros(m.frame, ir.rate),
		name: m.name,
		color: (m.color as MarkerColor) || 'blue'
	}));

	return { project, offlineCount };
}
