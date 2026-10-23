@AGENTS.md

## Claude Code

The shared rules are in `AGENTS.md`, imported above. Claude Code reads `CLAUDE.md` instead of `AGENTS.md`
when both exist, so keep this file to what is specific to Claude Code and put anything every agent needs
in `AGENTS.md`.

- Start the dev server in background mode (`npx astro dev --background`) and manage it with
  `astro dev status`, `astro dev logs` and `astro dev stop`. Never leave it running in the foreground.
- Prefer the dedicated Read, Edit and search tools over shell `cat`, `sed` and `grep`.
- While iterating, run only the tests for the files you touched. Run `npx tsc --noEmit` before you finish.
- Instructions here are context, not enforcement. Anything that must never happen belongs in a hook or a
  permission rule in `.claude/settings.json`, and in CI once it exists.
- Personal preferences go in `CLAUDE.local.md`, which git ignores, not in this file.
