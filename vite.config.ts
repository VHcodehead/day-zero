import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths, so the build works from any folder on any static host.
  base: './',
  plugins: [
    {
      name: 'publish-credits',
      buildStart() {
        copyFileSync('CREDITS.md', 'public/credits.txt');
      },
    },
  ],
});
