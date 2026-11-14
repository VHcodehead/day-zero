/**
 * Everything the UI loads from public/: sprite sheets, backgrounds, sounds and music.
 * The tables in art-manifest.ts say which file is used for what. Anything missing from
 * a table falls back to the flat icons and synthesised sounds, so the game always runs.
 */

/**
 * Absolute, because these URLs end up in CSS custom properties, and a relative url() there is
 * resolved against the stylesheet (in /assets/), not the page.
 */
export const BASE = new URL(import.meta.env.BASE_URL, document.baseURI).href;
export const assetUrl = (path: string): string => `${BASE}${path}`;

/** One animation: a horizontal strip of equal frames inside an image. */
export interface Sheet {
  /** Path under public/, e.g. "art/enemies/drone.png". */
  src: string;
  /** Frame size in image pixels. */
  fw: number;
  fh: number;
  frames: number;
  /** Frames per second. Default 8. */
  fps?: number;
  /** Row of the strip in a grid sheet, counted from 0. */
  row?: number;
  /** Column of the first frame. */
  col?: number;
}

export interface CharacterArt {
  idle: Sheet;
  attack?: Sheet;
  hurt?: Sheet;
  death?: Sheet;
  /** Height on screen in CSS pixels. */
  height: number;
  /** Mirror horizontally, for art drawn facing the wrong way. */
  flip?: boolean;
  /** Extra pixels to shift down, for sheets with empty space under the feet (in screen pixels). */
  drop?: number;
}

export type EffectName = 'hit' | 'crit' | 'slash' | 'explosion' | 'shield' | 'heal' | 'acid' | 'buff';

export interface Scene {
  /** Image paths, back to front. */
  layers: string[];
  /** Seconds for each layer to scroll one full width. 0 or missing = still. */
  drift?: number[];
  /** How dark the readability overlay is, 0..1. */
  dim?: number;
  /** CSS background-size for the layers. Default "cover". */
  size?: string;
  /** CSS background-position. Default "center bottom". */
  position?: string;
  /** CSS filter for the layers, e.g. to brighten dark art. */
  filter?: string;
}

export type SceneId = 'title' | 'map' | 'act0' | 'act1' | 'act2';

export type SfxName =
  | 'click'
  | 'card'
  | 'draw'
  | 'hit'
  | 'crit'
  | 'hurt'
  | 'block'
  | 'blocked'
  | 'heal'
  | 'miss'
  | 'enemy'
  | 'die'
  | 'buy'
  | 'deny'
  | 'reset'
  | 'win'
  | 'lose'
  | 'roar'
  | 'shoot'
  | 'explosion'
  | 'dice';

export type MusicId = 'title' | 'map' | 'combat' | 'boss' | 'calm';

// ---------- sprite rendering ----------

function spriteStyle(sheet: Sheet, height: number, loop: boolean): string {
  const scale = height / sheet.fh;
  const col = sheet.col ?? 0;
  const dur = sheet.frames / (sheet.fps ?? 8);
  // A negative delay keeps looping animations in step across re-renders.
  const delay = loop ? -((performance.now() / 1000) % dur) : 0;
  return [
    `--img:url('${assetUrl(sheet.src)}')`,
    `--fw:${sheet.fw}`,
    `--fh:${sheet.fh}`,
    `--s:${scale.toFixed(4)}`,
    `--n:${sheet.frames}`,
    `--x0:${-col * sheet.fw}px`,
    `--x1:${-(col + sheet.frames - 1) * sheet.fw}px`,
    `--y:${-(sheet.row ?? 0) * sheet.fh}px`,
    `--dur:${dur.toFixed(3)}s`,
    `--delay:${delay.toFixed(3)}s`,
  ].join(';');
}

const spriteClasses = (sheet: Sheet, once: boolean, flip: boolean, extra: string): string =>
  ['sprite', sheet.frames < 2 ? 'still' : '', once ? 'once' : '', flip ? 'flip' : '', extra].filter(Boolean).join(' ');

/** HTML for an animated sprite. `once` plays it a single time and holds the last frame. */
export function spriteHtml(
  sheet: Sheet,
  height: number,
  opts: { cls?: string; once?: boolean; flip?: boolean; held?: boolean; attrs?: string } = {},
): string {
  const once = !!opts.once || !!opts.held;
  // "held" shows the final frame without playing: a corpse that has already fallen.
  const shown: Sheet = opts.held ? { ...sheet, col: (sheet.col ?? 0) + sheet.frames - 1, frames: 1 } : sheet;
  return `<div class="${spriteClasses(shown, once, !!opts.flip, opts.cls ?? '')}" ${opts.attrs ?? ''} style="${spriteStyle(shown, height, !once)}"><i></i></div>`;
}

/** Switches an existing sprite element to another animation, restarting it. */
export function setSprite(el: HTMLElement, sheet: Sheet, height: number, once: boolean): void {
  const flip = el.classList.contains('flip');
  const keep = [...el.classList].filter((c) => !['sprite', 'still', 'once', 'flip'].includes(c)).join(' ');
  el.className = spriteClasses(sheet, once, flip, keep);
  el.style.cssText = spriteStyle(sheet, height, !once);
  el.replaceChildren(document.createElement('i')); // a new node restarts the CSS animation
}

export const sheetSeconds = (sheet: Sheet): number => sheet.frames / (sheet.fps ?? 8);
