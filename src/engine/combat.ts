import { SCAR, STATIC } from './cards';
import { Rng } from './rng';
import type {
  CardDef,
  CardInstance,
  Enemy,
  EnemyDef,
  Fx,
  FxTarget,
  LogEntry,
  LogKind,
  Move,
  Player,
  Statuses,
} from './types';

export const PLAN_AHEAD = 3;
export const HAND_SIZE = 5;
export const MAX_HAND = 10;
export const DRONE_BLOCK = 3;
export const MAX_CORRUPTION = 10;

export interface CombatSetup {
  deck: CardDef[];
  hp: number;
  maxHp: number;
  enemies: EnemyDef[];
  /** Drives enemy HP and move choices. The same seed gives the same enemy behaviour. */
  seed: number;
  /** Co-op: enemies another player's combat already created. They are fought together. */
  sharedEnemies?: Enemy[];
  /** Seed for the player's shuffles and rolls. Random when omitted. */
  playerSeed?: number;
  maxAmmo?: number;
  critChance?: number;
  /** Multiplies enemy HP (threat levels). */
  enemyHpMult?: (def: EnemyDef) => number;
  /** Runs after the first hand is drawn (gear effects). */
  onStart?: (combat: Combat) => void;
}

export type CombatStatus = 'playing' | 'won' | 'lost';

export interface AttackResult {
  damage: number;
  /** HP the target actually lost, after its Block. */
  hpLost: number;
  crit: boolean;
  killed: boolean;
}

const noStatuses = (): Statuses => ({ vulnerable: 0, weak: 0, strength: 0 });

function tickStatuses(s: Statuses): void {
  if (s.vulnerable > 0) s.vulnerable--;
  if (s.weak > 0) s.weak--;
}

/** Weighted pick that never plans the same move twice in a row. Uses only the enemy's own RNG. */
export function planMove(enemy: Enemy): Move {
  const all = enemy.def.moves;
  const options = all.length > 1 ? all.filter((m) => m.move.name !== enemy.lastPlanned) : all;
  const total = options.reduce((sum, m) => sum + m.weight, 0);
  let r = enemy.rng.next() * total;
  let chosen = options[options.length - 1].move;
  for (const option of options) {
    r -= option.weight;
    if (r < 0) {
      chosen = option.move;
      break;
    }
  }
  enemy.lastPlanned = chosen.name;
  return chosen;
}

export class Combat {
  /** False when the enemies belong to another player's combat (co-op). */
  readonly ownsEnemies: boolean;
  player: Player;
  enemies: Enemy[] = [];
  hand: CardInstance[] = [];
  drawPile: CardInstance[] = [];
  discardPile: CardInstance[] = [];
  exhaustPile: CardInstance[] = [];
  turn = 0;
  status: CombatStatus = 'playing';
  phase: 'player' | 'enemy' = 'player';
  log: LogEntry[] = [];
  /** Animation events since the UI last drained them. */
  fx: Fx[] = [];
  lastPlayed: { def: CardDef; targetUid?: number } | null = null;
  /** Extra cards drawn at the start of each turn. */
  extraDraw = 0;
  /** All enemies take this damage at the end of the given player turn. */
  airstrike: { turn: number; damage: number } | null = null;

  private rng: Rng;
  private nextUid = 1;
  private queue: Enemy[] = [];
  /** Debuffs enemies applied this phase. Added after the end-of-round tick so they last a full round. */
  private pending = { weak: 0, vulnerable: 0 };

  constructor(setup: CombatSetup) {
    this.rng = new Rng(setup.playerSeed ?? Math.floor(Math.random() * 2 ** 32));
    const maxAmmo = setup.maxAmmo ?? 0;
    this.player = {
      hp: setup.hp,
      maxHp: setup.maxHp,
      block: 0,
      energy: 3,
      maxEnergy: 3,
      energySpent: 0,
      ammo: maxAmmo,
      maxAmmo,
      ammoPerTurn: 0,
      critChance: setup.critChance ?? 0.1,
      tempCrit: 0,
      nextCrit: false,
      evade: 0,
      statuses: noStatuses(),
      systems: [],
      turrets: 0,
      turretDamage: 3,
      drones: 0,
      regen: 0,
      critBlock: 0,
      critDraw: 0,
      retainBlock: false,
      scars: setup.deck.filter((d) => d.type === 'scar').length,
      scarBlock: 0,
      blockPerTurn: 0,
      corruption: 0,
      corruptionPerTurn: 0,
      corruptionMult: 1,
      burnResist: 0,
    };

    this.ownsEnemies = !setup.sharedEnemies;
    if (setup.sharedEnemies) {
      this.enemies = setup.sharedEnemies;
      this.nextUid = Math.max(0, ...this.enemies.map((e) => e.uid)) + 1;
    }
    (setup.sharedEnemies ? [] : setup.enemies).forEach((def, i) => {
      const rng = new Rng(setup.seed + (i + 1) * 7919);
      const hp = Math.round(rng.int(def.hp[0], def.hp[1]) * (setup.enemyHpMult?.(def) ?? 1));
      const enemy: Enemy = {
        uid: this.nextUid++,
        def,
        hp,
        maxHp: hp,
        block: 0,
        statuses: noStatuses(),
        plan: [],
        rng,
        stunned: false,
      };
      while (enemy.plan.length < PLAN_AHEAD) enemy.plan.push(planMove(enemy));
      this.enemies.push(enemy);
    });

    this.drawPile = this.rng.shuffle(setup.deck.map((def) => ({ uid: this.nextUid++, def })));
    this.startTurn();
    setup.onStart?.(this);
    this.fx = [];
  }

  // ---------- queries ----------

  get aliveEnemies(): Enemy[] {
    return this.enemies.filter((e) => e.hp > 0);
  }

  /** Bonus damage per hit from Corruption. */
  get corruptionBonus(): number {
    return Math.floor(this.player.corruption / 2) * this.player.corruptionMult;
  }

  /** HP lost to Corruption at the end of each of your turns. */
  get corruptionBurn(): number {
    return Math.max(0, Math.floor(this.player.corruption / 3) - this.player.burnResist);
  }

  get critChance(): number {
    return Math.min(1, Math.max(0, this.player.critChance + this.player.tempCrit));
  }

  canPlay(card: CardInstance): boolean {
    const { def } = card;
    return (
      this.status === 'playing' &&
      this.phase === 'player' &&
      !def.unplayable &&
      def.cost <= this.player.energy &&
      (def.ammo ?? 0) <= this.player.ammo
    );
  }

  /** Damage a single hit of this move would deal to the player right now, before block. */
  previewEnemyHit(enemy: Enemy, move: Move): number {
    let dmg = (move.damage ?? 0) + enemy.statuses.strength;
    if (enemy.statuses.weak > 0) dmg *= 0.75;
    if (this.player.statuses.vulnerable > 0) dmg *= 1.5;
    return Math.max(0, Math.floor(dmg));
  }

  intendsAttack(enemy: Enemy): boolean {
    return enemy.hp > 0 && !enemy.stunned && !!enemy.plan[0]?.damage;
  }

  /** Total damage this enemy will attempt on its next move. */
  incomingFrom(enemy: Enemy): number {
    if (!this.intendsAttack(enemy)) return 0;
    const move = enemy.plan[0];
    return this.previewEnemyHit(enemy, move) * (move.hits ?? 1);
  }

  get totalIncoming(): number {
    return this.aliveEnemies.reduce((sum, e) => sum + this.incomingFrom(e), 0);
  }

  // ---------- player actions ----------

  /** Returns true if the card was played. */
  playCard(cardUid: number, targetUid?: number): boolean {
    const index = this.hand.findIndex((c) => c.uid === cardUid);
    if (index < 0) return false;
    const card = this.hand[index];
    if (!this.canPlay(card)) return false;

    let target: Enemy | null = null;
    if (card.def.needsTarget) {
      const alive = this.aliveEnemies;
      target =
        targetUid === undefined
          ? alive.length === 1
            ? alive[0]
            : null
          : (alive.find((e) => e.uid === targetUid) ?? null);
      if (!target) return false;
    }

    this.player.energy -= card.def.cost;
    this.player.energySpent += card.def.cost;
    this.player.ammo -= card.def.ammo ?? 0;
    this.hand.splice(index, 1);
    this.addLog(`You play ${card.def.name}.`);
    card.def.play?.(this, target);
    if (!card.def.noRepeat) this.lastPlayed = { def: card.def, targetUid: target?.uid };

    if (card.def.type === 'system') {
      this.player.systems.push(card.def.name);
    } else if (card.def.exhaust) {
      this.exhaustPile.push(card);
    } else {
      this.discardPile.push(card);
    }
    this.checkEnd();
    return true;
  }

  /** Runs the whole enemy phase at once. The UI uses the three steps below to animate it. */
  endTurn(): void {
    this.beginEnemyPhase();
    while (this.enemyStep()) {
      // each call resolves one enemy
    }
    this.finishEnemyPhase();
  }

  beginEnemyPhase(): void {
    if (this.status !== 'playing' || this.phase !== 'player') return;
    this.fireTurrets();
    if (this.airstrike?.turn === this.turn) {
      this.addLog('The airstrike hits.', 'good');
      this.damageAll(this.airstrike.damage);
    }
    if (this.player.regen) this.heal(this.player.regen);
    if (this.corruptionBurn > 0) {
      this.addLog('Corruption burns you for ' + this.corruptionBurn + ' HP.', 'bad');
      this.damagePlayer(this.corruptionBurn, true);
    }
    this.checkEnd();
    if (this.status !== 'playing') return;
    this.phase = 'enemy';
    this.discardPile.push(...this.hand);
    this.hand = [];
    this.queue = this.aliveEnemies;
    this.pending = { weak: 0, vulnerable: 0 };
  }

  /** The enemy that will act on the next enemyStep call, if any. */
  peekEnemy(): Enemy | null {
    if (this.status !== 'playing' || this.phase !== 'enemy') return null;
    return this.queue.find((e) => e.hp > 0) ?? null;
  }

  /** Resolves one enemy's move. Returns the enemy that acted, or null when none are left. */
  enemyStep(): Enemy | null {
    const enemy = this.peekEnemy();
    if (!enemy) return null;
    this.queue = this.queue.filter((e) => e !== enemy);
    enemy.block = 0;
    const move = enemy.plan.shift()!;
    enemy.plan.push(planMove(enemy));
    if (enemy.stunned) {
      enemy.stunned = false;
      this.addLog(`${enemy.def.name} is stunned and loses its turn.`, 'good');
      this.fx.push({ kind: 'text', target: enemy.uid, text: 'STUNNED', tone: 'good' });
    } else {
      this.resolveMove(enemy, move);
    }
    tickStatuses(enemy.statuses);
    return enemy;
  }

  finishEnemyPhase(): void {
    if (this.status !== 'playing' || this.phase !== 'enemy') return;
    tickStatuses(this.player.statuses);
    this.player.statuses.weak += this.pending.weak;
    this.player.statuses.vulnerable += this.pending.vulnerable;
    this.phase = 'player';
    this.startTurn();
  }

  // ---------- effects used by cards, stims and gear ----------

  /** One hit from the player. Rolls for a crit. */
  attack(target: Enemy, base: number, opts: { critBonus?: number } = {}): AttackResult {
    if (target.hp <= 0) return { damage: 0, hpLost: 0, crit: false, killed: false };
    let dmg = base + this.player.statuses.strength + this.corruptionBonus;
    if (this.player.statuses.weak > 0) dmg *= 0.75;
    const chance = Math.min(1, Math.max(0, this.critChance + (opts.critBonus ?? 0)));
    const crit = this.player.nextCrit || this.rng.chance(chance);
    this.player.nextCrit = false;
    if (crit) dmg *= 2;
    if (target.statuses.vulnerable > 0) dmg *= 1.5;
    dmg = Math.max(0, Math.floor(dmg));
    const hpLost = this.dealToEnemy(target, dmg, crit);
    if (crit) {
      if (this.player.critBlock) this.gainBlock(this.player.critBlock);
      if (this.player.critDraw) this.draw(this.player.critDraw);
    }
    return { damage: dmg, hpLost, crit, killed: target.hp === 0 };
  }

  attackRandom(base: number): void {
    const alive = this.aliveEnemies;
    if (alive.length) this.attack(this.rng.pick(alive), base);
  }

  attackAll(base: number): void {
    for (const enemy of this.aliveEnemies) this.attack(enemy, base);
  }

  /** Flat damage that ignores Strength, Weak, Vulnerable and crits (turrets, grenades). */
  damageEnemy(target: Enemy, amount: number): void {
    if (target.hp > 0) this.dealToEnemy(target, amount, false);
  }

  damageAll(amount: number): void {
    for (const enemy of this.aliveEnemies) this.damageEnemy(enemy, amount);
  }

  fireTurrets(): void {
    for (let i = 0; i < this.player.turrets; i++) {
      const alive = this.aliveEnemies;
      if (!alive.length) return;
      this.damageEnemy(this.rng.pick(alive), this.player.turretDamage);
    }
  }

  gainBlock(amount: number): void {
    if (amount <= 0) return;
    this.player.block += amount;
    this.fx.push({ kind: 'block', target: 'player', amount });
  }

  gainEnergy(amount: number): void {
    this.player.energy += amount;
  }

  /** Negative amounts remove Corruption. */
  gainCorruption(amount: number): void {
    const p = this.player;
    p.corruption = Math.min(MAX_CORRUPTION, Math.max(0, p.corruption + amount));
  }

  gainAmmo(amount: number): void {
    this.player.ammo = Math.min(this.player.maxAmmo, this.player.ammo + amount);
  }

  heal(amount: number): void {
    const before = this.player.hp;
    this.player.hp = Math.min(this.player.maxHp, before + amount);
    if (this.player.hp > before) {
      this.fx.push({ kind: 'heal', target: 'player', amount: this.player.hp - before });
    }
  }

  applyToEnemy(enemy: Enemy, status: 'vulnerable' | 'weak', amount: number): void {
    if (enemy.hp <= 0) return;
    enemy.statuses[status] += amount;
    this.fx.push({
      kind: 'text',
      target: enemy.uid,
      text: status === 'weak' ? 'WEAK' : 'VULNERABLE',
      tone: 'info',
    });
  }

  applyToAll(status: 'vulnerable' | 'weak', amount: number): void {
    for (const enemy of this.aliveEnemies) this.applyToEnemy(enemy, status, amount);
  }

  stun(enemy: Enemy): void {
    if (enemy.hp <= 0) return;
    enemy.stunned = true;
    this.fx.push({ kind: 'text', target: enemy.uid, text: 'STUNNED', tone: 'good' });
  }

  /** Random roll on the player's stream, for risk cards. */
  roll(chance: number): boolean {
    return this.rng.chance(chance);
  }

  rollInt(min: number, max: number): number {
    return this.rng.int(min, max);
  }

  /** Damage to the player from an enemy hit or a card's drawback. */
  damagePlayer(amount: number, ignoreBlock = false): void {
    const absorbed = ignoreBlock ? 0 : Math.min(this.player.block, amount);
    this.player.block -= absorbed;
    const lost = Math.min(this.player.hp, amount - absorbed);
    this.player.hp -= lost;
    this.fx.push(lost > 0 ? { kind: 'hit', target: 'player', amount: lost } : { kind: 'blocked', target: 'player' });
    if (this.player.hp === 0) this.status = 'lost';
  }

  draw(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.hand.length >= MAX_HAND) return;
      if (this.drawPile.length === 0) {
        if (this.discardPile.length === 0) return;
        this.drawPile = this.rng.shuffle(this.discardPile);
        this.discardPile = [];
      }
      this.hand.push(this.drawPile.pop()!);
    }
  }

  /** Plays the effect of the last card played this turn again, for free. */
  replayLast(): void {
    const last = this.lastPlayed;
    if (!last) {
      this.addLog('Nothing to repeat.');
      return;
    }
    const alive = this.aliveEnemies;
    let target: Enemy | null = null;
    if (last.def.needsTarget) {
      target = alive.find((e) => e.uid === last.targetUid) ?? (alive.length ? this.rng.pick(alive) : null);
      if (!target) return;
    }
    this.addLog(`${last.def.name} repeats.`);
    last.def.play?.(this, target);
  }

  /** Moves up to `count` random Attack cards from the discard pile into the hand. */
  recallAttacks(count: number): void {
    for (let i = 0; i < count; i++) {
      const attacks = this.discardPile.filter((c) => c.def.type === 'attack');
      if (!attacks.length || this.hand.length >= MAX_HAND) return;
      const card = this.rng.pick(attacks);
      this.discardPile.splice(this.discardPile.indexOf(card), 1);
      this.hand.push(card);
    }
  }

  /** Adds a Scar for this combat only. */
  addScar(): void {
    this.player.scars++;
    this.discardPile.push({ uid: this.nextUid++, def: SCAR });
  }

  /** Co-op: this player goes down (they left the game). */
  fall(): void {
    if (this.status !== 'playing') return;
    this.player.hp = 0;
    this.status = 'lost';
  }

  /** Co-op: the squad won, so a downed player gets back up. */
  standUp(hp: number): void {
    if (this.status === 'lost') this.player.hp = Math.max(1, hp);
    this.status = 'won';
  }

  addLog(text: string, kind: LogKind = 'info'): void {
    this.log.push({ text, kind });
  }

  checkEnd(): void {
    if (this.status !== 'playing') return;
    if (this.player.hp <= 0) {
      this.status = 'lost';
    } else if (this.aliveEnemies.length === 0) {
      this.status = 'won';
      this.addLog('Area clear.', 'good');
    }
  }

  // ---------- internals ----------

  private dealToEnemy(target: Enemy, dmg: number, crit: boolean): number {
    const absorbed = Math.min(target.block, dmg);
    target.block -= absorbed;
    const lost = Math.min(target.hp, dmg - absorbed);
    target.hp -= lost;
    const uid: FxTarget = target.uid;
    this.fx.push(lost > 0 ? { kind: 'hit', target: uid, amount: lost, crit } : { kind: 'blocked', target: uid });
    this.addLog(
      `${crit ? 'CRIT! ' : ''}${target.def.name} takes ${dmg}${absorbed ? ` (${absorbed} blocked)` : ''}.`,
      crit ? 'crit' : 'info',
    );
    if (target.hp === 0) this.addLog(`${target.def.name} is destroyed.`, 'good');
    return lost;
  }

  private startTurn(): void {
    const p = this.player;
    this.turn++;
    if (!p.retainBlock) p.block = 0;
    p.retainBlock = false;
    p.energy = p.maxEnergy;
    p.energySpent = 0;
    p.tempCrit = 0;
    p.evade = 0;
    this.lastPlayed = null;
    this.addLog(`— Turn ${this.turn} —`);
    if (p.ammoPerTurn) this.gainAmmo(p.ammoPerTurn);
    if (p.corruptionPerTurn) this.gainCorruption(p.corruptionPerTurn);
    this.gainBlock(p.drones * DRONE_BLOCK + p.scars * p.scarBlock + p.blockPerTurn);
    this.draw(HAND_SIZE + this.extraDraw);
  }

  private resolveMove(enemy: Enemy, move: Move): void {
    this.enemyActs(enemy, move, true);
    this.sufferMove(enemy, move);
  }

  /**
   * What a move does to the enemy itself. In co-op every player's combat shows it,
   * but only one of them (`apply`) changes the shared enemy.
   */
  enemyActs(enemy: Enemy, move: Move, apply: boolean): void {
    this.addLog(`${enemy.def.name} uses ${move.name}.`);
    if (move.block) {
      if (apply) enemy.block += move.block;
      this.fx.push({ kind: 'block', target: enemy.uid, amount: move.block });
    }
    if (move.strength) {
      if (apply) enemy.statuses.strength += move.strength;
      this.fx.push({ kind: 'text', target: enemy.uid, text: `+${move.strength} DMG`, tone: 'bad' });
    }
    if (move.heal) {
      const healed = Math.min(enemy.maxHp - enemy.hp, move.heal);
      if (apply) enemy.hp += healed;
      if (healed) this.fx.push({ kind: 'heal', target: enemy.uid, amount: healed });
    }
  }

  /** What a move does to this combat's player. */
  sufferMove(enemy: Enemy, move: Move): void {
    const p = this.player;
    if (move.damage) {
      for (let i = 0; i < (move.hits ?? 1); i++) {
        if (p.evade > 0 && this.rng.chance(p.evade)) {
          this.addLog('You evade the hit.', 'good');
          this.fx.push({ kind: 'miss', target: 'player' });
          continue;
        }
        const before = p.hp;
        this.damagePlayer(this.previewEnemyHit(enemy, move));
        const lost = before - p.hp;
        this.addLog(lost > 0 ? `You take ${lost} damage.` : 'You block the hit.', lost > 0 ? 'bad' : 'good');
        if (this.status === 'lost') {
          this.addLog('You are killed in action.', 'bad');
          return;
        }
      }
    }
    if (move.weak) {
      this.pending.weak += move.weak;
      this.fx.push({ kind: 'text', target: 'player', text: 'WEAK', tone: 'bad' });
    }
    if (move.vulnerable) {
      this.pending.vulnerable += move.vulnerable;
      this.fx.push({ kind: 'text', target: 'player', text: 'VULNERABLE', tone: 'bad' });
    }
    if (move.wound) {
      for (let i = 0; i < move.wound; i++) this.discardPile.push({ uid: this.nextUid++, def: STATIC });
      this.addLog(`${move.wound} Static jam${move.wound > 1 ? 's' : ''} your deck.`, 'bad');
      this.fx.push({ kind: 'text', target: 'player', text: 'STATIC', tone: 'bad' });
    }
  }
}
