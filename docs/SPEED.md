# Speed, Reverse, Time Remapping, and Freeze Frames (Gate M)

This document specifies the speed and time-manipulation architecture in TheFreeVideoEditor, covering constant speed adjustment, non-linear time remapping curves, reverse playback, freeze frames, and high-fidelity audio time-stretching via WSOLA.

---

## 1. Speed Models & Semantics

The editor supports two complementary speed modification models:

### Constant Speed (`clip.speed`)

- **Semantics**: Linear multiplier applied uniformly across the entire clip. Speed $s = 1.0$ is normal playback ($100\%$), $s = 2.0$ is $200\%$ ($2\times$), $s = 0.5$ is $50\%$, and $s < 0$ is reverse playback.
- **Speed/Duration Dialog (`Alt+R`)**:
  - Displays linked percentage and timecode duration inputs.
  - Duration is derived bidirectionally: $\text{duration} = \frac{|\text{sourceOut} - \text{sourceIn}|}{|s|}$.
  - Offers a **Ripple** toggle to push or pull later clips on the track when clip duration changes.
  - Offers a **Reverse** toggle ($s \to -s$).
  - Offers a **Maintain Audio Pitch** toggle (`clip.maintainPitch`).
- **One-Click Reverse Any Clip (`Shift+R`, Timeline Context Menu, Edit Menu, Inspector)**:
  - Reverses **any clip type** (video, audio, image, text, shape, solid/gradient, adjustment layer, or nested sequence / template).
  - Negates playback direction (`speed` or `timeRemap`), swaps `sourceIn`/`sourceOut`, reverses keyframed animations on `properties`, `effects`, and `masks` across `clip.duration` via `reverseAnimatedValue`, and swaps `fadeInUs`/`fadeOutUs`.
  - Automatically includes linked A/V and grouped clips, respects locked tracks and nested sequence scopes, and updates filmstrip thumbnails and audio waveforms to reflect reversed playback.

### Time Remapping (`clip.timeRemap`)

- **Semantics**: An `AnimatedValue<number>` representing the instantaneous speed multiplier at each local timeline position.
- **Speed curve values**:
  - $v = 1.0$: Normal source speed ($100\%$).
  - $v = 2.0$: Double speed.
  - $v = 0.0$: Freeze frame (source time stops progressing).
  - $v < 0.0$: Reverse playback segment.
- **Timeline duration is invariant**: Adjusting time remapping curves alters which source frame is displayed at each timeline moment, leaving clip duration on the timeline fixed.
- **Graph Editor Integration**: The reusable Graph Editor and Inspector display and edit time remapping curves with linear, hold, and bezier ease handles.

---

## 2. Mathematical Integration & Mapping

All mapping routines reside in `src/editor/core/timeRemap.ts`:

### Forward Mapping: `timelineToSource(clip, timelineTime)`

- Integrates the speed curve from `clip.start` (where $\text{source} = \text{clip.sourceIn}$) to $\text{timelineTime}$:
  $$\text{source}(t) = \text{sourceIn} + \int_{t_{\text{start}}}^{t} v(\tau) \, d\tau$$
- **Segmented Integration**:
  - **Hold segments**: Exact rectangle integration $\Delta \text{source} = v \cdot \Delta t$.
  - **Linear segments**: Exact trapezoid integration $\Delta \text{source} = \frac{v_1 + v_2}{2} \cdot \Delta t$.
  - **Bezier segments**: 64-step composite Simpson's rule numerical integration.

### Reverse Mapping: `sourceToTimeline(clip, sourceTime, hintTimeline)`

- Inverts the mapping via binary search / root-finding across the clip's timeline duration.

### Head Trim Re-basing: `retimeForHeadTrim(clip, trimDelta, newDuration)`

- In previous gates, head trims did not re-base `timeRemap`. Gate M resolves this:
  - Updates `clip.sourceIn` to $\text{timelineToSource}(\text{clip}, \text{clip.start} + \text{trimDelta})$.
  - Re-times keyframe timestamps by shifting them backward by $\text{trimDelta}$ via `retimeAnimatedValue`.

---

## 3. Source Range & Extent Model

- **Schema Relaxation**: In `src/editor/core/schema.ts`, the legacy constraint $\text{sourceOut} > \text{sourceIn}$ is relaxed whenever `clip.timeRemap` is present or when reversed ($\text{clip.speed} < 0$).
- **`sourceExtent(clip)`**: All systems checking bounds, media availability, handles, waveforms, thumbnails, and interchange export use `sourceExtent(clip) -> { min, max }`:
  - Evaluates start, end, keyframe stops, and inflection points.
  - Warns in the UI with an `Exceeds media duration` badge if the mapped source extent exceeds the underlying asset's duration (`isSpeedExceedingMedia`).

---

## 4. Freeze Frames

Two freeze operations are available via shortcut, context menu, and Edit menu:

1. **Add Freeze Frame (`Shift+F`)**:
   - Splits the clip at the playhead position into three segments:
     1. Head segment (plays up to freeze point).
     2. 2-second hold segment with `timeRemap: { value: 0 }`, `sourceIn = sourceOut = freezeSource`, and `volume: 0`.
     3. Tail segment (resumes from freeze point).
   - Ripples subsequent clips on the track to accommodate the inserted 2-second hold.
2. **Freeze Frame to End of Clip (`Alt+Shift+F`)**:
   - Converts the clip from playhead onward into a freeze frame, setting instantaneous speed to $0$.

---

## 5. Audio Processing & WSOLA Time-Stretching

### Dual-Mode Playback Engine

1. **Constant forward speed ($[0.25\times, 4.0\times]$)**:
   - Uses native `HTMLMediaElement.playbackRate` and `HTMLMediaElement.preservesPitch = clip.maintainPitch !== false`.
2. **Reverse, freeze, and speed ramps**:
   - Switches to a seek-based rendering mode. Audio playback in seek-mode is silenced during interactive scrub/reverse, accompanied by a non-intrusive preview hint banner (`"Preview may be choppy for this speed"`).

### Export Audio Mixdown (`audioMix.ts`)

- Implements in-house **WSOLA (Waveform Similarity Overlap-Add)** time-stretching in `src/editor/services/audio/wsola.ts`.
- **Algorithm**:
  - Divides input into overlapping analysis frames (e.g. 20 ms Hanning window).
  - Cross-correlates adjacent synthesis candidates within an adaptive search window to find optimal phase alignment.
  - Overlap-adds with crossfade to preserve pitch and timbre during time acceleration or deceleration.
  - Supports non-linear time remapping curves chunk-by-chunk through `renderRemappedAudio`.

---

## 6. Export Video Pipeline & LRU Frame Cache

- Non-linear speed curves and reverse playback require non-monotonic frame access during export.
- `src/editor/services/export/frameProvider.ts` includes an **LRU ImageBitmap cache** (64 frames capacity):
  - Minimizes redundant video frame decoding when seeking backward or evaluating freeze frames.
  - Evicts oldest bitmaps cleanly to maintain bounded memory footprint.

---

## 7. Keyboard Shortcuts

| Action                  | Shortcut (Mac / Other) | Scope   |
| :---------------------- | :--------------------- | :------ |
| Speed / Duration Dialog | `Alt+R`                | Editing |
| Reverse Clip            | `Shift+R`              | Editing |
| Add Freeze Frame        | `Shift+F`              | Editing |
| Freeze Frame to End     | `Alt+Shift+F`          | Editing |
