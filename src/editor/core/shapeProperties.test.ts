import { describe, expect, it } from 'vitest';
import { isAnimated } from './animation';
import { createEmptyProject } from './factory';
import { enableAnimation, setPropertyAtTime } from './keyframeEdit';
import { resolveFrame } from './playback';
import { descriptorFor, propertyCurve, readProperty } from './properties';
import type { Clip, ClipId, PropertyId, TrackId } from './types';

/** Every property the renderer reads for a shape (see the shape branch of `resolveFrame`). */
const SHAPE_PROPERTY_IDS: PropertyId[] = [
	'shape.width',
	'shape.height',
	'shape.fillColor',
	'shape.strokeColor',
	'shape.strokeWidth',
	'shape.cornerRadius',
	'shape.shadowColor',
	'shape.shadowBlur',
	'shape.shadowOffsetX',
	'shape.shadowOffsetY'
];

const FPS = 30;

function shapeClip(): Clip {
	return {
		id: 'shape-1' as ClipId,
		start: 0,
		duration: 2_000_000,
		sourceIn: 0,
		sourceOut: 2_000_000,
		speed: 1,
		volume: 1,
		source: {
			type: 'shape',
			shapeType: 'rect',
			width: 320,
			height: 180,
			fillColor: { r: 0.2, g: 0.4, b: 0.6, a: 1 },
			strokeColor: { r: 1, g: 1, b: 1, a: 0.5 },
			strokeWidth: 6,
			cornerRadius: 24,
			shadowColor: { r: 0, g: 0, b: 0, a: 0.4 },
			shadowBlur: 12,
			shadowOffsetX: 3,
			shadowOffsetY: 8
		}
	};
}

describe('shape properties', () => {
	it.each(SHAPE_PROPERTY_IDS)('%s has a property descriptor', (id) => {
		expect(descriptorFor(id)).toBeDefined();
	});

	it('describes colours as RGBA and sizes as non-negative numbers', () => {
		expect(descriptorFor('shape.fillColor')).toMatchObject({ shape: 'vec4', min: 0, max: 1 });
		expect(descriptorFor('shape.cornerRadius')).toMatchObject({ shape: 'number', min: 0 });
		expect(descriptorFor('shape.width')).toMatchObject({ shape: 'number', min: 1 });
	});

	it('reads the shape source value when the property has no curve', () => {
		const clip = shapeClip();

		expect(readProperty(clip, 'shape.cornerRadius', 0)).toBe(24);
		expect(readProperty(clip, 'shape.width', 0)).toBe(320);
		expect(readProperty(clip, 'shape.fillColor', 0)).toEqual([0.2, 0.4, 0.6, 1]);
		expect(readProperty(clip, 'shape.shadowOffsetY', 0)).toBe(8);
	});

	it('starts an animation from the shape source value, not the default', () => {
		const animated = enableAnimation(shapeClip(), 'shape.cornerRadius', 0, FPS);

		const curve = propertyCurve(animated, 'shape.cornerRadius')!;
		expect(isAnimated(curve)).toBe(true);
		expect(readProperty(animated, 'shape.cornerRadius', 0)).toBe(24);
	});

	it('keyframes a shape property and the renderer follows the curve', () => {
		let clip = enableAnimation(shapeClip(), 'shape.cornerRadius', 0, FPS);
		clip = setPropertyAtTime(clip, 'shape.cornerRadius', 1_000_000, 60, {
			autoKey: true,
			fps: FPS
		});
		clip = setPropertyAtTime(clip, 'shape.fillColor', 0, [1, 0, 0, 1], {
			autoKey: false,
			fps: FPS
		});
		const project = createEmptyProject({ name: 'Shape keys' });
		const track = project.tracks.find((candidate) => candidate.kind === 'video')!;
		const withClip = {
			...project,
			tracks: project.tracks.map((candidate) =>
				candidate.id === (track.id as TrackId) ? { ...candidate, clips: [clip] } : candidate
			)
		};

		const [layer] = resolveFrame(withClip, 1_000_000).videoLayers;

		expect(layer!.shapeData!.cornerRadius).toBe(60);
		expect(layer!.shapeData!.fillColor).toEqual({ r: 1, g: 0, b: 0, a: 1 });
	});

	it('clamps a shape value to the descriptor range', () => {
		const clip = setPropertyAtTime(shapeClip(), 'shape.cornerRadius', 0, -10, {
			autoKey: false,
			fps: FPS
		});

		expect(readProperty(clip, 'shape.cornerRadius', 0)).toBe(0);
	});
});
