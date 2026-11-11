import type { Clip, Track, TrackAudio, TrackCompressor, TrackEq } from './types';
import { evaluate } from './animation';

/** Floor in dB where audio is considered silence. */
export const AUDIO_MIN_DB = -96;
export const AUDIO_MAX_DB = 24;

/**
 * Convert decibels to linear amplitude gain.
 * db <= -96 returns exact 0.
 */
export function dbToGain(db: number): number {
	if (!Number.isFinite(db) || db <= AUDIO_MIN_DB) {
		return 0;
	}
	const clamped = Math.min(AUDIO_MAX_DB, db);
	return Math.pow(10, clamped / 20);
}

/**
 * Convert linear amplitude gain to decibels.
 * gain <= 0 returns -96 dB.
 */
export function gainToDb(gain: number): number {
	if (!Number.isFinite(gain) || gain <= 0.000015848931924611134) {
		// 10^(-96/20)
		return AUDIO_MIN_DB;
	}
	const db = 20 * Math.log10(gain);
	return Math.max(AUDIO_MIN_DB, Math.min(AUDIO_MAX_DB, db));
}

/**
 * Constant-power stereo pan law (for mono sources):
 * theta = (pi / 4) * (pan + 1)
 * L = cos(theta), R = sin(theta)
 * pan in [-1, 1]. At pan = 0: L = R = sqrt(0.5) ≈ 0.7071 (-3.01 dB center).
 * Preserves total acoustic energy L^2 + R^2 = 1.0.
 */
export function panGains(pan: number): { left: number; right: number } {
	const clampedPan = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
	const theta = (Math.PI / 4) * (clampedPan + 1);
	return {
		left: Math.cos(theta),
		right: Math.sin(theta)
	};
}

/**
 * Stereo balance law (for stereo sources):
 * At center (pan = 0): L = 1.0, R = 1.0 (bit-identical pass-through, zero attenuation).
 * Panning left (pan < 0): Left remains 1.0, Right attenuates: R = sin((pan + 1) * pi / 2). At pan = -1: R = 0.
 * Panning right (pan > 0): Right remains 1.0, Left attenuates: L = sin((1 - pan) * pi / 2). At pan = +1: L = 0.
 */
export function balanceGains(pan: number): { left: number; right: number } {
	const clampedPan = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
	if (Math.abs(clampedPan) <= 0.02) {
		return { left: 1.0, right: 1.0 };
	}
	if (clampedPan < 0) {
		const theta = ((clampedPan + 1) * Math.PI) / 2;
		return {
			left: 1.0,
			right: Math.sin(theta)
		};
	}
	const theta = ((1 - clampedPan) * Math.PI) / 2;
	return {
		left: Math.sin(theta),
		right: 1.0
	};
}

/**
 * Compute fade gain multiplier [0..1] at clip-relative time ticks.
 * Supports equal-power (sin/cos) and linear curves.
 */
export function fadeGain(
	clipTimeTicks: number,
	clipDurationTicks: number,
	fadeInUs = 0,
	fadeOutUs = 0,
	curve: 'equalPower' | 'linear' = 'equalPower'
): number {
	if (clipDurationTicks <= 0) return 0;
	let gain = 1;

	// Fade In
	if (fadeInUs > 0 && clipTimeTicks < fadeInUs) {
		const t = Math.max(0, Math.min(1, clipTimeTicks / fadeInUs));
		gain *= curve === 'equalPower' ? Math.sin((t * Math.PI) / 2) : t;
	}

	// Fade Out
	const fadeOutStart = clipDurationTicks - fadeOutUs;
	if (fadeOutUs > 0 && clipTimeTicks > fadeOutStart) {
		const t = Math.max(0, Math.min(1, (clipDurationTicks - clipTimeTicks) / fadeOutUs));
		gain *= curve === 'equalPower' ? Math.sin((t * Math.PI) / 2) : t;
	}

	return Math.max(0, Math.min(1, gain));
}

/**
 * Compute the effective linear gain of a clip at a specific timeline time.
 * Factors in:
 * - clip.properties['audio.volume'] animated or scalar (dB), or legacy clip.volume (linear)
 * - clip fade in / fade out
 */
export function clipGainAt(clip: Clip, timelineTime: number): number {
	const localTime = timelineTime - clip.start;
	if (localTime < 0 || localTime > clip.duration) return 0;

	let baseGain: number;
	const volumeProp = clip.properties?.['audio.volume'];
	if (volumeProp) {
		const db = Number(evaluate(volumeProp, localTime)) || 0;
		baseGain = dbToGain(db);
	} else if (typeof clip.volume === 'number') {
		// Legacy linear clip.volume (1.0 = 0 dB)
		baseGain = Math.max(0, clip.volume);
	} else {
		baseGain = 1.0;
	}

	const fade = fadeGain(
		localTime,
		clip.duration,
		clip.fadeInUs ?? 0,
		clip.fadeOutUs ?? 0,
		clip.fadeCurve ?? 'equalPower'
	);

	return baseGain * fade;
}

/**
 * Compute the pan value in [-1, 1] for a clip at a timeline time.
 */
export function clipPanAt(clip: Clip, timelineTime: number): number {
	const localTime = timelineTime - clip.start;
	const panProp = clip.properties?.['audio.pan'];
	if (panProp) {
		const pan = Number(evaluate(panProp, localTime)) || 0;
		return Math.max(-1, Math.min(1, pan));
	}
	return 0;
}

/**
 * Solo / Mute truth table:
 * If ANY audio track in the project has solo === true:
 *   Only tracks with solo === true AND muted === false are audible.
 * If NO audio track has solo === true:
 *   Tracks with muted === false are audible.
 */
export function resolveAudibleTracks(tracks: readonly Track[]): Set<string> {
	const audioTracks = tracks.filter((t) => t.kind === 'audio');
	const hasSolo = audioTracks.some((t) => t.audio?.solo === true);
	const audible = new Set<string>();

	for (const track of audioTracks) {
		if (track.muted) continue;
		if (hasSolo) {
			if (track.audio?.solo === true || track.audio?.soloSafe === true) {
				audible.add(track.id);
			}
		} else {
			audible.add(track.id);
		}
	}

	return audible;
}

/**
 * Default track audio state.
 */
export function defaultTrackAudio(): TrackAudio {
	return {
		gainDb: 0,
		pan: 0,
		solo: false
	};
}

/**
 * Default 4-band EQ state.
 * Bands:
 * 1: Low Shelf (80 Hz, 0 dB, Q=0.71)
 * 2: Peaking Low-Mid (500 Hz, 0 dB, Q=1.0)
 * 3: Peaking High-Mid (3000 Hz, 0 dB, Q=1.0)
 * 4: High Shelf (10000 Hz, 0 dB, Q=0.71)
 */
export function defaultTrackEq(): TrackEq {
	return {
		enabled: false,
		bands: [
			{ type: 'lowshelf', frequencyHz: 80, gainDb: 0, q: 0.71 },
			{ type: 'peaking', frequencyHz: 500, gainDb: 0, q: 1.0 },
			{ type: 'peaking', frequencyHz: 3000, gainDb: 0, q: 1.0 },
			{ type: 'highshelf', frequencyHz: 10000, gainDb: 0, q: 0.71 }
		]
	};
}

/**
 * Default track compressor state.
 */
export function defaultTrackCompressor(): TrackCompressor {
	return {
		enabled: false,
		thresholdDb: -24,
		ratio: 4,
		attackMs: 20,
		releaseMs: 250,
		kneeDb: 6,
		makeupDb: 0
	};
}

/**
 * Migrate legacy linear clip.volume (1.0 = 0 dB) to audio.volume property (dB).
 * If clip already has properties['audio.volume'], leaves it untouched.
 */
export function migrateLegacyVolume(clip: Clip): Clip {
	if (clip.properties?.['audio.volume']) {
		return clip;
	}
	const db = gainToDb(clip.volume ?? 1);
	return {
		...clip,
		properties: {
			...(clip.properties ?? {}),
			'audio.volume': { value: db }
		}
	};
}

/**
 * Robert Bristow-Johnson (RBJ) Audio EQ Biquad frequency response calculation.
 * Computes magnitude in dB at frequency f given sample rate fs.
 */
export function biquadFrequencyResponse(
	band: {
		type: 'lowshelf' | 'peaking' | 'highshelf';
		frequencyHz: number;
		gainDb: number;
		q: number;
	},
	f: number,
	fs = 48000
): number {
	if (band.gainDb === 0) return 0;
	const f0 = Math.max(10, Math.min(fs / 2 - 1, band.frequencyHz));
	const w0 = (2 * Math.PI * f0) / fs;
	const A = Math.pow(10, band.gainDb / 40);
	const Q = Math.max(0.001, band.q);
	const alpha = Math.sin(w0) / (2 * Q);
	const cos_w0 = Math.cos(w0);

	let b0 = 1,
		b1 = 0,
		b2 = 0,
		a0 = 1,
		a1 = 0,
		a2 = 0;

	if (band.type === 'peaking') {
		b0 = 1 + alpha * A;
		b1 = -2 * cos_w0;
		b2 = 1 - alpha * A;
		a0 = 1 + alpha / A;
		a1 = -2 * cos_w0;
		a2 = 1 - alpha / A;
	} else if (band.type === 'lowshelf') {
		const sqrtA = Math.sqrt(A);
		const alpha_shelf = (Math.sin(w0) / 2) * Math.sqrt((A + 1 / A) * (1 / Math.SQRT2 - 1) + 2);
		b0 = A * (A + 1 - (A - 1) * cos_w0 + 2 * sqrtA * alpha_shelf);
		b1 = 2 * A * (A - 1 - (A + 1) * cos_w0);
		b2 = A * (A + 1 - (A - 1) * cos_w0 - 2 * sqrtA * alpha_shelf);
		a0 = A + 1 + (A - 1) * cos_w0 + 2 * sqrtA * alpha_shelf;
		a1 = -2 * (A - 1 + (A + 1) * cos_w0);
		a2 = A + 1 + (A - 1) * cos_w0 - 2 * sqrtA * alpha_shelf;
	} else if (band.type === 'highshelf') {
		const sqrtA = Math.sqrt(A);
		const alpha_shelf = (Math.sin(w0) / 2) * Math.sqrt((A + 1 / A) * (1 / Math.SQRT2 - 1) + 2);
		b0 = A * (A + 1 + (A - 1) * cos_w0 + 2 * sqrtA * alpha_shelf);
		b1 = -2 * A * (A - 1 + (A + 1) * cos_w0);
		b2 = A * (A + 1 + (A - 1) * cos_w0 - 2 * sqrtA * alpha_shelf);
		a0 = A + 1 - (A - 1) * cos_w0 + 2 * sqrtA * alpha_shelf;
		a1 = 2 * (A - 1 - (A + 1) * cos_w0);
		a2 = A + 1 - (A - 1) * cos_w0 - 2 * sqrtA * alpha_shelf;
	}

	// Normalize coefficients by a0
	const nb0 = b0 / a0;
	const nb1 = b1 / a0;
	const nb2 = b2 / a0;
	const na1 = a1 / a0;
	const na2 = a2 / a0;

	const w = (2 * Math.PI * f) / fs;
	const phi = 4 * Math.sin(w / 2) * Math.sin(w / 2);
	const num =
		Math.pow(nb0 + nb1 + nb2, 2) + (nb0 * nb2 * phi - (nb1 * (nb0 + nb2) + 4 * nb0 * nb2)) * phi;
	const den = Math.pow(1 + na1 + na2, 2) + (na2 * phi - (na1 * (1 + na2) + 4 * na2)) * phi;

	if (den <= 0 || num <= 0) return 0;
	return 10 * Math.log10(num / den);
}

/**
 * Total 4-band EQ magnitude response in dB at frequency f.
 */
export function totalEqResponse(eq: TrackEq, f: number, fs = 48000): number {
	if (!eq?.enabled || !Array.isArray(eq.bands)) return 0;
	let totalDb = 0;
	for (const band of eq.bands) {
		if (band) {
			totalDb += biquadFrequencyResponse(band, f, fs);
		}
	}
	return totalDb;
}

/**
 * Compressor static transfer curve:
 * Computes output dB given input dB, threshold, ratio, knee, makeup.
 */
export function compressorStaticTransfer(
	inputDb: number,
	comp: Pick<TrackCompressor, 'thresholdDb' | 'ratio' | 'kneeDb' | 'makeupDb'>
): number {
	const { thresholdDb: T, ratio: R, kneeDb: W, makeupDb: M } = comp;
	let yDb: number;

	if (W <= 0) {
		// Hard knee
		if (inputDb <= T) {
			yDb = inputDb;
		} else {
			yDb = T + (inputDb - T) / R;
		}
	} else {
		// Soft knee
		const halfW = W / 2;
		if (inputDb <= T - halfW) {
			yDb = inputDb;
		} else if (inputDb > T + halfW) {
			yDb = T + (inputDb - T) / R;
		} else {
			// Inside the knee region: quadratic interpolation
			const x = inputDb - T + halfW;
			yDb = inputDb + ((1 / R - 1) * (x * x)) / (2 * W);
		}
	}

	return yDb + (M ?? 0);
}
