# Persona Publish + Trainee Visibility (Arena) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trainees see and roleplay published personas owned by their trainer or any super admin, via a trainee-only **Arena**; owners author drafts and test their own personas with distinct simulation sessions.

**Architecture:** Add a publish flag to `Persona` and a simulation flag to `Session`. Centralize a single trainee-visibility predicate in `PersonasService` and reuse it for list, detail, and session-start authorization. Replace the dead `assignedPersona` 1:1 path. Frontend splits the launcher (Arena, trainee-only) from the chat route (any authenticated user) and adds draft/publish + owner Test controls.

**Tech Stack:** NestJS 11 (Fastify), Prisma + PostgreSQL, Zod DTOs, React + TanStack Router/Query, Vitest + MSW.

## Global Constraints

- Strict TS: never `{ ...dto }` spread into Prisma — build explicit `data` with conditional spreads (`if (x !== undefined)`, `if ('k' in dto) data.k = dto.k ?? null`).
- DTO validation via inline `Schema.safeParse(body)` → `ValidationException` (no Nest pipes).
- Object-level access enforced in **services**, not just guards.
- Commit format `feat(<scope>): ...` / `fix(...)` / `docs(...)`. **Never** append `Co-Authored-By` (user rule).
- Verification per task: `npm run typecheck` (api) / `npm run typecheck` (web) must pass; backend behavior verified by the curl block in the task; web service logic by `npm run test` where a test is specified.
- Roles: `SUPER_ADMIN`, `TRAINER`, `USER` (trainee). Owner of a persona = `Persona.createdById`.
- API working dir: `apps/api`. Web working dir: `apps/web`. Repo root: `/Users/sivivicky/Dev/on-going/traineon`.

## File structure

Backend (`apps/api`):
- `prisma/schema.prisma` — add `Persona.isPublished`, `Session.isSimulation`.
- `prisma/migrations/<ts>_add_persona_published_and_session_simulation/` — generated.
- `src/modules/personas/persona-access.ts` — **new**: visibility predicate + where-builder.
- `src/modules/personas/personas.service.ts` — role-scoped list/my/findById, create flag, publish/unpublish, update guard.
- `src/modules/personas/personas.controller.ts` — pass actor, publish/unpublish routes.
- `src/modules/personas/dto/persona.dto.ts` — `isPublished` on create.
- `src/modules/sessions/sessions.service.ts` — simulation + auth in `start`.
- `src/modules/sessions/sessions.controller.ts` — pass full actor, parse `simulation`.
- `src/modules/sessions/dto/session.dto.ts` — `simulation` on start.

Frontend (`apps/web`):
- `src/services/personas.ts` — `isPublished` types, publish/unpublish, create flag.
- `src/services/roleplay.ts` — `startSession(personaId, opts)`.
- `src/components/personas/persona-builder.tsx` — draft/publish buttons + toggle.
- `src/routes/_auth/personas/index.tsx` — badge + Test button.
- `src/routes/_auth/arena/index.tsx` — **moved** from `practice/index.tsx`.
- `src/routes/_auth/session/$uid.tsx` — **moved** from `practice/$uid.tsx`.
- `src/components/layout/app-sidebar.tsx` — Arena nav, `roles: ['USER']`.
- chat page (the moved `session/$uid.tsx`) — simulation banner.

---

## Task 1: Schema — isPublished + isSimulation + migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (`model Persona`, `model Session`)

**Interfaces:**
- Produces: `Persona.isPublished: boolean` (default false), `Session.isSimulation: boolean` (default false).

- [ ] **Step 1: Add `isPublished` to Persona**

In `model Persona`, after the existing `color` line (`color String?`), add:

```prisma
  isPublished         Boolean   @default(false)
```

- [ ] **Step 2: Add `isSimulation` to Session**

In `model Session`, after the `feedback String?` line, add:

```prisma
  isSimulation Boolean       @default(false)
```

- [ ] **Step 3: Generate migration**

Run (from `apps/api`):
```bash
npx prisma migrate dev --name add_persona_published_and_session_simulation
```
Expected: new folder `prisma/migrations/<ts>_add_persona_published_and_session_simulation/` with `ALTER TABLE "personas" ADD COLUMN "isPublished"` and `ALTER TABLE "sessions" ADD COLUMN "isSimulation"`; Prisma Client regenerated.

> Note: an unrelated untracked migration `20260619052252_add_persona_color` from prior work may exist. Do **not** delete it; only stage this task's new files.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck` (in `apps/api`)
Expected: PASS (Prisma types now include `isPublished`, `isSimulation`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/*_add_persona_published_and_session_simulation
git commit -m "feat(personas): add isPublished + Session.isSimulation columns"
```

---

## Task 2: Persona access predicate (new module)

**Files:**
- Create: `apps/api/src/modules/personas/persona-access.ts`

**Interfaces:**
- Consumes: `PrismaService`, `Prisma`.
- Produces:
  - `async superAdminUserIds(prisma: PrismaService): Promise<number[]>`
  - `traineeVisibleWhere(supervisorId: number | null, superAdminIds: number[]): Prisma.PersonaWhereInput`
  - `canTraineeAccess(persona: { isPublished: boolean; isDeleted: boolean; createdById: number | null }, supervisorId: number | null, superAdminIds: number[]): boolean`

- [ ] **Step 1: Write the module**

Create `apps/api/src/modules/personas/persona-access.ts`:

```typescript
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/database/prisma.service';

/** Ids of all SUPER_ADMIN users — their published personas are visible to every trainee. */
export async function superAdminUserIds(prisma: PrismaService): Promise<number[]> {
  const rows = await prisma.user.findMany({
    where: { role: { name: 'SUPER_ADMIN' }, isDeleted: false },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Owner ids a trainee may see published personas from: their supervisor + all super admins. */
function visibleOwnerIds(supervisorId: number | null, superAdminIds: number[]): number[] {
  const ids = new Set<number>(superAdminIds);
  if (supervisorId != null) ids.add(supervisorId);
  return [...ids];
}

/** Prisma `where` for the published personas a trainee may list. */
export function traineeVisibleWhere(
  supervisorId: number | null,
  superAdminIds: number[],
): Prisma.PersonaWhereInput {
  return {
    isDeleted: false,
    isPublished: true,
    createdById: { in: visibleOwnerIds(supervisorId, superAdminIds) },
  };
}

/** Single-object form of the same predicate (detail / session-start checks). */
export function canTraineeAccess(
  persona: { isPublished: boolean; isDeleted: boolean; createdById: number | null },
  supervisorId: number | null,
  superAdminIds: number[],
): boolean {
  if (!persona.isPublished || persona.isDeleted || persona.createdById == null) return false;
  return visibleOwnerIds(supervisorId, superAdminIds).includes(persona.createdById);
}
```

> Verify the `User` model relation to role is named `role` with `.name` (it is — see `users.service.ts` `role: { name: ... }`). If the field differs, match it.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` (in `apps/api`)
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/personas/persona-access.ts
git commit -m "feat(personas): add trainee visibility predicate helpers"
```

---

## Task 3: PersonasService — role scoping, publish, guards

**Files:**
- Modify: `apps/api/src/modules/personas/personas.service.ts`

**Interfaces:**
- Consumes: helpers from Task 2; `JwtPayload` (`{ sub: number; role: string }`).
- Produces (new/changed signatures used by Task 4):
  - `myPersonas(user: { sub: number; role: string })`
  - `list(query: PersonaQueryDto, actor: { sub: number; role: string })`
  - `findById(id: number, actor: { sub: number; role: string })`
  - `create(dto: CreatePersonaDto, createdById: number)` — now reads `dto.isPublished`
  - `publish(id: number, actor: { sub: number; role: string })`
  - `unpublish(id: number, actor: { sub: number; role: string })`
  - `update(id, dto, actor)` — owner guard added

- [ ] **Step 1: Add imports**

At the top of `personas.service.ts`, add to the existing imports:

```typescript
import { ForbiddenException } from '../../core/errors/domain.errors';
import {
  superAdminUserIds,
  traineeVisibleWhere,
  canTraineeAccess,
} from './persona-access';
```

> Confirm `ForbiddenException` is exported from `core/errors/domain.errors` (it is used in `users.service.ts`). If named differently there, match that name.

- [ ] **Step 2: Add a private owner-guard + supervisor lookup helper**

Inside the `PersonasService` class, add:

```typescript
  /** Owner (creator) or any super admin may mutate / test a persona. */
  private async assertCanManage(personaCreatedById: number | null, actor: { sub: number; role: string }) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (personaCreatedById !== actor.sub) {
      throw new ForbiddenException('You can only modify your own personas');
    }
  }

  private async supervisorIdOf(userId: number): Promise<number | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { supervisorId: true },
    });
    return u?.supervisorId ?? null;
  }
```

- [ ] **Step 3: Rewrite `myPersonas`**

Replace the existing `myPersonas` method body with:

```typescript
  async myPersonas(user: { sub: number; role: string }) {
    if (user.role === 'SUPER_ADMIN') {
      return this.list({ page: 1, limit: 100 }, user);
    }
    if (user.role === 'TRAINER') {
      const personas = await this.prisma.persona.findMany({
        where: { isDeleted: false, createdById: user.sub },
        include: PERSONA_INCLUDE,
        orderBy: { createdAt: 'desc' },
      });
      return { personas, total: personas.length };
    }
    // Trainee (USER): published personas of own trainer or any super admin.
    const [supervisorId, superAdminIds] = await Promise.all([
      this.supervisorIdOf(user.sub),
      superAdminUserIds(this.prisma),
    ]);
    const personas = await this.prisma.persona.findMany({
      where: traineeVisibleWhere(supervisorId, superAdminIds),
      include: PERSONA_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return { personas, total: personas.length };
  }
```

- [ ] **Step 4: Scope `list` by role**

Change the `list` signature to accept `actor` and merge a role scope into `where`. Replace the method header and the `where` construction:

```typescript
  async list(query: PersonaQueryDto, actor: { sub: number; role: string }) {
    const { page, limit, q } = query;
    const skip = (page - 1) * limit;

    const search: Prisma.PersonaWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: Prisma.QueryMode.insensitive } },
            { description: { contains: q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {};

    let scope: Prisma.PersonaWhereInput;
    if (actor.role === 'SUPER_ADMIN') {
      scope = { isDeleted: false };
    } else if (actor.role === 'TRAINER') {
      scope = { isDeleted: false, createdById: actor.sub };
    } else {
      const [supervisorId, superAdminIds] = await Promise.all([
        this.supervisorIdOf(actor.sub),
        superAdminUserIds(this.prisma),
      ]);
      scope = traineeVisibleWhere(supervisorId, superAdminIds);
    }

    const where: Prisma.PersonaWhereInput = { AND: [scope, search] };
```

Keep the rest of `list` (the `Promise.all([findMany, count])` and return) unchanged.

- [ ] **Step 5: Guard `findById`**

Change `findById` to accept `actor` and enforce access:

```typescript
  async findById(id: number, actor: { sub: number; role: string }) {
    const persona = await this.prisma.persona.findUnique({
      where: { id, isDeleted: false },
      include: PERSONA_INCLUDE,
    });
    if (!persona) throw new NotFoundException('Persona', id);
    if (actor.role === 'SUPER_ADMIN') return persona;
    if (actor.role === 'TRAINER') {
      if (persona.createdById !== actor.sub) throw new NotFoundException('Persona', id);
      return persona;
    }
    const [supervisorId, superAdminIds] = await Promise.all([
      this.supervisorIdOf(actor.sub),
      superAdminUserIds(this.prisma),
    ]);
    if (!canTraineeAccess(persona, supervisorId, superAdminIds)) {
      throw new NotFoundException('Persona', id);
    }
    return persona;
  }
```

> `update`, `softDelete`, `getVersions`, `getVersion`, and the controller `enhance` all call `this.findById(id)` today. Update those internal calls to pass an actor. For internal (already-authorized) service calls, pass a super-admin-equivalent actor to avoid double-checking: define a private getter that returns the persona without re-checking. Simplest: add a private `loadOrThrow(id)` that does the unchecked find+include+404, and have `update`/`softDelete`/`getVersions`/`getVersion` call `loadOrThrow`; keep `findById(id, actor)` for the controller. Implement `loadOrThrow`:

```typescript
  private async loadOrThrow(id: number) {
    const persona = await this.prisma.persona.findUnique({
      where: { id, isDeleted: false },
      include: PERSONA_INCLUDE,
    });
    if (!persona) throw new NotFoundException('Persona', id);
    return persona;
  }
```

Replace internal `await this.findById(id)` calls in `update`, `softDelete`, `getVersions`, `getVersion` with `await this.loadOrThrow(id)`. The final `return this.findById(id)` at the end of `update` → `return this.loadOrThrow(id)`.

- [ ] **Step 6: `create` reads `isPublished`**

In `create`, add the publish flag to the `data` object (after the `color` conditional):

```typescript
          isPublished: dto.isPublished ?? false,
```

- [ ] **Step 7: Owner guard in `update`**

At the very start of `update(id, dto, actor)`, change the signature to take `actor: { sub: number; role: string }` and load + guard:

```typescript
  async update(id: number, dto: UpdatePersonaDto, actor: { sub: number; role: string }) {
    const existing = await this.loadOrThrow(id);
    await this.assertCanManage(existing.createdById, actor);
```

Replace remaining `updatedById` references with `actor.sub` (the old param name was `updatedById`). The version snapshot and criteria logic are unchanged.

- [ ] **Step 8: `publish` / `unpublish`**

Add two methods:

```typescript
  async publish(id: number, actor: { sub: number; role: string }) {
    const persona = await this.loadOrThrow(id);
    await this.assertCanManage(persona.createdById, actor);
    return this.prisma.persona.update({
      where: { id },
      data: { isPublished: true, updatedById: actor.sub },
      include: PERSONA_INCLUDE,
    });
  }

  async unpublish(id: number, actor: { sub: number; role: string }) {
    const persona = await this.loadOrThrow(id);
    await this.assertCanManage(persona.createdById, actor);
    return this.prisma.persona.update({
      where: { id },
      data: { isPublished: false, updatedById: actor.sub },
      include: PERSONA_INCLUDE,
    });
  }
```

- [ ] **Step 9: `softDelete` guard**

`softDelete(id, deletedById)` → add actor guard. Change signature to `softDelete(id: number, actor: { sub: number; role: string })`, body:

```typescript
    const persona = await this.loadOrThrow(id);
    await this.assertCanManage(persona.createdById, actor);
    await this.prisma.persona.update({
      where: { id },
      data: { isDeleted: true, updatedById: actor.sub },
    });
```

- [ ] **Step 10: Typecheck**

Run: `npm run typecheck` (in `apps/api`)
Expected: errors only in `personas.controller.ts` (call-site arity) — fixed in Task 4. If errors appear elsewhere, fix them here. Service file itself must be clean.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/personas/personas.service.ts
git commit -m "feat(personas): role-scoped visibility, publish/unpublish, owner guards"
```

---

## Task 4: PersonasController — actor wiring + publish routes + DTO

**Files:**
- Modify: `apps/api/src/modules/personas/personas.controller.ts`
- Modify: `apps/api/src/modules/personas/dto/persona.dto.ts`

**Interfaces:**
- Consumes: Task 3 service methods.
- Produces: `POST /personas/:id/publish`, `POST /personas/:id/unpublish`; `isPublished` accepted on `POST /personas`.

- [ ] **Step 1: DTO — add `isPublished` to create**

In `persona.dto.ts`, inside `CreatePersonaDtoSchema`, add:

```typescript
  isPublished: z.boolean().optional(),
```

- [ ] **Step 2: Controller — pass actor to `my`, `list`, `findOne`**

- `myPersonas`: `return this.personasService.myPersonas({ sub: user.sub, role: user.role });`
- `list`: add `@CurrentUser() actor: JwtPayload` param; `return this.personasService.list(result.data, { sub: actor.sub, role: actor.role });`
- `findOne`: add `@CurrentUser() actor: JwtPayload`; `return this.personasService.findById(id, { sub: actor.sub, role: actor.role });`
- `enhance`: it calls `this.personasService.findById(id)` — change to pass actor: `findById(id, { sub: actor.sub, role: actor.role })` and add `@CurrentUser() actor: JwtPayload` to the method (enhance currently has no CurrentUser — add it).
- `update`: `return this.personasService.update(id, result.data, { sub: actor.sub, role: actor.role });`
- `remove`: `await this.personasService.softDelete(id, { sub: actor.sub, role: actor.role });`

- [ ] **Step 3: Controller — publish/unpublish routes**

Add (place before `@Get(':id')` to avoid route capture is unnecessary since these are POST; place near update):

```typescript
  @Post(':id/publish')
  @Permissions('personas:write')
  async publish(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    return this.personasService.publish(id, { sub: actor.sub, role: actor.role });
  }

  @Post(':id/unpublish')
  @Permissions('personas:write')
  async unpublish(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    return this.personasService.unpublish(id, { sub: actor.sub, role: actor.role });
  }
```

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build` (in `apps/api`)
Expected: PASS.

- [ ] **Step 5: Curl verification**

Start the API + DB (per dev setup). Then, with a TRAINER token `$T`, a trainee token `$U` (trainee supervised by that trainer), and persona id `$PID` created by the trainer:

```bash
# trainer creates a draft persona (isPublished omitted/false) — trainee should NOT see it
curl -s -H "Authorization: Bearer $U" localhost:3000/api/v1/personas/my | jq '.data.personas | length'   # expect 0
# trainer publishes
curl -s -X POST -H "Authorization: Bearer $T" localhost:3000/api/v1/personas/$PID/publish | jq '.data.isPublished'  # expect true
# trainee now sees it
curl -s -H "Authorization: Bearer $U" localhost:3000/api/v1/personas/my | jq '.data.personas | length'   # expect 1
# trainee cannot fetch an unpublished/other persona by id (use a draft id) -> 404
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $U" localhost:3000/api/v1/personas/<draftId>  # expect 404
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/personas/personas.controller.ts apps/api/src/modules/personas/dto/persona.dto.ts
git commit -m "feat(personas): publish/unpublish endpoints + actor-scoped reads"
```

---

## Task 5: Sessions — simulation flag + start authorization

**Files:**
- Modify: `apps/api/src/modules/sessions/dto/session.dto.ts`
- Modify: `apps/api/src/modules/sessions/sessions.service.ts`
- Modify: `apps/api/src/modules/sessions/sessions.controller.ts`

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces: `start(dto: StartSessionDto, actor: { sub: number; role: string })` persisting `isSimulation`.

- [ ] **Step 1: DTO — `simulation` on start**

In `session.dto.ts`, `StartSessionDtoSchema`:

```typescript
export const StartSessionDtoSchema = z.object({
  personaId: z.number().int().positive(),
  simulation: z.boolean().optional(),
});
```

- [ ] **Step 2: Service — auth + flag in `start`**

In `sessions.service.ts`, add imports:

```typescript
import { ForbiddenException } from '../../core/errors/domain.errors';
import { superAdminUserIds, canTraineeAccess } from '../personas/persona-access';
```

Rewrite `start`:

```typescript
  async start(dto: StartSessionDto, actor: { sub: number; role: string }) {
    const persona = await this.prisma.persona.findUnique({
      where: { id: dto.personaId, isDeleted: false },
      select: { id: true, isPublished: true, isDeleted: true, createdById: true },
    });
    if (!persona) throw new NotFoundException('Persona', dto.personaId);

    let isSimulation = false;
    if (actor.role === 'USER') {
      const [supervisorId, superAdminIds] = await Promise.all([
        this.prisma.user
          .findUnique({ where: { id: actor.sub }, select: { supervisorId: true } })
          .then((u) => u?.supervisorId ?? null),
        superAdminUserIds(this.prisma),
      ]);
      if (!canTraineeAccess(persona, supervisorId, superAdminIds)) {
        throw new ForbiddenException('Persona not available');
      }
    } else {
      // TRAINER / SUPER_ADMIN: test/simulation session against own (trainer) or any (admin) persona.
      if (actor.role === 'TRAINER' && persona.createdById !== actor.sub) {
        throw new ForbiddenException('You can only test your own personas');
      }
      isSimulation = dto.simulation ?? true;
    }

    return this.prisma.session.create({
      data: { userId: actor.sub, personaId: dto.personaId, isSimulation },
      select: { id: true, uid: true, startedAt: true, personaId: true, status: true, isSimulation: true },
    });
  }
```

> If `NotFoundException` is not already imported in this file, keep the existing import (it was used at line 22).

- [ ] **Step 3: Service — expose `isSimulation` on detail**

Find the session detail read (`findOne`/`getByUid`, the method returning a single session with `persona` include). Add `isSimulation: true` to its `select`/ensure the field is returned so the frontend banner can read it. If it uses `include` without `select`, the scalar is already returned — no change.

- [ ] **Step 4: Controller — pass full actor**

In `sessions.controller.ts` `start`:

```typescript
    return this.sessionsService.start(result.data, { sub: actor.sub, role: actor.role });
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run typecheck && npm run build` (in `apps/api`)
Expected: PASS.

- [ ] **Step 6: Curl verification**

```bash
# trainer starts a test session against own draft -> isSimulation true
curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"personaId":'$PID'}' localhost:3000/api/v1/sessions | jq '.data.isSimulation'   # expect true
# trainee starts session against a published visible persona -> isSimulation false
curl -s -X POST -H "Authorization: Bearer $U" -H 'Content-Type: application/json' \
  -d '{"personaId":'$PID'}' localhost:3000/api/v1/sessions | jq '.data.isSimulation'   # expect false
# trainee against an unpublished persona -> 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $U" -H 'Content-Type: application/json' \
  -d '{"personaId":<draftId>}' localhost:3000/api/v1/sessions   # expect 403
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/sessions
git commit -m "feat(sessions): simulation flag + role-aware start authorization"
```

---

## Task 6: Web services — personas + roleplay

**Files:**
- Modify: `apps/web/src/services/personas.ts`
- Modify: `apps/web/src/services/roleplay.ts`

**Interfaces:**
- Produces:
  - `Persona.isPublished?: boolean`, `PersonaSummary.isPublished?: boolean`
  - `createPersona(input, publish?: boolean)`
  - `publishPersona(id): Promise<Persona>`, `unpublishPersona(id): Promise<Persona>`
  - `startSession(personaId: number, opts?: { simulation?: boolean })`

- [ ] **Step 1: personas.ts — types**

Add `isPublished?: boolean` to both `interface PersonaSummary` and `interface Persona`. Add `isPublished?: boolean` to `interface PersonaPayload`.

- [ ] **Step 2: personas.ts — create carries publish flag**

Change `buildPersonaPayload` to accept the flag and `createPersona`:

```typescript
export function buildPersonaPayload(input: PersonaInput, isPublished?: boolean): PersonaPayload {
  // ...existing body...
  if (isPublished !== undefined) payload.isPublished = isPublished
  return payload
}

export async function createPersona(input: PersonaInput, publish = false): Promise<Persona> {
  return apiPost<Persona>('/personas', buildPersonaPayload(input, publish))
}
```

(`updatePersona` keeps calling `buildPersonaPayload(input)` with no flag.)

- [ ] **Step 3: personas.ts — publish/unpublish + comment**

Add:

```typescript
/** POST /personas/:id/publish — make visible to trainees (owner/admin only). */
export async function publishPersona(id: number): Promise<Persona> {
  return apiPost<Persona>(`/personas/${id}/publish`, {})
}

/** POST /personas/:id/unpublish — hide from trainees again. */
export async function unpublishPersona(id: number): Promise<Persona> {
  return apiPost<Persona>(`/personas/${id}/unpublish`, {})
}
```

Fix the `listMyPersonas` doc comment to: `/** GET /personas/my — trainee: published personas of own trainer or super admin; trainer/admin: own/all. */`

- [ ] **Step 4: roleplay.ts — simulation option**

```typescript
export async function startSession(
  personaId: number,
  opts?: { simulation?: boolean },
): Promise<StartedSession> {
  return apiPost<StartedSession>('/sessions', {
    personaId,
    ...(opts?.simulation ? { simulation: true } : {}),
  })
}
```

(Adjust to match the existing `apiPost` call shape in the file.) Add `isSimulation?: boolean` to `interface StartedSession`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck` (in `apps/web`)
Expected: errors only at call sites updated in later tasks (builder, index, mocks). Service files clean.

- [ ] **Step 6: Update MSW mocks**

In `apps/web/src/mocks/handlers.ts`, add handlers for `POST /personas/:id/publish` and `/unpublish` (return the persona with `isPublished` toggled) so component tests pass. Match existing handler style in that file.

- [ ] **Step 7: Run web tests**

Run: `npm run test` (in `apps/web`)
Expected: PASS (existing persona/roleplay tests still green).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/services/personas.ts apps/web/src/services/roleplay.ts apps/web/src/mocks/handlers.ts
git commit -m "feat(web): persona publish/unpublish + simulation session client"
```

---

## Task 7: Persona builder — draft / publish controls

**Files:**
- Modify: `apps/web/src/components/personas/persona-builder.tsx`

**Interfaces:**
- Consumes: `createPersona(input, publish)`, `publishPersona`, `unpublishPersona`, `updatePersona`.

- [ ] **Step 1: Split create submit into draft vs publish**

Replace the single submit button (around `persona-builder.tsx:461`) so that, in **create** mode, two buttons render: **Save as draft** (`createPersona(input, false)`) and **Save & publish** (`createPersona(input, true)`). Wire each through the existing `save` mutation by passing the publish flag (extend the mutation input, e.g. `save.mutate({ input: buildInput(), publish })`). The form's `onSubmit` (line ~177) should default to draft.

- [ ] **Step 2: Edit mode publish toggle**

In **edit** mode, show the existing single Save button (content update via `updatePersona`) plus a **Publish** / **Unpublish** button reflecting `persona.isPublished`, calling `publishPersona(persona.id)` / `unpublishPersona(persona.id)` and invalidating the persona queries (`personaKeys`).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` (in `apps/web`)
Expected: PASS.

- [ ] **Step 4: Run web tests**

Run: `npm run test` (in `apps/web`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/personas/persona-builder.tsx
git commit -m "feat(web): draft vs publish save + publish toggle in persona builder"
```

---

## Task 8: Personas list — badge + Test button

**Files:**
- Modify: `apps/web/src/routes/_auth/personas/index.tsx`

**Interfaces:**
- Consumes: `startSession(personaId, { simulation: true })`, persona `isPublished`.

- [ ] **Step 1: Published / Draft badge**

For each persona row/card, render a badge: `isPublished ? 'Published' : 'Draft'` (style after existing badges; reuse the persona-color/badge pattern already in this file).

- [ ] **Step 2: Test button**

Beside the existing Edit action, add a **Test** button. On click, call a `useMutation` wrapping `startSession(persona.id, { simulation: true })`; on success navigate to `/session/$uid` (route from Task 9) with the returned `uid`. Mirror the `start` mutation pattern in `practice/index.tsx`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck` (in `apps/web`)
Expected: PASS (the `/session/$uid` route exists after Task 9; if running Task 8 before 9, expect a router type error here — do Task 9 first or together).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_auth/personas/index.tsx
git commit -m "feat(web): persona list publish badge + owner Test button"
```

---

## Task 9: Routing — Arena (trainee) + Session chat split + nav

**Files:**
- Create: `apps/web/src/routes/_auth/arena/index.tsx` (move from `practice/index.tsx`)
- Create: `apps/web/src/routes/_auth/session/$uid.tsx` (move from `practice/$uid.tsx`)
- Delete: `apps/web/src/routes/_auth/practice/index.tsx`, `apps/web/src/routes/_auth/practice/$uid.tsx`
- Modify: `apps/web/src/components/layout/app-sidebar.tsx`
- Modify: any `to: '/practice...'` navigations

**Interfaces:**
- Produces: routes `/arena` (trainee launcher) and `/session/$uid` (chat, any auth).

- [ ] **Step 1: Move launcher → arena**

`git mv apps/web/src/routes/_auth/practice/index.tsx apps/web/src/routes/_auth/arena/index.tsx`. Update its `createFileRoute('/_auth/practice/')` → `createFileRoute('/_auth/arena/')`. Add a `beforeLoad` guard redirecting non-`USER` roles to `/dashboard` (read role from the auth store as the sidebar does). Update the `navigate({ to: '/practice/$uid', ... })` inside it to `to: '/session/$uid'`.

- [ ] **Step 2: Move chat → session**

`git mv apps/web/src/routes/_auth/practice/$uid.tsx apps/web/src/routes/_auth/session/$uid.tsx`. Update `createFileRoute('/_auth/practice/$uid')` → `createFileRoute('/_auth/session/$uid')`. No role guard (any authenticated user with a valid session).

- [ ] **Step 3: Sidebar nav**

In `app-sidebar.tsx`, change the Practice entry to:

```typescript
  { label: 'Arena', to: '/arena', icon: MessagesSquare, roles: ['USER'] },
```

- [ ] **Step 4: Regenerate route tree + typecheck**

Run (in `apps/web`): `npm run dev` briefly (TanStack router plugin regenerates `routeTree.gen.ts`) or `npm run build`. Then `npm run typecheck`.
Expected: PASS; `routeTree.gen.ts` now has `/arena/` and `/session/$uid`, no `/practice`.

- [ ] **Step 5: Grep for stale `/practice` links**

Run: `grep -rn "/practice" apps/web/src --include="*.tsx" --include="*.ts" | grep -v routeTree.gen`
Expected: no results (fix any remaining).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes apps/web/src/components/layout/app-sidebar.tsx
git commit -m "feat(web): Arena trainee launcher + /session chat route + nav gating"
```

---

## Task 10: Simulation banner on chat

**Files:**
- Modify: `apps/web/src/routes/_auth/session/$uid.tsx`

**Interfaces:**
- Consumes: session detail `isSimulation` (Task 5 Step 3).

- [ ] **Step 1: Render banner**

In the chat page, when the loaded session has `isSimulation === true`, render an unmistakable banner above the transcript, e.g. a high-contrast strip: "Simulation — this is a persona test session, not a graded trainee session." Use the existing surface/border tokens.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build` (in `apps/web`)
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Trainer → Personas → Test on a draft → chat opens with the Simulation banner. Trainee → Arena → start a published persona → no banner.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/_auth/session/$uid.tsx
git commit -m "feat(web): simulation banner on test sessions"
```

---

## Self-review notes (coverage vs spec)

- Visibility rule → Task 2 (predicate) + Task 3 (my/list/findById) + Task 5 (start). ✓
- Publish gate (draft / Save & publish) → Task 1 (column), 3 (create flag, publish/unpublish), 4 (routes/DTO), 7 (UI). ✓
- Owner-only mutation guard → Task 3 (update/softDelete/publish). ✓
- Session access gap → Task 5. ✓
- Arena trainee-only + owner Test + simulation flag/banner → Tasks 1, 5, 8, 9, 10. ✓
- `publishedVersion`, `assignedPersonaId` removal, analytics exclusion → deferred (spec "Out of scope"). ✓
