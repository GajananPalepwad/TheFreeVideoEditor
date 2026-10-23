# AGENTS.md

Instructions for AI coding agents working in this repository. The full human guide is
[CONTRIBUTING.md](./CONTRIBUTING.md); this file is the short, command-first version. If the two disagree,
fix the one that is wrong in the same PR.

## Project

The Free Video Editor: a browser-based, 100% client-side video editor. Astro 7 + React 19, TypeScript 6,
Tailwind 4, Zustand 5 + Immer, Zod 4, WebGL2/Canvas2D rendering, WebCodecs (mediabunny) export. Node

> = 22.12. Tests: Vitest 5 (unit) and Playwright (e2e).

## Commands

| Task                    | Command                                                               |
| ----------------------- | --------------------------------------------------------------------- |
| Dev server (agents)     | `npx astro dev --background`, then `astro dev status \| logs \| stop` |
| Editor URL              | `http://localhost:4321/editor`                                        |
| Typecheck (required)    | `npx astro sync` once on a fresh clone, then `npx tsc --noEmit`       |
| Unit tests, whole suite | `npm test`                                                            |
| Unit tests, some files  | `npx vitest run <path> [<path>...]`                                   |
| e2e, one spec           | `npx playwright test tests/e2e/<spec> --project=chromium --workers=1` |
| Lint                    | `npm run lint`                                                        |
| Format a file you wrote | `npx prettier --write <file>`                                         |
| Production build        | `npm run build`                                                       |
| Regenerate templates    | `npm run templates:generate` (see "Generated files")                  |

- e2e needs the dev server running. After `npm run build`, restart it, or e2e fails with
  `_jsxDEV is not a function`. The first e2e run after a new import can fail with "Execution context was
  destroyed" while Vite re-optimises: run it again.
- Specs reach the editor store through `window.__TFVE_STORE__`.
- Never run `npm run deploy` (see Boundaries).

## Layout

| Path                   | What lives there                                                         |
| ---------------------- | ------------------------------------------------------------------------ |
| `src/editor/core/`     | Pure data models and math: timeline, animation, templates, schema, text  |
| `src/editor/services/` | Browser and hardware: render (WebGL2/Canvas2D), playback, export, audio  |
| `src/editor/state/`    | Zustand store, actions, undo/redo                                        |
| `src/editor/ui/`       | React components: timeline, inspector, graphics panel, preview           |
| `src/pages/`           | Astro pages (`/editor` mounts the app)                                   |
| `public/templates/`    | `.tfvetemplate` motion templates                                         |
| `tests/e2e/`           | Playwright specs. Unit tests sit next to the code as `*.test.ts`         |
| `docs/`                | One guide per area (`TEMPLATES.md`, `ANIMATION.md`, `RENDERING.md`, ...) |

Read the guide in `docs/` for the area you are changing before you start, and update it when behaviour
changes. `docs/KNOWN_LIMITATIONS.md` lists accepted gaps; do not re-report them as bugs.

## Architecture rules

- `core/` is pure and deterministic: no React, DOM, WebGL or WebCodecs imports. It must run in Node.
- `services/` owns browser resources and must release them (`dispose()` / `close()`). Modules in
  `services/render/*.ts` may not use `window.`, unguarded `document.` or `getImageData`
  (enforced by `renderBoundary.test.ts`).
- `state/` mutations are atomic, serializable and one undo entry. Coalesce high-frequency edits.
- `ui/` stays thin: calculations go to `core/`, state changes go through store actions.
- Invariants: non-destructive editing; no two overlapping clips on one track; time is integer
  microseconds (`1_000_000` = 1 s); no user media or telemetry leaves the device.

## Testing

- Write the failing test first, run it, and confirm it fails for the right reason before the fix. A test
  that passes immediately proves nothing.
- Every behaviour change ships with a unit test (preferred, in `core/` or `state/`) or a Playwright spec.
- Never copy an expected value from the code's own output: the test would only prove the code equals
  itself. Derive it by hand or from the spec.
- Tests never use the network or paid APIs (the opt-in `npm run test:captions:real` is the one exception). Use files in `tests/fixtures/` or build data in the test.
- A change that breaks a passing test is a regression, even if the total number of passing tests goes up.
  When behaviour changes, report the numbers as before and after, and name anything that went from pass
  to fail.
- Some checks already fail on `main` (lint errors, unformatted files, `interop.test.ts` needs
  `xmllint`, a few slow unit tests time out under load, some e2e specs). Compare against `main` before
  blaming your change, and do not fix unrelated failures inside a feature PR.
- Run the affected tests and `npx tsc --noEmit` before saying work is done. Report failures as they are.

## Coding rules

- Keep it simple. No speculative abstractions, no features beyond the task, but think through the edge
  cases (empty tracks, zero-length clips, missing assets, undo of the action).
- Match the surrounding code: naming, idiom, comment density. Prettier config: tabs, single quotes, no
  trailing commas, width 100. The repo is not prettier-clean, so format only files you create.
- No dead code and no unrelated reformatting or renames in the same change.
- Types: no `any` (use `unknown` and narrow). Validate file and project data with Zod at the boundary.
- Errors: throw a named subclass of `Error` (see `core/operations/errors.ts`), never a bare string. Wrap
  third-party failures with `new XError('...', { cause })`. One bad file or clip must not stop the app.
- Logging: no `console.log` in committed code. `console.warn` and `console.error` are for real failures and
  fallbacks only, with a message that says what went wrong. Never log user media or file contents.
- Comments: a short doc comment on every exported function and type saying what it is for and why, not how.
- Time and numbers: integer microseconds for time, never floats that can drift. Parse and validate numbers
  from files before using them.
- Fix root causes in the data mapping or renderer, not with visual workarounds.

### Language and framework specifics

- **React**: declare every hook unconditionally at the top of a component, before any early `return`
  (`react-hooks/rules-of-hooks` reports it as an ESLint error).
- **TypeScript**: narrow with the discriminated unions (`source.type`, `track.kind`) instead of casting.
  Use the branded ids (`ClipId`, `TrackId`, `AssetId`, `SequenceId`) from `core/types.ts`; `Time` is
  integer microseconds, never float seconds.
- **Zustand + Immer**: the producer passed to `set((state) => ...)` is synchronous. Await OPFS, decoders and
  parsers before or after it, never inside. Components subscribe with a selector
  (`useEditorStore((s) => s.x)`), never to the whole store, to keep playback smooth.
- **WebGL2 / GLSL**: shaders live in `services/render/shaders/*.glsl` with `precision highp float;`.
  Textures are premultiplied, so output premultiplied alpha. Every texture, program and framebuffer needs a
  `dispose()` path.
- **CSS**: scope class names by panel (`.inspector-*`, `.color-*`, `.timeline-*`) and add a
  `:root[data-theme='light']` variant next to the default dark styles.

## Generated files

`public/templates/*.tfvetemplate` (except the hand-written `example.tfvetemplate`) are generated. Edit
`src/editor/core/templates/templateConverter.ts`, run `npm run templates:generate` (it uses headless
Chromium through Playwright), and commit the regenerated files with the change. Never edit them by hand.
Text bounds are measured in the browser, so the output depends on the fonts installed on your machine and
can differ by a pixel or two. Regenerate only when you changed the converter, and commit only the
templates you meant to change.

## Working as an agent

- Work in small blocks: one logical change plus its tests, then run the checks.
- Never claim something works without running the command and showing its real output.
- If the user asked for step-by-step review, stop after each block and wait. Otherwise stop at the end
  and report what changed, what you ran, and what you did not verify.
- If the task is unclear or looks infeasible, stop and say so. Do not redesign the task.
- Explain changes in plain language: what changed and why.
- Commit, push and open PRs only when asked.

## Git and pull requests

- Open or claim an issue first for anything larger than a typo; small fixes can go straight to a PR.
- Branch from the latest `main` as `feat/`, `fix/`, `perf/`, `docs/`, `refactor/`, `test/`, `chore/` or `ci/`.
- Conventional commits: `type(scope): short description`; the body says why. Make several short commits,
  each one logical change plus its tests. Stage explicit paths, not `git add -A`.
- Rebase on `main`; do not merge `main` into your branch. Before pushing: fetch upstream, rebase, re-run
  the checks above.
- Before every commit run `git status` and check that no `.env`, local notes, build output, `test-results/`
  or generated files you did not mean to change are staged.
- Never commit straight to `main`.
- Title the PR `type(scope): subject` (feat, fix, perf, docs, style, refactor, test, chore, ci); CI checks it.
- Use the PR template in `.github/pull_request_template.md`, link the issue (`Fixes #n` or `Refs #n`), and
  add before/after screenshots or a recording for UI changes. Keep PRs small and single-purpose.
- You are responsible for everything you submit, including AI-written code. Read the diff before pushing.

## Boundaries

**Always**

- Read the relevant `docs/` guide and the code you are about to change.
- Add or update tests and docs with the change.
- Keep `core/` free of UI and browser dependencies.

**Ask first**

- Adding a dependency.
- Changing the `.tfvetemplate` or project file schema (older files must still load).
- Moving layer boundaries or doing a large refactor.
- Deleting files or branches, or touching anything outside the task.
- Actions visible to others: opening a PR or issue, commenting, merging, force-pushing.

**Never**

- Run `npm run deploy` or `wrangler`; deployment is for maintainers.
- Commit secrets or `.env` files, or send user media or telemetry off the device.
- Hand-edit generated files, `dist/`, `node_modules/` or `.astro/`.
- Delete, skip or weaken a failing test to get a green run.
- Force-push a shared branch or bypass a hook.

## Where each rule is enforced

| Rule                                     | Enforced by                                |
| ---------------------------------------- | ------------------------------------------ |
| No `any`, hooks before early returns     | ESLint (`npm run lint`); CI: changed files |
| Types                                    | `npx tsc --noEmit` (CI: Typecheck)         |
| Render modules stay worker-safe          | `renderBoundary.test.ts`                   |
| Behaviour, invariants, template fidelity | Vitest and Playwright specs                |
| Formatting                               | Prettier; CI: changed files only           |
| PR title format                          | CI: PR title check                         |
| Everything else in this file             | Convention and code review only            |

GitHub Actions runs the typecheck, unit tests, build, and lint and format of changed files on every PR
(see [docs/CI.md](./docs/CI.md)), and checks the PR title. Run the same commands before you push.

## External docs

[Astro](https://docs.astro.build) for routing, components and styling;
[React](https://react.dev) for UI; [Zod](https://zod.dev) for schemas; [Vitest](https://vitest.dev) and
[Playwright](https://playwright.dev) for tests. Visual language for the marketing pages is in
[DESIGN.md](./DESIGN.md).
