import {
	Fragment,
	useEffect,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent,
	type ReactNode
} from 'react';
import type { LayoutNode, LayoutSplitNode, LayoutStackNode, PanelId } from './types';
import { collectPanels, resizeSplit } from './operations';
import { PANEL_REGISTRY } from './registry';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import './workspace-layout.css';

interface WorkspaceShellProps {
	layout: LayoutNode;
	onLayoutChange: (newLayout: LayoutNode) => void;
	/** Map of renderers for keepAlive components (program, timeline) */
	keepAliveSlots: {
		program: ReactNode;
		timeline: ReactNode;
	};
	renderPanel?: (panelId: PanelId) => ReactNode;
	maximizedPanelId?: PanelId | null;
	onToggleMaximize?: (panelId: PanelId) => void;
	onClosePanel?: (panelId: PanelId) => void;
}

export default function WorkspaceShell({
	layout,
	onLayoutChange,
	keepAliveSlots,
	renderPanel,
	maximizedPanelId,
	onToggleMaximize,
	onClosePanel
}: WorkspaceShellProps) {
	const store = useEditorStoreApi();
	const scopesOpen = useEditorStore((state) => state.scopes.open);
	const visiblePanels = collectPanels(layout);
	const isProgramInLayout = visiblePanels.includes('program');
	const isTimelineInLayout = visiblePanels.includes('timeline');

	const programVaultRef = useRef<HTMLDivElement>(null);
	const timelineVaultRef = useRef<HTMLDivElement>(null);

	// Ensure persistent keepAlive DOM nodes are mounted once and reparented cleanly to whichever slot is active
	useEffect(() => {
		const programEl = programVaultRef.current;
		const timelineEl = timelineVaultRef.current;

		try {
			if (programEl) {
				const target = document.querySelector<HTMLDivElement>('.keepalive-target-program');
				if (target && isProgramInLayout && (!maximizedPanelId || maximizedPanelId === 'program')) {
					if (programEl.parentElement !== target) {
						target.appendChild(programEl);
					}
				} else {
					const fallback = document.querySelector<HTMLDivElement>('.keepalive-hidden-vault');
					if (fallback && programEl.parentElement !== fallback) {
						fallback.appendChild(programEl);
					}
				}
			}

			if (timelineEl) {
				const target = document.querySelector<HTMLDivElement>('.keepalive-target-timeline');
				if (
					target &&
					isTimelineInLayout &&
					(!maximizedPanelId || maximizedPanelId === 'timeline')
				) {
					if (timelineEl.parentElement !== target) {
						target.appendChild(timelineEl);
					}
				} else {
					const fallback = document.querySelector<HTMLDivElement>('.keepalive-hidden-vault');
					if (fallback && timelineEl.parentElement !== fallback) {
						fallback.appendChild(timelineEl);
					}
				}
			}
		} catch {
			// Ignore DOM reparenting race conditions
		}
	}, [layout, maximizedPanelId, isProgramInLayout, isTimelineInLayout]);

	// If a panel is maximized, render just that panel
	if (maximizedPanelId) {
		const def = PANEL_REGISTRY[maximizedPanelId];
		const isMaxTimeline = maximizedPanelId === 'timeline';
		return (
			<div
				className="workspace-shell-container workspace-root--maximized"
				data-testid="workspace-shell"
				translate="no"
			>
				<div className={`layout-stack is-maximized ${isMaxTimeline ? 'is-single-timeline' : ''}`}>
					<div className="layout-stack-header">
						<div className="layout-tablist" role="tablist">
							{maximizedPanelId === 'source' ? (
								<>
									<button
										type="button"
										role="tab"
										aria-selected={!scopesOpen}
										className={`layout-tab ${!scopesOpen ? 'is-active' : ''}`}
										onClick={() => store.getState().setScopesOpen(false)}
										data-testid="tab-source"
									>
										Source Media
									</button>
									<button
										type="button"
										role="tab"
										aria-selected={scopesOpen}
										className={`layout-tab ${scopesOpen ? 'is-active' : ''}`}
										onClick={() => store.getState().setScopesOpen(true)}
										data-testid="tab-scopes"
									>
										Scopes
									</button>
								</>
							) : (
								<span className="layout-tab is-active" role="tab" aria-selected="true">
									{def?.title ?? maximizedPanelId}
								</span>
							)}
						</div>
						<div className="layout-stack-actions">
							<button
								type="button"
								className="layout-header-btn"
								title="Restore"
								onClick={() => onToggleMaximize?.(maximizedPanelId)}
							>
								Restore
							</button>
						</div>
					</div>
					<div className="layout-stack-content">
						{maximizedPanelId === 'program' ? (
							<div className="keepalive-slot keepalive-target-program" />
						) : maximizedPanelId === 'timeline' ? (
							<div className="keepalive-slot keepalive-target-timeline" />
						) : renderPanel ? (
							renderPanel(maximizedPanelId)
						) : (
							def && <def.component />
						)}
					</div>
				</div>

				{/* Keep alive persistent vaults so GL context / engine are never unmounted */}
				<div className="keepalive-hidden-vault" aria-hidden="true">
					<div
						ref={programVaultRef}
						className="keepalive-persistent-mount"
						style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
					>
						{keepAliveSlots.program}
					</div>
					<div
						ref={timelineVaultRef}
						className="keepalive-persistent-mount"
						style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
					>
						{keepAliveSlots.timeline}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="workspace-shell-container" data-testid="workspace-shell" translate="no">
			<LayoutNodeRenderer
				node={layout}
				onNodeChange={onLayoutChange}
				keepAliveSlots={keepAliveSlots}
				renderPanel={renderPanel}
				onToggleMaximize={onToggleMaximize}
				onClosePanel={onClosePanel}
			/>

			{/* Keep alive persistent vaults so GL context / engine are never unmounted */}
			<div className="keepalive-hidden-vault" aria-hidden="true">
				<div
					ref={programVaultRef}
					className="keepalive-persistent-mount"
					style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
				>
					{keepAliveSlots.program}
				</div>
				<div
					ref={timelineVaultRef}
					className="keepalive-persistent-mount"
					style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}
				>
					{keepAliveSlots.timeline}
				</div>
			</div>
		</div>
	);
}

function LayoutNodeRenderer({
	node,
	onNodeChange,
	keepAliveSlots,
	renderPanel,
	onToggleMaximize,
	onClosePanel
}: {
	node: LayoutNode;
	onNodeChange: (newNode: LayoutNode) => void;
	keepAliveSlots: { program: ReactNode; timeline: ReactNode };
	renderPanel?: (panelId: PanelId) => ReactNode;
	onToggleMaximize?: (panelId: PanelId) => void;
	onClosePanel?: (panelId: PanelId) => void;
}) {
	if (node.type === 'stack') {
		return (
			<StackRenderer
				node={node}
				onNodeChange={onNodeChange}
				renderPanel={renderPanel}
				onToggleMaximize={onToggleMaximize}
				onClosePanel={onClosePanel}
			/>
		);
	}

	return (
		<SplitRenderer
			node={node}
			onNodeChange={onNodeChange}
			keepAliveSlots={keepAliveSlots}
			renderPanel={renderPanel}
			onToggleMaximize={onToggleMaximize}
			onClosePanel={onClosePanel}
		/>
	);
}

function SplitRenderer({
	node,
	onNodeChange,
	keepAliveSlots,
	renderPanel,
	onToggleMaximize,
	onClosePanel
}: {
	node: LayoutSplitNode;
	onNodeChange: (newNode: LayoutNode) => void;
	keepAliveSlots: { program: ReactNode; timeline: ReactNode };
	renderPanel?: (panelId: PanelId) => ReactNode;
	onToggleMaximize?: (panelId: PanelId) => void;
	onClosePanel?: (panelId: PanelId) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);

	const handleChildChange = (index: number, newChild: LayoutNode) => {
		const newChildren = [...node.children];
		newChildren[index] = newChild;
		onNodeChange({ ...node, children: newChildren });
	};

	const handleSplitResize = (index: number, delta: number) => {
		const container = containerRef.current;
		if (!container) return;
		const totalPixels =
			node.direction === 'horizontal' ? container.clientWidth : container.clientHeight;
		const updated = resizeSplit(node, index, delta, totalPixels, 160);
		onNodeChange(updated);
	};

	const childPanels = collectPanels(node);
	const isMonitorSplit =
		childPanels.length > 0 &&
		childPanels.includes('program') &&
		childPanels.every((p) => p === 'source' || p === 'program');

	return (
		<div
			ref={containerRef}
			className={`layout-split is-${node.direction} ${isMonitorSplit ? 'monitor-panel' : ''}`}
			style={{ width: '100%', height: '100%' }}
		>
			{node.children.map((child, idx) => {
				const sizePct = node.sizes[idx] ?? 100 / node.children.length;
				const style: CSSProperties = {
					flex: `${sizePct} 1 0%`,
					minWidth: 0,
					minHeight: 0
				};

				const childPanelsSub = collectPanels(child);
				const hasMedia = childPanelsSub.includes('media');
				const hasInspector = childPanelsSub.includes('inspector');
				const hasMonitorsSub =
					childPanelsSub.includes('program') || childPanelsSub.includes('source');
				const isSourceOnly = childPanelsSub.length === 1 && childPanelsSub[0] === 'source';
				const hasProgram = childPanelsSub.includes('program');
				const hasColor = childPanelsSub.includes('color');
				const hasEffects = childPanelsSub.includes('effects');
				const hasMixer = childPanelsSub.includes('mixer');
				const hasCaptions =
					childPanelsSub.includes('captions') || childPanelsSub.includes('auto-caption');

				return (
					<div key={idx} style={{ display: 'contents' }}>
						<div
							className={`layout-split-child ${hasMedia ? 'has-media-panel' : ''} ${hasInspector ? 'has-inspector-panel' : ''} ${hasMonitorsSub ? 'has-monitors' : ''} ${isSourceOnly ? 'has-source-monitor' : ''} ${hasProgram ? 'has-program-monitor' : ''} ${hasColor ? 'has-color-panel' : ''} ${hasEffects ? 'has-effects-panel' : ''} ${hasMixer ? 'has-mixer-panel' : ''} ${hasCaptions ? 'has-captions-panel' : ''}`}
							style={style}
						>
							<LayoutNodeRenderer
								node={child}
								onNodeChange={(newChild) => handleChildChange(idx, newChild)}
								keepAliveSlots={keepAliveSlots}
								renderPanel={renderPanel}
								onToggleMaximize={onToggleMaximize}
								onClosePanel={onClosePanel}
							/>
						</div>
						{idx < node.children.length - 1 && (
							<SplitterHandle
								direction={node.direction}
								sizeValue={Math.round(sizePct)}
								onResize={(delta) => handleSplitResize(idx, delta)}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
}

function SplitterHandle({
	direction,
	sizeValue,
	onResize
}: {
	direction: 'horizontal' | 'vertical';
	sizeValue: number;
	onResize: (delta: number) => void;
}) {
	const draggingRef = useRef(false);
	const startPosRef = useRef(0);
	const [isDragging, setIsDragging] = useState(false);

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		draggingRef.current = true;
		setIsDragging(true);
		startPosRef.current = direction === 'horizontal' ? e.clientX : e.clientY;
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current) return;
		const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;
		const delta = currentPos - startPosRef.current;
		startPosRef.current = currentPos;
		onResize(delta);
	};

	const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
		draggingRef.current = false;
		setIsDragging(false);
		try {
			e.currentTarget.releasePointerCapture(e.pointerId);
		} catch {}
	};

	const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
		const step = e.shiftKey ? 20 : 6;
		if (direction === 'horizontal') {
			if (e.key === 'ArrowLeft') {
				e.preventDefault();
				onResize(-step);
			} else if (e.key === 'ArrowRight') {
				e.preventDefault();
				onResize(step);
			}
		} else {
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				onResize(-step);
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				onResize(step);
			}
		}
	};

	return (
		<div
			className={`layout-splitter is-${direction} ${isDragging ? 'is-active' : ''}`}
			role="separator"
			tabIndex={0}
			aria-orientation={direction}
			aria-valuenow={sizeValue}
			aria-label={`Resize split ${direction}`}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerUp}
			onKeyDown={onKeyDown}
		>
			<span className="layout-splitter-dots" aria-hidden="true">
				<span className="layout-splitter-dot" />
				<span className="layout-splitter-dot" />
				<span className="layout-splitter-dot" />
			</span>
		</div>
	);
}

function StackRenderer({
	node,
	onNodeChange,
	renderPanel,
	onToggleMaximize,
	onClosePanel
}: {
	node: LayoutStackNode;
	onNodeChange: (newNode: LayoutNode) => void;
	renderPanel?: (panelId: PanelId) => ReactNode;
	onToggleMaximize?: (panelId: PanelId) => void;
	onClosePanel?: (panelId: PanelId) => void;
}) {
	const store = useEditorStoreApi();
	const scopesOpen = useEditorStore((state) => state.scopes.open);
	const activePanel = node.activeId;
	const activeDef =
		PANEL_REGISTRY[activePanel] ||
		PANEL_REGISTRY[node.panelIds.find((id) => !!PANEL_REGISTRY[id]) ?? 'media'];

	const handleSelectTab = (panelId: PanelId) => {
		onNodeChange({ ...node, activeId: panelId });
	};

	const onTabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			const next = (currentIndex + 1) % node.panelIds.length;
			handleSelectTab(node.panelIds[next]!);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			const prev = (currentIndex - 1 + node.panelIds.length) % node.panelIds.length;
			handleSelectTab(node.panelIds[prev]!);
		} else if (e.key === 'Home') {
			e.preventDefault();
			handleSelectTab(node.panelIds[0]!);
		} else if (e.key === 'End') {
			e.preventDefault();
			handleSelectTab(node.panelIds[node.panelIds.length - 1]!);
		}
	};

	const canClose = activePanel !== 'program' && activePanel !== 'timeline';
	const isSingleTimeline = node.panelIds.length === 1 && node.panelIds[0] === 'timeline';

	return (
		<div
			className={`layout-stack ${isSingleTimeline ? 'is-single-timeline' : ''}`}
			data-testid={`stack-${activePanel}`}
		>
			<div className="layout-stack-header">
				<div className="layout-tablist" role="tablist" aria-label="Panel tabs">
					{node.panelIds.map((panelId, idx) => {
						const def = PANEL_REGISTRY[panelId];
						if (!def) return null;
						const isActive = panelId === activePanel;

						if (panelId === 'source') {
							const isSourceMediaActive = isActive && !scopesOpen;
							const isScopesActive = isActive && scopesOpen;

							return (
								<Fragment key={panelId}>
									<button
										id="source-panel-title"
										type="button"
										role="tab"
										aria-selected={isSourceMediaActive}
										className={`layout-tab ${isSourceMediaActive ? 'is-active' : ''}`}
										tabIndex={isSourceMediaActive ? 0 : -1}
										onClick={() => {
											handleSelectTab('source');
											store.getState().setScopesOpen(false);
										}}
										onKeyDown={(e) => {
											if (e.key === 'ArrowRight') {
												e.preventDefault();
												handleSelectTab('source');
												store.getState().setScopesOpen(true);
											} else if (e.key === 'ArrowLeft') {
												e.preventDefault();
												const prev = (idx - 1 + node.panelIds.length) % node.panelIds.length;
												handleSelectTab(node.panelIds[prev]!);
											} else {
												onTabKeyDown(e, idx);
											}
										}}
										data-testid="tab-source"
									>
										Source Media
									</button>
									<button
										id="scopes-panel-title"
										type="button"
										role="tab"
										aria-selected={isScopesActive}
										className={`layout-tab ${isScopesActive ? 'is-active' : ''}`}
										tabIndex={isScopesActive ? 0 : -1}
										onClick={() => {
											handleSelectTab('source');
											store.getState().setScopesOpen(true);
										}}
										onKeyDown={(e) => {
											if (e.key === 'ArrowLeft') {
												e.preventDefault();
												handleSelectTab('source');
												store.getState().setScopesOpen(false);
											} else if (e.key === 'ArrowRight') {
												e.preventDefault();
												const next = (idx + 1) % node.panelIds.length;
												handleSelectTab(node.panelIds[next]!);
											} else {
												onTabKeyDown(e, idx);
											}
										}}
										data-testid="tab-scopes"
									>
										Scopes
									</button>
								</Fragment>
							);
						}

						const tabId =
							panelId === 'media'
								? 'project-panel-title'
								: panelId === 'effects'
									? 'effects-panel-title'
									: panelId === 'captions'
										? 'captions-panel-title'
										: panelId === 'graphics'
											? 'graphics-panel-title'
											: panelId === 'shapes'
												? 'shapes-panel-title'
												: panelId === 'inspector'
													? 'inspector-title'
													: panelId === 'color'
														? 'color-panel-title'
														: panelId === 'ai-assistant'
															? 'ai-assistant-panel-title'
															: panelId === 'auto-caption'
																? 'auto-caption-panel-title'
																: undefined;

						return (
							<button
								key={panelId}
								id={tabId}
								type="button"
								role="tab"
								aria-selected={isActive}
								className={`layout-tab ${isActive ? 'is-active' : ''}`}
								tabIndex={isActive ? 0 : -1}
								onClick={() => handleSelectTab(panelId)}
								onKeyDown={(e) => onTabKeyDown(e, idx)}
								data-testid={`tab-${panelId}`}
							>
								{def?.title ?? panelId}
							</button>
						);
					})}
				</div>
				<div className="layout-stack-actions">
					<button
						type="button"
						className="layout-header-btn"
						title="Maximize panel"
						aria-label={`Maximize ${activeDef?.title ?? activePanel}`}
						onClick={() => onToggleMaximize?.(activePanel)}
					>
						⤢
					</button>
					{canClose && (
						<button
							type="button"
							className="layout-header-btn"
							title="Close panel"
							aria-label={`Close ${activeDef?.title ?? activePanel}`}
							onClick={() => onClosePanel?.(activePanel)}
						>
							✕
						</button>
					)}
				</div>
			</div>

			<div className="layout-stack-content">
				{node.panelIds.map((panelId) => {
					const isActive = panelId === activePanel;
					const isKeepAlive = panelId === 'program' || panelId === 'timeline';

					if (!isActive && !isKeepAlive) {
						return null;
					}

					const panelStyle: CSSProperties = isActive
						? { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }
						: { display: 'none' };

					const panelClassMap: Record<PanelId, string> = {
						media: 'media-panel',
						effects: 'effects-panel',
						captions: 'captions-panel',
						graphics: 'graphics-panel',
						shapes: 'shapes-panel',
						source: 'source-panel',
						program: 'program-panel',
						inspector: 'inspector-panel',
						color: 'color-panel',
						mixer: 'mixer-panel',
						loudness: 'loudness-panel',
						'essential-sound': 'essential-sound-panel',
						'effect-controls-audio': 'effect-controls-audio-panel',
						timeline: 'timeline-panel',
						graph: 'graph-panel',
						'ai-assistant': 'ai-assistant-panel',
						'auto-caption': 'auto-caption-panel'
					};

					const Tag =
						panelId === 'timeline' || panelId === 'media'
							? 'section'
							: panelId === 'inspector'
								? 'aside'
								: 'div';
					const ariaLabelledby =
						panelId === 'timeline'
							? 'timeline-title'
							: panelId === 'media'
								? 'project-panel-title'
								: panelId === 'inspector'
									? 'inspector-title'
									: undefined;

					return (
						<Tag
							key={panelId}
							id={
								panelId === 'media'
									? 'media-panel'
									: panelId === 'inspector'
										? 'inspector-panel'
										: panelId === 'timeline'
											? 'timeline-panel'
											: undefined
							}
							className={`layout-panel-body ${panelClassMap[panelId] ?? ''}`}
							style={panelStyle}
							aria-hidden={!isActive}
							aria-labelledby={ariaLabelledby}
						>
							{panelId === 'timeline' && (
								<h2 id="timeline-title" className="sr-only">
									Timeline
								</h2>
							)}
							{panelId === 'media' && (
								<h2 id="project-panel-title" className="sr-only">
									Project
								</h2>
							)}
							{panelId === 'inspector' && (
								<h2 id="inspector-title" className="sr-only">
									Properties
								</h2>
							)}
							{panelId === 'program' ? (
								<div className="keepalive-slot keepalive-target-program monitor-program" />
							) : panelId === 'timeline' ? (
								<div className="keepalive-slot keepalive-target-timeline" />
							) : panelId === 'source' ? (
								<div
									className="monitor monitor-source"
									style={{
										width: '100%',
										height: '100%',
										display: 'flex',
										flexDirection: 'column'
									}}
								>
									{renderPanel
										? renderPanel(panelId)
										: (() => {
												const Comp = PANEL_REGISTRY[panelId]?.component;
												return Comp ? <Comp /> : null;
											})()}
								</div>
							) : (
								(() => {
									const customRender = renderPanel ? renderPanel(panelId) : undefined;
									if (customRender !== undefined && customRender !== null) return customRender;
									const Comp = PANEL_REGISTRY[panelId]?.component;
									return Comp ? <Comp /> : null;
								})()
							)}
						</Tag>
					);
				})}
			</div>
		</div>
	);
}
