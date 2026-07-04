/**
 * PCM16 helpers shared by the S2S managers: sample-rate conversion for the
 * client↔provider boundary and WAV framing so the browser's decodeAudioData
 * (already used by the client AudioPlayer) accepts raw provider PCM.
 */

/** Linear-interpolation resample of PCM16 mono LE. No-op when rates match. */
export function resamplePcm16(input: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return input;
  const inSamples = Math.floor(input.length / 2);
  if (inSamples === 0) return Buffer.alloc(0);
  const outSamples = Math.floor((inSamples * toRate) / fromRate);
  const out = Buffer.alloc(outSamples * 2);
  const ratio = (inSamples - 1) / Math.max(outSamples - 1, 1);
  for (let i = 0; i < outSamples; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input.readInt16LE(idx * 2);
    const s1 = idx + 1 < inSamples ? input.readInt16LE((idx + 1) * 2) : s0;
    out.writeInt16LE(Math.round(s0 + (s1 - s0) * frac), i * 2);
  }
  return out;
}

/** 44-byte RIFF/WAVE header for PCM16 mono at the given rate. */
export function pcm16WavHeader(dataBytes: number, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate (16-bit mono)
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}
