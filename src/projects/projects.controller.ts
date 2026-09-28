import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express/multer';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProjectsService } from './projects.service';
import { resolveImportedProjectName } from './imported-name';
import { XmiExporter } from '../diagrams/xmi-exporter';
import { XmiImporter, XmiParseError } from '../diagrams/xmi-importer';
import { DiagramGateway } from '../diagrams/diagrams.gateway';
import { normalizeDiagram } from '../diagrams/diagram.types';
import { SpringExportService } from '../spring-export/spring-export.service';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { sub: string; username: string };
  }
}

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly xmiExporter: XmiExporter,
    private readonly xmiImporter: XmiImporter,
    private readonly springExportService: SpringExportService,
    private readonly diagramsGateway: DiagramGateway,
  ) {}

  @Post()
  async create(@Req() req: Request, @Body() body: { name?: string }) {
    const userId = (req.user as { sub: string }).sub;
    const project = await this.projectsService.create(userId, body.name ?? '');
    return { id: project.id, name: project.name };
  }

  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async importXmi(
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = (req.user as { sub: string }).sub;
    if (!file) {
      throw new BadRequestException('file is required');
    }
    let parsed;
    try {
      parsed = this.xmiImporter.parse(file.buffer.toString('utf-8'));
    } catch (error) {
      if (error instanceof XmiParseError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const name = resolveImportedProjectName(parsed.name);
    // Persist the borrowed package/diagram names into the created project's
    // diagram document so a re-export reproduces them.
    const diagram = {
      ...parsed.diagram,
      packageName: parsed.packageName,
      diagramName: parsed.diagramName,
    };
    const project = await this.projectsService.create(userId, name, diagram);
    return { id: project.id, name: project.name };
  }

  // Replace-in-place import: parses and validates the upload first (any
  // XmiParseError is rejected as `Wrong format` before a single write), then
  // atomically renames the project and swaps its diagram document, and
  // finally pushes the replacement to every connected collaborator.
  @Post(':id/import')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }),
  )
  async importXmiIntoProject(
    @Req() req: Request,
    @Param('id') id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const userId = (req.user as { sub: string }).sub;
    if (!file) {
      throw new BadRequestException('file is required');
    }
    let parsed;
    try {
      parsed = this.xmiImporter.parse(file.buffer.toString('utf-8'));
    } catch (error) {
      if (error instanceof XmiParseError) {
        throw new BadRequestException('Wrong format');
      }
      throw error;
    }
    const name = resolveImportedProjectName(parsed.name);
    const diagram = {
      ...parsed.diagram,
      packageName: parsed.packageName,
      diagramName: parsed.diagramName,
    };
    const project = await this.projectsService.replaceDocument(
      id,
      userId,
      name,
      diagram,
    );
    this.diagramsGateway.replaceDocument(id, diagram);
    return { id: project.id, name: project.name };
  }

  @Get()
  async list(@Req() req: Request) {
    const userId = (req.user as { sub: string }).sub;
    const projects = await this.projectsService.listOwned(userId);
    return { projects };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const project = await this.projectsService.get(id);
    return { id: project.id, name: project.name, diagram: project.diagram };
  }

  @Patch(':id')
  async rename(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ) {
    const userId = (req.user as { sub: string }).sub;
    const project = await this.projectsService.rename(
      id,
      userId,
      body.name ?? '',
    );
    return { id: project.id, name: project.name };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Req() req: Request, @Param('id') id: string) {
    const userId = (req.user as { sub: string }).sub;
    await this.projectsService.remove(id, userId);
    return { ok: true };
  }

  @Get(':id/xmi')
  async exportXmi(@Param('id') id: string, @Res() res: Response) {
    const project = await this.projectsService.get(id);
    const diagram = normalizeDiagram(project.diagram);
    const xml = this.xmiExporter.serialize(diagram, {
      projectId: project.id,
      projectName: project.name,
    });
    res.contentType('application/xml');
    res.send(xml);
  }

  @Get(':id/spring-boot')
  async exportSpringBoot(@Param('id') id: string, @Res() res: Response) {
    const project = await this.projectsService.get(id);
    const diagram = normalizeDiagram(project.diagram);
    const buffer = await this.springExportService.exportSpringBoot(diagram);
    res.contentType('application/zip');
    res.send(buffer);
  }
}
