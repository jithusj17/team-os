import type { SummaryType } from '@team-os/shared';

/** Bump when prompts change, so cached summaries written with the old prompt are not reused. */
export const PROMPT_VERSION = 1;

export const SUMMARY_SYSTEM = `You summarize content from a team workspace (tasks, projects, meetings, docs) for busy teammates.
Write in Markdown. Start with a one-sentence overview, then short bullet points covering what matters: current state, decisions, open questions, risks, and next steps. Skip sections that have nothing to say.
Only use facts from the content provided; never invent people, dates or numbers. Refer to tasks by their key (e.g. ENG-12).
Keep it under 200 words.`;

export const SUMMARY_FOCUS: Record<SummaryType, string> = {
  task: 'Summarize this task and its discussion: what it is, where it stands, and what is blocking or next.',
  project:
    'Write a project status update: overall progress, what moved recently, what is overdue or blocked, and what needs attention.',
  meeting:
    'Summarize this meeting: purpose, key decisions, and action items (with owners and due dates when stated).',
  doc: 'Summarize this document: its purpose and key points.',
};

export const ASK_SYSTEM = `You answer questions about a team workspace using only the numbered sources provided.
Cite sources inline with their number in square brackets, like [1] or [2][3], right after the claim they support.
If the sources don't contain the answer, say so plainly instead of guessing. Be concise and write in Markdown.`;

export const NO_SOURCES_ANSWER =
  "I couldn't find anything in this workspace about that. Try rephrasing, or check that the content exists and you have access to it.";

export const ACTIONS_SYSTEM = `You turn requests into concrete actions in a team workspace's task tracker. The available actions are:
- create_task: needs a title; optionally projectKey, description, priority, assignee, status, dueDate.
- update_task: needs taskKey; set only the fields that should change (title, description, priority, assignee, status, dueDate).
- add_comment: needs taskKey and comment.
Rules:
- Only propose actions the request asks for or clearly implies (e.g. action items in meeting notes). Propose no actions if there is nothing to do.
- Use only project keys, task keys, people and statuses listed in the context. For assignee use the person's email. Leave a field null when unknown or unchanged.
- Dates are YYYY-MM-DD; resolve relative dates ("next Friday") against today's date.
- Give each action a short reason pointing at the part of the request or source it comes from.
- summary: one sentence describing the proposed changes.`;

/** Cache key for a summary: changes whenever the content, prompt or model changes. */
export function summaryCacheKey(type: SummaryType, id: string, contentHash: string) {
  return `ai:summary:${type}:${id}:${contentHash}`;
}

export interface Person {
  userId: string;
  name: string;
  email: string;
}

/**
 * Finds the one person an AI-written reference ("dana@acme.com", "Dana", "Dana Lee") means.
 * Exact email or name wins; otherwise a unique first-name or partial match. Ambiguous or
 * unknown references resolve to an error, never a guess.
 */
export function matchPerson(people: Person[], ref: string): { userId: string } | { error: string } {
  const q = ref.trim().toLowerCase().replace(/^@/, '');
  const pick = (matches: Person[]) =>
    matches.length === 1
      ? { userId: matches[0]!.userId }
      : matches.length > 1
        ? { error: `"${ref}" matches more than one person` }
        : null;
  return (
    pick(people.filter((p) => p.email.toLowerCase() === q)) ??
    pick(people.filter((p) => p.name.toLowerCase() === q)) ??
    pick(people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === q)) ??
    pick(people.filter((p) => q.length >= 3 && p.name.toLowerCase().includes(q))) ?? {
      error: `No one called "${ref}" can be assigned here`,
    }
  );
}

/** Whether `s` is a real calendar date in YYYY-MM-DD form. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Content trimmed to a size that keeps prompts fast and cheap. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[…truncated]`;
}

export interface NumberedSource {
  n: number;
  title: string;
  content: string;
}

/** Retrieved sources as numbered context for a cited answer. */
export function formatSources(sources: NumberedSource[]): string {
  return sources.map((s) => `[${s.n}] ${s.title}\n${clip(s.content, 3000)}`).join('\n\n---\n\n');
}
