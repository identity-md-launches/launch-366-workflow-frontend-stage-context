# DESIGN.md — Match quadratic funding (web)

Design record of the implemented one-page frontend in `web/`, extracted from the final source
(`web/src/styles.css`, `web/src/components/*.tsx`, `web/index.html`) and confirmed in the headless
Chromium run recorded in `docs/FRONTEND-VALIDATION.md`. It is placed under `docs/` because this
assignment's write scope is `web/**`, `dist/**` and `docs/**`; a repository-root copy was outside
that scope.

## Overview

Audience: Sepolia testers who hold or want MTCH and take part in curated quadratic funding rounds
(creators, funders, contributors, payout addresses). The page is a calm, light, single-column tool:
one neutral warm-grey ramp, one indigo accent used only for interaction, and status hues only where
a state exists (open, ended, finalized, success, error). Hierarchy comes from size and weight, not
decoration; grouping comes from space and white cards on a tinted page, with borders reserved for
structure (cards, tables, inputs).

System-wide rules: sentence case everywhere, verb-first buttons, exactly one filled primary action
per form, tabular numerals on every changing value, every control labelled and every transaction
gated by chain and prerequisite state. Page-specific arrangement (header with wallet bar, then
Wallet and MTCH, Rounds, Create a round, Contracts) is this page's composition, not a rule for
every future page.

## Colors

Defined once in `web/src/styles.css` `:root`. Primitives are named by hue and never used in a
component; components use the semantic tier only. Hex notation throughout; light theme only
(`<meta name="color-scheme" content="light">`, no dark variant).

| Semantic token | Value (primitive) | Job |
| --- | --- | --- |
| `--color-bg-page` | `#f6f6f3` (`--neutral-50`) | page background |
| `--color-bg-surface` | `#ffffff` | cards, inputs, wallet identity chip, secondary buttons |
| `--color-bg-subtle` | `#eeeeea` (`--neutral-100`) | table header, disabled inputs, secondary hover |
| `--color-border` | `#d8d8d2` (`--neutral-200`) | card, table and section borders (structure) |
| `--color-border-strong` | `#8a8a82` (`--neutral-500`) | input and secondary-button borders (must read as controls) |
| `--color-text` | `#1c1c1a` (`--neutral-900`) | body and headings |
| `--color-text-secondary` | `#5c5c56` (`--neutral-600`) | captions, hints, `dt` labels, muted values |
| `--color-accent-solid` / `-hover` | `#2f4fb8` / `#28439c` (`--indigo-600/700`) | the single filled primary action per form |
| `--color-accent-text` | `#28439c` | links, ghost buttons, finalized badge text |
| `--color-accent-bg` | `#e6ecfa` (`--indigo-100`) | in-progress transaction status, info notices, finalized badge, ghost hover |
| `--color-on-accent` | `#ffffff` | text on the filled accent |
| `--color-focus` | `#2f4fb8` | `:focus-visible` outline (2px solid, 2px offset) |
| `--color-success-bg` / `-text` | `#e2f2e7` / `#135c31` | confirmed status, "Open" badge, on-chain dot |
| `--color-danger-bg` / `-text` | `#fbe7e5` / `#a3231b` | failed status, error notices, field errors, wrong-network dot |
| `--color-warning-bg` / `-text` | `#fbeed2` / `#6b4400` | "Ended, awaiting finalization" badge |

Measured WCAG 2 ratios for the rendered pairs (script in the validation record): body text 17.1:1
on surface, secondary text 6.7:1 on surface and 5.8:1 on the table header, links 8.9:1, primary
button label 7.2:1, status text on its tinted background 6.3–7.5:1, input borders 3.5:1, focus ring
6.6:1 on the page. Colour is never the only carrier: badges carry text, statuses carry an icon
glyph and words, the network dot sits next to the network name.

## Typography

- Family: the system stack `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
  sans-serif` (`--font-sans`); addresses, hashes and ids use `--font-mono`
  (`ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`). No web fonts are
  loaded, so the export has no font assets and no synthesis concerns beyond the platform's own faces.
- Scale (`--text-*`): xs 0.75rem (badges), sm 0.875rem (hints, captions, table, status), base 1rem
  (body, inputs), lg 1.125rem (form titles `h3`/`h4` `.action-title`), xl 1.375rem (section titles
  `h2` and round titles `h3`), 2xl 1.75rem (`h1`, letter-spacing -0.01em). Heading sizes descend with
  level; adjacent levels that share a size are separated by weight and context.
- Weights: 400 body, 500 labels/buttons/values, 600 headings, badges and event names, 700 only for
  the status glyph. Nothing below 400.
- Line height: `--leading-tight` 1.15 on headings, `--leading-body` 1.5 elsewhere; `text-wrap:
  balance` on headings, `text-wrap: pretty` on paragraphs; `overflow-wrap: anywhere` on `body` so
  addresses and hashes never overflow.
- Numbers: `font-variant-numeric: tabular-nums` on `.num`, `.stat dd`, inputs, the rate line and
  table numerals. Amounts are formatted with the token's decimals, thousands grouping and at most
  four fraction digits with a trailing "…" when truncated (`web/src/lib/format.ts`).
- Inputs render at `max(1rem, var(--text-base))` so iOS does not zoom. Measure is capped at
  `--measure: 68ch` for descriptions and the footer note.
- Links use `text-underline-position: from-font`, `text-decoration-thickness: from-font` and
  `text-decoration-skip-ink: auto`.

## Layout

- Container: `--page-max: 68rem`, centred, `padding-inline: var(--space-4)`; header and main share
  the same edges. Logical properties (`inset-inline-start`, `padding-inline-start`,
  `border-block-end`, `margin-block-start`) throughout.
- Spacing: 4px scale `--space-1..10` (0.25–2.5rem). Within a form: `--space-3`; between stats:
  `--space-4`; card padding `--space-5`; between round-action forms `--space-6`; between page
  sections `--space-8`. Intra-group gaps stay at half or less of inter-group gaps.
- Grids: `.stats` and `.contracts` use `repeat(auto-fit, minmax(11rem|16rem, 1fr))`;
  `.stats-compact` (round metrics) `minmax(9rem, 1fr)` with the schedule spanning the full row;
  `.form-row` `minmax(14rem, 1fr)`. The wallet panel (`.panel-grid`) and the round action area
  (`.round-actions`) go two-column at `min-width: 52rem` and are single-column below it. This is the
  only breakpoint; it was chosen where two forms stop fitting side by side, not from a device preset.
- Tables: `.table-wrap` gives the projects table `overflow-x: auto` inside a bordered rounded box
  so narrow screens scroll the table horizontally with the next column peeking; the page itself
  never scrolls horizontally (verified at 320, 768, 1280 CSS px and at 200% CSS zoom).
- Reading order matches DOM order: skip link, header (brand, wallet), Wallet and MTCH, Rounds
  (newest first), Create a round, Contracts. Every transaction control sits in normal flow inside its
  card; nothing is sticky or fixed.
- Controls: `--control-height` 2.5rem, raised to 2.75rem under `(pointer: coarse)`; `.button-small`
  2rem for dismiss/refresh. Adjacent buttons are separated by `--space-3` (12px) so hit areas never
  touch.

## Elevation & Depth

Flat by design. Cards have a 1px `--color-border` plus a very light two-layer shadow
(`--shadow-card: 0 1px 2px rgb(0 0 0 / .04), 0 1px 1px rgb(0 0 0 / .03)`) to lift them off the
tinted page. Tinted backgrounds (`--color-accent-bg`, success/danger/warning) mark status surfaces
without shadows. There are no overlays, modals or stacked layers; the only absolutely positioned
element is the skip link, which appears on focus.

## Shapes

- `--radius-sm: 0.375rem` for buttons, inputs, status chips, notices, table wrap and the wallet chip.
- `--radius-md: 0.75rem` for cards.
- Badges are pills (`border-radius: 999px`, uppercase 0.75rem with 0.02em tracking).
- The network dot is a 0.625rem circle. No other decorative shapes or icons; status glyphs (✓ · ! · …)
  are text inside the status chip.

## Components

All components live in `web/src/components/` and are plain React function components styled by
the classes below; none is a published library export.

- **Button** (`.button` + `.button-primary | .button-secondary | .button-ghost`, `.button-small`)
  — `<button>` or `<a>` with the same look. Primary is the one filled action of a form; secondary is
  bordered white; ghost is text-only (Dismiss, Refresh, Disconnect). States: hover (only under
  `@media (hover: hover)`), `:active` scale 0.96 gated by `prefers-reduced-motion: no-preference`,
  `:disabled` at 0.6 opacity with `cursor: not-allowed`, `:focus-visible` ring from the global rule.
  Transitions name their properties (`background-color, color, border-color, scale`, 120ms ease-out).
- **Field / TextInput / Select** (`Field.tsx`, `.field`, `.input`, `.field-hint`, `.field-error`)
  — visible `<label for>`, optional hint and inline error; the input carries `aria-invalid` and
  `aria-describedby` (error id first, hint id second) via `describedIds()`. Amount inputs are
  `type="text" inputmode="decimal"`. Validation runs on submit, never on keystroke; typing clears the
  error.
- **TxStatus** (`TxStatus.tsx`, `.tx-status.is-<phase>`) — one stable region per control key,
  `role="status" aria-live="polite"` for progress and success, `role="alert"` for failure, with an
  explorer link once a hash exists and a Dismiss ghost button when finished. Rendered even when empty
  so the live region exists before its text changes.
- **PayingForm** (`PayingForm.tsx`, `.action-form`, `.steps`) — the approve-then-pay pattern used
  for `fund` and `contribute`: amount field with balance/allowance hint, "Step 1: Approve MTCH" and
  "Step 2: <action>"; the button that is currently the right next step is primary, the other is
  secondary; step 2 is disabled until the allowance covers the amount; both are disabled when
  disconnected or on the wrong chain, with the reason in `.action-note`.
- **WalletBar** (`WalletBar.tsx`, `.wallet-bar`, `.wallet-identity`, `.chain-dot`) — connect
  buttons per discovered wallet (or a note when none), then the address chip (explorer link, network
  name or "Wrong network (chain n)"), the single "Switch to Sepolia" primary control and Disconnect.
- **Badge** (`.badge`, `.badge-open | -ended | -finalized`, default = upcoming) — round phase.
- **Stats** (`.stats`, `.stat`, `.stats-compact`) — `dl` of label/value pairs used for wallet
  figures, round metrics and the contracts footer.
- **Card** (`.card`) and **RoundCard** (`RoundCard.tsx`, `.round`, `.round-header`, `.projects`,
  `.round-actions`, `.activity`) — an `article` labelled by its heading with the schedule, metrics,
  projects table (`caption` for assistive tech, `th scope`), state-dependent action forms and a
  native `<details>` activity disclosure that loads events on first open.
- **Notice** (`.notice`, `.notice-error`) — page-level status or alert text.
- **Empty state** (`.empty-state`) — title, one sentence of orientation, one next action.
- **Skip link** (`.skip-link`) — first focusable element, visible on focus, targets `#main`.

Keyboard: every control is native (`button`, `a`, `input`, `select`, `summary`), so Tab order is
DOM order and Enter/Space activate; the focus ring is the global 2px `--color-focus` outline with
2px offset and was observed at every stop in the browser walk.

## Do's and Don'ts

- Start a new surface from `.section` → `.card`; put related fields in `.action-form` and buttons
  in `.steps`. Use `.stats` for label/value facts, `.notice` for page-level messages.
- One `.button-primary` per form or card region; peers are `.button-secondary`; text-only actions are
  `.button-ghost`. Never put accent colour on plain text that is not a link.
- Reference only semantic tokens (`--color-*`, `--space-*`, `--text-*`, `--radius-*`); add a token
  if a role is missing rather than reusing one for its value.
- Keep sentence case, verb-first labels and the existing vocabulary: "Connect wallet", "Switch to
  Sepolia", "Approve MTCH", "Fund pool", "Contribute", "Register project", "Finalize round", "Claim",
  "Reclaim funding", "Dismiss", "Refresh".
- Every changing number gets `.num` or lives in a `.stat dd`; format amounts with
  `formatAmount(value, decimals)`.
- Keep transaction controls disabled until wallet, chain and contract prerequisites are met, and
  render a `TxStatus` for every control key you introduce.
- Do not add a dark theme, web fonts, modals or animation beyond the press scale; do not introduce
  `oklch()` or Tailwind alongside the hex tokens.
- Recipe for another page: copy `index.html` and `main.tsx`, reuse `styles.css`, compose
  `section.section > h2.section-title + div.card`, use `Field`/`TextInput` for inputs and
  `TxStatus` + `useTransactions` for any write, and read configuration only through
  `loadDeployment()` from `src/config.ts`.
