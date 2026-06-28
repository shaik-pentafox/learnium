/**
 * Splits a stream of LLM token deltas into speakable sentence chunks.
 *
 * Voice latency rule: do NOT wait for the full reply before TTS. Feed token
 * deltas here; whenever a sentence terminator (. ? ! । or newline) lands and the
 * buffer clears a minimum length, the completed sentence is emitted so it can be
 * synthesized while the LLM is still generating the rest. Call {@link flush} at
 * stream end to emit any trailing partial sentence.
 *
 * Pure and synchronous — no I/O, trivially unit-testable.
 */

/** Sentence-ending punctuation, incl. the Devanagari danda (।) for Indic text. */
const TERMINATORS = /[.!?।]/;

export class SentenceChunker {
  private buffer = '';

  /**
   * @param minChars Minimum trimmed length before a terminator triggers a flush.
   *   Guards against tiny fragments ("1.", "Mr.") becoming their own TTS calls.
   */
  constructor(private readonly minChars = 12) {}

  /**
   * Add a token delta. Returns zero or more completed sentences ready to speak,
   * in order. Most calls return `[]`.
   */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];

    for (;;) {
      const sentence = this.takeSentence();
      if (sentence === null) break;
      out.push(sentence);
    }
    return out;
  }

  /** Emit any remaining buffered text as a final chunk (call once at stream end). */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest.length > 0 ? [rest] : [];
  }

  /**
   * Pull the earliest complete sentence from the buffer, or null if none is ready.
   * A newline always breaks (any length). Otherwise the first terminator whose
   * preceding text clears `minChars` breaks — shorter terminators (abbreviations,
   * list numbers like "1.") are skipped so they don't stall or fragment the stream.
   */
  private takeSentence(): string | null {
    const newlineIdx = this.buffer.indexOf('\n');
    const termIdx = this.findBreakableTerminator();

    if (termIdx === -1 && newlineIdx === -1) return null;

    // Whichever boundary comes first wins; newline wins ties and ignores minChars.
    if (newlineIdx !== -1 && (termIdx === -1 || newlineIdx < termIdx)) {
      const sentence = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      return sentence.length > 0 ? sentence : this.takeSentence();
    }

    const sentence = this.buffer.slice(0, termIdx + 1).trim();
    this.buffer = this.buffer.slice(termIdx + 1);
    return sentence;
  }

  /**
   * Index of the first terminator whose sentence (buffer start → terminator)
   * clears `minChars`, or -1 if none yet. Skipping short ones lets the buffer keep
   * accumulating past abbreviations and numbered list markers.
   */
  private findBreakableTerminator(): number {
    for (let i = 0; i < this.buffer.length; i++) {
      if (!TERMINATORS.test(this.buffer[i]!)) continue;
      if (this.buffer.slice(0, i + 1).trim().length >= this.minChars) return i;
    }
    return -1;
  }
}
