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

### Offer 「元に戻す」 on a day of more than 600 switches

**What:** Arm the day's 「元に戻す」 after an edit on a day that lists more than `UNDO_ROWS_MAX` (600) rows, for example by writing back only the rows the edit changed instead of the whole day.

**Why:** Since 0.24.7.0 a day busier than `DAY_ROWS_MAX` (300) names its rows by a digest (`dayDigest`), so its edits notice another device's change and its undo writes back up to 600 rows under the 100 KB body limit on `/api/*`. Above 600 the edit still lands with the digest baseline, but no undo is armed, since the rows to write back no longer fit one request.

**Context:** `undoSlotFor` and `undoRequest` in `apps/app/src/lib/correction.ts`, `replaceDay` in `apps/api/src/rpc/switches.ts`, `UNDO_ROWS_MAX` in `packages/shared/src/schemas.ts`, the body-limit tests in `apps/api/src/app.test.ts`. Only a script or a hotkey burst reaches 600 switches in a day.

**Effort:** M
**Priority:** P4
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

### Bound Better Auth's own transactions

**What:** Put the transactions Better Auth opens through its Drizzle adapter (sign-up: the user, account and seed rows) under a deadline, so a half-open connection cannot hold one past `REQUEST_DEADLINE_MS`.

**Why:** Every statement run through `db` outside a transaction now reads the request's deadline from `requestDeadline`, and a call through `inTransaction` destroys its connection at it. Better Auth's `/api/auth/*` handler sets no request clock and its `db.transaction` (the adapter's `transaction: true`) takes a connection from the pool and runs its statements on it, so a sign-up whose socket went half-open waits until the OS gives up. Only sign-up and the writes that use the adapter's transaction are affected; sign-in and the session lookup run statement by statement and are bounded.

**Context:** `boundedPool` in `apps/api/src/db/client.ts` hands `connect` straight to the pool; it could hand back a client whose `query` is bounded the same way `queryWithinDeadline` is, or `apps/api/src/auth.ts` could stop asking for `transaction: true` and let the seed hook repair a half-made account (`seedUser` already does). The auth route also needs its own `requestDeadline.run` in `apps/api/src/app.ts`.

**Effort:** S
**Priority:** P4
**Depends on:** None

## Auth

### Prove that an e-mail address belongs to the person signing up

**What:** Turn on `requireEmailVerification` once there is a mailer, so an address cannot be used until its owner confirms it, and add a password reset through the same mailer. When e-mail links or social sign-in bring auth deep links, also narrow the native entry in `trustedOrigins` from `switchtime://` to `switchtime://auth`.

**Why:** Since 0.17.0.0 (`autoSignIn: false`) the answer to one sign-up request no longer tells whether an address has an account: Better Auth answers both the same way. The flow still does: sign up with a fresh password, then sign in with it, and only an unused address lets you in (leaving an account behind). Two overlapping sign-ups for an unused address can also differ: one may hit the unique index and get 422 `FAILED_TO_CREATE_USER`, while an existing address answers 200 twice. And someone who forgot they had an account and "registers" again with a new password gets 「登録しました」, then a sign-in error, with no way back without a reset. The same dead end hides squatting: someone can register another person's address first with a password of their own, and its owner now meets 「登録しました」 and a sign-in error instead of "already exists".

**Context:** `apps/api/src/auth.ts` sets `emailAndPassword: { enabled: true, autoSignIn: false }`; the branch is `shouldReturnGenericDuplicateResponse` in `better-auth/dist/api/routes/sign-up.mjs`. `requireEmailVerification` needs `sendVerificationEmail`; with it, `onExistingUserSignUp` can mail the owner of an address that someone tried to register again. The 登録しました notice on sign-in (pen boards 「ST Phone / サインイン（登録後）」 and 「ST Phone / サインイン・入力中と失敗」) would then say to check the inbox, so change the boards first. `switchtime://` stays host-less for now because the Expo client sends `expo-origin: switchtime://` (`Linking.createURL('', { scheme })`), which a `switchtime://auth` pattern rejects (`matchesOriginPattern`), so every native POST that carries cookies would get 403; the narrowing needs that origin to change too. A new account also takes longer to answer than an existing one (the inserts, and `seedUser`, which Better Auth waits for), so the timing of one request still tells, and a probe of an existing address leaves nothing behind; padding the duplicate path or seeding in the background would close that part without a mailer. Production rate limiting (Better Auth's rule for `/sign-up` and `/sign-in`, 3 per 10 s per `do-connecting-ip`) slows both, but its counts live in memory: per API instance, and reset on every deploy.

**Effort:** M
**Priority:** P3
**Depends on:** A mailer

### Check on a phone that the 登録しました notice is spoken

**What:** With VoiceOver and TalkBack on, register, and check that the notice is read when sign-in opens. If the screen reader's own announcement of the new screen cuts it off, delay it until the transition ends (or use iOS's queued announcement).

**Why:** `useNativeAnnouncement` (`apps/app/src/hooks/use-registration.ts`) calls `announceForAccessibility` as sign-in mounts, during the stack transition, which screen readers often interrupt. On the web the password field's `aria-describedby` carries the notice instead, and the e2e tests check that one.

**Context:** Raised by the adversarial review of 0.17.0.0. `apps/app/src/app/(app)/correction.tsx` announces its status line on iOS only (0.24.6.0, through `useIosAnnouncement`).

**Effort:** S
**Priority:** P3
**Depends on:** Starting native builds

### Keep the error's place while a sign-in retry runs

**What:** Hold the alert box's height while a retry is in flight, so the card does not jump when its error goes and comes back.

**Why:** `useAuthForm` reads `request.error`, which TanStack Query clears the moment the next request starts. On a card with no registration notice, the error box (about 50px) disappears when the button is pressed again and returns with the next error, and the centred card moves about 25px each way. The registration notice already keeps the box: it comes back while a retry runs, and an error takes its place again.

**Context:** `serverError` in `apps/app/src/hooks/use-auth-form.ts`; the box is drawn by `AuthCard` (`apps/app/src/components/auth-card.tsx`). Left by the PR that put the auth errors in Japanese and kept the notice through typing (0.24.11.0). Draw the retry state on the pen board 「ST Phone / サインイン・入力中と失敗」 first.

**Effort:** S
**Priority:** P4
**Depends on:** The retry state on the pen board

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
