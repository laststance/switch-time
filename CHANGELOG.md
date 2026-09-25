# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
`major.minor.patch.micro`.

## [0.18.0.0] - 2026-09-25

### Added

- Pressing デトックス again once its week is over starts a new week of
  counting. Home's detox row says 「押し直すと新しく始まります」 then,
  and the press (or the `0` key) starts the detox over from now, so the
  untapped days after it count again for up to 7 days. Inside the week
  the press still changes nothing, and a double tap starts one week, not
  two.
- On the last day a detox measures, Home says 「明日から計測に入りません」
  and how to keep counting, instead of only telling you after the days
  have stopped counting.

### Changed

- The notice on a day a detox no longer measures now names both ways
  back: press デトックス again, or switch to an activity.
- A detox that a cut split still counts its week from the day it
  started, on Home too.
- Edits and 「元に戻す」 keep a renewed week: undoing an edit on that
  day, or merging the renewed record into the detox split from it or
  into the detox before it on the same day, no longer folds it back
  into the earlier week.
- Renewing is offered only while 「使わなかった日を除外」 is on, since
  every day counts while it is off.

## [0.17.0.0] - 2026-09-25

### Changed

- 新規登録 no longer tells anyone whether an address already has an
  account. アカウントを作成 answers the same way for a new address and a
  taken one, and it no longer signs you in: サインイン opens with the
  address filled in, the password field ready, and
  「登録しました。サインインしてください」. Signing in with the password
  just chosen can still tell, until the app proves who owns an address.
- The notice is read out: with the password field on the web, and
  announced by the screen reader on iPhone and Android.

### Fixed

- A sign-up holding a character the database cannot store as sent (a
  NUL, or half of a UTF-16 pair) is turned away the same way for a new
  and a taken address, instead of answering differently.
- A sign-up left waiting on a slow connection no longer takes over
  サインイン when its answer finally comes, whether you went on to sign
  in or registered another address.
- Once a sign-in goes through, サインイン keeps the address you sent and
  its button stays off until the app opens, so a second tap cannot send
  it again. A sign-in whose screen you left before it answered still
  clears the previous account's data from this device.
- Going back to サインイン from 新規登録 without registering leaves the
  cursor where you had it.

## [0.16.0.0] - 2026-09-25

### Added

- Home says so when a detox has run past its week: from the eighth day
  after it started, with no switch that day, 「今日は計測に入りません」
  and the rule appear under the detox, until you tap an activity. It
  shows only once the server confirms the day is not measured, never
  while that answer is loading or failed, and never while 未使用日の扱い
  keeps every day measured.
- The 「… から」 line on Home names the day (`9月16日 21:20`) when the
  running record started before today, so a detox carried over from an
  earlier day no longer reads as if it started this morning.

### Changed

- The 未使用日の扱い hint states the detox week: a detox counts from the
  day after it started for 7 days, and after that the day is left out as
  「切替なし」.

## [0.15.0.0] - 2026-09-25

### Added

- 設定 has a タイムゾーン row. It shows the account's zone next to this
  device's, and when another device (a laptop abroad, a browser that
  reports UTC) changed the account's zone, 「この端末に合わせる」 takes it
  back. A take-back that fails says so on the row and can be tried
  again; it waits while another 設定 change is still being saved.

### Fixed

- Signing in as another account in a second tab no longer lets this tab
  write its zone into the wrong account, or remember the first account's
  zone as the new one's: the zone sync acts only on the signed-in
  account's own settings, and the server refuses a zone change meant for
  another account. A failed zone save no longer puts the first account's
  settings back over the next one's.
- A zone save that failed is not sent again and again while the app is
  open; the next account, or a device that moved to another zone, saves
  as usual.

## [0.14.0.0] - 2026-09-25

### Added

- The API can bring an archived activity back (`activities.unarchive`).
  It returns to the end of the grid, since a reorder may have given its
  old place to another activity, and it can be tapped again. Asking
  again for one that is already back leaves it where it is, so a retry
  is safe. No screen offers it yet; a 戻す control in 設定 comes next.

### Fixed

- Adding an activity from two devices at the same moment, or adding one
  while another comes back from the archive, now puts each in its own
  place in the grid. Before, both could reach for the same place and one
  of them failed.
- A reorder sent while another device archived or added an activity is
  now refused instead of partly applied, and the grid keeps the order it
  had. A reorder also takes the same short time however many activities
  the grid holds.
- Adding, reordering and bringing back activities now follow the same
  per-account queue and time limit as taps, so a stuck connection no
  longer leaves them waiting indefinitely. A burst of writes from one
  account is refused as busy, as taps already were.

## [0.13.0.0] - 2026-09-25

### Changed

- A detox left running measures at most the week after the day it
  started: the untapped days among the next seven count as measured and
  keep 連続記録, and from the eighth day on an untapped day is 計測なし
  again, so an app left on detox and forgotten stops counting. Switching
  to an activity and back starts a new week; cutting a detox in 訂正 does
  not. The stats work this out from your taps on every read, so past
  weeks and months that held a longer detox change too: their measured
  days, 1日あたり averages and a 連続記録 that ran through such a detox
  are counted again under the new rule.
- The line under 「ここで分割」 that says a cut makes the day 計測できた日
  now asks the server how it counts that day, so it follows the detox
  week and every other day rule instead of a copy of them in the app.
  It trusts the day's own rows first, so it never repeats the promise
  once the cut has landed, and it waits instead of guessing while the
  answer is loading, failed or held offline. A sheet left open over
  midnight asks again once the day is past.

## [0.12.0.0] - 2026-09-25

### Changed

- When an edit on the correction sheet gets no clear answer (no reply in
  30 seconds, a lost connection, or a server error), the sheet no longer
  says it was not saved. It says 「一覧を読み直しています…」 while it reads
  the day again, then asks you to check the list, because the edit may
  have landed. An older 元に戻す is turned off then, so it cannot undo the
  wrong state. A server that gave up before saving still says to try again.
- If reading the day again fails too, the sheet says the rows may be out of
  date, and it clears that as soon as a later read of the day succeeds (on
  returning to the tab, for example).
- The message after an edit is refused because the day or the record
  changed no longer blames another device. It now says the record changed
  and the latest state is shown, which is also true after a double tap or
  this device's own late edit.
- A refusal that can never succeed (the session ended, or a request the app
  should not have sent) turns 元に戻す off instead of leaving it armed.

### Fixed

- A day's message clears once a later read shows the day has moved on, for
  example after a tap on ホーム, instead of staying until the next press.
- 元に戻す turns off once any read of the day shows that pressing it could
  only be refused, even after another change was put back. That includes
  the edit's own re-read, which lands before 元に戻す is offered. It still
  survives a settings change made while its sheet is closed, and a time
  zone change that only moves its record out of the listed day.
- An answer the API itself did not write (a page for an unknown address,
  for example) no longer reads as "the record changed": the sheet says it
  was not saved and keeps 元に戻す.
- When the session ends during an edit, the sign-in screen brings you back
  to the same day's correction sheet, and signing in again (in another tab,
  too) clears the sign-in message.
- Screen readers announce the sheet's waiting and offline lines more
  reliably: the polite status region stays in place, empty and taking no
  room, instead of appearing together with its text.

## [0.11.0.0] - 2026-09-25

### Changed

- The server now gives up on a call after 25 seconds, before the app's
  30-second wait runs out, so a write the app stopped waiting for can no
  longer land later behind the next one. A write it gave up on answers
  whether nothing was saved, or whether it was cut off while saving and
  may have landed.
- One account's writes wait their turn inside the server instead of each
  holding a database connection while it waits. A burst of taps from a
  few accounts at once can no longer use up every connection and hold up
  everyone else. A write still waiting when its time runs out is refused
  as busy, and the writes behind it keep their order.
- A day's list and the stats are read from one consistent snapshot on a
  single connection, so a write landing in between can no longer split
  what one screen shows.

### Fixed

- A write stuck on a database connection that went dead (after a
  managed-database failover, for example) is cut off at the deadline. Its
  database session is ended, so the account's next tap is not held up
  behind it, and a lost connection is logged instead of crashing the
  server.
- The database itself now refuses a record that names another account's
  activity, not only the API's own checks.
- Editing an activity is bounded by the same deadline, so an edit that
  arrives late cannot overwrite the one sent after it.

### Developer experience

- The production image is built as `switch-time-api:prod`, so a local
  development build can no longer be run as production by mistake.
- The README explains how to let a laptop reach the production database
  for a one-off `psql` session, and how to close that access again.
- The new database migration takes its locks in a fixed order, waits at
  most 5 seconds for each, caps each statement at 10 seconds, and fails
  the deployment rather than holding every account's writes. The README
  gives the query that finds rows it would refuse, and how to undo it.

## [0.10.0.0] - 2026-09-25

### Added

- 記録 shows how much of a day went to detox. A day that mixed work and
  detox stacks its detox time as an outlined part on top of its
  activity colours, and a 計測なし day shows its detox part too.
- 状態別 ends with a detox row (total and 1日あたり over the measured
  days) whenever the range holds detox time.

### Changed

- A day that was mostly left idle, with some detox in it, now shows as
  an ordinary day with its detox part, instead of being claimed as a
  whole day of detox. A day counts as a detox day only when it has no
  activity time and at least as much detox as idle time.
- The dashed border of a 計測なし day is drawn in the secondary text
  tone, so it stands out from the card at the WCAG 3:1 contrast asked of
  a mark that carries meaning.

### Fixed

- A full 計測なし day's bar fits inside its dashed border, so its top is
  no longer cut off.

## [0.9.1.0] - 2026-09-25

### Changed

- Detox has one look everywhere: a solid outline in the secondary text
  tone, never filled. 記録 marks a detox day with that outline and a
  wind glyph in the middle; the 24-h bar, its legend and the correction
  sheet's bar and detox row use the same outline. A dashed border now
  means only that there is no data (a 計測なし day, or time left idle
  on the bar), so detox no longer looks like either.

### Fixed

- Secondary text in the light theme is darker, enough to read at the
  WCAG AA contrast ratio on every surface.
- An outlined span at either end of the 24-h bar or the correction
  sheet's bar keeps its rounded corner, so its outline is no longer cut
  open.
- A day worked on an activity this device has not loaded yet is no
  longer shown as a detox day on 記録.
- A device whose clock runs behind no longer draws a stray line on the
  correction sheet's bar for the record it just started.

## [0.9.0.0] - 2026-09-25

### Changed

- A day spent entirely in detox now counts. When detox stays on past
  midnight, the days it runs through keep 連続記録 going, count toward
  計測できた日 and the 1日あたり averages, and show on 記録 as detox
  days instead of 計測なし. An activity left running over a day with no
  switch still leaves that day out, as before. The 未使用日の扱い sheet
  says so.

### Fixed

- 「ここで分割」 on a detox carried in from an earlier day no longer says
  the cut makes an untapped day measured, since that day already counts.
- Stats read every switch at once, so an edit from another device that
  lands mid-read can no longer count the same record as both work and
  detox.
- Days and months outside 1970-01-01 to 9999-11-30 are refused instead
  of producing wrong day boundaries, and a day before the year 1000
  keeps a four-digit year.
- A time zone written as an offset such as `+09:00` is refused; the
  device's named zone is kept.
- Stats and the timeline build each time zone's clock once instead of
  once per switch, which makes long histories faster to read.

## [0.8.0.0] - 2026-09-25

### Added

- An edit or 「元に戻す」 refused after its correction sheet closed is
  still explained: reopening that day's sheet shows the refusal on the
  status line, and an undo refused because the activity was archived
  opens the record on its notice. Each day keeps its own line and
  notice, and signing out or another account signing in clears them.

### Fixed

- 「元に戻す」 turns off once the day no longer reads as the edit left
  it, for example after a tap on ホーム or a change from another device
  that the list has already shown, instead of staying on for a press
  that can only be refused. The undo of a pick on the carried-in record
  stays on after a zone change lists that record among the day's own
  rows, while no other write has reached it.
- A split or undo whose answer lands after the sheet moved to another
  day (today's sheet past midnight, or another day opened from 記録)
  no longer selects a row on the day now shown.
- Picking an activity or cutting on the record a kept notice opened
  keeps its panel open while the change is written, and a notice that
  lands while another row is selected shows once its record is tapped.

## [0.7.0.0] - 2026-09-25

### Added

- An edit that lands after its correction sheet closed still arms
  「元に戻す」, and reopening that day's sheet (from 記録 or 訂正) offers
  it. The undo now belongs to the day, not to the open sheet, so a second
  tap before the controls dim arms it too. An undo that lands after its
  sheet closed leaves nothing to undo when the day is reopened.

### Fixed

- Signing in, or signing up, clears the previous account's cached data
  and 「元に戻す」, as signing out already did: a session that expired or
  was revoked elsewhere reaches sign-in without signing out. An edit of
  the old session that lands later is ignored.
- When another tab signs in as someone else, this tab drops the previous
  account's cached rows and 「元に戻す」 as soon as it sees the new
  session. The API also refuses a 「元に戻す」 that was armed under
  another account, so a tab that has not caught up yet cannot write the
  previous account's day into the new one's.
- A 「元に戻す」 of a pick on the carried-in record, refused because
  another device changed that record, says so on the status line.

### Changed

- `switches.replaceDay` takes an optional `account`, the user the undo
  was armed under. The app always sends it; left out, it is not compared.

## [0.6.0.0] - 2026-09-25

### Added

- The correction sheet says why an edit or 「元に戻す」 did nothing, on a
  line between the rows and 元に戻す: for example 「これ以上動かせません」,
  「統合できる記録がありません」, 「ここでは分割できません」, or
  「別の端末で記録が変わったため、最新の状態を表示しました」 when another
  device changed the day. The line stays until the next press, selection
  or undo.
- While a write is still landing after 400 ms, the same line says
  「反映しています…」, and while the web page is offline it says
  「オフラインです。接続が戻ると反映されます」. A write that lands at once
  shows nothing, so the footer does not jump.

### Fixed

- A request that never answers no longer holds the correction sheet until
  the page is reloaded. Every call now gives up after 30 s, and the sheet
  says 「応答がありませんでした。反映されたか一覧で確かめてください」 and
  reads the day again. The edit may still have landed, so an older
  「元に戻す」 turns off after a timed-out edit, while a timed-out
  「元に戻す」 stays armed and is refused if replayed once the day changed.
- A refused 「元に戻す」 (another device changed the day, or its activity
  was archived meanwhile) now says why as it turns off, instead of only
  going grey.

### Changed

- The refusals the correction sheet can name now carry a reason in their
  error `data` (day changed, record changed, archived, no room, no record
  to merge into, next record on a later day, cannot split, busy), shared
  by the API and the app, so the app no longer guesses from the error's
  text. Input errors and a record that is gone carry none.

## [0.5.0.0] - 2026-09-25

### Fixed

- A phone and a laptop in different time zones no longer take turns
  rewriting the account's zone on every focus, which moved every day
  boundary back and forth. A device now writes its zone only when its own
  zone changed since it last synced, and never while signed out.
- 「前の記録に統合」 on the running record, and a day's 「元に戻す」, can no
  longer leave an archived activity as the one running now. The sheet
  disables the merge in that case, and the server refuses both.
- 「前の記録に統合」 on a day's first record is refused when another device
  has changed the record carried in from the day before, instead of handing
  time to a record the sheet never showed.
- A day with more than 300 switches can be corrected again. Its edits are
  still checked against the day, but it offers no 「元に戻す」.
- Two switches of one account can no longer start at the same instant, so
  the timeline and the day lists always read in the same order. A tap in the
  same millisecond as the running switch starts 1 ms after it.
- One account can no longer tie up the server with a burst of taps and
  corrections: at most 4 of its timeline writes wait at once, the rest are
  refused, and no request waits more than 10 s for a database connection.
- Fast taps on ホーム reach the server one at a time, in the order they were
  made, so the last activity picked is the one left running.
- The correction sheet waits for a pending settings write (a time-zone
  change) before it allows another edit.

### Changed

- A database migration moves switches of one account that started at the
  same instant 1 ms apart, in the order they were recorded, and makes the
  start of each switch unique per account. The moved instants are not kept.
  While it runs, taps and corrections wait for it to finish.

## [0.4.0.0] - 2026-09-25

### Fixed

- Two devices correcting the same timeline at once no longer corrupt it.
  Every tap, correction, undo, archive and time-zone change of one account
  now runs one after the other, and each reads the records it changes only
  once it is its turn. Before, merging neighbouring records from two devices
  could hand a span to the wrong activity for good, two undos of one day
  could write every record twice, and a tap could start an activity that was
  being archived at that moment.
- A correction made on a sheet whose list another device has since changed
  is refused instead of landing on records the sheet never showed, and the
  sheet then shows the other device's change.
- 「元に戻す」 is refused once the day changed after the edit (a switch or a
  correction from another device, a merge or cut on the next day's sheet
  that moved where the day's last record ends, or a different time zone), so
  it never erases a switch made elsewhere or silently undoes someone else's
  correction. It turns off instead.
- Changing the time zone refetches every day list, so the correction sheet
  never works on a day windowed in the old zone.

### Changed

- `switches.replaceDay` requires `timeZone` and `expected` (the rows the day
  must still hold), and every other correction accepts a `baseline` (the day,
  the zone and the rows the sheet listed). A web tab opened before this
  release loses 「元に戻す」 until it is reloaded.

## [0.3.0.0] - 2026-09-24

### Added

- The record that runs into a day from the day before (sleep past midnight,
  say) can now be corrected on that day's sheet. Its panel says when it
  really started, and 区切る時刻 picks a quarter hour to cut it at with
  「ここで分割」: the part after the cut becomes a new record of its own,
  selected so the next pick changes only that part. The lines under the
  button say how the cut changes the totals (idle time that comes back,
  a day that becomes 計測できた日).
- 活動を変える on that record changes the whole record, the earlier day
  included, and 「元に戻す」 puts the previous activity back. The panel
  warns before a pick away from an archived activity, since that pick
  cannot be undone.

### Fixed

- A pick on a record that reaches an earlier day, and its undo, never
  overwrite a change made on another device: a record that was changed,
  merged, split or moved elsewhere since the sheet listed it is refused and
  「元に戻す」 turns off, instead of rewriting time the sheet never saw.
- An undo refused because the previous activity was archived meanwhile
  says so on the row.

### Changed

- Local defaults are :4100 (API) and :4101 (Expo / Playwright) so they no
  longer collide with nsx on :4000. Production still listens on 8080.
- Dependencies are on their latest releases as of 2026-09-22, except
  TypeScript (still 6.0.3; 7.0.2 is a major) and the seven packages Expo SDK
  57 pins (`react` and `react-dom` 19.2.3, `react-native` 0.86.3,
  `react-native-safe-area-context` 5.7.0, `react-native-screens` 4.26.2,
  `react-native-svg` 15.15.4, `@types/react` 19.2.18): React Native 0.87.1
  breaks the web export, because `@expo/cli` 57 imports
  `react-native/rn-get-polyfills`, which 0.87 no longer exports. Moved: Expo
  SDK 57 patches (`expo` 57.0.24, `expo-router` 57.0.22), Better Auth 1.7.5,
  oRPC 1.15.2, Hono 4.13.8, Zod 4.6.5, TanStack Query 5.103.2, Vitest 5.0.1,
  ESLint 10.11.0, Prettier 3.9.8, Fallow 3.27.0 and `@types/node` 26.6.2, with
  transitive dependencies moved within their ranges.
- Node.js 26 is the runtime: `.node-version` says 26.10.0, `engines.node`
  `26.x`, and both Dockerfiles build on `node:26-slim`. That image no longer
  ships Corepack (dropped in Node 25), so they install it from npm before
  `corepack enable`; `packageManager` still picks the pnpm release.

### Developer experience

- `eslint-config-ts-prefixer` 5.1.0 brings `ts-prefixer/explicit-void-return-type`:
  a function whose return type is inferred as `void` or `Promise<void>` must
  spell it. `pnpm lint:fix` wrote the 37 annotations this needed.

## [0.2.1.0] - 2026-09-17

### Changed

- Local defaults are :4000 (API) and :4001 (Expo / Playwright) so they no
  longer collide with other projects on :8080 / :8081. Production still
  listens on 8080 inside the container. `E2E_API_PORT` / `E2E_APP_PORT` still
  move both.

### Fixed

- 「元に戻す」 restores a day that holds a record of an archived activity.
  Before, it failed without a message on such a day, so a record merged away
  there could not be brought back. Switching to an archived activity, or
  changing a record to one, is still refused.

### Known issues

- A record of an archived activity that was merged away can be brought back
  only with 「元に戻す」, while the 訂正 sheet that made the edit is still open.
  After that it cannot be rebuilt: 活動を変える offers live activities only,
  and an archived activity cannot be restored.

### Developer experience

- `switches.replaceDay` no longer shares the archived-activity guard with
  `switchTo` and `changeActivity`: it checks only that each row's activity
  belongs to the account, and sets the account on every row it writes after
  the client's fields. The README's correction notes say which write refuses
  what.
- API tests cover a replaced day that ends on an archived activity (it runs on
  as the current state, and a tap on it is refused), 「元に戻す」 on a day with
  an archived record, one activity on several rows, another account's activity
  alone or beside the user's own, 半分で分割 on an archived record, and the
  current state merged into the archived record before it.
- Playwright covers undo after 次の記録に統合 onto an archived record; the test
  archives the activity through the API.

## [0.2.0.0] - 2026-09-17

### Added

- **訂正: give a record's time to the record after it.** 「次の記録に統合」 sits
  next to 「前の記録に統合」: it removes the selected record and starts the next
  one where the removed one started, so a mis-tapped span folds forward as well
  as back. 「元に戻す」 brings the removed record back.
- 「次の記録に統合」 stays inside the day. The last record of a day cannot pull
  the next day's first switch back, even one at exactly 0:00, because
  「元に戻す」 only rewrites the day it was pressed on. The server refuses that
  merge as well, judging the day in the account's time zone, and the running
  state has no later record to merge into.
- Either merge is refused when another device has just merged the same record
  away, rather than succeeding as well and handing its span to a different
  record.

### Changed

- The 訂正 panel shows the two merge buttons side by side at equal width, with
  「半分で分割」 full width below them, on wide and phone-width screens alike.
- The design file (`design/switch-time.pen`) adjusts UI dimensions for
  responsiveness.

### Fixed

- 「元に戻す」 restores the day as it was when the edit's button was pressed.
  Before, if the day reloaded while the edit was saving, it could keep the
  reloaded rows instead, and undo then changed nothing.
- The 訂正 panel waits for every switch still being saved, including a tap on
  ホーム and an edit from a sheet closed before it finished, so no edit or undo
  starts from rows that are about to change.

### Known issues

- 「元に戻す」 fails without a message on a day that holds a record of an
  archived activity, so a record merged away on such a day cannot be brought
  back.
- Two devices merging neighbouring records at the same moment can both succeed
  and hand a span to the wrong activity.
- While a switch is being saved, or waits for the connection on the web, the
  訂正 panel dims with no explanation, and a request that never answers keeps
  it dimmed until the page reloads.

### Developer experience

- API tests cover `switches.mergeIntoNext`: the merge itself, a detox next
  record, another account's id, and both refusals (the running state, and a
  next record on a later day at 0:00 sharp and in a Los Angeles account).
  `canMergeNext` is unit-tested at the midnight boundary.
- An API test races two merges of one record against the real Postgres: it
  holds one merge's transaction open until the other waits on it.
- Playwright covers undo after a merge in either direction, after a merge and a
  15-minute move, after 活動を変える and after 半分で分割, the panel waiting for
  an edit from a closed sheet, a past day's last record that cannot merge into
  the next day, and the merge buttons' layout at 1024 px and 390 px.

## [0.1.0.0] - 2026-09-16

### Added

- **Detox: record time to no activity.** A full-width row under the switch
  buttons on ホーム starts a state with no activity (`switches.activity_id`
  null). It reports `aria-pressed` like the switch buttons, so exactly one
  control is pressed at any moment, and inverts to the `ink` fill while it runs.
- The digit `0` (no modifier) starts detox from the keyboard on web, next to the
  digits that pick activities by position.
- The hero names detox with no colour of its own: the dial's ring, hand and dot
  go to `sub`, the elapsed time dims, and the subtext reads
  「どの行動にも積み上がりません」.
- The 24-h bar draws detox spans dashed, like idle ones, and the wide legend
  names detox alongside the day's activities.
- 記録 outlines a measured day whose time all went to detox with a dashed `sub`
  cell and reads it out as `・detox`, so a day off the clock is not mistaken for
  an untapped one.
- The 訂正 sheet lists a detox row as `detox` with the wind glyph and no colour,
  keeps every correction on it (±15 min, merge, split, undo), and its
  活動を変える picker gained a detox pill, so a span moves onto detox and back.

### Changed

- `stats.*` reports `detoxMs` per day. Detox time is in neither the totals nor
  `idleMs`, so it never accumulates against an activity, and the day still
  counts as measured.
- `switches.activity_id` is nullable (`20260916012834_detox`). The change is
  forward-only in practice: once a detox row exists, an older bundle does not
  expect a null. `switchTo`, `changeActivity` and `replaceDay` accept an
  explicit null and share one archived-activity guard.
- `design-system/readme.md` no longer says there is no "nothing selected" state:
  exactly one switch is pressed, an activity button or the detox row.

### Developer experience

- `E2E_API_PORT` / `E2E_APP_PORT` move the Playwright ports when another project
  holds :8080 / :8081. Set them together or not at all; the config refuses one
  without the other.
- Compose bind-mounts `packages/shared/src` like `apps/api/src`, so a shared
  edit reaches the API container without a rebuild.
