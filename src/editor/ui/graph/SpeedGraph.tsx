import { useMemo, useState } from 'react';
import {
	evaluate,
	isAnimated,
	propertyCurve,
	velocityCurve,
	type Clip,
	type Time
} from '../../core';
import type { GraphEditorCurve } from './GraphEditor';

interface Props {
	clip: Clip;
	curves: GraphEditorCurve[];
	minT: Time;
	maxT: Time;
	playhead: Time;
}

const PAD = { left: 56, right: 24, top: 18, bottom: 26 };

/** How fast each visible curve changes over time, in its display units per second. Read only. */
export default function SpeedGraph({ clip, curves, minT, maxT, playhead }: Props) {
	const [size, setSize] = useState({ width: 800, height: 190 });
	const { width, height } = size;
	const plotW = Math.max(10, width - PAD.left - PAD.right);
	const plotH = Math.max(10, height - PAD.top - PAD.bottom);

	const series = useMemo(() => {
		const count = Math.min(240, Math.max(40, Math.floor(plotW / 3)));
		return curves.flatMap((curve) => {
			const raw = propertyCurve(clip, curve.propertyId);
			if (!raw || !isAnimated(raw)) return [];
			const valueAt = (time: Time) => {
				const value = evaluate(raw, time);
				const channel = Array.isArray(value) ? (value[curve.channelIdx] ?? 0) : value;
				return (channel as number) * curve.desc.displayFactor;
			};
			return [{ curve, points: velocityCurve(valueAt, minT, maxT, count) }];
		});
	}, [clip, curves, minT, maxT, plotW]);

	let peak = 1;
	for (const { points } of series) {
		for (const point of points) peak = Math.max(peak, Math.abs(point.velocity));
	}
	peak *= 1.1;

	const x = (time: Time) => PAD.left + ((time - minT) / Math.max(1, maxT - minT)) * plotW;
	const y = (velocity: number) => PAD.top + ((peak - velocity) / (2 * peak)) * plotH;

	return (
		<svg
			ref={(element) => {
				if (
					element &&
					element.clientWidth > 0 &&
					element.clientHeight > 0 &&
					(element.clientWidth !== width || element.clientHeight !== height)
				) {
					setSize({ width: element.clientWidth, height: element.clientHeight });
				}
			}}
			className="graph-svg graph-speed-svg"
			data-testid="speed-graph"
			aria-label="Speed graph"
		>
			{[-1, -0.5, 0, 0.5, 1].map((fraction) => {
				const velocity = fraction * peak;
				return (
					<g key={fraction}>
						<line
							x1={PAD.left}
							y1={y(velocity)}
							x2={width - PAD.right}
							y2={y(velocity)}
							className={fraction === 0 ? 'graph-baseline-zero' : 'graph-grid-line'}
						/>
						<text
							x={PAD.left - 6}
							y={y(velocity) + 3.5}
							textAnchor="end"
							className="graph-axis-label"
						>
							{velocity.toFixed(Math.abs(velocity) < 10 ? 1 : 0)}
						</text>
					</g>
				);
			})}
			<text x={PAD.left} y={PAD.top - 5} className="graph-axis-label">
				units per second
			</text>
			{series.map(({ curve, points }) => (
				<path
					key={curve.id}
					className="graph-curve-path graph-speed-path"
					stroke={curve.color}
					d={points
						.map(
							(point, index) =>
								`${index === 0 ? 'M' : 'L'} ${x(point.time).toFixed(1)} ${y(point.velocity).toFixed(1)}`
						)
						.join(' ')}
				/>
			))}
			{playhead >= minT && playhead <= maxT && (
				<line
					x1={x(playhead)}
					y1={PAD.top}
					x2={x(playhead)}
					y2={height - PAD.bottom}
					className="graph-playhead-line"
				/>
			)}
		</svg>
	);
}
