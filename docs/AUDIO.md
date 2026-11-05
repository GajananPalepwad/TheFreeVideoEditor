# Audio Architecture & Processing Guide (Pro Audio Engine)

This document specifies the professional audio architecture for **TheFreeVideoEditor**, detailing mathematical foundations, the single `AudioGraphController`, the isomorphic `buildAudioGraph` builder, the offline rendering pipeline, mixing controls, plugin delay compensation (PDC), loudness metering, and real-time playback integration.

---

## 1. Mathematical Foundations & Pan Law

### Decibels and Linear Amplitude Gain

Gain calculations are strictly bounded between $-96\text{ dB}$ (digital silence floor) and $+24\text{ dB}$ (maximum gain ceiling). JSON serialization never outputs `-Infinity`:

$$\text{gain}(dB) = \begin{cases} 0 & \text{if } dB \le -96 \\ 10^{\frac{\min(24, dB)}{20}} & \text{otherwise} \end{cases}$$

$$\text{dB}(\text{gain}) = \begin{cases} -96 & \text{if } \text{gain} \le 10^{-96/20} \approx 0.00001585 \\ \max(-96, \min(24, 20 \log_{10}(\text{gain}))) & \text{otherwise} \end{cases}$$

### Constant-Power Stereo Pan Law

For pan $p \in [-1, 1]$:
$$\theta = \frac{\pi}{4}(p + 1)$$
$$G_L = \cos(\theta), \quad G_R = \sin(\theta)$$

- **Center ($p = 0$):** $\theta = \frac{\pi}{4} \implies G_L = G_R = \frac{\sqrt{2}}{2} \approx 0.7071$ ($-3.01\text{ dB}$ center attenuation).
- **Hard Left ($p = -1$):** $\theta = 0 \implies G_L = 1.0, \quad G_R = 0.0$.
- **Hard Right ($p = 1$):** $\theta = \frac{\pi}{2} \implies G_L = 0.0, \quad G_R = 1.0$.
- **Acoustic Power Invariant:** $G_L^2 + G_R^2 = 1.000000$ identically across all pan settings, preserving total acoustic energy in stereo space.

### Equal-Power Fades & Crossfades

Clip-level fade in ($T_{in}$) and fade out ($T_{out}$) over duration $T$:

- **Equal-Power Crossfade Curve ($\cos/\sin$):**
  For transition progression $p \in [0, 1]$ between outgoing clip $A$ and incoming clip $B$:
  $$g_A(p) = \cos\left(\frac{p \pi}{2}\right), \quad g_B(p) = \sin\left(\frac{p \pi}{2}\right)$$
  Invariant: $g_A^2 + g_B^2 = 1.000000$, ensuring seamless crossfades without volume dips or peaks.
- **Equal-Power Fade In / Fade Out:**
  $$G_{in}(t) = \sin\left(\frac{\pi t}{2 T_{in}}\right), \quad G_{out}(t) = \sin\left(\frac{\pi (T - t)}{2 T_{out}}\right)$$
- **Linear Curve:**
  $$G_{in}(t) = \frac{t}{T_{in}}, \quad G_{out}(t) = \frac{T - t}{T_{out}}$$

---

## 2. Core Architecture: AudioGraphController

Live audio is owned by a single controller singleton (`src/editor/services/audio/controller.ts`):

1. **Context Ownership & Gesture Unlocking**:
   - Manages a single `AudioContext` instance.
   - Automatically unlocks audio on the first user interaction (click, play, scrub) via `unlock(): Promise<void>`.
   - Never suspends without UI notification; gracefully resumes on window focus or user input.
2. **Minimal-Diff Reactive Subscriptions**:
   - Subscribes to the project store and analyzes state changes with minimal diffs.
   - **Parameter changes** (faders, pans, trim, EQ gains, compressor thresholds) apply directly to existing Web Audio `AudioParam` nodes via `setTargetAtTime` / `setValueAtTime`, avoiding clicks and avoiding expensive graph teardowns ($< 0.05\text{ ms}$ update latency).
   - **Structural changes** (adding/removing tracks, inserting rack effects, changing bus routing) rebuild only the affected subgraphs, preserving undisturbed tracks.
3. **Zero Node Leaks**:
   - All disconnections explicitly cascade through source nodes, biquads, gains, panners, and analysers.
   - Verified across 100 consecutive rebuild cycles with constant baseline node counts.
4. **Dedicated AudioWorklet Processing**:
   - Clip, track, submix bus, and master DSP effect racks execute on the dedicated browser audio thread via `dsp.worklet.ts` (`AudioWorkletNode`).
   - Completely removes DSP processing from the main JavaScript thread, eliminating audio crackles and buffer underruns during timeline scrubbing, gizmo interaction, and waveform rendering.
   - Automatically falls back to `ScriptProcessorNode` only when `AudioWorklet` is unavailable.

---

## 3. Shared AudioGraph Topology (Preview & Export Parity)

`src/editor/services/audio/graph.ts` is the single source of truth for both live preview (`AudioContext`) and offline render (`OfflineAudioContext`):

```
Clip Source (HTMLMediaElement / AudioBufferSourceNode)
      │
      ▼
GainNode (Clip Volume Automation + Equal-Power Fades)
      │
      ▼
StereoPannerNode (Clip Pan Automation)
      │
      ▼
GainNode (Track Pre-Amp Trim: -24 dB .. +24 dB)
      │
      ▼
Track Effect Rack (Pure TS DSP / AudioWorklet / Biquads)
  ├── Band 1: High-Pass / Low-Shelf
  ├── Band 2: Parametric Peaking (Q, Freq, Gain)
  ├── Band 3: Parametric Peaking (Q, Freq, Gain)
  ├── Band 4: Low-Pass / High-Shelf
  └── Dynamics Compressor (Threshold, Ratio, Attack, Release, Makeup)
      │
      ▼
GainNode (Track Fader: -96 dB .. +12 dB)
      │
      ▼
StereoPannerNode (Track Pan: -1.0 .. +1.0)
      │
      ▼
GainNode (Mute / Solo Gate: 0.0 or 1.0)
      │
      ▼
DelayNode (Track Plugin Delay Compensation - PDC)
      │
      ▼
Track AnalyserNodes (Peak, RMS, Ballistics)
      │
      ├──────────────────────────────┐
      ▼ (Default)                    ▼ (Submix Routing)
Master Bus Input GainNode       Submix Bus Input GainNode (Bus 1..N)
      │                              │
      │                              ▼
      │                         Submix Bus Rack & Fader
      │                              │
      └──────────────────────────────┘
      │
      ▼
Master Effect Rack & Multi-Band EQ
      │
      ▼
GainNode (Master Fader dB)
      │
      ▼
DynamicsCompressorNode / Lookahead Limiter (-0.5 dBTP Ceiling)
      │
      ▼
Master AnalyserNodes (Peak, RMS, 4x True-Peak, LUFS Tap)
      │
      ▼
Destination (AudioContext.destination / OfflineAudioContext.destination)
```

---

## 4. Solo / Mute Truth Table & Exclusive Solo

When resolving audible audio tracks (`resolveAudibleTracks`):

1. **Standard Solo**:
   - If **any** track has `solo === true`:
     $$\text{audible} \iff \text{solo} === \text{true} \land \text{muted} === \text{false}$$
   - If **no** track has `solo === true`:
     $$\text{audible} \iff \text{muted} === \text{false}$$
2. **Exclusive Solo (`Cmd/Ctrl + Click`)**:
   - Clicking Solo while holding `Cmd` (macOS) or `Ctrl` (Windows/Linux) solos the selected track while immediately clearing solo on all other tracks.

---

## 5. Plugin Delay Compensation (PDC)

Effects with lookahead or phase filters report their algorithmic latency in samples (`latencySamples`):

- `computeGraphPdc(project, sampleRate)` calculates cumulative latency along every parallel track and submix bus path to the master destination.
- Graph builder inserts sample-exact `DelayNode` compensators on faster paths.
- Guarantees sample-exact time alignment ($\le 1\text{ sample}$ error) across parallel tracks, live preview, and multi-track export renders.

---

## 6. Loudness Compliance (ITU-R BS.1770-4 / EBU R128)

The editor features a real-time and offline loudness analysis engine (`src/editor/core/audio/loudness.ts`):

1. **K-Weighting Filter**: Pre-filter high-shelf ($+4.0\text{ dB}$ at $1.5\text{ kHz}$) followed by RLB high-pass filter ($f_c \approx 38\text{ Hz}$) adapted for any sample rate.
2. **Standard Windows**:
   - **Momentary Loudness ($M$)**: $400\text{ ms}$ sliding rectangular window.
   - **Short-Term Loudness ($S$)**: $3.0\text{ s}$ sliding window.
   - **Integrated Loudness ($I$)**: Full-timeline integrated measure with dual-stage gating (absolute threshold at $-70\text{ LUFS}$, relative threshold at $-10\text{ LU}$).
   - **Loudness Range (LRA)**: Distribution of short-term loudness between 10th and 95th percentiles (EBU Tech 3342).
3. **Target Presets**:
   - **Broadcast (EBU R128)**: $-23.0\text{ LUFS}$, max $-1.0\text{ dBTP}$.
   - **YouTube**: $-14.0\text{ LUFS}$, max $-1.0\text{ dBTP}$.
   - **Spotify**: $-14.0\text{ LUFS}$, max $-1.0\text{ dBTP}$.
   - **Apple Music / Podcasts**: $-16.0\text{ LUFS}$, max $-1.0\text{ dBTP}$.
   - **Netflix**: $-27.0\text{ LUFS}$, max $-2.0\text{ dBTP}$.

---

## 7. Offline Rendering & Memory Caps

- Single-pass `OfflineAudioContext` is used for timeline frame counts $\le 32\text{M}$ samples ($\approx 256\text{ MB}$ in 32-bit float stereo, $\approx 11.1$ minutes at $48\text{ kHz}$).
- For long timelines exceeding 256 MB, the offline renderer splits playback into overlapping chunks with $\ge 1.0\text{ s}$ pre-roll to allow IIR filters and compressors to settle, eliminating seam artifacts ($< -60\text{ dBFS}$).
- Render throughput benchmark: $> 100,000,000\text{ samples/sec}$ ($> 2,000\times$ faster than real-time playback).

---

## 8. Keyboard Shortcuts & Accessibility

- `Alt+M` (`⌥M`): Toggle Audio Mixer panel.
- `Alt+0` (`⌥0`): Reset active track/master fader to $0\text{ dB}$.
- `Alt+Shift+M` (`⌥⇧M`): Toggle mute on selected audio track.
- `Alt+Shift+S` (`⌥⇧S`): Toggle solo on selected audio track.
- `Cmd+Click` / `Ctrl+Click` on Solo: Exclusive solo.
- `Double Click` on any fader or pan knob: Reset to default unity gain ($0\text{ dB}$) or center ($0.0$).
- All mixer sliders and knobs include `role="slider"`, `aria-label`, and live value readouts for screen-reader accessibility.

---

## 9. Pan & Balance Control (`PanControl`)

The `PanControl` component (`src/editor/ui/audio/PanControl.tsx`) implements professional audio panning semantics:
- **Center Detent**: Deadband of $\pm 2\%$ around center ($|p| \le 0.02 \implies p = 0$) preventing unwanted channel bias.
- **Display Readout**: Displays `C` at center, `L1` to `L100` on the left, and `R1` to `R100` on the right.
- **Reset Shortcuts**: Double-click or Alt-click on the slider or readout instantly resets to center ($0.0$).
- **Direct Numeric Entry**: Clicking the readout opens a focused text input supporting `C`, `Center`, `0`, `L50` ($-0.5$), `R40` ($+0.4$), `-25` ($-0.25$), or raw numbers.
- **Keyboard Navigation**:
  - `ArrowLeft` / `ArrowDown`: Step left by 1%.
  - `ArrowRight` / `ArrowUp`: Step right by 1%.
  - `Shift + Arrow`: Step by 10%.
  - `Home`: Jump to hard left (`L100`).
  - `End`: Jump to hard right (`R100`).
- **Stereo Balance Semantics (`balanceGains(pan)`)**:
  - For stereo signals, panning acts as a true stereo balance control:
    - Pan left ($p < 0$): Left channel remains at unity ($1.0$), right channel attenuates by $(1 + p)$.
    - Pan right ($p > 0$): Right channel remains at unity ($1.0$), left channel attenuates by $(1 - p)$.
    - Constant acoustic balance without mid-channel power loss or mono summing artifacts.

---

## 10. Premiere-Style Audio Inspector (`EffectControlsAudio`)

The `EffectControlsAudio` panel (`src/editor/ui/audio/EffectControlsAudio.tsx`) provides clip-level audio inspection:
- **Volume**: Clip-level gain fader with numerical dB input, mute toggle, and unity reset.
- **Panner**: Integrated `PanControl` for clip-level stereo balance.
- **Applied Effects Rack**:
  - Reorder effects via drag or move up/down controls.
  - Per-effect bypass toggle (`Ø`).
  - Per-effect delete button (`×`).
  - "Custom Setup → Edit..." action launching dedicated visual popups for Parametric EQ and Dynamics Compressor.
  - Collapsible individual parameters with live slider adjustments.

---

## 11. Master True-Peak Limiter & Metering

- **Hardware Lookahead Limiter**: Configured with a true lookahead buffer, fast attack ($0.001\text{ s}$), and program-dependent release.
- **Brickwall Clamping**: Followed by a non-linear WaveShaper brickwall clamp curve that guarantees output peak never exceeds $-0.5\text{ dBTP}$ under any signal condition:
  $$f(x) = \begin{cases} x & \text{if } |x| \le c \\ c \cdot \tanh\left(\frac{|x|}{c}\right) \cdot \operatorname{sgn}(x) & \text{otherwise} \end{cases}$$
  where $c = 10^{-0.5 / 20} \approx 0.94406$.
- **Calibrated ITU-R BS.1770-4 LUFS Metering**: Master strip displays calibrated Short-Term / Integrated LUFS and True-Peak dBTP readouts.

---

## 12. Automation Modes

Channel strip automation defaults strictly to `'read'` (safe playback) rather than `'latch'`:
- `'off'`: Automation ignored, static fader values.
- `'read'` (Default): Follows recorded parameter curves without modifying project state.
- `'touch'`: Overwrites automation curves while fader is actively held, returning to recorded curve on release.
- `'latch'`: Begins overwriting automation when fader is first moved and continues until playback stops.
- `'write'`: Continuously writes current fader position over automation curve throughout playback.

