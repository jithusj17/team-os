import { describe, expect, it } from 'vitest';
import {
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
