# ALFA Traineon — Frontend Implementation Plan (React)

Companion to [PRODUCT_PLAN.md](./PRODUCT_PLAN.md), [BACKEND_PLAN.md](./BACKEND_PLAN.md), and [DEV_STRATEGY.md](./DEV_STRATEGY.md) (authoritative). The frontend is a **React SPA** living at `apps/web` in the same **npm-workspaces** monorepo, consuming the typed contracts from `packages/contracts` and the `/api/v1` backend.

> **Scope alignment with DEV_STRATEGY:** core is **text roleplay over WebSocket**. Voice (§F3) and **gamification** (leaderboard/badges/streaks, §F4) are **deferred** — built only after the core chat + dashboards loop ships. Persona visibility follows the **owner + publish** model (trainee sees only their trainer's *published* personas), not `isPublic`. Gamification screens/components below stay in the plan as the deferred target, not v1 work.

**Design bar: clean and professional.** Dense-but-breathable admin surfaces, restrained color, consistent spacing/typography, dark + light themes. Animation is purposeful (state transitions, voice feedback), never decorative noise.

---

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | React 19 + Vite 6 | SPA; SSR not needed for an authenticated tool |
| Language | TypeScript 5.x strict | shared tsconfig base from the monorepo |
| Routing | TanStack Router | fully typed routes, search-param state (filters/pagination in the URL), route-level auth guards, code splitting per route |
| Server state | **TanStack Query v5** ([docs](https://tanstack.com/query/latest)) | the only home for server data — queries/mutations, optimistic updates, cache invalidation, retries, `staleTime`/`gcTime` policy; centralized `queryKeys` factory; mutation success/error → react-hot-toast; no server data in Zustand |
| Client state | Zustand | auth/session slice, UI slice (sidebar, theme, modals), live-session slice (WS status, audio state); small focused stores, immutable updates |
| HTTP | Axios | single instance; interceptors: auth header, envelope unwrap, 401 → refresh-token rotation + replay, error normalization |
| Forms | react-hook-form + `@hookform/resolvers/zod` | same Zod schemas as the backend via `packages/contracts` — client and server validate identically |
| UI system | **shadcn/ui** + Tailwind CSS v4 | components vendored into the repo (full ownership), CVA variants, CSS-vars theming |
| Tables | **tablecn** patterns (shadcn + TanStack Table) | server-side pagination/sort/filter wired to URL search params |
| Animation | **motion-primitives** + Framer Motion | page/list transitions, micro-interactions |
| Rich/marketing accents | **21st.dev, Aceternity UI, ReactBits, shadcnspace** | reference catalogs — copy, strip to the design tokens, keep it professional; login/empty states/dashboard accents only |
| Voice & agent UI | **ElevenLabs UI** (`@elevenlabs/ui`) | waveform visualizers, voice-chat surfaces, audio playback — base for the roleplay voice session screen (transport stays our own WS, not ElevenLabs services) |
| Skeletons / loaders | **Boneyard** ([boneyard.vercel.app](https://boneyard.vercel.app/overview)) | content-shaped skeleton loaders for tables, cards, dashboards, chat history; tokenized to theme colors (`--muted` base, shimmer in brand accent); the default for any data-fetch wait |
| Toasts / notifications | **react-hot-toast** | global `<Toaster>` in `__root.tsx`; mutation feedback, normalized API errors, connection/reconnect advisories; hosts custom JSX (deferred `BadgeToast` celebrate animation renders as a custom toast) |
| Charts | Recharts (shadcn charts) | analytics + LLM cost dashboards |
| Icons | lucide-react | shadcn default |
| WS client | native WebSocket wrapper | typed protocol from `packages/contracts`; ticket auth, heartbeat, exponential-backoff reconnect implementing the backend resume contract |
| Audio | Web Audio API + AudioWorklet | mic capture → PCM16 frames; jitter-buffered playback; ElevenLabs UI components for visualization |
| Testing | Vitest + React Testing Library + MSW; Playwright E2E | MSW mocks generated from the OpenAPI contract |
| Lint/format | ESLint (typescript-eslint strict) + Prettier + Tailwind plugin | shared monorepo config |

### MCP servers (AI-assisted development)

| Server | Use |
|---|---|
| **shadcn MCP** (official) | search/install components from the shadcn registry and compatible registries (shadcnspace etc.) directly from the editor |
| **21st.dev Magic MCP** | generate/refine components from the 21st.dev catalog |

Registry-compatible sources (Aceternity, motion-primitives, shadcnspace) get wired into `components.json` so `shadcn add` + MCP cover most component acquisition.

---

## 2. Structure

```
apps/web/
├── src/
│   ├── main.tsx                    # provider tree: QueryClientProvider → RouterProvider
│   │                               #   → ThemeProvider → react-hot-toast <Toaster>
│   ├── routes/                     # TanStack Router file-based routes
│   │   ├── __root.tsx              # shell: role-aware sidebar, header; mounts <Toaster>
│   │   ├── login.tsx
│   │   ├── _auth/                  # authenticated layout (route guard)
│   │   │   ├── dashboard.tsx       # role-aware: trainee KPIs vs trainer vs admin
│   │   │   ├── users/              # list, detail drawer, create/edit, bulk import
│   │   │   ├── personas/           # list, builder (instructions, scoring, voice,
│   │   │   │                       #   model roles), version history, publish, playground (E3)
│   │   │   ├── roleplay/           # session launcher, chat session,
│   │   │   │                       #   feedback & score reveal  (voice = deferred)
│   │   │   ├── analytics/          # user/persona dashboards, exports
│   │   │   ├── llm-ops/            # provider/model registry + BYOK key mgmt (E6), usage & cost
│   │   │   ├── settings/           # profile, roles admin
│   │   │   ├── leaderboard/        # DEFERRED (gamification) — global / my-trainees, period switcher
│   │   │   └── badges/             # DEFERRED (gamification) — badge shelf, catalog, notifications
│   ├── components/
│   │   ├── ui/                     # vendored shadcn primitives (owned, themed)
│   │   ├── data-table/             # tablecn-based server-side table kit
│   │   ├── feedback/               # Boneyard skeletons (TableSkeleton, CardSkeleton,
│   │   │   │                       #   DashboardSkeleton, ChatHistorySkeleton),
│   │   │   │                       #   empty states, error states, route fallback
│   │   │   └── toast.tsx           # react-hot-toast wrappers + custom toast renderers
│   │   ├── charts/                 # themed Recharts wrappers
│   │   ├── voice/                  # DEFERRED — ElevenLabs-UI waveform, mic, audio player
│   │   └── gamification/           # DEFERRED — LeaderboardTable/Row, OwnRankCard,
│   │                               #   PerformanceScoreCard, BadgeShelf/Catalog/Card,
│   │                               #   BadgeToast (custom react-hot-toast), StreakCalendar/Counter,
│   │                               #   PeriodSwitcher
│   ├── features/                   # feature logic co-located per domain (mirrors backend modules)
│   │   └── <domain>/               # api.ts      — axios calls (envelope-unwrapped)
│   │                               # queries.ts  — TanStack useQuery/useMutation hooks
│   │                               # keys.ts     — domain query-key factory
│   │                               # components/, hooks/
│   ├── stores/                     # zustand (client state only): auth.ts, ui.ts, live-session.ts
│   ├── lib/
│   │   ├── query-client.ts         # QueryClient singleton: default staleTime/gcTime,
│   │   │                           #   retry policy, global onError → toast
│   │   ├── query-keys.ts           # root query-key namespaces (composed by feature keys.ts)
│   │   ├── api-client.ts           # axios instance + interceptors (auth, envelope, 401-refresh)
│   │   ├── toast.ts                # react-hot-toast helpers: success/error/promise, themed options
│   │   ├── ws-client.ts            # typed WS wrapper, reconnect + resume
│   │   ├── audio/                  # DEFERRED — worklets, PCM16 encode/decode, playback queue
│   │   └── utils.ts
│   └── styles/                     # tailwind entry, theme tokens (CSS vars)
└── tests/                          # vitest unit + Playwright e2e
```

Rules: routes compose features; features own their API calls, query hooks, and **query-key factories**; `components/` is domain-free; **server data lives in TanStack Query only** (Zustand never caches API responses); every fetch wait renders a **Boneyard skeleton**, every mutation result surfaces through **react-hot-toast**.

---

## 3. Design System

**Design direction (chosen): "Linear" archetype — Zinc + Violet/Indigo.** Set `globals.css` token set in Phase F0. **Both dark and light themes are first-class — neither is an afterthought.** Define every token (`--background`, `--surface`, `--border`, `--foreground`, `--muted`, `--primary`, status colors) under both `:root` (light) and `.dark`, with shadcn CSS-vars theming:
- **Dark**: `zinc-950` bg / `zinc-900` surface, `zinc-800` borders, brand accent `indigo-500`.
- **Light**: `white`/`zinc-50` bg / `white` surface, `zinc-200` borders, `zinc-900` text, brand accent `indigo-600` (one step darker for AA contrast on light).
- Borders carry structure in both themes (subtle `1px` over drop shadows); accent used sparingly (active-tab glow, primary CTA, deferred `BadgeToast`).

Theme is toggleable and persisted (UI Zustand slice → `localStorage`), defaults to system (`prefers-color-scheme`), applied via the `.dark` class on `<html>` with no flash on load (inline pre-hydration script). Reference archetypes if the bar shifts: **Vercel** (stark black/white, blue accent), **Stripe** (slate undertone, soft shadows, emerald/cobalt accent). Whichever is picked, external snippets are stripped to `var(--primary)` / `var(--radius)` before merge — and verified in **both** themes.

- **Tokens first**: neutral base palette (zinc default; slate if the warmer Stripe direction is taken), one brand accent, semantic status colors; spacing/radius/typography scales as CSS variables; dark + light from day one.
- **Data-layer typography**: **JetBrains Mono** for all numeric/data surfaces — global rank (`12 / 470`), token counts, latency, performance scores — monospace prevents layout jitter on live updates. **Inter** for everything else, disciplined weights (`font-normal` body, `font-medium` labels, bold reserved for page titles).
- **Density**: shadcn `Card` with reduced padding on dashboards; LLM-ops Recharts hide gridlines/axes until hover; performance-score ring = crisp SVG donut (`zinc-800` track, accent progress, score in JetBrains Mono).
- **Typography**: Inter (UI) + JetBrains Mono (IDs, tokens, logs). Tight, consistent hierarchy — page title / section / body / caption.
- **Layout**: fixed sidebar navigation (collapsible), top bar with breadcrumbs + user menu; content max-width on forms, full-bleed on tables/dashboards.
- **Component discipline**: every external snippet (21st.dev / Aceternity / ReactBits) is re-themed to tokens before merge — no one-off colors, shadows, or fonts. Flashy effects allowed only on login and empty states, and subtle.
- **Accessibility**: WCAG AA contrast, full keyboard navigation, focus rings, `prefers-reduced-motion` respected by all animation.
- **Voice session screen** is the showcase: persona avatar, live waveform (ElevenLabs UI), speaking/listening indicator, captions stream, elapsed timer, end-session → animated score reveal. Professional, not gimmicky.

---

## 4. Roles & Navigation

Three roles drive what renders in the sidebar and what routes are accessible.

| Nav item | Super Admin | Trainer | User (Trainee) |
|---|---|---|---|
| Dashboard | ✓ (org KPIs + system health) | ✓ (supervisee KPIs + at-risk users) | ✓ (own score card + streak) |
| Leaderboard | ✓ (global) | ✓ (global + my trainees) | ✓ (global) |
| My Badges | ✓ | ✓ | ✓ |
| Practice (Roleplay) | ✓ | ✓ | ✓ |
| Personas | ✓ | ✓ (build + manage + playground) | — |
| Users | ✓ | ✓ (view supervisees) | — |
| Analytics | ✓ (global) | ✓ (supervisees) | — |
| LLM Ops | ✓ | — | — |
| Settings | ✓ | profile only | profile only |

Route guards in TanStack Router check `user.role` from the auth store; forbidden routes redirect to dashboard. Server also enforces on every request.

---

## 5. Key Screens (v1)

| Screen | Role(s) | Notes |
|---|---|---|
| Login | all | credential form, error states; clean brand moment (single tasteful animated accent) |
| **Dashboard — Trainee** | USER | Performance score ring (current month), global rank (e.g. "12 / 470"), badge shelf, streak counter, last 5 sessions with scores, "Start Practice" CTA, weakest-criterion callout |
| **Dashboard — Trainer** | TRAINER | My Trainees leaderboard preview (top 5 + full link), supervisee avg score + completion rate, at-risk users flagged (low completion / declining scores) |
| **Dashboard — Admin** | SUPER_ADMIN | Org-wide KPIs (WAU, sessions today, avg score, active streaks), LLM cost sparkline, system health tiles (API latency, WS sessions live, job queue depth) |
| **Leaderboard** | all | Period switcher (weekly / monthly / all-time); ranked table with avatars, score bars, badge chips; own row pinned at bottom if outside top 50; global / my-trainees scope selector (my-trainees for Trainer/Admin only) |
| **Badge Catalog & Profile** | all | Full badge grid (earned in color, locked greyed); earned date and triggering session; notification dot for unread; badge-earned toast animation on new award |
| Users | SUPER_ADMIN, TRAINER | server-side data table (search/filter/sort/paginate in URL), detail drawer, create/edit, bulk-import wizard with progress + error report |
| Personas | SUPER_ADMIN, TRAINER | card/list browse; builder (identity, instructions, scoring criteria, voice style, model roles from registry; `isPublic` + trainee assignment); version history diff view; **testing playground** (E3): pick a version → chat panel + running token/cost meter + "Run scoring" button, unmistakable simulation banner |
| Roleplay — chat | all | streaming messages, typing indicator, emotion/emoji surface, reconnect banner, end-session → animated feedback + per-criterion score reveal |
| Roleplay — voice | all | mic permission flow, live waveform, interruption handling, captions, post-session feedback + score reveal |
| Analytics | SUPER_ADMIN, TRAINER | filterable dashboards (user/persona/version), chart kit, Excel export |
| LLM Ops | SUPER_ADMIN | provider/model registry CRUD; **BYOK key management** (E6): masked key entry, per-key rpm/tpm + health status (ok / rate-limited / auth-failed), verify button; usage/cost charts (incl. playground spend), model-promotion status |
| Settings | all | profile + avatar; roles admin (Super Admin only) |

---

## 6. Cross-Cutting Behaviors

- **Auth flow**: access token in memory (Zustand, never localStorage), refresh token in httpOnly cookie; axios interceptor refreshes on 401 and replays; router guard redirects to login; idle logout.
- **Realtime resume**: WS drop → auto-reconnect with session id + last message id (backend contract §3.4 of BACKEND_PLAN); UI shows degraded-connection banner, never loses transcript.
- **Data layer (TanStack Query)**: every server read is a `useQuery`; every write a `useMutation` that invalidates the affected query keys (or applies an optimistic update + rollback). Query keys come from per-feature `keys.ts` factories composed off `lib/query-keys.ts` — no inline string keys. `QueryClient` defaults (`staleTime`, `gcTime`, retry, global `onError`) live in `lib/query-client.ts`. URL search params (TanStack Router) are the source of truth for table pagination/filter/sort and feed straight into query keys, so refresh/bookmark restore state.
- **Errors**: normalized from the envelope; field errors land on forms via react-hook-form, everything else via **react-hot-toast** (`toast.error`); per-route error boundary with retry; the query client's global `onError` is the backstop.
- **Loading**: **Boneyard** content-shaped skeletons for tables, cards, dashboards, and chat history (route-level + per-query `isPending`); inline spinner only for button-bound mutations; `toast.promise` for long async (export, bulk import) and LLM-wait moments.
- **Permissions**: role from the session drives nav visibility and action gating (see §4 table); server enforces on every request.
- **Badge notifications**: on app load and after session end, poll `/badges/me/unseen`; new badges trigger `BadgeToast` (Framer Motion celebrate animation, 4 s duration) and update the sidebar badge-count dot. PATCH `/badges/me/seen` on dismiss.
- **i18n-ready**: strings centralized from day one, even if v1 ships English-only.

---

## 7. Testing

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest + RTL | stores, hooks, form validation, table/url-state logic |
| Component | Vitest + RTL + MSW | features against contract-generated mocks |
| E2E | Playwright | login → run chat session → end → see score; users CRUD; persona build; provider admin |
| Visual sanity | Playwright screenshots on key screens | catches theme/regression drift |

80% coverage gate on `src/features` and `src/lib`; MSW handlers generated from the OpenAPI spec so frontend tests break when the contract drifts.

---

## 8. Delivery Phases (tracks backend phases)

### Phase F0 — Foundation (parallel with backend Phase 1)
Vite + TanStack Router/Query scaffold in `apps/web`; Tailwind v4 + shadcn init + token system + dark/light; axios client + envelope/refresh interceptors; Zustand stores; MCP servers configured (shadcn, 21st.dev) + registries in `components.json`; CI (lint, typecheck, unit); Storybook-lite (or route playground) for the component kit.

**Exit:** themed shell with auth guard renders against mocked API.

### Phase F1 — Identity surfaces (backend Phase 1–2)
Login + session flow against real auth; **role-aware** app shell (sidebar hides irrelevant nav by role); users data-table (tablecn) with URL state; user create/edit + role gating + supervisor assignment; bulk-import wizard; settings (roles matrix).

**Exit:** full user-management workflows live.

### Phase F2 — Personas & roleplay chat (backend Phase 2–3)
Persona browse + builder + version history + `isPublic`/assignment controls; persona testing playground panel (E3: chat + token/cost meter + run-scoring, simulation banner); session launcher; chat session screen with streaming WS, reconnect banner, end-session + feedback/score reveal.

**Exit:** complete text roleplay loop in the browser; persona playground usable.

### Phase F3 — Voice (backend Phase 3)
Audio pipeline (worklet capture → PCM16 frames → WS; jitter-buffered playback); voice session screen on ElevenLabs UI components (waveform, indicators, captions); interruption + reconnect handling; cross-browser audio QA (Chrome/Edge/Safari).

**Exit:** voice roleplay end-to-end.

### Phase F4 — Dashboard, analytics, LLM ops + gamification (backend Phase 4)
Trainee + trainer dashboard pages (E2); analytics dashboards + chart kit + exports; LLM ops admin (registry CRUD, **BYOK key management** with masked entry + per-key health, usage/cost incl. playground spend). **Gamification screens**: leaderboard (global + my-trainees, period switcher, own-row pinning), badge catalog + shelf, streak calendar, role-aware dashboards, `BadgeToast` celebrate animation, badge notification dot.

**Exit:** the in-scope feature set + full gamification UI live.

### Phase F5 — Polish & launch (backend Phase 5)
Playwright E2E suite green; accessibility pass (keyboard, contrast, reduced motion); performance pass (route-level code splitting, bundle budget < 300 KB initial gz, chart lazy-load); empty/error/loading state sweep; visual QA against the design bar; cutover with the backend parallel run.

---

## 9. Key Decisions & Trade-offs

| Decision | Choice | Why |
|---|---|---|
| Framework | React SPA (Vite), not Next.js | authenticated internal product — no SEO/SSR need; simpler deploy (static + API) |
| Router | TanStack Router | typed routes + URL-as-state for tables/filters beats react-router here |
| State split | TanStack Query (server) / Zustand (client) | no duplication; each tool at its strength |
| UI ownership | shadcn vendored components | full control, themeable, no library lock-in; reference catalogs feed it |
| External components | re-themed to tokens before merge | "clean, professional" survives contact with flashy catalogs |
| Voice UI | ElevenLabs UI components, own transport | best OSS audio/agent components; our WS protocol unchanged |
| Contract safety | Zod from `packages/contracts` + OpenAPI-generated MSW mocks | compile-time + test-time drift protection |
| MCP | shadcn MCP + 21st.dev Magic MCP | fastest component acquisition path inside the chosen ecosystem |
