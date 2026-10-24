import type { InvitableRole } from '@team-os/shared';
import type { AppUrls, Clock, JobQueue, TokenService } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { conflict, notFound } from '../../../shared/domain/errors.js';
import type { UserRepository } from '../../identity/domain/ports.js';
import { INVITE_TTL_MS, assertAcceptable, inviteStatus, type Invite } from '../domain/invite.js';
import type { InviteRepository, MemberRepository, WorkspaceRepository } from '../domain/ports.js';
import type { WorkspaceAccess } from './workspace-access.js';

type Repos = {
  invites: InviteRepository;
  members: MemberRepository;
  workspaces: WorkspaceRepository;
  users: UserRepository;
};

export class CreateInvite {
  constructor(
    private readonly deps: {
      uow: UnitOfWork<Repos>;
      access: WorkspaceAccess;
      tokens: TokenService;
      clock: Clock;
      jobs: JobQueue;
      urls: AppUrls;
    },
  ) {}

  /** Creates an invite (replacing any open one for the same email) and queues the email. */
  async execute(
    actorId: string,
    workspaceId: string,
    input: { email: string; role: InvitableRole },
  ): Promise<{ invite: Invite; acceptUrl: string }> {
    const { uow, access, tokens, clock, jobs, urls } = this.deps;
    await access.authorize(actorId, workspaceId, { action: 'invite:create', role: input.role });

    const token = tokens.generate();
    const now = clock.now();
    const invite = await uow.transaction(async ({ invites, members }) => {
      if (await members.isMemberByEmail(workspaceId, input.email)) {
        throw conflict('already_member', 'This person is already a member');
      }
      await invites.revokeOpenForEmail(workspaceId, input.email, now);
      return invites.create({
        workspaceId,
        email: input.email,
        role: input.role,
        invitedBy: actorId,
        tokenHash: tokens.hash(token),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      });
    });

    // Queued after the transaction commits, so the worker never emails a rolled-back invite.
    const acceptUrl = urls.invite(token);
    const [workspace, inviter] = await Promise.all([
      uow.repos.workspaces.findById(workspaceId),
      uow.repos.users.findById(actorId),
    ]);
    await jobs.sendEmail({
      type: 'workspace-invite',
      to: invite.email,
      workspaceName: workspace?.name ?? 'a workspace',
      inviterName: inviter?.name ?? 'A teammate',
      role: invite.role,
      acceptUrl,
      expiresAt: invite.expiresAt.toISOString(),
    });
    return { invite, acceptUrl };
  }
}

export class ListInvites {
  constructor(
    private readonly deps: { uow: UnitOfWork<Repos>; access: WorkspaceAccess; clock: Clock },
  ) {}

  async execute(actorId: string, workspaceId: string): Promise<Invite[]> {
    await this.deps.access.authorize(actorId, workspaceId, { action: 'invite:list' });
    return this.deps.uow.repos.invites.listOpen(workspaceId, this.deps.clock.now());
  }
}

export class RevokeInvite {
  constructor(
    private readonly deps: { uow: UnitOfWork<Repos>; access: WorkspaceAccess; clock: Clock },
  ) {}

  async execute(actorId: string, workspaceId: string, inviteId: string) {
    await this.deps.access.authorize(actorId, workspaceId, { action: 'invite:revoke' });
    const revoked = await this.deps.uow.repos.invites.revoke(
      workspaceId,
      inviteId,
      this.deps.clock.now(),
    );
    if (!revoked) throw notFound('invite_not_found', 'Invite not found');
  }
}

export class PreviewInvite {
  constructor(
    private readonly deps: { uow: UnitOfWork<Repos>; tokens: TokenService; clock: Clock },
  ) {}

  async execute(token: string) {
    const data = await this.deps.uow.repos.invites.findPreviewByTokenHash(
      this.deps.tokens.hash(token),
    );
    if (!data) throw notFound('invite_not_found', 'Invite not found');
    const { invite } = data;
    return {
      workspaceId: invite.workspaceId,
      workspaceName: data.workspaceName,
      email: invite.email,
      role: invite.role,
      invitedByName: data.invitedByName,
      expiresAt: invite.expiresAt,
      status: inviteStatus(invite, this.deps.clock.now()),
    };
  }
}

export class AcceptInvite {
  constructor(
    private readonly deps: { uow: UnitOfWork<Repos>; tokens: TokenService; clock: Clock },
  ) {}

  /** Accepts an invite for the signed-in user. Their email must match the invited email. */
  async execute(actorId: string, token: string): Promise<{ workspaceId: string }> {
    const { uow, tokens, clock } = this.deps;
    return uow.transaction(async ({ invites, members, users }) => {
      const invite = await invites.lockByTokenHash(tokens.hash(token));
      if (!invite) throw notFound('invite_not_found', 'Invite not found');
      const actor = await users.findById(actorId);
      if (!actor) throw notFound('user_not_found', 'User not found');

      const now = clock.now();
      assertAcceptable(invite, actor.email, now);
      await members.add(invite.workspaceId, actorId, invite.role);
      await invites.markAccepted(invite.id, now);
      return { workspaceId: invite.workspaceId };
    });
  }
}
