# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
`major.minor.patch.micro`.

## [Unreleased]

### Changed

- Local defaults are :4000 (API) and :4001 (Expo / Playwright) so they no
  longer collide with other projects on :8080 / :8081. Production still
  listens on 8080 inside the container. `E2E_API_PORT` / `E2E_APP_PORT` still
  move both.

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
