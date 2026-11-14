import type { Fx } from '../engine/types';
import { MUSIC_FILES, SFX_FILES } from './art-manifest';
import { assetUrl, type MusicId, type SfxName } from './assets';
import { S } from './state';

/**
 * Sound effects and music.
 * Effects play a sampled file when art-manifest.ts lists one, and otherwise fall back to a
 * tone synthesised with Web Audio. Browsers only allow audio after a click or key press,
 * so nothing loads or plays until unlockAudio() has been called from one.
 */

const SFX_VOLUME = 0.6;
const MUSIC_VOLUME = 0.32;

let ctx: AudioContext | null = null;
let unlocked = false;
const buffers = new Map<string, AudioBuffer>();

function audio(): AudioContext | null {
  if (S.meta.muted || !unlocked) return null;
  try {
    ctx ??= new AudioContext();
  } catch {
    return null;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

async function loadSample(url: string): Promise<void> {
  if (buffers.has(url) || !ctx) return;
  try {
    const data = await (await fetch(url)).arrayBuffer();
    buffers.set(url, await ctx.decodeAudioData(data));
  } catch {
    // A missing or undecodable file just means that sound stays synthesised.
  }
}

/** Call from the first click or key press. Starts loading samples and any pending music. */
export function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  try {
    ctx ??= new AudioContext();
  } catch {
    return;
  }
  for (const files of Object.values(SFX_FILES)) {
    for (const file of files ?? []) void loadSample(assetUrl(file));
  }
  music.refresh();
}

/** Plays a sampled sound. Returns false if there is none ready, so the caller can synthesise. */
function sample(name: SfxName, volume = 1): boolean {
  const files = SFX_FILES[name];
  const ac = audio();
  if (!ac || !files?.length) return false;
  const buffer = buffers.get(assetUrl(files[Math.floor(Math.random() * files.length)]));
  if (!buffer) return false;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 0.94 + Math.random() * 0.12; // slight variation so repeats don't sound identical
  const gain = ac.createGain();
  gain.gain.value = SFX_VOLUME * volume;
  src.connect(gain).connect(ac.destination);
  src.start();
  return true;
}

// ---------- synthesised fallbacks ----------

interface ToneOptions {
  type?: OscillatorType;
  vol?: number;
  /** Frequency to slide to by the end of the note. */
  to?: number;
  delay?: number;
}

function tone(freq: number, dur: number, opts: ToneOptions = {}): void {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + (opts.delay ?? 0);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = opts.type ?? 'square';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
  gain.gain.setValueAtTime(opts.vol ?? 0.06, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A burst of filtered noise: impacts, swishes. */
function noise(dur: number, vol: number, cutoff: number): void {
  const ac = audio();
  if (!ac) return;
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(vol, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start();
}

const jingle = (notes: number[], gap: number, opts: ToneOptions): void =>
  notes.forEach((f, i) => tone(f, gap * 1.8, { ...opts, delay: i * gap }));

const SYNTH: Record<SfxName, () => void> = {
  click: () => tone(520, 0.05, { type: 'triangle', vol: 0.05 }),
  card: () => {
    noise(0.07, 0.05, 5000);
    tone(300, 0.08, { type: 'triangle', to: 620, vol: 0.04 });
  },
  draw: () => noise(0.05, 0.03, 7000),
  hit: () => {
    noise(0.12, 0.13, 1400);
    tone(150, 0.12, { type: 'sawtooth', to: 60, vol: 0.06 });
  },
  crit: () => {
    noise(0.18, 0.17, 2600);
    tone(880, 0.08, { vol: 0.04 });
    tone(1320, 0.16, { vol: 0.04, delay: 0.06 });
  },
  hurt: () => {
    noise(0.16, 0.15, 700);
    tone(110, 0.2, { type: 'sawtooth', to: 45, vol: 0.08 });
  },
  block: () => tone(240, 0.09, { type: 'triangle', to: 180, vol: 0.07 }),
  blocked: () => {
    noise(0.05, 0.05, 6000);
    tone(900, 0.05, { vol: 0.025 });
  },
  heal: () => jingle([520, 780], 0.08, { type: 'sine', vol: 0.06 }),
  miss: () => noise(0.12, 0.05, 8000),
  enemy: () => tone(90, 0.18, { type: 'sawtooth', to: 140, vol: 0.05 }),
  die: () => {
    noise(0.35, 0.13, 900);
    tone(200, 0.35, { type: 'sawtooth', to: 40, vol: 0.05 });
  },
  buy: () => jingle([880, 1175], 0.06, { type: 'triangle', vol: 0.05 }),
  deny: () => tone(140, 0.12, { vol: 0.04 }),
  reset: () => tone(900, 0.9, { type: 'sawtooth', to: 60, vol: 0.06 }),
  win: () => jingle([523, 659, 784, 1047], 0.12, { type: 'triangle', vol: 0.07 }),
  lose: () => jingle([392, 330, 262, 196], 0.16, { type: 'sawtooth', vol: 0.045 }),
  roar: () => tone(70, 0.6, { type: 'sawtooth', to: 110, vol: 0.08 }),
  shoot: () => {
    noise(0.09, 0.12, 3000);
    tone(400, 0.07, { type: 'square', to: 120, vol: 0.04 });
  },
  explosion: () => {
    noise(0.5, 0.2, 500);
    tone(90, 0.5, { type: 'sawtooth', to: 30, vol: 0.08 });
  },
  dice: () => noise(0.2, 0.06, 4000),
};

/** sfx.hit(), sfx.card(), ... one function per sound name. */
export const sfx = Object.fromEntries(
  (Object.keys(SYNTH) as SfxName[]).map((name) => [
    name,
    () => {
      if (!sample(name)) SYNTH[name]();
    },
  ]),
) as Record<SfxName, () => void>;

/** The sound for one engine animation event. */
export function fxSound(e: Fx): void {
  switch (e.kind) {
    case 'hit':
      return e.target === 'player' ? sfx.hurt() : e.crit ? sfx.crit() : sfx.hit();
    case 'blocked':
      return sfx.blocked();
    case 'miss':
      return sfx.miss();
    case 'block':
      return sfx.block();
    case 'heal':
      return sfx.heal();
    default:
      return;
  }
}

// ---------- music ----------

const players = new Map<MusicId, HTMLAudioElement>();
let wanted: MusicId | null = null;
let playing: MusicId | null = null;

/** A newer fade on the same track cancels the older one, so a fade-out cannot pause a track that was asked for again. */
const fades = new WeakMap<HTMLAudioElement, number>();

function fade(el: HTMLAudioElement, to: number, then?: () => void): void {
  const from = el.volume;
  const start = performance.now();
  const id = (fades.get(el) ?? 0) + 1;
  fades.set(el, id);
  const step = (): void => {
    if (fades.get(el) !== id) return;
    const t = Math.min(1, (performance.now() - start) / 900);
    el.volume = from + (to - from) * t;
    if (t < 1) requestAnimationFrame(step);
    else then?.();
  };
  step();
}

export const music = {
  /** Asks for a track (or silence). Crossfades from whatever is playing. */
  set(track: MusicId | null): void {
    wanted = track;
    music.refresh();
  },

  /** Brings what is playing in line with what is wanted, the mute setting and the unlock state. */
  refresh(): void {
    const target = unlocked && !S.meta.muted && wanted && MUSIC_FILES[wanted] ? wanted : null;
    if (target === playing) return;
    const old = playing ? players.get(playing) : null;
    if (old) fade(old, 0, () => old.pause());
    playing = target;
    if (!target) return;
    let el = players.get(target);
    if (!el) {
      el = new Audio(assetUrl(MUSIC_FILES[target]!));
      el.loop = true;
      players.set(target, el);
    }
    el.volume = 0;
    void el.play().catch(() => {
      playing = null; // blocked or missing: stay silent and try again on the next refresh
    });
    fade(el, MUSIC_VOLUME);
  },
};
