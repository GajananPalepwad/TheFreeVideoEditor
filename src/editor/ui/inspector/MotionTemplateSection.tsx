import { useEditorStoreApi } from '../../state/EditorProvider';
import type { Clip } from '../../core/types';
import { ColorPickerField } from './ColorPickerField';
import type { PublishedTemplateParam } from '../../core/templates/templateTypes';
import { ensureFontLoaded } from '../../services/render/text/fontLoader';
import './motionTemplateSection.css';

interface MotionTemplateSectionProps {
	clip: Clip;
}

const COMMON_FONTS = [
	'Montserrat',
	'Kanit',
	'Inter',
	'Roboto',
	'Roboto Mono',
	'Playfair Display',
	'Bebas Neue',
	'Caveat',
	'Poppins',
	'Oswald',
	'Anton',
	'Cinzel',
	'Bodoni Moda',
	'Pacifico',
	'Lobster',
	'Fira Code',
	'JetBrains Mono',
	'Arial',
	'Courier New'
];

export function MotionTemplateSection({ clip }: MotionTemplateSectionProps) {
	const store = useEditorStoreApi();

	if (clip.source?.type !== 'sequence') return null;

	const source = clip.source;
	const templateName = source.templateName || 'Motion Graphic Template';
	const publishedParams: PublishedTemplateParam[] = source.publishedParams || [];
	const overrides = source.paramOverrides || {};

	const handleParamChange = (paramId: string, value: any) => {
		store.getState().setTemplateParamOverride(clip.id, paramId, value);
	};

	const handleReset = () => {
		if (window.confirm('Reset all template customizations back to default values?')) {
			store.getState().resetTemplateParamOverrides(clip.id);
		}
	};

	const handleUnpack = () => {
		if (
			window.confirm(
				'Unpack this template into separate individual tracks on the timeline? All your customized text and color changes will be preserved.'
			)
		) {
			store.getState().unpackTemplateClip(clip.id);
		}
	};

	return (
		<div className="motion-template-inspector">
			<div className="motion-template-banner">
				<div className="motion-template-banner-info">
					<div className="motion-template-badge-row">
						<span className="motion-template-mogrt-badge">MOGRT</span>
						{source.templateCategory && (
							<span className="motion-template-cat-badge">{source.templateCategory}</span>
						)}
					</div>
					<h4 className="motion-template-banner-title">{templateName}</h4>
				</div>
				<button
					type="button"
					className="motion-template-reset-btn"
					onClick={handleReset}
					title="Reset properties to template defaults"
				>
					Reset
				</button>
			</div>

			<div className="motion-template-params">
				{publishedParams.length === 0 ? (
					<p className="motion-template-no-params">
						This template does not have any published editable parameters.
					</p>
				) : (
					publishedParams.map((param) => {
						const currentValue = overrides[param.id] !== undefined ? overrides[param.id] : param.defaultValue;

						if (param.type === 'text') {
							const textVal = typeof currentValue === 'string' ? currentValue : String(currentValue ?? '');
							const isMultiline = textVal.includes('\n') || textVal.length > 35;

							return (
								<div key={param.id} className="motion-template-field">
									<label className="motion-template-label">{param.name}</label>
									{isMultiline ? (
										<textarea
											className="motion-template-textarea"
											rows={2}
											value={textVal}
											onChange={(e) => handleParamChange(param.id, e.target.value)}
										/>
									) : (
										<input
											type="text"
											className="motion-template-input"
											value={textVal}
											onChange={(e) => handleParamChange(param.id, e.target.value)}
										/>
									)}
								</div>
							);
						}

						if (param.type === 'font') {
							const currentFont = String(currentValue ?? param.defaultValue ?? 'Montserrat');
							const fontList = COMMON_FONTS.includes(currentFont)
								? COMMON_FONTS
								: [currentFont, ...COMMON_FONTS];

							return (
								<div key={param.id} className="motion-template-field">
									<label className="motion-template-label">{param.name}</label>
									<select
										className="motion-template-select"
										value={currentFont}
										onChange={(e) => {
											handleParamChange(param.id, e.target.value);
											void ensureFontLoaded(e.target.value);
										}}
									>
										{fontList.map((font) => (
											<option key={font} value={font} style={{ fontFamily: font }}>
												{font}
											</option>
										))}
									</select>
								</div>
							);
						}

						if (param.type === 'color') {
							const colorVal =
								currentValue && typeof currentValue === 'object' && 'r' in currentValue
									? currentValue
									: { r: 1, g: 1, b: 1, a: 1 };

							return (
								<div key={param.id} className="motion-template-field">
									<label className="motion-template-label">{param.name}</label>
									<ColorPickerField
										value={colorVal}
										onChange={(rgba) => {
											handleParamChange(param.id, {
												r: rgba[0],
												g: rgba[1],
												b: rgba[2],
												a: rgba[3]
											});
										}}
										label={param.name}
										hasAlpha={true}
									/>
								</div>
							);
						}

						if (param.type === 'number') {
							const numVal = Number(currentValue ?? 1);
							return (
								<div key={param.id} className="motion-template-field">
									<div className="motion-template-label-row">
										<label className="motion-template-label">{param.name}</label>
										<span className="motion-template-val-badge">{numVal}</span>
									</div>
									<div className="motion-template-slider-row">
										<input
											type="range"
											min={param.min ?? 0}
											max={param.max ?? 2}
											step={param.step ?? 0.05}
											value={numVal}
											onChange={(e) => handleParamChange(param.id, parseFloat(e.target.value))}
											className="motion-template-slider"
											aria-label={param.name}
										/>
										<input
											type="number"
											min={param.min ?? 0}
											max={param.max ?? 2}
											step={param.step ?? 0.05}
											value={numVal}
											onChange={(e) => {
												const val = parseFloat(e.target.value);
												if (!isNaN(val)) handleParamChange(param.id, val);
											}}
											className="motion-template-number-input"
											aria-label={`${param.name} value`}
										/>
									</div>
								</div>
							);
						}

						return null;
					})
				)}
			</div>

			<div className="motion-template-actions">
				<button
					type="button"
					className="motion-template-unpack-btn"
					onClick={handleUnpack}
					title="Decompose this template clip back into raw tracks on the timeline"
				>
					<span>Unpack / Edit Internal Layers</span>
				</button>
			</div>
		</div>
	);
}
