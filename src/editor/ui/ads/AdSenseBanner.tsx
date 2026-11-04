import { useEffect, useRef } from 'react';
import './ads.css';

export interface AdSenseBannerProps {
	/** Google AdSense Publisher ID (defaults to user's client ID). */
	client?: string;
	/** AdSense Ad Unit Slot ID (optional, defaults to empty or auto). */
	slot?: string;
	/** Ad unit width in pixels (defaults to 160 for Wide Skyscraper). */
	width?: number;
	/** Ad unit height in pixels (defaults to 600 for Wide Skyscraper). */
	height?: number;
	/** Side position relative to the dialog ('left' or 'right'). */
	position: 'left' | 'right';
	/** Accessibility label and top badge text (defaults to 'Advertisement'). */
	label?: string;
	/** Force placeholder preview mode regardless of environment. */
	previewMode?: boolean;
}

const DEFAULT_CLIENT_ID = 'ca-pub-5660298759458774';

/**
 * Renders a 160x600 skyscraper ad banner positioned beside dialog popups.
 * In development, renders a styled placeholder box. In production, mounts
 * the Google AdSense <ins> unit and pushes to the ad queue.
 */
export function AdSenseBanner({
	client = DEFAULT_CLIENT_ID,
	slot = '',
	width = 160,
	height = 600,
	position,
	label = 'Advertisement',
	previewMode
}: AdSenseBannerProps) {
	const adRef = useRef<HTMLModElement>(null);
	const isProd = import.meta.env?.PROD ?? false;
	const showRealAd = isProd && !previewMode && Boolean(client);

	useEffect(() => {
		if (!showRealAd) return;
		try {
			const win = window as unknown as { adsbygoogle?: unknown[] };
			win.adsbygoogle = win.adsbygoogle || [];
			win.adsbygoogle.push({});
		} catch (error) {
			console.warn('Google AdSense load error:', error);
		}
	}, [showRealAd, slot]);

	return (
		<aside
			className={`dialog-side-ad dialog-side-ad-${position}`}
			style={{ width: `${width}px`, minHeight: `${height}px` }}
			aria-label={label}
		>
			<span className="dialog-ad-badge">{label}</span>
			{showRealAd ? (
				<ins
					ref={adRef}
					className="adsbygoogle"
					style={{ display: 'inline-block', width: `${width}px`, height: `${height}px` }}
					data-ad-client={client}
					{...(slot ? { 'data-ad-slot': slot } : {})}
					data-full-width-responsive="false"
				/>
			) : (
				<div
					className="dialog-ad-placeholder"
					style={{ width: `${width}px`, height: `${height}px` }}
					data-testid={`ad-placeholder-${position}`}
				>
					<div className="dialog-ad-placeholder-content">
						<svg
							className="dialog-ad-icon"
							width="24"
							height="24"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							aria-hidden="true"
						>
							<rect x="2" y="3" width="20" height="18" rx="2" />
							<line x1="8" y1="8" x2="16" y2="8" />
							<line x1="8" y1="12" x2="16" y2="12" />
							<line x1="8" y1="16" x2="12" y2="16" />
						</svg>
						<span className="dialog-ad-title">Google AdSense</span>
						<span className="dialog-ad-dims">
							{width} × {height}
						</span>
						<span className="dialog-ad-pos">{position === 'left' ? 'Left Ad' : 'Right Ad'}</span>
					</div>
				</div>
			)}
		</aside>
	);
}
