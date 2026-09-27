import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { sub: string; username: string };
  }
}
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(200)
  async signup(@Body() body: { username?: string; password?: string }) {
    const user = await this.authService.signup(body.username, body.password);
    const token = this.authService.signToken({
      id: user.id,
      username: user.username,
    });
    return { username: user.username, token };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { username?: string; password?: string }) {
    const user = await this.authService.login(body.username, body.password);
    const token = this.authService.signToken({
      id: user.id,
      username: user.username,
    });
    return {
      username: user.username,
      lastOpenedProjectId: user.lastOpenedProjectId ?? null,
      token,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: Request) {
    const payload = req.user as { username: string; sub: string };
    const user = await this.authService.findById(payload.sub);
    return {
      username: payload.username,
      lastOpenedProjectId: user?.lastOpenedProjectId ?? null,
    };
  }
}
