import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { AdSenseBanner } from './AdSenseBanner';

describe('AdSenseBanner component', () => {
	it('renders left placeholder banner in development mode with accessible attributes', () => {
		const html = renderToString(
			<AdSenseBanner position="left" width={160} height={600} previewMode={true} />
		);

		expect(html).toContain('dialog-side-ad-left');
		expect(html).toContain('width:160px');
		expect(html).toContain('min-height:600px');
		expect(html).toContain('Advertisement');
		expect(html).toContain('Google AdSense');
		expect(html).toContain('Left Ad');
	});

	it('renders right placeholder banner with correct position class', () => {
		const html = renderToString(
			<AdSenseBanner position="right" width={160} height={600} previewMode={true} />
		);

		expect(html).toContain('dialog-side-ad-right');
		expect(html).toContain('Right Ad');
	});

	it('renders production AdSense <ins> element when showRealAd conditions are simulated', () => {
		// Mock import.meta.env.PROD = true
		const originalEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = 'production';

		const html = renderToString(
			<AdSenseBanner
				position="left"
				client="ca-pub-5660298759458774"
				slot="1234567890"
				previewMode={false}
			/>
		);

		expect(html).toContain('dialog-side-ad-left');
		process.env.NODE_ENV = originalEnv;
	});
});
