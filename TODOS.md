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

**What:** Show a short line on ホーム when a tap (or a hotkey) is refused, reusing the correction sheet's messages (`failureKind` and `failureMessage` in `apps/app/src/lib/correction.ts`): `busy` (TOO_MANY_REQUESTS), `archived`, a failure that may have landed (a timeout, a lost answer, a 5xx), or a plain failure.

**Why:** A refused tap only rolls back its optimistic state (`useSwitchTo`), so the clock jumps back without a word. Since 0.5.0.0 a burst of taps from several devices can reach the account's cap of writes under its lock (`TIMELINE_WRITES_PER_USER`, which the activity writes share since 0.14.0.0), and every refusal now carries a reason the app can read.

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

### Say why the 活動項目 editor refused an add, a reorder or an archive

**What:** Give the create, reorder and archive mutations in `useActivityEditor` an error line (designed in the pen file first): the `busy` refusal in the same Japanese the correction sheet uses (`failureMessage`), archive's CONFLICT, and for `GATEWAY_TIMEOUT` a line saying the add may have been saved.

**Why:** None of the three has an `onError`; `write.onSettled` only refetches the list, so a refused 「＋ 項目を追加」, ▲▼ or 🗑 just does nothing. Since `activities.create` and `reorder` run under `withUserLock` they can also answer `TOO_MANY_REQUESTS` (`busy`) and the deadline errors, as `archive` already could. A `GATEWAY_TIMEOUT` on an add may have saved the row; the refetch shows it, but a user who taps again before it lands adds a second one.

**Context:** `apps/app/src/hooks/use-activity-editor.ts`, `failureMessage` in `apps/app/src/lib/correction.ts`, `REFUSAL` in `packages/shared`. Raised by the API-contract pass during the `activities.unarchive` ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

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

### Keep the user's own selection when today's sheet passes midnight

**What:** When the sheet's day changes, keep the row the user selected if the new day still lists it (the running record becomes the carried-in one under the same id), and drop only the selection and focus an answer set.

**Why:** `sheetView` starts the sheet's own state over whenever the day changes, so a panel open at midnight closes under the user's finger, with its picker and 区切る時刻. Before 0.8.0.0 the selection stayed. `onPressedDay` alone already keeps a late answer off the new day.

**Context:** `sheetView` and `onPressedDay` in `apps/app/src/lib/correction.ts`; the e2e "a split whose answer lands after midnight selects nothing on the new day" must keep passing. Raised by the Claude adversarial pass during the 0.8.0.0 ship.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Rebuild a merged-away record of an archived activity

**What:** Add a control in 設定 that lists the archived activities and brings one back with 戻す through `activities.unarchive`, so the usual edits can rebuild a record of it once 「元に戻す」 is gone. The pen file first.

**Why:** 「元に戻す」 restores a day that holds a record of an archived activity, and it survives closing the sheet, but not a reload or sign-out. After that, a record merged into its neighbour cannot be rebuilt: `changeActivity` refuses archived ids and the 活動を変える picker lists live activities only (`useActivities`). The route exists since the PR that added it (2026-09-25), but no screen calls it. A pick on a carried-in record of an archived activity arms no undo at all (the panel warns before the pick and shows 「前の活動はアーカイブ済みのため、元に戻せません」 after it), so that record is another one only this control could rebuild.

**Context:** `activities.unarchive` in `apps/api/src/rpc/activities.ts` puts the activity back at the end of the live order and answers an already-live one unchanged. `activities.list` already returns archived rows (`archivedAt` set), so the control needs no new read; the 活動項目 editor (`useActivityEditor`, `editorRows` in `apps/app/src/lib/settings.ts`) lists live ones only. The other remedy, `changeActivity` accepting archived ids on a past row, is no longer needed. Left out of scope by the 0.2.1.0 fix, in which the owner chose to have `replaceDay` check ownership only; raised by the review during that ship.

**Effort:** S
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

**Context:** `dayBaseline` and `undoSlotFor` in `apps/app/src/lib/correction.ts`, `checkBaseline` and `checkOwnRowBaseline` in `apps/api/src/rpc/switches.ts`, `DAY_ROWS_MAX` in `packages/shared/src/schemas.ts`, the body-limit test in `apps/api/src/app.test.ts`. Only a script or a hotkey burst reaches 300 switches in a day. The API also accepts a baseline without `rows` on a day that holds 300 rows or fewer (the app never sends one, but a busy day another device has since thinned out still passes); refusing that as a changed day, by counting the day's rows, belongs with the same fix. Left over from "Let a day with more than 500 switches still be corrected", which 0.5.0.0 closed. Since the correction status PR (2026-09-25), a failure that may have landed (a timeout, a lost answer, a 5xx) says 「反映されたか分かりませんでした。一覧で確かめてください」 once the list is read again, but on such a day redoing a ±15分 move or a split that did land passes the rowless baseline and applies twice.

**Effort:** M
**Priority:** P4
**Depends on:** None

### Refuse a day undo whose day changed and changed back while nobody read it

**What:** Retire a day's armed 「元に戻す」 when the day was changed and then changed back while no read of it landed, for example by giving each day a revision the API bumps on every write, which the slot keeps and `replaceDay` checks.

**Why:** A slot is retired only when a read shows the day moved on. On a past day whose sheet is closed, nothing reads it: another device can change a row and change it back (pick 娯楽, then 仕事 again), and the reopened sheet still offers the undo, since the day compares rows by id, activity and start, not by revision. Pressing it then undoes an edit from before those changes. The rows it restores are what the edit replaced, so nothing is lost that the day did not already show, but the undo reaches past changes the user never saw.

**Context:** `undoOutlived`, `offeredUndo` and `dayRowsMatch` in `apps/app/src/lib/correction.ts`; `checkBaseline` in `apps/api/src/rpc/switches.ts`. Left over from the PR that retires the undo by later reads (2026-09-25), which closed "Drop a day's 元に戻す once a settled read shows the day moved on" for every change a read sees.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Announce the correction sheet's status line with VoiceOver on iOS

**What:** On iOS, call `AccessibilityInfo.announceForAccessibility` whenever the correction sheet's status line gets new text: the failure lines (alert) and 「反映しています…」, 「一覧を読み直しています…」 and the offline line (polite).

**Why:** React Native has no live region on iOS: `aria-live` and `role="alert"` are read on the web and Android only, so a VoiceOver user never hears why an edit failed or that it is waiting. The cut's 区切る時刻 readout already announces itself this way on iOS.

**Context:** `StatusLine` in `apps/app/src/app/(app)/correction.tsx` (its slots come from `statusSlots` in `apps/app/src/lib/correction.ts`); the pattern is in `CarriedInActions` in the same file. The web keeps the mounted polite region and the keyed alert. Found by the pre-landing review of the PR that settled the correction status line by later reads (2026-09-25). Only matters once the native build ships.

**Effort:** S
**Priority:** P4
**Depends on:** None

## Stats

### Say when an edit changes whether the untapped days around it count

**What:** Add a note like the cut's 計測 line to every edit that changes the record carried into or out of the viewed day: 活動を変える on a carried-in detox (an activity turns the untapped days it ran through back into 計測なし, detox on a carried-in activity measures them), the same pick on the day's last row, a merge or 元に戻す that removes or adds the tap ending a detox, and an edit that joins or splits detox runs (detox picked for the record between two detoxes, a merge that removes it, a pick or move on a run's first record), which moves the day its 7-day week counts from and can turn days another week measured into 計測なし. The rule to state: whether later untapped days count follows the activity of the record carried over them, for at most a week of detox.

**Why:** Since detox left on over midnight measures up to a week of the days it covers (`detoxCarriedDays`, 2026-09-25), any of these edits silently moves `measuredDays`, the streak and every 1日あたり average for days the sheet is not showing.

**Context:** The rule is in `classifyDay` / `detoxCarriedDays` (`packages/shared/src/stats.ts`); `cutTotalsEffects` in `apps/app/src/lib/correction.ts` is the pattern for such a note. New text, so the pen file first. Left out of the PR that let detox days count.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Say on Home when a detox has stopped counting days

**What:** Show on Home (and decide whether History's today cell follows) that a detox running past `DETOX_MEASURED_DAYS_MAX` (7) days after its run started no longer measures the untapped days, or let a detox re-tap on a day past the week start a new run (a new detox row the stats treat as a tap, which cut and rewrite rows are not).

**Why:** From the eighth day after a detox run started, the untapped days it runs through are 計測なし and 連続記録 breaks, but DetoxRow stays pressed and nothing says so; tapping detox again is a no-op in `switches.switchTo`, so the only way to keep counting is a tap on an activity and back, which writes a minute of activity time.

**Context:** The cap and the run rule are in `detoxCarriedDays` (`packages/shared/src/stats.ts`); the re-tap no-op is `switches.switchTo` (`apps/api/src/rpc/switches.ts`). The plan review of the cap (2026-09-25) kept the no-op and the API as they are; raised by the red team of that PR's pre-landing review. New text or state on Home, so the pen file first.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Say the detox week in the 未使用日の扱い hint

**What:** Change the hint on the 未使用日の扱い sheet, 「…デトックスを続けた日は計測に入ります。」, to state the week limit (for example 「デトックスを続けた日は7日まで計測に入ります。」), in the pen file first.

**Why:** Since the detox cap (2026-09-25), the untapped days from the eighth day after a detox run started are listed as 切替なし on that same sheet, under a hint that says they count.

**Context:** `hint` in `apps/app/src/app/(app)/excluded-days.tsx`; the board is `ST Phone / 設定＋除外シート` in `design/switch-time.pen`. Raised by the red team of the cap's pre-landing review; left out because only one session edits the pen file at a time.

**Effort:** S
**Priority:** P2
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

## Database

### Bound the calls that still run without a deadline

**What:** Put the remaining calls under the request's deadline, starting with the session lookup that every procedure runs (Better Auth's `getSession` through the Drizzle adapter), then the writes `excludedDays.*` and `settings.update` without a zone change, and the reads `activities.list`, `settings.get` / `getSettings` and `switches.current`, so none of them waits on a half-open connection for longer than `REQUEST_DEADLINE_MS`.

**Why:** Since the PR that bounded timeline writes, every timeline write, `activities.update` and the multi-query reads run in `inTransaction` (and `activities.create`, `reorder` and `unarchive` since the PR that added `unarchive`, 2026-09-25), which destroys its connection at the deadline. The other calls still go through `db` on the pool: after a managed-database failover, a lent connection whose socket went half-open keeps such a call waiting until the OS gives up on it, minutes later. Nothing is written twice, but the request hangs past the app's 30 s, and the session lookup runs before every write, so a write can wait there before its deadline starts to matter.

**Context:** `inTransaction` in `apps/api/src/db/client.ts` owns its client and releases it with an error at the deadline; pg's `query_timeout` is not a way out (in non-pipeline mode it leaves the active query on the client, and the pool lends that client again). Better Auth takes the `db` instance in `apps/api/src/auth.ts`, so the session lookup needs either a per-request adapter or a `Promise.race` that evicts the client some other way. Left out of that PR. Reads also have no per-account cap like `TIMELINE_WRITES_PER_USER`: one account sending many `stats.month` calls at once can hold every pool connection (pg's default of 10) for up to the deadline, so a small in-flight cap on reads belongs with this work. A timeline write that waits out `lock_timeout` (55P03, another instance holds the lock past 10 s) or `statement_timeout` (57014) still answers a plain 500 although nothing was saved; answer it as TIMEOUT, like a write cut off at its deadline. Since the correction status PR (2026-09-25) the app reads a plain 500 as a write that may have landed: it asks the user to check the list and drops the day's older 元に戻す, which a TIMEOUT would keep.

**Effort:** M
**Priority:** P4
**Depends on:** None

### Cap how many live activities an account can have

**What:** Refuse `activities.create` and `activities.unarchive` once the account has as many live activities as `reorderInputSchema` accepts (100), with a `$count` under `withUserLock` and a `REFUSAL` reason the editor can say, and share the number between the two.

**Why:** `reorder` must name the whole live set and accepts 1 to 100 ids, but nothing stops the live set growing past that: an account with 101 live activities can never reorder again, and with the editor's silent refusals (the 活動項目 item under Settings) the ▲▼ buttons just stop working. A client adding in a loop is throttled only by the per-process in-flight cap.

**Context:** `apps/api/src/rpc/activities.ts`, `reorderInputSchema` in `packages/shared/src/schemas.ts`. Raised by the red-team pass during the `activities.unarchive` ship; the gap predates it.

**Effort:** S
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

### Prove that an e-mail address belongs to the person signing up

**What:** Turn on `requireEmailVerification` once there is a mailer, so an address cannot be used until its owner confirms it, and add a password reset through the same mailer. When e-mail links or social sign-in bring auth deep links, also narrow the native entry in `trustedOrigins` from `switchtime://` to `switchtime://auth`.

**Why:** Since 0.16.0.0 (`autoSignIn: false`) one sign-up request no longer tells whether an address has an account: Better Auth answers both the same way. The flow still does: sign up with a fresh password, then sign in with it, and only an unused address lets you in (leaving an account behind). Two overlapping sign-ups for an unused address can also differ: one may hit the unique index and get 422 `FAILED_TO_CREATE_USER`, while an existing address answers 200 twice. And someone who forgot they had an account and "registers" again with a new password gets 「登録しました」, then a sign-in error, with no way back without a reset.

**Context:** `apps/api/src/auth.ts` sets `emailAndPassword: { enabled: true, autoSignIn: false }`; the branch is `shouldReturnGenericDuplicateResponse` in `better-auth/dist/api/routes/sign-up.mjs`. `requireEmailVerification` needs `sendVerificationEmail`; with it, `onExistingUserSignUp` can mail the owner of an address that someone tried to register again. The 登録しました notice on sign-in (pen board 「ST Phone / サインイン（登録後）」) would then say to check the inbox, so change the board first. `switchtime://` stays host-less for now because the Expo client sends `expo-origin: switchtime://` (`Linking.createURL('', { scheme })`), which a `switchtime://auth` pattern rejects (`matchesOriginPattern`), so every native POST that carries cookies would get 403; the narrowing needs that origin to change too. A new account also takes longer to answer than an existing one (the inserts and `seedUser`), a weaker signal than the flow above; production rate limiting (Better Auth's rule for `/sign-up` and `/sign-in`, 3 per 10 s per `do-connecting-ip`) bounds both.

**Effort:** M
**Priority:** P3
**Depends on:** A mailer

### Say the auth errors in Japanese

**What:** Show the sign-in and sign-up server errors in Japanese: map Better Auth's error codes (`INVALID_EMAIL_OR_PASSWORD`, `PASSWORD_TOO_SHORT`, the rate limit's 429, …) to the app's words instead of showing its English `message`.

**Why:** A wrong password shows "Invalid email or password" in an otherwise Japanese app. Since 0.16.0.0 every sign-up goes through sign-in, so more people see it.

**Context:** `useAuthForm` (`apps/app/src/hooks/use-auth-form.ts`) throws `error.message ?? 'もう一度お試しください'` and `AuthCard` shows it as the role=alert line. Put the copy on a pen board first (the text on a screen is a design change). Raised by the design review of the 0.16.0.0 plan.

**Effort:** S
**Priority:** P3
**Depends on:** The copy on a pen board

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
