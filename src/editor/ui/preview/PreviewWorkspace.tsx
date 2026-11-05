import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../../core';
import { createPlaybackEngine, type PlaybackEngine } from '../../services/playback/engine';
import { selectRenderer } from '../../services/render';
import { attachPlaybackTestHooks } from '../../services/playback/testHooks';
import { useEditorStoreApi } from '../../state/EditorProvider';
import PreviewPlayer from './PreviewPlayer';
import TransportBar from './TransportBar';
import './preview.css';

interface PreviewWorkspaceProps {
	project: Project | null;
	revision: number;
	onEngineChange: (engine: PlaybackEngine | null) => void;
}

export default function PreviewWorkspace({
	project,
	revision,
	onEngineChange
}: PreviewWorkspaceProps) {
	const store = useEditorStoreApi();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const currentProject = useRef(project);
	const engineChange = useRef(onEngineChange);
	const [engine, setEngine] = useState<PlaybackEngine | null>(null);
	const [zoom, setZoom] = useState('fit');
	const renderer = useMemo(() => selectRenderer(project), [project]);
	currentProject.current = project;
	engineChange.current = onEngineChange;

	// Create playback engine once per project ID
	useEffect(() => {
		const initialProject = currentProject.current;
		if (!initialProject) {
			setEngine(null);
			engineChange.current(null);
			return;
		}
		const playback = createPlaybackEngine(store, initialProject);
		const detachTestHooks = attachPlaybackTestHooks(playback);
		setEngine(playback);
		engineChange.current(playback);
		return () => {
			engineChange.current(null);
			detachTestHooks();
			playback.dispose();
		};
	}, [project?.id, store]);

	// Attach engine to canvas whenever engine mounts or renderer switches
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!engine || !canvas || engine.disposed) return;
		engine.attach(canvas, renderer);
	}, [engine, renderer]);

	useEffect(() => {
		if (project && engine?.projectId === project.id) engine.setProject(project);
	}, [engine, project, revision]);

	const containerRef = useRef<HTMLDivElement>(null);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [isIdle, setIsIdle] = useState(false);
	const idleTimeoutRef = useRef<number | null>(null);

	const resetIdleTimer = useCallback(() => {
		setIsIdle(false);
		if (idleTimeoutRef.current) {
			window.clearTimeout(idleTimeoutRef.current);
		}
		if (isFullscreen && engine?.snapshot.playing) {
			idleTimeoutRef.current = window.setTimeout(() => {
				setIsIdle(true);
			}, 2500);
		}
	}, [engine?.snapshot.playing, isFullscreen]);

	useEffect(() => {
		if (!isFullscreen) {
			setIsIdle(false);
			if (idleTimeoutRef.current) {
				window.clearTimeout(idleTimeoutRef.current);
			}
		}
	}, [isFullscreen]);

	const toggleFullscreen = useCallback(() => {
		const container = containerRef.current;
		if (!container) return;
		if (!document.fullscreenElement) {
			void container.requestFullscreen?.().catch(() => {});
		} else {
			void document.exitFullscreen?.().catch(() => {});
		}
	}, []);

	useEffect(() => {
		const handleFsChange = () => {
			const container = containerRef.current;
			setIsFullscreen(
				Boolean(document.fullscreenElement && container?.contains(document.fullscreenElement))
			);
		};
		document.addEventListener('fullscreenchange', handleFsChange);
		return () => document.removeEventListener('fullscreenchange', handleFsChange);
	}, []);

	return (
		<div
			ref={containerRef}
			className={`preview-panel-content ${isFullscreen ? 'is-fullscreen' : ''} ${isIdle && isFullscreen ? 'is-idle' : ''}`}
			onMouseMove={resetIdleTimer}
			onPointerDown={resetIdleTimer}
		>
			<div
				className="preview-stage-row"
				style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}
			>
				<PreviewPlayer
					project={project}
					engine={engine}
					zoom={zoom}
					canvasRef={canvasRef}
					renderer={renderer}
				/>
			</div>
			{project && (
				<TransportBar
					engine={engine?.projectId === project.id ? engine : null}
					fps={project.settings.fps}
					zoom={zoom}
					onZoomChange={setZoom}
					isFullscreen={isFullscreen}
					onToggleFullscreen={toggleFullscreen}
				/>
			)}
		</div>
	);
}
