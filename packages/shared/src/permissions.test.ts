import { describe, expect, it } from 'vitest';
import {
  canInProject,
  effectiveProjectRole,
  canInWorkspace,
  type WorkspacePermissionCheck,
  type WorkspaceRole,
} from './permissions.js';

type Row = [WorkspacePermissionCheck, Record<WorkspaceRole, boolean>];

const all = (v: boolean) => ({ owner: v, admin: v, member: v, guest: v });

const matrix: Row[] = [
  [{ action: 'workspace:read' }, all(true)],
  [{ action: 'workspace:update' }, { owner: true, admin: true, member: false, guest: false }],
  [{ action: 'workspace:delete' }, { owner: true, admin: false, member: false, guest: false }],
  [{ action: 'member:list' }, { owner: true, admin: true, member: true, guest: false }],
  [{ action: 'invite:list' }, { owner: true, admin: true, member: false, guest: false }],
  [{ action: 'invite:revoke' }, { owner: true, admin: true, member: false, guest: false }],
  [{ action: 'invite:create', role: 'owner' }, all(false)],
  [
    { action: 'invite:create', role: 'admin' },
    { owner: true, admin: false, member: false, guest: false },
  ],
  [
    { action: 'invite:create', role: 'member' },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    { action: 'invite:create', role: 'guest' },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    { action: 'member:change-role', targetRole: 'member', newRole: 'guest' },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    { action: 'member:change-role', targetRole: 'member', newRole: 'admin' },
    { owner: true, admin: false, member: false, guest: false },
  ],
  [
    { action: 'member:change-role', targetRole: 'admin', newRole: 'member' },
    { owner: true, admin: false, member: false, guest: false },
  ],
  [
    { action: 'member:remove', targetRole: 'guest', isSelf: false },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    { action: 'member:remove', targetRole: 'admin', isSelf: false },
    { owner: true, admin: false, member: false, guest: false },
  ],
  [{ action: 'member:remove', targetRole: 'guest', isSelf: true }, all(true)],
];

describe('canInWorkspace', () => {
  for (const [check, expected] of matrix) {
    for (const role of Object.keys(expected) as WorkspaceRole[]) {
      it(`${role} ${expected[role] ? 'can' : 'cannot'} ${JSON.stringify(check)}`, () => {
        expect(canInWorkspace(role, check)).toBe(expected[role]);
      });
    }
  }
});

describe('effectiveProjectRole', () => {
  it('gives workspace owners and admins admin on every project', () => {
    for (const ws of ['owner', 'admin'] as const) {
      expect(effectiveProjectRole(ws, 'private', null)).toBe('admin');
      expect(effectiveProjectRole(ws, 'workspace', 'viewer')).toBe('admin');
    }
  });

  it('gives members editor on workspace projects unless an explicit role is set', () => {
    expect(effectiveProjectRole('member', 'workspace', null)).toBe('editor');
    expect(effectiveProjectRole('member', 'workspace', 'viewer')).toBe('viewer');
    expect(effectiveProjectRole('member', 'private', null)).toBeNull();
    expect(effectiveProjectRole('member', 'private', 'admin')).toBe('admin');
  });

  it('requires explicit membership for guests', () => {
    expect(effectiveProjectRole('guest', 'workspace', null)).toBeNull();
    expect(effectiveProjectRole('guest', 'private', 'editor')).toBe('editor');
  });
});

describe('canInProject', () => {
  it('ranks viewer < editor < admin', () => {
    expect(canInProject('viewer', 'comment:create')).toBe(true);
    expect(canInProject('viewer', 'task:update')).toBe(false);
    expect(canInProject('editor', 'task:delete')).toBe(true);
    expect(canInProject('editor', 'status:manage')).toBe(false);
    expect(canInProject('admin', 'project:delete')).toBe(true);
  });
});

describe('workspace-level project and label actions', () => {
  it('lets everyone but guests create projects and labels; only admins delete labels', () => {
    const expectRoles = (check: WorkspacePermissionCheck, allowed: WorkspaceRole[]) => {
      for (const role of ['owner', 'admin', 'member', 'guest'] as const) {
        expect(canInWorkspace(role, check), `${role} ${check.action}`).toBe(allowed.includes(role));
      }
    };
    expectRoles({ action: 'project:create' }, ['owner', 'admin', 'member']);
    expectRoles({ action: 'label:manage' }, ['owner', 'admin', 'member']);
    expectRoles({ action: 'label:delete' }, ['owner', 'admin']);
  });
});
