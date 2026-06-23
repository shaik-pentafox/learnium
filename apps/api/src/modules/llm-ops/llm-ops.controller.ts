import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { LlmOpsService } from './llm-ops.service';
import { UsageService } from '../../core/llm/usage.service';
import { Permissions } from '../../core/auth/decorators/permissions.decorator';
import { ValidationException } from '../../core/errors/domain.errors';
import {
  CreateProviderDtoSchema,
  UpdateProviderDtoSchema,
  CreateModelDtoSchema,
  UpdateModelDtoSchema,
  ModelQueryDtoSchema,
} from './dto/llm-ops.dto';

@Controller('llm')
export class LlmOpsController {
  constructor(
    private readonly llmOpsService: LlmOpsService,
    private readonly usage: UsageService,
  ) {}

  // ── Usage telemetry ──────────────────────────────────────────────────────────

  @Get('usage')
  @Permissions('llmops:read')
  usageSummary(
    @Query('days') days?: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.usage.summary({
      ...(days ? { days: Number(days) } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
  }

  // ── Providers ──────────────────────────────────────────────────────────────

  @Get('providers')
  @Permissions('llmops:read')
  listProviders() {
    return this.llmOpsService.listProviders();
  }

  @Post('providers')
  @Permissions('llmops:write')
  createProvider(@Body() body: unknown) {
    const result = CreateProviderDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid provider payload', result.error.issues);
    return this.llmOpsService.createProvider(result.data);
  }

  @Patch('providers/:id')
  @Permissions('llmops:write')
  updateProvider(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const result = UpdateProviderDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid provider payload', result.error.issues);
    return this.llmOpsService.updateProvider(id, result.data);
  }

  @Delete('providers/:id')
  @Permissions('llmops:write')
  disableProvider(@Param('id', ParseIntPipe) id: number) {
    return this.llmOpsService.disableProvider(id);
  }

  // ── Models ─────────────────────────────────────────────────────────────────

  @Get('models')
  @Permissions('llmops:read')
  listModels(@Query() query: unknown) {
    const result = ModelQueryDtoSchema.safeParse(query);
    if (!result.success) throw new ValidationException('Invalid query', result.error.issues);
    return this.llmOpsService.listModels(result.data);
  }

  @Post('models')
  @Permissions('llmops:write')
  createModel(@Body() body: unknown) {
    const result = CreateModelDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid model payload', result.error.issues);
    return this.llmOpsService.createModel(result.data);
  }

  @Patch('models/:id')
  @Permissions('llmops:write')
  updateModel(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    const result = UpdateModelDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid model payload', result.error.issues);
    return this.llmOpsService.updateModel(id, result.data);
  }

  @Post('models/:id/promote')
  @Permissions('llmops:write')
  promoteModel(@Param('id', ParseIntPipe) id: number) {
    return this.llmOpsService.promoteModel(id);
  }
}
