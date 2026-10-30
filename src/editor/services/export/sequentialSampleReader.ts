interface TimedSample<S> {
	readonly timestamp: number;
	clone(): S;
	close(): void;
}

/** What the reader needs from a decoder, shaped like mediabunny's `VideoSampleSink`. */
export interface SampleSource<S> {
	/** Yields frames in order, first the last one at or before `startTimestamp`, then pre-decodes ahead. */
	samples(startTimestamp: number): AsyncGenerator<S, void, unknown>;
	/** The last frame at or before `timestamp`, found by seeking. Cheap once, costly every frame. */
	getSample(timestamp: number): Promise<S | null>;
}

export interface SequentialSampleReaderOptions {
	/** A forward jump longer than this starts a new iterator instead of decoding through the gap. */
	maxJumpSeconds?: number;
}

const DEFAULT_MAX_JUMP_SECONDS = 2;
const BACKWARD_TOLERANCE_SECONDS = 1e-6;

/**
 * Reads the frame showing at a time, for times that mostly move forward, as an export does.
 *
 * Seeking for every frame builds a new decoder and decodes from the previous key frame each time. This
 * keeps one iterator alive and steps it forward instead, so each packet is decoded once and decoding
 * runs ahead of the caller. Time going backwards (reversed clips) falls back to seeking, which is the
 * old behaviour, and the iterator restarts on the next forward read.
 *
 * Every frame it returns is a clone owned by the caller, who must close it.
 */
export class SequentialSampleReader<S extends TimedSample<S>> {
	private iterator: AsyncGenerator<S, void, unknown> | null = null;
	private held: S | null = null;
	private ahead: S | null = null;
	private exhausted = false;
	private lastTime = -Infinity;
	private readonly maxJumpSeconds: number;

	constructor(
		private readonly source: SampleSource<S>,
		options: SequentialSampleReaderOptions = {}
	) {
		this.maxJumpSeconds = options.maxJumpSeconds ?? DEFAULT_MAX_JUMP_SECONDS;
	}

	/** The frame showing at `time` in seconds, or null before the first frame. The caller closes it. */
	async sampleAt(time: number): Promise<S | null> {
		const wentBackwards = time < this.lastTime - BACKWARD_TOLERANCE_SECONDS;
		this.lastTime = time;
		if (wentBackwards) {
			await this.reset();
			return this.source.getSample(time);
		}
		if (this.iterator && this.ahead && time - this.ahead.timestamp > this.maxJumpSeconds) {
			await this.reset();
		}
		if (!this.iterator) await this.start(time);
		await this.advanceTo(time);
		if (!this.held || this.held.timestamp > time) return null;
		return this.held.clone();
	}

	/** Closes every frame still held and stops the iterator. Safe to call more than once. */
	async dispose(): Promise<void> {
		await this.reset();
	}

	private async start(time: number): Promise<void> {
		this.iterator = this.source.samples(time);
		this.exhausted = false;
		const first = await this.iterator.next();
		if (first.done) this.exhausted = true;
		else this.held = first.value;
	}

	private async advanceTo(time: number): Promise<void> {
		for (;;) {
			if (!this.ahead && !this.exhausted && this.iterator) {
				const next = await this.iterator.next();
				if (next.done) this.exhausted = true;
				else this.ahead = next.value;
			}
			if (!this.ahead || this.ahead.timestamp > time) return;
			this.held?.close();
			this.held = this.ahead;
			this.ahead = null;
		}
	}

	private async reset(): Promise<void> {
		this.held?.close();
		this.ahead?.close();
		this.held = null;
		this.ahead = null;
		const iterator = this.iterator;
		this.iterator = null;
		this.exhausted = false;
		await iterator?.return(undefined);
	}
}

/** Each reader keeps a decoder and a few decoded frames alive, so there is a cap on how many run at once. */
const DEFAULT_MAX_READERS = 4;

interface PoolEntry<S extends TimedSample<S>> {
	source: SampleSource<S>;
	reader: SequentialSampleReader<S>;
}

/**
 * One reader per layer, up to a limit. A layer past the limit seeks for each frame, as before, so a
 * project with many layers, or a device with few hardware decoders, is never worse off than it was.
 */
export class SampleReaderPool<S extends TimedSample<S>> {
	private readonly entries = new Map<string, PoolEntry<S>>();

	constructor(private readonly maxReaders = DEFAULT_MAX_READERS) {}

	/** The frame showing at `time` for the layer `key`. The caller closes it. */
	async sampleAt(key: string, source: SampleSource<S>, time: number): Promise<S | null> {
		let entry = this.entries.get(key);
		if (entry && entry.source !== source) {
			await this.drop(key, entry);
			entry = undefined;
		}
		if (!entry) {
			if (this.entries.size >= this.maxReaders) return source.getSample(time);
			entry = { source, reader: new SequentialSampleReader(source) };
			this.entries.set(key, entry);
		}
		return entry.reader.sampleAt(time);
	}

	/** Stops the readers of layers that are no longer on screen, which frees their slots. */
	async release(activeKeys: ReadonlySet<string>): Promise<void> {
		for (const [key, entry] of [...this.entries]) {
			if (!activeKeys.has(key)) await this.drop(key, entry);
		}
	}

	/** Stops every reader that uses `source`, for when its input is about to be closed. */
	async disposeSource(source: SampleSource<S>): Promise<void> {
		for (const [key, entry] of [...this.entries]) {
			if (entry.source === source) await this.drop(key, entry);
		}
	}

	async dispose(): Promise<void> {
		for (const [key, entry] of [...this.entries]) await this.drop(key, entry);
	}

	private async drop(key: string, entry: PoolEntry<S>): Promise<void> {
		this.entries.delete(key);
		await entry.reader.dispose();
	}
}
