import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Env } from '../config/env.schema';

export interface StreamChunk {
  delta: string;
  done: boolean;
}

@Injectable()
export class LlmClientService {
  readonly client: OpenAI;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.client = new OpenAI({
      baseURL: config.get('LITELLM_BASE_URL', { infer: true }),
      apiKey: config.get('LITELLM_API_KEY', { infer: true }),
    });
  }

  async *stream(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    model: string,
  ): AsyncGenerator<StreamChunk> {
    const response = await this.client.chat.completions.create({
      model,
      messages,
      stream: true,
    });

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) yield { delta, done: false };
    }

    yield { delta: '', done: true };
  }

  async complete(
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    model: string,
  ): Promise<string> {
    const resp = await this.client.chat.completions.create({
      model,
      messages,
      response_format: { type: 'json_object' },
    });
    return resp.choices[0]?.message?.content ?? '{}';
  }
}
