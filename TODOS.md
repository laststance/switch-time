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

### Let 「元に戻す」 restore a day that holds an archived activity

**What:** Pick one of two fixes: (a) `replaceDay` checks only that the activities are the user's, or (b) the merges refuse (CONFLICT plus a row flag) on a day that holds a row of an archived activity.

**Why:** The undo snapshot carries every row's `activityId`, and `replaceDay` refuses archived ones (`BAD_REQUEST 'activity is archived'`). After any edit on such a day, 「元に戻す」 fails every time, silently. For a merge that loses data: the merged-away row never comes back, and a row of the archived activity cannot even be rebuilt by hand, because `changeActivity` refuses archived ids too.

**Context:** Archiving refuses only the current state's activity, and past rows keep the archived id. (a) reverses "a replaced day cannot be written onto an archived activity" in `domain.test.ts` (7e3f204) and lets a client write fresh time onto a hidden activity on past days; (b) keeps that rule but blocks a legitimate merge and needs a client flag. The hole has been there since 0.1.0.0 for 「前の記録に統合」 (and for undoing ±15 min, 活動を変える and 半分で分割); 0.2.0.0 adds 「次の記録に統合」 to the same path. Raised by the red team during the 0.2.0.0 ship; the choice was left to the owner.

**Effort:** S
**Priority:** P1
**Depends on:** None

### Refuse an undo when the day changed after the edit

**What:** Make `replaceDay` conditional: send the ids of the rows the edit left, and answer CONFLICT inside the transaction when the day's current ids differ.

**Why:** 「元に戻す」 deletes the day's whole window and writes the snapshot back without looking. A switch made on another device after the snapshot's data was fetched (up to the 30 s `staleTime`), or after the edit while 元に戻す is still armed, is deleted for good, and the current state silently reverts.

**Context:** The snapshot is `list.data` when the button is pressed (`use-correction.ts`), and Home's today view shares the `listByDay` key. Once the edit's invalidation has refetched, `queryClient.getQueryData` holds the rows the edit left. A client-only stopgap is `staleTime: 0` on the sheet's list. Raised by the red team during the 0.2.0.0 ship.

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

**What:** Invalidate `switches.*` in `useUpdateSettings` when `timeZone` changes.

**Why:** `listByDay` is keyed by the day string, but the server windows it with the stored time zone. After a change, a cached answer (30 s `staleTime`) still holds the old window while the sheet computes `dayBounds` with the new one, so the row flags and the undo snapshot disagree with the day `replaceDay` rewrites: 「元に戻す」 then fails, or deletes rows the snapshot never had.

**Context:** `useUpdateSettings` refetches `settings.*` and `stats.*` only. The server checks day bounds for 「次の記録に統合」 (0.2.0.0); `moveStart` and `splitInHalf` still trust the client's flags, so a mismatched window can also leave a stray row on the next day after 「元に戻す」. Pre-existing, raised by the review during the 0.2.0.0 ship.

**Effort:** S
**Priority:** P2
**Depends on:** None

### Decide what a merge that makes a segment idle should do

**What:** Warn in the sheet, or mark the row, when a merge makes a segment longer than the idle threshold.

**Why:** A segment longer than `idleThresholdMinutes` (12 h by default) counts as idle and leaves the totals. Merging a 7 h row into a 6 h one therefore removes 13 h from the day's totals with no explanation.

**Context:** `segmentsInRange` in `packages/shared/src/stats.ts` judges idle on the unclipped length. Both merge directions and the ±15 min steps can cross the threshold; the sheet does not know the threshold today (`useSettings` has it). Raised by the review during the 0.2.0.0 ship.

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

**What:** Pad the year in `localDay` (`String(c.year).padStart(4, '0')`) and add a `time.test.ts` case for a day before the year 1000.

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
