import { useMemo } from 'react';
import {
	computeRuleOfThirds,
	computeSafeMargins,
	computeSocialMediaGuide
} from '../../core/previewGuides';
import { useEditorStore } from '../../state/EditorProvider';

interface GuidesOverlayProps {
	renderedWidth: number;
	renderedHeight: number;
}

export default function GuidesOverlay({ renderedWidth, renderedHeight }: GuidesOverlayProps) {
	const previewGuides = useEditorStore((state) => state.previewGuides);

	const { safeMargins, ruleOfThirds, socialGuide } = previewGuides;

	const hasActiveGuides = safeMargins || ruleOfThirds || socialGuide;

	const margins = useMemo(() => {
		if (!safeMargins) return null;
		return computeSafeMargins(renderedWidth, renderedHeight);
	}, [safeMargins, renderedWidth, renderedHeight]);

	const thirds = useMemo(() => {
		if (!ruleOfThirds) return null;
		return computeRuleOfThirds(renderedWidth, renderedHeight);
	}, [ruleOfThirds, renderedWidth, renderedHeight]);

	const social = useMemo(() => {
		if (!socialGuide) return null;
		return computeSocialMediaGuide(renderedWidth, renderedHeight);
	}, [socialGuide, renderedWidth, renderedHeight]);

	if (!hasActiveGuides || renderedWidth <= 0 || renderedHeight <= 0) {
		return null;
	}

	return (
		<svg
			className="preview-guides-overlay"
			data-testid="preview-guides-overlay"
			style={{
				position: 'absolute',
				inset: 0,
				width: '100%',
				height: '100%',
				pointerEvents: 'none',
				zIndex: 8,
				overflow: 'hidden'
			}}
			viewBox={`0 0 ${renderedWidth} ${renderedHeight}`}
			aria-hidden="true"
		>
			<defs>
				{/* High-contrast drop shadow filter ensuring visibility against white/bright and black footage */}
				<filter id="guide-shadow" x="-20%" y="-20%" width="140%" height="140%">
					<feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000000" floodOpacity="0.85" />
				</filter>
				<filter id="social-badge-shadow" x="-20%" y="-20%" width="140%" height="140%">
					<feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#000000" floodOpacity="0.9" />
				</filter>
			</defs>

			{/* ---------------- 1. Safe Margins (Action 90% and Title 80%) ---------------- */}
			{margins && (
				<g className="guide-safe-margins" data-testid="guide-safe-margins">
					{/* 90% Action Safe */}
					<rect
						x={margins.actionSafe.x}
						y={margins.actionSafe.y}
						width={margins.actionSafe.width}
						height={margins.actionSafe.height}
						fill="none"
						stroke="#38bdf8"
						strokeWidth="1"
						strokeOpacity="0.75"
						filter="url(#guide-shadow)"
					/>
					{/* Action Safe Corner Ticks */}
					<g stroke="#38bdf8" strokeWidth="1.2" strokeOpacity="0.9" filter="url(#guide-shadow)">
						{/* Top Left */}
						<line
							x1={margins.actionSafe.x}
							y1={margins.actionSafe.y}
							x2={margins.actionSafe.x + 10}
							y2={margins.actionSafe.y}
						/>
						<line
							x1={margins.actionSafe.x}
							y1={margins.actionSafe.y}
							x2={margins.actionSafe.x}
							y2={margins.actionSafe.y + 10}
						/>
						{/* Top Right */}
						<line
							x1={margins.actionSafe.x + margins.actionSafe.width}
							y1={margins.actionSafe.y}
							x2={margins.actionSafe.x + margins.actionSafe.width - 10}
							y2={margins.actionSafe.y}
						/>
						<line
							x1={margins.actionSafe.x + margins.actionSafe.width}
							y1={margins.actionSafe.y}
							x2={margins.actionSafe.x + margins.actionSafe.width}
							y2={margins.actionSafe.y + 10}
						/>
						{/* Bottom Left */}
						<line
							x1={margins.actionSafe.x}
							y1={margins.actionSafe.y + margins.actionSafe.height}
							x2={margins.actionSafe.x + 10}
							y2={margins.actionSafe.y + margins.actionSafe.height}
						/>
						<line
							x1={margins.actionSafe.x}
							y1={margins.actionSafe.y + margins.actionSafe.height}
							x2={margins.actionSafe.x}
							y2={margins.actionSafe.y + margins.actionSafe.height - 10}
						/>
						{/* Bottom Right */}
						<line
							x1={margins.actionSafe.x + margins.actionSafe.width}
							y1={margins.actionSafe.y + margins.actionSafe.height}
							x2={margins.actionSafe.x + margins.actionSafe.width - 10}
							y2={margins.actionSafe.y + margins.actionSafe.height}
						/>
						<line
							x1={margins.actionSafe.x + margins.actionSafe.width}
							y1={margins.actionSafe.y + margins.actionSafe.height}
							x2={margins.actionSafe.x + margins.actionSafe.width}
							y2={margins.actionSafe.y + margins.actionSafe.height - 10}
						/>
					</g>
					<text
						x={margins.actionSafe.x + 5}
						y={margins.actionSafe.y + 12}
						fill="#38bdf8"
						fontSize="9"
						fontWeight="600"
						fontFamily="system-ui, -apple-system, sans-serif"
						filter="url(#guide-shadow)"
					>
						90% ACTION SAFE
					</text>

					{/* 80% Title Safe */}
					<rect
						x={margins.titleSafe.x}
						y={margins.titleSafe.y}
						width={margins.titleSafe.width}
						height={margins.titleSafe.height}
						fill="none"
						stroke="#38bdf8"
						strokeWidth="1"
						strokeDasharray="5 3"
						strokeOpacity="0.85"
						filter="url(#guide-shadow)"
					/>
					<text
						x={margins.titleSafe.x + 5}
						y={margins.titleSafe.y + 12}
						fill="#38bdf8"
						fontSize="9"
						fontWeight="600"
						fontFamily="system-ui, -apple-system, sans-serif"
						filter="url(#guide-shadow)"
					>
						80% TITLE SAFE
					</text>

					{/* Center Crosshair */}
					<g stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.85" filter="url(#guide-shadow)">
						<line
							x1={margins.centerCrosshair.x - margins.centerCrosshair.size}
							y1={margins.centerCrosshair.y}
							x2={margins.centerCrosshair.x - 3}
							y2={margins.centerCrosshair.y}
						/>
						<line
							x1={margins.centerCrosshair.x + 3}
							y1={margins.centerCrosshair.y}
							x2={margins.centerCrosshair.x + margins.centerCrosshair.size}
							y2={margins.centerCrosshair.y}
						/>
						<line
							x1={margins.centerCrosshair.x}
							y1={margins.centerCrosshair.y - margins.centerCrosshair.size}
							x2={margins.centerCrosshair.x}
							y2={margins.centerCrosshair.y - 3}
						/>
						<line
							x1={margins.centerCrosshair.x}
							y1={margins.centerCrosshair.y + 3}
							x2={margins.centerCrosshair.x}
							y2={margins.centerCrosshair.y + margins.centerCrosshair.size}
						/>
						<circle
							cx={margins.centerCrosshair.x}
							cy={margins.centerCrosshair.y}
							r="1.5"
							fill="#38bdf8"
						/>
					</g>
				</g>
			)}

			{/* ---------------- 2. Rule of Thirds (3x3 Grid) ---------------- */}
			{thirds && (
				<g className="guide-rule-of-thirds" data-testid="guide-rule-of-thirds">
					{/* Vertical Lines */}
					<line
						x1={thirds.verticals[0]}
						y1={0}
						x2={thirds.verticals[0]}
						y2={renderedHeight}
						stroke="#ffffff"
						strokeWidth="1"
						strokeDasharray="4 4"
						strokeOpacity="0.45"
						filter="url(#guide-shadow)"
					/>
					<line
						x1={thirds.verticals[1]}
						y1={0}
						x2={thirds.verticals[1]}
						y2={renderedHeight}
						stroke="#ffffff"
						strokeWidth="1"
						strokeDasharray="4 4"
						strokeOpacity="0.45"
						filter="url(#guide-shadow)"
					/>

					{/* Horizontal Lines */}
					<line
						x1={0}
						y1={thirds.horizontals[0]}
						x2={renderedWidth}
						y2={thirds.horizontals[0]}
						stroke="#ffffff"
						strokeWidth="1"
						strokeDasharray="4 4"
						strokeOpacity="0.45"
						filter="url(#guide-shadow)"
					/>
					<line
						x1={0}
						y1={thirds.horizontals[1]}
						x2={renderedWidth}
						y2={thirds.horizontals[1]}
						stroke="#ffffff"
						strokeWidth="1"
						strokeDasharray="4 4"
						strokeOpacity="0.45"
						filter="url(#guide-shadow)"
					/>

					{/* 4 Intersection Power Points */}
					{thirds.powerPoints.map((pt, index) => (
						<g key={`power-point-${index}`} filter="url(#guide-shadow)">
							<circle
								cx={pt.x}
								cy={pt.y}
								r="4"
								fill="none"
								stroke="#ffffff"
								strokeWidth="1.5"
								strokeOpacity="0.75"
							/>
							<circle cx={pt.x} cy={pt.y} r="1" fill="#ffffff" fillOpacity="0.9" />
						</g>
					))}
				</g>
			)}

			{/* ---------------- 3. TikTok / Instagram Reels UI Mask Overlay ---------------- */}
			{social && (
				<g className="guide-social-media" data-testid="guide-social-media">
					{/* Pillarboxes for non-portrait aspect ratio */}
					{!social.isPortrait && (
						<>
							<rect
								x={0}
								y={0}
								width={social.container.x}
								height={renderedHeight}
								fill="#000000"
								fillOpacity="0.4"
							/>
							<rect
								x={social.container.x + social.container.width}
								y={0}
								width={renderedWidth - (social.container.x + social.container.width)}
								height={renderedHeight}
								fill="#000000"
								fillOpacity="0.4"
							/>
							{/* Left & Right Container Bounds */}
							<line
								x1={social.container.x}
								y1={0}
								x2={social.container.x}
								y2={renderedHeight}
								stroke="#a855f7"
								strokeWidth="1.5"
								strokeDasharray="4 2"
								strokeOpacity="0.7"
								filter="url(#guide-shadow)"
							/>
							<line
								x1={social.container.x + social.container.width}
								y1={0}
								x2={social.container.x + social.container.width}
								y2={renderedHeight}
								stroke="#a855f7"
								strokeWidth="1.5"
								strokeDasharray="4 2"
								strokeOpacity="0.7"
								filter="url(#guide-shadow)"
							/>
						</>
					)}

					{/* Shaded Obstruction Danger Zones */}
					{/* Top Header Zone */}
					<rect
						x={social.topHeader.x}
						y={social.topHeader.y}
						width={social.topHeader.width}
						height={social.topHeader.height}
						fill="#ef4444"
						fillOpacity="0.12"
						stroke="#ef4444"
						strokeWidth="1"
						strokeDasharray="3 3"
						strokeOpacity="0.5"
					/>
					<text
						x={social.topHeader.x + social.topHeader.width / 2}
						y={social.topHeader.y + 22}
						textAnchor="middle"
						fill="#ffffff"
						fontSize="11"
						fontWeight="600"
						fontFamily="system-ui, -apple-system, sans-serif"
						fillOpacity="0.85"
						filter="url(#guide-shadow)"
					>
						Following &nbsp;|&nbsp; For You
					</text>

					{/* Right Rail Interaction Danger Zone */}
					<rect
						x={social.rightButtons.x}
						y={social.rightButtons.y}
						width={social.rightButtons.width}
						height={social.rightButtons.height}
						fill="#ef4444"
						fillOpacity="0.12"
						stroke="#ef4444"
						strokeWidth="1"
						strokeDasharray="3 3"
						strokeOpacity="0.5"
					/>
					{/* Right Column Simulated Buttons */}
					<g
						transform={`translate(${social.rightButtons.x + social.rightButtons.width / 2}, ${social.rightButtons.y})`}
						filter="url(#guide-shadow)"
					>
						{/* Profile avatar circle with '+' badge */}
						<circle cx="0" cy="20" r="14" fill="#1e293b" stroke="#ffffff" strokeWidth="1.5" />
						<circle cx="0" cy="32" r="5" fill="#ef4444" />
						<text x="0" y="34.5" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="bold">
							+
						</text>

						{/* Heart / Like Icon */}
						<g transform="translate(0, 56)">
							<path
								d="M0,7 C-4,1 -10,3 -10,8 C-10,13 -2,17 0,20 C2,17 10,13 10,8 C10,3 4,1 0,7 Z"
								fill="#ffffff"
								fillOpacity="0.9"
							/>
							<text x="0" y="29" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="600">
								124K
							</text>
						</g>

						{/* Comment Bubble Icon */}
						<g transform="translate(0, 102)">
							<path
								d="M-8,-4 C-8,-9 8,-9 8,-4 C8,1 -1,1 -3,4 L-4,6 L-4,4 C-7,4 -8,2 -8,-4 Z"
								fill="#ffffff"
								fillOpacity="0.9"
							/>
							<text x="0" y="15" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="600">
								1.8K
							</text>
						</g>

						{/* Bookmark Icon */}
						<g transform="translate(0, 134)">
							<path d="M-6,-6 L6,-6 L6,6 L0,2 L-6,6 Z" fill="#ffffff" fillOpacity="0.9" />
							<text x="0" y="14" textAnchor="middle" fill="#ffffff" fontSize="9" fontWeight="600">
								3.2K
							</text>
						</g>

						{/* Share Arrow Icon */}
						<g transform="translate(0, 164)">
							<path
								d="M-6,0 L2,-6 L2,-2 C6,-2 8,2 8,6 C6,4 4,3 2,3 L2,6 Z"
								fill="#ffffff"
								fillOpacity="0.9"
							/>
							<text x="0" y="14" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="600">
								Share
							</text>
						</g>

						{/* Music Disc Icon */}
						<g transform="translate(0, 196)">
							<circle cx="0" cy="0" r="10" fill="#0f172a" stroke="#ffffff" strokeWidth="1.5" />
							<circle cx="0" cy="0" r="3" fill="#64748b" />
						</g>
					</g>

					{/* Bottom Caption Danger Zone */}
					<rect
						x={social.bottomCaption.x}
						y={social.bottomCaption.y}
						width={social.bottomCaption.width}
						height={social.bottomCaption.height}
						fill="#ef4444"
						fillOpacity="0.12"
						stroke="#ef4444"
						strokeWidth="1"
						strokeDasharray="3 3"
						strokeOpacity="0.5"
					/>
					<g
						transform={`translate(${social.bottomCaption.x + 8}, ${social.bottomCaption.y + 16})`}
						filter="url(#guide-shadow)"
					>
						<text
							x="0"
							y="0"
							fill="#ffffff"
							fontSize="10"
							fontWeight="700"
							fontFamily="system-ui, -apple-system, sans-serif"
						>
							@creator_handle
						</text>
						<text
							x="0"
							y="14"
							fill="#ffffff"
							fontSize="9"
							fillOpacity="0.85"
							fontFamily="system-ui, -apple-system, sans-serif"
						>
							Engaging video caption and title tags #video #edit…
						</text>
						<g transform="translate(0, 26)">
							<text x="0" y="0" fill="#ffffff" fontSize="9" fillOpacity="0.8">
								🎵 Original Sound - Trending Audio
							</text>
						</g>
					</g>

					{/* Bottom Navigation & Progress Bar Zone */}
					<rect
						x={social.bottomNav.x}
						y={social.bottomNav.y}
						width={social.bottomNav.width}
						height={social.bottomNav.height}
						fill="#ef4444"
						fillOpacity="0.15"
					/>
					{/* Progress bar line */}
					<line
						x1={social.bottomNav.x}
						y1={social.bottomNav.y + 2}
						x2={social.bottomNav.x + social.bottomNav.width}
						y2={social.bottomNav.y + 2}
						stroke="#ffffff"
						strokeWidth="2"
						strokeOpacity="0.8"
					/>

					{/* Content Safe Zone Box (Clear for Titles, Faces & Captions) */}
					<rect
						x={social.safeContent.x}
						y={social.safeContent.y}
						width={social.safeContent.width}
						height={social.safeContent.height}
						fill="none"
						stroke="#22c55e"
						strokeWidth="1.5"
						strokeDasharray="5 3"
						filter="url(#guide-shadow)"
					/>
					<text
						x={social.safeContent.x + 6}
						y={social.safeContent.y + 13}
						fill="#22c55e"
						fontSize="9"
						fontWeight="700"
						fontFamily="system-ui, -apple-system, sans-serif"
						filter="url(#social-badge-shadow)"
					>
						SAFE ZONE FOR CAPTIONS & TITLES
					</text>
				</g>
			)}
		</svg>
	);
}
