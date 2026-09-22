import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { AiCreatorController } from './ai-creator.controller';
import { AiCreatorService } from './ai-creator.service';

@Module({
  imports: [AuthModule, ProjectsModule],
  controllers: [AiCreatorController],
  providers: [AiCreatorService],
})
export class AiCreatorModule {}
