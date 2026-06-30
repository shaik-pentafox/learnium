import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';
import type { RoleplayGraph } from '../../core/llm/roleplay-graph';
import type { VoiceTurnManager } from '../../core/voice/voice-turn.manager';

export interface WsClient {
  ws: WebSocket;
  userId: number;
  sessionDbId?: number;
  sessionUid?: string;
  personaName?: string;
  /** Per-session compiled LangGraph (model + system prompt bound). */
  graph?: RoleplayGraph;
  /** Resolved conversation model — carried for usage telemetry. */
  modelId?: number;
  modelName?: string;
  providerType?: string;
  /** Epoch ms of the last persisted message — used to time the next turn. */
  lastTurnAt?: number;
  /** Voice: allowed BCP-47 codes from the persona (empty = voice disabled). */
  personaLanguages?: string[];
  /** Voice: persona's default Sarvam voiceId (null = none configured). */
  personaVoiceId?: string | null;
  /** Active voice turn manager for this connection (set on voice_start). */
  voiceTurn?: VoiceTurnManager;
  /** Mutable holder so voice_start can swap the live system prompt without rebuilding the graph. */
  systemPromptHolder?: { active: string };
  /** Original (no-language) system prompt — restored on voice_stop. */
  baseSystemPrompt?: string;
}

@Injectable()
export class SessionRegistry {
  private readonly bySession = new Map<number, WsClient>();
  private readonly byWs = new Map<WebSocket, WsClient>();

  add(ws: WebSocket, userId: number): WsClient {
    const client: WsClient = { ws, userId };
    this.byWs.set(ws, client);
    return client;
  }

  attachSession(
    client: WsClient,
    sessionDbId: number,
    sessionUid: string,
    personaName: string,
    graph: RoleplayGraph,
  ): void {
    client.sessionDbId = sessionDbId;
    client.sessionUid = sessionUid;
    client.personaName = personaName;
    client.graph = graph;
    this.bySession.set(sessionDbId, client);
  }

  get(ws: WebSocket): WsClient | undefined {
    return this.byWs.get(ws);
  }

  remove(ws: WebSocket): void {
    const client = this.byWs.get(ws);
    if (client?.sessionDbId !== undefined) {
      this.bySession.delete(client.sessionDbId);
    }
    this.byWs.delete(ws);
  }
}
