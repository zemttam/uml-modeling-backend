import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectEntity } from './project.entity';
import { UserEntity } from '../users/user.entity';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
  ) {}

  async create(
    ownerId: string,
    name: string,
    diagram?: unknown,
  ): Promise<ProjectEntity> {
    const project = this.projectsRepository.create({
      name,
      ownerId,
      diagram:
        diagram !== undefined
          ? diagram
          : {
              packageName: name,
              diagramName: 'New Class Diagram',
              elements: [],
              relationships: [],
            },
    });
    const saved = await this.projectsRepository.save(project);
    await this.usersRepository.update(ownerId, {
      lastOpenedProjectId: saved.id,
    });
    return saved;
  }

  async listOwned(userId: string): Promise<ProjectEntity[]> {
    return this.projectsRepository.find({
      where: { ownerId: userId },
      order: { createdAt: 'ASC' },
    });
  }

  // Any authenticated user may fetch an existing project by id (shared via
  // the share link). Ownership is no longer required for read access.
  async get(id: string): Promise<ProjectEntity> {
    const project = await this.projectsRepository.findOne({
      where: { id },
    });
    if (!project) {
      throw new NotFoundException('project not found');
    }
    return project;
  }

  async rename(
    id: string,
    userId: string,
    name: string,
  ): Promise<ProjectEntity> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('name is required');
    }
    const project = await this.projectsRepository.findOne({
      where: { id },
    });
    if (!project) {
      throw new NotFoundException('project not found');
    }
    if (project.ownerId !== userId) {
      throw new ForbiddenException('not your project');
    }
    project.name = trimmed;
    return this.projectsRepository.save(project);
  }

  // Replace-in-place import: ownership-checked atomic update of both the
  // project's name and its whole diagram document.
  async replaceDocument(
    id: string,
    userId: string,
    name: string,
    diagram: unknown,
  ): Promise<ProjectEntity> {
    const project = await this.projectsRepository.findOne({
      where: { id },
    });
    if (!project) {
      throw new NotFoundException('project not found');
    }
    if (project.ownerId !== userId) {
      throw new ForbiddenException('not your project');
    }
    project.name = name;
    project.diagram = diagram;
    return this.projectsRepository.save(project);
  }

  async remove(id: string, userId: string): Promise<void> {
    const project = await this.projectsRepository.findOne({
      where: { id },
    });
    if (!project) {
      throw new NotFoundException('project not found');
    }
    if (project.ownerId !== userId) {
      throw new ForbiddenException('not your project');
    }
    await this.projectsRepository.delete(id);
    const owner = await this.usersRepository.findOne({
      where: { id: userId },
    });
    if (owner && owner.lastOpenedProjectId === id) {
      await this.usersRepository.update(userId, {
        lastOpenedProjectId: null,
      });
    }
  }
}
