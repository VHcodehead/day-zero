import { CLASSES } from './classes';
import { planMove, type Combat } from './combat';
import { Run, type PartyLink, type RunOptions } from './run';
import type { ClassId, Enemy, Fx, LogEntry } from './types';

/**
 * Co-op. Every player keeps their own Run (deck, HP, Scrap, gear, shops, rewards),
 * and the squad shares the map, the enemies of each fight and the pool of Resets.
 *
 * Rules:
 *  - Everyone travels together. The squad moves on once every player is back on the map.
 *  - Enemies have their HP multiplied by the number of players, and each enemy move hits every player.
 *  - Players take their turns at the same time. Enemies act once every player has ended their turn.
 *  - A player at 0 HP is down for the rest of the fight and gets back up afterwards if the squad wins.
 *  - If everyone is down, the squad may spend one shared Reset to replay the fight.
 *
 * A Party changes only through `apply` and the enemy-phase steps, and is fully deterministic,
 * so every player's machine can run its own copy and stay in step by applying the same actions
 * in the same order.
 */

export const MAX_PARTY = 4;
/** Share of max HP a downed player gets back up with after a won fight. */
export const REVIVE_SHARE = 0.2;

export interface Member {
  name: string;
  classId: ClassId;
}

/** Everything a player can do to the game, in a form that can be sent over the network. */
export type Action =
  | { k: 'gear'; i: number }
  | { k: 'node'; id: number }
  | { k: 'card'; uid: number; target?: number }
  | { k: 'end' }
  | { k: 'stim'; i: number }
  | { k: 'reset' }
  | { k: 'rewardCard'; i: number }
  | { k: 'rewardLeave' }
  | { k: 'buy'; what: 'card' | 'gear' | 'stim' | 'reset'; i: number }
  | { k: 'remove'; i: number }
  | { k: 'rest' }
  | { k: 'upgrade'; i: number }
  | { k: 'event'; i: number }
  | { k: 'market'; what: 'crate' | 'blood' | 'bet' }
  | { k: 'leave' }
  /** The player has left the game. */
  | { k: 'drop' };

const int = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6;

/** Checks a message from another machine before it is treated as an Action. */
export function isAction(v: unknown): v is Action {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  switch (a.k) {
    case 'end':
    case 'reset':
    case 'rewardLeave':
    case 'rest':
    case 'leave':
    case 'drop':
      return true;
    case 'gear':
    case 'stim':
    case 'rewardCard':
    case 'remove':
    case 'upgrade':
    case 'event':
      return int(a.i);
    case 'node':
      return int(a.id);
    case 'card':
      return int(a.uid) && (a.target === undefined || int(a.target));
    case 'buy':
      return int(a.i) && ['card', 'gear', 'stim', 'reset'].includes(a.what as string);
    case 'market':
      return ['crate', 'blood', 'bet'].includes(a.what as string);
    default:
      return false;
  }
}

export const isMember = (v: unknown): v is Member =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as Member).name === 'string' &&
  typeof (v as Member).classId === 'string' &&
  Object.hasOwn(CLASSES, (v as Member).classId);

export class Party {
  readonly runs: Run[];
  readonly names: string[];
  /** Players who have left. Their runs are ignored from then on. */
  readonly gone: boolean[];
  readonly link: PartyLink;
  /**
   * When true, enemies act as soon as every player has ended their turn.
   * The UI sets this to false and calls the enemy-phase steps itself, so it can animate them.
   */
  autoEnemies = true;

  private queue: Enemy[] | null = null;

  constructor(members: Member[], seed: number, options: Pick<RunOptions, 'threat'> = {}) {
    if (members.length < 1 || members.length > MAX_PARTY) throw new Error('A squad has 1 to 4 players.');
    this.link = { size: members.length, enemies: null };
    this.names = members.map((m) => m.name);
    this.gone = members.map(() => false);
    this.runs = members.map((m, player) => new Run(m.classId, seed, { ...options, party: this.link, player }));
    const resets = Math.max(...this.runs.map((r) => r.resets));
    for (const run of this.runs) run.resets = resets;
  }

  // ---------- queries ----------

  get size(): number {
    return this.runs.length;
  }

  /** Indexes of the players still in the game. */
  get active(): number[] {
    return this.runs.map((_, i) => i).filter((i) => !this.gone[i]);
  }

  /** The shared pool of Resets. */
  get resets(): number {
    return this.runs[this.active[0] ?? 0].resets;
  }

  /** True when the squad can pick the next node: everyone is back on the map. */
  get canTravel(): boolean {
    const active = this.active;
    return active.length > 0 && active.every((i) => this.runs[i].phase === 'map');
  }

  /** Players in the current fight (including downed ones). */
  get fighters(): number[] {
    return this.active.filter((i) => this.runs[i].phase === 'combat' && this.runs[i].combat);
  }

  /** Players in the current fight who are still standing. */
  get standing(): number[] {
    return this.fighters.filter((i) => this.runs[i].combat!.status === 'playing');
  }

  /** True when the squad is on a screen that waits for a single shared decision or for everyone. */
  get over(): boolean {
    return this.active.every((i) => ['victory', 'gameover'].includes(this.runs[i].phase));
  }

  /** Who the squad is waiting for right now. */
  get waitingOn(): number[] {
    const standing = this.standing;
    if (standing.length) return standing.filter((i) => this.runs[i].combat!.phase === 'player');
    if (this.fighters.length) return [];
    return this.active.filter((i) => !['map', 'dead', 'gameover', 'victory'].includes(this.runs[i].phase));
  }

  /** True when every standing player has ended their turn and the enemies should act. */
  get enemiesReady(): boolean {
    if (this.queue) return false;
    const standing = this.standing;
    return standing.length > 0 && standing.every((i) => this.runs[i].combat!.phase === 'enemy');
  }

  get enemiesActing(): boolean {
    return this.queue !== null;
  }

  /** A number that is the same on every machine as long as their copies of the game agree. */
  hash(): number {
    let h = 2166136261;
    const add = (n: number): void => {
      h ^= n | 0;
      h = Math.imul(h, 16777619);
    };
    const phases = ['gear', 'map', 'combat', 'reward', 'shop', 'camp', 'event', 'market', 'dead', 'gameover', 'victory'];
    this.runs.forEach((run, i) => {
      add(this.gone[i] ? 1 : 0);
      if (this.gone[i]) return;
      for (const n of [run.hp, run.maxHp, run.scrap, run.deck.length, run.resets, run.act, run.nodeId ?? -1]) add(n);
      for (const n of [phases.indexOf(run.phase), run.gear.length, run.stims.length, run.fightsWon]) add(n);
      const c = run.phase === 'combat' ? run.combat : null;
      if (!c) return;
      const p = c.player;
      for (const n of [p.hp, p.block, p.energy, p.ammo, c.hand.length, c.drawPile.length, c.discardPile.length, c.turn]) add(n);
      for (const card of c.hand) add(card.uid);
      for (const e of c.enemies) for (const n of [e.hp, e.block, e.statuses.strength, e.statuses.weak, e.statuses.vulnerable]) add(n);
    });
    return h >>> 0;
  }

  // ---------- actions ----------

  /** Applies one player's action. Returns false if it was not allowed and changed nothing. */
  apply(player: number, a: Action): boolean {
    const run = this.runs[player];
    if (!run || this.gone[player] || this.queue) return false;
    const combat = run.phase === 'combat' ? run.combat : null;
    const mark = combat ? { fx: combat.fx.length, log: combat.log.length } : null;

    const ok = this.perform(player, run, a);

    if (combat && mark) this.mirror(player, combat, mark);
    if (ok && a.k !== 'drop') {
      // Resets are shared: whatever this player's count became is the new pool.
      for (const i of this.active) this.runs[i].resets = run.resets;
    }
    this.settle();
    if (this.autoEnemies && this.enemiesReady) this.runEnemyPhase();
    return ok;
  }

  private perform(player: number, run: Run, a: Action): boolean {
    const phase = run.phase;
    switch (a.k) {
      case 'gear':
        run.chooseStartingGear(a.i);
        return run.phase !== phase;
      case 'node': {
        if (!this.canTravel || !run.availableNodes().some((n) => n.id === a.id)) return false;
        this.link.enemies = null;
        for (const i of this.active) this.runs[i].enterNode(a.id);
        return true;
      }
      case 'card':
        return run.playCard(a.uid, a.target);
      case 'end': {
        const combat = run.combat;
        if (phase !== 'combat' || !combat || combat.status !== 'playing' || combat.phase !== 'player') return false;
        run.beginEnemyPhase();
        return true;
      }
      case 'stim':
        return run.useStim(a.i);
      case 'reset': {
        const active = this.active;
        if (!active.every((i) => this.runs[i].phase === 'dead')) return false;
        this.link.enemies = null;
        for (const i of active) this.runs[i].useReset();
        return true;
      }
      case 'rewardCard': {
        const before = run.deck.length;
        run.takeRewardCard(a.i);
        return run.deck.length > before;
      }
      case 'rewardLeave':
        run.leaveReward();
        return run.phase !== phase;
      case 'buy':
        if (a.what === 'card') return run.buyCard(a.i);
        if (a.what === 'gear') return run.buyGear(a.i);
        if (a.what === 'stim') return run.buyStim(a.i);
        return run.buyReset();
      case 'remove':
        return run.buyRemoval(a.i);
      case 'rest':
        run.campRest();
        return run.phase !== phase;
      case 'upgrade':
        return run.campUpgrade(a.i);
      case 'event': {
        const before = run.event?.result;
        run.chooseEvent(a.i);
        return run.event?.result !== before;
      }
      case 'market': {
        if (phase !== 'market') return false;
        const before = run.marketLog.length;
        if (a.what === 'crate') run.marketCrate();
        else if (a.what === 'blood') run.marketBlood();
        else run.marketBet();
        return run.marketLog.length > before;
      }
      case 'leave':
        run.leave();
        return run.phase !== phase;
      case 'drop':
        this.gone[player] = true;
        this.link.size = Math.max(1, this.active.length);
        if (phase === 'combat') run.combat?.fall();
        for (const i of this.fighters) this.runs[i].combat!.addLog(`${this.names[player]} has left the squad.`, 'bad');
        return true;
    }
  }

  // ---------- enemy phase ----------

  /** Runs the whole enemy phase at once. The UI uses the steps below to animate it. */
  runEnemyPhase(): void {
    this.beginEnemies();
    while (this.enemyStep()) {
      // each call resolves one enemy
    }
    this.finishEnemies();
  }

  beginEnemies(): void {
    if (!this.enemiesReady) return;
    this.queue = (this.link.enemies ?? []).filter((e) => e.hp > 0);
  }

  /** The enemy that will act on the next enemyStep call, if any. */
  peekEnemy(): Enemy | null {
    if (!this.queue || !this.standing.length) return null;
    return this.queue.find((e) => e.hp > 0) ?? null;
  }

  /** Resolves one enemy's move against every standing player. */
  enemyStep(): Enemy | null {
    const enemy = this.peekEnemy();
    if (!enemy || !this.queue) return null;
    this.queue = this.queue.filter((e) => e !== enemy);
    enemy.block = 0;
    const move = enemy.plan.shift()!;
    enemy.plan.push(planMove(enemy));

    const watching = this.fighters.map((i) => this.runs[i].combat!);
    if (enemy.stunned) {
      enemy.stunned = false;
      for (const c of watching) {
        c.addLog(`${enemy.def.name} is stunned and loses its turn.`, 'good');
        c.fx.push({ kind: 'text', target: enemy.uid, text: 'STUNNED', tone: 'good' });
      }
    } else {
      watching.forEach((c, n) => c.enemyActs(enemy, move, n === 0));
      for (const c of watching) if (c.status === 'playing') c.sufferMove(enemy, move);
    }
    if (enemy.statuses.vulnerable > 0) enemy.statuses.vulnerable--;
    if (enemy.statuses.weak > 0) enemy.statuses.weak--;
    this.settle();
    return enemy;
  }

  finishEnemies(): void {
    if (!this.queue) return;
    this.queue = null;
    for (const i of this.standing) this.runs[i].combat!.finishEnemyPhase();
    this.settle();
  }

  // ---------- internals ----------

  /** Ends the fight for everyone once the enemies are dead or the whole squad is down. */
  private settle(): void {
    const fighters = this.fighters;
    if (!fighters.length) return;
    const combats = fighters.map((i) => this.runs[i].combat!);
    for (const c of combats) c.checkEnd();

    const enemiesDead = (this.link.enemies ?? []).every((e) => e.hp <= 0);
    if (enemiesDead) {
      this.queue = null;
      for (const i of fighters) {
        const run = this.runs[i];
        run.combat!.standUp(Math.ceil(run.maxHp * REVIVE_SHARE));
        run.resolveCombat();
      }
    } else if (combats.every((c) => c.status === 'lost')) {
      this.queue = null;
      for (const i of fighters) this.runs[i].resolveCombat();
    }
  }

  /** Shows a player's hits on the shared enemies, and what they played, to everyone else in the fight. */
  private mirror(player: number, combat: Combat, mark: { fx: number; log: number }): void {
    const name = this.names[player];
    const fx: Fx[] = combat.fx.slice(mark.fx).filter((e) => e.target !== 'player');
    const log: LogEntry[] = combat.log
      .slice(mark.log)
      .map((entry) => ({
        ...entry,
        text: entry.text.replace(/^You play /, `${name} plays `).replace(/^You use /, `${name} uses `),
      }))
      .filter((entry) => !/\byou(r)?\b/i.test(entry.text));
    for (const i of this.fighters) {
      const other = this.runs[i].combat!;
      if (other === combat) continue;
      other.fx.push(...fx.map((e) => ({ ...e })));
      other.log.push(...log);
    }
  }
}
