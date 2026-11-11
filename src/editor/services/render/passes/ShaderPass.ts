import type { EvaluatedEffect } from '../../../core/effects/types';
import type { FboPool, PooledFbo } from './FboPool';
import {
	BLIT_FRAG,
	BLIT_MIX_FRAG,
	CHROMA_KEY_FRAG,
	COLOR_CORRECTION_FRAG,
	CURVES_FRAG,
	DIRECTIONAL_BLUR_FRAG,
	DUOTONE_FRAG,
	FILM_GRAIN_FRAG,
	GAUSSIAN_BLUR_FRAG,
	GLOW_FRAG,
	INVERT_FRAG,
	LUT_3D_FRAG,
	MIRROR_FRAG,
	MOSAIC_FRAG,
	NEON_EDGES_FRAG,
	PASS_VERTEX_SHADER,
	RGB_SPLIT_FRAG,
	SCANLINES_FRAG,
	SEPIA_FRAG,
	SHARPEN_FRAG,
	SOLID_FRAG,
	VIGNETTE_FRAG,
	WAVE_DISTORT_FRAG,
	ZOOM_BLUR_FRAG
} from './effectsShaders';
import {
	CROSS_DISSOLVE_FRAG,
	DIP_TO_BLACK_FRAG,
	DIP_TO_WHITE_FRAG,
	FADE_FRAG,
	IRIS_FRAG,
	PUSH_FRAG,
	SLIDE_FRAG,
	WIPE_FRAG,
	ZOOM_DISSOLVE_FRAG,
	GLITCH_FRAG,
	LIGHT_LEAK_FRAG,
	RADIAL_WIPE_FRAG,
	BLINDS_FRAG,
	DIAMOND_FRAG,
	WHIP_PAN_FRAG,
	PIXELIZE_FRAG,
	SWIRL_FRAG,
	RIPPLE_FRAG,
	BLUR_DISSOLVE_FRAG
} from './transitionShaders';
import {
	RECT_MASK_FRAG,
	ELLIPSE_MASK_FRAG,
	MATTE_ACCUM_FRAG,
	MATTE_MULTIPLY_FRAG,
	FEATHER_BLUR_FRAG,
	PATH_MATTE_INIT_FRAG,
	BLIT_MASK_MIX_FRAG
} from './maskShaders';
import type { EvaluatedMask } from '../../../core/masks';
import { generateCompositeCurvesLut, type CurvePoint } from '../../../core/curves';
import type { ParsedLut3D } from '../../../core/lut';
import { ShaderCompileError } from '../RenderContext';

export function createShader(
	gl: WebGL2RenderingContext,
	type: number,
	source: string,
	name: string
): WebGLShader {
	const shader = gl.createShader(type);
	if (!shader) throw new ShaderCompileError(name, 'Could not create shader');
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader) ?? '';
		gl.deleteShader(shader);
		throw new ShaderCompileError(name, log);
	}
	return shader;
}

export function createProgram(
	gl: WebGL2RenderingContext,
	vsSource: string,
	fsSource: string,
	name: string
): WebGLProgram {
	const vs = createShader(gl, gl.VERTEX_SHADER, vsSource, `${name}_VS`);
	const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource, `${name}_FS`);
	const program = gl.createProgram();
	if (!program) throw new ShaderCompileError(name, 'Could not create program');
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program) ?? '';
		gl.deleteProgram(program);
		throw new ShaderCompileError(name, log);
	}
	return program;
}

export class ShaderPassManager {
	private readonly programs = new Map<string, WebGLProgram>();
	private quadVao: WebGLVertexArrayObject | null = null;
	private curveTextures = new Map<string, WebGLTexture>();
	private lut3dTextures = new Map<string, WebGLTexture>();
	private pathTextures = new Map<string, WebGLTexture>();
	private readonly targetIsCanvasLocs = new Map<WebGLProgram, WebGLUniformLocation | null>();

	constructor(private readonly gl: WebGL2RenderingContext) {
		this.quadVao = gl.createVertexArray();
	}

	get liveProgramsCount(): number {
		return this.programs.size;
	}

	get liveTexturesCount(): number {
		return this.curveTextures.size + this.lut3dTextures.size + this.pathTextures.size;
	}

	private getProgram(name: string, fsSource: string): WebGLProgram {
		let program = this.programs.get(name);
		if (!program) {
			program = createProgram(this.gl, PASS_VERTEX_SHADER, fsSource, name);
			this.programs.set(name, program);
		}
		return program;
	}

	/**
	 * Renders a fullscreen pass from inputTexture into targetFbo (or canvas if targetFbo is null).
	 */
	renderQuad(
		program: WebGLProgram,
		targetFbo: WebGLFramebuffer | null,
		width: number,
		height: number,
		inputTexture?: WebGLTexture
	): void {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);
		gl.viewport(0, 0, width, height);
		gl.disable(gl.BLEND);
		gl.useProgram(program);
		if (typeof gl.getUniformLocation === 'function') {
			let loc = this.targetIsCanvasLocs.get(program);
			if (loc === undefined) {
				loc = gl.getUniformLocation(program, 'u_targetIsCanvas');
				this.targetIsCanvasLocs.set(program, loc);
			}
			if (loc !== null) {
				gl.uniform1i(loc, targetFbo === null ? 1 : 0);
			}
		}
		if (inputTexture) {
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, inputTexture);
		}
		gl.bindVertexArray(this.quadVao);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		gl.bindVertexArray(null);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.bindTexture(gl.TEXTURE_3D, null);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.enable(gl.BLEND);
	}

	/** Blits a texture to target. */
	blit(
		sourceTexture: WebGLTexture,
		targetFbo: WebGLFramebuffer | null,
		width: number,
		height: number,
		opacity = 1.0,
		options: {
			keepAlpha?: boolean;
			dither?: boolean;
			bitDepth?: 8 | 10;
			frameIndex?: number;
		} = {}
	): void {
		const gl = this.gl;
		const program = this.getProgram('blit', BLIT_FRAG);
		gl.useProgram(program);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
		gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
		gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), opacity);
		const keepAlphaLoc = gl.getUniformLocation(program, 'u_keepAlpha');
		if (keepAlphaLoc !== null) gl.uniform1i(keepAlphaLoc, options.keepAlpha ? 1 : 0);
		const ditherLoc = gl.getUniformLocation(program, 'u_dither');
		if (ditherLoc !== null) gl.uniform1i(ditherLoc, options.dither ? 1 : 0);
		const bitDepthLoc = gl.getUniformLocation(program, 'u_bitDepth');
		if (bitDepthLoc !== null) gl.uniform1i(bitDepthLoc, options.bitDepth === 10 ? 10 : 8);
		const frameIndexLoc = gl.getUniformLocation(program, 'u_frameIndex');
		if (frameIndexLoc !== null) gl.uniform1ui(frameIndexLoc, (options.frameIndex ?? 0) >>> 0);
		this.renderQuad(program, targetFbo, width, height, sourceTexture);
	}

	/** Mixes two textures together by mix amount into target. */
	blitMix(
		originalTexture: WebGLTexture,
		processedTexture: WebGLTexture,
		targetFbo: WebGLFramebuffer | null,
		width: number,
		height: number,
		mix = 1.0
	): void {
		const gl = this.gl;
		const program = this.getProgram('blitMix', BLIT_MIX_FRAG);
		gl.useProgram(program);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, originalTexture);
		gl.uniform1i(gl.getUniformLocation(program, 'u_original'), 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, processedTexture);
		gl.uniform1i(gl.getUniformLocation(program, 'u_processed'), 1);
		gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);
		this.renderQuad(program, targetFbo, width, height);
	}

	/** Blits a solid color. */
	renderSolid(
		color: { r: number; g: number; b: number; a: number },
		targetFbo: WebGLFramebuffer | null,
		width: number,
		height: number
	): void {
		const gl = this.gl;
		const program = this.getProgram('solid', SOLID_FRAG);
		gl.useProgram(program);
		gl.uniform4f(gl.getUniformLocation(program, 'u_color'), color.r, color.g, color.b, color.a);
		this.renderQuad(program, targetFbo, width, height);
	}

	/**
	 * Blends fromTexture and toTexture with a transition of type and params at progress (0 to 1).
	 * Renders directly into targetFbo.
	 */
	applyTransition(
		type: string,
		fromTexture: WebGLTexture,
		toTexture: WebGLTexture,
		progress: number,
		params: Record<string, unknown>,
		targetFbo: WebGLFramebuffer | null,
		width: number,
		height: number
	): void {
		const gl = this.gl;
		const p = Math.max(0, Math.min(1, progress));

		let fsSource = CROSS_DISSOLVE_FRAG;
		let programName = 'trans_crossDissolve';

		switch (type) {
			case 'dipToBlack':
				fsSource = DIP_TO_BLACK_FRAG;
				programName = 'trans_dipToBlack';
				break;
			case 'dipToWhite':
				fsSource = DIP_TO_WHITE_FRAG;
				programName = 'trans_dipToWhite';
				break;
			case 'fade':
				fsSource = FADE_FRAG;
				programName = 'trans_fade';
				break;
			case 'wipe':
				fsSource = WIPE_FRAG;
				programName = 'trans_wipe';
				break;
			case 'slide':
				fsSource = SLIDE_FRAG;
				programName = 'trans_slide';
				break;
			case 'push':
				fsSource = PUSH_FRAG;
				programName = 'trans_push';
				break;
			case 'zoomDissolve':
				fsSource = ZOOM_DISSOLVE_FRAG;
				programName = 'trans_zoomDissolve';
				break;
			case 'iris':
				fsSource = IRIS_FRAG;
				programName = 'trans_iris';
				break;
			case 'glitch':
				fsSource = GLITCH_FRAG;
				programName = 'trans_glitch';
				break;
			case 'lightLeak':
				fsSource = LIGHT_LEAK_FRAG;
				programName = 'trans_lightLeak';
				break;
			case 'radialWipe':
				fsSource = RADIAL_WIPE_FRAG;
				programName = 'trans_radialWipe';
				break;
			case 'blinds':
				fsSource = BLINDS_FRAG;
				programName = 'trans_blinds';
				break;
			case 'diamond':
				fsSource = DIAMOND_FRAG;
				programName = 'trans_diamond';
				break;
			case 'whipPan':
				fsSource = WHIP_PAN_FRAG;
				programName = 'trans_whipPan';
				break;
			case 'pixelize':
				fsSource = PIXELIZE_FRAG;
				programName = 'trans_pixelize';
				break;
			case 'swirl':
				fsSource = SWIRL_FRAG;
				programName = 'trans_swirl';
				break;
			case 'ripple':
				fsSource = RIPPLE_FRAG;
				programName = 'trans_ripple';
				break;
			case 'blurDissolve':
				fsSource = BLUR_DISSOLVE_FRAG;
				programName = 'trans_blurDissolve';
				break;
			case 'crossDissolve':
			default:
				fsSource = CROSS_DISSOLVE_FRAG;
				programName = 'trans_crossDissolve';
				break;
		}

		const program = this.getProgram(programName, fsSource);
		gl.useProgram(program);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, fromTexture);
		gl.uniform1i(gl.getUniformLocation(program, 'u_fromTexture'), 0);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, toTexture);
		gl.uniform1i(gl.getUniformLocation(program, 'u_toTexture'), 1);

		gl.uniform1f(gl.getUniformLocation(program, 'u_progress'), p);

		if (type === 'wipe') {
			const angle = typeof params.angle === 'number' ? params.angle : 0;
			const softness = typeof params.softness === 'number' ? params.softness : 0.05;
			const reverse = params.reverse ? 1 : 0;
			gl.uniform1f(gl.getUniformLocation(program, 'u_angle'), angle);
			gl.uniform1f(gl.getUniformLocation(program, 'u_softness'), softness);
			gl.uniform1i(gl.getUniformLocation(program, 'u_reverse'), reverse);
		} else if (type === 'radialWipe') {
			const startAngle = typeof params.startAngle === 'number' ? params.startAngle : 0;
			const softness = typeof params.softness === 'number' ? params.softness : 0.02;
			const reverse = params.reverse ? 1 : 0;
			gl.uniform1f(gl.getUniformLocation(program, 'u_startAngle'), startAngle);
			gl.uniform1f(gl.getUniformLocation(program, 'u_softness'), softness);
			gl.uniform1i(gl.getUniformLocation(program, 'u_reverse'), reverse);
		} else if (type === 'blinds') {
			const count = typeof params.count === 'number' ? params.count : 10;
			const dir = params.direction === 'vertical' ? 1 : 0;
			const softness = typeof params.softness === 'number' ? params.softness : 0.03;
			gl.uniform1f(gl.getUniformLocation(program, 'u_count'), count);
			gl.uniform1i(gl.getUniformLocation(program, 'u_direction'), dir);
			gl.uniform1f(gl.getUniformLocation(program, 'u_softness'), softness);
		} else if (type === 'diamond') {
			const softness = typeof params.softness === 'number' ? params.softness : 0.05;
			const reverse = params.reverse ? 1 : 0;
			gl.uniform1f(gl.getUniformLocation(program, 'u_softness'), softness);
			gl.uniform1i(gl.getUniformLocation(program, 'u_reverse'), reverse);
		} else if (type === 'slide' || type === 'push' || type === 'whipPan') {
			const dir = params.direction ?? 'left';
			const dirCode = dir === 'right' ? 1 : dir === 'up' ? 2 : dir === 'down' ? 3 : 0;
			gl.uniform1i(gl.getUniformLocation(program, 'u_direction'), dirCode);
			if (type === 'whipPan') {
				const blur = typeof params.blur === 'number' ? params.blur : 0.6;
				gl.uniform1f(gl.getUniformLocation(program, 'u_blur'), blur);
			}
		} else if (type === 'zoomDissolve') {
			const scale = typeof params.scale === 'number' ? params.scale : 1.5;
			gl.uniform1f(gl.getUniformLocation(program, 'u_scale'), scale);
		} else if (type === 'iris') {
			const softness = typeof params.softness === 'number' ? params.softness : 0.05;
			const reverse = params.reverse ? 1 : 0;
			gl.uniform1f(gl.getUniformLocation(program, 'u_softness'), softness);
			gl.uniform1i(gl.getUniformLocation(program, 'u_reverse'), reverse);
		} else if (type === 'glitch') {
			const intensity = typeof params.intensity === 'number' ? params.intensity : 0.8;
			const colorShift = params.colorShift !== false ? 1 : 0;
			gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), intensity);
			gl.uniform1i(gl.getUniformLocation(program, 'u_colorShift'), colorShift);
		} else if (type === 'lightLeak') {
			const warmth = typeof params.warmth === 'number' ? params.warmth : 1.0;
			const intensity = typeof params.intensity === 'number' ? params.intensity : 1.2;
			gl.uniform1f(gl.getUniformLocation(program, 'u_warmth'), warmth);
			gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), intensity);
		} else if (type === 'pixelize') {
			const maxBlockSize = typeof params.maxBlockSize === 'number' ? params.maxBlockSize : 32.0;
			gl.uniform1f(gl.getUniformLocation(program, 'u_maxBlockSize'), maxBlockSize);
		} else if (type === 'swirl') {
			const radius = typeof params.radius === 'number' ? params.radius : 0.8;
			const turns = typeof params.turns === 'number' ? params.turns : 3.0;
			gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), radius);
			gl.uniform1f(gl.getUniformLocation(program, 'u_turns'), turns);
		} else if (type === 'ripple') {
			const frequency = typeof params.frequency === 'number' ? params.frequency : 25.0;
			const amplitude = typeof params.amplitude === 'number' ? params.amplitude : 0.06;
			const speed = typeof params.speed === 'number' ? params.speed : 2.0;
			gl.uniform1f(gl.getUniformLocation(program, 'u_frequency'), frequency);
			gl.uniform1f(gl.getUniformLocation(program, 'u_amplitude'), amplitude);
			gl.uniform1f(gl.getUniformLocation(program, 'u_speed'), speed);
		} else if (type === 'blurDissolve') {
			const angle = typeof params.angle === 'number' ? params.angle : 0;
			const strength = typeof params.strength === 'number' ? params.strength : 0.5;
			gl.uniform1f(gl.getUniformLocation(program, 'u_angle'), angle);
			gl.uniform1f(gl.getUniformLocation(program, 'u_strength'), strength);
		}

		this.renderQuad(program, targetFbo, width, height, fromTexture);
	}

	private getPathRasterTexture(
		mask: EvaluatedMask,
		width: number,
		height: number
	): WebGLTexture | null {
		const points = mask.points;
		if (!points || points.length === 0) return null;
		const hash = `${mask.id}:${mask.shape.join(',')}:${mask.expansion}:${width}:${height}`;
		let tex = this.pathTextures.get(hash);
		if (tex) return tex;

		const offscreen = new OffscreenCanvas(width, height);
		const ctx = offscreen.getContext('2d');
		if (!ctx) return null;

		ctx.clearRect(0, 0, width, height);
		const path = new Path2D();
		path.moveTo(points[0]!.x * width, points[0]!.y * height);
		for (let i = 1; i < points.length; i++) {
			const prev = points[i - 1]!;
			const curr = points[i]!;
			if (prev.outHandle || curr.inHandle) {
				const cp1x = (prev.x + (prev.outHandle?.x ?? 0)) * width;
				const cp1y = (prev.y + (prev.outHandle?.y ?? 0)) * height;
				const cp2x = (curr.x + (curr.inHandle?.x ?? 0)) * width;
				const cp2y = (curr.y + (curr.inHandle?.y ?? 0)) * height;
				path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, curr.x * width, curr.y * height);
			} else {
				path.lineTo(curr.x * width, curr.y * height);
			}
		}
		if (mask.closed && points.length >= 3) {
			const last = points[points.length - 1]!;
			const first = points[0]!;
			if (last.outHandle || first.inHandle) {
				const cp1x = (last.x + (last.outHandle?.x ?? 0)) * width;
				const cp1y = (last.y + (last.outHandle?.y ?? 0)) * height;
				const cp2x = (first.x + (first.inHandle?.x ?? 0)) * width;
				const cp2y = (first.y + (first.inHandle?.y ?? 0)) * height;
				path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, first.x * width, first.y * height);
			}
			path.closePath();
		}

		ctx.fillStyle = '#ffffff';
		if (mask.expansion > 0) {
			ctx.lineWidth = mask.expansion * 2;
			ctx.strokeStyle = '#ffffff';
			ctx.lineJoin = 'round';
			ctx.lineCap = 'round';
			ctx.stroke(path);
		}
		ctx.fill(path);

		const gl = this.gl;
		tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
		gl.bindTexture(gl.TEXTURE_2D, null);

		if (this.pathTextures.size >= 64) {
			const firstKey = this.pathTextures.keys().next().value;
			if (firstKey) {
				const oldTex = this.pathTextures.get(firstKey);
				if (oldTex) gl.deleteTexture(oldTex);
				this.pathTextures.delete(firstKey);
			}
		}

		this.pathTextures.set(hash, tex);
		return tex;
	}

	generateMaskMatte(
		mask: EvaluatedMask,
		fboPool: FboPool,
		width: number,
		height: number
	): PooledFbo {
		const gl = this.gl;
		const rawMatteFbo = fboPool.acquire(width, height);

		if (mask.type === 'rect') {
			const program = this.getProgram('rectMask', RECT_MASK_FRAG);
			gl.useProgram(program);
			const [cx, cy, w, h, rotDeg, roundness] = mask.shape;
			gl.uniform2f(gl.getUniformLocation(program, 'u_center'), cx ?? 0.5, cy ?? 0.5);
			gl.uniform2f(gl.getUniformLocation(program, 'u_size'), w ?? 0.4, h ?? 0.4);
			gl.uniform1f(gl.getUniformLocation(program, 'u_rotation'), ((rotDeg ?? 0) * Math.PI) / 180);
			gl.uniform1f(gl.getUniformLocation(program, 'u_roundness'), roundness ?? 0);
			gl.uniform1f(gl.getUniformLocation(program, 'u_expansion'), mask.expansion);
			gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
			gl.uniform1f(gl.getUniformLocation(program, 'u_inverted'), mask.inverted ? 1.0 : 0.0);
			gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), mask.opacity);
			this.renderQuad(program, rawMatteFbo.framebuffer, width, height);
		} else if (mask.type === 'ellipse') {
			const program = this.getProgram('ellipseMask', ELLIPSE_MASK_FRAG);
			gl.useProgram(program);
			const [cx, cy, rx, ry, rotDeg] = mask.shape;
			gl.uniform2f(gl.getUniformLocation(program, 'u_center'), cx ?? 0.5, cy ?? 0.5);
			gl.uniform2f(gl.getUniformLocation(program, 'u_radii'), rx ?? 0.2, ry ?? 0.2);
			gl.uniform1f(gl.getUniformLocation(program, 'u_rotation'), ((rotDeg ?? 0) * Math.PI) / 180);
			gl.uniform1f(gl.getUniformLocation(program, 'u_expansion'), mask.expansion);
			gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
			gl.uniform1f(gl.getUniformLocation(program, 'u_inverted'), mask.inverted ? 1.0 : 0.0);
			gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), mask.opacity);
			this.renderQuad(program, rawMatteFbo.framebuffer, width, height);
		} else {
			const rasterTex = this.getPathRasterTexture(mask, width, height);
			if (rasterTex) {
				const program = this.getProgram('pathMatteInit', PATH_MATTE_INIT_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, rasterTex);
				gl.uniform1i(gl.getUniformLocation(program, 'u_pathRaster'), 0);
				gl.uniform1f(gl.getUniformLocation(program, 'u_inverted'), mask.inverted ? 1.0 : 0.0);
				gl.uniform1f(gl.getUniformLocation(program, 'u_opacity'), mask.opacity);
				this.renderQuad(program, rawMatteFbo.framebuffer, width, height, rasterTex);
			} else {
				const clearVal = mask.inverted ? mask.opacity : 0.0;
				this.renderSolid(
					{ r: clearVal, g: clearVal, b: clearVal, a: clearVal },
					rawMatteFbo.framebuffer,
					width,
					height
				);
			}
		}

		if (mask.feather > 0) {
			const sigma = mask.feather / 2;
			let downscale = 1;
			if (sigma > 24 && width > 8 && height > 8) {
				downscale = 4;
			} else if (sigma > 10 && width > 4 && height > 4) {
				downscale = 2;
			}

			const blurW = Math.max(2, Math.floor(width / downscale));
			const blurH = Math.max(2, Math.floor(height / downscale));
			const effSigma = sigma / downscale;

			let srcTex = rawMatteFbo.texture;
			let downFbo: PooledFbo | null = null;
			if (downscale > 1) {
				downFbo = fboPool.acquire(blurW, blurH);
				this.blit(rawMatteFbo.texture, downFbo.framebuffer, blurW, blurH);
				srcTex = downFbo.texture;
			}

			const blurProg = this.getProgram('featherBlur', FEATHER_BLUR_FRAG);

			const hPassFbo = fboPool.acquire(blurW, blurH);
			gl.useProgram(blurProg);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, srcTex);
			gl.uniform1i(gl.getUniformLocation(blurProg, 'u_texture'), 0);
			gl.uniform2f(gl.getUniformLocation(blurProg, 'u_direction'), 1.0 / blurW, 0.0);
			gl.uniform1f(gl.getUniformLocation(blurProg, 'u_sigma'), effSigma);
			this.renderQuad(blurProg, hPassFbo.framebuffer, blurW, blurH, srcTex);

			if (downFbo) fboPool.release(downFbo);
			fboPool.release(rawMatteFbo);

			const vPassFbo = fboPool.acquire(blurW, blurH);
			gl.useProgram(blurProg);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, hPassFbo.texture);
			gl.uniform1i(gl.getUniformLocation(blurProg, 'u_texture'), 0);
			gl.uniform2f(gl.getUniformLocation(blurProg, 'u_direction'), 0.0, 1.0 / blurH);
			gl.uniform1f(gl.getUniformLocation(blurProg, 'u_sigma'), effSigma);
			this.renderQuad(blurProg, vPassFbo.framebuffer, blurW, blurH, hPassFbo.texture);
			fboPool.release(hPassFbo);

			if (downscale > 1) {
				const finalFbo = fboPool.acquire(width, height);
				this.blit(vPassFbo.texture, finalFbo.framebuffer, width, height);
				fboPool.release(vPassFbo);
				return finalFbo;
			}

			return vPassFbo;
		}

		return rawMatteFbo;
	}

	accumulateMasks(
		masks: readonly EvaluatedMask[],
		fboPool: FboPool,
		width: number,
		height: number
	): PooledFbo {
		const gl = this.gl;
		const active = masks.filter((m) => m?.enabled && !m.effectId);
		let accumFbo = fboPool.acquire(width, height);

		if (active.length === 0) {
			this.renderSolid({ r: 1, g: 1, b: 1, a: 1 }, accumFbo.framebuffer, width, height);
			return accumFbo;
		}

		const firstMode = active[0]!.mode;
		const initVal = firstMode === 'add' ? 0 : 1;
		this.renderSolid(
			{ r: initVal, g: initVal, b: initVal, a: initVal },
			accumFbo.framebuffer,
			width,
			height
		);

		const accumProg = this.getProgram('matteAccum', MATTE_ACCUM_FRAG);

		for (const mask of active) {
			const maskMatteFbo = this.generateMaskMatte(mask, fboPool, width, height);
			const nextAccumFbo = fboPool.acquire(width, height);

			gl.useProgram(accumProg);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, accumFbo.texture);
			gl.uniform1i(gl.getUniformLocation(accumProg, 'u_accumMatte'), 0);

			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, maskMatteFbo.texture);
			gl.uniform1i(gl.getUniformLocation(accumProg, 'u_maskMatte'), 1);

			const modeInt = mask.mode === 'add' ? 0 : mask.mode === 'subtract' ? 1 : 2;
			gl.uniform1i(gl.getUniformLocation(accumProg, 'u_mode'), modeInt);

			this.renderQuad(accumProg, nextAccumFbo.framebuffer, width, height);

			fboPool.release(accumFbo);
			fboPool.release(maskMatteFbo);
			accumFbo = nextAccumFbo;
		}

		return accumFbo;
	}

	applyMatteToTexture(
		layerTexture: WebGLTexture,
		matteTexture: WebGLTexture,
		fboPool: FboPool,
		width: number,
		height: number
	): PooledFbo {
		const gl = this.gl;
		const multProg = this.getProgram('matteMultiply', MATTE_MULTIPLY_FRAG);
		const outFbo = fboPool.acquire(width, height);

		gl.useProgram(multProg);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, layerTexture);
		gl.uniform1i(gl.getUniformLocation(multProg, 'u_layerTexture'), 0);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, matteTexture);
		gl.uniform1i(gl.getUniformLocation(multProg, 'u_matteTexture'), 1);

		this.renderQuad(multProg, outFbo.framebuffer, width, height);
		return outFbo;
	}

	/**
	 * Applies an evaluated effect to an input texture and outputs into an acquired FBO.
	 * Returns the new texture. The caller can release the previous intermediate FBO.
	 */
	applyEffect(
		effect: EvaluatedEffect,
		inputTexture: WebGLTexture,
		fboPool: FboPool,
		width: number,
		height: number,
		timeInTicks: number,
		lutGetter?: (lutId: string) => ParsedLut3D | null,
		maskTexture?: WebGLTexture | null
	): PooledFbo {
		const outFbo = this.runRawEffect(
			effect,
			inputTexture,
			fboPool,
			width,
			height,
			timeInTicks,
			lutGetter
		);
		if (maskTexture) {
			const gl = this.gl;
			const mix = typeof effect.params.mix === 'number' ? effect.params.mix : 1;
			const maskedFbo = fboPool.acquire(width, height);
			const mixProg = this.getProgram('blitMaskMix', BLIT_MASK_MIX_FRAG);
			gl.useProgram(mixProg);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, inputTexture);
			gl.uniform1i(gl.getUniformLocation(mixProg, 'u_original'), 0);
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, outFbo.texture);
			gl.uniform1i(gl.getUniformLocation(mixProg, 'u_processed'), 1);
			gl.activeTexture(gl.TEXTURE2);
			gl.bindTexture(gl.TEXTURE_2D, maskTexture);
			gl.uniform1i(gl.getUniformLocation(mixProg, 'u_maskMatte'), 2);
			gl.uniform1f(gl.getUniformLocation(mixProg, 'u_mix'), mix);
			this.renderQuad(mixProg, maskedFbo.framebuffer, width, height);
			fboPool.release(outFbo);
			return maskedFbo;
		}
		return outFbo;
	}

	private runRawEffect(
		effect: EvaluatedEffect,
		inputTexture: WebGLTexture,
		fboPool: FboPool,
		width: number,
		height: number,
		timeInTicks: number,
		lutGetter?: (lutId: string) => ParsedLut3D | null
	): PooledFbo {
		const gl = this.gl;
		const mix = typeof effect.params.mix === 'number' ? effect.params.mix : 1;

		switch (effect.type) {
			case 'gaussianBlur': {
				const radius = typeof effect.params.radius === 'number' ? effect.params.radius : 0;
				if (radius <= 0 || mix <= 0) {
					const outFbo = fboPool.acquire(width, height);
					this.blit(inputTexture, outFbo.framebuffer, width, height);
					return outFbo;
				}

				const program = this.getProgram('gaussianBlur', GAUSSIAN_BLUR_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), radius);
				gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);

				// For large radius >= 24, we use a 2x downscaled pass then upsample
				const useDownscale = radius >= 24 && width > 4 && height > 4;
				const blurW = useDownscale ? Math.max(2, Math.floor(width / 2)) : width;
				const blurH = useDownscale ? Math.max(2, Math.floor(height / 2)) : height;

				let srcTex = inputTexture;
				let downFbo: PooledFbo | null = null;
				if (useDownscale) {
					downFbo = fboPool.acquire(blurW, blurH);
					this.blit(inputTexture, downFbo.framebuffer, blurW, blurH);
					srcTex = downFbo.texture;
				}

				// Horizontal blur pass
				const hFbo = fboPool.acquire(blurW, blurH);
				gl.useProgram(program);
				gl.uniform2f(gl.getUniformLocation(program, 'u_direction'), 1.0 / blurW, 0.0);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), 1.0); // full mix for intermediate
				this.renderQuad(program, hFbo.framebuffer, blurW, blurH, srcTex);

				if (downFbo) fboPool.release(downFbo);

				// Vertical blur pass
				const outFbo = fboPool.acquire(width, height);
				gl.useProgram(program);
				gl.uniform2f(gl.getUniformLocation(program, 'u_direction'), 0.0, 1.0 / blurH);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);
				this.renderQuad(program, outFbo.framebuffer, width, height, hFbo.texture);

				fboPool.release(hFbo);
				return outFbo;
			}

			case 'sharpen': {
				const amount = typeof effect.params.amount === 'number' ? effect.params.amount : 0;
				const radius = typeof effect.params.radius === 'number' ? effect.params.radius : 1;
				const program = this.getProgram('sharpen', SHARPEN_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
				gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), amount);
				gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), radius);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'vignette': {
				const amount = typeof effect.params.amount === 'number' ? effect.params.amount : 0;
				const radius = typeof effect.params.radius === 'number' ? effect.params.radius : 0.8;
				const softness = typeof effect.params.softness === 'number' ? effect.params.softness : 0.5;
				const center = Array.isArray(effect.params.center) ? effect.params.center : [0.5, 0.5];

				const program = this.getProgram('vignette', VIGNETTE_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(
					gl.getUniformLocation(program, 'u_center'),
					center[0] ?? 0.5,
					center[1] ?? 0.5
				);
				gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), radius);
				gl.uniform1f(gl.getUniformLocation(program, 'u_softness'), softness);
				gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), amount);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'mosaic': {
				const blockSize = typeof effect.params.blockSize === 'number' ? effect.params.blockSize : 1;
				const program = this.getProgram('mosaic', MOSAIC_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
				gl.uniform1f(gl.getUniformLocation(program, 'u_blockSize'), blockSize);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'filmGrain': {
				const amount = typeof effect.params.amount === 'number' ? effect.params.amount : 0;
				const speed = typeof effect.params.speed === 'number' ? effect.params.speed : 1;
				const time = (timeInTicks / 1_000_000) * speed;

				const program = this.getProgram('filmGrain', FILM_GRAIN_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), amount);
				gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'invert': {
				const amount = typeof effect.params.amount === 'number' ? effect.params.amount : 0;
				const program = this.getProgram('invert', INVERT_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), amount);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'mirror': {
				const modeStr = effect.params.mode;
				const mode = modeStr === 'vertical' ? 1 : modeStr === 'quad' ? 2 : 0;
				const amount = typeof effect.params.amount === 'number' ? effect.params.amount : 0;

				const program = this.getProgram('mirror', MIRROR_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform1i(gl.getUniformLocation(program, 'u_mode'), mode);
				gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), amount);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'glow': {
				const threshold =
					typeof effect.params.threshold === 'number' ? effect.params.threshold : 0.8;
				const radius = typeof effect.params.radius === 'number' ? effect.params.radius : 0;
				const intensity = typeof effect.params.intensity === 'number' ? effect.params.intensity : 1;

				const program = this.getProgram('glow', GLOW_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
				gl.uniform1f(gl.getUniformLocation(program, 'u_threshold'), threshold);
				gl.uniform1f(gl.getUniformLocation(program, 'u_radius'), radius);
				gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), intensity);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'chromaKey': {
				let keyR = 0,
					keyG = 1,
					keyB = 0;
				if (Array.isArray(effect.params.color) && effect.params.color.length >= 3) {
					keyR = Number(effect.params.color[0]) || 0;
					keyG = Number(effect.params.color[1]) || 0;
					keyB = Number(effect.params.color[2]) || 0;
				} else if (typeof effect.params.color === 'string') {
					const hex = effect.params.color.replace('#', '');
					if (hex.length === 6) {
						keyR = parseInt(hex.slice(0, 2), 16) / 255;
						keyG = parseInt(hex.slice(2, 4), 16) / 255;
						keyB = parseInt(hex.slice(4, 6), 16) / 255;
					}
				}
				const tolerance = typeof effect.params.tolerance === 'number' ? effect.params.tolerance : 0;
				const softness = typeof effect.params.softness === 'number' ? effect.params.softness : 0.1;
				const spill = typeof effect.params.spill === 'number' ? effect.params.spill : 0.5;

				const program = this.getProgram('chromaKey', CHROMA_KEY_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform3f(gl.getUniformLocation(program, 'u_keyColor'), keyR, keyG, keyB);
				gl.uniform1f(gl.getUniformLocation(program, 'u_tolerance'), tolerance);
				gl.uniform1f(gl.getUniformLocation(program, 'u_softness'), softness);
				gl.uniform1f(gl.getUniformLocation(program, 'u_spill'), spill);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'colorCorrection': {
				const program = this.getProgram('colorCorrection', COLOR_CORRECTION_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_exposure'),
					(effect.params.exposure as number) ?? 0
				);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_contrast'),
					(effect.params.contrast as number) ?? 0
				);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_highlights'),
					(effect.params.highlights as number) ?? 0
				);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_shadows'),
					(effect.params.shadows as number) ?? 0
				);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_whites'),
					(effect.params.whites as number) ?? 0
				);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_blacks'),
					(effect.params.blacks as number) ?? 0
				);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_temperature'),
					(effect.params.temperature as number) ?? 0
				);
				gl.uniform1f(gl.getUniformLocation(program, 'u_tint'), (effect.params.tint as number) ?? 0);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_saturation'),
					(effect.params.saturation as number) ?? 0
				);
				gl.uniform1f(
					gl.getUniformLocation(program, 'u_vibrance'),
					(effect.params.vibrance as number) ?? 0
				);
				gl.uniform3f(
					gl.getUniformLocation(program, 'u_lift'),
					(effect.params.liftR as number) ?? 0,
					(effect.params.liftG as number) ?? 0,
					(effect.params.liftB as number) ?? 0
				);
				gl.uniform3f(
					gl.getUniformLocation(program, 'u_gamma'),
					(effect.params.gammaR as number) ?? 0,
					(effect.params.gammaG as number) ?? 0,
					(effect.params.gammaB as number) ?? 0
				);
				gl.uniform3f(
					gl.getUniformLocation(program, 'u_gain'),
					(effect.params.gainR as number) ?? 0,
					(effect.params.gainG as number) ?? 0,
					(effect.params.gainB as number) ?? 0
				);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'curves': {
				const curveLutData = generateCompositeCurvesLut(
					effect.params.rgb as CurvePoint[] | undefined,
					effect.params.red as CurvePoint[] | undefined,
					effect.params.green as CurvePoint[] | undefined,
					effect.params.blue as CurvePoint[] | undefined
				);
				let curveTex = this.curveTextures.get(effect.id);
				if (!curveTex) {
					curveTex = gl.createTexture()!;
					gl.bindTexture(gl.TEXTURE_2D, curveTex);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
					this.curveTextures.set(effect.id, curveTex);
				}
				const byteLut = new Uint8Array(256 * 4);
				for (let i = 0; i < 256 * 4; i += 1) {
					byteLut[i] = Math.round(Math.min(1, Math.max(0, curveLutData[i] ?? 0)) * 255);
				}
				gl.bindTexture(gl.TEXTURE_2D, curveTex);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, byteLut);

				const program = this.getProgram('curves', CURVES_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

				gl.activeTexture(gl.TEXTURE1);
				gl.bindTexture(gl.TEXTURE_2D, curveTex);
				gl.uniform1i(gl.getUniformLocation(program, 'u_curveLut'), 1);

				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'lut3d': {
				const lutAssetId = effect.params.lutAssetId as string;
				let intensity = 1;
				if (typeof effect.params.intensity === 'number' && !Number.isNaN(effect.params.intensity)) {
					intensity = effect.params.intensity;
				} else if (
					effect.params.intensity &&
					typeof effect.params.intensity === 'object' &&
					'value' in effect.params.intensity &&
					typeof (effect.params.intensity as { value: unknown }).value === 'number' &&
					!Number.isNaN((effect.params.intensity as { value: number }).value)
				) {
					intensity = (effect.params.intensity as { value: number }).value;
				}

				const lut = lutGetter ? lutGetter(lutAssetId) : null;
				if (!lut) {
					const outFbo = fboPool.acquire(width, height);
					this.blit(inputTexture, outFbo.framebuffer, width, height);
					return outFbo;
				}

				let lut3dTex = this.lut3dTextures.get(lutAssetId);
				if (!lut3dTex) {
					lut3dTex = gl.createTexture()!;
					gl.bindTexture(gl.TEXTURE_3D, lut3dTex);
					gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
					gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
					gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

					// WebGL forbids UNPACK_PREMULTIPLY_ALPHA_WEBGL for FLOAT and HALF_FLOAT textures.
					// We must temporarily set it to false during texture upload.
					const prevPremult = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
					gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

					let uploadSuccess = false;
					try {
						while (gl.getError() !== gl.NO_ERROR) {}
						gl.texImage3D(
							gl.TEXTURE_3D,
							0,
							gl.RGBA32F,
							lut.size,
							lut.size,
							lut.size,
							0,
							gl.RGBA,
							gl.FLOAT,
							lut.data
						);
						uploadSuccess = gl.getError() === gl.NO_ERROR;
					} catch {
						uploadSuccess = false;
					}

					if (!uploadSuccess) {
						// Fallback to RGBA8 for GPUs/drivers that do not support 32F 3D linear filtering
						while (gl.getError() !== gl.NO_ERROR) {}
						const u8 = new Uint8Array(lut.size * lut.size * lut.size * 4);
						for (let i = 0; i < u8.length; i += 1) {
							u8[i] = Math.round(Math.min(1, Math.max(0, lut.data[i] ?? 0)) * 255);
						}
						gl.texImage3D(
							gl.TEXTURE_3D,
							0,
							gl.RGBA8,
							lut.size,
							lut.size,
							lut.size,
							0,
							gl.RGBA,
							gl.UNSIGNED_BYTE,
							u8
						);
					}

					gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremult);
					this.lut3dTextures.set(lutAssetId, lut3dTex);
				}

				const program = this.getProgram('lut3d', LUT_3D_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

				gl.activeTexture(gl.TEXTURE1);
				gl.bindTexture(gl.TEXTURE_3D, lut3dTex);
				gl.uniform1i(gl.getUniformLocation(program, 'u_lut3d'), 1);

				gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), intensity);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);
				gl.uniform1f(gl.getUniformLocation(program, 'u_lutSize'), lut.size);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'rgbSplit': {
				const amount = typeof effect.params.amount === 'number' ? effect.params.amount : 0;
				const angleDeg = typeof effect.params.angle === 'number' ? effect.params.angle : 0;
				const angleRad = (angleDeg * Math.PI) / 180.0;

				const program = this.getProgram('rgbSplit', RGB_SPLIT_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
				gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), amount);
				gl.uniform1f(gl.getUniformLocation(program, 'u_angle'), angleRad);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'directionalBlur': {
				const length = typeof effect.params.length === 'number' ? effect.params.length : 0;
				const angleDeg = typeof effect.params.angle === 'number' ? effect.params.angle : 0;
				const angleRad = (angleDeg * Math.PI) / 180.0;

				const program = this.getProgram('directionalBlur', DIRECTIONAL_BLUR_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
				gl.uniform1f(gl.getUniformLocation(program, 'u_length'), length);
				gl.uniform1f(gl.getUniformLocation(program, 'u_angle'), angleRad);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'zoomBlur': {
				const strength = typeof effect.params.strength === 'number' ? effect.params.strength : 0;
				const center = Array.isArray(effect.params.center) ? effect.params.center : [0.5, 0.5];

				const program = this.getProgram('zoomBlur', ZOOM_BLUR_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(
					gl.getUniformLocation(program, 'u_center'),
					Number(center[0]) || 0.5,
					Number(center[1]) || 0.5
				);
				gl.uniform1f(gl.getUniformLocation(program, 'u_strength'), strength);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'scanlines': {
				const count = typeof effect.params.count === 'number' ? effect.params.count : 300;
				const intensity =
					typeof effect.params.intensity === 'number' ? effect.params.intensity : 0.35;
				const speed = typeof effect.params.speed === 'number' ? effect.params.speed : 1;
				const time = (timeInTicks / 1_000_000) * speed;

				const program = this.getProgram('scanlines', SCANLINES_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform1f(gl.getUniformLocation(program, 'u_count'), count);
				gl.uniform1f(gl.getUniformLocation(program, 'u_intensity'), intensity);
				gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'neonEdges': {
				const color = this.parseColorParam(effect.params.color, [0, 0.9, 1]);
				const threshold =
					typeof effect.params.threshold === 'number' ? effect.params.threshold : 0.15;
				const brightness =
					typeof effect.params.brightness === 'number' ? effect.params.brightness : 2.0;

				const program = this.getProgram('neonEdges', NEON_EDGES_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
				gl.uniform3f(gl.getUniformLocation(program, 'u_neonColor'), color[0], color[1], color[2]);
				gl.uniform1f(gl.getUniformLocation(program, 'u_threshold'), threshold);
				gl.uniform1f(gl.getUniformLocation(program, 'u_brightness'), brightness);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'duotone': {
				const shadowColor = this.parseColorParam(effect.params.shadowColor, [0.05, 0.05, 0.2]);
				const highlightColor = this.parseColorParam(effect.params.highlightColor, [1, 0.85, 0.6]);
				const contrast = typeof effect.params.contrast === 'number' ? effect.params.contrast : 0;

				const program = this.getProgram('duotone', DUOTONE_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform3f(
					gl.getUniformLocation(program, 'u_shadowColor'),
					shadowColor[0],
					shadowColor[1],
					shadowColor[2]
				);
				gl.uniform3f(
					gl.getUniformLocation(program, 'u_highlightColor'),
					highlightColor[0],
					highlightColor[1],
					highlightColor[2]
				);
				gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), contrast);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'waveDistort': {
				const amplitude =
					typeof effect.params.amplitude === 'number' ? effect.params.amplitude : 15;
				const frequency =
					typeof effect.params.frequency === 'number' ? effect.params.frequency : 20;
				const speed = typeof effect.params.speed === 'number' ? effect.params.speed : 1.5;
				const time = timeInTicks / 1_000_000;

				const program = this.getProgram('waveDistort', WAVE_DISTORT_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
				gl.uniform1f(gl.getUniformLocation(program, 'u_amplitude'), amplitude);
				gl.uniform1f(gl.getUniformLocation(program, 'u_frequency'), frequency);
				gl.uniform1f(gl.getUniformLocation(program, 'u_speed'), speed);
				gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			case 'sepia': {
				const amount = typeof effect.params.amount === 'number' ? effect.params.amount : 0.8;

				const program = this.getProgram('sepia', SEPIA_FRAG);
				gl.useProgram(program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, inputTexture);
				gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
				gl.uniform1f(gl.getUniformLocation(program, 'u_amount'), amount);
				gl.uniform1f(gl.getUniformLocation(program, 'u_mix'), mix);

				const outFbo = fboPool.acquire(width, height);
				this.renderQuad(program, outFbo.framebuffer, width, height, inputTexture);
				return outFbo;
			}

			default: {
				const outFbo = fboPool.acquire(width, height);
				this.blit(inputTexture, outFbo.framebuffer, width, height);
				return outFbo;
			}
		}
	}

	private parseColorParam(
		val: unknown,
		fallback: [number, number, number]
	): [number, number, number] {
		if (Array.isArray(val) && val.length >= 3) {
			return [Number(val[0]) || 0, Number(val[1]) || 0, Number(val[2]) || 0];
		}
		if (typeof val === 'string') {
			const hex = val.replace('#', '');
			if (hex.length === 6) {
				return [
					parseInt(hex.slice(0, 2), 16) / 255,
					parseInt(hex.slice(2, 4), 16) / 255,
					parseInt(hex.slice(4, 6), 16) / 255
				];
			}
		}
		return fallback;
	}

	dispose(): void {
		const gl = this.gl;
		for (const p of this.programs.values()) gl.deleteProgram(p);
		this.programs.clear();
		this.targetIsCanvasLocs.clear();
		for (const t of this.curveTextures.values()) gl.deleteTexture(t);
		this.curveTextures.clear();
		for (const t of this.lut3dTextures.values()) gl.deleteTexture(t);
		this.lut3dTextures.clear();
		for (const t of this.pathTextures.values()) gl.deleteTexture(t);
		this.pathTextures.clear();
		if (this.quadVao) gl.deleteVertexArray(this.quadVao);
		this.quadVao = null;
	}
}
