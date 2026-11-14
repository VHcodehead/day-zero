import type { Combat } from './combat';
import type { Action, Party } from './party';
import type { Rng } from './rng';
import type { Run } from './run';
import type { CardInstance } from './types';

/**
 * A simple autoplayer. It is not a good player; it exists so tests can run whole
 * runs end to end, and so balance changes can be compared with a rough win rate.
 */

function score(card: CardInstance, need: number): number {
  const d = card.def;
  switch (d.type) {
    case 'system':
      return 60;
    case 'tactic':
      return d.cost === 0 ? 55 : 22;
    case 'defense':
      return need > 0 ? 40 : -1;
    case 'attack':
      return 25 + (d.cost === 0 ? 10 : 0);
    default:
      return -1;
  }
}

/** Plays cards for the current turn. Does not end the turn. */
export function botPlayTurn(run: Run): void {
  for (let plays = 0; plays < 40 && run.phase === 'combat'; plays++) {
    const combat = run.combat as Combat;
    const need = combat.totalIncoming - combat.player.block;

    if (run.stims.length && (combat.player.hp < combat.player.maxHp * 0.4 || need > combat.player.hp * 0.5)) {
      run.useStim(0);
      continue;
    }

    let best: CardInstance | null = null;
    let bestScore = 0;
    for (const card of combat.hand) {
      if (!combat.canPlay(card)) continue;
      const s = score(card, need);
      if (s > bestScore) {
        best = card;
        bestScore = s;
      }
    }
    if (!best) return;
    const target = [...combat.aliveEnemies].sort((a, b) => a.hp + a.block - (b.hp + b.block))[0];
    if (!run.playCard(best.uid, target?.uid)) return;
  }
}

const RARITY_VALUE: Record<string, number> = { common: 1, uncommon: 2, rare: 3 };

/** Makes one decision in whatever phase the run is in. Returns false when the run is over. */
export function botStep(run: Run, rng: Rng): boolean {
  switch (run.phase) {
    case 'gear':
      run.chooseStartingGear(0);
      return true;
    case 'map': {
      const options = run.availableNodes();
      const hurt = run.hp < run.maxHp * 0.5;
      const want = (type: string): number => {
        if (type === 'camp') return hurt ? 10 : 4;
        if (type === 'elite') return hurt ? 0 : 5;
        if (type === 'shop') return run.scrap >= 100 ? 8 : 2;
        if (type === 'cache') return 7;
        if (type === 'event') return 5;
        if (type === 'market') return 1;
        return 4;
      };
      const best = Math.max(...options.map((n) => want(n.type)));
      run.enterNode(rng.pick(options.filter((n) => want(n.type) === best)).id);
      return true;
    }
    case 'combat':
      botPlayTurn(run);
      if (run.phase === 'combat') run.endTurn();
      return true;
    case 'reward': {
      const reward = run.reward!;
      if (!reward.cardTaken && run.deck.length < 24) {
        let best = 0;
        reward.cards.forEach((c, i) => {
          if (RARITY_VALUE[c.rarity] > RARITY_VALUE[reward.cards[best].rarity]) best = i;
        });
        run.takeRewardCard(best);
      }
      run.leaveReward();
      return true;
    }
    case 'shop': {
      const shop = run.shop!;
      shop.gear.forEach((_, i) => run.buyGear(i));
      shop.stims.forEach((_, i) => run.buyStim(i));
      shop.cards.forEach((c, i) => {
        if (c.item.rarity !== 'common') run.buyCard(i);
      });
      run.leave();
      return true;
    }
    case 'camp': {
      const upgradable = run.deck.findIndex((c) => c.upgradesTo);
      if (run.hp < run.maxHp * 0.65 || upgradable < 0) run.campRest();
      else run.campUpgrade(upgradable);
      return true;
    }
    case 'event': {
      const event = run.event!;
      if (event.result === null) {
        const enabled = event.choices.map((c, i) => (c.disabled ? -1 : i)).filter((i) => i >= 0);
        run.chooseEvent(rng.pick(enabled));
      } else {
        run.leave();
      }
      return true;
    }
    case 'market':
      run.leave();
      return true;
    case 'dead':
      run.useReset();
      return true;
    default:
      return false;
  }
}

/** Plays a run to its end. Returns true on victory. */
export function botRun(run: Run, rng: Rng, maxSteps = 20000): boolean {
  for (let i = 0; i < maxSteps && botStep(run, rng); i++) {
    // keep stepping
  }
  return run.phase === 'victory';
}

// ---------- co-op ----------

/** The next thing the bot would do as this player of a squad, or null if it has to wait. */
export function botAction(party: Party, player: number, rng: Rng): Action | null {
  const run = party.runs[player];
  const leader = party.active[0] === player;
  switch (run.phase) {
    case 'gear':
      return { k: 'gear', i: 0 };
    case 'map': {
      if (!leader || !party.canTravel) return null;
      return { k: 'node', id: rng.pick(run.availableNodes()).id };
    }
    case 'combat': {
      const combat = run.combat!;
      if (combat.status !== 'playing' || combat.phase !== 'player') return null;
      const need = combat.totalIncoming - combat.player.block;
      const playable = combat.hand
        .filter((c) => combat.canPlay(c) && score(c, need) > 0)
        .sort((a, b) => score(b, need) - score(a, need));
      if (!playable.length) return { k: 'end' };
      const target = [...combat.aliveEnemies].sort((a, b) => a.hp + a.block - (b.hp + b.block))[0];
      return { k: 'card', uid: playable[0].uid, target: target?.uid };
    }
    case 'reward':
      return run.reward && !run.reward.cardTaken && run.reward.cards.length
        ? { k: 'rewardCard', i: 0 }
        : { k: 'rewardLeave' };
    case 'camp':
      return { k: 'rest' };
    case 'event': {
      const event = run.event!;
      if (event.result !== null) return { k: 'leave' };
      const enabled = event.choices.map((c, i) => (c.disabled ? -1 : i)).filter((i) => i >= 0);
      return { k: 'event', i: rng.pick(enabled) };
    }
    case 'shop':
    case 'market':
      return { k: 'leave' };
    case 'dead':
      return leader ? { k: 'reset' } : null;
    default:
      return null;
  }
}

/** Plays a squad to the end of its run. Returns the actions taken, so a second copy can replay them. */
export function botParty(party: Party, rng: Rng, maxSteps = 60000): { player: number; action: Action }[] {
  const taken: { player: number; action: Action }[] = [];
  const act = (player: number, action: Action): boolean => {
    taken.push({ player, action });
    return party.apply(player, action);
  };
  for (let step = 0; step < maxSteps; step++) {
    let moved = false;
    for (const player of party.active) {
      const action = botAction(party, player, rng);
      if (!action) continue;
      // A card that cannot be played after all would be retried forever: end the turn instead.
      if (!act(player, action) && action.k === 'card') act(player, { k: 'end' });
      moved = true;
    }
    if (!moved) break;
  }
  return taken;
}
