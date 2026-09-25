# TODOS

## Home

### Start detox from the first-launch screen

**What:** Offer detox as a starting state on `FirstLaunch`, next to the activity buttons.

**Why:** A new account cannot begin on detox. `DetoxRow` and the `0` hotkey live in `HomeBody`, which only mounts once `switches.current` is non-null, so the first tap has to be a real activity. That records a span the user did not want and then has to correct.

**Context:** Deliberate in the approved plan: first launch asks 「いま何をしていますか？」 and picking an activity is the onboarding. The API already supports it (`domain.test.ts`, "the very first tap can be detox"), so this is a UI-only change plus an e2e that signs up and presses detox without touching an activity. Raised by the Codex adversarial pass during the 0.1.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Say why a tap on ホーム was refused

**What:** Show a short line on ホーム when a tap (or a hotkey) is refused, reusing the correction sheet's messages (`refusalMessage` in `apps/app/src/lib/correction.ts`): `busy` (TOO_MANY_REQUESTS), `archived`, a timeout, or a plain failure.

**Why:** A refused tap only rolls back its optimistic state (`useSwitchTo`), so the clock jumps back without a word. Since 0.5.0.0 a burst of taps from several devices can reach the account's cap of timeline writes (`TIMELINE_WRITES_PER_USER`), and every refusal now carries a reason the app can read.

**Context:** The correction sheet got its status line in the PR that closed "Say why a correction was refused" (2026-09-25); ホーム has no slot for it yet, so it needs a pen design first. Queued taps share one mutation scope (`switches.switchTo`), so a refused tap does not stop the ones queued after it.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep a detox span's outline whole when it is narrower than the bar's rounded end

**What:** Draw a detox span that touches an end of the 24-h bar (or the correction sheet's day bar) but is narrower than that end's corner radius so its outline stays closed, for example by capping the lent radius at half the span's width or giving such a span a minimum width.

**Why:** `spanCorners` lends the bar's own corner to a span touching that end, which keeps an ordinary span's outline from being clipped open. A span only a few pixels wide (a few minutes of detox right after midnight, or just before now) is still cut by the bar's `overflow-hidden` rounded corner, so its `sub` outline shows as a broken arc.

**Context:** `spanCorners` in `apps/app/src/lib/today.ts`, `BANDS` in `apps/app/src/components/today-flow.tsx` (7 px wide, 5 px narrow) and `DAY_BAR_CORNERS` in `apps/app/src/app/(app)/correction.tsx` (`rounded-md`). Raised by the red-team review of the PR that outlined detox spans solid (2026-09-25).

**Effort:** S
**Priority:** P4
**Depends on:** None

## Settings

### Let the main device take the account's zone back

**What:** Give the user a way back when another device's zone replaced the account's: a zone row in 設定 (designed in the pen file first) or a prompt when the stored zone differs from both the device's zone and the one it last synced.

**Why:** Since 0.5.0.0 a device writes its zone only when its own zone changed since it last synced (`zoneSyncAction` in `apps/app/src/lib/settings.ts`), which stopped two devices from flipping the zone on every focus. A single sign-in from another zone (a friend's laptop abroad, a browser that reports UTC to resist fingerprinting, a test run against the real account) now writes once, and the main device, whose own zone has not changed, never writes again. Every day boundary, the stats and the correction windows stay shifted, and the app has no zone control to undo it.

**Context:** `apps/app/src/lib/device-zone.ts` keeps the last synced zone per account (localStorage on the web, `expo-secure-store` on native). On iOS the keychain can keep that entry across a reinstall, so reinstalling does not reclaim the zone either. A prompt keeps the automatic path; a 設定 row is simpler and also covers a user who wants a zone other than the device's. Raised by the red-team pass during the 0.5.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep the zone sync from recording the previous account's zone when another tab signs in as someone else

**What:** Key the settings query (or the synced-zone check) by the account, or have `useTimeZoneSync` skip the render in which the session's user id changed, so it only compares the device's zone with the new account's stored one.

**Why:** When another tab signs in as a different account, this tab's session turns to that account on focus. `useAccountScope` then resets the query cache (the PR that bound 元に戻す to its account), but in the same commit `useTimeZoneSync`'s effect still reads the first account's settings: it can find that zone equal to the device's and record it as synced for the second account (`zoneSyncAction`'s 'record'), after which the device never writes its zone into the second account.

**Context:** `apps/app/src/hooks/use-time-zone-sync.ts`, `orpc.settings.get.queryKey()` (not keyed by user), `useAccountScope` in `apps/app/src/hooks/use-account-scope.ts`. Raised by the Claude adversarial pass during the 0.5.0.0 ship; narrowed when the cache reset landed.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Correction

### Decide what a merge that makes a segment idle should do

**What:** Warn in the sheet, or mark the row, when a merge makes a segment longer than the idle threshold. Decide as well whether a merge that leaves two rows of the same activity side by side should join them.

**Why:** A segment longer than `idleThresholdMinutes` (12 h by default) counts as idle and leaves the totals. Merging a 7 h row into a 6 h one therefore removes 13 h from the day's totals with no explanation. A merge can also leave the same activity twice in a row (仕事, 読書, 仕事 → merge 読書), which Home counts as one switch too many.

**Context:** `segmentsInRange` in `packages/shared/src/stats.ts` judges idle on the unclipped length. Both merge directions and the ±15 min steps can cross the threshold; the sheet reads the threshold since the carried-in row's panel (2026-09-24) (`totalsFacts` in `use-correction.ts`, used by `cutTotalsEffects` for 「ここで分割」's notes), so a merge or move could warn the same way. `switchTo` never records the same activity twice in a row, but the merges can. Raised by the review during the 0.2.0.0 ship; the adversarial pass added the repeated activity.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Let a day's kept failure line expire once the day moved on

**What:** Hide a day's kept refusal line once a later read of that day has succeeded (keep when it was set, compare with the list's `dataUpdatedAt`), or clear it when a `switches.*` write on that day succeeds, and let the offline or writing line show over an old refusal.

**Why:** Since the line moved to the store (`refused` in `apps/app/src/store/correction.ts`) it lasts until the next press, selection or undo on that day. Reopen a day hours after a refusal, when a tap on ホーム or another sheet's merge has long since changed it, and the sheet still says the edit failed, even naming 別の端末 for this device's own double tap. `statusLine` puts the refusal first, so it also hides 「オフラインです…」 and 「反映しています…」 on reopening.

**Context:** `statusLine` in `apps/app/src/lib/correction.ts`, `useCorrectionState` in `apps/app/src/hooks/use-correction.ts`. Related: "Stop naming another device when this device's own late write changed the day". Raised by the Claude adversarial pass during the 0.8.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Drop a day's 元に戻す once a settled read shows the day moved on

**What:** Dispatch `dropped` for the day when `offeredUndo` turns a slot off on a settled, successful read (no fetch or `switches.*` write in flight), instead of only hiding it.

**Why:** A slot that no longer matches stays in the store. If another device later puts the day back exactly as the edit left it (merging away the switch this device tapped), 元に戻す shows again and would undo an edit made long before; the API accepts it, since the day reads as the undo expects. A read that fails while stale data is shown must not drop it.

**Context:** `offeredUndo` in `apps/app/src/lib/correction.ts`, `useCorrection` in `apps/app/src/hooks/use-correction.ts`. Raised by the Claude adversarial pass during the 0.8.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep the user's own selection when today's sheet passes midnight

**What:** When the sheet's day changes, keep the row the user selected if the new day still lists it (the running record becomes the carried-in one under the same id), and drop only the selection and focus an answer set.

**Why:** `sheetView` starts the sheet's own state over whenever the day changes, so a panel open at midnight closes under the user's finger, with its picker and 区切る時刻. Before 0.8.0.0 the selection stayed. `onPressedDay` alone already keeps a late answer off the new day.

**Context:** `sheetView` and `onPressedDay` in `apps/app/src/lib/correction.ts`; the e2e "a split whose answer lands after midnight selects nothing on the new day" must keep passing. Raised by the Claude adversarial pass during the 0.8.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Rebuild a merged-away record of an archived activity

**What:** Give the user a way to bring back a record of an archived activity once 「元に戻す」 is gone. Either `changeActivity` accepts the user's archived activity on a past row (and 活動を変える offers it there), or an `activities.unarchive` route with a control in 設定 brings the activity back so the usual edits can rebuild the row.

**Why:** Since 0.2.1.0 (PR #49), 「元に戻す」 restores a day that holds such a record, and since the undo moved into the store it survives closing the sheet, but not a reload or sign-out. After that, a record merged into its neighbour cannot be rebuilt: `changeActivity` refuses archived ids, the 活動を変える picker lists live activities only (`useActivities`), and no route unarchives an activity.

**Context:** The undo slot lives in the Redux store per day (`correctionSlice`), so it outlives the sheet but not the page or the session. Accepting archived ids in `changeActivity` also needs a rule for which rows may take one: "not the latest row", checked under the user's timeline lock, as `replaceDay` and `mergeIntoPrevious` have done since 0.5.0.0 (`assertLiveActivities` on the row that becomes the latest switch, in `apps/api/src/rpc/switches.ts`); a later merge or undo that makes the edited row the latest is then refused by those checks. An `unarchive` must also move the row to the end of the live order in the same update, as `create` does. Archiving keeps the old `position`, `reorder` may since have handed it to a live activity, and `activities_user_position_idx` is unique among live rows, so clearing `archived_at` alone would fail. Test it by archiving, reordering, then unarchiving. Since the carried-in row's panel (2026-09-24), a pick on a carried-in record of an archived activity arms no undo at all: the panel warns before the pick and shows 「前の活動はアーカイブ済みのため、元に戻せません」 after it, so that record is another one only this item could rebuild. Left out of scope by the 0.2.1.0 fix, in which the owner chose to have `replaceDay` check ownership only; raised by the review during that ship.

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

### Notice another device's edit on a day busier than a baseline can list

**What:** Let the sheet detect a change another device made to the day's own rows when the day lists more than `DAY_ROWS_MAX` (300) rows, and offer 「元に戻す」 there, for example by comparing a hash or a revision of the day instead of every row.

**Why:** Since 0.5.0.0, such a day sends a baseline without `rows`: its zone and the records carried in and out are still checked, and an edit on a row of another day is refused, but an edit another device made to one of the day's own rows is not noticed, and no day 「元に戻す」 is offered. `DAY_ROWS_MAX` comes from the 100 KB body limit on `/api/*`: 300 rows twice (`expected` and `rows`) serialize to about 87 KB.

**Context:** `dayBaseline` and `undoSlotFor` in `apps/app/src/lib/correction.ts`, `checkBaseline` and `checkOwnRowBaseline` in `apps/api/src/rpc/switches.ts`, `DAY_ROWS_MAX` in `packages/shared/src/schemas.ts`, the body-limit test in `apps/api/src/app.test.ts`. Only a script or a hotkey burst reaches 300 switches in a day. The API also accepts a baseline without `rows` on a day that holds 300 rows or fewer (the app never sends one, but a busy day another device has since thinned out still passes); refusing that as a changed day, by counting the day's rows, belongs with the same fix. Left over from "Let a day with more than 500 switches still be corrected", which 0.5.0.0 closed.

**Effort:** M
**Priority:** P4
**Depends on:** None

### Say the list is being read again after a timeout

**What:** While the correction sheet re-reads the day after an edit timed out, say so under the rows (for example 「一覧を読み直しています…」), and show 「応答がありませんでした。反映されたか一覧で確かめてください」 only once that read settles. If the read fails as well, say the rows may be out of date rather than asking the user to check them.

**Why:** Against a hung API the re-read hits the same 30 s deadline plus the one query retry (about 61 s). The panel is dim that whole time, but the line already asks the user to check rows that still show the day before the edit. If the read fails, the panel is released on those stale rows, and redoing the edit is refused with the day-changed text, which blames another device for this device's late write. Nothing is lost there (the API's baseline check holds), but the line points at the wrong rows. On a day over `DAY_ROWS_MAX` (300 rows) the baseline carries no row list, so redoing a ±15分 move or a split that did land late passes the check and applies twice.

**Context:** `useEditLifecycle` in `apps/app/src/hooks/use-correction.ts` does not await the refetch after a `RequestTimeoutError`, so the timeout line shows at 30 s; `statusLine` in `apps/app/src/lib/correction.ts` puts a refusal ahead of any waiting text, and `waiting` follows writes only, not `list.isFetching`. New text needs the pen file's 訂正シート・状態行 board first. Left over from the PR that added the status line (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Keep the correction sheet's polite status region mounted

**What:** Keep an empty `role="status"` / `aria-live="polite"` region mounted under the correction sheet's rows while the sheet is open, and change only its text, so screen readers announce 「反映しています…」 and the offline line.

**Why:** `StatusLine` renders nothing when idle, so the polite region only appears together with its text, and NVDA, JAWS and VoiceOver on the web often skip a live region that arrives already filled. The offline line is the only thing that tells a screen-reader user an edit is queued. The refusal line is a keyed `role="alert"`, which is announced on insertion, so it is fine.

**Context:** `StatusLine` in `apps/app/src/app/(app)/correction.tsx`. The sheet's column uses `gap-4`, so an always-mounted empty child would add a 16 px gap when idle: keep it out of the flow (visually hidden, absolutely positioned) or settle the idle spacing in the pen file first. Left over from the PR that added the status line (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Tell a write that may have landed from one that failed before it left

**What:** Treat every failure that is not an `ORPCError` (a `TypeError` "Failed to fetch" after the request went out, a reset or a 502 while App Platform redeploys the API) like a timeout: drop the older 元に戻す in `fail()` and say 「反映されたか一覧で確かめてください」 rather than 「保存できませんでした。もう一度お試しください」. Keep the retry text for answers the server rolled back. For failures a retry cannot fix (UNAUTHORIZED, the input `BAD_REQUEST`s such as a row that is not one of the day's own), say what is wrong and turn 元に戻す off rather than keeping it armed.

**Why:** A connection that drops after the server committed tells the user the edit was not saved. The refetch then shows it landed, and pressing ±15分 again moves the record twice, because the new baseline matches. A request refused for its input fails the same way on every press while the text asks for another try.

**Context:** `failed` and `useEditLifecycle` (its `onError`) in `apps/app/src/hooks/use-correction.ts`; `refusalMessage`, `FAILED_MESSAGE` and `afterUndoFailure` in `apps/app/src/lib/correction.ts`. New text needs the pen file's 訂正シート・状態行 board first. Found by the pre-landing review of the PR that added the status line (2026-09-25). Since the PR that bounded timeline writes, the API cuts a request off at its 25 s deadline and says which case it is: `TIMEOUT` when nothing was saved (a retry is safe), `GATEWAY_TIMEOUT` when the cut-off came during COMMIT (it may have landed, like the app's own timeout); the app reads both as a plain failure today.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Stop naming another device when this device's own late write changed the day

**What:** Remember that the last write on the sheet timed out, and until the next success show a neutral day-changed or record-changed text (for example 「記録が変わっていたため、最新の状態を表示しました」) instead of one that names 別の端末.

**Why:** A timed-out undo keeps its slot, and on a slow API the refetch can finish before that undo commits. Once it lands, pressing 元に戻す again or making an edit is refused as day-changed, and the sheet blames another device on a single device. The same happens after any timed-out edit that lands after the refetch, and to the second press of a double tap (two presses before the controls dim), which the first press's edit refuses.

**Context:** `REFUSAL_MESSAGES` in `apps/app/src/lib/correction.ts`; `useEditLifecycle` and the undo path in `apps/app/src/hooks/use-correction.ts`. New text needs the pen file first. Since 元に戻す is offered only while the listed day matches its slot (`offeredUndo`, 2026-09-25), the undo turns off once any later read shows the late write, so only a press made before that read is still refused this way. Found by the pre-landing review of the PR that added the status line (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** None

## Stats

### Say when an edit changes whether the untapped days around it count

**What:** Add a note like the cut's 計測 line to every edit that changes the record carried into or out of the viewed day: 活動を変える on a carried-in detox (an activity turns the untapped days it ran through back into 計測なし, detox on a carried-in activity measures them), the same pick on the day's last row, and a merge or 元に戻す that removes or adds the tap ending a detox. The rule to state: whether later untapped days count follows the activity of the record carried over them.

**Why:** Since detox left on over midnight measures the days it covers (`detoxCarriedDays`, 2026-09-25), any of these edits silently moves `measuredDays`, the streak and every 1日あたり average for days the sheet is not showing.

**Context:** The rule is in `classifyDay` / `detoxCarriedDays` (`packages/shared/src/stats.ts`); `cutTotalsEffects` in `apps/app/src/lib/correction.ts` is the pattern for such a note. New text, so the pen file first. Left out of the PR that let detox days count.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Fit a 25-hour day's activity time on History's 24-hour bar

**What:** Decide how a fall-back day that holds more than 24 h of activity time fits History's bar, for example by scaling that day's slices to its own length or clamping the top activity slice as the detox part is, and add a `history.test.ts` case.

**Why:** `stackSlices` sizes every slice as a share of 24 h, so on the one day a year the clocks go back, 25 h of activity asks for more than the 132 px (week) or 48 px (month) track and the top slice is clipped by the track's rounded end.

**Context:** `stackSlices` in `apps/app/src/lib/history.ts`; `dayBounds` in `packages/shared/src/stats.ts` gives the day its real length. The detox part is already clamped to the room left above the activities. 「1本 = 24時間」 is the chart's label, so scaling one day changes what a pixel means on it. Raised by the outside voice of the eng review of the PR that drew a day's detox part on History (2026-09-25).

**Effort:** S
**Priority:** P4
**Depends on:** None

### Read a History day's activity and detox time to screen readers

**What:** Add what a stacked day cell draws to its `aria-label` (each activity's time, then detox when the cell has a detox part), and assert it in `history.test.ts`.

**Why:** A stacked cell's label is the date alone, so a screen-reader user hears nothing of the bars. Since History draws a day's partial detox time as an outline, that outline also has no text equivalent, while a detox day's label ends in ・detox.

**Context:** `SUFFIX` and `dayCell` in `apps/app/src/lib/history.ts`; `formatDuration` gives the durations. Month cells are 31 links in a row, so keep the label short. Raised by the design pass of the ship review of the PR that drew a day's detox part on History (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** None

### Decide whether a detox left running for weeks keeps measuring days

**What:** Choose whether a detox with no later tap measures every day up to today (the current rule), or stops after a limit (for example a week, or a setting), and add a test for a detox left running for a month.

**Why:** Someone who taps detox and then stops using the app gets a 連続記録 that grows by one each day and a zero-total measured day that pulls every 1日あたり average down, which is the dilution the auto exclusion exists to prevent. An activity left running is read as a forgotten tap instead, and the idle threshold does not apply to detox.

**Context:** `detoxCarriedDays` in `packages/shared/src/stats.ts` covers up to `window.to` (today). A deliberate choice in the PR that let detox days count; found in its review.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Database

### Bound the reads that still run without a deadline

**What:** Put the remaining single-query calls under the request's deadline, starting with the session lookup that every procedure runs (Better Auth's `getSession` through the Drizzle adapter), then `activities.list`, `settings.get` / `getSettings`, `switches.current` and `excludedDays.*`, so none of them waits on a half-open connection for longer than `REQUEST_DEADLINE_MS`.

**Why:** Since the PR that bounded timeline writes, every write, `activities.update` and the multi-query reads run in `inTransaction`, which destroys its connection at the deadline. The other calls still go through `db` on the pool: after a managed-database failover, a lent connection whose socket went half-open keeps such a call waiting until the OS gives up on it, minutes later. Nothing is written twice, but the request hangs past the app's 30 s, and the session lookup runs before every write, so a write can wait there before its deadline starts to matter.

**Context:** `inTransaction` in `apps/api/src/db/client.ts` owns its client and releases it with an error at the deadline; pg's `query_timeout` is not a way out (in non-pipeline mode it leaves the active query on the client, and the pool lends that client again). Better Auth takes the `db` instance in `apps/api/src/auth.ts`, so the session lookup needs either a per-request adapter or a `Promise.race` that evicts the client some other way. Left out of that PR.

**Effort:** M
**Priority:** P4
**Depends on:** None

## Design

### Raise the 24-h bar's idle dash above 3:1

**What:** Draw the idle spans of Home's 24-h bar (and the correction sheet's bar, if it dashes idle too) in dashed `sub` instead of dashed `line`, as History's excluded day now is; check it at 1x in both themes. The pen file first.

**Why:** Dashed is the "no data" mark on both surfaces, but since History's excluded day moved to `sub` (so it clears 3:1 against the card), the bar's idle dash is the one no-data mark still in `line`, 12 % ink in light and 14 % white in dark, below the 3:1 WCAG asks of a mark that carries meaning.

**Context:** `LOOK.idle` (`border border-dashed border-line`) in `apps/app/src/components/today-flow.tsx`; `design/tokens.md` §5 and `design-system/readme.md` name the idle dash. Found while fixing the excluded day's dash (2026-09-25).

**Effort:** S
**Priority:** P4
**Depends on:** None

### Keep an excluded day's detox outline off its dashed border

**What:** Decide in the pen how an excluded day's detox part meets the cell's dashed `sub` border (for example a 1 px `chip` gap inside the dash, with end radii of 6 − inset, or no side lines on that slice), then implement it and check a manually excluded day of all detox at 1x in the month view.

**Why:** History draws an excluded day's detox part as a solid `sub` outline at full width, so its side lines lie against the dash in the same tone and fill its gaps. On a day excluded by hand after a whole day of detox, the cell reads as a solid outline without the wind glyph, close to a detox day, and the dash that marks 「点線の日」 is lost.

**Context:** `CELL.excluded` in `apps/app/src/app/(app)/(tabs)/history.tsx`; `sliceLook`, `EXCLUDED_BORDER_PX` and `dayCell` in `apps/app/src/lib/history.ts` (a gap would also come off the slices' track height). The pen's excluded day is an `auto_unused` day, which holds no detox, so the pen needs a manual one. A 1 px `p-px` gap was tried in the ship review and taken back, because it changes the cell's spacing without the pen. Raised by the Claude adversarial pass of the ship review of the PR that drew a day's detox part on History (2026-09-25).

**Effort:** S
**Priority:** P4
**Depends on:** None

### Space the correction panels' groups 20 apart, as tokens.md asks

**What:** Put 20 between the groups of both correction panels (the day's own rows: 開始時刻 / 活動を変える / the merge and split buttons; the carried-in record: origin note / 区切る時刻 / 活動を変える), in the pen file first.

**Why:** `design/tokens.md` asks for at least 20 between groups; both panels use 12 (`gap-3` on the `Actions` container), so the groups read as one block.

**Context:** The carried-in panel matched the existing panel on purpose so the two stay consistent (design review of the carried-in row's panel (2026-09-24), D9); change both together.

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
