import { beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../../src/shared/domain/errors.js';
import {
  AcceptInvite,
  CreateInvite,
} from '../../src/modules/workspaces/application/invite-use-cases.js';
import {
  ChangeMemberRole,
  RemoveMember,
} from '../../src/modules/workspaces/application/member-use-cases.js';
import { WorkspaceAccess } from '../../src/modules/workspaces/application/workspace-access.js';
import { CreateWorkspace } from '../../src/modules/workspaces/application/workspace-use-cases.js';
import { INVITE_TTL_MS } from '../../src/modules/workspaces/domain/invite.js';
import { FakeJobQueue, FakeTokens, FixedClock, InMemoryUnitOfWork } from '../fakes/in-memory.js';

// Use-case tests against in-memory repositories: no database, no HTTP, milliseconds each.

async function rejectsWith(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

describe('workspace use cases', () => {
  let uow: InMemoryUnitOfWork;
  let tokens: FakeTokens;
  let clock: FixedClock;
  let jobs: FakeJobQueue;
  let access: WorkspaceAccess;

  beforeEach(() => {
    uow = new InMemoryUnitOfWork();
    tokens = new FakeTokens();
    clock = new FixedClock();
    jobs = new FakeJobQueue();
    access = new WorkspaceAccess(uow.repos.members);
  });

  const user = (email: string) =>
    uow.repos.users.create({ email, name: email.split('@')[0]!, avatarUrl: null });

  async function workspaceWithOwner() {
    const owner = await user('owner@example.com');
    const ws = await new CreateWorkspace({ uow, tokens }).execute(owner.id, { name: 'Acme' });
    return { owner, ws };
  }

  describe('CreateWorkspace', () => {
    it('makes the creator the owner', async () => {
      const { owner, ws } = await workspaceWithOwner();
      expect(ws).toMatchObject({ slug: 'acme', role: 'owner' });
      expect(await uow.repos.members.findRole(ws.id, owner.id)).toBe('owner');
    });

    it('suffixes a derived slug on collision but not an explicit one', async () => {
      const { owner } = await workspaceWithOwner();
      const create = new CreateWorkspace({ uow, tokens });
      expect((await create.execute(owner.id, { name: 'Acme' })).slug).toMatch(/^acme-s\d+$/);
      await rejectsWith(create.execute(owner.id, { name: 'X', slug: 'acme' }), 'slug_taken');
    });
  });

  describe('ChangeMemberRole / RemoveMember', () => {
    it('protects the last owner and rolls back nothing else', async () => {
      const { owner, ws } = await workspaceWithOwner();
      await rejectsWith(
        new ChangeMemberRole({ uow, access }).execute(owner.id, ws.id, owner.id, 'member'),
        'last_owner',
      );
      await rejectsWith(
        new RemoveMember({ uow, access }).execute(owner.id, ws.id, owner.id),
        'last_owner',
      );
      expect(await uow.repos.members.findRole(ws.id, owner.id)).toBe('owner');
    });

    it('allows stepping down once there is another owner', async () => {
      const { owner, ws } = await workspaceWithOwner();
      const other = await user('other@example.com');
      await uow.repos.members.add(ws.id, other.id, 'owner');
      await new ChangeMemberRole({ uow, access }).execute(owner.id, ws.id, owner.id, 'member');
      expect(await uow.repos.members.findRole(ws.id, owner.id)).toBe('member');
    });
  });

  describe('invites', () => {
    const urls = {
      invite: (t: string) => `https://app.test/invites/${t}`,
      task: (ws: string, key: string) => `https://app.test/w/${ws}/tasks/${key}`,
    };

    async function invited(email: string) {
      const { owner, ws } = await workspaceWithOwner();
      const result = await new CreateInvite({ uow, access, tokens, clock, jobs, urls }).execute(
        owner.id,
        ws.id,
        { email, role: 'member' },
      );
      const token = result.acceptUrl.split('/invites/')[1]!;
      return { owner, ws, result, token };
    }

    it('stores only the token hash and queues the email', async () => {
      const { result, token } = await invited('new@example.com');
      expect(uow.state.invites[0]!.tokenHash).toBe(`hash:${token}`);
      expect(jobs.emails).toEqual([
        expect.objectContaining({ to: 'new@example.com', acceptUrl: result.acceptUrl }),
      ]);
    });

    it('accepts within the expiry window and rejects after it', async () => {
      const { ws, token } = await invited('new@example.com');
      const invitee = await user('new@example.com');
      const accept = new AcceptInvite({ uow, tokens, clock });

      clock.advance(INVITE_TTL_MS + 1);
      await rejectsWith(accept.execute(invitee.id, token), 'invite_expired');

      clock.advance(-2);
      expect(await accept.execute(invitee.id, token)).toEqual({ workspaceId: ws.id });
      expect(await uow.repos.members.findRole(ws.id, invitee.id)).toBe('member');
    });

    it('rejects a different account and leaves no membership behind', async () => {
      const { ws, token } = await invited('new@example.com');
      const someoneElse = await user('else@example.com');
      await rejectsWith(
        new AcceptInvite({ uow, tokens, clock }).execute(someoneElse.id, token),
        'invite_email_mismatch',
      );
      expect(await uow.repos.members.findRole(ws.id, someoneElse.id)).toBeNull();
    });
  });
});
