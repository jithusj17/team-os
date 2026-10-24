import { canInProject } from '@team-os/shared';
import type { EventRepository } from '../../../shared/application/events.js';
import type { Clock } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { forbidden, notFound } from '../../../shared/domain/errors.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import { parseMentions, type Comment } from '../domain/comment.js';
import type { ActivityRepository, CommentRepository, WatcherRepository } from '../domain/ports.js';
import type { Task } from '../domain/task.js';
import type { TaskAccess } from './task-use-cases.js';

type Deps = {
  uow: UnitOfWork<{
    comments: CommentRepository;
    activity: ActivityRepository;
    events: EventRepository;
    watchers: WatcherRepository;
  }>;
  taskAccess: TaskAccess;
  projectAccess: ProjectAccess;
  clock: Clock;
};

const commentNotFound = () => notFound('comment_not_found', 'Comment not found');

/** Mentioned users who can actually see the project; others are dropped silently. */
async function visibleMentions(projectAccess: ProjectAccess, projectId: string, body: string) {
  const ids = parseMentions(body);
  const grants = await Promise.all(ids.map((id) => projectAccess.grantFor(id, projectId)));
  return ids.filter((_, i) => grants[i] !== null);
}

const commentEvent = (
  type: 'comment.created' | 'comment.updated' | 'comment.deleted',
  task: Task,
  actorId: string,
  payload: unknown,
) => ({
  workspaceId: task.workspaceId,
  projectId: task.projectId,
  taskId: task.id,
  type,
  actorId,
  payload,
});

export class ListComments {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, taskId: string): Promise<Comment[]> {
    await this.deps.taskAccess.authorize(actorId, taskId, 'project:read');
    return this.deps.uow.repos.comments.list(taskId);
  }
}

export class AddComment {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, taskId: string, body: string): Promise<Comment> {
    const { task } = await this.deps.taskAccess.authorize(actorId, taskId, 'comment:create');
    const mentions = await visibleMentions(this.deps.projectAccess, task.projectId, body);
    return this.deps.uow.transaction(async ({ comments, activity, events, watchers }) => {
      const comment = await comments.create({ taskId, authorId: actorId, body, mentions });
      // Commenting or being mentioned subscribes you to the conversation.
      await watchers.add(taskId, [actorId, ...mentions]);
      await activity.record({ taskId, actorId, type: 'comment.created', commentId: comment.id });
      await events.append(commentEvent('comment.created', task, actorId, comment));
      return comment;
    });
  }
}

export class EditComment {
  constructor(private readonly deps: Deps) {}

  async execute(actorId: string, commentId: string, body: string): Promise<Comment> {
    const existing = await this.deps.uow.repos.comments.findById(commentId);
    if (!existing) throw commentNotFound();
    const { task } = await this.deps.taskAccess.authorize(
      actorId,
      existing.taskId,
      'comment:create',
    );
    if (existing.authorId !== actorId) {
      throw forbidden('not_comment_author', 'You can only edit your own comments');
    }
    const mentions = await visibleMentions(this.deps.projectAccess, task.projectId, body);
    return this.deps.uow.transaction(async ({ comments, activity, events }) => {
      const comment = await comments.update(commentId, {
        body,
        mentions,
        editedAt: this.deps.clock.now(),
      });
      await activity.record({ taskId: task.id, actorId, type: 'comment.updated', commentId });
      await events.append(commentEvent('comment.updated', task, actorId, comment));
      return comment;
    });
  }
}

export class DeleteComment {
  constructor(private readonly deps: Deps) {}

  /** Authors can delete their own comments; project admins can delete any. */
  async execute(actorId: string, commentId: string) {
    const existing = await this.deps.uow.repos.comments.findById(commentId);
    if (!existing) throw commentNotFound();
    const { task, grant } = await this.deps.taskAccess.authorize(
      actorId,
      existing.taskId,
      'project:read',
    );
    if (existing.authorId !== actorId && !canInProject(grant.role, 'comment:moderate')) {
      throw forbidden('not_comment_author', 'You can only delete your own comments');
    }
    await this.deps.uow.transaction(async ({ comments, activity, events }) => {
      await comments.delete(commentId);
      await activity.record({ taskId: task.id, actorId, type: 'comment.deleted', commentId });
      await events.append(commentEvent('comment.deleted', task, actorId, { id: commentId }));
    });
  }
}
