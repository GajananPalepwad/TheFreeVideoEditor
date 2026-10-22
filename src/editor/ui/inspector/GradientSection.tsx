import {
	MAX_GRADIENT_STOPS,
	gradientFieldsOf,
	gradientStopCount,
	type Clip,
	type GradientType,
	type PropertyId,
	type Time
} from '../../core';
import { useEditorStoreApi } from '../../state/EditorProvider';
import { PropertyRow, type ConfirmDisableState } from './Inspector';

interface Props {
	clip: Clip;
	localTime: Time;
	fps: number;
	confirmDisable: ConfirmDisableState | null;
	onStartDisableConfirm: (state: ConfirmDisableState) => void;
	onCancelDisableConfirm: () => void;
}

const TYPES: Array<{ id: GradientType; label: string }> = [
	{ id: 'none', label: 'None' },
	{ id: 'linear-horizontal', label: 'Linear, left to right' },
	{ id: 'linear-vertical', label: 'Linear, top to bottom' },
	{ id: 'linear-angle', label: 'Linear, at an angle' },
	{ id: 'radial', label: 'Radial' }
];

/** The colour stops of a text, shape or solid gradient: their colour, position and angle, all keyframable. */
export function GradientSection({ clip, localTime, fps, ...confirm }: Props) {
	const store = useEditorStoreApi();
	const type = gradientFieldsOf(clip)?.gradientType ?? 'none';
	const stopCount = gradientStopCount(clip);
	const row = (propertyId: PropertyId) => (
		<PropertyRow
			key={propertyId}
			clip={clip}
			propertyId={propertyId}
			localTime={localTime}
			fps={fps}
			{...confirm}
		/>
	);

	return (
		<div className="inspector-section-content gradient-section-content">
			<div className="property-row">
				<label className="property-label" htmlFor={`gradient-type-${clip.id}`}>
					Type
				</label>
				<select
					id={`gradient-type-${clip.id}`}
					className="property-select"
					aria-label="Gradient type"
					value={type}
					onChange={(event) =>
						store.getState().setGradientType(clip.id, event.target.value as GradientType)
					}
				>
					{TYPES.map((option) => (
						<option key={option.id} value={option.id}>
							{option.label}
						</option>
					))}
				</select>
			</div>

			{type === 'linear-angle' && row('gradient.angle')}

			{stopCount > 0 &&
				Array.from({ length: stopCount }, (_, index) => (
					<fieldset className="gradient-stop" key={index} aria-label={`Gradient stop ${index + 1}`}>
						<legend className="gradient-stop-title">
							Stop {index + 1}
							<button
								type="button"
								className="gradient-stop-remove"
								disabled={stopCount <= 2}
								onClick={() => store.getState().removeGradientStop(clip.id, index)}
								title="Remove this stop"
								aria-label={`Remove gradient stop ${index + 1}`}
							>
								✕
							</button>
						</legend>
						{row(`gradient.stop${index}.color`)}
						{row(`gradient.stop${index}.offset`)}
					</fieldset>
				))}

			{stopCount > 0 && (
				<button
					type="button"
					className="gradient-stop-add"
					disabled={stopCount >= MAX_GRADIENT_STOPS}
					onClick={() => store.getState().addGradientStop(clip.id)}
				>
					Add stop
				</button>
			)}
		</div>
	);
}
