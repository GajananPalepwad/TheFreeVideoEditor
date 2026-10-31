import { timeToPixels } from '../../core';
import type { Time } from '../../core';

export interface RecordingBlockProps {
	startTime: Time;
	duration: Time;
	pixelsPerSecond: number;
}

function formatDuration(microseconds: number): string {
	const seconds = microseconds / 1_000_000;
	return `${seconds.toFixed(1)}s`;
}

export default function RecordingBlock({
	startTime,
	duration,
	pixelsPerSecond
}: RecordingBlockProps) {
	const left = timeToPixels(startTime, pixelsPerSecond);
	const width = Math.max(12, timeToPixels(duration, pixelsPerSecond));

	return (
		<div
			className="timeline-recording-block"
			style={{
				left: `${left}px`,
				width: `${width}px`
			}}
			role="status"
			aria-label={`Recording audio: ${formatDuration(duration)} elapsed`}
			data-testid="timeline-recording-block"
		>
			<span className="timeline-recording-block-indicator" aria-hidden="true">
				<span className="timeline-recording-block-dot" />
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
					<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
					<line x1="12" y1="19" x2="12" y2="22" />
				</svg>
			</span>
			<span className="timeline-recording-block-label">REC {formatDuration(duration)}</span>
		</div>
	);
}
