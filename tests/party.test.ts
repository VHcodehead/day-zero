import { describe, expect, it } from 'vitest';
import { botParty } from '../src/engine/bot';
import { isAction, Party, REVIVE_SHARE, type Member } from '../src/engine/party';
import { Rng } from '../src/engine/rng';

const squad = (...classes: Member['classId'][]): Member[] =>
  classes.map((classId, i) => ({ name: `P${i + 1}`, classId }));

/** Gets a fresh squad past the gear screen and into its first fight. */
function intoFight(members: Member[], seed = 7): Party {
  const party = new Party(members, seed);
  members.forEach((_, i) => party.apply(i, { k: 'gear', i: 0 }));
  const node = party.runs[0].availableNodes().find((n) => n.type === 'skirmish')!;
  expect(party.apply(members.length - 1, { k: 'node', id: node.id })).toBe(true);
  return party;
}

describe('co-op party', () => {
  it('gives every player the same map and waits for everyone before travelling', () => {
    const party = new Party(squad('grunt', 'scout'), 42);
    expect(party.runs[0].map).toEqual(party.runs[1].map);
    expect(party.canTravel).toBe(false);
    party.apply(0, { k: 'gear', i: 0 });
    expect(party.canTravel).toBe(false);
    expect(party.waitingOn).toEqual([1]);
    expect(party.apply(0, { k: 'node', id: party.runs[0].map.nodes[0].id })).toBe(false);
    party.apply(1, { k: 'gear', i: 1 });
    expect(party.canTravel).toBe(true);
  });

  it('shares one set of enemies with HP scaled to the squad size', () => {
    const duo = intoFight(squad('grunt', 'scout'), 7);
    const [a, b] = duo.runs.map((r) => r.combat!);
    expect(a.enemies).toBe(b.enemies);
    expect(a.hand).not.toBe(b.hand);

    const one = new Party(squad('grunt'), 7);
    one.apply(0, { k: 'gear', i: 0 });
    one.apply(0, { k: 'node', id: duo.runs[0].nodeId! });
    const hp1 = one.runs[0].combat!.enemies.map((e) => e.maxHp);
    const hp2 = a.enemies.map((e) => e.maxHp);
    expect(hp2.length).toBe(hp1.length);
    hp2.forEach((hp, i) => expect(hp).toBe(hp1[i] * 2));
  });

  it('lets one player hurt the enemy the other is looking at', () => {
    const party = intoFight(squad('grunt', 'scout'));
    const [a, b] = party.runs.map((r) => r.combat!);
    const attack = a.hand.find((c) => c.def.type === 'attack' && a.canPlay(c))!;
    const target = a.aliveEnemies[0];
    const before = target.hp + target.block;
    expect(party.apply(0, { k: 'card', uid: attack.uid, target: target.uid })).toBe(true);
    expect(b.enemies[0].hp + b.enemies[0].block).toBeLessThan(before);
    expect(b.log.some((l) => l.text.startsWith('P1 plays'))).toBe(true);
    expect(b.fx.some((f) => f.target === target.uid)).toBe(true);
  });

  it('makes enemies act only once everyone has ended their turn', () => {
    const party = intoFight(squad('grunt', 'scout'));
    const [a, b] = party.runs.map((r) => r.combat!);
    const plan = a.enemies.map((e) => e.plan[0].name);
    party.apply(0, { k: 'end' });
    expect(a.phase).toBe('enemy');
    expect(a.turn).toBe(1);
    expect(party.waitingOn).toEqual([1]);
    expect(a.enemies.map((e) => e.plan[0].name)).toEqual(plan);
    party.apply(1, { k: 'end' });
    expect(a.turn).toBe(2);
    expect(b.turn).toBe(2);
    expect(a.phase).toBe('player');
    const uses = (c: typeof a): number => c.log.filter((l) => l.text.includes(' uses ')).length;
    expect(uses(a)).toBeGreaterThan(0);
    expect(uses(a)).toBe(uses(b));
  });

  it('keeps a downed player out, then stands them up when the squad wins', () => {
    const party = intoFight(squad('grunt', 'scout'));
    const [a, b] = party.runs.map((r) => r.combat!);
    a.damagePlayer(999, true);
    b.gainBlock(999);
    party.apply(1, { k: 'end' });
    expect(party.runs[0].phase).toBe('combat');
    expect(party.standing).toEqual([1]);
    expect(b.turn).toBe(2);
    for (const e of b.enemies) e.hp = 0;
    party.apply(1, { k: 'end' });
    expect(party.runs.map((r) => r.phase)).toEqual(['reward', 'reward']);
    expect(party.runs[0].hp).toBe(Math.ceil(party.runs[0].maxHp * REVIVE_SHARE));
  });

  it('spends one shared Reset when the whole squad is down', () => {
    const party = intoFight(squad('grunt', 'scout'));
    const pool = party.resets;
    const hp = party.runs.map((r) => r.hp);
    party.runs[0].combat!.damagePlayer(999, true);
    party.runs[1].combat!.damagePlayer(999, true);
    party.apply(0, { k: 'end' });
    expect(party.runs.map((r) => r.phase)).toEqual(['dead', 'dead']);
    expect(party.apply(1, { k: 'reset' })).toBe(true);
    expect(party.runs.map((r) => r.phase)).toEqual(['combat', 'combat']);
    expect(party.runs.map((r) => r.resets)).toEqual([pool - 1, pool - 1]);
    expect(party.runs.map((r) => r.combat!.player.hp)).toEqual(hp);
    expect(party.runs[0].combat!.enemies).toBe(party.runs[1].combat!.enemies);
    expect(party.runs[0].foresight).toBe(true);
  });

  it('carries on without a player who leaves', () => {
    const party = intoFight(squad('grunt', 'scout', 'engineer'));
    party.apply(0, { k: 'end' });
    party.apply(2, { k: 'drop' });
    expect(party.waitingOn).toEqual([1]);
    party.runs[0].combat!.gainBlock(999);
    party.runs[1].combat!.gainBlock(999);
    party.apply(1, { k: 'end' });
    expect(party.runs[1].combat!.turn).toBe(2);
    expect(party.apply(2, { k: 'end' })).toBe(false);
  });

  it('plays whole runs with bots, and a second copy fed the same actions ends up identical', () => {
    const cases: [number, Member[]][] = [
      [11, squad('grunt', 'scout')],
      [12, squad('engineer', 'veteran', 'hybrid')],
      [13, squad('scout', 'scout', 'grunt', 'engineer')],
    ];
    for (const [seed, members] of cases) {
      const host = new Party(members, seed);
      const actions = botParty(host, new Rng(seed));
      expect(host.over).toBe(true);
      const guest = new Party(members, seed);
      for (const { player, action } of actions) guest.apply(player, action);
      expect(guest.hash()).toBe(host.hash());
      const view = (p: Party): unknown => p.runs.map((r) => [r.phase, r.hp, r.scrap, r.deck.map((c) => c.id)]);
      expect(view(guest)).toEqual(view(host));
    }
  });

  it('rejects malformed actions from the network', () => {
    expect(isAction({ k: 'card', uid: 3, target: 1 })).toBe(true);
    expect(isAction({ k: 'card', uid: '3' })).toBe(false);
    expect(isAction({ k: 'buy', what: 'everything', i: 0 })).toBe(false);
    expect(isAction({ k: 'node', id: -1 })).toBe(false);
    expect(isAction(null)).toBe(false);
  });
});
