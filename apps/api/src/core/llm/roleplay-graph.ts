import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph';
import { SystemMessage } from '@langchain/core/messages';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { ChatRunnable } from './model-factory.service';

export type RoleplayGraph = ReturnType<typeof buildRoleplayGraph>;

export interface RoleplayGraphHooks {
  onBeforeInvoke?: (ctx: {
    messageCount: number;
    systemPromptChars: number;
  }) => void;
  onAfterInvoke?: (ctx: {
    outputChars: number;
    latencyMs: number;
  }) => void;
}

/**
 * Single-node roleplay graph: START → chatbot → END (ports the legacy LangGraph
 * shape). The system prompt + model are bound per session; the checkpointer carries
 * conversation state per `thread_id`, so each turn appends only the new user message
 * — the prior history is loaded from the checkpoint, never rebuilt by hand.
 *
 * Stream it with `streamMode: "messages"` to surface LLM tokens turn-by-turn.
 */
export function buildRoleplayGraph(
  chat: ChatRunnable,
  systemPrompt: string,
  checkpointer: PostgresSaver,
  hooks?: RoleplayGraphHooks,
) {
  const callModel = async (state: typeof MessagesAnnotation.State) => {
    hooks?.onBeforeInvoke?.({
      messageCount: state.messages.length,
      systemPromptChars: systemPrompt.length,
    });
    const startedAt = Date.now();
    const response = await chat.invoke([
      new SystemMessage(systemPrompt),
      ...state.messages,
    ]);
    const outputChars =
      typeof response.content === 'string'
        ? response.content.length
        : JSON.stringify(response.content).length;
    hooks?.onAfterInvoke?.({
      outputChars,
      latencyMs: Date.now() - startedAt,
    });
    return { messages: [response] };
  };

  return new StateGraph(MessagesAnnotation)
    .addNode('chatbot', callModel)
    .addEdge(START, 'chatbot')
    .addEdge('chatbot', END)
    .compile({ checkpointer });
}
