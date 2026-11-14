import type { Rng } from './rng';

export type NodeType = 'skirmish' | 'elite' | 'shop' | 'camp' | 'event' | 'cache' | 'market' | 'boss';

export interface MapNode {
  id: number;
  row: number;
  /** Horizontal position, 0..1. */
  x: number;
  type: NodeType;
  /** Ids of nodes in the next row this one leads to. */
  next: number[];
}

export interface ActMap {
  nodes: MapNode[];
  rows: number;
}

/** Rows 0..6 are the route, row 7 is the boss. */
export const MAP_ROWS = 8;

const WEIGHTS: [NodeType, number, minRow: number][] = [
  ['skirmish', 40, 1],
  ['event', 24, 1],
  ['elite', 12, 2],
  ['shop', 9, 2],
  ['camp', 6, 3],
  ['cache', 5, 1],
  ['market', 4, 1],
];

function rollType(rng: Rng, row: number): NodeType {
  const options = WEIGHTS.filter(([, , minRow]) => row >= minRow);
  let r = rng.next() * options.reduce((sum, [, w]) => sum + w, 0);
  for (const [type, weight] of options) {
    r -= weight;
    if (r < 0) return type;
  }
  return 'skirmish';
}

export function generateMap(rng: Rng): ActMap {
  const rows: MapNode[][] = [];
  let id = 0;

  for (let row = 0; row < MAP_ROWS; row++) {
    const last = row === MAP_ROWS - 1;
    const width = last ? 1 : row === 0 ? 3 : rng.int(2, 4);
    rows.push(
      Array.from({ length: width }, (_, i) => {
        let type: NodeType;
        if (last) type = 'boss';
        else if (row === 0) type = 'skirmish';
        else if (row === MAP_ROWS - 2) type = 'camp';
        else type = rollType(rng, row);
        const jitter = last ? 0 : (rng.next() - 0.5) * (0.3 / width);
        return { id: id++, row, x: (i + 0.5) / width + jitter, type, next: [] };
      }),
    );
  }

  // Every act has at least one shop and one event to find.
  rng.pick(rows[3]).type = 'shop';
  rng.pick(rows[1]).type = 'event';

  for (let row = 0; row < MAP_ROWS - 1; row++) {
    const from = rows[row];
    const to = rows[row + 1];
    const scale = (i: number, a: number, b: number): number =>
      a === 1 ? Math.floor((b - 1) / 2) : Math.round((i * (b - 1)) / (a - 1));

    from.forEach((node, i) => {
      const j = scale(i, from.length, to.length);
      node.next.push(to[j].id);
      if (rng.chance(0.4)) {
        const k = j + (rng.chance(0.5) ? 1 : -1);
        if (k >= 0 && k < to.length) node.next.push(to[k].id);
      }
    });
    // No dead ends going backwards: every node must be reachable.
    to.forEach((node, j) => {
      if (!from.some((f) => f.next.includes(node.id))) {
        from[scale(j, to.length, from.length)].next.push(node.id);
      }
    });
    for (const node of from) node.next.sort((a, b) => a - b);
  }

  return { nodes: rows.flat(), rows: MAP_ROWS };
}
