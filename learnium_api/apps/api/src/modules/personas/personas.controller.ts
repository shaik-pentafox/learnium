import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { CurrentUser, type JwtPayload } from '../../core/auth/decorators/current-user.decorator';
import { Permissions } from '../../core/auth/decorators/permissions.decorator';
import { ValidationException } from '../../core/errors/domain.errors';
import type { Env } from '../../core/config/env.schema';
import { PersonasService } from './personas.service';
import {
  CreatePersonaDtoSchema,
  UpdatePersonaDtoSchema,
  PersonaQueryDtoSchema,
  EnhanceDtoSchema,
} from './dto/persona.dto';

@Controller('personas')
export class PersonasController {
  private readonly openai: OpenAI;

  constructor(
    private readonly personasService: PersonasService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.openai = new OpenAI({
      baseURL: config.get('LITELLM_BASE_URL', { infer: true }),
      apiKey: config.get('LITELLM_API_KEY', { infer: true }),
    });
  }

  @Get('my')
  async myPersonas(@CurrentUser() user: JwtPayload) {
    return this.personasService.myPersonas(user.sub, user.role);
  }

  @Get()
  @Permissions('personas:read')
  async list(@Query() query: unknown) {
    const result = PersonaQueryDtoSchema.safeParse(query);
    if (!result.success) throw new ValidationException('Invalid query', result.error.issues);
    return this.personasService.list(result.data);
  }

  @Get(':id/versions')
  @Permissions('personas:read')
  async getVersions(@Param('id', ParseIntPipe) id: number) {
    return this.personasService.getVersions(id);
  }

  @Get(':id/versions/:v')
  @Permissions('personas:read')
  async getVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('v', ParseIntPipe) v: number,
  ) {
    return this.personasService.getVersion(id, v);
  }

  @Get(':id')
  @Permissions('personas:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.personasService.findById(id);
  }

  @Post()
  @Permissions('personas:write')
  async create(@Body() body: unknown, @CurrentUser() actor: JwtPayload) {
    const result = CreatePersonaDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid persona payload', result.error.issues);
    return this.personasService.create(result.data, actor.sub);
  }

  @Post(':id/enhance')
  @Permissions('personas:write')
  async enhance(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ) {
    const result = EnhanceDtoSchema.safeParse(body ?? {});
    if (!result.success) throw new ValidationException('Invalid enhance payload', result.error.issues);

    const persona = await this.personasService.findById(id);
    const source = result.data.field === 'customInstructions'
      ? (persona.customInstructions ?? persona.systemPrompt)
      : persona.systemPrompt;

    const systemMsg = 'You are an expert prompt engineer. Improve the given roleplay persona instruction to be clearer, more immersive, and more effective for AI-driven training simulations. Preserve the persona intent. Return only the improved text, no commentary.';
    const userMsg = result.data.instruction
      ? `Additional instruction: ${result.data.instruction}\n\nOriginal:\n${source}`
      : `Original:\n${source}`;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    try {
      const stream = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: userMsg },
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          reply.raw.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
    } catch {
      reply.raw.write(`data: ${JSON.stringify({ error: 'LLM unavailable' })}\n\n`);
    }

    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
  }

  @Patch(':id')
  @Permissions('personas:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() actor: JwtPayload,
  ) {
    const result = UpdatePersonaDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid persona payload', result.error.issues);
    return this.personasService.update(id, result.data, actor.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('personas:delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    await this.personasService.softDelete(id, actor.sub);
  }
}
