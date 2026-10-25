import { useEffect, useRef, useState, type RefObject } from 'react';
import { resolveFrame, projectNeedsGpu } from '../../core';
import type { Project } from '../../core';
import type { PlaybackEngine, PlaybackSnapshot } from '../../services/playback/engine';
import type { RendererKind } from '../../services/render';
import { observePreviewScale } from '../../services/playback/previewLayout';
import { useEditorStore } from '../../state/EditorProvider';
import { viewProject } from '../../core/sequences/access';
import TransformGizmo from './TransformGizmo';
import MaskOverlay from './MaskOverlay';
import TextInlineEditor from './TextInlineEditor';
import { TrackingOverlay } from './TrackingOverlay';
import CaptionOverlay from './CaptionOverlay';
import GuidesOverlay from './GuidesOverlay';

interface PreviewPlayerProps {
	project: Project | null;
	engine: PlaybackEngine | null;
	zoom: string;
	canvasRef: RefObject<HTMLCanvasElement | null>;
	renderer: RendererKind;
}

interface PreviewState {
	hasVideo: boolean;
	hasAudio: boolean;
	missing: string[];
	loading: boolean;
	error: string;
	unsupported: string;
	proxyActive: boolean;
}

export default function PreviewPlayer({
	project,
	engine,
	zoom,
	canvasRef,
	renderer
}: PreviewPlayerProps) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [fitScale, setFitScale] = useState(0);
	const activeSeqId = useEditorStore((state) => state.activeSequenceId);
	const activeProject = project ? viewProject(project, activeSeqId) : null;
	const scale = Number(zoom) || 1;
	const projectWidth = project?.settings.width;
	const projectHeight = project?.settings.height;

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport || !projectWidth || !projectHeight) return;
		return observePreviewScale(
			viewport,
			{ width: projectWidth, height: projectHeight },
			setFitScale
		);
	}, [projectHeight, projectWidth]);

	const renderedWidth = Math.max(1, project?.settings.width ?? 1) * fitScale * scale;
	const renderedHeight = Math.max(1, project?.settings.height ?? 1) * fitScale * scale;

	return (
		<div className="preview-workspace">
			<div className="preview-canvas-viewport" ref={viewportRef}>
				{project ? (
					<div
						className="preview-canvas-frame"
						style={{ width: renderedWidth, height: renderedHeight }}
					>
						<canvas
							key={`${project.id}:${renderer}`}
							ref={canvasRef}
							className="preview-canvas"
							width={project.settings.width}
							height={project.settings.height}
							role="img"
							tabIndex={0}
							aria-label="Preview"
							data-testid="preview-canvas"
						/>
						<TransformGizmo
							project={activeProject ?? project}
							renderedWidth={renderedWidth}
							renderedHeight={renderedHeight}
						/>
						<MaskOverlay
							project={activeProject ?? project}
							renderedWidth={renderedWidth}
							renderedHeight={renderedHeight}
						/>
						<TextInlineEditor
							project={activeProject ?? project}
							renderedWidth={renderedWidth}
							renderedHeight={renderedHeight}
						/>
						<TrackingOverlay
							project={activeProject ?? project}
							renderedWidth={renderedWidth}
							renderedHeight={renderedHeight}
						/>
						<CaptionOverlay
							project={activeProject ?? project}
							renderedWidth={renderedWidth}
							renderedHeight={renderedHeight}
						/>
						<GuidesOverlay renderedWidth={renderedWidth} renderedHeight={renderedHeight} />
						<PreviewNotice project={project} engine={engine} renderer={renderer} />
					</div>
				) : (
					<div className="preview-empty-state">
						<p>No project open</p>
						<span>Create or open a project to preview its timeline.</span>
					</div>
				)}
			</div>
			{project && (
				<div className="preview-project-status">
					<span>
						{project.settings.width} × {project.settings.height}
					</span>
				</div>
			)}
		</div>
	);
}

function PreviewNotice({
	project,
	engine,
	renderer
}: {
	project: Project;
	engine: PlaybackEngine | null;
	renderer: RendererKind;
}) {
	const [state, setState] = useState<PreviewState>({
		hasVideo: false,
		hasAudio: false,
		missing: [],
		loading: false,
		error: '',
		unsupported: '',
		proxyActive: false
	});

	useEffect(() => {
		if (!engine) return;
		const update = (snapshot: PlaybackSnapshot) => {
			const resolved = resolveFrame(project, snapshot.time);
			const names = [...new Set(snapshot.missing.map((id) => project.assets[id]?.name ?? id))];
			const unsupportedAsset = resolved.videoLayers
				.map((layer) => (layer.assetId ? project.assets[layer.assetId] : undefined))
				.find((asset) => asset?.videoDecodable === false);
			const nextState: PreviewState = {
				hasVideo: resolved.videoLayers.some(
					(layer) => !layer.assetId || !snapshot.missing.includes(layer.assetId)
				),
				hasAudio: resolved.audioSources.length > 0,
				missing: names,
				loading: snapshot.loading,
				error: snapshot.error,
				unsupported: unsupportedAsset
					? `${unsupportedAsset.name}${unsupportedAsset.videoCodec ? ` (${unsupportedAsset.videoCodec})` : ''}`
					: '',
				proxyActive: snapshot.proxyActive ?? false
			};
			setState((previous) =>
				previous.hasVideo === nextState.hasVideo &&
				previous.hasAudio === nextState.hasAudio &&
				previous.loading === nextState.loading &&
				previous.error === nextState.error &&
				previous.unsupported === nextState.unsupported &&
				previous.proxyActive === nextState.proxyActive &&
				previous.missing.join('\0') === nextState.missing.join('\0')
					? previous
					: nextState
			);
		};
		return engine.subscribe(update);
	}, [engine, project]);

	const needsGpu = projectNeedsGpu(project);
	if (needsGpu && renderer !== 'webgl2') {
		return (
			<div className="preview-warning-overlay" role="alert">
				<strong>Rendering requires WebGL2</strong>
				<span>
					Effects and adjustment layers require WebGL2, which is unavailable in this browser
					session.
				</span>
			</div>
		);
	}

	if (state.missing.length > 0) {
		return (
			<div className="preview-warning-overlay" role="status" aria-live="polite">
				<strong>Offline media</strong>
				<span>{state.missing.join(', ')}</span>
			</div>
		);
	}
	if (state.error) {
		return (
			<div className="preview-warning-overlay" role="alert">
				<strong>Playback error</strong>
				<span>{state.error}</span>
			</div>
		);
	}
	if (state.unsupported) {
		return (
			<div className="preview-warning-overlay" role="alert">
				<strong>Unsupported video codec</strong>
				<span>This browser cannot decode “{state.unsupported}”.</span>
			</div>
		);
	}
	if (!state.hasVideo && !state.hasAudio) {
		return (
			<div className="preview-empty-overlay">
				<span>Nothing at playhead</span>
			</div>
		);
	}
	// Check if any active clip at playhead uses seeking mode (reverse, time remap, or speed outside [0.25, 4])
	const hasChoppySpeed =
		engine?.snapshot.playing &&
		project.tracks.some((t) =>
			t.clips.some((c) => {
				if (
					c.start <= (engine?.snapshot.time ?? 0) &&
					(engine?.snapshot.time ?? 0) < c.start + c.duration
				) {
					if (c.timeRemap) return true;
					if (c.speed !== undefined && (c.speed < 0 || c.speed < 0.25 || c.speed > 4)) return true;
				}
				return false;
			})
		);
	return (
		<>
			{state.loading && !engine?.snapshot.playing && (
				<div className="preview-loading-indicator" role="status" aria-live="polite">
					Decoding frame…
				</div>
			)}
			{state.proxyActive && (
				<div
					className="preview-proxy-badge"
					data-testid="preview-proxy-badge"
					style={{
						position: 'absolute',
						top: '8px',
						right: '8px',
						background: 'var(--color-link, #0070f3)',
						color: '#ffffff',
						padding: '2px 6px',
						borderRadius: '3px',
						fontSize: '10px',
						fontWeight: 600,
						letterSpacing: '0.05em',
						pointerEvents: 'none',
						zIndex: 10,
						boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)'
					}}
					role="status"
					aria-label="Proxy media active"
				>
					PROXY
				</div>
			)}
			{hasChoppySpeed && (
				<div
					className="preview-choppy-speed-hint"
					style={{
						position: 'absolute',
						bottom: '8px',
						left: '50%',
						transform: 'translateX(-50%)',
						background: 'rgba(0, 0, 0, 0.75)',
						color: '#f59e0b',
						padding: '3px 8px',
						borderRadius: '4px',
						fontSize: '0.6875rem',
						pointerEvents: 'none',
						zIndex: 10
					}}
					role="status"
				>
					Preview may be choppy for this speed
				</div>
			)}
		</>
	);
}
