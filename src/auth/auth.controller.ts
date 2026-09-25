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
    const token = this.authService.signToken({
      id: user.id,
      username: user.username,
    });
    this.setSessionCookie(res, token);
    return { username: user.username, token };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { username?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.authService.login(body.username, body.password);
    const token = this.authService.signToken({
      id: user.id,
      username: user.username,
    });
    this.setSessionCookie(res, token);
    return {
      username: user.username,
      lastOpenedProjectId: user.lastOpenedProjectId ?? null,
      token,
    };
  }

  // Not guarded: logout must succeed (and clear the cookie) even when the
  // session is already stale or missing, so the client always lands cleanly.
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
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

  private setSessionCookie(res: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      // Cross-site requests (frontend on Vercel, API on Render) only carry
      // the cookie in strict browsers (e.g. Firefox) with SameSite=None.
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
    });
  }
}
