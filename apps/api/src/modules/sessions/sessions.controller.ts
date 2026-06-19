import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CurrentUser, type JwtPayload } from '../../core/auth/decorators/current-user.decorator';
import { Permissions } from '../../core/auth/decorators/permissions.decorator';
import { ValidationException } from '../../core/errors/domain.errors';
import { SessionsService } from './sessions.service';
import { StartSessionDtoSchema, SessionQueryDtoSchema, MessageQueryDtoSchema } from './dto/session.dto';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Permissions('sessions:write')
  async start(@Body() body: unknown, @CurrentUser() actor: JwtPayload) {
    const result = StartSessionDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid session payload', result.error.issues);
    return this.sessionsService.start(result.data, { sub: actor.sub, role: actor.role });
  }

  @Get()
  @Permissions('sessions:read')
  async list(@Query() query: unknown, @CurrentUser() actor: JwtPayload) {
    const result = SessionQueryDtoSchema.safeParse(query);
    if (!result.success) throw new ValidationException('Invalid query', result.error.issues);
    return this.sessionsService.list(result.data, actor.sub, actor.role);
  }

  @Get(':uid/messages')
  @Permissions('sessions:read')
  async getMessages(
    @Param('uid') uid: string,
    @Query() query: unknown,
    @CurrentUser() actor: JwtPayload,
  ) {
    const result = MessageQueryDtoSchema.safeParse(query);
    if (!result.success) throw new ValidationException('Invalid query', result.error.issues);
    return this.sessionsService.getMessages(uid, result.data, actor.sub, actor.role);
  }

  @Get(':uid')
  @Permissions('sessions:read')
  async findOne(@Param('uid') uid: string, @CurrentUser() actor: JwtPayload) {
    return this.sessionsService.findByUid(uid, actor.sub, actor.role);
  }

  @Post(':uid/end')
  @HttpCode(HttpStatus.OK)
  async end(@Param('uid') uid: string, @CurrentUser() actor: JwtPayload) {
    return this.sessionsService.end(uid, actor.sub, actor.role);
  }
}
