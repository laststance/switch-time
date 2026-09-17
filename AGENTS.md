# AGENTS.md

Rules for coding agents (Claude Code, Codex) in this repository. `CLAUDE.md` is a symlink to this file, so both tools read the same rules.

## Design UI changes in pen.dev first

A change that alters what the user sees starts in the design file, and the code follows the design. This covers layout, spacing, colour, type, the text on a screen, and adding or removing a control or a screen.

- The design source is `design/switch-time.pen` (pen.dev). Open it with `open -a Pen design/switch-time.pen`; the pencil MCP works on the document Pen has open. Change `.pen` files only through the pencil MCP or in Pen, never with file-editing tools.
- Pen does not autosave. Save with Cmd+S, then commit the design change (one design task, one save, one commit) before the code that implements it.
- Design tokens follow the same order: the `.pen` file first, then `design-system/theme.json` and `design-system/styles.css`, then the code that copies them (`apps/app/src/global.css`, `packages/shared`).
- `design/PEN-MIGRATION.md` has the agent procedure and the known traps, `design/README.md` maps the design files, and `design/tokens.md` explains the tokens.
- Work that leaves the screen unchanged (API, logic, tests, a refactor that keeps every pixel) needs no design step.

## Work in a new git worktree

Unless the user says otherwise, a Claude Code or Codex task that changes the repository runs in its own git worktree, on a new branch cut from the latest `origin/main`. Don't edit files in the main checkout.

- Claude Code: run `git fetch origin`, then `EnterWorktree`, which creates `.claude/worktrees/<name>` on a new branch `worktree-<name>` and moves the session into it (`claude --worktree <name>` does the same for a new session). The branch starts at the locally cached `origin/HEAD`, which is `origin/main` here, and Claude Code refetches it only when the last fetch is more than 24 hours old, so fetch first.
- Codex: create the worktree outside the repository, then start Codex in it.

  ```sh
  git fetch origin
  git worktree add -b <type>/<topic> ~/.codex/worktrees/switch-time/<topic> origin/main
  codex --cd ~/.codex/worktrees/switch-time/<topic>
  ```

  Don't put it under the repository's `.codex/`: Codex's workspace-write sandbox keeps that directory read-only. `codex --worktree` is an experimental feature that checks out the starting checkout's `HEAD` detached, so use the commands above.

- Before running anything in a new worktree, copy `.env` from the main checkout (it is untracked), then run `pnpm install`.
- Run `pnpm check` and the other scripts inside the worktree. ESLint and Prettier skip `.claude/` (`eslint.config.mjs`, `.prettierignore`): each worktree there is a full checkout, and the main checkout's lint would fail on it.
- The API tests share one `_test` database and empty it before every test. Never run them in two checkouts at once.
- Playwright reuses a server that already listens on :4000 / :4001 (`reuseExistingServer`), and that server may belong to another checkout. In a worktree, set `E2E_API_PORT` and `E2E_APP_PORT` together to free ports so the run starts this worktree's own build.
- Once the PR is merged, remove the worktree and its branches:
  - Claude Code, in the session that created it: `ExitWorktree` with `remove`.
  - Otherwise, from the main checkout after pulling `main`: `git worktree remove <path>`, then `git branch -d <branch>`.
  - Delete the remote branch as well (`gh pr merge --delete-branch` does it). If another open PR is based on that branch, retarget it to `main` first, or GitHub closes it.
