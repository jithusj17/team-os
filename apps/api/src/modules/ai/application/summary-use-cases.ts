import {
  MENTION_PATTERN,
  type AiStreamEvent,
  type SearchSourceType,
  type SummaryType,
} from '@team-os/shared';
import type { Clock, TokenService } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { DomainError, unavailable } from '../../../shared/domain/errors.js';
import type { GetDoc } from '../../docs/application/doc-use-cases.js';
import type { GetMeeting } from '../../meetings/application/meeting-use-cases.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import { isClosedCategory } from '../../projects/domain/project.js';
import type { StatusRepository } from '../../projects/domain/ports.js';
import type { SearchWorkspace } from '../../search/application/search-use-cases.js';
import type { ListComments } from '../../tasks/application/comment-use-cases.js';
import type { GetTask } from '../../tasks/application/task-use-cases.js';
import type { TaskRepository } from '../../tasks/domain/ports.js';
import type { MemberRepository } from '../../workspaces/domain/ports.js';
import {
  ASK_SYSTEM,
  NO_SOURCES_ANSWER,
  PROMPT_VERSION,
  SUMMARY_FOCUS,
  SUMMARY_SYSTEM,
  clip,
  formatSources,
  summaryCacheKey,
} from '../domain/ai.js';
import type { LanguageModel, SummaryCache } from '../domain/ports.js';

/** Fails fast with 503 when no model is configured. */
export function requireModel(model: LanguageModel) {
  if (!model.enabled) {
    throw unavailable('ai_not_configured', 'AI features are not configured on this server');
  }
}

export class GetAiStatus {
  constructor(private readonly deps: { model: LanguageModel }) {}

  execute() {
    return { enabled: this.deps.model.enabled };
  }
}

type Repos = { members: MemberRepository; statuses: StatusRepository; tasks: TaskRepository };

/** Names for user ids in a workspace, for writing content the model can read. */
async function namesIn(members: MemberRepository, workspaceId: string) {
  const names = new Map((await members.list(workspaceId)).map((m) => [m.userId, m.name]));
  return (id: string | null) => (id ? (names.get(id) ?? 'Former member') : 'Unassigned');
}

const day = (d: Date | string | null) =>
  d ? (typeof d === 'string' ? d : d.toISOString().slice(0, 10)) : null;

/**
 * Streams a summary of a task, project, meeting or doc. Access is checked by the same use
 * cases that serve the content, before anything streams. Summaries are cached by a hash of
 * exactly the content the viewer can see, so a cached summary never reveals more.
 */
export class Summarize {
  constructor(
    private readonly deps: {
      uow: UnitOfWork<Repos>;
      model: LanguageModel;
      cache: SummaryCache;
      tokens: TokenService;
      clock: Clock;
      projectAccess: ProjectAccess;
      getTask: GetTask;
      listComments: ListComments;
      getMeeting: GetMeeting;
      getDoc: GetDoc;
    },
  ) {}

  async execute(
    actorId: string,
    input: { type: SummaryType; id: string },
    signal?: AbortSignal,
  ): Promise<AsyncIterable<AiStreamEvent>> {
    requireModel(this.deps.model);
    const content = await this.content(actorId, input.type, input.id);
    const hash = this.deps.tokens.hash(
      JSON.stringify([PROMPT_VERSION, this.deps.model.name, input.type, content]),
    );
    const key = summaryCacheKey(input.type, input.id, hash);
    const { model, cache } = this.deps;
    const prompt = `${SUMMARY_FOCUS[input.type]}\n\n<content>\n${content}\n</content>`;

    return (async function* () {
      const cached = await cache.get(key);
      if (cached !== null) {
        yield { type: 'delta', text: cached };
        yield { type: 'done', cached: true };
        return;
      }
      let text = '';
      for await (const delta of model.streamText({ system: SUMMARY_SYSTEM, prompt, signal })) {
        text += delta;
        yield { type: 'delta', text: delta };
      }
      if (text.trim()) await cache.set(key, text);
      yield { type: 'done', cached: false };
    })();
  }

  /** The content to summarize, as plain text. Throws not-found/forbidden like a normal read. */
  private async content(actorId: string, type: SummaryType, id: string): Promise<string> {
    const { uow } = this.deps;
    switch (type) {
      case 'task': {
        const task = await this.deps.getTask.execute(actorId, id);
        const [comments, statuses, name] = await Promise.all([
          this.deps.listComments.execute(actorId, id),
          uow.repos.statuses.listForProject(task.projectId),
          namesIn(uow.repos.members, task.workspaceId),
        ]);
        const status = statuses.find((s) => s.id === task.statusId)?.name ?? 'Unknown';
        const mentionsAsNames = (body: string) =>
          body.replace(MENTION_PATTERN, (_m, uid: string) => `@${name(uid.toLowerCase())}`);
        return [
          `Task ${task.key}: ${task.title}`,
          `Status: ${status} | Priority: ${task.priority} | Assignee: ${name(task.assigneeId)} | Due: ${day(task.dueDate) ?? 'none'}`,
          task.openBlockerCount ? `Blocked by ${task.openBlockerCount} open task(s)` : '',
          `Description:\n${clip(task.description || '(none)', 8000)}`,
          comments.length
            ? `Comments (oldest first):\n${comments
                .slice(-40)
                .map(
                  (c) =>
                    `- ${name(c.authorId)} (${day(c.createdAt)}): ${clip(mentionsAsNames(c.body), 1500)}`,
                )
                .join('\n')}`
            : 'No comments.',
        ]
          .filter(Boolean)
          .join('\n\n');
      }
      case 'project': {
        const { project } = await this.deps.projectAccess.authorize(actorId, id, 'project:read');
        const [statuses, page, name] = await Promise.all([
          uow.repos.statuses.listForProject(id),
          uow.repos.tasks.list(id, {}, 'updated', { limit: 100 }),
          namesIn(uow.repos.members, project.workspaceId),
        ]);
        const today = day(this.deps.clock.now())!;
        const statusOf = new Map(statuses.map((s) => [s.id, s]));
        const counts = statuses
          .map((s) => `${s.name}: ${page.items.filter((t) => t.statusId === s.id).length}`)
          .join(', ');
        const lines = page.items.map((t) => {
          const status = statusOf.get(t.statusId);
          const open = !status || !isClosedCategory(status.category);
          const due = day(t.dueDate);
          return [
            `- ${t.key} [${status?.name ?? '?'}] ${t.title}`,
            `assignee: ${name(t.assigneeId)}`,
            t.priority !== 'none' ? `priority: ${t.priority}` : '',
            due ? `due ${due}${open && due < today ? ' (OVERDUE)' : ''}` : '',
            t.openBlockerCount ? `blocked by ${t.openBlockerCount}` : '',
            `updated ${day(t.updatedAt)}`,
          ]
            .filter(Boolean)
            .join(', ');
        });
        return [
          `Project ${project.key}: ${project.name}`,
          project.description ? `Description: ${clip(project.description, 2000)}` : '',
          `Today: ${today}`,
          `Tasks by status${page.nextCursor ? ' (100 most recently updated)' : ''}: ${counts}`,
          `Tasks, most recently updated first:\n${lines.join('\n') || '(no tasks)'}`,
        ]
          .filter(Boolean)
          .join('\n\n');
      }
      case 'meeting': {
        const meeting = await this.deps.getMeeting.execute(actorId, id);
        const name = await namesIn(uow.repos.members, meeting.workspaceId);
        const notes = meeting.notesDocId
          ? await this.readableDocBody(actorId, meeting.notesDocId)
          : null;
        return [
          `Meeting: ${meeting.title}`,
          `When: ${meeting.startsAt.toISOString()} to ${meeting.endsAt.toISOString()}`,
          `Organizer: ${name(meeting.organizerId)}`,
          `Attendees: ${meeting.attendees.map((a) => `${name(a.userId)} (${a.response})`).join(', ') || 'none'}`,
          meeting.description ? `Agenda / description:\n${clip(meeting.description, 4000)}` : '',
          meeting.linkedTasks.length
            ? `Linked tasks: ${meeting.linkedTasks.map((t) => `${t.key} ${t.title}`).join('; ')}`
            : '',
          notes ? `Meeting notes:\n${clip(notes, 12000)}` : 'No meeting notes yet.',
        ]
          .filter(Boolean)
          .join('\n\n');
      }
      case 'doc': {
        const doc = await this.deps.getDoc.execute(actorId, id);
        return `Doc: ${doc.title}\n\n${clip(doc.body || '(empty)', 16000)}`;
      }
    }
  }

  private async readableDocBody(actorId: string, docId: string): Promise<string | null> {
    try {
      return (await this.deps.getDoc.execute(actorId, docId)).body;
    } catch (err) {
      if (err instanceof DomainError) return null;
      throw err;
    }
  }
}

/**
 * "Ask the workspace": retrieves content the actor can access (permissions are applied
 * inside the search query) and streams an answer that cites it.
 */
export class AskWorkspace {
  constructor(private readonly deps: { model: LanguageModel; search: SearchWorkspace }) {}

  async execute(
    actorId: string,
    workspaceId: string,
    question: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<AiStreamEvent>> {
    requireModel(this.deps.model);
    const { results } = await this.deps.search.retrieve(actorId, workspaceId, {
      q: question,
      limit: 8,
      match: 'any',
    });
    const sources = results.map((r, i) => ({
      n: i + 1,
      type: r.type as SearchSourceType,
      id: r.id,
      title: r.title,
      projectId: r.projectId,
      taskId: r.taskId,
      taskKey: r.taskKey,
    }));
    const prompt = `<sources>\n${formatSources(
      results.map((r, i) => ({ n: i + 1, title: r.title, content: r.content })),
    )}\n</sources>\n\nQuestion: ${question}`;
    const { model } = this.deps;

    return (async function* () {
      yield { type: 'sources', sources };
      if (sources.length === 0) {
        yield { type: 'delta', text: NO_SOURCES_ANSWER };
      } else {
        for await (const delta of model.streamText({ system: ASK_SYSTEM, prompt, signal })) {
          yield { type: 'delta', text: delta };
        }
      }
      yield { type: 'done', cached: false };
    })();
  }
}
