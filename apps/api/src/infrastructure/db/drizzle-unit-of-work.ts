import type { UnitOfWork } from '../../shared/application/unit-of-work.js';
import { DrizzleUserRepository } from '../../modules/identity/infrastructure/drizzle-user-repository.js';
import { DrizzleInviteRepository } from '../../modules/workspaces/infrastructure/drizzle-invite-repository.js';
import { DrizzleMemberRepository } from '../../modules/workspaces/infrastructure/drizzle-member-repository.js';
import { DrizzleWorkspaceRepository } from '../../modules/workspaces/infrastructure/drizzle-workspace-repository.js';
import type { DbExecutor } from './executor.js';

/** Every repository, bound to one executor (the database or a transaction). */
export function createRepositories(db: DbExecutor) {
  return {
    users: new DrizzleUserRepository(db),
    workspaces: new DrizzleWorkspaceRepository(db),
    members: new DrizzleMemberRepository(db),
    invites: new DrizzleInviteRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export class DrizzleUnitOfWork implements UnitOfWork<Repositories> {
  readonly repos: Repositories;

  constructor(private readonly db: DbExecutor) {
    this.repos = createRepositories(db);
  }

  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => work(createRepositories(tx)));
  }
}
