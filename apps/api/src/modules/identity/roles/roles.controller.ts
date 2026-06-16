import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    return this.prisma.roleDef.findMany({ orderBy: { id: 'asc' } });
  }
}
