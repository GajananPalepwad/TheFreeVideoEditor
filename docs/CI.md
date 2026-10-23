# Continuous Integration

GitHub Actions checks every pull request to `main` and every push to `main`. Small parallel jobs keep the feedback fast and show exactly what failed.

## Workflows

| Workflow                                            | Runs on                  | What it does                                                   |
| --------------------------------------------------- | ------------------------ | -------------------------------------------------------------- |
| [`ci.yml`](../.github/workflows/ci.yml)             | PRs and pushes to `main` | Typecheck, unit tests, build, lint and format of changed files |
| [`pr-title.yml`](../.github/workflows/pr-title.yml) | PRs                      | Checks the PR title format and adds the matching label         |
| [`codeql.yml`](../.github/workflows/codeql.yml)     | Pushes to `main`, weekly | Security analysis of the TypeScript code (CodeQL)              |
| [`dependabot.yml`](../.github/dependabot.yml)       | Weekly                   | Opens PRs that update the pinned GitHub Actions                |

Draft pull requests skip `ci.yml` until they are marked ready for review. A new push to a PR cancels its older run.

## Jobs in `ci.yml`

| Job                  | Command (run it locally the same way) | Blocks a merge when                                   |
| -------------------- | ------------------------------------- | ----------------------------------------------------- |
| Typecheck            | `npx astro sync && npx tsc --noEmit`  | There is any type error                               |
| Unit tests           | `npx vitest run --testTimeout=30000`  | A test fails                                          |
| Build                | `npm run build`                       | The site does not build                               |
| Lint changed files   | `npx eslint <file>`                   | A changed file has more lint errors than on `main`    |
| Format changed files | `npx prettier --check <file>`         | A changed file is less formatted than on `main`       |
| CI passed            | none                                  | Any job above failed. **This is the one to require.** |

`npx astro sync` generates the `.astro/` types. A fresh clone does not have them, so run it before `tsc` there.

### Why lint and format only check changed files

`main` still has lint errors and unformatted files, so checking everything would fail every PR. Instead each changed file is compared with the same file on the base branch:

- A new file must be clean.
- An existing file may not get worse. A file that was already unformatted can stay that way, a clean file must stay clean, and the number of lint errors may not go up.

Existing debt is tolerated and new debt is not. Once the baseline is cleaned up, these jobs can switch to `npm run lint` and `npm run format:check` on the whole repository. The logic lives in [`scripts/ci/ratchet.mjs`](../scripts/ci/ratchet.mjs).

## Pull request titles

Titles use Conventional Commits: `type(scope): subject`, with an optional `!` before the colon for a breaking change.

- Types: `feat`, `fix`, `perf`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`.
- Example: `fix(timeline): stop clips overlapping after a ripple edit`.

The check fails when the title does not match. It then adds an existing label, and never removes one a person chose and never creates a new one:

| Title type                                                 | Label           |
| ---------------------------------------------------------- | --------------- |
| `fix`                                                      | `bug`           |
| `docs`                                                     | `documentation` |
| `feat`, `perf`, `style`, `refactor`, `test`, `chore`, `ci` | `enhancement`   |

## Security choices

- **Least privilege.** Every workflow starts with a read-only token. Only the jobs that need more ask for it: `pr-title` can write PR labels and CodeQL can write security events.
- **Pinned actions.** Third-party actions are pinned to a full commit SHA, with the version in a comment. A tag can be moved, a commit cannot. Dependabot proposes updates.
- **No stored credentials.** Checkouts use `persist-credentials: false`.
- **No install scripts.** `npm ci --ignore-scripts` stops a compromised dependency from running code during install. Build, tests and typecheck do not need them.
- **Untrusted input stays out of shell code.** Event data such as a PR title is passed through environment variables, never pasted into a script.
- **Fork-safe.** `ci.yml` and `codeql.yml` use `pull_request`, so PRs from forks get no secrets. `pr-title.yml` uses `pull_request_target` to be able to label fork PRs, and is safe because it only checks out the base branch and never runs code from the PR.
- **Time limits.** Every job has a timeout.

## Reusable actions

Small composite actions in [`.github/actions/`](../.github/actions) keep the workflows short:

| Action          | Purpose                                                   |
| --------------- | --------------------------------------------------------- |
| `setup-node`    | Node from `.nvmrc`, cached npm, `npm ci --ignore-scripts` |
| `changed-files` | Lists the files a PR or push changed, filtered by regex   |
| `ratchet`       | Runs the lint or format ratchet on that list              |

## Updating a pinned action

Merge the Dependabot PR, or look up the new release by hand and replace the SHA and the version comment together. Check the SHA against the release tag before merging.

## Settings only a repository admin can change

These cannot be set from a pull request:

- In **Settings > Branches**, require the `CI passed` and `Conventional title` checks on `main`. Requiring only `CI passed` is enough for the code checks.
- Optionally enable **Code scanning** results in the Security tab, which CodeQL feeds.

## Common failures

- **Typecheck fails on missing CSS or `import.meta.env` types.** Run `npx astro sync` first.
- **`interop.test.ts` fails locally.** It needs `xmllint` (`libxml2-utils`). CI installs it.
- **A test times out locally under load.** CI gives tests 30 seconds. Run `npx vitest run --testTimeout=30000`.
- **Lint or format says a file got worse.** Run the command it prints. For lint, fix the new error. Do not reformat a whole file just to touch it unless the check asks you to.
- **PR title check fails.** Edit the title; the check reruns on its own.

## Not covered yet

- **End-to-end tests.** Playwright specs need a browser and a dev server, and 13 of them already fail on `main`. They are not part of CI yet.
- **`astro check`.** It reports the same as `tsc` plus checks of `.astro` files, but `npm run typecheck` fails on a fresh install because npm leaves out the optional package `@emnapi/runtime`. Adding that package as a dev dependency would fix it.
- **CodeQL on fork PRs.** A fork's token cannot upload results, so those PRs are skipped. Every merge to `main` is still scanned.
