# TODOS

## Settings

### Check on a phone that a zone change made in the background reaches 設定

**What:** On an iPhone and an Android phone, put the app in the background, change the phone's time zone in the system settings, bring the app back, and check that the タイムゾーン row and the account's stored zone follow. On the same phones, open the タイムゾーン sheet, search with the keyboard up, and check that the list's last rows can be scrolled above the keyboard and picked with one tap, and that VoiceOver and TalkBack read the line under the search after a pick.

**Why:** The app reads the zone with `Intl.DateTimeFormat().resolvedOptions().timeZone` each time it returns to the foreground (`useDeviceZone`). The e2e covers only the web. Hermes may take the zone from a cached system value (Foundation keeps `systemTimeZone` until `resetSystemTimeZone`), so on iOS a zone change while the app stays open may not show until a relaunch. The sheet's list leans on `automaticallyAdjustKeyboardInsets` and `keyboardShouldPersistTaps` (`apps/app/src/app/(app)/time-zone.tsx`), which the web build never exercises.

**Context:** `apps/app/src/hooks/use-device-zone.ts` re-reads on TanStack's `focusManager`, which `src/lib/query.ts` wires to `AppState` on native. If Hermes keeps the old zone, read it from `expo-localization` (`getCalendars()[0].timeZone`) on native instead. Found by the adversarial review of the take-back PR (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** A native build (see "Line up the native build's peer dependencies before the first prebuild")

## Correction

### Decide what a merge that makes a segment idle should do

**What:** Warn in the sheet, or mark the row, when a merge makes a segment longer than the idle threshold. Decide as well whether a merge that leaves two rows of the same activity side by side should join them.

**Why:** A segment longer than `idleThresholdMinutes` (16 h by default) counts as idle and leaves the totals. Merging a 9 h row into an 8 h one therefore removes 17 h from the day's totals with no explanation. A merge can also leave the same activity twice in a row (仕事, 読書, 仕事 → merge 読書), which Home counts as one switch too many.

**Context:** `segmentsInRange` in `packages/shared/src/stats.ts` judges idle on the unclipped length. Both merge directions and the ±15 min steps can cross the threshold; the sheet reads the threshold since the carried-in row's panel (2026-09-24) (`totalsFacts` in `use-correction.ts`, used by `cutTotalsEffects` for 「ここで分割」's notes), so a merge or move could warn the same way. `switchTo` never records the same activity twice in a row, but the merges can. Raised by the review during the 0.2.0.0 ship; the adversarial pass added the repeated activity.

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

### Name only the untapped days an edit really changes

**What:** Make the correction sheet's untapped-day notes exact: (1) let `untappedChange` see the taps after the first switch after the day, up to that switch's day + 7, so a run that a later tap ends is not treated as running through its week; (2) leave manually excluded days out, as `classifyDay` does; (3) name separate runs of changed days separately (「9月9日、9月16日〜9月17日」) instead of one first-to-last range that can include the viewed day's own tapped day and days that do not change. (3) changes the note's text, so pen first.

**Why:** Each case shows a note, or a wider range, for days whose counting does not change. For example, picking detox for the last row of a day 8+ days back that a detox after midnight follows names the day a week later even when the next morning's tap ends that run. The notes say 「変わることがあります」 and never miss a real change, but a false warning makes them easy to ignore.

**Context:** `untappedChange` and `timeline` in `apps/app/src/lib/untapped.ts`. `switches.listByDay` returns only the first switch after the day (`carriedOut`), and manual exclusions come from `excludedDays.list` (`use-excluded-days.ts`). Adding a hook to `useCorrection` puts it over fallow's complexity limit, so feed them through `untappedSheetNotes` or the list answer. Raised by the red-team review of the PR that added the notes (2026-09-25).

**Effort:** M
**Priority:** P3
**Depends on:** None

## Stats

### Listen to History's and the correction sheet's spoken labels

**What:** With VoiceOver (iOS, and macOS Safari on the web build) and TalkBack, listen to a History day cell, a 状態別 row and a correction sheet row, and on iOS check that VoiceOver says the correction sheet's status line (a failure, 「反映しています…」) when it changes. Check that the spoken times (`9時間`, `9時間5分`, `45分`) read as times, that the `、` between a day cell's parts is a pause, that a 状態別 row is one stop that reads its label (`仕事、合計 19時間、1日あたり 6時間20分`) and not its hidden texts on iOS, and whether 31 month cells are too long to swipe through. If they are, move the times to a description (`aria-describedby` on the web, `accessibilityHint` on native) and keep the name to the date.

**Why:** The labels now say durations in Japanese, join a day cell's parts with `、`, start today's cell with 今日, and read an activity named like detox or 平均から除外 with 活動 in front, but the tests check them as strings only. Nobody has heard them.

**Context:** `formatSpokenDuration` and `spokenActivityNames` in `apps/app/src/lib/format.ts`; `cellLabel` and `breakdownLabel` in `apps/app/src/lib/history.ts`; `Breakdown` in `apps/app/src/app/(app)/(tabs)/history.tsx` (`accessible` + `role="group"` + hidden children); `RowHeader` and `StatusLine` (which calls `useIosAnnouncement` since 0.24.6.0) in `apps/app/src/app/(app)/correction.tsx`. Left by the PR that gave these labels their spoken form (2026-09-29).

**Effort:** S
**Priority:** P3
**Depends on:** None (the macOS check needs no native build)

## Database

### Bound the calls that still run without a deadline

**What:** Put the remaining calls under the request's deadline, starting with the session lookup that every procedure runs (Better Auth's `getSession` through the Drizzle adapter), then the writes `excludedDays.*` and `settings.update` without a zone change, and the reads `activities.list`, `settings.get` / `getSettings` and `switches.current`, so none of them waits on a half-open connection for longer than `REQUEST_DEADLINE_MS`.

**Why:** Since the PR that bounded timeline writes, every timeline write, `activities.update` and the multi-query reads run in `inTransaction` (and `activities.create`, `reorder` and `unarchive` since the PR that added `unarchive`, 2026-09-25), which destroys its connection at the deadline. The other calls still go through `db` on the pool: after a managed-database failover, a lent connection whose socket went half-open keeps such a call waiting until the OS gives up on it, minutes later. Nothing is written twice, but the request hangs past the app's 30 s, and the session lookup runs before every write, so a write can wait there before its deadline starts to matter.

**Context:** `inTransaction` in `apps/api/src/db/client.ts` owns its client and releases it with an error at the deadline; pg's `query_timeout` is not a way out (in non-pipeline mode it leaves the active query on the client, and the pool lends that client again). Better Auth takes the `db` instance in `apps/api/src/auth.ts`, so the session lookup needs either a per-request adapter or a `Promise.race` that evicts the client some other way. Left out of that PR. Reads also have no per-account cap like `TIMELINE_WRITES_PER_USER`: one account sending many `stats.month` calls at once can hold every pool connection (pg's default of 10) for up to the deadline, so a small in-flight cap on reads belongs with this work. A timeline write that waits out `lock_timeout` (55P03, another instance holds the lock past 10 s) or `statement_timeout` (57014) still answers a plain 500 although nothing was saved; answer it as TIMEOUT, like a write cut off at its deadline. Since the correction status PR (2026-09-25) the app reads a plain 500 as a write that may have landed: it asks the user to check the list and drops the day's older 元に戻す, which a TIMEOUT would keep.

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

### Give the plain Pressables the focus ring and pressed look `Control` has

**What:** Draw the pen's 「Control の押下とフォーカス」 look (2 px `ink` ring at a 2 px offset on keyboard focus, 70 % while pressed) on the Pressables that are not `Control`s: the correction sheet's row headers, `ActivityPill`, the sheet's 完了 and ✕, and any others a sweep finds. The pen first, for the ones whose shape the ring would change.

**Why:** Since 0.23.0.0 the sheet's buttons show where keyboard focus is and answer a press, but a keyboard user tabbing from a merge button to the row header next to it loses the ring, and a tap on a pill gives no feedback.

**Context:** `apps/app/src/components/control.tsx` holds the classes; `RowHeader` and the footer's 完了 in `apps/app/src/app/(app)/correction.tsx`, `apps/app/src/components/activity-pill.tsx`, and the ✕ in `apps/app/src/components/sheet.tsx`. Raised by the design pass of the ship review of 0.23.0.0 (2026-09-25).

**Effort:** S
**Priority:** P3
**Depends on:** None

## Auth

### Prove that an e-mail address belongs to the person signing up

**What:** Turn on `requireEmailVerification` once there is a mailer, so an address cannot be used until its owner confirms it, and add a password reset through the same mailer. When e-mail links or social sign-in bring auth deep links, also narrow the native entry in `trustedOrigins` from `switchtime://` to `switchtime://auth`.

**Why:** Since 0.17.0.0 (`autoSignIn: false`) the answer to one sign-up request no longer tells whether an address has an account: Better Auth answers both the same way. The flow still does: sign up with a fresh password, then sign in with it, and only an unused address lets you in (leaving an account behind). Two overlapping sign-ups for an unused address can also differ: one may hit the unique index and get 422 `FAILED_TO_CREATE_USER`, while an existing address answers 200 twice. And someone who forgot they had an account and "registers" again with a new password gets 「登録しました」, then a sign-in error, with no way back without a reset. The same dead end hides squatting: someone can register another person's address first with a password of their own, and its owner now meets 「登録しました」 and a sign-in error instead of "already exists".

**Context:** `apps/api/src/auth.ts` sets `emailAndPassword: { enabled: true, autoSignIn: false }`; the branch is `shouldReturnGenericDuplicateResponse` in `better-auth/dist/api/routes/sign-up.mjs`. `requireEmailVerification` needs `sendVerificationEmail`; with it, `onExistingUserSignUp` can mail the owner of an address that someone tried to register again. The 登録しました notice on sign-in (pen board 「ST Phone / サインイン（登録後）」) would then say to check the inbox, so change the board first. `switchtime://` stays host-less for now because the Expo client sends `expo-origin: switchtime://` (`Linking.createURL('', { scheme })`), which a `switchtime://auth` pattern rejects (`matchesOriginPattern`), so every native POST that carries cookies would get 403; the narrowing needs that origin to change too. A new account also takes longer to answer than an existing one (the inserts, and `seedUser`, which Better Auth waits for), so the timing of one request still tells, and a probe of an existing address leaves nothing behind; padding the duplicate path or seeding in the background would close that part without a mailer. Production rate limiting (Better Auth's rule for `/sign-up` and `/sign-in`, 3 per 10 s per `do-connecting-ip`) slows both, but its counts live in memory: per API instance, and reset on every deploy.

**Effort:** M
**Priority:** P3
**Depends on:** A mailer

### Say the auth errors in Japanese

**What:** Show the sign-in and sign-up server errors in Japanese: map Better Auth's error codes (`INVALID_EMAIL_OR_PASSWORD`, `PASSWORD_TOO_SHORT`, the rate limit's 429, …) to the app's words instead of showing its English `message`.

**Why:** A wrong password shows "Invalid email or password" in an otherwise Japanese app. Since 0.17.0.0 every sign-up goes through sign-in, so more people see it.

**Context:** `useAuthForm` (`apps/app/src/hooks/use-auth-form.ts`) throws `error.message ?? 'もう一度お試しください'` and `AuthCard` shows it as the role=alert line. Put the copy on a pen board first (the text on a screen is a design change). Raised by the design review of the 0.17.0.0 plan.

**Effort:** S
**Priority:** P3
**Depends on:** The copy on a pen board

### Check on a phone that the 登録しました notice is spoken

**What:** With VoiceOver and TalkBack on, register, and check that the notice is read when sign-in opens. If the screen reader's own announcement of the new screen cuts it off, delay it until the transition ends (or use iOS's queued announcement).

**Why:** `useNativeAnnouncement` (`apps/app/src/hooks/use-registration.ts`) calls `announceForAccessibility` as sign-in mounts, during the stack transition, which screen readers often interrupt. On the web the password field's `aria-describedby` carries the notice instead, and the e2e tests check that one.

**Context:** Raised by the adversarial review of 0.17.0.0. `apps/app/src/app/(app)/correction.tsx` announces its status line on iOS only (0.24.6.0, through `useIosAnnouncement`).

**Effort:** S
**Priority:** P3
**Depends on:** Starting native builds

### Keep the sign-in card still when the 登録しました notice goes

**What:** Decide on the pen board 「ST Phone / サインイン（登録後）」 what happens to the space of the notice once it goes, and make sign-in match: keep the chip's space, top-align the card on this screen, or keep the notice until the sign-in lands.

**Why:** The first keystroke in the focused password field dismisses the notice. `AuthCard` centres the card vertically, so losing the chip and its gap (about 50px) moves the whole card by about 25px while the user types.

**Context:** `dismissNotice()` runs in sign-in's `set` wrapper (`apps/app/src/app/(auth)/sign-in.tsx`); the card is centred by `items-center justify-center` in `apps/app/src/components/auth-card.tsx`. The board's caption says the notice goes on input but does not draw the card after it. Raised by the design review of 0.17.0.0.

**Effort:** S
**Priority:** P3
**Depends on:** The after-input state on the pen board

### Draw the auth screens with the keyboard open

**What:** Add a keyboard-open state of the sign-in and sign-up boards to the pen file, then keep the focused field and the submit button above the keyboard on iOS and Android (a `KeyboardAvoidingView` or a scrollable card).

**Why:** Since 0.17.0.0 sign-in focuses the password field after 登録, so the keyboard opens as soon as sign-in comes into view after 登録. The auth screens have nothing that moves out of its way: on a phone the keyboard (about 336pt) can cover the サインイン button, and the password field on a short one.

**Context:** `useScreenFocusField` (`apps/app/src/hooks/use-screen-focus-field.ts`) focuses the password from `sign-in.tsx`; `AuthCard` has no keyboard handling. The web build is not affected. Raised by the design review of 0.17.0.0.

**Effort:** S
**Priority:** P3
**Depends on:** Starting native builds; the keyboard-open state on the pen board

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
