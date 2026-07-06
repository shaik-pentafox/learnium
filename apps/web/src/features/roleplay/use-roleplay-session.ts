import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RoleplayChannel,
  type ChannelStatus,
  type RoleplayServerMessage,
} from '@/lib/ws-client'
import { getRealtimeTicket } from '@/services/roleplay'
import { useMicCapture } from './voice/useMicCapture'
import { AudioPlayer } from './voice/audioPlayer'

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
  /** True from "End & score" until the scored result arrives. */
  ending: boolean
  ended: boolean
  scores: unknown[] | null
  feedback: string | null
  error: string | null
  sendMessage: (content: string) => void
  /** Ask the customer (persona) to open the conversation. */
  begin: () => void
  endSession: () => void
  /** BCP-47 codes allowed for voice in this persona (empty = voice disabled). */
  personaLanguages: string[]
  /** True while the mic is active and the server's voice loop is running. */
  voiceActive: boolean
  /** Live STT partial transcript (null when not speaking). */
  sttCaption: string | null
  startVoice: (languageCode: string) => void
  stopVoice: () => void
  /** Barge-in: abort the current AI turn + TTS, restart listening. */
  cancelTurn: () => void
  /** Client-side mic mute: audio keeps capturing but nothing is sent. */
  micMuted: boolean
  toggleMic: () => void
  /** Live mic input level 0–1 (for the voice bar visualization). */
  getInputLevel: () => number
  /** Live agent playback level 0–1 (for the voice bar visualization). */
  getOutputLevel: () => number
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
  const [ending, setEnding] = useState(false)
  const [ended, setEnded] = useState(false)
  const [scores, setScores] = useState<unknown[] | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [personaLanguages, setPersonaLanguages] = useState<string[]>([])
  const [voiceActive, setVoiceActive] = useState(false)
  const [sttCaption, setSttCaption] = useState<string | null>(null)
  const [micMuted, setMicMuted] = useState(false)

  const channelRef = useRef<RoleplayChannel | null>(null)
  const lastServerIdRef = useRef<string | null>(null)
  const playerRef = useRef<AudioPlayer>(new AudioPlayer())

  const handleServer = useCallback((msg: RoleplayServerMessage) => {
    switch (msg.type) {
      case 'joined':
        setPersonaName(msg.personaName)
        setPersonaColor(msg.personaColor ?? null)
        setHasStarted(msg.hasStarted ?? false)
        setPersonaLanguages(msg.personaLanguages ?? [])
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
        setEnding(true)
        break
      case 'session_ended':
        setThinking(false)
        setEnding(false)
        setEnded(true)
        setScores(msg.scores)
        setFeedback(msg.feedback ?? null)
        channelRef.current?.close()
        break
      case 'error':
        setError(msg.message)
        setThinking(false)
        setEnding(false)
        break
      case 'voice_started':
        setVoiceActive(true)
        setSttCaption(null)
        setMicMuted(false)
        break
      case 'voice_stopped':
        setVoiceActive(false)
        setSttCaption(null)
        playerRef.current.stop()
        break
      case 'stt_partial':
        // User is speaking. If agent audio is still playing (or queued), this
        // is a barge-in — cut playback so the agent stops and listens.
        // Provider-agnostic net alongside the server's tts_stop.
        if (playerRef.current.isPlaying) playerRef.current.stop()
        setSttCaption(msg.text)
        break
      case 'stt_final':
        setSttCaption(null)
        // Show transcribed text as a user message bubble (persisted server-side too).
        setMessages((prev) => [
          ...prev,
          { localId: `u${prev.length}`, role: 'user', content: msg.text, pending: false },
        ])
        setThinking(true)
        break
      case 'tts_meta':
        // Binary audio frame follows; handled by onAudio below.
        break
      case 'tts_stop':
        // Barge-in: the user spoke over the agent — kill playback now.
        playerRef.current.stop()
        break
      case 'reconnect':
      case 'pong':
        break
    }
  }, [])

  useEffect(() => {
    const player = playerRef.current
    const channel = new RoleplayChannel(sessionUid, getRealtimeTicket, {
      onMessage: handleServer,
      onStatus: setStatus,
      lastMessageId: () => lastServerIdRef.current,
      onAudio: (buf) => void player.enqueue(buf),
    })
    channelRef.current = channel
    void channel.connect()
    return () => {
      channel.close()
      player.destroy()
    }
  }, [sessionUid, handleServer])

  // Mic capture: feed PCM16 chunks to the server while voice is active.
  const onMicChunk = useCallback((buf: ArrayBuffer) => {
    channelRef.current?.sendAudio(buf)
  }, [])
  const mic = useMicCapture(onMicChunk, voiceActive, micMuted)

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
    setEnding(true)
    // Voice session: silence playback + release the mic immediately — the
    // server also tears down its voice pipeline on `end`.
    playerRef.current.stop()
    setVoiceActive(false)
    setSttCaption(null)
    channelRef.current?.send({ type: 'control', action: 'end' })
  }, [])

  const startVoice = useCallback((languageCode: string) => {
    playerRef.current.resume()
    channelRef.current?.send({ type: 'control', action: 'voice_start', languageCode })
  }, [])

  const stopVoice = useCallback(() => {
    channelRef.current?.send({ type: 'control', action: 'voice_stop' })
    playerRef.current.stop()
    setVoiceActive(false)
    setSttCaption(null)
  }, [])

  const cancelTurn = useCallback(() => {
    channelRef.current?.send({ type: 'control', action: 'cancel' })
    playerRef.current.stop()
  }, [])

  const toggleMic = useCallback(() => setMicMuted((m) => !m), [])
  const getInputLevel = mic.getLevel
  const getOutputLevel = useCallback(() => playerRef.current.getLevel(), [])

  return {
    status,
    personaName,
    personaColor,
    messages,
    thinking,
    hasStarted,
    ending,
    ended,
    scores,
    feedback,
    error,
    sendMessage,
    begin,
    endSession,
    personaLanguages,
    voiceActive,
    sttCaption,
    startVoice,
    stopVoice,
    cancelTurn,
    micMuted,
    toggleMic,
    getInputLevel,
    getOutputLevel,
  }
}
