import type { DependencyTask } from '@team-os/shared';

export type { DependencyTask };

export interface DependencyEdge {
  blockerId: string;
  blockedId: string;
}

export interface GraphNode extends DependencyTask {
  estimate: number | null;
  external: boolean;
}

/**
 * The critical path: the heaviest chain of *open* tasks along blocker -> blocked edges, where
 * each task weighs its estimate (or 1 if unestimated). Closed tasks are finished work and
 * are left out. Expects an acyclic graph, which the write path guarantees.
 */
export function criticalPath(
  nodes: Pick<GraphNode, 'id' | 'estimate' | 'closed'>[],
  edges: DependencyEdge[],
): { taskIds: string[]; length: number } {
  const open = new Map(nodes.filter((n) => !n.closed).map((n) => [n.id, n]));
  const weight = (id: string) => open.get(id)!.estimate ?? 1;

  const successors = new Map<string, string[]>();
  const inDegree = new Map<string, number>([...open.keys()].map((id) => [id, 0]));
  for (const { blockerId, blockedId } of edges) {
    if (!open.has(blockerId) || !open.has(blockedId)) continue;
    successors.set(blockerId, [...(successors.get(blockerId) ?? []), blockedId]);
    inDegree.set(blockedId, inDegree.get(blockedId)! + 1);
  }

  // Kahn's algorithm gives a topological order; relax longest distances along it.
  const best = new Map<string, { length: number; previous: string | null }>();
  const queue = [...inDegree].filter(([, d]) => d === 0).map(([id]) => id);
  for (const id of queue) best.set(id, { length: weight(id), previous: null });

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const here = best.get(id)!;
    for (const next of successors.get(id) ?? []) {
      const candidate = here.length + weight(next);
      if (candidate > (best.get(next)?.length ?? -Infinity)) {
        best.set(next, { length: candidate, previous: id });
      }
      inDegree.set(next, inDegree.get(next)! - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  let end: string | null = null;
  for (const [id, { length }] of best) {
    if (end === null || length > best.get(end)!.length) end = id;
  }
  const taskIds: string[] = [];
  for (let id = end; id !== null; id = best.get(id)!.previous) taskIds.unshift(id);
  return { taskIds, length: end === null ? 0 : best.get(end)!.length };
}
