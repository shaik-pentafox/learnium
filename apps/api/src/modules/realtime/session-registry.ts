import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';
import type { RoleplayGraph } from '../../core/llm/roleplay-graph';

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
