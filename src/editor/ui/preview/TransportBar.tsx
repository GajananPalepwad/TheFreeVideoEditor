import { useEffect, useRef, useState } from 'react';
import { ticksToTimecode } from '../../core';
import type { PlaybackEngine, PlaybackSnapshot } from '../../services/playback/engine';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import YouTubeTimelineScrubber from './YouTubeTimelineScrubber';

const ZOOM_OPTIONS = [
	{ label: 'Fit', value: 'fit' },
	{ label: '25%', value: '0.25' },
	{ label: '50%', value: '0.5' },
	{ label: '75%', value: '0.75' },
	{ label: '100%', value: '1' },
	{ label: '125%', value: '1.25' },
	{ label: '150%', value: '1.5' },
	{ label: '200%', value: '2' }
] as const;

interface TransportBarProps {
	engine: PlaybackEngine | null;
	fps: number;
	zoom: string;
	onZoomChange: (value: string) => void;
	isFullscreen?: boolean;
	onToggleFullscreen?: () => void;
}

export default function TransportBar({
	engine,
	fps,
	zoom,
	onZoomChange,
	isFullscreen = false,
	onToggleFullscreen
}: TransportBarProps) {
	const store = useEditorStoreApi();
	const scopesOpen = useEditorStore((state) => state.scopes.open);
	const proxiesEnabled = useEditorStore((state) => state.project?.proxy?.enabled ?? false);
	const previewGuides = useEditorStore((state) => state.previewGuides);
	const [isGuidesMenuOpen, setIsGuidesMenuOpen] = useState(false);
	const guidesMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isGuidesMenuOpen) return;
		function handleClickOutside(event: MouseEvent) {
			if (guidesMenuRef.current && !guidesMenuRef.current.contains(event.target as Node)) {
				setIsGuidesMenuOpen(false);
			}
		}
		function handleKeyDown(event: globalThis.KeyboardEvent) {
			if (event.key === 'Escape') {
				setIsGuidesMenuOpen(false);
			}
		}
		window.addEventListener('mousedown', handleClickOutside);
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('mousedown', handleClickOutside);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [isGuidesMenuOpen]);

	const [snapshot, setSnapshot] = useState<PlaybackSnapshot | null>(engine?.snapshot ?? null);
	const [playAnnouncement, setPlayAnnouncement] = useState('');
	const previousPlaying = useRef<boolean | null>(null);
	useEffect(() => {
		setSnapshot(engine?.snapshot ?? null);
		previousPlaying.current = engine?.snapshot.playing ?? null;
		if (!engine) return;
		return engine.subscribe((next) => {
			setSnapshot(next);
			if (previousPlaying.current !== null && previousPlaying.current !== next.playing) {
				setPlayAnnouncement(next.playing ? 'Playback started.' : 'Playback paused.');
			}
			previousPlaying.current = next.playing;
		});
	}, [engine]);

	const time = snapshot?.time ?? 0;
	const duration = snapshot?.duration ?? 0;
	const disabled = !engine;
	const currentTime = ticksToTimecode(time, fps);
	const totalTime = ticksToTimecode(duration, fps);

	return (
		<div
			className={`preview-transport ${isFullscreen ? 'is-fullscreen' : ''}`}
			role="toolbar"
			aria-label="Program playback controls"
		>
			{/* Timeline Scrubber in Fullscreen Preview Only */}
			{isFullscreen && (
				<YouTubeTimelineScrubber
					engine={engine}
					time={time}
					duration={duration}
					fps={fps}
					isFullscreen={true}
				/>
			)}

			{/* Row 1: Primary transport navigation, playhead, timecode */}
			<div className="preview-transport-row preview-transport-row-primary">
				<div className="preview-transport-group" role="group" aria-label="Timeline navigation">
					<button
						type="button"
						aria-label="Go to start"
						title="Go to start (Home)"
						disabled={disabled}
						onClick={() => engine?.jumpTo('start')}
					>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<rect x="2" y="3" width="2" height="10" rx="0.5" />
							<polygon points="14,3 6,8 14,13" />
						</svg>
					</button>
					<button
						type="button"
						aria-label="Previous edit"
						title="Previous edit (↑)"
						disabled={disabled}
						onClick={() => engine?.jumpTo('prevEdge')}
					>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<polygon points="11,3 3,8 11,13" />
							<rect x="12" y="3" width="2" height="10" rx="0.5" />
						</svg>
					</button>
					<button
						type="button"
						aria-label="Step back one frame"
						title="Step back one frame (←)"
						disabled={disabled}
						onClick={() => engine?.stepFrames(-1)}
					>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<polygon points="12,3 4,8 12,13" />
						</svg>
					</button>
					<button
						className="preview-play-button"
						type="button"
						aria-label={snapshot?.playing ? 'Pause' : 'Play'}
						title="Play / Pause (Space)"
						disabled={disabled}
						onClick={() => engine?.toggle()}
					>
						{snapshot?.playing ? (
							<svg
								width="12"
								height="12"
								viewBox="0 0 16 16"
								fill="currentColor"
								aria-hidden="true"
							>
								<rect x="3" y="3" width="3.5" height="10" rx="0.8" />
								<rect x="9.5" y="3" width="3.5" height="10" rx="0.8" />
							</svg>
						) : (
							<svg
								width="12"
								height="12"
								viewBox="0 0 16 16"
								fill="currentColor"
								aria-hidden="true"
							>
								<polygon points="4,2.5 13.5,8 4,13.5" />
							</svg>
						)}
					</button>
					<button
						type="button"
						aria-label="Step forward one frame"
						title="Step forward one frame (→)"
						disabled={disabled}
						onClick={() => engine?.stepFrames(1)}
					>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<polygon points="4,3 12,8 4,13" />
						</svg>
					</button>
					<button
						type="button"
						aria-label="Next edit"
						title="Next edit (↓)"
						disabled={disabled}
						onClick={() => engine?.jumpTo('nextEdge')}
					>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<rect x="2" y="3" width="2" height="10" rx="0.5" />
							<polygon points="5,3 13,8 5,13" />
						</svg>
					</button>
					<button
						type="button"
						aria-label="Go to end"
						title="Go to end (End)"
						disabled={disabled}
						onClick={() => engine?.jumpTo('end')}
					>
						<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
							<polygon points="2,3 10,8 2,13" />
							<rect x="12" y="3" width="2" height="10" rx="0.5" />
						</svg>
					</button>
					<button
						type="button"
						aria-label="Toggle playback loop"
						aria-pressed={snapshot?.looping ?? false}
						title="Loop playback (⌘/Ctrl+L)"
						className={`preview-loop-button ${snapshot?.looping ? 'is-active' : ''}`}
						disabled={disabled}
						onClick={() => engine?.setLoop(!snapshot?.looping)}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<polyline points="17 1 21 5 17 9" />
							<path d="M3 11V9a4 4 0 0 1 4-4h14" />
							<polyline points="7 23 3 19 7 15" />
							<path d="M21 13v2a4 4 0 0 1-4 4H3" />
						</svg>
						<span className="preview-loop-label">Loop</span>
					</button>
					<button
						type="button"
						className="preview-capture-button"
						aria-label="Export frame"
						title="Export frame (Shift+E)"
						disabled={disabled}
						onClick={() => {
							if (snapshot?.playing) engine?.pause();
							store.getState().openExportFrameDialog();
						}}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
							<circle cx="12" cy="13" r="4" />
						</svg>
					</button>
				</div>
				<div className="preview-timecode-group">
					<output
						className="preview-timecode"
						aria-label="Current timecode and duration"
						aria-live="off"
					>
						{currentTime} / {totalTime}
					</output>
					<span className="sr-only" role="status" aria-live="polite">
						{playAnnouncement}
					</span>
					{snapshot?.rate && snapshot.rate !== 1 && (
						<span className="preview-rate" aria-label="Playback speed">
							{`${Math.abs(snapshot.rate)}× ${snapshot.rate < 0 ? 'reverse' : 'forward'}`}
						</span>
					)}
					{snapshot?.error && (
						<span className="preview-playback-error" role="alert">
							{snapshot.error}
						</span>
					)}
				</div>
			</div>

			{/* Row 2: Audio status, meter, zoom, full screen preview */}
			<div className="preview-transport-row preview-transport-row-secondary">
				<div
					className="preview-transport-group preview-audio-tools"
					role="group"
					aria-label="Audio controls"
				>
					<button
						type="button"
						className={`preview-mute-button ${snapshot?.muted ? 'is-muted' : ''}`}
						aria-label={snapshot?.muted ? 'Unmute audio' : 'Mute audio'}
						aria-pressed={snapshot?.muted ?? false}
						title={snapshot?.muted ? 'Unmute audio (M)' : 'Mute audio (M)'}
						disabled={disabled}
						onClick={() => engine?.setMuted(!snapshot?.muted)}
					>
						<svg
							viewBox="0 0 16 16"
							width="13"
							height="13"
							fill="currentColor"
							aria-hidden="true"
							style={{ display: 'inline-block', verticalAlign: 'text-bottom' }}
						>
							{snapshot?.muted || (snapshot?.volume ?? 1) === 0 ? (
								<path d="M6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06zm7.137 2.096a.5.5 0 0 1 0 .708L12.207 8l1.647 1.646a.5.5 0 0 1-.708.708L11.5 8.707l-1.646 1.647a.5.5 0 0 1-.708-.708L10.793 8 9.146 6.354a.5.5 0 1 1 .708-.708L11.5 7.293l1.646-1.647a.5.5 0 0 1 .708 0z" />
							) : (
								<path d="M11.536 14.01A8.473 8.473 0 0 0 14.026 8a8.473 8.473 0 0 0-2.49-6.01l-.708.707A7.476 7.476 0 0 1 13.025 8c0 2.071-.84 3.946-2.197 5.303l.708.707zM10.121 12.596A6.48 6.48 0 0 0 12.025 8a6.48 6.48 0 0 0-1.904-4.596l-.707.707A5.482 5.482 0 0 1 11.025 8a5.482 5.482 0 0 1-1.611 3.889l.707.707zM8.707 11.182A4.486 4.486 0 0 0 10.025 8a4.486 4.486 0 0 0-1.318-3.182L8 5.525A3.489 3.489 0 0 1 9.025 8 3.49 3.49 0 0 1 8 10.475l.707.707zM6.717 3.55A.5.5 0 0 1 7 4v8a.5.5 0 0 1-.812.39L3.825 10.5H1.5A.5.5 0 0 1 1 10V6a.5.5 0 0 1 .5-.5h2.325l2.363-1.89a.5.5 0 0 1 .529-.06z" />
							)}
						</svg>
						<span className="preview-audio-label">{snapshot?.muted ? 'Muted' : 'Audio'}</span>
					</button>
					<label
						className="preview-volume-control"
						title={`Master Volume: ${Math.round((snapshot?.muted ? 0 : (snapshot?.volume ?? 1)) * 100)}%`}
					>
						<span className="sr-only">Master volume</span>
						<input
							type="range"
							className="preview-volume-slider"
							min="0"
							max="1"
							step="0.01"
							disabled={disabled}
							value={snapshot?.muted ? 0 : (snapshot?.volume ?? 1)}
							onChange={(e) => {
								const val = Number(e.currentTarget.value);
								if (snapshot?.muted && val > 0) {
									engine?.setMuted(false);
								}
								engine?.setVolume(val);
							}}
							aria-label="Master playback volume"
						/>
					</label>
				</div>

				<div
					className="preview-transport-group preview-view-tools"
					role="group"
					aria-label="View options"
				>
					<label className="sr-only" htmlFor="preview-zoom">
						Preview zoom
					</label>
					<select
						id="preview-zoom"
						name="preview-zoom"
						aria-label="Preview zoom"
						value={zoom}
						onChange={(event) => onZoomChange(event.currentTarget.value)}
					>
						{ZOOM_OPTIONS.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<button
						type="button"
						aria-label="Toggle proxy playback"
						aria-pressed={proxiesEnabled}
						title={proxiesEnabled ? 'Use Proxies (active)' : 'Use Proxies (inactive)'}
						className={proxiesEnabled ? 'is-active' : ''}
						data-testid="toggle-proxies-button"
						onClick={() => store.getState().toggleProxiesEnabled()}
					>
						Proxies
					</button>
					<button
						type="button"
						aria-label="Toggle scopes"
						aria-pressed={scopesOpen}
						title="Video scopes"
						className={scopesOpen ? 'is-active' : ''}
						onClick={() => store.getState().toggleScopesOpen()}
					>
						Scopes
					</button>
					<div className="preview-guides-container" ref={guidesMenuRef}>
						<button
							type="button"
							aria-label="Toggle preview overlays and guides"
							aria-pressed={Boolean(
								previewGuides.safeMargins || previewGuides.ruleOfThirds || previewGuides.socialGuide
							)}
							aria-haspopup="true"
							aria-expanded={isGuidesMenuOpen}
							title={
								previewGuides.safeMargins || previewGuides.ruleOfThirds || previewGuides.socialGuide
									? 'Guides & Overlays (active)'
									: 'Guides & Overlays'
							}
							className={`preview-guides-button ${
								previewGuides.safeMargins || previewGuides.ruleOfThirds || previewGuides.socialGuide
									? 'is-active'
									: ''
							} ${isGuidesMenuOpen ? 'is-open' : ''}`}
							data-testid="toggle-guides-button"
							onClick={() => setIsGuidesMenuOpen((prev) => !prev)}
						>
							<svg
								viewBox="0 0 16 16"
								width="13"
								height="13"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								aria-hidden="true"
								style={{ marginRight: '3px', verticalAlign: 'text-bottom' }}
							>
								<rect x="2" y="2" width="12" height="12" rx="1.5" />
								<line x1="6" y1="2" x2="6" y2="14" />
								<line x1="10" y1="2" x2="10" y2="14" />
								<line x1="2" y1="6" x2="14" y2="6" />
								<line x1="2" y1="10" x2="14" y2="10" />
							</svg>
							<span>Guides</span>
							<svg
								viewBox="0 0 8 6"
								width="7"
								height="5"
								fill="currentColor"
								aria-hidden="true"
								style={{ marginLeft: '3px', verticalAlign: 'middle' }}
							>
								<path d="M0.5 1l3.5 4 3.5-4z" />
							</svg>
						</button>
						{isGuidesMenuOpen && (
							<div
								className="preview-dropdown-menu guides-dropdown-menu"
								role="menu"
								aria-label="Guides and overlay options"
								onMouseDown={(e) => e.stopPropagation()}
							>
								<div className="preview-dropdown-title">Overlays & Guides</div>
								<button
									type="button"
									role="menuitemcheckbox"
									aria-checked={previewGuides.safeMargins}
									className={`dropdown-menu-item ${previewGuides.safeMargins ? 'is-checked' : ''}`}
									data-testid="toggle-safe-margins-button"
									onClick={() => store.getState().togglePreviewGuide('safeMargins')}
								>
									<span className="menu-check">{previewGuides.safeMargins ? '✓' : ''}</span>
									<span className="menu-label">Safe Margins (80% & 90%)</span>
								</button>
								<button
									type="button"
									role="menuitemcheckbox"
									aria-checked={previewGuides.ruleOfThirds}
									className={`dropdown-menu-item ${previewGuides.ruleOfThirds ? 'is-checked' : ''}`}
									data-testid="toggle-rule-of-thirds-button"
									onClick={() => store.getState().togglePreviewGuide('ruleOfThirds')}
								>
									<span className="menu-check">{previewGuides.ruleOfThirds ? '✓' : ''}</span>
									<span className="menu-label">Rule of Thirds (3×3)</span>
								</button>
								<button
									type="button"
									role="menuitemcheckbox"
									aria-checked={previewGuides.socialGuide}
									className={`dropdown-menu-item ${previewGuides.socialGuide ? 'is-checked' : ''}`}
									data-testid="toggle-social-guide-button"
									onClick={() => store.getState().togglePreviewGuide('socialGuide')}
								>
									<span className="menu-check">{previewGuides.socialGuide ? '✓' : ''}</span>
									<span className="menu-label">TikTok / Reels Safe Zone</span>
								</button>
								<div className="preview-dropdown-divider" />
								<button
									type="button"
									role="menuitem"
									className="dropdown-menu-item dropdown-menu-action"
									data-testid="toggle-all-guides-button"
									onClick={() => {
										const anyActive =
											previewGuides.safeMargins ||
											previewGuides.ruleOfThirds ||
											previewGuides.socialGuide;
										if (anyActive) {
											store.getState().resetPreviewGuides();
										} else {
											store.getState().setPreviewGuide('safeMargins', true);
											store.getState().setPreviewGuide('ruleOfThirds', true);
										}
									}}
								>
									<span className="menu-check"></span>
									<span className="menu-label">
										{previewGuides.safeMargins ||
										previewGuides.ruleOfThirds ||
										previewGuides.socialGuide
											? 'Clear All Guides'
											: 'Show Standard Guides'}
									</span>
								</button>
							</div>
						)}
					</div>
					{onToggleFullscreen && (
						<button
							type="button"
							className="preview-fullscreen-button"
							aria-label={isFullscreen ? 'Exit preview full screen' : 'Full screen preview'}
							title={isFullscreen ? 'Exit preview full screen (Esc)' : 'Full screen preview'}
							onClick={onToggleFullscreen}
						>
							<svg
								viewBox="0 0 16 16"
								width="13"
								height="13"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
								style={{
									marginRight: '5px',
									display: 'inline-block',
									verticalAlign: 'text-bottom'
								}}
							>
								{isFullscreen ? (
									/* Exit Fullscreen */
									<path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
								) : (
									/* Enter Fullscreen */
									<path d="M2 6V2h4M10 2h4v4M2 10v4h4M14 10v4h-4" />
								)}
							</svg>
							{isFullscreen ? 'Windowed' : 'Fullscreen'}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
