import { describe, it, expect } from 'vitest';
import {
	dbToGain,
	gainToDb,
	panGains,
	balanceGains,
	fadeGain,
	resolveAudibleTracks,
	totalEqResponse,
	compressorStaticTransfer,
	migrateLegacyVolume,
	defaultTrackEq
} from './audioMath';
import type { Clip, Track } from './types';

describe('audioMath unit tests', () => {
	describe('dbToGain & gainToDb conversion', () => {
		it('converts 0 dB to 1.0 linear gain', () => {
			expect(dbToGain(0)).toBeCloseTo(1.0, 5);
			expect(gainToDb(1.0)).toBeCloseTo(0, 5);
		});

		it('converts +6 dB to ~2.0 linear gain and -6 dB to ~0.5 linear gain', () => {
			expect(dbToGain(6.0206)).toBeCloseTo(2.0, 3);
			expect(gainToDb(2.0)).toBeCloseTo(6.0206, 3);
			expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 3);
			expect(gainToDb(0.5)).toBeCloseTo(-6.0206, 3);
		});

		it('clamps minimum dB to -96 and returns exact 0 gain', () => {
			expect(dbToGain(-96)).toBe(0);
			expect(dbToGain(-120)).toBe(0);
			expect(gainToDb(0)).toBe(-96);
		});

		it('clamps maximum dB to +24', () => {
			expect(dbToGain(30)).toBeCloseTo(dbToGain(24), 5);
			expect(gainToDb(100)).toBe(24);
		});
	});

	describe('Constant-power pan law', () => {
		it('calculates equal -3 dB power at center pan (pan = 0)', () => {
			const { left, right } = panGains(0);
			expect(left).toBeCloseTo(Math.SQRT1_2, 4);
			expect(right).toBeCloseTo(Math.SQRT1_2, 4);
			// Constant power invariant: left^2 + right^2 == 1
			expect(left * left + right * right).toBeCloseTo(1.0, 5);
		});

		it('calculates full left at pan = -1 and full right at pan = 1', () => {
			const fullLeft = panGains(-1);
			expect(fullLeft.left).toBeCloseTo(1.0, 5);
			expect(fullLeft.right).toBeCloseTo(0, 5);

			const fullRight = panGains(1);
			expect(fullRight.left).toBeCloseTo(0, 5);
			expect(fullRight.right).toBeCloseTo(1.0, 5);
		});

		it('satisfies constant-power invariant across all pan positions', () => {
			for (let p = -1; p <= 1; p += 0.1) {
				const { left, right } = panGains(p);
				expect(left * left + right * right).toBeCloseTo(1.0, 5);
			}
		});
	});

	describe('Stereo balance law', () => {
		it('returns unity 1.0 on both channels at center (pan = 0)', () => {
			const { left, right } = balanceGains(0);
			expect(left).toBe(1.0);
			expect(right).toBe(1.0);
		});

		it('snaps within +/- 2% center detent to 1.0 on both channels', () => {
			const detentPos = balanceGains(0.015);
			expect(detentPos.left).toBe(1.0);
			expect(detentPos.right).toBe(1.0);

			const detentNeg = balanceGains(-0.015);
			expect(detentNeg.left).toBe(1.0);
			expect(detentNeg.right).toBe(1.0);
		});

		it('attenuates right channel when panned left without boosting left', () => {
			const { left, right } = balanceGains(-0.5);
			expect(left).toBe(1.0);
			expect(right).toBeLessThan(1.0);
			expect(right).toBeGreaterThan(0.0);
		});

		it('attenuates left channel when panned right without boosting right', () => {
			const { left, right } = balanceGains(0.5);
			expect(left).toBeLessThan(1.0);
			expect(left).toBeGreaterThan(0.0);
			expect(right).toBe(1.0);
		});

		it('fully isolates channels at hard left and hard right', () => {
			const hardL = balanceGains(-1);
			expect(hardL.left).toBe(1.0);
			expect(hardL.right).toBeCloseTo(0.0, 5);

			const hardR = balanceGains(1);
			expect(hardR.left).toBeCloseTo(0.0, 5);
			expect(hardR.right).toBe(1.0);
		});
	});

	describe('Clip fades (equal-power vs linear)', () => {
		const duration = 10_000_000; // 10s
		const fadeIn = 2_000_000; // 2s
		const fadeOut = 2_000_000; // 2s

		it('returns 0 at start and 1 after fadeIn', () => {
			expect(fadeGain(0, duration, fadeIn, fadeOut, 'equalPower')).toBe(0);
			expect(fadeGain(fadeIn, duration, fadeIn, fadeOut, 'equalPower')).toBeCloseTo(1.0, 5);
		});

		it('evaluates sin curve for equal-power fade', () => {
			const midFade = fadeIn / 2;
			// sin(pi/4) ≈ 0.7071
			expect(fadeGain(midFade, duration, fadeIn, fadeOut, 'equalPower')).toBeCloseTo(
				Math.SQRT1_2,
				4
			);
			// Linear fade gives 0.5
			expect(fadeGain(midFade, duration, fadeIn, fadeOut, 'linear')).toBeCloseTo(0.5, 4);
		});

		it('evaluates fade-out correctly', () => {
			expect(fadeGain(duration, duration, fadeIn, fadeOut, 'equalPower')).toBe(0);
			expect(fadeGain(duration - fadeOut, duration, fadeIn, fadeOut, 'equalPower')).toBeCloseTo(
				1.0,
				5
			);
		});
	});

	describe('Solo / Mute truth table', () => {
		const createTrack = (id: string, muted: boolean, solo: boolean): Track => ({
			id: id as unknown as Track['id'],
			kind: 'audio',
			name: id,
			muted,
			locked: false,
			hidden: false,
			clips: [],
			audio: { gainDb: 0, pan: 0, solo }
		});

		it('allows all unmuted tracks when no track is soloed', () => {
			const tracks = [
				createTrack('t1', false, false),
				createTrack('t2', true, false),
				createTrack('t3', false, false)
			];
			const audible = resolveAudibleTracks(tracks);
			expect(audible.has('t1')).toBe(true);
			expect(audible.has('t2')).toBe(false);
			expect(audible.has('t3')).toBe(true);
		});

		it('allows only soloed and unmuted tracks when at least one track is soloed', () => {
			const tracks = [
				createTrack('t1', false, true),
				createTrack('t2', false, false),
				createTrack('t3', true, true) // soloed but muted -> mute wins
			];
			const audible = resolveAudibleTracks(tracks);
			expect(audible.has('t1')).toBe(true);
			expect(audible.has('t2')).toBe(false);
			expect(audible.has('t3')).toBe(false);
		});
	});

	describe('migrateLegacyVolume', () => {
		it('converts linear volume 1.0 to 0 dB', () => {
			const clip: Clip = {
				id: 'c1' as unknown as Clip['id'],
				start: 0 as unknown as Clip['start'],
				duration: 1000000 as unknown as Clip['duration'],
				sourceIn: 0 as unknown as Clip['sourceIn'],
				sourceOut: 1000000 as unknown as Clip['sourceOut'],
				speed: 1,
				volume: 1.0
			};
			const migrated = migrateLegacyVolume(clip);
			const volumeProp = migrated.properties?.['audio.volume'];
			const val = volumeProp && 'value' in volumeProp ? (volumeProp.value as number) : 0;
			expect(val).toBeCloseTo(0, 5);
		});

		it('converts linear volume 0.5 to -6.02 dB', () => {
			const clip: Clip = {
				id: 'c1' as unknown as Clip['id'],
				start: 0 as unknown as Clip['start'],
				duration: 1000000 as unknown as Clip['duration'],
				sourceIn: 0 as unknown as Clip['sourceIn'],
				sourceOut: 1000000 as unknown as Clip['sourceOut'],
				speed: 1,
				volume: 0.5
			};
			const migrated = migrateLegacyVolume(clip);
			const volumeProp = migrated.properties?.['audio.volume'];
			const val = volumeProp && 'value' in volumeProp ? (volumeProp.value as number) : 0;
			expect(val).toBeCloseTo(-6.0206, 3);
		});
	});

	describe('RBJ Biquad EQ & Compressor static curves', () => {
		it('returns 0 dB response when EQ is undefined or has no bands', () => {
			expect(
				totalEqResponse(undefined as unknown as Parameters<typeof totalEqResponse>[0], 1000)
			).toBe(0);
			expect(totalEqResponse({} as unknown as Parameters<typeof totalEqResponse>[0], 1000)).toBe(0);
		});

		it('returns 0 dB response when EQ gain is 0', () => {
			const eq = defaultTrackEq();
			expect(totalEqResponse(eq, 1000)).toBe(0);
		});

		it('calculates peaking EQ boost around center frequency', () => {
			const eq = defaultTrackEq();
			eq.enabled = true;
			eq.bands[1].gainDb = 6; // 500 Hz peaking +6 dB
			const responseAtCenter = totalEqResponse(eq, 500);
			expect(responseAtCenter).toBeCloseTo(6, 0.5);
			const responseAtFar = totalEqResponse(eq, 10000);
			expect(responseAtFar).toBeCloseTo(0, 0.5);
		});

		it('calculates compressor static transfer curve for hard knee', () => {
			const comp = { thresholdDb: -20, ratio: 4, kneeDb: 0, makeupDb: 0 };
			// Below threshold: 1:1
			expect(compressorStaticTransfer(-30, comp)).toBeCloseTo(-30, 4);
			// At threshold: -20
			expect(compressorStaticTransfer(-20, comp)).toBeCloseTo(-20, 4);
			// 12 dB above threshold: reduced by ratio 4 -> output = -20 + (12 / 4) = -17 dB
			expect(compressorStaticTransfer(-8, comp)).toBeCloseTo(-17, 4);
		});

		it('applies makeup gain correctly', () => {
			const comp = { thresholdDb: -20, ratio: 4, kneeDb: 0, makeupDb: 5 };
			expect(compressorStaticTransfer(-30, comp)).toBeCloseTo(-25, 4);
		});
	});
});
