import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { botRun } from '../src/engine/bot';
import { card, CARDS, rewardPool } from '../src/engine/cards';
import { CLASS_LIST, CLASSES } from '../src/engine/classes';
import { Combat } from '../src/engine/combat';
import { ACTS, ALL_ENEMIES, ALPHA, BULWARK, DRONE } from '../src/engine/enemies';
import { EVENTS } from '../src/engine/events';
import { GEAR, STIMS } from '../src/engine/items';
import { generateMap, MAP_ROWS } from '../src/engine/map';
import { Rng } from '../src/engine/rng';
import { Run } from '../src/engine/run';
import type { CardDef, EnemyDef, Move } from '../src/engine/types';

const dummy = (move: Move = { name: 'Hit', damage: 8 }): EnemyDef => ({
  id: 'dummy',
  name: 'Dummy',
  icon: 'alien-bug',
  tier: 'normal',
  hp: [100, 100],
  moves: [{ move, weight: 1 }],
});

function combatWith(ids: string[], enemies: EnemyDef[] = [dummy()], maxAmmo = 6): Combat {
  const combat = new Combat({
    deck: ids.map(card),
    hp: 50,
    maxHp: 50,
    enemies,
    seed: 42,
    playerSeed: 1,
    maxAmmo,
    critChance: 0, // keep damage numbers exact
  });
  return combat;
}

const inHand = (combat: Combat, id: string) => combat.hand.find((c) => c.def.id === id)!;
const play = (combat: Combat, id: string, target?: number) => combat.playCard(inHand(combat, id).uid, target);

describe('combat', () => {
  it('spends energy and deals damage', () => {
    const combat = combatWith(['sidearm']);
    expect(play(combat, 'sidearm')).toBe(true);
    expect(combat.enemies[0].hp).toBe(94);
    expect(combat.player.energy).toBe(2);
    expect(combat.discardPile).toHaveLength(1);
  });

  it('block absorbs enemy damage and expires next turn', () => {
    const combat = combatWith(['brace']);
    play(combat, 'brace');
    combat.endTurn();
    expect(combat.player.hp).toBe(50 - 3);
    expect(combat.player.block).toBe(0);
  });

  it('refuses cards without enough ammo', () => {
    const combat = combatWith(['autocannon']);
    combat.player.ammo = 1;
    expect(play(combat, 'autocannon')).toBe(false);
    combat.player.ammo = 2;
    expect(play(combat, 'autocannon')).toBe(true);
    expect(combat.player.ammo).toBe(0);
    expect(combat.enemies[0].hp).toBe(88);
  });

  it('vulnerable increases damage by 50%, a crit doubles it', () => {
    const combat = combatWith(['mark_target', 'sidearm', 'sidearm']);
    play(combat, 'mark_target');
    play(combat, 'sidearm');
    expect(combat.enemies[0].hp).toBe(100 - 9);
    combat.player.critChance = 1;
    play(combat, 'sidearm');
    expect(combat.enemies[0].hp).toBe(100 - 9 - 18);
  });

  it('requires a target when several enemies are alive', () => {
    const combat = combatWith(['sidearm'], [dummy(), dummy()]);
    expect(play(combat, 'sidearm')).toBe(false);
    expect(play(combat, 'sidearm', combat.enemies[1].uid)).toBe(true);
    expect(combat.enemies[1].hp).toBe(94);
  });

  it('scars cannot be played, upgraded cards are stronger', () => {
    const combat = combatWith(['scar', 'sidearm+']);
    expect(play(combat, 'scar')).toBe(false);
    play(combat, 'sidearm+');
    expect(combat.enemies[0].hp).toBe(91);
  });

  it('debuffs from enemies last through the next enemy turn', () => {
    const combat = combatWith(['brace'], [dummy({ name: 'Expose', damage: 10, vulnerable: 1 })]);
    combat.endTurn();
    expect(combat.player.hp).toBe(40);
    expect(combat.player.statuses.vulnerable).toBe(1);
    combat.endTurn(); // 10 * 1.5
    expect(combat.player.hp).toBe(25);
  });

  it('stepwise enemy phase matches endTurn', () => {
    const a = combatWith(['brace'], [dummy(), dummy()]);
    const b = combatWith(['brace'], [dummy(), dummy()]);
    a.endTurn();
    b.beginEnemyPhase();
    expect(b.phase).toBe('enemy');
    let steps = 0;
    while (b.enemyStep()) steps++;
    b.finishEnemyPhase();
    expect(steps).toBe(2);
    expect(b.player.hp).toBe(a.player.hp);
    expect(b.turn).toBe(2);
    expect(b.phase).toBe('player');
  });

  it('turrets fire at end of turn and drones give block', () => {
    const combat = combatWith(['deploy_turret', 'shield_drone'], [dummy({ name: 'Wait', block: 0 })], 0);
    play(combat, 'deploy_turret');
    play(combat, 'shield_drone');
    combat.endTurn();
    expect(combat.enemies[0].hp).toBe(97);
    expect(combat.player.block).toBe(3);
  });

  it('Déjà Vu repeats the last card and a stun skips a move', () => {
    const combat = combatWith(['service_rifle', 'deja_vu', 'fixed_point+']);
    play(combat, 'service_rifle');
    play(combat, 'deja_vu');
    expect(combat.enemies[0].hp).toBe(88);
    play(combat, 'fixed_point+');
    combat.endTurn();
    expect(combat.player.hp).toBe(50);
  });

  it('full evade avoids every hit', () => {
    const combat = combatWith(['brace']);
    combat.player.evade = 1;
    combat.endTurn();
    expect(combat.player.hp).toBe(50);
  });

  it('enemies follow the same plan for the same seed, whatever the player does', () => {
    const record = (playerSeed: number, act: boolean): string[] => {
      const combat = new Combat({
        deck: CLASSES.grunt.starter.map(card),
        hp: 9999,
        maxHp: 9999,
        enemies: [ALPHA, BULWARK, DRONE],
        seed: 1234,
        playerSeed,
      });
      for (let turn = 0; turn < 8; turn++) {
        const c = combat.hand.find((h) => h.def.id === 'brace');
        if (act && c) combat.playCard(c.uid);
        combat.endTurn();
      }
      return combat.log.map((l) => l.text).filter((t) => t.includes(' uses '));
    };
    const a = record(1, false);
    expect(a.length).toBe(24);
    expect(record(999, true)).toEqual(a);
  });
});

describe('content', () => {
  const hasIcon = (name: string) => existsSync(`public/icons/${name}.svg`);

  it('every card has an icon, and non-special cards have an upgrade', () => {
    for (const c of Object.values(CARDS) as CardDef[]) {
      expect(hasIcon(c.icon), `icon for ${c.id}: ${c.icon}`).toBe(true);
      if (c.rarity !== 'special' && !c.upgraded) expect(CARDS[c.upgradesTo!], c.id).toBeDefined();
    }
  });

  it('enemies, gear, stims, classes and events have icons', () => {
    const icons = [
      ...ALL_ENEMIES.map((e) => e.icon),
      ...GEAR.map((g) => g.icon),
      ...STIMS.map((s) => s.icon),
      ...CLASS_LIST.map((c) => c.icon),
      ...EVENTS.map((e) => e.icon),
      ...['crossed-swords', 'death-skull', 'shop', 'campfire', 'radio-tower', 'locked-chest', 'rolling-dices', 'crowned-skull'],
    ];
    for (const icon of icons) expect(hasIcon(icon), icon).toBe(true);
  });

  it('every class has a valid starter deck and a reward pool with all rarities', () => {
    for (const cls of CLASS_LIST) {
      for (const id of cls.starter) expect(CARDS[id], id).toBeDefined();
      const pool = rewardPool(cls.id);
      for (const rarity of ['common', 'uncommon', 'rare']) {
        expect(pool.filter((c) => c.rarity === rarity).length, `${cls.id} ${rarity}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('every card can be played without throwing', () => {
    for (const c of Object.values(CARDS) as CardDef[]) {
      if (c.unplayable) continue;
      const combat = new Combat({
        deck: [c, card('sidearm')],
        hp: 50,
        maxHp: 50,
        enemies: [dummy(), dummy()],
        seed: 5,
        playerSeed: 5,
        maxAmmo: 6,
      });
      combat.player.energy = 5;
      expect(combat.playCard(inHand(combat, c.id).uid, combat.enemies[0].uid), c.id).toBe(true);
      combat.endTurn();
    }
  });
});

describe('map', () => {
  it('is fully connected from the first row to the boss', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const map = generateMap(new Rng(seed));
      const reachable = new Set(map.nodes.filter((n) => n.row === 0).map((n) => n.id));
      for (const node of map.nodes) {
        if (!reachable.has(node.id)) continue;
        for (const id of node.next) {
          expect(map.nodes[id].row).toBe(node.row + 1);
          reachable.add(id);
        }
      }
      expect(reachable.size).toBe(map.nodes.length);
      for (const node of map.nodes) {
        if (node.row < MAP_ROWS - 1) expect(node.next.length).toBeGreaterThan(0);
        else expect(node.type).toBe('boss');
      }
      expect(map.nodes.some((n) => n.type === 'shop')).toBe(true);
    }
  });
});

describe('run', () => {
  const started = (seed = 7): Run => {
    const run = new Run('grunt', seed);
    run.chooseStartingGear(0);
    return run;
  };

  it('starts on the map and enters a fight from the first row', () => {
    const run = started();
    expect(run.phase).toBe('map');
    const options = run.availableNodes();
    expect(options.length).toBe(3);
    run.enterNode(options[0].id);
    expect(run.phase).toBe('combat');
  });

  it('a Reset replays the fight with a Scar and foresight', () => {
    const run = started();
    run.gear = [];
    run.enterNode(run.availableNodes()[0].id);
    const hpBefore = run.hp;
    const standAndDie = () => {
      while (run.phase === 'combat') run.endTurn();
    };
    const snapshot = () => run.combat!.enemies.map((e) => [e.maxHp, ...e.plan.map((m) => m.name)]);
    const before = snapshot();

    standAndDie();
    expect(run.phase).toBe('dead');

    run.useReset();
    expect(run.phase).toBe('combat');
    expect(run.resets).toBe(1);
    expect(run.foresight).toBe(true);
    expect(run.intentsAhead).toBe(3);
    expect(run.hp).toBe(hpBefore);
    expect(run.deck.filter((c) => c.id === 'scar')).toHaveLength(1);
    expect(snapshot()).toEqual(before);

    standAndDie();
    run.useReset();
    standAndDie();
    expect(run.phase).toBe('gameover');
  });

  it('shop, camp, event and market screens work', () => {
    const run = started();
    run.scrap = 1000;

    run.enterType('shop');
    const deckSize = run.deck.length;
    expect(run.buyCard(0)).toBe(true);
    expect(run.buyCard(0)).toBe(false);
    expect(run.buyGear(0)).toBe(true);
    expect(run.buyStim(0)).toBe(true);
    expect(run.buyRemoval(0)).toBe(true);
    expect(run.buyRemoval(0)).toBe(false);
    expect(run.deck.length).toBe(deckSize);
    expect(run.gear.length).toBe(2);
    run.leave();
    expect(run.phase).toBe('map');

    run.enterType('camp');
    run.campUpgrade(0);
    expect(run.deck[0].upgraded).toBe(true);
    run.hp = 10;
    run.enterType('camp');
    run.campRest();
    expect(run.hp).toBe(10 + Math.ceil(run.maxHp * 0.3));

    for (let i = 0; i < EVENTS.length * 2; i++) {
      run.enterType('event');
      const event = run.event!;
      const index = event.choices.findIndex((c) => !c.disabled);
      run.chooseEvent(index);
      expect(run.event!.result).toBeTruthy();
      run.leave();
      expect(run.hp).toBeGreaterThan(0);
    }

    run.enterType('market');
    run.marketCrate();
    run.marketBet();
    run.marketBlood();
    expect(run.marketLog).toHaveLength(3);
    run.leave();

    run.enterType('cache');
    expect(run.phase).toBe('reward');
    run.leaveReward();
    expect(run.phase).toBe('map');
  });

  it('the bot can finish runs with every class', () => {
    const runs = 150;
    for (const cls of CLASS_LIST) {
      let wins = 0;
      const reached = [0, 0, 0];
      for (let i = 0; i < runs; i++) {
        const run = new Run(cls.id, i * 31 + 1);
        const won = botRun(run, new Rng(i + 1));
        expect(['victory', 'gameover']).toContain(run.phase);
        if (won) wins++;
        reached[run.act]++;
      }
      console.log(
        `${cls.name.padEnd(9)} bot wins ${wins}/${runs}; died in act 1/2/3: ${reached[0]}/${reached[1]}/${reached[2] - wins}`,
      );
    }
    expect(ACTS.length).toBe(3);
  });
});
