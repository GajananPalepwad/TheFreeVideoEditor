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
| Typecheck (required)    | `npx tsc --noEmit`                                                    |
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
- Some checks already fail on `main` (lint errors, unformatted files, `interop.test.ts` needs
  `xmllint`, a few slow unit tests time out under load, some e2e specs). Compare against `main` before
  blaming your change, and do not fix unrelated failures inside a feature PR.
- Run the affected tests and `npx tsc --noEmit` before saying work is done. Report failures as they are.

## Code style

- Match the surrounding code: naming, idiom, comment density. Prettier config: tabs, single quotes, no
  trailing commas, width 100. The repo is not prettier-clean, so format only files you create.
- No dead code, no speculative abstractions, no unrelated reformatting or renames in the same change.
- Avoid `any`; validate file and project data with Zod.
- Fix root causes in the data mapping or renderer, not with visual workarounds.

## Generated files

`public/templates/*.tfvetemplate` (except the hand-written `example.tfvetemplate`) are generated. Edit
`src/editor/core/templates/templateConverter.ts`, run `npm run templates:generate` (it uses headless
Chromium through Playwright), and commit the regenerated files with the change. Never edit them by hand.

## Git and pull requests

- Open or claim an issue first for anything larger than a typo; small fixes can go straight to a PR.
- Branch from the latest `main` as `feat/`, `fix/`, `perf/`, `docs/`, `refactor/`, `test/` or `chore/`.
- Conventional commits: `type(scope): short description`; the body says why. Make several short commits,
  each one logical change plus its tests. Stage explicit paths, not `git add -A`.
- Before pushing: fetch upstream, rebase on `main`, re-run the checks above.
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

## External docs

[Astro](https://docs.astro.build) for routing, components and styling;
[React](https://react.dev) for UI; [Zod](https://zod.dev) for schemas; [Vitest](https://vitest.dev) and
[Playwright](https://playwright.dev) for tests. Visual language for the marketing pages is in
[DESIGN.md](./DESIGN.md).
