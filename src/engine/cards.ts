import type { Combat } from './combat';
import type { CardDef, CardMod, CardOwner, CardType, ClassId, Rarity } from './types';

type Spec = Pick<CardDef, 'text' | 'icon'> &
  Partial<Pick<CardDef, 'play' | 'needsTarget' | 'exhaust' | 'ammo' | 'cost' | 'noRepeat'>>;
type Make = (upgraded: boolean) => Spec;

export const CARDS: Record<string, CardDef> = {};

/** Registers a card and its upgraded "+" version. `make(true)` describes the upgrade. */
function def(
  owner: CardOwner,
  rarity: Rarity,
  type: CardType,
  cost: number,
  id: string,
  name: string,
  make: Make,
): void {
  const shared = { type, rarity, owner, cost };
  CARDS[id] = { id, name, ...shared, ...make(false), upgradesTo: `${id}+` };
  CARDS[`${id}+`] = { id: `${id}+`, name: `${name}+`, ...shared, ...make(true), upgraded: true };
}

const strike =
  (icon: string, base: number, up: number): Make =>
  (u) => {
    const d = u ? up : base;
    return { icon, needsTarget: true, text: `Deal ${d} damage.`, play: (c, t) => void c.attack(t!, d) };
  };

const guard =
  (icon: string, base: number, up: number): Make =>
  (u) => {
    const b = u ? up : base;
    return { icon, text: `Gain ${b} Block.`, play: (c) => c.gainBlock(b) };
  };

const pct = (n: number): string => `${Math.round(n * 100)}%`;

// ====================================================================
// NEUTRAL — any class can find these
// ====================================================================

def('neutral', 'common', 'attack', 0, 'combat_knife', 'Combat Knife', strike('bowie-knife', 4, 6));
def('neutral', 'common', 'defense', 2, 'dig_in', 'Dig In', guard('trench-spade', 12, 16));
def('neutral', 'common', 'tactic', 1, 'mark_target', 'Mark Target', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'targeted',
    needsTarget: true,
    text: `Apply ${n} Vulnerable.`,
    play: (c, t) => c.applyToEnemy(t!, 'vulnerable', n),
  };
});
def('neutral', 'uncommon', 'tactic', 1, 'flashbang', 'Flashbang', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'flash-grenade',
    exhaust: true,
    text: `Apply ${n} Weak to ALL enemies. Exhaust.`,
    play: (c) => c.applyToAll('weak', n),
  };
});
def('neutral', 'uncommon', 'tactic', 0, 'combat_stim', 'Combat Stim', (u) => {
  const e = u ? 3 : 2;
  return {
    icon: 'syringe',
    exhaust: true,
    text: `Gain ${e} Energy. Lose 2 HP. Exhaust.`,
    play: (c) => {
      c.gainEnergy(e);
      c.damagePlayer(2, true);
    },
  };
});
def('neutral', 'uncommon', 'system', 1, 'targeting_computer', 'Targeting Computer', (u) => {
  const n = u ? 0.25 : 0.15;
  return {
    icon: 'processor',
    text: `+${pct(n)} crit chance for the rest of combat.`,
    play: (c) => {
      c.player.critChance += n;
    },
  };
});
def('neutral', 'uncommon', 'tactic', 1, 'field_dressing', 'Field Dressing', (u) => {
  const n = u ? 10 : 6;
  return { icon: 'bandage-roll', exhaust: true, text: `Heal ${n} HP. Exhaust.`, play: (c) => c.heal(n) };
});

// ====================================================================
// GRUNT — heavy weapons that burn Ammo
// ====================================================================

def('grunt', 'starter', 'attack', 1, 'sidearm', 'Sidearm', strike('pistol-gun', 6, 9));
def('grunt', 'starter', 'defense', 1, 'brace', 'Brace', guard('shield', 5, 8));
def('grunt', 'starter', 'attack', 1, 'autocannon', 'Autocannon', (u) => ({
  ...strike('minigun', 12, 16)(u),
  ammo: 2,
}));
def('grunt', 'starter', 'tactic', 0, 'reload', 'Reload', (u) => {
  const n = u ? 6 : 3;
  return {
    icon: 'reload-gun-barrel',
    text: `Gain ${n} Ammo. Draw 1 card.`,
    play: (c) => {
      c.gainAmmo(n);
      c.draw(1);
    },
  };
});
def('grunt', 'common', 'attack', 1, 'aimed_shot', 'Aimed Shot', (u) => {
  const d = u ? 11 : 8;
  const bonus = u ? 0.5 : 0.4;
  return {
    icon: 'crosshair',
    ammo: 1,
    needsTarget: true,
    text: `Deal ${d} damage. +${pct(bonus)} crit chance.`,
    play: (c, t) => void c.attack(t!, d, { critBonus: bonus }),
  };
});
def('grunt', 'common', 'attack', 1, 'suppressing_fire', 'Suppressing Fire', (u) => {
  const hits = u ? 5 : 4;
  return {
    icon: 'bullets',
    ammo: 2,
    text: `Deal 3 damage to a random enemy ${hits} times.`,
    play: (c) => {
      for (let i = 0; i < hits; i++) c.attackRandom(3);
    },
  };
});
def('grunt', 'common', 'defense', 1, 'hit_the_dirt', 'Hit the Dirt', (u) => {
  const b = u ? 7 : 4;
  return {
    icon: 'dodging',
    text: `Gain ${b} Block. Draw 1 card.`,
    play: (c) => {
      c.gainBlock(b);
      c.draw(1);
    },
  };
});
def('grunt', 'common', 'attack', 1, 'shrapnel_round', 'Shrapnel Round', (u) => {
  const d = u ? 8 : 5;
  return { icon: 'bullet-impacts', ammo: 1, text: `Deal ${d} damage to ALL enemies.`, play: (c) => c.attackAll(d) };
});
def('grunt', 'uncommon', 'attack', 1, 'overcharge', 'Overcharge', (u) => {
  const d = u ? 26 : 20;
  return {
    icon: 'overdrive',
    needsTarget: true,
    text: `70%: deal ${d} damage. 30%: it backfires and you lose 5 HP.`,
    play: (c, t) => {
      if (c.roll(0.7)) {
        c.attack(t!, d);
      } else {
        c.addLog('Overcharge backfires! You lose 5 HP.', 'bad');
        c.damagePlayer(5, true);
      }
    },
  };
});
def('grunt', 'uncommon', 'attack', 2, 'claymore', 'Claymore', (u) => {
  const d = u ? 11 : 8;
  return {
    icon: 'claymore-explosive',
    text: `Deal ${d} damage to ALL enemies. Apply 1 Vulnerable to ALL.`,
    play: (c) => {
      c.attackAll(d);
      c.applyToAll('vulnerable', 1);
    },
  };
});
def('grunt', 'uncommon', 'system', 1, 'auto_loader', 'Auto-Loader', (u) => ({
  icon: 'ammo-box',
  cost: u ? 0 : 1,
  text: 'At the start of each turn, gain 1 Ammo.',
  play: (c) => {
    c.player.ammoPerTurn += 1;
  },
}));
def('grunt', 'rare', 'attack', 2, 'mag_dump', 'Mag Dump', (u) => {
  const d = u ? 7 : 5;
  return {
    icon: 'machine-gun-magazine',
    ammo: 1,
    needsTarget: true,
    text: `Spend ALL Ammo. Deal ${d} damage for each Ammo spent.`,
    play: (c, t) => {
      const spent = 1 + c.player.ammo;
      c.player.ammo = 0;
      for (let i = 0; i < spent; i++) c.attack(t!, d);
    },
  };
});
def('grunt', 'rare', 'system', 2, 'servo_motors', 'Servo Motors', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'mechanical-arm',
    text: `Your attacks deal +${n} damage per hit for the rest of combat.`,
    play: (c) => {
      c.player.statuses.strength += n;
    },
  };
});
def('grunt', 'rare', 'defense', 2, 'iron_wall', 'Iron Wall', (u) => {
  const b = u ? 14 : 10;
  return {
    icon: 'defensive-wall',
    text: `Gain ${b} Block. Your Block is not removed at the start of next turn.`,
    play: (c) => {
      c.gainBlock(b);
      c.player.retainBlock = true;
    },
  };
});

// ====================================================================
// SCOUT — crits, evasion and gambles
// ====================================================================

def('scout', 'starter', 'attack', 1, 'quick_shot', 'Quick Shot', strike('supersonic-bullet', 5, 8));
def('scout', 'starter', 'defense', 1, 'sidestep', 'Sidestep', guard('sprint', 5, 8));
def('scout', 'starter', 'attack', 1, 'vital_strike', 'Vital Strike', (u) => {
  const d = u ? 10 : 7;
  return {
    icon: 'headshot',
    needsTarget: true,
    text: `Deal ${d} damage. +30% crit chance.`,
    play: (c, t) => void c.attack(t!, d, { critBonus: 0.3 }),
  };
});
def('scout', 'starter', 'defense', 1, 'smoke_step', 'Smoke Step', (u) => {
  const e = u ? 0.35 : 0.25;
  return {
    icon: 'smoke-bomb',
    text: `Gain 3 Block. ${pct(e)} chance to evade each hit this turn.`,
    play: (c) => {
      c.gainBlock(3);
      c.player.evade = Math.min(0.9, c.player.evade + e);
    },
  };
});
def('scout', 'common', 'attack', 1, 'double_tap', 'Double Tap', (u) => {
  const d = u ? 5 : 4;
  return {
    icon: 'double-shot',
    needsTarget: true,
    text: `Deal ${d} damage twice.`,
    play: (c, t) => {
      c.attack(t!, d);
      c.attack(t!, d);
    },
  };
});
def('scout', 'common', 'defense', 1, 'shadow_roll', 'Shadow Roll', (u) => {
  const b = u ? 8 : 6;
  const e = u ? 0.4 : 0.3;
  return {
    icon: 'running-ninja',
    text: `Gain ${b} Block. ${pct(e)} chance to evade each hit this turn.`,
    play: (c) => {
      c.gainBlock(b);
      c.player.evade = Math.min(0.9, c.player.evade + e);
    },
  };
});
def('scout', 'common', 'attack', 1, 'opportunist', 'Opportunist', (u) => {
  const d = u ? 10 : 7;
  return {
    icon: 'backstab',
    needsTarget: true,
    text: `Deal ${d} damage. If it crits, gain 1 Energy.`,
    play: (c, t) => {
      if (c.attack(t!, d).crit) c.gainEnergy(1);
    },
  };
});
def('scout', 'common', 'attack', 1, 'throwing_knives', 'Throwing Knives', (u) => {
  const hits = u ? 4 : 3;
  return {
    icon: 'thrown-daggers',
    text: `Deal 3 damage to a random enemy ${hits} times.`,
    play: (c) => {
      for (let i = 0; i < hits; i++) c.attackRandom(3);
    },
  };
});
def('scout', 'common', 'tactic', 0, 'lucky_break', 'Lucky Break', (u) => {
  const p = u ? 0.65 : 0.5;
  return {
    icon: 'clover',
    text: `Draw 1 card. ${pct(p)}: draw another and gain 1 Energy.`,
    play: (c) => {
      c.draw(1);
      if (c.roll(p)) {
        c.addLog('Lucky break!', 'good');
        c.draw(1);
        c.gainEnergy(1);
      }
    },
  };
});
def('scout', 'uncommon', 'attack', 1, 'coin_flip', 'Coin Flip', (u) => {
  const d = u ? 23 : 18;
  return {
    icon: 'coinflip',
    needsTarget: true,
    text: `50%: deal ${d} damage. 50%: deal 4 damage.`,
    play: (c, t) => void c.attack(t!, c.roll(0.5) ? d : 4),
  };
});
def('scout', 'uncommon', 'attack', 1, 'exploit_weakness', 'Exploit Weakness', (u) => {
  const d = u ? 9 : 6;
  return {
    icon: 'knife-thrust',
    needsTarget: true,
    text: `Deal ${d} damage. Apply 1 Vulnerable.`,
    play: (c, t) => {
      c.attack(t!, d);
      c.applyToEnemy(t!, 'vulnerable', 1);
    },
  };
});
def('scout', 'uncommon', 'defense', 2, 'ghost_protocol', 'Ghost Protocol', (u) => ({
  icon: 'ghost',
  cost: u ? 1 : 2,
  text: '60% chance to evade each hit this turn.',
  play: (c) => {
    c.player.evade = Math.min(0.9, c.player.evade + 0.6);
  },
}));
def('scout', 'uncommon', 'system', 1, 'killer_instinct', 'Killer Instinct', (u) => ({
  icon: 'on-target',
  cost: u ? 0 : 1,
  text: 'Whenever you crit, draw 1 card.',
  play: (c) => {
    c.player.critDraw += 1;
  },
}));
def('scout', 'uncommon', 'system', 1, 'reflex_loop', 'Reflex Loop', (u) => {
  const b = u ? 5 : 3;
  return {
    icon: 'shield-reflect',
    text: `Whenever you crit, gain ${b} Block.`,
    play: (c) => {
      c.player.critBlock += b;
    },
  };
});
def('scout', 'uncommon', 'tactic', 0, 'steady_aim', 'Steady Aim', (u) => ({
  icon: 'reticule',
  exhaust: !u,
  text: `Your next attack hit is a guaranteed crit.${u ? '' : ' Exhaust.'}`,
  play: (c) => {
    c.player.nextCrit = true;
  },
}));
def('scout', 'rare', 'attack', 2, 'jackpot', 'Jackpot', (u) => {
  const m = u ? 8 : 6;
  return {
    icon: 'slot-machine',
    needsTarget: true,
    text: `Roll a die. Deal ${m} damage times the roll (${m}–${m * 6}).`,
    play: (c, t) => {
      const roll = c.rollInt(1, 6);
      c.addLog(`Jackpot rolls a ${roll}.`, roll >= 5 ? 'good' : 'info');
      c.attack(t!, m * roll);
    },
  };
});
def('scout', 'rare', 'tactic', 1, 'all_in', 'All In', (u) => {
  const n = u ? 0.75 : 0.5;
  return {
    icon: 'poker-hand',
    exhaust: true,
    text: `+${pct(n)} crit chance this turn. Exhaust.`,
    play: (c) => {
      c.player.tempCrit += n;
    },
  };
});
def('scout', 'rare', 'attack', 2, 'assassinate', 'Assassinate', (u) => {
  const d = u ? 20 : 15;
  return {
    icon: 'hooded-assassin',
    needsTarget: true,
    text: `Deal ${d} damage. If the target is at or below half HP, deal ${d * 2} instead.`,
    play: (c, t) => void c.attack(t!, t!.hp * 2 <= t!.maxHp ? d * 2 : d),
  };
});

// ====================================================================
// ENGINEER — turrets and shield drones that work every turn
// ====================================================================

const constructs = (c: { player: { turrets: number; drones: number } }): number =>
  c.player.turrets + c.player.drones;

def('engineer', 'starter', 'attack', 1, 'rivet_gun', 'Rivet Gun', strike('hammer-nails', 5, 8));
def('engineer', 'starter', 'defense', 1, 'barricade', 'Barricade', guard('barricade', 5, 8));
def('engineer', 'starter', 'tactic', 1, 'deploy_turret', 'Deploy Turret', (u) => ({
  icon: 'sentry-gun',
  exhaust: true,
  cost: u ? 0 : 1,
  text: 'Deploy a Turret. It shoots a random enemy at the end of each of your turns. Exhaust.',
  play: (c) => {
    c.player.turrets += 1;
  },
}));
def('engineer', 'starter', 'tactic', 1, 'overclock', 'Overclock', (u) => ({
  icon: 'gears',
  cost: u ? 0 : 1,
  text: 'Your Turrets fire now.',
  play: (c) => c.fireTurrets(),
}));
def('engineer', 'common', 'tactic', 1, 'shield_drone', 'Shield Drone', (u) => ({
  icon: 'delivery-drone',
  exhaust: true,
  cost: u ? 0 : 1,
  text: 'Deploy a Shield Drone. It gives 3 Block at the start of each turn. Exhaust.',
  play: (c) => {
    c.player.drones += 1;
  },
}));
def('engineer', 'common', 'attack', 1, 'arc_welder', 'Arc Welder', (u) => {
  const d = u ? 9 : 7;
  const per = u ? 3 : 2;
  return {
    icon: 'lightning-arc',
    needsTarget: true,
    text: `Deal ${d} damage, +${per} for each Turret.`,
    play: (c, t) => void c.attack(t!, d + per * c.player.turrets),
  };
});
def('engineer', 'common', 'defense', 1, 'scrap_shield', 'Scrap Shield', (u) => {
  const b = u ? 8 : 6;
  return {
    icon: 'gear-hammer',
    text: `Gain ${b} Block, +2 for each Turret and Drone.`,
    play: (c) => c.gainBlock(b + 2 * constructs(c)),
  };
});
def('engineer', 'common', 'attack', 1, 'nail_bomb', 'Nail Bomb', (u) => {
  const d = u ? 6 : 4;
  return { icon: 'nails', text: `Deal ${d} damage to ALL enemies.`, play: (c) => c.attackAll(d) };
});
def('engineer', 'common', 'tactic', 0, 'tinker', 'Tinker', (u) => {
  const n = u ? 2 : 1;
  return {
    icon: 'tinker',
    text: `Draw ${n} card${n > 1 ? 's' : ''}. Gain 3 Block.`,
    play: (c) => {
      c.draw(n);
      c.gainBlock(3);
    },
  };
});
def('engineer', 'uncommon', 'tactic', 2, 'twin_turrets', 'Twin Turrets', (u) => ({
  icon: 'turret',
  exhaust: true,
  text: `Deploy 2 Turrets.${u ? ' They fire now.' : ''} Exhaust.`,
  play: (c) => {
    c.player.turrets += 2;
    if (u) c.fireTurrets();
  },
}));
def('engineer', 'uncommon', 'tactic', 1, 'target_uplink', 'Target Uplink', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'radar-dish',
    needsTarget: true,
    text: `Apply ${n} Vulnerable. Your Turrets fire now.`,
    play: (c, t) => {
      c.applyToEnemy(t!, 'vulnerable', n);
      c.fireTurrets();
    },
  };
});
def('engineer', 'uncommon', 'system', 1, 'upgraded_barrels', 'Upgraded Barrels', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'laser-turret',
    text: `Turrets deal +${n} damage.`,
    play: (c) => {
      c.player.turretDamage += n;
    },
  };
});
def('engineer', 'uncommon', 'attack', 2, 'emp', 'EMP Blast', (u) => {
  const d = u ? 9 : 6;
  const w = u ? 2 : 1;
  return {
    icon: 'tesla-coil',
    text: `Deal ${d} damage to ALL enemies. Apply ${w} Weak to ALL.`,
    play: (c) => {
      c.attackAll(d);
      c.applyToAll('weak', w);
    },
  };
});
def('engineer', 'uncommon', 'system', 2, 'repair_bot', 'Repair Bot', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'auto-repair',
    text: `Heal ${n} HP at the end of each of your turns.`,
    play: (c) => {
      c.player.regen += n;
    },
  };
});
def('engineer', 'rare', 'tactic', 0, 'salvage', 'Salvage', (u) => {
  const max = u ? 4 : 3;
  return {
    icon: 'recycle',
    exhaust: true,
    text: `Gain 1 Energy for each Turret (max ${max}). Exhaust.`,
    play: (c) => c.gainEnergy(Math.min(max, c.player.turrets)),
  };
});
def('engineer', 'rare', 'system', 3, 'mech_walker', 'Mech Walker', (u) => ({
  icon: 'megabot',
  cost: u ? 2 : 3,
  text: 'Deploy 2 Turrets and 2 Shield Drones.',
  play: (c) => {
    c.player.turrets += 2;
    c.player.drones += 2;
  },
}));
def('engineer', 'rare', 'attack', 1, 'self_destruct', 'Self-Destruct', (u) => {
  const d = u ? 16 : 12;
  return {
    icon: 'time-bomb',
    text: `Destroy all your Turrets. Deal ${d} damage to ALL enemies for each one destroyed.`,
    play: (c) => {
      const n = c.player.turrets;
      c.player.turrets = 0;
      for (let i = 0; i < n; i++) c.attackAll(d);
    },
  };
});
def('engineer', 'rare', 'defense', 2, 'fortress', 'Fortress', (u) => {
  const b = u ? 10 : 8;
  const per = u ? 5 : 4;
  return {
    icon: 'stone-tower',
    text: `Gain ${b} Block, +${per} for each Turret and Drone.`,
    play: (c) => c.gainBlock(b + per * constructs(c)),
  };
});

// ====================================================================
// VETERAN — reads enemy intents and turns Scars into strength
// ====================================================================

def('veteran', 'starter', 'attack', 1, 'service_rifle', 'Service Rifle', strike('lee-enfield', 6, 9));
def('veteran', 'starter', 'defense', 1, 'guard', 'Guard', guard('shield', 5, 8));
def('veteran', 'starter', 'tactic', 1, 'predict', 'Predict', (u) => {
  const n = u ? 12 : 9;
  return {
    icon: 'crystal-ball',
    needsTarget: true,
    text: `If the target intends to attack, gain ${n} Block. Otherwise deal ${n} damage to it.`,
    play: (c, t) => {
      if (c.intendsAttack(t!)) c.gainBlock(n);
      else c.attack(t!, n);
    },
  };
});
def('veteran', 'starter', 'defense', 1, 'seen_it_before', 'Seen It Before', (u) => {
  const max = u ? 18 : 12;
  return {
    icon: 'third-eye',
    text: `Gain Block equal to the biggest incoming attack (max ${max}).`,
    play: (c) => c.gainBlock(Math.min(max, Math.max(0, ...c.aliveEnemies.map((e) => c.incomingFrom(e))))),
  };
});
def('veteran', 'common', 'attack', 1, 'counterstrike', 'Counterstrike', (u) => {
  const d = u ? 8 : 6;
  const big = u ? 14 : 11;
  return {
    icon: 'sword-clash',
    needsTarget: true,
    text: `Deal ${d} damage. If the target intends to attack, deal ${big} instead.`,
    play: (c, t) => void c.attack(t!, c.intendsAttack(t!) ? big : d),
  };
});
def('veteran', 'common', 'defense', 1, 'anticipate', 'Anticipate', (u) => {
  const b = u ? 6 : 4;
  return {
    icon: 'all-seeing-eye',
    text: `Gain 3 Block, +${b} for each enemy that intends to attack.`,
    play: (c) => c.gainBlock(3 + b * c.aliveEnemies.filter((e) => c.intendsAttack(e)).length),
  };
});
def('veteran', 'common', 'tactic', 0, 'old_tricks', 'Old Tricks', (u) => {
  const n = u ? 2 : 1;
  return {
    icon: 'return-arrow',
    exhaust: true,
    text: `Return ${n} random Attack${n > 1 ? 's' : ''} from your discard pile to your hand. Exhaust.`,
    play: (c) => c.recallAttacks(n),
  };
});
def('veteran', 'common', 'defense', 1, 'scar_tissue', 'Scar Tissue', (u) => {
  const b = u ? 7 : 5;
  const per = u ? 4 : 3;
  return {
    icon: 'stitched-wound',
    text: `Gain ${b} Block, +${per} for each Scar in your deck.`,
    play: (c) => c.gainBlock(b + per * c.player.scars),
  };
});
def('veteran', 'common', 'attack', 1, 'grudge', 'Grudge', (u) => {
  const d = u ? 7 : 5;
  const per = u ? 4 : 3;
  return {
    icon: 'ragged-wound',
    needsTarget: true,
    text: `Deal ${d} damage, +${per} for each Scar in your deck.`,
    play: (c, t) => void c.attack(t!, d + per * c.player.scars),
  };
});
def('veteran', 'uncommon', 'tactic', 1, 'deja_vu', 'Déjà Vu', (u) => ({
  icon: 'cycle',
  noRepeat: true,
  cost: u ? 0 : 1,
  text: 'Repeat the effect of the last card you played this turn.',
  play: (c) => c.replayLast(),
}));
def('veteran', 'uncommon', 'tactic', 1, 'premonition', 'Premonition', (u) => {
  const n = u ? 4 : 3;
  return { icon: 'brain', text: `Draw ${n} cards.`, play: (c) => c.draw(n) };
});
def('veteran', 'uncommon', 'system', 1, 'wear_it_proudly', 'Wear It Proudly', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'medal-skull',
    text: `At the start of each turn, gain ${n} Block for each Scar in your deck.`,
    play: (c) => {
      c.player.scarBlock += n;
    },
  };
});
def('veteran', 'uncommon', 'tactic', 0, 'bitter_lesson', 'Bitter Lesson', (u) => {
  const n = u ? 2 : 1;
  return {
    icon: 'broken-heart',
    exhaust: true,
    text: `Gain 2 Energy and draw ${n}. Add a Scar to your deck for this combat. Exhaust.`,
    play: (c) => {
      c.gainEnergy(2);
      c.draw(n);
      c.addScar();
    },
  };
});
def('veteran', 'uncommon', 'attack', 2, 'exploit_pattern', 'Exploit Pattern', (u) => {
  const d = u ? 18 : 14;
  const big = u ? 28 : 22;
  return {
    icon: 'chess-knight',
    needsTarget: true,
    text: `Deal ${d} damage. If the target does NOT intend to attack, deal ${big} instead.`,
    play: (c, t) => void c.attack(t!, c.intendsAttack(t!) ? d : big),
  };
});
def('veteran', 'rare', 'tactic', 1, 'rewind', 'Rewind', (u) => ({
  icon: 'backward-time',
  exhaust: true,
  noRepeat: true,
  cost: u ? 0 : 1,
  text: 'Regain the Energy you spent this turn (max 3). Exhaust.',
  play: (c) => c.gainEnergy(Math.min(3, c.player.energySpent)),
}));
def('veteran', 'rare', 'system', 3, 'perfect_run', 'Perfect Run', (u) => ({
  icon: 'infinity',
  cost: u ? 2 : 3,
  text: 'Gain 1 extra Energy at the start of each turn.',
  play: (c) => {
    c.player.maxEnergy += 1;
  },
}));
def('veteran', 'rare', 'tactic', 2, 'fixed_point', 'Fixed Point', (u) => ({
  icon: 'time-trap',
  exhaust: true,
  needsTarget: true,
  cost: u ? 1 : 2,
  text: 'Stun an enemy. It loses its next move. Exhaust.',
  play: (c, t) => c.stun(t!),
}));
def('veteran', 'rare', 'attack', 1, 'thousand_deaths', 'A Thousand Deaths', (u) => {
  const per = u ? 8 : 6;
  return {
    icon: 'skull-crossed-bones',
    needsTarget: true,
    text: `Deal ${per} damage for each Scar in your deck (at least ${per}).`,
    play: (c, t) => void c.attack(t!, per * Math.max(1, c.player.scars)),
  };
});

// ====================================================================
// HYBRID — alien blood. Corruption adds damage and burns HP every turn.
// ====================================================================

def('hybrid', 'starter', 'attack', 1, 'claw', 'Claw', strike('claw-slashes', 6, 9));
def('hybrid', 'starter', 'defense', 1, 'carapace', 'Carapace', guard('turtle-shell', 5, 8));
def('hybrid', 'starter', 'tactic', 0, 'mutate', 'Mutate', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'dna1',
    text: `Gain ${n} Corruption. Draw 1 card.`,
    play: (c) => {
      c.gainCorruption(n);
      c.draw(1);
    },
  };
});
def('hybrid', 'starter', 'attack', 1, 'acid_spit', 'Acid Spit', (u) => {
  const d = u ? 8 : 5;
  return {
    icon: 'acid-blob',
    needsTarget: true,
    text: `Deal ${d} damage. Apply 1 Weak.`,
    play: (c, t) => {
      c.attack(t!, d);
      c.applyToEnemy(t!, 'weak', 1);
    },
  };
});
def('hybrid', 'common', 'attack', 1, 'feed', 'Feed', (u) => {
  const d = u ? 9 : 7;
  const h = u ? 3 : 2;
  return {
    icon: 'carnivore-mouth',
    needsTarget: true,
    text: `Deal ${d} damage. Heal ${h} HP.`,
    play: (c, t) => {
      c.attack(t!, d);
      c.heal(h);
    },
  };
});
def('hybrid', 'common', 'attack', 1, 'frenzy', 'Frenzy', (u) => {
  const hits = u ? 3 : 2;
  return {
    icon: 'insect-jaws',
    needsTarget: true,
    text: `Deal 3 damage ${hits} times. Gain 1 Corruption.`,
    play: (c, t) => {
      for (let i = 0; i < hits; i++) c.attack(t!, 3);
      c.gainCorruption(1);
    },
  };
});
def('hybrid', 'common', 'defense', 1, 'harden', 'Harden', (u) => {
  const b = u ? 10 : 7;
  return {
    icon: 'spiked-snail',
    text: `Gain ${b} Block. Gain 1 Corruption.`,
    play: (c) => {
      c.gainBlock(b);
      c.gainCorruption(1);
    },
  };
});
def('hybrid', 'common', 'attack', 1, 'bile_spray', 'Bile Spray', (u) => {
  const d = u ? 6 : 4;
  return {
    icon: 'vile-fluid',
    text: `Deal ${d} damage to ALL enemies. Gain 1 Corruption.`,
    play: (c) => {
      c.attackAll(d);
      c.gainCorruption(1);
    },
  };
});
def('hybrid', 'common', 'defense', 1, 'shed_skin', 'Shed Skin', (u) => {
  const per = u ? 7 : 5;
  return {
    icon: 'slime',
    text: `Lose up to 2 Corruption. Gain 3 Block, +${per} for each Corruption lost.`,
    play: (c) => {
      const lost = Math.min(2, c.player.corruption);
      c.gainCorruption(-lost);
      c.gainBlock(3 + per * lost);
    },
  };
});
def('hybrid', 'uncommon', 'tactic', 0, 'adrenal_surge', 'Adrenal Surge', (u) => {
  const e = u ? 2 : 1;
  return {
    icon: 'virus',
    exhaust: true,
    text: `Gain 3 Corruption and ${e} Energy. Exhaust.`,
    play: (c) => {
      c.gainCorruption(3);
      c.gainEnergy(e);
    },
  };
});
def('hybrid', 'uncommon', 'defense', 1, 'purge', 'Purge', (u) => {
  const per = u ? 4 : 3;
  return {
    icon: 'fleshy-mass',
    text: `Lose ALL Corruption. Gain ${per} Block for each point lost.`,
    play: (c) => {
      const lost = c.player.corruption;
      c.gainCorruption(-lost);
      c.gainBlock(per * lost);
    },
  };
});
def('hybrid', 'uncommon', 'system', 1, 'hive_link', 'Hive Link', (u) => {
  const b = u ? 5 : 3;
  return {
    icon: 'brain-tentacle',
    text: `At the start of each turn, gain 1 Corruption and ${b} Block.`,
    play: (c) => {
      c.player.corruptionPerTurn += 1;
      c.player.blockPerTurn += b;
    },
  };
});
def('hybrid', 'uncommon', 'attack', 2, 'rend', 'Rend', (u) => {
  const d = u ? 16 : 12;
  return {
    icon: 'crab-claw',
    needsTarget: true,
    text: `Deal ${d} damage. Apply 2 Vulnerable.`,
    play: (c, t) => {
      c.attack(t!, d);
      c.applyToEnemy(t!, 'vulnerable', 2);
    },
  };
});
def('hybrid', 'uncommon', 'attack', 1, 'parasite', 'Parasite', (u) => {
  const d = u ? 8 : 5;
  return {
    icon: 'tick',
    needsTarget: true,
    text: `Deal ${d} damage. Heal HP equal to the unblocked damage dealt.`,
    play: (c, t) => c.heal(c.attack(t!, d).hpLost),
  };
});
def('hybrid', 'uncommon', 'system', 1, 'thick_hide', 'Thick Hide', (u) => {
  const n = u ? 2 : 1;
  return {
    icon: 'scarab-beetle',
    text: `Corruption burns ${n} less HP each turn.`,
    play: (c) => {
      c.player.burnResist += n;
    },
  };
});
def('hybrid', 'rare', 'system', 3, 'apex_form', 'Apex Form', (u) => ({
  icon: 'oni',
  cost: u ? 2 : 3,
  text: 'The damage bonus from Corruption is doubled.',
  play: (c) => {
    c.player.corruptionMult *= 2;
  },
}));
def('hybrid', 'rare', 'attack', 2, 'devour', 'Devour', (u) => {
  const d = u ? 18 : 14;
  const h = u ? 14 : 10;
  return {
    icon: 'gluttonous-smile',
    needsTarget: true,
    text: `Deal ${d} damage. If this kills the target, heal ${h} HP.`,
    play: (c, t) => {
      if (c.attack(t!, d).killed) c.heal(h);
    },
  };
});
def('hybrid', 'rare', 'tactic', 1, 'hive_scream', 'Hive Scream', (u) => {
  const n = u ? 3 : 2;
  return {
    icon: 'screaming',
    exhaust: true,
    text: `Apply ${n} Weak and ${n} Vulnerable to ALL enemies. Gain 2 Corruption. Exhaust.`,
    play: (c) => {
      c.applyToAll('weak', n);
      c.applyToAll('vulnerable', n);
      c.gainCorruption(2);
    },
  };
});
def('hybrid', 'rare', 'attack', 1, 'unleash', 'Unleash', (u) => {
  const per = u ? 5 : 4;
  return {
    icon: 'alien-fire',
    needsTarget: true,
    text: `Lose ALL Corruption. Deal ${per} damage for each point lost.`,
    play: (c, t) => {
      const lost = c.player.corruption;
      c.gainCorruption(-lost);
      c.attack(t!, per * lost);
    },
  };
});

// ====================================================================
// SPECIAL
// ====================================================================

export const SCAR: CardDef = {
  id: 'scar',
  name: 'Scar',
  type: 'scar',
  rarity: 'special',
  owner: 'none',
  cost: 0,
  unplayable: true,
  icon: 'scar-wound',
  text: 'Unplayable. The price of a Reset.',
};

/** Jams the hand for one combat. Added by enemy moves. */
export const STATIC: CardDef = {
  id: 'static',
  name: 'Static',
  type: 'scar',
  rarity: 'special',
  owner: 'none',
  cost: 0,
  unplayable: true,
  icon: 'electric',
  text: 'Unplayable. Gone after this combat.',
};

CARDS[SCAR.id] = SCAR;
CARDS[STATIC.id] = STATIC;

// ====================================================================
// CARD MODS — random modifiers rolled on reward and shop cards
// ====================================================================

interface ModSpec extends CardMod {
  applies: (def: CardDef) => boolean;
  apply: (def: CardDef) => Partial<CardDef>;
}

const wrap =
  (def: CardDef, before: (c: Combat) => void, after: (c: Combat) => void): CardDef['play'] =>
  (c, t) => {
    before(c);
    def.play?.(c, t);
    after(c);
  };

const MOD_SPECS: ModSpec[] = [
  {
    id: 'hair_trigger',
    name: 'Hair-trigger',
    text: '+15% crit chance for this card.',
    applies: (d) => d.type === 'attack',
    apply: (d) => ({
      play: wrap(
        d,
        (c) => void (c.player.tempCrit += 0.15),
        (c) => void (c.player.tempCrit -= 0.15),
      ),
    }),
  },
  {
    id: 'lightweight',
    name: 'Lightweight',
    text: 'Costs 1 less Energy.',
    applies: (d) => d.cost >= 1 && d.rarity !== 'rare',
    apply: (d) => ({ cost: Math.max(0, d.cost - 1) }),
  },
  {
    id: 'reinforced',
    name: 'Reinforced',
    text: 'Also gain 3 Block.',
    applies: () => true,
    apply: (d) => ({
      play: wrap(
        d,
        () => undefined,
        (c) => c.gainBlock(3),
      ),
    }),
  },
  {
    id: 'charged',
    name: 'Charged',
    text: '+2 damage per hit for this card.',
    applies: (d) => d.type === 'attack',
    apply: (d) => ({
      play: wrap(
        d,
        (c) => void (c.player.statuses.strength += 2),
        (c) => void (c.player.statuses.strength -= 2),
      ),
    }),
  },
];

export const MODS: CardMod[] = MOD_SPECS.map(({ id, name, text }) => ({ id, name, text }));

/** Ids of the mods this card could roll. */
export function modsFor(def: CardDef): string[] {
  return def.mod || def.unplayable ? [] : MOD_SPECS.filter((m) => m.applies(def)).map((m) => m.id);
}

/** The card with a mod attached. Its id is "<card id>~<mod id>", and the mod survives upgrades. */
export function withMod(def: CardDef, modId: string): CardDef {
  const id = `${def.id}~${modId}`;
  if (CARDS[id]) return CARDS[id];
  const spec = MOD_SPECS.find((m) => m.id === modId);
  if (!spec) throw new Error(`Unknown card mod: ${modId}`);
  const modded: CardDef = {
    ...def,
    ...spec.apply(def),
    id,
    mod: { id: spec.id, name: spec.name, text: spec.text },
    upgradesTo: def.upgradesTo ? `${def.upgradesTo}~${modId}` : undefined,
  };
  CARDS[id] = modded;
  return modded;
}

/** Looks a card up by id, including modded ids like "sidearm+~charged". */
export const card = (id: string): CardDef => {
  const found = CARDS[id];
  if (found) return found;
  const [baseId, modId] = id.split('~');
  if (modId && CARDS[baseId]) return withMod(CARDS[baseId], modId);
  throw new Error(`Unknown card: ${id}`);
};

/** Cards a class can be offered as rewards or in shops. */
export function rewardPool(classId: ClassId): CardDef[] {
  return Object.values(CARDS).filter(
    (c) =>
      !c.upgraded &&
      !c.mod &&
      (c.owner === classId || c.owner === 'neutral') &&
      (c.rarity === 'common' || c.rarity === 'uncommon' || c.rarity === 'rare'),
  );
}
