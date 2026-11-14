import type { Combat } from './combat';
import type { Run } from './run';

/** Gear: permanent passive items for the rest of the run. */
export interface GearDef {
  id: string;
  name: string;
  icon: string;
  text: string;
  onPickup?: (run: Run) => void;
  onCombatStart?: (combat: Combat) => void;
}

// Gear with no hooks here is checked by id in run.ts (rations, magnet, lucky_coin, loop_anchor, visor).
export const GEAR: GearDef[] = [
  { id: 'rations', name: 'Field Rations', icon: 'meal', text: 'Heal 5 HP after every fight you win.' },
  {
    id: 'scope',
    name: 'Rangefinder',
    icon: 'binoculars',
    text: '+10% crit chance.',
    onCombatStart: (c) => {
      c.player.critChance += 0.1;
    },
  },
  {
    id: 'plating',
    name: 'Reactive Plating',
    icon: 'armor-vest',
    text: 'Start each fight with 8 Block.',
    onCombatStart: (c) => c.gainBlock(8),
  },
  {
    id: 'adrenal',
    name: 'Adrenal Implant',
    icon: 'heart-beats',
    text: 'Gain 1 extra Energy on the first turn of each fight.',
    onCombatStart: (c) => c.gainEnergy(1),
  },
  {
    id: 'lucky_coin',
    name: 'Lucky Coin',
    icon: 'two-coins',
    text: '+15% to every success chance in events and the Black Market.',
  },
  {
    id: 'whetstone',
    name: 'Mono-Edge',
    icon: 'plain-dagger',
    text: 'Your attacks deal +1 damage per hit.',
    onCombatStart: (c) => {
      c.player.statuses.strength += 1;
    },
  },
  {
    id: 'medkit',
    name: 'Trauma Kit',
    icon: 'medical-pack',
    text: '+12 max HP.',
    onPickup: (run) => {
      run.maxHp += 12;
      run.hp += 12;
    },
  },
  { id: 'magnet', name: 'Scrap Magnet', icon: 'magnet', text: 'Gain 50% more Scrap from fights.' },
  { id: 'loop_anchor', name: 'Loop Anchor', icon: 'anchor', text: 'Resets no longer add a Scar to your deck.' },
  { id: 'visor', name: 'Tactical Visor', icon: 'visored-helm', text: 'See 1 more turn of enemy moves.' },
  {
    id: 'backpack',
    name: 'Field Pack',
    icon: 'backpack',
    text: 'Draw 2 extra cards on the first turn of each fight.',
    onCombatStart: (c) => c.draw(2),
  },
];

/** Stims: one-use items, free to use on your turn in a fight. */
export interface StimDef {
  id: string;
  name: string;
  icon: string;
  text: string;
  use: (combat: Combat) => void;
}

export const STIMS: StimDef[] = [
  { id: 'medigel', name: 'Medi-Gel', icon: 'health-potion', text: 'Heal 15 HP.', use: (c) => c.heal(15) },
  { id: 'battery', name: 'Power Cell', icon: 'battery-plus', text: 'Gain 2 Energy.', use: (c) => c.gainEnergy(2) },
  { id: 'frag', name: 'Frag Grenade', icon: 'grenade', text: 'Deal 12 damage to ALL enemies.', use: (c) => c.damageAll(12) },
  { id: 'smoke', name: 'Smoke Canister', icon: 'fizzing-flask', text: 'Gain 12 Block.', use: (c) => c.gainBlock(12) },
  {
    id: 'focus',
    name: 'Focus Stim',
    icon: 'bolt-eye',
    text: 'Every attack you make this turn is a crit.',
    use: (c) => {
      c.player.tempCrit += 1;
    },
  },
  {
    id: 'neurotoxin',
    name: 'Neurotoxin',
    icon: 'poison-bottle',
    text: 'Apply 3 Vulnerable to ALL enemies.',
    use: (c) => c.applyToAll('vulnerable', 3),
  },
];

export const MAX_STIMS = 3;
