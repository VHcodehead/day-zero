// Packs the chosen sprites from assets-staging/sprites into one sheet per character
// (public/art/chars/<id>.png, one animation per row) and one strip per effect
// (public/art/fx/<name>.png), and writes the frame layout to src/ui/art-data.json.
// Frames are trimmed to the pixels actually drawn and aligned bottom-centre, so
// sprites from different packs sit on the same ground line.
// Run with: node scripts/build-sprites.mjs     (needs: npm i -D pngjs)
// Sources and licences are in CREDITS.md and assets-staging/sprites/MANIFEST.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const ROOT = here('../assets-staging/sprites/');

const BUGS = 'redshrike-last-escape-bugs/';
const ARS = 'redshrike-ars-notoria/spritesheets/';
const SCIFI = 'ansimuz-sideview-sci-fi/Sideview Sci-Fi - Patreon Collection/Sprites/';
const GOTH = 'ansimuz-gothicvania/ gothicvania patreon collection/';
const CEM = 'ansimuz-gothicvania-cemetery/gothicvania-cemetery-files/PNG/Sprites/';
const SWAMP = 'ansimuz-gothicvania-swamp/Gothicvania Swamp files/Sprites/';
const CAVES = 'ansimuz-warped-caves/warped-files/PNG/';
const EYE = 'luizmelo-monsters-creatures-fantasy/Monsters_Creatures_Fantasy/Monsters_Creatures_Fantasy/Flying eye/';
const CITY2 = 'ansimuz-warped-city-2/cyberpunk city 2 files/Sprites/';
const SHOTFX = 'ansimuz-warped-shooting-fx/Warped shooting fx files/Pixelart/';
const GFX = 'ansimuz-sideview-fantasy/Sideview Fantasy Patreon Collection/Sprites/Grotto-escape-2-FX/PNG/spritesheets/';
const EXPL = 'ansimuz-animated-explosions/explosions-pack/spritesheets/';
const CM = 'codemanu-free-pixel-effects-pack/';

// ---------- ways to describe where frames are ----------

/** n frames in a row of a sheet. */
const strip = (file, n, fw, fh, row = 0, col = 0) =>
  Array.from({ length: n }, (_, i) => ({ file, x: (col + i) * fw, y: row * fh, w: fw, h: fh }));
/** Chosen cells of a grid, as [col, row] pairs in play order. */
const cells = (file, fw, fh, list) => list.map(([c, r]) => ({ file, x: c * fw, y: r * fh, w: fw, h: fh }));
/** Cells of a grid in reading order, from index `from` to `to` inclusive. */
const reading = (file, fw, fh, cols, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => [(from + i) % cols, Math.floor((from + i) / cols)]).map(([c, r]) => ({
    file,
    x: c * fw,
    y: r * fh,
    w: fw,
    h: fh,
  }));
/** Whole numbered files: pattern uses # for the number. */
const files = (pattern, from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ file: pattern.replace('#', String(from + i)), whole: true }));

const CHARS = {
  // ---- Act 1 ----
  drone: { idle: strip(BUGS + 'flyer_0.png', 3, 32, 64, 0), death: strip(BUGS + 'flyer_0.png', 4, 32, 64, 1) },
  spitter: { idle: strip(CAVES + 'spritesheets/enemies/octopus.png', 4, 28, 37) },
  bulwark: { idle: cells(BUGS + 'spider.png', 64, 64, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1]]) },
  leaper: {
    idle: strip(SCIFI + 'alien-walking-enemy/PNG/alien-enemy-idle.png', 4, 48, 48),
    attack: strip(SCIFI + 'alien-walking-enemy/PNG/alien-enemy-walk.png', 6, 57, 42),
  },
  alpha: { idle: files(CEM + 'hell-gato/hell-gato-#.png', 1, 4) },
  crusher: {
    idle: cells(BUGS + 'bossbeetle.png', 64, 64, [[0, 1], [1, 1]]),
    attack: strip(BUGS + 'bossbeetle.png', 4, 64, 64, 2),
  },
  brood_mother: { idle: strip(BUGS + 'bosswasp.png', 3, 128, 128) },
  // ---- Act 2 ----
  stalker: { idle: files(SCIFI + 'alien-flying-enemy/sprites/alien-enemy-flying#.png', 1, 8) },
  screamer: {
    idle: strip(GOTH + 'Ghost-Files/PNG/ghost-idle.png', 7, 64, 80),
    attack: strip(GOTH + 'Ghost-Files/PNG/ghost-shriek.png', 4, 64, 80),
    death: strip(GOTH + 'Ghost-Files/PNG/ghost-vanish.png', 7, 64, 64),
  },
  burrower: {
    idle: cells(BUGS + 'centipede_0.png', 64, 32, [[2, 0], [3, 0], [2, 1], [3, 1], [2, 2], [3, 2]]),
    death: cells(BUGS + 'centipede_0.png', 64, 32, [[0, 0], [0, 1], [0, 2], [0, 3]]),
  },
  swarmling: {
    idle: cells(BUGS + 'crawler_0.png', 64, 32, [[2, 0], [3, 0]]),
    death: cells(BUGS + 'crawler_0.png', 64, 32, [[3, 1], [2, 1], [1, 1], [0, 1]]),
  },
  ravager: {
    idle: strip(GOTH + 'Hell-Beast-Files/PNG/without-stroke/hell-beast-idle.png', 6, 55, 67),
    attack: strip(GOTH + 'Hell-Beast-Files/PNG/without-stroke/hell-beast-breath.png', 4, 64, 64),
  },
  matriarch: {
    idle: reading(ARS + 'andromalius-57x88.png', 57, 88, 8, 0, 15),
    attack: strip(ARS + 'andromalius-57x88.png', 8, 57, 88, 2),
  },
  siege_titan: { idle: strip(SCIFI + 'mech-unit/spritesheet/mech-unit.png', 10, 96, 80) },
  // ---- Act 3 ----
  warden: { idle: strip(ARS + 'minion-45x66.png', 3, 45, 66) },
  leech: { idle: files(SWAMP + 'Thing/walk thing/thing#.png', 1, 4) },
  hunter: {
    idle: strip(EYE + 'Flight.png', 8, 150, 150),
    attack: strip(EYE + 'Attack.png', 8, 150, 150),
    hurt: strip(EYE + 'Take Hit.png', 4, 150, 150),
    death: strip(EYE + 'Death.png', 4, 150, 150),
  },
  praetorian: {
    idle: strip(ARS + 'gnu-120x100.png', 5, 120, 100, 0),
    attack: strip(ARS + 'gnu-120x100.png', 5, 120, 100, 2),
    death: strip(ARS + 'gnu-120x100.png', 2, 120, 100, 3),
  },
  omega: { idle: reading(ARS + 'mage-3-87x110.png', 87, 110, 4, 0, 7) },
  // ---- player classes ----
  grunt: { idle: files(CITY2 + 'cop/idle/cop#.png', 1, 3) },
  scout: {
    idle: files(SWAMP + 'Player/idle/idle#.png', 1, 6),
    attack: files(SWAMP + 'Player/shoot/shoot#.png', 1, 3),
    hurt: files(SWAMP + 'Player/hurt/Hurt#.png', 1, 2),
  },
  engineer: {
    idle: strip(SCIFI + 'space-marine/PNG/space-marine-idle.png', 4, 48, 48),
    attack: strip(SCIFI + 'space-marine/PNG/space-marine-shoot.png', 2, 64, 48),
  },
  veteran: {
    idle: files(CITY2 + 'Player/Idle/Idle#.png', 1, 4),
    attack: files(CITY2 + 'Player/Shoot/Shoot#.png', 1, 3),
    hurt: files(CITY2 + 'Player/Hurt/Hurt#.png', 2, 2),
  },
  hybrid: {
    idle: strip(CAVES + 'spritesheets/player/player-idle.png', 4, 80, 80),
    attack: strip(CAVES + 'spritesheets/player/player-stand.png', 3, 80, 80),
    hurt: strip(CAVES + 'spritesheets/player/player-hurt.png', 2, 80, 80),
  },
};

/** Effects keep their full cells (no trimming) so they stay centred. */
const EFFECTS = {
  hit: files(SHOTFX + 'hits/hits-1/frames/hits-1-#.png', 1, 5),
  crit: strip(GFX + 'energy-smack.png', 8, 128, 96),
  explosion: strip(EXPL + 'explosion-3.png', 10, 128, 80),
  shield: strip(GFX + 'energy-shield.png', 8, 51, 47),
  heal: reading(CM + '5_magickahit_spritesheet.png', 100, 100, 7, 1, 40),
};

// ---------- image helpers ----------

const cache = new Map();
const missing = new Set();
function load(file) {
  if (!cache.has(file)) {
    if (!existsSync(ROOT + file)) {
      missing.add(file);
      cache.set(file, null);
    } else {
      cache.set(file, PNG.sync.read(readFileSync(ROOT + file)));
    }
  }
  return cache.get(file);
}

/** Resolves a frame description to { img, x, y, w, h }, or null if the file is missing. */
function resolve(f) {
  const img = load(f.file);
  if (!img) return null;
  return f.whole ? { img, x: 0, y: 0, w: img.width, h: img.height } : { img, x: f.x, y: f.y, w: f.w, h: f.h };
}

const alphaAt = (img, x, y) => (x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 4 + 3]);

/** Smallest box, relative to the frame origin, that holds every drawn pixel in these frames. */
function bounds(frames) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const f of frames) {
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        if (alphaAt(f.img, f.x + x, f.y + y) > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  }
  return x1 < 0 ? { x0: 0, y0: 0, w: 1, h: 1 } : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function blit(src, sx, sy, w, h, dst, dx, dy) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (sx + x >= src.width || sy + y >= src.height) continue;
      const s = ((sy + y) * src.width + sx + x) * 4;
      const d = ((dy + y) * dst.width + dx + x) * 4;
      src.data.copy(dst.data, d, s, s + 4);
    }
  }
}

/** Builds a sheet with one animation per row. Returns its layout, or null if nothing could be read. */
function pack(anims, outPath, trim) {
  const rows = [];
  for (const [name, list] of Object.entries(anims)) {
    const frames = list.map(resolve).filter(Boolean);
    if (!frames.length) continue;
    const box = trim ? bounds(frames) : { x0: 0, y0: 0, w: Math.max(...frames.map((f) => f.w)), h: Math.max(...frames.map((f) => f.h)) };
    rows.push({ name, frames, box });
  }
  if (!rows.length) return null;
  const fw = Math.max(...rows.map((r) => r.box.w));
  const fh = Math.max(...rows.map((r) => r.box.h));
  const out = new PNG({ width: fw * Math.max(...rows.map((r) => r.frames.length)), height: fh * rows.length });
  const layout = { fw, fh, anims: {} };
  rows.forEach((row, r) => {
    row.frames.forEach((f, i) => {
      const dx = i * fw + Math.floor((fw - row.box.w) / 2); // centred
      const dy = r * fh + (fh - row.box.h); // on the ground line
      blit(f.img, f.x + row.box.x0, f.y + row.box.y0, row.box.w, row.box.h, out, dx, dy);
    });
    layout.anims[row.name] = { row: r, frames: row.frames.length };
  });
  writeFileSync(outPath, PNG.sync.write(out));
  return { layout, image: out };
}

// ---------- build ----------

mkdirSync(here('../public/art/chars/'), { recursive: true });
mkdirSync(here('../public/art/fx/'), { recursive: true });
const data = { chars: {}, fx: {} };
const built = [];

for (const [id, anims] of Object.entries(CHARS)) {
  const res = pack(anims, here(`../public/art/chars/${id}.png`), true);
  if (!res) continue;
  data.chars[id] = { src: `art/chars/${id}.png`, ...res.layout };
  built.push(res.image);
  console.log(`${id.padEnd(13)} ${res.layout.fw}x${res.layout.fh}  ${Object.entries(res.layout.anims).map(([n, a]) => `${n}:${a.frames}`).join(' ')}`);
}
for (const [name, frames] of Object.entries(EFFECTS)) {
  const res = pack({ play: frames }, here(`../public/art/fx/${name}.png`), false);
  if (!res) continue;
  data.fx[name] = { src: `art/fx/${name}.png`, fw: res.layout.fw, fh: res.layout.fh, frames: res.layout.anims.play.frames };
  console.log(`fx ${name.padEnd(10)} ${res.layout.fw}x${res.layout.fh} x${data.fx[name].frames}`);
}
writeFileSync(here('../src/ui/art-data.json'), JSON.stringify(data, null, 2) + '\n');

// A contact sheet of every character sheet, for checking the result by eye.
const pad = 6;
const sheet = new PNG({
  width: Math.max(...built.map((b) => b.width)) + pad * 2,
  height: built.reduce((sum, b) => sum + b.height + pad, pad),
});
for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set([40, 44, 52, 255], i);
let y = pad;
for (const img of built) {
  for (let yy = 0; yy < img.height; yy++) {
    for (let xx = 0; xx < img.width; xx++) {
      const s = (yy * img.width + xx) * 4;
      if (img.data[s + 3] > 16) img.data.copy(sheet.data, ((y + yy) * sheet.width + pad + xx) * 4, s, s + 4);
    }
  }
  y += img.height + pad;
}
writeFileSync(here('../assets-staging/contact.png'), PNG.sync.write(sheet));

if (missing.size) {
  console.error('\nMISSING FILES:\n' + [...missing].join('\n'));
  process.exit(1);
}
