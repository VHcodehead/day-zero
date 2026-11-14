import type { ClassId } from './types';

export interface ClassDef {
  id: ClassId;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  maxHp: number;
  resets: number;
  critChance: number;
  maxAmmo: number;
  /** How many enemy moves ahead this class can read. */
  intentsAhead: number;
  starter: string[];
}

/** Classes that must be unlocked. The Hybrid unlocks the first time you beat an Act 1 boss. */
export const LOCKED_CLASSES: ClassId[] = ['hybrid'];

const times = (id: string, n: number): string[] => Array<string>(n).fill(id);

export const CLASSES: Record<ClassId, ClassDef> = {
  grunt: {
    id: 'grunt',
    name: 'Grunt',
    icon: 'battle-mech',
    tagline: 'Heavy weapons',
    description: 'Tough and simple. Big guns spend Ammo; Reload to keep firing.',
    maxHp: 80,
    resets: 2,
    critChance: 0.1,
    maxAmmo: 6,
    intentsAhead: 1,
    starter: [...times('sidearm', 4), ...times('brace', 4), 'autocannon', 'reload'],
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    icon: 'hood',
    tagline: 'Luck and crits',
    description: 'Fragile gambler. Starts with 20% crit chance, evades hits and bets on dice.',
    maxHp: 66,
    resets: 2,
    critChance: 0.2,
    maxAmmo: 0,
    intentsAhead: 1,
    starter: [...times('quick_shot', 4), ...times('sidestep', 4), 'vital_strike', 'smoke_step'],
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    icon: 'wrench',
    tagline: 'Turrets and drones',
    description: 'Slow start, strong finish. Turrets shoot every turn; Shield Drones keep you covered.',
    maxHp: 72,
    resets: 2,
    critChance: 0.1,
    maxAmmo: 0,
    intentsAhead: 1,
    starter: [...times('rivet_gun', 4), ...times('barricade', 4), 'deploy_turret', 'overclock'],
  },
  veteran: {
    id: 'veteran',
    name: 'Veteran',
    icon: 'rank-3',
    tagline: 'Has died here before',
    description:
      'Reads enemy moves 2 turns ahead and starts with 3 Resets. Starts with a Scar, and gets stronger with each one.',
    maxHp: 70,
    resets: 3,
    critChance: 0.1,
    maxAmmo: 0,
    intentsAhead: 2,
    starter: [...times('service_rifle', 4), ...times('guard', 4), 'predict', 'seen_it_before', 'scar'],
  },
  hybrid: {
    id: 'hybrid',
    name: 'Hybrid',
    icon: 'tentacles-skull',
    tagline: 'Alien blood',
    description:
      'Builds Corruption: every 2 points add 1 damage per hit, every 3 burn 1 HP each turn. Ride it, then purge it.',
    maxHp: 74,
    resets: 2,
    critChance: 0.1,
    maxAmmo: 0,
    intentsAhead: 1,
    starter: [...times('claw', 4), ...times('carapace', 4), 'mutate', 'acid_spit'],
  },
};

export const CLASS_LIST: ClassDef[] = Object.values(CLASSES);
