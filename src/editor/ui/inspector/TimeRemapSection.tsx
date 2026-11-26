import { isSpeedExceedingMedia } from '../../core/timeRemap';
import type { Clip } from '../../core/types';
import { useEditorStore, useEditorStoreApi } from '../../state/EditorProvider';
import { PropertyRow, type ConfirmDisableState } from './Inspector';

interface TimeRemapSectionProps {
	clip: Clip;
	localTime: number;
	fps: number;
	confirmDisable?: ConfirmDisableState | null;
	onStartDisableConfirm?: (state: ConfirmDisableState) => void;
	onCancelDisableConfirm?: () => void;
}

export default function TimeRemapSection({
	clip,
	localTime,
	fps,
	confirmDisable = null,
	onStartDisableConfirm = () => {},
	onCancelDisableConfirm = () => {}
}: TimeRemapSectionProps) {
	const store = useEditorStoreApi();
	const project = useEditorStore((state) => state.project);
	const asset = clip.assetId && project ? project.assets[clip.assetId] : null;

	const isRemapEnabled = Boolean(clip.timeRemap);
	const exceedsMedia = asset ? isSpeedExceedingMedia(clip, asset) : false;
	const isReversed = clip.timeRemap
		? 'keyframes' in clip.timeRemap
			? clip.timeRemap.keyframes.some((k) => k.value < 0)
			: clip.timeRemap.value < 0
		: (clip.speed ?? 1) < 0;

	const handleToggleRemap = () => {
		if (isRemapEnabled) {
			store.getState().disableTimeRemap(clip.id, 'average');
		} else {
			store.getState().enableTimeRemap(clip.id);
		}
	};

	const handleMaintainPitchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		store.getState().setMaintainPitch([clip.id], e.target.checked);
	};

	const handleOpenGraph = () => {
		store.getState().setGraphOpen(true);
		store.getState().setGraphVisibleProperties(['timeRemap']);
	};

	return (
		<div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 'var(--spacing-xs)'
				}}
			>
				<button
					type="button"
					className={`secondary-button ${isReversed ? 'is-active' : ''}`}
					aria-pressed={isReversed}
					aria-label="Reverse Clip"
					style={{
						fontSize: '0.75rem',
						padding: '4px 8px',
						...(isReversed
							? {
									borderColor: 'var(--color-accent, #3b82f6)',
									color: 'var(--color-accent, #3b82f6)'
								}
							: {})
					}}
					onClick={() => store.getState().reverseClips([clip.id])}
				>
					⇄ {isReversed ? 'Reversed' : 'Reverse Clip'}
				</button>
				<button
					type="button"
					className="secondary-button"
					style={{ fontSize: '0.75rem', padding: '4px 8px' }}
					onClick={() => store.getState().openSpeedDialog(clip.id)}
				>
					Speed / Duration…
				</button>
			</div>

			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<label
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 'var(--spacing-xs)',
						cursor: 'pointer'
					}}
				>
					<input
						type="checkbox"
						checked={isRemapEnabled}
						aria-label="Enable Time Remapping"
						onChange={handleToggleRemap}
					/>
					<span
						style={{ fontWeight: 'var(--font-weight-medium)', fontSize: 'var(--text-body-sm)' }}
					>
						Enable Time Remapping
					</span>
				</label>

				{isRemapEnabled && (
					<button
						type="button"
						className="secondary-button"
						style={{ fontSize: '0.6875rem', padding: '2px 6px' }}
						onClick={handleOpenGraph}
					>
						Graph Editor
					</button>
				)}
			</div>

			{isRemapEnabled && (
				<>
					<PropertyRow
						clip={clip}
						propertyId="timeRemap"
						localTime={localTime}
						fps={fps}
						confirmDisable={confirmDisable}
						onStartDisableConfirm={onStartDisableConfirm}
						onCancelDisableConfirm={onCancelDisableConfirm}
					/>

					<label
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 'var(--spacing-xs)',
							cursor: 'pointer'
						}}
					>
						<input
							type="checkbox"
							checked={clip.maintainPitch ?? true}
							onChange={handleMaintainPitchChange}
						/>
						<span style={{ fontSize: 'var(--text-body-sm)', color: 'var(--color-mute)' }}>
							Maintain Audio Pitch
						</span>
					</label>

					{exceedsMedia && (
						<div
							style={{
								padding: '4px 8px',
								borderRadius: 'var(--radius-sm)',
								background: 'color-mix(in srgb, var(--color-warning, #f59e0b) 15%, transparent)',
								color: 'var(--color-warning, #f59e0b)',
								fontSize: 'var(--text-body-xs, 0.75rem)',
								display: 'flex',
								alignItems: 'center',
								gap: '4px'
							}}
							role="status"
						>
							<span aria-hidden="true">⚠️</span>
							<span>Speed curve exceeds media duration. End frame will be held freeze.</span>
						</div>
					)}
				</>
			)}
		</div>
	);
}
