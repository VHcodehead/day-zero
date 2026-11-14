// Converts the chosen files from assets-staging/audio into public/audio as OGG,
// trimming long ones and matching peak volume. Needs ffmpeg on the PATH.
// Run with: node scripts/build-audio.mjs
// Sources and licences are listed in CREDITS.md and assets-staging/audio/MANIFEST.md.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STAGING = new URL('../assets-staging/audio/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = new URL('../public/audio/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** name -> list of [pack folder, file-name regex, how many matches to take, options] */
const SFX = {
  click: [['kenney-interface-sounds', /^click_00[1-3]\.ogg$/, 3]],
  card: [['kenney-casino-audio', /^card-slide-[1-4]\.ogg$/, 4]],
  draw: [['kenney-casino-audio', /^card-place-[1-2]\.ogg$/, 2]],
  hit: [
    ['qubodup-impact', /^qubodupImpactMeat0[12]\.ogg$/, 2],
    ['untamedpixels-150-combat-sfx', /^impact_punch_medium.*\.wav$/, 3],
  ],
  crit: [['untamedpixels-150-combat-sfx', /^impact_punch_heavy.*\.wav$/, 3]],
  hurt: [['qubodup-male-strain-hurt', /^slightscream-0[1-4]\.flac$/, 4, { trim: 1.2 }]],
  block: [['kenney-sci-fi-sounds', /^forceField_00[0-2]\.ogg$/, 3, { trim: 0.9 }]],
  blocked: [['kenney-sci-fi-sounds', /^impactMetal_00[0-2]\.ogg$/, 3]],
  heal: [['someoneman-cure-magic', /^Cure[1-3]\.wav$/i, 3, { trim: 1.8 }]],
  miss: [['artisticdude-swishes', /^swish-[1-3]\.wav$/, 3]],
  enemy: [['rubberduck-80-cc0-creature-sfx-2', /^attack_0[1-5]\.ogg$/, 5, { trim: 1.2 }]],
  die: [['rubberduck-80-cc0-creature-sfx-2', /^die_0[1-4]\.ogg$/, 4, { trim: 1.8 }]],
  buy: [['kenney-interface-sounds', /^confirmation_00[1-2]\.ogg$/, 2]],
  deny: [['kenney-interface-sounds', /^error_00[1-3]\.ogg$/, 3]],
  reset: [['qubodup-wind-hit-time-morph', /^qubodup-slomo1\.wav$/, 1, { trim: 2.2 }]],
  win: [['music-srg774-dark-sci-fi-audio-pack', /^victory\.ogg$/, 1]],
  lose: [['kenney-digital-audio', /^lowThreeTone\.mp3$/, 1]],
  roar: [['trazzz123-deep-monster-roar', /^monster_roar\.wav$/, 1, { trim: 3 }]],
  shoot: [
    ['baradari-gun-shots', /^pistol\.wav$/, 1, { trim: 0.7 }],
    ['baradari-gun-shots', /^rifle\.wav$/, 1, { trim: 0.6 }],
  ],
  explosion: [['kenney-sci-fi-sounds', /^explosionCrunch_00[0-2]\.ogg$/, 3]],
  dice: [['kenney-casino-audio', /^dice-throw-[1-3]\.ogg$/, 3]],
};

const MUSIC = {
  title: ['music-srg774-dark-sci-fi-audio-pack', /^title\.ogg$/],
  map: ['music-junkala-horror-atmosphere', /Post_Apocalyptic_Wastelands.*\.ogg$/],
  combat: ['music-tsorthan-grove-la-war-zone', /war_zone_loop\.flac$/],
  boss: ['music-mintodog-boss-battles', /^heavy_boss_battle_1.*\.ogg$/],
  calm: ['music-tsorthan-grove-gates-to-infinity', /Gates to Infinity \(Loop\)\.ogg$/],
};

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (name === '__MACOSX') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function find(pack, regex, count = 1) {
  const files = walk(join(STAGING, pack))
    .filter((p) => regex.test(p.split(/[\\/]/).pop()))
    .sort();
  if (files.length < count) console.warn(`  ! ${pack}: wanted ${count} of ${regex}, found ${files.length}`);
  return files.slice(0, count);
}

function ffmpeg(args) {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr.split('\n').slice(-4).join('\n'));
  return res.stderr;
}

/** Peak level of a file in dB (0 = full scale). */
function peak(input, trim) {
  const out = ffmpeg(['-i', input, ...(trim ? ['-t', String(trim)] : []), '-af', 'volumedetect', '-f', 'null', '-']);
  return Number(/max_volume: (-?[\d.]+) dB/.exec(out)?.[1] ?? 0);
}

mkdirSync(join(OUT, 'sfx'), { recursive: true });
mkdirSync(join(OUT, 'music'), { recursive: true });
const manifest = { sfx: {}, music: {} };

for (const [name, sources] of Object.entries(SFX)) {
  manifest.sfx[name] = [];
  let n = 1;
  for (const [pack, regex, count, opts = {}] of sources) {
    for (const input of find(pack, regex, count)) {
      const rel = `audio/sfx/${name}-${n++}.ogg`;
      const gain = (-2 - peak(input, opts.trim)).toFixed(1); // bring every effect to the same peak
      const filters = [`volume=${gain}dB`];
      if (opts.trim) filters.push(`afade=t=out:st=${(opts.trim * 0.75).toFixed(2)}:d=${(opts.trim * 0.25).toFixed(2)}`);
      ffmpeg(['-i', input, ...(opts.trim ? ['-t', String(opts.trim)] : []), '-af', filters.join(','), '-ac', '2', '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '4', join(OUT, '..', rel)]);
      manifest.sfx[name].push(rel);
    }
  }
  console.log(`${name}: ${manifest.sfx[name].length}`);
}

for (const [name, [pack, regex]] of Object.entries(MUSIC)) {
  const [input] = find(pack, regex);
  if (!input) continue;
  const rel = `audio/music/${name}.ogg`;
  ffmpeg(['-i', input, '-af', 'loudnorm=I=-20:TP=-2:LRA=11', '-ac', '2', '-ar', '44100', '-c:a', 'libvorbis', '-q:a', '3', join(OUT, '..', rel)]);
  manifest.music[name] = rel;
  console.log(`music ${name}: ${(statSync(join(OUT, '..', rel)).size / 1e6).toFixed(1)} MB`);
}

console.log('\n' + JSON.stringify(manifest));
