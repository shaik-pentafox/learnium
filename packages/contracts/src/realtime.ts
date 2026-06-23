import { z } from 'zod';

// ── Client → Server ───────────────────────────────────────────────────────────

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), content: z.string(), id: z.string() }),
  z.object({ type: z.literal('control'), action: z.enum(['begin', 'end']) }),
  z.object({ type: z.literal('resume'), lastMessageId: z.string() }),
  z.object({ type: z.literal('ping') }),
]);

export const VoiceControlSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('control'), action: z.enum(['interrupt', 'end']) }),
  z.object({ type: z.literal('ping') }),
]);

// ── Server → Client ───────────────────────────────────────────────────────────

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), delta: z.string() }),
  z.object({
    type: z.literal('message_done'),
    messageId: z.string(),
    emotion: z.string().optional(),
    emoji: z.string().optional(),
  }),
  z.object({ type: z.literal('session_ending') }),
  z.object({
    type: z.literal('session_ended'),
    scores: z.array(z.unknown()),
    feedback: z.string().optional(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('reconnect'), reason: z.string() }),
  z.object({ type: z.literal('pong') }),
]);

export const VoiceServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('speech_start') }),
  z.object({ type: z.literal('speech_end') }),
  z.object({ type: z.literal('transcript'), role: z.enum(['user', 'assistant']), text: z.string() }),
  z.object({ type: z.literal('emotion'), value: z.string() }),
  z.object({ type: z.literal('session_ended'), scores: z.array(z.unknown()), feedback: z.string().optional() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('reconnect'), reason: z.string() }),
  z.object({ type: z.literal('pong') }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type VoiceServerMessage = z.infer<typeof VoiceServerMessageSchema>;
