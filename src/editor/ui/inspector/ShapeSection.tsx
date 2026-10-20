import { useState } from 'react';
import type { Clip, PropertyId, Time } from '../../core';
import type { ShapeConfig } from '../../core/shapes/shapeTypes';
import { useEditorStoreApi } from '../../state/EditorProvider';
import { ColorPickerField } from './ColorPickerField';
import { PropertyRow, type ConfirmDisableState } from './Inspector';
import {
	ShapeIcon,
	LinkAspectIcon,
	UnlinkAspectIcon,
	SHAPE_GEOMETRIES
} from '../shapes/ShapeIcons';

interface ShapeSectionProps {
	clip: Clip;
	localTime: Time;
	fps: number;
	confirmDisable: ConfirmDisableState | null;
	onStartDisableConfirm: (state: ConfirmDisableState) => void;
	onCancelDisableConfirm: () => void;
}

/** The shape properties that can be keyframed, in the order they are listed. */
const ANIMATABLE_SHAPE_PROPERTIES: PropertyId[] = [
	'shape.width',
	'shape.height',
	'shape.fillColor',
	'shape.strokeColor',
	'shape.strokeWidth',
	'shape.cornerRadius',
	'shape.shadowColor',
	'shape.shadowBlur',
	'shape.shadowOffsetX',
	'shape.shadowOffsetY'
];

export function ShapeSection({
	clip,
	localTime,
	fps,
	confirmDisable,
	onStartDisableConfirm,
	onCancelDisableConfirm
}: ShapeSectionProps) {
	const store = useEditorStoreApi();
	const shapeSource = clip.source?.type === 'shape' ? clip.source : null;
	const [linkAspect, setLinkAspect] = useState(false);

	if (!shapeSource) return null;

	const handleUpdate = (updates: Partial<ShapeConfig>) => {
		store.getState().updateShapeProperties(clip.id, updates);
	};

	const shapeType = shapeSource.shapeType ?? 'rect';
	const width = shapeSource.width ?? 360;
	const height = shapeSource.height ?? 240;
	const fillColor = shapeSource.fillColor ?? { r: 0.02, g: 0.71, b: 0.83, a: 1 };
	const strokeColor = shapeSource.strokeColor ?? { r: 1, g: 1, b: 1, a: 0.8 };
	const strokeWidth = shapeSource.strokeWidth ?? 2;
	const strokeStyle = shapeSource.strokeStyle ?? 'solid';
	const cornerRadius = shapeSource.cornerRadius ?? 0;
	const points = shapeSource.points ?? (shapeType === 'star' ? 5 : shapeType === 'badge' ? 12 : 6);
	const innerRadius = shapeSource.innerRadius ?? (shapeType === 'badge' ? 0.82 : 0.45);
	const shadowBlur = shapeSource.shadowBlur ?? 0;
	const shadowColor = shapeSource.shadowColor ?? { r: 0, g: 0, b: 0, a: 0.6 };
	const shadowOffsetX = shapeSource.shadowOffsetX ?? 0;
	const shadowOffsetY = shapeSource.shadowOffsetY ?? 4;
	const hasShadow = shadowBlur > 0 || (shapeSource.shadowColor && shapeSource.shadowColor.a > 0);

	return (
		<div
			className="inspector-section-content shape-section-content"
			style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
		>
			{/* Shape Type Selector */}
			<div className="property-group">
				<label className="shape-field-heading">Shape Geometry</label>
				<div className="shape-geometry-grid">
					{SHAPE_GEOMETRIES.map((item) => (
						<button
							key={item.type}
							type="button"
							className={`shape-type-btn ${shapeType === item.type ? 'is-active' : ''}`}
							title={item.label}
							onClick={() => handleUpdate({ shapeType: item.type })}
						>
							<span
								style={{
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
									width: '20px',
									height: '20px'
								}}
							>
								<ShapeIcon type={item.type} size={16} />
							</span>
							<span
								style={{
									fontSize: '0.58rem',
									marginTop: '3px',
									textOverflow: 'ellipsis',
									overflow: 'hidden',
									whiteSpace: 'nowrap',
									width: '100%',
									textAlign: 'center'
								}}
							>
								{item.label}
							</span>
						</button>
					))}
				</div>
			</div>

			{/* Dimensions */}
			<div
				className="property-group"
				style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
			>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<label className="shape-field-heading" style={{ marginBottom: 0 }}>
						Dimensions
					</label>
					<button
						type="button"
						className={`shape-aspect-btn ${linkAspect ? 'is-linked' : ''}`}
						onClick={() => setLinkAspect(!linkAspect)}
						title={linkAspect ? 'Constrain proportions (linked)' : 'Free dimensions (unlinked)'}
						aria-label={linkAspect ? 'Unlink dimensions' : 'Link dimensions'}
					>
						{linkAspect ? <LinkAspectIcon size={12} /> : <UnlinkAspectIcon size={12} />}
						<span>{linkAspect ? 'Linked' : 'Unlinked'}</span>
					</button>
				</div>
				<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
					<div>
						<span className="shape-field-sublabel">Width (px)</span>
						<input
							type="number"
							min={10}
							max={2560}
							value={Math.round(width)}
							onChange={(e) => {
								const val = Number(e.target.value);
								if (linkAspect && width > 0) {
									const ratio = height / width;
									handleUpdate({ width: val, height: Math.round(val * ratio) });
								} else {
									handleUpdate({ width: val });
								}
							}}
							className="shape-dimension-input"
						/>
					</div>
					<div>
						<span className="shape-field-sublabel">Height (px)</span>
						<input
							type="number"
							min={10}
							max={2560}
							value={Math.round(height)}
							onChange={(e) => {
								const val = Number(e.target.value);
								if (linkAspect && height > 0) {
									const ratio = width / height;
									handleUpdate({ height: val, width: Math.round(val * ratio) });
								} else {
									handleUpdate({ height: val });
								}
							}}
							className="shape-dimension-input"
						/>
					</div>
				</div>
			</div>

			{/* Fill Color */}
			{shapeType !== 'line' && (
				<div className="property-group">
					<ColorPickerField
						label="Fill Color"
						value={fillColor}
						onChange={([r, g, b, a]) => handleUpdate({ fillColor: { r, g, b, a } })}
						hasAlpha={true}
						gradient={{
							type: shapeSource.gradientType ?? 'none',
							colorEnd: shapeSource.gradientColorEnd,
							angle: shapeSource.gradientAngle ?? 90
						}}
						onGradientChange={({ type, colorEnd, angle }) =>
							handleUpdate({
								gradientType: type,
								gradientColorEnd: {
									r: colorEnd[0],
									g: colorEnd[1],
									b: colorEnd[2],
									a: colorEnd[3]
								},
								gradientAngle: angle
							})
						}
					/>
				</div>
			)}

			{/* Stroke / Border */}
			<div
				className="property-group shape-group-divider"
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: '8px'
				}}
			>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<span className="shape-field-heading" style={{ marginBottom: 0 }}>
						Stroke / Outline
					</span>
					<div style={{ display: 'flex', gap: '4px' }}>
						{(['solid', 'dashed', 'dotted'] as const).map((style) => (
							<button
								key={style}
								type="button"
								className={`shape-stroke-btn ${strokeStyle === style ? 'is-active' : ''}`}
								onClick={() => handleUpdate({ strokeStyle: style })}
							>
								{style}
							</button>
						))}
					</div>
				</div>
				<ColorPickerField
					label="Stroke Color"
					value={strokeColor}
					onChange={([r, g, b, a]) => handleUpdate({ strokeColor: { r, g, b, a } })}
					hasAlpha={true}
				/>
				<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
					<span className="shape-range-label" style={{ width: '80px' }}>
						Width: {Math.round(strokeWidth)}px
					</span>
					<input
						type="range"
						min={0}
						max={60}
						value={strokeWidth}
						onChange={(e) => handleUpdate({ strokeWidth: Number(e.target.value) })}
						style={{ flex: 1 }}
					/>
				</div>
			</div>

			{/* Special Parameters: Corner Radius, Points */}
			{(shapeType === 'rect' || shapeType === 'rounded-rect' || shapeType === 'callout') && (
				<div
					className="property-group"
					style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
				>
					<span className="shape-range-label" style={{ width: '90px' }}>
						Corner Radius: {Math.round(cornerRadius)}px
					</span>
					<input
						type="range"
						min={0}
						max={Math.min(120, width / 2, height / 2)}
						value={cornerRadius}
						onChange={(e) => handleUpdate({ cornerRadius: Number(e.target.value) })}
						style={{ flex: 1 }}
					/>
				</div>
			)}

			{(shapeType === 'star' || shapeType === 'polygon' || shapeType === 'badge') && (
				<div
					className="property-group"
					style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
				>
					<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
						<span className="shape-range-label" style={{ width: '80px' }}>
							{shapeType === 'polygon' ? 'Sides' : 'Points'}: {points}
						</span>
						<input
							type="range"
							min={3}
							max={shapeType === 'badge' ? 24 : 12}
							value={points}
							onChange={(e) => handleUpdate({ points: Number(e.target.value) })}
							style={{ flex: 1 }}
						/>
					</div>
					{(shapeType === 'star' || shapeType === 'badge') && (
						<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
							<span className="shape-range-label" style={{ width: '80px' }}>
								Depth: {Math.round(innerRadius * 100)}%
							</span>
							<input
								type="range"
								min={15}
								max={90}
								value={Math.round(innerRadius * 100)}
								onChange={(e) => handleUpdate({ innerRadius: Number(e.target.value) / 100 })}
								style={{ flex: 1 }}
							/>
						</div>
					)}
				</div>
			)}

			{/* Drop Shadow / Glow */}
			<div
				className="property-group shape-group-divider"
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: '8px'
				}}
			>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<span className="shape-field-heading" style={{ marginBottom: 0 }}>
						Drop Shadow & Glow
					</span>
					<input
						type="checkbox"
						checked={hasShadow}
						onChange={(e) => {
							if (e.target.checked) {
								handleUpdate({
									shadowBlur: 20,
									shadowColor: { r: 0.02, g: 0.71, b: 0.83, a: 0.6 },
									shadowOffsetX: 0,
									shadowOffsetY: 4
								});
							} else {
								handleUpdate({
									shadowBlur: 0,
									shadowColor: { r: 0, g: 0, b: 0, a: 0 }
								});
							}
						}}
					/>
				</div>
				{hasShadow && (
					<>
						<ColorPickerField
							label="Shadow Color"
							value={shadowColor}
							onChange={([r, g, b, a]) => handleUpdate({ shadowColor: { r, g, b, a } })}
							hasAlpha={true}
						/>
						<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
							<span className="shape-range-label" style={{ width: '70px' }}>
								Blur: {Math.round(shadowBlur)}px
							</span>
							<input
								type="range"
								min={1}
								max={60}
								value={shadowBlur}
								onChange={(e) => handleUpdate({ shadowBlur: Number(e.target.value) })}
								style={{ flex: 1 }}
							/>
						</div>
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
							<div>
								<span className="shape-field-sublabel">Offset X ({shadowOffsetX}px)</span>
								<input
									type="range"
									min={-40}
									max={40}
									value={shadowOffsetX}
									onChange={(e) => handleUpdate({ shadowOffsetX: Number(e.target.value) })}
									style={{ width: '100%' }}
								/>
							</div>
							<div>
								<span className="shape-field-sublabel">Offset Y ({shadowOffsetY}px)</span>
								<input
									type="range"
									min={-40}
									max={40}
									value={shadowOffsetY}
									onChange={(e) => handleUpdate({ shadowOffsetY: Number(e.target.value) })}
									style={{ width: '100%' }}
								/>
							</div>
						</div>
					</>
				)}
			</div>

			{/* Keyframes: each row edits the value at the playhead and has its own stopwatch. */}
			<div
				className="property-group shape-group-divider"
				style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
			>
				<span className="shape-field-heading" style={{ marginBottom: 0 }}>
					Animate
				</span>
				{ANIMATABLE_SHAPE_PROPERTIES.filter(
					(propertyId) => propertyId !== 'shape.fillColor' || shapeType !== 'line'
				).map((propertyId) => (
					<PropertyRow
						key={propertyId}
						clip={clip}
						propertyId={propertyId}
						localTime={localTime}
						fps={fps}
						confirmDisable={confirmDisable}
						onStartDisableConfirm={onStartDisableConfirm}
						onCancelDisableConfirm={onCancelDisableConfirm}
					/>
				))}
			</div>
		</div>
	);
}
export default ShapeSection;
