import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './user.entity';
import { ProjectEntity } from '../projects/project.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, ProjectEntity])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
