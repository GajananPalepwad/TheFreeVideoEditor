import { useState, useRef, useMemo, useEffect } from 'react';
import type { AssetId, Clip, EffectInstance } from '../../core';
import type { CurvePoint } from '../../core/curves';
import { evaluateSpline } from '../../core/curves';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import {
	ensureLutLoaded,
	ensureBuiltinLutLoaded,
	getParsedLut,
	isBuiltinLutId,
	BUILTIN_LUTS,
	findBuiltinLut
} from '../../services/media/lutCache';
import { trackFeatureUsed } from '../../../services/activityTracking';
import './color.css';

function getNumericParam(val: unknown, fallback = 1): number {
	if (typeof val === 'number' && !Number.isNaN(val)) return val;
	if (val && typeof val === 'object' && 'value' in val) {
		const inner = (val as { value: unknown }).value;
		if (typeof inner === 'number' && !Number.isNaN(inner)) return inner;
	}
	return fallback;
}

export default function ColorPanel() {
	const store = useEditorStoreApi();
	const project = useEditorStore((state) => state.project);
	const activeTab = useEditorStore((state) => state.colorUi.activeTab);
	const selectedClipIds = useEditorStore((state) => state.timeline.selection.clipIds);

	const [curveChannel, setCurveChannel] = useState<'master' | 'red' | 'green' | 'blue'>('master');
	const [lutError, setLutError] = useState<string | null>(null);
	const [isLutDragOver, setIsLutDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const selectedClip: Clip | null =
		project && selectedClipIds.length === 1
			? (project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipIds[0]) ?? null)
			: null;

	const ccEffect = (selectedClip?.effects ?? []).find((e) => e.type === 'colorCorrection');
	const curvesEffect = (selectedClip?.effects ?? []).find((e) => e.type === 'curves');
	const lutEffect = (selectedClip?.effects ?? []).find((e) => e.type === 'lut3d');

	const paramKeyForCurve = {
		master: 'rgb',
		red: 'red',
		green: 'green',
		blue: 'blue'
	}[curveChannel];

	const currentPoints: CurvePoint[] = useMemo(() => {
		const raw = curvesEffect?.params[paramKeyForCurve];
		if (Array.isArray(raw) && raw.length >= 2) return raw as unknown as CurvePoint[];
		return [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 }
		];
	}, [curvesEffect, paramKeyForCurve]);

	// LUT helpers
	const currentLutId = (lutEffect?.params.lutAssetId as string) || '';
	const selectedBuiltinLut = findBuiltinLut(currentLutId);

	useEffect(() => {
		if (currentLutId && isBuiltinLutId(currentLutId) && !getParsedLut(currentLutId)) {
			void ensureBuiltinLutLoaded(currentLutId);
		}
	}, [currentLutId]);

	if (!project || !selectedClip) {
		return (
			<div className="color-panel">
				<div className="effects-empty">Select a single clip in the timeline to grade color.</div>
			</div>
		);
	}

	// Helper to set a param on the active colorCorrection effect
	const setCcParam = (paramName: string, value: number) => {
		trackFeatureUsed('color_grading');
		const eff = ccEffect ?? store.getState().ensureColorCorrection(selectedClip.id);
		if (!eff) return;
		store.getState().setEffectParam(selectedClip.id, eff.id, paramName, value, { autoKey: true });
	};

	// Helper to get raw param value
	const getCcParam = (paramName: string, fallback: number): number => {
		if (!ccEffect) return fallback;
		const raw = ccEffect.params[paramName];
		if (typeof raw === 'number') return raw;
		if (typeof raw === 'object' && raw !== null && 'value' in raw) {
			return Number((raw as { value: unknown }).value);
		}
		return fallback;
	};

	// Curves helpers
	const ensureCurvesEffect = (): EffectInstance | null => {
		if (curvesEffect) return curvesEffect;
		return store.getState().addEffect(selectedClip.id, 'curves', undefined, { revealInspector: false });
	};

	const updateCurvePoints = (newPoints: CurvePoint[]) => {
		const eff = ensureCurvesEffect();
		if (!eff) return;
		const sorted = [...newPoints].sort((a, b) => a.x - b.x);
		store.getState().setEffectParam(selectedClip.id, eff.id, paramKeyForCurve, sorted);
	};

	const handleSelectLut = (assetId: string) => {
		if (!selectedClip) return;
		const eff =
			lutEffect ??
			(assetId
				? store.getState().addEffect(selectedClip.id, 'lut3d', undefined, { revealInspector: false })
				: null);
		if (eff) {
			store.getState().setEffectParam(selectedClip.id, eff.id, 'lutAssetId', assetId);
			if (assetId) {
				if (isBuiltinLutId(assetId)) {
					void ensureBuiltinLutLoaded(assetId);
				} else {
					const asset = project.assets[assetId as AssetId];
					if (asset) {
						void ensureLutLoaded(project.id, asset);
					}
				}
			}
		}
	};

	const handleImportLutFile = async (file: File) => {
		setLutError(null);
		try {
			const text = await file.text();
			const assetId = await store.getState().importLut(file.name, text);
			if (assetId) {
				const eff =
					lutEffect ??
					store.getState().addEffect(selectedClip.id, 'lut3d', undefined, { revealInspector: false });
				if (eff) {
					store.getState().setEffectParam(selectedClip.id, eff.id, 'lutAssetId', assetId);
				}
			} else {
				setLutError(store.getState().projectMessage || 'Could not parse LUT file.');
			}
		} catch (err: unknown) {
			setLutError(err instanceof Error ? err.message : 'Could not parse LUT file.');
		}
	};

	const lutAssets = Object.values(project.assets).filter((a) => a.kind === 'lut');

	return (
		<div className="color-panel" aria-label="Color Grading Panel">
			<div className="color-panel-tabs" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === 'basic'}
					className={`color-tab-btn ${activeTab === 'basic' ? 'is-active' : ''}`}
					onClick={() => store.getState().setColorTab('basic')}
				>
					Basic
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === 'curves'}
					className={`color-tab-btn ${activeTab === 'curves' ? 'is-active' : ''}`}
					onClick={() => store.getState().setColorTab('curves')}
				>
					Curves
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === 'wheels'}
					className={`color-tab-btn ${activeTab === 'wheels' ? 'is-active' : ''}`}
					onClick={() => store.getState().setColorTab('wheels')}
				>
					Wheels
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={activeTab === 'lut'}
					className={`color-tab-btn ${activeTab === 'lut' ? 'is-active' : ''}`}
					onClick={() => store.getState().setColorTab('lut')}
				>
					LUT
				</button>
			</div>

			<div className="color-tab-content">
				{activeTab === 'basic' && (
					<div className="basic-tab">
						<ColorSlider
							label="Temperature"
							value={getCcParam('temperature', 0)}
							min={-1}
							max={1}
							step={0.01}
							defaultValue={0}
							onChange={(v) => setCcParam('temperature', v)}
						/>
						<ColorSlider
							label="Tint"
							value={getCcParam('tint', 0)}
							min={-1}
							max={1}
							step={0.01}
							defaultValue={0}
							onChange={(v) => setCcParam('tint', v)}
						/>
						<ColorSlider
							label="Exposure"
							value={getCcParam('exposure', 0)}
							min={-5}
							max={5}
							step={0.05}
							defaultValue={0}
							unit="EV"
							onChange={(v) => setCcParam('exposure', v)}
						/>
						<ColorSlider
							label="Contrast"
							value={getCcParam('contrast', 0)}
							min={-1}
							max={1}
							step={0.01}
							defaultValue={0}
							onChange={(v) => setCcParam('contrast', v)}
						/>
						<ColorSlider
							label="Highlights"
							value={getCcParam('highlights', 0)}
							min={-1}
							max={1}
							step={0.01}
							defaultValue={0}
							onChange={(v) => setCcParam('highlights', v)}
						/>
						<ColorSlider
							label="Shadows"
							value={getCcParam('shadows', 0)}
							min={-1}
							max={1}
							step={0.01}
							defaultValue={0}
							onChange={(v) => setCcParam('shadows', v)}
						/>
						<ColorSlider
							label="Whites"
							value={getCcParam('whites', 0)}
							min={-1}
							max={1}
							step={0.01}
							defaultValue={0}
							onChange={(v) => setCcParam('whites', v)}
						/>
						<ColorSlider
							label="Blacks"
							value={getCcParam('blacks', 0)}
							min={-1}
							max={1}
							step={0.01}
							defaultValue={0}
							onChange={(v) => setCcParam('blacks', v)}
						/>
						<ColorSlider
							label="Saturation"
							value={getCcParam('saturation', 1)}
							min={0}
							max={2}
							step={0.01}
							defaultValue={1}
							unit="×"
							onChange={(v) => setCcParam('saturation', v)}
						/>
						<ColorSlider
							label="Vibrance"
							value={getCcParam('vibrance', 0)}
							min={-1}
							max={1}
							step={0.01}
							defaultValue={0}
							onChange={(v) => setCcParam('vibrance', v)}
						/>
					</div>
				)}

				{activeTab === 'curves' && (
					<div className="curves-container">
						<div className="curves-channel-tabs">
							{(['master', 'red', 'green', 'blue'] as const).map((ch) => (
								<button
									key={ch}
									type="button"
									className={`curves-channel-btn is-${ch} ${curveChannel === ch ? 'is-active' : ''}`}
									onClick={() => setCurveChannel(ch)}
								>
									{ch.charAt(0).toUpperCase() + ch.slice(1)}
								</button>
							))}
						</div>

						<CurveEditor
							points={currentPoints}
							channel={curveChannel}
							onChange={updateCurvePoints}
						/>

						<p className="curves-help-text">
							Click line to add point. Double-click point to remove.
						</p>
					</div>
				)}

				{activeTab === 'wheels' && (
					<div className="wheels-grid">
						<ColorWheel
							title="Lift (Shadows)"
							r={getCcParam('liftR', 0)}
							g={getCcParam('liftG', 0)}
							b={getCcParam('liftB', 0)}
							onChange={(r, g, b) => {
								setCcParam('liftR', r);
								setCcParam('liftG', g);
								setCcParam('liftB', b);
							}}
						/>
						<ColorWheel
							title="Gamma (Midtones)"
							r={getCcParam('gammaR', 0)}
							g={getCcParam('gammaG', 0)}
							b={getCcParam('gammaB', 0)}
							onChange={(r, g, b) => {
								setCcParam('gammaR', r);
								setCcParam('gammaG', g);
								setCcParam('gammaB', b);
							}}
						/>
						<ColorWheel
							title="Gain (Highlights)"
							r={getCcParam('gainR', 0)}
							g={getCcParam('gainG', 0)}
							b={getCcParam('gainB', 0)}
							onChange={(r, g, b) => {
								setCcParam('gainR', r);
								setCcParam('gainG', g);
								setCcParam('gainB', b);
							}}
						/>
					</div>
				)}

				{activeTab === 'lut' && (
					<div className="lut-container">
						<div className="lut-select-field">
							<span className="property-label">Select 3D LUT</span>
							<select
								className="lut-select"
								value={currentLutId}
								onChange={(e) => handleSelectLut(e.target.value)}
							>
								<option value="">(None)</option>
								<optgroup label="Preset LUTs">
									{BUILTIN_LUTS.map((lut) => (
										<option key={lut.id} value={lut.id}>
											{lut.name} ({lut.category})
										</option>
									))}
								</optgroup>
								{lutAssets.length > 0 && (
									<optgroup label="Project LUTs">
										{lutAssets.map((asset) => (
											<option key={asset.id} value={asset.id}>
												{asset.name}
											</option>
										))}
									</optgroup>
								)}
							</select>
						</div>

						{selectedBuiltinLut && (
							<div className="lut-builtin-info-card">
								<div className="lut-builtin-info-header">
									<span className="lut-builtin-info-title">{selectedBuiltinLut.name}</span>
									<span className="lut-builtin-info-badge">{selectedBuiltinLut.category}</span>
								</div>
								<p className="lut-builtin-info-desc">{selectedBuiltinLut.description}</p>
							</div>
						)}

						{lutEffect && currentLutId && (
							<ColorSlider
								label="LUT Intensity"
								value={getNumericParam(lutEffect.params.intensity ?? lutEffect.params.mix, 1)}
								min={0}
								max={1}
								step={0.01}
								defaultValue={1}
								onChange={(v) => {
									if (Number.isNaN(v)) return;
									store.getState().setEffectParam(selectedClip.id, lutEffect.id, 'intensity', v);
									store.getState().setEffectParam(selectedClip.id, lutEffect.id, 'mix', v);
								}}
							/>
						)}

						<div className="lut-presets-section">
							<span className="property-label">Preset Looks</span>
							<div className="lut-presets-grid">
								{BUILTIN_LUTS.map((lut) => {
									const isSelected = currentLutId === lut.id;
									return (
										<button
											key={lut.id}
											type="button"
											className={`lut-preset-btn ${isSelected ? 'is-active' : ''}`}
											onClick={() => handleSelectLut(isSelected ? '' : lut.id)}
											title={`${lut.name}: ${lut.description}`}
										>
											<span className="lut-preset-btn-name">{lut.name}</span>
											<span className="lut-preset-btn-tag">{lut.category}</span>
										</button>
									);
								})}
							</div>
						</div>

						<div
							className={`lut-dropzone ${isLutDragOver ? 'is-drag-over' : ''}`}
							onDragOver={(e) => {
								e.preventDefault();
								setIsLutDragOver(true);
							}}
							onDragLeave={() => setIsLutDragOver(false)}
							onDrop={(e) => {
								e.preventDefault();
								setIsLutDragOver(false);
								const file = e.dataTransfer.files[0];
								if (file) void handleImportLutFile(file);
							}}
							onClick={() => fileInputRef.current?.click()}
						>
							<span>Drop .cube file here or click to import</span>
							<input
								ref={fileInputRef}
								type="file"
								accept=".cube"
								style={{ display: 'none' }}
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) void handleImportLutFile(file);
								}}
							/>
						</div>

						{lutError && <div className="lut-error-msg">{lutError}</div>}
					</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------
// Sub-components
// ---------------------------------------------------------

interface ColorSliderProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	defaultValue?: number;
	unit?: string;
	onChange: (v: number) => void;
}

function ColorSlider({
	label,
	value,
	min,
	max,
	step,
	defaultValue = 0,
	unit = '',
	onChange
}: ColorSliderProps) {
	const safeValue = Number.isNaN(value) ? defaultValue : value;
	const isTemp = label === 'Temperature';
	const isTint = label === 'Tint';
	const rangeClass = isTemp
		? 'color-range-input color-range-temp'
		: isTint
			? 'color-range-input color-range-tint'
			: 'color-range-input';

	return (
		<div className="color-slider-row">
			<div className="color-slider-label">
				<span
					onDoubleClick={() => onChange(defaultValue)}
					title="Double-click to reset"
					style={{ cursor: 'pointer' }}
				>
					{label}
				</span>
				<span
					className="color-slider-val"
					onDoubleClick={() => onChange(defaultValue)}
					title="Double-click to reset"
					style={{ cursor: 'pointer' }}
				>
					{safeValue > 0 && !unit && '+'}
					{safeValue.toFixed(2)}
					{unit}
				</span>
			</div>
			<input
				type="range"
				className={rangeClass}
				min={min}
				max={max}
				step={step}
				value={safeValue}
				onChange={(e) => {
					const parsed = parseFloat(e.target.value);
					if (!Number.isNaN(parsed)) onChange(parsed);
				}}
				onDoubleClick={() => onChange(defaultValue)}
				title={`${label}: ${safeValue.toFixed(2)}${unit} (Double-click to reset)`}
			/>
		</div>
	);
}

interface CurveEditorProps {
	points: CurvePoint[];
	channel: 'master' | 'red' | 'green' | 'blue';
	onChange: (points: CurvePoint[]) => void;
}

function CurveEditor({ points, channel, onChange }: CurveEditorProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

	const channelColor = {
		master: 'var(--color-ink)',
		red: '#ef4444',
		green: '#22c55e',
		blue: '#3b82f6'
	}[channel];

	// Generate spline path pathData
	const pathData = useMemo(() => {
		const steps = 64;
		const d: string[] = [];
		for (let i = 0; i <= steps; i++) {
			const x = i / steps;
			const y = evaluateSpline(points, x);
			const svgX = x * 100;
			const svgY = (1 - y) * 100; // Invert Y
			if (i === 0) d.push(`M ${svgX} ${svgY}`);
			else d.push(`L ${svgX} ${svgY}`);
		}
		return d.join(' ');
	}, [points]);

	const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect) return;
		const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const ny = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));

		// Check if clicked near existing point
		const hitIdx = points.findIndex((p) => Math.hypot(p.x - nx, p.y - ny) < 0.08);
		if (hitIdx !== -1) {
			setDraggingIdx(hitIdx);
			(e.target as Element).setPointerCapture(e.pointerId);
		} else {
			// Add new point
			const newPoints = [...points, { x: nx, y: ny }].sort((a, b) => a.x - b.x);
			onChange(newPoints);
			const newIdx = newPoints.findIndex((p) => p.x === nx && p.y === ny);
			setDraggingIdx(newIdx);
			(e.target as Element).setPointerCapture(e.pointerId);
		}
	};

	const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
		if (draggingIdx === null) return;
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect) return;
		let nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const ny = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));

		// Keep endpoints pinned to x=0 and x=1
		if (draggingIdx === 0) nx = 0;
		if (draggingIdx === points.length - 1) nx = 1;

		const updated = points.map((p, i) => (i === draggingIdx ? { x: nx, y: ny } : p));
		onChange(updated);
	};

	const handlePointerUp = () => {
		setDraggingIdx(null);
	};

	const handleDoubleClick = (idx: number) => {
		if (idx === 0 || idx === points.length - 1) return; // Cannot delete endpoints
		const filtered = points.filter((_, i) => i !== idx);
		onChange(filtered);
	};

	return (
		<svg
			ref={svgRef}
			viewBox="0 0 100 100"
			className="curves-svg-box"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerUp}
		>
			{/* Grid lines */}
			<line x1="25" y1="0" x2="25" y2="100" className="curves-grid-line" />
			<line x1="50" y1="0" x2="50" y2="100" className="curves-grid-line" />
			<line x1="75" y1="0" x2="75" y2="100" className="curves-grid-line" />
			<line x1="0" y1="25" x2="100" y2="25" className="curves-grid-line" />
			<line x1="0" y1="50" x2="100" y2="50" className="curves-grid-line" />
			<line x1="0" y1="75" x2="100" y2="75" className="curves-grid-line" />

			{/* Diagonal identity line */}
			<line x1="0" y1="100" x2="100" y2="0" className="curves-diagonal-line" />

			{/* Spline curve path */}
			<path d={pathData} fill="none" className="curves-spline-path" stroke={channelColor} />

			{/* Control points */}
			{points.map((p, i) => (
				<circle
					key={i}
					cx={p.x * 100}
					cy={(1 - p.y) * 100}
					r="3.5"
					className="curves-control-point"
					fill={channelColor}
					onDoubleClick={(e) => {
						e.stopPropagation();
						handleDoubleClick(i);
					}}
				/>
			))}
		</svg>
	);
}

interface ColorWheelProps {
	title: string;
	r: number;
	g: number;
	b: number;
	onChange: (r: number, g: number, b: number) => void;
}

function ColorWheel({ title, r, g, b, onChange }: ColorWheelProps) {
	const svgRef = useRef<SVGSVGElement>(null);
	const [isDragging, setIsDragging] = useState(false);

	// Map RGB offsets to 2D disc coordinates (normalized [-1, 1])
	// With 3 color axes at 120° (Green at 90°/top, Red at -30°/bottom-right, Blue at 210°/bottom-left):
	// x = (r - b) * cos(30°) = (r - b) * 0.866
	// y = -g + 0.5 * (r + b)
	// Or directly tracking the puck vector:
	const discX = (r - b) * 0.57735; // (r - b) / sqrt(3)
	const discY = -(g - (r + b) * 0.5);

	const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
		setIsDragging(true);
		try {
			(e.target as Element).setPointerCapture(e.pointerId);
		} catch {
			// ignore
		}
		updateFromPointer(e);
	};

	const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
		if (!isDragging) return;
		updateFromPointer(e);
	};

	const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
		setIsDragging(false);
		try {
			(e.target as Element).releasePointerCapture(e.pointerId);
		} catch {
			// ignore
		}
	};

	const handleReset = () => {
		onChange(0, 0, 0); // Reset puck
	};

	const updateFromPointer = (e: React.PointerEvent<SVGSVGElement>) => {
		const rect = svgRef.current?.getBoundingClientRect();
		if (!rect) return;
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		// Active interactive radius inside SVG (up to 44px out of 50px SVG half-width)
		const radius = (rect.width / 2) * 0.88;

		let dx = (e.clientX - centerX) / radius;
		let dy = (e.clientY - centerY) / radius;
		const dist = Math.hypot(dx, dy);
		if (dist > 1) {
			dx /= dist;
			dy /= dist;
		}

		// Standard color grading wheel formula:
		// Top (dy < 0) adds Green / subtracts Magenta
		// Right / bottom-right (dx > 0) adds Red
		// Left / bottom-left (dx < 0) adds Blue
		// Angle measured clockwise from top (0 = Green, 120 = Red, 240 = Blue)
		const angleRad = Math.atan2(dx, -dy); // 0 at top (green), +pi/2 at right (yellow/red), -pi/2 at left (cyan/blue)
		const magnitude = Math.min(1, dist);

		// Projections onto the three 120° color axes:
		// Green axis: 0 rad (top) -> cos(angleRad)
		// Red axis: +2.0944 rad (120° = bottom right) -> cos(angleRad - 2π/3)
		// Blue axis: -2.0944 rad (240° = bottom left) -> cos(angleRad - 4π/3)
		const gVal = Math.cos(angleRad) * magnitude;
		const rVal = Math.cos(angleRad - (2 * Math.PI) / 3) * magnitude;
		const bVal = Math.cos(angleRad - (4 * Math.PI) / 3) * magnitude;

		onChange(
			Math.round(rVal * 100) / 100,
			Math.round(gVal * 100) / 100,
			Math.round(bVal * 100) / 100
		);
	};

	// Center point is 50, 50 in 100x100 viewBox; disk radius is 48, puck usable radius is 42
	// Normalize hypot(discX, discY) to max 1 for puck rendering
	const puckDist = Math.hypot(discX, discY);
	const normDist = puckDist > 1 ? 1 : puckDist;
	const puckAngle = Math.atan2(discY, discX);
	const puckSvgX = 50 + (puckDist > 0 ? Math.cos(puckAngle) * normDist * 42 : 0);
	const puckSvgY = 50 + (puckDist > 0 ? Math.sin(puckAngle) * normDist * 42 : 0);

	// Calculate dynamic tint color for the puck
	const pr = Math.round(Math.max(0, Math.min(255, 128 + r * 127)));
	const pg = Math.round(Math.max(0, Math.min(255, 128 + g * 127)));
	const pb = Math.round(Math.max(0, Math.min(255, 128 + b * 127)));
	const puckColor = `rgb(${pr}, ${pg}, ${pb})`;
	const isModified = Math.abs(r) > 0.001 || Math.abs(g) > 0.001 || Math.abs(b) > 0.001;

	return (
		<div className="wheel-card">
			<div className="wheel-header">
				<span className="wheel-title">{title}</span>
				{isModified && (
					<button
						type="button"
						className="wheel-reset-btn"
						title="Reset wheel to neutral"
						aria-label={`Reset ${title}`}
						onClick={handleReset}
					>
						<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor">
							<path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 1 0-.908-.418A4 4 0 1 1 8 4a3.97 3.97 0 0 1 2.828 1.172l-1.414 1.414H13V3.001l-1.464 1.464A4.975 4.975 0 0 0 8 3z" />
						</svg>
					</button>
				)}
			</div>
			<div className="wheel-disc-container">
				<svg
					ref={svgRef}
					viewBox="0 0 100 100"
					className="wheel-svg"
					onPointerDown={handlePointerDown}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
					onDoubleClick={handleReset}
					role="slider"
					aria-label={title}
					aria-valuenow={Math.round(Math.hypot(discX, discY) * 100)}
				>
					{/* Outer perimeter outline */}
					<circle
						cx="50"
						cy="50"
						r="48"
						fill="transparent"
						stroke="rgba(255, 255, 255, 0.14)"
						strokeWidth="1"
					/>
					{/* Crosshair guide lines */}
					<line
						x1="50"
						y1="4"
						x2="50"
						y2="96"
						stroke="rgba(255, 255, 255, 0.2)"
						strokeWidth="0.75"
						strokeDasharray="2 3"
					/>
					<line
						x1="4"
						y1="50"
						x2="96"
						y2="50"
						stroke="rgba(255, 255, 255, 0.2)"
						strokeWidth="0.75"
						strokeDasharray="2 3"
					/>
					{/* Neutral center deadzone circle */}
					<circle
						cx="50"
						cy="50"
						r="6"
						stroke="rgba(255, 255, 255, 0.3)"
						strokeWidth="0.75"
						fill="rgba(0, 0, 0, 0.35)"
					/>
					{/* Control Puck with dynamic color tint */}
					<circle
						cx={puckSvgX}
						cy={puckSvgY}
						r="5.5"
						className="wheel-puck"
						style={{ fill: puckColor }}
					/>
				</svg>
			</div>
			<div className="wheel-readouts" aria-label={`RGB values for ${title}`}>
				<span className="wheel-readout-item readout-r">
					<span className="readout-label">R</span>
					<span>{r >= 0 ? `+${r.toFixed(2)}` : r.toFixed(2)}</span>
				</span>
				<span className="wheel-readout-item readout-g">
					<span className="readout-label">G</span>
					<span>{g >= 0 ? `+${g.toFixed(2)}` : g.toFixed(2)}</span>
				</span>
				<span className="wheel-readout-item readout-b">
					<span className="readout-label">B</span>
					<span>{b >= 0 ? `+${b.toFixed(2)}` : b.toFixed(2)}</span>
				</span>
			</div>
		</div>
	);
}
