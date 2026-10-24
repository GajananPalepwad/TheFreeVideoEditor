# Title Graphics & Motion Templates (Gate O)

A motion template is a small multi-track timeline stored in a `.grafree` file. Dropping one on the
timeline creates a **nested sequence instance**: one clip that plays the template's layers, with a few
published fields (text, colours, size) the user can edit.

## Where templates come from

| Source                     | Where                                            | Notes                                                                              |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Built-in library           | `public/templates/*.grafree`                     | Loaded at build time by `core/templates/builtinTemplates.ts` (`import.meta.glob`). |
| Imported by the user       | Graphics panel, Import, stored in `localStorage` | Read by the same `deserializeTemplate`.                                            |
| Saved from the timeline    | Graphics panel, Save as template                 | Built by `createTemplateFromClips`.                                                |
| Author sample (not listed) | `public/templates/example.grafree`               | A small template to copy from; excluded from the library.                          |

The files are the source of truth. The built-in library is whatever is in `public/templates/`, listed in
file-name order, and a file that does not read cleanly fails the build with its path in the error. The
Graphics panel's Templates tab lists this library (`filterBuiltinTemplates`), so a file added there shows up
in the tab.

## File format

A `.grafree` is JSON. The reader is `deserializeTemplate` and the schema is
`core/templates/templateSchema.ts`.

- **Envelope**: `$schema` and `tfve_type: "motion_template"`. Both are dropped on read. A file with a
  different `tfve_type` is refused.
- **`version`**: a positive whole number, currently `1`. A newer version is refused with a message
  asking the user to update the editor; a missing version is read as `1`.
- **Template fields**: `id`, `name`, `category`, `description`, `author`, `createdAt`, `duration`
  (microseconds), `responsiveTiming` (`introDuration`, `outroDuration`), `bounds` (`width`, `height`,
  `originX`, `originY`), `tracks`, `publishedParams`, `previewThumbnail`.
- **`resources`** (optional): fonts and media the template uses, so the file looks the same on another machine. `resources.fonts` is a list of `{ family, fileName, data }` and `resources.assets` a list of `{ id, name, mimeType, data }`, where `data` is base64 and an asset's `id` is the `assetId` its clips use. A file may embed up to 8 MB in total.
- **`tracks`** use the same schema as a project's tracks, so a template cannot hold anything a project
  could not. Errors name the field, for example `tracks.0.clips.0.duration`.
- **Unknown top-level fields** are kept when a template is read and written back.
- **Track order**: the first track is the top layer. Put text above its background shape.
- **Units**: crop is a fraction of the source (`0` to `1`), not a percentage. Positions are relative to
  the centre of the template's own canvas (`bounds`).

### Published fields

Each entry in `publishedParams` points at a clip in the template and a property on it:

| `targetProperty`                                   | Effect                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- |
| `text.content`, `text.fontFamily`, `text.fontSize` | Text, font, and size (`text.fontSize` property).              |
| `text.fill`, `text.accentBarColor`                 | Recolours; keyframed colours keep their animation.            |
| `shape.fill`, `shape.stroke`                       | Recolours the shape, including an animated `shape.fillColor`. |
| `solid.color`, `shape.gradient`                    | Solid colour and shape gradient.                              |
| `transform.scale`, `transform.opacity`             | Scale and opacity of the layer.                               |

`text.stroke` is accepted by the schema but not applied yet.

## Templates inside templates

With a template sequence open, "+ Add", a drag from a card and the store's `instantiateTemplate` place the new
template in that sequence, as one undo step. Its published fields work, it can be unpacked into the open
sequence, and the root timeline draws it through both levels. `resolveFrame` stops at a nesting depth of 8.

## Writing a template

1. Copy `public/templates/example.grafree`, give it a new `id` and `name`.
2. Edit the layers. Keep clips on one track from overlapping in time.
3. Keep every `publishedParams[].targetClipId` pointing at a clip id in the file.
4. Import it from the Graphics panel to try it. To ship it, add it to `public/templates/`.

## The built-in library

Eighteen templates in five categories, each with at least two: Titles (Cinematic Blockbuster, Modern Bold
Punch, Minimal Editorial, Cyber Glitch Tech, Chapter Marker), Kinetic (Bouncy Pop Headline, Dynamic Split
Angle, Kinetic Marquee Stack, Typewriter Terminal, Word Cascade), Lower Thirds (Broadcast News Header,
Documentary Elegant Card, Clean Minimal Wipe Lower Third, Corporate Name Strap), Social (Social Creator Pill,
Subscribe Banner) and Callouts (Circular Crest Emblem, Highlight Callout). The Graphics panel only shows
a category tab that has templates.

Word Cascade is the kinetic example: three text layers on three tracks, each revealing word by word with
`text.reveal` keyframes while sliding into place, one after the other.

## Bounds and frames

A template's `bounds` is the size of its own canvas. Anything drawn outside it is cut off, so it is
measured, not guessed:

- Text is measured with the layout the renderer draws with (the layer's own line height and letter
  spacing), at the largest size the Text Size slider allows (`TEXT_SIZE_MAX_SCALE`, 1.5 times the drawn
  size). That needs a canvas and the bundled fonts, so `npm run templates:generate` runs the converter in
  headless Chromium (Playwright). Under Node there is no canvas and text would measure as a fixed box.
- Each frame, plate or rule is sized and placed from the measured text block, honouring left and right
  alignment. A frame does not follow the text if the slider is raised after the template is placed.

## The generator

Eighteen of the shipped files are generated from the definitions in `core/text/graphicsTemplates.ts` by
`core/templates/templateConverter.ts` (Word Cascade and the Mixkit lower third are built by hand in the
converter). After changing either, run:

```
npm run templates:generate
```

It rewrites the files in `public/templates/` (keeping each file's `createdAt`). `npm test` never writes
files. It checks that the shipped files match the converter output for everything a browser does not
measure (clips, parameters, timing), and tells you to run the script if they do not. Bounds and frame sizes
depend on browser font metrics, so `tests/e2e/template-text-bounds.spec.ts` checks them in a browser.

## Tests

- `builtinTemplates.test.ts`: the library is exactly the shipped files; the example reads and renders.
- `templateLibrary.test.ts`: 18 templates, every category populated, no overlapping clips on a track.
- `templateSchema.test.ts`: exact round trips, version and validation errors.
- `templateMapping.test.ts`: overrides, crop units, frame decorations, layer order, unpacking.
- `templateConverter.test.ts`: the shipped files match the converter's design.
- `templateBounds.test.ts`: text is measured with the renderer's line height and letter spacing.
- `templateFidelity.test.ts`: every template saves and reopens unchanged and draws the same layers; the
  drawn layers at three times are pinned as snapshots (`__snapshots__/`). Update them with
  `npx vitest run -u` only when a template is meant to change.
- `state/templatePlacement.test.ts`: dropping onto a track equals "+ Add" at the playhead, repeated
  drops never overlap, and a template can be placed, edited and unpacked inside another template.
- `tests/e2e/template-text-bounds.spec.ts`: nothing reaches the edge of any template's bounds, at the
  default size and at the slider maximum.
- `tests/e2e/template-parity.spec.ts`: a card's pixels match the Program monitor, for every template at
  three times.
- `templateResources.test.ts`: base64, which fonts and assets a template uses, embedding with the size limit, missing resources, remapping.
- `tests/e2e/template-resources.spec.ts`: a custom font and a picture travel with a template and are installed on import, through the Graphics panel as well.
- `tests/e2e/template-fidelity.spec.ts`: dragging each card and pressing "+ Add" build the same instance.
- `tests/e2e/template-nested.spec.ts`: "+ Add" and a drag inside an open template sequence, and the real
  renderer drawing the inner template.
