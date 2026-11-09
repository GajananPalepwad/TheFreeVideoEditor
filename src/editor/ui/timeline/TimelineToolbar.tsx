import type { ReactNode } from 'react';

interface TimelineToolbarProps {
	playheadLabel: string;
	durationLabel: string;
	clipCount: number;
	sequenceTabs?: ReactNode;
	isMaximized?: boolean;
	onToggleMaximize?: () => void;
	snapEnabled?: boolean;
	snapToMarkers?: boolean;
	onToggleSnapToMarkers?: () => void;
	markerCount?: number;
	pixelsPerSecond: number;
	showLanes?: 'selected' | 'all' | 'off';
	onToggleKeyframes?: () => void;
	graphOpen?: boolean;
	onToggleGraph?: () => void;
	onSplit: () => void;
	onDelete: () => void;
	onRippleDelete: () => void;
	onToggleSnap?: () => void;
	onZoom: (value: number) => void;
	onFit: () => void;
	onAddTrack: (kind: 'video' | 'audio') => void;
	onAddAdjustment?: () => void;
	onAddSolid?: () => void;
	onAddShape?: () => void;
	onAddText?: () => void;
	onAddCaption?: () => void;
}

export default function TimelineToolbar({
	playheadLabel,
	durationLabel,
	clipCount,
	sequenceTabs,
	isMaximized = false,
	onToggleMaximize,
	snapEnabled = true,
	onToggleSnap,
	showLanes,
	onToggleKeyframes,
	graphOpen = false,
	onToggleGraph,
	markerCount,
	pixelsPerSecond,
	onSplit,
	onDelete,
	onRippleDelete,
	onZoom,
	onFit,
	onAddAdjustment,
	onAddSolid,
	onAddShape,
	onAddText,
	onAddCaption
}: TimelineToolbarProps) {
	return (
		<div className="timeline-toolbar-row">
			<div className="timeline-toolbar-left">
				{sequenceTabs && (
					<>
						<div className="timeline-tabs-inline">{sequenceTabs}</div>
						<div className="timeline-toolbar-separator" aria-hidden="true" />
					</>
				)}
				<div className="timeline-tool-group" role="group" aria-label="Timeline edit actions">
					<button
						className="tool-button"
						type="button"
						onClick={onSplit}
						title="Split selected clips at playhead (S)"
						aria-label="Split selected clips at playhead"
					>
						<svg
							className="tool-btn-icon"
							viewBox="0 0 16 16"
							width="13"
							height="13"
							fill="currentColor"
							aria-hidden="true"
						>
							<g transform="rotate(45 8 8)">
								<path
									fillRule="evenodd"
									clipRule="evenodd"
									d="M2.5 4.5h11l1 1.5v1.2h-1.2v1.6h1.2v1.2l-1 1.5h-11l-1-1.5V8.8h1.2V7.2H1.5V6l1-1.5zm2 3h7v1h-7v-1zm3.5-1.5a1 1 0 100 2 1 1 0 000-2z"
								/>
							</g>
						</svg>
						<span>Split</span>
					</button>
					<button
						className="tool-button"
						type="button"
						onClick={onDelete}
						title="Delete selected clips (Delete)"
						aria-label="Delete selected clips"
					>
						<svg
							className="tool-btn-icon"
							viewBox="0 0 16 16"
							width="12"
							height="12"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z" />
							<path
								fillRule="evenodd"
								d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"
							/>
						</svg>
						<span>Delete</span>
					</button>
					<button
						className="tool-button"
						type="button"
						onClick={onRippleDelete}
						title="Ripple delete selected clips (Shift+Delete)"
						aria-label="Ripple delete selected clips"
					>
						<svg
							className="tool-btn-icon"
							viewBox="0 0 16 16"
							width="12"
							height="12"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M2.5 1a1 1 0 0 0-1 1v1h11V2a1 1 0 0 0-1-1h-9zm10 3H1.5v8a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2V4zm-7 2.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5zm3 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V7a.5.5 0 0 1 .5-.5z" />
							<path d="M14 6l2 2-2 2V6z" />
						</svg>
						<span>Ripple</span>
					</button>
				</div>
				<div
					className="timeline-tool-group timeline-mobile-corner-actions"
					role="group"
					aria-label="Timeline display controls"
				>
					{onToggleSnap && (
						<button
							type="button"
							className={`tool-button ${snapEnabled ? 'is-active' : ''}`}
							onClick={onToggleSnap}
							title={`Snap in Timeline: ${snapEnabled ? 'On' : 'Off'} (S)`}
							aria-label="Toggle Snapping"
							aria-pressed={snapEnabled}
						>
							<svg
								className="tool-btn-icon"
								viewBox="0 0 16 16"
								width="13"
								height="13"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M3 2a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v5a1 1 0 0 1-2 0V2H5v5a3 3 0 0 0 6 0V2h-1V1h1a2 2 0 0 1 2 2v5a5 5 0 0 1-10 0V2z" />
								<path d="M3 2h2v2H3V2zm8 0h2v2h-2V2z" />
							</svg>
							<span>Snap</span>
						</button>
					)}
					{onToggleKeyframes && (
						<button
							type="button"
							className={`tool-button ${showLanes && showLanes !== 'off' ? 'is-active' : ''}`}
							onClick={onToggleKeyframes}
							title={`Keyframes: ${showLanes ?? 'off'} (Cmd+K)`}
							aria-label={`Keyframes display: ${showLanes ?? 'off'}`}
							aria-pressed={showLanes !== 'off'}
						>
							<svg
								className="tool-btn-icon"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M8 1.5L14 8L8 14.5L2 8L8 1.5Z" />
							</svg>
							<span>Keyframes</span>
						</button>
					)}
					{onToggleGraph && (
						<button
							type="button"
							className={`tool-button ${graphOpen ? 'is-active' : ''}`}
							onClick={onToggleGraph}
							title="Toggle Graph Editor (Shift+G)"
							aria-label="Graph"
							aria-pressed={graphOpen}
						>
							<svg
								className="tool-btn-icon"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.75"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M2 13C5 13 6 3 14 3" />
								<circle cx="2" cy="13" r="1.5" fill="currentColor" />
								<circle cx="14" cy="3" r="1.5" fill="currentColor" />
							</svg>
							<span>Graph</span>
						</button>
					)}
				</div>
				<div className="timeline-toolbar-separator" aria-hidden="true" />
				<div className="timeline-tool-group" role="group" aria-label="Add layers">
					{onAddAdjustment && (
						<button
							type="button"
							className="tool-button"
							onClick={onAddAdjustment}
							title="Add adjustment layer across sequence"
							aria-label="Adjustment Layer"
						>
							<svg
								className="tool-btn-icon"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.5v11A5.5 5.5 0 0 1 8 2.5z" />
							</svg>
							<span>
								Adjustment<span className="tool-button-layer-suffix"> Layer</span>
							</span>
						</button>
					)}
					{onAddSolid && (
						<button
							type="button"
							className="tool-button"
							onClick={onAddSolid}
							title="Add solid color layer"
							aria-label="Solid Layer"
						>
							<svg
								className="tool-btn-icon"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								fill="currentColor"
								aria-hidden="true"
							>
								<rect x="2" y="2" width="12" height="12" rx="2" />
							</svg>
							<span>
								Solid<span className="tool-button-layer-suffix"> Layer</span>
							</span>
						</button>
					)}
					{onAddShape && (
						<button
							type="button"
							className="tool-button"
							onClick={onAddShape}
							title="Add shape layer at playhead"
							aria-label="Shape Layer"
						>
							<svg
								className="tool-btn-icon"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.75"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<rect x="2" y="2" width="7.5" height="7.5" rx="1" />
								<circle cx="10" cy="10" r="4" />
							</svg>
							<span>
								Shape<span className="tool-button-layer-suffix"> Layer</span>
							</span>
						</button>
					)}
					{onAddText && (
						<button
							type="button"
							className="tool-button"
							onClick={onAddText}
							title="Add text clip at playhead"
							aria-label="Text Layer"
						>
							<svg
								className="tool-btn-icon"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M2.5 3v2h4.25v8h2.5V5H13.5V3h-11z" />
							</svg>
							<span>
								Text<span className="tool-button-layer-suffix"> Layer</span>
							</span>
						</button>
					)}
					{onAddCaption && (
						<button
							type="button"
							className="tool-button"
							onClick={onAddCaption}
							title="Add caption track or subtitle cue"
							aria-label="Caption Layer"
						>
							<svg
								className="tool-btn-icon"
								viewBox="0 0 16 16"
								width="12"
								height="12"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M2 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h1.5v2.5L7 13h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H2zm3.5 3h1.5a.5.5 0 0 1 .5.5v.5h-1v-.5H5.5v3H6v-.5h1v.5a.5.5 0 0 1-.5.5h-1.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5zm5 0H12a.5.5 0 0 1 .5.5v.5h-1v-.5H10.5v3H11v-.5h1v.5a.5.5 0 0 1-.5.5h-1.5a.5.5 0 0 1-.5-.5v-3a.5.5 0 0 1 .5-.5z" />
							</svg>
							<span>
								Caption<span className="tool-button-layer-suffix"> Layer</span>
							</span>
						</button>
					)}
				</div>
			</div>
			<div className="timeline-toolbar-right">
				<div className="timeline-tool-group timeline-zoom-tools">
					<label title="Timeline zoom">
						<span className="sr-only">Timeline zoom</span>
						<svg
							viewBox="0 0 16 16"
							width="11"
							height="11"
							fill="currentColor"
							className="timeline-zoom-icon"
							aria-hidden="true"
						>
							<path d="M6.5 12a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zm4.4-1.8l3.4 3.4a.75.75 0 0 1-1.06 1.06l-3.4-3.4a5.5 5.5 0 0 1-3.34.74zM4 6h5v1H4V6z" />
						</svg>
						<input
							type="range"
							name="timeline-zoom"
							className="timeline-zoom-slider"
							min="8"
							max="400"
							step="1"
							value={pixelsPerSecond}
							onChange={(event) => onZoom(Number(event.currentTarget.value))}
						/>
						<svg
							viewBox="0 0 16 16"
							width="11"
							height="11"
							fill="currentColor"
							className="timeline-zoom-icon"
							aria-hidden="true"
						>
							<path d="M6.5 12a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zm4.4-1.8l3.4 3.4a.75.75 0 0 1-1.06 1.06l-3.4-3.4a5.5 5.5 0 0 1-3.34.74zM6 4h1v2h2v1H7v2H6V7H4V6h2V4z" />
						</svg>
					</label>
					<button
						type="button"
						className="tool-button"
						onClick={onFit}
						title="Fit the full sequence (\)"
					>
						Fit
					</button>
					{playheadLabel && durationLabel && (
						<output
							className="timeline-time-readout"
							role="status"
							aria-label="Playhead time and sequence duration"
						>
							{playheadLabel} / {durationLabel}
						</output>
					)}
					<span
						className="timeline-counter-badge timeline-clip-count"
						aria-label={`${clipCount} clips`}
					>
						{clipCount} clips
					</span>
					{markerCount !== undefined && markerCount > 0 && (
						<span
							className="timeline-counter-badge timeline-marker-count"
							aria-label={`${markerCount} markers`}
						>
							<span className="marker-dot" aria-hidden="true" />
							{markerCount} markers
						</span>
					)}
					{onToggleMaximize && (
						<button
							type="button"
							className="tool-button timeline-maximize-btn"
							title={isMaximized ? 'Restore panel' : 'Maximize timeline'}
							aria-label={isMaximized ? 'Restore panel' : 'Maximize timeline'}
							onClick={onToggleMaximize}
						>
							⤢
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
