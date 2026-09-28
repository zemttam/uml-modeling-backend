import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../projects/project.entity';
import { AuthModule } from '../auth/auth.module';
import { DiagramGateway } from './diagrams.gateway';
import { XmiExporter } from './xmi-exporter';
import { XmiImporter } from './xmi-importer';

@Module({
  // ProjectEntity repository is used by the gateway to load/save diagrams;
  // AuthModule exports the configured JwtModule used for handshake auth.
  imports: [TypeOrmModule.forFeature([ProjectEntity]), AuthModule],
  providers: [DiagramGateway, XmiExporter, XmiImporter],
  exports: [XmiExporter, XmiImporter, DiagramGateway],
})
export class DiagramsModule {}
