/**
 * Gapless Web Audio playback for streamed TTS frames.
 *
 * Frames are decoded in arrival order and scheduled back-to-back on the
 * AudioContext clock (`source.start(at)` where `at` = end of the previous
 * buffer) — NOT chained via `onended`, whose main-thread latency leaves an
 * audible gap at every frame boundary (choppy speech). Call `stop()` for
 * barge-in: all scheduled sources are killed immediately.
 *
 * Output goes to `ctx.destination` (via a passive AnalyserNode tap for the
 * level meter). A MediaStreamDestination →
 * <audio> element route was tried for echo cancellation (Chromium AEC only
 * references media-element output), but Chrome's live-stream drift
 * compensation progressively time-stretched playback (low/slow voice after
 * the first turn). Echo robustness is handled server-side by the VAD
 * threshold instead.
 */
/** Seconds of lead when playback (re)starts — a jitter buffer that absorbs
 *  late frames (a hairline lead turns every late frame into an audible gap). */
const RESTART_LEAD_S = 0.15

export class AudioPlayer {
  private ctx: AudioContext | null = null
  /** Passthrough tap for output-level metering (sources → analyser → dest).
   *  A passive node in the SAME context — none of the MediaStreamDestination
   *  drift risk described above. */
  private analyser: AnalyserNode | null = null

  /** Live (scheduled or playing) sources — killed on stop(). */
  private readonly sources = new Set<AudioBufferSourceNode>()
  /** AudioContext time where the next buffer should begin. */
  private nextTime = 0
  /** Serializes async decodes so frames schedule in arrival order. */
  private chain: Promise<void> = Promise.resolve()
  /** Bumped on stop() so frames decoding across a barge-in never schedule. */
  private epoch = 0

  /** Unlock audio output on a user gesture (call on mic button click). */
  resume(): void {
    void this.ctx?.resume()
  }

  /** True while any buffer is playing or scheduled. */
  get isPlaying(): boolean {
    return this.sources.size > 0
  }

  /** Current output level, normalized 0–1 (0 when nothing is playing). */
  getLevel(): number {
    if (!this.analyser || this.sources.size === 0) return 0
    const data = new Uint8Array(this.analyser.fftSize)
    this.analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const s = (data[i]! - 128) / 128
      sum += s * s
    }
    // Same speech-band scaling as the mic meter (RMS ~0.25 at loud speech).
    return Math.min(Math.sqrt(sum / data.length) * 4, 1)
  }

  async enqueue(bytes: ArrayBuffer): Promise<void> {
    this.chain = this.chain
      .then(() => this.decodeAndSchedule(bytes))
      .catch((err) => console.error('[AudioPlayer] frame failed:', err))
    return this.chain
  }

  stop(): void {
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        // already stopped
      }
    }
    this.sources.clear()
    this.nextTime = 0
    // Drop queued frames and invalidate any decode already in flight.
    this.chain = Promise.resolve()
    this.epoch++
  }

  destroy(): void {
    this.stop()
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
  }

  private async decodeAndSchedule(bytes: ArrayBuffer): Promise<void> {
    const epoch = this.epoch
    const ctx = this.ensureCtx()
    if (ctx.state === 'suspended') await ctx.resume()
    // Manual WAV→AudioBuffer parse: our frames are always PCM16 mono WAV, and
    // building the buffer at the header's exact sample rate removes any
    // decodeAudioData resampling/pitch ambiguity across devices.
    const buffer = this.wavToBuffer(ctx, bytes)
    if (!buffer) return
    if (epoch !== this.epoch) return // barge-in happened while decoding

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.analyser ?? ctx.destination)
    // Splice exactly onto the end of the previous buffer. When the pipeline
    // (re)starts — first frame, or the queue ran dry — lead by 150ms as a
    // jitter buffer: with a hairline lead, any frame arriving a beat late
    // lands as an audible gap (choppy/robotic speech on jittery networks).
    const startAt = Math.max(this.nextTime, ctx.currentTime + RESTART_LEAD_S)
    this.nextTime = startAt + buffer.duration
    this.sources.add(source)
    source.onended = () => this.sources.delete(source)
    source.start(startAt)
  }

  /** Parse a PCM16 mono WAV frame into an AudioBuffer at its native rate. */
  private wavToBuffer(ctx: AudioContext, bytes: ArrayBuffer): AudioBuffer | null {
    if (bytes.byteLength <= 44) return null
    const view = new DataView(bytes)
    // RIFF sanity check — fall through silently on anything unexpected.
    if (view.getUint32(0, false) !== 0x52494646 /* 'RIFF' */) return null
    const sampleRate = view.getUint32(24, true)
    const samples = Math.floor((bytes.byteLength - 44) / 2)
    if (sampleRate < 8000 || samples === 0) return null
    const buffer = ctx.createBuffer(1, samples, sampleRate)
    const ch = buffer.getChannelData(0)
    for (let i = 0; i < samples; i++) {
      ch[i] = view.getInt16(44 + i * 2, true) / 32768
    }
    return buffer
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.connect(this.ctx.destination)
      this.nextTime = 0
    }
    return this.ctx
  }
}
