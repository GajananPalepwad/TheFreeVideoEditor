import { useEffect, useRef, useState } from 'react';
import { useEditorStoreApi } from '../../state/EditorProvider';
import {
	DEFAULT_EASE_IN,
	DEFAULT_EASE_OUT,
	handleFromNumbers,
	handleToNumbers,
	inHandleFromNumbers,
	inHandleToNumbers,
	readProperty,
	type Clip,
	type PropertyId,
	type PropertyValue,
	type Time
} from '../../core';
import type { GraphEditorCurve } from './GraphEditor';

interface Props {
	clip: Clip;
	curve: GraphEditorCurve;
	/** Index of the selected keyframe in `curve.keyframes`. */
	index: number;
}

interface FieldProps {
	label: string;
	unit: string;
	value: number;
	step: number;
	onCommit: (value: number) => void;
}

/** A number the user types. It applies on Enter or when the field loses focus, never per keystroke. */
function NumberField({ label, unit, value, step, onCommit }: FieldProps) {
	const [draft, setDraft] = useState(String(value));
	// Enter commits and then blurs the field, and the blur must not commit the same number again.
	const committed = useRef<number | null>(null);
	useEffect(() => {
		committed.current = null;
		setDraft(String(value));
	}, [value]);

	const commit = () => {
		const parsed = Number(draft);
		if (draft.trim() === '' || !Number.isFinite(parsed)) {
			setDraft(String(value));
			return;
		}
		if (parsed === value || parsed === committed.current) return;
		committed.current = parsed;
		onCommit(parsed);
	};

	return (
		<label className="graph-number-field">
			<span className="graph-number-label">{label}</span>
			<input
				type="number"
				className="graph-number-input"
				aria-label={label}
				value={draft}
				step={step}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') {
						commit();
						event.currentTarget.blur();
					} else if (event.key === 'Escape') {
						setDraft(String(value));
						event.currentTarget.blur();
					}
					event.stopPropagation();
				}}
			/>
			{unit && <span className="graph-number-unit">{unit}</span>}
		</label>
	);
}

/** Exact numbers for the one selected keyframe: when it is, what it is, and how its handles bend. */
export default function KeyframeNumbers({ clip, curve, index }: Props) {
	const store = useEditorStoreApi();
	const key = curve.keyframes[index];
	if (!key) return null;

	const prev = curve.keyframes[index - 1];
	const next = curve.keyframes[index + 1];
	// A key's own interpolation shapes the segment after it, so the in handle depends on the key before.
	const outEditable = key.interpolation === 'bezier' && Boolean(next);
	const inEditable = prev?.interpolation === 'bezier';

	const setTime = (seconds: number) => {
		const target = Math.min(clip.duration, Math.max(0, Math.round(seconds * 1_000_000))) as Time;
		const delta = target - key.time;
		if (delta !== 0) store.getState().moveSelectedKeyframes(delta, true);
	};

	const setValue = (display: number) => {
		const internal = display / (curve.desc.displayFactor || 1);
		const raw = readProperty(clip, curve.propertyId as PropertyId, key.time);
		let value: PropertyValue = internal;
		if (Array.isArray(raw)) {
			const copy = [...raw];
			copy[curve.channelIdx] = internal;
			value = copy as unknown as PropertyValue;
		}
		store
			.getState()
			.setKeyframeValue(clip.id, curve.propertyId, key.time, value, curve.channelIdx, true);
	};

	const out = handleToNumbers(key.easeOut ?? DEFAULT_EASE_OUT);
	const into = inHandleToNumbers(key.easeIn ?? DEFAULT_EASE_IN);

	return (
		<div className="graph-numbers" role="group" aria-label={`${curve.label} keyframe values`}>
			<span className="graph-numbers-title">{curve.label}</span>
			<NumberField
				label="Time"
				unit="s"
				value={Math.round((key.time / 1_000_000) * 1000) / 1000}
				step={0.01}
				onCommit={setTime}
			/>
			<NumberField
				label="Value"
				unit={curve.unit}
				value={Math.round(key.value * 1000) / 1000}
				step={1}
				onCommit={setValue}
			/>
			{outEditable && (
				<>
					<NumberField
						label="Out influence"
						unit="%"
						value={out.influence}
						step={1}
						onCommit={(influence) =>
							store.getState().setBezierHandles(clip.id, curve.propertyId, key.time, {
								easeOut: handleFromNumbers({ influence, value: out.value })
							})
						}
					/>
					<NumberField
						label="Out value"
						unit="%"
						value={out.value}
						step={1}
						onCommit={(value) =>
							store.getState().setBezierHandles(clip.id, curve.propertyId, key.time, {
								easeOut: handleFromNumbers({ influence: out.influence, value })
							})
						}
					/>
				</>
			)}
			{inEditable && (
				<>
					<NumberField
						label="In influence"
						unit="%"
						value={into.influence}
						step={1}
						onCommit={(influence) =>
							store.getState().setBezierHandles(clip.id, curve.propertyId, key.time, {
								easeIn: inHandleFromNumbers({ influence, value: into.value })
							})
						}
					/>
					<NumberField
						label="In value"
						unit="%"
						value={into.value}
						step={1}
						onCommit={(value) =>
							store.getState().setBezierHandles(clip.id, curve.propertyId, key.time, {
								easeIn: inHandleFromNumbers({ influence: into.influence, value })
							})
						}
					/>
				</>
			)}
		</div>
	);
}
