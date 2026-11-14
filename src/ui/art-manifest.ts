import data from './art-data.json';
import type { CharacterArt, EffectName, MusicId, Scene, SceneId, SfxName, Sheet } from './assets';

/**
 * Which downloaded file is used for what. Sources and licences are in CREDITS.md.
 * Sprite sheets and their frame layouts (art-data.json) are produced by
 * scripts/build-sprites.mjs; sounds by scripts/build-audio.mjs.
 * Leave an entry out and the game falls back to a flat icon or a synthesised sound.
 */

interface CharLayout {
  src: string;
  fw: number;
  fh: number;
  anims: Record<string, { row: number; frames: number }>;
}

interface CharOptions {
  /** Whole-number (or .5) zoom of the pixel art. */
  scale: number;
  /** The art faces right; mirror it so enemies face the player. */
  flip?: boolean;
  /** Idle frames per second. */
  fps?: number;
}

const layouts = data.chars as Record<string, CharLayout>;

function character(id: string, opts: CharOptions): CharacterArt | undefined {
  const layout = layouts[id];
  if (!layout?.anims.idle) return undefined;
  const sheet = (name: string, fps: number): Sheet | undefined => {
    const anim = layout.anims[name];
    return anim && { src: layout.src, fw: layout.fw, fh: layout.fh, frames: anim.frames, row: anim.row, fps };
  };
  return {
    idle: sheet('idle', opts.fps ?? 6)!,
    attack: sheet('attack', 12),
    hurt: sheet('hurt', 10),
    death: sheet('death', 8),
    height: Math.round(layout.fh * opts.scale),
    flip: opts.flip,
  };
}

function characters(table: Record<string, CharOptions>): Record<string, CharacterArt> {
  const out: Record<string, CharacterArt> = {};
  for (const [id, opts] of Object.entries(table)) {
    const art = character(id, opts);
    if (art) out[id] = art;
  }
  return out;
}

/** Keyed by enemy id (see engine/enemies.ts). */
export const ENEMY_ART = characters({
  // Act 1
  drone: { scale: 2, fps: 8 },
  spitter: { scale: 3 },
  bulwark: { scale: 3, flip: true },
  leaper: { scale: 3 },
  alpha: { scale: 3, fps: 7 },
  crusher: { scale: 3, flip: true, fps: 3 },
  brood_mother: { scale: 2, flip: true, fps: 9 },
  // Act 2
  stalker: { scale: 2, fps: 10 },
  screamer: { scale: 2.5 },
  burrower: { scale: 3, flip: true },
  swarmling: { scale: 2, flip: true, fps: 4 },
  ravager: { scale: 2.5 },
  matriarch: { scale: 2, fps: 8 },
  siege_titan: { scale: 3, flip: true, fps: 7 },
  // Act 3
  warden: { scale: 2, fps: 4 },
  leech: { scale: 3 },
  hunter: { scale: 2.5, flip: true, fps: 10 },
  praetorian: { scale: 2, fps: 5 },
  omega: { scale: 2, fps: 7 },
});

/** Keyed by class id (see engine/classes.ts). */
export const CLASS_ART = characters({
  grunt: { scale: 2, fps: 4 },
  scout: { scale: 2 },
  engineer: { scale: 3, fps: 5 },
  veteran: { scale: 2, fps: 5 },
  hybrid: { scale: 3, fps: 5 },
});

const fx = data.fx as Record<string, { src: string; fw: number; fh: number; frames: number }>;

/** `size` is the height on screen in CSS pixels. */
function effect(name: string, size: number, fps: number): (Sheet & { size: number }) | undefined {
  return fx[name] && { ...fx[name], fps, size };
}

export const EFFECT_ART: Partial<Record<EffectName, Sheet & { size: number }>> = {
  hit: effect('hit', 96, 20),
  crit: effect('crit', 170, 18),
  explosion: effect('explosion', 190, 16),
  shield: effect('shield', 130, 16),
  heal: effect('heal', 170, 36),
};

export const SCENES: Partial<Record<SceneId, Scene>> = {
  title: { layers: ['art/bg/title.png'], dim: 0.35, position: 'center center' },
  map: { layers: ['art/bg/map.png'], dim: 0.6 },
  act0: { layers: ['art/bg/act0.png'], dim: 0.5 },
  act1: { layers: ['art/bg/act1.png'], dim: 0.5 },
  // Small tiling layers, scaled up and scrolled slowly at different speeds.
  // Small tiling layers, scaled up and scrolled slowly at different speeds:
  // an alien sky behind, black hive girders in front.
  act2: { layers: ['art/bg/act2-back.png', 'art/bg/act2-front.png'], drift: [300, 140], dim: 0.5 },
};

/** audio/sfx/<name>-1.ogg ... -<count>.ogg, as written by scripts/build-audio.mjs. */
const variants = (name: SfxName, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `audio/sfx/${name}-${i + 1}.ogg`);

/** Several files for one sound are picked from at random. */
export const SFX_FILES: Partial<Record<SfxName, string[]>> = {
  click: variants('click', 3),
  card: variants('card', 4),
  draw: variants('draw', 2),
  hit: variants('hit', 5),
  crit: variants('crit', 3),
  hurt: variants('hurt', 4),
  block: variants('block', 3),
  blocked: variants('blocked', 3),
  heal: variants('heal', 3),
  miss: variants('miss', 3),
  enemy: variants('enemy', 5),
  die: variants('die', 4),
  buy: variants('buy', 2),
  deny: variants('deny', 3),
  reset: variants('reset', 1),
  win: variants('win', 1),
  lose: variants('lose', 1),
  roar: variants('roar', 1),
  shoot: variants('shoot', 2),
  explosion: variants('explosion', 3),
  dice: variants('dice', 3),
};

export const MUSIC_FILES: Partial<Record<MusicId, string>> = {
  title: 'audio/music/title.ogg',
  map: 'audio/music/map.ogg',
  combat: 'audio/music/combat.ogg',
  boss: 'audio/music/boss.ogg',
  calm: 'audio/music/calm.ogg',
};
