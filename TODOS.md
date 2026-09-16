# TODOS

## Home

### Start detox from the first-launch screen

**What:** Offer detox as a starting state on `FirstLaunch`, next to the activity buttons.

**Why:** A new account cannot begin on detox. `DetoxRow` and the `0` hotkey live in `HomeBody`, which only mounts once `switches.current` is non-null, so the first tap has to be a real activity. That records a span the user did not want and then has to correct.

**Context:** Deliberate in the approved plan: first launch asks 「いま何をしていますか？」 and picking an activity is the onboarding. The API already supports it (`domain.test.ts`, "the very first tap can be detox"), so this is a UI-only change plus an e2e that signs up and presses detox without touching an activity. Raised by the Codex adversarial pass during the 0.1.0.0 ship.

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

## Design

### Check the 24-h bar's detox legend swatch at 1x

**What:** Look at the wide legend's detox marker in both themes and decide whether an 8 px square with a 1 px dashed `line` border is legible.

**Why:** At that size a dashed border yields one or two dashes per side, and in dark `line` is a low-alpha white, so the marker may read as an empty square rather than "dashed like the span".

**Context:** `today-flow.tsx` renders it as `cn('h-2 w-2 rounded-[2px]', look.className)`. If it is illegible, either grow the detox swatch a little or give the legend square `border-sub`, which matches the History detox cell's tone. Raised by the design pass during the 0.1.0.0 ship; deferred because it needs eyes on a screen, not a code read.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed
