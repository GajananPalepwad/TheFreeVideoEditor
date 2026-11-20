import { describe, expect, it, vi } from 'vitest';
import { FboPool } from './FboPool';
import { ShaderPassManager, createShader, createProgram } from './ShaderPass';
import { ShaderCompileError } from '../RenderContext';
import { GlCompositor } from '../GlCompositor';
import type { ActiveLayer } from '../../../core/playback';
import type { ClipId, TrackId } from '../../../core/types';
import * as effectsShaders from './effectsShaders';
import { applyExposure } from '../../../core/colorMath';
import layerFragSource from '../shaders/layer.frag.glsl?raw';

describe('passes regression tests (Gate J root causes & invariants)', () => {
	it('Root Cause 1: never samples from an FBO texture currently attached to the bound framebuffer', () => {
		let currentFbo: unknown = null;
		let currentAttachmentTexture: unknown = null;
		let currentBoundTex0: unknown = null;
		let drawCallCount = 0;

		const mockGl = {
			TEXTURE_2D: 0x0de1,
			TEXTURE0: 0x84c0,
			TEXTURE1: 0x84c1,
			FRAMEBUFFER: 0x8d40,
			COLOR_ATTACHMENT0: 0x8ce0,
			TRIANGLE_STRIP: 5,
			BLEND: 0x0be2,
			bindFramebuffer: vi.fn((_target: number, fbo: unknown) => {
				currentFbo = fbo;
			}),
			framebufferTexture2D: vi.fn(
				(_target: number, _attachment: number, _textarget: number, tex: unknown) => {
					currentAttachmentTexture = tex;
				}
			),
			activeTexture: vi.fn(),
			bindTexture: vi.fn((_target: number, tex: unknown) => {
				currentBoundTex0 = tex;
			}),
			viewport: vi.fn(),
			disable: vi.fn(),
			enable: vi.fn(),
			useProgram: vi.fn(),
			bindVertexArray: vi.fn(),
			createVertexArray: vi.fn(() => ({})),
			deleteVertexArray: vi.fn(),
			drawArrays: vi.fn(() => {
				drawCallCount++;
				// When rendering into an FBO, the input texture sampled on TEXTURE0
				// MUST NOT be the framebuffer's attached output texture!
				if (currentFbo !== null && currentAttachmentTexture !== null) {
					expect(currentBoundTex0).not.toBe(currentAttachmentTexture);
				}
			})
		} as unknown as WebGL2RenderingContext;

		const pass = new ShaderPassManager(mockGl);
		const inputTex = { id: 'input_texture' };
		const targetFbo = { id: 'target_fbo' };
		currentAttachmentTexture = { id: 'target_fbo_texture' };

		const mockProgram = { id: 'mock_program' } as unknown as WebGLProgram;
		pass.renderQuad(
			mockProgram,
			targetFbo as unknown as WebGLFramebuffer,
			100,
			100,
			inputTex as unknown as WebGLTexture
		);

		expect(drawCallCount).toBe(1);
	});

	it('Root Cause 2: throws ShaderCompileError with shader/program name using correct parameters', () => {
		// Test Shader compilation failure (must use getShaderParameter, not getProgramParameter)
		const mockGlShaderFail = {
			createShader: vi.fn(() => ({})),
			shaderSource: vi.fn(),
			compileShader: vi.fn(),
			getShaderParameter: vi.fn(() => false),
			getShaderInfoLog: vi.fn(() => 'syntax error in fragment shader'),
			deleteShader: vi.fn()
		} as unknown as WebGL2RenderingContext;

		expect(() => createShader(mockGlShaderFail, 0x8b30, 'invalid code', 'TEST_SHADER')).toThrow(
			ShaderCompileError
		);

		try {
			createShader(mockGlShaderFail, 0x8b30, 'invalid code', 'TEST_SHADER');
		} catch (err: unknown) {
			expect(err).toBeInstanceOf(ShaderCompileError);
			if (err instanceof ShaderCompileError) {
				expect(err.shader).toBe('TEST_SHADER');
				expect(err.message).toContain('syntax error in fragment shader');
			}
		}

		// Test Program link failure (must use getProgramParameter, not getShaderParameter)
		const mockGlLinkFail = {
			createShader: vi.fn(() => ({})),
			shaderSource: vi.fn(),
			compileShader: vi.fn(),
			getShaderParameter: vi.fn(() => true),
			deleteShader: vi.fn(),
			createProgram: vi.fn(() => ({})),
			attachShader: vi.fn(),
			linkProgram: vi.fn(),
			getProgramParameter: vi.fn(() => false),
			getProgramInfoLog: vi.fn(() => 'linking failed: uniform mismatch'),
			deleteProgram: vi.fn()
		} as unknown as WebGL2RenderingContext;

		expect(() => createProgram(mockGlLinkFail, 'vs_code', 'fs_code', 'TEST_PROGRAM')).toThrow(
			ShaderCompileError
		);

		try {
			createProgram(mockGlLinkFail, 'vs_code', 'fs_code', 'TEST_PROGRAM');
		} catch (err: unknown) {
			expect(err).toBeInstanceOf(ShaderCompileError);
			if (err instanceof ShaderCompileError) {
				expect(err.shader).toBe('TEST_PROGRAM');
				expect(err.message).toContain('linking failed: uniform mismatch');
			}
		}
	});

	it('Root Cause 3: shader sources contain no unguarded pow() calls prone to Metal NaNs', () => {
		const shadersCode = Object.values(effectsShaders).join('\n');

		// Find every pow( call
		const powMatches = [...shadersCode.matchAll(/\bpow\s*\(([^,]+),\s*([^)]+)\)/g)];
		expect(powMatches.length).toBeGreaterThan(0);

		for (const match of powMatches) {
			const baseExpr = match[1].trim();
			// Assert that baseExpr either has a max(..., base) or is guarded by a positive threshold
			const isSafe =
				baseExpr.includes('max(') ||
				baseExpr.includes('sBase') ||
				baseExpr.includes('hBase') ||
				baseExpr.includes('safe');
			expect(isSafe, `Unguarded pow call detected with base: ${baseExpr}`).toBe(true);
		}

		// Also check layer.frag.glsl
		const layerPowMatches = [...layerFragSource.matchAll(/\bpow\s*\(([^,]+),\s*([^)]+)\)/g)];
		for (const match of layerPowMatches) {
			const baseExpr = match[1].trim();
			const isSafe = baseExpr.includes('max(') || baseExpr.includes('safe');
			expect(isSafe, `Unguarded pow call in layer.frag.glsl: ${baseExpr}`).toBe(true);
		}
	});

	it('Root Cause 4: exposure formula doubles (+1 EV) and halves (-1 EV) without distortion', () => {
		// +1 EV stop = 2^1 = exactly 2.0x
		const [r1, g1, b1] = applyExposure(0.25, 0.4, 0.1, 1.0);
		expect(r1).toBeCloseTo(0.5, 4);
		expect(g1).toBeCloseTo(0.8, 4);
		expect(b1).toBeCloseTo(0.2, 4);

		// -1 EV stop = 2^-1 = exactly 0.5x
		const [rDown, gDown, bDown] = applyExposure(0.5, 0.8, 0.2, -1.0);
		expect(rDown).toBeCloseTo(0.25, 4);
		expect(gDown).toBeCloseTo(0.4, 4);
		expect(bDown).toBeCloseTo(0.1, 4);
	});

	it('FBO pool and ShaderPass leak counters return to 0 after dispose()', () => {
		const createdTextures = new Set<unknown>();
		const createdFramebuffers = new Set<unknown>();

		const mockGl = {
			RGBA8: 0x8058,
			RGBA: 0x1908,
			UNSIGNED_BYTE: 0x1401,
			TEXTURE_2D: 0x0de1,
			TEXTURE_MIN_FILTER: 0x2801,
			TEXTURE_MAG_FILTER: 0x2800,
			TEXTURE_WRAP_S: 0x2802,
			TEXTURE_WRAP_T: 0x2803,
			LINEAR: 0x2601,
			CLAMP_TO_EDGE: 0x812f,
			FRAMEBUFFER: 0x8d40,
			COLOR_ATTACHMENT0: 0x8ce0,
			FRAMEBUFFER_COMPLETE: 0x8cd5,
			createTexture: vi.fn(() => {
				const tex = { id: `tex_${createdTextures.size}` };
				createdTextures.add(tex);
				return tex;
			}),
			createFramebuffer: vi.fn(() => {
				const fbo = { id: `fbo_${createdFramebuffers.size}` };
				createdFramebuffers.add(fbo);
				return fbo;
			}),
			bindTexture: vi.fn(),
			texParameteri: vi.fn(),
			texImage2D: vi.fn(),
			bindFramebuffer: vi.fn(),
			framebufferTexture2D: vi.fn(),
			checkFramebufferStatus: vi.fn(() => 0x8cd5),
			deleteTexture: vi.fn((tex: unknown) => {
				createdTextures.delete(tex);
			}),
			deleteFramebuffer: vi.fn((fbo: unknown) => {
				createdFramebuffers.delete(fbo);
			}),
			createVertexArray: vi.fn(() => ({})),
			deleteVertexArray: vi.fn()
		} as unknown as WebGL2RenderingContext;

		const pool = new FboPool(mockGl);
		const fbo1 = pool.acquire(100, 100);
		const fbo2 = pool.acquire(100, 100);
		expect(fbo2.width).toBe(100);
		expect(pool.totalLive).toBe(2);
		expect(createdTextures.size).toBe(2);

		// Release back to pool
		pool.release(fbo1);
		expect(pool.totalLive).toBe(2); // 1 in-use, 1 pooled

		// Dispose pool
		pool.dispose();
		expect(pool.totalLive).toBe(0);
		expect(createdTextures.size).toBe(0);
		expect(createdFramebuffers.size).toBe(0);

		// ShaderPass program/texture disposal
		const pass = new ShaderPassManager(mockGl);
		expect(pass.liveProgramsCount).toBe(0);
		expect(pass.liveTexturesCount).toBe(0);
		pass.dispose();
		expect(pass.liveProgramsCount).toBe(0);
		expect(pass.liveTexturesCount).toBe(0);
	});

	it('isolates WebGL texture upload failures (e.g. SecurityError on cross-origin media)', () => {
		const mockGl = {
			getExtension: vi.fn(),
			createShader: vi.fn(() => ({})),
			shaderSource: vi.fn(),
			compileShader: vi.fn(),
			getShaderParameter: vi.fn(() => true),
			createProgram: vi.fn(() => ({})),
			attachShader: vi.fn(),
			linkProgram: vi.fn(),
			getProgramParameter: vi.fn(() => true),
			getUniformLocation: vi.fn((_p, name) => ({ name })),
			getAttribLocation: vi.fn(() => 0),
			createVertexArray: vi.fn(() => ({})),
			bindVertexArray: vi.fn(),
			createBuffer: vi.fn(() => ({})),
			bindBuffer: vi.fn(),
			bufferData: vi.fn(),
			enableVertexAttribArray: vi.fn(),
			vertexAttribPointer: vi.fn(),
			createTexture: vi.fn(() => ({})),
			bindTexture: vi.fn(),
			texParameteri: vi.fn(),
			disable: vi.fn(),
			enable: vi.fn(),
			pixelStorei: vi.fn(),
			blendFunc: vi.fn(),
			texImage2D: vi.fn(() => {
				throw new DOMException(
					"Failed to execute 'texImage2D' on 'WebGL2RenderingContext': The video element contains cross-origin data, and may not be loaded.",
					'SecurityError'
				);
			}),
			texSubImage2D: vi.fn(() => {
				throw new DOMException(
					"Failed to execute 'texSubImage2D' on 'WebGL2RenderingContext': The video element contains cross-origin data, and may not be loaded.",
					'SecurityError'
				);
			}),
			isContextLost: vi.fn(() => false),
			drawArrays: vi.fn(),
			deleteTexture: vi.fn(),
			deleteBuffer: vi.fn(),
			deleteVertexArray: vi.fn(),
			deleteProgram: vi.fn(),
			deleteShader: vi.fn(),
			bindFramebuffer: vi.fn(),
			viewport: vi.fn(),
			clearColor: vi.fn(),
			clear: vi.fn(),
			useProgram: vi.fn(),
			uniform1i: vi.fn(),
			uniform2f: vi.fn(),
			uniformMatrix3fv: vi.fn(),
			activeTexture: vi.fn(),
			TEXTURE_2D: 0x0de1,
			TEXTURE0: 0x84c0,
			RGBA8: 0x8058,
			RGBA: 0x1908,
			UNSIGNED_BYTE: 0x1401,
			COLOR_BUFFER_BIT: 0x4000,
			FRAMEBUFFER: 0x8d40,
			CLAMP_TO_EDGE: 0x812f,
			LINEAR: 0x2601,
			TEXTURE_MIN_FILTER: 0x2801,
			TEXTURE_MAG_FILTER: 0x2800,
			TEXTURE_WRAP_S: 0x2802,
			TEXTURE_WRAP_T: 0x2803,
			ARRAY_BUFFER: 0x8892,
			STATIC_DRAW: 0x88e4,
			FLOAT: 0x1406,
			DEPTH_TEST: 0x0b71,
			CULL_FACE: 0x0b44,
			BLEND: 0x0be2,
			UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
			UNPACK_FLIP_Y_WEBGL: 0x9240,
			ONE: 1,
			ONE_MINUS_SRC_ALPHA: 0x0303
		} as unknown as WebGL2RenderingContext;

		const mockCanvas = {
			getContext: vi.fn(() => mockGl),
			width: 1920,
			height: 1080,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		} as unknown as HTMLCanvasElement;

		const compositor = new GlCompositor(mockCanvas);
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		const layer: ActiveLayer = {
			clipId: 'clip-cross-origin' as ClipId,
			trackId: 'track-1' as TrackId,
			trackOrder: 0,
			sourceTime: 0,
			kind: 'video',
			opacity: 1
		};
		const crossOriginVideo = {
			videoWidth: 1920,
			videoHeight: 1080
		} as unknown as HTMLVideoElement;

		// Rendering should not throw despite texImage2D throwing SecurityError
		expect(() => {
			compositor.render({ width: 1920, height: 1080 }, [layer], () => crossOriginVideo);
		}).not.toThrow();

		expect(warnSpy).toHaveBeenCalledWith(
			'Failed to upload texture source to WebGL:',
			expect.any(Error)
		);
		warnSpy.mockRestore();
	});
});
