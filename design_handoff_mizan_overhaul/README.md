# Handoff: Mizan UI overhaul

## Overview

A full UI overhaul of Mizan (the deterministic household finance app in this repo). The engine is unchanged — every domain module, Firestore repository, parser and rule stays exactly as it is. What changes is the surface, for one reason: **the current UI shows everything at once, so nobody knows what to do, and there is no reward for the weekly ritual.** The overhaul reorganises the same data into four views, promotes the weekly check-in into a real ritual with a payoff, makes measurement uncertainty visible instead of hidden, and adds the one screen the product is missing — the one that actually causes a second statement import.

**Do not port the domain layer.** `src/domain/**`, `src/import/**`, `src/household/**`, `src/storage/**`, `firestore.rules` are untouched by this work except where explicitly listed in §Data model additions.

---

## About the design files

`Mizan Overhaul.dc.html` in this bundle is a **design reference written in HTML** — a prototype showing intended look, copy and behaviour. It is not production code and should not be copied into the app. It is a single-file streaming document; open it in a browser (keep `support.js` next to it) and pan/zoom around it.

The task is to **recreate these designs inside this repo's existing environment**: React 19 + TypeScript + Vite, plain CSS files under `src/styles/`, `lucide-react` icons, the primitives in `src/ui/bits.tsx`. Use those patterns. Do not introduce a CSS-in-JS library, a component kit, or Tailwind — the prototype uses inline styles only because of how the prototype tool works, not as a recommendation.

The prototype contains **two turns**, newest first:

| id | Screen | Status |
|----|--------|--------|
| `2a` | **Balance** — the new Home | **Build this one.** Supersedes `1b`. |
| `2b` | **Catch up** — statement pipeline | Build. New screen. |
| `2c` | Sunday notification; Sort hard case 1 (transfer); Sort hard case 2 (split) | Build. |
| `1c` | Mobile: Balance, Sort, Decide, Receipt, The Books | Build. Mobile layouts for all views. |
| `1d` | **Sort** — desktop triage | Build. |
| `1b` | Balance, first pass | **Superseded by `2a`** — reference only, for the ritual card and settle-up card markup. |
| `1a` | The **current** Home, rebuilt | Reference only. Do not build. It exists so the before/after is honest. |

## Fidelity

**High fidelity.** Colours, type, spacing, radii and copy in the prototype are final and are reproduced exactly in this README. Recreate them pixel-accurately using this repo's CSS-file approach. Where the prototype and this README disagree, **this README wins**.

Two deliberate exceptions where the prototype is only indicative:
- Phone frames are drawn as 390×844 rectangles. Real layouts are fluid; the frames only fix the breakpoint.
- Content in the prototype is fictional sample data for a two-member LKR household (Munsif + Sara). All figures must come from `MonthSummary` / `AppData`.

---

## The measurement contract (read this before anything else)

This is the spine of the overhaul and the thing most likely to be lost in implementation.

> **Mizan never draws a number it has not measured, and never fills an unknown with an estimate.**

The app already knows when it is uncertain — `computeAccountCoverage()` in `src/domain/accountCoverage.ts` returns a row per active account with `status: "current" | "stale" | "missing"`, and `dataIsBehind(coverageRows, summary)` collapses that to a boolean. Today that knowledge is spent on an attention card and a 13px grey sentence. In the overhaul it becomes a **visual property of every figure**:

1. **The confidence chip** (top of Balance, next to the month pill) has three states, derived from `computeAccountCoverage()`:
   - all rows `current` → `Fully measured` — `--ql-brand-soft` / `--ql-brand`
   - some rows `stale`/`missing` → `Partly measured · N of M accounts` — `--ql-danger-surface` / `--ql-danger`, 7px dot with the `mzPulse` animation
   - no transactions this month → `Not yet measured` — `--ql-subtle` / `--ql-muted`
2. **The accounted-for bar** renders unread spending as a **hollow segment**: `background: transparent; border: var(--ql-unmeasured-stroke)`. Never a fill, never a gradient, never a shaded "estimate".
3. **Copy states the boundary and the exposure**: "every rupee above traces to a statement line dated on or before **24 July**… up to **LKR 38,000** of spending may still be missing."

The hollow segment's width is the only figure in the app that is an upper bound rather than a measurement, so it must be computed conservatively and labelled as a bound. Recommended derivation (add to `src/domain/accountCoverage.ts`):

```ts
export function unmeasuredExposure(
  rows: AccountCoverageRow[],
  history: MonthSummary[],   // completed months, already available to HistoryView
  today: Date,
): { amount: number; throughDate: string; accounts: AccountCoverageRow[] }
```

For each non-current account, take that account's median recorded spend per day over the last three completed months, multiply by the days between `row.throughDate` and today, and sum. Round **up** to the nearest 1,000 of household currency. If any account is `missing` (never confirmed), the result is a bound with no basis — return the amount but flag it, and the UI says "at least" instead of "up to". `saveRate` and every other figure stay exactly as `summary.ts` computes them; the exposure is presentational only and **must never enter the ledger, the projection, or settlement**.

---

## Information architecture

Today `View = "home" | "transactions" | "history"` (`src/app/useHouseholdSession.ts`), with Settings and Import as modals, and Home carrying eleven stacked sections.

New:

| View | Route id | Replaces | Purpose |
|------|----------|----------|---------|
| **Balance** | `balance` | `home` | One verdict, one instrument, one action, the ritual, settle-up. Nothing else. |
| **Sort** | `sort` | the review queue inside `TransactionsView` | Full-screen one-at-a-time triage. Owns the nav badge. |
| **Ledger** | `ledger` | `transactions` | The table, filters, and row editing. Unchanged in substance. |
| **Trend** | `trend` | `history` | Unchanged in substance. |
| **The Books** | pushed from Balance | the eight lower sections of `HomeView` | Purpose matrix, funding reconciliation, member statements, commitments, coverage, assets, efficiency. **Every one of them survives verbatim.** |
| **Catch up** | pushed from Balance / step 1 of the close | `ImportModal` | Statement cadence, drop zone, forward-to address. |

Add `"balance" | "sort" | "ledger" | "trend"` to the `View` union and migrate the persisted value (`localConvenience.ts`) with a map `{home: "balance", transactions: "ledger", history: "trend"}`.

**Navigation chrome.** The `.topbar` with centred nav is replaced by a **left rail**, `--ql-rail-width: 88px`, `background: var(--ql-ink-surface)`, full height, `position: sticky; top: 0`. Contents top to bottom: 44×44 `--ql-radius-panel` brand tile with an italic serif "M" (`--ql-font-display`, 26px, `--ql-brand` background), 22px gap, then four items. Each item: `display:grid; justify-items:center; gap:5px; padding:11px 4px; border-radius:12px`, 21px lucide icon at `strokeWidth={1.7}`, 11px/600 label. Active item `background: rgba(244,239,230,.1); color: var(--ql-on-ink-strong)`; inactive `color: #8e9690`. Badge on Sort: absolute `top:6px; right:10px`, min 20px, `--ql-radius-pill`, `--ql-danger` background, white 11px/700.

Icons (all `lucide-react`, already a dependency): Balance = `Scale`; Sort = `Layers` (or `Inbox`); Ledger = `List`; Trend = `TrendingUp`. **The prototype hand-draws these as inline SVG — use the lucide components, not the prototype's paths.**

Below 720px the rail becomes a bottom tab bar: `background: var(--ql-surface)`, `border-top: 1px solid var(--ql-border)`, `padding: 10px 12px 22px` (the trailing 22px is `env(safe-area-inset-bottom)`), four equal columns, same icons at 21px, 11px labels, active `--ql-brand`.

**Month + household controls** move to a slim row inside the view: a month pill (`padding:7px 14px; border-radius:var(--ql-radius-pill); background:var(--ql-surface); border:1px solid var(--ql-border); font-size:14px; font-weight:600` + 14px `ChevronDown`) opening the existing `MonthNavigator` popover, then the confidence chip. Right side: member avatar stack (30px circles, `member.color` background, white 12px/700 initial, 2px `--ql-canvas` border, `margin-left:-8px` overlap), then 36×36 `--ql-radius-control` icon buttons for privacy and settings. The sync chip is absorbed into the confidence chip's row — keep `syncChipLabel()` as its title/tooltip.

**`PageHeader` is retired on Balance, Sort and Catch up.** Those screens lead with their own display headline. Keep `PageHeader` on Ledger and Trend.

---

## Screen: Balance (`2a`) — the new Home

Replaces `HomeView.tsx`'s `HomeOverview`. Everything it renders comes from `useHomeViewModel()`, which stays as-is; only the JSX below it changes.

**Layout.** Rail (88px) + content column. Content padding `26px 44px 40px`. Then, in order:

1. Control row (month pill · confidence chip · avatars · icon buttons), `padding-bottom:24px`.
2. Two-column grid `minmax(0,1.02fr) minmax(0,.98fr)`, `gap:44px`, `align-items:start` — left is the verdict + bar, right is the instrument.
3. Action row, two columns `minmax(0,1.15fr) minmax(0,.85fr)`, `gap:20px`, `margin-top:26px`.

Below 960px both grids collapse to one column; the instrument sits above the bar on mobile.

### The verdict headline

`.mz-display-xl` (60px Instrument Serif, line-height 1.03, letter-spacing -.01em), `text-wrap: pretty`.

```
You've saved LKR 178,400 of the LKR 223,000 you promised each other.
```

- Saved amount in `--ql-brand`; promised amount in `--ql-danger`.
- `saved` = `summary.projectedSaved`; `promised` = `summary.incomeTotal * summary.targetSaveRate / 100`.
- Both wrapped in the existing `<MoneyValue formatted={money(x)} hidden={financialValuesHidden} />` — **privacy mode must keep working on every new figure, including the instrument pans and the bar segments.**
- Solo household: "you promised yourself". One member ⇒ `solo === true` in the view model; the copy switch is the same one already used in `HomeHeroSummary`.
- No income configured (`!s.incomeItems.length`): keep the existing early-return onboarding panel, restyled — headline "Start with your income", one primary button to `onOpenSettings({tab:"household", section:"income"})`.
- No activity (`!hasActivity`): headline becomes "July hasn't been measured yet." and the whole bar renders hollow.

Sub-paragraph, `.mz-body-l`, `--ql-muted`, `max-width:520px`:

```
Measured, not projected — every rupee above traces to a statement line dated on
or before {latestTransactionDate}. {ownerName}'s {accountLabel} hasn't been read
since the {n}th, so up to {money(exposure)} of spending may still be missing.
```

Second sentence renders only when `dataIsBehind()` is true.

### The accounted-for bar

Card: `padding:22px; border-radius:var(--ql-radius-panel); background:var(--ql-surface); border:1px solid var(--ql-border); box-shadow:var(--ql-shadow-card)`.

Eyebrow (`.mz-eyebrow`): `LKR 892,000 income, accounted for`.

Bar: `display:flex; height:62px; gap:3px; font-variant-numeric:tabular-nums`. Four segments, each `border-radius:8px`, widths as a percentage of `summary.incomeTotal`:

| Segment | Value | Fill | Label |
|---|---|---|---|
| Spent | `summary.attribution.recordedSpend` | `--ql-brand`, text `#f1f5f1` | `Spent` / figure |
| **Unmeasured** | `unmeasuredExposure().amount` | `transparent` + `var(--ql-unmeasured-stroke)` | none — too narrow for text |
| Left in plan | `max(0, targetSpend − totalSpend) − exposure` | `--ql-plan-hatch`, text `--ql-muted` | `Left in plan` / figure |
| Saved | `summary.projectedSaved` | `--ql-beam` `#c9a227`, text `#2a2208` | `Saved` / figure |

Inside a segment: `display:grid; align-content:center; gap:2px; padding:0 12px`; label 11px/600 at 75% opacity, figure 16px/600. Segments narrower than ~9% render unlabelled. If the four values do not sum to income (they will not when the plan is overspent), the **Left in plan** segment absorbs the difference and clamps at 0; never let a segment go negative — flip to a single full-width `--ql-danger` segment reading "Over the plan by X" instead.

Legend below: 20×11px dashed swatch + `.mz-caption`:

```
The empty box is spending Mizan believes exists but has not read. It is drawn
hollow on purpose — it is never filled in with an estimate.
```

### The balance instrument

The signature element. Card: `padding:26px 26px 22px; border-radius:var(--ql-radius-panel); background:var(--ql-ink-surface); color:var(--ql-on-ink); box-shadow:0 16px 40px rgba(16,32,26,.16)`.

Header row: `.mz-eyebrow` in `--ql-on-ink-muted` reading `Mīzān · the balance` (note the macron), right-aligned caption `level at {targetSaveRate}%`.

**It weighs what you actually saved against what you promised — not spending against income.** A spending-vs-income scale always tilts hard and says nothing. This one is level exactly when the target is met, which is the only balance the product cares about.

Geometry — a 206px-tall `position:relative` box:

| Part | Style |
|---|---|
| post | `position:absolute; left:50%; top:66px; width:3px; height:72px; background:var(--ql-beam-post); transform:translateX(-50%)` |
| base | `position:absolute; left:50%; top:136px; width:132px; height:7px; border-radius:4px; background:var(--ql-beam-post); transform:translateX(-50%)` |
| fulcrum | `position:absolute; left:50%; top:56px; border-left:9px solid transparent; border-right:9px solid transparent; border-bottom:14px solid var(--ql-beam); transform:translateX(-50%)` |
| beam | `position:absolute; left:50%; top:62px; width:250px; height:6px; border-radius:4px; background:var(--ql-beam); transform:translateX(-50%) rotate({tilt})` |
| end caps | 13px circles, `--ql-beam`, at each beam end, `translate(∓50%,-50%)` |
| hangers | 1px × 34px `#5c6660` lines dropping from each beam end |
| pans | at each beam end, `top:40px`, `transform:translateX(∓50%) rotate({−tilt})` so they stay upright; `width:120px; padding:12px 8px; border-radius:10px` |

Left pan: `background:var(--ql-ink-surface-2); border:1px solid #2e3c34`; label `Actually saved` 11px/700 uppercase in `--ql-brand-tint`; figure `.mz-figure` in `--ql-on-ink-strong`.
Right pan: `background:#2b211a; border:1px solid #4a3527`; label `You promised` in `#e0a07a`; same figure treatment.

**Tilt.** `tilt = clamp(-7deg, (promised − saved) / promised * 20deg, 7deg)`, positive = right pan down = behind target. `transition: transform 700ms cubic-bezier(.22,1,.36,1)` on the beam and both pans, and **skip the transition under `prefers-reduced-motion`** (base.css already has the global reduce block — make sure these transitions are inside its reach). Animate from 0 on mount so it visibly settles. Never exceed ±7°: past that the pans collide with the card edge, and the sizes above are the ones that fit — `beamWidth/2 + panWidth/2 ≤ containerWidth/2 − 26px`. If you change either width, re-check that inequality.

Caption under it (`.mz-body`, `#b7beb8`):

```
The beam is off by LKR 44,600 — a fifth of the way tipped. It sat level in April and May.
```

The "sat level in" clause lists up to two of the most recent completed months where `saveRate >= targetSaveRate`, from the same `history` rows `HistoryView` already receives. Omit the clause when there are none.

Footer: four month labels with 3px bars, coloured `--ql-brand-tint` when the month met target, `--ql-beam` within 5 points, `--ql-danger` below. Separated by `border-top: 1px solid var(--ql-ink-line)`.

Mobile: the instrument keeps its geometry but the container drops to 168px and the beam to 190px / pans to 104px.

### Action row, left — "Make it measured"

This is **`rankHomeActions()[0]` and nothing else.** `src/ui/homeActions.ts` already ranks all fourteen families by `HOME_ACTION_PRIORITY`; the UI simply stops rendering the rest here. Items 2..n move to The Books, under a heading "Also waiting", in the existing compact `.attention-card` list.

Card: `padding:24px 26px; border-radius:var(--ql-radius-panel); background:var(--ql-surface); border:1px solid var(--ql-border); border-left:5px solid var(--ql-danger)`.

- Eyebrow `.mz-eyebrow` in `--ql-danger`, plus a `2 min` pill (`padding:3px 9px; border-radius:var(--ql-radius-pill); background:var(--ql-danger-surface); color:var(--ql-danger); font-size:12px; font-weight:700`). **Add an `estimateMinutes` field to `HomeAction`** — a constant per family is fine (coverage 2, classification `ceil(count/8)`, income confirmation 1, weekly check-in 4, settlement 1).
- Headline `.mz-display-m`.
- Body `.mz-body` `--ql-muted`. Rewrite every `HomeAction.body` string in the warmer register — see §Copy rewrites.
- Primary `Button` from `bits.tsx` (`variant="primary"`, restyled to `--ql-radius-control`, `min-height:46px`, `padding:0 20px`) plus one secondary. The coverage action's secondary is **"Remind me on the 3rd"**, which schedules the notification in §Notifications.
- The left border colour follows the action's tone: `--ql-danger` for anything blocking measurement, `--ql-brand` otherwise.
- When `rankHomeActions()` is empty, render the calm variant: `border-left-color: var(--ql-brand)`, headline "Nothing is waiting.", body naming what was checked, no buttons.

### Action row, right — settle-up

Card: `padding:24px 26px; border-radius:var(--ql-radius-panel); background:var(--ql-subtle); border:1px solid var(--ql-border)`.

Statement in `.mz-display-s`, e.g. `Sara owes Munsif LKR 48,600.` — built from `summary.transfers[0]` (`{fromName, toName, amount}`). Two or more transfers: show the largest and "+N more" linking to The Books. Zero: "You two are square." with no buttons.

Sub-line `.mz-body-s`: `Unchanged for 6 days. Settling writes a transfer to the ledger — it does not alter either month.`

**"Mark settled" is a new action** — see §Data model additions. It must create a real ledger record, never mutate a closed month.

Hidden entirely when `solo === true`.

---

## Screen: Catch up (`2b`)

New view, pushed from Balance and used as step 1 of the weekly close. It is the highest-leverage screen in the overhaul: it exists to produce the **second** statement import.

**Header.** Eyebrow `Catch up · step 1 of the weekly close`, `.mz-display-l` headline `Three of your four accounts are read through July.`, `.mz-body` sub. Right-aligned progress: one 44×8px `--ql-radius-pill` chip per active account, filled `--ql-brand` when `status === "current"`, otherwise `border: var(--ql-unmeasured-stroke)` and hollow — the same measurement language as the bar. Caption `one hollow box left to close`.

**Body.** Two columns `minmax(0,1.42fr) minmax(0,1fr)`, `gap:20px`.

*Left — the account list.* One row per `AccountCoverageRow`, ordered non-current first. Row: `display:grid; grid-template-columns:44px minmax(0,1fr) auto; gap:16px; align-items:center; padding:18px 22px; border-radius:14px; background:var(--ql-surface); border:1px solid var(--ql-border)`. The 44px cell is the owner avatar in `member.color`.

- **Behind** (`stale`/`missing`): `border-color: var(--ql-danger-border); border-left:5px solid var(--ql-danger); box-shadow: var(--ql-shadow-card); padding:20px 22px`. Sub-line in `--ql-danger`: `Read to 12 July · statement usually arrives the 3rd · password remembered`. Actions: primary `Add it` (opens the existing `ImportModal` pre-scoped to that account) and secondary `Nothing new` (calls `confirmImportedAccountCoverage()` with today's date and no transactions — the mechanism already exists in `AccountCoverageConfirm.tsx`).
- **Current**: sub-line `Read to 31 July · added 2 days ago · 214 rows`, and a status pill (`padding:7px 13px; border-radius:var(--ql-radius-pill); background:var(--ql-brand-soft); color:var(--ql-brand); font-size:13px/700`) with a `Check` icon.

Drop zone below: `padding:30px; border-radius:14px; border:1.5px dashed #c9bfac; background:rgba(255,255,255,.5)`, centred `Upload` icon, `Drop any statement here`, and the reassurance line about on-device decryption. It accepts everything `src/import/registry.ts` handles and routes to the existing modals.

*Right — two cards.*

1. **Forward-to-Mizan** on `--ql-ink-surface`: `.mz-display-s` "Forward the bank's email. That's the whole import.", a monospace address chip in `--ql-beam` on `rgba(244,239,230,.08)` with a Copy button, and an explanatory line. **See §Open decision — this feature has a privacy consequence and must not be built without an explicit product decision.**
2. **"When this one lands"** — four bullets predicting the consequence of the missing import: the hollow segment closes; ~N new merchants to name; duplicates dropped against the existing N rows; and, in `--ql-danger`, *don't settle until this is in* when `summary.transfers.length > 0`.

That fourth bullet is the retention mechanism in one sentence: it tells the user what they get, before they do the work.

---

## Screen: Sort (`1d` desktop, `1c`/`2c` mobile)

Replaces the review-queue block inside `TransactionsView.tsx`. Same data (`derived.queue`, `categorizeMerchant`, `categorizeMerchants`, `rememberTransactionMerchant`), presented one merchant at a time.

**Header.** Eyebrow `Step 2 of the weekly close`, `.mz-display-l` `Eight merchants left to teach.`, sub `Each one you name now is named forever — and backfills your history.` Right: `.mz-display-l` progress `15 / 23` (denominator in `#c6bfb0`), a 220×7px `--ql-radius-pill` progress track filled `--ql-brand`, and a time estimate at ~4s per item.

**Body** two columns `minmax(0,1.55fr) minmax(0,1fr)`, `gap:20px`.

*The card* (`padding:28px; border-radius:var(--ql-radius-panel); background:var(--ql-surface); border:1px solid var(--ql-border); box-shadow:var(--ql-shadow-raised)`):
- Eyebrow `New merchant · 8 of 23`; merchant name in `.mz-display-l` (38px); context line `4 charges since 2 July · Munsif's Amex Gold · biggest LKR 7,240`; total right-aligned in 34px display type.
- **What for** — the categories as 46px-tall chips with a keycap badge (19×19, `border-radius:5px`, 11px). Selected chip `background:var(--ql-brand); color:#fff`; unselected `border:1px solid var(--ql-border-strong); background:var(--ql-surface)`. Last chip is dashed: `Something else`.
- **Who for** — `Both of us` / one chip per member with a `member.color` dot. Hidden entirely when `solo`.
- **Rule confirmation** on `--ql-brand-soft`: *"Make it a rule. Future KEELLS SUPER charges land in Groceries · Both — and the 11 older ones in your history get corrected too."* The backfill count comes from matching the existing ledger with `src/domain/matching.ts`. This sentence is the reward; do not shorten it.
- Buttons: `Sort it` (primary, ↵) and `Skip` (→), with `Undo last · ⌘Z` right-aligned, wired to `undoLastLedgerChange()`.

**Keyboard is the point on desktop.** `1`–`6` pick a category, `B`/`M`/`S` (first letter of each member, de-duplicated with a digit suffix on collision) pick who, `Enter` commits, `→` skips, `⌘Z`/`Ctrl+Z` undoes. Show the keycaps. Every control also has a 44px+ touch target for mobile.

*Right column*: the individual charges (date · card · amount, tabular-nums); a `--ql-subtle` card explaining *these are already in your spend total — sorting moves them out of "unassigned"*; and a `--ql-ink-surface` card listing what was sorted this session as pills, ending with *"Fifteen rules taught. Next month these sort themselves and this list starts near empty."*

### Hard case 1 — internal transfer (`2c`)

Rows from `derived.transferCandidates` must be asked about **before** merchant naming, because misclassifying a card payment inflates the month. Card shows an info pill `Looks like your own money moving`, then the two legs stacked (each `padding:14px; border-radius:12px; background:var(--ql-sunken); border:1px solid #ede7db`, amount in `--ql-danger` / `--ql-brand`), a down arrow between them, and the plain-language stake: *"Same amount, one day apart, both your accounts. If this is a card payment it is not spending — counting it would inflate July by LKR 75,000."* Buttons `Yes — one transfer` → `confirmTransfer(debitId, creditId)`, `No — two separate things` → `rejectTransfer(...)`. Both persist, per the existing behaviour.

### Hard case 2 — split (`2c`)

When a merchant has a prior `Split` on ≥2 transactions, offer the remembered **ratio**. Two labelled rows, each with a proportional bar in the category colour, then `Adds up to · LKR 34,600 · exact`. Buttons `Split it that way` → `saveSplit(id, split)`, `Adjust` → existing `SplitModal`, `All groceries` → plain categorise. Footer: *"A remembered ratio, never a remembered amount — the split always totals the real charge to the cent."* Rounding goes to the largest share so the parts always reconcile exactly.

---

## The weekly close (the ritual)

Four steps, resumable, with a receipt. Entered from the ritual card on Balance or the Sunday notification.

| Step | Screen | Done when |
|---|---|---|
| 1 Catch up | Catch up view | every `AccountCoverageRow.status === "current"`, or the user marked the rest "nothing new" |
| 2 Sort | Sort view | `queue.length === 0`, or the user chose to stop |
| 3 Read | What changed — `summary.movementRows` as at most three sentences, not a table | viewed |
| 4 Decide | `efficiency.topOpportunities[0]` full-bleed, the rest dimmed below | a plan saved via `saveEfficiencyDecision()`, or "Nothing this week, thanks" |

**Ritual card on Balance** (see `1b` for markup): `--ql-ink-surface`, eyebrow `The weekly close`, a streak pill in `rgba(201,162,39,.16)`/`#e4c351` reading `6 weeks in a row`, `.mz-display-m` `Close week 30`, then the four steps as `22px minmax(0,1fr) auto` rows — done steps get a `--ql-beam` filled check and struck-through label, current step a `--ql-beam` ring and bold label, future steps a faint ring. Primary button `Continue` on `--ql-on-ink-strong`, with `about 4 minutes left`.

**The receipt** (`1c` frame 4) is the payoff and the single most important new screen emotionally. Full-screen `--ql-ink-surface`, a 64px `--ql-beam` circle with the Scale icon, `.mz-display-l` `Week 30 is closed.`, then a four-row stat block on `#1b2823` panels separated by 1px gaps:

- `Unsorted` — `23 → 0` (the `0` in `--ql-brand-tint`)
- `Accounts current` — `4 of 4`
- `Save rate, now measured` — `20.0% → 21.4%`
- `Committed this week` — `LKR 2,500/mo` in `--ql-beam`

Then the honesty paragraph, which is the reason this does not feel like a gamified lie:

> Sorting the 23 rows moved **LKR 42,700** out of "unassigned" and into real purposes, and Sara's statement added **LKR 3,100**. Your savings didn't change — the measurement got honest.

Finish with `Send Sara the receipt` (share sheet / Web Share API, text summary) and `Back to Balance`. Hide the share button when `solo`.

**Rules for the streak, so it stays honest:** a week counts as closed only when steps 1–4 were each answered (skipping is answering; ignoring is not). It is stored per user per household. Breaking it shows the count reset with no penalty language — "Starting again" — and the app never sends more than one nudge per week.

---

## The Books

Everything cut from Home, moved intact behind one link. Build it as a view with a chip filter across the top: `Purpose · Settle-up · Coverage · Fixed · Assets · Efficiency · Also waiting`.

The content is a **restyle only** — reuse `PurposeMatrix`, the funding reconciliation block, `ResponsibilityCard`, `EfficiencySection`, `HomeAssetSection`, the commitments list and the coverage list from today's `HomeView.tsx`. Apply: `--ql-radius-panel` corners, `--ql-border`, `--ql-surface` cards instead of hairline-separated transparent sections, and the type scale above. Keep every `DrilldownAmount` — drilling into the ledger from any figure is a genuine strength.

Mobile Books (`1c` frame 5) collapses the matrix to a per-category row with the member split as a `.mz-caption` sub-line, keeping the total on the right. The two flagged blocks stay: `LKR 42,700 has no "who" yet` on `--ql-danger-surface`, and `LKR 214,000 planned, not yet seen` on `--ql-surface`.

---

## Copy rewrites

The words are currently the data model. Rewrite them; the meaning must not change.

| Today | New |
|---|---|
| Money check-in | Balance |
| Recorded responsibility | What each of you is responsible for |
| To receive in settle-up / To pay in settle-up | Sara owes Munsif LKR 48,600 |
| Joint or unregistered funding | Paid from an account we can't attribute |
| Planning-only fixed commitments | Planned, not yet seen in a statement |
| Who it was for is still unassigned | LKR 42,700 has no "who" yet |
| Classify new spending — 23 transactions need a purpose | 23 new things to name — about 90 seconds |
| Acknowledge gaps | Close the week anyway |
| Mark reviewed | Close the week |
| Attributable settlement pool | The shared costs one of you fronted |
| Responsibility is not the same as who paid | Who benefited, and who actually paid |
| Estimated monthly saving | Getting it back is worth |
| Materiality threshold / readiness reason | Not enough evidence yet — Mizan will say when there is |

Tone rules: second person, contractions allowed, no exclamation marks, no emoji, never congratulate the user for spending less without saying by how much and against what baseline. Numbers always carry their unit and their basis.

---

## Data model additions

Four additions. Everything else is unchanged.

1. **`Account.statementDay?: number`** (1–28) — the day of month the statement usually arrives. Learn it from the median day-of-month of confirmed coverage dates for that account; let the user override in Settings → Accounts. Drives "usually arrives the 3rd" and the reminder.
2. **`WeeklyClose` records** — `{ id, householdId, uid, weekIso, closedAt, stepsCompleted: string[], sortedCount, committedPlanId? }` in a subcollection alongside the existing weekly-review write in `useCloudSync.ts`. Needed for the streak and the receipt. Firestore rules: same read/write scope as the current per-user weekly review; add to `firestore.rules` and to the rules test suite in `tests/firestore.rules.test.ts`.
3. **Settlement records** — `{ id, householdId, month, fromMemberId, toMemberId, amount, settledAt, settledByUid }`. "Mark settled" appends one; it never edits transactions and never changes a month's figures. Settlement display becomes `computed − settled`. Add to the backup schema in `src/storage/schema.ts` and to `src/storage/backup.ts`, and bump the schema version with a migration that defaults it to `[]`.
4. **`HomeAction.estimateMinutes: number`** in `src/ui/homeActions.ts`.

**Remembered statement passwords** must be stored per device only — `localStorage` alongside the other non-financial convenience state in `src/app/localConvenience.ts`, never in Firestore, never in a backup export. `SECURITY-AUDIT.md` and the README promise passwords are not uploaded; keep that promise. Consider gating behind the platform credential store where available.

---

## Notifications

The ritual needs a trigger; without one none of this retains. `public/sw.js` and `public/manifest.webmanifest` already exist.

- One weekly push, user-chosen day and time, default Sunday 19:30 local.
- The payload states payoff and cost: *"Week 31 is ready to close. Sara's HSBC statement came in, so July is fully measured now. 6 merchants to name — about 3 minutes."*
- Actions: `Close it` (deep-links to the close at the first incomplete step) and `Tomorrow` (one 24h snooze, maximum one per week).
- A second optional reminder per account on `statementDay + 1`: *"HSBC usually sends your statement around now."*
- Never more than two notifications in a week. Never a notification that only says a number went down.
- Compute the payload client-side on `periodicsync` where available; fall back to computing it when the app is next opened and scheduling a local notification.

---

## Design tokens

Full set in `tokens.new.css` in this bundle — drop it in as `src/styles/tokens.css`. It preserves every existing `--ql-*` name so nothing downstream breaks, and adds the measurement, instrument and ink-surface roles. Headlines:

| Token | Value | Note |
|---|---|---|
| `--ql-canvas` | `#f4efe6` | was `#f6f5f1` |
| `--ql-text` | `#10201a` | was `#1b2620` |
| `--ql-border` | `#e0dace` | was `#d7d9d4` |
| `--ql-brand` | `#14483a` | was `#1f5b46` |
| `--ql-danger` | `#a94e28` | clay, not red |
| `--ql-beam` | `#c9a227` | gold — instrument + "saved" |
| `--ql-ink-surface` | `#10201a` | ritual, instrument, receipt |
| `--ql-unmeasured` | `#a94e28` | hollow segments only |
| `--ql-radius-control` | `10px` | was 6px |
| `--ql-radius-panel` | `16px` | was 8px |

Type: **Instrument Sans** (400/500/600/700) for UI, **Instrument Serif** (400 + italic) for every display figure and headline — replacing Inter and Georgia respectively. Both are on Google Fonts; self-host into `public/` if you would rather not add a third-party request (the CSP and offline story are both simpler that way). Scale is defined as `.mz-*` classes in the token file.

Elevation: only three levels — `--ql-shadow-card` for resting cards, `--ql-shadow-raised` for the focused Sort card and the instrument, `--ql-shadow-overlay` for modals. Nothing else casts a shadow.

Motion: `700ms cubic-bezier(.22,1,.36,1)` for the beam settle, `200ms ease` for hovers and chip selection, `140ms` for disclosure rotation (existing). Everything respects the `prefers-reduced-motion` block already in `base.css`.

---

## Assets

No new image assets. Icons are `lucide-react`, already a dependency — the prototype's inline SVGs are stand-ins, use the components. The "M" wordmark is a text glyph in Instrument Serif italic on a `--ql-brand` tile, no artwork. The hatch and dashed patterns are CSS.

---

## Suggested order of work

1. `tokens.new.css` + the `.mz-*` type scale, with the old app still rendering. Nothing should visibly break; only colours and type shift.
2. Rail + bottom tab bar + the `View` union change and its migration.
3. **The Books** — move the eight lower `HomeView` sections there verbatim, restyled. Home is now nearly empty but nothing is lost. Ship this and stop; it is already an improvement.
4. `unmeasuredExposure()` + the confidence chip + the accounted-for bar.
5. Balance: verdict, bar, single action, settle-up.
6. The balance instrument.
7. Sort, keyboard-first, including the transfer and split cases.
8. Catch up (without the forward-to address until §Open decision is resolved).
9. The weekly close flow + `WeeklyClose` records + the receipt.
10. Notifications.
11. Settlement records + "Mark settled".

Steps 1–3 are safe and independently shippable. Step 4 onward changes what Home means, so land them together behind a flag if you release to anyone but yourselves.

---

## Open decision — forward-to-Mizan email

The forward-to address in `2b` is the single highest-leverage retention feature in this design and it **contradicts a promise the current README makes**: *"Raw statement files and passwords are not uploaded by Mizan."* Ingesting mailed attachments requires a server that receives, and briefly holds, the statement file.

Do not build it silently. Options:

- **Don't.** Keep the drop zone and the reminder; accept the friction. Nothing else in the design depends on it.
- **Build it as an explicit, per-household opt-in** with its own consent copy, a stated retention window (parse and delete within minutes), a distinct address per household, and an amended privacy section in the README. Statements would be parsed server-side, which also means the parsers in `src/import/**` need a Node target — they are currently browser-only and use `crypto.subtle`.
- **A middle path:** a share-target PWA entry (`share_target` in `manifest.webmanifest`) so a statement can be shared into Mizan from the phone's mail app in two taps, entirely on-device. This gets most of the convenience with none of the privacy cost, and is the recommended starting point.

The rest of the handoff assumes the third option unless you decide otherwise.

---

## What this design does not yet cover

Stated plainly so it is not discovered late:

- **Solo households** — the copy switches are specified but no dedicated screens were drawn.
- **First run / onboarding** — `OnboardingView.tsx` is untouched by this pass and will look out of place against the new tokens.
- **Multi-currency income** — a household with income in more than one currency breaks the single accounted-for bar. Needs its own treatment.
- **Disagreement about a settlement** — "Mark settled" assumes agreement; there is no dispute or reversal flow.
- **Historical months** — Balance is designed for the current month; a completed month should probably show the instrument at rest with no ritual card and no action.
- **Empty and error states** for Catch up and Sort beyond the ones noted.

---

## Files in this bundle

| File | What it is |
|---|---|
| `README.md` | This document. Self-sufficient; implement from it. |
| `Mizan Overhaul.dc.html` | The design prototype. Open in a browser with `support.js` beside it. |
| `support.js` | Runtime required by the prototype file. Not part of the app. |
| `tokens.new.css` | Drop-in replacement for `src/styles/tokens.css`. |

## Files in the app this touches

Rewritten: `src/ui/HomeView.tsx` (splits into `BalanceView` + `BooksView`), `src/app/AppPresentation.tsx` (rail, view union, screen routing), `src/styles/tokens.css`, `src/styles/views.css`, `src/styles/components.css`.
Extended: `src/ui/homeActions.ts` (`estimateMinutes`), `src/domain/accountCoverage.ts` (`unmeasuredExposure`), `src/domain/types.ts` (`Account.statementDay`, settlement + weekly-close types), `src/app/useHouseholdSession.ts` (`View`), `src/app/localConvenience.ts` (view migration, remembered passwords), `src/storage/schema.ts` + `backup.ts` (settlement records), `firestore.rules`, `public/sw.js`, `public/manifest.webmanifest`, `index.html` (fonts).
New: `src/ui/BalanceView.tsx`, `src/ui/BalanceInstrument.tsx`, `src/ui/BooksView.tsx`, `src/ui/SortView.tsx`, `src/ui/CatchUpView.tsx`, `src/ui/WeeklyClose.tsx`, `src/ui/WeeklyReceipt.tsx`, `src/ui/AppRail.tsx`.
Untouched: everything under `src/domain/` except the two files named above, all of `src/import/`, `src/household/`, `src/firebase/`, `src/auth/`, `src/security/`.

Existing tests in `src/ui/HomeView.test.tsx` will need rewriting against the new component split; the domain suites should pass unchanged, and that is the check that this overhaul stayed in its lane.
