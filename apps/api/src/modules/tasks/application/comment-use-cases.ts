import { canInProject } from '@team-os/shared';
import type { Clock } from '../../../shared/application/ports.js';
import type { UnitOfWork } from '../../../shared/application/unit-of-work.js';
import { forbidden, notFound } from '../../../shared/domain/errors.js';
import type { ProjectAccess } from '../../projects/application/project-access.js';
import { parseMentions, type Comment } from '../domain/comment.js';
import type { ActivityRepository, CommentRepository } from '../domain/ports.js';
import type { TaskAccess } from './task-use-cases.js';

type Deps = {
  uow: UnitOfWork<{ comments: CommentRepository; activity: ActivityRepository }>;
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
    return this.deps.uow.transaction(async ({ comments, activity }) => {
      const comment = await comments.create({ taskId, authorId: actorId, body, mentions });
      await activity.record({ taskId, actorId, type: 'comment.created', commentId: comment.id });
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
    return this.deps.uow.transaction(async ({ comments, activity }) => {
      const comment = await comments.update(commentId, {
        body,
        mentions,
        editedAt: this.deps.clock.now(),
      });
      await activity.record({ taskId: task.id, actorId, type: 'comment.updated', commentId });
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
    const { grant } = await this.deps.taskAccess.authorize(
      actorId,
      existing.taskId,
      'project:read',
    );
    if (existing.authorId !== actorId && !canInProject(grant.role, 'comment:moderate')) {
      throw forbidden('not_comment_author', 'You can only delete your own comments');
    }
    await this.deps.uow.transaction(async ({ comments, activity }) => {
      await comments.delete(commentId);
      await activity.record({
        taskId: existing.taskId,
        actorId,
        type: 'comment.deleted',
        commentId,
      });
    });
  }
}
