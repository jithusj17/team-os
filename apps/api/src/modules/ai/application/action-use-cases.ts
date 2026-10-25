import {
  canInProject,
  effectiveProjectRole,
  type ActionResult,
  type AiAction,
  type AiDraftAction,
  type AiProposal,
  type ProjectRole,
  type UpdateTaskBody,
} from '@team-os/shared';
import type { Clock } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { DomainError, notFound, validation } from '../../../shared/domain/errors.js';
import type { GetDoc } from '../../docs/application/doc-use-cases.js';
import type { GetMeeting } from '../../meetings/application/meeting-use-cases.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import type { Project, Status } from '../../projects/domain/project.js';
import type { ProjectRepository, StatusRepository } from '../../projects/domain/ports.js';
import type { AddComment, ListComments } from '../../tasks/application/comment-use-cases.js';
import type {
  CreateTask,
  GetTask,
  GetTaskByKey,
  UpdateTask,
} from '../../tasks/application/task-use-cases.js';
import type { TaskView } from '../../tasks/domain/task.js';
import type { WorkspaceAccess } from '../../workspaces/application/workspace-access.js';
import type { MemberRepository } from '../../workspaces/domain/ports.js';
import { ACTIONS_SYSTEM, clip, isIsoDate, matchPerson, type Person } from '../domain/ai.js';
import type { LanguageModel, Proposal, ProposalRepository } from '../domain/ports.js';
import { requireModel } from './summary-use-cases.js';

type Repos = {
  aiProposals: ProposalRepository;
  members: MemberRepository;
  projects: ProjectRepository;
  statuses: StatusRepository;
};

const proposalNotFound = () => notFound('proposal_not_found', 'Proposal not found');

const MAX_ACTIONS = 20;

export function toProposalView(p: Proposal): AiProposal {
  return {
    id: p.id,
    instruction: p.instruction,
    summary: p.summary,
    actions: p.actions,
    status: p.status,
    results: p.results,
    createdAt: p.createdAt,
  };
}

type Source = { type: 'meeting' | 'doc' | 'task'; id: string };

/** What the actor can work with: projects (with their role and statuses) and people. */
interface ActorContext {
  workspaceId: string;
  projects: Map<string, { project: Project; role: ProjectRole; statuses: Status[] }>;
  people: Person[];
  defaultProjectId: string | null;
}

/**
 * Asks the model for actions, then resolves and validates every one against what the actor
 * may do, so the person confirming sees exactly what would happen (and what can't).
 * Nothing changes until the proposal is executed.
 */
export class ProposeActions {
  constructor(
    private readonly deps: {
      uow: UnitOfWork<Repos>;
      model: LanguageModel;
      clock: Clock;
      workspaceAccess: WorkspaceAccess;
      projectAccess: ProjectAccess;
      getTask: GetTask;
      getTaskByKey: GetTaskByKey;
      listComments: ListComments;
      getMeeting: GetMeeting;
      getDoc: GetDoc;
    },
  ) {}

  async execute(
    actorId: string,
    workspaceId: string,
    input: { instruction: string; projectId: string | null; source: Source | null },
  ): Promise<AiProposal> {
    requireModel(this.deps.model);
    const ctx = await this.actorContext(actorId, workspaceId, input.projectId);
    const sourceText = input.source
      ? await this.sourceText(actorId, workspaceId, input.source)
      : null;

    const today = this.deps.clock.now().toISOString().slice(0, 10);
    const projects = [...ctx.projects.values()]
      .filter((p) => canInProject(p.role, 'task:create') || canInProject(p.role, 'task:update'))
      .map(
        ({ project, statuses }) =>
          `- ${project.key} "${project.name}" (statuses: ${statuses.map((s) => s.name).join(', ')})${
            project.id === ctx.defaultProjectId ? ' [default]' : ''
          }`,
      );
    const prompt = [
      `Today's date: ${today}`,
      `Projects:\n${projects.join('\n') || '(none you can change)'}`,
      `People:\n${ctx.people.map((p) => `- ${p.name} <${p.email}>`).join('\n')}`,
      sourceText ? `<source>\n${sourceText}\n</source>` : '',
      `Request: ${input.instruction}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const draft = await this.deps.model.draftActions({ system: ACTIONS_SYSTEM, prompt });
    const actions: AiAction[] = [];
    for (const [i, a] of draft.actions.slice(0, MAX_ACTIONS).entries()) {
      actions.push(await this.resolve(actorId, ctx, i + 1, a));
    }

    const proposal = await this.deps.uow.repos.aiProposals.create({
      workspaceId,
      actorId,
      instruction: input.instruction,
      context: { projectId: input.projectId, source: input.source },
      summary: draft.summary,
      actions,
      model: this.deps.model.name,
    });
    return toProposalView(proposal);
  }

  private async actorContext(
    actorId: string,
    workspaceId: string,
    defaultProjectId: string | null,
  ): Promise<ActorContext> {
    const role = await this.deps.workspaceAccess.authorize(actorId, workspaceId, {
      action: 'workspace:read',
    });
    const { projects, statuses, members } = this.deps.uow.repos;
    const visible = (await projects.listWithExplicitRole(workspaceId, actorId)).flatMap((p) => {
      const projectRole = effectiveProjectRole(role, p.visibility, p.explicitRole);
      return projectRole ? [{ project: p, role: projectRole }] : [];
    });
    const map: ActorContext['projects'] = new Map();
    for (const v of visible.slice(0, 50)) {
      map.set(v.project.id, { ...v, statuses: await statuses.listForProject(v.project.id) });
    }
    if (defaultProjectId && !map.has(defaultProjectId)) {
      throw notFound('project_not_found', 'Project not found');
    }
    const people = (await members.list(workspaceId)).map(({ userId, name, email }) => ({
      userId,
      name,
      email,
    }));
    return { workspaceId, projects: map, people, defaultProjectId };
  }

  /** The source content as text, read with the actor's own permissions. */
  private async sourceText(actorId: string, workspaceId: string, source: Source) {
    const inWorkspace = <T extends { workspaceId: string }>(x: T) => {
      if (x.workspaceId !== workspaceId) throw notFound(`${source.type}_not_found`, 'Not found');
      return x;
    };
    switch (source.type) {
      case 'meeting': {
        const m = inWorkspace(await this.deps.getMeeting.execute(actorId, source.id));
        let notes = '';
        if (m.notesDocId) {
          try {
            notes = (await this.deps.getDoc.execute(actorId, m.notesDocId)).body;
          } catch (err) {
            if (!(err instanceof DomainError)) throw err;
          }
        }
        return clip(
          `Meeting: ${m.title} (${m.startsAt.toISOString().slice(0, 10)})\n${m.description}\n\nNotes:\n${notes || '(none)'}`,
          16000,
        );
      }
      case 'doc': {
        const d = inWorkspace(await this.deps.getDoc.execute(actorId, source.id));
        return clip(`Doc: ${d.title}\n\n${d.body}`, 16000);
      }
      case 'task': {
        const t = inWorkspace(await this.deps.getTask.execute(actorId, source.id));
        const comments = await this.deps.listComments.execute(actorId, source.id);
        return clip(
          `Task ${t.key}: ${t.title}\n${t.description}\n\nComments:\n${comments
            .slice(-30)
            .map((c) => `- ${c.body}`)
            .join('\n')}`,
          16000,
        );
      }
    }
  }

  /** Resolves names and keys to ids and checks the action is allowed; never throws. */
  private async resolve(
    actorId: string,
    ctx: ActorContext,
    id: number,
    draft: AiDraftAction,
  ): Promise<AiAction> {
    const action: AiAction = {
      id,
      type: draft.type,
      reason: clip(draft.reason ?? '', 500),
      error: null,
      projectId: null,
      projectKey: null,
      taskId: null,
      taskKey: null,
      title: null,
      description: null,
      priority: null,
      assigneeId: null,
      statusId: null,
      dueDate: null,
      comment: null,
    };
    const fail = (error: string): AiAction => ({ ...action, error });

    // The project (and task) the action applies to.
    let target: { project: Project; role: ProjectRole; statuses: Status[] } | undefined;
    if (draft.type === 'create_task') {
      target = draft.projectKey
        ? [...ctx.projects.values()].find(
            (p) => p.project.key.toUpperCase() === draft.projectKey!.trim().toUpperCase(),
          )
        : ctx.defaultProjectId
          ? ctx.projects.get(ctx.defaultProjectId)
          : undefined;
      if (!target) {
        return fail(
          draft.projectKey
            ? `Project ${draft.projectKey} not found`
            : 'No project chosen for this task',
        );
      }
      action.projectId = target.project.id;
      action.projectKey = target.project.key;
      if (!canInProject(target.role, 'task:create')) {
        return fail(`You can't create tasks in ${target.project.key}`);
      }
    } else {
      if (!draft.taskKey) return fail('No task given');
      let task: TaskView;
      try {
        task = await this.deps.getTaskByKey.execute(actorId, ctx.workspaceId, draft.taskKey.trim());
      } catch (err) {
        if (err instanceof DomainError) return fail(`Task ${draft.taskKey} not found`);
        throw err;
      }
      target = ctx.projects.get(task.projectId);
      action.taskId = task.id;
      action.taskKey = task.key;
      action.projectId = task.projectId;
      action.projectKey = target?.project.key ?? null;
      const needed = draft.type === 'update_task' ? 'task:update' : 'comment:create';
      if (!target || !canInProject(target.role, needed)) {
        return fail(
          draft.type === 'update_task'
            ? `You can't edit ${task.key}`
            : `You can't comment on ${task.key}`,
        );
      }
    }

    if (draft.type === 'add_comment') {
      const comment = draft.comment?.trim();
      if (!comment) return fail('The comment is empty');
      action.comment = clip(comment, 9900);
      return action;
    }

    // create_task / update_task fields.
    const title = draft.title?.trim();
    if (title) action.title = title.slice(0, 500);
    if (draft.description?.trim()) action.description = clip(draft.description.trim(), 49_000);
    action.priority = draft.priority;
    if (draft.dueDate) {
      if (!isIsoDate(draft.dueDate)) return fail(`"${draft.dueDate}" is not a valid date`);
      action.dueDate = draft.dueDate;
    }
    if (draft.status) {
      const status = target.statuses.find(
        (s) => s.name.toLowerCase() === draft.status!.trim().toLowerCase(),
      );
      if (!status) return fail(`${target.project.key} has no status "${draft.status}"`);
      action.statusId = status.id;
    }
    if (draft.assignee) {
      const match = matchPerson(ctx.people, draft.assignee);
      if ('error' in match) return fail(match.error);
      if (!(await this.deps.projectAccess.grantFor(match.userId, target.project.id))) {
        return fail(`${draft.assignee} can't see ${target.project.key}, so they can't be assigned`);
      }
      action.assigneeId = match.userId;
    }

    if (draft.type === 'create_task' && !action.title) return fail('The task has no title');
    if (
      draft.type === 'update_task' &&
      !action.title &&
      !action.description &&
      !action.priority &&
      !action.dueDate &&
      !action.statusId &&
      !action.assigneeId
    ) {
      return fail('Nothing to change');
    }
    return action;
  }
}

export class GetProposal {
  constructor(private readonly deps: { uow: UnitOfWork<Repos> }) {}

  /** Proposals are private to the person who asked for them. */
  async execute(actorId: string, proposalId: string): Promise<AiProposal> {
    const p = await this.deps.uow.repos.aiProposals.findById(proposalId);
    if (!p || p.actorId !== actorId) throw proposalNotFound();
    return toProposalView(p);
  }
}

/**
 * Carries out the confirmed actions through the normal use cases, so every permission and
 * business rule applies exactly as if the person had made the change themselves.
 *
 * The proposal id is the idempotency key: the row is locked while executing and records the
 * results, so a retried or double-clicked confirmation returns the first outcome instead of
 * applying the actions again.
 */
export class ExecuteProposal {
  constructor(
    private readonly deps: {
      uow: UnitOfWork<Repos>;
      clock: Clock;
      createTask: CreateTask;
      updateTask: UpdateTask;
      getTask: GetTask;
      addComment: AddComment;
      log: { error: (obj: object, msg: string) => void };
    },
  ) {}

  async execute(actorId: string, proposalId: string, actionIds?: number[]): Promise<AiProposal> {
    return this.deps.uow.transaction(async ({ aiProposals }) => {
      const p = await aiProposals.lockById(proposalId);
      if (!p || p.actorId !== actorId) throw proposalNotFound();
      if (p.status === 'executed') return toProposalView(p);

      const selected = p.actions.filter(
        (a) => a.error === null && (!actionIds || actionIds.includes(a.id)),
      );
      if (selected.length === 0) {
        throw validation('no_actions_selected', 'Select at least one action that can run');
      }
      const results: ActionResult[] = [];
      for (const action of selected) results.push(await this.run(actorId, action));
      return toProposalView(await aiProposals.markExecuted(p.id, results, this.deps.clock.now()));
    });
  }

  private async run(actorId: string, a: AiAction): Promise<ActionResult> {
    const result = { actionId: a.id, ok: true, taskId: a.taskId, taskKey: a.taskKey, error: null };
    try {
      switch (a.type) {
        case 'create_task': {
          const task = await this.deps.createTask.execute(actorId, a.projectId!, {
            title: a.title!,
            description: a.description ?? '',
            statusId: a.statusId ?? undefined,
            priority: a.priority ?? 'none',
            assigneeId: a.assigneeId,
            labelIds: [],
            dueDate: a.dueDate,
            estimate: null,
            parentId: null,
          });
          return { ...result, taskId: task.id, taskKey: task.key };
        }
        case 'update_task': {
          // Applied on top of the task's latest version: only the proposed fields change.
          const current = await this.deps.getTask.execute(actorId, a.taskId!);
          const patch: UpdateTaskBody = { version: current.version };
          if (a.title) patch.title = a.title;
          if (a.description) patch.description = a.description;
          if (a.priority) patch.priority = a.priority;
          if (a.statusId) patch.statusId = a.statusId;
          if (a.assigneeId) patch.assigneeId = a.assigneeId;
          if (a.dueDate) patch.dueDate = a.dueDate;
          await this.deps.updateTask.execute(actorId, a.taskId!, patch);
          return result;
        }
        case 'add_comment':
          await this.deps.addComment.execute(actorId, a.taskId!, a.comment!);
          return result;
      }
    } catch (err) {
      // One failed action (e.g. permissions changed since proposing) doesn't stop the rest.
      if (!(err instanceof DomainError)) this.deps.log.error({ err }, 'AI action failed');
      return {
        ...result,
        ok: false,
        error: err instanceof DomainError ? err.message : 'Something went wrong',
      };
    }
  }
}
