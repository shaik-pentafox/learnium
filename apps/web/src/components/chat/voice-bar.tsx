import { useEffect, useState } from 'react'
import { Orb as OrbBars, type OrbState } from 'orb-ui'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RoleplaySession } from '@/features/roleplay/use-roleplay-session'

/** How often the bar samples live audio levels. ~15fps is plenty for a level
 *  meter and keeps re-renders contained to this component. */
const METER_INTERVAL_MS = 66

const STATE_LABEL: Record<OrbState, string> = {
  idle: 'Mic muted',
  connecting: 'Connecting…',
  listening: 'Listening…',
  speaking: 'Speaking…',
  error: 'Connection lost',
}

/**
 * Bottom composer replacement for voice sessions: an audio-reactive bars
 * visualization (orb-ui, controlled mode) fed by the live mic level while
 * listening and the agent playback level while speaking, plus mic mute and
 * stop-voice controls where the send button sits in text mode.
 *
 * Clicking the bars while the agent is speaking interrupts the turn (the
 * server's VAD barge-in also does this automatically when you speak).
 */
export function VoiceBar({ session }: { session: RoleplaySession }) {
  const [volume, setVolume] = useState(0)
  const [speaking, setSpeaking] = useState(false)

  const { getInputLevel, getOutputLevel, micMuted, status } = session

  useEffect(() => {
    const timer = setInterval(() => {
      const out = getOutputLevel()
      setSpeaking(out > 0)
      if (micMuted) setVolume(0)
      else setVolume(out > 0 ? out : getInputLevel())
    }, METER_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [getInputLevel, getOutputLevel, micMuted])

  const state: OrbState =
    status !== 'open'
      ? 'connecting'
      : micMuted
        ? 'idle'
        : speaking || session.thinking
          ? 'speaking'
          : 'listening'

  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background p-2 shadow-sm shadow-black/5">
      <span className="w-24 shrink-0 px-2 text-xs text-muted-foreground">
        {STATE_LABEL[state]}
      </span>
      {/* orb-ui renders in a square `size` container; clip it to the bar's
          height (bars max out at size*0.55 ≈ 53px, so nothing visible is cut). */}
      <div className="flex h-14 flex-1 items-center justify-center overflow-hidden">
        <OrbBars
          theme="bars"
          state={state}
          volume={volume}
          size={96}
          aria-label="Voice activity"
          onStop={() => {
            if (session.thinking || speaking) session.cancelTurn()
          }}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 text-muted-foreground hover:text-destructive"
        aria-label="Stop voice session"
        onClick={session.stopVoice}
      >
        <PhoneOff />
      </Button>
      <Button
        size="icon"
        variant={micMuted ? 'destructive' : 'primary'}
        className="shrink-0"
        aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
        onClick={session.toggleMic}
      >
        {micMuted ? <MicOff /> : <Mic />}
      </Button>
    </div>
  )
}
