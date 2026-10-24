import {
  effectiveProjectRole,
  type SearchIndexJob,
  type SearchResponse,
  type SearchSourceType,
  type WorkspaceEvent,
} from '@team-os/shared';
import type { JobQueue, TokenService } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import type { DocRepository } from '../../docs/domain/ports.js';
import type { MeetingRepository } from '../../meetings/domain/ports.js';
import type { ProjectRepository } from '../../projects/domain/ports.js';
import type { CommentRepository, TaskRepository } from '../../tasks/domain/ports.js';
import type { WorkspaceAccess } from '../../workspaces/application/workspace-access.js';
import type {
  EmbeddingProvider,
  SearchHit,
  SearchIndexRepository,
  SearchScope,
} from '../domain/ports.js';
import {
  chunkText,
  markdownToText,
  reciprocalRankFusion,
  stripMentions,
  toPrefixTsQuery,
  type IndexableSource,
} from '../domain/search.js';

type Repos = {
  search: SearchIndexRepository;
  tasks: TaskRepository;
  comments: CommentRepository;
  docs: DocRepository;
  meetings: MeetingRepository;
  projects: ProjectRepository;
};

/** Turns committed events into (debounced) re-index jobs. */
export class ScheduleIndexing {
  constructor(private readonly deps: { jobs: JobQueue }) {}

  async execute(event: WorkspaceEvent) {
    const job = indexJobFor(event);
    if (job) await this.deps.jobs.indexForSearch(job);
  }
}

export function indexJobFor(event: WorkspaceEvent): SearchIndexJob | null {
  const source = (
    sourceType: SearchSourceType,
    sourceId: string | null | undefined,
  ): SearchIndexJob | null => (sourceId ? { kind: 'source', sourceType, sourceId } : null);
  const payloadId = (event.payload as { id?: string } | null)?.id;
  switch (event.type) {
    case 'task.created':
    case 'task.updated':
    case 'task.deleted':
      return source('task', event.taskId);
    case 'comment.created':
    case 'comment.updated':
    case 'comment.deleted':
      return source('comment', payloadId);
    case 'doc.created':
    case 'doc.updated':
    case 'doc.deleted':
      return source('doc', payloadId);
    case 'meeting.created':
    case 'meeting.updated':
    case 'meeting.deleted':
      return source('meeting', payloadId);
    case 'project.deleted':
      return event.projectId ? { kind: 'project-deleted', projectId: event.projectId } : null;
    default:
      return null;
  }
}

/** Indexes the current state of one source, or removes it if it no longer exists. */
export class IndexSource {
  constructor(
    private readonly deps: {
      uow: UnitOfWork<Repos>;
      embeddings: EmbeddingProvider;
      tokens: TokenService;
    },
  ) {}

  async execute(job: SearchIndexJob): Promise<'indexed' | 'unchanged' | 'removed'> {
    const { search } = this.deps.uow.repos;
    if (job.kind === 'project-deleted') {
      await search.deleteProject(job.projectId);
      return 'removed';
    }

    const source = await this.load(job.sourceType, job.sourceId);
    if (!source) {
      if (job.sourceType === 'task') await search.deleteTask(job.sourceId);
      else await search.deleteSource(job.sourceType, job.sourceId);
      return 'removed';
    }

    // Skip re-embedding when nothing searchable changed (e.g. a task was only reordered).
    const hash = this.deps.tokens.hash(
      JSON.stringify([
        source.title,
        source.content,
        source.projectId,
        source.allowedUserIds,
        this.deps.embeddings.enabled,
      ]),
    );
    if ((await search.currentHash(source.sourceType, source.sourceId)) === hash) return 'unchanged';

    const chunks = chunkText(source.content || source.title);
    const embeddings = this.deps.embeddings.enabled
      ? await this.deps.embeddings.embed(
          chunks.map((c) => `${source.title}\n\n${c}`),
          'document',
        )
      : null;
    const { title, content: _c, ...meta } = source;
    await search.replace(
      { ...meta, hash },
      chunks.map((content, i) => ({ title, content, embedding: embeddings?.[i] ?? null })),
    );
    return 'indexed';
  }

  private async load(type: SearchSourceType, id: string): Promise<IndexableSource | null> {
    const { tasks, comments, docs, meetings } = this.deps.uow.repos;
    const base = { sourceType: type, sourceId: id, allowedUserIds: [] as string[] };
    switch (type) {
      case 'task': {
        const t = await tasks.findView(id);
        return t
          ? {
              ...base,
              workspaceId: t.workspaceId,
              projectId: t.projectId,
              taskId: t.id,
              title: `${t.key} ${t.title}`,
              content: t.description,
            }
          : null;
      }
      case 'comment': {
        const c = await comments.findById(id);
        const t = c && (await tasks.findView(c.taskId));
        return c && t
          ? {
              ...base,
              workspaceId: t.workspaceId,
              projectId: t.projectId,
              taskId: t.id,
              // Only the key: the task title is the task's to match, not each comment's.
              title: `Comment on ${t.key}`,
              content: stripMentions(c.body),
            }
          : null;
      }
      case 'doc': {
        const d = await docs.findById(id);
        return d
          ? {
              ...base,
              workspaceId: d.workspaceId,
              projectId: d.projectId,
              taskId: null,
              title: d.title,
              content: markdownToText(d.body),
            }
          : null;
      }
      case 'meeting': {
        const m = await meetings.findById(id);
        if (!m) return null;
        const attendees = (await meetings.attendees([id])).get(id) ?? [];
        return {
          ...base,
          workspaceId: m.workspaceId,
          projectId: m.projectId,
          taskId: null,
          title: m.title,
          content: [m.description, m.location].filter(Boolean).join('\n\n'),
          allowedUserIds: [
            ...new Set([
              ...attendees.map((a) => a.userId),
              ...(m.organizerId ? [m.organizerId] : []),
            ]),
          ],
        };
      }
    }
  }
}

/** Hybrid search over everything the actor can see in a workspace. */
export class SearchWorkspace {
  constructor(
    private readonly deps: {
      uow: UnitOfWork<Repos>;
      workspaceAccess: WorkspaceAccess;
      embeddings: EmbeddingProvider;
      log: { warn: (obj: object, msg: string) => void };
    },
  ) {}

  async execute(
    actorId: string,
    workspaceId: string,
    query: { q: string; types?: SearchSourceType[]; limit: number },
  ): Promise<SearchResponse> {
    const role = await this.deps.workspaceAccess.authorize(actorId, workspaceId, {
      action: 'workspace:read',
    });
    const { search, projects, tasks } = this.deps.uow.repos;
    const visibleProjectIds = (await projects.listWithExplicitRole(workspaceId, actorId))
      .filter((p) => effectiveProjectRole(role, p.visibility, p.explicitRole))
      .map((p) => p.id);
    // Fetch more candidates than we return, so fusion has something to work with.
    const scope: SearchScope = {
      workspaceId,
      userId: actorId,
      isGuest: role === 'guest',
      visibleProjectIds,
      types: query.types,
      limit: Math.max(query.limit * 3, 30),
    };

    const tsquery = toPrefixTsQuery(query.q);
    const [keywordHits, semanticHits] = await Promise.all([
      tsquery ? search.keyword(scope, { prefix: tsquery, text: query.q }) : Promise.resolve([]),
      this.semantic(scope, query.q),
    ]);

    const key = (h: SearchHit) => `${h.sourceType}:${h.sourceId}`;
    const keywordByKey = new Map(keywordHits.map((h) => [key(h), h]));
    const fused = reciprocalRankFusion([
      keywordHits.map((h) => ({ ...h, key: key(h) })),
      (semanticHits ?? []).map((h) => ({ ...h, key: key(h) })),
    ]).slice(0, query.limit);

    const refs = new Map(
      (
        await tasks.findRefs([
          ...new Set(fused.flatMap(({ item }) => (item.taskId ? [item.taskId] : []))),
        ])
      ).map((r) => [r.id, r]),
    );
    return {
      semantic: semanticHits !== null,
      results: fused.map(({ item, score }) => ({
        type: item.sourceType,
        id: item.sourceId,
        title:
          item.sourceType === 'comment' && item.taskId && refs.get(item.taskId)
            ? `Comment on ${refs.get(item.taskId)!.key}: ${refs.get(item.taskId)!.title}`
            : item.title,
        // Keyword snippets carry highlights, so prefer them when both found the item.
        snippet: keywordByKey.get(item.key)?.snippet ?? item.snippet,
        projectId: item.projectId,
        taskId: item.taskId,
        taskKey: item.taskId ? (refs.get(item.taskId)?.key ?? null) : null,
        score: Math.round(score * 10_000) / 10_000,
      })),
    };
  }

  /** Semantic hits, or null if embeddings are off or the provider failed (keyword still works). */
  private async semantic(scope: SearchScope, q: string): Promise<SearchHit[] | null> {
    if (!this.deps.embeddings.enabled) return null;
    try {
      const [vector] = await this.deps.embeddings.embed([q], 'query');
      return vector
        ? await this.deps.uow.repos.search.semantic(
            scope,
            vector,
            this.deps.embeddings.minSimilarity,
          )
        : null;
    } catch (err) {
      this.deps.log.warn({ err }, 'Semantic search unavailable; using keyword results only');
      return null;
    }
  }
}
