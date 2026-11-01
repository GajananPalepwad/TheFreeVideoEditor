import { describe, it, expect } from 'vitest';
import { encodeWav } from './wavEncoder';

describe('wavEncoder', () => {
	it('encodes mono audio with valid 44-byte WAV header and PCM samples', () => {
		const sampleRate = 44100;
		// 3 samples: 0, 1.0, -1.0
		const channel = new Float32Array([0, 1.0, -1.0]);
		const buffer = encodeWav([channel], sampleRate);

		expect(buffer.byteLength).toBe(44 + 3 * 2);

		const view = new DataView(buffer);
		// Check "RIFF"
		const riff = String.fromCharCode(
			view.getUint8(0),
			view.getUint8(1),
			view.getUint8(2),
			view.getUint8(3)
		);
		expect(riff).toBe('RIFF');

		// File length - 8
		expect(view.getUint32(4, true)).toBe(44 + 6 - 8);

		// Check "WAVE"
		const wave = String.fromCharCode(
			view.getUint8(8),
			view.getUint8(9),
			view.getUint8(10),
			view.getUint8(11)
		);
		expect(wave).toBe('WAVE');

		// Check "fmt "
		const fmt = String.fromCharCode(
			view.getUint8(12),
			view.getUint8(13),
			view.getUint8(14),
			view.getUint8(15)
		);
		expect(fmt).toBe('fmt ');

		// Subchunk1Size = 16
		expect(view.getUint32(16, true)).toBe(16);
		// AudioFormat = 1 (PCM)
		expect(view.getUint16(20, true)).toBe(1);
		// NumChannels = 1
		expect(view.getUint16(22, true)).toBe(1);
		// SampleRate = 44100
		expect(view.getUint32(24, true)).toBe(44100);
		// ByteRate = 44100 * 1 * 2 = 88200
		expect(view.getUint32(28, true)).toBe(88200);
		// BlockAlign = 2
		expect(view.getUint16(32, true)).toBe(2);
		// BitsPerSample = 16
		expect(view.getUint16(34, true)).toBe(16);

		// Check "data"
		const data = String.fromCharCode(
			view.getUint8(36),
			view.getUint8(37),
			view.getUint8(38),
			view.getUint8(39)
		);
		expect(data).toBe('data');
		// Data length = 6 bytes
		expect(view.getUint32(40, true)).toBe(6);

		// Samples
		expect(view.getInt16(44, true)).toBe(0);
		expect(view.getInt16(46, true)).toBe(32767);
		expect(view.getInt16(48, true)).toBe(-32768);
	});

	it('interleaves stereo channels properly', () => {
		const sampleRate = 48000;
		const left = new Float32Array([0.5, -0.5]);
		const right = new Float32Array([-0.25, 0.25]);

		const buffer = encodeWav([left, right], sampleRate);
		expect(buffer.byteLength).toBe(44 + 4 * 2);

		const view = new DataView(buffer);
		expect(view.getUint16(22, true)).toBe(2); // 2 channels
		expect(view.getUint32(24, true)).toBe(48000);
		expect(view.getUint32(28, true)).toBe(48000 * 2 * 2); // 192000

		// Sample 0: left then right
		expect(view.getInt16(44, true)).toBe(Math.round(0.5 * 32767));
		expect(view.getInt16(46, true)).toBe(Math.round(-0.25 * 32768));

		// Sample 1: left then right
		expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 32768));
		expect(view.getInt16(50, true)).toBe(Math.round(0.25 * 32767));
	});

	it('clamps values beyond [-1.0, 1.0]', () => {
		const sampleRate = 48000;
		const channel = new Float32Array([2.5, -3.0]);
		const buffer = encodeWav([channel], sampleRate);

		const view = new DataView(buffer);
		expect(view.getInt16(44, true)).toBe(32767);
		expect(view.getInt16(46, true)).toBe(-32768);
	});
});
