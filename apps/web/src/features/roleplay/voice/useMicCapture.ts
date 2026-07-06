import { useEffect, useRef } from 'react'

/** Wire format the server expects. */
const TARGET_RATE = 16000

export interface MicCapture {
  /** Latest mic input level, normalized 0–1 (0 while muted/disabled). */
  getLevel: () => number
}

/**
 * Captures microphone audio and emits raw PCM16 chunks at 16 kHz.
 *
 * The AudioContext runs at the DEVICE's native rate and we downsample to
 * 16 kHz here on the main thread. Do NOT force a 16 kHz context: mixing
 * contexts with different sample rates triggers macOS/Chromium audio-service
 * bugs where the OTHER context's playback pitch-shifts (agent voice going
 * deep after the mic starts).
 *
 * `muted` only gates chunk forwarding — the stream and context stay alive so
 * unmuting is instant (no new permission prompt, no context rebuild).
 *
 * Cleans up (stops tracks, closes context) when `enabled` flips to false or
 * the component unmounts.
 */
export function useMicCapture(
  onChunk: (buf: ArrayBuffer) => void,
  enabled: boolean,
  muted = false,
): MicCapture {
  const onChunkRef = useRef(onChunk)
  onChunkRef.current = onChunk
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const levelRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      levelRef.current = 0
      return
    }

    let stream: MediaStream
    let audioCtx: AudioContext
    let workletNode: AudioWorkletNode
    let active = true

    async function start() {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      if (!active) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      audioCtx = new AudioContext() // device-native rate; see header comment
      await audioCtx.audioWorklet.addModule('/pcm-processor.js')
      if (!active) {
        void audioCtx.close()
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const source = audioCtx.createMediaStreamSource(stream)
      workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor')
      const sourceRate = audioCtx.sampleRate
      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (mutedRef.current) {
          levelRef.current = 0
          return
        }
        const pcm = downsamplePcm16(e.data, sourceRate, TARGET_RATE)
        levelRef.current = pcm16Rms(pcm)
        onChunkRef.current(pcm)
      }
      source.connect(workletNode)
    }

    void start().catch((err) => {
      console.error('[useMicCapture] start failed:', err)
    })

    return () => {
      active = false
      levelRef.current = 0
      workletNode?.disconnect()
      stream?.getTracks().forEach((t) => t.stop())
      void audioCtx?.close()
    }
  }, [enabled])

  return { getLevel: () => levelRef.current }
}

/** RMS of a PCM16 chunk, scaled so normal speech lands around 0.3–0.8. */
function pcm16Rms(buf: ArrayBuffer): number {
  const samples = new Int16Array(buf)
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]! / 32768
    sum += s * s
  }
  // Speech RMS rarely exceeds ~0.25 — scale up and clamp to the 0–1 range.
  return Math.min(Math.sqrt(sum / samples.length) * 4, 1)
}

/** Linear-interpolation downsample of PCM16 mono LE. No-op when rates match. */
function downsamplePcm16(
  input: ArrayBuffer,
  fromRate: number,
  toRate: number,
): ArrayBuffer {
  if (fromRate === toRate) return input
  const src = new Int16Array(input)
  if (src.length === 0) return input
  const outLength = Math.floor((src.length * toRate) / fromRate)
  const out = new Int16Array(outLength)
  const ratio = (src.length - 1) / Math.max(outLength - 1, 1)
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = src[idx]!
    const s1 = idx + 1 < src.length ? src[idx + 1]! : s0
    out[i] = Math.round(s0 + (s1 - s0) * frac)
  }
  return out.buffer
}
