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

Cursor stays in the current checkout. Do not create a worktree unless the user asks for one.

Unless the user says otherwise, a Claude Code or Codex task that changes the repository runs in its own git worktree, on a new branch cut from the latest `origin/main`. Don't edit files in the main checkout.

- Claude Code: run `git fetch origin`, then `EnterWorktree`, which creates `.claude/worktrees/<name>` on a new branch `worktree-<name>` and moves the session into it (`claude --worktree <name>` does the same for a new session). The branch starts at the locally cached `origin/HEAD`, which is `origin/main` here, and Claude Code refetches it only when the last fetch is more than 24 hours old, so fetch first.
- Codex: create the worktree outside the repository, then start Codex in it.

  ```sh
  git fetch origin
  git worktree add -b <type>/<topic> ~/.codex/worktrees/switch-time/<topic> origin/main
  codex --cd ~/.codex/worktrees/switch-time/<topic>
  ```

  Don't put it under the repository's `.codex/`: Codex's workspace-write sandbox keeps that directory read-only. `codex --worktree` is an experimental feature that checks out the starting checkout's `HEAD` detached, so use the commands above.

- Before running anything in a new worktree, make sure it has `.env` (it is untracked), then run `pnpm install`. Claude Code copies `.env` from the main checkout into each worktree it creates, because `.worktreeinclude` lists it. A Codex worktree, or any other made with `git worktree add`, needs it copied by hand.
- Run `pnpm check` and the other scripts inside the worktree. ESLint and Prettier skip `.claude/` (`eslint.config.mjs`, `.prettierignore`): each worktree there is a full checkout, and the main checkout's lint would fail on it.
- The API tests share one `_test` database and empty it before every test. Never run them in two checkouts at once.
- Playwright reuses a server that already listens on :4100 / :4101 (`reuseExistingServer`), and that server may belong to another checkout. In a worktree, set `E2E_API_PORT` and `E2E_APP_PORT` together to free ports so the run starts this worktree's own build.
- Once the PR is merged, remove the worktree and its branches:
  - Claude Code, in the session that created it: `ExitWorktree` with `remove`. If it refuses because the branch has commits (it did right after PR #50 merged), use `keep` instead and finish from the main checkout as in the next item.
  - From the main checkout, after pulling `main`: `git worktree remove <path>`, then `git branch -d <branch>`. After a squash or rebase merge, `-d` can refuse, because `main` then holds new commits rather than the branch's own. Confirm that the PR shows as merged (`gh pr view <number> --json state`), then delete the branch with `git branch -D <branch>`.
  - Delete the remote branch as well (`gh pr merge --delete-branch` does it). If another open PR is based on that branch, retarget it to `main` first, or GitHub closes it.

## Close a TODOS.md item in the PR that fixes it

`TODOS.md` is the list of open work. When a PR fixes an item on it, the same PR updates `TODOS.md`; don't leave that to a later cleanup PR.

- Delete the item. `TODOS.md` keeps no `## Completed` section: the PR description says what the fix did and what it left out, and the CHANGELOG records the change when the PR ships a release. `/ship` moves finished items under `## Completed`; delete them instead.
- If the PR fixes only part of an item, rewrite the item to cover what is left, and keep its priority unless the owner changes it.
- If the fix leaves a related gap that the item did not cover, add the gap as a new item in the same PR.
- In the same PR, update any other item the fix affects: one that refers to the deleted item (point it at the PR or the release instead), cites a version the PR changed, or quotes a title the PR rewrote.

## Cloud Agent environment

Cloud Agents use the documented Compose backend (`docker compose up --build`: Postgres 18 + the API). systemd is not PID 1, so start launches `dockerd` itself, then Compose. install writes `.env` including a generated `BETTER_AUTH_SECRET`. After start the API is on `:4100`; open the Expo web app with `pnpm --filter app web` (`:4101`). The environment still installs Node `24.20.0` with nvm, while the repository pins `26.10.0` (`.node-version`) and the API image runs Node 26. Until its install step moves to 26 (TODOS.md), run `. "$HOME/.nvm/nvm.sh" && nvm install 26.10.0`, then prepend `$HOME/.nvm/versions/node/v26.10.0/bin` when `node -v` shows 22 (from `/exec-daemon`) or 24.
