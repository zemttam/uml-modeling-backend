import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { ProjectEntity } from '../projects/project.entity';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  password: string;

  @Column({ type: 'uuid', nullable: true })
  lastOpenedProjectId: string | null;

  @OneToMany(() => ProjectEntity, (project) => project.owner)
  projects: ProjectEntity[];
}
