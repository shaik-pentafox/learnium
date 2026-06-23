import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type JwtPayload } from '../../core/auth/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** GET /dashboard/summary — role-aware home metrics for the logged-in user. */
  @Get('summary')
  async summary(@CurrentUser() actor: JwtPayload) {
    return this.dashboardService.summary({ sub: actor.sub, role: actor.role });
  }
}
