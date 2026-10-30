import { describe, expect, it } from 'vitest';
import {
	SampleReaderPool,
	SequentialSampleReader,
	type SampleSource
} from './sequentialSampleReader';

class FakeSample {
	constructor(
		readonly timestamp: number,
		private readonly bank: FakeSource
	) {
		bank.open.add(this);
	}

	clone(): FakeSample {
		return new FakeSample(this.timestamp, this.bank);
	}

	close(): void {
		this.bank.open.delete(this);
	}
}

/** A 25 fps source of `count` frames starting at `first`, counting how it was used. */
class FakeSource implements SampleSource<FakeSample> {
	readonly open = new Set<FakeSample>();
	iteratorsStarted = 0;
	getSampleCalls = 0;

	constructor(
		private readonly count = 100,
		private readonly first = 0
	) {}

	/** The frame a player shows at `time`: the last one starting at or before it. */
	expected(time: number): number | null {
		const index = Math.floor((time - this.first) * 25 + 1e-9);
		if (index < 0) return null;
		return this.first + Math.min(index, this.count - 1) / 25;
	}

	async getSample(time: number): Promise<FakeSample | null> {
		this.getSampleCalls += 1;
		const timestamp = this.expected(time);
		return timestamp === null ? null : new FakeSample(timestamp, this);
	}

	async *samples(start: number): AsyncGenerator<FakeSample, void, unknown> {
		this.iteratorsStarted += 1;
		// Like mediabunny: a start past the end still yields the last frame.
		const begin = Math.min(
			this.count - 1,
			Math.max(0, Math.floor((start - this.first) * 25 + 1e-9))
		);
		for (let index = begin; index < this.count; index += 1) {
			yield new FakeSample(this.first + index / 25, this);
		}
	}
}

async function read(reader: SequentialSampleReader<FakeSample>, time: number) {
	const sample = await reader.sampleAt(time);
	const timestamp = sample?.timestamp ?? null;
	sample?.close();
	return timestamp;
}

describe('SequentialSampleReader', () => {
	it('returns the frame a player would show, reading forward through one iterator', async () => {
		const source = new FakeSource();
		const reader = new SequentialSampleReader(source);

		for (let frame = 0; frame < 90; frame += 1) {
			const time = frame / 30;
			expect(await read(reader, time), `t=${time}`).toBeCloseTo(source.expected(time)!, 9);
		}

		expect(source.iteratorsStarted).toBe(1);
		expect(source.getSampleCalls).toBe(0);
		await reader.dispose();
		expect(source.open.size).toBe(0);
	});

	it('shows the same frame again when asked for the same time twice', async () => {
		const source = new FakeSource();
		const reader = new SequentialSampleReader(source);

		expect(await read(reader, 0.5)).toBeCloseTo(0.48, 9);
		expect(await read(reader, 0.5)).toBeCloseTo(0.48, 9);

		expect(source.iteratorsStarted).toBe(1);
		await reader.dispose();
		expect(source.open.size).toBe(0);
	});

	it('hands out samples the caller can close without breaking later reads', async () => {
		const source = new FakeSource();
		const reader = new SequentialSampleReader(source);

		const first = await reader.sampleAt(0.5);
		first!.close();
		const second = await reader.sampleAt(0.52);

		expect(second!.timestamp).toBeCloseTo(0.52, 9);
		second!.close();
		await reader.dispose();
		expect(source.open.size).toBe(0);
	});

	it('returns null before the first frame and the last frame after the end', async () => {
		const source = new FakeSource(10, 0.5);
		const reader = new SequentialSampleReader(source);

		expect(await read(reader, 0.1)).toBeNull();
		expect(await read(reader, 0.5)).toBeCloseTo(0.5, 9);
		expect(await read(reader, 5)).toBeCloseTo(0.5 + 9 / 25, 9);
		expect(await read(reader, 6)).toBeCloseTo(0.5 + 9 / 25, 9);

		await reader.dispose();
		expect(source.open.size).toBe(0);
	});

	it('falls back to random access when time goes backwards, such as reversed clips', async () => {
		const source = new FakeSource();
		const reader = new SequentialSampleReader(source);

		await read(reader, 2);
		expect(await read(reader, 1.5)).toBeCloseTo(1.48, 9);
		expect(await read(reader, 1.0)).toBeCloseTo(1.0, 9);

		expect(source.getSampleCalls).toBe(2);
		await reader.dispose();
		expect(source.open.size).toBe(0);
	});

	it('goes back to sequential reads once time moves forward again', async () => {
		const source = new FakeSource();
		const reader = new SequentialSampleReader(source);

		await read(reader, 2);
		await read(reader, 1);
		expect(await read(reader, 1.04)).toBeCloseTo(1.04, 9);
		expect(await read(reader, 1.08)).toBeCloseTo(1.08, 9);

		expect(source.iteratorsStarted).toBe(2);
		expect(source.getSampleCalls).toBe(1);
		await reader.dispose();
		expect(source.open.size).toBe(0);
	});

	it('starts a new iterator instead of decoding through a long forward jump', async () => {
		const source = new FakeSource(500);
		const reader = new SequentialSampleReader(source, { maxJumpSeconds: 2 });

		await read(reader, 0);
		expect(await read(reader, 15)).toBeCloseTo(15, 9);

		expect(source.iteratorsStarted).toBe(2);
		await reader.dispose();
		expect(source.open.size).toBe(0);
	});

	it('closes every sample it still holds when disposed mid-stream', async () => {
		const source = new FakeSource();
		const reader = new SequentialSampleReader(source);

		await read(reader, 1);
		await reader.dispose();

		expect(source.open.size).toBe(0);
	});
});

describe('SampleReaderPool', () => {
	it('gives each layer its own reader, so layers on one source do not make each other seek', async () => {
		const source = new FakeSource();
		const pool = new SampleReaderPool(4);

		for (let frame = 0; frame < 30; frame += 1) {
			const base = await pool.sampleAt('base', source, frame / 30);
			const overlay = await pool.sampleAt('overlay', source, 2 + frame / 30);
			base?.close();
			overlay?.close();
		}

		expect(source.iteratorsStarted).toBe(2);
		expect(source.getSampleCalls).toBe(0);
		await pool.dispose();
		expect(source.open.size).toBe(0);
	});

	it('seeks for layers beyond the limit instead of opening more decoders', async () => {
		const source = new FakeSource();
		const pool = new SampleReaderPool(2);

		for (const key of ['a', 'b', 'c']) {
			const sample = await pool.sampleAt(key, source, 1);
			expect(sample!.timestamp, key).toBeCloseTo(1, 9);
			sample!.close();
		}

		expect(source.iteratorsStarted).toBe(2);
		expect(source.getSampleCalls).toBe(1);
		await pool.dispose();
		expect(source.open.size).toBe(0);
	});

	it('frees a slot when a layer is no longer on screen', async () => {
		const source = new FakeSource();
		const pool = new SampleReaderPool(1);

		(await pool.sampleAt('first', source, 0))!.close();
		await pool.release(new Set(['second']));
		(await pool.sampleAt('second', source, 0))!.close();

		expect(source.iteratorsStarted).toBe(2);
		expect(source.getSampleCalls).toBe(0);
		await pool.dispose();
		expect(source.open.size).toBe(0);
	});

	it('keeps the readers of layers that are still on screen', async () => {
		const source = new FakeSource();
		const pool = new SampleReaderPool(2);

		(await pool.sampleAt('a', source, 0))!.close();
		await pool.release(new Set(['a']));
		(await pool.sampleAt('a', source, 0.04))!.close();

		expect(source.iteratorsStarted).toBe(1);
		await pool.dispose();
	});

	it('stops only the readers of a source that is closed', async () => {
		const first = new FakeSource();
		const second = new FakeSource();
		const pool = new SampleReaderPool(4);

		(await pool.sampleAt('a', first, 0))!.close();
		(await pool.sampleAt('b', second, 0))!.close();
		await pool.disposeSource(first);

		expect(first.open.size).toBe(0);
		expect(second.open.size).toBeGreaterThan(0);
		(await pool.sampleAt('b', second, 0.04))!.close();
		expect(second.iteratorsStarted).toBe(1);
		await pool.dispose();
		expect(second.open.size).toBe(0);
	});
});
