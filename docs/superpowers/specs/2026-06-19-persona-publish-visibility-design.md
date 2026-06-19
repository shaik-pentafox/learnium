# Persona Publish + Trainee Visibility — Design

**Date:** 2026-06-19
**Branch:** `feature/persona-publish-visibility`
**Status:** Approved design, pre-implementation

## Problem

A trainee sees no personas, even after their trainer (or a super admin) creates
one. Reported case: super admin creates a Trainer → Trainer creates a Trainee
and a Persona → Trainee's persona list is empty.

### Root cause

`PersonasService.myPersonas(userId, role)` returns, for role `USER`, only the
user's legacy 1:1 `assignedPersona` relation (`User.assignedPersonaId`). Nothing
in the codebase ever writes `assignedPersonaId` (verified by grep), so it is
always null and the trainee always sees an empty list.

The intended model (per `docs/E2E_BACKEND_PLAN.md` §"Hierarchy & persona
visibility", lines 231–246) is a **publish gate + supervisor hierarchy**, which
was never implemented. The `Persona` table has no `isPublished` flag, and list
endpoints are not scoped by role.

### Secondary gaps found (in scope)

- `PersonasService.list(query)` is **not scoped by role** — any caller with
  `personas:read` (which trainees have) gets every persona.
- `PersonasService.findById(id)` has **no object-level access check** — a
  trainee can fetch any persona, including unpublished drafts, by id.
- `SessionsService.start(dto, userId)` has **no access check** — a trainee can
  start a roleplay session against any persona id (any owner, any draft).
- `PersonasService.update(id, ...)` likewise has no owner guard (a trainer can
  edit a super admin's persona). Fixing the update guard is in scope since it is
  the same predicate; publish content stays separate from the publish toggle.

The plan calls this out: object-level checks must be enforced in services, not
just guards (`docs/E2E_BACKEND_PLAN.md:651`).

## Confirmed facts

- `User.supervisorId` column exists. When a **trainer** creates a trainee,
  `users.service.ts:96` forces `supervisorId = actor.sub`. So in the reported
  case `trainee.supervisorId == trainer.id` and `persona.createdById ==
  trainer.id` — the visibility rule below will match once implemented.
- Persona owner = `Persona.createdById`.
- Roles: `SUPER_ADMIN`, `TRAINER`, `USER`. Trainee = `USER`.
- Frontend practice page (`apps/web/src/routes/_auth/practice/index.tsx`)
  already renders `data.personas` as an array — no change needed there once the
  backend returns the visible list.

## Visibility rule (single source of truth)

> A trainee (role `USER`) may see/use persona **P** iff:
> `P.isPublished && !P.isDeleted && P.createdById ∈ ({ trainee.supervisorId } ∪ { all SUPER_ADMIN user ids })`

Roles summary:

| Role | Sees |
|------|------|
| `SUPER_ADMIN` | all personas (any state) |
| `TRAINER` | own personas only (`createdById == self`), any state |
| `USER` (trainee) | published personas owned by own trainer **or** any super admin |

### Implementation of the rule

Build a Prisma `where` fragment rather than joining on owner role. Fetch the
small set of super-admin user ids once, then:

```
{
  isPublished: true,
  isDeleted: false,
  createdById: { in: [trainee.supervisorId, ...superAdminIds] },
}
```

`trainee.supervisorId` may be null (e.g. a trainee created directly by a super
admin with no supervisor set); filter it out of the `in` array when null. Super
admin personas remain visible regardless.

A reusable helper centralizes both forms:
- `traineeVisibleWhere(supervisorId, superAdminIds)` → Prisma `where` for lists.
- `assertTraineeCanAccess(persona, user)` → throws `ForbiddenException` for
  single-object checks (findById, session start), using the same predicate.

## Scope decisions

- **`publishedVersion` deferred.** Boolean `isPublished` only. A trainee always
  sees the persona's current published content; we do not pin a version. This is
  an explicit YAGNI decision, not an omission. Revisit if version pinning is
  needed later.
- **Dedicated publish endpoints**, not a raw `isPublished` field in the update
  DTO. `POST /personas/:id/publish` and `POST /personas/:id/unpublish`, owner-or-
  super-admin guarded. `create` carries an initial `isPublished` to back the
  "Save & publish" button. Keeps the publish toggle separate from content edits
  (which snapshot a version); avoids accidental publish on a content PATCH.
- Legacy `User.assignedPersonaId` 1:1 relation is left in the schema (not
  removed) but no longer used for trainee visibility. Removal is out of scope.

## Backend changes

### Schema + migration
- Add `Persona.isPublished Boolean @default(false)`.
- Prisma migration `add_persona_published`.

### `PersonasService`
- `myPersonas(user)`:
  - `SUPER_ADMIN` → all (existing `list` path).
  - `TRAINER` → own personas (`createdById == user.sub`), any state.
  - `USER` → `traineeVisibleWhere(...)`.
- `list(query, actor)`: add `actor`, scope by role identically (fixes the
  unscoped-list bug). Pagination/search preserved.
- `findById(id, actor)`: after load, `assertTraineeCanAccess` for `USER`;
  trainer restricted to own; super admin unrestricted.
- `create(dto, actor)`: accept `isPublished` (default false) → persists initial
  state.
- `publish(id, actor)` / `unpublish(id, actor)`: load persona; allow only owner
  (`createdById == actor.sub`) or `SUPER_ADMIN`; set `isPublished`.
- `update(id, dto, actor)`: add owner-or-super-admin guard (same predicate);
  behavior otherwise unchanged (still snapshots a version, replaces criteria).
  Does **not** touch `isPublished`.

### `PersonasController`
- Pass `actor` (CurrentUser) into `list` and `findById`.
- `POST /personas/:id/publish` and `POST /personas/:id/unpublish`
  (`@Permissions('personas:write')`).
- `CreatePersonaDtoSchema` gains optional `isPublished: boolean` (default false).

### `SessionsService.start`
- Before creating the session, for role `USER` enforce the trainee visibility
  predicate against `dto.personaId`; trainer/super admin may start against own /
  any (simulation). Reject with `ForbiddenException` otherwise.

## Frontend changes

### `apps/web/src/services/personas.ts`
- Add `isPublished` to `Persona` / `PersonaSummary` / payload types.
- `createPersona(input, publish: boolean)` (or carry `isPublished` on input).
- `publishPersona(id)` / `unpublishPersona(id)` calling the new endpoints.
- Fix the stale `listMyPersonas` comment ("assigned persona" → visibility rule).

### `apps/web/src/components/personas/persona-builder.tsx`
- Replace the single submit button with **Save as draft** and **Save & publish**.
- Edit mode: a publish/unpublish toggle reflecting current `isPublished`.

### `apps/web/src/routes/_auth/personas/index.tsx`
- Draft / Published badge per persona row.

### Practice page
- No change (already array-ready). Verify it now shows the visible personas.

## Testing

- Backend: trainer creates trainee + draft persona → trainee sees nothing;
  trainer publishes → trainee sees it; super admin publishes a persona →
  trainee (under any trainer) sees it; trainee cannot `findById` / `start` an
  unpublished or other-trainer persona (403); trainer cannot edit/publish a
  super admin persona; super admin sees all.
- Frontend: builder save-as-draft vs save-&-publish; badge renders; practice
  list populates.

## Out of scope

- `publishedVersion` / version pinning.
- Removing `User.assignedPersonaId`.
- Transitive supervisor chains (single-level supervisor only).
