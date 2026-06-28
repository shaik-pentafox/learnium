import { describe, it, expect } from '@jest/globals';
import { SentenceChunker } from './sentence-chunker';

describe('SentenceChunker', () => {
  it('emits nothing until a terminator clears minChars', () => {
    const c = new SentenceChunker();
    expect(c.push('Hello there')).toEqual([]); // no terminator yet
  });

  it('emits a sentence when a terminator lands', () => {
    const c = new SentenceChunker();
    expect(c.push('Hello there, how are you?')).toEqual([
      'Hello there, how are you?',
    ]);
  });

  it('splits multiple sentences from one delta in order', () => {
    const c = new SentenceChunker();
    // 'Third?' is below minChars, so it holds until flush.
    expect(c.push('First sentence here. Second sentence here! Third?')).toEqual([
      'First sentence here.',
      'Second sentence here!',
    ]);
    expect(c.flush()).toEqual(['Third?']);
  });

  it('reassembles sentences across token-sized deltas', () => {
    const c = new SentenceChunker();
    const tokens = ['How ', 'can ', 'I ', 'help ', 'you ', 'today', '?'];
    const emitted = tokens.flatMap((t) => c.push(t));
    expect(emitted).toEqual(['How can I help you today?']);
  });

  it('does not break on a short abbreviation/number terminator', () => {
    const c = new SentenceChunker();
    // "1." is below minChars, so it keeps buffering to the real sentence end.
    expect(c.push('1. Please confirm your account number.')).toEqual([
      '1. Please confirm your account number.',
    ]);
  });

  it('breaks on a newline regardless of length', () => {
    const c = new SentenceChunker();
    expect(c.push('Hi\n')).toEqual(['Hi']);
  });

  it('flush emits a trailing partial sentence with no terminator', () => {
    const c = new SentenceChunker();
    expect(c.push('No terminator yet')).toEqual([]);
    expect(c.flush()).toEqual(['No terminator yet']);
  });

  it('buffers a sub-minChars sentence until flush (short final line speaks at end)', () => {
    const c = new SentenceChunker();
    expect(c.push('Done.')).toEqual([]); // 5 chars < minChars, held back
    expect(c.flush()).toEqual(['Done.']);
  });

  it('flush returns empty after a full-length sentence already emitted', () => {
    const c = new SentenceChunker();
    expect(c.push('That is all for now.')).toEqual(['That is all for now.']);
    expect(c.flush()).toEqual([]);
  });

  it('handles the Devanagari danda terminator', () => {
    const c = new SentenceChunker();
    expect(c.push('नमस्ते आप कैसे हैं।')).toEqual(['नमस्ते आप कैसे हैं।']);
  });
});
