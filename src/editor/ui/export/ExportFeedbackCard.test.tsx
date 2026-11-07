import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ExportFeedbackCard } from './ExportFeedbackCard';

describe('ExportFeedbackCard component', () => {
	it('renders rating stars, categories, and message input', () => {
		const html = renderToString(<ExportFeedbackCard />);

		expect(html).toContain('export-complete-feedback-card');
		expect(html).toContain('Rate your export experience');
		expect(html).toContain('export-feedback-stars');
		// Stars start empty at beginning
		expect(html).toContain('export-feedback-star-btn is-empty');
		expect(html).toContain('Tap to rate');
		// Category toggle chips replace the dropdown
		expect(html).toContain('export-feedback-category-toggles');
		expect(html).toContain('export-feedback-toggle-chip');
		expect(html).toContain('Export');
		expect(html).toContain('Feature Request');
		expect(html).toContain('Bug Report');
		expect(html).toContain('export-feedback-input');
		expect(html).toContain('Send');
	});
});
