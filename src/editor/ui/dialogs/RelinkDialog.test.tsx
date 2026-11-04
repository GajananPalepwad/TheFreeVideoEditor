import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import RelinkDialog from './RelinkDialog';
import type { InterchangeTimeline } from '../../core/interchange/ir';
import { resolveRate } from '../../core/interchange/time';
import type { MissingAssetInfo } from '../../services/interop/import/relink';
import type { AssetId } from '../../core/types';

describe('RelinkDialog component', () => {
	const mockTimeline: InterchangeTimeline = {
		name: 'Test Sequence',
		rate: resolveRate(30),
		width: 1920,
		height: 1080,
		durationFrames: 300,
		tracks: [],
		markers: [],
		omissions: [],
		featureAudits: [],
		assets: new Map()
	};

	const mockMissing: MissingAssetInfo[] = [
		{
			id: 'asset-1' as AssetId,
			name: 'clip1.mp4',
			expectedPath: '/media/clip1.mp4',
			durationFrames: 100,
			hasAudio: true,
			size: 10_000_000
		}
	];

	it('renders nothing when isOpen is false', () => {
		const html = renderToString(
			<RelinkDialog
				isOpen={false}
				timeline={mockTimeline}
				missingAssets={mockMissing}
				onRelinkComplete={() => {}}
				onImportOffline={() => {}}
				onClose={() => {}}
			/>
		);
		expect(html).toBe('');
	});

	it('renders dialog with Search Folder button and fallback input when isOpen is true', () => {
		const html = renderToString(
			<RelinkDialog
				isOpen={true}
				timeline={mockTimeline}
				missingAssets={mockMissing}
				onRelinkComplete={() => {}}
				onImportOffline={() => {}}
				onClose={() => {}}
			/>
		);

		expect(html).toContain('Relink Missing Media');
		expect(html).toContain('Search Folder…');
		expect(html).toContain('Browse Files…');
		expect(html).toContain('webkitdirectory');
		expect(html).toContain('clip1.mp4');
		expect(html).toContain('Import as Offline Media');
	});
});
