# Production Release Checklist (Gate S)

This checklist confirms release readiness for The Free Video Editor v1.0.

---

## 1. Implementation Gate Completion Status

| Gate | Title | Deliverables | Verification Status |
| :--- | :--- | :--- | :--- |
| **Gate A** | Project Architecture & Core Shell | Astro 5, React 19, Zustand store, dark/light theme | **CLOSED** |
| **Gate B** | Media Ingest & OPFS Storage | WebCodecs demuxing, OPFS persistence, thumbnail worker | **CLOSED** |
| **Gate C** | Timeline Core & Ripple Editing | Virtualized timeline, clips, tracks, ripple/roll trims | **CLOSED** |
| **Gate D** | Canvas2D & WebGL2 Compositor | Double-buffered compositor, transform gizmo, blend modes | **CLOSED** |
| **Gate E** | Playback Engine & Sync | Clock-driven audio/video synchronization, scrub caching | **CLOSED** |
| **Gate F** | Audio Engine & WSOLA | Time-stretch WSOLA, 4-band biquad EQ, dynamics compressor | **CLOSED** |
| **Gate G** | WebCodecs Video Export | Worker-based hardware encoding, MP4/WebM muxing | **CLOSED** |
| **Gate H** | Keyframe Animation Engine | Bezier curves, property tracks, animated transforms | **CLOSED** |
| **Gate I** | Color Grading & Scopes | Real-time WebGL2 vectorscope, waveform, parade, 3D LUTs | **CLOSED** |
| **Gate J** | Real-Time GPU Effects | 11 GPU fragment shaders with Canvas2D parity oracles | **CLOSED** |
| **Gate K** | Transitions & Blends | 9 transition shaders (parked behind `?labs=transitions`) | **CLOSED** |
| **Gate L** | Masking & Rotoscoping | Bezier, ellipse, and rectangle path rasterization | **CLOSED** |
| **Gate M** | Speed Curves & Time Remapping | Non-linear speed curves, optical-flow/frame-blend remap | **CLOSED** |
| **Gate N** | Pro Audio DSP & Fairlight Mixer | Submix buses, PDC, ITU-R BS.1770-4 loudness normalization | **CLOSED** |
| **Gate O** | Motion Graphics & Titles | Text generator, typographic animation, styling presets | **CLOSED** |
| **Gate O+** | Title Graphics & Motion Template Repair Pass | 18 file-based templates, one render path, save/reload fidelity | **CLOSED** (re-opened and re-closed, see below) |
| **Gate P** | Speech-to-Text & Subtitles | Whisper ONNX client-side inference, VAD ducking, SRT/VTT | **CLOSED** |
| **Gate Q** | Proxy Workflow & Offline Media | Automatic 720p/540p proxy transcode, seamless switching | **CLOSED** |
| **Gate R** | Nested Sequences | Arbitrary depth sequences, recursive compositor, flattening | **CLOSED** |
| **Gate S** | Interchange & Acceptance | Universal IR, xmeml, fcpxml, otio, edl, relink dialog | **CLOSED** |

Gate O was marked **CLOSED** while motion templates were known to be broken: a template dragged onto the
timeline did not look like its card, the nested render path differed between preview and export, saving a
project dropped template gradients, a dropped custom template rendered another template's text, and several
panel controls did nothing. Gate O was re-opened and re-closed as **Gate O+** (12 pull requests, #18 to #48).
The evidence per item, including what is still unverified, is in `docs/VERIFICATION_DEBT.md` section 13, and
the deferred items are in `docs/KNOWN_LIMITATIONS.md` under "Gate O+ (Motion Templates)".

---

## 2. Pre-Release Verification Protocol

Before shipping a release build, all automated suites must pass sequentially without retries:

```bash
# 1. Vitest Unit Suite (89 files, 521 tests)
npm test

# 2. Chrome Metal/WebGL2 GPU Suite (42 tests)
npm run test:gpu

# 3. TypeScript Typecheck (392 files)
npm run typecheck

# 4. ESLint Audit
npm run lint

# 5. Prettier Code Formatting
npm run format:check

# 6. Production Static Build (8 static pages)
npm run build

# 7. Playwright Full E2E Acceptance (126 passed, 1 skipped)
npm run test:e2e
```

---

## 3. Accepted Technical Debt & Known Limitations

The following items are deliberately deferred or documented with transparent limitations:

1. **Tier 2 Codec Pack (ProRes / DNxHR / MPEG-2 / FFV1)**:
   - *Status*: `deferred (toolchain)`
   - *Owner*: System Toolchain Lead
   - *Reason*: WebAssembly C/C++ cross-compilation toolchain (`emcc` / `docker`) is absent on this development environment.
   - *Mitigation*: UI honestly marks the feature as "Deferred (Not Built)" with disabled Install action. Full unblock instructions documented in `docs/CODECS.md`.

2. **Synchronous PBO Readback in 10-bit WebGL2 Exporter**:
   - *Status*: `accepted limitation`
   - *Owner*: Render Pipeline Lead
   - *Reason*: `gl.readPixels` blocks CPU while reading planar YUV buffers from GPU (~11.5 ms/frame at 1080p).
   - *Mitigation*: Export runs inside a background Web Worker, ensuring zero main-thread UI stutter.

3. **Track Transitions Flag**:
   - *Status*: `parked behind ?labs=transitions`
   - *Owner*: UI Lead
   - *Reason*: Feature complete, gated for user evaluation before default activation.

4. **Premiere Pro `.prproj` Binary Format**:
   - *Status*: `omitted (no golden sample)`
   - *Owner*: Interchange Lead
   - *Reason*: No sample project exists in repo (`/samples/minimal.prproj`). Premiere Pro natively imports xmeml v4 (`.xml`) and CMX3600 EDL with 100% fidelity.

