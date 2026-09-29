# TODOS

## Settings

### Check on a phone that a zone change made in the background reaches 設定

**What:** On an iPhone and an Android phone, put the app in the background, change the phone's time zone in the system settings, bring the app back, and check that the タイムゾーン row and the account's stored zone follow. On the same phones, open the タイムゾーン sheet, pick a zone, and check that VoiceOver and TalkBack read the line under the search (「…に変更しました」). On Android, also open the sheet, search with the keyboard up, and check that a row can be picked with one tap and that the list's last rows can be reached.

**Why:** The app reads the zone with `Intl.DateTimeFormat().resolvedOptions().timeZone` each time it returns to the foreground (`useDeviceZone`). The e2e covers only the web. Hermes may take the zone from a cached system value (Foundation keeps `systemTimeZone` until `resetSystemTimeZone`), so on iOS a zone change while the app stays open may not show until a relaunch. The iOS simulator cannot change its own zone (it follows the Mac) and has no screen reader, so those two parts, and the Android keyboard behaviour of the sheet's list (`automaticallyAdjustKeyboardInsets`, `keyboardShouldPersistTaps` in `apps/app/src/app/(app)/time-zone.tsx`), are still unchecked.

**Context:** `apps/app/src/hooks/use-device-zone.ts` re-reads on TanStack's `focusManager`, which `src/lib/query.ts` wires to `AppState` on native. If Hermes keeps the old zone, read it from `expo-localization` (`getCalendars()[0].timeZone`) on native instead. Found by the adversarial review of the take-back PR (2026-09-25). Checked on an iPhone 17 simulator (iOS 26.5, 2026-09-29): with the keyboard up, one tap on a row picks it, the keyboard closes and the line 「サンティアゴに変更しました」 shows under the search; a drag on the list closes the keyboard (`keyboardDismissMode="on-drag"`), after which the list scrolls to its last row.

**Effort:** S
**Priority:** P3
**Depends on:** A native build

## Stats

### Listen to History's and the correction sheet's spoken labels

**What:** With VoiceOver (iOS, and macOS Safari on the web build) and TalkBack, listen to a History day cell, a 状態別 row and a correction sheet row, and on iOS check that VoiceOver says the correction sheet's status line (a failure, 「反映しています…」) when it changes. Check that the spoken times (`9時間`, `9時間5分`, `45分`) read as times, that the `、` between a day cell's parts is a pause, that a 状態別 row is one stop that reads its label (`仕事、合計 19時間、1日あたり 6時間20分`) and not its hidden texts on iOS, and whether 31 month cells are too long to swipe through. If they are, move the times to a description (`aria-describedby` on the web, `accessibilityHint` on native) and keep the name to the date.

**Why:** The labels now say durations in Japanese, join a day cell's parts with `、`, start today's cell with 今日, and read an activity named like detox or 平均から除外 with 活動 in front, but the tests check them as strings only. Nobody has heard them.

**Context:** `formatSpokenDuration` and `spokenActivityNames` in `apps/app/src/lib/format.ts`; `cellLabel` and `breakdownLabel` in `apps/app/src/lib/history.ts`; `Breakdown` in `apps/app/src/app/(app)/(tabs)/history.tsx` (`accessible` + `role="group"` + hidden children); `RowHeader` and `StatusLine` (which calls `useIosAnnouncement` since 0.24.6.0) in `apps/app/src/app/(app)/correction.tsx`. Left by the PR that gave these labels their spoken form (2026-09-29).

**Effort:** S
**Priority:** P3
**Depends on:** None (the macOS check needs no native build)

## Auth

### Turn on mail in production and check the mailed links on a phone

**What:** Give the production API a mail server: set `SMTP_URL` (a secret, it carries the login) and `MAIL_FROM` in App Platform (`.do/app.yaml`, encrypted like `BETTER_AUTH_SECRET`), on a sending domain with SPF, DKIM and DMARC. Then, on a phone with a native build, sign up, open the mailed link and check that it lands in the app on sign-in (`?verified=1`), and the same for a reset link (`/reset-password?token=`). Also narrow the native entry in `trustedOrigins` from `switchtime://` to `switchtime://auth`.

**Why:** 0.24.19.0 built address confirmation and password reset by mail, but the API turns them on only when both variables are set, and production sets neither. Until it does, production still lets an unused address in after sign-up plus sign-in (leaving an account behind), an address can be registered by someone else first with a password of their own, and a user who forgot the password has no way back. The links were checked on the web only (e2e, against a real SMTP server); on native they redirect to `Linking.createURL('/sign-in', …)` (`switchtime:///sign-in?verified=1`), which Better Auth accepts because `switchtime://` is trusted, and no device has opened one yet.

**Context:** `apps/api/src/mail.ts`, `auth-mail.ts`, `mail-text.ts`; the pen board 「ST Phone / メール確認とパスワード再設定」. `switchtime://` stays host-less for now because the Expo client sends `expo-origin: switchtime://` (`Linking.createURL('', { scheme })`), which a `switchtime://auth` pattern rejects (`matchesOriginPattern`), so every native POST that carries cookies would get 403; the narrowing needs that origin to change too. A new account also takes longer to answer than an existing one (the inserts, and `seedUser`, which Better Auth waits for), so the timing of one request still tells, and a probe of an existing address leaves nothing behind; padding the duplicate path or seeding in the background would close that part. Two overlapping sign-ups for an unused address can also differ: one may hit the unique index and get 422 `FAILED_TO_CREATE_USER`, while an existing address answers 200 twice. Production rate limiting (Better Auth's rule for `/sign-up` and `/sign-in`, 3 per 10 s per `do-connecting-ip`) slows both, but its counts live in memory: per API instance, and reset on every deploy. A Compose API needs `docker compose up --build` once to get nodemailer.

**Effort:** M
**Priority:** P3
**Depends on:** A mail provider account and a sending domain

### Check on a phone that the 登録しました notice is spoken

**What:** With VoiceOver and TalkBack on, register, and check that the notice is read when sign-in opens. If the screen reader's own announcement of the new screen cuts it off, delay it until the transition ends (or use iOS's queued announcement).

**Why:** `useNativeAnnouncement` (`apps/app/src/hooks/use-registration.ts`) calls `announceForAccessibility` as sign-in mounts, during the stack transition, which screen readers often interrupt. On the web the password field's `aria-describedby` carries the notice instead, and the e2e tests check that one.

**Context:** Raised by the adversarial review of 0.17.0.0. `apps/app/src/app/(app)/correction.tsx` announces its status line on iOS only (0.24.6.0, through `useIosAnnouncement`).

**Effort:** S
**Priority:** P3
**Depends on:** Starting native builds

### Check on an Android phone that the sign-in card clears the keyboard

**What:** On an Android phone (or an emulator), open sign-in, focus the password field, and check that the card sits above the keyboard with the サインイン button in view, and that a short screen scrolls the card. On a phone with a display cutout or three-button navigation, check that nothing sits under the system bars.

**Why:** `AuthCard` wraps the card in `KeyboardAvoidingView` (`behavior="padding"`) and a `ScrollView`. On iOS this was checked on the simulator (an iPhone 17: the button that the keyboard used to half-cover is in view). Android draws edge to edge under SDK 57 and can size the window itself, so `padding` may double the shift or do nothing there; `behavior="height"` is the other value to try. No Android SDK was available when this was written.

**Context:** `apps/app/src/components/auth-card.tsx`; the pen board 「ST Phone / サインイン・キーボード表示中」. A build for Android needs `expo prebuild --platform android` (the peers are lined up since 0.24.17.0).

**Effort:** S
**Priority:** P3
**Depends on:** An Android device or emulator

## Infrastructure

### Install Node 26 in the Cloud Agent environment

**What:** Change the Cursor Cloud Agent environment's install step to install Node 26.10.0 with nvm and make it the default (`nvm alias default 26.10.0`). Then point the PATH hint in AGENTS.md's "Cloud Agent environment" section at `v26.10.0` and drop the `nvm install` workaround.

**Why:** Since 2026-09-22 the repository runs on Node 26: `.node-version` says 26.10.0, `engines.node` is `26.x`, and CI and both Dockerfiles use 26. The Cloud Agent environment still installs 24.20.0, so an agent's `pnpm check` and `pnpm --filter app web` run on a different major than CI. Nothing stops that: pnpm 12 did not enforce `engines` here (`pnpm install --frozen-lockfile` passed on Node 24.19.0 on 2026-09-22).

**Context:** The install and start steps live in Cursor's environment settings, not in this repository (there is no `.cursor/environment.json`). The Compose API is unaffected, because it builds `apps/api/Dockerfile` on `node:26-slim`.

**Effort:** S
**Priority:** P3
**Depends on:** Access to the Cursor Cloud Agent settings
