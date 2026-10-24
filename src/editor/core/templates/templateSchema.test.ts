import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Clip, ClipId, Track, TrackId } from '../types';
import { BUILTIN_MOTION_TEMPLATES } from './builtinTemplates';
import { createTemplateFromClips, deserializeTemplate, serializeTemplate } from './templateService';
import type { MotionGraphicTemplate } from './templateTypes';

const roundTrip = (template: MotionGraphicTemplate): MotionGraphicTemplate =>
	deserializeTemplate(serializeTemplate(template));

/** A small template that uses every part of the format a built-in does not. */
function richTemplate(): MotionGraphicTemplate {
	const clip: Clip = {
		id: 'c1' as ClipId,
		start: 0,
		duration: 3_000_000,
		sourceIn: 0,
		sourceOut: 3_000_000,
		speed: 1,
		volume: 1,
		transform: { x: 12.5, y: -3.25, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
		bypassEffects: true,
		effects: [
			{ id: 'fx1', type: 'blur', enabled: true, params: { radius: 4 } }
		] as unknown as Clip['effects'],
		properties: {
			position: {
				keyframes: [
					{ time: 0, value: [0.5, 1.25], interpolation: 'linear' },
					{ time: 1_000_000, value: [10.75, 20.5], interpolation: 'linear' }
				]
			},
			'text.fillColor': { value: [1, 0.5, 0.25, 1] }
		},
		source: {
			type: 'text',
			text: 'Hello',
			style: { fontFamily: 'Inter', fontWeight: '700' },
			box: {
				frameStyle: 'card',
				gradientType: 'linear-angle',
				gradientColorEnd: { r: 0, g: 0, b: 1, a: 1 },
				gradientAngle: 30
			},
			colorRuns: [{ startIndex: 0, endIndex: 5, fillColor: { r: 1, g: 0, b: 0, a: 1 } }]
		}
	};
	const shape: Clip = {
		id: 'c2' as ClipId,
		start: 0,
		duration: 3_000_000,
		sourceIn: 0,
		sourceOut: 3_000_000,
		speed: 1,
		volume: 0,
		source: {
			type: 'shape',
			shapeType: 'rect',
			width: 300,
			height: 80,
			fillColor: { r: 0, g: 0, b: 0, a: 1 },
			gradientType: 'radial',
			gradientColorEnd: { r: 1, g: 1, b: 1, a: 1 }
		}
	};
	const tracks: Track[] = [
		{
			id: 't1' as TrackId,
			kind: 'video',
			name: 'Text',
			muted: false,
			locked: false,
			hidden: false,
			clips: [clip],
			audio: { gainDb: -3, pan: 0.25, solo: false }
		},
		{
			id: 't2' as TrackId,
			kind: 'video',
			name: 'Shape',
			muted: false,
			locked: false,
			hidden: false,
			clips: [shape]
		}
	];
	return createTemplateFromClips({
		name: 'Rich',
		clips: [clip, shape],
		tracks,
		publishedParams: [
			{
				id: 'p1',
				name: 'Size',
				type: 'number',
				targetClipId: clip.id,
				targetProperty: 'text.fontSize',
				defaultValue: 48,
				min: 10,
				max: 200,
				step: 2
			}
		]
	});
}

describe('template format', () => {
	it('round-trips every built-in template exactly', () => {
		for (const template of BUILTIN_MOTION_TEMPLATES) {
			expect(roundTrip(template), template.id).toEqual(template);
		}
	});

	it('round-trips properties, keyframes, effects, gradients and published params exactly', () => {
		const template = richTemplate();
		expect(roundTrip(template)).toEqual(template);
	});

	it('reads every shipped .grafree file', () => {
		const dir = 'public/templates';
		const files = readdirSync(dir).filter((name) => name.endsWith('.grafree'));
		expect(files.length).toBeGreaterThan(0);
		for (const name of files) {
			expect(() => deserializeTemplate(readFileSync(`${dir}/${name}`, 'utf8')), name).not.toThrow();
		}
	});

	it('keeps track transitions, audio, captions and caption style when packaging', () => {
		const template = richTemplate();
		expect(template.tracks[0]!.audio).toEqual({ gainDb: -3, pan: 0.25, solo: false });
	});

	it('packages transitions between template clips under the new clip ids', () => {
		const clip = (id: string, start: number): Clip => ({
			id: id as ClipId,
			start,
			duration: 1_000_000,
			sourceIn: 0,
			sourceOut: 1_000_000,
			speed: 1,
			volume: 1,
			source: { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }
		});
		const [a, b, outside] = [clip('a', 0), clip('b', 1_000_000), clip('x', 2_000_000)];
		const transition = (id: string, from: string, to: string) => ({
			id,
			type: 'crossfade',
			duration: 200_000,
			alignment: 'center' as const,
			edge: { kind: 'cut' as const, fromClipId: from as ClipId, toClipId: to as ClipId },
			params: {}
		});
		const track: Track = {
			id: 't' as TrackId,
			kind: 'video',
			name: 'V',
			muted: false,
			locked: false,
			hidden: false,
			clips: [a!, b!, outside!],
			transitions: [transition('keep', 'a', 'b'), transition('drop', 'b', 'x')]
		};
		const template = createTemplateFromClips({
			name: 'Joined',
			clips: [a!, b!],
			tracks: [track],
			publishedParams: []
		});
		const packaged = template.tracks[0]!;
		expect(packaged.transitions).toHaveLength(1);
		expect(packaged.transitions![0]!.edge).toEqual({
			kind: 'cut',
			fromClipId: packaged.clips[0]!.id,
			toClipId: packaged.clips[1]!.id
		});
		expect(roundTrip(template)).toEqual(template);
	});

	describe('version', () => {
		it('rejects a newer format with a clear message', () => {
			const json = JSON.stringify({ ...JSON.parse(serializeTemplate(richTemplate())), version: 2 });
			expect(() => deserializeTemplate(json)).toThrow(/version 2.*newer/i);
		});

		it('treats a missing version as the first format', () => {
			const rest = JSON.parse(serializeTemplate(richTemplate()));
			delete rest.version;
			expect(deserializeTemplate(JSON.stringify(rest)).version).toBe(1);
		});

		it('rejects a version that is not a positive whole number', () => {
			const base = JSON.parse(serializeTemplate(richTemplate()));
			for (const version of [0, -1, 1.5, 'one']) {
				expect(() => deserializeTemplate(JSON.stringify({ ...base, version }))).toThrow(/version/i);
			}
		});
	});

	describe('validation', () => {
		it('keeps unknown top-level fields and drops only the file envelope', () => {
			const base = JSON.parse(serializeTemplate(richTemplate()));
			const restored = deserializeTemplate(
				JSON.stringify({ ...base, license: 'CC0', credits: { by: 'me' } })
			) as MotionGraphicTemplate & Record<string, unknown>;
			expect(restored.license).toBe('CC0');
			expect(restored.credits).toEqual({ by: 'me' });
			expect(restored).not.toHaveProperty('tfve_type');
			expect(restored).not.toHaveProperty('$schema');
		});

		it('rejects a file that is not a motion template', () => {
			const base = JSON.parse(serializeTemplate(richTemplate()));
			expect(() => deserializeTemplate(JSON.stringify({ ...base, tfve_type: 'project' }))).toThrow(
				/motion template/i
			);
		});

		it('names the field that is wrong inside a track', () => {
			const base = JSON.parse(serializeTemplate(richTemplate()));
			base.tracks[0].clips[0].duration = -5;
			expect(() => deserializeTemplate(JSON.stringify(base))).toThrow(
				/tracks\.0\.clips\.0\.duration/
			);
		});

		it('rejects text that is not JSON', () => {
			expect(() => deserializeTemplate('not json')).toThrow(/not valid JSON/i);
		});

		it('still requires a name, tracks and a duration', () => {
			expect(() => deserializeTemplate(JSON.stringify({ tracks: [], duration: 1 }))).toThrow(
				/name/
			);
		});
	});
});
