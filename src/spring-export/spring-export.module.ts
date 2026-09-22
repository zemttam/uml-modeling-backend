import { Module } from '@nestjs/common';
import { SpringExportService } from './spring-export.service';

@Module({
  providers: [SpringExportService],
  exports: [SpringExportService],
})
export class SpringExportModule {}
