import type { ActionResult, AiAction, AiDraftProposal } from '@team-os/shared';

export interface ModelRequest {
  system: string;
  prompt: string;
  /** Stops generation when the client goes away. */
  signal?: AbortSignal;
}

/** The LLM behind every AI feature. */
export interface LanguageModel {
  /** False when no API key is configured: AI endpoints report `ai_not_configured`. */
  readonly enabled: boolean;
  /** Recorded on proposals and part of summary cache keys. */
  readonly name: string;
  /** Streams the response text. Throws if the model declines or fails. */
  streamText(request: ModelRequest): AsyncIterable<string>;
  /** Drafts actions as structured output (not yet validated). */
  draftActions(request: ModelRequest): Promise<AiDraftProposal>;
}

/** Generated summaries, keyed by a hash of the content they summarize. */
export interface SummaryCache {
  get(key: string): Promise<string | null>;
  set(key: string, text: string): Promise<void>;
}

export type ProposalStatus = 'pending' | 'executed';

export interface Proposal {
  id: string;
  workspaceId: string;
  actorId: string | null;
  instruction: string;
  context: unknown;
  summary: string;
  actions: AiAction[];
  status: ProposalStatus;
  results: ActionResult[] | null;
  model: string;
  createdAt: Date;
  executedAt: Date | null;
}

/** AI action proposals: the audit log of what the AI suggested and what was carried out. */
export interface ProposalRepository {
  create(
    data: Omit<Proposal, 'id' | 'status' | 'results' | 'createdAt' | 'executedAt'>,
  ): Promise<Proposal>;
  findById(id: string): Promise<Proposal | null>;
  /** Reads and row-locks a proposal until the transaction ends (serializes executions). */
  lockById(id: string): Promise<Proposal | null>;
  markExecuted(id: string, results: ActionResult[], at: Date): Promise<Proposal>;
}
