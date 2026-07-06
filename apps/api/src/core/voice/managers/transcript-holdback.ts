/**
 * Streams assistant transcript deltas to the client while making sure the
 * end-of-conversation sentinel (e.g. "[CONVERSATION_ENDED]") never becomes
 * visible: any tail of the emitted text that could be the start of the
 * sentinel is held back until the next delta proves it either is (dropped)
 * or isn't (released).
 */
export class SentinelHoldback {
  private buffer = '';

  constructor(private readonly sentinel: string) {}

  /** Add a delta; returns the text that is now safe to show the user. */
  push(delta: string): string {
    this.buffer += delta;
    // A complete sentinel anywhere in the buffer is dropped outright.
    this.buffer = this.buffer.split(this.sentinel).join('');
    const hold = this.holdLength();
    const safe = this.buffer.slice(0, this.buffer.length - hold);
    this.buffer = this.buffer.slice(this.buffer.length - hold);
    return safe;
  }

  /** End of response: release whatever held text was NOT a sentinel. */
  flush(): string {
    const rest = this.buffer.split(this.sentinel).join('');
    this.buffer = '';
    return rest;
  }

  /** Longest suffix of the buffer that is a prefix of the sentinel. */
  private holdLength(): number {
    const max = Math.min(this.buffer.length, this.sentinel.length - 1);
    for (let len = max; len > 0; len--) {
      if (this.buffer.endsWith(this.sentinel.slice(0, len))) return len;
    }
    return 0;
  }
}
