/** Minimal controllable WebSocket stand-in for tests. Install with
 *  `installFakeWebSocket()`; drive instances via the static `last` handle. */
export class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static instances: FakeWebSocket[] = []
  static get last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  }
  static reset(): void {
    FakeWebSocket.instances = []
  }

  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  readonly url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: '' })
  }

  // ── test drivers ──
  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }
  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
  emitClose(code = 1006, reason = ''): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}

export function installFakeWebSocket(): void {
  FakeWebSocket.reset()
  ;(globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket
}
