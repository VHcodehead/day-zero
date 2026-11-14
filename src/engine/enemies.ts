import type { EnemyDef, EnemyTier, Move } from './types';

function enemy(
  id: string,
  name: string,
  icon: string,
  tier: EnemyTier,
  hp: [number, number],
  moves: [weight: number, move: Move][],
): EnemyDef {
  return { id, name, icon, tier, hp, moves: moves.map(([weight, move]) => ({ weight, move })) };
}

// ---------- Act 1: the Beach ----------

export const DRONE = enemy('drone', 'Drone', 'alien-bug', 'normal', [17, 21], [
  [3, { name: 'Claw', damage: 6 }],
  [2, { name: 'Frenzy', damage: 3, hits: 2 }],
  [1, { name: 'Skitter', block: 5 }],
]);
export const SPITTER = enemy('spitter', 'Spitter', 'acid-blob', 'normal', [15, 18], [
  [2, { name: 'Acid Spit', damage: 5, weak: 1 }],
  [2, { name: 'Bile Glob', damage: 9 }],
]);
export const BULWARK = enemy('bulwark', 'Bulwark', 'beetle-shell', 'normal', [30, 34], [
  [2, { name: 'Harden', block: 9 }],
  [3, { name: 'Slam', damage: 10 }],
  [2, { name: 'Shell Bash', damage: 5, block: 5 }],
]);
export const LEAPER = enemy('leaper', 'Leaper', 'insect-jaws', 'normal', [22, 26], [
  [3, { name: 'Pounce', damage: 9 }],
  [2, { name: 'Rake', damage: 4, hits: 2 }],
  [1, { name: 'Coil', block: 4, strength: 1 }],
]);
export const ALPHA = enemy('alpha', 'Alpha', 'alien-stare', 'elite', [58, 64], [
  [2, { name: 'Roar', strength: 2, block: 6 }],
  [3, { name: 'Rend', damage: 11 }],
  [2, { name: 'Flurry', damage: 4, hits: 3 }],
]);
export const CRUSHER = enemy('crusher', 'Crusher', 'minotaur', 'elite', [68, 74], [
  [1, { name: 'Wind Up', strength: 3 }],
  [3, { name: 'Smash', damage: 13 }],
  [2, { name: 'Quake', damage: 6, vulnerable: 1 }],
]);
export const BROOD_MOTHER = enemy('brood_mother', 'Brood Mother', 'tentacle-heart', 'boss', [118, 118], [
  [3, { name: 'Crush', damage: 13 }],
  [2, { name: 'Acid Rain', damage: 4, hits: 3 }],
  [2, { name: 'Brood Shell', block: 12, strength: 1 }],
  [2, { name: 'Screech', damage: 6, weak: 2 }],
]);

// ---------- Act 2: the Ruined City ----------

export const STALKER = enemy('stalker', 'Stalker', 'praying-mantis', 'normal', [30, 34], [
  [2, { name: 'Ambush', damage: 11 }],
  [3, { name: 'Slash', damage: 4, hits: 2 }],
  [1, { name: 'Cloak', block: 8 }],
]);
export const SCREAMER = enemy('screamer', 'Screamer', 'sonic-screech', 'normal', [25, 29], [
  [2, { name: 'Shriek', damage: 4, vulnerable: 2 }],
  [3, { name: 'Sonic Lance', damage: 9 }],
  [1, { name: 'Wail', weak: 2 }],
]);
export const BURROWER = enemy('burrower', 'Burrower', 'worm-mouth', 'normal', [38, 43], [
  [1, { name: 'Tunnel', block: 10, strength: 1 }],
  [2, { name: 'Erupt', damage: 13 }],
  [3, { name: 'Bite', damage: 7 }],
]);
export const SWARMLING = enemy('swarmling', 'Swarmling', 'tick', 'normal', [14, 17], [
  [3, { name: 'Bite', damage: 4 }],
  [2, { name: 'Gnaw', damage: 2, hits: 3 }],
]);
export const RAVAGER = enemy('ravager', 'Ravager', 'horned-reptile', 'elite', [88, 96], [
  [2, { name: 'Rampage', damage: 5, hits: 3 }],
  [3, { name: 'Cleave', damage: 15 }],
  [1, { name: 'Enrage', strength: 3, block: 8 }],
]);
export const MATRIARCH = enemy('matriarch', 'Matriarch', 'hydra', 'elite', [80, 88], [
  [2, { name: 'Regrow', block: 14, heal: 6 }],
  [2, { name: 'Spine Volley', damage: 5, hits: 4 }],
  [3, { name: 'Impale', damage: 12, wound: 1 }],
]);
export const SIEGE_TITAN = enemy('siege_titan', 'Siege Titan', 'golem-head', 'boss', [170, 170], [
  [3, { name: 'Stomp', damage: 16 }],
  [2, { name: 'Barrage', damage: 5, hits: 4 }],
  [2, { name: 'Fortify', block: 14, strength: 2 }],
  [2, { name: 'Jammer', damage: 8, wound: 2 }],
]);

// ---------- Act 3: the Hive ----------

export const WARDEN = enemy('warden', 'Warden', 'spiked-halo', 'normal', [48, 54], [
  [3, { name: 'Lance', damage: 14 }],
  [2, { name: 'Phase Shield', block: 14 }],
  [2, { name: 'Shock', damage: 8, wound: 1 }],
]);
export const LEECH = enemy('leech', 'Leech', 'carnivore-mouth', 'normal', [34, 38], [
  [3, { name: 'Drain', damage: 9, heal: 6 }],
  [2, { name: 'Latch', damage: 5, hits: 2, weak: 1 }],
]);
export const HUNTER = enemy('hunter', 'Hunter', 'eyestalk', 'normal', [40, 45], [
  [2, { name: 'Volley', damage: 4, hits: 4 }],
  [2, { name: 'Mark Prey', damage: 6, vulnerable: 2 }],
  [2, { name: 'Snipe', damage: 14 }],
]);
export const PRAETORIAN = enemy('praetorian', 'Praetorian', 'alien-skull', 'elite', [125, 135], [
  [2, { name: 'Execute', damage: 20 }],
  [2, { name: 'Phalanx', block: 18, strength: 2 }],
  [3, { name: 'Sweep', damage: 8, hits: 2 }],
]);
export const OMEGA = enemy('omega', 'Omega', 'overmind', 'boss', [250, 250], [
  [3, { name: 'Mind Spike', damage: 13, wound: 1 }],
  [3, { name: 'Time Fracture', damage: 6, hits: 3 }],
  [2, { name: 'Assimilate', block: 20, heal: 12 }],
  [1, { name: 'Dominate', strength: 2, weak: 2, vulnerable: 2 }],
  [2, { name: 'Annihilate', damage: 24 }],
]);

export interface ActDef {
  name: string;
  /** Fights for the first two rows of the map. */
  easy: EnemyDef[][];
  hard: EnemyDef[][];
  elites: EnemyDef[][];
  boss: EnemyDef[];
  /** The extra enemy that joins under the Reinforcements anomaly. */
  reinforcement: EnemyDef;
}

export const ACTS: ActDef[] = [
  {
    name: 'The Beach',
    easy: [[DRONE, DRONE], [SPITTER, DRONE], [LEAPER]],
    hard: [
      [BULWARK, SPITTER],
      [LEAPER, LEAPER],
      [DRONE, DRONE, SPITTER],
      [BULWARK, DRONE],
    ],
    elites: [[ALPHA], [CRUSHER]],
    boss: [BROOD_MOTHER],
    reinforcement: DRONE,
  },
  {
    name: 'The Ruined City',
    easy: [
      [STALKER, SWARMLING],
      [SCREAMER, SWARMLING, SWARMLING],
    ],
    hard: [
      [BURROWER, SCREAMER],
      [STALKER, STALKER],
      [BURROWER, SWARMLING, SWARMLING],
      [SCREAMER, STALKER],
    ],
    elites: [[RAVAGER], [MATRIARCH]],
    boss: [SIEGE_TITAN],
    reinforcement: SWARMLING,
  },
  {
    name: 'The Hive',
    easy: [
      [HUNTER, LEECH],
      [WARDEN, LEECH],
    ],
    hard: [
      [WARDEN, HUNTER],
      [HUNTER, HUNTER, LEECH],
      [LEECH, LEECH, WARDEN],
    ],
    elites: [[PRAETORIAN], [WARDEN, WARDEN, LEECH]],
    boss: [OMEGA],
    reinforcement: LEECH,
  },
];

export const ALL_ENEMIES: EnemyDef[] = [
  ...new Set(ACTS.flatMap((a) => [...a.easy, ...a.hard, ...a.elites, a.boss].flat())),
];
