import { describe, expect, it } from 'vitest';
import { criticalPath } from '../../src/modules/tasks/domain/dependency.js';

const node = (id: string, estimate: number | null = null, closed = false) => ({
  id,
  estimate,
  closed,
});
const edge = (blockerId: string, blockedId: string) => ({ blockerId, blockedId });

describe('criticalPath', () => {
  it('is empty for an empty or fully closed graph', () => {
    expect(criticalPath([], [])).toEqual({ taskIds: [], length: 0 });
    expect(criticalPath([node('a', 3, true)], [])).toEqual({ taskIds: [], length: 0 });
  });

  it('counts unestimated tasks as 1', () => {
    expect(criticalPath([node('a'), node('b'), node('c')], [edge('a', 'b')])).toEqual({
      taskIds: ['a', 'b'],
      length: 2,
    });
  });

  it('picks the heaviest chain, not the longest by count', () => {
    // a(1) -> b(1) -> c(1)   vs   x(10) -> c(1)
    const nodes = [node('a', 1), node('b', 1), node('c', 1), node('x', 10)];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('x', 'c')];
    expect(criticalPath(nodes, edges)).toEqual({ taskIds: ['x', 'c'], length: 11 });
  });

  it('handles diamonds and ignores closed tasks and edges to them', () => {
    //      a(2)
    //     /    \
    //  b(5)    c(1)
    //     \    /
    //      d(1)    with done(100) -> d
    const nodes = [node('a', 2), node('b', 5), node('c', 1), node('d', 1), node('done', 100, true)];
    const edges = [
      edge('a', 'b'),
      edge('a', 'c'),
      edge('b', 'd'),
      edge('c', 'd'),
      edge('done', 'd'),
    ];
    expect(criticalPath(nodes, edges)).toEqual({ taskIds: ['a', 'b', 'd'], length: 8 });
  });
});
