import type { Fx } from '../engine/types';
import { CLASS_ART, EFFECT_ART, ENEMY_ART } from './art-manifest';
import { setSprite, sheetSeconds, spriteHtml, type CharacterArt, type EffectName } from './assets';
import { fxSound } from './sound';

const layer = document.querySelector<HTMLDivElement>('#fx-layer')!;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- character animations ----------

/** Art for a sprite element, from its data-art attribute ("enemy:drone", "class:grunt"). */
function artOf(el: HTMLElement): CharacterArt | undefined {
  const [kind, id] = (el.dataset.art ?? '').split(':');
  return (kind === 'enemy' ? ENEMY_ART : CLASS_ART)[id];
}

/**
 * Plays a one-shot animation (attack or hurt) on the character inside `target`, then returns it
 * to idle. Does nothing if that character has no such animation. Returns its length in ms.
 */
export function playCharAnim(target: Element | null, anim: 'attack' | 'hurt'): number {
  const el = target?.querySelector<HTMLElement>('.sprite.char:not(.corpse)');
  const art = el && artOf(el);
  const sheet = art?.[anim];
  if (!el || !art || !sheet) return 0;
  const ms = sheetSeconds(sheet) * 1000;
  setSprite(el, sheet, art.height, true);
  el.dataset.anim = anim;
  setTimeout(() => {
    // Skip if the element was re-rendered away or has started another animation since.
    if (el.isConnected && el.dataset.anim === anim) {
      setSprite(el, art.idle, art.height, false);
      delete el.dataset.anim;
    }
  }, ms);
  return ms;
}

// ---------- effect sprites ----------

/** Plays an effect sprite sheet once, centred on an element. */
export function spawnEffect(name: EffectName, on: Element): void {
  const art = EFFECT_ART[name];
  if (!art) return;
  const rect = on.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'effect';
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height * 0.42}px`;
  el.innerHTML = spriteHtml(art, art.size, { once: true });
  layer.append(el);
  setTimeout(() => el.remove(), sheetSeconds(art) * 1000);
}

function effectFor(e: Fx): EffectName | null {
  switch (e.kind) {
    case 'hit':
      return e.crit && EFFECT_ART.crit ? 'crit' : 'hit';
    case 'block':
      return 'shield';
    case 'heal':
      return 'heal';
    default:
      return null;
  }
}

// ---------- floating numbers ----------

function describe(e: Fx): { text: string; cls: string; shake: boolean } {
  switch (e.kind) {
    case 'hit':
      return { text: `${e.amount}${e.crit ? '!' : ''}`, cls: e.crit ? 'crit' : 'dmg', shake: true };
    case 'blocked':
      return { text: 'BLOCKED', cls: 'info', shake: false };
    case 'miss':
      return { text: 'EVADED', cls: 'good', shake: false };
    case 'block':
      return { text: `+${e.amount} 🛡`, cls: 'block', shake: false };
    case 'heal':
      return { text: `+${e.amount}`, cls: 'good', shake: false };
    case 'text':
      return { text: e.text, cls: e.tone, shake: false };
  }
}

function show(e: Fx): void {
  const el = document.querySelector<HTMLElement>(`[data-fx="${e.target}"]`);
  if (!el) return;
  const { text, cls, shake } = describe(e);
  fxSound(e);

  const effect = effectFor(e);
  if (effect) spawnEffect(effect, el.querySelector('.sprite.char') ?? el);
  if (e.kind === 'hit') playCharAnim(el, 'hurt');

  const rect = el.getBoundingClientRect();
  const float = document.createElement('div');
  float.className = `float ${cls}`;
  float.textContent = text;
  float.style.left = `${rect.left + rect.width * (0.3 + Math.random() * 0.4)}px`;
  float.style.top = `${rect.top + rect.height * 0.35}px`;
  layer.append(float);
  float.addEventListener('animationend', () => float.remove());
  if (shake) {
    el.classList.remove('shake');
    void el.offsetWidth; // restart the animation if it is already running
    el.classList.add('shake');
  }
}

/** Shows floating numbers for engine events, one after another. Resolves when the last has started. */
export async function playFx(events: Fx[]): Promise<void> {
  const step = events.length > 6 ? 70 : 110;
  events.forEach((e, i) => setTimeout(() => show(e), i * step));
  if (events.length) await sleep(Math.min(events.length * step, 700));
}

/** A played card lifts off the hand and fades. Call before re-rendering. */
export function flyCard(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.className = `${ghost.className.replace(/draw-in|selected/g, '')} card-fly`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.animationDelay = '0s';
  layer.append(ghost);
  ghost.addEventListener('animationend', () => ghost.remove());
}

/** Full-screen "time rewinds" flash for a Reset. Runs `midway` while the screen is covered. */
export async function rewindFx(midway: () => void): Promise<void> {
  const el = document.createElement('div');
  el.className = 'rewind';
  el.innerHTML = '<span>⟲ RESET</span>';
  layer.append(el);
  await sleep(450);
  midway();
  await sleep(550);
  el.remove();
}
