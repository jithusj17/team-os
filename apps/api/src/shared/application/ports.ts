import type { EmailJob } from '@team-os/shared';

/** Background jobs. Implementations must be safe to call after a transaction commits. */
export interface JobQueue {
  sendEmail(job: EmailJob): Promise<void>;
}

/** Secure random tokens and their one-way hashes (for storing tokens at rest). */
export interface TokenService {
  generate(): string;
  /** A short lowercase hex string for human-visible suffixes (not a secret). */
  shortId(): string;
  hash(token: string): string;
  equals(a: string, b: string): boolean;
}

export interface Clock {
  now(): Date;
}

/** Builds links into the web app (invite links, email links). */
export interface AppUrls {
  invite(token: string): string;
  task(workspaceId: string, taskKey: string): string;
}
