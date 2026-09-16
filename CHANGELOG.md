# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
`major.minor.patch.micro`.

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
