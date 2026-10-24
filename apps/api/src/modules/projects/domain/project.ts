import type {
  ProjectMember,
  ProjectRole,
  ProjectVisibility,
  StatusCategory,
} from '@team-os/shared';

export type { ProjectMember, ProjectRole, ProjectVisibility, StatusCategory };

export interface Project {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string;
  visibility: ProjectVisibility;
  createdAt: Date;
}

/** A project as seen by one user. */
export interface ProjectView extends Project {
  role: ProjectRole;
}

export interface Status {
  id: string;
  projectId: string;
  name: string;
  category: StatusCategory;
  color: string;
  position: number;
}

export type NewStatus = Omit<Status, 'id' | 'projectId'>;

/** Statuses every new project starts with. Admins can rename, reorder, add and remove them. */
export const DEFAULT_STATUSES: NewStatus[] = [
  { name: 'Backlog', category: 'backlog', color: '#9ca3af', position: 0 },
  { name: 'Todo', category: 'todo', color: '#6b7280', position: 1 },
  { name: 'In Progress', category: 'in_progress', color: '#f59e0b', position: 2 },
  { name: 'In Review', category: 'in_progress', color: '#8b5cf6', position: 3 },
  { name: 'Done', category: 'done', color: '#10b981', position: 4 },
  { name: 'Canceled', category: 'canceled', color: '#ef4444', position: 5 },
];

/** Tasks in closed statuses count as finished (completed or canceled). */
export const isClosedCategory = (category: StatusCategory) =>
  category === 'done' || category === 'canceled';

/** The status new tasks land in when none is given: the first "todo", else the first status. */
export function defaultStatus(statuses: Status[]): Status | undefined {
  const ordered = [...statuses].sort((a, b) => a.position - b.position);
  return ordered.find((s) => s.category === 'todo') ?? ordered[0];
}
