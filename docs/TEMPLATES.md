# Title Graphics & Motion Templates (Gate O)

A motion template is a small multi-track timeline stored in a `.tfvetemplate` file. Dropping one on the
timeline creates a **nested sequence instance**: one clip that plays the template's layers, with a few
published fields (text, colours, size) the user can edit.

## Where templates come from

| Source                     | Where                                            | Notes                                                                              |
| -------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Built-in library           | `public/templates/*.tfvetemplate`                | Loaded at build time by `core/templates/builtinTemplates.ts` (`import.meta.glob`). |
| Imported by the user       | Graphics panel, Import, stored in `localStorage` | Read by the same `deserializeTemplate`.                                            |
| Saved from the timeline    | Graphics panel, Save as template                 | Built by `createTemplateFromClips`.                                                |
| Author sample (not listed) | `public/templates/example.tfvetemplate`          | A small template to copy from; excluded from the library.                          |

The files are the source of truth. The built-in library is whatever is in `public/templates/`, listed in
file-name order, and a file that does not read cleanly fails the build with its path in the error. The
Graphics panel's Templates tab lists this library (`filterBuiltinTemplates`), so a file added there shows up
in the tab.

## File format

A `.tfvetemplate` is JSON. The reader is `deserializeTemplate` and the schema is
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

## Fonts and media inside a file

- **Export** (Graphics panel, Custom Templates, Export): the file embeds the custom fonts its text uses and the project media its clips use. Fonts that ship with the editor are not embedded. Media that is not in the open project cannot be embedded; the panel says what is missing. More than 8 MB is refused with the name of the file that did not fit.
- **Import**: embedded fonts are installed as custom fonts (unless the family is already available) and embedded media is imported into the open project, with the template's clips pointed at the new assets. The copy kept in the template library is the light one, without the embedded data.
- **Missing pieces**: adding a template whose font is not available says so in the panel and the default font is drawn; a clip whose media is missing stays offline as any missing media does.
- **Media follows the project**: imported media lives in the project that imported it. Adding the template in another project needs the file imported again there.

## Writing a template

1. Copy `public/templates/example.tfvetemplate`, give it a new `id` and `name`.
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
- `state/templatePlacement.test.ts`: dropping onto a track equals "+ Add" at the playhead, and repeated
  drops never overlap.
- `tests/e2e/template-text-bounds.spec.ts`: nothing reaches the edge of any template's bounds, at the
  default size and at the slider maximum.
- `tests/e2e/template-parity.spec.ts`: a card's pixels match the Program monitor, for every template at
  three times.
- `templateResources.test.ts`: base64, which fonts and assets a template uses, embedding with the size limit, missing resources, remapping.
- `tests/e2e/template-resources.spec.ts`: a custom font and a picture travel with a template and are installed on import, through the Graphics panel as well.
- `tests/e2e/template-fidelity.spec.ts`: dragging each card and pressing "+ Add" build the same instance.
