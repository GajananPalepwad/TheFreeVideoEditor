# Exporting projects and video

Open **Export** in the editor header or choose **File → Export…**. The dialog
contains video and project-interchange outputs.

## Video

The frame-accurate path uses Mediabunny and the browser's WebCodecs encoders.
MP4 uses H.264/AAC; WebM uses a supported VP9/AV1/VP8 codec with Opus where
available. Codec support is checked for the selected size, frame rate, and audio
setting before enabling the export action.

### Rendering architecture

The preferred path creates a module Worker from `export.worker.ts`. It owns
media decoding, frame resolution and compositing on `OffscreenCanvas`, frame
and audio encoding, audio mixdown, and muxing. The main thread prepares an
immutable project snapshot and export plan, transfers the required `File`
objects, reports progress, and writes acknowledged output chunks to the
user-selected file. The writable stream itself is not transferred: chunks are
sent as transferable `ArrayBuffer`s and written on the main thread, which also
works in Chromium versions that do not support transferring a file stream.

The typed Worker protocol has `probe`, `start`, `progress`, `chunk`, `ack`,
`cancel`, `done`, and `error` messages. `chunk`/`ack` provide bounded output
backpressure. Cancellation stops frame/audio work, cancels the muxer, aborts the
selected output, discards buffered chunks, and terminates a Worker that does
not acknowledge cancellation promptly.

If a module Worker, worker WebCodecs, or `OffscreenCanvas` is unavailable, the
WebCodecs pipeline falls back to the main thread and yields between video frames
and audio chunks. The UI displays a compatibility notice. MediaRecorder is a
separate real-time compatibility path for WebM; it can drop frames and is not
frame-accurate.

Exports are deterministic relative to their captured project snapshot, media
bytes, settings, and browser codec implementation. Edits made after export
starts affect the live project only, not the in-flight snapshot. Frame count
and timestamps follow the export plan; codec output pixels and exact encoded
bytes can vary between browser/OS encoder implementations. Playback is paused
for the duration of export.

Offline media is called out before rendering. If the user explicitly continues,
offline video layers render blank and offline audio is silent. Export
cancellation discards the partial output. The active project cannot be closed,
switched, or deleted during export without first confirming cancellation.
Worker export avoids running the render loop on the UI thread, but the yielding
main-thread fallback can still reduce responsiveness. Codec support and decode
performance also depend on the browser, operating system, and media file. In

### Gate M: Speed, Time Remapping, and WSOLA Audio Mixdown

Export pipelines fully support constant speed changes, reverse playback, freeze frames,
and arbitrary non-linear time remapping curves:

- **Audio Mixdown**: `audioMix.ts` integrates with in-house WSOLA time-stretching (`renderRemappedAudio.ts`).
  Pitch is preserved across accelerated, decelerated, and curve-remapped audio chunks when `clip.maintainPitch` is true.
  Reverse playback and hold frames mute audio cleanly.
- **Video Frames & LRU Cache**: `frameProvider.ts` includes a 64-frame LRU `ImageBitmap` cache to
  avoid repeated decodes when evaluating backward seeking, reverse clips, and freeze frames.
- **Interchange Export**: EDL, FCPXML, OTIO, and XMEML exporters evaluate `sourceExtent(clip)` to accurately
  compute source time boundaries under speed adjustments and reversal.

### Export speed

Export time is dominated by reading source frames, so that is where the effort went.

**Progress.** While exporting, the dialog shows frames done, speed, elapsed time and, once at
least 30 frames have been timed, the time left (`150 / 600 frames · 30.0 fps · 0:05 elapsed ·
about 0:15 left`). When it finishes it shows `finished in m:ss`. The estimate is the average
speed so far, so it settles as the export goes on.

**What was slow.** Profiling an export (stage timer in the frame loop, `scripts/bench-export.mjs`)
showed that about 94% of the time went to decoding source frames. The loop asked mediabunny for
the frame at each timestamp with `getSample(t)`, which builds a new decoder and decodes from the
previous key frame every time. Resolving the timeline, drawing, encoding the video and yielding to
the event loop each took a few percent or less.

**What changed.** A `SequentialSampleReader` keeps one decoder per layer that is on screen and
steps it forward (`samples()`), so each packet is decoded once and decoding runs ahead of the
export. Output is the same frames as before:

- Time going backwards (reversed clips) falls back to `getSample`, as before.
- A forward jump of more than 2 seconds starts a new iterator instead of decoding through the gap.
- At most 4 readers run at once. A layer past the limit seeks for each frame as before, so a project
  with many layers, or a device with few hardware decoders, is no worse off than it was.
- A layer's reader is released when the layer leaves the screen, and all readers are closed when the
  export ends, fails or is cancelled.

**Results.** 720p, 9 s (270 frames), median of 3 runs, this machine (12-thread i5-12450H, 15 GB,
Intel UHD and NVIDIA GTX 1650, Linux). "Before" is the code before this change.

| Browser                 | Output | Scene                  | Before   | After    | Speed-up |
| ----------------------- | ------ | ---------------------- | -------- | -------- | -------- |
| Chromium (headless)     | WebM   | one clip               | 5.75 s   | 2.02 s   | 2.8x     |
| Chromium (headless)     | WebM   | clip and title         | 6.03 s   | 2.17 s   | 2.8x     |
| Chromium (headless)     | WebM   | two layers and title   | 6.22 s   | 2.31 s   | 2.7x     |
| Chrome 156              | WebM   | one clip               | 10.56 s  | 3.34 s   | 3.2x     |
| Chrome 156              | MP4    | one clip               | 10.28 s  | 2.80 s   | 3.7x     |
| Chrome 156              | MP4    | clip and title         | 10.62 s  | 3.07 s   | 3.5x     |
| Firefox 155             | WebM   | one clip               | 26.09 s  | 21.03 s  | 1.2x     |

After the change the video encoder is the slowest stage in every browser (about 60% to 70% of the
time), so further gains depend on the encoder, which differs per browser and machine. Firefox's
software encoder is slow enough that decoding was a smaller share of its time. Reversed clips use
the seek fallback, so they are unchanged (Firefox: 20.5 s before, 21.4 s after, within noise).

**Output is unchanged.** For 12 scenarios (plain, title, two layers, reversed, slow motion, 2x speed,
trimmed, split, freeze frame, speed ramp, a 2x layer over a 1x layer, a reversed layer over a forward
one) the exported WebM files have identical SHA-256 hashes before and after in Chromium. Decoded
frames, hashed per layer for every export frame, are identical before and after in Chromium and in
Chrome 156, which also agree with each other. Chrome's H.264 encoder is not deterministic (two runs
of the same code give different MP4 bytes), so MP4 was checked through the decoded frames.

In Firefox the new code also fixes a defect: with `getSample`, Firefox 155 showed the same frame for
up to 13 export frames in a row (28 distinct images over 270 frames). With the sequential reader it
shows the same pattern as Chromium (60 distinct images, each held for 1 or 2 frames). Only the
frame pattern was compared across browsers, not pixels, because the decoders differ.

**Run it yourself.** Start the dev server (`npx astro dev --background`), then:

```sh
node scripts/bench-export.mjs                              # speed and per-stage time
node scripts/bench-export.mjs --check --scenarios reverse  # output hash of one scenario
node scripts/bench-export.mjs --frames                     # hash of every decoded frame
node scripts/bench-export.mjs --channel chrome             # real Chrome instead of Chromium
node scripts/bench-export.mjs --browser firefox            # Playwright's Firefox
```

Compare the same command on two versions of the code on one machine. Numbers depend on the
machine, the browser and its codecs.

**Not measured.** Safari, mobile browsers, Windows and macOS, and machines with a hardware video
encoder were not tested. The reader uses only mediabunny's documented `samples()` API, and the limit
of 4 readers is there for devices with few hardware decoders, but treat those platforms as unverified.

## Project interchange

- **Premiere Pro XML (xmeml)** and **CMX3600 EDL** are the Premiere-oriented
  routes. EDL output contains video cuts only; packaged EDL export creates one
  EDL for each video track and includes an audio limitation note.
- **FCPXML** targets Final Cut Pro and DaVinci Resolve.
- **OpenTimelineIO (.otio)** is an open interchange format supported by various
  editing applications.

Interchange files can be exported alone or packaged with the source media.
Packaged media paths are allocated relative to the package. If an application
cannot find the media after extraction or moving the package, relink the files
in that application. Packaging cannot include assets marked offline.

These serializers represent basic edits, tracks, source ranges, markers, and
media references. Effects, transitions, advanced audio routing, speed changes,
and application-specific metadata are not represented. Structural unit tests do
not guarantee compatibility with every version of an editor.

An experimental `.prproj` serializer is not exposed in the UI because Premiere's
project schema is version-specific. No sample is currently present at
`samples/minimal.prproj`, and neither a serializer nor its golden-test scaffold
has been created; neither should be inferred without a real sample. To proceed,
provide a minimal Premiere Pro project containing one sequence, one video clip,
and one audio clip, saved from the exact Premiere Pro version/build to support.
Include that version/build (as shown in About Premiere Pro) with the sample.
Use xmeml or EDL in the meantime.

## Export dependency and credit

Gate G added `mediabunny` 1.61.3 as the media demuxing, decoding, encoding,
and muxing engine (licensed under MPL-2.0).

Gate P added `@huggingface/transformers` (Apache-2.0) for client-side ONNX Runtime Web
speech recognition in `stt.worker.ts`. It is strictly dynamically imported inside the dedicated
Worker thread so the main application bundle chunk size remains lean and unaffected.

## Subtitles and Captions Export (Gate P)

1. **Burn-in Video Subtitles**: When a caption track is not hidden (`hidden !== true`), caption segments are resolved into active text layers and baked directly into exported MP4 and WebM video frames using the Canvas2D/WebGL2 render pipeline.
2. **Sidecar Subtitle Files**: The Export dialog offers `.srt` (SubRip) and `.vtt` (WebVTT) export buttons that format caption cues with proper timecodes (`HH:MM:SS,mmm` and `HH:MM:SS.mmm`), cue indices, and speaker prefixes without requiring video rendering.

## Professional Codecs Pipeline (Tiers 1, 2, and 3)

The Free Video Editor supports professional broadcast and editing formats:

### Tier 1 — Platform WebCodecs & Uncompressed Audio
- **H.264 / AVC High Profile**: `avc1.640033` up to Level 5.1 in MP4 and QuickTime MOV.
- **HEVC / H.265 Main & Main 10**: `hvc1.1.6.L120.B0` (8-bit) and `hvc1.2.4.L120.B0` (10-bit) in MP4 and QuickTime MOV where supported by hardware.
- **VP9 Profile 0 & Profile 2**: `vp09.00.41.08` (8-bit) and `vp09.02.41.10` (10-bit master) in WebM with alpha channel preservation.
- **AV1 Main**: `av01.0.08M.08` in MP4 and WebM for state-of-the-art compression.
- **Linear PCM Audio**: Lossless 16-bit (`pcm-s16`), 24-bit studio master (`pcm-s24`), and 32-bit floating point (`pcm-f32`) in WAV and QuickTime MOV.
- **Audio-Only WAV Export**: Zero-video overhead WAV audio pipeline directly streaming uncompressed PCM audio chunks to disk.

### Tier 2 — Optional Advanced Codec Pack (WASM)
- **Codecs**: Apple ProRes (Proxy, LT, 422, 422 HQ, 4444 with alpha) and Avid DNxHD/DNxHR (SMPTE VC-3); MPEG-2 4:2:2 and FFV1 archival ingest; MXF and MPEG-TS demuxing.
- **UX Pattern**: Follows the Captions consent + download + manager model (lazy download, client-side execution, offline-ready).
- **Compliance & Licensing**: Built strictly from LGPL-2.1-or-later libraries (`libavcodec`, `libavformat`, `libswscale`, `libswresample`). Software H.264/HEVC encoders are completely omitted to prevent patent exposure. Apple ProRes is an independent open-source implementation (`prores_ks`) with explicit non-endorsement notices.
- **Feasibility Status**: Step 0 feasibility audit recorded a NO-GO for on-host compilation due to missing `emcc`/`docker` toolchain. Complete plumbing (`pack.worker.ts`, `packService.ts`, `CodecPackDialog.tsx`) and reproducible build script (`tools/codec-pack/build.sh`) are delivered and Tier 2 binary is marked deferred.

### Tier 3 — High-Bit-Depth Render Pipeline & Alpha
- **Half-Float Render Targets**: `FboPool` acquires `gl.RGBA16F` framebuffers (backed by `EXT_color_buffer_float`) when 10-bit or HDR export is active, preventing intermediate 8-bit precision clipping.
- **Bit-Deterministic PCG Integer Dithering**: TPDF dithering via unsigned integer PCG hash eliminates quantization banding without non-deterministic trigonometric float approximations. Dither is scaled by target bit depth ($\pm 1$ code value: $1/255$ for 8-bit, $1/1023$ for 10-bit) and is strictly OFF (`u_dither = 0`) on 8-bit default export paths to ensure bit-identical baseline blit output.
- **ColorConversionPass & 10-bit Export**: Full-canvas GPU conversion pass implementing broadcast-standard ITU-R BT.709 and BT.2020 matrices, 4:2:0 box planar subsampling, true 10-bit RGBA packing (`hi8 = v10 >> 2u`, `low2 = (v10 & 3u) << 6u`), and asynchronous PBO readback for `I420P10` `VideoFrame` creation.
- **Alpha Export**: Transparent canvas background clearing (`gl.clearColor(0,0,0,0)`) and `alpha: 'keep'` preserve transparency for motion graphics overlays in WebM VP9.
- **Source Inspection & Warnings**: Automatic detection and UI badge chips (`10b`, `HDR`, `VFR`, `INT`) and Export dialog alerts for HDR, Variable Frame Rate, interlaced, and unsupported formats.
