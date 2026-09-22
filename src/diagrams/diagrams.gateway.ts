import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { ProjectEntity } from '../projects/project.entity';
import { SESSION_COOKIE_NAME } from '../auth/jwt-auth.guard';
import {
  DIAGRAM_EVENT,
  DiagramDocument,
  DiagramOp,
  normalizeDiagram,
} from './diagram.types';
import { applyOp } from './diagram.reducer';

const AUTOSAVE_DEBOUNCE_MS = 1000;

function roomFor(projectId: string): string {
  return `project:${projectId}`;
}

function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      return v.length ? decodeURIComponent(v.join('=')) : undefined;
    }
  }
  return undefined;
}

@WebSocketGateway({
  namespace: 'diagrams',
  cors: {
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  },
})
export class DiagramGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DiagramGateway.name);
  private readonly diagrams = new Map<string, DiagramDocument>();
  private readonly saveTimers = new Map<string, NodeJS.Timeout>();
  private readonly membership = new Map<string, Set<string>>();
  // elementId -> socketId, per project; locks are ephemeral session state
  private readonly locks = new Map<string, Map<string, string>>();

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    private readonly jwtService: JwtService,
  ) {}

  @WebSocketServer()
  server: Server;

  // --- connection lifecycle: handshake JWT-cookie auth (reuses token guard) ---

  async handleConnection(client: Socket): Promise<void> {
    const token = readCookie(
      client.handshake.headers.cookie,
      SESSION_COOKIE_NAME,
    );
    if (!token) {
      this.logger.warn(`rejecting socket ${client.id}: no session cookie`);
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify(token) as {
        sub: string;
        username: string;
      };
      client.data.user = payload;
    } catch {
      this.logger.warn(`rejecting socket ${client.id}: invalid session`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.leaveCurrent(client);
  }

  // --- join: room membership + full snapshot ---

  @SubscribeMessage(DIAGRAM_EVENT.JOIN)
  async handleJoin(
    @MessageBody() payload: { projectId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!client.data.user) {
      client.disconnect(true);
      return;
    }
    const projectId = payload?.projectId;
    if (!projectId) {
      return;
    }
    await this.leaveCurrent(client);
    const room = roomFor(projectId);
    await client.join(room);
    client.data.projectId = projectId;

    const members = this.membership.get(projectId) ?? new Set<string>();
    members.add(client.id);
    this.membership.set(projectId, members);

    const doc = await this.loadDiagram(projectId);
    client.emit(DIAGRAM_EVENT.STATE, doc);
    this.emitPresence(projectId);
  }

  // --- editing: op-based, membership-checked, broadcast incl. sender ---

  @SubscribeMessage(DIAGRAM_EVENT.OP)
  async handleOp(
    @MessageBody() payload: DiagramOp,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const projectId = client.data.projectId as string | undefined;
    if (!projectId) {
      // non-member: reject (do not apply or broadcast)
      return;
    }
    let doc = this.diagrams.get(projectId);
    if (!doc) {
      doc = await this.loadDiagram(projectId);
    }
    applyOp(doc, payload);
    this.scheduleAutosave(projectId);
    // broadcast to the whole room including the sender so all clients converge
    this.server.to(roomFor(projectId)).emit(DIAGRAM_EVENT.OP, payload);
  }

  // --- element locking: exclusive, session-only, never persisted ---

  @SubscribeMessage(DIAGRAM_EVENT.ELEMENT_LOCK)
  async handleElementLock(
    @MessageBody() payload: { elementId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const projectId = client.data.projectId as string | undefined;
    const elementId = payload?.elementId;
    if (!projectId || !elementId) {
      return;
    }
    const projectLocks = this.locks.get(projectId);
    const holder = projectLocks?.get(elementId);
    if (holder && holder !== client.id) {
      // held by another member: deny to the requester only
      client.emit(DIAGRAM_EVENT.ELEMENT_LOCK_DENIED, { elementId });
      return;
    }
    if (holder === client.id) {
      return; // idempotent re-lock by the current holder
    }
    if (!projectLocks) {
      this.locks.set(projectId, new Map([[elementId, client.id]]));
    } else {
      projectLocks.set(elementId, client.id);
    }
    this.server
      .to(roomFor(projectId))
      .emit(DIAGRAM_EVENT.ELEMENT_LOCKED, { elementId });
  }

  @SubscribeMessage(DIAGRAM_EVENT.ELEMENT_UNLOCK)
  async handleElementUnlock(
    @MessageBody() payload: { elementId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const projectId = client.data.projectId as string | undefined;
    const elementId = payload?.elementId;
    if (!projectId || !elementId) {
      return;
    }
    this.releaseLock(projectId, elementId, client);
  }

  private releaseLock(
    projectId: string,
    elementId: string,
    client: Socket,
  ): void {
    const projectLocks = this.locks.get(projectId);
    if (!projectLocks || projectLocks.get(elementId) !== client.id) {
      return; // only the holding socket may release
    }
    projectLocks.delete(elementId);
    if (projectLocks.size === 0) {
      this.locks.delete(projectId);
    }
    this.server
      .to(roomFor(projectId))
      .emit(DIAGRAM_EVENT.ELEMENT_UNLOCKED, { elementId });
  }

  // --- explicit save: force-flush pending changes ---

  @SubscribeMessage(DIAGRAM_EVENT.SAVE_REQUEST)
  async handleSaveRequest(@ConnectedSocket() client: Socket): Promise<void> {
    const projectId = client.data.projectId as string | undefined;
    if (!projectId) {
      return;
    }
    await this.flushSave(projectId);
  }

  // --- helpers ---

  private async loadDiagram(projectId: string): Promise<DiagramDocument> {
    const cached = this.diagrams.get(projectId);
    if (cached) {
      return cached;
    }
    const project = await this.projectsRepository.findOne({
      where: { id: projectId },
    });
    const doc = normalizeDiagram(project?.diagram);
    this.diagrams.set(projectId, doc);
    return doc;
  }

  private scheduleAutosave(projectId: string): void {
    const existing = this.saveTimers.get(projectId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.saveTimers.delete(projectId);
      void this.flushSave(projectId);
    }, AUTOSAVE_DEBOUNCE_MS);
    this.saveTimers.set(projectId, timer);
  }

  private async flushSave(projectId: string): Promise<void> {
    const timer = this.saveTimers.get(projectId);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(projectId);
    }
    const doc = this.diagrams.get(projectId);
    if (!doc) {
      return;
    }
    try {
      await this.projectsRepository.update(projectId, { diagram: doc });
    } catch (err) {
      this.logger.error(
        `autosave failed for project ${projectId}: ${(err as Error).message}`,
      );
    }
  }

  private async leaveCurrent(client: Socket): Promise<void> {
    const previous = client.data.projectId as string | undefined;
    if (!previous) {
      return;
    }
    const room = roomFor(previous);
    await client.leave(room);
    const members = this.membership.get(previous);
    if (members) {
      members.delete(client.id);
      if (members.size === 0) {
        this.membership.delete(previous);
      }
    }
    client.data.projectId = undefined;
    // evict any element locks this socket still holds, broadcasting releases
    const projectLocks = this.locks.get(previous);
    if (projectLocks) {
      for (const [elementId, socketId] of [...projectLocks]) {
        if (socketId === client.id) {
          projectLocks.delete(elementId);
          this.server
            .to(roomFor(previous))
            .emit(DIAGRAM_EVENT.ELEMENT_UNLOCKED, { elementId });
        }
      }
      if (projectLocks.size === 0) {
        this.locks.delete(previous);
      }
    }
    this.emitPresence(previous);
  }

  private emitPresence(projectId: string): void {
    const count = this.membership.get(projectId)?.size ?? 0;
    this.server
      .to(roomFor(projectId))
      .emit(DIAGRAM_EVENT.PRESENCE_COUNT, { count });
  }
}
