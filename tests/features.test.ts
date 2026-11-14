import { describe, expect, it } from 'vitest';
import { botRun } from '../src/engine/bot';
import { card, CARDS, MODS, modsFor, withMod } from '../src/engine/cards';
import { Combat } from '../src/engine/combat';
import { ACTS } from '../src/engine/enemies';
import { ANOMALIES, MAX_THREAT } from '../src/engine/modifiers';
import { Rng } from '../src/engine/rng';
import { Run } from '../src/engine/run';
import type { CardDef, EnemyDef } from '../src/engine/types';

const dummy: EnemyDef = {
  id: 'dummy',
  name: 'Dummy',
  icon: 'alien-bug',
  tier: 'normal',
  hp: [100, 100],
  moves: [{ move: { name: 'Wait', block: 0 }, weight: 1 }],
};

function combatWith(deck: CardDef[], extra: Partial<ConstructorParameters<typeof Combat>[0]> = {}): Combat {
  return new Combat({
    deck,
    hp: 50,
    maxHp: 50,
    enemies: [dummy],
    seed: 42,
    playerSeed: 1,
    critChance: 0,
    ...extra,
  });
}

const play = (combat: Combat, id: string) => combat.playCard(combat.hand.find((c) => c.def.id === id)!.uid);

describe('hybrid corruption', () => {
  it('adds damage per hit and burns HP at the end of the turn', () => {
    const combat = combatWith([card('claw'), card('mutate+')]);
    play(combat, 'mutate+'); // 3 Corruption
    combat.gainCorruption(3); // 6
    expect(combat.corruptionBonus).toBe(3);
    expect(combat.corruptionBurn).toBe(2);
    play(combat, 'claw');
    expect(combat.enemies[0].hp).toBe(100 - 9);
    combat.endTurn();
    expect(combat.player.hp).toBe(48);
  });

  it('caps at 10 and can be purged for block', () => {
    const combat = combatWith([card('purge')]);
    combat.gainCorruption(99);
    expect(combat.player.corruption).toBe(10);
    play(combat, 'purge');
    expect(combat.player.corruption).toBe(0);
    expect(combat.player.block).toBe(30);
  });
});

describe('card mods', () => {
  it('every mod applies to some card and changes it as described', () => {
    for (const mod of MODS) {
      expect(Object.values(CARDS).some((c) => modsFor(c).includes(mod.id)), mod.id).toBe(true);
    }
    expect(withMod(card('sidearm'), 'lightweight').cost).toBe(0);
    expect(modsFor(card('brace'))).not.toContain('charged');
    expect(modsFor(card('scar'))).toEqual([]);

    const charged = withMod(card('sidearm'), 'charged');
    const reinforced = withMod(card('sidearm'), 'reinforced');
    const combat = combatWith([charged, reinforced]);
    play(combat, charged.id);
    expect(combat.enemies[0].hp).toBe(92);
    expect(combat.player.statuses.strength).toBe(0);
    play(combat, reinforced.id);
    expect(combat.enemies[0].hp).toBe(86);
    expect(combat.player.block).toBe(3);
  });

  it('a mod survives an upgrade', () => {
    const modded = withMod(card('sidearm'), 'charged');
    const upgraded = card(modded.upgradesTo!);
    expect(upgraded.upgraded).toBe(true);
    expect(upgraded.mod?.id).toBe('charged');
    const combat = combatWith([upgraded]);
    play(combat, upgraded.id);
    expect(combat.enemies[0].hp).toBe(100 - 11);
  });
});

describe('anomalies', () => {
  it('every anomaly starts without errors', () => {
    for (const anomaly of ANOMALIES) {
      const combat = combatWith([card('sidearm')], { onStart: (c) => anomaly.onStart?.(c) });
      combat.endTurn();
      expect(combat.status, anomaly.id).toBe('playing');
    }
  });

  it('the airstrike lands at the end of turn 3 and a supply drop draws extra', () => {
    const find = (id: string) => ANOMALIES.find((a) => a.id === id)!;
    const strike = combatWith([card('brace')], { onStart: (c) => find('airstrike').onStart!(c) });
    strike.endTurn();
    strike.endTurn();
    expect(strike.enemies[0].hp).toBe(100);
    strike.endTurn();
    expect(strike.enemies[0].hp).toBe(85);

    const deck = Array<CardDef>(12).fill(card('brace'));
    const drop = combatWith(deck, { onStart: (c) => find('supply_drop').onStart!(c) });
    expect(drop.hand).toHaveLength(6);
    drop.endTurn();
    expect(drop.hand).toHaveLength(6);
  });

  it('reinforcements add an enemy, and a Reset keeps the same anomaly', () => {
    let seen = false;
    for (let seed = 1; seed < 400 && !seen; seed++) {
      const run = new Run('grunt', seed);
      run.chooseStartingGear(0);
      run.gear = [];
      run.enterType('skirmish', 0);
      if (run.anomaly?.id !== 'reinforcements') continue;
      seen = true;
      const names = run.combat!.enemies.map((e) => e.def.id);
      expect(names[names.length - 1]).toBe(ACTS[0].reinforcement.id);
      while (run.phase === 'combat') run.endTurn();
      run.useReset();
      expect(run.anomaly?.id).toBe('reinforcements');
      expect(run.combat!.enemies.map((e) => e.def.id)).toEqual(names);
    }
    expect(seen).toBe(true);
  });
});

describe('threat levels and daily runs', () => {
  it('max threat applies its handicaps', () => {
    const base = new Run('grunt', 3);
    const hard = new Run('grunt', 3, { threat: MAX_THREAT });
    expect(hard.resets).toBe(base.resets - 1);
    expect(hard.maxHp).toBe(base.maxHp - 10);
    expect(hard.deck.filter((c) => c.id === 'scar')).toHaveLength(1);
    expect(hard.campHeal).toBeLessThan(base.campHeal);

    base.chooseStartingGear(0);
    hard.chooseStartingGear(0);
    base.enterType('boss');
    hard.enterType('boss');
    expect(hard.combat!.enemies[0].maxHp).toBe(Math.round(base.combat!.enemies[0].maxHp * 1.1 * 1.2));
    expect(hard.combat!.enemies[0].statuses.strength).toBe(2);
  });

  it('the same seed and the same choices give the same run', () => {
    const outcome = (): string => {
      const run = new Run('scout', 20261114, { daily: '2026-11-14' });
      botRun(run, new Rng(9));
      return [run.phase, run.act, run.fightsWon, run.hp, run.scrap, run.score, run.deck.map((c) => c.id).join(',')].join('|');
    };
    expect(outcome()).toBe(outcome());
  });

  it('the bot can finish runs at max threat', () => {
    for (let i = 0; i < 40; i++) {
      const run = new Run('veteran', i + 1, { threat: MAX_THREAT });
      botRun(run, new Rng(i + 1));
      expect(['victory', 'gameover']).toContain(run.phase);
    }
  });
});
