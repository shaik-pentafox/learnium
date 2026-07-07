import { z } from 'zod';

// ── Client → Server ───────────────────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), content: z.string(), id: z.string() }),
  z.object({
    type: z.literal('control'),
    action: z.enum(['begin', 'end', 'voice_start', 'voice_stop', 'cancel']),
    languageCode: z.string().optional(),
    voiceId: z.string().optional(),
  }),
  z.object({ type: z.literal('resume'), lastMessageId: z.string() }),
  z.object({ type: z.literal('ping') }),
]);

// ── Server → Client ───────────────────────────────────────────────────────────
//
// A roleplay session runs over ONE WebSocket channel carrying both text and voice
// frames — so there is a single server-frame union, not a separate voice schema.
// This mirrors the gateway's actual `send()` calls (chat.gateway.ts) and the
// voice managers' `sendJson()` frames (core/voice/managers/*). Keep them in
// lockstep: a frame the gateway sends but this omits is drift.

export const ServerMessageSchema = z.discriminatedUnion('type', [
  // Handshake
  z.object({
    type: z.literal('joined'),
    sessionId: z.string(),
    personaName: z.string(),
    personaColor: z.string().nullable().optional(),
    hasStarted: z.boolean().optional(),
    /** BCP-47 codes the persona allows for voice sessions. Empty = voice off. */
    personaLanguages: z.array(z.string()).optional(),
  }),
  // Text streaming
  z.object({ type: z.literal('token'), delta: z.string() }),
  z.object({
    type: z.literal('message_done'),
    messageId: z.string(),
    emotion: z.string().nullable().optional(),
    emoji: z.string().nullable().optional(),
  }),
  // Lifecycle
  z.object({ type: z.literal('session_ending') }),
  z.object({
    type: z.literal('session_ended'),
    scores: z.array(z.unknown()),
    feedback: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('reconnect'), reason: z.string() }),
  z.object({ type: z.literal('pong') }),
  // Voice (native S2S) — control
  z.object({ type: z.literal('voice_started'), languageCode: z.string(), voiceId: z.string() }),
  z.object({ type: z.literal('voice_stopped') }),
  // Voice — live transcript (STT)
  z.object({ type: z.literal('stt_partial'), text: z.string() }),
  z.object({ type: z.literal('stt_final'), text: z.string() }),
  // Voice — audio playback (TTS); a binary WAV frame follows each tts_meta
  z.object({ type: z.literal('tts_meta'), seq: z.number(), mime: z.string(), sampleRate: z.number() }),
  /** Barge-in: user spoke over the agent — stop playback immediately. */
  z.object({ type: z.literal('tts_stop') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
