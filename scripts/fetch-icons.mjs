// Downloads the icons listed in scripts/icons.txt from game-icons.net (CC BY 3.0)
// into public/icons and regenerates CREDITS.md. Run with: node scripts/fetch-icons.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const AUTHORS = {
  lorc: 'Lorc',
  delapouite: 'Delapouite',
  sbed: 'sbed',
  skoll: 'Skoll',
  'john-colburn': 'John Colburn',
  darkzaitzev: 'DarkZaitzev',
  'caro-asercion': 'Caro Asercion',
  'heavenly-dog': 'HeavenlyDog',
  'various-artists': 'Various artists',
  priorblue: 'PriorBlue',
};

const list = (await readFile(new URL('./icons.txt', import.meta.url), 'utf8'))
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

const outDir = new URL('../public/icons/', import.meta.url);
await mkdir(outDir, { recursive: true });

const failed = [];
await Promise.all(
  list.map(async (path) => {
    const name = path.split('/')[1];
    const res = await fetch(`https://raw.githubusercontent.com/game-icons/icons/master/${path}.svg`);
    if (!res.ok) return failed.push(path);
    // Drop the black background square so the icon can be tinted with a CSS mask.
    const svg = (await res.text()).replace('<path d="M0 0h512v512H0z"/>', '');
    await writeFile(new URL(`${name}.svg`, outDir), svg);
  }),
);

const rows = list
  .map((p) => p.split('/'))
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([author, name]) => `| ${name}.svg | ${AUTHORS[author] ?? author} |`);

await writeFile(
  new URL('../CREDITS.md', import.meta.url),
  `# Credits

Everything here is either public domain (CC0) or used under an attribution licence
(CC-BY 3.0, OGA-BY 3.0), credited below. Licences were checked on each source page on 2026-11-14.

## Icons

All icons in \`public/icons/\` are from [game-icons.net](https://game-icons.net), used under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The black background square was removed
from each file so the icons can be tinted in CSS. The list is in \`scripts/icons.txt\`; re-download
with \`node scripts/fetch-icons.mjs\`.

| File | Author |
|---|---|
${rows.join('\n')}

${await readFile(new URL('./credits-art-audio.md', import.meta.url), 'utf8')}`,
);

console.log(`${list.length - failed.length}/${list.length} icons downloaded`);
if (failed.length) {
  console.error('FAILED:', failed.join(', '));
  process.exit(1);
}
