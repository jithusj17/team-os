import { asc, eq, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { commentMentions, comments } from '../../../infrastructure/db/schema.js';
import type { Comment } from '../domain/comment.js';
import type { CommentRepository } from '../domain/ports.js';

const columns = {
  id: comments.id,
  taskId: comments.taskId,
  authorId: comments.authorId,
  body: comments.body,
  createdAt: comments.createdAt,
  editedAt: comments.editedAt,
  mentions: sql<string[]>`coalesce((
    select array_agg(cm.user_id::text) from comment_mentions cm where cm.comment_id = ${comments.id}
  ), '{}')`,
};

export class DrizzleCommentRepository implements CommentRepository {
  constructor(private readonly db: DbExecutor) {}

  list(taskId: string): Promise<Comment[]> {
    return this.db
      .select(columns)
      .from(comments)
      .where(eq(comments.taskId, taskId))
      .orderBy(asc(comments.createdAt), asc(comments.id));
  }

  async findById(id: string) {
    const [row] = await this.db.select(columns).from(comments).where(eq(comments.id, id));
    return row ?? null;
  }

  private async setMentions(commentId: string, userIds: string[]) {
    await this.db.delete(commentMentions).where(eq(commentMentions.commentId, commentId));
    if (userIds.length) {
      await this.db
        .insert(commentMentions)
        .values(userIds.map((userId) => ({ commentId, userId })));
    }
  }

  async create(data: { taskId: string; authorId: string; body: string; mentions: string[] }) {
    const { mentions, ...values } = data;
    const [row] = await this.db.insert(comments).values(values).returning({ id: comments.id });
    await this.setMentions(row!.id, mentions);
    return (await this.findById(row!.id))!;
  }

  async update(id: string, data: { body: string; mentions: string[]; editedAt: Date }) {
    await this.db
      .update(comments)
      .set({ body: data.body, editedAt: data.editedAt })
      .where(eq(comments.id, id));
    await this.setMentions(id, data.mentions);
    return (await this.findById(id))!;
  }

  async delete(id: string) {
    await this.db.delete(comments).where(eq(comments.id, id));
  }
}
