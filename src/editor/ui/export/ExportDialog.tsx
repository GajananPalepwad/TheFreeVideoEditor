import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
	timelineDuration,
	ticksToSeconds,
	ROOT_SEQUENCE_ID,
	viewProject,
	flattenForInterchange,
	type SequenceId
} from '../../core';
import type { Project } from '../../core';
import { serializeSrt } from '../../core/captions/srt';
import { serializeVtt } from '../../core/captions/vtt';
import type { ExportProgress } from '../../services/export/exporter';
import { getExportCapabilities, type EncoderSupport } from '../../services/export/capabilities';
import { registerProjectExport } from '../../services/export/session';
import {
	settingsForPreset,
	sanitizeFilename,
	DESTINATION_PRESETS,
	type DestinationPresetId
} from '../../services/export/presets';
import type { ExportQuality, ResolutionPreset } from '../../services/export/presets';
import type { ExportSettings } from '../../services/export/plan';
import type { InterchangeFormat, PackageProgress } from '../../services/interop/export';
import { projectToInterchange } from '../../core/interchange/ir';
import {
	createStreamingSaveTarget,
	supportsStreamingSave,
	saveFile
} from '../../services/storage/fileAccess';
import type { SaveFileType } from '../../services/storage/fileAccess';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { VIDEO_CODEC_REGISTRY } from '../../core/codecs/registry';
import { isCodecSupportedSync, probeCodecCapabilities } from '../../services/codecs/probe';
import CodecSupportDialog from '../dialogs/CodecSupportDialog';
import CodecPackDialog from '../dialogs/CodecPackDialog';
import {
	trackExportStart,
	trackExportComplete,
	trackExportFailed
} from '../../../services/activityTracking';
import './export-dialog.css';

type ExportTab = 'video' | 'project';
type ExportMode = 'webcodecs' | 'compatibility';
interface ExportRuntime {
	exportTimeline: typeof import('../../services/export/exporter').exportTimeline;
	ExportError: typeof import('../../services/export/exporter').ExportError;
	recordExportPath: typeof import('../../services/export/exporter').recordExportPath;
	exportWithMediaRecorder: typeof import('../../services/export/fallbackRecorder').exportWithMediaRecorder;
	exportInterchangeFile: typeof import('../../services/interop/export').exportInterchangeFile;
	streamInterchangePackage: typeof import('../../services/interop/export').streamInterchangePackage;
}

const INTERCHANGE_FORMATS: Array<{ value: InterchangeFormat; label: string }> = [
	{ value: 'xmeml', label: 'Premiere Pro XML (xmeml)' },
	{ value: 'edl', label: 'CMX3600 EDL' },
	{ value: 'fcpxml', label: 'Final Cut Pro XML' },
	{ value: 'otio', label: 'OpenTimelineIO' }
];
const INTERCHANGE_TYPES: Record<InterchangeFormat, SaveFileType[]> = {
	xmeml: [{ description: 'Premiere Pro XML', accept: { 'application/xml': ['.xml'] } }],
	edl: [{ description: 'CMX3600 EDL package', accept: { 'application/zip': ['.zip'] } }],
	fcpxml: [{ description: 'Final Cut Pro XML', accept: { 'application/xml': ['.fcpxml'] } }],
	otio: [{ description: 'OpenTimelineIO', accept: { 'application/json': ['.otio'] } }]
};
const LARGE_IN_MEMORY_EXPORT_BYTES = 512 * 1024 * 1024;

function formatBytes(bytes: number): string {
	if (!bytes || bytes <= 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	const idx = Math.max(0, Math.min(i, sizes.length - 1));
	const val = bytes / Math.pow(k, idx);
	return `${val < 10 && idx > 0 ? val.toFixed(1) : Math.round(val)} ${sizes[idx]}`;
}

function makeVideoSettings(
	project: Project,
	options: {
		format: ExportSettings['format'];
		preset: ResolutionPreset;
		quality: ExportQuality;
		audio: boolean;
		filename: string;
		codecId?: string;
		audioCodecId?: string;
		colorSpaceTag?: string;
		bitDepth?: number;
		alpha?: boolean;
		customBitrateBps?: number;
		normalizeAudio?: boolean;
		loudnessTargetLufs?: number;
	}
): ExportSettings {
	return settingsForPreset(project, options);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : 'The export could not be completed.';
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}

function getProjectExportFilename(
	project: Project,
	format: InterchangeFormat,
	packageFile: boolean
): string {
	if (packageFile || format === 'edl') {
		return sanitizeFilename(project.name, 'zip');
	}
	const extension = format === 'xmeml' ? 'xml' : format;
	return sanitizeFilename(project.name, extension);
}

function interchangeFileTypes(format: InterchangeFormat, packageFile: boolean): SaveFileType[] {
	return packageFile
		? [{ description: 'Project interchange package', accept: { 'application/zip': ['.zip'] } }]
		: INTERCHANGE_TYPES[format];
}

export default function ExportDialog() {
	const open = useEditorStore((state) => state.isExportDialogOpen);
	const project = useEditorStore((state) => state.project);
	const editorStore = useEditorStoreApi();
	const close = useEditorStore((state) => state.closeExportDialog);
	const setExporting = useEditorStore((state) => state.setExporting);
	const repairAudioMetadata = useEditorStore((state) => state.repairAudioMetadata);
	const isClosePromptOpen = useEditorStore((state) => state.isExportClosePromptOpen);
	const dismissClosePrompt = useEditorStore((state) => state.dismissExportClosePrompt);
	const confirmCancelAndContinue = useEditorStore((state) => state.confirmCancelExportAndContinue);
	const [tab, setTab] = useState<ExportTab>('video');
	const [selectedSequenceId, setSelectedSequenceId] = useState<SequenceId>(ROOT_SEQUENCE_ID);
	const [destinationPreset, setDestinationPreset] = useState<DestinationPresetId>('custom');
	const [videoFormat, setVideoFormat] = useState<ExportSettings['format']>('mp4');
	const [selectedCodecId, setSelectedCodecId] = useState<string>('h264-mp4');
	const [selectedAudioCodec, setSelectedAudioCodec] = useState<string>('aac');
	const [selectedColorSpace, setSelectedColorSpace] = useState<string>('rec709');
	const [exportAlpha, setExportAlpha] = useState(false);
	const [customBitrateMbps, setCustomBitrateMbps] = useState(16);
	const [isCodecSupportOpen, setIsCodecSupportOpen] = useState(false);
	const [isCodecPackOpen, setIsCodecPackOpen] = useState(false);
	const [preset, setPreset] = useState<ResolutionPreset>('project');
	const [quality, setQuality] = useState<ExportQuality>('high');
	const [includeAudio, setIncludeAudio] = useState(true);
	const [normalizeAudio, setNormalizeAudio] = useState(false);
	const [filename, setFilename] = useState('');
	const [mode, setMode] = useState<ExportMode>('webcodecs');
	const [interchangeFormat, setInterchangeFormat] = useState<InterchangeFormat>('xmeml');
	const [includeMedia, setIncludeMedia] = useState(true);
	const [exportSidecar, setExportSidecar] = useState(false);
	const [sidecarFormat, setSidecarFormat] = useState<'srt' | 'vtt'>('srt');
	const [offlineConfirmed, setOfflineConfirmed] = useState(false);
	const [capabilities, setCapabilities] = useState<EncoderSupport | null>(null);
	const [runtime, setRuntime] = useState<ExportRuntime | null>(null);
	const [progress, setProgress] = useState<ExportProgress | null>(null);
	const [packageProgress, setPackageProgress] = useState<PackageProgress | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const [cancelConfirmation, setCancelConfirmation] = useState(false);
	const [errorMessage, setErrorMessage] = useState('');
	const [notice, setNotice] = useState('');
	const dialogRef = useRef<HTMLDialogElement>(null);
	const closePromptRef = useRef<HTMLDialogElement>(null);
	const cancelDialogRef = useRef<HTMLDialogElement>(null);
	const errorRef = useRef<HTMLParagraphElement>(null);
	const cancelConfirmRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<AbortController | null>(null);

	const exportProject = useMemo(() => {
		if (!project) return null;
		return viewProject(project, selectedSequenceId);
	}, [project, selectedSequenceId]);

	const offlineAssets = useMemo(
		() =>
			exportProject ? Object.values(exportProject.assets).filter((asset) => asset.offline) : [],
		[exportProject]
	);
	const undecodableAudioAssets = useMemo(() => {
		if (!exportProject) return [];
		const scheduledAssets = new Set(
			exportProject.tracks
				.filter((track) => track.kind === 'audio' && !track.muted)
				.flatMap((track) => track.clips.flatMap((clip) => (clip.assetId ? [clip.assetId] : [])))
		);
		return Object.values(exportProject.assets).filter(
			(asset) => asset.hasAudio && asset.audioDecodable === false && scheduledAssets.has(asset.id)
		);
	}, [exportProject]);
	const captionTracks = useMemo(
		() => (exportProject ? exportProject.tracks.filter((t) => t.kind === 'caption') : []),
		[exportProject]
	);
	const settings = useMemo(
		() =>
			exportProject
				? makeVideoSettings(exportProject, {
						format: videoFormat,
						preset,
						quality,
						audio: includeAudio,
						filename: filename || exportProject.name,
						codecId: selectedCodecId,
						audioCodecId: selectedAudioCodec,
						colorSpaceTag: selectedColorSpace,
						bitDepth: VIDEO_CODEC_REGISTRY.find((c) => c.id === selectedCodecId)?.bitDepth ?? 8,
						alpha: exportAlpha,
						customBitrateBps: customBitrateMbps * 1_000_000,
						normalizeAudio: includeAudio && normalizeAudio,
						loudnessTargetLufs: normalizeAudio ? -14.0 : undefined
					})
				: null,
		[
			filename,
			includeAudio,
			preset,
			exportProject,
			quality,
			videoFormat,
			selectedCodecId,
			selectedAudioCodec,
			selectedColorSpace,
			exportAlpha,
			customBitrateMbps,
			normalizeAudio
		]
	);
	const capabilityProjectId = exportProject?.id;
	const capabilityFormat = settings?.format;
	const capabilityWidth = settings?.width;
	const capabilityHeight = settings?.height;
	const capabilityFps = settings?.fps;
	const capabilityAudio = settings?.audio;
	const capabilityCodecId = settings?.codecId;
	const capabilityAudioCodecId = settings?.audioCodecId;
	const durationSeconds = exportProject ? ticksToSeconds(timelineDuration(exportProject)) : 0;
	const estimatedSize = useMemo(() => {
		if (!settings || durationSeconds <= 0) return 0;
		if (videoFormat === 'wav') {
			const sampleRate = exportProject?.settings.sampleRate || 48000;
			const channels = 2;
			const bytesPerSample =
				selectedAudioCodec === 'pcm24' ? 3 : selectedAudioCodec === 'pcm32f' ? 4 : 2;
			return Math.ceil(durationSeconds * sampleRate * channels * bytesPerSample);
		}
		const audioBps = settings.audio ? settings.audioBitrate : 0;
		return Math.ceil(((settings.videoBitrate + audioBps) * durationSeconds) / 8);
	}, [
		settings,
		durationSeconds,
		videoFormat,
		exportProject?.settings.sampleRate,
		selectedAudioCodec
	]);
	const warnAboutMemoryFallback =
		!supportsStreamingSave() && estimatedSize >= LARGE_IN_MEMORY_EXPORT_BYTES;

	const timelineMediaWarnings = useMemo(() => {
		if (!exportProject) return [];
		const warnings: string[] = [];
		const scheduledAssetIds = new Set(
			exportProject.tracks.flatMap((t) => t.clips.flatMap((c) => (c.assetId ? [c.assetId] : [])))
		);
		const scheduledAssets = Object.values(exportProject.assets).filter((a) =>
			scheduledAssetIds.has(a.id)
		);

		const hasHdr = scheduledAssets.some((a) => a.isHdr);
		const hasVfr = scheduledAssets.some((a) => a.isVfr);
		const hasInterlaced = scheduledAssets.some((a) => a.isInterlaced);
		const hasUnsupported = scheduledAssets.some((a) => a.videoDecodable === false);

		if (hasHdr && (settings?.bitDepth ?? 8) <= 8) {
			warnings.push(
				'Timeline contains HDR media. WebCodecs will convert to SDR unless 10-bit HDR export is selected (HEVC Main10 / VP9 Profile 2).'
			);
		}
		if (hasVfr) {
			warnings.push(
				'Timeline contains Variable Frame Rate (VFR) media. Frame timings will be resampled to constant project FPS.'
			);
		}
		if (hasInterlaced) {
			warnings.push(
				'Timeline contains interlaced media. Progressive scan is recommended for web exports.'
			);
		}
		if (hasUnsupported) {
			warnings.push('Timeline contains video tracks with unsupported codecs or pixel formats.');
		}
		return warnings;
	}, [exportProject, settings?.bitDepth]);

	const interchangeOmissionWarning = useMemo(() => {
		if (!exportProject) return null;
		let effectsCount = 0;
		let adjustmentsCount = 0;
		let solidsCount = 0;
		let masksCount = 0;
		let transitionsCount = 0;
		let speedChangesCount = 0;
		for (const track of exportProject.tracks) {
			if (track.transitions) {
				transitionsCount += track.transitions.length;
			}
			for (const clip of track.clips) {
				if (clip.effects && clip.effects.length > 0) {
					effectsCount += clip.effects.length;
				}
				if (clip.masks && clip.masks.length > 0) {
					masksCount += clip.masks.length;
				}
				if (clip.source?.type === 'adjustment') {
					adjustmentsCount += 1;
				}
				if (clip.source?.type === 'solid') {
					solidsCount += 1;
				}
				if (clip.speed !== 1 || clip.timeRemap) {
					speedChangesCount += 1;
				}
			}
		}
		if (
			effectsCount === 0 &&
			adjustmentsCount === 0 &&
			solidsCount === 0 &&
			masksCount === 0 &&
			transitionsCount === 0 &&
			speedChangesCount === 0
		)
			return null;
		const parts: string[] = [];
		if (masksCount > 0) {
			parts.push(`${masksCount} mask${masksCount === 1 ? '' : 's'}`);
		}
		if (effectsCount > 0) {
			parts.push(`${effectsCount} effect${effectsCount === 1 ? '' : 's'}`);
		}
		if (transitionsCount > 0) {
			parts.push(`${transitionsCount} transition${transitionsCount === 1 ? '' : 's'}`);
		}
		if (adjustmentsCount > 0) {
			parts.push(`${adjustmentsCount} adjustment layer${adjustmentsCount === 1 ? '' : 's'}`);
		}
		if (solidsCount > 0) {
			parts.push(`${solidsCount} solid color layer${solidsCount === 1 ? '' : 's'}`);
		}
		if (speedChangesCount > 0) {
			parts.push(`${speedChangesCount} speed change${speedChangesCount === 1 ? '' : 's'}`);
		}
		return `${parts.join(', ')} are not included in project files; use Video export to render them.`;
	}, [exportProject]);

	const interchangeTimeline = useMemo(() => {
		if (!exportProject) return null;
		try {
			return projectToInterchange(exportProject, { dropFrame: false });
		} catch {
			return null;
		}
	}, [exportProject]);

	const canExport = Boolean(
		exportProject &&
		settings &&
		runtime &&
		durationSeconds > 0 &&
		(offlineAssets.length === 0 || offlineConfirmed) &&
		(!isRunning || tab !== 'video') &&
		(videoFormat === 'wav'
			? true
			: mode === 'webcodecs'
				? capabilities?.video && (!includeAudio || capabilities.audio)
				: videoFormat === 'webm' && capabilities?.compatibility)
	);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			setNotice('');
			setErrorMessage('');
			setProgress(null);
			setIsRunning(false);
			setCancelConfirmation(false);
		}
		if (!open && dialog.open && !isRunning) dialog.close();
	}, [isRunning, open]);

	useEffect(() => {
		if (open) {
			void probeCodecCapabilities();
		}
	}, [open]);

	useEffect(() => {
		if (!open || runtime) return;
		let active = true;
		void Promise.all([
			import('../../services/export/exporter'),
			import('../../services/export/fallbackRecorder'),
			import('../../services/interop/export')
		])
			.then(([exporter, recorder, interop]) => {
				if (!active) return;
				setRuntime({
					exportTimeline: exporter.exportTimeline,
					ExportError: exporter.ExportError,
					recordExportPath: exporter.recordExportPath,
					exportWithMediaRecorder: recorder.exportWithMediaRecorder,
					exportInterchangeFile: interop.exportInterchangeFile,
					streamInterchangePackage: interop.streamInterchangePackage
				});
			})
			.catch((error: unknown) => {
				if (active) setErrorMessage(`Could not load export tools: ${errorText(error)}`);
			});
		return () => {
			active = false;
		};
	}, [open, runtime]);

	useEffect(() => {
		const dialog = closePromptRef.current;
		if (!dialog) return;
		if (isClosePromptOpen && !dialog.open) dialog.showModal();
		if (!isClosePromptOpen && dialog.open) dialog.close();
	}, [isClosePromptOpen]);

	useEffect(() => {
		if (
			!open ||
			!capabilityProjectId ||
			!capabilityFormat ||
			!capabilityWidth ||
			!capabilityHeight ||
			!capabilityFps ||
			capabilityAudio === undefined
		)
			return;
		let active = true;
		setCapabilities(null);
		void getExportCapabilities({
			format: capabilityFormat,
			width: capabilityWidth,
			height: capabilityHeight,
			fps: capabilityFps,
			audio: capabilityAudio,
			codecId: capabilityCodecId,
			audioCodecId: capabilityAudioCodecId
		})
			.then((result) => {
				if (!active) return;
				setCapabilities(result);
				setMode(result.video ? 'webcodecs' : 'compatibility');
			})
			.catch((error: unknown) => {
				if (active) setErrorMessage(`Could not check browser export support: ${errorText(error)}`);
			});
		return () => {
			active = false;
		};
	}, [
		open,
		capabilityProjectId,
		capabilityAudio,
		capabilityFormat,
		capabilityFps,
		capabilityHeight,
		capabilityWidth,
		capabilityCodecId,
		capabilityAudioCodecId
	]);

	useEffect(() => {
		if (!open || !project) return;
		setFilename(project.name);
		setOfflineConfirmed(offlineAssets.length === 0);
		setProgress(null);
		setPackageProgress(null);
		setErrorMessage('');
		setNotice('');
	}, [offlineAssets.length, open, project]);

	useEffect(() => {
		if (errorMessage) errorRef.current?.focus();
	}, [errorMessage]);

	useEffect(() => {
		const dialog = cancelDialogRef.current;
		if (!dialog) return;
		if (cancelConfirmation && !dialog.open) {
			dialog.showModal();
			cancelConfirmRef.current?.focus();
		}
		if (!cancelConfirmation && dialog.open) dialog.close();
	}, [cancelConfirmation]);

	function handleDestinationPresetChange(destId: DestinationPresetId): void {
		setDestinationPreset(destId);
		setErrorMessage('');
		if (destId === 'custom') return;
		const dest = DESTINATION_PRESETS.find((d) => d.id === destId);
		if (!dest) return;

		setVideoFormat(dest.format);
		setSelectedCodecId('h264-mp4');
		setSelectedAudioCodec('aac');
		setPreset(dest.resolutionPreset);
		setQuality('custom');
		setCustomBitrateMbps(dest.bitrateMbps);
		setIncludeAudio(true);
		setNormalizeAudio(true);
		setExportAlpha(false);
	}

	function updateFormat(format: ExportSettings['format']): void {
		setDestinationPreset('custom');
		setVideoFormat(format);
		setErrorMessage('');
		if (format === 'mp4') {
			setSelectedCodecId('h264-mp4');
			setSelectedAudioCodec('aac');
			setExportAlpha(false);
		} else if (format === 'mov') {
			setSelectedCodecId('h264-mov');
			setSelectedAudioCodec('aac');
		} else if (format === 'webm') {
			setSelectedCodecId('vp9-webm');
			setSelectedAudioCodec('opus');
		} else if (format === 'wav') {
			setSelectedCodecId('wav-pcm16');
			setSelectedAudioCodec('pcm16');
			setExportAlpha(false);
		}
	}

	function updateCodec(codecId: string): void {
		setDestinationPreset('custom');
		setSelectedCodecId(codecId);
		const desc = VIDEO_CODEC_REGISTRY.find((c) => c.id === codecId);
		if (desc?.bitDepth === 10) {
			setSelectedColorSpace('rec2020');
		}
	}

	async function runVideoExport(): Promise<void> {
		if (!project || !settings || !runtime || isRunning) return;
		const exportRuntime = runtime;
		const controller = new AbortController();
		cancelRef.current = controller;
		let unregister: (() => void) | null = null;
		let fallbackNotice = '';
		const exportWarnings: string[] = [];
		setIsRunning(true);
		setExporting(true);
		setErrorMessage('');
		setNotice('');
		setProgress(null);
		trackExportStart({
			format: videoFormat,
			resolution: `${settings.width}x${settings.height}`,
			fps: settings.fps,
			mode
		});
		try {
			const audioRepair = await repairAudioMetadata();
			if (audioRepair.warnings.length > 0) {
				exportWarnings.push(...audioRepair.warnings);
				setNotice(audioRepair.warnings.join(' '));
			}
			const currentProject = audioRepair.project ?? editorStore.getState().project;
			if (!currentProject) throw new Error('The project closed before export could start.');
			const currentView = viewProject(currentProject, selectedSequenceId);
			const snapshot = structuredClone(currentView);
			unregister = registerProjectExport(snapshot.id, controller);
			if (mode === 'compatibility') {
				exportRuntime.recordExportPath('compatibility');
				const types: SaveFileType[] = [
					{ description: 'WebM video', accept: { 'video/webm': ['.webm'] } }
				];
				const saveTarget = await createStreamingSaveTarget(
					settings.filename.replace(/\.[^.]+$/, '.webm'),
					types
				);
				if (controller.signal.aborted) throw new DOMException('Export cancelled.', 'AbortError');
				const result = await exportRuntime.exportWithMediaRecorder(snapshot, settings, {
					signal: controller.signal,
					onProgress: setProgress,
					onWarning: (warning) => exportWarnings.push(warning)
				});
				if (saveTarget) {
					try {
						await saveTarget.write(new Uint8Array(await result.blob.arrayBuffer()));
						await saveTarget.close();
					} catch (error) {
						await saveTarget.abort(error);
						throw error;
					}
				} else {
					await saveFile(result.blob, result.filename, types);
				}

				if (exportSidecar && captionTracks.length > 0) {
					const activeCapTrack = captionTracks[0];
					if (activeCapTrack && activeCapTrack.captions && activeCapTrack.captions.length > 0) {
						const subContent =
							sidecarFormat === 'vtt'
								? serializeVtt(activeCapTrack.captions)
								: serializeSrt(activeCapTrack.captions);
						const subBlob = new Blob([subContent], {
							type: sidecarFormat === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8'
						});
						const subFilename = settings.filename.replace(/\.[^.]+$/, `.${sidecarFormat}`);
						await saveFile(subBlob, subFilename, [
							{
								description:
									sidecarFormat === 'vtt' ? 'WebVTT Subtitles (*.vtt)' : 'SubRip Subtitles (*.srt)',
								accept: {
									[sidecarFormat === 'vtt' ? 'text/vtt' : 'text/plain']: [`.${sidecarFormat}`]
								}
							}
						]);
					}
				}
				if (dialogRef.current?.open) {
					dialogRef.current.close();
				}
				const durationSec = durationSeconds > 0 ? durationSeconds : undefined;
				trackExportComplete({
					format: 'webm',
					resolution: `${settings.width}x${settings.height}`,
					duration_sec: durationSec ? Math.round(durationSec) : undefined
				});
				editorStore.getState().openExportCompleteDialog({
					filename: settings.filename.replace(/\.[^.]+$/, '.webm'),
					format: 'WEBM',
					width: settings.width,
					height: settings.height,
					fps: settings.fps,
					durationSec,
					fileSizeBytes: result.blob.size,
					blob: result.blob,
					warnings: exportWarnings.length > 0 ? exportWarnings : undefined,
					notice: 'Compatibility export uses real-time browser recording.'
				});
				setNotice(
					[
						'Compatibility export uses real-time browser recording. Some frames may be dropped on slower devices.',
						...exportWarnings
					].join(' ')
				);
				return;
			}

			const descriptor = VIDEO_CODEC_REGISTRY.find((c) => c.id === selectedCodecId);
			const result = await exportRuntime.exportTimeline(snapshot, settings, {
				signal: controller.signal,
				onProgress: setProgress,
				onWarning: (warning) => exportWarnings.push(warning),
				onFallback: (reason) => {
					fallbackNotice = reason;
					setNotice(reason);
				},
				...(descriptor?.videoCodecString
					? { videoCodec: descriptor.videoCodecString }
					: capabilities?.codec
						? { videoCodec: capabilities.codec }
						: {}),
				...(includeAudio && capabilities?.audioCodec ? { audioCodec: capabilities.audioCodec } : {})
			});
			if (result.blob) {
				const mimeType =
					videoFormat === 'mp4'
						? 'video/mp4'
						: videoFormat === 'mov'
							? 'video/quicktime'
							: videoFormat === 'wav'
								? 'audio/wav'
								: 'video/webm';
				const description =
					videoFormat === 'mp4'
						? 'MP4 video'
						: videoFormat === 'mov'
							? 'QuickTime MOV'
							: videoFormat === 'wav'
								? 'WAV audio'
								: 'WebM video';
				const types: SaveFileType[] = [
					{
						description,
						accept: {
							[mimeType]: [`.${videoFormat}`]
						}
					}
				];
				await saveFile(result.blob, settings.filename, types);
			}

			if (exportSidecar && captionTracks.length > 0) {
				const activeCapTrack = captionTracks[0];
				if (activeCapTrack && activeCapTrack.captions && activeCapTrack.captions.length > 0) {
					const subContent =
						sidecarFormat === 'vtt'
							? serializeVtt(activeCapTrack.captions)
							: serializeSrt(activeCapTrack.captions);
					const subBlob = new Blob([subContent], {
						type: sidecarFormat === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8'
					});
					const subFilename = settings.filename.replace(/\.[^.]+$/, `.${sidecarFormat}`);
					await saveFile(subBlob, subFilename, [
						{
							description:
								sidecarFormat === 'vtt' ? 'WebVTT Subtitles (*.vtt)' : 'SubRip Subtitles (*.srt)',
							accept: {
								[sidecarFormat === 'vtt' ? 'text/vtt' : 'text/plain']: [`.${sidecarFormat}`]
							}
						}
					]);
				}
			}
			const completionNotice =
				result.path === 'main-webcodecs'
					? `${videoFormat.toUpperCase()} export complete. ${fallbackNotice || 'The yielding main-thread encoder was used; the editor may respond more slowly.'}`
					: `${videoFormat.toUpperCase()} video export complete.`;
			setNotice([completionNotice, ...exportWarnings].join(' '));

			if (dialogRef.current?.open) {
				dialogRef.current.close();
			}
			const durationSec = durationSeconds > 0 ? durationSeconds : undefined;
			trackExportComplete({
				format: videoFormat,
				resolution: `${settings.width}x${settings.height}`,
				duration_sec: durationSec ? Math.round(durationSec) : undefined
			});
			const fileSizeBytes = result.blob ? result.blob.size : result.bytes;
			editorStore.getState().openExportCompleteDialog({
				filename: settings.filename,
				format: videoFormat.toUpperCase(),
				width: settings.width,
				height: settings.height,
				fps: settings.fps,
				durationSec,
				fileSizeBytes,
				blob: result.blob ?? undefined,
				warnings: exportWarnings.length > 0 ? exportWarnings : undefined,
				notice: fallbackNotice || undefined
			});
		} catch (error) {
			if (
				isAbortError(error) ||
				(error instanceof exportRuntime.ExportError && error.code === 'CANCELLED')
			) {
				setNotice('Export cancelled. No output file was saved.');
			} else {
				setErrorMessage(errorText(error));
				trackExportFailed(error, { format: videoFormat });
			}
		} finally {
			unregister?.();
			cancelRef.current = null;
			setExporting(false);
			setIsRunning(false);
			setCancelConfirmation(false);
			setProgress(null);
		}
	}

	async function runInterchangeExport(): Promise<void> {
		if (!project || !runtime || isRunning) return;
		const exportRuntime = runtime;
		const currentView = viewProject(project, selectedSequenceId);
		const flattened = flattenForInterchange(currentView);
		const snapshot = structuredClone(flattened.project);
		const controller = new AbortController();
		cancelRef.current = controller;
		let unregister: (() => void) | null = null;
		const packageFile = includeMedia || interchangeFormat === 'edl';
		const suggestedName = getProjectExportFilename(snapshot, interchangeFormat, packageFile);
		setIsRunning(true);
		setExporting(true);
		setErrorMessage('');
		setNotice('');
		setPackageProgress(null);
		trackExportStart({
			format: interchangeFormat,
			is_package: packageFile
		});
		let finalBlob: Blob | undefined;
		try {
			unregister = registerProjectExport(snapshot.id, controller);
			if (packageFile) {
				const target = await createStreamingSaveTarget(
					suggestedName,
					interchangeFileTypes(interchangeFormat, packageFile)
				);
				if (target) {
					try {
						await exportRuntime.streamInterchangePackage(
							snapshot,
							interchangeFormat,
							(chunk) => target.write(chunk),
							{
								includeMedia,
								signal: controller.signal,
								onProgress: setPackageProgress
							}
						);
						await target.close();
					} catch (error) {
						await target.abort(error);
						throw error;
					}
				} else {
					const chunks: Uint8Array[] = [];
					await exportRuntime.streamInterchangePackage(
						snapshot,
						interchangeFormat,
						async (chunk) => {
							chunks.push(chunk.slice());
						},
						{
							includeMedia,
							signal: controller.signal,
							onProgress: setPackageProgress
						}
					);
					const blob = new Blob(
						chunks.map((chunk) => Uint8Array.from(chunk).buffer),
						{
							type: 'application/zip'
						}
					);
					finalBlob = blob;
					await saveFile(blob, suggestedName, interchangeFileTypes(interchangeFormat, packageFile));
				}
			} else {
				const contents = exportRuntime.exportInterchangeFile(snapshot, interchangeFormat);
				const mimeType = interchangeFormat === 'otio' ? 'application/json' : 'application/xml';
				finalBlob = new Blob([contents], { type: `${mimeType};charset=utf-8` });
				await saveFile(finalBlob, suggestedName, interchangeFileTypes(interchangeFormat, false));
			}
			const interchangeLabel =
				INTERCHANGE_FORMATS.find((item) => item.value === interchangeFormat)?.label ?? 'Project';
			setNotice(`${interchangeLabel} export complete.`);
			if (dialogRef.current?.open) {
				dialogRef.current.close();
			}
			trackExportComplete({
				format: interchangeFormat
			});
			editorStore.getState().openExportCompleteDialog({
				filename: suggestedName,
				format: interchangeFormat.toUpperCase(),
				fileSizeBytes: finalBlob ? finalBlob.size : undefined,
				blob: finalBlob
			});
		} catch (error) {
			if (isAbortError(error)) setNotice('Export cancelled. No output file was saved.');
			else {
				setErrorMessage(errorText(error));
				trackExportFailed(error, { format: interchangeFormat });
			}
		} finally {
			unregister?.();
			cancelRef.current = null;
			setExporting(false);
			setIsRunning(false);
			setCancelConfirmation(false);
			setPackageProgress(null);
		}
	}

	function requestCancel(): void {
		if (isRunning) setCancelConfirmation(true);
		else close();
	}

	const progressValue =
		tab === 'video'
			? progress
				? { value: progress.percent, label: `${progress.percent}%` }
				: null
			: packageProgress
				? {
						value: packageProgress.totalFiles
							? Math.round((packageProgress.filesDone / packageProgress.totalFiles) * 100)
							: 0,
						label: `${packageProgress.filesDone} of ${packageProgress.totalFiles} files`
					}
				: null;

	return (
		<>
			<dialog
				ref={dialogRef}
				className="editor-dialog export-dialog"
				aria-labelledby="export-dialog-title"
				onCancel={(event) => {
					event.preventDefault();
					requestCancel();
				}}
				onClick={(event: MouseEvent<HTMLDialogElement>) => {
					if (event.target === event.currentTarget && !isRunning) close();
				}}
			>
				<div className="dialog-content">
					<div className="dialog-heading">
						<div>
							<p className="dialog-eyebrow">DELIVER</p>
							<h2 id="export-dialog-title">Export</h2>
						</div>
						<button
							className="icon-button dialog-close"
							type="button"
							aria-label={isRunning ? 'Request export cancellation' : 'Close export dialog'}
							onClick={requestCancel}
						>
							×
						</button>
					</div>
					<div className="export-tabs" role="tablist" aria-label="Export type">
						<button
							type="button"
							role="tab"
							aria-selected={tab === 'video'}
							tabIndex={tab === 'video' ? 0 : -1}
							aria-controls="video-export-panel"
							onKeyDown={(event) => {
								if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
								event.preventDefault();
								const nextTab = event.key === 'ArrowRight' ? 'project' : 'video';
								setTab(nextTab);
								event.currentTarget.parentElement
									?.querySelector<HTMLButtonElement>(`[data-export-tab="${nextTab}"]`)
									?.focus();
							}}
							data-export-tab="video"
							onClick={() => setTab('video')}
						>
							Video
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={tab === 'project'}
							tabIndex={tab === 'project' ? 0 : -1}
							aria-controls="project-export-panel"
							onKeyDown={(event) => {
								if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
								event.preventDefault();
								const nextTab = event.key === 'ArrowRight' ? 'video' : 'project';
								setTab(nextTab);
								event.currentTarget.parentElement
									?.querySelector<HTMLButtonElement>(`[data-export-tab="${nextTab}"]`)
									?.focus();
							}}
							data-export-tab="project"
							onClick={() => setTab('project')}
						>
							Project file
						</button>
					</div>
					{!runtime && !errorMessage && (
						<p className="export-capability" role="status" aria-live="polite">
							Loading export tools…
						</p>
					)}
					{tab === 'video' ? (
						<div id="video-export-panel" role="tabpanel" className="export-form">
							{project && project.sequences && Object.keys(project.sequences).length > 0 && (
								<label className="dialog-field">
									<span>Sequence</span>
									<select
										value={selectedSequenceId}
										disabled={isRunning}
										onChange={(event) =>
											setSelectedSequenceId(event.currentTarget.value as SequenceId)
										}
									>
										<option value={ROOT_SEQUENCE_ID}>Main Timeline (Root)</option>
										{Object.values(project.sequences).map((seq) => (
											<option key={seq.id} value={seq.id}>
												{seq.name}
											</option>
										))}
									</select>
								</label>
							)}
							<label className="dialog-field">
								<span>Destination Preset</span>
								<select
									value={destinationPreset}
									disabled={isRunning}
									onChange={(event) =>
										handleDestinationPresetChange(event.currentTarget.value as DestinationPresetId)
									}
									data-testid="export-destination-preset-select"
								>
									<option value="custom">Custom / Project Settings</option>
									{DESTINATION_PRESETS.map((dest) => (
										<option key={dest.id} value={dest.id}>
											{dest.label} ({dest.description})
										</option>
									))}
								</select>
							</label>

							<label className="dialog-field">
								<span>Format</span>
								<select
									value={videoFormat}
									disabled={isRunning}
									onChange={(event) =>
										updateFormat(event.currentTarget.value as ExportSettings['format'])
									}
								>
									<option value="mp4">MP4 (H.264 / HEVC / AV1)</option>
									<option value="mov">QuickTime MOV (H.264 / HEVC / ProRes / PCM)</option>
									<option value="webm">WebM (VP9 / AV1 / Opus)</option>
									<option value="wav">WAV Audio (Uncompressed PCM)</option>
								</select>
							</label>

							{videoFormat !== 'wav' && (
								<label className="dialog-field">
									<span>Video Codec</span>
									<select
										value={selectedCodecId}
										disabled={isRunning}
										onChange={(event) => updateCodec(event.currentTarget.value)}
									>
										{VIDEO_CODEC_REGISTRY.filter((c) => c.container === videoFormat).map((c) => {
											const supported = isCodecSupportedSync(c.id);
											return (
												<option key={c.id} value={c.id} disabled={c.tier === 2}>
													{c.label}{' '}
													{c.tier === 2
														? '· Pack Required (Deferred)'
														: supported === false
															? '· Unsupported'
															: '· Hardware/WebCodecs'}
												</option>
											);
										})}
									</select>
								</label>
							)}

							{videoFormat !== 'wav' && (
								<label className="dialog-field">
									<span>Resolution</span>
									<select
										value={preset}
										disabled={isRunning}
										onChange={(event) => {
											setDestinationPreset('custom');
											setPreset(event.currentTarget.value as ResolutionPreset);
										}}
									>
										<option value="project">
											Project · {project?.settings.width} × {project?.settings.height}
										</option>
										<optgroup label="Standard Landscape (16:9)">
											<option value="4k">4K Ultra HD (3840 × 2160)</option>
											<option value="1440p">1440p Quad HD (2560 × 1440)</option>
											<option value="1080p">1080p Full HD (1920 × 1080)</option>
											<option value="720p">720p HD (1280 × 720)</option>
											<option value="480p">480p SD (854 × 480)</option>
										</optgroup>
										<optgroup label="Social & Aspect Ratios">
											<option value="9:16">
												9:16 Vertical · TikTok/Reels/Shorts (1080 × 1920)
											</option>
											<option value="1:1">1:1 Square · Instagram Post (1080 × 1080)</option>
											<option value="4:5">4:5 Social Portrait · Instagram (1080 × 1350)</option>
											<option value="21:9">21:9 Ultrawide Cinema (2560 × 1080)</option>
										</optgroup>
									</select>
								</label>
							)}

							{videoFormat !== 'wav' && (
								<label className="dialog-field">
									<span>Quality</span>
									<select
										value={quality}
										disabled={isRunning}
										onChange={(event) => {
											setDestinationPreset('custom');
											setQuality(event.currentTarget.value as ExportQuality);
										}}
									>
										<option value="high">High (Recommended)</option>
										<option value="medium">Standard</option>
										<option value="low">Smaller file</option>
										<option value="pro">Pro Bitrate</option>
										<option value="custom">Custom Bitrate…</option>
									</select>
								</label>
							)}

							{videoFormat !== 'wav' && quality === 'custom' && (
								<label className="dialog-field">
									<span>Bitrate (Mbps)</span>
									<input
										type="number"
										min="1"
										max="100"
										step="1"
										value={customBitrateMbps}
										disabled={isRunning}
										onChange={(event) => {
											setDestinationPreset('custom');
											setCustomBitrateMbps(Math.max(1, Number(event.currentTarget.value)));
										}}
									/>
								</label>
							)}

							{videoFormat !== 'wav' && (
								<label className="dialog-field">
									<span>Color Space Tag</span>
									<select
										value={selectedColorSpace}
										disabled={isRunning}
										onChange={(event) => setSelectedColorSpace(event.currentTarget.value)}
									>
										<option value="rec709">Rec. 709 · Standard Dynamic Range (SDR)</option>
										<option value="rec2020">Rec. 2020 · Wide Gamut / 10-bit HDR</option>
										<option value="srgb">sRGB · Computer & Web Graphics</option>
										<option value="display-p3">Display P3 · Apple Wide Color</option>
									</select>
								</label>
							)}

							{(videoFormat === 'webm' || videoFormat === 'mov') && (
								<label className="export-checkbox">
									<input
										type="checkbox"
										checked={exportAlpha}
										disabled={isRunning}
										onChange={(event) => setExportAlpha(event.currentTarget.checked)}
									/>
									<span>Export with alpha transparency (transparent canvas)</span>
								</label>
							)}

							{videoFormat !== 'wav' && (
								<label className="export-checkbox">
									<input
										type="checkbox"
										checked={includeAudio}
										disabled={isRunning}
										onChange={(event) => setIncludeAudio(event.currentTarget.checked)}
									/>
									<span>Include audio</span>
								</label>
							)}

							{(includeAudio || videoFormat === 'wav') && (
								<label className="export-checkbox">
									<input
										type="checkbox"
										checked={normalizeAudio}
										disabled={isRunning}
										onChange={(event) => {
											setDestinationPreset('custom');
											setNormalizeAudio(event.currentTarget.checked);
										}}
										data-testid="export-normalize-audio-checkbox"
									/>
									<span>Normalize audio to -14 LUFS (YouTube, TikTok, Instagram standard)</span>
								</label>
							)}

							{(includeAudio || videoFormat === 'wav') &&
								(videoFormat === 'mov' || videoFormat === 'wav') && (
									<label className="dialog-field">
										<span>
											{videoFormat === 'wav' ? 'Audio Bit Depth / Quality' : 'Audio Codec'}
										</span>
										<select
											value={selectedAudioCodec}
											disabled={isRunning}
											onChange={(event) => setSelectedAudioCodec(event.currentTarget.value)}
										>
											{videoFormat === 'mov' && (
												<option value="aac">AAC-LC · Compressed (192 kbps)</option>
											)}
											<option value="pcm16">PCM 16-bit · Linear Uncompressed</option>
											<option value="pcm24">PCM 24-bit · High-Resolution Master</option>
											<option value="pcm32f">PCM 32-bit Float · 32-bit Floating Point</option>
										</select>
									</label>
								)}

							<label className="dialog-field">
								<span>File name</span>
								<input
									name="export-filename"
									value={filename}
									disabled={isRunning}
									maxLength={120}
									autoComplete="off"
									onChange={(event) => setFilename(event.currentTarget.value)}
								/>
							</label>
							{capabilities &&
								mode === 'webcodecs' &&
								includeAudio &&
								!capabilities.audio &&
								videoFormat !== 'wav' && (
									<p className="export-warning" role="status">
										Audio encoding is unavailable for this format here. Turn off “Include audio” or
										choose another format.
									</p>
								)}
							{includeAudio &&
								undecodableAudioAssets.map((asset) => (
									<p className="export-warning" role="status" key={asset.id}>
										Audio from “{asset.name}” will be skipped because this browser cannot decode its
										codec.
									</p>
								))}
							{captionTracks.length > 0 && videoFormat !== 'wav' && (
								<div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
									<label className="export-checkbox">
										<input
											type="checkbox"
											checked={exportSidecar}
											disabled={isRunning}
											onChange={(event) => setExportSidecar(event.currentTarget.checked)}
										/>
										<span>Export sidecar subtitle file</span>
									</label>
									{exportSidecar && (
										<label className="dialog-field" style={{ marginLeft: '24px' }}>
											<span>Subtitle format</span>
											<select
												value={sidecarFormat}
												disabled={isRunning}
												onChange={(e) => setSidecarFormat(e.currentTarget.value as 'srt' | 'vtt')}
											>
												<option value="srt">SubRip (.srt)</option>
												<option value="vtt">WebVTT (.vtt)</option>
											</select>
										</label>
									)}
								</div>
							)}
							<div className="export-capability" role="status" aria-live="polite">
								{videoFormat === 'wav' ? (
									'Uncompressed PCM audio muxing via container engine.'
								) : capabilities === null ? (
									'Checking browser export support…'
								) : capabilities.video ? (
									<>
										WebCodecs available
										{includeAudio && !capabilities.audio ? ' · audio encoding unavailable' : ''}
										{capabilities.codec ? ` · ${capabilities.codec}` : ''}
									</>
								) : (
									<>
										{capabilities.reason || 'WebCodecs is unavailable.'}
										{capabilities.compatibility
											? ' Use compatibility mode for real-time WebM recording.'
											: ' This browser cannot export video.'}
									</>
								)}
							</div>
							{capabilities && videoFormat !== 'wav' && (
								<label className="dialog-field">
									<span>Export method</span>
									<select
										value={mode}
										disabled={isRunning}
										onChange={(event) => setMode(event.currentTarget.value as ExportMode)}
									>
										<option value="webcodecs" disabled={!capabilities.video}>
											WebCodecs · frame-accurate
										</option>
										<option
											value="compatibility"
											disabled={!capabilities.compatibility || videoFormat !== 'webm'}
										>
											Compatibility · real-time WebM
										</option>
									</select>
								</label>
							)}
							<p className="export-estimate">
								{durationSeconds > 0
									? `${Math.floor(durationSeconds / 60)}:${String(Math.floor(durationSeconds % 60)).padStart(2, '0')} · approximately ${formatBytes(estimatedSize)}`
									: 'Add clips to the timeline before exporting.'}
							</p>
							<div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '2px' }}>
								<button
									type="button"
									className="media-action-link"
									onClick={() => setIsCodecSupportOpen(true)}
								>
									Hardware & Codec Support Diagnostics…
								</button>
								<button
									type="button"
									className="media-action-link"
									onClick={() => setIsCodecPackOpen(true)}
								>
									Advanced Codec Pack (ProRes / DNxHR)…
								</button>
							</div>
							{timelineMediaWarnings.map((warn, i) => (
								<p key={i} className="export-warning" role="status">
									{warn}
								</p>
							))}
							{warnAboutMemoryFallback && (
								<p className="export-warning" role="status">
									This browser cannot stream the estimated {Math.ceil(estimatedSize / 1_000_000)} MB
									export to disk. The output will be buffered in memory and may exceed available
									memory.
								</p>
							)}
							{offlineAssets.length > 0 && (
								<div className="export-warning" role="group" aria-label="Offline media warning">
									<p>
										{offlineAssets.length} media asset(s) are offline. Those portions of the
										exported video will be blank or silent.
									</p>
									<label className="export-checkbox">
										<input
											type="checkbox"
											checked={offlineConfirmed}
											disabled={isRunning}
											onChange={(event) => setOfflineConfirmed(event.currentTarget.checked)}
										/>
										<span>Continue without offline media</span>
									</label>
								</div>
							)}
						</div>
					) : (
						<div id="project-export-panel" role="tabpanel" className="export-form">
							{project && project.sequences && Object.keys(project.sequences).length > 0 && (
								<label className="dialog-field">
									<span>Sequence</span>
									<select
										value={selectedSequenceId}
										disabled={isRunning}
										onChange={(event) =>
											setSelectedSequenceId(event.currentTarget.value as SequenceId)
										}
									>
										<option value={ROOT_SEQUENCE_ID}>Main Timeline (Root)</option>
										{Object.values(project.sequences).map((seq) => (
											<option key={seq.id} value={seq.id}>
												{seq.name}
											</option>
										))}
									</select>
								</label>
							)}
							<label className="dialog-field">
								<span>Format</span>
								<select
									value={interchangeFormat}
									disabled={isRunning}
									onChange={(event) =>
										setInterchangeFormat(event.currentTarget.value as InterchangeFormat)
									}
								>
									{INTERCHANGE_FORMATS.map((format) => (
										<option key={format.value} value={format.value}>
											{format.label}
										</option>
									))}
								</select>
							</label>
							<label className="export-checkbox">
								<input
									type="checkbox"
									checked={includeMedia}
									disabled={isRunning}
									onChange={(event) => setIncludeMedia(event.currentTarget.checked)}
								/>
								<span>Package project with media files (.zip)</span>
							</label>
							<p className="dialog-description">
								Premiere Pro imports xmeml and EDL. Final Cut Pro XML targets Final Cut Pro and
								Resolve. OTIO is an open interchange format. Media is referenced by package-relative
								paths when included; relink it if you move files.
							</p>
							{interchangeFormat === 'edl' && (
								<p className="export-warning" role="note">
									CMX3600 EDL contains cuts for video tracks only. The package contains one EDL per
									video track; audio is not included.
								</p>
							)}
							{includeMedia && offlineAssets.length > 0 && (
								<p className="export-warning" role="alert">
									Cannot package {offlineAssets.length} offline media asset(s). Relink them or turn
									off media packaging.
								</p>
							)}
							{interchangeOmissionWarning && (
								<p className="export-warning" role="note">
									{interchangeOmissionWarning}
								</p>
							)}
							{interchangeTimeline && (
								<details className="interchange-matrix" open>
									<summary>
										What’s transferred to{' '}
										{INTERCHANGE_FORMATS.find((f) => f.value === interchangeFormat)?.label ??
											'this format'}
									</summary>
									<table className="interchange-table">
										<thead>
											<tr>
												<th>Feature</th>
												<th>Transfer Status</th>
												<th>Mapping Notes</th>
											</tr>
										</thead>
										<tbody>
											{interchangeTimeline.featureAudits.map((item) => {
												const audit = item[interchangeFormat];
												return (
													<tr key={item.feature}>
														<td>{item.feature}</td>
														<td>
															<span className={`status-badge ${audit.status}`}>{audit.status}</span>
														</td>
														<td>{audit.note}</td>
													</tr>
												);
											})}
										</tbody>
									</table>
									{interchangeTimeline.omissions.length > 0 && (
										<div
											className="interchange-omissions"
											style={{ marginTop: '8px', color: '#f59e0b' }}
										>
											<strong>Sequence omissions:</strong>
											<ul>
												{interchangeTimeline.omissions.map((om, idx) => (
													<li key={idx}>{om}</li>
												))}
											</ul>
										</div>
									)}
								</details>
							)}
						</div>
					)}
					{progressValue && (
						<div className="export-progress" role="status" aria-live="polite">
							<div className="export-progress-label">
								<span>{isRunning ? 'Exporting…' : 'Export complete'}</span>
								<span>{progressValue.label}</span>
							</div>
							<progress max={100} value={progressValue.value} aria-label="Export progress" />
							{progress && (
								<p>
									{progress.framesDone} / {progress.totalFrames} frames
									{progress.phase === 'rendering' ? ` · ${progress.fps.toFixed(1)} fps` : ''}
								</p>
							)}
						</div>
					)}
					{!isRunning && progressValue && progressValue.value >= 100 && (
						<div
							className="export-bmc-callout"
							style={{
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'space-between',
								gap: '12px',
								padding: '10px 14px',
								background: 'rgba(255, 221, 0, 0.08)',
								border: '1px solid rgba(255, 221, 0, 0.25)',
								borderRadius: '8px',
								marginTop: '12px',
								fontSize: '12px',
								color: '#e2e8f0'
							}}
						>
							<span>Enjoying your free watermark-free export?</span>
							<a
								href="https://buymeacoffee.com/beestack"
								target="_blank"
								rel="noopener noreferrer"
								style={{
									display: 'inline-flex',
									alignItems: 'center',
									gap: '6px',
									background: '#ffdd00',
									color: '#000000',
									fontWeight: 700,
									padding: '4px 10px',
									borderRadius: '6px',
									textDecoration: 'none',
									whiteSpace: 'nowrap'
								}}
							>
								<span>Buy me a coffee ☕</span>
							</a>
						</div>
					)}
					{errorMessage && (
						<p ref={errorRef} className="dialog-message" role="alert" tabIndex={-1}>
							{errorMessage}
						</p>
					)}
					{notice && (
						<p className="export-notice" role="status" aria-live="polite">
							{notice}
						</p>
					)}
					<div className="dialog-actions">
						<button
							ref={cancelConfirmRef}
							className="secondary-button"
							type="button"
							onClick={requestCancel}
						>
							{isRunning ? 'Cancel…' : 'Close'}
						</button>
						<button
							className="primary-button"
							type="button"
							disabled={
								isRunning ||
								(tab === 'video'
									? !canExport
									: !runtime || !project || (includeMedia && offlineAssets.length > 0))
							}
							onClick={() => void (tab === 'video' ? runVideoExport() : runInterchangeExport())}
						>
							{isRunning ? 'Exporting…' : tab === 'video' ? 'Export video' : 'Export project'}
						</button>
					</div>
				</div>
			</dialog>
			<dialog
				ref={cancelDialogRef}
				className="editor-dialog export-confirm-dialog"
				aria-labelledby="cancel-export-title"
				aria-describedby="cancel-export-description"
				onCancel={(event) => {
					event.preventDefault();
					setCancelConfirmation(false);
				}}
			>
				<div className="dialog-content">
					<h2 id="cancel-export-title">Cancel this export?</h2>
					<p id="cancel-export-description" className="dialog-description">
						The current output will be discarded.
					</p>
					<div className="dialog-actions">
						<button
							ref={cancelConfirmRef}
							className="secondary-button"
							type="button"
							onClick={() => setCancelConfirmation(false)}
						>
							Keep exporting
						</button>
						<button
							className="danger-button"
							type="button"
							onClick={() => cancelRef.current?.abort()}
						>
							Cancel export
						</button>
					</div>
				</div>
			</dialog>
			<dialog
				ref={closePromptRef}
				className="editor-dialog export-close-dialog"
				aria-labelledby="export-close-title"
				onCancel={(event) => {
					event.preventDefault();
					dismissClosePrompt();
				}}
			>
				<div className="dialog-content">
					<h2 id="export-close-title">Export in progress</h2>
					<p className="dialog-description">
						Cancel the active export before closing or switching projects? Its output will be
						discarded.
					</p>
					<div className="dialog-actions">
						<button className="secondary-button" type="button" onClick={dismissClosePrompt}>
							Keep exporting
						</button>
						<button
							className="danger-button"
							type="button"
							onClick={() => void confirmCancelAndContinue()}
						>
							Cancel export and continue
						</button>
					</div>
				</div>
			</dialog>
			<CodecSupportDialog
				isOpen={isCodecSupportOpen}
				onClose={() => setIsCodecSupportOpen(false)}
			/>
			<CodecPackDialog isOpen={isCodecPackOpen} onClose={() => setIsCodecPackOpen(false)} />
		</>
	);
}
