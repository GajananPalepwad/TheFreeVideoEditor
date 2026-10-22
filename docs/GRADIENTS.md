# Gradients (Gate O+)

Text, shapes and solid layers can be filled with a gradient of two to sixteen colour stops. Every part of
a gradient can be keyframed.

## What a gradient is

A gradient has a **type**, an **angle** (for `linear-angle`) and a list of **stops**, each a colour and a
position from 0 to 1.

| Where it is kept                      | Fields                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| A text clip: `source.box`             | `gradientType`, `gradientColorEnd`, `gradientAngle`, `gradientStops`           |
| A shape clip: `source`                | the same fields                                                                |
| A solid clip: `source`                | the same fields                                                                |

Types are `none`, `linear-horizontal`, `linear-vertical`, `linear-angle` and `radial`.

`gradientStops` holds the whole list and wins when it has two or more stops. Without it, the gradient runs
from the clip's fill (the text colour, the shape fill, the solid colour) to `gradientColorEnd`, as older
projects and templates do. Turning the type to `none` keeps the stops, so turning it back on restores them.

## Animating a gradient

Three property ids work on any clip that has a gradient:

- `gradient.angle` is the angle in degrees.
- `gradient.stop<N>.color` is the colour of stop N (counting from 0), as RGBA from 0 to 1.
- `gradient.stop<N>.offset` is the position of stop N, from 0 to 1 (shown as a percentage).

They are ordinary properties, so they use the same keyframes, easing, graph editor and Inspector stopwatch as
every other property. A property the clip does not animate shows the value its gradient has. In the old
two-colour form the first stop follows the fill, so an animated fill animates the gradient's start.

A stop is numbered by its place in the list, not by its position, so stops can pass each other while the
gradient animates. New stops go on the end of the list, so adding one never renumbers the animation of the
others. Removing a stop moves the animation of the later stops down by one.

## In the app

The Inspector has a **Gradient** section for text, shape and solid layers: a type, the angle (for an angled
gradient), and one group per stop with its colour and position, each with a stopwatch, plus **Add stop** and
a remove button per stop (a gradient keeps at least two). The old two-colour controls in the colour picker
are hidden once a clip has a list of stops.

## How it is drawn

`resolveGradient` (`core/gradient.ts`) turns a clip's fields and its `gradient.*` properties at one moment into
a type, an angle and sorted stops. `resolveFrame` puts them on the layer (`gradientStops` on text and shape
data, `solidGradientStops` on a solid). `createGradientPaint` (`services/render/gradientPaint.ts`) builds the
canvas gradient with every stop, and the text and shape rasterizers, the canvas compositor and the WebGL solid
texture all use it. Their caches are keyed by the stops, so an animated gradient is drawn again when it
changes.

## Limits

- Sixteen stops at most.
- The type cannot be keyframed, and a radial gradient is always centred on the layer.
- A gradient fills text and shapes, not their strokes.
- Interchange formats (EDL, FCPXML, xmeml, OTIO) cannot carry gradients, as they cannot carry other generated
  graphics.

## Tests

- `core/gradient.test.ts`: resolving stops and the old fields, animated angle, positions and colours, property
  descriptors, the file schema, editing the stop list, reading unanimated gradient properties.
- `core/playback.test.ts`: layers carry their resolved stops.
- `services/render/gradientPaint.test.ts`: the geometry and every stop of the canvas gradient.
- `state/gradientStops.test.ts`: add, set and remove stops, undo, animating a stop, inside a template sequence.
- `tests/e2e/gradients.spec.ts`: pixels read back from the canvas and WebGL renderers and from text.
- `tests/e2e/gradient-inspector.spec.ts`: the Inspector section.
