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
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { CurrentUser, type JwtPayload } from '../../core/auth/decorators/current-user.decorator';
import { Permissions } from '../../core/auth/decorators/permissions.decorator';
import { ValidationException } from '../../core/errors/domain.errors';
import { ModelFactoryService } from '../../core/llm/model-factory.service';
import { LlmFlowLogger, previewText } from '../../core/llm/llm-flow.logger';
import { PersonasService } from './personas.service';
import {
  CreatePersonaDtoSchema,
  UpdatePersonaDtoSchema,
  PersonaQueryDtoSchema,
  EnhanceDtoSchema,
} from './dto/persona.dto';

@Controller('personas')
export class PersonasController {
  constructor(
    private readonly personasService: PersonasService,
    private readonly models: ModelFactoryService,
    private readonly flowLog: LlmFlowLogger,
  ) {}

  @Get('my')
  async myPersonas(@CurrentUser() user: JwtPayload) {
    return this.personasService.myPersonas({ sub: user.sub, role: user.role });
  }

  @Get()
  @Permissions('personas:read')
  async list(@Query() query: unknown, @CurrentUser() actor: JwtPayload) {
    const result = PersonaQueryDtoSchema.safeParse(query);
    if (!result.success) throw new ValidationException('Invalid query', result.error.issues);
    return this.personasService.list(result.data, { sub: actor.sub, role: actor.role });
  }

  @Get(':id/versions')
  @Permissions('personas:read')
  async getVersions(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    return this.personasService.getVersions(id, { sub: actor.sub, role: actor.role });
  }

  @Get(':id/versions/:v')
  @Permissions('personas:read')
  async getVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('v', ParseIntPipe) v: number,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.personasService.getVersion(id, v, { sub: actor.sub, role: actor.role });
  }

  @Get(':id')
  @Permissions('personas:read')
  async findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    return this.personasService.findById(id, { sub: actor.sub, role: actor.role });
  }

  @Post()
  @Permissions('personas:write')
  async create(@Body() body: unknown, @CurrentUser() actor: JwtPayload) {
    const result = CreatePersonaDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid persona payload', result.error.issues);
    return this.personasService.create(result.data, actor.sub);
  }

  @Post(':id/publish')
  @Permissions('personas:write')
  async publish(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    return this.personasService.publish(id, { sub: actor.sub, role: actor.role });
  }

  @Post(':id/unpublish')
  @Permissions('personas:write')
  async unpublish(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    return this.personasService.unpublish(id, { sub: actor.sub, role: actor.role });
  }

  @Post(':id/enhance')
  @Permissions('personas:write')
  async enhance(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
    @CurrentUser() actor: JwtPayload,
  ) {
    const result = EnhanceDtoSchema.safeParse(body ?? {});
    if (!result.success) throw new ValidationException('Invalid enhance payload', result.error.issues);

    const persona = await this.personasService.findById(id, { sub: actor.sub, role: actor.role });
    const source = result.data.field === 'customInstructions'
      ? (persona.customInstructions ?? persona.systemPrompt)
      : persona.systemPrompt;

    const systemMsg = 'You are an expert prompt engineer. Improve the given roleplay persona instruction to be clearer, more immersive, and more effective for AI-driven training simulations. Preserve the persona intent. Return only the improved text, no commentary.';
    const userMsg = result.data.instruction
      ? `Additional instruction: ${result.data.instruction}\n\nOriginal:\n${source}`
      : `Original:\n${source}`;

    const span = this.flowLog.start('persona_enhance', {
      personaId: id,
      field: result.data.field,
      inputChars: userMsg.length,
      inputPreview: previewText(userMsg),
    });

    // Resolve the default registry model before opening the SSE stream so a
    // missing-model error returns a clean 503 instead of a half-open stream.
    let chat;
    try {
      ({ chat } = await this.models.resolve(null));
    } catch (err) {
      span.fail(err);
      throw err;
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders();

    let outputChars = 0;
    let chunkCount = 0;
    try {
      const stream = await chat.stream([
        new SystemMessage(systemMsg),
        new HumanMessage(userMsg),
      ]);

      for await (const chunk of stream) {
        chunkCount++;
        const content =
          typeof chunk.content === 'string' ? chunk.content : '';
        if (content) {
          outputChars += content.length;
          reply.raw.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
      span.complete({ outputChars, chunkCount });
    } catch (err) {
      span.fail(err, { outputChars, chunkCount });
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
    return this.personasService.update(id, result.data, { sub: actor.sub, role: actor.role });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('personas:delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    await this.personasService.softDelete(id, { sub: actor.sub, role: actor.role });
  }
}
