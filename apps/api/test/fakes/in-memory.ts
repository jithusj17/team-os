import { randomUUID } from 'node:crypto';
import type { EmailJob } from '@team-os/shared';
import type { Clock, JobQueue, TokenService } from '../../src/shared/application/ports.js';
import type { UnitOfWork } from '../../src/shared/application/unit-of-work.js';
import { conflict } from '../../src/shared/domain/errors.js';
import type { UserRepository } from '../../src/modules/identity/domain/ports.js';
import type { OAuthProviderName, User } from '../../src/modules/identity/domain/user.js';
import type { Invite } from '../../src/modules/workspaces/domain/invite.js';
import type { Member } from '../../src/modules/workspaces/domain/membership.js';
import type {
  InviteRepository,
  MemberRepository,
  WorkspaceRepository,
} from '../../src/modules/workspaces/domain/ports.js';
import type { Workspace, WorkspaceRole } from '../../src/modules/workspaces/domain/workspace.js';

/** All in-memory data. Transactions snapshot it and restore on failure. */
interface State {
  users: User[];
  oauth: { provider: OAuthProviderName; providerUserId: string; userId: string }[];
  workspaces: Workspace[];
  members: { workspaceId: string; userId: string; role: WorkspaceRole; joinedAt: Date }[];
  invites: (Invite & { tokenHash: string })[];
}

const emptyState = (): State => ({
  users: [],
  oauth: [],
  workspaces: [],
  members: [],
  invites: [],
});

class InMemoryUsers implements UserRepository {
  constructor(private readonly s: () => State) {}
  async findById(id: string) {
    return this.s().users.find((u) => u.id === id) ?? null;
  }
  async findByEmail(email: string) {
    return this.s().users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }
  async findByOAuthAccount(provider: OAuthProviderName, providerUserId: string) {
    const link = this.s().oauth.find(
      (o) => o.provider === provider && o.providerUserId === providerUserId,
    );
    return link ? this.findById(link.userId) : null;
  }
  async create(data: Omit<User, 'id'>) {
    const user = { id: randomUUID(), ...data };
    this.s().users.push(user);
    return user;
  }
  async linkOAuthAccount(userId: string, provider: OAuthProviderName, providerUserId: string) {
    this.s().oauth.push({ userId, provider, providerUserId });
  }
}

class InMemoryWorkspaces implements WorkspaceRepository {
  constructor(private readonly s: () => State) {}
  async findById(id: string) {
    return this.s().workspaces.find((w) => w.id === id) ?? null;
  }
  async listForUser(userId: string) {
    return this.s()
      .members.filter((m) => m.userId === userId)
      .map((m) => ({ ...this.s().workspaces.find((w) => w.id === m.workspaceId)!, role: m.role }));
  }
  async create(data: { name: string; slug: string }) {
    if (this.s().workspaces.some((w) => w.slug === data.slug)) {
      throw conflict('slug_taken', 'taken');
    }
    const ws = { id: randomUUID(), name: data.name, slug: data.slug, createdAt: new Date() };
    this.s().workspaces.push(ws);
    return ws;
  }
  async update(id: string, patch: { name?: string; slug?: string }) {
    const ws = await this.findById(id);
    if (!ws) return null;
    Object.assign(ws, patch);
    return ws;
  }
  async delete(id: string) {
    const s = this.s();
    s.workspaces = s.workspaces.filter((w) => w.id !== id);
    s.members = s.members.filter((m) => m.workspaceId !== id);
  }
}

class InMemoryMembers implements MemberRepository {
  constructor(private readonly s: () => State) {}
  private find(workspaceId: string, userId: string) {
    return this.s().members.find((m) => m.workspaceId === workspaceId && m.userId === userId);
  }
  async findRole(workspaceId: string, userId: string) {
    return this.find(workspaceId, userId)?.role ?? null;
  }
  async list(workspaceId: string): Promise<Member[]> {
    return this.s()
      .members.filter((m) => m.workspaceId === workspaceId)
      .map((m) => {
        const u = this.s().users.find((x) => x.id === m.userId)!;
        return { ...u, userId: u.id, role: m.role, joinedAt: m.joinedAt };
      });
  }
  async isMemberByEmail(workspaceId: string, email: string) {
    const user = this.s().users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    return Boolean(user && this.find(workspaceId, user.id));
  }
  async add(workspaceId: string, userId: string, role: WorkspaceRole) {
    if (!this.find(workspaceId, userId)) {
      this.s().members.push({ workspaceId, userId, role, joinedAt: new Date() });
    }
  }
  async updateRole(workspaceId: string, userId: string, role: WorkspaceRole) {
    const m = this.find(workspaceId, userId);
    if (m) m.role = role;
  }
  async remove(workspaceId: string, userId: string) {
    const s = this.s();
    s.members = s.members.filter((m) => !(m.workspaceId === workspaceId && m.userId === userId));
  }
  async lockOwnerIds(workspaceId: string) {
    return this.s()
      .members.filter((m) => m.workspaceId === workspaceId && m.role === 'owner')
      .map((m) => m.userId);
  }
}

class InMemoryInvites implements InviteRepository {
  constructor(private readonly s: () => State) {}
  private open = (i: Invite) => !i.acceptedAt && !i.revokedAt;
  async listOpen(workspaceId: string, now: Date) {
    return this.s().invites.filter(
      (i) => i.workspaceId === workspaceId && this.open(i) && i.expiresAt > now,
    );
  }
  async create(data: Parameters<InviteRepository['create']>[0]) {
    const invite = {
      ...data,
      id: randomUUID(),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    };
    this.s().invites.push(invite);
    return invite;
  }
  async revokeOpenForEmail(workspaceId: string, email: string, now: Date) {
    for (const i of this.s().invites) {
      if (i.workspaceId === workspaceId && i.email === email && this.open(i)) i.revokedAt = now;
    }
  }
  async revoke(workspaceId: string, inviteId: string, now: Date) {
    const i = this.s().invites.find(
      (x) => x.id === inviteId && x.workspaceId === workspaceId && this.open(x),
    );
    if (i) i.revokedAt = now;
    return Boolean(i);
  }
  async lockByTokenHash(tokenHash: string) {
    return this.s().invites.find((i) => i.tokenHash === tokenHash) ?? null;
  }
  async findPreviewByTokenHash(tokenHash: string) {
    const invite = await this.lockByTokenHash(tokenHash);
    if (!invite) return null;
    const ws = this.s().workspaces.find((w) => w.id === invite.workspaceId)!;
    const inviter = this.s().users.find((u) => u.id === invite.invitedBy);
    return { invite, workspaceName: ws.name, invitedByName: inviter?.name ?? null };
  }
  async markAccepted(inviteId: string, now: Date) {
    const i = this.s().invites.find((x) => x.id === inviteId);
    if (i) i.acceptedAt = now;
  }
}

function createRepos(s: () => State) {
  return {
    users: new InMemoryUsers(s),
    workspaces: new InMemoryWorkspaces(s),
    members: new InMemoryMembers(s),
    invites: new InMemoryInvites(s),
  };
}

export type InMemoryRepos = ReturnType<typeof createRepos>;

export class InMemoryUnitOfWork implements UnitOfWork<InMemoryRepos> {
  state = emptyState();
  readonly repos = createRepos(() => this.state);

  async transaction<T>(work: (repos: InMemoryRepos) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.state);
    try {
      return await work(this.repos);
    } catch (err) {
      this.state = snapshot; // roll back
      throw err;
    }
  }
}

export class FakeJobQueue implements JobQueue {
  readonly emails: EmailJob[] = [];
  async sendEmail(job: EmailJob) {
    this.emails.push(job);
  }
}

export class FixedClock implements Clock {
  constructor(public current = new Date('2026-01-01T00:00:00Z')) {}
  now() {
    return new Date(this.current);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Predictable tokens: tok-1, tok-2, ...; hash is a reversible prefix for easy assertions. */
export class FakeTokens implements TokenService {
  private n = 0;
  generate() {
    return `tok-${++this.n}`;
  }
  shortId() {
    return `s${String(++this.n).padStart(5, '0')}`;
  }
  hash(token: string) {
    return `hash:${token}`;
  }
  equals(a: string, b: string) {
    return a === b;
  }
}
