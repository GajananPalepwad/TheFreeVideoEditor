import { resolveFrame } from '../../core';
import { buildTemplatePreviewProject } from '../../core/templates/templatePreview';
import type { MotionGraphicTemplate } from '../../core/templates/templateTypes';
import type { Project, Time } from '../../core/types';
import { CompatibilityFrameProvider } from '../export/compatibilityFrameProvider';
import { createFrameRenderer, selectRenderer, type RendererKind } from './frameRenderer';
import type { FrameRenderer } from './GlCompositor';
import type { GlCanvas } from './RenderContext';

/** Where a frame is painted: a card's own 2D canvas. */
export interface TemplatePreviewTarget {
	context: CanvasRenderingContext2D;
	width: number;
	height: number;
}

interface RendererSlot {
	canvas: GlCanvas;
	renderer: FrameRenderer;
}

/** Fraction of the target kept clear around the graphic. */
const PADDING = 0.06;

/**
 * Draws template cards with the same pipeline as the Program monitor and export: a one-clip project
 * through `resolveFrame` and the frame renderer. One offscreen canvas per renderer kind is shared
 * by every card, and draws are serialised because the canvas holds a single frame at a time.
 */
export class TemplatePreviewRenderer {
	private readonly slots = new Map<RendererKind, RendererSlot>();
	private readonly projects = new WeakMap<MotionGraphicTemplate, Project>();
	private queue: Promise<unknown> = Promise.resolve();
	private disposed = false;

	get isDisposed(): boolean {
		return this.disposed;
	}

	/** Renders `template` at template-local `time` and paints it, centred, into `target`. */
	draw(
		template: MotionGraphicTemplate,
		time: Time,
		target: TemplatePreviewTarget
	): Promise<boolean> {
		const run = this.queue.then(() => this.drawNow(template, time, target));
		this.queue = run.catch(() => undefined);
		return run;
	}

	dispose(): void {
		this.disposed = true;
		for (const slot of this.slots.values()) slot.renderer.dispose();
		this.slots.clear();
	}

	private projectFor(template: MotionGraphicTemplate): Project {
		let project = this.projects.get(template);
		if (!project) {
			project = buildTemplatePreviewProject(template);
			this.projects.set(template, project);
		}
		return project;
	}

	private slotFor(kind: RendererKind, width: number, height: number): RendererSlot | null {
		let slot = this.slots.get(kind);
		if (!slot) {
			// Export already requires OffscreenCanvas; without it the cards simply stay blank.
			if (typeof OffscreenCanvas === 'undefined') return null;
			const canvas = new OffscreenCanvas(width, height);
			const renderer = createFrameRenderer(canvas, {
				forceCanvas2d: kind === 'canvas2d',
				preserveDrawingBuffer: true,
				alpha: true,
				onContextLost: () => this.slots.delete(kind)
			});
			if (!renderer) return null;
			slot = { canvas, renderer };
			this.slots.set(kind, slot);
		}
		if (slot.canvas.width !== width) slot.canvas.width = width;
		if (slot.canvas.height !== height) slot.canvas.height = height;
		return slot;
	}

	private async drawNow(
		template: MotionGraphicTemplate,
		time: Time,
		target: TemplatePreviewTarget
	): Promise<boolean> {
		if (this.disposed) return false;
		const project = this.projectFor(template);
		const { width, height } = project.settings;
		const slot = this.slotFor(selectRenderer(project), width, height);
		if (!slot) return false;
		const frame = resolveFrame(project, Math.max(0, Math.min(time, template.duration - 1)));
		const provider = new CompatibilityFrameProvider(project);
		try {
			await provider.prepare(frame.videoLayers);
			if (this.disposed) return false;
			const drawn = slot.renderer.render(
				{ width, height },
				frame.videoLayers,
				(layer) => provider.getFrame(layer),
				new Map(),
				{ transparent: true }
			);
			if (!drawn) return false;
			const fit = Math.min(target.width / width, target.height / height) * (1 - PADDING * 2);
			const drawWidth = width * fit;
			const drawHeight = height * fit;
			target.context.clearRect(0, 0, target.width, target.height);
			target.context.drawImage(
				slot.canvas as CanvasImageSource,
				(target.width - drawWidth) / 2,
				(target.height - drawHeight) / 2,
				drawWidth,
				drawHeight
			);
			return true;
		} finally {
			provider.dispose();
		}
	}
}

let shared: TemplatePreviewRenderer | null = null;

/** The one renderer behind every template card. */
export function getTemplatePreviewRenderer(): TemplatePreviewRenderer {
	if (!shared || shared.isDisposed) shared = new TemplatePreviewRenderer();
	return shared;
}
