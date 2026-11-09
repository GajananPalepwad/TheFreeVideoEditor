import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import TimelineToolbar from './TimelineToolbar';

describe('TimelineToolbar component', () => {
	it('renders layer buttons with tool-button-layer-suffix for hover expansion', () => {
		const html = renderToString(
			<TimelineToolbar
				playheadLabel="00:00:00:00"
				durationLabel="00:00:10:00"
				clipCount={1}
				pixelsPerSecond={100}
				onSplit={() => {}}
				onDelete={() => {}}
				onRippleDelete={() => {}}
				onZoom={() => {}}
				onFit={() => {}}
				onAddTrack={() => {}}
				onAddAdjustment={() => {}}
				onAddSolid={() => {}}
				onAddShape={() => {}}
				onAddText={() => {}}
				onAddCaption={() => {}}
			/>
		);

		// Verify layer suffix class is rendered on each layer button
		expect(html).toContain('tool-button-layer-suffix');

		// Verify each layer button has the base text and the suffix
		expect(html).toMatch(
			/Adjustment<span class="[^"]*tool-button-layer-suffix[^"]*">\s*Layer<\/span>/
		);
		expect(html).toMatch(/Solid<span class="[^"]*tool-button-layer-suffix[^"]*">\s*Layer<\/span>/);
		expect(html).toMatch(/Shape<span class="[^"]*tool-button-layer-suffix[^"]*">\s*Layer<\/span>/);
		expect(html).toMatch(/Text<span class="[^"]*tool-button-layer-suffix[^"]*">\s*Layer<\/span>/);
		expect(html).toMatch(
			/Caption<span class="[^"]*tool-button-layer-suffix[^"]*">\s*Layer<\/span>/
		);

		// Accessible aria-labels remain intact
		expect(html).toContain('aria-label="Adjustment Layer"');
		expect(html).toContain('aria-label="Solid Layer"');
		expect(html).toContain('aria-label="Shape Layer"');
		expect(html).toContain('aria-label="Text Layer"');
		expect(html).toContain('aria-label="Caption Layer"');
	});
});
