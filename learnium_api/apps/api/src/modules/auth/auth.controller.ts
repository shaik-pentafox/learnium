import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../core/auth/decorators/public.decorator';
import { CurrentUser, type JwtPayload } from '../../core/auth/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDtoSchema, RefreshDtoSchema } from './dto/login.dto';
import { ValidationException } from '../../core/errors/domain.errors';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() body: unknown) {
    const result = LoginDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid login payload', result.error.issues);
    return this.authService.login(result.data.username, result.data.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: unknown) {
    const result = RefreshDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('refreshToken is required');
    return this.authService.refresh(result.data.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: unknown) {
    const result = RefreshDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('refreshToken is required');
    await this.authService.logout(result.data.refreshToken);
    return { message: 'Logged out' };
  }

  @Post('realtime/ticket')
  @HttpCode(HttpStatus.CREATED)
  async realtimeTicket(@CurrentUser() user: JwtPayload) {
    const ticket = await this.authService.issueRealtimeTicket(user.sub);
    return { ticket };
  }
}
