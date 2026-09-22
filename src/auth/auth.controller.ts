import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { sub: string; username: string };
  }
}
import { AuthService } from './auth.service';
import { JwtAuthGuard, SESSION_COOKIE_NAME } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(200)
  async signup(
    @Body() body: { username?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.signup(body.username, body.password);
    this.setSessionCookie(res, { id: user.id, username: user.username });
    return { username: user.username };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { username?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.login(body.username, body.password);
    this.setSessionCookie(res, { id: user.id, username: user.username });
    return {
      username: user.username,
      lastOpenedProjectId: user.lastOpenedProjectId ?? null,
    };
  }

  // Not guarded: logout must succeed (and clear the cookie) even when the
  // session is already stale or missing, so the client always lands cleanly.
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.cookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 0,
    });
    return { ok: true };
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

  private setSessionCookie(
    res: Response,
    user: { id: string; username: string },
  ) {
    const token = this.authService.signToken(user);
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }
}
