import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type JwtPayload } from '../../core/auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

interface PageParams {
  page: number;
  limit: number;
  q?: string;
  published?: boolean;
}

/** Parse shared list query params (page/limit/q[/published]) with sane caps. */
function pageParams(
  page?: string,
  limit?: string,
  q?: string,
  published?: string,
): PageParams {
  return {
    page: Math.max(1, Number(page) || 1),
    limit: Math.min(100, Math.max(1, Number(limit) || 20)),
    ...(q ? { q } : {}),
    ...(published === 'true' ? { published: true } : {}),
    ...(published === 'false' ? { published: false } : {}),
  };
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** GET /dashboard/summary — role-aware home metrics for the logged-in user. */
  @Get('summary')
  async summary(@CurrentUser() actor: JwtPayload) {
    return this.dashboardService.summary({ sub: actor.sub, role: actor.role });
  }

  /** GET /dashboard/report/trainers — admin per-trainer rollup (paginated). */
  @Get('report/trainers')
  async reportTrainers(
    @CurrentUser() actor: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    return this.dashboardService.reportTrainers(actor, pageParams(page, limit, q));
  }

  /** GET /dashboard/report/personas — admin per-persona rollup (paginated). */
  @Get('report/personas')
  async reportPersonas(
    @CurrentUser() actor: JwtPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('published') published?: string,
  ) {
    return this.dashboardService.reportPersonas(
      actor,
      pageParams(page, limit, q, published),
    );
  }
}
