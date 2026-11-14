import { CLASS_LIST, LOCKED_CLASSES } from '../engine/classes';
import type { Party } from '../engine/party';
import type { Run } from '../engine/run';
import type { Session } from '../net/session';
import type { ClassId } from '../engine/types';

/** Progress that survives between loops. */
export interface Meta {
  loops: number;
  wins: number;
  /** Enemy ids whose moves you can read, because you've fought them before. */
  known: string[];
  hybridUnlocked: boolean;
  /** Highest threat level unlocked, and the one currently selected. */
  maxThreat: number;
  threat: number;
  muted: boolean;
  /** Name shown to other players in co-op. */
  name: string;
  /** Best result on the most recent daily run played. */
  daily: { date: string; best: number; attempts: number } | null;
}

const META_KEY = 'day-zero-meta';

const DEFAULT_META: Meta = {
  loops: 0,
  wins: 0,
  known: [],
  hybridUnlocked: false,
  maxThreat: 0,
  threat: 0,
  muted: false,
  name: '',
  daily: null,
};

function loadMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return { ...DEFAULT_META, ...(JSON.parse(raw) as Partial<Meta>) };
  } catch {
    // storage unavailable or corrupt: start fresh
  }
  return { ...DEFAULT_META };
}

export function saveMeta(): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(S.meta));
  } catch {
    // ignore: the game works without persistence
  }
}

/** Local date as YYYY-MM-DD. */
export function todayString(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The seed and class everyone gets for a given day's daily run. */
export function dailySetup(date: string): { seed: number; classId: ClassId } {
  let hash = 2166136261;
  for (const ch of `day-zero-${date}`) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const seed = hash >>> 0;
  const classes = CLASS_LIST.filter((c) => !LOCKED_CLASSES.includes(c.id));
  return { seed, classId: classes[seed % classes.length].id };
}

export type Modal = null | { kind: 'deck' } | { kind: 'pick'; mode: 'remove' | 'upgrade' };

/** UI state. The game rules live in the engine; this is only what the screen needs. */
export const S = {
  meta: loadMeta(),
  /** The local player's run. In co-op this is `party.runs[me]`. */
  run: null as Run | null,
  /** Co-op: the connection (from the lobby onwards), the squad (once the run starts) and which player we are. */
  session: null as Session | null,
  party: null as Party | null,
  me: 0,
  /** Co-op: room code typed or taken from an invite link, and a message for the title screen. */
  joinCode: '',
  notice: '',
  /** Co-op: the machines disagree about the game. */
  desync: false,
  copied: false,
  /** Card waiting for a target. */
  selected: null as number | null,
  modal: null as Modal,
  /** True while an animation sequence is running and input is locked. */
  busy: false,
  /** True once this run's result has been recorded in Meta. */
  runClosed: false,
  // Bookkeeping so things animate once, not on every re-render.
  combatRef: null as unknown,
  seenCards: new Set<number>(),
  deadShown: new Set<number>(),
  prevHp: new Map<string, number>(),
  lastScreen: '',
};
