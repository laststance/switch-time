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

**What:** Make `replaceDay` conditional: send the ids of the rows the edit left, and answer CONFLICT inside the transaction when the day's current ids differ.

**Why:** 「元に戻す」 deletes the day's whole window and writes the snapshot back without looking. A switch made on another device after the snapshot's data was fetched (up to the 30 s `staleTime`), or after the edit while 元に戻す is still armed, is deleted for good, and the current state silently reverts. It happens on one device too: when the refetch after an edit fails, the sheet unlocks on the pre-edit list, so the next edit snapshots that list and 元に戻す reverts both edits; and a merge paused offline arms 元に戻す with rows from before the connection dropped.

**Context:** The snapshot is `list.data` when the button is pressed (`use-correction.ts`), and Home's today view shares the `listByDay` key. Once the edit's invalidation has refetched, `queryClient.getQueryData` holds the rows the edit left. A client-only stopgap is `staleTime: 0` on the sheet's list plus holding the panel after a failed refetch (`list.isRefetchError`); it does not cover the offline case, which the id check does. Since 0.2.1.0 (the archived-day undo fix under Completed) this also reaches days that hold a record of an archived activity, today included once an activity used earlier today is archived: `replaceDay` used to refuse those days outright. A sheet left open across that deploy with a failed undo still armed replays its old snapshot on the next press. Raised by the red team during the 0.2.0.0 ship; Codex and the Claude adversarial pass added the one-device paths.

**Effort:** M
**Priority:** P2
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

**Why:** Since 0.2.1.0, 「元に戻す」 restores a day that holds such a record (see "Let 「元に戻す」 restore a day that holds an archived activity" under Completed), but only while the sheet that made the edit is open. After 完了, a record merged into its neighbour cannot be rebuilt: `changeActivity` refuses archived ids, the 活動を変える picker lists live activities only (`useActivities`), and no route unarchives an activity.

**Context:** The undo snapshot lives in `useState` in `use-correction.ts`, so closing the sheet drops it. "Arm 「元に戻す」 from the mutation, not from the tap" would keep the slot outside the sheet, which narrows this gap without closing it. Accepting archived ids in `changeActivity` also needs a rule for which rows may take one, such as "not the latest row", checked under the per-user lock from "Serialize a user's switch writes and re-read the neighbours inside them", since a later merge or undo can make the edited row the latest. An `unarchive` must also move the row to the end of the live order in the same update, as `create` does. Archiving keeps the old `position`, `reorder` may since have handed it to a live activity, and `activities_user_position_idx` is unique among live rows, so clearing `archived_at` alone would fail. Test it by archiving, reordering, then unarchiving. Left out of scope when the owner chose (a) for that fix; raised by the review during the 0.2.1.0 ship.

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

## Completed

### Let 「元に戻す」 restore a day that holds an archived activity

**What:** Pick one of two fixes: (a) `replaceDay` checks only that the activities are the user's, or (b) the merges refuse (CONFLICT plus a row flag) on a day that holds a row of an archived activity.

**Why:** The undo snapshot carries every row's `activityId`, and `replaceDay` refuses archived ones (`BAD_REQUEST 'activity is archived'`). After any edit on such a day, 「元に戻す」 fails every time, silently. For a merge that loses data: the merged-away row never comes back, and a row of the archived activity cannot even be rebuilt by hand, because `changeActivity` refuses archived ids too.

**Context:** Archiving refuses only the current state's activity, and past rows keep the archived id. (a) reverses "a replaced day cannot be written onto an archived activity" in `domain.test.ts` (7e3f204) and lets a client write fresh time onto a hidden activity on past days; (b) keeps that rule but blocks a legitimate merge and needs a client flag. The hole has been there since 0.1.0.0 for 「前の記録に統合」 (and for undoing ±15 min, 活動を変える and 半分で分割); 0.2.0.0 adds 「次の記録に統合」 to the same path. Raised by the red team during the 0.2.0.0 ship, and found again by Codex's adversarial pass; the choice was left to the owner.

**Resolution:** (a), the owner's call on 2026-09-17. `replaceDay` now checks ownership only, through `ownActivities`: a stranger's id still reads as NOT_FOUND, alone or mixed in with the user's own. `switchTo` and `changeActivity` still refuse archived activities. The owner accepted that a user's own API client can write past time onto their archived activity. On the latest recorded day, such a row can also run on as the current state. `archive` refuses the current state's activity, so archiving itself ends in that state only when a tap or a 活動を変える on the latest record, from another device, lands between its check and its write (see the P1 lock). An undo replayed after another device archived the activity reaches it too, and 「前の記録に統合」 already could, since it checks no activity. Home keeps an archived current activity as its last button (`gridActivities`). Tests pin the rule. In `domain.test.ts`: the flipped 7e3f204 test, which also shows the archived activity running on as the current state; a re-tap of that state, which `switchTo` still refuses; a merge into the previous record that makes an archived activity the current state; a bystander-row undo; a day with one activity on several rows; a stranger's id mixed in with the user's own; and a split that keeps both halves on the archived activity. In the e2e: merging into an archived activity's record and undoing it. One gap stays out of scope: a row merged away and not undone still cannot be rebuilt by hand, because `changeActivity` refuses archived ids. It is tracked under Correction as "Rebuild a merged-away record of an archived activity".

**Effort:** S
**Priority:** P1
**Depends on:** None
**Completed:** v0.2.1.0 (2026-09-17)
