import { z } from 'zod'
import type { ClientMessage } from '@learnium/contracts'

// Server → client frames. Mirrors packages/contracts `ServerMessageSchema`,
// PLUS the `joined` handshake the gateway sends but the contract omits (drift).
// Defined locally (not imported) so we don't pull a CommonJS runtime value out
// of the contracts package, which Vite's dev ESM analyzer can't resolve.
const RoleplayServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('joined'),
    sessionId: z.string(),
    personaName: z.string(),
    systemPrompt: z.string(),
  }),
  z.object({ type: z.literal('token'), delta: z.string() }),
  z.object({
    type: z.literal('message_done'),
    messageId: z.string(),
    emotion: z.string().nullable().optional(),
    emoji: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('session_ending') }),
  z.object({
    type: z.literal('session_ended'),
    scores: z.array(z.unknown()),
    feedback: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('reconnect'), reason: z.string() }),
  z.object({ type: z.literal('pong') }),
])

export type RoleplayServerMessage = z.infer<typeof RoleplayServerSchema>

export type ChannelStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'

interface ChannelHandlers {
  onMessage: (msg: RoleplayServerMessage) => void
  onStatus: (status: ChannelStatus) => void
  /** Returns the last assistant messageId so a reconnect can replay misses. */
  lastMessageId: () => string | null
}

const HEARTBEAT_MS = 25_000
const MAX_BACKOFF_MS = 10_000
const BASE_BACKOFF_MS = 500

/** ws(s):// origin of the backend. Derived from VITE_API_URL when set (direct
 *  mode), otherwise the current page host (legacy vite-proxy mode). */
function realtimeOrigin(): string {
  const apiUrl = import.meta.env.VITE_API_URL
  if (apiUrl) {
    const u = new URL(apiUrl)
    return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}`
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}`
}

/**
 * Roleplay WebSocket channel. Implements the backend resume contract: ticket
 * auth in the query string, ping/pong heartbeat, and exponential-backoff
 * reconnect that replays missed assistant messages via a `resume` frame.
 *
 * The ticket is single-use, so reconnects request a fresh one through
 * `getTicket` before each (re)connect.
 */
export class RoleplayChannel {
  private ws: WebSocket | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempts = 0
  private closedByCaller = false
  private resuming = false

  private readonly sessionUid: string
  private readonly getTicket: () => Promise<string>
  private readonly handlers: ChannelHandlers

  constructor(
    sessionUid: string,
    getTicket: () => Promise<string>,
    handlers: ChannelHandlers,
  ) {
    this.sessionUid = sessionUid
    this.getTicket = getTicket
    this.handlers = handlers
  }

  async connect(): Promise<void> {
    this.closedByCaller = false
    await this.open()
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  close(): void {
    this.closedByCaller = true
    this.clearTimers()
    this.ws?.close()
    this.ws = null
    this.handlers.onStatus('closed')
  }

  private async open(): Promise<void> {
    this.handlers.onStatus(this.attempts === 0 ? 'connecting' : 'reconnecting')
    let ticket: string
    try {
      ticket = await this.getTicket()
    } catch {
      // Ticket issuance is auth-gated; a failure won't fix itself by retrying.
      this.fail('TICKET_ERROR', 'Could not authorize the realtime session.')
      return
    }
    if (this.closedByCaller) return

    const url = `${realtimeOrigin()}/api/v1/realtime/chat?ticket=${encodeURIComponent(
      ticket,
    )}&sessionId=${encodeURIComponent(this.sessionUid)}`

    const ws = new WebSocket(url)
    this.ws = ws

    ws.onopen = () => {
      this.attempts = 0
      this.handlers.onStatus('open')
      this.startHeartbeat()
      // On a reconnect (not the first open), replay anything we missed.
      if (this.resuming) {
        const last = this.handlers.lastMessageId()
        if (last) this.send({ type: 'resume', lastMessageId: last })
      }
      this.resuming = false
    }

    ws.onmessage = (event) => {
      const parsed = RoleplayServerSchema.safeParse(JSON.parse(event.data))
      if (parsed.success) this.handlers.onMessage(parsed.data)
    }

    ws.onclose = (event) => {
      this.stopHeartbeat()
      if (this.closedByCaller) return
      // The gateway uses 4400–4599 for terminal rejections (bad ticket, session
      // not active, forbidden, no LLM model). Retrying those just spins forever
      // — surface the reason and stop instead.
      const code = event?.code ?? 0
      if (code >= 4400 && code <= 4599) {
        this.fail(String(code), event.reason || 'Connection closed')
        return
      }
      this.resuming = true
      this.scheduleReconnect()
    }

    ws.onerror = () => ws.close()
  }

  /** Terminal failure: surface as an error frame, stop reconnecting. */
  private fail(code: string, message: string): void {
    this.closedByCaller = true
    this.clearTimers()
    this.handlers.onMessage({ type: 'error', code, message })
    this.handlers.onStatus('closed')
  }

  private scheduleReconnect(): void {
    if (this.closedByCaller) return
    this.handlers.onStatus('reconnecting')
    const delay = Math.min(
      BASE_BACKOFF_MS * 2 ** this.attempts,
      MAX_BACKOFF_MS,
    )
    this.attempts += 1
    this.reconnectTimer = setTimeout(() => void this.open(), delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => this.send({ type: 'ping' }), HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}
