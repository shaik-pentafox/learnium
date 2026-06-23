import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RoleplayChannel,
  type ChannelStatus,
  type RoleplayServerMessage,
} from '@/lib/ws-client'
import { getRealtimeTicket } from '@/services/roleplay'

export interface ChatMessage {
  /** Stable client id; assistant messages also get a server messageId on done. */
  localId: string
  serverId?: string
  role: 'user' | 'assistant'
  content: string
  pending: boolean
}

export interface RoleplaySession {
  status: ChannelStatus
  personaName: string | null
  personaColor: string | null
  messages: ChatMessage[]
  /** True while the assistant is streaming a reply. */
  thinking: boolean
  /** Server truth from `joined`: null before join, then whether the session
   *  already has messages. Drives the one-time start-confirm dialog. */
  hasStarted: boolean | null
  ended: boolean
  scores: unknown[] | null
  feedback: string | null
  error: string | null
  sendMessage: (content: string) => void
  /** Ask the customer (persona) to open the conversation. */
  begin: () => void
  endSession: () => void
}

function uid(): string {
  return crypto.randomUUID()
}

export function useRoleplaySession(sessionUid: string): RoleplaySession {
  const [status, setStatus] = useState<ChannelStatus>('connecting')
  const [personaName, setPersonaName] = useState<string | null>(null)
  const [personaColor, setPersonaColor] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [thinking, setThinking] = useState(false)
  const [hasStarted, setHasStarted] = useState<boolean | null>(null)
  const [ended, setEnded] = useState(false)
  const [scores, setScores] = useState<unknown[] | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const channelRef = useRef<RoleplayChannel | null>(null)
  // Mirror the latest assistant serverId for the resume contract.
  const lastServerIdRef = useRef<string | null>(null)

  const handleServer = useCallback((msg: RoleplayServerMessage) => {
    switch (msg.type) {
      case 'joined':
        setPersonaName(msg.personaName)
        setPersonaColor(msg.personaColor ?? null)
        setHasStarted(msg.hasStarted ?? false)
        break
      case 'token': {
        const delta = msg.delta
        setThinking(true)
        // Pure updater: append to the in-progress assistant bubble, or start a
        // new one. Decision derives only from `prev`, so it's stable under
        // React StrictMode's double-invoke (a mutated ref here would drop it).
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant' && last.pending) {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: m.content + delta } : m,
            )
          }
          return [
            ...prev,
            {
              localId: `a${prev.length}`,
              role: 'assistant',
              content: delta,
              pending: true,
            },
          ]
        })
        break
      }
      case 'message_done': {
        const messageId = msg.messageId
        lastServerIdRef.current = messageId
        setThinking(false)
        setMessages((prev) =>
          prev.map((m, i) =>
            i === prev.length - 1 && m.role === 'assistant' && m.pending
              ? { ...m, serverId: messageId, pending: false }
              : m,
          ),
        )
        break
      }
      case 'session_ending':
        setThinking(true)
        break
      case 'session_ended':
        setThinking(false)
        setEnded(true)
        setScores(msg.scores)
        setFeedback(msg.feedback ?? null)
        channelRef.current?.close()
        break
      case 'error':
        setError(msg.message)
        setThinking(false)
        break
      case 'reconnect':
      case 'pong':
        break
    }
  }, [])

  useEffect(() => {
    const channel = new RoleplayChannel(sessionUid, getRealtimeTicket, {
      onMessage: handleServer,
      onStatus: setStatus,
      lastMessageId: () => lastServerIdRef.current,
    })
    channelRef.current = channel
    void channel.connect()
    return () => channel.close()
  }, [sessionUid, handleServer])

  const sendMessage = useCallback((content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    setMessages((prev) => [
      ...prev,
      { localId: `u${prev.length}`, role: 'user', content: trimmed, pending: false },
    ])
    setThinking(true)
    channelRef.current?.send({ type: 'message', content: trimmed, id: uid() })
  }, [])

  const begin = useCallback(() => {
    setThinking(true)
    channelRef.current?.send({ type: 'control', action: 'begin' })
  }, [])

  const endSession = useCallback(() => {
    channelRef.current?.send({ type: 'control', action: 'end' })
  }, [])

  return {
    status,
    personaName,
    personaColor,
    messages,
    thinking,
    hasStarted,
    ended,
    scores,
    feedback,
    error,
    sendMessage,
    begin,
    endSession,
  }
}
