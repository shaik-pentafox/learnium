import { Injectable } from '@nestjs/common';
import type { WebSocket } from 'ws';

export interface WsClient {
  ws: WebSocket;
  userId: number;
  sessionDbId?: number;
  sessionUid?: string;
  systemPrompt?: string;
  personaName?: string;
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
    systemPrompt: string,
    personaName: string,
  ): void {
    client.sessionDbId = sessionDbId;
    client.sessionUid = sessionUid;
    client.systemPrompt = systemPrompt;
    client.personaName = personaName;
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
