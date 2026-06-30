import { useEffect, useRef } from 'react'

/**
 * Captures microphone audio and emits raw PCM16 chunks at 16 kHz.
 *
 * The AudioContext is created at 16 kHz so the browser resamples from the
 * device's native rate automatically. The AudioWorklet processor converts
 * Float32 → Int16 and transfers the buffer to the main thread.
 *
 * Cleans up (stops tracks, closes context) when `enabled` flips to false or
 * the component unmounts.
 */
export function useMicCapture(
  onChunk: (buf: ArrayBuffer) => void,
  enabled: boolean,
): void {
  const onChunkRef = useRef(onChunk)
  onChunkRef.current = onChunk

  useEffect(() => {
    if (!enabled) return

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
      audioCtx = new AudioContext({ sampleRate: 16000 })
      await audioCtx.audioWorklet.addModule('/pcm-processor.js')
      if (!active) {
        void audioCtx.close()
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const source = audioCtx.createMediaStreamSource(stream)
      workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor')
      workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        onChunkRef.current(e.data)
      }
      source.connect(workletNode)
    }

    void start().catch((err) => {
      console.error('[useMicCapture] start failed:', err)
    })

    return () => {
      active = false
      workletNode?.disconnect()
      stream?.getTracks().forEach((t) => t.stop())
      void audioCtx?.close()
    }
  }, [enabled])
}
