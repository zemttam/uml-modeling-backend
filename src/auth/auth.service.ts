import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { UserEntity } from '../users/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(username: string, password: string): Promise<UserEntity> {
    if (
      !username ||
      !password ||
      typeof username !== 'string' ||
      typeof password !== 'string'
    ) {
      throw new UnauthorizedException('incorrect credentials');
    }
    const existing = await this.usersService.findByUsername(username);
    if (existing) {
      throw new UnauthorizedException('username taken');
    }
    try {
      return await this.usersService.create(username, password);
    } catch {
      throw new UnauthorizedException('incorrect credentials');
    }
  }

  async login(username: string, password: string): Promise<UserEntity> {
    if (!username || !password) {
      throw new UnauthorizedException('incorrect credentials');
    }
    const user = await this.usersService.findByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('incorrect credentials');
    }
    return user;
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.usersService.findById(id);
  }

  signToken(user: { id: string; username: string }): string {
    return this.jwtService.sign(
      { sub: user.id, username: user.username },
      { expiresIn: '7d' },
    );
  }

  verifyToken(token: string): { sub: string; username: string } {
    return this.jwtService.verify(token);
  }
}
