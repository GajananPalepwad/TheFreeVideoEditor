# Text System Architecture (Gate O)

The Free Video Editor features a high-performance, non-destructive text system integrated natively into the layer geometry, keyframe animation, Canvas2D, and WebGL2 render pipelines.

## Core Concepts

1. **Clip Source Discriminated Union**:
   Text clips are native timeline clips with `Clip.source`:

   ```ts
   {
     type: 'text',
     text: string,
     style?: TextStyle,
     box?: TextBox
   }
   ```

   Static styling properties (font family, weight, style, alignment) reside on `source.style`. Sizing constraints (auto-size, fixed width, vertical anchor) reside on `source.box`.

2. **Animatable Properties**:
   Animatable text styling properties live directly on `clip.properties` and integrate seamlessly with all Gate I keyframe lanes, curve evaluation, split/trim continuity, and auto-key:
   - `text.fontSize`: Font size in composition px.
   - `text.fillColor`: RGBA fill color vector `[r, g, b, a]`.
   - `text.strokeColor`: RGBA stroke color vector `[r, g, b, a]`.
   - `text.strokeWidth`: Stroke outline width in px.
   - `text.letterSpacing`: Additional spacing between graphemes in px.
   - `text.lineHeight`: Multiplier for vertical line spacing.
   - `text.reveal`: Reveal progress (0 to 1) for typewriter and progressive title reveals.

3. **Layout Engine (`core/text/layout.ts`)**:
   - Pure, deterministic, dependency-free text layout engine.
   - Handles multi-line strings, word wrapping within bounding boxes, grapheme-aware splitting using `Intl.Segmenter` (ensuring emojis and combining characters remain intact), text alignment (`left` | `center` | `right`), and vertical anchoring (`top` | `center` | `bottom`).
   - Injected `MeasureFunction` allows headless unit testing using simulated or monospace metrics.

4. **Rasterizer and Caching (`services/render/text/`)**:
   - `OffscreenCanvas` (falling back to `HTMLCanvasElement`) generates crisp premultiplied RGBA bitmaps.
   - Render order: Background Box -> Shadow -> Round-joined Stroke (behind fill) -> Fill.
   - Caching: Text rasters are cached in `TextRasterCache` keyed by the layout, style, and quantized scale hash, re-rasterizing only on parameter or resolution change.
   - Crisp scaling: text is rasterized at composition resolution × scale (capped at 2×) to prevent blurriness when scaled up.

5. **Presets & Templates (`core/text/presets.ts`)**:
   - 7 curated template presets: Title, Subtitle, Lower third, Bold outline, Neon glow, Typewriter caption, Pop-in caption.
   - 8 animation presets: Fade In/Out, Slide In Up/Down/Left/Right, Pop In, Typewriter.
   - Presets apply smoothly to clip keyframe curves and can be cleared with one click.

6. **Interaction & Editing**:
   - Timeline shortcut: `T` inserts a new text clip at the playhead on the selected or primary video track.
   - Double-clicking text on the preview canvas opens the on-canvas inline editor with IME safety, auto-focus, commit on blur, and `Esc` cancel.
   - Transform gizmo calculates exact text layout bounding box for intuitive direct manipulation on canvas.

## Animating each character, word or line (Gate O+)

A text clip can move its characters, words or lines separately, so one text layer does a typewriter pop,
a rise, a spin or a wave without stacking a layer per word.

**How it works.** The clip sets `text.anim.progress`, a value from 0 to 1 that runs over the whole text. Each unit
follows it a little later than the one before (`text.anim.stagger`) and moves from a starting pose to its
place. Setting `text.anim.progress` is what turns the animation on; the other properties take their defaults.

| Property                | Meaning                                                       | Default |
| ----------------------- | ------------------------------------------------------------- | ------- |
| `text.anim.progress`    | 0 puts every unit in its starting pose, 1 in its place        | 1       |
| `text.anim.stagger`     | 0 moves all units together, 1 moves them one after another    | 0.6     |
| `text.anim.offsetX`/`Y` | where a unit starts, in pixels from its place                 | 0, 40   |
| `text.anim.scale`       | the size a unit starts at, 1 being its own size               | 1       |
| `text.anim.rotation`    | the angle a unit starts at, in degrees                        | 0       |
| `text.anim.opacity`     | the opacity a unit starts at                                  | 0       |

All of them are ordinary properties, so each can be keyframed and eased (spring, bounce, bezier) like any other,
and they show in the graph editor. The unit is the one **Reveal by** sets: character, word or line. Spaces are not
units. `text.reveal` still applies first, so a half revealed text animates only its revealed part.

**In the app.** The text Inspector has an **Animate each ...** group with a row per property and an **Animate in**
button that keys the progress from 0 to 1 over the first second.

**How it is drawn.** `resolveFrame` puts the animator on the text layer (`core/text/animator.ts`). The rasterizer
draws each unit on its own, in the pose `unitTransform` gives for `unitProgress` (`core/text/textUnits.ts` finds the
units). The picture of the text keeps a margin all round, `animatorMargin`, so a unit that starts away from its
place is not cut off, and alignment ignores that margin (`textAnimationInset`), so animated text sits where the same
text without animation would.

**Limits.** Units are characters, words or lines, not individual curves of a glyph, and text on a path is not
supported. The margin follows the starting pose, so it changes if that pose is itself animated. An animated text is
drawn again every frame it changes.

## Captions & Subtitles Integration (Gate P)

Caption segments on dedicated caption tracks (`kind: 'caption'`) leverage the text layout engine:
- **Layout Mapping**: Track-level `captionStyle` is mapped into `TextStyle` and `TextBox` constraints (max width with margin padding, vertical anchor `bottom` | `center` | `top`, alignment `left` | `center` | `right`).
- **Word-Level Highlighting**: For karaoke and social pop styles (`highlightMode: 'word' | 'progressive'`), active word spans are computed from segment word timestamps and rendered through character-range styling runs during layout.
- **Bit-Accurate Compositing**: Both Canvas2D and WebGL2 render active caption layers through the shared `TextRasterCache`, ensuring identical pixel presentation in preview monitor and export workers.
