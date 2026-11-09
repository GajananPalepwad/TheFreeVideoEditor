import type { ReactNode } from 'react';
import type { TimelineTool } from '../../state/store';
import { trackFeatureUsed } from '../../../services/activityTracking';

interface ToolItem {
	id: TimelineTool | 'mark';
	label: string;
	shortcut?: string;
	description: string;
	icon: ReactNode;
}

const TOOLS: ToolItem[] = [
	{
		id: 'select',
		label: 'Selection Tool',
		shortcut: 'V',
		description: 'Select, move, and trim individual clips on the timeline',
		icon: (
			<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
				{/* Premiere Pro standard pointer cursor */}
				<path d="M2.5 1.5l10 6.5-4.8.8 2.6 4.7-1.8 1-2.6-4.7-3.4 3.2V1.5z" />
			</svg>
		)
	},
	{
		id: 'track-select',
		label: 'Track Select Forward Tool',
		shortcut: 'A',
		description: 'Select all clips forward (to the right) across all tracks',
		icon: (
			<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
				{/* Vertical track bar with double forward arrows */}
				<rect x="2" y="2.5" width="2" height="11" rx="0.5" />
				<path d="M6 4.5l4 3.5-4 3.5V4.5zM10.5 4.5l4 3.5-4 3.5V4.5z" />
			</svg>
		)
	},
	{
		id: 'ripple',
		label: 'Ripple Edit Tool',
		shortcut: 'B',
		description: 'Trim a clip while automatically adjusting the rest of the timeline',
		icon: (
			<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
				{/* Premiere Ripple Edit bracket with inward directional arrows */}
				<path d="M4 3h3v2H6v6h1v2H4V3zm5 2.5l3.5 2.5-3.5 2.5v-5z" />
			</svg>
		)
	},
	{
		id: 'razor',
		label: 'Razor Tool',
		shortcut: 'C',
		description: 'Make precise cuts and split clips into separate sections',
		icon: (
			<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
				{/* Premiere Pro classic angled razor blade */}
				<g transform="rotate(45 8 8)">
					<path
						fillRule="evenodd"
						clipRule="evenodd"
						d="M2.5 4.5h11l1 1.5v1.2h-1.2v1.6h1.2v1.2l-1 1.5h-11l-1-1.5V8.8h1.2V7.2H1.5V6l1-1.5zm2 3h7v1h-7v-1zm3.5-1.5a1 1 0 100 2 1 1 0 000-2z"
					/>
				</g>
			</svg>
		)
	},
	{
		id: 'slip',
		label: 'Slip Tool',
		shortcut: 'Y',
		description: "Shift clip's internal in and out points without moving its position",
		icon: (
			<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
				{/* Two boundary brackets with inward slip arrows */}
				<path d="M2 3h2v10H2V3zm10 0h2v10h-2V3zM7.5 5.5L5 8l2.5 2.5V5.5zm1 5L11 8 8.5 5.5v5z" />
			</svg>
		)
	},
	{
		id: 'rect',
		label: 'Rectangle Tool',
		description: 'Draw shapes and graphics overlays inside the program monitor',
		icon: (
			<svg
				viewBox="0 0 16 16"
				width="15"
				height="15"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<rect x="2.5" y="3.5" width="11" height="9" rx="1.2" />
			</svg>
		)
	},
	{
		id: 'mark',
		label: 'Add Marker',
		shortcut: 'M',
		description: 'Add marker at playhead',
		icon: (
			<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
				<path d="M4 1.5h8v8l-4 5-4-5V1.5z" />
			</svg>
		)
	},
	{
		id: 'type',
		label: 'Text Tool',
		shortcut: 'T',
		description: 'Add text layer at playhead',
		icon: (
			<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
				{/* Clean bold capital T */}
				<path d="M2.5 3.5V2h11v1.5H9.5v10.5H6.5V3.5H2.5z" />
			</svg>
		)
	}
];

interface TimelineToolsProps {
	activeTool: TimelineTool;
	onSelectTool: (tool: TimelineTool) => void;
	onAddMarker?: () => void;
	onAddText?: () => void;
	onAddShape?: () => void;
}

export function TimelineTools({
	activeTool,
	onSelectTool,
	onAddMarker,
	onAddText,
	onAddShape
}: TimelineToolsProps) {
	return (
		<aside
			className="timeline-toolstrip"
			role="toolbar"
			aria-label="Timeline editing tools"
			aria-orientation="vertical"
		>
			{TOOLS.map((tool) => {
				const isAction = tool.id === 'mark' || tool.id === 'type' || tool.id === 'rect';
				const isActive = !isAction && activeTool === tool.id;
				return (
					<button
						key={tool.id}
						type="button"
						className={`timeline-toolstrip-button ${isActive ? 'is-active' : ''}`}
						aria-pressed={isActive}
						aria-label={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
						onClick={() => {
							if (tool.id === 'mark') {
								trackFeatureUsed('marker');
								onAddMarker?.();
							} else if (tool.id === 'type') {
								trackFeatureUsed('text_layer');
								if (onAddText) {
									onAddText();
								} else {
									onSelectTool(tool.id);
								}
							} else if (tool.id === 'rect') {
								trackFeatureUsed('shape_layer');
								if (onAddShape) {
									onAddShape();
								} else {
									onSelectTool(tool.id);
								}
							} else {
								trackFeatureUsed(tool.id);
								onSelectTool(tool.id);
							}
						}}
					>
						<span className="timeline-toolstrip-icon" aria-hidden="true">
							{tool.icon}
						</span>
						<span className="timeline-toolstrip-name">{tool.label}</span>
						{tool.shortcut && (
							<kbd className="timeline-toolstrip-shortcut" aria-hidden="true">
								{tool.shortcut}
							</kbd>
						)}
					</button>
				);
			})}
		</aside>
	);
}

export default TimelineTools;
