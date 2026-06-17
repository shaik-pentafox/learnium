import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../core/auth/decorators/public.decorator';
import { CurrentUser, type JwtPayload } from '../../core/auth/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDtoSchema, RefreshDtoSchema } from './dto/login.dto';
import { UpdateProfileDtoSchema, ChangePasswordDtoSchema } from './dto/profile.dto';
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

  @Get('me')
  async me(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.sub);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const result = UpdateProfileDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid profile payload', result.error.issues);
    return this.authService.updateProfile(user.sub, result.data);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const result = ChangePasswordDtoSchema.safeParse(body);
    if (!result.success) throw new ValidationException('Invalid password payload', result.error.issues);
    return this.authService.changePassword(
      user.sub,
      result.data.currentPassword,
      result.data.newPassword,
    );
  }

  @Post('realtime/ticket')
  @HttpCode(HttpStatus.CREATED)
  async realtimeTicket(@CurrentUser() user: JwtPayload) {
    const ticket = await this.authService.issueRealtimeTicket(user.sub);
    return { ticket };
  }
}
