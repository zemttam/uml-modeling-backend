export class JwtService {
  sign(payload: Record<string, unknown>): string {
    return `stubjwt.${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
  }

  verify<T = Record<string, unknown>>(token: string): T {
    if (typeof token !== 'string' || !token.startsWith('stubjwt.')) {
      throw new Error('invalid token');
    }
    return JSON.parse(
      Buffer.from(token.slice('stubjwt.'.length), 'base64').toString('utf8'),
    ) as T;
  }

  decode<T = Record<string, unknown>>(token: string): T {
    return this.verify<T>(token);
  }
}

export class JwtModule {
  static register(): { module: unknown } {
    return { module: class JwtModuleStub {} };
  }

  static registerAsync(): { module: unknown } {
    return { module: class JwtModuleAsyncStub {} };
  }
}
