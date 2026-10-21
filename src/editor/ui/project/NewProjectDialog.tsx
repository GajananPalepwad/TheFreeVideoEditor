import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { useEditorStore } from '../../state/EditorProvider';
import './new-project-dialog.css';

export interface ProjectPreset {
	id: string;
	title: string;
	category: 'social' | 'film';
	width: number;
	height: number;
	aspectRatioLabel: string;
	fps: number;
	description: string;
	wireframe: { w: number; h: number };
}

export const PROJECT_PRESETS: ProjectPreset[] = [
	{
		id: 'youtube-1080p',
		title: 'YouTube / Web 1080p',
		category: 'social',
		width: 1920,
		height: 1080,
		aspectRatioLabel: '16:9',
		fps: 30,
		description: 'Standard Full HD horizontal video',
		wireframe: { w: 46, h: 26 }
	},
	{
		id: 'tiktok-reels-shorts',
		title: 'TikTok / Reels / Shorts',
		category: 'social',
		width: 1080,
		height: 1920,
		aspectRatioLabel: '9:16',
		fps: 30,
		description: 'Vertical format for mobile feeds & stories',
		wireframe: { w: 26, h: 46 }
	},
	{
		id: 'instagram-square',
		title: 'Instagram Post',
		category: 'social',
		width: 1080,
		height: 1080,
		aspectRatioLabel: '1:1',
		fps: 30,
		description: 'Square feed video & carousel',
		wireframe: { w: 34, h: 34 }
	},
	{
		id: 'instagram-portrait',
		title: 'Instagram Portrait',
		category: 'social',
		width: 1080,
		height: 1350,
		aspectRatioLabel: '4:5',
		fps: 30,
		description: 'Maximum feed real estate on mobile',
		wireframe: { w: 30, h: 38 }
	},
	{
		id: 'film-4k',
		title: '4K UHD Broadcast',
		category: 'film',
		width: 3840,
		height: 2160,
		aspectRatioLabel: '16:9',
		fps: 30,
		description: 'Ultra High Definition for cinematic work',
		wireframe: { w: 46, h: 26 }
	},
	{
		id: 'cinema-ultrawide',
		title: 'Cinema Ultrawide',
		category: 'film',
		width: 2560,
		height: 1080,
		aspectRatioLabel: '21:9',
		fps: 24,
		description: 'Cinematic widescreen aspect ratio',
		wireframe: { w: 50, h: 22 }
	},
	{
		id: 'standard-720p',
		title: '720p HD Standard',
		category: 'film',
		width: 1280,
		height: 720,
		aspectRatioLabel: '16:9',
		fps: 30,
		description: 'Lightweight preview & standard resolution',
		wireframe: { w: 46, h: 26 }
	}
];

type PresetCategory = 'all' | 'social' | 'film' | 'custom';

export default function NewProjectDialog({ focusProjectTitle }: { focusProjectTitle: () => void }) {
	const open = useEditorStore((state) => state.isNewProjectDialogOpen);
	const project = useEditorStore((state) => state.project);
	const message = useEditorStore((state) => state.projectMessage);
	const createProject = useEditorStore((state) => state.createProject);
	const closeNewProjectDialog = useEditorStore((state) => state.closeNewProjectDialog);
	const setProjectMessage = useEditorStore((state) => state.setProjectMessage);

	const [name, setName] = useState('Untitled Project');
	const [selectedPresetId, setSelectedPresetId] = useState<string>('youtube-1080p');
	const [activeCategory, setActiveCategory] = useState<PresetCategory>('all');
	const [width, setWidth] = useState(1920);
	const [height, setHeight] = useState(1080);
	const [fps, setFps] = useState(30);
	const [sampleRate, setSampleRate] = useState(48000);

	const dialogRef = useRef<HTMLDialogElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const errorRef = useRef<HTMLParagraphElement>(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			nameRef.current?.focus();
		}
		if (!open && dialog.open) {
			dialog.close();
			if (project) focusProjectTitle();
		}
	}, [focusProjectTitle, open, project]);

	useEffect(() => {
		if (open && message) errorRef.current?.focus();
	}, [message, open]);

	function handleSelectPreset(preset: ProjectPreset) {
		setSelectedPresetId(preset.id);
		setWidth(preset.width);
		setHeight(preset.height);
		setFps(preset.fps);
	}

	function handleWidthChange(newWidth: number) {
		setWidth(newWidth);
		const match = PROJECT_PRESETS.find((p) => p.width === newWidth && p.height === height);
		setSelectedPresetId(match ? match.id : 'custom');
	}

	function handleHeightChange(newHeight: number) {
		setHeight(newHeight);
		const match = PROJECT_PRESETS.find((p) => p.width === width && p.height === newHeight);
		setSelectedPresetId(match ? match.id : 'custom');
	}

	const isLandscape = width >= height;

	function setOrientation(orientation: 'landscape' | 'portrait') {
		if (orientation === 'landscape' && width < height) {
			setWidth(height);
			setHeight(width);
			const match = PROJECT_PRESETS.find((p) => p.width === height && p.height === width);
			setSelectedPresetId(match ? match.id : 'custom');
		} else if (orientation === 'portrait' && width > height) {
			setWidth(height);
			setHeight(width);
			const match = PROJECT_PRESETS.find((p) => p.width === height && p.height === width);
			setSelectedPresetId(match ? match.id : 'custom');
		}
	}

	const filteredPresets =
		activeCategory === 'all'
			? PROJECT_PRESETS
			: PROJECT_PRESETS.filter((p) => p.category === activeCategory);

	async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();
		setProjectMessage('');
		await createProject({
			name,
			settings: {
				width,
				height,
				fps,
				sampleRate
			}
		});
	}

	return (
		<dialog
			ref={dialogRef}
			className="editor-dialog new-project-dialog"
			aria-labelledby="new-project-title"
			onCancel={(event) => {
				event.preventDefault();
				closeNewProjectDialog();
			}}
			onClick={(event: MouseEvent<HTMLDialogElement>) => {
				if (event.target === event.currentTarget) closeNewProjectDialog();
			}}
		>
			<form className="dialog-content" onSubmit={(event) => void submit(event)}>
				<div className="new-project-header">
					<div>
						<p
							className="dialog-eyebrow"
							style={{
								margin: 0,
								fontSize: '10px',
								letterSpacing: '0.08em',
								color: '#64748b',
								textTransform: 'uppercase',
								fontWeight: 700
							}}
						>
							NEW PROJECT
						</p>
						<h2 id="new-project-title">Create a Project</h2>
					</div>
					<button
						className="icon-button dialog-close"
						type="button"
						aria-label="Close new project dialog"
						onClick={closeNewProjectDialog}
					>
						×
					</button>
				</div>

				<div className="new-project-body">
					{/* Left: Presets Grid */}
					<div className="new-project-main">
						<div className="new-project-tabs" role="tablist" aria-label="Preset categories">
							<button
								type="button"
								role="tab"
								aria-selected={activeCategory === 'all'}
								className={`new-project-tab ${activeCategory === 'all' ? 'is-active' : ''}`}
								onClick={() => setActiveCategory('all')}
							>
								All Presets
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={activeCategory === 'social'}
								className={`new-project-tab ${activeCategory === 'social' ? 'is-active' : ''}`}
								onClick={() => setActiveCategory('social')}
							>
								Social Media
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={activeCategory === 'film'}
								className={`new-project-tab ${activeCategory === 'film' ? 'is-active' : ''}`}
								onClick={() => setActiveCategory('film')}
							>
								Film & Video
							</button>
							<button
								type="button"
								role="tab"
								aria-selected={activeCategory === 'custom'}
								className={`new-project-tab ${activeCategory === 'custom' ? 'is-active' : ''}`}
								onClick={() => {
									setActiveCategory('custom');
									setSelectedPresetId('custom');
								}}
							>
								Custom
							</button>
						</div>

						<div className="new-project-presets-scroll">
							<p className="new-project-presets-section-title">
								{activeCategory === 'all'
									? 'Standard & Social Presets'
									: activeCategory === 'social'
										? 'Social Media Destinations'
										: activeCategory === 'film'
											? 'Film & Video Formats'
											: 'Custom Canvas'}
							</p>

							<div className="new-project-presets-grid" role="listbox" aria-label="Project presets">
								{filteredPresets.map((preset) => {
									const isSelected = selectedPresetId === preset.id;
									return (
										<div
											key={preset.id}
											role="option"
											aria-selected={isSelected}
											tabIndex={0}
											className={`preset-card ${isSelected ? 'is-selected' : ''}`}
											onClick={() => handleSelectPreset(preset)}
											onKeyDown={(e) => {
												if (e.key === 'Enter' || e.key === ' ') {
													e.preventDefault();
													handleSelectPreset(preset);
												}
											}}
										>
											<div className="preset-aspect-wireframe">
												<div
													className="aspect-box"
													style={{
														width: `${preset.wireframe.w}px`,
														height: `${preset.wireframe.h}px`
													}}
												/>
											</div>
											<div className="preset-title">{preset.title}</div>
											<div className="preset-dimensions">
												{preset.width} × {preset.height}
											</div>
											<span className="preset-badge">{preset.aspectRatioLabel}</span>
										</div>
									);
								})}

								{(activeCategory === 'all' || activeCategory === 'custom') && (
									<div
										role="option"
										aria-selected={selectedPresetId === 'custom'}
										tabIndex={0}
										className={`preset-card ${selectedPresetId === 'custom' ? 'is-selected' : ''}`}
										onClick={() => setSelectedPresetId('custom')}
										onKeyDown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												setSelectedPresetId('custom');
											}
										}}
									>
										<div className="preset-aspect-wireframe">
											<div
												className="aspect-box"
												style={{
													width: '34px',
													height: '34px',
													borderStyle: 'dashed'
												}}
											>
												<span style={{ fontSize: '15px', color: '#94a3b8' }}>+</span>
											</div>
										</div>
										<div className="preset-title">Custom</div>
										<div className="preset-dimensions">
											{width} × {height}
										</div>
										<span className="preset-badge">Custom</span>
									</div>
								)}
							</div>
						</div>
					</div>

					{/* Right: Preset Details Sidebar */}
					<div className="new-project-sidebar">
						<div className="sidebar-fields">
							<p className="sidebar-heading">Preset Details</p>

							<label className="dialog-field">
								<span>Project name</span>
								<input
									ref={nameRef}
									type="text"
									name="project-name"
									autoComplete="off"
									maxLength={80}
									required
									value={name}
									aria-invalid={message.length > 0}
									aria-describedby={message ? 'new-project-error' : undefined}
									onChange={(event) => setName(event.currentTarget.value)}
								/>
							</label>

							<div className="dimension-row">
								<label className="dialog-field">
									<span>Width</span>
									<div className="input-with-unit">
										<input
											type="number"
											name="project-width"
											min={128}
											max={7680}
											value={width}
											onChange={(e) =>
												handleWidthChange(Math.max(1, Number(e.currentTarget.value)))
											}
											required
										/>
										<span className="unit-tag">px</span>
									</div>
								</label>
								<label className="dialog-field">
									<span>Height</span>
									<div className="input-with-unit">
										<input
											type="number"
											name="project-height"
											min={128}
											max={7680}
											value={height}
											onChange={(e) =>
												handleHeightChange(Math.max(1, Number(e.currentTarget.value)))
											}
											required
										/>
										<span className="unit-tag">px</span>
									</div>
								</label>
							</div>

							<div className="orientation-row">
								<span className="orientation-label">Orientation</span>
								<div className="orientation-buttons">
									<button
										type="button"
										className={`orientation-btn ${isLandscape ? 'is-active' : ''}`}
										onClick={() => setOrientation('landscape')}
										aria-label="Landscape orientation"
										title="Landscape"
									>
										<svg
											width="15"
											height="15"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
										>
											<rect x="2" y="6" width="20" height="12" rx="2" />
										</svg>
										Landscape
									</button>
									<button
										type="button"
										className={`orientation-btn ${!isLandscape ? 'is-active' : ''}`}
										onClick={() => setOrientation('portrait')}
										aria-label="Portrait orientation"
										title="Portrait"
									>
										<svg
											width="15"
											height="15"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
										>
											<rect x="6" y="2" width="12" height="20" rx="2" />
										</svg>
										Portrait
									</button>
								</div>
							</div>

							<label className="dialog-field">
								<span>Frame rate</span>
								<select
									name="frame-rate"
									value={fps}
									onChange={(event) => setFps(Number(event.currentTarget.value))}
								>
									<option value={24}>24 fps (Cinematic)</option>
									<option value={25}>25 fps (PAL / Broadcast)</option>
									<option value={30}>30 fps (Web / Social standard)</option>
									<option value={60}>60 fps (High Smoothness)</option>
								</select>
							</label>

							<label className="dialog-field">
								<span>Audio sample rate</span>
								<select
									name="sample-rate"
									value={sampleRate}
									onChange={(event) => setSampleRate(Number(event.currentTarget.value))}
								>
									<option value={48000}>48 kHz (Broadcast standard)</option>
									<option value={44100}>44.1 kHz (CD quality)</option>
								</select>
							</label>

							{message && (
								<p
									ref={errorRef}
									id="new-project-error"
									className="dialog-message"
									role="alert"
									tabIndex={-1}
								>
									{message}
								</p>
							)}
						</div>

						<div className="sidebar-actions">
							<button className="secondary-button" type="button" onClick={closeNewProjectDialog}>
								Cancel
							</button>
							<button className="primary-button" type="submit">
								Create project
							</button>
						</div>
					</div>
				</div>
			</form>
		</dialog>
	);
}
