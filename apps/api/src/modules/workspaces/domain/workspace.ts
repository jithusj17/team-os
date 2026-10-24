import type { WorkspaceRole } from '@team-os/shared';

export type { WorkspaceRole };

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

/** A workspace as seen by one of its members. */
export interface WorkspaceView extends Workspace {
  role: WorkspaceRole;
}

/** Derives a URL slug from a workspace name, e.g. "Rocket Team!" -> "rocket-team". */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug.length >= 3 ? slug : `workspace-${slug}`.replace(/-+$/, '');
}

/** A slug with a random suffix, used when the derived slug is already taken. */
export function slugWithSuffix(base: string, suffix: string): string {
  return `${base.slice(0, 33)}-${suffix}`;
}
