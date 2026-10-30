import type { ExportProgress } from '../../services/export/exporter';

/** Frames that must be timed before the time left is shown, so the first guesses are not wildly off. */
const MIN_FRAMES_FOR_ESTIMATE = 30;

/** Writes a duration as m:ss, or h:mm:ss from one hour. Never negative, never fractional. */
export function formatClock(ms: number): string {
	const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = String(totalSeconds % 60).padStart(2, '0');
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
		: `${minutes}:${seconds}`;
}

/** The progress line under the bar: frames, speed, elapsed time, and the time left once it is reliable. */
export function describeProgress(progress: ExportProgress, elapsedMs: number): string {
	const parts = [`${progress.framesDone} / ${progress.totalFrames} frames`];
	if (progress.phase === 'rendering') {
		parts.push(`${progress.fps.toFixed(1)} fps`);
	}
	parts.push(
		progress.phase === 'complete'
			? `finished in ${formatClock(elapsedMs)}`
			: `${formatClock(elapsedMs)} elapsed`
	);
	const reliable =
		progress.phase === 'rendering' &&
		progress.framesDone >= MIN_FRAMES_FOR_ESTIMATE &&
		progress.fps > 0 &&
		Number.isFinite(progress.etaMs) &&
		progress.etaMs > 0;
	if (reliable) parts.push(`about ${formatClock(Math.ceil(progress.etaMs / 1000) * 1000)} left`);
	return parts.join(' · ');
}
