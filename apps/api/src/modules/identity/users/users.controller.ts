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
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { CurrentUser, type JwtPayload } from '../../../core/auth/decorators/current-user.decorator';
import { Permissions } from '../../../core/auth/decorators/permissions.decorator';
import { ValidationException } from '../../../core/errors/domain.errors';
import { UsersService } from './users.service';
import { ImportService } from '../import/import.service';
import {
  CreateUserDtoSchema,
  UpdateUserDtoSchema,
  UserQueryDtoSchema,
} from './dto/user.dto';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly importService: ImportService,
  ) {}

  @Get()
  @Permissions('users:read')
  async list(@Query() query: unknown) {
    const result = UserQueryDtoSchema.safeParse(query);
    if (!result.success) throw new ValidationException('Invalid query', result.error.issues);
    return this.usersService.list(result.data);
  }

  @Get('import/:reportId')
  @Permissions('users:write')
  async getImportReport(@Param('reportId') reportId: string) {
    return this.importService.getReport(reportId);
  }

  @Get('import/:reportId/errors')
  @Permissions('users:write')
  async downloadErrors(@Param('reportId') reportId: string, @Res() reply: FastifyReply) {
    await this.importService.streamErrors(reportId, reply);
  }

  @Get(':id')
  @Permissions('users:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findById(id);
  }

  @Post()
  @Permissions('users:write')
  async create(@Body() body: unknown, @CurrentUser() actor: JwtPayload) {
    const result = CreateUserDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid user payload', result.error.issues);
    return this.usersService.create(result.data, actor.sub);
  }

  @Post('import')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('users:write')
  async importUsers(@Req() req: FastifyRequest, @CurrentUser() actor: JwtPayload) {
    const file = await req.file();
    if (!file) throw new ValidationException('No file uploaded');
    const buf = await file.toBuffer();
    return this.importService.startImport(buf, file.filename, actor.sub);
  }

  @Patch(':id')
  @Permissions('users:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentUser() actor: JwtPayload,
  ) {
    const result = UpdateUserDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid user payload', result.error.issues);
    return this.usersService.update(id, result.data, actor.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions('users:delete')
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: JwtPayload) {
    await this.usersService.softDelete(id, actor.sub);
  }
}
