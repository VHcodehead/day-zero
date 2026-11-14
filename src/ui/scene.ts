import type { Run } from '../engine/run';
import { MUSIC_FILES, SCENES } from './art-manifest';
import { assetUrl, type MusicId, type SceneId } from './assets';

/**
 * The backdrop behind the whole UI. It lives outside #app so it is not rebuilt on every
 * render, and only changes when the scene id changes.
 */

const root = document.querySelector<HTMLDivElement>('#scene')!;
let current: string | null = null;

export function sceneFor(run: Run | null): SceneId {
  if (!run) return 'title';
  if (run.phase === 'map' || run.phase === 'gear') return 'map';
  return `act${run.act}` as SceneId;
}

/** Which music fits the screen, falling back to a nearby track if one is not installed. */
export function musicFor(run: Run | null): MusicId | null {
  const first = (...ids: MusicId[]): MusicId | null => ids.find((id) => MUSIC_FILES[id]) ?? null;
  if (!run) return first('title', 'map');
  switch (run.phase) {
    case 'combat':
    case 'dead':
      return run.nodeType === 'boss' ? first('boss', 'combat') : first('combat');
    case 'shop':
    case 'camp':
    case 'event':
    case 'market':
      return first('calm', 'map');
    case 'victory':
    case 'gameover':
      return null;
    default:
      return first('map', 'calm');
  }
}

/** Scrolling layers need to know how wide one copy of the image is on screen. */
function sizeLayer(el: HTMLElement, img: HTMLImageElement): void {
  if (!img.naturalHeight) return;
  el.style.setProperty('--tile', `${Math.round((img.naturalWidth * root.clientHeight) / img.naturalHeight)}px`);
}

export function setScene(id: SceneId): void {
  if (id === current) return;
  current = id;
  const scene = SCENES[id];
  root.replaceChildren();
  root.dataset.scene = id;
  if (!scene) return;

  scene.layers.forEach((path, i) => {
    const el = document.createElement('div');
    const seconds = scene.drift?.[i] ?? 0;
    el.className = `scene-layer ${seconds ? 'drift' : ''}`;
    el.style.backgroundImage = `url('${assetUrl(path)}')`;
    el.style.backgroundSize = seconds ? 'auto 100%' : (scene.size ?? 'cover');
    el.style.backgroundPosition = scene.position ?? 'center bottom';
    if (scene.filter) el.style.filter = scene.filter;
    if (seconds) {
      el.style.setProperty('--drift', `${seconds}s`);
      const img = new Image();
      img.onload = () => sizeLayer(el, img);
      img.src = assetUrl(path);
      window.addEventListener('resize', () => sizeLayer(el, img));
    }
    root.append(el);
  });

  const dim = document.createElement('div');
  dim.className = 'scene-dim';
  dim.style.opacity = String(scene.dim ?? 0.55);
  root.append(dim);
}
