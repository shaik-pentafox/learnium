import { StrictMode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useRoleplaySession } from '@/features/roleplay/use-roleplay-session'
import { FakeWebSocket, installFakeWebSocket } from '@/mocks/fake-websocket'

// The hook requests a realtime ticket via the REST api before connecting.
vi.mock('@/services/roleplay', () => ({
  getRealtimeTicket: () => Promise.resolve('ticket-1'),
}))

beforeEach(() => installFakeWebSocket())
afterEach(() => vi.clearAllMocks())

async function open() {
  // StrictMode double-invokes state updaters in dev — guards against impure
  // updaters dropping the streaming assistant message.
  const view = renderHook(() => useRoleplaySession('sess-1'), {
    wrapper: StrictMode,
  })
  await waitFor(() => expect(FakeWebSocket.last).toBeTruthy())
  act(() => FakeWebSocket.last.emitOpen())
  await waitFor(() => expect(view.result.current.status).toBe('open'))
  return view
}

describe('useRoleplaySession', () => {
  it('captures the persona name and start state from the joined frame', async () => {
    const { result } = await open()
    act(() =>
      FakeWebSocket.last.emitMessage({
        type: 'joined',
        sessionId: 'sess-1',
        personaName: 'Angry Customer',
        systemPrompt: 'x',
        hasStarted: false,
      }),
    )
    await waitFor(() =>
      expect(result.current.personaName).toBe('Angry Customer'),
    )
    expect(result.current.hasStarted).toBe(false)
  })

  it('begin() asks the customer to open the conversation', async () => {
    const { result } = await open()
    act(() => result.current.begin())
    expect(JSON.parse(FakeWebSocket.last.sent.at(-1)!)).toMatchObject({
      type: 'control',
      action: 'begin',
    })
    expect(result.current.thinking).toBe(true)
  })

  it('marks hasStarted true when joining a session already in progress', async () => {
    const { result } = await open()
    act(() =>
      FakeWebSocket.last.emitMessage({
        type: 'joined',
        sessionId: 'sess-1',
        personaName: 'Angry Customer',
        systemPrompt: 'x',
        hasStarted: true,
      }),
    )
    await waitFor(() => expect(result.current.hasStarted).toBe(true))
  })

  it('appends a user message and streams the assistant reply', async () => {
    const { result } = await open()

    act(() => result.current.sendMessage('hello'))
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: 'hello',
    })
    expect(result.current.thinking).toBe(true)

    act(() => FakeWebSocket.last.emitMessage({ type: 'token', delta: 'Hi ' }))
    act(() => FakeWebSocket.last.emitMessage({ type: 'token', delta: 'there' }))
    await waitFor(() =>
      expect(result.current.messages[1]?.content).toBe('Hi there'),
    )
    expect(result.current.messages[1].pending).toBe(true)

    act(() =>
      FakeWebSocket.last.emitMessage({ type: 'message_done', messageId: '77' }),
    )
    await waitFor(() => expect(result.current.thinking).toBe(false))
    expect(result.current.messages[1]).toMatchObject({
      serverId: '77',
      pending: false,
    })
  })

  it('reveals scores and feedback when the session ends', async () => {
    const { result } = await open()
    act(() => result.current.endSession())
    expect(JSON.parse(FakeWebSocket.last.sent.at(-1)!)).toMatchObject({
      type: 'control',
      action: 'end',
    })

    act(() =>
      FakeWebSocket.last.emitMessage({
        type: 'session_ended',
        scores: [{ criterionId: 1, score: 8, maxScore: 10, feedback: 'good' }],
        feedback: 'Nice work',
      }),
    )
    await waitFor(() => expect(result.current.ended).toBe(true))
    expect(result.current.feedback).toBe('Nice work')
    expect(result.current.scores).toHaveLength(1)
  })

  it('ignores an empty message and reacts to session_ending', async () => {
    const { result } = await open()

    const before = FakeWebSocket.last.sent.length
    act(() => result.current.sendMessage('   '))
    expect(result.current.messages).toHaveLength(0)
    expect(FakeWebSocket.last.sent.length).toBe(before)

    act(() => FakeWebSocket.last.emitMessage({ type: 'session_ending' }))
    await waitFor(() => expect(result.current.thinking).toBe(true))
  })

  it('surfaces an error frame', async () => {
    const { result } = await open()
    act(() =>
      FakeWebSocket.last.emitMessage({
        type: 'error',
        code: 'PROVIDER_ERROR',
        message: 'LLM unavailable',
      }),
    )
    await waitFor(() =>
      expect(result.current.error).toBe('LLM unavailable'),
    )
  })
})
