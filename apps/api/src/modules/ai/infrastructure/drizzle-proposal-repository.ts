import { eq } from 'drizzle-orm';
import type { ActionResult, AiAction } from '@team-os/shared';
import type { DbExecutor } from '../../../infrastructure/db/executor.js';
import { aiProposals } from '../../../infrastructure/db/schema.js';
import type { Proposal, ProposalRepository, ProposalStatus } from '../domain/ports.js';

type Row = typeof aiProposals.$inferSelect;

const toProposal = (r: Row): Proposal => ({
  ...r,
  // jsonb columns: written only by this repository, in these shapes.
  actions: r.actions as AiAction[],
  results: r.results as ActionResult[] | null,
  status: r.status as ProposalStatus,
});

export class DrizzleProposalRepository implements ProposalRepository {
  constructor(private readonly db: DbExecutor) {}

  async create(data: Omit<Proposal, 'id' | 'status' | 'results' | 'createdAt' | 'executedAt'>) {
    const [row] = await this.db.insert(aiProposals).values(data).returning();
    return toProposal(row!);
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(aiProposals).where(eq(aiProposals.id, id));
    return row ? toProposal(row) : null;
  }

  async lockById(id: string) {
    const [row] = await this.db
      .select()
      .from(aiProposals)
      .where(eq(aiProposals.id, id))
      .for('update');
    return row ? toProposal(row) : null;
  }

  async markExecuted(id: string, results: ActionResult[], at: Date) {
    const [row] = await this.db
      .update(aiProposals)
      .set({ status: 'executed', results, executedAt: at })
      .where(eq(aiProposals.id, id))
      .returning();
    return toProposal(row!);
  }
}
