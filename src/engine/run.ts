import { card, modsFor, rewardPool, SCAR, withMod } from './cards';
import { CLASSES, type ClassDef } from './classes';
import { Combat } from './combat';
import { ACTS } from './enemies';
import { EVENTS, type EventChoice, type EventDef } from './events';
import { GEAR, MAX_STIMS, STIMS, type GearDef, type StimDef } from './items';
import { generateMap, type ActMap, type MapNode, type NodeType } from './map';
import { ANOMALIES, ANOMALY_CHANCE, type AnomalyDef } from './modifiers';
import { Rng } from './rng';
import type { CardDef, ClassId, Enemy, EnemyDef, Rarity } from './types';

export type RunPhase =
  /** Choosing starting gear. */
  | 'gear'
  | 'map'
  | 'combat'
  | 'reward'
  | 'shop'
  | 'camp'
  | 'event'
  | 'market'
  /** Killed, but a Reset is available. */
  | 'dead'
  /** Killed with no Resets left. */
  | 'gameover'
  | 'victory';

export interface Reward {
  title: string;
  scrap: number;
  cards: CardDef[];
  cardTaken: boolean;
  gear: GearDef | null;
  stim: StimDef | null;
  healed: number;
}

export interface ShopItem<T> {
  item: T;
  price: number;
  sold: boolean;
}

export interface Shop {
  cards: ShopItem<CardDef>[];
  gear: ShopItem<GearDef>[];
  stims: ShopItem<StimDef>[];
  removalPrice: number;
  removalUsed: boolean;
  /** A spare Reset is only sometimes in stock. */
  reset: ShopItem<null> | null;
}

export interface ActiveEvent {
  def: EventDef;
  choices: EventChoice[];
  result: string | null;
  success: boolean | null;
}

/** Shared between the runs of a co-op squad. See party.ts. */
export interface PartyLink {
  /** Players still in the game. Enemy HP is multiplied by this. */
  size: number;
  /** The enemies of the current fight, created by the first run to start it. */
  enemies: Enemy[] | null;
}

export interface RunOptions {
  /** Co-op: the squad this run belongs to, and which player it is. */
  party?: PartyLink;
  player?: number;
  /** Threat level, 0..MAX_THREAT. See modifiers.ts. */
  threat?: number;
  /** Date string (YYYY-MM-DD) when this is a daily run. */
  daily?: string;
}

/** Chance for a reward or shop card to roll a random mod. */
export const MOD_CHANCE = 0.15;
export const CAMP_HEAL = 0.3;
export const ACT_HEAL = 0.3;
export const MARKET = { cratePrice: 40, bloodCost: 8, bet: 30, betWin: 75, betChance: 0.45 };

const CARD_PRICE: Record<string, number> = { common: 45, uncommon: 70, rare: 125 };
const RARITY_WEIGHTS: Record<'normal' | 'elite' | 'boss', [Rarity, number][]> = {
  normal: [
    ['common', 60],
    ['uncommon', 32],
    ['rare', 8],
  ],
  elite: [
    ['common', 35],
    ['uncommon', 45],
    ['rare', 20],
  ],
  boss: [
    ['uncommon', 50],
    ['rare', 50],
  ],
};

/** One loop: three acts of map, fights, shops and events. */
export class Run {
  readonly cls: ClassDef;
  hp: number;
  maxHp: number;
  deck: CardDef[];
  resets: number;
  scrap = 0;
  gear: GearDef[] = [];
  stims: StimDef[] = [];

  act = 0;
  map: ActMap;
  /** Current node, or null at the start of an act. */
  nodeId: number | null = null;
  visited: number[] = [];
  nodeType: NodeType | null = null;

  phase: RunPhase = 'gear';
  combat: Combat | null = null;
  /** True when the current fight is a replay after a Reset. */
  foresight = false;
  gearChoices: GearDef[];
  reward: Reward | null = null;
  shop: Shop | null = null;
  event: ActiveEvent | null = null;
  marketLog: string[] = [];
  fightsWon = 0;
  readonly threat: number;
  readonly daily: string | null;
  /** The twist on the current fight, if any. */
  anomaly: AnomalyDef | null = null;

  readonly party: PartyLink | null;
  /** Personal luck: rewards, shops, events, shuffles. */
  private rng: Rng;
  /** The world: maps, which enemies appear, how they behave. Identical for every player of a squad. */
  private world: Rng;
  private fightSeed = 0;
  private hpAtFightStart = 0;
  private enemies: EnemyDef[] = [];
  private seenEvents: string[] = [];

  constructor(
    classId: ClassId,
    seed: number = Math.floor(Math.random() * 2 ** 32),
    options: RunOptions = {},
  ) {
    this.party = options.party ?? null;
    this.world = new Rng((seed ^ 0x5bd1e995) >>> 0);
    this.rng = new Rng(seed + (options.player ?? 0) * 7919);
    this.cls = CLASSES[classId];
    this.hp = this.maxHp = this.cls.maxHp;
    this.threat = options.threat ?? 0;
    this.daily = options.daily ?? null;
    this.resets = Math.max(0, this.cls.resets - (this.threat >= 2 ? 1 : 0));
    this.deck = this.cls.starter.map(card);
    if (this.threat >= 5) this.deck.push(SCAR);
    if (this.threat >= 6) this.hp = this.maxHp = this.maxHp - 10;
    this.map = generateMap(this.world);
    this.gearChoices = this.rng.shuffle([...GEAR]).slice(0, 3);
  }

  // ---------- queries ----------

  get actName(): string {
    return ACTS[this.act].name;
  }

  /** Share of max HP a camp rest heals. */
  get campHeal(): number {
    return this.threat >= 4 ? 0.2 : CAMP_HEAL;
  }

  /** Used to compare daily runs. */
  get score(): number {
    const progress = this.fightsWon * 10 + this.act * 50;
    return this.phase === 'victory' ? progress + 500 + this.hp + this.resets * 25 : progress;
  }

  hasGear(id: string): boolean {
    return this.gear.some((g) => g.id === id);
  }

  /** How many upcoming enemy moves the player may see. */
  get intentsAhead(): number {
    if (this.foresight) return 3;
    return Math.min(3, this.cls.intentsAhead + (this.hasGear('visor') ? 1 : 0));
  }

  /** A success chance after gear bonuses, as shown to the player. */
  odds(chance: number): number {
    return Math.min(0.95, chance + (this.hasGear('lucky_coin') ? 0.15 : 0));
  }

  availableNodes(): MapNode[] {
    if (this.phase !== 'map') return [];
    if (this.nodeId === null) return this.map.nodes.filter((n) => n.row === 0);
    const here = this.map.nodes[this.nodeId];
    return here.next.map((id) => this.map.nodes[id]);
  }

  // ---------- setup ----------

  chooseStartingGear(index: number): void {
    if (this.phase !== 'gear') return;
    const gear = this.gearChoices[index];
    if (!gear) return;
    this.addGear(gear);
    this.phase = 'map';
  }

  // ---------- map ----------

  enterNode(id: number): void {
    const node = this.availableNodes().find((n) => n.id === id);
    if (!node) return;
    this.nodeId = node.id;
    this.visited.push(node.id);
    this.enterType(node.type, node.row);
  }

  /** Starts the content of a node type. Public so tests and dev tools can jump straight to a screen. */
  enterType(type: NodeType, row = 3): void {
    const act = ACTS[this.act];
    this.nodeType = type;
    switch (type) {
      case 'skirmish':
        return this.startFight(this.world.pick(row < 2 || this.world.chance(0.2) ? act.easy : act.hard));
      case 'elite':
        return this.startFight(this.world.pick(act.elites));
      case 'boss':
        return this.startFight(act.boss);
      case 'shop':
        this.shop = this.buildShop();
        this.phase = 'shop';
        return;
      case 'camp':
        this.phase = 'camp';
        return;
      case 'market':
        this.marketLog = [];
        this.phase = 'market';
        return;
      case 'cache': {
        const scrap = this.rng.int(15, 25);
        this.scrap += scrap;
        this.reward = {
          title: 'SUPPLY CACHE',
          scrap,
          cards: [],
          cardTaken: true,
          gear: this.gainRandomGear(),
          stim: null,
          healed: 0,
        };
        this.phase = 'reward';
        return;
      }
      case 'event': {
        let pool = EVENTS.filter((e) => !this.seenEvents.includes(e.id));
        if (!pool.length) {
          this.seenEvents = [];
          pool = EVENTS;
        }
        const def = this.rng.pick(pool);
        this.seenEvents.push(def.id);
        this.event = { def, choices: def.choices(this), result: null, success: null };
        this.phase = 'event';
        return;
      }
    }
  }

  /** Back to the map after a shop, camp, event or market. */
  leave(): void {
    if (!['shop', 'camp', 'event', 'market'].includes(this.phase)) return;
    this.shop = null;
    this.event = null;
    this.phase = 'map';
  }

  // ---------- combat ----------

  playCard(cardUid: number, targetUid?: number): boolean {
    if (this.phase !== 'combat' || !this.combat) return false;
    const played = this.combat.playCard(cardUid, targetUid);
    this.sync();
    return played;
  }

  endTurn(): void {
    if (this.phase !== 'combat' || !this.combat) return;
    this.combat.endTurn();
    this.sync();
  }

  beginEnemyPhase(): void {
    if (this.phase !== 'combat' || !this.combat) return;
    this.combat.beginEnemyPhase();
    this.sync();
  }

  enemyStep(): Enemy | null {
    if (this.phase !== 'combat' || !this.combat) return null;
    const acted = this.combat.enemyStep();
    this.sync();
    return acted;
  }

  finishEnemyPhase(): void {
    if (this.phase !== 'combat' || !this.combat) return;
    this.combat.finishEnemyPhase();
    this.sync();
  }

  useStim(index: number): boolean {
    const combat = this.combat;
    const stim = this.stims[index];
    if (this.phase !== 'combat' || !combat || !stim) return false;
    if (combat.status !== 'playing' || combat.phase !== 'player') return false;
    this.stims.splice(index, 1);
    combat.addLog(`You use ${stim.name}.`);
    stim.use(combat);
    combat.checkEnd();
    this.sync();
    return true;
  }

  /** Spend a Reset: replay the same fight, against the same enemy plan, with a Scar in the deck. */
  useReset(): void {
    if (this.phase !== 'dead') return;
    this.resets--;
    if (!this.hasGear('loop_anchor')) this.deck.push(SCAR);
    this.hp = this.hpAtFightStart;
    this.foresight = true;
    this.startCombat();
  }

  // ---------- reward ----------

  takeRewardCard(index: number): void {
    const reward = this.reward;
    if (this.phase !== 'reward' || !reward || reward.cardTaken) return;
    const choice = reward.cards[index];
    if (!choice) return;
    this.deck.push(choice);
    reward.cardTaken = true;
  }

  leaveReward(): void {
    if (this.phase !== 'reward') return;
    this.reward = null;
    if (this.nodeType === 'boss') this.nextAct();
    this.phase = 'map';
  }

  // ---------- shop ----------

  buyCard(index: number): boolean {
    const entry = this.shop?.cards[index];
    if (!this.pay(entry)) return false;
    this.deck.push(entry!.item);
    return true;
  }

  buyGear(index: number): boolean {
    const entry = this.shop?.gear[index];
    if (!this.pay(entry)) return false;
    this.addGear(entry!.item);
    return true;
  }

  buyStim(index: number): boolean {
    const entry = this.shop?.stims[index];
    if (this.stims.length >= MAX_STIMS || !this.pay(entry)) return false;
    this.stims.push(entry!.item);
    return true;
  }

  buyReset(): boolean {
    if (!this.pay(this.shop?.reset)) return false;
    this.resets++;
    return true;
  }

  /** Pays to remove the card at this deck index. */
  buyRemoval(deckIndex: number): boolean {
    const shop = this.shop;
    if (this.phase !== 'shop' || !shop || shop.removalUsed) return false;
    if (this.scrap < shop.removalPrice || !this.deck[deckIndex]) return false;
    this.scrap -= shop.removalPrice;
    this.deck.splice(deckIndex, 1);
    shop.removalUsed = true;
    return true;
  }

  // ---------- camp ----------

  campRest(): void {
    if (this.phase !== 'camp') return;
    this.heal(Math.ceil(this.maxHp * this.campHeal));
    this.phase = 'map';
  }

  campUpgrade(deckIndex: number): boolean {
    if (this.phase !== 'camp' || !this.upgradeAt(deckIndex)) return false;
    this.phase = 'map';
    return true;
  }

  // ---------- event ----------

  chooseEvent(index: number): void {
    const event = this.event;
    if (this.phase !== 'event' || !event || event.result !== null) return;
    const choice = event.choices[index];
    if (!choice || choice.disabled) return;
    const success = choice.chance === undefined ? true : this.rng.chance(this.odds(choice.chance));
    event.success = choice.chance === undefined ? null : success;
    event.result = choice.resolve(this, success);
  }

  // ---------- black market ----------

  marketCrate(): void {
    if (this.phase !== 'market' || this.scrap < MARKET.cratePrice) return;
    this.scrap -= MARKET.cratePrice;
    const r = this.rng.next();
    let text: string;
    if (r < 0.25) {
      const gear = this.gainRandomGear();
      text = gear ? `Gear: ${gear.name}.` : `A rare card: ${this.addRandomCard('rare').name}.`;
    } else if (r < 0.55) {
      text = `A rare card: ${this.addRandomCard('rare').name}.`;
    } else if (r < 0.8) {
      const stim = this.gainRandomStim();
      text = stim ? `A stim: ${stim.name}.` : 'A stim, but your pouches are full. Wasted.';
    } else {
      this.addScar();
      text = 'Junk. Something in it bites you. A Scar is added to your deck.';
    }
    this.marketLog.push(`Mystery crate: ${text}`);
  }

  marketBlood(): void {
    if (this.phase !== 'market' || this.hp <= MARKET.bloodCost) return;
    this.hp -= MARKET.bloodCost;
    const pool = rewardPool(this.cls.id).filter((c) => c.rarity === 'uncommon');
    const got = card(this.rng.pick(pool).upgradesTo!);
    this.deck.push(got);
    this.marketLog.push(`Blood deal: you lose ${MARKET.bloodCost} HP and receive ${got.name}.`);
  }

  marketBet(): void {
    if (this.phase !== 'market' || this.scrap < MARKET.bet) return;
    this.scrap -= MARKET.bet;
    if (this.rng.chance(this.odds(MARKET.betChance))) {
      this.scrap += MARKET.betWin;
      this.marketLog.push(`Dice: you win ${MARKET.betWin} Scrap.`);
    } else {
      this.marketLog.push(`Dice: you lose ${MARKET.bet} Scrap.`);
    }
  }

  // ---------- helpers used by events ----------

  gainScrap(amount: number): void {
    this.scrap += amount;
  }

  /** Out-of-combat damage never kills: it leaves you at 1 HP. */
  loseHp(amount: number): void {
    this.hp = Math.max(1, this.hp - amount);
  }

  heal(amount: number): number {
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return this.hp - before;
  }

  addScar(): void {
    this.deck.push(SCAR);
  }

  removeScar(): boolean {
    const i = this.deck.findIndex((c) => c.type === 'scar');
    if (i < 0) return false;
    this.deck.splice(i, 1);
    return true;
  }

  addRandomCard(rarity: Rarity): CardDef {
    const got = this.rng.pick(rewardPool(this.cls.id).filter((c) => c.rarity === rarity));
    this.deck.push(got);
    return got;
  }

  gainRandomGear(): GearDef | null {
    const pool = GEAR.filter((g) => !this.hasGear(g.id));
    if (!pool.length) return null;
    const gear = this.rng.pick(pool);
    this.addGear(gear);
    return gear;
  }

  gainRandomStim(): StimDef | null {
    if (this.stims.length >= MAX_STIMS) return null;
    const stim = this.rng.pick(STIMS);
    this.stims.push(stim);
    return stim;
  }

  /** Returns the upgraded card, or null if nothing can be upgraded. */
  upgradeRandomCard(): CardDef | null {
    const options = this.deck.map((c, i) => (c.upgradesTo ? i : -1)).filter((i) => i >= 0);
    if (!options.length) return null;
    const index = this.rng.pick(options);
    this.upgradeAt(index);
    return this.deck[index];
  }

  // ---------- internals ----------

  private upgradeAt(deckIndex: number): boolean {
    const current = this.deck[deckIndex];
    if (!current?.upgradesTo) return false;
    this.deck[deckIndex] = card(current.upgradesTo);
    return true;
  }

  private addGear(gear: GearDef): void {
    this.gear.push(gear);
    gear.onPickup?.(this);
  }

  private pay(entry: ShopItem<unknown> | null | undefined): boolean {
    if (this.phase !== 'shop' || !entry || entry.sold || this.scrap < entry.price) return false;
    this.scrap -= entry.price;
    entry.sold = true;
    return true;
  }

  private startFight(enemies: EnemyDef[]): void {
    this.anomaly =
      this.nodeType !== 'boss' && this.world.chance(ANOMALY_CHANCE) ? this.world.pick(ANOMALIES) : null;
    this.enemies =
      this.anomaly?.id === 'reinforcements' ? [...enemies, ACTS[this.act].reinforcement] : enemies;
    this.fightSeed = this.world.int(1, 2 ** 31 - 1);
    this.hpAtFightStart = this.hp;
    this.foresight = false;
    this.startCombat();
  }

  private startCombat(): void {
    this.combat = new Combat({
      deck: this.deck,
      hp: this.hp,
      maxHp: this.maxHp,
      enemies: this.enemies,
      sharedEnemies: this.party?.enemies ?? undefined,
      seed: this.fightSeed,
      maxAmmo: this.cls.maxAmmo,
      critChance: this.cls.critChance,
      playerSeed: this.rng.int(1, 2 ** 31 - 1),
      enemyHpMult: (def) =>
        (this.party?.size ?? 1) *
        (this.threat >= 1 ? 1.1 : 1) *
        (this.threat >= 8 && def.tier !== 'normal' ? 1.2 : 1),
      onStart: (combat) => {
        for (const gear of this.gear) gear.onCombatStart?.(combat);
        this.anomaly?.onStart?.(combat);
        // Shared enemies already got these from the player who created them.
        for (const enemy of combat.ownsEnemies ? combat.enemies : []) {
          if (this.threat >= 3) enemy.statuses.strength += 1;
          if (this.threat >= 8 && enemy.def.tier !== 'normal') enemy.statuses.strength += 1;
        }
      },
    });
    if (this.party) this.party.enemies = this.combat.enemies;
    this.phase = 'combat';
  }

  /** In co-op the squad decides when a fight is over (party.ts), not each player's own combat. */
  private sync(): void {
    if (!this.party) this.resolveCombat();
  }

  /** Moves on from a fight that has been won or lost. */
  resolveCombat(): void {
    const combat = this.combat;
    if (!combat || this.phase !== 'combat') return;
    if (combat.status === 'won') {
      this.hp = combat.player.hp;
      this.fightsWon++;
      if (this.nodeType === 'boss' && this.act === ACTS.length - 1) {
        this.phase = 'victory';
        return;
      }
      this.reward = this.buildReward();
      this.phase = 'reward';
    } else if (combat.status === 'lost') {
      this.hp = 0;
      this.phase = this.resets > 0 ? 'dead' : 'gameover';
    }
  }

  private nextAct(): void {
    this.act++;
    this.heal(Math.ceil(this.maxHp * ACT_HEAL));
    this.map = generateMap(this.world);
    this.nodeId = null;
    this.visited = [];
  }

  private buildReward(): Reward {
    const tier = this.nodeType === 'boss' ? 'boss' : this.nodeType === 'elite' ? 'elite' : 'normal';
    const base = tier === 'boss' ? 60 : tier === 'elite' ? this.rng.int(30, 42) : this.rng.int(14, 22);
    const scrap = Math.round(
      base * (this.hasGear('magnet') ? 1.5 : 1) * (this.anomaly?.id === 'bounty' ? 2 : 1),
    );
    this.scrap += scrap;
    const healed = this.hasGear('rations') ? this.heal(5) : 0;
    return {
      title: tier === 'boss' ? 'BOSS DESTROYED' : tier === 'elite' ? 'ALPHA DOWN' : 'AREA CLEAR',
      scrap,
      cards: this.rollCards(this.threat >= 7 ? 2 : 3, RARITY_WEIGHTS[tier]),
      cardTaken: false,
      gear: tier === 'normal' ? null : this.gainRandomGear(),
      stim: this.rng.chance(0.35) ? this.gainRandomStim() : null,
      healed,
    };
  }

  private rollCards(count: number, weights: [Rarity, number][]): CardDef[] {
    const pool = rewardPool(this.cls.id);
    const choices: CardDef[] = [];
    const taken = new Set<string>();
    const total = weights.reduce((sum, [, w]) => sum + w, 0);
    for (let guard = 0; choices.length < count && guard < 200; guard++) {
      let r = this.rng.next() * total;
      let rarity = weights[0][0];
      for (const [name, weight] of weights) {
        r -= weight;
        if (r < 0) {
          rarity = name;
          break;
        }
      }
      const options = pool.filter((c) => c.rarity === rarity && !taken.has(c.id));
      if (!options.length) continue;
      const picked = this.rng.pick(options);
      taken.add(picked.id);
      const mods = modsFor(picked);
      choices.push(mods.length && this.rng.chance(MOD_CHANCE) ? withMod(picked, this.rng.pick(mods)) : picked);
    }
    return choices;
  }

  private buildShop(): Shop {
    const price = (base: number): number => Math.round(base * (0.9 + this.rng.next() * 0.2) * (this.threat >= 4 ? 1.15 : 1));
    const gearPool = this.rng.shuffle(GEAR.filter((g) => !this.hasGear(g.id)));
    return {
      cards: this.rollCards(5, [
        ['common', 45],
        ['uncommon', 40],
        ['rare', 15],
      ]).map((item) => ({ item, price: price(CARD_PRICE[item.rarity]), sold: false })),
      gear: gearPool.slice(0, 2).map((item) => ({ item, price: price(140), sold: false })),
      stims: this.rng
        .shuffle([...STIMS])
        .slice(0, 2)
        .map((item) => ({ item, price: price(40), sold: false })),
      removalPrice: 75,
      removalUsed: false,
      reset: this.rng.chance(0.5) ? { item: null, price: price(180), sold: false } : null,
    };
  }
}
