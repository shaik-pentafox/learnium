# Learnium — Design System (`DESIGN.md`)

> **Status:** authoritative design reference for `apps/web`. Codifies the direction chosen in
> [`FRONTEND_PLAN.md §3`](./FRONTEND_PLAN.md) — the **"Linear" archetype: Zinc neutral + Indigo accent**,
> dark + light first-class. Read alongside `DEV_STRATEGY.md` (stack/scope authority) and
> `FRONTEND_PLAN.md` (component sources, screens, phases). Where this file and an older plan
> disagree on a token or surface, **this file wins for visual decisions**; `DEV_STRATEGY` still
> wins for scope.
>
> Tokens are named for **shadcn/Tailwind v4 CSS variables** (`--background`, `--primary`, `--radius`…)
> because that is what the code consumes. Every token is defined under **both** `:root` (light) and
> `.dark`. Hex/oklch pairs below are the source values; components reference the variable, never a
> raw hex.

---

## Overview

Learnium is an **authenticated AI-roleplay training platform** — trainees practice sales/support
conversations against AI personas, trainers build those personas and watch their cohort, admins run
the org and the LLM fleet. The surface is a **dense-but-breathable internal tool**, not a marketing
page. That single fact drives every decision: structure over decoration, restraint over flash,
legibility of live data over hero moments.

The system is **structural, not chromatic**. A near-neutral **Zinc** scale carries every surface,
border, and text tone; a single **Indigo** accent carries every primary action, active state, and
data-progress fill. There is no second accent — status colors (emerald/amber/red) are semantic
signals, not brand color. Decoration is **borders and spacing**, not shadows and gradients: a
`1px` border separates a card from its background in both themes, and generous whitespace separates
regions. Drop shadows exist only for things that genuinely float (popovers, modals, command menu).

**Both themes are designed, neither is a port.** Dark is the showcase — the voice/chat session
screen is built dark-first — but light is held to the same contrast and structure bar. Tokens are
declared in pairs from day one; "looks right in dark, broken in light" is a bug.

Type is the second voice. **Inter** carries all UI narrative at disciplined weights (400 body, 500
labels, 600 page titles — never 700+). **JetBrains Mono** carries every *number that updates live or
identifies a thing*: performance scores, ranks (`12 / 470`), token counts, latency, cost, IDs, log
lines. Monospace stops layout jitter when those values tick, and signals "this is data."

**Key Characteristics:**

- **One accent, used sparingly.** `--primary` Indigo marks the single most important action per view
  (primary CTA, active nav item, donut-progress fill, focused input ring). Two indigo buttons
  competing on one screen is a smell.
- **Borders are the structure system.** `--border` at `1px` defines every card, table row, input,
  and panel edge — in both themes. The brand reads calm because structure comes from hairlines, not
  elevation.
- **Mono is the data layer.** Any numeric/identifier surface is JetBrains Mono; any sentence is Inter.
  The split is absolute and is the platform's technical voice.
- **Status color is semantic only.** Emerald = healthy/pass, amber = caution/rate-limited, red =
  error/auth-failed. These never get used as decoration or as a second brand color.
- **Elevation is restrained.** Cards sit flat on a `1px` border. Shadows appear only on true overlays
  (popover, dropdown, dialog, toast, command palette) and stay soft.
- **Density is deliberate.** Dashboards and tables run tight (reduced card padding, hairline rows);
  forms and reading surfaces breathe (max-width, larger spacing). The page knows which mode it's in.

---

## Colors

All values are given as **light → dark** pairs. Components reference the CSS variable; the variable
resolves per theme via the `.dark` class on `<html>`.

### Core surface & text (shadcn base tokens)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#ffffff` (zinc-50 on app chrome) | `#09090b` (zinc-950) | App body / page background. |
| `--surface` | `#ffffff` | `#18181b` (zinc-900) | Card, panel, sidebar, popover base. (shadcn `--card`/`--popover` map here.) |
| `--surface-2` | `#fafafa` (zinc-50) | `#1f1f23` (zinc-900↑) | Inset region — table header, code block, nested panel. |
| `--muted` | `#f4f4f5` (zinc-100) | `#27272a` (zinc-800) | Muted fill — skeleton base, disabled bg, hover row. |
| `--border` | `#e4e4e7` (zinc-200) | `#27272a` (zinc-800) | Every hairline: card edge, divider, input border, table row. |
| `--input` | `#e4e4e7` (zinc-200) | `#3f3f46` (zinc-700) | Input border (one step stronger than `--border` in dark). |
| `--ring` | `#6366f1` (indigo-500) | `#6366f1` (indigo-500) | Focus ring — accent in both themes. |
| `--foreground` | `#18181b` (zinc-900) | `#fafafa` (zinc-50) | Primary text — headings, body. |
| `--muted-foreground` | `#52525b` (zinc-600) | `#a1a1aa` (zinc-400) | Secondary text — captions, labels, inactive nav. |
| `--faint-foreground` | `#a1a1aa` (zinc-400) | `#52525b` (zinc-600) | Lowest priority — placeholder, fine print. |

### Brand accent (Indigo)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` | `#4f46e5` (indigo-600) | `#6366f1` (indigo-500) | THE accent. Primary CTA bg, active nav, donut-progress fill, links, selected state. Light uses one step darker for AA on white. |
| `--primary-foreground` | `#ffffff` | `#ffffff` | Text/icon on a `--primary` fill. |
| `--primary-hover` | `#4338ca` (indigo-700) | `#818cf8` (indigo-400) | Hover/pressed on primary surfaces. |
| `--accent-soft` | `#eef2ff` (indigo-50) | `#312e81`/30% (indigo-900 α) | Soft accent wash — active-tab background, selected-row tint, badge-info fill. |
| `--accent-ring-glow` | `#6366f1`/40% | `#6366f1`/35% | The subtle accent glow on the active sidebar item / focused tab. |

> **No second brand accent.** Violet (`#7c3aed`) is permitted **only** as the far stop of the single
> signature gradient (below) — never as a standalone button or label color.

### Semantic status

| Token | Light | Dark | Use |
|---|---|---|---|
| `--success` | `#16a34a` (green-600) | `#22c55e` (green-500) | Healthy provider, passing criterion, completed session, positive delta. |
| `--success-soft` | `#dcfce7` | `#052e16` | Success badge/banner background. |
| `--warning` | `#d97706` (amber-600) | `#f59e0b` (amber-500) | Rate-limited key, caution, pending, at-risk trainee. |
| `--warning-soft` | `#fef3c7` | `#3a2a06` | Warning badge/banner background. |
| `--destructive` | `#dc2626` (red-600) | `#ef4444` (red-500) | Auth-failed key, validation error, destructive action, declining score. |
| `--destructive-soft` | `#fee2e2` | `#3a0a0a` | Destructive badge/banner background. |
| `--info` | `#2563eb` (blue-600) | `#3b82f6` (blue-500) | Neutral informational note (distinct from the indigo *brand* accent). |

### Data-viz palette (charts)

Recharts series use a fixed, theme-aware ramp — accent-led, status-adjacent, never rainbow:
`--chart-1` indigo (`--primary`), `--chart-2` violet `#8b5cf6`, `--chart-3` teal `#14b8a6`,
`--chart-4` amber `#f59e0b`, `--chart-5` rose `#f43f5e`. Gridlines/axes use `--border` and stay
hidden until hover on dense dashboards.

### Signature gradient (reserved)

A single **indigo → violet** linear gradient (`--primary` `#6366f1` → `#8b5cf6`) is the *only*
gradient in the system. It is reserved for **three moments**: the login brand panel, the
end-of-session **score-reveal ring/headline**, and **empty-state** illustration accents. It is never
applied to buttons, cards at rest, nav, or data surfaces, and never miniaturized to an icon. Treat it
as one object — do not reorder or recolor the stops.

---

## Typography

### Font Families

1. **Inter** — all UI narrative: page titles, section headers, body, labels, nav, button text, form
   copy. Working weights **400 / 500 / 600 only**. Inter never appears at 700+. Enable
   `font-feature-settings: "cv11", "ss01"` for the cleaner single-story `a`/`g`.
2. **JetBrains Mono** — every numeric or identifier surface: performance scores, ranks, token/cost
   counts, latency ms, dates in tables, session/persona IDs, log lines, code/instruction snippets in
   the persona builder. Weight **400 / 500**. Monospace prevents width jitter on live updates.

Both are variable web fonts, self-hosted, `font-display: swap`, subset to Latin.

### Hierarchy

| Token | Size / Line | Weight | Tracking | Font | Use |
|---|---|---|---|---|---|
| `--text-display` | 30 / 36 | 600 | -0.02em | Inter | Login headline, score-reveal number context, empty-state title. |
| `--text-title` | 24 / 32 | 600 | -0.015em | Inter | Page title (one per route). |
| `--text-h2` | 18 / 28 | 600 | -0.01em | Inter | Section header, card cluster title, dialog title. |
| `--text-h3` | 16 / 24 | 500 | 0 | Inter | Sub-section, panel header, table caption. |
| `--text-body` | 14 / 20 | 400 | 0 | Inter | Default body, table cells, form values. (App base size is 14, not 16 — it's a dense tool.) |
| `--text-body-strong` | 14 / 20 | 500 | 0 | Inter | Labels, active nav, emphasized inline. |
| `--text-caption` | 12 / 16 | 400 | 0 | Inter | Helper text, timestamps, fine print, badge labels. |
| `--text-eyebrow` | 11 / 16 | 500 | 0.06em | Inter | Uppercase section eyebrow / table column header. |
| `--text-mono-data` | 14 / 20 | 500 | 0 | JetBrains Mono | Inline data: scores, counts, latency, cost, rank. |
| `--text-mono-lg` | 28 / 32 | 500 | -0.01em | JetBrains Mono | Hero data: the donut score number, big-stat KPI value. |
| `--text-mono-sm` | 12 / 16 | 400 | 0 | JetBrains Mono | IDs, log lines, dense table numerics, code captions. |
| `--text-code` | 13 / 20 | 400 | 0 | JetBrains Mono | Persona-instruction blocks, JSON/snippet panels. |

### Principles

- **Inter for words, JetBrains Mono for numbers.** The split is mechanical: if a value updates live
  or identifies a record, it's mono. Body sentences are never mono.
- **Weight ceiling is 600.** Hierarchy comes from size + color + spacing, not heavy weight. Bold (600)
  is reserved for page/section titles. No 700/800 anywhere.
- **Base size is 14px.** This is a data-dense admin tool; 16px base is reserved for the login and
  long-form reading surfaces only.
- **Negative tracking on display/title only.** Body and caption stay at neutral tracking.
- **Eyebrows are uppercase mono-feel via Inter 500 + letter-spacing**, used for table headers and
  section labels — the only uppercase in the system.

---

## Layout

### Spacing System

- **Base unit: 4px** (Tailwind default). Every spacing value is a multiple of 4.
- **Tokens** (Tailwind scale): `1`=4 · `2`=8 · `3`=12 · `4`=16 · `5`=20 · `6`=24 · `8`=32 · `10`=40 ·
  `12`=48 · `16`=64 · `20`=80 · `24`=96.
- **Page padding:** content region `24px` (`p-6`) on desktop, `16px` (`p-4`) on mobile.
- **Card interior:** dense dashboard cards `16px` (`p-4`); standard cards `24px` (`p-6`); forms/reading
  `24–32px`.
- **Stack rhythm:** label→control `8px`; control→control `16px`; section→section `32px`; page
  title→content `24px`.
- **Table density:** row height `44px` comfortable / `36px` compact; cell padding `12px` horizontal.

### Grid & Container

- **App shell:** fixed **left sidebar** (`256px` expanded / `64px` collapsed) + **top bar** (`56px`,
  breadcrumbs left, theme toggle + user menu right) + content region.
- **Content max-width:** forms and reading surfaces cap at `720px` (`max-w-2xl`–`3xl`) centered;
  **tables and dashboards go full-bleed** to the content region width.
- **Dashboard grid:** 12-col responsive. KPI tiles 4-up desktop → 2-up tablet → 1-up mobile. Chart
  cards span 6 or 12 cols.
- **Leaderboard / data table:** single full-width column; own-row pinned to a sticky footer when
  outside the visible page.

### Whitespace Philosophy

Structure comes from **hairline borders + consistent spacing**, not decoration. Regions are separated
by `32px` gaps and `1px` `--border` lines, not by shadow or color blocks. Inside a card the
header→content gap is tight (`12–16px`); between cards the gap is generous (`16–24px`). The tool reads
as *engineered*: tight interiors, deliberate outer rhythm.

### Responsive Strategy

| Name | Width | Key changes |
|---|---|---|
| Mobile | < 640px | Sidebar → off-canvas drawer (hamburger in top bar); KPI/feature grids → 1-up; tables → horizontal scroll or stacked card rows; chat full-screen. |
| Tablet | 640–1023px | Sidebar collapses to icon-rail (`64px`); grids → 2-up; top bar keeps breadcrumbs. |
| Desktop | 1024–1439px | Sidebar expanded (`256px`); full multi-col dashboards; data tables full-bleed. |
| Wide | ≥ 1440px | Content region caps; dashboards gain a 3rd/4th column where it aids density, never just to fill. |

**Touch targets:** interactive controls meet `44×44px` on touch viewports; on desktop, table-row and
nav hit areas use full-row padding. Focus ring (`--ring`) is always visible on keyboard nav.

**Reduced motion:** `prefers-reduced-motion` disables score-reveal animation, badge celebrate, and
list transitions — content still appears, just without movement.

---

## Elevation & Depth

Elevation is **minimal and border-first**. Most surfaces have zero shadow and rely on `--border`.
Shadows appear only on elements that genuinely float above the page, and stay soft in both themes
(dark uses lower-opacity, larger-blur shadows since shadow-on-dark reads weakly — depth in dark also
leans on a subtly lighter `--surface`).

| Level | Treatment | Use |
|---|---|---|
| 0 — Flat | No shadow, no border. | Page background, full-bleed bands. |
| 1 — Hairline | `1px` `--border`, no shadow. | **Default surface** — cards, panels, sidebar, table, inputs at rest. The universal "this is a region" cue. |
| 2 — Raised | `1px` border + `shadow-sm` (`0 1px 2px rgb(0 0 0 / .05)`; dark `/.3`). | Hoverable cards, sticky table header, KPI tile on hover. |
| 3 — Overlay | `1px` border + `shadow-md` (`0 4px 8px -2px rgb(0 0 0 / .08)`; dark larger-blur `/.4`). | Dropdown, select, popover, command palette. |
| 4 — Dialog | `1px` border + `shadow-lg` (`0 12px 24px -6px rgb(0 0 0 / .12)`; dark `/.5`) + backdrop scrim. | Modal/dialog, drawer, toast. |

### Decorative depth

- **Active-state accent glow:** the active sidebar item / focused tab carries a soft
  `--accent-ring-glow` (small indigo glow + `--accent-soft` fill), the one place accent creates depth.
- **Dark `--surface` lift:** in dark theme, a raised card is `zinc-900` on a `zinc-950` page — the
  lighter surface *is* the elevation cue, reinforced by the border.
- **Scrim, not blur-heavy glass:** modals dim the page with a `--background/70%` scrim; no heavy
  glassmorphism.

---

## Shapes

### Border Radius Scale

shadcn drives radius off a single `--radius` token (set to **8px**); steps derive from it.

| Token | Value | Use |
|---|---|---|
| `--radius-sm` (`calc(--radius - 4px)`) | 4px | Badges, chips, tag pills, checkbox, small inline controls. |
| `--radius-md` (`calc(--radius - 2px)`) | 6px | Buttons, inputs, select, dropdown items. |
| `--radius` (base) | 8px | Cards, panels, dialogs, popover, table container. |
| `--radius-lg` (`calc(--radius + 4px)`) | 12px | Large feature cards, KPI tiles, login panel, score-reveal card. |
| `--radius-full` | 9999px | Avatars, status dots, the performance-score donut, badge medallions, toggle/switch. |

- **Buttons are `6px` rounded rectangles, not pills.** This is a tool, not a marketing page — the
  100px marketing pill is *not* used. (One exception: small status/count chips use `--radius-sm`.)
- **The score donut and avatars are the only fully-round elements.**

### Imagery & avatar geometry

- **Persona / user avatars:** `--radius-full` circles, consistent sizes (`24` nav, `32` table, `40`
  card, `64` profile). Initials fallback on `--muted` with `--muted-foreground` text.
- **Charts:** full-width inside a Level-1 card; no frame beyond the card border.
- **Waveform (voice):** rendered edge-to-edge inside the session panel, `--primary` active bars on
  `--muted` track — treated as live data, not an image.
- **Empty-state art:** minimal line illustration tinted with the signature gradient, centered, capped
  at ~`200px`.

---

## Components

> All components are **vendored shadcn/ui** primitives re-themed to the tokens above (per
> `FRONTEND_PLAN §3`). External catalog snippets (21st.dev, Aceternity, ReactBits) are stripped to
> `var(--*)` tokens **before** merge. CVA variants below name the canonical states.

### Buttons

**`button-primary`** — the single accent action per view.
- Bg `--primary`, text `--primary-foreground`, `--text-body-strong`, padding `8px 16px`, height `36px`,
  radius `--radius-md` (6px). Hover → `--primary-hover`. Focus → `--ring` ring. Loading → inline
  spinner, label dims, width holds.

**`button-secondary`** — the neutral paired action.
- Bg `--surface`, text `--foreground`, `1px --border`, same metrics as primary. Hover → `--muted` fill.

**`button-ghost`** — low-emphasis (table row actions, toolbar).
- Transparent bg, text `--muted-foreground`, no border. Hover → `--muted` fill + `--foreground` text.

**`button-destructive`** — irreversible actions.
- Bg `--destructive`, text white, radius `--radius-md`. Always behind a confirm dialog for data loss.

**`button-sm` / `button-icon`** — height `32px` / square `32px` icon button (radius `--radius-md`),
for dense toolbars, table rows, top bar.

### Cards & Containers

**`card`** — canonical Level-1 surface.
- Bg `--surface`, `1px --border`, radius `--radius` (8px), padding `24px`. Header (`--text-h3`) +
  optional description (`--text-caption --muted-foreground`) + content.

**`card-kpi`** — dense dashboard stat tile.
- Bg `--surface`, `1px --border`, radius `--radius-lg`, padding `16px`. Eyebrow label
  (`--text-eyebrow --muted-foreground`), big value (`--text-mono-lg`), delta chip (success/destructive
  soft). Hover → Level 2.

**`card-soft`** — nested/secondary panel.
- Bg `--surface-2`, `1px --border`, radius `--radius`, padding `16px`. For inset groups inside a card.

**`score-donut`** — the performance-score ring (signature).
- SVG donut, track `--muted`, progress arc `--primary` (gradient on the *reveal* moment only), score
  centered in `--text-mono-lg`, `/100` suffix in `--text-mono-sm --muted-foreground`. Fully round.

**`code-panel`** — persona instructions / JSON / log surface.
- Bg `--surface-2`, `1px --border`, radius `--radius`, body in `--text-code` (JetBrains Mono),
  padding `16px`, line numbers optional in `--faint-foreground`.

### Inputs & Forms

**`input`** — canonical text field.
- Bg `--surface` (light) / `--background` (dark), `1px --input` border, text `--text-body`, radius
  `--radius-md`, height `36px`, padding `8px 12px`. Focus → `--ring` ring + `--primary` border.
  Placeholder `--faint-foreground`. Error → `--destructive` border + helper text.

**`input-sm` / `input-lg`** — `32px` (dense filters) / `44px` (login) height variants.

**`select` / `combobox`** — same chrome as `input`; menu is Level-3 overlay; selected row uses
`--accent-soft` + `--primary` check.

**`form-field`** — label (`--text-body-strong`) + control + helper/error (`--text-caption`). Field
errors land here via react-hook-form; non-field errors go to toast.

### Navigation

**`sidebar`** — fixed left nav, role-aware.
- Bg `--surface`, `1px --border` right edge, width `256/64px`. Nav items: icon + label
  (`--text-body-strong`), `8px 12px` padding, radius `--radius-md`. **Active** → `--accent-soft` fill +
  `--primary` text + left `2px --primary` indicator + soft `--accent-ring-glow`. Hover → `--muted`.
  Collapsible; persists in UI store.

**`topbar`** — `56px`, bg `--surface`, `1px --border` bottom. Breadcrumbs (`--text-body
--muted-foreground`, current `--foreground`) left; theme toggle + notification dot + user menu right.

**`tabs`** — underline style. Inactive `--muted-foreground`; active `--foreground` + `2px --primary`
underline. Used for persona-builder sections, analytics scopes.

**`data-table`** (tablecn) — server-side, URL-state-driven.
- Container Level-1 card. Header row bg `--surface-2`, `--text-eyebrow`. Body rows `1px --border`
  bottom, hover `--muted`, selected `--accent-soft`. Numeric cells `--text-mono-data`, right-aligned.
  Pagination + sort + filter reflect URL search params. Loading → `TableSkeleton` (Boneyard).

### Feedback & status

**`badge`** — small status/label chip.
- Radius `--radius-sm`, `--text-caption`, padding `2px 8px`. Variants: `info` (`--accent-soft` /
  `--primary`), `success`, `warning`, `destructive` (soft bg / solid fg of each semantic pair),
  `neutral` (`--muted` / `--muted-foreground`).

**`status-dot`** — `8px` round, for provider/key/session health: `--success` ok, `--warning`
rate-limited, `--destructive` auth-failed, `--muted-foreground` idle. Paired with mono label.

**`toast`** (react-hot-toast) — Level-4 surface, bg `--surface`, `1px --border`, radius `--radius`,
icon in the semantic color, `--text-body`. Mutation feedback, normalized API errors, reconnect
advisories.

**`skeleton`** (Boneyard) — content-shaped loaders; base `--muted`, shimmer sweep in
`--primary/15%`. Default for every data-fetch wait (`TableSkeleton`, `CardSkeleton`,
`DashboardSkeleton`, `ChatHistorySkeleton`).

**`banner`** — inline advisory strip (reconnecting, simulation mode, at-risk). Soft semantic bg +
`1px` semantic border, `--text-body`, radius `--radius`. The persona-playground **simulation banner**
is unmistakable: `--warning-soft` bg, persistent, full-width.

### Signature components

**`chat-session`** — the core roleplay surface.
- Streaming message bubbles: trainee right-aligned `--primary` fill / white text; persona left-aligned
  `--surface` / `--foreground` with `1px --border`. Typing indicator (3-dot), emotion/emoji surface,
  reconnect `banner`. End-session → animated **`score-reveal`**.

**`score-reveal`** — end-of-session moment (the one animated showcase).
- Centered `card-lg`, `score-donut` animating 0→score with the signature gradient arc, per-criterion
  bars below (`--text-mono-data` values), weakest-criterion callout. Respects reduced-motion.

**`voice-session`** (deferred, F3) — persona avatar, live **waveform** (`--primary` bars on `--muted`),
speaking/listening status dot, captions stream (`--text-body`), elapsed timer (`--text-mono-data`),
end → `score-reveal`. ElevenLabs UI components re-themed to tokens.

**`leaderboard-row`** (deferred, F4) — rank (`--text-mono-data`), avatar, name, score bar
(`--primary` fill on `--muted` track), badge chips. Own row pinned to sticky footer with
`--accent-soft` tint when outside the page.

**`badge-medallion`** (deferred, F4) — earned in full color, locked greyed (`--muted` + reduced
opacity). New award → `BadgeToast` (Framer Motion celebrate, 4s, custom react-hot-toast), sidebar dot.

**`llm-key-row`** (F4) — masked key (`••••••••1234` in `--text-mono-sm`), per-key rpm/tpm
(`--text-mono-data`), health `status-dot`, verify `button-sm`. Keys are write-only/masked — never
echo a full secret.

---

## Examples (illustrative re-skin surfaces)

Canonical surfaces a downstream component generator should render consistently from the tokens above:

- **`ex-dashboard-kpi`** — `card-kpi`: eyebrow label, `--text-mono-lg` value, success/destructive
  delta chip. Props: `backgroundColor`, `borderColor`, `radius`, `padding`, `valueTypography`.
- **`ex-score-donut`** — round SVG progress ring, `--muted` track + `--primary` arc, mono center.
  Props: `trackColor`, `progressColor`, `valueTypography`.
- **`ex-data-table-row`** — header `--surface-2` + `--text-eyebrow`; body `--text-body`, mono numerics
  right-aligned, `1px --border`, hover `--muted`. Props: `headerBackground`, `rowBorder`, `cellPadding`.
- **`ex-chat-bubble`** — trainee `--primary`/white vs persona `--surface`/`--foreground` + border.
  Props: `backgroundColor`, `textColor`, `radius`.
- **`ex-auth-card`** — login `card-lg`, signature-gradient brand accent, `input-lg`, `button-primary`.
  Props: `backgroundColor`, `radius`, `padding`.
- **`ex-persona-builder-panel`** — `code-panel` for instructions + `form-field` rows + `tabs`.
  Props: `backgroundColor`, `radius`, `padding`, `codeTypography`.
- **`ex-status-badge`** — semantic soft-bg/solid-fg chip. Props: `backgroundColor`, `textColor`,
  `radius`, `typography`.
- **`ex-sidebar-row`** — nav row; active = `--accent-soft` + `--primary` text + `2px` indicator +
  glow. Props: `backgroundColor`, `activeIndicator`, `radius`, `padding`.
- **`ex-modal-card`** — Level-4 dialog, `1px --border`, `shadow-lg`, scrim. Props: `backgroundColor`,
  `radius`, `padding`, `shadow`.
- **`ex-toast`** — Level-4 toast, semantic icon, `--text-body`. Props: `backgroundColor`, `radius`,
  `padding`, `typography`.

---

## Do's and Don'ts

### Do

- Reserve `--primary` (Indigo) for the single most important action/state per view. One accent, used
  sparingly, is the whole color story.
- Build structure from `1px --border` + spacing. A card is a hairline border, not a shadow.
- Define every token under **both** `:root` and `.dark`. Verify each screen in both themes before
  calling it done — light is not an afterthought.
- Set every number that updates live or identifies a record in **JetBrains Mono**; every sentence in
  **Inter**. The split is absolute.
- Keep Inter at weight ≤600 — hierarchy comes from size, color, and spacing.
- Use semantic colors (emerald/amber/red) only as status signals, never as decoration.
- Reserve shadows for true overlays (popover, dropdown, dialog, toast). Everything at rest is flat +
  border.
- Strip every external catalog snippet to `var(--*)` tokens before merge.

### Don't

- Don't introduce a second brand accent. Indigo + Zinc + semantic status is the entire palette;
  Violet exists only in the one reserved gradient.
- Don't use the marketing **pill** button shape — buttons are `6px` rounded rectangles in this tool.
- Don't render the signature gradient anywhere but login / score-reveal / empty-state, and never at
  icon scale.
- Don't promote Inter to 700+. The display ceiling is 600.
- Don't set body sentences in JetBrains Mono, or data/numerics in Inter — the layer split is the
  technical voice.
- Don't pile a heavy drop-shadow on resting cards. Flat + hairline is the elevation.
- Don't echo a full secret/API key in the UI — keys are masked and write-only.
- Don't animate without honoring `prefers-reduced-motion`.
```
