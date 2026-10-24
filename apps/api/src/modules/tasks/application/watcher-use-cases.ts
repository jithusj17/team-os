import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { WatcherRepository } from '../domain/ports.js';
import type { TaskAccess } from './task-use-cases.js';

type Deps = { uow: UnitOfWork<{ watchers: WatcherRepository }>; taskAccess: TaskAccess };

export class ListWatchers {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, taskId: string): Promise<string[]> {
    await this.deps.taskAccess.authorize(actorId, taskId, 'project:read');
    return this.deps.uow.repos.watchers.list(taskId);
  }
}

export class SetWatching {
  constructor(private readonly deps: Deps) {}

  /** Starts or stops watching a task. Anyone who can see a task may watch it. */
  async execute(actorId: string, taskId: string, watching: boolean) {
    await this.deps.taskAccess.authorize(actorId, taskId, 'project:read');
    const { watchers } = this.deps.uow.repos;
    if (watching) await watchers.add(taskId, [actorId]);
    else await watchers.remove(taskId, actorId);
  }
}
