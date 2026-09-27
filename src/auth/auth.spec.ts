import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/user.entity';
import { JwtService } from '@nestjs/jwt';

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  const user = new UserEntity();
  user.id = 'user-1';
  user.username = 'alice';
  user.password = 'hashed';
  user.lastOpenedProjectId = null;
  Object.assign(user, overrides);
  return user;
}

describe('AuthController (Bearer auth)', () => {
  let controller: AuthController;
  let authService: {
    signup: jest.Mock;
    login: jest.Mock;
    findById: jest.Mock;
    signToken: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      signup: jest.fn(),
      login: jest.fn(),
      findById: jest.fn(),
      signToken: jest.fn().mockReturnValue('stubjwt.token'),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: {} },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(
              (payload: Record<string, unknown>) =>
                `stubjwt.${Buffer.from(JSON.stringify(payload)).toString('base64')}`,
            ),
            verify: jest.fn(),
          },
        },
      ],
    }).compile();
    controller = moduleRef.get(AuthController);
  });

  it('returns a token in the signup response body', async () => {
    authService.signup.mockResolvedValue(makeUser());
    const result = await controller.signup({
      username: 'alice',
      password: 'pw',
    });
    expect(result.username).toBe('alice');
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);
  });

  it('returns a token and lastOpenedProjectId in the login response body', async () => {
    authService.login.mockResolvedValue(
      makeUser({ lastOpenedProjectId: 'proj-9' }),
    );
    const result = await controller.login({
      username: 'alice',
      password: 'pw',
    });
    expect(result.username).toBe('alice');
    expect(result.lastOpenedProjectId).toBe('proj-9');
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(0);
  });
});

describe('JwtAuthGuard (Bearer header)', () => {
  let guard: JwtAuthGuard;
  let jwtService: { sign: jest.Mock; verify: jest.Mock };

  function makeContext(headers: Record<string, string>) {
    const request = { headers, user: undefined };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;
  }

  beforeEach(() => {
    jwtService = { sign: jest.fn(), verify: jest.fn() };
    guard = new JwtAuthGuard(jwtService as never);
  });

  it('accepts a request with a valid Authorization: Bearer header', () => {
    const payload = { sub: 'user-1', username: 'alice' };
    jwtService.verify.mockReturnValue(payload);
    const context = makeContext({ authorization: `Bearer stubjwt.abc` });
    expect(guard.canActivate(context)).toBe(true);
    const request = (
      context as unknown as {
        switchToHttp: () => { getRequest: () => { user?: unknown } };
      }
    )
      .switchToHttp()
      .getRequest();
    expect(request.user).toEqual(payload);
  });

  it('rejects a request without an Authorization header', () => {
    const context = makeContext({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a request with a non-Bearer Authorization header', () => {
    const context = makeContext({ authorization: 'Basic dXNlcjpwYXNz' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a request with an invalid Bearer token', () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('invalid token');
    });
    const context = makeContext({ authorization: 'Bearer not-a-jwt' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
