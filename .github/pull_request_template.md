## What

<!-- One or two sentences: what changes for the user or the code. -->

## Why

<!-- The problem this solves. -->

## Changes

<!-- The notable changes, as a short list. -->

## Files

<!-- The main files touched, grouped (source, tests, docs). -->

## Tests

<!-- What you ran and what it showed. Name failures that also happen on `main`. -->

## How to check

<!-- Steps a reviewer can follow, with commands. For UI changes add before and after screenshots or a recording. -->

## Checklist

- [ ] Branched from the latest `main`.
- [ ] Business logic stays in `src/editor/core/` with no UI dependencies.
- [ ] Core invariants hold: zero frame drift, non-destructive editing, no overlapping clips on a track, client-side privacy.
- [ ] `npx tsc --noEmit` reports 0 errors.
- [ ] `npm test` passes, and new behaviour has unit or Playwright tests written first.
- [ ] The PR title is `type(scope): subject`, for example `fix(timeline): stop clips overlapping`.
- [ ] Linked the related issue below.

<!-- Required: one line per related issue, for example `Fixes #123` or `Refs #123`. -->

Fixes #
