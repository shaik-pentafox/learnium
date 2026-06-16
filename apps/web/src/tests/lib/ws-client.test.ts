import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RoleplayChannel, type RoleplayServerMessage } from '@/lib/ws-client'
import { FakeWebSocket, installFakeWebSocket } from '@/mocks/fake-websocket'

beforeEach(() => {
  installFakeWebSocket()
  vi.useRealTimers()
})

function makeChannel(received: RoleplayServerMessage[], lastId: string | null = null) {
  const statuses: string[] = []
  const channel = new RoleplayChannel('sess-1', () => Promise.resolve('ticket-1'), {
    onMessage: (m) => received.push(m),
    onStatus: (s) => statuses.push(s),
    lastMessageId: () => lastId,
  })
  return { channel, statuses }
}

describe('RoleplayChannel', () => {
  it('connects with ticket + sessionId and reports open', async () => {
    const received: RoleplayServerMessage[] = []
    const { channel, statuses } = makeChannel(received)

    await channel.connect()
    FakeWebSocket.last.emitOpen()

    expect(FakeWebSocket.last.url).toContain('ticket=ticket-1')
    expect(FakeWebSocket.last.url).toContain('sessionId=sess-1')
    expect(statuses).toContain('connecting')
    expect(statuses).toContain('open')
  })

  it('parses and forwards valid server frames, drops invalid ones', async () => {
    const received: RoleplayServerMessage[] = []
    const { channel } = makeChannel(received)
    await channel.connect()
    FakeWebSocket.last.emitOpen()

    FakeWebSocket.last.emitMessage({
      type: 'joined',
      sessionId: 'sess-1',
      personaName: 'Coach',
      systemPrompt: 'x',
    })
    FakeWebSocket.last.emitMessage({ type: 'token', delta: 'hi' })
    FakeWebSocket.last.emitMessage({ type: 'garbage' })

    expect(received).toHaveLength(2)
    expect(received[0]).toMatchObject({ type: 'joined', personaName: 'Coach' })
    expect(received[1]).toMatchObject({ type: 'token', delta: 'hi' })
  })

  it('only sends frames while the socket is open', async () => {
    const { channel } = makeChannel([])
    await channel.connect()

    channel.send({ type: 'ping' }) // not open yet → dropped
    FakeWebSocket.last.emitOpen()
    channel.send({ type: 'message', content: 'hello', id: 'm1' })

    expect(FakeWebSocket.last.sent).toHaveLength(1)
    expect(JSON.parse(FakeWebSocket.last.sent[0])).toMatchObject({
      type: 'message',
      content: 'hello',
    })
  })

  it('replays a resume frame with the last message id after reconnect', async () => {
    vi.useFakeTimers()
    const { channel } = makeChannel([], 'srv-42')
    await channel.connect()
    FakeWebSocket.last.emitOpen()

    // Drop the connection → schedules a backoff reconnect.
    FakeWebSocket.last.emitClose()
    await vi.advanceTimersByTimeAsync(600)
    FakeWebSocket.last.emitOpen()

    const resume = FakeWebSocket.last.sent
      .map((s) => JSON.parse(s))
      .find((m) => m.type === 'resume')
    expect(resume).toMatchObject({ type: 'resume', lastMessageId: 'srv-42' })
    channel.close()
    vi.useRealTimers()
  })

  it('surfaces a terminal close code as an error and stops reconnecting', async () => {
    vi.useFakeTimers()
    const received: RoleplayServerMessage[] = []
    const { channel, statuses } = makeChannel(received)
    await channel.connect()
    FakeWebSocket.last.emitOpen()
    const count = FakeWebSocket.instances.length

    // 4503 = no LLM model configured (the likely first-run state).
    FakeWebSocket.last.emitClose(4503, 'No LLM model configured.')
    await vi.advanceTimersByTimeAsync(5000)

    expect(received.at(-1)).toMatchObject({ type: 'error', code: '4503' })
    expect(statuses.at(-1)).toBe('closed')
    expect(FakeWebSocket.instances.length).toBe(count) // no reconnect attempt
    vi.useRealTimers()
  })

  it('fails closed when the ticket cannot be issued', async () => {
    const received: RoleplayServerMessage[] = []
    const statuses: string[] = []
    const channel = new RoleplayChannel(
      'sess-1',
      () => Promise.reject(new Error('401')),
      {
        onMessage: (m) => received.push(m),
        onStatus: (s) => statuses.push(s),
        lastMessageId: () => null,
      },
    )

    await channel.connect()

    expect(received.at(-1)).toMatchObject({ type: 'error', code: 'TICKET_ERROR' })
    expect(statuses.at(-1)).toBe('closed')
    expect(FakeWebSocket.instances.length).toBe(0) // never opened a socket
  })

  it('does not reconnect after an explicit close', async () => {
    const { channel, statuses } = makeChannel([])
    await channel.connect()
    FakeWebSocket.last.emitOpen()
    const count = FakeWebSocket.instances.length

    channel.close()
    FakeWebSocket.last.emitClose()

    expect(FakeWebSocket.instances.length).toBe(count)
    expect(statuses.at(-1)).toBe('closed')
  })
})
