/**
 * Encodes audio channel data (Float32Array) to a 16-bit PCM WAV ArrayBuffer.
 */
export function encodeWav(channelData: Float32Array[], sampleRate: number): ArrayBuffer {
	const numChannels = channelData.length;
	const numSamples = numChannels > 0 ? channelData[0]!.length : 0;
	const bytesPerSample = 2; // 16-bit PCM
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = numSamples * blockAlign;
	const bufferSize = 44 + dataSize;

	const buffer = new ArrayBuffer(bufferSize);
	const view = new DataView(buffer);

	// Write ASCII string helper
	const writeString = (offset: number, str: string) => {
		for (let i = 0; i < str.length; i++) {
			view.setUint8(offset + i, str.charCodeAt(i));
		}
	};

	// 1. RIFF chunk descriptor
	writeString(0, 'RIFF');
	view.setUint32(4, 36 + dataSize, true); // ChunkSize
	writeString(8, 'WAVE');

	// 2. "fmt " sub-chunk
	writeString(12, 'fmt ');
	view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
	view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
	view.setUint16(22, numChannels, true); // NumChannels
	view.setUint32(24, sampleRate, true); // SampleRate
	view.setUint32(28, byteRate, true); // ByteRate
	view.setUint16(32, blockAlign, true); // BlockAlign
	view.setUint16(34, 16, true); // BitsPerSample (16 bits)

	// 3. "data" sub-chunk
	writeString(36, 'data');
	view.setUint32(40, dataSize, true); // Subchunk2Size

	// 4. Interleaved PCM 16-bit signed samples
	let offset = 44;
	for (let i = 0; i < numSamples; i++) {
		for (let ch = 0; ch < numChannels; ch++) {
			const raw = channelData[ch]![i]!;
			const clamped = Math.max(-1, Math.min(1, raw));
			const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
			view.setInt16(offset, int16, true);
			offset += 2;
		}
	}

	return buffer;
}

/**
 * Encodes audio channel data to a WAV Blob.
 */
export function encodeWavBlob(channelData: Float32Array[], sampleRate: number): Blob {
	const buffer = encodeWav(channelData, sampleRate);
	return new Blob([buffer], { type: 'audio/wav' });
}
