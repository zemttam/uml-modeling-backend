import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from './project.entity';
import { UserEntity } from '../users/user.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { AuthModule } from '../auth/auth.module';
import { DiagramsModule } from '../diagrams/diagrams.module';
import { SpringExportModule } from '../spring-export/spring-export.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectEntity, UserEntity]),
    AuthModule,
    DiagramsModule,
    SpringExportModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
