# WebSocket Auth — One-Time Ticket

How the roleplay chat WebSocket authenticates, why, and the alternatives.

## What is TTL

**TTL = Time To Live** — how long a value stays valid before it auto-expires. Here
the ticket is a Redis key with a 30-second expiry:

```ts
redis.set(`rt_ticket:${ticketId}`, String(userId), 'EX', ttl) // ttl = WS_TICKET_TTL_SECONDS (default 30)
```

After 30s Redis deletes the key on its own. So an unused ticket is dead in ≤30s —
no cleanup job needed. 30s is the window: long enough to cover the REST→WS open
latency, short enough that a stolen ticket is almost always already expired.

## The flow (current approach)

```
client ──POST /auth/realtime/ticket (JWT in header)──► API
        ◄──────────── { ticket } ──────────────────────
client ──WS …/realtime/chat?ticket=<id>&sessionId=<uid>► gateway
                         gateway: GETDEL rt_ticket:<id>  (atomic, one-time)
                         → userId, check session ACTIVE + owned → accept / close
```

- **Mint** (`auth.service.issueRealtimeTicket`): authenticated REST call mints
  `ticketId = randomUUID()`, stores `rt_ticket:<id> → userId` in Redis with a 30s TTL.
- **Connect**: client opens the WS with `?ticket=<id>&sessionId=<uid>`.
- **Consume** (`chat.gateway.handleConnection`): `GETDEL` reads **and deletes**
  the key atomically → single use. Missing/expired → close `4401`. Then verifies
  the session is `ACTIVE` (`4404`) and owned by that user (`4403`).

## Why this approach

The root constraint: **browsers cannot set an `Authorization` header on the
WebSocket handshake.** The `WebSocket` constructor takes only a URL (+ subprotocols).
So a bearer JWT can't travel the normal way. Options narrow to: put something in the
URL, smuggle it in the subprotocol, or use a cookie. Each has a catch — the ticket
solves them:

| Concern | How the ticket handles it |
|---|---|
| JWT in URL leaks (logs, proxies, history) | URL carries only an opaque random id, not the JWT. |
| Replay if the id leaks | `GETDEL` burns it on first use; a second connect fails. |
| Long exposure window | 30s TTL; stale tickets self-destruct. |
| Cross-Site WebSocket Hijacking (CSWSH) | Auth is **not** an ambient cookie — a cross-site page can't mint a ticket without the user's JWT, so it can't forge a connection. |
| Server-side cleanup | None — Redis TTL expires unused tickets. |

This is the well-trodden "connection ticket / negotiate token" pattern (e.g. SignalR's
negotiate step, and most browser realtime stacks).

## Alternatives considered

| Approach | How | Verdict |
|---|---|---|
| **JWT in query string** | `?token=<jwt>` | Simplest, but the long-lived secret leaks into logs/history/proxies. Rejected. |
| **Subprotocol smuggling** | pass JWT via `Sec-WebSocket-Protocol` (the one header the browser *can* set) | Avoids URL leak, but still ships the full JWT, is a hack, and the server must echo a valid subprotocol. Fragile. |
| **Cookie + Origin check** | httpOnly cookie auto-sent on the upgrade | Clean *if* you already use cookies — but this app keeps the access token in memory (refresh token in localStorage), not cookies. Adds CSWSH risk that must be closed with strict `Origin` validation. Bigger architectural change for no real gain here. |
| **First-message auth** | connect anonymously, send JWT as the first frame | Works, but leaves unauthenticated sockets open briefly (DoS surface) and needs an auth-timeout. More moving parts. |
| **One-time ticket (current)** | short-TTL, single-use id via authenticated REST | Best fit: no JWT in URL, replay-proof, self-expiring, CSWSH-resistant, minimal code. |

## Is there a better way?

For a browser client using **bearer tokens** (this app's model), the one-time ticket
is the standard best practice — there isn't a meaningfully "better" class of solution,
only the cookie route, which is a lateral move that fits cookie-based auth, not ours.

Where it *can* be hardened (cheap, incremental):

1. **Bind the ticket to the session.** Today the ticket maps to `userId` only, so it
   works for any of that user's sessions. Store `{ userId, sessionId }` and verify the
   `sessionId` query param matches on consume — narrows a leaked ticket to one session.
2. **Bind to context.** Optionally pin the ticket to the requesting IP / `Origin` and
   check it on connect.
3. **Validate `Origin` on the upgrade** as defence-in-depth (the gateway doesn't today).
4. **Tune TTL down** (e.g. 10–15s) if observed REST→WS latency allows.

None are required for correctness; (1) is the highest-value tweak if we want to tighten
the blast radius of a leaked ticket.
