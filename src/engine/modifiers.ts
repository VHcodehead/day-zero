import type { Combat } from './combat';

/** A random twist on a single fight. Rolled once per fight, so a Reset replays the same one. */
export interface AnomalyDef {
  id: string;
  name: string;
  text: string;
  onStart?: (combat: Combat) => void;
}

// 'fog' and 'reinforcements' and the Scrap bonus of 'bounty' are handled by id in run.ts and the UI.
export const ANOMALIES: AnomalyDef[] = [
  { id: 'fog', name: 'Fog', text: 'You cannot read enemy moves in this fight.' },
  {
    id: 'airstrike',
    name: 'Airstrike Inbound',
    text: 'At the end of your turn 3, all enemies take 15 damage.',
    onStart: (c) => {
      c.airstrike = { turn: 3, damage: 15 };
    },
  },
  { id: 'reinforcements', name: 'Reinforcements', text: 'An extra hostile has joined this fight.' },
  {
    id: 'supply_drop',
    name: 'Supply Drop',
    text: 'Draw 1 extra card every turn.',
    onStart: (c) => {
      c.extraDraw += 1;
      c.draw(1);
    },
  },
  {
    id: 'bounty',
    name: 'Bounty',
    text: 'Enemies deal +1 damage per hit. This fight pays double Scrap.',
    onStart: (c) => {
      for (const enemy of c.enemies) enemy.statuses.strength += 1;
    },
  },
];

export const ANOMALY_CHANCE = 0.25;

/**
 * Threat levels stack: level N applies every line up to N.
 * Winning at your highest unlocked level unlocks the next.
 */
export const THREATS: string[] = [
  'Enemies have 10% more HP.',
  'Start with 1 fewer Reset.',
  'Enemies deal +1 damage per hit.',
  'Camps heal 20% instead of 30%, and shops charge 15% more.',
  'Start with a Scar in your deck.',
  'You have 10 less max HP.',
  'Card rewards offer 2 cards instead of 3.',
  'Elites and bosses have 20% more HP and deal +1 more damage per hit.',
];

export const MAX_THREAT = THREATS.length;
