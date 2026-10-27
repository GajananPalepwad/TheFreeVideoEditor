import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset, AssetId, ProjectId } from '../../core';
import { generateDerived } from './derived';
import { getDerived, putDerived } from '../storage/mediaCache';

const storageMocks = vi.hoisted(() => ({
	getMediaFile: vi.fn()
}));

vi.mock('../storage/opfs', () => ({
	getMediaFile: storageMocks.getMediaFile
}));

describe('generateDerived cache invalidation', () => {
	const projectId = 'proj-test' as ProjectId;
	const assetId = 'asset-video-1' as AssetId;
	const videoAsset: Asset = {
		id: assetId,
		kind: 'video',
		name: 'sample.mp4',
		duration: 6_000_000,
		hasAudio: true,
		mimeType: 'video/mp4',
		size: 1024,
		opfsPath: 'projects/proj-test/media/asset-video-1.mp4'
	};

	beforeEach(() => {
		storageMocks.getMediaFile.mockReset();
	});

	it('returns cached data directly when cache is valid and starts at time 0', async () => {
		const validDerived = {
			poster: new Blob(['poster'], { type: 'image/webp' }),
			thumbs: [
				{ time: 0, blob: new Blob(['thumb0'], { type: 'image/webp' }) },
				{ time: 3_000_000, blob: new Blob(['thumb1-diff'], { type: 'image/webp' }) },
				{ time: 5_980_000, blob: new Blob(['thumb2-different-size'], { type: 'image/webp' }) }
			],
			waveformStatus: 'ready' as const
		};
		await putDerived(projectId, assetId, validDerived);

		const result = await generateDerived(projectId, videoAsset);
		expect(result).toEqual(validDerived);
		expect(storageMocks.getMediaFile).not.toHaveBeenCalled();
	});

	it('detects bogus legacy cache where thumbs did not start at time 0 and re-extracts', async () => {
		const bogusDerived = {
			poster: new Blob(['poster'], { type: 'image/webp' }),
			thumbs: [
				{ time: 1_500_000, blob: new Blob(['thumb0'], { type: 'image/webp' }) },
				{ time: 3_000_000, blob: new Blob(['thumb0'], { type: 'image/webp' }) }
			],
			waveformStatus: 'ready' as const,
			peaks: {
				sampleRate: 48000,
				bucketsPerSecond: 20,
				min: new Int8Array([-1, 0]),
				max: new Int8Array([1, 0])
			}
		};
		await putDerived(projectId, assetId, bogusDerived);

		// When bogus cache is detected, getMediaFile is called to regenerate
		storageMocks.getMediaFile.mockRejectedValue(
			new Error('Media file requested for re-extraction')
		);

		await expect(generateDerived(projectId, videoAsset)).rejects.toThrow(
			'Media file requested for re-extraction'
		);
		expect(storageMocks.getMediaFile).toHaveBeenCalledWith(projectId, videoAsset);
	});
});
