import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type JwtPayload } from '../../core/auth/decorators/current-user.decorator';
import { LeaderboardService } from './leaderboard.service';

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  /** GET /leaderboard — trainee ranking over a rolling window. Visible to every
   *  authenticated role; the board is the motivation feature, not a report. */
  @Get()
  async board(
    @CurrentUser() actor: JwtPayload,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
  ) {
    return this.leaderboardService.board(
      { sub: actor.sub, role: actor.role },
      {
        days: Math.min(MAX_DAYS, Math.max(1, Number(days) || DEFAULT_DAYS)),
        limit: Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT)),
      },
    );
  }
}
