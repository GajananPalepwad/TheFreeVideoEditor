import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TimelineTools } from './TimelineTools';

describe('TimelineTools component', () => {
	it('renders toolstrip container with all tools, tool names, and shortcut badges', () => {
		const html = renderToString(<TimelineTools activeTool="select" onSelectTool={() => {}} />);

		expect(html).toContain('timeline-toolstrip');
		expect(html).toContain('timeline-toolstrip-name');
		expect(html).toContain('timeline-toolstrip-shortcut');

		// Verify tool names are rendered in the DOM
		expect(html).toContain('Selection Tool');
		expect(html).toContain('Track Select Forward Tool');
		expect(html).toContain('Ripple Edit Tool');
		expect(html).toContain('Razor Tool');
		expect(html).toContain('Slip Tool');
		expect(html).toContain('Rectangle Tool');
		expect(html).toContain('Add Marker');
		expect(html).toContain('Text Tool');

		// Verify shortcut badges
		expect(html).toContain('V');
		expect(html).toContain('A');
		expect(html).toContain('B');
		expect(html).toContain('C');
		expect(html).toContain('Y');
		expect(html).toContain('M');
		expect(html).toContain('T');
	});

	it('indicates active tool state correctly with is-active and aria-pressed', () => {
		const html = renderToString(<TimelineTools activeTool="razor" onSelectTool={() => {}} />);

		// Razor tool should be active
		expect(html).toMatch(
			/class="[^"]*timeline-toolstrip-button[^"]*is-active[^"]*"[^>]*aria-label="Razor Tool \(C\)"/
		);
	});
});
