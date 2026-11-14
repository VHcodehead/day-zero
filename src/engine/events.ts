import type { Run } from './run';

export interface EventChoice {
  label: string;
  /** What the choice costs or gives, shown under the label. */
  detail: string;
  /** Base success chance (0..1). Omit for a sure thing. */
  chance?: number;
  disabled?: boolean;
  /** Applies the outcome and returns the text shown to the player. */
  resolve: (run: Run, success: boolean) => string;
}

export interface EventDef {
  id: string;
  title: string;
  icon: string;
  text: string;
  choices: (run: Run) => EventChoice[];
}

const leave = (label = 'Move on'): EventChoice => ({
  label,
  detail: 'Nothing happens.',
  resolve: () => 'You keep moving.',
});

export const EVENTS: EventDef[] = [
  {
    id: 'dropship',
    title: 'Downed Dropship',
    icon: 'radio-tower',
    text: 'A dropship lies broken in the sand, still smoking. The weapons locker is sealed, and the wreck is in plain view of the ridge.',
    choices: () => [
      {
        label: 'Hotwire the locker',
        detail: 'Success: a rare card and 30 Scrap. Failure: lose 10 HP.',
        chance: 0.6,
        resolve: (run, ok) => {
          if (!ok) {
            run.loseHp(10);
            return 'The alarm shrieks. Something on the ridge opens fire before you get clear. You lose 10 HP.';
          }
          run.gainScrap(30);
          return `The lock gives. Inside: ${run.addRandomCard('rare').name} and 30 Scrap.`;
        },
      },
      {
        label: 'Strip the hull for parts',
        detail: 'Gain 35 Scrap.',
        resolve: (run) => {
          run.gainScrap(35);
          return 'You pull what you can carry. +35 Scrap.';
        },
      },
      leave(),
    ],
  },
  {
    id: 'wounded',
    title: 'Wounded Soldier',
    icon: 'radio-tower',
    text: 'A soldier is pinned under a slab of concrete. You have found him here before. He never makes it on his own.',
    choices: () => [
      {
        label: 'Carry him to the medics',
        detail: 'Lose 7 HP. He gives you something rare.',
        resolve: (run) => {
          run.loseHp(7);
          return `It costs you. At the aid station he presses something into your hand: ${run.addRandomCard('rare').name}.`;
        },
      },
      {
        label: 'Take his kit',
        detail: 'Gain a stim and 25 Scrap. Add a Scar to your deck.',
        resolve: (run) => {
          const stim = run.gainRandomStim();
          run.gainScrap(25);
          run.addScar();
          return `You take ${stim ? stim.name : 'what little he has'} and 25 Scrap, and you do not look back. A Scar is added to your deck.`;
        },
      },
      leave('Leave him'),
    ],
  },
  {
    id: 'armory',
    title: 'Abandoned Armory',
    icon: 'radio-tower',
    text: 'A field armory, left in a hurry. The workbench still has power.',
    choices: () => [
      {
        label: 'Tune your gear',
        detail: 'Upgrade 2 random cards.',
        resolve: (run) => {
          const names = [run.upgradeRandomCard(), run.upgradeRandomCard()].filter(Boolean).map((c) => c!.name);
          return names.length ? `Upgraded: ${names.join(', ')}.` : 'There is nothing left to upgrade.';
        },
      },
      {
        label: 'Grab supplies',
        detail: 'Gain a stim and 20 Scrap.',
        resolve: (run) => {
          const stim = run.gainRandomStim();
          run.gainScrap(20);
          return `${stim ? `You pocket a ${stim.name}` : 'Your pouches are full'} and 20 Scrap.`;
        },
      },
    ],
  },
  {
    id: 'minefield',
    title: 'Minefield',
    icon: 'radio-tower',
    text: 'A supply crate sits in the middle of a minefield. Some loops you remember the safe path. This is not one of them.',
    choices: () => [
      {
        label: 'Go for the crate',
        detail: 'Success: a piece of gear. Failure: lose 14 HP.',
        chance: 0.55,
        resolve: (run, ok) => {
          if (!ok) {
            run.loseHp(14);
            return 'Click. You lose 14 HP and the crate is in pieces.';
          }
          const gear = run.gainRandomGear();
          return gear ? `You make it. Inside: ${gear.name}.` : 'You make it, but the crate is empty.';
        },
      },
      leave('Walk around'),
    ],
  },
  {
    id: 'echo',
    title: 'Time Echo',
    icon: 'radio-tower',
    text: 'For a second you see yourself lying dead right here, from a loop you do not remember. The image hangs in the air, waiting.',
    choices: (run) => [
      {
        label: 'Take the memory',
        detail: 'Gain 1 Reset. Lose 8 max HP.',
        resolve: (r) => {
          r.resets++;
          r.maxHp -= 8;
          r.hp = Math.min(r.hp, r.maxHp);
          return 'You remember dying. It hurts every time. +1 Reset, −8 max HP.';
        },
      },
      {
        label: 'Let it go',
        detail: 'Remove a Scar from your deck and heal 10 HP.',
        disabled: !run.deck.some((c) => c.type === 'scar'),
        resolve: (r) => {
          r.removeScar();
          r.heal(10);
          return 'The image fades, and something old in you fades with it. A Scar is removed. +10 HP.';
        },
      },
      leave('Look away'),
    ],
  },
  {
    id: 'medic',
    title: 'Field Medic',
    icon: 'radio-tower',
    text: 'A medic has set up in a crater. She has supplies, and an untested serum she is a little too keen to try.',
    choices: (run) => [
      {
        label: 'Pay for treatment',
        detail: 'Pay 30 Scrap. Heal 25 HP.',
        disabled: run.scrap < 30,
        resolve: (r) => {
          r.scrap -= 30;
          r.heal(25);
          return 'Stitches, a shot, and a pat on the helmet. +25 HP.';
        },
      },
      {
        label: 'Try the serum',
        detail: 'Success: +8 max HP. Failure: lose 8 HP.',
        chance: 0.5,
        resolve: (r, ok) => {
          if (!ok) {
            r.loseHp(8);
            return 'Your veins burn for an hour. You lose 8 HP.';
          }
          r.maxHp += 8;
          r.heal(8);
          return 'You feel ten years younger. +8 max HP.';
        },
      },
      {
        label: 'Patch yourself up',
        detail: 'Heal 8 HP.',
        resolve: (r) => {
          r.heal(8);
          return 'You borrow some bandages. +8 HP.';
        },
      },
    ],
  },
  {
    id: 'eggs',
    title: 'Egg Cluster',
    icon: 'radio-tower',
    text: 'A cluster of translucent eggs pulses in a shell hole. Command pays a bounty for burning them. The glands are worth more, if you can cut them out.',
    choices: () => [
      {
        label: 'Harvest the glands',
        detail: 'Success: 2 stims. Failure: lose 8 HP.',
        chance: 0.65,
        resolve: (run, ok) => {
          if (!ok) {
            run.loseHp(8);
            return 'One hatches in your hands. You lose 8 HP.';
          }
          const got = [run.gainRandomStim(), run.gainRandomStim()].filter(Boolean).map((s) => s!.name);
          return got.length ? `You distil: ${got.join(', ')}.` : 'Your pouches are full. You leave the glands behind.';
        },
      },
      {
        label: 'Burn it',
        detail: 'Gain 20 Scrap.',
        resolve: (run) => {
          run.gainScrap(20);
          return 'It burns green. You log the bounty. +20 Scrap.';
        },
      },
    ],
  },
  {
    id: 'deserter',
    title: 'The Deserter',
    icon: 'radio-tower',
    text: 'A soldier sits against a wall, rolling dice. "You too, huh? How many times?" He is looping. He has just stopped trying.',
    choices: (run) => [
      {
        label: 'Trade stories',
        detail: 'Upgrade a random card.',
        resolve: (r) => {
          const up = r.upgradeRandomCard();
          return up ? `He shows you a trick he learned on loop 200. Upgraded: ${up.name}.` : 'You have nothing left to learn from him.';
        },
      },
      {
        label: 'Play him at dice',
        detail: 'Bet 25 Scrap. Win: get 60 back.',
        chance: 0.5,
        disabled: run.scrap < 25,
        resolve: (r, ok) => {
          r.scrap -= 25;
          if (!ok) return 'He has rolled these dice ten thousand times. You lose 25 Scrap.';
          r.gainScrap(60);
          return 'He laughs. "First time that has happened." You take 60 Scrap.';
        },
      },
      leave(),
    ],
  },
  {
    id: 'bunker',
    title: 'Sealed Bunker',
    icon: 'radio-tower',
    text: 'A command bunker, sealed from the inside. No one answers. The door is thick, but the hinges are rusted.',
    choices: () => [
      {
        label: 'Force the door',
        detail: 'Success: a piece of gear and 40 Scrap. Failure: lose 6 HP.',
        chance: 0.4,
        resolve: (run, ok) => {
          if (!ok) {
            run.loseHp(6);
            return 'The door does not move. Your shoulder does. You lose 6 HP.';
          }
          const gear = run.gainRandomGear();
          run.gainScrap(40);
          return `The hinges shear. ${gear ? `You find ${gear.name}` : 'The racks are bare'} and 40 Scrap.`;
        },
      },
      leave(),
    ],
  },
];
