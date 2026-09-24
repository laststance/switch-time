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

### Say why a correction was refused

**What:** Show a short message in the correction sheet when an edit or 「元に戻す」 fails, e.g. 「次の記録は翌日なので統合できません」.

**Why:** Every failed `switches.*` write is silent: the buttons re-enable and nothing changes. The server now refuses a cross-day 「次の記録に統合」 with CONFLICT; the row flags normally hide that button, but a stale list can still reach it, and the user sees a tap that did nothing.

**Context:** `useCorrection` never reads the mutations' `error`, and `correction.tsx` has no error slot. The code alone cannot pick the message: `mergeIntoNext`, `mergeIntoPrevious`, `moveStart` and `splitInHalf` all refuse with CONFLICT, and only the English `message` tells the reasons apart. Give each refusal a machine-readable reason (`new ORPCError('CONFLICT', { message, data: { reason } })`), map that to Japanese, and show it in one `Text` under the action panel. Since the carried-in row's panel (2026-09-24) three more refusals are silent: `splitAt`'s CONFLICT (the cut no longer fits its record), a pick on the carried-in record that another device changed (CONFLICT, or NOT_FOUND once it is gone), and the undo of such a pick for the same reasons (`afterUndoFailure` in `lib/correction.ts` turns 元に戻す off without a word). The undo refused because the previous activity was archived already shows its notice, and that refusal is the first to carry a reason (`ARCHIVED_REFUSAL` in `packages/shared`, thrown by `assertLiveActivities` and read by `afterUndoFailure`); follow its shape. Since the day baseline (2026-09-25), every edit of the sheet and the day's 「元に戻す」 can also be refused because the day changed elsewhere (another device's switch or edit, or a stored-zone change): that refusal already carries `DAY_CHANGED_REFUSAL` (`{ reason: 'day-changed' }`, thrown by `checkBaseline` and `replaceDay` in `apps/api/src/rpc/switches.ts`), so it can map to a message such as 「別の端末で記録が変わったため、最新の状態を表示しました」. `moveStart`, `splitInHalf` and `splitAt` also refuse a result that would land on another day. Raised by the review during the 0.2.0.0 ship.

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

**What:** Add two tests. (1) e2e: hold the `mergeIntoNext` answer, force a refetch that shows the merged day (`page.clock` past the 30 s `staleTime`, then `visibilitychange`), release the answer, press 元に戻す and expect the merged row back. (2) API: merging the record before the running state moves `switches.current()` back to that record's start, with `source: 'merge'`.

**Why:** No test fails if the undo snapshot goes back to being taken when the edit lands (the 0.2.0.0 fix has no regression test). Every `mergeIntoNext` test merges into a record that has a later switch, so the everyday case, a mis-tap just before what is running now, is untested.

**Context:** `apps/app/src/hooks/use-correction.ts` (`press` and its `arm`), `apps/app/e2e/correction.spec.ts` (the held-answer pattern is in "an edit still landing after its sheet closed…"), `apps/api/src/rpc/domain.test.ts`. A refused edit on a stale list leaving 元に戻す disabled is covered since the day baseline (2026-09-25). Raised by the testing pass during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Decide what a merge that makes a segment idle should do

**What:** Warn in the sheet, or mark the row, when a merge makes a segment longer than the idle threshold. Decide as well whether a merge that leaves two rows of the same activity side by side should join them.

**Why:** A segment longer than `idleThresholdMinutes` (12 h by default) counts as idle and leaves the totals. Merging a 7 h row into a 6 h one therefore removes 13 h from the day's totals with no explanation. A merge can also leave the same activity twice in a row (仕事, 読書, 仕事 → merge 読書), which Home counts as one switch too many.

**Context:** `segmentsInRange` in `packages/shared/src/stats.ts` judges idle on the unclipped length. Both merge directions and the ±15 min steps can cross the threshold; the sheet reads the threshold since the carried-in row's panel (2026-09-24) (`totalsFacts` in `use-correction.ts`, used by `cutTotalsEffects` for 「ここで分割」's notes), so a merge or move could warn the same way. `switchTo` never records the same activity twice in a row, but the merges can. Raised by the review during the 0.2.0.0 ship; the adversarial pass added the repeated activity.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Arm 「元に戻す」 from the mutation, not from the tap

**What:** Take the undo snapshot in a hook-level `onMutate` (returned as the mutation's context), arm the slot in the hook-level `onSuccess`, and keep the slot outside the sheet (Redux, keyed by day) so a reopened sheet for that day can still offer 元に戻す.

**Why:** Callbacks passed to `mutate()` run only for the latest `mutate()` call and only while the sheet is mounted. A double tap that lands the first merge and fails the second (NOT_FOUND, or the day-changed refusal) leaves 元に戻す unarmed, or armed with an older edit, which the day undo's `expected` rows now refuse rather than reverting two edits. A merge that lands after 完了 can never be undone.

**Context:** The double-tap case is new in 0.2.0.0, which moved the snapshot into `mutate()` callbacks (the buttons dim only after the next render). The closed-sheet case has existed since 0.1.0.0 for 「前の記録に統合」. A hook-level `onMutate` runs with the render that pressed the button, so the snapshot stays the pre-edit list; it would take over `press` in `use-correction.ts`, which takes the day's baseline at the press and arms from it and the returned row (`rowsAfterEdit`). Extend the held-answer e2e to press 元に戻す after the answer lands. Since the carried-in row's panel (2026-09-24), the slot is a union of a `day` and an `activity` undo, and `undoSlotFor` in `lib/correction.ts` picks the kind; the hook-level callbacks would call it, and the Redux slot must hold either kind (and the archived notice it can raise instead). Raised by the red team and the Claude adversarial pass during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Rebuild a merged-away record of an archived activity

**What:** Give the user a way to bring back a record of an archived activity once 「元に戻す」 is gone. Either `changeActivity` accepts the user's archived activity on a past row (and 活動を変える offers it there), or an `activities.unarchive` route with a control in 設定 brings the activity back so the usual edits can rebuild the row.

**Why:** Since 0.2.1.0 (PR #49), 「元に戻す」 restores a day that holds such a record, but only while the sheet that made the edit is open. After 完了, a record merged into its neighbour cannot be rebuilt: `changeActivity` refuses archived ids, the 活動を変える picker lists live activities only (`useActivities`), and no route unarchives an activity.

**Context:** The undo snapshot lives in `useState` in `use-correction.ts`, so closing the sheet drops it. "Arm 「元に戻す」 from the mutation, not from the tap" would keep the slot outside the sheet, which narrows this gap without closing it. Accepting archived ids in `changeActivity` also needs a rule for which rows may take one, such as "not the latest row", checked under the user's timeline lock (`withUserLock` in `apps/api/src/rpc/base.ts`), since a later merge or undo can make the edited row the latest. An `unarchive` must also move the row to the end of the live order in the same update, as `create` does. Archiving keeps the old `position`, `reorder` may since have handed it to a live activity, and `activities_user_position_idx` is unique among live rows, so clearing `archived_at` alone would fail. Test it by archiving, reordering, then unarchiving. Since the carried-in row's panel (2026-09-24), a pick on a carried-in record of an archived activity arms no undo at all: the panel warns before the pick and shows 「前の活動はアーカイブ済みのため、元に戻せません」 after it, so that record is another one only this item could rebuild. Left out of scope by the 0.2.1.0 fix, in which the owner chose to have `replaceDay` check ownership only; raised by the review during that ship.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Offer 区切る時刻 on the day's own rows in place of 半分で分割

**What:** Give every row's panel the 区切る時刻 stepper and 「ここで分割」, and retire 「半分で分割」.

**Why:** 「半分で分割」 always cuts at the midpoint, so splitting a row at the time something really changed still takes a split followed by several ±15 moves, each a round trip. The carried-in record already cuts at a chosen quarter hour in one write.

**Context:** `cutRange` in `lib/correction.ts` computes the range for carried-in rows only (`cut` is null on the day's own rows), and `switches.splitAt` accepts any row. The day's own rows need the same margins as `clampStart` from both neighbours. Out of scope for the carried-in row's panel (2026-09-24); raised as an open question in its design.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Select the new row after 半分で分割, as 「ここで分割」 does

**What:** After 「半分で分割」 lands, select (and focus) the later half, which `splitInHalf` already returns.

**Why:** After 「ここで分割」 on the carried-in record the sheet selects the new row, so the next pick changes only the later part. 「半分で分割」 keeps the old row selected, so the same next pick changes the earlier half, and the two cuts behave differently.

**Context:** `useCorrection`'s `cut` calls `select` and `setFocusId` with the row `splitAt` returns; `split` could do the same with `splitInHalf`'s answer, and `undoSlotFor` could remember the halved row to reselect on undo as it does for a cut. Raised by the design review of the carried-in row's panel (2026-09-24) (D12).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Show which repeated wall-clock time is meant on a fall-back day

**What:** On a daylight-saving fall-back day, show which occurrence a repeated wall-clock time means (for example the UTC offset) in the correction sheet's row labels, 開始時刻, 区切る時刻 and History.

**Why:** In a zone with daylight saving the hour after the fall-back repeats, so two instants an hour apart read the same `H:MM`. A user can move a start or cut a record at the wrong one without seeing it.

**Context:** `formatTime` (`apps/app/src/lib/format.ts`) prints `H:MM`; `timeZoneSchema` accepts any IANA zone; `dayBounds` already handles 23- and 25-hour days. The 区切る時刻 steps are elapsed time (±15 / ±60 min), so inside the repeated hour +1時間 can leave the readout unchanged. The owner's zone (Asia/Tokyo) never reaches it. Start with a helper that tells whether an instant's wall time occurs twice that day, tested on `America/New_York` 2026-11-01. Raised by Codex in the eng review of the carried-in row's panel (2026-09-24) (R10 kept `H:MM` for consistency with every other label).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Name every day a carried-in record reaches, and its year

**What:** Make the carried-in panel's notes name the whole reach of the record. The scope note under 活動を変える should give the range of days the record covers (`9月21日〜9月24日の集計に反映されます`), not only the day it started. The origin note should add the year when the record started in another year than the viewed day. Change the text in the pen file first, then in `correction.tsx` and `lib/correction.ts` (`trueStartLabels`).

**Why:** A pick changes the record's activity on every day it covers. A record from 9/21 23:00 viewed on 9/23 also changes 9/22, and one that is still running changes today, but the note names only 9/21. A record that began more than a year ago reads as a recent date: on the same calendar day it even reads as the viewed day.

**Context:** `CorrectionRow` already carries `trueStart` and `trueEnd`, and the last day the record touches is `localDay(trueEnd - 1)` in the stored zone. Raised by the Red Team during the carried-in panel's ship (2026-09-24).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Mention the carried-in panel's controls in the sheet hint

**What:** Rewrite the correction sheet's hint (「行をタップ → 開始時刻を15分ずつ動かす／活動を変える」) so it also covers the carried-in row, whose panel cuts the record (区切る時刻 and 「ここで分割」) rather than moving its start. Change the text in the pen file first, then in `correction.tsx`.

**Why:** On a day whose first row is carried in from an earlier day, the hint promises a 15-minute move that row does not have, and says nothing about cutting it.

**Context:** The hint is the `hint` prop of `Sheet` in `apps/app/src/app/(app)/correction.tsx`, and the pen file's correction frame holds the same string. Raised by the design review during the carried-in panel's ship (2026-09-24).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Stop the stored time zone flipping between two devices

**What:** Make `use-time-zone-sync.ts` write the device's zone only when that device's own zone changes (compare it with the last zone this device synced, kept on the device), or ask before overwriting the stored one. While a `settings.update` that carries `timeZone` is in flight, hold the correction sheet's buttons.

**Why:** The hook writes the focused device's zone whenever it differs from the stored one, so two devices in different zones flip it back and forth on every focus. A browser with `resistFingerprinting` reports UTC, so one laptop and one phone are enough. Since the day baseline (2026-09-25), every edit and every day 「元に戻す」 carries the zone, so each flip makes the other device's open sheet refuse its next edit and turns its 元に戻す off (`DAY_CHANGED_REFUSAL`, which the client does not read yet). The same write runs at app start, where the settings cache takes the device zone at once while `listByDay` may still hold rows windowed in the old one, so edits are refused silently until the zone write settles.

**Context:** Left open when the day baseline closed "Refetch the day's switches after the time zone changes" (`useUpdateSettings` now refetches `switches.*` too, and a replay under another zone is refused). Raised by the Red Team during the day baseline's ship (2026-09-25).

**Effort:** S
**Priority:** P2
**Depends on:** None

### Refuse an edit that makes a record of an archived activity the current state

**What:** Under the per-user lock, refuse `replaceDay` and `mergeIntoPrevious` with `ARCHIVED_REFUSAL` when the row that becomes the user's latest switch names an archived activity.

**Why:** `activities.archive` refuses the activity of the current state, and the lock keeps a tap or a pick from racing that check, but two locked writes still get around it. (1) Device A's sheet changes today's running record from X to Y, device B archives X (allowed: X is no longer current), then A presses 「元に戻す」: the day still reads as the edit left it (archiving writes no switch), and `replaceDay` checks ownership only, so the running record goes back to X. (2) 「前の記録に統合」 on the latest record makes the previous record the current state without looking at its activity.

**Context:** The owner accepted archived ids in `replaceDay` for past time (0.2.1.0, PR #49), not for the running state. `apps/api/src/rpc/switches.ts`. The rule matches the "not the latest row" rule that "Rebuild a merged-away record of an archived activity" needs. Raised by the Red Team during the day baseline's ship (2026-09-25).

**Effort:** S
**Priority:** P2
**Depends on:** None

### Refuse a merge into a carried-in record that changed elsewhere

**What:** Put the carried-in record's id and `revision` into the day baseline (the sheet's row already holds both), and refuse 「前の記録に統合」 with `DAY_CHANGED_REFUSAL` when the record it merges into is that record and its id or revision no longer match.

**Why:** The baseline covers the day's own rows only. When another device changes the carried-in record first (a pick on the previous day's sheet, or a merge that leaves an earlier row in its place), the day's baseline still matches, so merging the day's first row into it hands that time to an activity the sheet never showed. The day's 「元に戻す」 can still reverse it, but the edit is not refused, which is what the baseline is for.

**Context:** `checkBaseline` and `mergeIntoPrevious` in `apps/api/src/rpc/switches.ts`, `dayBaseline` in `apps/app/src/lib/correction.ts`, `dayBaselineSchema` in `packages/shared/src/schemas.ts`. Raised by the Red Team during the day baseline's ship (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Let a day with more than 500 switches still be corrected

**What:** Send no baseline and arm no day 「元に戻す」 when the listed day holds more rows than the baseline schema allows, or raise the cap to an explicit server limit on switches per day.

**Why:** Since the day baseline (2026-09-25), every sheet edit sends all the day's rows, capped at 500 by `dayRowsSchema` in `packages/shared/src/schemas.ts`. On a day with more (a script, a hotkey burst), every edit fails validation with BAD_REQUEST and nothing is shown, so the day cannot be corrected at all. Before, only 「元に戻す」 hit the cap. The sheet can also cross it itself: 半分で分割 on a day of exactly 500 rows lands (its baseline holds 500), and then its own 「元に戻す」 is refused, since `expected` would hold 501; keep the cap on the rows written back apart from the one on the rows compared, and test 500 → 501.

**Context:** The API already accepts an edit without a baseline. `dayBaseline` in `apps/app/src/lib/correction.ts` builds it. Raised by the Red Team during the day baseline's ship (2026-09-25).

**Effort:** S
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

### Keep two switches of one account from starting at the same instant

**What:** In `switchTo`, under the per-user lock, start the new switch at `max(now, current.startedAt + 1 ms)` (or take the time from the database with `greatest()`), and add `id` as a second sort key in `dayRows`, `switchesBetween` and `rowsAfterEdit`.

**Why:** Two taps from two devices, serialized by the lock, can land in the same millisecond, and a clock step or a second API instance can even start the new row before the current one. Nothing orders tied rows: the list and the locked re-read can then read them in different orders, which refuses edits as day-changed for no reason, and `replaceDay` rejects tied rows with BAD_REQUEST, which `afterUndoFailure` keeps armed, so 「元に戻す」 fails on every press.

**Context:** No unique index covers `(user_id, started_at)`. `apps/api/src/rpc/switches.ts`, `apps/app/src/lib/correction.ts`. Raised by the Red Team during the day baseline's ship (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep one account's queued writes from filling the connection pool

**What:** Queue a user's timeline writes in the API process (a per-user mutex in front of `withUserLock`) so only one connection per user waits on the advisory lock, cap how many writes one user can have in flight (TOO_MANY_REQUESTS above a small number), and set `connectionTimeoutMillis` on the `Pool` in `apps/api/src/db/client.ts`.

**Why:** Every write that waits in `withUserLock` holds a pool connection for up to the 10 s `lock_timeout`. The `Pool` keeps the default 10 connections and no acquire timeout, and nothing rate-limits RPC writes, so one signed-in account with about ten writes in flight (taps, edits, zone updates) fills the pool with requests queued on its own lock; every other account's reads and writes then wait on the pool with no bound. Before the lock, the same burst ran in parallel and drained about ten times faster.

**Context:** The advisory lock stays for correctness across API instances; the in-process queue only stops waiters from holding connections. `pg_try_advisory_xact_lock` with a short backoff, or a shorter timeout, are the cheaper alternatives. Raised by the security pass during the day baseline's ship (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** None

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

### Raise the sub token's contrast to WCAG AA

**What:** Darken `sub` in the light theme (and lighten it in dark) until 12 px notes reach 4.5:1 on `chip`, the selected card's fill, as well as on `sheetBg`; the pen file first, then `design-system/`, then the code copies.

**Why:** The carried-in panel's notes (where the record started, what a pick also changes, how a cut changes the totals) are `text-sub` at 12 px on the selected card's `bg-chip`, about 3.7:1, below AA. They carry information the user needs before an edit to an earlier day.

**Context:** `sub` is app-wide (hints, labels, durations), so the change is a token change, not a one-off class. The notes carry `gstack-shortcut(dec-f15d7e22)` in `apps/app/src/app/(app)/correction.tsx` (the `NOTE` class); the irreversible case (the archived box) is already `text-ink`. Accepted as a shortcut in the design review of the carried-in row's panel (2026-09-24) (D11).

**Effort:** S
**Priority:** P2
**Depends on:** None

### Space the correction panels' groups 20 apart, as tokens.md asks

**What:** Put 20 between the groups of both correction panels (the day's own rows: 開始時刻 / 活動を変える / the merge and split buttons; the carried-in record: origin note / 区切る時刻 / 活動を変える), in the pen file first.

**Why:** `design/tokens.md` asks for at least 20 between groups; both panels use 12 (`gap-3` on the `Actions` container), so the groups read as one block.

**Context:** The carried-in panel matched the existing panel on purpose so the two stay consistent (design review of the carried-in row's panel (2026-09-24), D9); change both together.

**Effort:** S
**Priority:** P3
**Depends on:** None

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

**Context:** `correction.tsx` keys the cards by `row.id`. Applies to both merge buttons (「前の記録に統合」 since 0.1.0.0). 「ここで分割」 already does this since the carried-in row's panel (2026-09-24): `useCorrection` sets `focusId` to the row `splitAt` returns, and `RowHeader` takes focus when its `focused` prop turns on, so a merge can set the same id. Raised by the design pass during the 0.2.0.0 ship.

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
