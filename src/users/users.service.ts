import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserEntity } from './user.entity';
import { ProjectEntity } from '../projects/project.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
  ) {}

  async create(username: string, plainPassword: string): Promise<UserEntity> {
    const hashed = await bcrypt.hash(plainPassword, 10);
    const user = this.usersRepository.create({ username, password: hashed });
    return this.usersRepository.save(user);
  }

  async findById(id: string): Promise<UserEntity | null> {
    if (!id) {
      return null;
    }
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      return null;
    }
    if (user.lastOpenedProjectId) {
      const project = await this.projectsRepository.findOne({
        where: { id: user.lastOpenedProjectId, ownerId: id },
      });
      if (!project) {
        user.lastOpenedProjectId = null;
        await this.usersRepository.update(id, { lastOpenedProjectId: null });
      }
    }
    return user;
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.usersRepository.findOne({ where: { username } });
  }
}
