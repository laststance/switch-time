# Switch Time design system

Switch Time is a clock that always holds exactly one state — 家事 / 仕事 / 休息 / 睡眠 / 食事 / 娯楽 — and the user switches it as their day changes. Everything else is subordinate to that: a large tabular-nums readout on a soft dark ground, one row of activity buttons where exactly one is lit in its own color, and a quiet timeline underneath. Warm off-white (`#F5F2EB`) by day, near-black (`#111216`) by night; cards are soft-cornered filled surfaces with a hairline border, never outlines-only. The only saturated color on screen is the currently active activity.

## How to use this

- Link the one stylesheet from every page — `<link rel="stylesheet" href="styles.css">` (adjust the relative path) — and take every color, font, spacing and radius from its variables (`var(--color-*)`, `var(--font-*)`, `var(--space-*)`, `var(--radius-*)`, `var(--text-*)`). Never hard-code a hex or a px value the tokens already carry.
- Dark is the default band. Light is `[data-theme="light"]` on the root element. `auto` resolves to light between 06:00 and 18:00.
- **Web builds must set `[data-surface="web"]`** on the root — see *Web constraints* below.
- The whole system was derived from `theme.json`. To change the look, edit the tokens at the top of `styles.css` and keep `theme.json` in step so they don't drift.

## Surfaces

iOS, Android, macOS menubar and Web ship first. Windows, Linux and Apple Watch do not. The app must be reachable *while an activity is happening*, which is why the menubar and the widgets exist at all.

| Surface | Canvas | Notes |
| --- | --- | --- |
| iOS / Android | 402×874 | Home, history, settings, correction sheet, widgets |
| macOS menubar | 420×600 | Panel under the tray icon. ⌘1–6 switch activities |
| Web | 1024×860 | Nav rail ≥800px, bottom tab bar below |

## The activity palette is data, not styling

```
#E0A431  #3B7BD9  #4FA877  #6C63D6  #E0684A  #D8579C  #2BA3B5  #8A6A4B
```

These eight are assigned by the user to their activities and **persisted in the backend** (`activities.color`). They are not theme colors and they do not adapt per surface. **They must be byte-identical on every platform** — if the Web build invents a different green, the same activity shows a different color on the user's phone and laptop. Defaults: 家事 `#E0A431`, 仕事 `#3B7BD9`, 休息 `#4FA877`, 睡眠 `#6C63D6`, 食事 `#E0684A`, 娯楽 `#D8579C`. The last two are spares for user-added activities.

Never use an activity color as interface chrome. Chrome comes from `--color-accent`.

## Persisted fields the design implies

- `color` — from the palette above, cycled by the user.
- `target` — the daily goal in hours (仕事 8, 睡眠 7, 休息 2, others 1.5). Surfaced as 「1日の目安」 in the menubar and settings.
- **order** — the position in the activity list. The menubar derives its `⌘1`–`⌘6` shortcuts from the array index, so the order is user-visible and must be stored. The shortcut label itself is *not* stored, and is macOS-only — do not leak it into shared component props.

## Color

Two bands, paired. `--color-bg` is the page, `--color-face` the clock dial, `--color-surface` cards and unselected buttons, `--color-sheet-bg` modals. Text is `--color-ink` with `--color-sub` for secondary. `--color-line` draws hairlines, `--color-chip` fills small pills. `--color-accent` (#2A66C4 light / #7FB2FF dark) is links and emphasis — the *only* chrome accent.

## Type

**Mona Sans** — GitHub's own grotesque, OFL-1.1 — for latin and numerals; Japanese falls through to the system face (Hiragino Sans on Apple surfaces, Noto Sans JP elsewhere). One stack for both heading and body (`--font-heading` / `--font-body` resolve identically), so hierarchy comes from weight and size only, never from a second typeface. Scale: 10 / 12 / 14 / 16 / 18 / 20 / 28px.

On iOS/Android, React Native's `fontFamily` takes a single family, not a stack: ship `fontFamily: 'Mona Sans'` via `expo-font` and let the OS handle per-glyph Japanese fallback.

**Every clock and elapsed-time readout takes `.tabular`** (`font-variant-numeric: tabular-nums`). Without it the digits jitter every second, which on a screen whose whole purpose is a running clock reads as a bug.

## Radius

Three tiers, roughly 1.6x apart, so radius reads as hierarchy: controls 10, containers 16, sheets 28 (top corners only), pills 9999 for status only — never a button. Use `--radius-chip` / `--radius-card` / `--radius-sheet` / `--radius-pill`. Do not flatten them back to one generous value.

## The active state

Exactly one activity button is pressed at any moment. The pressed button fills with the activity's own persisted color, flips its label to `#fff`, and matches its border. That is all — **no glow.** A drop shadow tinted with an accent colour is the single loudest "AI mockup" tell; the fill already carries the state. Unpressed buttons stay `--color-surface` with a `--color-line` border. Pass the color in as `--activity` on the element; the stylesheet does the rest.

## Web constraints (react-native-web)

The Web build is the web target of a single Expo / React Native codebase — the Bluesky approach. It renders through `View` / `Text` / `Pressable` and flexbox only. **These do not survive and must not appear in any design intended for Web:**

`display: grid` · `grid-template-*` · `position: sticky` · `backdrop-filter` · `filter` · `linear-gradient` / `repeating-linear-gradient` · `::before` / `::after` · multiple `box-shadow` values

Two tokens therefore have web-specific values, applied by `[data-surface="web"]`:

| Token | iOS / Android / macOS | Web |
| --- | --- | --- |
| `--color-tab-bg` | translucent `rgba(…,0.90)` | opaque, same value as `--color-bg` |
| `--pattern-hatch` | diagonal stripe gradient | `none` — `.is-excluded` becomes a `1.5px dashed` border with a `--color-chip` fill |

Every other token is shared unchanged.

`display: grid` **is** used in the macOS menubar design (the 3×2 switch cards and the editor rows) and that is deliberate — that surface is native macOS. If the menubar is ever rebuilt in Electron or React Native, those two rules are the porting cost.

## Do

- Keep exactly one activity active, always. There is no "nothing selected" state.
- Put `.tabular` on every digit that changes on a timer.
- Let the active activity's own color be the loudest thing on screen.
- Design the longest-word language too — German or Finnish runs 2–3× the length of Japanese, and the menubar's fixed 3×2 grid breaks first.

## Don't

- Do not use an activity color for buttons, links or chrome.
- Do not hard-code a hex that a token already carries — that is exactly how the phone and web builds drifted apart before this system existed.
- Do not use the banned CSS above on anything that ships to Web.
- Do not store the `⌘n` label; derive it from the activity's index.

## Files

- `styles.css` — the only stylesheet: tokens (`:root`, the light override, the web override) plus the component layer. Link it from every page.
- `readme.md` — this guide.
- `theme.json` — the parameters these files were derived from, plus the activity palette and default activities as machine-readable records.
- `foundations/color.html` — the two bands side by side and the activity palette, with the data-not-styling rule spelled out.
- `foundations/type.html` — the scale at real sizes and the tabular-nums demonstration.
- `components/switch-buttons.html` — the core interaction: six buttons, one active, in both bands.
