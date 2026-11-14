import type { Combat } from './combat';
import type { Rng } from './rng';

export type ClassId = 'grunt' | 'scout' | 'engineer' | 'veteran' | 'hybrid';

/** A random modifier a card can roll when it is offered as a reward or sold in a shop. */
export interface CardMod {
  id: string;
  name: string;
  text: string;
}
export type CardType = 'attack' | 'defense' | 'tactic' | 'system' | 'scar';
export type Rarity = 'starter' | 'common' | 'uncommon' | 'rare' | 'special';
export type CardOwner = ClassId | 'neutral' | 'none';

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: Rarity;
  owner: CardOwner;
  /** Energy cost. */
  cost: number;
  /** Ammo required and spent on play (Grunt). */
  ammo?: number;
  text: string;
  /** File name (without .svg) in public/icons. */
  icon: string;
  needsTarget?: boolean;
  /** Removed from the deck for the rest of the combat after being played. */
  exhaust?: boolean;
  unplayable?: boolean;
  /** Not remembered as "the last card played" (so it cannot repeat itself). */
  noRepeat?: boolean;
  upgraded?: boolean;
  mod?: CardMod;
  /** Id of the upgraded version, if there is one. */
  upgradesTo?: string;
  play?: (combat: Combat, target: Enemy | null) => void;
}

export interface CardInstance {
  uid: number;
  def: CardDef;
}

export interface Statuses {
  /** Takes 50% more attack damage. */
  vulnerable: number;
  /** Deals 25% less attack damage. */
  weak: number;
  /** Flat bonus damage per hit. */
  strength: number;
}

export interface Move {
  name: string;
  damage?: number;
  hits?: number;
  block?: number;
  /** Strength the enemy gains. */
  strength?: number;
  /** HP the enemy recovers. */
  heal?: number;
  /** Weak applied to the player. */
  weak?: number;
  /** Vulnerable applied to the player. */
  vulnerable?: number;
  /** Unplayable Static cards shuffled into the player's discard pile for this combat. */
  wound?: number;
}

export type EnemyTier = 'normal' | 'elite' | 'boss';

export interface EnemyDef {
  id: string;
  name: string;
  icon: string;
  tier: EnemyTier;
  hp: [min: number, max: number];
  moves: { move: Move; weight: number }[];
}

export interface Enemy {
  uid: number;
  def: EnemyDef;
  hp: number;
  maxHp: number;
  block: number;
  statuses: Statuses;
  /** Upcoming moves, soonest first. Always planned ahead so foresight is truthful. */
  plan: Move[];
  rng: Rng;
  lastPlanned?: string;
  /** Skips its next move. */
  stunned: boolean;
}

export interface Player {
  hp: number;
  maxHp: number;
  block: number;
  energy: number;
  maxEnergy: number;
  energySpent: number;
  ammo: number;
  maxAmmo: number;
  ammoPerTurn: number;
  /** 0..1 */
  critChance: number;
  /** Extra crit chance until the end of this turn. */
  tempCrit: number;
  /** The next attack hit is a guaranteed crit. */
  nextCrit: boolean;
  /** Chance (0..1) to avoid each enemy hit this turn. */
  evade: number;
  statuses: Statuses;
  /** Names of System cards active this combat. */
  systems: string[];
  /** Engineer: each turret shoots a random enemy at the end of your turn. */
  turrets: number;
  turretDamage: number;
  /** Engineer: each shield drone gives Block at the start of your turn. */
  drones: number;
  /** HP recovered at the end of each of your turns. */
  regen: number;
  critBlock: number;
  critDraw: number;
  /** Block is kept at the start of the next turn. */
  retainBlock: boolean;
  /** Scars in the deck (Veteran cards scale with this). */
  scars: number;
  /** Block gained per Scar at the start of each turn. */
  scarBlock: number;
  blockPerTurn: number;
  /** Hybrid: every 2 Corruption adds 1 damage per hit; every 3 costs 1 HP at the end of your turn. Max 10. */
  corruption: number;
  corruptionPerTurn: number;
  /** Multiplies the damage bonus from Corruption. */
  corruptionMult: number;
  /** HP of Corruption burn ignored each turn. */
  burnResist: number;
}

export type FxTarget = number | 'player';

/** Things the UI animates. The engine only records them. */
export type Fx =
  | { kind: 'hit'; target: FxTarget; amount: number; crit?: boolean }
  | { kind: 'blocked'; target: FxTarget }
  | { kind: 'miss'; target: FxTarget }
  | { kind: 'block'; target: FxTarget; amount: number }
  | { kind: 'heal'; target: FxTarget; amount: number }
  | { kind: 'text'; target: FxTarget; text: string; tone: 'good' | 'bad' | 'info' };

export type LogKind = 'info' | 'good' | 'bad' | 'crit';

export interface LogEntry {
  text: string;
  kind: LogKind;
}
