# Animation, schema v2 and time remap

## Model (`core/animation.ts`)

- `AnimatedValue<T>` is `{ value }` or `{ keyframes }`. Keyframe times are clip-local timeline µs.
- Interpolations: `hold`, `linear`, `bezier`. Bezier uses the left keyframe's `easeOut` as P1 and the right
  keyframe's `easeIn` as P2; defaults are (0.42, 0) and (0.58, 1).
- Values hold before the first and after the last keyframe. Non-lerpable values hold their left value.
- Colors interpolate per channel in gamma-encoded sRGB (not linear light). Angles unwrap by default, with
  an optional `'shortest'` mode.
- Splitting uses de Casteljau subdivision and is lossless (verified on 1,000 random curves). A head trim
  re-bases keyframes (`retimeAnimatedValue`).

## Clip properties

`clip.properties` ids: `position` [x,y], `scale` [x,y], `rotation` (degrees), `opacity` (0–1),
`anchor` [x,y]. `evaluateLayerProperties` (in `core/playback.ts`) evaluates them at local time and merges
them over the legacy `clip.transform`, so renderers only see plain numbers. Clips without `properties`
resolve exactly as in Phase 1.

## Schema v2

`CURRENT_SCHEMA_VERSION = 2`. v1 → v2 is a no-op that bumps the version; versions > 2 are rejected. New
optional fields: `clip.source`, `properties`, `masks`, `blendMode`, `timeRemap`; `Track.transitions`;
`Project.sequences`; `Asset.proxy`. Ids across effects, masks, transitions and sequences must be unique and
transitions must reference existing clips. `duplicateProject` remaps these ids and drops `proxy`.

## Time remap

`timelineToSource` is bit-identical to Phase 1 without `timeRemap`. With it, the speed curve is integrated
(hold exact, linear trapezoid, bezier composite Simpson, 64 steps); `sourceToTimeline` inverts by binary
search. `splitClipsAt` honours it. In Gate M, head trims re-base `timeRemap` via `retimeForHeadTrim`,
updating `clip.sourceIn` to the integrated source time at the cut point and shifting keyframe times backward.

## Gate I: Properties, Keyframing and Transform Gizmo

### Clip Properties & Crop

- Property IDs: `position` [x, y], `scale` [x, y], `rotation` (degrees), `opacity` (0–1), `anchor` [x, y], and `crop` [left, top, right, bottom] (0–1 fractions).
- Crop insets are clamped such that `left + right < 1` and `top + bottom < 1`, preserving at least 1% visible content.

### Legacy `clip.transform` Policy

- The Inspector treats `clip.properties` as the single source of truth.
- On the first Inspector edit of a clip containing a legacy static `clip.transform`, `migrateLegacyTransform(clip)` converts it to constant entries in `clip.properties` and removes `clip.transform` within that same single recorded history entry.
- Reading continues to fall back to `clip.transform` transparently for Phase 1 projects that have not been modified.

### Inspector Editing Semantics

- Editing a constant property replaces the constant value.
- Editing an animated property auto-keys at the playhead time (frame-snapped).
- Scrubbing inputs coalesces into a single undo step.
- Stopwatch toggles animation on/off: turning on creates a keyframe at the playhead; turning off flattens the property to the current value.

### On-Canvas Gizmo Math & Coordinate Spaces

- Coordinate transformation hierarchy:
  1. **Monitor CSS px → Composition px**: Divide by `monitorScale` (monitor pixels per composition pixel, incorporating fit scale and user zoom).
  2. **Composition px → Clip-Local Layer Space**: Subtract the pivot $T = (W/2 + x + ax, H/2 + y + ay)$, apply inverse rotation $R(-\theta)$, and divide by scale $(s_x, s_y)$.
- `layerAffine` is the single source of truth for mapping the unit quad $(u, v) \in [0, 1]^2$ to composition pixels (y down).
- **Pivot & Anchor Math**:
  When dragging the anchor handle, the anchor point moves in composition space to the pointer location. The `position` property is simultaneously compensated via `positionForPivot` so that the layer content does not visually shift on the screen.
- **Snapping**:
  Bounding box features (left, center, right; top, middle, bottom) snap to composition guides (center, edges, third lines, safe areas) within a tolerance in composition pixels.

## Gate J: Effect Parameter Keyframing

Effect parameters use dynamic property IDs adhering to the pattern:

```
effect:<type>:<instanceId>:<paramName>
```

- **Universal Contract**: By implementing dynamic lookup in `descriptorFor(propertyId)` (`core/properties.ts`), all effect parameters inherit the full animation infrastructure:
  - Linear, hold, and bezier ease curve evaluation via `core/animation.ts`.
  - Inspector stopwatch toggles, keyframe diamond steppers, and auto-keying at current playhead.
  - Timeline keyframe diamond lanes with drag-move, drag-box marquee selection, copy (`mod+c`), paste (`mod+v`), and delete (`delete`).
  - Graph Editor cubic bezier visual manipulation (`shift+g`) and Easy Ease (`f9`).
- **Splitting & Retiming**:
  - `splitAnimatedValue` and `retimeAnimatedValue` cleanly subdivide and shift effect parameter keyframes when clips are trimmed or split on the timeline.

## Gate L: Mask Parameter & Shape Keyframing

Mask parameters use dynamic property IDs adhering to the pattern:

```
mask:<maskId>:<property>
```

- **Supported Properties**:
  - `mask:<id>:shape`: Animatible flat numeric representation of the geometry (6 numbers for `rect`, 5 for `ellipse`, $6 \times N$ for `path`).
  - `mask:<id>:feather`: Animatible scalar feather in composition pixels (0–200 px).
  - `mask:<id>:expansion`: Animatible scalar expansion in composition pixels (-100–100 px).
  - `mask:<id>:opacity`: Animatible scalar opacity (0–1).
- **Universal Contract**:
  - `descriptorFor(propertyId)` dynamically provides descriptors and clamps for mask properties.
  - Scalar properties (`feather`, `expansion`, `opacity`) integrate into the Graph Editor (`shift+g`) with full cubic bezier curve control.
  - `mask:<id>:shape` uses numeric array component-wise keyframing with auto-key on on-canvas shape edits.
- **Same-Point-Count Invariant**:
  - Keyframing a path shape requires all keyframes to maintain the same point count. Inserting or deleting vertices on an animated mask is blocked with an explanatory error notice unless animation is flattened or disabled first.
- **Timeline & Inspector Integration**:
  - Timeline lanes (`ClipView.tsx`) display keyframe diamonds for active mask properties.
  - Inspector Masks section provides stopwatch toggles, keyframe steppers (prev/next), and diamond toggle buttons for shape and scalar properties.

## Graph Editor: exact numbers and the speed graph

- **Numbers for the selected keyframe**: with one keyframe selected, a bar above the curves shows its Time (seconds), Value (display units) and, for a bezier segment, the influence and value of its handles, in percent. A number applies on Enter or when the field loses focus, as one undo step; an entry that is not a number is ignored. `core/curveNumerics.ts` converts between handles and numbers.
- **Handle numbers**: an out handle is measured forwards from its keyframe and an in handle backwards from its own keyframe (the in handle is stored on the key at the end of its segment, measured from the segment's start), so the default ease reads 42% influence, 0% value on both sides. Influence stays within the segment (0 to 100%). A value above 100% or below 0% overshoots. The influence of each handle is its weight, set independently of the other handle.
- **Speed graph**: the Speed button replaces the value curves with how fast each visible curve changes, in its display units per second (`velocityCurve` in `core/curveNumerics.ts`, measured over a 10 ms window). It is read only. A fall draws below the zero line.
