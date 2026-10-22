import { useEffect, useRef, useState } from 'react';
import type { Clip, Time } from '../../core';
import { readProperty } from '../../core';
import { TEXT_TEMPLATE_PRESETS, TEXT_ANIMATION_PRESETS } from '../../core/text/presets';
import { GRAPHIC_TEMPLATES } from '../../core/text/graphicsTemplates';
import { useEditorStoreApi } from '../../state/EditorProvider';
import { trackFeatureUsed } from '../../../services/activityTracking';
import { PropertyRow, type ConfirmDisableState } from './Inspector';
import {
	getCustomFonts,
	loadSavedCustomFonts,
	saveCustomFont,
	deleteCustomFont,
	type CustomFont
} from '../../services/render/text/fontLoader';

interface TextSectionProps {
	clip: Clip;
	localTime: Time;
	fps: number;
	confirmDisable: ConfirmDisableState | null;
	onStartDisableConfirm: (state: ConfirmDisableState) => void;
	onCancelDisableConfirm: () => void;
}

const ALL_FONTS = [
	// Sans-Serif
	{ family: 'Inter', displayName: 'Inter (Sans)', category: 'sans' },
	{ family: 'Roboto', displayName: 'Roboto', category: 'sans' },
	{ family: 'Open Sans', displayName: 'Open Sans', category: 'sans' },
	{ family: 'Lato', displayName: 'Lato', category: 'sans' },
	{ family: 'Poppins', displayName: 'Poppins', category: 'sans' },
	{ family: 'Montserrat', displayName: 'Montserrat', category: 'display' },
	{ family: 'Raleway', displayName: 'Raleway', category: 'sans' },
	{ family: 'Nunito', displayName: 'Nunito', category: 'sans' },
	{ family: 'Ubuntu', displayName: 'Ubuntu', category: 'sans' },
	{ family: 'Work Sans', displayName: 'Work Sans', category: 'sans' },
	{ family: 'Rubik', displayName: 'Rubik', category: 'sans' },

	// Serif & Display
	{ family: 'Playfair Display', displayName: 'Playfair Display', category: 'serif' },
	{ family: 'Merriweather', displayName: 'Merriweather', category: 'serif' },
	{ family: 'Lora', displayName: 'Lora', category: 'serif' },
	{ family: 'Cinzel', displayName: 'Cinzel', category: 'display' },
	{ family: 'Bodoni Moda', displayName: 'Bodoni Moda', category: 'display' },
	{ family: 'Abril Fatface', displayName: 'Abril Fatface', category: 'display' },
	{ family: 'Bebas Neue', displayName: 'Bebas Neue', category: 'condensed' },
	{ family: 'Oswald', displayName: 'Oswald', category: 'condensed' },
	{ family: 'Anton', displayName: 'Anton', category: 'display' },
	{ family: 'Lobster', displayName: 'Lobster', category: 'display' },

	// Handwriting & Script
	{ family: 'Caveat', displayName: 'Caveat', category: 'handwriting' },
	{ family: 'Pacifico', displayName: 'Pacifico', category: 'handwriting' },
	{ family: 'Dancing Script', displayName: 'Dancing Script', category: 'handwriting' },
	{ family: 'Great Vibes', displayName: 'Great Vibes', category: 'handwriting' },
	{ family: 'Sacramento', displayName: 'Sacramento', category: 'handwriting' },
	{ family: 'Satisfy', displayName: 'Satisfy', category: 'handwriting' },

	// Monospace
	{ family: 'Roboto Mono', displayName: 'Roboto Mono', category: 'mono' },
	{ family: 'Fira Code', displayName: 'Fira Code', category: 'mono' },
	{ family: 'JetBrains Mono', displayName: 'JetBrains Mono', category: 'mono' },
	{ family: 'Space Mono', displayName: 'Space Mono', category: 'mono' },
	{ family: 'Source Code Pro', displayName: 'Source Code Pro', category: 'mono' }
];

export function TextSection({
	clip,
	localTime,
	fps,
	confirmDisable,
	onStartDisableConfirm,
	onCancelDisableConfirm
}: TextSectionProps) {
	const store = useEditorStoreApi();
	const textSource = clip.source?.type === 'text' ? clip.source : null;
	const textStyle = textSource?.style ?? { fontFamily: 'sans-serif', alignment: 'center' };
	const textBox = textSource?.box;

	const [fontSearch, setFontSearch] = useState('');
	const [fontPickerOpen, setFontPickerOpen] = useState(false);
	const [customFontsList, setCustomFontsList] = useState<CustomFont[]>([]);
	const [fontUploadError, setFontUploadError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		loadSavedCustomFonts()
			.then((fonts) => setCustomFontsList(fonts))
			.catch(() => {});
	}, []);

	if (!textSource) return null;

	const handleCustomFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		setFontUploadError(null);
		try {
			const buffer = await file.arrayBuffer();
			const cleanName = file.name
				.replace(/\.[^/.]+$/, '')
				.replace(/[-_](regular|bold|italic|variable|font|light|medium|semibold)/gi, '')
				.replace(/[-_]/g, ' ')
				.trim();
			const familyName = cleanName || file.name.replace(/\.[^/.]+$/, '');
			const saved = await saveCustomFont({
				family: familyName,
				displayName: familyName,
				fileName: file.name,
				data: buffer
			});
			setCustomFontsList(getCustomFonts());
			handleFontSelect(saved.family);
		} catch (err) {
			console.error('Failed to load custom font file:', err);
			setFontUploadError(
				'Failed to load font file. Please ensure it is a valid font file (.ttf, .otf, .woff, .woff2).'
			);
		} finally {
			if (fileInputRef.current) fileInputRef.current.value = '';
		}
	};

	const handleDeleteCustomFont = async (e: React.MouseEvent, family: string) => {
		e.stopPropagation();
		await deleteCustomFont(family);
		setCustomFontsList(getCustomFonts());
		if (textStyle.fontFamily === family) {
			handleFontSelect('sans-serif');
		}
	};

	const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		trackFeatureUsed('text_layer');
		store.getState().setTextContent(clip.id, e.target.value);
	};

	const handleTemplateSelect = (templateId: string) => {
		trackFeatureUsed('text_layer', { template: templateId });
		const isGraphic = GRAPHIC_TEMPLATES.some((g) => g.id === templateId);
		if (isGraphic) {
			store.getState().applyGraphicTemplate(clip.id, templateId);
		} else {
			store.getState().applyTextTemplate(clip.id, templateId);
		}
	};

	const handleAnimationSelect = (presetId: string) => {
		trackFeatureUsed('text_layer', { animation: presetId });
		store.getState().applyTextAnimation(clip.id, presetId);
	};

	const handleClearAnimations = () => {
		store.getState().clearTextAnimations(clip.id);
	};

	const handleFontSelect = (family: string) => {
		store.getState().setTextStyle(clip.id, { fontFamily: family });
		setFontPickerOpen(false);
	};

	const handleAlignmentChange = (alignment: 'left' | 'center' | 'right') => {
		store.getState().setTextStyle(clip.id, { alignment });
	};

	const handleWeightChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		store.getState().setTextStyle(clip.id, {
			fontWeight: e.target.value as
				'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900'
		});
	};

	const handleStyleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		store.getState().setTextStyle(clip.id, {
			fontStyle: e.target.value as 'normal' | 'italic'
		});
	};

	const handleBoxModeChange = (mode: 'auto' | 'fixed') => {
		if (mode === 'auto') {
			store.getState().setTextBox(clip.id, { autoSize: true });
		} else {
			store.getState().setTextBox(clip.id, {
				autoSize: false,
				width: textBox?.width ?? 600,
				height: textBox?.height ?? 200
			});
		}
	};

	const handleBoxWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const width = Math.max(20, Number(e.target.value) || 20);
		store.getState().setTextBox(clip.id, { width, autoSize: false });
	};

	const handleBoxHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const height = Math.max(20, Number(e.target.value) || 20);
		store.getState().setTextBox(clip.id, { height, autoSize: false });
	};

	const currentPaddingX = textBox?.paddingX ?? (textBox?.autoSize !== false ? 20 : 0);
	const currentPaddingY = textBox?.paddingY ?? (textBox?.autoSize !== false ? 16 : 0);

	const handlePaddingXChange = (val: number) => {
		const paddingX = Math.max(0, Math.min(200, Math.round(val)));
		store.getState().setTextBox(clip.id, { paddingX });
	};

	const handlePaddingYChange = (val: number) => {
		const paddingY = Math.max(0, Math.min(200, Math.round(val)));
		store.getState().setTextBox(clip.id, { paddingY });
	};

	const handleVerticalAnchorChange = (anchor: 'top' | 'center' | 'bottom') => {
		store.getState().setTextBox(clip.id, { verticalAnchor: anchor });
	};

	const handleAlignToFrame = (
		horizontal: 'left' | 'center' | 'right' | null,
		vertical: 'top' | 'center' | 'bottom' | null
	) => {
		const project = store.getState().project;
		const width = project?.settings.width ?? 1920;
		const height = project?.settings.height ?? 1080;
		const currentPos = (readProperty(clip, 'position', localTime) as [number, number]) ?? [0, 0];
		let [newX, newY] = currentPos;

		const marginX = Math.round(width * 0.1);
		const marginY = Math.round(height * 0.1);

		if (horizontal === 'left') {
			newX = -Math.round(width / 2 - marginX);
		} else if (horizontal === 'center') {
			newX = 0;
		} else if (horizontal === 'right') {
			newX = Math.round(width / 2 - marginX);
		}

		if (vertical === 'top') {
			newY = -Math.round(height / 2 - marginY);
		} else if (vertical === 'center') {
			newY = 0;
		} else if (vertical === 'bottom') {
			newY = Math.round(height / 2 - marginY);
		}

		store.getState().setProperty(clip.id, 'position', [newX, newY], { autoKey: true });
	};

	const allAvailableFonts = [
		...customFontsList.map((f) => ({
			family: f.family,
			displayName: f.displayName,
			category: 'custom' as const
		})),
		...ALL_FONTS
	];

	const filteredFonts = allAvailableFonts.filter(
		(font) =>
			font.displayName.toLowerCase().includes(fontSearch.toLowerCase()) ||
			font.family.toLowerCase().includes(fontSearch.toLowerCase()) ||
			font.category.toLowerCase().includes(fontSearch.toLowerCase())
	);

	return (
		<div className="inspector-section-content text-section-container">
			{/* Template Presets Picker */}
			<div className="property-row">
				<div className="property-header">
					<span className="property-label">Template</span>
				</div>
				<select
					className="text-select"
					onChange={(e) => {
						if (e.target.value) handleTemplateSelect(e.target.value);
					}}
					defaultValue=""
					aria-label="Apply text template preset"
				>
					<option value="" disabled>
						Apply Style Template…
					</option>
					<optgroup label="Essential Text Presets">
						{TEXT_TEMPLATE_PRESETS.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name}
							</option>
						))}
					</optgroup>
					<optgroup label="Motion Graphic Templates">
						{GRAPHIC_TEMPLATES.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name} ({t.category})
							</option>
						))}
					</optgroup>
				</select>
			</div>

			{/* Animation Presets */}
			<div className="property-row">
				<div className="property-header">
					<span className="property-label">Animation</span>
				</div>
				<div className="flex w-full items-center gap-1.5">
					<select
						className="text-select flex-1"
						onChange={(e) => {
							if (e.target.value) handleAnimationSelect(e.target.value);
						}}
						defaultValue=""
						aria-label="Apply text animation preset"
					>
						<option value="" disabled>
							Apply Animation…
						</option>
						{TEXT_ANIMATION_PRESETS.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name} ({a.kind})
							</option>
						))}
					</select>
					<button
						type="button"
						className="text-action-btn"
						onClick={handleClearAnimations}
						title="Clear all animation keyframes on this text clip"
					>
						Clear
					</button>
				</div>
			</div>

			{/* Text Content */}
			<div className="property-row">
				<div className="property-header">
					<span className="property-label" id="text-content-label">
						Content
					</span>
				</div>
				<textarea
					id="text-content-input"
					className="text-content-textarea"
					rows={3}
					value={textSource.text}
					onChange={handleContentChange}
					placeholder="Enter text..."
					aria-labelledby="text-content-label"
				/>
			</div>

			{/* Font Family Picker */}
			<div className="property-row">
				<div className="property-header">
					<span className="property-label">Font Family</span>
				</div>
				<div className="relative w-full">
					<button
						type="button"
						className="font-picker-btn"
						onClick={() => setFontPickerOpen(!fontPickerOpen)}
						aria-label="Select font family"
					>
						<span style={{ fontFamily: textStyle.fontFamily || 'sans-serif' }}>
							{textStyle.fontFamily || 'sans-serif'}
						</span>
						<svg
							width="10"
							height="10"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{
								transform: fontPickerOpen ? 'rotate(180deg)' : 'none',
								transition: 'transform 0.15s ease'
							}}
							aria-hidden="true"
						>
							<polyline points="6 9 12 15 18 9" />
						</svg>
					</button>

					{fontPickerOpen && (
						<div className="font-picker-dropdown">
							{/* Upload Custom Font Button */}
							<div className="border-b border-[#242430] p-1 pb-1.5">
								<button
									type="button"
									className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-[#3b82f6]/50 bg-[#3b82f6]/10 px-2 py-1.5 text-xs font-medium text-[#60a5fa] transition-colors hover:border-[#3b82f6] hover:bg-[#3b82f6]/20"
									onClick={() => fileInputRef.current?.click()}
								>
									<svg
										width="12"
										height="12"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.5"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<line x1="12" y1="5" x2="12" y2="19" />
										<line x1="5" y1="12" x2="19" y2="12" />
									</svg>
									<span>Add Custom Font (.ttf, .otf, .woff, .woff2)</span>
								</button>
								<input
									ref={fileInputRef}
									type="file"
									accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
									className="hidden"
									onChange={handleCustomFontUpload}
								/>
								{fontUploadError && (
									<div className="mt-1.5 rounded border border-red-500/30 bg-red-500/10 p-1.5 text-[11px] text-red-400">
										{fontUploadError}
									</div>
								)}
							</div>

							<input
								type="text"
								className="font-search-input mt-1"
								placeholder="Search fonts..."
								value={fontSearch}
								onChange={(e) => setFontSearch(e.target.value)}
								autoFocus
							/>
							<div className="flex max-h-60 flex-col gap-0.5 overflow-y-auto">
								<button
									type="button"
									className="font-option-btn"
									onClick={() => {
										handleFontSelect('sans-serif');
										setFontPickerOpen(false);
									}}
								>
									<span>System Sans-Serif</span>
								</button>
								<button
									type="button"
									className="font-option-btn"
									onClick={() => {
										handleFontSelect('monospace');
										setFontPickerOpen(false);
									}}
								>
									<span style={{ fontFamily: 'monospace' }}>System Monospace</span>
								</button>

								{filteredFonts.map((font) => (
									<div
										key={font.family}
										className="font-option-btn flex items-center justify-between p-0 hover:bg-[#252538]"
									>
										<button
											type="button"
											className="flex flex-1 items-center justify-between px-2.5 py-1.5 text-left"
											onClick={() => {
												handleFontSelect(font.family);
												setFontPickerOpen(false);
											}}
										>
											<span style={{ fontFamily: font.family }}>{font.displayName}</span>
											<span
												className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${
													font.category === 'custom'
														? 'border-[#3b82f6]/40 bg-[#3b82f6]/20 text-[#60a5fa]'
														: 'border-[#242430] bg-[#1a1a24] text-[#64748b]'
												}`}
											>
												{font.category}
											</span>
										</button>
										{font.category === 'custom' && (
											<button
												type="button"
												className="mr-1.5 rounded p-1 text-[#64748b] hover:bg-red-500/20 hover:text-red-400"
												onClick={(e) => handleDeleteCustomFont(e, font.family)}
												title={`Delete font ${font.displayName}`}
												aria-label={`Delete custom font ${font.displayName}`}
											>
												<svg
													width="11"
													height="11"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2.5"
													strokeLinecap="round"
													strokeLinejoin="round"
												>
													<line x1="18" y1="6" x2="6" y2="18" />
													<line x1="6" y1="6" x2="18" y2="18" />
												</svg>
											</button>
										)}
									</div>
								))}

								{filteredFonts.length === 0 && (
									<div className="p-2 text-center text-xs text-gray-400">
										No fonts found for "{fontSearch}"
									</div>
								)}
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Font Weight & Style */}
			<div className="flex gap-2">
				<div className="property-row flex-1">
					<div className="property-header">
						<span className="property-label">Weight</span>
					</div>
					<select
						className="text-select"
						value={textStyle.fontWeight || 'normal'}
						onChange={handleWeightChange}
					>
						<option value="normal">Normal (400)</option>
						<option value="bold">Bold (700)</option>
						<option value="300">Light (300)</option>
						<option value="500">Medium (500)</option>
						<option value="600">Semi-Bold (600)</option>
						<option value="800">Extra-Bold (800)</option>
						<option value="900">Black (900)</option>
					</select>
				</div>
				<div className="property-row flex-1">
					<div className="property-header">
						<span className="property-label">Style</span>
					</div>
					<select
						className="text-select"
						value={textStyle.fontStyle || 'normal'}
						onChange={handleStyleChange}
					>
						<option value="normal">Normal</option>
						<option value="italic">Italic</option>
					</select>
				</div>
			</div>

			{/* Alignment */}
			<div className="property-row">
				<div className="property-header">
					<span className="property-label">Alignment</span>
				</div>
				<div className="segmented-pill-group" role="group" aria-label="Text Alignment">
					{(['left', 'center', 'right'] as const).map((align) => {
						const isActive = (textStyle.alignment || 'center') === align;
						return (
							<button
								key={align}
								type="button"
								className={`segmented-pill-btn ${isActive ? 'is-active' : ''}`}
								onClick={() => handleAlignmentChange(align)}
								title={`Align ${align}`}
								aria-pressed={isActive}
							>
								{align === 'left' && (
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.2"
										strokeLinecap="round"
									>
										<line x1="17" y1="10" x2="3" y2="10" />
										<line x1="21" y1="6" x2="3" y2="6" />
										<line x1="21" y1="14" x2="3" y2="14" />
										<line x1="17" y1="18" x2="3" y2="18" />
									</svg>
								)}
								{align === 'center' && (
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.2"
										strokeLinecap="round"
									>
										<line x1="18" y1="10" x2="6" y2="10" />
										<line x1="21" y1="6" x2="3" y2="6" />
										<line x1="21" y1="14" x2="3" y2="14" />
										<line x1="18" y1="18" x2="6" y2="18" />
									</svg>
								)}
								{align === 'right' && (
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.2"
										strokeLinecap="round"
									>
										<line x1="21" y1="10" x2="7" y2="10" />
										<line x1="21" y1="6" x2="3" y2="6" />
										<line x1="21" y1="14" x2="3" y2="14" />
										<line x1="21" y1="18" x2="7" y2="18" />
									</svg>
								)}
								<span className="capitalize">{align}</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* Box Sizing (Auto / Fixed Width) */}
			<div className="property-row">
				<div className="property-header">
					<span className="property-label">Box Mode</span>
				</div>
				<div className="segmented-pill-group" role="group" aria-label="Text Box Sizing">
					<button
						type="button"
						className={`segmented-pill-btn ${textBox?.autoSize !== false ? 'is-active' : ''}`}
						onClick={() => handleBoxModeChange('auto')}
						aria-pressed={textBox?.autoSize !== false}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
						>
							<polyline points="4 14 10 14 10 20" />
							<polyline points="20 10 14 10 14 4" />
							<line x1="14" y1="10" x2="21" y2="3" />
							<line x1="3" y1="21" x2="10" y2="14" />
						</svg>
						<span>Auto Size</span>
					</button>
					<button
						type="button"
						className={`segmented-pill-btn ${textBox?.autoSize === false ? 'is-active' : ''}`}
						onClick={() => handleBoxModeChange('fixed')}
						aria-pressed={textBox?.autoSize === false}
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
						>
							<rect x="3" y="3" width="18" height="18" rx="2" />
							<line x1="9" y1="12" x2="15" y2="12" />
						</svg>
						<span>Fixed Width</span>
					</button>
				</div>
			</div>

			{textBox?.autoSize === false && (
				<div className="flex gap-2">
					<div className="property-row flex-1">
						<div className="property-header">
							<span className="property-label">Width (px)</span>
						</div>
						<input
							type="number"
							min="50"
							max="3840"
							className="text-select font-mono"
							value={textBox?.width ?? 600}
							onChange={handleBoxWidthChange}
						/>
					</div>
					<div className="property-row flex-1">
						<div className="property-header">
							<span className="property-label">Height (px)</span>
						</div>
						<input
							type="number"
							min="20"
							max="2160"
							className="text-select font-mono"
							value={textBox?.height ?? 200}
							onChange={handleBoxHeightChange}
						/>
					</div>
				</div>
			)}

			{/* Padding Controls */}
			<div className="flex gap-2">
				<div className="property-row flex-1">
					<div className="property-header">
						<span className="property-label">Padding X</span>
						<span className="property-subtext">{currentPaddingX}px</span>
					</div>
					<div className="flex items-center gap-2">
						<input
							type="range"
							min="0"
							max="150"
							value={currentPaddingX}
							onChange={(e) => handlePaddingXChange(Number(e.target.value))}
							className="inspector-slider flex-1"
							aria-label="Text Horizontal Padding"
						/>
						<input
							type="number"
							min="0"
							max="200"
							value={currentPaddingX}
							onChange={(e) => handlePaddingXChange(Number(e.target.value))}
							className="text-select w-16 font-mono text-xs"
							aria-label="Text Horizontal Padding Input"
						/>
					</div>
				</div>
				<div className="property-row flex-1">
					<div className="property-header">
						<span className="property-label">Padding Y</span>
						<span className="property-subtext">{currentPaddingY}px</span>
					</div>
					<div className="flex items-center gap-2">
						<input
							type="range"
							min="0"
							max="150"
							value={currentPaddingY}
							onChange={(e) => handlePaddingYChange(Number(e.target.value))}
							className="inspector-slider flex-1"
							aria-label="Text Vertical Padding"
						/>
						<input
							type="number"
							min="0"
							max="200"
							value={currentPaddingY}
							onChange={(e) => handlePaddingYChange(Number(e.target.value))}
							className="text-select w-16 font-mono text-xs"
							aria-label="Text Vertical Padding Input"
						/>
					</div>
				</div>
			</div>

			{/* Vertical Anchor */}
			<div className="property-row">
				<div className="property-header">
					<span className="property-label">Vertical Anchor</span>
				</div>
				<div className="segmented-pill-group" role="group" aria-label="Vertical Anchor">
					{(['top', 'center', 'bottom'] as const).map((anchor) => {
						const isActive = (textBox?.verticalAnchor || 'center') === anchor;
						return (
							<button
								key={anchor}
								type="button"
								className={`segmented-pill-btn ${isActive ? 'is-active' : ''}`}
								onClick={() => handleVerticalAnchorChange(anchor)}
								title={`Anchor ${anchor}`}
								aria-pressed={isActive}
							>
								{anchor === 'top' && (
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
									>
										<line x1="4" y1="4" x2="20" y2="4" />
										<rect x="7" y="8" width="10" height="12" rx="1" />
									</svg>
								)}
								{anchor === 'center' && (
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
									>
										<line x1="4" y1="12" x2="20" y2="12" />
										<rect x="7" y="6" width="10" height="12" rx="1" />
									</svg>
								)}
								{anchor === 'bottom' && (
									<svg
										width="13"
										height="13"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
									>
										<line x1="4" y1="20" x2="20" y2="20" />
										<rect x="7" y="4" width="10" height="12" rx="1" />
									</svg>
								)}
								<span className="capitalize">{anchor === 'center' ? 'Middle' : anchor}</span>
							</button>
						);
					})}
				</div>
			</div>

			{/* Align to Video Frame */}
			<div className="property-row">
				<div className="property-header">
					<span className="property-label">Align to Video</span>
				</div>
				<div className="flex w-full flex-col gap-1.5">
					<div
						className="segmented-pill-group"
						role="group"
						aria-label="Horizontal Frame Alignment"
					>
						<button
							type="button"
							className="segmented-pill-btn"
							onClick={() => handleAlignToFrame('left', null)}
							title="Align Left of Video Frame"
							aria-label="Snap to Frame Start"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<line x1="4" y1="4" x2="4" y2="20" />
								<rect x="8" y="7" width="12" height="10" rx="1" />
							</svg>
							<span>Left</span>
						</button>
						<button
							type="button"
							className="segmented-pill-btn"
							onClick={() => handleAlignToFrame('center', null)}
							title="Center Horizontally in Video Frame"
							aria-label="Center in Frame"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<line x1="12" y1="4" x2="12" y2="20" />
								<rect x="6" y="7" width="12" height="10" rx="1" />
							</svg>
							<span>Center</span>
						</button>
						<button
							type="button"
							className="segmented-pill-btn"
							onClick={() => handleAlignToFrame('right', null)}
							title="Align Right of Video Frame"
							aria-label="Snap to Frame End"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<line x1="20" y1="4" x2="20" y2="20" />
								<rect x="4" y="7" width="12" height="10" rx="1" />
							</svg>
							<span>Right</span>
						</button>
					</div>
					<div className="segmented-pill-group" role="group" aria-label="Vertical Frame Alignment">
						<button
							type="button"
							className="segmented-pill-btn"
							onClick={() => handleAlignToFrame(null, 'top')}
							title="Align Top of Video Frame"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<line x1="4" y1="4" x2="20" y2="4" />
								<rect x="7" y="8" width="10" height="12" rx="1" />
							</svg>
							<span>Top</span>
						</button>
						<button
							type="button"
							className="segmented-pill-btn"
							onClick={() => handleAlignToFrame(null, 'center')}
							title="Center Vertically in Video Frame"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<line x1="4" y1="12" x2="20" y2="12" />
								<rect x="7" y="6" width="10" height="12" rx="1" />
							</svg>
							<span>Middle</span>
						</button>
						<button
							type="button"
							className="segmented-pill-btn"
							onClick={() => handleAlignToFrame(null, 'bottom')}
							title="Align Bottom of Video Frame"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
							>
								<line x1="4" y1="20" x2="20" y2="20" />
								<rect x="7" y="4" width="10" height="12" rx="1" />
							</svg>
							<span>Bottom</span>
						</button>
					</div>
				</div>
			</div>

			{/* Animatable Text Properties */}
			<div className="text-divider">
				<span className="text-divider-title">Styling & Layout</span>
				<div className="timeline-counter-badge" style={{ margin: 0 }}>
					<span className="timeline-badge-dot" aria-hidden="true" />7 channels
				</div>
			</div>

			<PropertyRow
				clip={clip}
				propertyId="text.fontSize"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.fillColor"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.strokeColor"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.strokeWidth"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.letterSpacing"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.lineHeight"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.reveal"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<div className="property-row">
				<div className="property-header">
					<span className="property-label">Reveal by</span>
				</div>
				<select
					className="text-select"
					aria-label="Reveal by"
					value={textStyle.revealUnit || 'char'}
					onChange={(e) =>
						store
							.getState()
							.setTextStyle(clip.id, { revealUnit: e.target.value as 'char' | 'word' | 'line' })
					}
				>
					<option value="char">Character</option>
					<option value="word">Word</option>
					<option value="line">Line</option>
				</select>
			</div>

			<div className="text-divider">
				<span className="text-divider-title">Animate each {textStyle.revealUnit === 'word' ? 'word' : textStyle.revealUnit === 'line' ? 'line' : 'character'}</span>
			</div>

			<div className="property-row">
				<button
					type="button"
					className="text-action-btn"
					onClick={() => {
						const end = Math.min(1_000_000, clip.duration);
						store.getState().addKeyframeAtTime(clip.id, 'text.anim.progress', 0, 0);
						store.getState().addKeyframeAtTime(clip.id, 'text.anim.progress', end, 1);
					}}
					title="Make each unit rise into place one after another over the first second"
				>
					Animate in
				</button>
			</div>

			<PropertyRow
				clip={clip}
				propertyId="text.anim.progress"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.anim.stagger"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.anim.offsetX"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.anim.offsetY"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.anim.scale"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.anim.rotation"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.anim.opacity"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<div className="text-divider">
				<span className="text-divider-title">Shadow</span>
				<div className="timeline-counter-badge" style={{ margin: 0 }}>
					<span className="timeline-badge-dot" aria-hidden="true" />4 channels
				</div>
			</div>

			<PropertyRow
				clip={clip}
				propertyId="text.shadowColor"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.shadowBlur"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.shadowOffsetX"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>

			<PropertyRow
				clip={clip}
				propertyId="text.shadowOffsetY"
				localTime={localTime}
				fps={fps}
				confirmDisable={confirmDisable}
				onStartDisableConfirm={onStartDisableConfirm}
				onCancelDisableConfirm={onCancelDisableConfirm}
			/>
		</div>
	);
}
