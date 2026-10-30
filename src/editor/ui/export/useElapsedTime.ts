import { useEffect, useRef, useState } from 'react';

/** Milliseconds since `running` last turned true. Ticks every second and keeps its final value after. */
export function useElapsedTime(running: boolean): number {
	const [elapsedMs, setElapsedMs] = useState(0);
	const startedAt = useRef(0);

	useEffect(() => {
		if (!running) return;
		startedAt.current = performance.now();
		setElapsedMs(0);
		const tick = () => setElapsedMs(performance.now() - startedAt.current);
		const timer = window.setInterval(tick, 1000);
		return () => {
			window.clearInterval(timer);
			tick();
		};
	}, [running]);

	return elapsedMs;
}
