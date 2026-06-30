/**
 * Sequential Web Audio playback queue for TTS audio frames.
 *
 * Each `enqueue` call decodes a WAV/PCM ArrayBuffer and appends it to the
 * queue. Buffers play back-to-back without gaps. Call `stop()` for barge-in
 * (clears the queue and stops the current source immediately).
 *
 * AudioContext is created lazily on the first enqueue (post-user-gesture) and
 * resumed automatically if the browser suspends it.
 */
export class AudioPlayer {
  private ctx: AudioContext | null = null
  private queue: AudioBuffer[] = []
  private playing = false
  private currentSource: AudioBufferSourceNode | null = null

  /** Unlock the AudioContext on a user gesture (call on mic button click). */
  resume(): void {
    void this.ctx?.resume()
  }

  async enqueue(bytes: ArrayBuffer): Promise<void> {
    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()
    try {
      // slice(0) to clone — decodeAudioData detaches the buffer
      const buffer = await ctx.decodeAudioData(bytes.slice(0))
      this.queue.push(buffer)
      if (!this.playing) this.playNext()
    } catch (err) {
      console.error('[AudioPlayer] decode failed:', err)
    }
  }

  stop(): void {
    this.queue = []
    try {
      this.currentSource?.stop()
    } catch {
      // already stopped
    }
    this.currentSource = null
    this.playing = false
  }

  destroy(): void {
    this.stop()
    void this.ctx?.close()
    this.ctx = null
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext()
    }
    return this.ctx
  }

  private playNext(): void {
    const buffer = this.queue.shift()
    if (!buffer) {
      this.playing = false
      this.currentSource = null
      return
    }
    const ctx = this.ensureCtx()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => this.playNext()
    this.currentSource = source
    this.playing = true
    source.start()
  }
}
