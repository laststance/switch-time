# TODOS

## Home

### Start detox from the first-launch screen

**What:** Offer detox as a starting state on `FirstLaunch`, next to the activity buttons.

**Why:** A new account cannot begin on detox. `DetoxRow` and the `0` hotkey live in `HomeBody`, which only mounts once `switches.current` is non-null, so the first tap has to be a real activity. That records a span the user did not want and then has to correct.

**Context:** Deliberate in the approved plan: first launch asks 「いま何をしていますか？」 and picking an activity is the onboarding. The API already supports it (`domain.test.ts`, "the very first tap can be detox"), so this is a UI-only change plus an e2e that signs up and presses detox without touching an activity. Raised by the Codex adversarial pass during the 0.1.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Correction

### Serialize a user's switch writes and re-read the neighbours inside them

**What:** Take a per-user lock at the start of every `switches.*` write transaction (`pg_advisory_xact_lock` on the user id), and move `withNeighbours` and the merge's day check inside it. Take the same lock in `activities.archive`, and check for an archived activity inside it in `switchTo` and `changeActivity`.

**Why:** `mergeIntoNext` reads the row and its next state before its transaction, then writes the row's start onto the next state by id. Two devices merging neighbouring records at once both succeed, and a span moves to the wrong activity for good: from 仕事 9:00, 休息 12:00, 娯楽 18:00, merging 仕事 into 休息 and 休息 into 娯楽 together leaves 娯楽 starting at 12:00 instead of 9:00, and 9:00–12:00 goes to whatever came before 仕事. A split racing a merge does the same, and `mergeIntoNext` on one row racing `mergeIntoPrevious` on the next can deadlock (a silent 500). Two 「元に戻す」 of one day at once (two tabs or devices) keep both inserts: under READ COMMITTED the second delete cannot see the first one's new rows, so every row appears twice, and the next undo on that day fails the order check. A tap, or a 活動を変える on the latest record, can also land between `archive`'s current-state check and its write, leaving an archived activity running, and two archives at once can pass the last-live-activity count together.

**Context:** New in 0.2.0.0 for `mergeIntoNext`; `mergeIntoPrevious` writes no time, and its update fails (rolling back the delete) when the kept row is already gone. Two merges of the same record no longer both succeed: `mergeInto` requires its delete to remove the row. `moveStart` and `splitInHalf` have computed their new time from a read outside the transaction since 0.1.0.0, and `switchTo` already names the missing per-user lock in a `ponytail:` comment. Needs a concurrency test against the real Postgres; the same-record test in `domain.test.ts` shows how to hold one transaction open and wait on `pg_stat_activity` until the other blocks. Raised by Codex's adversarial pass (as P1) and the Claude adversarial pass during the 0.2.0.0 ship; left to the owner before merging.

**Effort:** M
**Priority:** P1
**Depends on:** None

### Refuse an undo when the day changed after the edit

**What:** Make `replaceDay` conditional: send the rows the edit left, each with its id, start and activity, and answer CONFLICT inside the transaction when the day's current rows differ from them in any of those.

**Why:** 「元に戻す」 deletes the day's whole window and writes the snapshot back without looking. A switch made on another device after the snapshot's data was fetched (up to the 30 s `staleTime`), or after the edit while 元に戻す is still armed, is deleted for good, and the current state silently reverts. An edit made on another device in the meantime (±15 min, 活動を変える) is silently undone as well. It happens on one device too: when the refetch after an edit fails, the sheet unlocks on the pre-edit list, so the next edit snapshots that list and 元に戻す reverts both edits; and a merge paused offline arms 元に戻す with rows from before the connection dropped.

**Context:** The snapshot is `list.data` when the button is pressed (`use-correction.ts`), and Home's today view shares the `listByDay` key. Once the edit's invalidation has refetched, `queryClient.getQueryData` holds the rows the edit left. A client-only stopgap is `staleTime: 0` on the sheet's list plus holding the panel after a failed refetch (`list.isRefetchError`); it does not cover the offline case, which the row check does. Compare whole rows, not only ids: `moveStart` and `changeActivity` edit a row in place through `correct`, which keeps its id, so an id-only check would still let 元に戻す overwrite such an edit. Compare in the statement that deletes (`delete … returning id, started_at, activity_id` against the rows sent), or run the comparison under the per-user lock from "Serialize a user's switch writes and re-read the neighbours inside them". A separate select before the delete is not enough under READ COMMITTED: a switch committed between the two statements is still deleted. Since 0.2.1.0 (the archived-day undo fix, PR #49) this also reaches days that hold a record of an archived activity, today included once an activity used earlier today is archived: `replaceDay` used to refuse those days outright. A sheet left open across that deploy with a failed undo still armed replays its old snapshot on the next press. Raised by the red team during the 0.2.0.0 ship; Codex and the Claude adversarial pass added the one-device paths. The owner raised it from P2 to P1 on 2026-09-17.

**Effort:** M
**Priority:** P1
**Depends on:** None

### Say why a correction was refused

**What:** Show a short message in the correction sheet when an edit or 「元に戻す」 fails, e.g. 「次の記録は翌日なので統合できません」.

**Why:** Every failed `switches.*` write is silent: the buttons re-enable and nothing changes. The server now refuses a cross-day 「次の記録に統合」 with CONFLICT; the row flags normally hide that button, but a stale list can still reach it, and the user sees a tap that did nothing.

**Context:** `useCorrection` never reads the mutations' `error`, and `correction.tsx` has no error slot. The code alone cannot pick the message: `mergeIntoNext`, `mergeIntoPrevious`, `moveStart` and `splitInHalf` all refuse with CONFLICT, and only the English `message` tells the reasons apart. Give each refusal a machine-readable reason (`new ORPCError('CONFLICT', { message, data: { reason } })`), map that to Japanese, and show it in one `Text` under the action panel. Raised by the review during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Refetch the day's switches after the time zone changes

**What:** Invalidate `switches.*` in `useUpdateSettings` when `timeZone` changes, and carry the time zone in the undo snapshot so a replay under another zone is refused.

**Why:** `listByDay` is keyed by the day string, but the server windows it with the stored time zone. After a change, a cached answer (30 s `staleTime`) still holds the old window while the sheet computes `dayBounds` with the new one, so the row flags and the undo snapshot disagree with the day `replaceDay` rewrites: 「元に戻す」 then fails, or deletes rows the snapshot never had. For someone with two devices in different time zones this is routine rather than a rare settings change: `use-time-zone-sync.ts` writes the focused device's zone whenever it differs, so the stored zone flips back and forth.

**Context:** `useUpdateSettings` refetches `settings.*` and `stats.*` only. The server checks day bounds for 「次の記録に統合」 (0.2.0.0); `moveStart` and `splitInHalf` still trust the client's flags, so a mismatched window can also leave a stray row on the next day after 「元に戻す」. Since 0.2.1.0 the undo that deletes rows the snapshot never had also reaches days that hold a record of an archived activity, which `replaceDay` used to refuse before deleting anything. Pre-existing, raised by the review during the 0.2.0.0 ship; Codex and the Claude adversarial pass found it again, and the adversarial pass suggests the zone flipping may make it P1.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Explain a dimmed correction panel, and bound how long a write can hold it

**What:** Show one short line under the action panel while a `switches.*` write is pending, and a different one while it waits offline (for example 「接続が戻ると反映されます」), designed in the pen file first. Give the RPCLink `fetch` a deadline (`AbortSignal.timeout`, merged with `init.signal`) so a request that never answers fails and releases the panel.

**Why:** Since 0.2.0.0 the panel waits for every pending `switches.*` write in the shared mutation cache: a tap on ホーム, an edit from a sheet closed mid-flight, or a write paused offline on the web. Closing and reopening the sheet no longer clears that wait, as the old per-sheet `isPending` flags did. The dim looks the same as "not allowed on this row", and one request that never answers keeps every 訂正 sheet dim until the page reloads.

**Context:** Keep the gate. Leaving paused writes out of it would let edits made offline, each with its own stale snapshot, replay at once (`resumePausedMutations` runs them in parallel, and they have no `scope`). Do not `void` the `onSettled` refetch either: that unlocks the panel before the refetch lands and reopens the stale-snapshot window. `apps/app/src/lib/orpc.ts` sets no timeout, and `onSettled` awaits the refetch. Add e2e cases for a paused write and for one that never answers. Raised by the design, red-team and Claude adversarial passes during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Pin the undo snapshot and a merge into the running state with tests

**What:** Add three tests. (1) e2e: a merge the API refuses because the open sheet's list is stale (merge 娯楽 away through the API, then press 次の記録に統合 on 休息) leaves 元に戻す disabled. (2) e2e: hold the `mergeIntoNext` answer, force a refetch that shows the merged day (`page.clock` past the 30 s `staleTime`, then `visibilitychange`), release the answer, press 元に戻す and expect the merged row back. (3) API: merging the record before the running state moves `switches.current()` back to that record's start, with `source: 'merge'`.

**Why:** No test fails if `withUndo` arms 元に戻す on press instead of on success, or if the snapshot goes back to being taken when the edit lands (the 0.2.0.0 fix has no regression test). Every `mergeIntoNext` test merges into a record that has a later switch, so the everyday case, a mis-tap just before what is running now, is untested.

**Context:** `apps/app/src/hooks/use-correction.ts` (`withUndo`), `apps/app/e2e/correction.spec.ts` (the held-answer pattern is in "an edit still landing after its sheet closed…"), `apps/api/src/rpc/domain.test.ts`. Raised by the testing pass during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Decide what a merge that makes a segment idle should do

**What:** Warn in the sheet, or mark the row, when a merge makes a segment longer than the idle threshold. Decide as well whether a merge that leaves two rows of the same activity side by side should join them.

**Why:** A segment longer than `idleThresholdMinutes` (12 h by default) counts as idle and leaves the totals. Merging a 7 h row into a 6 h one therefore removes 13 h from the day's totals with no explanation. A merge can also leave the same activity twice in a row (仕事, 読書, 仕事 → merge 読書), which Home counts as one switch too many.

**Context:** `segmentsInRange` in `packages/shared/src/stats.ts` judges idle on the unclipped length. Both merge directions and the ±15 min steps can cross the threshold; the sheet does not know the threshold today (`useSettings` has it). `switchTo` never records the same activity twice in a row, but the merges can. Raised by the review during the 0.2.0.0 ship; the adversarial pass added the repeated activity.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Arm 「元に戻す」 from the mutation, not from the tap

**What:** Take the undo snapshot in a hook-level `onMutate` (returned as the mutation's context), arm the slot in the hook-level `onSuccess`, and keep the slot outside the sheet (Redux, keyed by day) so a reopened sheet for that day can still offer 元に戻す.

**Why:** Callbacks passed to `mutate()` run only for the latest `mutate()` call and only while the sheet is mounted. A double tap that lands the first merge and fails the second (NOT_FOUND) leaves 元に戻す unarmed, or armed with an older edit, so undo then reverts two edits. A merge that lands after 完了 can never be undone.

**Context:** The double-tap case is new in 0.2.0.0, which moved the snapshot into `mutate()` callbacks (the buttons dim only after the next render). The closed-sheet case has existed since 0.1.0.0 for 「前の記録に統合」. A hook-level `onMutate` runs with the render that pressed the button, so the snapshot stays the pre-edit list. Extend the held-answer e2e to press 元に戻す after the answer lands. Raised by the red team and the Claude adversarial pass during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Rebuild a merged-away record of an archived activity

**What:** Give the user a way to bring back a record of an archived activity once 「元に戻す」 is gone. Either `changeActivity` accepts the user's archived activity on a past row (and 活動を変える offers it there), or an `activities.unarchive` route with a control in 設定 brings the activity back so the usual edits can rebuild the row.

**Why:** Since 0.2.1.0 (PR #49), 「元に戻す」 restores a day that holds such a record, but only while the sheet that made the edit is open. After 完了, a record merged into its neighbour cannot be rebuilt: `changeActivity` refuses archived ids, the 活動を変える picker lists live activities only (`useActivities`), and no route unarchives an activity.

**Context:** The undo snapshot lives in `useState` in `use-correction.ts`, so closing the sheet drops it. "Arm 「元に戻す」 from the mutation, not from the tap" would keep the slot outside the sheet, which narrows this gap without closing it. Accepting archived ids in `changeActivity` also needs a rule for which rows may take one, such as "not the latest row", checked under the per-user lock from "Serialize a user's switch writes and re-read the neighbours inside them", since a later merge or undo can make the edited row the latest. An `unarchive` must also move the row to the end of the live order in the same update, as `create` does. Archiving keeps the old `position`, `reorder` may since have handed it to a live activity, and `activities_user_position_idx` is unique among live rows, so clearing `archived_at` alone would fail. Test it by archiving, reordering, then unarchiving. Left out of scope by the 0.2.1.0 fix, in which the owner chose to have `replaceDay` check ownership only; raised by the review during that ship.

**Effort:** M
**Priority:** P3
**Depends on:** None

## Stats

### Decide what a detox that runs past midnight does to 連続記録

**What:** Either let `classifyDay` measure a day whose carried-in state is detox, or keep the current rule and soften the wording that calls such a day 「アプリを使わなかった」 / 「切替なし」.

**Why:** Detox is the feature for deliberately stepping off the clock, yet day 2 of a multi-day detox has no tap, so it is `auto_unused`: the streak breaks, the day joins the 未使用日 list and the History footnote counts it as unused.

**Context:** The rule predates detox and covers every carried-in state (an activity left running over a weekend behaves the same), which is why 0.1.0.0 shipped it unchanged (decision at ship time, option A). `summarizeDays` already has the segments and `detoxMs` per day, so option (a) is local to `classifyDay` in `packages/shared/src/stats.ts`, but it moves `measuredDays`, `streak` and every 1日あたり average for all states, so it needs its own tests. Raised by the adversarial pass during the 0.1.0.0 ship.

**Effort:** M
**Priority:** P2
**Depends on:** None

## Shared

### Reuse one `Intl.DateTimeFormat` per time zone

**What:** Cache the formatters that `civil` (`packages/shared/src/time.ts`) and `formatTime` (`apps/app/src/lib/format.ts`) build, keyed by time zone.

**Why:** The correction sheet re-renders on every 1 s clock tick, and each render builds several formatters for `dayBounds` plus one or two per row. A new one costs about 0.02 ms on Node against 0.0003 ms reused: roughly 1 ms a second for a 20-row day on the web, and Hermes is usually slower.

**Context:** The API's stats paths call the same helpers per row. A module-level `Map` in each file is enough; a `useMemo` on the day's bounds in `useCorrection` is optional on top. Pre-existing, raised by the review during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep a four-digit year in `localDay`

**What:** Pad the year in `localDay` (`String(c.year).padStart(4, '0')`) and add a `time.test.ts` case for a day before the year 1000. Bound `daySchema` as well (a four-digit year, no earlier than, say, 1970-01-01): negative years, and years 0–99, which `Date.UTC` reads as 1900–1999, break `dayBounds` even with the padding.

**Why:** `daySchema` accepts `0999-06-01`, so `replaceDay` stores a row on it, but `localDay` returns `999-06-01`, which `dayBounds` cannot parse: `mergeIntoNext` answers 500 instead of CONFLICT for that row. `dayBounds` also puts such days an hour off, because its own `localDay` check never matches.

**Context:** Only rows a client plants in its own account reach it. Raised by the security pass during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Database

### Let the switches index serve the timeline queries in order

**What:** Declare `switches_user_started_idx` with `startedAt.desc().nullsFirst()` and generate the migration.

**Why:** Drizzle's `.desc()` writes `started_at DESC NULLS LAST`, while the queries' `desc()` and `asc()` sort with Postgres' default null order, which that index serves in neither direction. Every `latestSwitch`, `withNeighbours` and `switchesBetween` lookup sorts all of the user's rows instead of reading one index entry, and the cost grows with every tap.

**Context:** `apps/api/src/db/schema/app.ts`. Confirm with `EXPLAIN` on a seeded account that the Sort node is gone. Pre-existing, raised by the review during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Make the database refuse a switch that names another account's activity

**What:** Add a unique constraint on `activities (id, user_id)` and replace the `switches.activity_id` foreign key with a composite one, `(activity_id, user_id)` → `activities (id, user_id)`, keeping `on delete cascade`; generate the migration.

**Why:** The foreign key checks only that `activity_id` exists, so the one thing that keeps a user's timeline off another account's activity is the route code: `ownActivities` in `switches.ts`. A future write path that forgets that call would store a cross-account reference: the day would total time under an activity the client cannot name, and deleting the other account would cascade into this user's timeline and remove those rows.

**Context:** Nothing reaches it today: every write that takes an activity id from the client calls `ownActivities` (directly or through `assertLiveActivities`), `splitInHalf` copies the id from the user's own row, activities never change owner, and they disappear only with their account. A composite key with the default `MATCH SIMPLE` still accepts a null `activity_id` (detox). `domain.test.ts` has the stranger cases to keep green ("a replaced day cannot be written onto another account’s activity", and the mixed-in one). Raised by the testing pass and the Claude adversarial pass during the 0.2.1.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Design

### Check the 24-h bar's detox legend swatch at 1x

**What:** Look at the wide legend's detox marker in both themes and decide whether an 8 px square with a 1 px dashed `line` border is legible.

**Why:** At that size a dashed border yields one or two dashes per side, and in dark `line` is a low-alpha white, so the marker may read as an empty square rather than "dashed like the span".

**Context:** `today-flow.tsx` renders it as `cn('h-2 w-2 rounded-[2px]', look.className)`. If it is illegible, either grow the detox swatch a little or give the legend square `border-sub`, which matches the History detox cell's tone. Raised by the design pass during the 0.1.0.0 ship; deferred because it needs eyes on a screen, not a code read.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Give `Control` a pressed and keyboard-focus look

**What:** Add a pressed state and a visible focus ring to `Control`, which every 「元に戻す」, ± and merge/split button uses.

**Why:** Its only state is the 40 % disabled dim. A tap gives no feedback until the write lands, and on the web a keyboard user cannot tell which button has focus.

**Context:** `apps/app/src/components/control.tsx`. Check the focus ring in both themes on a real screen before choosing a token. Pre-existing, raised by the design pass during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep keyboard focus in the correction sheet after a merge

**What:** When a merge lands, move focus to the kept row's header (both merge procedures return that row) or to the dialog.

**Why:** A merge deletes the selected row, which unmounts its card together with the focused button. On the web, focus falls to `<body>`: a keyboard or screen-reader user loses their place, and nothing announces the merge.

**Context:** `correction.tsx` keys the cards by `row.id`. Applies to both merge buttons (「前の記録に統合」 since 0.1.0.0). Raised by the design pass during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Auth

### Stop sign-up from telling whether an e-mail is registered

**What:** Make e-mail sign-up answer an address that already has an account the same way as a new one. Either turn on `requireEmailVerification` once there is a mailer, or set `autoSignIn: false` and send the user to sign in after signing up. When e-mail links or social sign-in bring auth deep links, also narrow the native entry in `trustedOrigins` from `switchtime://` to `switchtime://auth`.

**Why:** With neither option set, Better Auth 1.7.5 answers a sign-up for an existing address with 422 `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, so anyone can check which addresses have an account. With either option, it returns the same 200 for both and hashes the password anyway to even out the timing.

**Context:** `apps/api/src/auth.ts` sets only `emailAndPassword: { enabled: true }`. The branch is `shouldReturnGenericDuplicateResponse` in `better-auth/dist/api/routes/sign-up.mjs`. `requireEmailVerification` needs `sendVerificationEmail`, so it waits for a mailer; with one, `onExistingUserSignUp` can also tell the owner of the address. `autoSignIn: false` needs no mailer but adds a sign-in step after 登録, so design it in the pen file first, and keep the navigation in the `(auth)` layout as sign-in does. A host-less `switchtime://` trusts every URL of the scheme, while `switchtime://auth` trusts only that host (`trusted-origins.mjs`). Deferred during MVP-02..06 (2026-09-09). The client-IP item from the same list is done: `advanced.ipAddress.ipAddressHeaders` reads `do-connecting-ip`.

**Effort:** M
**Priority:** P3
**Depends on:** A mailer, for the `requireEmailVerification` route

## Infrastructure

### Give the README's production image and the Compose dev image different names

**What:** Tag the README's production build something other than `switch-time-api` (for example `switch-time-api:prod`), or give the Compose `api` service its own `image:` name. Update the README's `docker run` to match.

**Why:** `compose.yaml` sets `name: switch-time`, and its `api` service builds the `dev` target with no `image:`, so Compose tags that image `switch-time-api:latest`. The README's `docker build -f apps/api/Dockerfile -t switch-time-api .` uses the same tag, and the last build owns it. After the README build, `docker compose up -d` without `--build` runs the production image. That image sets `NODE_ENV=production`, which neither Compose nor `.env` overrides, so `env.ts` refuses the `http://` `APP_ORIGIN` and the API exits. In the other direction, the README's `docker run … switch-time-api` starts the dev image unless the production image was just rebuilt. This is reasoned from the config, not reproduced.

**Context:** README, "API" section. `pnpm dev:backend` runs `docker compose up --build`, so the usual path is safe. Found during PR #48 (2026-09-17) and left out of that PR.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Say in the README how to reach the production database from a laptop

**What:** Add to the DigitalOcean steps that, while the cluster has trusted sources, a laptop needs `doctl databases firewalls append <cluster-id> --rule ip_addr:<your-ip>` before `psql` connects, including step 2's `doadmin` session. Remove that rule afterwards with `doctl databases firewalls remove <cluster-id> --uuid <rule-uuid>`, and keep the `app:<app-id>` rule.

**Why:** The production cluster's only trusted source is the App Platform app (`doctl databases firewalls list <cluster-id>`). A direct `psql` from a laptop therefore times out without saying why, and the README mentions only the app rule, in step 4.

**Context:** Removing the app rule cuts off `db-migrate` and the API. Deferred after the 2026-09-11 production QA run.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Install Node 26 in the Cloud Agent environment

**What:** Change the Cursor Cloud Agent environment's install step to install Node 26.10.0 with nvm and make it the default (`nvm alias default 26.10.0`). Then point the PATH hint in AGENTS.md's "Cloud Agent environment" section at `v26.10.0` and drop the `nvm install` workaround.

**Why:** Since 2026-09-22 the repository runs on Node 26: `.node-version` says 26.10.0, `engines.node` is `26.x`, and CI and both Dockerfiles use 26. The Cloud Agent environment still installs 24.20.0, so an agent's `pnpm check` and `pnpm --filter app web` run on a different major than CI. Nothing stops that: pnpm 12 did not enforce `engines` here (`pnpm install --frozen-lockfile` passed on Node 24.19.0 on 2026-09-22).

**Context:** The install and start steps live in Cursor's environment settings, not in this repository (there is no `.cursor/environment.json`). The Compose API is unaffected, because it builds `apps/api/Dockerfile` on `node:26-slim`.

**Effort:** S
**Priority:** P3
**Depends on:** Access to the Cursor Cloud Agent settings

### Line up the native build's peer dependencies before the first prebuild

**What:** Before `expo prebuild` or an EAS build, pin `react-native-worklets` to a version that `expo-modules-core` accepts, and `@react-native/metro-config` to the `react-native` version (0.86.3). Then check with `pnpm peers check` and `npx expo install --check`.

**Why:** `pnpm peers check` reports both as unmet:

- `react-native-worklets` 0.13.0, pulled in by `@expo/ui` through `expo-router`. `expo-modules-core@57.0.18` wants `^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0`, and SDK 57's own list (`expo/bundledNativeModules.json`) says 0.10.1.
- `@react-native/metro-config` 0.87.1. `@react-native/community-cli-plugin@0.86.3` wants 0.86.3.

Expo Go and the web export don't notice either mismatch. A native build compiles against these versions, which are outside the declared ranges and untested together.

**Context:** Noted on issue #8 (2026-09-09) during MVP-06. That note says the SDK 57 template pairs `react-native-worklets` 0.10.x with `react-native-reanimated`. The `vitest` entry the same check used to list against `better-auth`'s peer range is gone since Better Auth 1.7.5. On a scratch copy (2026-09-17), an `overrides` entry `'@react-native/metro-config': 0.86.3` in `pnpm-workspace.yaml` moved every copy of that package to 0.86.3. The dependency refresh of 2026-09-22 kept `react-native` at 0.86.3 with `react` 19.2.3: `react-native` 0.87.1 breaks the web export (`@expo/cli` 57 imports `react-native/rn-get-polyfills`, which 0.87 no longer exports), so the seven packages `npx expo install --check` guards stay at SDK 57's versions until the SDK moves. The web export is the only build today.

**Effort:** S
**Priority:** P4
**Depends on:** Starting native builds
