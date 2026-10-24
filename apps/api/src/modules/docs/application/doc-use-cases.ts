import { canOnDoc, effectiveProjectRole, type DocAction } from '@team-os/shared';
import type { EventRepository } from '../../../shared/application/events.js';
import type { Clock } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { conflict, forbidden, notFound } from '../../../shared/domain/errors.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import type { ProjectRepository } from '../../projects/domain/ports.js';
import type { TaskRepository } from '../../tasks/domain/ports.js';
import type { WorkspaceAccess } from '../../workspaces/application/workspace-access.js';
import type { MemberRepository } from '../../workspaces/domain/ports.js';
import { startsNewSnapshot, type Doc } from '../domain/doc.js';
import type { DocRepository } from '../domain/ports.js';

type Repos = {
  docs: DocRepository;
  tasks: TaskRepository;
  members: MemberRepository;
  projects: ProjectRepository;
  events: EventRepository;
};
type Deps = {
  uow: UnitOfWork<Repos>;
  docAccess: DocAccess;
  projectAccess: ProjectAccess;
  clock: Clock;
};

const docNotFound = () => notFound('doc_not_found', 'Doc not found');

/** Authorizes doc actions. People who can't read a doc get not-found. */
export class DocAccess {
  constructor(
    private readonly deps: {
      docs: Pick<DocRepository, 'findById'>;
      members: Pick<MemberRepository, 'findRole'>;
      projectAccess: ProjectAccess;
    },
  ) {}

  async permissions(actorId: string, doc: Doc) {
    const workspaceRole = await this.deps.members.findRole(doc.workspaceId, actorId);
    if (!workspaceRole) return null;
    const projectRole = doc.projectId
      ? ((await this.deps.projectAccess.grantFor(actorId, doc.projectId))?.role ?? null)
      : null;
    const ctx = {
      workspaceRole,
      isProjectDoc: doc.projectId !== null,
      projectRole,
      isCreator: doc.createdBy === actorId,
    };
    return {
      read: canOnDoc(ctx, 'read'),
      edit: canOnDoc(ctx, 'edit'),
      delete: canOnDoc(ctx, 'delete'),
    };
  }

  async authorize(actorId: string, docId: string, action: DocAction) {
    const doc = await this.deps.docs.findById(docId);
    if (!doc) throw docNotFound();
    const can = await this.permissions(actorId, doc);
    if (!can?.read) throw docNotFound();
    if (!can[action]) throw forbidden();
    return { doc, can };
  }
}

/** The doc as returned to a viewer: with linked tasks they can see and what they may do. */
async function view(
  deps: Deps,
  actorId: string,
  doc: Doc,
  can: { edit: boolean; delete: boolean },
) {
  const { docs, tasks } = deps.uow.repos;
  const refs = await tasks.findRefs(await docs.linkedTaskIds(doc.id));
  return {
    ...doc,
    linkedTasks: await deps.projectAccess.filterVisible(actorId, refs),
    canEdit: can.edit,
    canDelete: can.delete,
  };
}

/** Workspace docs carry no content in events, so guests in the workspace room learn nothing. */
const docEvent = (
  type: 'doc.created' | 'doc.updated' | 'doc.deleted',
  doc: Doc,
  actorId: string,
) => ({
  workspaceId: doc.workspaceId,
  projectId: doc.projectId,
  type,
  actorId,
  payload: { id: doc.id },
});

export class ListDocs {
  constructor(private readonly deps: Deps & { workspaceAccess: WorkspaceAccess }) {}

  async execute(actorId: string, workspaceId: string, opts: { projectId?: string; q?: string }) {
    const role = await this.deps.workspaceAccess.authorize(actorId, workspaceId, {
      action: 'workspace:read',
    });
    const { docs, projects } = this.deps.uow.repos;
    const visibleProjects = (await projects.listWithExplicitRole(workspaceId, actorId))
      .filter((p) => effectiveProjectRole(role, p.visibility, p.explicitRole))
      .map((p) => p.id);
    return docs.list(workspaceId, {
      includeWorkspaceDocs: role !== 'guest' && !opts.projectId,
      projectIds: opts.projectId
        ? visibleProjects.filter((id) => id === opts.projectId)
        : visibleProjects,
      search: opts.q,
    });
  }
}

export class CreateDoc {
  constructor(private readonly deps: Deps & { workspaceAccess: WorkspaceAccess }) {}

  async execute(
    actorId: string,
    workspaceId: string,
    input: { title: string; body: string; projectId: string | null },
  ) {
    if (input.projectId) {
      const { project } = await this.deps.projectAccess.authorize(
        actorId,
        input.projectId,
        'task:create',
      );
      if (project.workspaceId !== workspaceId)
        throw notFound('project_not_found', 'Project not found');
    } else {
      // Guests can't create workspace-wide docs.
      await this.deps.workspaceAccess.authorize(actorId, workspaceId, { action: 'project:create' });
    }
    const doc = await this.deps.uow.transaction(async ({ docs, events }) => {
      const created = await docs.create({ ...input, workspaceId, createdBy: actorId });
      await docs.addSnapshot({
        docId: created.id,
        version: created.version,
        title: created.title,
        body: created.body,
        authorId: actorId,
      });
      await events.append(docEvent('doc.created', created, actorId));
      return created;
    });
    return view(this.deps, actorId, doc, { edit: true, delete: true });
  }
}

export class GetDoc {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, docId: string) {
    const { doc, can } = await this.deps.docAccess.authorize(actorId, docId, 'read');
    return view(this.deps, actorId, doc, can);
  }
}

export class UpdateDoc {
  constructor(private readonly deps: Deps) {}

  async execute(
    actorId: string,
    docId: string,
    input: { version: number; title?: string; body?: string },
  ) {
    const { can } = await this.deps.docAccess.authorize(actorId, docId, 'edit');
    const now = this.deps.clock.now();
    const doc = await this.deps.uow.transaction(async ({ docs, events }) => {
      const { version, ...patch } = input;
      const updated = await docs.updateIfVersion(docId, version, { ...patch, updatedBy: actorId });
      if (!updated) {
        throw conflict(
          'version_conflict',
          'This doc was changed by someone else. Reload to see their changes.',
        );
      }
      const latest = await docs.latestSnapshot(docId);
      const snapshot = { version: updated.version, title: updated.title, body: updated.body };
      if (startsNewSnapshot(latest, actorId, now)) {
        await docs.addSnapshot({ ...snapshot, docId, authorId: actorId });
      } else {
        await docs.replaceSnapshot(latest!.id, snapshot);
      }
      await events.append(docEvent('doc.updated', updated, actorId));
      return updated;
    });
    return view(this.deps, actorId, doc, can);
  }
}

export class DeleteDoc {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, docId: string) {
    const { doc } = await this.deps.docAccess.authorize(actorId, docId, 'delete');
    await this.deps.uow.transaction(async ({ docs, events }) => {
      await docs.delete(docId);
      await events.append(docEvent('doc.deleted', doc, actorId));
    });
  }
}

export class ListDocVersions {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, docId: string) {
    await this.deps.docAccess.authorize(actorId, docId, 'read');
    return this.deps.uow.repos.docs.listSnapshots(docId);
  }
}

export class GetDocVersion {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, docId: string, versionId: string) {
    await this.deps.docAccess.authorize(actorId, docId, 'read');
    const snapshot = await this.deps.uow.repos.docs.findSnapshot(docId, versionId);
    if (!snapshot) throw notFound('version_not_found', 'Version not found');
    return snapshot;
  }
}

export class LinkDocTask {
  constructor(private readonly deps: Deps) {}

  /** Links a task the actor can see to a doc they can edit. Both must be in one workspace. */
  async execute(actorId: string, docId: string, taskId: string, link: boolean) {
    const { doc, can } = await this.deps.docAccess.authorize(actorId, docId, 'edit');
    if (link) {
      const task = await this.deps.uow.repos.tasks.findById(taskId);
      if (!task || task.workspaceId !== doc.workspaceId)
        throw notFound('task_not_found', 'Task not found');
      await this.deps.projectAccess.authorize(actorId, task.projectId, 'project:read', () =>
        notFound('task_not_found', 'Task not found'),
      );
    }
    await this.deps.uow.transaction(async ({ docs, events }) => {
      if (link) await docs.linkTask(docId, taskId);
      else if (!(await docs.unlinkTask(docId, taskId))) {
        throw notFound('link_not_found', 'That task is not linked');
      }
      await events.append(docEvent('doc.updated', doc, actorId));
    });
    return view(this.deps, actorId, doc, can);
  }
}
