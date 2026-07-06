/**
 * AudioWorklet processor — converts Float32 PCM (from getUserMedia) to Int16 PCM
 * at the AudioContext's native sample rate. The main thread downsamples to the
 * wire rate (16 kHz); forcing a 16 kHz context here triggered macOS/Chromium
 * mixed-sample-rate bugs that pitch-shifted OTHER contexts' output.
 * Transfers the Int16 buffer to the main thread on each process() call.
 */
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel?.length) {
      const pcm16 = new Int16Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        const s = channel[i];
        pcm16[i] = s > 1 ? 32767 : s < -1 ? -32768 : Math.round(s * 32767);
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-processor', PcmProcessor);
