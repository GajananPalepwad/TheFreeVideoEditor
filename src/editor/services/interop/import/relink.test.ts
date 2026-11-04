import { describe, expect, it } from 'vitest';
import type { AssetId } from '../../../core/types';
import {
	crawlDirectory,
	crawlDataTransferEntries,
	matchCandidateFile,
	type MissingAssetInfo
} from './relink';

describe('relink service', () => {
	describe('matchCandidateFile with size support', () => {
		const missingWithSize: MissingAssetInfo = {
			id: 'asset-1' as AssetId,
			name: 'interview.mp4',
			expectedPath: '/Volumes/Media/interview.mp4',
			durationFrames: 250,
			hasAudio: true,
			size: 50_000_000
		};

		it('prefers exact filename AND matching file size over same-named proxy with different size', () => {
			const proxyFile = new File([new Uint8Array(500)], 'interview.mp4', { type: 'video/mp4' });
			Object.defineProperty(proxyFile, 'size', { value: 5_000_000 });

			const rawFile = new File([new Uint8Array(500)], 'interview.mp4', { type: 'video/mp4' });
			Object.defineProperty(rawFile, 'size', { value: 50_000_000 });

			const match = matchCandidateFile(missingWithSize, [proxyFile, rawFile]);
			expect(match).not.toBeNull();
			expect(match?.file).toBe(rawFile);
			expect(match?.score).toBe(1.0);
			expect(match?.reason).toBe('Exact filename and size match');
		});

		it('matches stem and size when container format differs', () => {
			const movFile = new File([new Uint8Array(500)], 'interview.mov', { type: 'video/quicktime' });
			Object.defineProperty(movFile, 'size', { value: 50_000_000 });

			const match = matchCandidateFile(missingWithSize, [movFile]);
			expect(match).not.toBeNull();
			expect(match?.score).toBe(0.92);
			expect(match?.reason).toBe('Name and file size match (different container)');
		});

		it('matches partial name and size when filename has prefix/suffix', () => {
			const gradedFile = new File([new Uint8Array(500)], 'interview_graded.mp4', {
				type: 'video/mp4'
			});
			Object.defineProperty(gradedFile, 'size', { value: 50_000_000 });

			const match = matchCandidateFile(missingWithSize, [gradedFile]);
			expect(match).not.toBeNull();
			expect(match?.score).toBe(0.85);
			expect(match?.reason).toBe('Partial name and file size match');
		});

		it('falls back to exact filename match when file size differs', () => {
			const differentSizeFile = new File([new Uint8Array(500)], 'interview.mp4', {
				type: 'video/mp4'
			});
			Object.defineProperty(differentSizeFile, 'size', { value: 12_345 });

			const match = matchCandidateFile(missingWithSize, [differentSizeFile]);
			expect(match).not.toBeNull();
			expect(match?.score).toBe(0.95);
			expect(match?.reason).toBe('Exact filename match');
		});
	});

	describe('crawlDirectory', () => {
		it('recursively crawls nested subdirectories to collect all files', async () => {
			const file1 = new File(['1'], 'clip1.mp4', { type: 'video/mp4' });
			const file2 = new File(['2'], 'clip2.mov', { type: 'video/quicktime' });
			const file3 = new File(['3'], 'audio.wav', { type: 'audio/wav' });

			const mockDirHandle: FileSystemDirectoryHandle = {
				kind: 'directory',
				name: 'root',
				async *values() {
					yield {
						kind: 'file',
						name: 'clip1.mp4',
						async getFile() {
							return file1;
						}
					};
					yield {
						kind: 'directory',
						name: 'subfolder',
						async *values() {
							yield {
								kind: 'file',
								name: 'clip2.mov',
								async getFile() {
									return file2;
								}
							};
							yield {
								kind: 'directory',
								name: 'deep',
								async *values() {
									yield {
										kind: 'file',
										name: 'audio.wav',
										async getFile() {
											return file3;
										}
									};
								}
							};
						}
					};
				}
			} as unknown as FileSystemDirectoryHandle;

			const files = await crawlDirectory(mockDirHandle);
			expect(files).toHaveLength(3);
			expect(files.map((f) => f.name)).toEqual(['clip1.mp4', 'clip2.mov', 'audio.wav']);
		});

		it('handles empty directory handles gracefully', async () => {
			const emptyMockDir: FileSystemDirectoryHandle = {
				kind: 'directory',
				name: 'empty',
				async *values() {
					// yields nothing
				}
			} as unknown as FileSystemDirectoryHandle;

			const files = await crawlDirectory(emptyMockDir);
			expect(files).toEqual([]);
		});
	});

	describe('crawlDataTransferEntries', () => {
		it('extracts files from dropped files and nested dropped folders', async () => {
			const f1 = new File(['a'], 'clip1.mp4', { type: 'video/mp4' });
			const f2 = new File(['b'], 'clip2.mov', { type: 'video/quicktime' });

			const mockDataTransfer = {
				items: [
					{
						webkitGetAsEntry: () => ({
							isFile: true,
							isDirectory: false,
							file: (cb: (file: File) => void) => cb(f1)
						})
					},
					{
						webkitGetAsEntry: () => ({
							isFile: false,
							isDirectory: true,
							createReader: () => {
								let readOnce = false;
								return {
									readEntries: (cb: (entries: unknown[]) => void) => {
										if (!readOnce) {
											readOnce = true;
											cb([
												{
													isFile: true,
													isDirectory: false,
													file: (innerCb: (file: File) => void) => innerCb(f2)
												}
											]);
										} else {
											cb([]);
										}
									}
								};
							}
						})
					}
				],
				files: [f1]
			} as unknown as DataTransfer;

			const files = await crawlDataTransferEntries(mockDataTransfer);
			expect(files).toHaveLength(2);
			expect(files.map((f) => f.name)).toEqual(['clip1.mp4', 'clip2.mov']);
		});

		it('falls back to dataTransfer.files when webkitGetAsEntry is not available', async () => {
			const f1 = new File(['a'], 'clip1.mp4', { type: 'video/mp4' });
			const mockDataTransfer = {
				items: [
					{
						// No webkitGetAsEntry
					}
				],
				files: [f1]
			} as unknown as DataTransfer;

			const files = await crawlDataTransferEntries(mockDataTransfer);
			expect(files).toHaveLength(1);
			expect(files[0].name).toBe('clip1.mp4');
		});
	});
});
