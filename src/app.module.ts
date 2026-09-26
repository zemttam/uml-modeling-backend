import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { UserEntity } from './users/user.entity';
import { ProjectEntity } from './projects/project.entity';
import { ProjectsModule } from './projects/projects.module';
import { DiagramsModule } from './diagrams/diagrams.module';
import { AiCreatorModule } from './ai-creator/ai-creator.module';
import { SpringExportModule } from './spring-export/spring-export.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', ''),
        database: config.get<string>('DB_NAME', 'uml'),
        entities: [UserEntity, ProjectEntity],
        synchronize: true,
        ssl: {
          rejectUnauthorized: true, // Set to true in production with a valid CA certificate
        },
      }),
    }),
    UsersModule,
    AuthModule,
    ProjectsModule,
    DiagramsModule,
    AiCreatorModule,
    SpringExportModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
