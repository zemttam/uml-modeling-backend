import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express/multer';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { AiCreatorService } from './ai-creator.service';

function defaultTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

const UPLOAD_LIMIT = 10 * 1024 * 1024;

// The AI creator endpoints. All require a valid session; `prompt` arrives
// as a multipart form field (multer fills @Body() for form parts), and
// audio/image arrive as multipart files, both capped at 10 MB to match
// the XMI import limit.
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiCreatorController {
  constructor(
    private readonly aiCreator: AiCreatorService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('generate')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT } }),
  )
  async generate(@Req() req: Request, @Body() body: { prompt?: string }) {
    const userId = (req.user as { sub: string }).sub;
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }
    const diagram = await this.aiCreator.generateDiagram(prompt);
    const name = diagram.diagramName || `AI Diagram ${defaultTimestamp()}`;
    const project = await this.projectsService.create(userId, name, diagram);
    return { id: project.id, name: project.name };
  }

  @Post('transcribe')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT } }),
  )
  async transcribe(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const text = await this.aiCreator.transcribeAudio(
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { text };
  }

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: UPLOAD_LIMIT } }),
  )
  async describeImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const dsl = await this.aiCreator.describeImage(file.buffer, file.mimetype);
    return { dsl };
  }
}
