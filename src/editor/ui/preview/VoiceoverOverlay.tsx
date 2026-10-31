import { useEditorStore } from '../../state/EditorProvider';

function formatElapsed(microseconds: number): string {
	const totalSeconds = microseconds / 1_000_000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const tenths = Math.floor((totalSeconds % 1) * 10);
	return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export default function VoiceoverOverlay() {
	const voiceover = useEditorStore((state) => state.voiceover);

	if (voiceover.phase === 'idle' || voiceover.phase === 'requesting') {
		return null;
	}

	return (
		<div className="voiceover-overlay-root" role="status" aria-live="polite">
			{voiceover.phase === 'countdown' && (
				<div className="voiceover-countdown-box" data-testid="voiceover-countdown">
					<span className="voiceover-countdown-label">Recording in</span>
					<span className="voiceover-countdown-digit" key={voiceover.countdownValue}>
						{voiceover.countdownValue}
					</span>
				</div>
			)}

			{voiceover.phase === 'recording' && (
				<div className="voiceover-rec-badge" data-testid="voiceover-rec-badge">
					<span className="voiceover-rec-dot" aria-hidden="true" />
					<span className="voiceover-rec-text">REC</span>
					<span className="voiceover-rec-time">{formatElapsed(voiceover.elapsedDuration)}</span>
				</div>
			)}

			{voiceover.phase === 'saving' && (
				<div className="voiceover-saving-badge" data-testid="voiceover-saving-badge">
					<svg
						className="voiceover-spinner"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
					</svg>
					<span>Saving voiceover…</span>
				</div>
			)}
		</div>
	);
}
